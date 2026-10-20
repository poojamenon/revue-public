import { useState } from 'react'
import { t, layout } from '../lib/theme'

export default function Settings({ email, onLogout }) {
  const [apiKey, setApiKey] = useState(localStorage.getItem('claude_api_key') || '')
  const [hasKey, setHasKey] = useState(!!localStorage.getItem('claude_api_key'))
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  function saveApiKey() {
    const key = apiKey.trim()
    if (!key) return
    localStorage.setItem('claude_api_key', key)
    setApiKey(key)
    setHasKey(true)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function removeApiKey() {
    if (!confirm('Remove the Claude API key from this browser? Drafting will stop working until you add one again.')) return
    localStorage.removeItem('claude_api_key')
    setApiKey('')
    setHasKey(false)
    setShowKey(false)
  }

  return (
    <div style={s.page}>
      <div style={s.inner}>
        <header style={s.header}>
          <span style={s.eyebrow}>Account &amp; drafting</span>
          <h1 style={s.h1}>Settings</h1>
        </header>

        <div style={s.columns}>
          <section aria-labelledby="key-h" className="page-card" style={s.card}>
            <div style={s.cardHead}>
              <div style={s.cardHeadText}>
                <h2 id="key-h" style={s.h2}>Claude API key</h2>
                <p style={s.muted}>Powers drafts, rewrites and goal suggestions.</p>
              </div>
              {hasKey && (
                <span style={s.badge}>
                  <Icon size={14} strokeWidth={2.2} d="M5 12.5l4.5 4.5L19 7.5" />Key saved
                </span>
              )}
            </div>
            <div style={s.field}>
              <label htmlFor="api" style={s.smallLabel}>API key</label>
              <div style={s.keyRow}>
                <input id="api" type={showKey ? 'text' : 'password'} value={apiKey} autoComplete="off" spellCheck={false}
                  onChange={e => setApiKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveApiKey()}
                  placeholder="sk-ant-…" style={s.keyInput} />
                <button type="button" className="icon-btn" onClick={() => setShowKey(v => !v)} aria-label={showKey ? 'Hide API key' : 'Show API key'} aria-pressed={showKey} style={s.eyeBtn}>
                  {showKey
                    ? <Icon><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>
                    : <Icon><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>}
                </button>
              </div>
            </div>
            <div style={s.actions}>
              <button type="button" onClick={saveApiKey} disabled={!apiKey.trim()} style={{ ...s.primaryBtn, ...(apiKey.trim() ? {} : s.disabled) }}>{saved ? 'Saved!' : 'Save key'}</button>
              {hasKey && <button type="button" onClick={removeApiKey} style={s.removeBtn}>Remove key</button>}
            </div>
          </section>

          <aside style={s.aside}>
            <div style={s.darkCard}>
              <span style={s.darkEyebrow}>Where your key lives</span>
              <p style={s.darkText}>Only in this browser. It's sent to Anthropic when you draft, and never saved to the database.</p>
            </div>
            <section aria-labelledby="acct-h" style={s.account}>
              <div style={s.accountInfo}>
                <div aria-hidden="true" style={s.avatar}>{(email || '?').slice(0, 1).toUpperCase()}</div>
                <div style={{ ...s.cardHeadText, gap: 2, minWidth: 0 }}>
                  <h2 id="acct-h" style={s.accountH}>Account</h2>
                  <span style={s.email} title={email}>{email}</span>
                </div>
              </div>
              <button type="button" onClick={onLogout} style={s.outlineBtn}>
                <Icon size={16} d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />Sign out
              </button>
            </section>
          </aside>
        </div>
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

const btn = { height: 44, padding: '0 18px', borderRadius: 10, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }

const s = {
  ...layout,
  inner: { ...layout.inner, gap: 24 },
  columns: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24, maxWidth: 1100 },
  card: { flex: '999 1 460px', minWidth: 0, background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 28, display: 'flex', flexDirection: 'column', gap: 18 },
  cardHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardHeadText: { display: 'flex', flexDirection: 'column', gap: 4 },
  h2: { margin: 0, fontFamily: t.fontDisplay, fontSize: 20, fontWeight: 600 },
  muted: { margin: 0, fontSize: 14, color: t.muted },
  badge: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', borderRadius: 999, background: t.accentSoft, color: t.accentInk, fontSize: 13, fontWeight: 600 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  smallLabel: { fontSize: 13, fontWeight: 600 },
  keyRow: { display: 'flex', gap: 8 },
  keyInput: { flex: '1 1 auto', minWidth: 0, boxSizing: 'border-box', height: 44, border: `1px solid ${t.border}`, borderRadius: 10, background: t.field, padding: '0 14px', fontFamily: t.fontMono, fontSize: 14, color: t.text },
  eyeBtn: { flex: '0 0 auto', width: 44, height: 44, borderRadius: 10, border: `1px solid ${t.border}`, background: t.white, color: t.secondary, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  primaryBtn: { ...btn, border: 0, background: t.accent, color: t.white, fontWeight: 600 },
  removeBtn: { ...btn, border: `1px solid ${t.border}`, background: t.white, color: t.danger, fontWeight: 600 },
  outlineBtn: { ...btn, border: `1px solid ${t.border}`, background: t.white, color: t.text, fontWeight: 600 },
  disabled: { opacity: 0.5 },
  aside: { flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 16 },
  darkCard: { background: t.dark, color: t.white, borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 10 },
  darkEyebrow: { fontFamily: t.fontMono, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.bright },
  darkText: { margin: 0, fontSize: 15, lineHeight: 1.55, color: t.onDark },
  account: { background: t.white, border: `1px solid ${t.border}`, borderRadius: 18, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  accountInfo: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  accountH: { margin: 0, fontSize: 15, fontWeight: 600 },
  email: { fontSize: 13, color: t.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  avatar: { flexShrink: 0, width: 40, height: 40, borderRadius: '50%', background: t.accent, color: t.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600 },
}
