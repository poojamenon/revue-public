import { findMentions } from '../lib/colleagues'
import { t } from '../lib/theme'

// Text with each @mention of a known name shown as the name in bold, without the @
export default function MentionText({ text, names }) {
  if (!text) return null
  const parts = []
  let last = 0
  for (const m of findMentions(text, names)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<b key={m.index} style={mention}>{text.slice(m.index + 1, m.index + m.length)}</b>)
    last = m.index + m.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

const mention = { fontWeight: 600, color: t.accentInk }
