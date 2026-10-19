// RunItBack logo as shown in the home header. With onClick it becomes a button
export default function Logo({ onClick, compact = false, title }) {
  const content = (
    <>
      <span style={spade}>♠</span>
      {!compact && <span style={text}>RunItBack</span>}
    </>
  )
  return onClick
    ? <button type="button" style={{ ...root, ...button }} onClick={onClick} title={title}>{content}</button>
    : <div style={root}>{content}</div>
}

const root = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  fontFamily: "'Segoe UI', system-ui, sans-serif",
}

const button = { background: 'none', border: 'none', padding: 0, cursor: 'pointer' }

const spade = {
  fontSize: 22,
  color: '#60b0ff',
  textShadow: '0 0 20px rgba(60,140,255,0.6)',
  lineHeight: 1,
}

const text = {
  fontSize: 18,
  fontWeight: 900,
  color: '#e8f0ff',
  letterSpacing: '-0.3px',
}
