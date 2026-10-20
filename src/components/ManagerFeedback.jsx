import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { t, layout } from '../lib/theme'
import { reviewCycle, formatCycle } from '../lib/cycles'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export default function ManagerFeedback({ userId, onSuggestGoals }) {
  const emptyForm = () => ({ period_start: reviewCycle().start, period_end: reviewCycle().end, content: '' })
  const [entries, setEntries] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  // A saved record's id, 'add' for the form, or null for the newest record
  const [selected, setSelected] = useState(null)
  const [fullIds, setFullIds] = useState({})
  const [error, setError] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { fetchEntries() }, [userId])

  async function fetchEntries() {
    const { data } = await supabase.from('manager_feedback').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    setEntries(data || [])
  }

  async function extractPdf(file) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('That file isn\'t a PDF.'); return }
    setError('')
    setExtracting(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const pages = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        const lineMap = new Map()
        for (const item of content.items) {
          if (!item.str) continue
          const y = Math.round(item.transform[5])
          if (!lineMap.has(y)) lineMap.set(y, [])
          lineMap.get(y).push({ x: item.transform[4], str: item.str })
        }
        const sortedYs = [...lineMap.keys()].sort((a, b) => b - a)
        const lines = []
        let prevY = null
        for (const y of sortedYs) {
          if (prevY !== null && Math.abs(prevY - y) > 20) lines.push('')
          const items = lineMap.get(y).sort((a, b) => a.x - b.x)
          lines.push(items.map(it => it.str).join(' ').trim())
          prevY = y
        }
        pages.push(lines.join('\n'))
      }
      setForm(f => ({ ...f, content: pages.join('\n\n').trim() }))
    } catch (err) {
      setError(`Couldn't read text from that PDF: ${err.message}`)
    } finally {
      setExtracting(false)
    }
  }

  async function save() {
    setError('')
    setSaving(true)
    try {
      const { error: sbError } = await supabase.from('manager_feedback').insert({ user_id: userId, ...form })
      if (sbError) throw sbError
      setForm(emptyForm())
      setSelected(null)
      fetchEntries()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteEntry(id) {
    if (!confirm('Delete this feedback record?')) return
    await supabase.from('manager_feedback').delete().eq('id', id)
    setSelected(null)
    fetchEntries()
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    extractPdf(e.dataTransfer.files?.[0])
  }

  const current = selected === 'add' ? null : entries.find(e => e.id === selected) || entries[0] || null
  const adding = !current
  const canSave = form.content.trim() && form.period_start && form.period_end
  const rangeOf = entry => entry.period_start && entry.period_end ? formatCycle({ start: entry.period_start, end: entry.period_end }) : 'Undated'

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <header style={s.header}>
          <span style={s.eyebrow}>Shapes your goals and future reflections</span>
          <h1 style={s.h1}>Manager feedback</h1>
        </header>

        <div role="tablist" aria-label="Feedback by review period" style={s.tiles}>
          {entries.map(entry => {
            const on = current?.id === entry.id
            return (
              <button key={entry.id} type="button" role="tab" className="tile-btn" aria-selected={on} onClick={() => setSelected(entry.id)}
                style={{ ...s.tile, ...(on ? s.tileOn : {}) }}>
                <span style={{ ...s.tileEyebrow, ...(on ? { color: t.accentInk } : {}) }}>Review period</span>
                <span style={s.tileTitle}>{rangeOf(entry)}</span>
                <span style={{ ...s.tileMeta, ...(on ? { color: t.accentInk } : {}) }}>Saved {formatSaved(entry.created_at)}</span>
              </button>
            )
          })}
          <button type="button" role="tab" className="tile-btn" aria-selected={adding} onClick={() => setSelected('add')}
            style={{ ...s.tile, ...s.tileAdd, ...(adding ? s.tileOn : {}) }}>
            <span style={{ ...s.tileEyebrow, ...(adding ? { color: t.accentInk } : {}) }}>{entries.length ? 'Next review period' : 'First review period'}</span>
            <span style={s.tileTitle}>+ Add feedback</span>
            <span style={{ ...s.tileMeta, ...(adding ? { color: t.accentInk } : {}) }}>Paste text or upload a PDF</span>
          </button>
        </div>

        {error && <p role="alert" style={s.error}>{error}</p>}

        {current && (() => {
          const full = fullIds[current.id]
          const long = current.content.length > PREVIEW_CHARS
          const text = full || !long ? current.content : current.content.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '') + '…'
          const range = rangeOf(current)
          return (
            <div role="tabpanel" style={s.columns}>
              <article className="page-card" style={s.card}>
                <div style={s.cardHead}>
                  <div style={s.cardHeadText}>
                    <h2 style={s.h2}>{range}</h2>
                    <span style={s.meta}>Saved {formatSaved(current.created_at)}</span>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => deleteEntry(current.id)} aria-label={`Delete feedback ${range}`} title="Delete" style={s.iconBtn}>
                    <Icon size={16} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </button>
                </div>
                <blockquote style={s.quote}>{text}</blockquote>
                {long && (
                  <button type="button" onClick={() => setFullIds(f => ({ ...f, [current.id]: !full }))} style={s.linkBtn}>
                    {full ? 'Show less' : 'Show full feedback'}
                  </button>
                )}
              </article>
              {onSuggestGoals && (
                <aside style={s.darkCard}>
                  <span style={s.darkEyebrow}>Turn it into goals</span>
                  <p style={s.darkTitle}>Suggest goals from this feedback.</p>
                  <button type="button" onClick={() => onSuggestGoals(current.id)} style={s.brightBtn}>Suggest goals</button>
                </aside>
              )}
            </div>
          )
        })()}

        {adding && (
          <section role="tabpanel" aria-labelledby="add-h"
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
            onDrop={onDrop}
            className="page-card" style={{ ...s.addCard, ...(dragging ? s.addCardDrag : {}) }}>
            <h2 id="add-h" style={s.h2}>Add feedback</h2>
            <div style={s.dates}>
              <div style={s.field}>
                <label htmlFor="m-start" style={s.smallLabel}>Period from</label>
                <input id="m-start" type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} style={s.dateInput} />
              </div>
              <div style={s.field}>
                <label htmlFor="m-end" style={s.smallLabel}>to</label>
                <input id="m-end" type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} style={s.dateInput} />
              </div>
            </div>
            <div style={s.field}>
              <label htmlFor="m-text" style={s.smallLabel}>Feedback</label>
              <textarea id="m-text" rows={9} value={form.content} disabled={extracting}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder={extracting ? 'Reading PDF…' : "Paste your manager's written feedback…"} style={s.textarea} />
              <span style={s.hint}>Or drop a PDF anywhere on this card. Its text appears here for you to check before saving.</span>
            </div>
            <input type="file" accept="application/pdf" ref={fileInputRef} onChange={e => { extractPdf(e.target.files?.[0]); e.target.value = '' }} style={{ display: 'none' }} />
            <div style={s.addActions}>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={extracting} style={s.dashedBtn}>
                <Icon size={16}><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></Icon>
                {extracting ? 'Reading PDF…' : 'Upload PDF instead'}
              </button>
              <button type="button" onClick={save} disabled={saving || !canSave} style={{ ...s.saveBtn, ...(saving || !canSave ? s.disabled : {}) }}>
                {saving ? 'Saving…' : 'Save feedback'}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function Icon({ d, size = 18, strokeWidth = 1.8, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  )
}

function formatSaved(ts) {
  if (!ts) return ''
  return new Date(ts.includes('T') ? ts : ts + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PREVIEW_CHARS = 420

const control = { boxSizing: 'border-box', width: '100%', border: `1px solid ${t.border}`, borderRadius: 10, background: t.field, fontFamily: 'inherit', fontSize: 14, color: t.text }
const btn = { height: 44, padding: '0 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }

const s = {
  ...layout,
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 },
  tile: { textAlign: 'left', padding: 16, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: t.border, background: t.white, color: t.text, display: 'flex', flexDirection: 'column', gap: 8 },
  tileAdd: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.borderDash },
  tileOn: { borderWidth: 2, borderStyle: 'solid', borderColor: t.accent, background: t.accentSoft },
  tileEyebrow: { fontFamily: t.fontMono, fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: t.muted },
  tileTitle: { fontSize: 17, fontWeight: 600 },
  tileMeta: { fontSize: 13, color: t.muted },
  columns: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 },
  card: { flex: '999 1 520px', minWidth: 0, margin: 0, background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 28, display: 'flex', flexDirection: 'column', gap: 18 },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardHeadText: { display: 'flex', flexDirection: 'column', gap: 2 },
  h2: { margin: 0, fontFamily: t.fontDisplay, fontSize: 22, fontWeight: 600 },
  meta: { fontSize: 13, color: t.muted },
  iconBtn: { width: 40, height: 40, borderRadius: 10, border: `1px solid ${t.border}`, background: t.white, color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  quote: { margin: 0, padding: '18px 20px', borderRadius: 14, background: t.tints[0], fontSize: 16, lineHeight: 1.65, color: t.body, whiteSpace: 'pre-wrap' },
  linkBtn: { alignSelf: 'flex-start', height: 40, padding: 0, border: 0, background: 'transparent', color: t.accent, fontSize: 14, fontWeight: 600 },
  darkCard: { flex: '1 1 280px', maxWidth: 360, boxSizing: 'border-box', background: t.dark, color: t.white, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 },
  darkEyebrow: { fontFamily: t.fontMono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.bright },
  darkTitle: { margin: 0, fontSize: 19, fontWeight: 600, lineHeight: 1.3 },
  brightBtn: { ...btn, fontSize: 15, border: 0, background: t.bright, color: t.dark },
  addCard: { maxWidth: 760, boxSizing: 'border-box', background: t.white, borderWidth: 1, borderStyle: 'solid', borderColor: t.border, borderRadius: 18, padding: 28, display: 'flex', flexDirection: 'column', gap: 18 },
  addCardDrag: { borderColor: t.accent, background: t.accentSoft },
  dates: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  smallLabel: { fontSize: 13, fontWeight: 600 },
  dateInput: { ...control, height: 44, minHeight: 44, padding: '0 10px' },
  textarea: { ...control, resize: 'vertical', padding: 14, fontSize: 15, lineHeight: 1.6 },
  hint: { fontSize: 13, color: t.muted },
  addActions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  dashedBtn: { ...btn, fontWeight: 400, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.borderDash, background: 'transparent', color: t.secondary },
  saveBtn: { ...btn, padding: '0 20px', fontSize: 15, border: 0, background: t.accent, color: t.white },
  error: { margin: 0, fontSize: 14, color: t.danger },
  disabled: { opacity: 0.5 },
}
