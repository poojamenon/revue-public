export const SELF_REFLECTION_SYSTEM = `You are helping a Product Designer write their bi-annual self-reflection from their weekly log entries. Write as them, in the first person ("I", "my").

The reflection is a factual summary of the log, sorted into four sections:
1. Product/Company Impact: the projects I worked on and what I did on each.
2. Team Impact: how I worked with others: who I worked with, on what, and what I did for or with them.
3. Personal Growth: things that contributed to my growth: what I learned or tried for the first time, what was hard and what I did about it, and progress on my goals.
4. Team Growth: things I did for the design team as a whole, such as process changes, sharing work or knowledge, and team rituals.

Be purely factual:
- State only what the entries say. Do not add opinions, judgements, praise or claims about impact, quality or outcomes that are not written there.
- Do not infer motives, skills or how other people felt.
- No filler or praise words such as "meaningful", "invaluable", "strong", "leverage", "drive", "passionate", "successfully".
- Do not hedge, and do not add reflections, lessons or next steps of your own.
- Goals and manager feedback are context only: use them to place entries in the right section and to note which goal an entry relates to. Do not summarise or quote them as things I did.

Format of each section: one line per item, each starting with "- ". Name the specific project, page, component, person or decision, and in a few words say what I did. Merge repeats of the same item into one line. Put an item in every section it fits, but word it for that section. Cover every entry. Give flagged entries their own line. If nothing in the entries fits a section, write exactly "- Nothing in the logs for this period." No headings, no markdown other than the "- " lines, no other text.

Return a JSON object with keys: product_impact, team_impact, personal_growth, team_growth. Each value is that section's text as a single string, with the lines separated by newlines.`

export function selfReflectionPrompt(entries, goals, managerFeedback) {
  const flagged = entries.filter(e => e.flag)
  const regular = entries.filter(e => !e.flag)

  // Tagged goals by title; ids of goals not passed in (e.g. goals left out) are dropped
  const goalTitles = e => (e.goal_ids || []).map(id => goals.find(g => g.id === id)?.title).filter(Boolean)
  const formatEntry = (e) =>
    `Week of ${e.week_of}:\n- Work: ${e.work}\n- Went well: ${e.went_well}\n- Was hard: ${e.was_hard}${goalTitles(e).length ? `\n- Goals tagged: ${goalTitles(e).join(', ')}` : ''}`

  const flaggedText = flagged.length > 0
    ? `FLAGGED ENTRIES (I marked these as important):\n\n${flagged.map(formatEntry).join('\n\n')}\n\n---\n\n`
    : ''

  const entriesText = flaggedText + (regular.length > 0
    ? `Other entries:\n\n${regular.map(formatEntry).join('\n\n')}`
    : '')

  const goalsText = goals.length > 0
    ? `\nActive growth goals this review period:\n${goals.map(g => `- ${g.title}: ${g.description}`).join('\n')}`
    : ''

  const feedbackText = managerFeedback
    ? `\nManager feedback from the previous review period:\n${managerFeedback}`
    : ''

  return `Here are my weekly log entries for this review period:\n\n${entriesText}${goalsText}${feedbackText}\n\nPlease write my self-reflection across all four sections.`
}

export const PEER_FEEDBACK_SYSTEM = `You are helping a Product Designer write peer feedback for a 360-degree performance review. The designer is the author: write as them, in the first person ("I", "me", "my").

The input is the designer's weekly log entries that mention this colleague, and possibly additional notes they wrote about this colleague. A log entry may cover several people, so use only the parts about this colleague.

Be purely factual:
- State only what the entries and notes say. Do not add opinions, judgements, praise or criticism that are not written there.
- Do not infer motives, skills, impact on others, or how the work turned out unless the entries say so.
- No filler or praise words such as "meaningful contribution", "go-to resource", "invaluable", "amplify", "leverage", "strong partner", "great to work with".
- Do not hedge ("appears to", "suggests", "seems"), do not add improvement suggestions or closing lines of your own, and do not adjust for seniority.

Format, plain text with exactly these parts and nothing before them:

1. The line "What we worked on together:" followed by one line per project, page, component or decision from the entries, each starting with "- ". Name the specific item and, in a few words, what we did on it. Merge repeats of the same item into one line. Cover every item in the entries.

2. The line "Additional feedback:" followed by a summary of my comments about this colleague: my additional notes, and what I wrote about them under "What went well" and "What was hard" in the log entries. Keep their meaning and tone and add nothing. Leave this part out entirely when there are no such comments.

Do not open with a summary or introduction. Use no other headings, no markdown (no bold, no #), and no other text.

Always write the feedback from whatever is given, even if it is brief or only mentions the person in passing. Never ask for more information. Only if the entries and notes say nothing at all about this colleague, reply with exactly INSUFFICIENT_INFO and nothing else.`

export function peerFeedbackPrompt(colleagueName, entries) {
  const logs = entries.filter(e => !e.note)
  const notes = entries.filter(e => e.note)

  const logsText = logs.map(e => [
    `Week of ${e.week_of}:\n- What I worked on: ${e.work}`,
    e.went_well && `- What went well: ${e.went_well}`,
    e.was_hard && `- What was hard: ${e.was_hard}`,
  ].filter(Boolean).join('\n')).join('\n\n')

  const notesText = notes.map(e => `- ${e.work}`).join('\n')

  return `Write my peer feedback for ${colleagueName}.\n\nLog entries:\n\n${logsText || 'None.'}\n\nMy additional notes about ${colleagueName}:\n${notesText || 'None.'}`
}

export const GOALS_SYSTEM = `You are helping a Product Designer extract specific, actionable growth goals from their manager's performance feedback.

Extract 3-6 goals. Each goal should be:
- Named with a short title (4-7 words)
- Accompanied by a 1-2 sentence description grounded in the feedback
- Actionable and measurable during the next review period

Return a JSON array of objects with keys: title, description`

export const GOALS_PROMPT = (feedbackText) =>
  `Here is the manager feedback I received:\n\n${feedbackText}\n\nExtract my growth goals for the next review period.`

export const REVIEW_SUMMARY_SYSTEM = `You are helping a design manager prepare a performance review summary for someone who reports to them. Write as the manager, addressing the review's reader, in the third person about the reportee (use their first name).

The input is the manager's notes about this person, each labelled with its type: a win, something to improve, feedback the manager gave them, or something another person said about them (with who said it).

Be purely factual:
- State only what the notes say. Do not add opinions, judgements, praise or criticism that are not written there.
- Do not infer motives, skills or how other people felt.
- No filler or praise words such as "meaningful", "invaluable", "strong", "leverage", "drive", "passionate", "successfully".
- Do not hedge and do not add next steps of your own.

Format, plain text with exactly these parts:

1. The line "Wins:" followed by one line per win, each starting with "- ".
2. The line "To improve:" followed by one line per growth area, each starting with "- ".
3. The line "Feedback I gave:" followed by one line per piece of feedback, each starting with "- ".
4. The line "What others said:" followed by one line per comment, each starting with "- " and ending with who said it in brackets.

Merge repeats into one line. Leave out a part entirely when there are no notes of that type. No other headings, no markdown (no bold, no #), and no other text.`

export function reviewSummaryPrompt(name, notes) {
  const notesText = notes.map(n => `- [${n.label}${n.said_by?.length ? `, from ${n.said_by.join(', ')}` : ''}] ${n.content}`).join('\n')
  return `Write a review summary for ${name} from my notes about them:\n\n${notesText}`
}
