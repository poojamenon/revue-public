import { supabase } from './supabase'

const key = name => name.trim().replace(/\s+/g, ' ').toLowerCase()

// Map names to the casing of an already-known colleague and drop
// case-insensitive repeats, keeping first-seen order.
export function canonicalizeNames(names, knownNames = []) {
  const known = new Map(knownNames.map(n => [key(n), n]))
  const seen = new Map()
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (!name) continue
    const k = key(name)
    if (!seen.has(k)) seen.set(k, known.get(k) || name)
  }
  return [...seen.values()]
}

// Find @mentions in text. A two-word mention only counts when it matches a
// known colleague ("@Priya Shah"); otherwise just the first word is taken, so
// "@Priya reviewed the flows" yields "Priya", not "Priya reviewed".
// Returns { index, length, name } with index/length covering "@Name" in text.
export function findMentions(text, knownNames = []) {
  const known = new Map(knownNames.map(n => [key(n), n]))
  const found = []
  for (const m of (text || '').matchAll(/(?<!\w)@([^\s@]+)(?:([ \t]+)([^\s@]+))?/g)) {
    const first = m[1].replace(/[.,;:!?)\]]+$/, '')
    const second = m[3]?.replace(/[.,;:!?)\]]+$/, '')
    const two = second && known.get(key(`${first} ${second}`))
    if (two) found.push({ index: m.index, length: 1 + m[1].length + m[2].length + second.length, name: two })
    else if (first) found.push({ index: m.index, length: 1 + first.length, name: known.get(key(first)) || first })
  }
  return found
}

export function extractMentions(text, knownNames = []) {
  return findMentions(text, knownNames).map(m => m.name)
}

// Insert any names not already saved, checking against a fresh copy of the
// table rather than possibly stale component state.
export async function syncColleagues(userId, names) {
  const { data } = await supabase.from('colleagues').select('name').eq('user_id', userId)
  const saved = new Set((data || []).map(c => key(c.name)))
  for (const name of canonicalizeNames(names)) {
    if (saved.has(key(name))) continue
    const { error } = await supabase.from('colleagues').insert({ user_id: userId, name })
    // 23505 = unique violation: someone else inserted it first, which is fine
    if (error && error.code !== '23505') throw error
    saved.add(key(name))
  }
}
