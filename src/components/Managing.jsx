import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { t, layout } from '../lib/theme'
import { toIso, parseIso, formatDayMonth } from '../lib/weeks'
import { canonicalizeNames } from '../lib/colleagues'
import { callClaude } from '../lib/claude'
import { currentCycle, reviewCycle, formatCycle } from '../lib/cycles'
import { formatStamp } from '../lib/peerFeedback'
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
const noteDay = n => toIso(new Date(n.created_at))
const monthYear = date => date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })

export default function Managing({ userId }) {
  const [reportees, setReportees] = useState([])
  // Notes for every reportee, newest first
  const [notes, setNotes] = useState([])
  const [colleagueNames, setColleagueNames] = useState([])
  const [loadError, setLoadError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [noteType, setNoteType] = useState('mine')
  const [noteText, setNoteText] = useState('')
  const [saidBy, setSaidBy] = useState([])
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  // The note being edited: { id, type, content, saidBy, query }
  const [editing, setEditing] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)
  // The reportee form: { name, role, joined } to add someone, plus their id when editing them
  const [form, setForm] = useState(null)
  const adding = !!form && !form.id
  // Saved review summaries for every reportee, one per review period
  const [summaries, setSummaries] = useState([])
  // The summary open for each reportee, as { [reportee id]: summary id }; none is shown until one is drafted or viewed
  const [openSummary, setOpenSummary] = useState({})
  // The open summary's text while it's being edited
  const [summaryEdit, setSummaryEdit] = useState(null)
  const [savingSummary, setSavingSummary] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([
      supabase.from('reportees').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('reportee_notes').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('colleagues').select('name').eq('user_id', userId).order('name'),
      supabase.from('review_summaries').select('*').eq('user_id', userId),
    ]).then(([r, n, c, rs]) => {
      if (!live) return
      const failed = r.error || n.error
      if (failed) setLoadError(`Couldn't load your team: ${failed.message}`)
      else if (rs.error) setLoadError(`Couldn't load saved summaries: ${rs.error.message}`)
      setReportees(r.data || [])
      setNotes(n.data || [])
      setColleagueNames((c.data || []).map(x => x.name))
      setSummaries(rs.data || [])
    })
    return () => { live = false }
  }, [userId])

  const current = reportees.find(r => r.id === selectedId) || reportees[0] || null
  const first = current?.name.split(/\s+/)[0] || ''
  const teamQuery = teamSearch.trim().toLowerCase()
  const listed = teamQuery ? reportees.filter(r => `${r.name} ${r.role || ''}`.toLowerCase().includes(teamQuery)) : reportees
  const changedAt = x => x.updated_at || x.created_at
  const theirSummaries = current ? summaries.filter(x => x.reportee_id === current.id).sort((a, b) => changedAt(b).localeCompare(changedAt(a))) : []
  const shownSummary = theirSummaries.find(x => x.id === openSummary[current?.id]) || null
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
  // Review periods to summarise: the current one, the last finished one, and any older one with a saved summary
  const periods = [currentCycle(), reviewCycle(), ...theirSummaries.map(x => ({ start: x.period_start, end: x.period_end }))]
    .filter((c, i, all) => all.findIndex(o => o.start === c.start) === i)
    .sort((a, b) => b.start.localeCompare(a.start))
    .map(c => ({
      ...c,
      inProgress: c.start === currentCycle().start,
      count: currentNotes.filter(n => noteDay(n) >= c.start && noteDay(n) < c.end).length,
      summary: theirSummaries.find(x => x.period_start === c.start) || null,
    }))

  // A name typed but not yet picked still counts
  const withPending = (names, pending) => canonicalizeNames(pending.trim() ? [...names, pending] : names, pool.map(p => p.name))

  function pick(id) {
    setSelectedId(id)
    setFilter('all')
    setNoteText('')
    setSaidBy([])
    setQuery('')
    setEditing(null)
    setForm(f => f?.id ? null : f)
    setCopied(false)
    setSummaryEdit(null)
    setError('')
  }

  async function saveReportee(e) {
    e.preventDefault()
    const name = form.name.trim().replace(/\s+/g, ' ')
    if (!name) return
    setError('')
    const fields = { name, role: form.role.trim() || null, joined_on: form.joined || null }
    const { data, error: saveError } = form.id
      ? await supabase.from('reportees').update(fields).eq('id', form.id).select().single()
      : await supabase.from('reportees').insert({ user_id: userId, ...fields }).select().single()
    if (saveError) { setError(`Couldn't save ${name}: ${saveError.message}`); return }
    setForm(null)
    if (form.id) { setReportees(prev => prev.map(r => r.id === data.id ? data : r)); return }
    setReportees(prev => [...prev, data])
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
    const people = noteType === 'others' ? withPending(saidBy, query) : []
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

  function startEdit(n) {
    setEditing({ id: n.id, type: n.type, content: n.content, saidBy: n.said_by || [], query: '' })
  }

  async function saveEdit() {
    const content = editing.content.trim()
    if (!content || savingEdit) return
    const said_by = editing.type === 'others' ? withPending(editing.saidBy, editing.query) : []
    setSavingEdit(true)
    setError('')
    const { data, error: saveError } = await supabase.from('reportee_notes')
      .update({ type: editing.type, content, said_by }).eq('id', editing.id).select().single()
    setSavingEdit(false)
    if (saveError) { setError(`Couldn't save the note: ${saveError.message}`); return }
    setNotes(prev => prev.map(n => n.id === data.id ? data : n))
    setEditing(null)
  }

  async function deleteNote(id) {
    if (!confirm('Delete this note?')) return
    const { error: delError } = await supabase.from('reportee_notes').delete().eq('id', id)
    if (delError) { setError(`Couldn't delete the note: ${delError.message}`); return }
    setNotes(prev => prev.filter(n => n.id !== id))
    if (editing?.id === id) setEditing(null)
  }

  async function draftSummary(period) {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return }
    const inPeriod = currentNotes.filter(n => noteDay(n) >= period.start && noteDay(n) < period.end)
    if (!inPeriod.length) { setError(`No notes about ${first} in ${formatCycle(period)}.`); return }
    const person = current
    setError('')
    setDrafting(true)
    try {
      const labelled = [...inPeriod].reverse().map(n => ({ ...n, label: TYPES[n.type]?.label || n.type }))
      const text = await callClaude(apiKey, REVIEW_SUMMARY_SYSTEM, reviewSummaryPrompt(person.name, labelled, formatCycle(period)))
      const row = { user_id: userId, reportee_id: person.id, period_start: period.start, period_end: period.end, content: text }
      const { data, error: saveError } = await supabase.from('review_summaries').insert(row).select().single()
      // If saving fails, keep the summary on screen for this visit so it isn't lost
      const summary = data || { ...row, id: `unsaved-${person.id}-${period.start}`, created_at: new Date().toISOString(), unsaved: true }
      if (saveError) setError(`Drafted, but couldn't save the summary: ${saveError.message}. Copy it before you leave.`)
      setSummaries(prev => [...prev, summary])
      setOpenSummary(prev => ({ ...prev, [person.id]: summary.id }))
      setSummaryEdit(null)
      setCopied(false)
    } catch (err) {
      setError(`Couldn't draft the summary: ${err.message}`)
    } finally {
      setDrafting(false)
    }
  }

  function copySummary() {
    navigator.clipboard.writeText(shownSummary.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function viewSummary(summary) {
    setOpenSummary(prev => ({ ...prev, [current.id]: summary.id }))
    setSummaryEdit(null)
    setCopied(false)
  }

  function closeSummary() {
    setOpenSummary(prev => ({ ...prev, [current.id]: null }))
    setSummaryEdit(null)
  }

  async function saveSummary() {
    const content = summaryEdit.trim()
    if (!content || savingSummary) return
    setError('')
    if (shownSummary.unsaved) {
      setSummaries(prev => prev.map(x => x.id === shownSummary.id ? { ...x, content } : x))
      setSummaryEdit(null)
      return
    }
    setSavingSummary(true)
    const { data, error: saveError } = await supabase.from('review_summaries')
      .update({ content, updated_at: new Date().toISOString() }).eq('id', shownSummary.id).select().single()
    setSavingSummary(false)
    if (saveError) { setError(`Couldn't save the summary: ${saveError.message}`); return }
    setSummaries(prev => prev.map(x => x.id === data.id ? data : x))
    setSummaryEdit(null)
  }

  async function deleteSummary() {
    if (!confirm(`Delete ${first}'s review summary for ${formatCycle({ start: shownSummary.period_start, end: shownSummary.period_end })}?`)) return
    if (!shownSummary.unsaved) {
      const { error: delError } = await supabase.from('review_summaries').delete().eq('id', shownSummary.id)
      if (delError) { setError(`Couldn't delete the summary: ${delError.message}`); return }
    }
    setSummaries(prev => prev.filter(x => x.id !== shownSummary.id))
    setSummaryEdit(null)
    setCopied(false)
  }

  const reporteeForm = form && (
    <form onSubmit={saveReportee} style={s.addForm}>
      <span style={s.addTitle}>{form.id ? 'Edit reportee' : 'New reportee'}</span>
      <label htmlFor="reportee-name" style={s.srOnly}>Name</label>
      <input id="reportee-name" type="text" autoFocus placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={s.input} />
      <label htmlFor="reportee-role" style={s.srOnly}>Role</label>
      <input id="reportee-role" type="text" placeholder="Role, e.g. Product Designer" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} style={s.input} />
      <div style={s.field}>
        <label htmlFor="reportee-joined" style={s.smallLabel}>Reports to you since</label>
        <input id="reportee-joined" type="date" max={toIso(new Date())} value={form.joined} onChange={e => setForm({ ...form, joined: e.target.value })} style={s.input} />
      </div>
      <div style={s.addActions}>
        <button type="button" onClick={() => setForm(null)} style={s.cancelBtn}>Cancel</button>
        <button type="submit" disabled={!form.name.trim()} style={{ ...s.darkBtn, ...(form.name.trim() ? {} : s.disabled) }}>{form.id ? 'Save' : 'Add'}</button>
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
          <button type="button" onClick={() => setForm(adding ? null : { name: '', role: '', joined: '' })} aria-expanded={adding} style={s.primaryBtn}>
            <Icon size={16} strokeWidth={2} d="M12 5v14M5 12h14" />Add reportee
          </button>
        </header>

        {loadError && <p role="alert" style={s.error}>{loadError}</p>}
        {!current && error && <p role="alert" style={s.error}>{error}</p>}

        {!current ? (
          <div style={s.emptyTeam}>
            {adding ? reporteeForm : (
              <>
                <span style={s.emptyTitle}>No one on your team yet</span>
                <span style={s.emptyText}>Add the people who report to you, then capture wins, feedback you've given and things others mention as they happen — review time gets much easier.</span>
              </>
            )}
          </div>
        ) : (
          <div style={s.columns}>
            <aside aria-label="Reportees" style={s.aside}>
              {form && reporteeForm}
              <div style={s.searchWrap}>
                <span style={s.searchIcon}><Icon size={16} d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-4-4" /></span>
                <label htmlFor="team-search" style={s.srOnly}>Search your team</label>
                <input id="team-search" type="search" value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                  placeholder="Search by name or role" style={s.search} />
              </div>
              {teamQuery && !listed.length && <p style={s.noMatch}>No one matches “{teamSearch.trim()}”.</p>}
              {listed.map(r => {
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
                    <span style={s.muted}>
                      {current.role ? `${current.role} · ` : ''}
                      {current.joined_on ? `Reports to you since ${monthYear(parseIso(current.joined_on))}` : `Added ${monthYear(new Date(current.created_at))}`}
                    </span>
                  </div>
                </div>
                <div style={s.personActions}>
                  <SummaryMenu key={current.id} periods={periods} busy={drafting} onDraft={draftSummary} onView={viewSummary} />
                  <button type="button" className="icon-btn" onClick={() => setForm({ id: current.id, name: current.name, role: current.role || '', joined: current.joined_on || '' })}
                    aria-label={`Edit ${current.name}`} title="Edit" aria-expanded={form?.id === current.id} style={s.iconBtn}>
                    <Icon size={16} d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />
                  </button>
                  <button type="button" className="icon-btn" onClick={removeReportee} aria-label={`Remove ${current.name}`} title="Remove" style={s.iconBtn}>
                    <Icon size={16} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </button>
                </div>
              </div>

              {error && <p role="alert" style={s.error}>{error}</p>}

              {shownSummary && (
                <section aria-labelledby="summary-h" style={s.draftCard}>
                  <div style={s.draftHead}>
                    <div style={s.cardHeadText}>
                      <h3 id="summary-h" style={s.draftEyebrow}>Review summary · {formatCycle({ start: shownSummary.period_start, end: shownSummary.period_end })}</h3>
                      <span style={s.draftMeta}>
                        {shownSummary.unsaved ? 'Not saved' : shownSummary.updated_at ? `Edited ${formatStamp(shownSummary.updated_at)}` : `Saved ${formatStamp(shownSummary.created_at)}`}
                      </span>
                    </div>
                    {summaryEdit === null && (
                      <div style={s.draftActions}>
                        <button type="button" onClick={() => setSummaryEdit(shownSummary.content)} style={s.darkOutlineBtn}>Edit</button>
                        <button type="button" onClick={copySummary} style={s.brightBtn}>{copied ? 'Copied!' : 'Copy'}</button>
                        <button type="button" onClick={deleteSummary} aria-label="Delete this summary" title="Delete" style={s.darkIconBtn}>
                          <Icon size={16} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                        </button>
                        <button type="button" onClick={closeSummary} aria-label="Close summary" title="Close" style={s.darkIconBtn}>
                          <Icon size={16} d="M6 6l12 12M18 6L6 18" />
                        </button>
                      </div>
                    )}
                  </div>
                  {summaryEdit === null ? <p style={s.draftText}>{shownSummary.content}</p> : (
                    <>
                      <label htmlFor="summary-edit" style={s.srOnly}>Summary</label>
                      <textarea id="summary-edit" rows={12} autoFocus value={summaryEdit} onChange={e => setSummaryEdit(e.target.value)}
                        onKeyDown={e => e.key === 'Escape' && setSummaryEdit(null)} style={s.summaryTextarea} />
                      <div style={s.editActions}>
                        <button type="button" onClick={() => setSummaryEdit(null)} style={s.darkOutlineBtn}>Cancel</button>
                        <button type="button" onClick={saveSummary} disabled={!summaryEdit.trim() || savingSummary}
                          style={{ ...s.brightBtn, ...(!summaryEdit.trim() || savingSummary ? s.disabled : {}) }}>
                          {savingSummary ? 'Saving…' : 'Save summary'}
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}

              <div style={s.composer}>
                <div style={s.composerHead}>
                  <h3 style={s.h3}>Add to {first}'s log</h3>
                  <TypePicker value={noteType} onChange={setNoteType} />
                </div>

                {noteType === 'others' && (
                  <SaidByField id="said-by" value={saidBy} onChange={setSaidBy} query={query} onQueryChange={setQuery} pool={pool} />
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
                <div style={s.listHead}>
                  <h3 style={s.listTitle}>{filter === 'all' ? 'Log' : filterLabel} · newest first</h3>
                  <div role="group" aria-label="Filter notes" style={s.chips}>
                    {FILTERS.map(f => {
                      const on = f.key === filter
                      return (
                        <button key={f.key} type="button" className="chip-btn" aria-pressed={on} onClick={() => setFilter(f.key)}
                          style={{ ...s.chip, ...(on ? s.chipOn : {}) }}>
                          <span aria-hidden="true" style={{ ...s.dot, background: f.dot }} />
                          {f.label}
                          <span style={{ ...s.chipCount, ...(on ? s.chipCountOn : {}) }}>{counts[f.key]}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                {shown.length ? shown.map(n => {
                  const type = TYPES[n.type] || TYPES.mine
                  if (editing?.id === n.id) {
                    const edit = patch => setEditing(prev => ({ ...prev, ...patch }))
                    const canSave = editing.content.trim() && !savingEdit
                    return (
                      <article key={n.id} aria-label="Edit note" style={{ ...s.note, ...s.noteEditing }}>
                        <div style={s.composerHead}>
                          <span style={s.muted13}>Added {dayMonth(n.created_at)}</span>
                          <TypePicker value={editing.type} onChange={type => edit({ type })} />
                        </div>
                        {editing.type === 'others' && (
                          <SaidByField id={`said-by-${n.id}`} value={editing.saidBy} onChange={saidBy => edit({ saidBy })}
                            query={editing.query} onQueryChange={query => edit({ query })} pool={pool} />
                        )}
                        <label htmlFor={`note-${n.id}`} style={s.srOnly}>Note</label>
                        <textarea id={`note-${n.id}`} rows={3} autoFocus value={editing.content} onChange={e => edit({ content: e.target.value })}
                          onKeyDown={e => e.key === 'Escape' && setEditing(null)} style={s.textarea} />
                        <div style={s.editActions}>
                          <button type="button" onClick={() => setEditing(null)} style={s.cancelBtn}>Cancel</button>
                          <button type="button" onClick={saveEdit} disabled={!canSave} style={{ ...s.darkBtn, ...(canSave ? {} : s.disabled) }}>
                            {savingEdit ? 'Saving…' : 'Save changes'}
                          </button>
                        </div>
                      </article>
                    )
                  }
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
                        <div style={s.noteActions}>
                          <button type="button" className="icon-btn" onClick={() => startEdit(n)} aria-label="Edit note" title="Edit" style={s.smallIconBtn}>
                            <Icon size={14} d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />
                          </button>
                          <button type="button" className="icon-btn" onClick={() => deleteNote(n.id)} aria-label="Delete note" title="Delete" style={s.smallIconBtn}>
                            <Icon size={14} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                          </button>
                        </div>
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

// 'Draft review summary' and its popover for picking which review period to summarise
function SummaryMenu({ periods, busy, onDraft, onView }) {
  const [open, setOpen] = useState(false)
  // Defaults to the last finished period, the one a review is written about
  const [picked, setPicked] = useState(() => reviewCycle().start)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const period = periods.find(p => p.start === picked) || periods[0]

  useEffect(() => {
    if (!open) return
    wrapRef.current.querySelector('input[type="radio"]:checked')?.focus()
    const onDown = e => { if (!wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close() {
    setOpen(false)
    buttonRef.current.focus()
  }

  return (
    <div ref={wrapRef} style={s.relative}>
      <button ref={buttonRef} type="button" onClick={() => setOpen(v => !v)} disabled={busy} aria-haspopup="dialog" aria-expanded={open}
        style={{ ...s.darkBtn, ...s.tallBtn, ...(busy ? s.disabled : {}) }}>
        <Icon size={16} stroke={t.bright} d="M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" />
        {busy ? 'Drafting…' : 'Draft review summary'}
      </button>
      {open && (
        <div role="dialog" aria-labelledby="summary-period-h" className="popover" onKeyDown={e => e.key === 'Escape' && close()} style={s.popover}>
          <div style={s.cardHeadText}>
            <h3 id="summary-period-h" style={s.h3}>Which review period?</h3>
            <span style={s.hint}>Only notes from this period go into the summary.</span>
          </div>
          <fieldset style={s.periodList}>
            <legend style={s.srOnly}>Review period</legend>
            {periods.map(p => {
              const on = p.start === period.start
              return (
                <label key={p.start} style={{ ...s.periodOption, ...(on ? s.periodOptionOn : {}) }}>
                  <input type="radio" name="summary-period" value={p.start} checked={on} onChange={() => setPicked(p.start)} style={s.radio} />
                  <span style={s.personText}>
                    <span style={s.periodName}>{formatCycle(p)}</span>
                    <span style={s.personMeta}>{p.count} {p.count === 1 ? 'note' : 'notes'}{p.inProgress ? ' · in progress' : ''}{p.summary ? ' · summary saved' : ''}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>
          <div style={s.editActions}>
            <button type="button" onClick={close} style={s.cancelBtn}>Cancel</button>
            {period.summary ? (
              <button type="button" onClick={() => { setOpen(false); onView(period.summary) }} style={s.darkBtn}>View summary</button>
            ) : (
              <button type="button" disabled={!period.count} onClick={() => { setOpen(false); onDraft(period) }}
                style={{ ...s.darkBtn, ...(period.count ? {} : s.disabled) }}>
                Draft summary
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TypePicker({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Note type" style={s.types}>
      {Object.entries(TYPES).map(([key, type]) => {
        const on = key === value
        return (
          <button key={key} type="button" role="radio" aria-checked={on} onClick={() => onChange(key)}
            style={{ ...s.typeBtn, ...(on ? { border: `1.5px solid ${type.fg}`, background: type.bg, color: type.fg } : {}) }}>
            {type.label}
          </button>
        )
      })}
    </div>
  )
}

// Tag the people who said something, picking from `pool` ({ name, tag }) or adding someone new.
// The parent owns the typed `query` so a name typed but not picked can still be saved.
function SaidByField({ id, value, onChange, query, onQueryChange, pool }) {
  const q = nameKey(query)
  const tagged = new Set(value.map(nameKey))
  const suggestions = q ? pool.filter(p => !tagged.has(nameKey(p.name)) && nameKey(p.name).includes(q)).slice(0, 5) : []
  const exact = q && (pool.some(p => nameKey(p.name) === q) || tagged.has(q))

  function addTag(name) {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (clean) onChange(canonicalizeNames([...value, clean], pool.map(p => p.name)))
    onQueryChange('')
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length) addTag(suggestions[0].name)
      else if (q) addTag(query)
    } else if (e.key === 'Backspace' && !query && value.length) {
      onChange(value.slice(0, -1))
    } else if (e.key === 'Escape' && query) {
      e.stopPropagation()
      onQueryChange('')
    }
  }

  return (
    <div style={s.field}>
      <div style={s.fieldHead}>
        <label htmlFor={id} style={s.smallLabel}>Who said it?</label>
        <span style={s.hint}>Tag one or more people</span>
      </div>
      <div style={s.relative}>
        <div className="tag-box" style={{ ...s.tagBox, ...(q ? { border: `1.5px solid ${TYPES.others.fg}` } : {}) }}>
          {value.map(name => (
            <span key={name} style={s.tag}>
              <span aria-hidden="true" style={s.tagAvatar}>{initials(name)}</span>
              <span>{name}</span>
              <button type="button" aria-label={`Remove ${name}`} onClick={() => onChange(value.filter(n => n !== name))} style={s.tagRemove}>
                <Icon size={12} strokeWidth={2.4} d="M6 6l12 12M18 6L6 18" />
              </button>
            </span>
          ))}
          <input id={id} className="tag-input" type="text" autoComplete="off" role="combobox" aria-expanded={!!q} aria-controls={`${id}-suggestions`}
            placeholder={value.length ? 'Add another person…' : 'Type a name, e.g. Ravi'}
            value={query} onChange={e => onQueryChange(e.target.value)} onKeyDown={onKeyDown} style={s.tagInput} />
        </div>
        {q && (
          <div id={`${id}-suggestions`} role="listbox" aria-label="People" style={s.suggestions}>
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
  searchWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute', left: 12, display: 'flex', color: t.muted, pointerEvents: 'none' },
  search: { ...control, width: '100%', height: 44, background: t.white, padding: '0 12px 0 36px' },
  noMatch: { margin: 0, padding: '4px 2px', fontSize: 14, color: t.muted },
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

  popover: { position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 20, width: 340, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', background: t.white, border: `1px solid ${t.border}`, borderRadius: 16, boxShadow: '0 16px 40px rgba(28, 27, 34, 0.16)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 },
  cardHeadText: { display: 'flex', flexDirection: 'column', gap: 4 },
  periodList: { margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' },
  periodOption: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '10px 12px', borderRadius: 12, border: `1px solid ${t.border}`, cursor: 'pointer' },
  periodOptionOn: { border: `2px solid ${t.accent}`, padding: '9px 11px', background: t.accentSoft },
  periodName: { fontSize: 14, fontWeight: 600 },
  radio: { flex: '0 0 auto', width: 18, height: 18, margin: 0, accentColor: t.accent },
  draftCard: { background: t.dark, color: t.white, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 },
  draftHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  draftMeta: { fontSize: 13, color: t.onDarkMuted },
  draftActions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  darkOutlineBtn: { ...btn, height: 36, padding: '0 14px', border: `1px solid ${t.darkBorder}`, background: 'transparent', color: t.onDark },
  darkIconBtn: { width: 36, height: 36, borderRadius: 10, border: `1px solid ${t.darkBorder}`, background: 'transparent', color: t.onDark, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  summaryTextarea: { boxSizing: 'border-box', width: '100%', resize: 'vertical', border: `1px solid ${t.border}`, borderRadius: 12, background: t.field, color: t.text, padding: '12px 14px', fontSize: 15, lineHeight: 1.6 },
  draftEyebrow: { margin: 0, fontWeight: 500, fontFamily: t.fontMono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.bright },
  draftText: { margin: 0, fontSize: 15, lineHeight: 1.6, color: t.onDark, whiteSpace: 'pre-wrap' },

  listHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 6px 0 12px', borderRadius: 999, border: `1px solid ${t.border}`, background: t.white, color: t.secondary, fontSize: 13, fontWeight: 600 },
  chipOn: { border: `1px solid ${t.dark}`, background: t.dark, color: t.white },
  chipCount: { minWidth: 22, height: 22, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, background: t.avatar, color: t.text, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 },
  chipCountOn: { background: t.darkActive, color: t.white },
  dot: { flex: '0 0 auto', width: 8, height: 8, borderRadius: '50%' },

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
  noteEditing: { border: `2px solid ${t.accent}`, padding: '15px 17px', gap: 14 },
  noteActions: { display: 'flex', gap: 2, flexShrink: 0 },
  editActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
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
