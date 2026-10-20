// Weeks run Monday to Sunday and are keyed by their Monday as YYYY-MM-DD (local time)

const pad = n => String(n).padStart(2, '0')
export const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseIso = iso => new Date(iso + 'T00:00:00')

export function mondayOf(date = new Date()) {
  const d = typeof date === 'string' ? parseIso(date) : new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toIso(d)
}

export function addWeeks(iso, n) {
  const d = parseIso(iso)
  d.setDate(d.getDate() + n * 7)
  return toIso(d)
}

// ISO 8601 week number
export function weekNumber(iso) {
  const d = parseIso(iso)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const jan4 = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}

// Mondays from `from` up to and including `to`, oldest first
export function weeksBetween(from, to) {
  const out = []
  for (let w = mondayOf(from); w <= to; w = addWeeks(w, 1)) out.push(w)
  return out
}

// The last n weeks, ending with this one
export function recentWeeks(n, today = new Date()) {
  const end = mondayOf(today)
  return Array.from({ length: n }, (_, i) => addWeeks(end, i - n + 1))
}

// "5 Oct"
export function formatDayMonth(iso) {
  const d = parseIso(iso)
  return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`
}
