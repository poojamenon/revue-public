import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../lib/theme'

// Decorative: how the week tiles on the Weekly Log look
const WEEKS = [
  { label: 'WK 38', fill: '30%' },
  { label: 'WK 39', fill: '30%' },
  { label: 'WK 40', fill: '100%' },
  { label: 'WK 41', fill: '55%', selected: true },
  { label: 'NOW', fill: '30%', now: true },
]

const FEATURES = [
  'Weekly logs with the people you worked with',
  'Self-reflection and peer feedback drafts',
  "Goals shaped by your manager's feedback",
]

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // App listens for the auth change and swaps this screen out on success
  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSigningIn(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setSigningIn(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message)
  }

  return (
    <div style={s.page}>
      <section aria-label="About Revue" className="login-panel" style={s.panel}>
        <div style={s.brand}>
          <div aria-hidden="true" style={s.mark}>R</div>
          <span style={s.brandName}>Revue</span>
        </div>

        <div style={s.pitch}>
          <span style={s.eyebrow}>One week at a time</span>
          <h1 style={s.h1}>Log a little every week. Walk into review season ready.</h1>

          <div aria-hidden="true" style={s.weeks}>
            {WEEKS.map(w => (
              <div key={w.label} style={{ ...s.week, ...(w.selected ? s.weekSelected : {}), ...(w.now ? s.weekNow : {}) }}>
                <span style={{ ...s.weekLabel, ...(w.selected ? { color: t.bright } : {}) }}>{w.label}</span>
                <span style={{ ...s.weekBar, width: w.fill, background: w.now ? t.darkBorder : t.bright }} />
              </div>
            ))}
          </div>

          <ul style={s.features}>
            {FEATURES.map((f, i) => (
              <li key={f} style={s.feature}><span style={s.featureNum}>{String(i + 1).padStart(2, '0')}</span>{f}</li>
            ))}
          </ul>
        </div>
        <span />
      </section>

      <main style={s.main}>
        <div style={s.formWrap}>
          <div style={s.heading}>
            <h2 style={s.h2}>Sign in</h2>
            <p style={s.lede}>Welcome back. Pick up where you left off.</p>
          </div>

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label htmlFor="email" style={s.label}>Email</label>
              <input id="email" type="email" placeholder="you@company.com" value={email} autoComplete="username"
                onChange={e => setEmail(e.target.value)} required style={s.input} />
            </div>
            <div style={s.field}>
              <label htmlFor="password" style={s.label}>Password</label>
              <div style={s.pwRow}>
                <input id="password" type={showPassword ? 'text' : 'password'} placeholder="Your password" value={password} autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)} required style={{ ...s.input, flex: '1 1 auto', minWidth: 0 }}
                  aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
                <button type="button" className="icon-btn" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} style={s.eyeBtn}>
                  {showPassword
                    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>}
                </button>
              </div>
            </div>
            {error && <p id="login-error" role="alert" style={s.error}>{error}</p>}
            <button type="submit" disabled={signingIn} style={{ ...s.submit, ...(signingIn ? s.disabled : {}) }}>
              {signingIn ? 'Signing in…' : 'Sign in'}
              {!signingIn && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              )}
            </button>
          </form>

          <p style={s.note}>Accounts are added by whoever set up this copy of Revue. Ask them if you need one or forgot your password.</p>
        </div>
      </main>
    </div>
  )
}

const s = {
  page: { fontFamily: t.fontSans, color: t.text, background: t.canvas, minHeight: '100vh', display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' },
  panel: { flex: '1 1 440px', boxSizing: 'border-box', background: t.dark, color: t.white, padding: 'clamp(32px, 5vw, 64px)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 48 },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  mark: { width: 36, height: 36, borderRadius: 10, background: t.bright, color: t.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  brandName: { fontWeight: 600, fontSize: 18 },
  pitch: { display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 560 },
  eyebrow: { fontFamily: t.fontMono, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.bright },
  h1: { margin: '-16px 0 0', fontFamily: t.fontDisplay, fontSize: 'clamp(34px, 3.6vw, 50px)', fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.03em' },
  weeks: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 },
  week: { padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', borderColor: t.darkBorder, background: t.darkSoft, display: 'flex', flexDirection: 'column', gap: 8 },
  weekSelected: { borderWidth: 1.5, borderColor: t.bright, background: t.darkSel },
  weekNow: { borderWidth: 1.5, borderStyle: 'dashed', background: 'transparent' },
  weekLabel: { fontFamily: t.fontMono, fontSize: 10, color: t.onDarkMuted },
  weekBar: { height: 6, borderRadius: 3 },
  features: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 15, color: t.onDark },
  feature: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  featureNum: { fontFamily: t.fontMono, fontSize: 12, color: t.bright, paddingTop: 3 },
  main: { flex: '1 1 480px', boxSizing: 'border-box', padding: 'clamp(32px, 6vw, 80px) clamp(16px, 5vw, 64px)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  formWrap: { width: '100%', maxWidth: 400, boxSizing: 'border-box', background: t.white, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32, display: 'flex', flexDirection: 'column', gap: 22 },
  heading: { display: 'flex', flexDirection: 'column', gap: 6 },
  h2: { margin: 0, fontFamily: t.fontDisplay, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' },
  lede: { margin: 0, fontSize: 15, color: t.muted },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 14, fontWeight: 600 },
  input: { boxSizing: 'border-box', width: '100%', height: 48, border: `1px solid ${t.borderStrong}`, borderRadius: 12, background: t.field, padding: '0 14px', fontFamily: 'inherit', fontSize: 15, color: t.text },
  pwRow: { display: 'flex', gap: 8 },
  eyeBtn: { flex: '0 0 auto', width: 48, height: 48, borderRadius: 12, border: `1px solid ${t.borderStrong}`, background: t.white, color: t.secondary, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  error: { margin: 0, fontSize: 14, color: t.danger },
  submit: { height: 48, borderRadius: 12, border: 0, background: t.accent, color: t.white, fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 },
  disabled: { opacity: 0.6, cursor: 'default' },
  note: { margin: 0, fontSize: 13, lineHeight: 1.55, color: t.muted },
}
