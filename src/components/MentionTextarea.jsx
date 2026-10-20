import { useState, useRef } from 'react'
import { t } from '../lib/theme'

function getCaretCoordinates(el, position) {
  const computed = getComputedStyle(el)
  const mirror = document.createElement('div')
  const ms = mirror.style

  ms.position = 'absolute'
  ms.top = '0'
  ms.left = '0'
  ms.visibility = 'hidden'
  ms.pointerEvents = 'none'
  ms.whiteSpace = 'pre-wrap'
  ms.wordWrap = 'break-word'
  ms.overflow = 'hidden'

  ;[
    'box-sizing', 'width',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'font-size', 'font-family', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  ].forEach(p => { ms[p] = computed[p] })

  mirror.textContent = el.value.substring(0, position)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)

  el.parentNode.appendChild(mirror)
  const lineH = parseInt(computed.lineHeight) || 20
  const coords = {
    top:  el.offsetTop  + marker.offsetTop  - el.scrollTop  + lineH,
    left: el.offsetLeft + marker.offsetLeft - el.scrollLeft,
  }
  mirror.remove()
  return coords
}

export default function MentionTextarea({ value, onChange, mentions = [], onAddMention, style, ...props }) {
  const [query, setQuery]         = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [dropPos, setDropPos]     = useState({ top: 0, left: 0 })
  const textareaRef               = useRef(null)

  const filtered = query !== null
    ? mentions.filter(m => m.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : []

  // Show "add new" when query has content and doesn't exactly match an existing colleague
  const trimmed = query?.trim() ?? ''
  const isExactMatch = mentions.some(m => m.toLowerCase() === trimmed.toLowerCase())
  const showAdd = trimmed.length > 1 && !isExactMatch && onAddMention

  // Total items in dropdown: filtered + optional add row
  const totalItems = filtered.length + (showAdd ? 1 : 0)

  function detectMention(val, cursor) {
    const before = val.slice(0, cursor)
    // Match @ followed by 1 word (first name) or 2 words (first + last),
    // with no trailing space — stops re-triggering after the name is done.
    const match = before.match(/@([^\s@\n]+(?:\s[^\s@\n]+)?)$/)
    if (!match) return null
    return { index: match.index, query: match[1] }
  }

  function handleChange(e) {
    const val    = e.target.value
    const cursor = e.target.selectionStart
    const m      = detectMention(val, cursor)
    if (m) {
      // A new search starts at the top of the list
      if (m.query !== query) setActiveIdx(0)
      setQuery(m.query)
      setDropPos(getCaretCoordinates(e.target, m.index + 1))
    } else {
      setQuery(null)
    }
    onChange(e)
  }

  function handleKeyDown(e) {
    if (query === null) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, Math.max(totalItems - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered[activeIdx]) {
        e.preventDefault()
        insertMention(filtered[activeIdx])
      } else if (showAdd && activeIdx === filtered.length) {
        e.preventDefault()
        addAndInsert(trimmed)
      }
    } else if (e.key === 'Escape') {
      setQuery(null)
    }
  }

  function insertMention(name) {
    const el     = textareaRef.current
    const cursor = el.selectionStart
    const m      = detectMention(value, cursor)
    if (!m) return
    const newVal    = value.slice(0, m.index) + '@' + name + ' ' + value.slice(cursor)
    const newCursor = m.index + name.length + 2
    onChange({ target: { value: newVal } })
    if (onAddMention) onAddMention(name)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(newCursor, newCursor) })
    setQuery(null)
  }

  // insertMention also tells the page about the name, which saves the new colleague
  function addAndInsert(name) {
    insertMention(name)
  }

  const dropVisible = query !== null && (filtered.length > 0 || showAdd || mentions.length === 0)

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={style}
        {...props}
      />

      {dropVisible && (
        <div style={{ ...s.dropdown, top: dropPos.top, left: dropPos.left }}>
          {mentions.length === 0 && filtered.length === 0 && !showAdd && (
            <div style={s.empty}>Type a name to add a new colleague</div>
          )}

          {filtered.map((name, i) => (
            <div
              key={name}
              style={{ ...s.option, ...(i === activeIdx ? s.active : {}) }}
              onMouseDown={e => { e.preventDefault(); insertMention(name) }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span style={s.at}>@</span>{name}
            </div>
          ))}

          {showAdd && (
            <div
              style={{ ...s.addRow, ...(activeIdx === filtered.length ? s.active : {}) }}
              onMouseDown={e => { e.preventDefault(); addAndInsert(trimmed) }}
              onMouseEnter={() => setActiveIdx(filtered.length)}
            >
              <span style={s.addIcon}>+</span>
              Add <strong style={{ marginLeft: 4 }}>@{trimmed}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const s = {
  dropdown: {
    position: 'absolute',
    background: '#fff',
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(28,27,34,0.12)',
    zIndex: 300,
    minWidth: 200,
    maxWidth: 320,
    overflow: 'hidden',
  },
  option: {
    padding: '9px 14px',
    fontSize: 14,
    cursor: 'pointer',
    color: t.text,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    background: '#fff',
  },
  addRow: {
    padding: '9px 14px',
    fontSize: 14,
    cursor: 'pointer',
    color: t.text,
    display: 'flex',
    alignItems: 'center',
    background: '#fff',
    borderTop: `1px solid ${t.border}`,
  },
  active:  { background: t.accentSoft },
  at:      { color: t.accent, fontWeight: 600, marginRight: 1 },
  addIcon: { color: t.accent, fontWeight: 700, marginRight: 8, fontSize: 16 },
  empty:   { padding: '10px 14px', fontSize: 13, color: t.muted, fontStyle: 'italic' },
}
