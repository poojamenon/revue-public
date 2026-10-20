import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { t, layout } from '../lib/theme'
import MentionTextarea from './MentionTextarea'
import MentionText from './MentionText'
import { PersonDrawer } from './PersonPanel'
import { canonicalizeNames, extractMentions, syncColleagues } from '../lib/colleagues'
import { currentCycle, formatCycle } from '../lib/cycles'
import { mondayOf, weeksBetween, weekNumber, formatDayMonth, parseIso } from '../lib/weeks'

export default function WeeklyLog({ userId }) {
  const thisWeek = mondayOf()
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [goals, setGoals] = useState([])
  const [colleagues, setColleagues] = useState([])
  const [selectedWeek, setSelectedWeek] = useState(null)
  // null while reading a week, 'new' for a new entry, or the id of the entry being edited
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(() => blankForm(thisWeek))
  const [saving, setSaving] = useState(false)
  // Colleague whose feedback panel is open over the page
  const [openPerson, setOpenPerson] = useState(null)
  const [colleagueInput, setColleagueInput] = useState('')
  const [showAllGoals, setShowAllGoals] = useState(false)
  const [search, setSearch] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const tilesRef = useRef(null)

  // Merge saved colleagues with any names added in the current form (not yet saved)
  const allMentions = canonicalizeNames([...colleagues.map(c => c.name), ...form.colleagues])

  useEffect(() => { fetchAll() }, [userId])

  async function fetchAll() {
    const [{ data: e }, { data: g }, { data: c }] = await Promise.all([
      supabase.from('entries').select('*').eq('user_id', userId).order('week_of', { ascending: false }),
      supabase.from('goals').select('*').eq('user_id', userId).eq('status', 'active'),
      supabase.from('colleagues').select('*').eq('user_id', userId).order('name'),
    ])
    setEntries(e || [])
    setGoals(g || [])
    setColleagues(c || [])
    setLoaded(true)
  }

  // Entries grouped by the Monday of their week
  const byWeek = {}
  for (const e of entries) (byWeek[mondayOf(e.week_of)] ||= []).push(e)
  const earliest = Object.keys(byWeek).sort()[0]
  const cycleStart = currentCycle().start
  const weeks = weeksBetween(earliest && earliest < cycleStart ? earliest : cycleStart, thisWeek)
  // Until a week is picked, show the latest logged week, or this week when nothing is logged
  const week = selectedWeek || (entries.length ? mondayOf(entries[0].week_of) : thisWeek)
  const weekEntries = byWeek[week] || []
  const showForm = editing !== null || weekEntries.length === 0

  // Keep the chosen week's tile in view
  useEffect(() => {
    tilesRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [week, loaded])

  function selectWeek(w) {
    setSelectedWeek(w)
    setEditing(null)
    setForm(blankForm(w))
    setColleagueInput('')
  }

  function logThisWeek() {
    const existing = byWeek[thisWeek]?.[0]
    if (existing) { setSelectedWeek(thisWeek); startEdit(existing) }
    else selectWeek(thisWeek)
  }

  function startEdit(entry) {
    setEditing(entry.id)
    setForm({ week_of: entry.week_of, work: entry.work, went_well: entry.went_well || '', was_hard: entry.was_hard || '', colleagues: entry.colleagues || [], goal_ids: entry.goal_ids || [], flag: entry.flag || false })
  }

  function cancelEdit() {
    setEditing(null)
    setForm(blankForm(week))
  }

  async function saveEntry() {
    setSaving(true)
    // Merge explicitly tagged colleagues with any @mentions in text fields
    const mentioned = [
      ...extractMentions(form.work, allMentions),
      ...extractMentions(form.went_well, allMentions),
      ...extractMentions(form.was_hard, allMentions),
    ]
    const allColleagues = canonicalizeNames([...form.colleagues, ...mentioned], allMentions)
    const payload = { ...form, colleagues: allColleagues, user_id: userId }
    if (editing && editing !== 'new') {
      await supabase.from('entries').update(payload).eq('id', editing)
    } else {
      await supabase.from('entries').insert(payload)
    }
    await syncColleagues(userId, allColleagues)
    setSelectedWeek(mondayOf(form.week_of))
    setEditing(null)
    setForm(blankForm(mondayOf(form.week_of)))
    setSaving(false)
    fetchAll()
  }

  // Called when a new name is @mentioned in a text field
  async function handleMentionAdd(name) {
    // Check against the latest form state so a name is never added twice
    setForm(f => f.colleagues.some(c => c.toLowerCase() === name.toLowerCase()) ? f : { ...f, colleagues: [...f.colleagues, name] })
    await syncColleagues(userId, [name])
    fetchAll()
  }

  function addColleague() {
    const name = colleagueInput.trim()
    if (!name || form.colleagues.some(c => c.toLowerCase() === name.toLowerCase())) return
    setForm(f => ({ ...f, colleagues: canonicalizeNames([...f.colleagues, name], allMentions) }))
    setColleagueInput('')
  }

  function removeColleague(name) {
    setForm(f => ({ ...f, colleagues: f.colleagues.filter(c => c !== name) }))
  }

  function toggleGoal(id) {
    setForm(f => ({ ...f, goal_ids: f.goal_ids.includes(id) ? f.goal_ids.filter(g => g !== id) : [...f.goal_ids, id] }))
  }

  async function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return
    await supabase.from('entries').delete().eq('id', id)
    setEditing(null)
    fetchAll()
  }

  // People tagged in the most recent entries, for one-click adding
  const recentColleagues = []
  for (const e of entries) {
    for (const n of e.colleagues || []) {
      const k = n.toLowerCase()
      if (!recentColleagues.some(r => r.toLowerCase() === k) && !form.colleagues.some(c => c.toLowerCase() === k)) recentColleagues.push(n)
    }
    if (recentColleagues.length >= 4) break
  }
  const shownRecent = recentColleagues.slice(0, 4)

  const shownGoals = showAllGoals ? goals : goals.filter((g, i) => i < GOALS_SHOWN || form.goal_ids.includes(g.id))
  const hiddenGoalCount = goals.length - shownGoals.length

  const query = search.trim().toLowerCase()
  const filtering = !!query || flaggedOnly
  const results = filtering ? entries.filter(e => {
    if (flaggedOnly && !e.flag) return false
    if (!query) return true
    return [e.work, e.went_well, e.was_hard, ...(e.colleagues || [])].some(v => v?.toLowerCase().includes(query))
  }) : []

  const weekPeople = canonicalizeNames(weekEntries.flatMap(e => e.colleagues || []))
  const firstEver = loaded && entries.length === 0

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <header style={s.topHeader}>
          <div style={s.header}>
            <span style={s.eyebrow}>{firstEver ? 'Nothing logged yet' : `Review period · ${formatCycle(currentCycle())}`}</span>
            <h1 style={s.h1}>Your weeks</h1>
          </div>
          <div style={s.tools}>
            {!firstEver && (
              <>
                <div style={s.searchWrap}>
                  <span style={s.searchIcon}><Icon size={16}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></Icon></span>
                  <label htmlFor="f-search" style={s.srOnly}>Search entries</label>
                  <input id="f-search" type="search" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search entries or people" style={s.search} />
                </div>
                <button type="button" aria-pressed={flaggedOnly} onClick={() => setFlaggedOnly(v => !v)}
                  style={{ ...s.filterBtn, ...(flaggedOnly ? s.filterOn : {}) }}>
                  <span aria-hidden="true">★</span>Flagged
                </button>
              </>
            )}
            <button type="button" onClick={logThisWeek} style={s.primaryBtn}>
              <Icon size={16} strokeWidth={2} d="M12 5v14M5 12h14" />Log this week
            </button>
          </div>
        </header>

        {filtering ? (
          <section aria-labelledby="results-h" style={s.results}>
            <div style={s.resultsHead}>
              <h2 id="results-h" style={s.resultsTitle}>{results.length} {results.length === 1 ? 'entry' : 'entries'}{flaggedOnly ? ' flagged' : ''}{query ? ` matching “${search.trim()}”` : ''}</h2>
              <button type="button" onClick={() => { setSearch(''); setFlaggedOnly(false) }} style={s.linkBtn}>Clear</button>
            </div>
            {results.map(e => (
              <button key={e.id} type="button" className="entry-card" onClick={() => { selectWeek(mondayOf(e.week_of)); setSearch(''); setFlaggedOnly(false) }} style={s.resultCard}>
                <span style={s.resultWeek}>WK {weekNumber(mondayOf(e.week_of))} · {formatDayMonth(e.week_of)} {parseIso(e.week_of).getFullYear()}{e.flag && <span style={{ color: t.star }}> · ★</span>}</span>
                <span style={s.resultText}><MentionText text={firstLine(e.work)} names={allMentions} /></span>
                {e.colleagues?.length > 0 && <span style={s.resultMeta}>With {e.colleagues.join(', ')}</span>}
              </button>
            ))}
          </section>
        ) : (
          <>
            <div ref={tilesRef} role="tablist" aria-label="Weeks" style={s.tiles}>
              {weeks.map((w, i) => {
                const list = byWeek[w] || []
                const on = w === week
                const notes = list.reduce((n, e) => n + lines(e.work).length, 0)
                const people = canonicalizeNames(list.flatMap(e => e.colleagues || [])).length
                const flagged = list.some(e => e.flag)
                const logged = list.length > 0
                const now = w === thisWeek
                return (
                  <button key={w} type="button" role="tab" className="tile-btn" aria-selected={on} aria-controls="week-panel" onClick={() => selectWeek(w)}
                    aria-label={`Week of ${formatDayMonth(w)}${logged ? `, ${notes} ${notes === 1 ? 'note' : 'notes'}` : ', not logged'}${flagged ? ', flagged' : ''}`}
                    style={{ ...s.tile, ...(logged ? { background: t.tints[i % t.tints.length] } : s.tileEmpty), ...(on ? s.tileOn : {}) }}>
                    <span style={{ ...s.tileEyebrow, ...(on ? { color: t.accentInk } : {}) }}>
                      WK {weekNumber(w)}{now ? ' · Now' : ''}{flagged && <span style={{ color: t.star }}> · ★</span>}
                    </span>
                    <span style={s.tileDate}>{formatDayMonth(w)}</span>
                    <span style={s.bars} aria-hidden="true">
                      {logged
                        ? Array.from({ length: Math.min(Math.max(notes, 1), 6) }, (_, k) => <span key={k} style={s.bar} />)
                        : <span style={{ ...s.bar, background: on ? t.accentStrong : t.border }} />}
                    </span>
                    <span style={{ ...s.tileMeta, ...(on ? { color: t.accentInk } : {}) }}>
                      {logged ? `${notes} ${notes === 1 ? 'note' : 'notes'}${people ? ` · ${people} ${people === 1 ? 'person' : 'people'}` : ''}` : on && firstEver ? 'Start here' : now ? 'Not logged yet' : 'Not logged'}
                    </span>
                  </button>
                )
              })}
            </div>

            <div style={s.columns}>
              <div id="week-panel" role="tabpanel" style={s.mainCol}>
                {!showForm && weekEntries.map(entry => (
                  <article key={entry.id} className="page-card" style={s.card}>
                    <div style={s.cardHead}>
                      <div style={s.cardTitleRow}>
                        <h2 style={s.cardTitle}>Week of {formatLongDay(entry.week_of)}</h2>
                        {entry.flag && <span style={s.flagBadge}>★ Flagged</span>}
                      </div>
                      <div style={s.cardActions}>
                        <button type="button" onClick={() => startEdit(entry)} style={s.outlineBtn}>Edit week</button>
                        <button type="button" className="icon-btn" onClick={() => deleteEntry(entry.id)} aria-label={`Delete entry for week of ${formatDayMonth(entry.week_of)}`} title="Delete" style={s.iconBtn}>
                          <Icon size={16} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                        </button>
                      </div>
                    </div>
                    <div className="week-grid" style={s.grid}>
                      <h3 style={s.rowLabel}>Worked on</h3>
                      <ul style={s.list}>{lines(entry.work).map((l, k) => <li key={k}><MentionText text={l} names={allMentions} /></li>)}</ul>
                      <h3 style={s.rowLabel}>Went well</h3>
                      {entry.went_well?.trim()
                        ? <p style={s.rowText}><MentionText text={entry.went_well} names={allMentions} /></p>
                        : <button type="button" onClick={() => startEdit(entry)} style={s.addLink}>+ Add what went well</button>}
                      <h3 style={s.rowLabel}>Was hard</h3>
                      {entry.was_hard?.trim()
                        ? <p style={s.rowText}><MentionText text={entry.was_hard} names={allMentions} /></p>
                        : <button type="button" onClick={() => startEdit(entry)} style={s.addLink}>+ Add what was hard</button>}
                      {entry.goal_ids?.length > 0 && (
                        <>
                          <h3 style={s.rowLabel}>Goals</h3>
                          <div style={s.chipRow}>{goals.filter(g => entry.goal_ids.includes(g.id)).map(g => <span key={g.id} style={s.goalBadge}>{g.title}</span>)}</div>
                        </>
                      )}
                    </div>
                  </article>
                ))}

                {showForm && (
                  <section aria-labelledby="compose-h" className="page-card" style={s.card}>
                    <div style={s.formIntro}>
                      <h2 id="compose-h" style={s.formTitle}>
                        {editing && editing !== 'new' ? 'Edit week' : firstEver ? 'Log your first week' : `Log the week of ${formatDayMonth(form.week_of)}`}
                      </h2>
                      <div style={s.weekPick}>
                        <label htmlFor="f-week" style={s.weekPickLabel}>Week of</label>
                        <input id="f-week" type="date" value={form.week_of}
                          onChange={e => e.target.value && setForm(f => ({ ...f, week_of: e.target.value }))} style={s.weekInput} />
                        <span style={s.hint}>A few bullet points is plenty. You can come back and add more.</span>
                      </div>
                    </div>

                    <div style={s.field}>
                      <label htmlFor="f-work" style={s.label}>What did you work on?</label>
                      <MentionTextarea id="f-work" rows={4} value={form.work}
                        onChange={e => setForm(f => ({ ...f, work: e.target.value }))}
                        placeholder="Projects, reviews, meetings… type @ to mention someone"
                        mentions={allMentions}
                        onAddMention={handleMentionAdd}
                        style={s.textarea} />
                    </div>
                    <div style={s.pair}>
                      <div style={s.field}>
                        <label htmlFor="f-well" style={s.label}>What went well?</label>
                        <MentionTextarea id="f-well" rows={3} value={form.went_well}
                          onChange={e => setForm(f => ({ ...f, went_well: e.target.value }))}
                          placeholder="A win or a thank-you"
                          mentions={allMentions}
                          onAddMention={handleMentionAdd}
                          style={s.textarea} />
                      </div>
                      <div style={s.field}>
                        <label htmlFor="f-hard" style={s.label}>What was hard?</label>
                        <MentionTextarea id="f-hard" rows={3} value={form.was_hard}
                          onChange={e => setForm(f => ({ ...f, was_hard: e.target.value }))}
                          placeholder="Blockers or friction"
                          mentions={allMentions}
                          onAddMention={handleMentionAdd}
                          style={s.textarea} />
                      </div>
                    </div>

                    <div style={s.field}>
                      <label htmlFor="f-people" style={s.label}>Who did you work with?</label>
                      {form.colleagues.length > 0 && (
                        <div style={s.chipRow}>
                          {form.colleagues.map(name => (
                            <span key={name} style={s.chipSelected}>
                              {name}
                              <button type="button" onClick={() => removeColleague(name)} aria-label={`Remove ${name}`} style={s.chipRemove}>
                                <Icon size={12} d="M6 6l12 12M18 6L6 18" strokeWidth={2} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <input id="f-people" type="text" value={colleagueInput}
                        onChange={e => setColleagueInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addColleague())}
                        placeholder="Add people by name, then press Enter"
                        style={s.input} />
                      {shownRecent.length > 0 && (
                        <div style={s.chipRow}>
                          <span style={s.recentLabel}>Recent</span>
                          {shownRecent.map(name => (
                            <button key={name} type="button" className="chip-btn" onClick={() => setForm(f => ({ ...f, colleagues: canonicalizeNames([...f.colleagues, name], allMentions) }))} style={s.chipRecent}>
                              <Icon size={12} d="M12 5v14M5 12h14" strokeWidth={2} />{name}
                            </button>
                          ))}
                        </div>
                      )}
                      <span style={s.hint}>Everyone you add shows up in Peer Feedback later.</span>
                    </div>

                    {goals.length > 0 && (
                      <fieldset style={s.fieldset}>
                        <legend style={s.legend}>Relates to goals</legend>
                        <div style={s.chipRow}>
                          {shownGoals.map(g => {
                            const on = form.goal_ids.includes(g.id)
                            return (
                              <button key={g.id} type="button" className="chip-btn" aria-pressed={on} onClick={() => toggleGoal(g.id)} style={on ? s.goalOn : s.goalOff}>
                                {g.title}
                              </button>
                            )
                          })}
                          {hiddenGoalCount > 0 && (
                            <button type="button" onClick={() => setShowAllGoals(true)} style={s.moreBtn}>+{hiddenGoalCount} more</button>
                          )}
                        </div>
                      </fieldset>
                    )}

                    <div style={s.saveRow}>
                      <label htmlFor="f-flag" style={s.flagLabel}>
                        <input id="f-flag" type="checkbox" checked={form.flag}
                          onChange={e => setForm(f => ({ ...f, flag: e.target.checked }))} style={s.flagCheck} />
                        <span><span style={{ color: t.star }} aria-hidden="true">★ </span>Flag for review (I was awesome this week!!)</span>
                      </label>
                      <div style={s.saveActions}>
                        {editing !== null && weekEntries.length > 0 && <button type="button" onClick={cancelEdit} style={s.cancelBtn}>Cancel</button>}
                        <button type="button" onClick={saveEntry} disabled={saving || !form.work.trim()}
                          style={{ ...s.saveBtn, ...(saving || !form.work.trim() ? s.disabled : {}) }}>
                          {saving ? 'Saving…' : 'Save week'}
                        </button>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              <aside style={s.aside}>
                {!showForm && (
                  <section aria-labelledby="people-h" style={s.sideCard}>
                    <h2 id="people-h" style={s.sideTitle}>People in week {weekNumber(week)}</h2>
                    {weekPeople.length > 0 ? weekPeople.map(n => (
                      <button key={n} type="button" className="person-btn" onClick={() => setOpenPerson(n)} aria-haspopup="dialog" style={s.personRow}><span aria-hidden="true" style={s.initials}>{initials(n)}</span>{n}</button>
                    )) : <p style={s.sideText}>No one tagged this week.</p>}
                  </section>
                )}
                {showForm && (
                  <section aria-labelledby="missed-h" style={s.sideCard}>
                    <h2 id="missed-h" style={s.sideTitle}>Missed earlier weeks?</h2>
                    <p style={s.sideText}>Click any dashed week above to fill it in after the fact.</p>
                  </section>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
      {openPerson && <PersonDrawer key={openPerson} userId={userId} name={openPerson} onClose={() => setOpenPerson(null)} />}
    </div>
  )
}

function blankForm(week) {
  return { week_of: week, work: '', went_well: '', was_hard: '', colleagues: [], goal_ids: [], flag: false }
}

function Icon({ d, size = 18, strokeWidth = 1.8, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  )
}

const GOALS_SHOWN = 4

// The bullet points of an entry's "worked on" text
function lines(text) {
  return (text || '').split('\n').map(l => l.trim().replace(/^[-•*]\s+/, '')).filter(Boolean)
}

function firstLine(text) {
  const all = lines(text)
  return all.length > 1 ? `${all[0]} (+${all.length - 1} more)` : all[0] || ''
}

// "5 October"
function formatLongDay(iso) {
  const d = parseIso(iso)
  return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'long' })}`
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

const control = { boxSizing: 'border-box', width: '100%', border: `1px solid ${t.border}`, borderRadius: 12, background: t.field, fontFamily: 'inherit', fontSize: 15, color: t.text }
const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32, padding: '0 12px', borderRadius: 999, fontSize: 13 }
const btn = { height: 44, padding: '0 16px', borderRadius: 10, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }

const s = {
  ...layout,
  topHeader: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  tools: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  searchWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute', left: 12, display: 'flex', color: t.muted, pointerEvents: 'none' },
  search: { boxSizing: 'border-box', width: 240, maxWidth: '100%', height: 44, border: `1px solid ${t.border}`, borderRadius: 10, background: t.white, padding: '0 12px 0 36px', fontFamily: 'inherit', fontSize: 14, color: t.text },
  filterBtn: { ...btn, padding: '0 14px', borderWidth: 1, borderStyle: 'solid', borderColor: t.border, background: t.white, color: t.secondary, gap: 6 },
  filterOn: { borderColor: t.star, background: t.warnSoft, color: t.warnInk, fontWeight: 600 },
  primaryBtn: { ...btn, padding: '0 18px', border: 0, background: t.accent, color: t.white, fontSize: 15, fontWeight: 600 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
  tiles: { display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(150px, 1fr)', gap: 12, overflowX: 'auto', padding: '2px 2px 6px' },
  tile: { textAlign: 'left', padding: 16, borderRadius: 14, borderWidth: 1, borderStyle: 'solid', borderColor: t.border, color: t.text, display: 'flex', flexDirection: 'column', gap: 10 },
  tileEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.borderDash, background: t.white },
  tileOn: { borderWidth: 2, borderStyle: 'solid', borderColor: t.accent, background: t.accentSoft },
  tileEyebrow: { fontFamily: t.fontMono, fontSize: 11, textTransform: 'uppercase', color: t.muted, whiteSpace: 'nowrap' },
  tileDate: { fontSize: 17, fontWeight: 600 },
  bars: { display: 'flex', gap: 3 },
  bar: { width: 18, height: 6, borderRadius: 3, background: t.accent },
  tileMeta: { fontSize: 13, color: t.muted },
  columns: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 },
  mainCol: { flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 },
  card: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 28, display: 'flex', flexDirection: 'column', gap: 24 },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardTitleRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  cardTitle: { margin: 0, fontFamily: t.fontDisplay, fontSize: 22, fontWeight: 600 },
  cardActions: { display: 'flex', alignItems: 'center', gap: 6 },
  outlineBtn: { ...btn, height: 40, padding: '0 14px', border: `1px solid ${t.border}`, background: t.white, color: t.text, fontWeight: 500 },
  iconBtn: { width: 40, height: 40, borderRadius: 10, border: 0, background: 'transparent', color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  flagBadge: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, borderRadius: 6, padding: '2px 8px', color: t.warnInk, background: t.warnSoft },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 140px) minmax(0, 1fr)', gap: '12px 24px' },
  rowLabel: { margin: 0, fontSize: 13, fontWeight: 600, color: t.muted, textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: 3 },
  list: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 15, lineHeight: 1.6, color: t.body },
  rowText: { margin: 0, fontSize: 15, lineHeight: 1.6, color: t.body, whiteSpace: 'pre-wrap' },
  addLink: { justifySelf: 'start', height: 36, padding: 0, border: 0, background: 'transparent', color: t.accent, fontSize: 14, fontWeight: 600 },
  goalBadge: { display: 'inline-flex', alignItems: 'center', fontSize: 12, borderRadius: 6, padding: '2px 8px', color: t.accentInk, background: t.accentSoft },
  formIntro: { display: 'flex', flexDirection: 'column', gap: 10 },
  formTitle: { margin: 0, fontFamily: t.fontDisplay, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' },
  weekPick: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  weekPickLabel: { fontSize: 14, fontWeight: 600 },
  weekInput: { height: 40, minHeight: 40 },
  hint: { fontSize: 13, color: t.muted },
  field: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 },
  pair: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 16 },
  label: { fontSize: 14, fontWeight: 600 },
  textarea: { ...control, resize: 'vertical', padding: '12px 14px', lineHeight: 1.55 },
  input: { ...control, height: 44, padding: '0 14px' },
  chipRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chipSelected: { ...chip, padding: '0 6px 0 12px', background: t.accentSoft, color: t.accentInk, fontWeight: 500 },
  chipRemove: { width: 22, height: 22, border: 0, borderRadius: '50%', background: 'transparent', color: t.accentInk, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  recentLabel: { fontSize: 12, color: t.muted, marginRight: 2 },
  chipRecent: { ...chip, padding: '0 10px', border: `1px dashed ${t.borderDash}`, background: t.white, color: t.secondary },
  fieldset: { border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  legend: { padding: 0, marginBottom: 8, fontSize: 14, fontWeight: 600 },
  goalOn: { ...chip, border: `1px solid ${t.accent}`, background: t.accentSoft, color: t.accentInk, fontWeight: 500 },
  goalOff: { ...chip, border: `1px solid ${t.border}`, background: t.white, color: t.secondary },
  moreBtn: { ...chip, border: 0, background: 'transparent', color: t.accent, fontWeight: 500 },
  saveRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 16, borderTop: `1px solid ${t.borderSoft}` },
  flagLabel: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, fontSize: 14, cursor: 'pointer' },
  flagCheck: { width: 18, height: 18, margin: 0, accentColor: t.star, flexShrink: 0 },
  saveActions: { display: 'flex', gap: 8 },
  saveBtn: { height: 48, padding: '0 22px', borderRadius: 12, border: 0, background: t.accent, color: t.white, fontSize: 16, fontWeight: 600 },
  cancelBtn: { height: 48, padding: '0 20px', borderRadius: 12, border: `1px solid ${t.border}`, background: t.white, color: t.secondary, fontSize: 15, fontWeight: 500 },
  disabled: { opacity: 0.45 },
  aside: { flex: '1 1 300px', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16 },
  sideCard: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 },
  sideTitle: { margin: 0, fontSize: 15, fontWeight: 600 },
  sideText: { margin: 0, fontSize: 14, lineHeight: 1.5, color: t.muted },
  personRow: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: 0, border: 'none', background: 'none', font: 'inherit', fontSize: 14, color: 'inherit', textAlign: 'left', cursor: 'pointer' },
  initials: { flex: '0 0 auto', width: 30, height: 30, borderRadius: '50%', background: t.accentSoft, color: t.accentInk, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 },
  results: { display: 'flex', flexDirection: 'column', gap: 12 },
  resultsHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  resultsTitle: { margin: 0, fontSize: 16, fontWeight: 600 },
  linkBtn: { height: 40, padding: 0, border: 0, background: 'transparent', color: t.accent, fontSize: 14, fontWeight: 600 },
  resultCard: { textAlign: 'left', background: t.white, border: `1px solid ${t.border}`, borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 6, color: t.text },
  resultWeek: { fontFamily: t.fontMono, fontSize: 12, textTransform: 'uppercase', color: t.muted },
  resultText: { fontSize: 15, lineHeight: 1.5, color: t.body },
  resultMeta: { fontSize: 13, color: t.muted },
}
