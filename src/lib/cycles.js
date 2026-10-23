// Review periods are fixed: April 1 – October 1 and October 1 – April 1.
// ("Cycle" means something else at work, so the UI always says "review period".)

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// The review period that today falls in
export function currentCycle(today = new Date()) {
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  if (m >= 10) return { start: iso(y, 10, 1), end: iso(y + 1, 4, 1) }
  if (m >= 4) return { start: iso(y, 4, 1), end: iso(y, 10, 1) }
  return { start: iso(y - 1, 10, 1), end: iso(y, 4, 1) }
}

// The most recent review period that has finished: the one a review is written about
export function reviewCycle(today = new Date()) {
  const { start } = currentCycle(today)
  const [y, m] = start.split('-').map(Number)
  return m === 10 ? { start: iso(y, 4, 1), end: start } : { start: iso(y - 1, 10, 1), end: start }
}

// Review periods from the current one back to the one `fromIso` falls in, newest first.
// Always includes the current and last finished periods.
export function cyclesSince(fromIso, today = new Date()) {
  const cycles = [currentCycle(today)]
  const last = () => cycles[cycles.length - 1]
  while (cycles.length < 2 || (fromIso && fromIso < last().start)) {
    cycles.push(reviewCycle(new Date(last().start + 'T00:00:00')))
  }
  return cycles
}

// "Apr 1 – Oct 1, 2026" or "Oct 1, 2026 – Apr 1, 2027"
export function formatCycle({ start, end }) {
  const a = new Date(start + 'T00:00:00'), b = new Date(end + 'T00:00:00')
  const md = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return a.getFullYear() === b.getFullYear()
    ? `${md(a)} – ${md(b)}, ${b.getFullYear()}`
    : `${md(a)}, ${a.getFullYear()} – ${md(b)}, ${b.getFullYear()}`
}
