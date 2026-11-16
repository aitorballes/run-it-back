// Quick reads for a player note: tapping a tag adds it to the note (or takes it out if it's there),
// so the usual reads take one tap at the table instead of typing
const SEP = ' · '

const hasTag = (text, tag) => text.split(SEP).map(s => s.trim().toLowerCase()).includes(tag.toLowerCase())

function toggleTag(text, tag) {
  const parts = text.split(SEP).map(s => s.trim()).filter(Boolean)
  const i = parts.findIndex(p => p.toLowerCase() === tag.toLowerCase())
  if (i >= 0) parts.splice(i, 1)
  else parts.push(tag)
  return parts.join(SEP)
}

export default function NoteTags({ tags, text, onChange, disabled }) {
  return (
    <div style={st.wrap}>
      {tags.map(tag => {
        const on = hasTag(text, tag)
        return (
          <button key={tag} type="button" disabled={disabled} aria-pressed={on}
            style={{ ...st.tag, ...(on ? st.on : null), ...(disabled ? st.off : null) }}
            onClick={() => onChange(toggleTag(text, tag))}>
            {on ? '✓ ' : '+ '}{tag}
          </button>
        )
      })}
    </div>
  )
}

const st = {
  wrap: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tag: {
    background: '#0a1422', border: '1px solid #1e3048', borderRadius: 999, color: '#7a94b0',
    padding: '0 12px', minHeight: 34, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    touchAction: 'manipulation',
  },
  on: { background: 'rgba(240,192,112,0.14)', borderColor: 'rgba(240,192,112,0.55)', color: '#f0c070' },
  off: { opacity: 0.4, cursor: 'default' },
}
