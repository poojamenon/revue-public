import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callClaude } from '../lib/claude'
import { SELF_REFLECTION_SYSTEM, selfReflectionPrompt } from '../lib/prompts'
import { t, layout } from '../lib/theme'
import { reviewCycle } from '../lib/cycles'

const SECTIONS = [
  { key: 'product_impact', label: 'Product/Company Impact', title: 'Product / company impact', blurb: 'The projects you worked on and what you did' },
  { key: 'team_impact', label: 'Team Impact', title: 'Team impact', blurb: 'Who you worked with and what you did together' },
  { key: 'personal_growth', label: 'Personal Growth', title: 'Personal growth', blurb: 'Progress on your goals and what was hard' },
  { key: 'team_growth', label: 'Team Growth', title: 'Team growth', blurb: 'What you started or shared for the design team' },
]

export default function SelfReflection({ userId }) {
  const [periodStart, setPeriodStart] = useState(() => reviewCycle().start)
  const [periodEnd, setPeriodEnd] = useState(() => reviewCycle().end)
  const [draft, setDraft] = useState(null)
  // The saved row the open draft belongs to, so edits can be written back to it
  const [draftMeta, setDraftMeta] = useState(null)
  const [savedDrafts, setSavedDrafts] = useState([])
  const [latestFeedback, setLatestFeedback] = useState(null)
  const [activeGoalCount, setActiveGoalCount] = useState(null)
  const [includeGoals, setIncludeGoals] = useState(true)
  const [includeFeedback, setIncludeFeedback] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [regeneratingKey, setRegeneratingKey] = useState(null)
  const [openKey, setOpenKey] = useState(SECTIONS[0].key)
  const [instructions, setInstructions] = useState({})
  const [saveState, setSaveState] = useState('saved')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const saveTimer = useRef(null)
  const [pastOpen, setPastOpen] = useState(false)
  // Open the menu toward whichever side of the button has room
  const [pastAlign, setPastAlign] = useState('right')
  const pastRef = useRef(null)

  useEffect(() => { fetchSavedDrafts(); fetchLatestFeedback() }, [userId])
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  // Close the past-drafts menu on an outside click or Escape
  useEffect(() => {
    if (!pastOpen) return
    const close = e => { if (!pastRef.current?.contains(e.target)) setPastOpen(false) }
    const esc = e => { if (e.key === 'Escape') setPastOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [pastOpen])

  async function fetchSavedDrafts() {
    const { data } = await supabase.from('drafts').select('*').eq('user_id', userId).eq('type', 'self_reflection').order('created_at', { ascending: false })
    setSavedDrafts(data || [])
  }

  async function fetchLatestFeedback() {
    const [{ data }, { count }] = await Promise.all([
      supabase.from('manager_feedback').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
      supabase.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
    ])
    setLatestFeedback(data?.[0] || null)
    setActiveGoalCount(count ?? null)
  }

  async function sources() {
    const [{ data: entries }, { data: goals }] = await Promise.all([
      supabase.from('entries').select('*').eq('user_id', userId).gte('week_of', periodStart).lte('week_of', periodEnd),
      includeGoals ? supabase.from('goals').select('*').eq('user_id', userId).eq('status', 'active') : Promise.resolve({ data: [] }),
    ])
    const feedback = includeFeedback && latestFeedback ? latestFeedback.content : null
    return { entries: entries || [], goals: goals || [], feedback }
  }

  async function generate() {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return }
    setGenerating(true); setError('')
    try {
      const { entries, goals, feedback } = await sources()
      if (!entries.length) { setError('No weekly log entries found for this period.'); return }
      const raw = await callClaude(apiKey, SELF_REFLECTION_SYSTEM, selfReflectionPrompt(entries, goals, feedback))
      const content = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw)
      const { data: row } = await supabase.from('drafts').insert({ user_id: userId, type: 'self_reflection', period_start: periodStart, period_end: periodEnd, content }).select().single()
      setDraft(content)
      setDraftMeta(row || { period_start: periodStart, period_end: periodEnd })
      setOpenKey(SECTIONS[0].key)
      setSaveState('saved')
      fetchSavedDrafts()
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function regenerateSection(key) {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return }
    setRegeneratingKey(key); setError('')
    try {
      const { entries, goals, feedback } = await sources()
      const section = SECTIONS.find(s => s.key === key)
      const how = instructions[key]?.trim()
      const prompt = selfReflectionPrompt(entries, goals, feedback) + (how
        ? `\n\nHere is the current "${section.label}" section:\n\n${draft[key] || ''}\n\nRewrite ONLY this section, following these instructions: ${how}\nReturn just the text, no JSON.`
        : `\n\nRewrite ONLY the "${section.label}" section. Return just the text, no JSON.`)
      const text = await callClaude(apiKey, SELF_REFLECTION_SYSTEM, prompt)
      updateSection(key, text)
      setInstructions(i => ({ ...i, [key]: '' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setRegeneratingKey(null)
    }
  }

  function updateSection(key, text) {
    const next = { ...draft, [key]: text }
    setDraft(next)
    scheduleSave(next)
  }

  // Write edits back to the saved draft shortly after typing stops
  function scheduleSave(content) {
    if (!draftMeta?.id) return
    const id = draftMeta.id
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const { error: saveError } = await supabase.from('drafts').update({ content }).eq('id', id)
      if (saveError) { setSaveState('error'); return }
      setSavedDrafts(list => list.map(d => d.id === id ? { ...d, content } : d))
      setSaveState('saved')
    }, 800)
  }

  function loadDraft(saved) {
    clearTimeout(saveTimer.current)
    setDraft(saved.content)
    setDraftMeta(saved)
    setPeriodStart(saved.period_start)
    setPeriodEnd(saved.period_end)
    setOpenKey(SECTIONS[0].key)
    setSaveState('saved')
  }

  async function deleteDraft(id) {
    if (!confirm('Delete this draft?')) return
    await supabase.from('drafts').delete().eq('id', id)
    if (draftMeta?.id === id) { setDraft(null); setDraftMeta(null) }
    fetchSavedDrafts()
  }

  function asMarkdown() {
    return SECTIONS.map(s => `## ${s.label}\n\n${draft[s.key] || ''}`).join('\n\n---\n\n')
  }

  function copyAll() {
    navigator.clipboard.writeText(asMarkdown())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function exportDraft() {
    const title = `# Self-reflection: ${formatRange(draftMeta.period_start, draftMeta.period_end, ' – ')}\n\n`
    const url = URL.createObjectURL(new Blob([title + asMarkdown() + '\n'], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `self-reflection-${draftMeta.period_start}-to-${draftMeta.period_end}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveLabel = { saved: 'Edits save automatically', saving: 'Saving…', error: "Couldn't save your last edit. Keep this page open and try again." }[saveState]
  const feedbackRange = latestFeedback ? formatRange(latestFeedback.period_start, latestFeedback.period_end, ' – ') || 'Latest saved' : 'None saved yet'
  const openSection = SECTIONS.find(x => x.key === openKey) || SECTIONS[0]
  const busy = regeneratingKey === openSection.key

  const periodInputs = dark => (
    <div style={s.dates}>
      <div style={s.field}>
        <label htmlFor={`p-start-${dark ? 'd' : 'l'}`} style={{ ...s.smallLabel, ...(dark ? { color: t.onDarkMuted, fontWeight: 500 } : {}) }}>From</label>
        <input id={`p-start-${dark ? 'd' : 'l'}`} type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={dark ? s.dateDark : s.dateInput} />
      </div>
      <div style={s.field}>
        <label htmlFor={`p-end-${dark ? 'd' : 'l'}`} style={{ ...s.smallLabel, ...(dark ? { color: t.onDarkMuted, fontWeight: 500 } : {}) }}>To</label>
        <input id={`p-end-${dark ? 'd' : 'l'}`} type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={dark ? s.dateDark : s.dateInput} />
      </div>
    </div>
  )

  const pastDrafts = savedDrafts.length > 0 && (
    <div ref={pastRef} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="true" aria-expanded={pastOpen} aria-controls="past-menu" onClick={e => { setPastAlign(e.currentTarget.getBoundingClientRect().right >= 336 ? 'right' : 'left'); setPastOpen(o => !o) }}
        style={{ ...s.outlineBtn, ...(pastOpen ? s.outlineOn : {}) }}>
        <Icon size={16}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></Icon>
        Past drafts <span style={s.count}>{savedDrafts.length}</span>
      </button>
      {pastOpen && (
        <section id="past-menu" aria-label="Past drafts" style={{ ...s.pastMenu, ...(pastAlign === 'right' ? { right: 0 } : { left: 0 }) }}>
          {savedDrafts.map(d => {
            const current = draftMeta?.id === d.id
            return (
              <div key={d.id} style={{ ...s.pastItem, ...(current ? s.pastItemOn : {}) }}>
                <button type="button" aria-current={current || undefined} onClick={() => { loadDraft(d); setPastOpen(false) }} style={s.pastOpen}>
                  <span style={s.pastTitle}>{formatRange(d.period_start, d.period_end, ' → ')}</span>
                  <span style={s.pastMeta}>Created {formatDate(d.created_at)}</span>
                </button>
                <button type="button" className="icon-btn" onClick={() => deleteDraft(d.id)}
                  aria-label={`Delete draft ${formatRange(d.period_start, d.period_end, ' to ')}`} title="Delete" style={s.iconBtn}>
                  <Icon size={16} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </button>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <header style={s.topHeader}>
          <div style={s.header}>
            <span style={s.eyebrow}>{draft ? `Draft · ${formatRange(draftMeta?.period_start, draftMeta?.period_end, ' – ')}` : 'No draft open'}</span>
            <h1 style={s.h1}>Self-reflection</h1>
          </div>
          {(draft || pastDrafts) && (
            <div style={s.headActions}>
              {pastDrafts}
              {draft && (
                <>
                  <button type="button" onClick={copyAll} style={s.outlineBtn}>
                    <Icon size={16}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>
                    {copied ? 'Copied!' : 'Copy all'}
                  </button>
                  <button type="button" onClick={exportDraft} style={s.outlineBtn}>
                    <Icon size={16}><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></Icon>
                    Export
                  </button>
                </>
              )}
            </div>
          )}
        </header>

        {draft ? (
          <div role="tablist" aria-label="Sections" style={s.tiles}>
            {SECTIONS.map((sec, i) => {
              const on = sec.key === openSection.key
              const words = (draft[sec.key] || '').trim().split(/\s+/).filter(Boolean).length
              return (
                <button key={sec.key} type="button" role="tab" className="tile-btn" aria-selected={on} aria-controls="section-panel" onClick={() => setOpenKey(sec.key)}
                  style={{ ...s.tile, background: t.tints[i % t.tints.length], ...(on ? s.tileOn : {}) }}>
                  <span style={{ ...s.tileEyebrow, ...(on ? { color: t.accentInk } : {}) }}>{String(i + 1).padStart(2, '0')}{words ? ' · Drafted' : ''}</span>
                  <span style={s.tileTitle}>{sec.title}</span>
                  <span style={{ ...s.tileMeta, ...(on ? { color: t.accentInk } : {}) }}>{words ? `${words} words` : 'Empty'}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div aria-hidden="true" style={s.tiles}>
            {SECTIONS.map((sec, i) => (
              <div key={sec.key} style={{ ...s.tile, ...s.tileEmpty }}>
                <span style={s.tileEyebrow}>{String(i + 1).padStart(2, '0')}</span>
                <span style={{ ...s.tileTitle, color: t.secondary }}>{sec.title}</span>
                <span style={s.tileMeta}>Not drafted</span>
              </div>
            ))}
          </div>
        )}

        {draft ? (
          <div style={s.columns}>
            <article id="section-panel" role="tabpanel" aria-labelledby="sec-h" className="page-card" style={s.editor}>
              <div style={s.editorHead}>
                <h2 id="sec-h" style={s.editorTitle}>{openSection.title}</h2>
                <span role="status" style={{ ...s.saveText, ...(saveState === 'error' ? { color: t.danger } : {}) }}>{saveLabel}</span>
              </div>
              <label htmlFor="sec-text" style={s.srOnly}>{openSection.title}</label>
              <textarea id="sec-text" rows={12} value={draft[openSection.key] || ''}
                onChange={e => updateSection(openSection.key, e.target.value)} style={s.sectionText} />
              <div style={s.rewriteRow}>
                <label htmlFor="rw" style={s.srOnly}>Rewrite instructions for {openSection.title}</label>
                <input id="rw" type="text" value={instructions[openSection.key] || ''}
                  onChange={e => setInstructions(v => ({ ...v, [openSection.key]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && !busy && regenerateSection(openSection.key)}
                  placeholder="Rewrite… e.g. shorter, lead with outcomes" style={s.rewriteInput} />
                <button type="button" onClick={() => regenerateSection(openSection.key)} disabled={busy}
                  style={{ ...s.rewriteBtn, ...(busy ? s.disabled : {}) }}>
                  <Icon size={15} strokeWidth={2}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></Icon>
                  {busy ? 'Rewriting…' : 'Rewrite'}
                </button>
              </div>
              {error && <p role="alert" style={s.error}>{error}</p>}
            </article>

            <aside style={s.aside}>
              <section aria-labelledby="new-h" style={s.darkCard}>
                <h2 id="new-h" style={s.darkEyebrow}>New draft</h2>
                {periodInputs(true)}
                <fieldset style={s.fieldset}>
                  <legend style={s.srOnly}>Draw from</legend>
                  <label style={s.darkCheck}><input type="checkbox" checked disabled style={s.darkCheckbox} />Weekly logs</label>
                  <label style={s.darkCheck}><input type="checkbox" checked={includeGoals} onChange={e => setIncludeGoals(e.target.checked)} style={s.darkCheckbox} />Goals</label>
                  <label style={s.darkCheck}>
                    <input type="checkbox" checked={includeFeedback && !!latestFeedback} disabled={!latestFeedback} onChange={e => setIncludeFeedback(e.target.checked)} style={s.darkCheckbox} />
                    Manager feedback ({feedbackRange})
                  </label>
                </fieldset>
                <button type="button" onClick={generate} disabled={generating} style={{ ...s.brightBtn, ...(generating ? s.disabled : {}) }}>
                  {generating ? 'Building…' : 'Build new draft'}
                </button>
              </section>
            </aside>
          </div>
        ) : (
          <>
            <section aria-labelledby="start-h" className="page-card" style={s.startCard}>
              <div style={s.startMain}>
                <div style={s.startIntro}>
                  <h2 id="start-h" style={s.startTitle}>Turn your weeks into a first draft</h2>
                  <p style={s.startText}>Pick the period you're reviewing. All four sections are written from your logs, goals and feedback. Then you edit and rewrite until it sounds like you.</p>
                </div>
                <div style={s.field}>
                  <span style={s.groupLabel}>Review period</span>
                  {periodInputs(false)}
                </div>
                <fieldset style={s.fieldset}>
                  <legend style={{ ...s.groupLabel, padding: 0, marginBottom: 8 }}>Draw from</legend>
                  <label style={s.sourceRow}>
                    <input type="checkbox" checked disabled style={s.checkbox} />
                    <span style={s.sourceName}>Weekly logs</span>
                    <span style={s.sourceMeta}>Always included</span>
                  </label>
                  <label style={s.sourceRow}>
                    <input type="checkbox" checked={includeGoals} onChange={e => setIncludeGoals(e.target.checked)} style={s.checkbox} />
                    <span style={s.sourceName}>Goals</span>
                    <span style={s.sourceMeta}>{activeGoalCount != null ? `${activeGoalCount} active` : ''}</span>
                  </label>
                  <label style={{ ...s.sourceRow, ...(latestFeedback ? {} : { opacity: 0.6 }) }}>
                    <input type="checkbox" checked={includeFeedback && !!latestFeedback} disabled={!latestFeedback} onChange={e => setIncludeFeedback(e.target.checked)} style={s.checkbox} />
                    <span style={s.sourceName}>Manager feedback</span>
                    <span style={s.sourceMeta}>{feedbackRange}</span>
                  </label>
                </fieldset>
                <div style={s.buildRow}>
                  <button type="button" onClick={generate} disabled={generating} style={{ ...s.buildBtn, ...(generating ? s.disabled : {}) }}>
                    <Icon size={16} d="M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" />
                    {generating ? 'Building…' : savedDrafts.length ? 'Build draft' : 'Build my first draft'}
                  </button>
                  <span style={{ ...s.sourceMeta, color: t.muted }}>Takes about a minute</span>
                </div>
                {error && <p role="alert" style={s.error}>{error}</p>}
              </div>

              <div style={s.whatCard}>
                <span style={s.darkEyebrow}>What you'll get</span>
                <ol style={s.whatList}>
                  {SECTIONS.map((sec, i) => (
                    <li key={sec.key} style={s.whatItem}>
                      <span style={s.whatNum}>{String(i + 1).padStart(2, '0')}</span>
                      <span style={s.whatText}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{sec.title}</span>
                        <span style={s.whatBlurb}>{sec.blurb}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p style={s.whatFoot}>Thin on logs? Add a few weeks in the Weekly Log first. Drafts get better with every entry.</p>
              </div>
            </section>
          </>
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

function toDate(str) {
  return new Date(str + (str.includes('T') ? '' : 'T00:00:00'))
}

function formatDate(str) {
  if (!str) return ''
  return toDate(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// "Apr 1 → Oct 12, 2026", or with both years when they differ
function formatRange(start, end, sep) {
  if (!start || !end) return ''
  const a = toDate(start), b = toDate(end)
  const md = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return a.getFullYear() === b.getFullYear()
    ? `${md(a)}${sep}${md(b)}, ${b.getFullYear()}`
    : `${formatDate(start)}${sep}${formatDate(end)}`
}

const control = { boxSizing: 'border-box', width: '100%', border: `1px solid ${t.border}`, borderRadius: 10, background: t.field, fontFamily: 'inherit', fontSize: 14, color: t.text }
const btn = { height: 44, padding: '0 14px', borderRadius: 10, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }

const s = {
  ...layout,
  topHeader: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  headActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  outlineBtn: { ...btn, borderWidth: 1, borderStyle: 'solid', borderColor: t.border, background: t.white, color: t.text, fontWeight: 500 },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))', gap: 12, overflowX: 'auto', paddingBottom: 4 },
  tile: { textAlign: 'left', padding: 16, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: t.border, color: t.text, display: 'flex', flexDirection: 'column', gap: 8 },
  tileOn: { borderWidth: 2, borderColor: t.accent, background: t.accentSoft },
  tileEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.borderDash },
  tileEyebrow: { fontFamily: t.fontMono, fontSize: 11, textTransform: 'uppercase', color: t.muted },
  tileTitle: { fontSize: 17, fontWeight: 600 },
  tileMeta: { fontSize: 13, color: t.muted },
  columns: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 },
  editor: { flex: '999 1 520px', minWidth: 0, background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 28, display: 'flex', flexDirection: 'column', gap: 20 },
  editorHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  editorTitle: { margin: 0, fontFamily: t.fontDisplay, fontSize: 22, fontWeight: 600 },
  saveText: { fontSize: 13, color: t.muted },
  sectionText: { boxSizing: 'border-box', width: '100%', resize: 'vertical', border: `1px solid ${t.border}`, borderRadius: 12, background: t.white, padding: '18px 20px', fontFamily: 'inherit', fontSize: 16, lineHeight: 1.7, color: t.body },
  rewriteRow: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, borderRadius: 12, background: t.canvas },
  rewriteInput: { flex: '1 1 240px', boxSizing: 'border-box', height: 44, border: `1px solid ${t.border}`, borderRadius: 10, background: t.white, padding: '0 12px', fontFamily: 'inherit', fontSize: 14, color: t.text },
  rewriteBtn: { ...btn, padding: '0 16px', border: 0, background: t.accent, color: t.white, fontWeight: 600 },
  aside: { flex: '1 1 300px', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16 },
  darkCard: { background: t.dark, color: t.white, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 14 },
  darkEyebrow: { margin: 0, fontFamily: t.fontMono, fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.bright },
  dates: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  smallLabel: { fontSize: 13, fontWeight: 600 },
  groupLabel: { fontSize: 13, fontWeight: 600 },
  dateInput: { ...control, height: 44, minHeight: 44, padding: '0 10px' },
  dateDark: { ...control, height: 44, minHeight: 44, padding: '0 10px', background: t.darkSoft, borderColor: t.darkBorder, color: t.white, colorScheme: 'dark' },
  fieldset: { border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
  darkCheck: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: t.onDark, cursor: 'pointer' },
  darkCheckbox: { width: 18, height: 18, margin: 0, accentColor: t.bright, flexShrink: 0 },
  checkbox: { width: 18, height: 18, margin: 0, accentColor: t.accent, flexShrink: 0 },
  brightBtn: { ...btn, fontSize: 15, fontWeight: 600, border: 0, background: t.bright, color: t.dark },
  disabled: { opacity: 0.5 },
  error: { margin: 0, fontSize: 14, color: t.danger },
  outlineOn: { borderColor: t.accent, background: t.accentSoft, color: t.accentInk },
  count: { fontFamily: t.fontMono, fontSize: 12, color: t.muted },
  pastMenu: { position: 'absolute', top: 50, zIndex: 20, width: 320, maxWidth: 'calc(100vw - 32px)', maxHeight: 360, overflowY: 'auto', boxSizing: 'border-box', background: t.white, border: `1px solid ${t.border}`, borderRadius: 14, padding: 8, boxShadow: '0 12px 32px rgba(28,27,34,0.14)', display: 'flex', flexDirection: 'column', gap: 6 },
  pastItem: { display: 'flex', alignItems: 'center', gap: 8, borderWidth: 1, borderStyle: 'solid', borderColor: t.border, borderRadius: 12, padding: '4px 4px 4px 14px' },
  pastItemOn: { borderColor: t.accent, background: t.accentSoft },
  pastOpen: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0', border: 0, background: 'transparent', textAlign: 'left', color: t.text },
  pastTitle: { fontSize: 14, fontWeight: 600 },
  pastMeta: { fontSize: 12, color: t.muted },
  iconBtn: { flexShrink: 0, width: 40, height: 40, borderRadius: 8, border: 0, background: 'transparent', color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  startCard: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 'clamp(24px, 4vw, 40px)', display: 'flex', flexWrap: 'wrap', gap: 40 },
  startMain: { flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 22 },
  startIntro: { display: 'flex', flexDirection: 'column', gap: 10 },
  startTitle: { margin: 0, fontFamily: t.fontDisplay, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15 },
  startText: { margin: 0, fontSize: 16, lineHeight: 1.6, color: t.secondary, maxWidth: 460 },
  sourceRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, border: `1px solid ${t.border}`, cursor: 'pointer' },
  sourceName: { flex: '1 1 auto', fontSize: 15, fontWeight: 500 },
  sourceMeta: { fontSize: 13, color: t.accentInk },
  buildRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 },
  buildBtn: { height: 48, padding: '0 22px', borderRadius: 12, border: 0, background: t.accent, color: t.white, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  whatCard: { flex: '1 1 300px', maxWidth: 460, boxSizing: 'border-box', background: t.dark, color: t.white, borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 18 },
  whatList: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 },
  whatItem: { display: 'flex', gap: 14 },
  whatNum: { fontFamily: t.fontMono, fontSize: 12, color: t.bright, paddingTop: 2 },
  whatText: { display: 'flex', flexDirection: 'column', gap: 2 },
  whatBlurb: { fontSize: 13, lineHeight: 1.5, color: t.onDarkMuted },
  whatFoot: { margin: 0, paddingTop: 14, borderTop: `1px solid ${t.darkBorder}`, fontSize: 13, lineHeight: 1.5, color: t.onDarkMuted },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
}
