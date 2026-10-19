// Round user avatar: profile picture if there is one, otherwise the initial
export default function Avatar({ url, name, size = 26, style }) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase()
  return (
    <span style={{
      ...base,
      width: size,
      height: size,
      fontSize: Math.round(size * 0.44),
      ...style,
    }}>
      {url
        ? <img src={url} alt="" style={img} draggable={false} />
        : initial}
    </span>
  )
}

const base = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  overflow: 'hidden',
  flexShrink: 0,
  background: 'linear-gradient(135deg, #1e5cad, #0c3080)',
  border: '1px solid #2a4a80',
  color: '#d0e8ff',
  fontWeight: 900,
  lineHeight: 1,
  boxSizing: 'border-box',
}

const img = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
