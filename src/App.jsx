import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { clearSessionDrafts } from './lib/peerFeedback'
import { t } from './lib/theme'
import Auth from './components/Auth'
import WeeklyLog from './components/WeeklyLog'
import SelfReflection from './components/SelfReflection'
import PeerFeedback from './components/PeerFeedback'
import Goals from './components/Goals'
import ManagerFeedback from './components/ManagerFeedback'
import Managing from './components/Managing'
import Settings from './components/Settings'

const NAV = [
  { key: 'log', label: 'Weekly Log', icon: <><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" /><path d="M9 8h5M9 12h5M9 16h3" /></> },
  { key: 'reflection', label: 'Self-Reflection', icon: <><path d="M11 3l1.8 4.7 4.7 1.8-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" /><path d="M18 14l.8 2.2 2.2.8-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z" /></> },
  { key: 'peers', label: 'Peer Feedback', icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></> },
  { key: 'goals', label: 'Goals', icon: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></> },
  { key: 'feedback', label: 'Manager Feedback', icon: <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> },
]
const MANAGING = { key: 'managing', label: 'Managing', icon: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><circle cx="12" cy="10.5" r="2.5" /><path d="M8 17a4 4 0 0 1 8 0" /></> }
const SETTINGS_ICON = <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>
const GITHUB = { label: 'Revue on GitHub', href: 'https://github.com/poojamenon/revue-public', icon: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-5-2" /></> }

export default function App() {
  // undefined while the saved session is loading, null when signed out
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState('log')
  // Feedback to preselect when Manager Feedback's 'Suggest goals' opens Goals
  const [goalsFeedbackId, setGoalsFeedbackId] = useState(null)
  // Managing is hidden until it's turned on in Settings
  const [showManaging, setShowManaging] = useState(() => localStorage.getItem('show_managing_tab') === 'true')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user.id

  async function handleLogout() {
    await supabase.auth.signOut()
    clearSessionDrafts()
    setTab('log')
  }

  if (session === undefined) return null
  if (!session) return <Auth />

  const email = session.user.email || ''
  const go = key => { setTab(key); setGoalsFeedbackId(null) }

  function toggleManaging(show) {
    if (show) localStorage.setItem('show_managing_tab', 'true')
    else localStorage.removeItem('show_managing_tab')
    setShowManaging(show)
  }

  return (
    <div className="app-shell">
      <nav aria-label="Primary" className="app-rail" style={s.rail}>
        <div className="rail-logo" style={s.logo} aria-hidden="true">R</div>
        {NAV.map(n => <RailItem key={n.key} item={n} active={tab === n.key} onClick={() => go(n.key)} />)}
        {showManaging && (
          <>
            <span aria-hidden="true" className="rail-divider" style={s.divider} />
            <RailItem item={MANAGING} active={tab === 'managing'} onClick={() => go('managing')} />
          </>
        )}
        <div style={{ flexGrow: 1 }} />
        <RailItem item={GITHUB} />
        <RailItem item={{ label: 'Settings', icon: SETTINGS_ICON }} active={tab === 'settings'} onClick={() => go('settings')} />
      </nav>

      <main className="app-main">
        {tab === 'log'        && <WeeklyLog userId={userId} />}
        {tab === 'reflection' && <SelfReflection userId={userId} />}
        {tab === 'peers'      && <PeerFeedback userId={userId} />}
        {tab === 'goals'      && <Goals key={goalsFeedbackId || 'goals'} userId={userId} initialFeedbackId={goalsFeedbackId} />}
        {tab === 'feedback'   && <ManagerFeedback userId={userId} onSuggestGoals={id => { setGoalsFeedbackId(id); setTab('goals') }} />}
        {tab === 'managing'   && showManaging && <Managing userId={userId} />}
        {tab === 'settings'   && <Settings email={email} onLogout={handleLogout} showManaging={showManaging} onShowManagingChange={toggleManaging} />}
      </main>
    </div>
  )
}

// A tab button, or a link that opens in a new tab when the item has an href
function RailItem({ item, active, onClick }) {
  const icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{item.icon}</svg>
  if (item.href) {
    return <a href={item.href} target="_blank" rel="noreferrer" className="rail-item" aria-label={`${item.label} (opens in a new tab)`} title={item.label} style={s.railItem}>{icon}</a>
  }
  return (
    <button type="button" className="rail-item" aria-label={item.label} title={item.label} aria-current={active ? 'page' : undefined} onClick={onClick}
      style={{ ...s.railItem, ...(active ? s.railItemActive : {}) }}>
      {icon}
    </button>
  )
}

const s = {
  rail: { boxSizing: 'border-box', background: t.dark, padding: '20px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  logo: { flex: '0 0 auto', width: 36, height: 36, borderRadius: 10, background: t.bright, color: t.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: t.fontSans, marginBottom: 16 },
  railItem: { flex: '0 0 auto', width: 44, height: 44, borderRadius: 12, border: 0, background: 'transparent', color: t.onDarkMuted, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 },
  divider: { flex: '0 0 auto', width: 28, height: 1, background: t.darkBorder, margin: '4px 0' },
  railItemActive: { background: t.darkActive, color: t.bright },
}
