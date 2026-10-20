import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../lib/theme'
import { reviewCycle } from '../lib/cycles'
import { formatDayMonth } from '../lib/weeks'
import { mentionsOf, generatePeerDraft, rewritePeerDraft, getSessionDrafts, formatStamp } from '../lib/peerFeedback'
import MentionText from './MentionText'

// One colleague's feedback draft, notes and log mentions. The parent owns the draft and notes;
// give it key={colleague.id} so the inputs reset when the colleague changes.
export default function PersonPanel({ userId, colleague, colleagueNames, mentions, notes, notesError, feedback = {}, busy, onDraft, onRewrite, onNoteAdded, onNoteDeleted, onClose, panelRef, style }) {
  const [rewrite, setRewrite] = useState('')
  const [copied, setCopied] = useState(false)
  const [noteDraft, setNoteDraft] = useState(null)
  const [savingNote, setSavingNote] = useState(false)
  const [noteError, setNoteError] = useState('')
  const fb = feedback
  const first = colleague.name.split(/\s+/)[0]
  const canDraft = mentions.length > 0 || notes.length > 0

  function copyFeedback() {
    navigator.clipboard.writeText(fb.draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function submitRewrite() {
    const how = rewrite.trim()
    if (!how || busy) return
    if (await onRewrite(how)) setRewrite('')
  }

  async function saveNote() {
    const content = noteDraft?.trim()
    if (!content) return
    setSavingNote(true)
    setNoteError('')
    const { data, error: saveError } = await supabase.from('colleague_notes').insert({ user_id: userId, colleague_id: colleague.id, content }).select().single()
    setSavingNote(false)
    if (saveError) { setNoteError(`Couldn't save the note: ${saveError.message}`); return }
    onNoteAdded(data)
    setNoteDraft(null)
  }

  async function deleteNote(id) {
    const { error: deleteError } = await supabase.from('colleague_notes').delete().eq('id', id)
    if (deleteError) { setNoteError(`Couldn't delete the note: ${deleteError.message}`); return }
    onNoteDeleted(id)
  }

  return (
    <aside id="person-panel" ref={panelRef} aria-label={colleague.name} style={{ ...s.panel, ...style }}>
      <div style={s.panelHead}>
        <div style={s.panelPerson}>
          <span aria-hidden="true" style={s.panelAvatar}>{initials(colleague.name)}</span>
          <div style={s.personText}>
            <h2 style={s.panelName}>{colleague.name}</h2>
            <span style={s.personMeta}>
              {mentions.length ? `In ${mentions.length} weekly ${mentions.length === 1 ? 'log' : 'logs'} · most recent ${formatDayMonth(mentions[0].week_of)}` : 'Not in your logs for this period'}
            </span>
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel" style={s.closeBtn}>
          <Icon size={16} strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
        </button>
      </div>

      <div style={s.darkCard}>
        <div style={s.darkRow}><span style={{ color: t.onDarkMuted }}>Log mentions</span><span style={{ fontWeight: 600 }}>{mentions.length}</span></div>
        <div style={s.darkRow}>
          <span style={{ color: t.onDarkMuted }}>Feedback</span>
          <span style={{ fontWeight: 600, color: fb.draft ? t.bright : t.white }}>{fb.generating ? 'Drafting…' : fb.draft ? 'Drafted' : fb.needsInfo ? 'Needs more info' : 'Not started'}</span>
        </div>
        {fb.generating
          ? <button type="button" disabled aria-live="polite" style={s.darkBusy}>Drafting…</button>
          : !fb.draft && (canDraft
            ? <button type="button" onClick={onDraft} disabled={busy} style={{ ...s.brightBtn, ...(busy ? s.disabled : {}) }}>Draft feedback for {first}</button>
            : <button type="button" disabled style={s.darkGhost}>Add a note to draft</button>)}
      </div>

      {fb.error && <p role="alert" style={s.error}>{fb.error}</p>}

      {fb.draft && (
        <section aria-labelledby="dh" style={s.panelSection}>
          <h3 id="dh" style={s.panelH3}>Draft feedback</h3>
          <p style={s.draftText}>{fb.draft}</p>
          <div style={s.panelActions}>
            <button type="button" onClick={copyFeedback} style={s.smallBtn}>
              {copied
                ? <Icon size={15} strokeWidth={2} d="M5 12.5l4.5 4.5L19 7.5" />
                : <Icon size={15}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Icon>}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={onDraft} disabled={busy} style={{ ...s.smallBtn, ...(busy ? s.disabled : {}) }}>
              <Icon size={15}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 5v6h-6" /></Icon>Regenerate
            </button>
          </div>
          <div style={s.rewriteRow}>
            <label htmlFor="prw" style={s.srOnly}>Rewrite instructions for {first}'s feedback</label>
            <input id="prw" type="text" value={rewrite} onChange={e => setRewrite(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitRewrite()}
              placeholder="Rewrite… e.g. warmer, add a growth area" style={s.rewriteInput} />
            <button type="button" onClick={submitRewrite} disabled={busy || !rewrite.trim()}
              style={{ ...s.rewriteBtn, ...(busy || !rewrite.trim() ? s.disabled : {}) }}>Rewrite</button>
          </div>
        </section>
      )}

      <section aria-labelledby="notes-h" style={s.panelSection}>
        <h3 id="notes-h" style={s.panelH3}>Additional notes</h3>
        {notes.map(n => (
          <article key={n.id} style={s.note}>
            <div style={s.noteBody}>
              <p style={s.noteText}>{n.content}</p>
              <span style={s.noteMeta}>Added {formatStamp(n.created_at)}</span>
            </div>
            <button type="button" className="icon-btn" onClick={() => deleteNote(n.id)} aria-label={`Delete note added ${formatStamp(n.created_at)}`} title="Delete" style={s.noteDelete}>
              <Icon size={15} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </button>
          </article>
        ))}
        {noteDraft === null ? (
          <button type="button" onClick={() => { setNoteDraft(''); setNoteError('') }} style={s.addLink}>+ Add a note</button>
        ) : (
          <div style={s.noteForm}>
            <label htmlFor="pnote" style={s.srOnly}>New note about {first}</label>
            <textarea id="pnote" rows={3} autoFocus value={noteDraft} onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.stopPropagation(); setNoteDraft(null) }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote()
              }}
              placeholder="Context beyond your logs…" style={s.notes} />
            <div style={s.noteActions}>
              <button type="button" onClick={saveNote} disabled={savingNote || !noteDraft.trim()} aria-label="Save note" title="Save note"
                style={{ ...s.saveIconBtn, ...(savingNote || !noteDraft.trim() ? s.disabled : {}) }}>
                <Icon size={17}><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M8 4v5h7V4" /><path d="M8 20v-6h8v6" /></Icon>
              </button>
              <button type="button" className="icon-btn" onClick={() => setNoteDraft(null)} aria-label="Cancel note" title="Cancel" style={s.noteDelete}>
                <Icon size={15} strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
              </button>
            </div>
          </div>
        )}
        {(noteError || notesError) && <p role="alert" style={s.error}>{noteError || notesError}</p>}
      </section>

      <section style={s.panelSection}>
        <h3 style={s.monoHeading}>From your weekly logs</h3>
        {mentions.length > 0 ? (
          <div style={s.timeline}>
            {mentions.map(e => (
              <article key={e.id} style={s.timelineItem}>
                <span aria-hidden="true" style={s.timelineDot} />
                <span style={s.timelineWeek}>Week of {formatDayMonth(e.week_of)}</span>
                <p style={s.timelineText}><MentionText text={e.work} names={colleagueNames} /></p>
              </article>
            ))}
          </div>
        ) : (
          <p style={s.noMentions}>No entries in this period mention {first}. Add a note above so their draft has something to go on.</p>
        )}
      </section>
    </aside>
  )
}

// The panel as a drawer over the current page, for a colleague named in the Weekly Log.
// Loads its own data for the review period that Peer feedback opens on.
export function PersonDrawer({ userId, name, onClose }) {
  const [period] = useState(reviewCycle)
  const [colleagues, setColleagues] = useState(null)
  const [entries, setEntries] = useState([])
  const [notes, setNotes] = useState([])
  const [notesError, setNotesError] = useState('')
  const [feedback, setFeedback] = useState({})
  // True while the drawer slides out; onClose runs when that animation ends
  const [closing, setClosing] = useState(false)
  const closeRef = useRef(null)
  const colleague = colleagues?.find(c => c.name.toLowerCase() === name.toLowerCase()) || null

  useEffect(() => {
    let live = true
    Promise.all([
      supabase.from('colleagues').select('*').eq('user_id', userId).order('name'),
      supabase.from('entries').select('*').eq('user_id', userId).gte('week_of', period.start).lte('week_of', period.end),
      supabase.from('colleague_notes').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ]).then(([c, e, n]) => {
      if (!live) return
      const found = (c.data || []).find(x => x.name.toLowerCase() === name.toLowerCase())
      setColleagues(c.data || [])
      setEntries([...(e.data || [])].sort((a, b) => b.week_of.localeCompare(a.week_of)))
      if (n.error) setNotesError(`Couldn't load notes: ${n.error.message}`)
      else setNotes((n.data || []).filter(x => x.colleague_id === found?.id))
      const draft = found && getSessionDrafts(userId)[found.id]
      if (draft) setFeedback({ draft })
    })
    return () => { live = false }
  }, [userId, name, period])

  // Escape closes; focus starts on the close button and returns to the name afterwards
  function close() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose()
    else setClosing(true)
  }
  const closeFnRef = useRef(close)
  useEffect(() => { closeFnRef.current = close })
  useEffect(() => {
    const back = document.activeElement
    const onKey = e => e.key === 'Escape' && closeFnRef.current()
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); back?.focus?.() }
  }, [])
  useEffect(() => { if (colleague) closeRef.current?.querySelector('button[aria-label="Close panel"]')?.focus() }, [colleague])

  async function draft() {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setFeedback(f => ({ ...f, error: 'Add your Claude API key in Settings first.' })); return }
    setFeedback(f => ({ ...f, generating: true, error: '', needsInfo: false }))
    try {
      const result = await generatePeerDraft({ apiKey, userId, colleague, entries, notes, period })
      setFeedback(f => ({ ...f, generating: false, draft: result.draft || '', needsInfo: !!result.needsInfo, error: result.error || '' }))
    } catch (err) {
      setFeedback(f => ({ ...f, generating: false, error: `Couldn't draft feedback: ${err.message}` }))
    }
  }

  async function rewrite(how) {
    const apiKey = localStorage.getItem('claude_api_key')
    if (!apiKey) { setFeedback(f => ({ ...f, error: 'Add your Claude API key in Settings first.' })); return false }
    setFeedback(f => ({ ...f, generating: true, error: '' }))
    try {
      const next = await rewritePeerDraft({ apiKey, userId, colleague, entries, notes, current: feedback.draft, how })
      setFeedback(f => ({ ...f, generating: false, draft: next }))
      return true
    } catch (err) {
      setFeedback(f => ({ ...f, generating: false, error: `Couldn't rewrite feedback: ${err.message}` }))
      return false
    }
  }

  return (
    <div style={s.overlay}>
      <div aria-hidden="true" className={`drawer-backdrop${closing ? ' closing' : ''}`} onClick={close} style={s.backdrop} />
      <div ref={closeRef} className={`drawer${closing ? ' closing' : ''}`} onAnimationEnd={e => closing && e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={name} style={s.drawer}>
        {colleague ? (
          <PersonPanel userId={userId} colleague={colleague} colleagueNames={colleagues.map(c => c.name)}
            mentions={mentionsOf(entries, colleague)} notes={notes} notesError={notesError}
            feedback={feedback} busy={!!feedback.generating} onDraft={draft} onRewrite={rewrite}
            onNoteAdded={n => setNotes(list => [n, ...list])} onNoteDeleted={id => setNotes(list => list.filter(n => n.id !== id))}
            onClose={close} style={s.drawerPanel} />
        ) : (
          <div style={{ ...s.panel, ...s.drawerPanel }}>
            <div style={s.panelHead}>
              <h2 style={s.panelName}>{name}</h2>
              <button type="button" className="icon-btn" onClick={close} aria-label="Close panel" style={s.closeBtn}>
                <Icon size={16} strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
              </button>
            </div>
            <p style={s.personMeta}>{colleagues ? `${name} isn't in your colleagues list yet. Save the entry that tags them, then try again.` : 'Loading…'}</p>
          </div>
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

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

const small = { height: 40, padding: '0 14px', borderRadius: 10, fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }

const s = {
  overlay: { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', inset: 0, background: 'rgba(28, 27, 34, 0.32)' },
  drawer: { position: 'relative', width: 'min(570px, 100vw)', height: '100%', overflowY: 'auto', boxShadow: '-8px 0 32px rgba(28, 27, 34, 0.16)' },
  drawerPanel: { minHeight: '100%', borderLeft: 0 },
  disabled: { opacity: 0.5 },
  error: { margin: 0, fontSize: 14, color: t.danger },
  personText: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  personMeta: { margin: 0, fontSize: 13, color: t.muted },
  panel: { flex: '1 1 570px', maxWidth: '100%', boxSizing: 'border-box', background: t.white, borderLeft: `1px solid ${t.border}`, padding: '28px 28px 48px', display: 'flex', flexDirection: 'column', gap: 24, fontFamily: t.fontSans, color: t.text },
  panelHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  panelPerson: { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 },
  panelAvatar: { flex: '0 0 auto', width: 56, height: 56, borderRadius: '50%', background: t.accent, color: t.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 600 },
  panelName: { margin: 0, fontFamily: t.fontDisplay, fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2 },
  closeBtn: { flex: '0 0 auto', width: 40, height: 40, borderRadius: 10, border: `1px solid ${t.border}`, background: t.white, color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  darkCard: { background: t.dark, color: t.white, borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  darkRow: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 },
  brightBtn: { height: 44, borderRadius: 10, border: 0, background: t.bright, color: t.dark, fontSize: 15, fontWeight: 600 },
  darkBusy: { height: 44, borderRadius: 10, border: 0, background: t.darkActive, color: t.bright, fontSize: 15, fontWeight: 600 },
  darkGhost: { height: 44, borderRadius: 10, border: `1px solid ${t.darkBorder}`, background: 'transparent', color: t.onDarkMuted, fontSize: 14, fontWeight: 600 },
  panelSection: { display: 'flex', flexDirection: 'column', gap: 10 },
  panelH3: { margin: 0, fontSize: 16, fontWeight: 600 },
  draftText: { margin: 0, padding: '14px 16px', borderRadius: 12, border: `1px solid ${t.border}`, fontSize: 15, lineHeight: 1.65, color: t.body, whiteSpace: 'pre-wrap' },
  panelActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  smallBtn: { ...small, border: `1px solid ${t.border}`, background: t.white, color: t.text },
  rewriteRow: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, borderRadius: 12, background: t.canvas },
  rewriteInput: { flex: '1 1 180px', boxSizing: 'border-box', height: 40, border: `1px solid ${t.border}`, borderRadius: 10, background: t.white, padding: '0 12px', fontFamily: 'inherit', fontSize: 14, color: t.text },
  rewriteBtn: { ...small, border: 0, background: t.accent, color: t.white, fontWeight: 600 },
  monoHeading: { margin: '0 0 4px', fontFamily: t.fontMono, fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.muted },
  timeline: { display: 'flex', flexDirection: 'column', borderLeft: `2px solid ${t.border}`, marginLeft: 6 },
  timelineItem: { position: 'relative', padding: '0 0 22px 20px', display: 'flex', flexDirection: 'column', gap: 6 },
  timelineDot: { position: 'absolute', left: -7, top: 3, width: 12, height: 12, borderRadius: '50%', background: t.accent },
  timelineWeek: { fontFamily: t.fontMono, fontSize: 12, textTransform: 'uppercase', color: t.accent },
  timelineText: { margin: 0, fontSize: 15, lineHeight: 1.6, color: t.body, whiteSpace: 'pre-wrap' },
  noMentions: { margin: 0, padding: 16, borderRadius: 12, border: `1.5px dashed ${t.borderDash}`, fontSize: 14, lineHeight: 1.5, color: t.muted },
  addLink: { alignSelf: 'flex-start', height: 36, padding: 0, border: 0, background: 'transparent', color: t.accent, fontSize: 14, fontWeight: 600 },
  note: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 8px 12px 14px', borderRadius: 12, border: `1px solid ${t.border}` },
  noteBody: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  noteText: { margin: 0, fontSize: 15, lineHeight: 1.55, color: t.body, whiteSpace: 'pre-wrap' },
  noteMeta: { fontSize: 12, color: t.muted },
  noteDelete: { flex: '0 0 auto', width: 36, height: 36, borderRadius: 8, border: 0, background: 'transparent', color: t.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  noteForm: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  noteActions: { display: 'flex', flexDirection: 'column', gap: 4 },
  saveIconBtn: { width: 40, height: 40, borderRadius: 10, border: 0, background: t.accent, color: t.white, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  notes: { boxSizing: 'border-box', width: '100%', resize: 'vertical', border: `1px solid ${t.border}`, borderRadius: 10, background: t.field, padding: '10px 12px', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, color: t.text },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
}
