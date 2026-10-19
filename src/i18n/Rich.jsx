// Renders a translated string that may contain simple <b>, <i> or <code> tags
const TAG_RE = /<(b|i|code)>(.*?)<\/\1>/g

export default function Rich({ text }) {
  const parts = []
  let last = 0
  for (const m of text.matchAll(TAG_RE)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const Tag = m[1]
    parts.push(<Tag key={m.index}>{m[2]}</Tag>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
