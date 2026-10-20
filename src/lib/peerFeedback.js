import { callClaude } from './claude'
import { PEER_FEEDBACK_SYSTEM, peerFeedbackPrompt } from './prompts'
import { formatCycle } from './cycles'

// Drafts are never saved. They live in memory for this tab, as { [userId]: { [colleague_id]: draft } },
// so the Weekly Log panel and Peer feedback share them until the page reloads or the user signs out.
const sessionDrafts = new Map()

export function getSessionDrafts(userId) {
  return sessionDrafts.get(userId) || {}
}

export function clearSessionDrafts() {
  sessionDrafts.clear()
}

function remember(userId, colleague, draft) {
  sessionDrafts.set(userId, { ...getSessionDrafts(userId), [colleague.id]: draft })
}

// Log entries that tag this colleague, in the order given
export function mentionsOf(entries, colleague) {
  return entries.filter(e => e.colleagues?.some(n => n.toLowerCase() === colleague.name.toLowerCase()))
}

// Notes in the same shape as log entries, so drafts can use them alongside the log
function noteEntries(notes) {
  return notes.map(n => ({ week_of: `Note added ${formatStamp(n.created_at)}`, work: n.content, went_well: '', was_hard: '', note: true }))
}

// Resolves to { draft } or, when there is nothing to write from, { needsInfo: true, error }
export async function generatePeerDraft({ apiKey, userId, colleague, entries, notes, period }) {
  const source = [...mentionsOf(entries, colleague), ...noteEntries(notes)]
  if (!source.length) {
    return { needsInfo: true, error: `No entries mention ${colleague.name} in ${formatCycle(period)}. Tag them in your weekly log or add notes.` }
  }
  const draft = await callClaude(apiKey, PEER_FEEDBACK_SYSTEM, peerFeedbackPrompt(colleague.name, source))
  if (draft.trim().startsWith('INSUFFICIENT_INFO')) {
    return { needsInfo: true, error: `Not enough detail to write specific feedback for ${colleague.name}. Add notes, then try again.` }
  }
  remember(userId, colleague, draft)
  return { draft }
}

export async function rewritePeerDraft({ apiKey, userId, colleague, entries, notes, current, how }) {
  const source = [...mentionsOf(entries, colleague), ...noteEntries(notes)]
  const prompt = peerFeedbackPrompt(colleague.name, source) + `\n\nHere is the current draft:\n\n${current}\n\nRewrite it, following these instructions: ${how}\nKeep it grounded in the notes above. Return just the feedback text.`
  const draft = await callClaude(apiKey, PEER_FEEDBACK_SYSTEM, prompt)
  remember(userId, colleague, draft)
  return draft
}

// "16 Oct 2026, 14:05"
export function formatStamp(ts) {
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
