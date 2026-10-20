import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { mentionsOf as entriesMentioning, generatePeerDraft, rewritePeerDraft, getSessionDrafts, formatStamp } from '../lib/peerFeedback'
import { t, layout } from '../lib/theme'
import { reviewCycle, formatCycle } from '../lib/cycles'
import { formatDayMonth } from '../lib/weeks'
import PersonPanel from './PersonPanel'

export default function PeerFeedback({ userId }) {
  const [periodStart, setPeriodStart] = useState(() => reviewCycle().start)
  const [periodEnd, setPeriodEnd] = useState(() => reviewCycle().end)
  const [colleagues, setColleagues] = useState([])
  // Log entries in the period, newest first: the list's "logged with you" column and the panel's timeline
  const [periodEntries, setPeriodEntries] = useState([])
  // Drafts made earlier in this tab, here or from the Weekly Log panel
  const [feedbacks, setFeedbacks] = useState(() => Object.fromEntries(Object.entries(getSessionDrafts(userId)).map(([id, draft]) => [id, { draft }])))
  const [error, setError] = useState('')
  const [draftProgress, setDraftProgress] = useState(null)
  const [ranked, setRanked] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedId, setSelectedId] = useState(null)
  // True while the panel slides out; it is deselected when that animation ends
  const [closing, setClosing] = useState(false)
  // Saved notes for every colleague, newest first
  const [notes, setNotes] = useState([])
  const [noteError, setNoteError] = useState('')
  const panelRef = useRef(null)

  useEffect(() => {
    let live = true
    supabase.from('colleagues').select('*').eq('user_id', userId).order('name')
      .then(({ data }) => { if (live) setColleagues(data || []) })
    supabase.from('colleague_notes').select('*').eq('user_id', userId).order('created_at', { ascending: false })
      .then(({ data, error: notesError }) => {
        if (!live) return
        if (notesError) setNoteError(`Couldn't load notes: ${notesError.message}`)
        else setNotes(data || [])
      })
    return () => { live = false }
  }, [userId])

  useEffect(() => {
    let live = true
    supabase.from('entries').select('*').eq('user_id', userId).gte('week_of', periodStart).lte('week_of', periodEnd)
      .then(({ data }) => { if (live) setPeriodEntries([...(data || [])].sort((a, b) => b.week_of.localeCompare(a.week_of))) })
    return () => { live = false }
  }, [userId, periodStart, periodEnd])

  // On narrow screens the panel sits below the list, so bring it into view
  useEffect(() => {
    if (selectedId && window.innerWidth < 900) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId])

  async function draftAll() {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return }
    if (colleagues.some(c => feedbacks[c.id]?.draft) && !confirm('Replace the existing drafts with new ones?')) return
    setError('')
    setDraftProgress({ done: 0, total: colleagues.length })
    try {
      const { data: entries, error: entriesError } = await supabase.from('entries').select('*').eq('user_id', userId).gte('week_of', periodStart).lte('week_of', periodEnd)
      if (entriesError) throw entriesError
      const queue = [...colleagues]
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          await generateFeedback(c, apiKey, entries || [])
          setDraftProgress(p => ({ ...p, done: p.done + 1 }))
        }
      }
      // A few at a time keeps the API calls from tripping rate limits
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker))
    } catch (err) {
      setError(err.message)
    } finally {
      setDraftProgress(null)
    }
  }

  async function draftOne(colleague) {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return }
    setError('')
    const { data: entries, error: entriesError } = await supabase.from('entries').select('*').eq('user_id', userId).gte('week_of', periodStart).lte('week_of', periodEnd)
    if (entriesError) { setError(entriesError.message); return }
    await generateFeedback(colleague, apiKey, entries || [])
  }

  async function generateFeedback(colleague, apiKey, entries) {
    const update = patch => setFeedbacks(f => ({ ...f, [colleague.id]: { ...f[colleague.id], ...patch } }))
    update({ generating: true, error: '', needsInfo: false })
    try {
      const result = await generatePeerDraft({ apiKey, userId, colleague, entries, notes: notesFor(colleague), period: { start: periodStart, end: periodEnd } })
      update({ generating: false, draft: result.draft || '', needsInfo: !!result.needsInfo, error: result.error || '' })
    } catch (err) {
      update({ generating: false, error: `Couldn't draft feedback: ${err.message}` })
    }
  }

  async function rewriteFeedback(colleague, how) {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return false }
    setError('')
    const update = patch => setFeedbacks(f => ({ ...f, [colleague.id]: { ...f[colleague.id], ...patch } }))
    update({ generating: true, error: '' })
    try {
      const draft = await rewritePeerDraft({ apiKey, userId, colleague, entries: periodEntries, notes: notesFor(colleague), current: feedbacks[colleague.id]?.draft, how })
      update({ draft, generating: false })
      return true
    } catch (err) {
      update({ generating: false, error: `Couldn't rewrite feedback: ${err.message}` })
      return false
    }
  }

  const notesFor = colleague => notes.filter(n => n.colleague_id === colleague.id)
  const mentionsOf = colleague => entriesMentioning(periodEntries, colleague)
  const counts = Object.fromEntries(colleagues.map(c => [c.id, mentionsOf(c).length]))

  // Always exported in rank order
  function downloadFeedbackCsv() {
    const rows = [
      ['Rank', 'Entries', 'Colleague', 'Additional notes', 'Feedback'],
      ...sortByInteraction(colleagues, counts).map((c, i) => [
        i + 1, counts[c.id], c.name, notesFor(c).map(n => `${formatStamp(n.created_at)}: ${n.content}`).join('\n'), feedbacks[c.id]?.draft || '',
      ]),
    ]
    downloadCsv(rows, `peer-feedback-${periodStart}-to-${periodEnd}.csv`)
  }

  const tableColleagues = ranked ? sortByInteraction(colleagues, counts) : colleagues
  const shownColleagues = tableColleagues.slice(0, visibleCount)
  const draftedCount = colleagues.filter(c => feedbacks[c.id]?.draft).length
  // Tried, but there was nothing to write from: these can't move the bar until entries or notes are added
  const needsInfoCount = colleagues.filter(c => !feedbacks[c.id]?.draft && feedbacks[c.id]?.needsInfo).length
  const canExport = draftedCount > 0
  const selected = colleagues.find(c => c.id === selectedId) || null

  function selectColleague(id) {
    setClosing(false)
    setSelectedId(id)
  }

  function closePanel() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setSelectedId(null)
    else setClosing(true)
  }

  return (
    <div style={s.shell}>
      <div style={s.page}>
        <div style={s.inner}>
          <header style={s.topHeader}>
            <div style={s.header}>
              <span style={s.eyebrow}>Review period · {formatCycle({ start: periodStart, end: periodEnd })}</span>
              <h1 style={s.h1}>Peer feedback</h1>
            </div>
            {colleagues.length > 0 && (
              <div style={s.headerActions}>
                <button type="button" onClick={() => setRanked(r => !r)} aria-pressed={ranked} title="Order by number of log entries that mention each colleague"
                  style={{ ...s.outlineBtn, ...(ranked ? s.outlineOn : {}) }}>
                  <Icon size={16} d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />Rank
                </button>
                <button type="button" onClick={downloadFeedbackCsv} disabled={!canExport} title="Download a CSV of every colleague's notes and feedback"
                  style={{ ...s.outlineBtn, ...(canExport ? {} : s.outlineDisabled) }}>
                  <Icon size={16}><path d="M12 4v11M7 10l5 5 5-5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></Icon>
                  Export drafts
                </button>
                <button type="button" onClick={draftAll} disabled={!!draftProgress} style={{ ...s.primaryBtn, ...(draftProgress ? s.disabled : {}) }}>
                  {draftProgress ? `Drafting… ${draftProgress.done}/${draftProgress.total}` : `Draft for all ${colleagues.length}`}
                </button>
              </div>
            )}
          </header>

          <div style={s.bar}>
            <div style={s.periodGroup}>
              <Icon size={16}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></Icon>
              <label style={s.srOnly} htmlFor="pf-start">Period start</label>
              <input id="pf-start" type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={s.dateInput} />
              <span aria-hidden="true">–</span>
              <label style={s.srOnly} htmlFor="pf-end">Period end</label>
              <input id="pf-end" type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={s.dateInput} />
            </div>
            {colleagues.length > 0 && (
              <div style={s.progressGroup}>
                <span style={s.progressText}>
                  <b style={s.progressNum}>{draftedCount}</b> of {colleagues.length} drafted
                  {needsInfoCount > 0 && <span style={s.needsInfoText}> · {needsInfoCount} {needsInfoCount === 1 ? 'needs' : 'need'} more info</span>}
                </span>
                <div role="progressbar" aria-label="Drafts completed" aria-valuenow={draftedCount} aria-valuemin={0} aria-valuemax={colleagues.length} style={s.track}>
                  <div style={{ ...s.fill, width: `${(draftedCount / colleagues.length) * 100}%` }} />
                  {needsInfoCount > 0 && <div style={{ ...s.fill, ...s.fillNeedsInfo, width: `${(needsInfoCount / colleagues.length) * 100}%` }} />}
                </div>
              </div>
            )}
          </div>

          {error && <p role="alert" style={s.error}>{error}</p>}

          {colleagues.length === 0 && <p style={s.empty}>No colleagues yet. Tag people in your weekly log entries and they'll appear here.</p>}

          {colleagues.length > 0 && (
            <div style={s.listWrap}>
              <div className="peer-list" style={s.list}>
                <div className="peer-row" style={{ ...s.row, ...s.listHead }} aria-hidden="true">
                  <span>Colleague</span><span className="peer-weeks">Logged with you</span><span>Feedback</span><span />
                </div>
                {shownColleagues.map((colleague, i) => {
                  const fb = feedbacks[colleague.id] || {}
                  const on = colleague.id === selectedId
                  const weeks = mentionsOf(colleague).map(e => formatDayMonth(e.week_of))
                  return (
                    <button key={colleague.id} type="button" className="list-row peer-row" onClick={() => on && !closing ? closePanel() : selectColleague(colleague.id)}
                      aria-expanded={on} aria-controls="person-panel"
                      style={{ ...s.row, ...s.rowBtn, ...(on ? s.rowOn : {}) }}>
                      <span style={s.person}>
                        <span aria-hidden="true" style={{ ...s.avatar, ...(on ? s.avatarOn : {}) }}>{initials(colleague.name)}</span>
                        <span style={s.personText}>
                          <span style={s.personName}>{colleague.name}</span>
                          {ranked && <span style={s.personMeta}>#{i + 1}</span>}
                        </span>
                      </span>
                      <span className="peer-weeks" style={s.weeks}>{weeks.length ? `${weeks.length} · ${weeks.slice(0, 3).join(', ')}${weeks.length > 3 ? '…' : ''}` : '—'}</span>
                      <Status drafted={!!fb.draft} generating={fb.generating} needsInfo={fb.needsInfo} />
                      <span style={{ display: 'flex', color: t.muted }}><Icon d="M9 6l6 6-6 6" /></span>
                    </button>
                  )
                })}
                {tableColleagues.length > shownColleagues.length && (
                  <div style={s.moreRow}>
                    <button type="button" onClick={() => setVisibleCount(n => n + PAGE_SIZE)} style={s.moreBtn}>
                      Show {Math.min(PAGE_SIZE, tableColleagues.length - shownColleagues.length)} more {tableColleagues.length - shownColleagues.length === 1 ? 'colleague' : 'colleagues'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {selected && (
        // Unkeyed, so switching colleagues swaps the content without replaying the slide
        <div ref={panelRef} className={`side-panel${closing ? ' closing' : ''}`} style={s.panelSlot}
          onAnimationEnd={e => { if (closing && e.target === e.currentTarget) { setSelectedId(null); setClosing(false) } }}>
          <PersonPanel key={selected.id} userId={userId} colleague={selected} colleagueNames={colleagues.map(c => c.name)}
            mentions={mentionsOf(selected)} notes={notesFor(selected)} notesError={noteError}
            feedback={feedbacks[selected.id]} busy={!!feedbacks[selected.id]?.generating || !!draftProgress}
            onDraft={() => draftOne(selected)} onRewrite={how => rewriteFeedback(selected, how)}
            onNoteAdded={n => setNotes(list => [n, ...list])} onNoteDeleted={id => setNotes(list => list.filter(n => n.id !== id))}
            onClose={closePanel} style={s.panelFill} />
        </div>
      )}
    </div>
  )
}

function Status({ drafted, generating, needsInfo }) {
  if (generating) return <span style={s.status}><span aria-hidden="true" style={{ ...s.dot, borderColor: t.accent }} />Drafting…</span>
  if (drafted) return <span style={{ ...s.status, color: t.accentInk, fontWeight: 600 }}><span aria-hidden="true" style={{ ...s.dot, background: t.accent, borderColor: t.accent }} />Drafted</span>
  if (needsInfo) return <span style={{ ...s.status, color: t.warnInk }}><span aria-hidden="true" style={{ ...s.dot, background: t.warning, borderColor: t.warning }} />Needs more info</span>
  return <span style={s.status}><span aria-hidden="true" style={s.dot} />Not drafted</span>
}

function Icon({ d, size = 18, strokeWidth = 1.8, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  )
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

const PAGE_SIZE = 12

const outline = { height: 44, padding: '0 14px', borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: t.border, background: t.white, color: t.text, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }
const GRID = 'minmax(200px, 1.4fr) minmax(130px, 1fr) minmax(130px, 1fr) 24px'

const s = {
  ...layout,
  // overflowX clip keeps the sliding panel from adding a horizontal scrollbar
  shell: { display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', minHeight: '100vh', overflowX: 'clip' },
  panelSlot: { flex: '1 1 570px', maxWidth: '100%', display: 'flex' },
  panelFill: { flex: '1 1 auto' },
  page: { ...layout.page, flex: '999 1 560px', minWidth: 0, padding: '36px clamp(16px, 3vw, 44px) 72px' },
  inner: { ...layout.inner, gap: 24 },
  topHeader: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  headerActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  outlineBtn: outline,
  outlineOn: { borderColor: t.accent, background: t.accentSoft, color: t.accentInk },
  outlineDisabled: { color: t.faint, cursor: 'not-allowed' },
  primaryBtn: { ...outline, padding: '0 18px', borderWidth: 0, background: t.accent, color: t.white, fontSize: 15, fontWeight: 600 },
  disabled: { opacity: 0.5 },
  bar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px' },
  periodGroup: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: t.secondary },
  dateInput: { boxSizing: 'border-box', width: 'auto', height: 40, minHeight: 40, padding: '0 10px', border: `1px solid ${t.border}`, borderRadius: 10, background: t.white, fontFamily: 'inherit', fontSize: 14, color: t.text },
  progressGroup: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  progressText: { fontSize: 14, color: t.muted },
  progressNum: { color: t.text, fontWeight: 600 },
  track: { width: 180, height: 6, borderRadius: 999, background: t.border, overflow: 'hidden', display: 'flex', gap: 2 },
  fill: { height: '100%', borderRadius: 999, background: t.accent, transition: 'width 0.3s' },
  fillNeedsInfo: { background: t.warning },
  needsInfoText: { color: t.warnInk },
  error: { margin: 0, fontSize: 14, color: t.danger },
  empty: { margin: 0, fontSize: 15, color: t.muted },
  listWrap: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, overflowX: 'auto' },
  list: { minWidth: 600 },
  row: { display: 'grid', gridTemplateColumns: GRID, gap: 16, alignItems: 'center', padding: '12px 20px' },
  listHead: { borderBottom: `1px solid ${t.border}`, fontFamily: t.fontMono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.muted },
  rowBtn: { width: '100%', border: 0, borderBottom: `1px solid ${t.borderSoft}`, background: t.white, textAlign: 'left', color: t.text, fontSize: 14 },
  rowOn: { background: t.accentSoft, boxShadow: `inset 3px 0 0 ${t.accent}` },
  person: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  avatar: { flex: '0 0 auto', width: 34, height: 34, borderRadius: '50%', background: t.avatar, color: t.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 },
  avatarOn: { background: t.accent, color: t.white },
  personText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  personName: { fontSize: 15, fontWeight: 600 },
  personMeta: { fontSize: 13, color: t.muted },
  weeks: { color: t.muted },
  status: { fontSize: 14, color: t.muted, display: 'inline-flex', alignItems: 'center', gap: 8 },
  dot: { flex: '0 0 auto', width: 8, height: 8, borderRadius: '50%', borderWidth: 1.5, borderStyle: 'solid', borderColor: t.faint, boxSizing: 'border-box' },
  moreRow: { display: 'flex', justifyContent: 'center', padding: 10 },
  moreBtn: { height: 44, padding: '0 16px', borderRadius: 10, border: 0, background: 'transparent', color: t.accent, fontSize: 14, fontWeight: 600 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
}

function sortByInteraction(colleagues, counts) {
  return [...colleagues].sort((a, b) => (counts[b.id] - counts[a.id]) || a.name.localeCompare(b.name))
}

// Quote every field so commas, quotes and line breaks in feedback survive
function downloadCsv(rows, filename) {
  const esc = v => `"${String(v).replace(/"/g, '""')}"`
  const csv = rows.map(row => row.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
