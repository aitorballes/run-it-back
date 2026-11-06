// Shared inline styles for the live tournament pages (same look as Profile)
export const base = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 30% 20%, #1a2a3a 0%, #0d1520 40%, #050b10 100%)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: '#dde0e8',
  },
  header: {
    position: 'sticky', top: 0, zIndex: 10,
    background: 'rgba(10,15,25,0.92)', borderBottom: '1px solid #0e1828', backdropFilter: 'blur(12px)',
    padding: '11px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
  content: {
    maxWidth: 640, margin: '0 auto', padding: '20px 16px 48px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  title:    { fontSize: 22, fontWeight: 900, color: '#e8f0ff' },
  subtitle: { fontSize: 12, color: '#3a5a7a', marginTop: 3 },
  card: {
    background: 'linear-gradient(160deg, #1a2030 0%, #111828 100%)',
    border: '1px solid #2a3a52', borderRadius: 14, padding: '18px 18px 16px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  cardTitle: { fontSize: 14, fontWeight: 800, color: '#c8d8f0' },
  row:   { display: 'flex', gap: 10, flexWrap: 'wrap' },
  half:  { flex: '1 1 180px', minWidth: 0 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 10, fontWeight: 800, color: '#3a5a7a', letterSpacing: '1px', textTransform: 'uppercase' },
  hint:  { fontSize: 11, color: '#3a5a7a', lineHeight: 1.5 },
  muted: { fontSize: 13, color: '#3a5a7a', textAlign: 'center', padding: 20 },
  input: {
    background: '#080e18', border: '1px solid #1e2e42', borderRadius: 9,
    padding: '10px 12px', color: '#c8d4e8', fontSize: 15, outline: 'none',
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', minWidth: 0,
  },
  select: {
    colorScheme: 'dark', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', textAlign: 'center',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  btn: {
    background: 'linear-gradient(135deg, #1e5cad 0%, #1040a0 50%, #0c3080 100%)',
    border: '1px solid #2a4a80', borderRadius: 9, padding: '10px 18px',
    color: '#d0e8ff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(20,60,160,0.35)', whiteSpace: 'nowrap',
  },
  ghostBtn: {
    background: 'none', border: '1px solid #1a3048', borderRadius: 8, color: '#5a8ab0',
    padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
  },
  error: {
    color: '#e07070', fontSize: 12, padding: '7px 12px', background: 'rgba(160,30,30,0.12)',
    borderRadius: 7, border: '1px solid rgba(160,30,30,0.25)',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionTitle: { fontSize: 10, fontWeight: 800, color: '#3a5a7a', letterSpacing: '1px', textTransform: 'uppercase' },
  item: {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
    background: 'rgba(16,24,38,0.85)', border: '1px solid #1e2e42', borderRadius: 11,
    padding: '12px 14px', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit',
  },
  itemName:  { fontSize: 14, fontWeight: 800, color: '#e0ecff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  itemMeta:  { fontSize: 11, color: '#4a6a8a', marginTop: 2 },
  itemRight: { textAlign: 'right', flexShrink: 0 },
  itemBuyin: { fontSize: 14, fontWeight: 800, color: '#60b0ff' },
}
