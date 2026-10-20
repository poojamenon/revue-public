import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callClaude } from '../lib/claude'
import { GOALS_SYSTEM, GOALS_PROMPT } from '../lib/prompts'
import { t, layout } from '../lib/theme'
import { currentCycle, formatCycle } from '../lib/cycles'
import { recentWeeks, mondayOf, weekNumber } from '../lib/weeks'

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'achieved', label: 'Achieved' },
  { key: 'carried_over', label: 'Carried over' },
]

export default function Goals({ userId, initialFeedbackId }) {
  const [goals, setGoals] = useState([])
  const [feedbackList, setFeedbackList] = useState([])
  const [selectedFeedbackId, setSelectedFeedbackId] = useState(initialFeedbackId || '')
  const [generating, setGenerating] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [error, setError] = useState('')
  const [newGoal, setNewGoal] = useState({ title: '', description: '' })
  const [adding, setAdding] = useState(false)
  const [tab, setTab] = useState('active')
  // Which of the recent weeks each goal was logged against: { goalId: Set of Mondays }
  const [loggedWeeks, setLoggedWeeks] = useState({})

  useEffect(() => { fetchAll() }, [userId])

  async function fetchAll() {
    const [{ data: g }, { data: f }, { data: e }] = await Promise.all([
      supabase.from('goals').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('manager_feedback').select('id, period_start, period_end').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('entries').select('week_of, goal_ids').eq('user_id', userId).gte('week_of', RECENT[0]),
    ])
    setGoals(g || [])
    setFeedbackList(f || [])
    const logged = {}
    for (const entry of e || []) {
      for (const id of entry.goal_ids || []) (logged[id] ||= new Set()).add(mondayOf(entry.week_of))
    }
    setLoggedWeeks(logged)
    if (f?.length && !selectedFeedbackId) setSelectedFeedbackId(f[0].id)
  }

  // Ask Claude for goals, then hold them for review instead of adding them straight away
  async function generateGoals() {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setError('Add your Claude API key in Settings first.'); return }
    if (!selectedFeedbackId) { setError('Select a review period first.'); return }
    setGenerating(true); setError('')
    try {
      const { data: fb } = await supabase.from('manager_feedback').select('content').eq('id', selectedFeedbackId).single()
      const raw = await callClaude(apiKey, GOALS_SYSTEM, GOALS_PROMPT(fb.content))
      const parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || raw)
      setSuggestions({ feedbackId: selectedFeedbackId, items: parsed.map((g, i) => ({ id: i, title: g.title, description: g.description, keep: true })) })
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  async function addSuggestions() {
    const keep = suggestions.items.filter(g => g.keep)
    for (const g of keep) {
      await supabase.from('goals').insert({ user_id: userId, source_feedback_id: suggestions.feedbackId, title: g.title, description: g.description, status: 'active' })
    }
    setSuggestions(null)
    setTab('active')
    fetchAll()
  }

  async function updateStatus(id, status) {
    await supabase.from('goals').update({ status }).eq('id', id)
    fetchAll()
  }

  async function deleteGoal(id) {
    if (!confirm('Delete this goal?')) return
    await supabase.from('goals').delete().eq('id', id)
    fetchAll()
  }

  async function addGoal() {
    if (!newGoal.title.trim()) return
    await supabase.from('goals').insert({ user_id: userId, ...newGoal, status: 'active' })
    setNewGoal({ title: '', description: '' })
    setAdding(false)
    setTab('active')
    fetchAll()
  }

  async function updateGoal(id, field, value) {
    await supabase.from('goals').update({ [field]: value }).eq('id', id)
    setGoals(gs => gs.map(g => g.id === id ? { ...g, [field]: value } : g))
  }

  const counts = Object.fromEntries(TABS.map(tb => [tb.key, goals.filter(g => g.status === tb.key).length]))
  const shown = goals.filter(g => g.status === tab)
  const keptCount = suggestions?.items.filter(g => g.keep).length || 0

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <header style={s.topHeader}>
          <div style={s.header}>
            <span style={s.eyebrow}>Review period · {formatCycle(currentCycle())}</span>
            <h1 style={s.h1}>Goals</h1>
          </div>
          <button type="button" onClick={() => { setAdding(true); setTab('active') }} style={s.primaryBtn}>
            <Icon size={16} strokeWidth={2} d="M12 5v14M5 12h14" />Add goal
          </button>
        </header>

        {feedbackList.length > 0 && (
          <section aria-labelledby="gen-h" style={s.suggest}>
            <div style={s.suggestText}>
              <span style={s.darkEyebrow}>From manager feedback</span>
              <h2 id="gen-h" style={s.suggestTitle}>Suggest goals you can review before adding</h2>
            </div>
            <div style={s.suggestControls}>
              <label htmlFor="fb-sel" style={s.srOnly}>Review period of the feedback</label>
              <select id="fb-sel" value={selectedFeedbackId} onChange={e => setSelectedFeedbackId(e.target.value)} style={s.select}>
                {feedbackList.map(f => <option key={f.id} value={f.id}>{formatRange(f.period_start, f.period_end)}</option>)}
              </select>
              <button type="button" onClick={generateGoals} disabled={generating} style={{ ...s.brightBtn, ...(generating ? s.disabled : {}) }}>
                {generating ? 'Suggesting…' : 'Suggest goals'}
              </button>
            </div>
            {error && <p role="alert" style={{ ...s.error, color: '#F2B8B0' }}>{error}</p>}
          </section>
        )}

        {suggestions && (
          <section aria-labelledby="sugg-h" style={s.review}>
            <div style={s.reviewHead}>
              <div style={s.suggestText}>
                <h2 id="sugg-h" style={s.reviewTitle}>{suggestions.items.length} suggested goals</h2>
                <p style={s.reviewSub}>Untick any you don't want, then add the rest.</p>
              </div>
              <div style={s.reviewActions}>
                <button type="button" onClick={() => setSuggestions(null)} style={s.outlineBtn}>Discard all</button>
                <button type="button" onClick={addSuggestions} disabled={!keptCount} style={{ ...s.primaryBtn, ...(keptCount ? {} : s.disabled) }}>
                  Add {keptCount} {keptCount === 1 ? 'goal' : 'goals'}
                </button>
              </div>
            </div>
            <div style={s.reviewList}>
              {suggestions.items.map(g => (
                <label key={g.id} style={{ ...s.reviewItem, ...(g.keep ? {} : s.reviewItemOff) }}>
                  <input type="checkbox" checked={g.keep}
                    onChange={e => setSuggestions(sg => ({ ...sg, items: sg.items.map(x => x.id === g.id ? { ...x, keep: e.target.checked } : x) }))}
                    style={s.checkbox} />
                  <span style={s.reviewItemText}>
                    <span style={s.reviewItemTitle}>{g.title}</span>
                    {g.description && <span style={s.reviewItemDesc}>{g.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        <div role="tablist" aria-label="Goal status" style={s.tabs}>
          {TABS.map(tb => (
            <button key={tb.key} type="button" role="tab" aria-selected={tab === tb.key} onClick={() => setTab(tb.key)}
              style={{ ...s.tab, ...(tab === tb.key ? s.tabOn : {}) }}>
              {tb.label}{counts[tb.key] > 0 && <span style={s.tabCount}>{counts[tb.key]}</span>}
            </button>
          ))}
        </div>

        <div role="tabpanel" style={s.grid}>
          {adding && tab === 'active' && (
            <article style={s.card}>
              <label htmlFor="new-title" style={s.fieldLabel}>Goal</label>
              <input id="new-title" autoFocus placeholder="e.g. Lead research for the alerts redesign" value={newGoal.title}
                onChange={e => setNewGoal(g => ({ ...g, title: e.target.value }))} style={s.input} />
              <label htmlFor="new-desc" style={s.fieldLabel}>Description (optional)</label>
              <textarea id="new-desc" rows={3} placeholder="What does success look like? Drafts reference this." value={newGoal.description}
                onChange={e => setNewGoal(g => ({ ...g, description: e.target.value }))} style={s.textarea} />
              <div style={s.cardActions}>
                <button type="button" onClick={addGoal} disabled={!newGoal.title.trim()} style={{ ...s.primarySmall, ...(newGoal.title.trim() ? {} : s.disabled) }}>Add goal</button>
                <button type="button" onClick={() => { setAdding(false); setNewGoal({ title: '', description: '' }) }} style={s.outlineSmall}>Cancel</button>
              </div>
            </article>
          )}
          {shown.map((goal, i) => <GoalCard key={goal.id} goal={goal} tint={t.tints[i % t.tints.length]} logged={loggedWeeks[goal.id]} onStatusChange={updateStatus} onDelete={deleteGoal} onUpdate={updateGoal} />)}
        </div>
        {shown.length === 0 && !(adding && tab === 'active') && (
          <p style={s.empty}>
            {tab === 'active' ? 'No active goals yet. Suggest some from manager feedback or add your own.' : tab === 'achieved' ? 'No achieved goals yet.' : 'No carried-over goals.'}
          </p>
        )}
      </div>
    </div>
  )
}

function GoalCard({ goal, tint, logged, onStatusChange, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(goal.title)
  const [desc, setDesc] = useState(goal.description || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = e => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    const esc = e => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menuOpen])

  async function save() {
    await onUpdate(goal.id, 'title', title)
    await onUpdate(goal.id, 'description', desc)
    setEditing(false)
  }

  function startEdit() {
    setTitle(goal.title)
    setDesc(goal.description || '')
    setEditing(true)
    setMenuOpen(false)
  }

  if (editing) {
    return (
      <article style={s.card}>
        <label htmlFor={`t-${goal.id}`} style={s.fieldLabel}>Goal</label>
        <input id={`t-${goal.id}`} value={title} onChange={e => setTitle(e.target.value)} style={s.input} />
        <label htmlFor={`d-${goal.id}`} style={s.fieldLabel}>Description</label>
        <textarea id={`d-${goal.id}`} rows={3} value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="What does success look like? Drafts reference this." style={s.textarea} />
        <div style={s.cardActions}>
          <button type="button" onClick={save} disabled={!title.trim()} style={{ ...s.primarySmall, ...(title.trim() ? {} : s.disabled) }}>Save</button>
          <button type="button" onClick={() => setEditing(false)} style={s.outlineSmall}>Cancel</button>
        </div>
      </article>
    )
  }

  return (
    <article style={s.card}>
      <div style={s.cardHead}>
        <h3 style={s.cardTitle}>{goal.title}</h3>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button type="button" className="icon-btn" aria-label={`More actions for ${goal.title}`} aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={() => setMenuOpen(o => !o)} style={s.menuBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          </button>
          {menuOpen && (
            <div role="menu" style={s.menu}>
              <button type="button" role="menuitem" className="icon-btn" onClick={startEdit} style={s.menuItem}>Edit</button>
              <button type="button" role="menuitem" className="icon-btn" onClick={() => { setMenuOpen(false); onDelete(goal.id) }} style={{ ...s.menuItem, color: t.danger }}>Delete</button>
            </div>
          )}
        </div>
      </div>
      {goal.description
        ? <p style={s.cardDesc}>{goal.description}</p>
        : (
          <button type="button" className="chip-btn" onClick={startEdit} style={s.addDesc}>
            + Add a description — drafts reference it
          </button>
        )}
      <div style={{ flexGrow: 1 }} />
      {goal.status === 'active' && <LoggedStrip logged={logged} tint={tint} />}
      <div style={s.cardFoot}>
        {goal.status === 'active' ? (
          <>
            <button type="button" onClick={() => onStatusChange(goal.id, 'achieved')} style={{ ...s.outlineSmall, color: t.accentInk, fontWeight: 600 }}>
              <Icon size={16} strokeWidth={2} d="M5 12.5l4.5 4.5L19 7.5" />Mark achieved
            </button>
            <button type="button" onClick={() => onStatusChange(goal.id, 'carried_over')} style={s.outlineSmall}>
              <Icon size={16} d="M5 12h14M13 6l6 6-6 6" />Carry over
            </button>
          </>
        ) : (
          <button type="button" onClick={() => onStatusChange(goal.id, 'active')} style={s.outlineSmall}>
            <Icon size={16}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></Icon>Reactivate
          </button>
        )}
      </div>
    </article>
  )
}

// Which of the last five weeks had an entry linked to this goal
function LoggedStrip({ logged, tint }) {
  const n = RECENT.filter(w => logged?.has(w)).length
  return (
    <div style={{ ...s.strip, background: tint }}>
      <div style={s.stripHead}>
        <span style={{ fontWeight: 600 }}>Logged against</span>
        <span style={{ color: t.muted }}>{n ? `${n} ${n === 1 ? 'week' : 'weeks'} of the last ${RECENT.length}` : 'Not tagged recently'}</span>
      </div>
      <div style={s.stripWeeks}>
        {RECENT.map(w => {
          const on = logged?.has(w)
          return (
            <div key={w} style={s.stripWeek}>
              <span aria-hidden="true" style={{ ...s.stripBar, background: on ? t.accent : t.border }} />
              <span style={s.stripLabel}>WK{weekNumber(w)}<span style={s.srOnly}>{on ? ': logged' : ': not logged'}</span></span>
            </div>
          )
        })}
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

function formatRange(start, end) {
  if (!start || !end) return 'Undated'
  const a = new Date(start + 'T00:00:00'), b = new Date(end + 'T00:00:00')
  const md = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return a.getFullYear() === b.getFullYear()
    ? `${md(a)} – ${md(b)}, ${b.getFullYear()}`
    : `${md(a)}, ${a.getFullYear()} – ${md(b)}, ${b.getFullYear()}`
}

const RECENT = recentWeeks(5)

const control = { boxSizing: 'border-box', width: '100%', border: `1px solid ${t.border}`, borderRadius: 10, background: t.field, fontFamily: 'inherit', fontSize: 14, color: t.text }
const btn = { height: 44, padding: '0 16px', borderRadius: 10, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }
const small = { height: 40, padding: '0 14px', borderRadius: 10, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }

const s = {
  ...layout,
  inner: { ...layout.inner, gap: 24 },
  topHeader: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 },
  primaryBtn: { ...btn, padding: '0 18px', fontSize: 15, border: 0, background: t.accent, color: t.white },
  brightBtn: { ...btn, border: 0, background: t.bright, color: t.dark },
  outlineBtn: { ...btn, border: `1px solid ${t.border}`, background: t.white, color: t.text, fontWeight: 500 },
  disabled: { opacity: 0.5 },
  suggest: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, background: t.dark, color: t.white, borderRadius: 18, padding: '20px 22px' },
  suggestText: { flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 4 },
  darkEyebrow: { fontFamily: t.fontMono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.bright },
  suggestTitle: { margin: 0, fontSize: 18, fontWeight: 600 },
  suggestControls: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  select: { height: 44, minWidth: 210, padding: '0 12px', borderRadius: 10, border: `1px solid ${t.darkBorder}`, background: t.darkSoft, fontFamily: 'inherit', fontSize: 14, color: t.white },
  error: { flexBasis: '100%', margin: 0, fontSize: 14, color: t.danger },
  review: { background: t.white, border: `1px solid ${t.accent}`, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 },
  reviewHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  reviewTitle: { margin: 0, fontFamily: t.fontDisplay, fontSize: 20, fontWeight: 600 },
  reviewSub: { margin: 0, fontSize: 13, color: t.muted },
  reviewActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  reviewList: { display: 'flex', flexDirection: 'column', gap: 8 },
  reviewItem: { display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 12, border: `1px solid ${t.border}`, background: t.field, cursor: 'pointer' },
  reviewItemOff: { opacity: 0.55 },
  checkbox: { width: 18, height: 18, margin: '2px 0 0', accentColor: t.accent, flexShrink: 0 },
  reviewItemText: { display: 'flex', flexDirection: 'column', gap: 4 },
  reviewItemTitle: { fontSize: 15, fontWeight: 600 },
  reviewItemDesc: { fontSize: 14, lineHeight: 1.55, color: t.secondary },
  tabs: { display: 'flex', gap: 4, borderBottom: `1px solid ${t.border}`, overflowX: 'auto' },
  tab: { height: 44, padding: '0 14px', marginBottom: -1, borderWidth: '0 0 2px', borderStyle: 'solid', borderColor: 'transparent', background: 'transparent', color: t.muted, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' },
  tabOn: { borderColor: `transparent transparent ${t.accent}`, color: t.text, fontWeight: 600 },
  tabCount: { fontFamily: t.fontMono, fontSize: 12, color: t.muted },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))', gap: 16 },
  empty: { margin: 0, fontSize: 15, color: t.muted },
  card: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 16 },
  cardHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardTitle: { margin: 0, fontFamily: t.fontDisplay, fontSize: 18, fontWeight: 600, lineHeight: 1.35 },
  menuBtn: { flex: '0 0 auto', width: 36, height: 36, borderRadius: 8, border: 0, background: 'transparent', color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  menu: { position: 'absolute', right: 0, top: 40, zIndex: 20, minWidth: 140, padding: 4, background: t.white, border: `1px solid ${t.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(17,19,23,0.12)', display: 'flex', flexDirection: 'column' },
  menuItem: { height: 40, padding: '0 12px', border: 0, borderRadius: 6, background: 'transparent', textAlign: 'left', fontSize: 14, color: t.text },
  cardDesc: { margin: 0, fontSize: 15, lineHeight: 1.6, color: t.secondary },
  addDesc: { alignSelf: 'flex-start', minHeight: 40, padding: '0 14px', borderRadius: 10, border: `1.5px dashed ${t.borderDash}`, background: 'transparent', color: t.secondary, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 },
  cardFoot: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  strip: { display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 12 },
  stripHead: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, fontSize: 13 },
  stripWeeks: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 },
  stripWeek: { display: 'flex', flexDirection: 'column', gap: 4 },
  stripBar: { height: 8, borderRadius: 4 },
  stripLabel: { fontFamily: t.fontMono, fontSize: 10, color: t.muted },
  cardActions: { display: 'flex', gap: 8 },
  primarySmall: { ...small, border: 0, background: t.accent, color: t.white, fontWeight: 600 },
  outlineSmall: { ...small, border: `1px solid ${t.border}`, background: t.white, color: t.secondary },
  fieldLabel: { fontSize: 13, fontWeight: 600, marginBottom: -6 },
  input: { ...control, height: 44, padding: '0 14px' },
  textarea: { ...control, resize: 'vertical', padding: '12px 14px', lineHeight: 1.55 },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
}
