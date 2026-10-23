import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { t, layout } from '../lib/theme'
import { toIso, formatDayMonth } from '../lib/weeks'
import { canonicalizeNames } from '../lib/colleagues'
import { callClaude } from '../lib/claude'
import { REVIEW_SUMMARY_SYSTEM, reviewSummaryPrompt } from '../lib/prompts'

const TYPES = {
  mine:    { label: 'My feedback', bg: t.accentSoft, fg: t.accentInk, placeholder: 'Feedback you gave in a 1:1, crit or review…' },
  others:  { label: 'From others', bg: '#E5EBF4', fg: '#34507A', placeholder: 'What did they say? Quote it if you can.' },
  win:     { label: 'Win', bg: '#E3EFE7', fg: '#2F5D46', placeholder: 'Something they shipped, solved or did well…' },
  improve: { label: 'To improve', bg: '#F6EBD3', fg: '#7A5414', placeholder: 'A growth area, with a specific example…' },
}
const FILTERS = [
  { key: 'all', label: 'All notes', dot: t.faint },
  { key: 'win', label: 'Wins', dot: TYPES.win.fg },
  { key: 'improve', label: 'To improve', dot: TYPES.improve.fg },
  { key: 'mine', label: 'My feedback', dot: TYPES.mine.fg },
  { key: 'others', label: 'From others', dot: TYPES.others.fg },
]

const nameKey = n => n.trim().replace(/\s+/g, ' ').toLowerCase()
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
const dayMonth = ts => formatDayMonth(toIso(new Date(ts)))
const monthYear = ts => new Date(ts).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

export default function Managing({ userId }) {
  const [reportees, setReportees] = useState([])
  // Notes for every reportee, newest first
  const [notes, setNotes] = useState([])
  const [colleagueNames, setColleagueNames] = useState([])
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [noteType, setNoteType] = useState('mine')
  const [noteText, setNoteText] = useState('')
  const [saidBy, setSaidBy] = useState([])
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState('')
  // Review summaries aren't saved: they stay while the tab is open
  const [drafts, setDrafts] = useState({})
  const [drafting, setDrafting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([
      supabase.from('reportees').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('reportee_notes').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('colleagues').select('name').eq('user_id', userId).order('name'),
    ]).then(([r, n, c]) => {
      if (!live) return
      const failed = r.error || n.error
      if (failed) setLoadError(`Couldn't load your team: ${failed.message}`)
      setReportees(r.data || [])
      setNotes(n.data || [])
      setColleagueNames((c.data || []).map(x => x.name))
    })
    return () => { live = false }
  }, [userId])

  const current = reportees.find(r => r.id === selectedId) || reportees[0] || null
  const first = current?.name.split(/\s+/)[0] || ''
  const currentNotes = current ? notes.filter(n => n.reportee_id === current.id) : []
  const counts = { all: currentNotes.length, mine: 0, others: 0, win: 0, improve: 0 }
  currentNotes.forEach(n => { if (n.type in counts) counts[n.type]++ })
  const shown = currentNotes.filter(n => filter === 'all' || n.type === filter)
  const filterLabel = FILTERS.find(f => f.key === filter).label

  // People you can tag as having said something: your colleagues, anyone you've tagged before, and the rest of your team
  const known = new Set(colleagueNames.map(nameKey))
  const pastNames = canonicalizeNames(notes.flatMap(n => n.said_by || []), colleagueNames).filter(n => !known.has(nameKey(n)))
  const team = reportees.filter(r => r.id !== current?.id)
  const pool = [
    ...colleagueNames.map(name => ({ name, tag: '' })),
    ...pastNames.map(name => ({ name, tag: 'Added by you' })),
    ...team.filter(r => !known.has(nameKey(r.name))).map(r => ({ name: r.name, tag: 'Your team' })),
  ]
  const q = nameKey(query)
  const tagged = new Set(saidBy.map(nameKey))
  const suggestions = q ? pool.filter(p => !tagged.has(nameKey(p.name)) && nameKey(p.name).includes(q)).slice(0, 5) : []
  const exact = q && (pool.some(p => nameKey(p.name) === q) || tagged.has(q))

  function pick(id) {
    setSelectedId(id)
    setFilter('all')
    setNoteText('')
    setSaidBy([])
    setQuery('')
    setCopied(false)
    setError('')
  }

  function addTag(name) {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (clean) setSaidBy(prev => canonicalizeNames([...prev, clean], [...colleagueNames, ...pastNames, ...team.map(r => r.name)]))
    setQuery('')
  }

  function onTagKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length) addTag(suggestions[0].name)
      else if (q) addTag(query)
    } else if (e.key === 'Backspace' && !query && saidBy.length) {
      setSaidBy(saidBy.slice(0, -1))
    } else if (e.key === 'Escape') {
      setQuery('')
    }
  }

  async function addReportee(e) {
    e.preventDefault()
    const name = newName.trim().replace(/\s+/g, ' ')
    if (!name) return
    setError('')
    const { data, error: saveError } = await supabase.from('reportees').insert({ user_id: userId, name, role: newRole.trim() || null }).select().single()
    if (saveError) { setError(`Couldn't add ${name}: ${saveError.message}`); return }
    setReportees(prev => [...prev, data])
    setAdding(false)
    setNewName('')
    setNewRole('')
    pick(data.id)
  }

  async function removeReportee() {
    if (!confirm(`Remove ${current.name} and all your notes about them?`)) return
    const { error: delError } = await supabase.from('reportees').delete().eq('id', current.id)
    if (delError) { setError(`Couldn't remove ${current.name}: ${delError.message}`); return }
    setReportees(prev => prev.filter(r => r.id !== current.id))
    setNotes(prev => prev.filter(n => n.reportee_id !== current.id))
    pick(null)
  }

  async function saveNote() {
    const content = noteText.trim()
    if (!content || saving) return
    // A name typed but not yet picked still counts
    const people = noteType === 'others' ? canonicalizeNames(q ? [...saidBy, query] : saidBy) : []
    setSaving(true)
    setError('')
    const { data, error: saveError } = await supabase.from('reportee_notes')
      .insert({ user_id: userId, reportee_id: current.id, type: noteType, content, said_by: people }).select().single()
    setSaving(false)
    if (saveError) { setError(`Couldn't save the note: ${saveError.message}`); return }
    setNotes(prev => [data, ...prev])
    setNoteText('')
    setSaidBy([])
    setQuery('')
    setFilter('all')
  }

  async function deleteNote(id) {
    if (!confirm('Delete this note?')) return
    const { error: delError } = await supabase.from('reportee_notes').delete().eq('id', id)
    if (delError) { setError(`Couldn't delete the note: ${delError.message}`); return }
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  async function draftSummary() {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return }
    if (!currentNotes.length) { setError(`Add some notes about ${first} first.`); return }
    const person = current
    setError('')
    setDrafting(true)
    try {
      const labelled = [...currentNotes].reverse().map(n => ({ ...n, label: TYPES[n.type]?.label || n.type }))
      const draft = await callClaude(apiKey, REVIEW_SUMMARY_SYSTEM, reviewSummaryPrompt(person.name, labelled))
      setDrafts(prev => ({ ...prev, [person.id]: draft }))
      setCopied(false)
    } catch (err) {
      setError(`Couldn't draft the summary: ${err.message}`)
    } finally {
      setDrafting(false)
    }
  }

  function copyDraft() {
    navigator.clipboard.writeText(drafts[current.id])
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const addForm = (
    <form onSubmit={addReportee} style={s.addForm}>
      <span style={s.addTitle}>New reportee</span>
      <label htmlFor="reportee-name" style={s.srOnly}>Name</label>
      <input id="reportee-name" type="text" autoFocus placeholder="Full name" value={newName} onChange={e => setNewName(e.target.value)} style={s.input} />
      <label htmlFor="reportee-role" style={s.srOnly}>Role</label>
      <input id="reportee-role" type="text" placeholder="Role, e.g. Product Designer" value={newRole} onChange={e => setNewRole(e.target.value)} style={s.input} />
      <div style={s.addActions}>
        <button type="button" onClick={() => setAdding(false)} style={s.cancelBtn}>Cancel</button>
        <button type="submit" disabled={!newName.trim()} style={{ ...s.darkBtn, ...(newName.trim() ? {} : s.disabled) }}>Add</button>
      </div>
    </form>
  )

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <header style={s.pageHeader}>
          <div style={s.header}>
            <span style={s.eyebrow}>Your team · {reportees.length} {reportees.length === 1 ? 'reportee' : 'reportees'}</span>
            <h1 style={s.h1}>Managing</h1>
          </div>
          <button type="button" onClick={() => setAdding(v => !v)} aria-expanded={adding} style={s.primaryBtn}>
            <Icon size={16} strokeWidth={2} d="M12 5v14M5 12h14" />Add reportee
          </button>
        </header>

        {loadError && <p role="alert" style={s.error}>{loadError}</p>}

        {!current ? (
          <div style={s.emptyTeam}>
            {adding ? addForm : (
              <>
                <span style={s.emptyTitle}>No one on your team yet</span>
                <span style={s.emptyText}>Add the people who report to you, then capture wins, feedback you've given and things others mention as they happen — review time gets much easier.</span>
              </>
            )}
          </div>
        ) : (
          <div style={s.columns}>
            <aside aria-label="Reportees" style={s.aside}>
              {adding && addForm}
              {reportees.map(r => {
                const on = r.id === current.id
                const theirs = notes.filter(n => n.reportee_id === r.id)
                return (
                  <button key={r.id} type="button" className="person-row" aria-pressed={on} onClick={() => pick(r.id)}
                    style={{ ...s.personRow, ...(on ? s.personRowOn : {}) }}>
                    <span aria-hidden="true" style={{ ...s.avatar, ...(on ? s.avatarOn : {}) }}>{initials(r.name)}</span>
                    <span style={s.personText}>
                      <span style={s.personName}>{r.name}</span>
                      {r.role && <span style={s.personMeta}>{r.role}</span>}
                      <span style={s.personMeta}>{theirs.length} {theirs.length === 1 ? 'note' : 'notes'}{theirs.length ? ` · last ${dayMonth(theirs[0].created_at)}` : ''}</span>
                    </span>
                  </button>
                )
              })}
            </aside>

            <section aria-labelledby="person-h" style={s.main}>
              <div style={s.personCard}>
                <div style={s.personHead}>
                  <span aria-hidden="true" style={s.bigAvatar}>{initials(current.name)}</span>
                  <div style={s.personHeadText}>
                    <h2 id="person-h" style={s.h2}>{current.name}</h2>
                    <span style={s.muted}>{current.role ? `${current.role} · ` : ''}Added {monthYear(current.created_at)}</span>
                  </div>
                </div>
                <div style={s.personActions}>
                  <button type="button" onClick={draftSummary} disabled={drafting} style={{ ...s.darkBtn, ...s.tallBtn, ...(drafting ? s.disabled : {}) }}>
                    <Icon size={16} stroke={t.bright} d="M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" />
                    {drafting ? 'Drafting…' : drafts[current.id] ? 'Redraft review summary' : 'Draft review summary'}
                  </button>
                  <button type="button" className="icon-btn" onClick={removeReportee} aria-label={`Remove ${current.name}`} title="Remove" style={s.iconBtn}>
                    <Icon size={16} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </button>
                </div>
              </div>

              {error && <p role="alert" style={s.error}>{error}</p>}

              {drafts[current.id] && (
                <div style={s.draftCard}>
                  <div style={s.draftHead}>
                    <span style={s.draftEyebrow}>Review summary · not saved</span>
                    <button type="button" onClick={copyDraft} style={s.brightBtn}>{copied ? 'Copied!' : 'Copy'}</button>
                  </div>
                  <p style={s.draftText}>{drafts[current.id]}</p>
                </div>
              )}

              <div role="tablist" aria-label="Filter notes" style={s.filters}>
                {FILTERS.map(f => {
                  const on = f.key === filter
                  return (
                    <button key={f.key} type="button" role="tab" aria-selected={on} className="tile-btn" onClick={() => setFilter(f.key)}
                      style={{ ...s.filter, ...(on ? s.filterOn : {}) }}>
                      <span style={{ ...s.filterLabel, ...(on ? { color: t.onDarkMuted } : {}) }}>
                        <span aria-hidden="true" style={{ ...s.dot, background: f.dot }} />{f.label}
                      </span>
                      <span style={s.filterCount}>{counts[f.key]}</span>
                    </button>
                  )
                })}
              </div>

              <div style={s.composer}>
                <div style={s.composerHead}>
                  <h3 style={s.h3}>Add to {first}'s log</h3>
                  <div role="radiogroup" aria-label="Note type" style={s.types}>
                    {Object.entries(TYPES).map(([key, type]) => {
                      const on = key === noteType
                      return (
                        <button key={key} type="button" role="radio" aria-checked={on} onClick={() => setNoteType(key)}
                          style={{ ...s.typeBtn, ...(on ? { border: `1.5px solid ${type.fg}`, background: type.bg, color: type.fg } : {}) }}>
                          {type.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {noteType === 'others' && (
                  <div style={s.field}>
                    <div style={s.fieldHead}>
                      <label htmlFor="said-by" style={s.smallLabel}>Who said it?</label>
                      <span style={s.hint}>Tag one or more people</span>
                    </div>
                    <div style={s.relative}>
                      <div className="tag-box" style={{ ...s.tagBox, ...(q ? { border: `1.5px solid ${TYPES.others.fg}` } : {}) }}>
                        {saidBy.map(name => (
                          <span key={name} style={s.tag}>
                            <span aria-hidden="true" style={s.tagAvatar}>{initials(name)}</span>
                            <span>{name}</span>
                            <button type="button" aria-label={`Remove ${name}`} onClick={() => setSaidBy(saidBy.filter(n => n !== name))} style={s.tagRemove}>
                              <Icon size={12} strokeWidth={2.4} d="M6 6l12 12M18 6L6 18" />
                            </button>
                          </span>
                        ))}
                        <input id="said-by" className="tag-input" type="text" autoComplete="off" role="combobox" aria-expanded={!!q} aria-controls="said-by-suggestions"
                          placeholder={saidBy.length ? 'Add another person…' : 'Type a name, e.g. Ravi'}
                          value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onTagKey} style={s.tagInput} />
                      </div>
                      {q && (
                        <div id="said-by-suggestions" role="listbox" aria-label="People" style={s.suggestions}>
                          {suggestions.map((p, i) => (
                            <button key={p.name} type="button" role="option" aria-selected={i === 0} onClick={() => addTag(p.name)}
                              style={{ ...s.suggestion, ...(i === 0 ? { background: t.field } : {}) }}>
                              <span aria-hidden="true" style={s.suggestionAvatar}>{initials(p.name)}</span>
                              <span style={s.suggestionName}>{p.name}</span>
                              {p.tag && <span style={s.suggestionTag}>{p.tag}</span>}
                            </button>
                          ))}
                          {!exact && (
                            <button type="button" onClick={() => addTag(query)} style={{ ...s.customBtn, ...(suggestions.length ? { borderTop: `1px solid ${t.borderSoft}` } : {}) }}>
                              <span aria-hidden="true" style={s.customPlus}>+</span>
                              Tag “{query.trim()}” as someone new
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <label htmlFor="note" style={s.srOnly}>Note</label>
                <textarea id="note" rows={3} placeholder={TYPES[noteType].placeholder} value={noteText} onChange={e => setNoteText(e.target.value)} style={s.textarea} />
                <div style={s.composerActions}>
                  <button type="button" onClick={saveNote} disabled={!noteText.trim() || saving} style={{ ...s.primaryBtn, padding: '0 20px', ...(!noteText.trim() || saving ? s.disabled : {}) }}>
                    {saving ? 'Saving…' : 'Save to log'}
                  </button>
                </div>
              </div>

              <div style={s.list}>
                <h3 style={s.listTitle}>{filter === 'all' ? 'Log' : filterLabel} · newest first</h3>
                {shown.length ? shown.map(n => {
                  const type = TYPES[n.type] || TYPES.mine
                  return (
                    <article key={n.id} className="entry-card" style={s.note}>
                      <div style={s.noteHead}>
                        <div style={s.noteMeta}>
                          <span style={{ ...s.pill, background: type.bg, color: type.fg }}>{type.label}</span>
                          <span style={s.muted13}>{dayMonth(n.created_at)}</span>
                          {n.said_by?.length > 0 && (
                            <>
                              <span style={s.muted13}>· from</span>
                              {n.said_by.map(name => (
                                <span key={name} style={s.fromChip}>
                                  <span aria-hidden="true" style={s.fromAvatar}>{initials(name)}</span>{name}
                                </span>
                              ))}
                            </>
                          )}
                        </div>
                        <button type="button" className="icon-btn" onClick={() => deleteNote(n.id)} aria-label="Delete note" title="Delete" style={s.smallIconBtn}>
                          <Icon size={14} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                        </button>
                      </div>
                      <p style={s.noteText}>{n.content}</p>
                    </article>
                  )
                }) : (
                  <div style={s.empty}>
                    <span style={s.emptyTitle}>{currentNotes.length ? `Nothing under “${filterLabel}” yet` : `No notes for ${first} yet`}</span>
                    <span style={s.emptyText}>Capture wins, feedback you've given and things others mention as they happen — review time gets much easier.</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function Icon({ d, size = 18, strokeWidth = 1.8, stroke = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const btn = { height: 44, padding: '0 18px', borderRadius: 10, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }
const control = { boxSizing: 'border-box', border: `1px solid ${t.border}`, borderRadius: 10, background: t.field, fontSize: 14, color: t.text }
const empty = { padding: 28, borderRadius: 16, border: `1.5px dashed ${t.borderDash}`, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }

const s = {
  ...layout,
  inner: { ...layout.inner, gap: 24 },
  pageHeader: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  primaryBtn: { ...btn, fontSize: 15, border: 0, background: t.accent, color: t.white },
  darkBtn: { ...btn, height: 40, padding: '0 14px', border: 0, background: t.dark, color: t.white },
  tallBtn: { height: 44, padding: '0 16px' },
  cancelBtn: { ...btn, height: 40, padding: '0 12px', fontWeight: 400, border: `1px solid ${t.border}`, background: t.white, color: t.secondary },
  brightBtn: { ...btn, height: 36, padding: '0 14px', border: 0, background: t.bright, color: t.dark },
  iconBtn: { width: 44, height: 44, borderRadius: 10, border: `1px solid ${t.border}`, background: t.white, color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  smallIconBtn: { width: 32, height: 32, borderRadius: 8, border: 0, background: 'transparent', color: t.faint, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  disabled: { opacity: 0.5 },
  error: { margin: 0, fontSize: 14, color: t.danger },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' },
  columns: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 },

  aside: { flex: '1 1 280px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 },
  addForm: { background: t.white, border: `2px solid ${t.accent}`, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, alignSelf: 'stretch' },
  addTitle: { fontSize: 14, fontWeight: 600 },
  input: { ...control, height: 42, padding: '0 12px' },
  addActions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  personRow: { textAlign: 'left', padding: 14, borderRadius: 16, border: `1px solid ${t.border}`, background: t.white, color: t.text, display: 'flex', alignItems: 'center', gap: 12 },
  personRowOn: { border: `2px solid ${t.accent}`, padding: 13, background: t.accentSoft },
  avatar: { flex: '0 0 auto', width: 40, height: 40, borderRadius: '50%', background: t.avatar, color: t.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 },
  avatarOn: { background: t.accent, color: t.white },
  personText: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  personName: { fontSize: 15, fontWeight: 600 },
  personMeta: { fontSize: 13, color: t.muted },

  main: { flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 },
  personCard: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: '22px 24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  personHead: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 },
  bigAvatar: { flex: '0 0 auto', width: 56, height: 56, borderRadius: '50%', background: t.accent, color: t.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 600 },
  personHeadText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  h2: { margin: 0, fontFamily: t.fontDisplay, fontSize: 26, fontWeight: 600, lineHeight: 1.15 },
  muted: { fontSize: 14, color: t.muted },
  personActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },

  draftCard: { background: t.dark, color: t.white, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 },
  draftHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  draftEyebrow: { fontFamily: t.fontMono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.bright },
  draftText: { margin: 0, fontSize: 15, lineHeight: 1.6, color: t.onDark, whiteSpace: 'pre-wrap' },

  filters: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: 10, overflowX: 'auto', paddingBottom: 2 },
  filter: { textAlign: 'left', padding: 14, borderRadius: 14, border: `1px solid ${t.border}`, background: t.white, color: t.text, display: 'flex', flexDirection: 'column', gap: 6 },
  filterOn: { border: `1px solid ${t.dark}`, background: t.dark, color: t.white },
  filterLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: t.muted },
  dot: { width: 8, height: 8, borderRadius: '50%' },
  filterCount: { fontFamily: t.fontDisplay, fontSize: 26, fontWeight: 600, lineHeight: 1 },

  composer: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 },
  composerHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  h3: { margin: 0, fontSize: 16, fontWeight: 600 },
  types: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  typeBtn: { height: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${t.border}`, background: t.white, color: t.secondary, fontSize: 13, fontWeight: 600 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  smallLabel: { fontSize: 13, fontWeight: 600 },
  hint: { fontSize: 12, color: t.muted },
  relative: { position: 'relative' },
  tagBox: { ...control, minHeight: 46, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 8px' },
  tag: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 4px', borderRadius: 999, background: TYPES.others.bg, color: TYPES.others.fg, fontSize: 13, fontWeight: 600 },
  tagAvatar: { width: 24, height: 24, borderRadius: 999, background: TYPES.others.fg, color: t.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 },
  tagRemove: { width: 24, height: 24, border: 0, borderRadius: 999, background: 'transparent', color: TYPES.others.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  tagInput: { flex: '1 1 160px', minWidth: 140, height: 32, border: 0, background: 'transparent', padding: '0 6px', fontSize: 14, color: t.text },
  suggestions: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6, zIndex: 5, background: t.white, border: `1px solid ${t.border}`, borderRadius: 12, boxShadow: '0 12px 28px rgba(28, 27, 34, 0.12)', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 },
  suggestion: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, padding: '5px 10px', border: 0, borderRadius: 8, background: 'transparent', textAlign: 'left', color: t.text },
  suggestionAvatar: { flex: 'none', width: 30, height: 30, borderRadius: 999, background: t.avatar, color: t.dark, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 },
  suggestionName: { flex: 1, fontSize: 14, fontWeight: 600 },
  suggestionTag: { fontSize: 11, fontWeight: 600, color: t.muted },
  customBtn: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '6px 10px', border: 0, borderRadius: '0 0 8px 8px', background: 'transparent', textAlign: 'left', fontSize: 14, color: t.accentInk, fontWeight: 600 },
  customPlus: { flex: 'none', width: 30, height: 30, borderRadius: 999, border: `1.5px dashed ${t.borderDash}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 },
  textarea: { ...control, width: '100%', resize: 'vertical', borderRadius: 12, padding: '12px 14px', fontSize: 15, lineHeight: 1.55 },
  composerActions: { display: 'flex', justifyContent: 'flex-end' },

  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  listTitle: { margin: 0, fontFamily: t.fontMono, fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.muted },
  note: { margin: 0, background: t.white, border: `1px solid ${t.border}`, borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  noteHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  noteMeta: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pill: { display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 },
  muted13: { fontSize: 13, color: t.muted },
  fromChip: { display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px 0 3px', borderRadius: 999, border: `1px solid ${t.border}`, fontSize: 12, fontWeight: 600, color: t.body },
  fromAvatar: { width: 20, height: 20, borderRadius: 999, background: TYPES.others.fg, color: t.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 },
  noteText: { margin: 0, fontSize: 15, lineHeight: 1.6, color: t.body, whiteSpace: 'pre-wrap' },
  empty,
  emptyTeam: { ...empty, maxWidth: 560 },
  emptyTitle: { fontSize: 15, fontWeight: 600 },
  emptyText: { fontSize: 14, lineHeight: 1.5, color: t.muted },
}
