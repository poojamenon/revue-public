export const t = {
  // Charcoal crayon palette
  white:       '#FFFFFF',
  canvas:      '#F7F5F0',
  field:       '#FAF8F4',
  border:      '#E7E2D8',
  borderStrong:'#D6CFC2',
  borderSoft:  '#F0ECE4',
  borderDash:  '#B5AE9F',
  text:        '#1C1B22',
  body:        '#2B2A31',
  secondary:   '#45434C',
  muted:       '#57555E',
  faint:       '#8F8C95',
  avatar:      '#EFEBE4',
  accent:      '#A8463F',
  accentSoft:  '#F3E3E1',
  accentStrong:'#E2B8B3',
  accentInk:   '#7A2E29',
  warnSoft:    '#FDF4E7',
  warnInk:     '#7A3E00',
  star:        '#8A5300',
  warning:     '#A85F00',
  danger:      '#B42318',

  // Dark surfaces: the nav rail and the dark callout panels
  dark:        '#24232B',
  darkSoft:    '#2F2E37',
  darkBorder:  '#45434E',
  darkActive:  '#3A3844',
  darkSel:     '#3A352A',
  onDark:      '#E4E2E8',
  onDarkMuted: '#B3B1BC',
  bright:      '#D9B44A',

  // Soft tile backgrounds, used in rotation
  tints:       ['#F5F0E1', '#E6EFEA', '#E7ECF3'],

  // Typography
  fontDisplay: '"Baloo 2", "Instrument Sans", ui-sans-serif, system-ui, sans-serif',
  fontSans:    '"Instrument Sans", ui-sans-serif, system-ui, sans-serif',
  fontMono:    '"Geist Mono", ui-monospace, monospace',
}

// Shared page frame
export const layout = {
  page: { boxSizing: 'border-box', padding: '36px clamp(16px, 4vw, 56px) 72px', fontFamily: t.fontSans, color: t.text },
  inner: { display: 'flex', flexDirection: 'column', gap: 28 },
  header: { display: 'flex', flexDirection: 'column', gap: 4 },
  eyebrow: { fontFamily: t.fontMono, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.muted },
  h1: { margin: 0, fontFamily: t.fontDisplay, fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2 },
}
