import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function ResetPassword() {
  const { updatePassword } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return }
    if (password.length < 6)  { setError('Mínimo 6 caracteres.'); return }
    setLoading(true)
    const { error } = await updatePassword(password)
    setLoading(false)
    if (error) setError(error.message)
    else navigate('/')
  }

  return (
    <div style={s.page}>
      <div style={{ ...s.suit, top: '6%',  left: '5%',   fontSize: 200, transform: 'rotate(-15deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '55%', left: '2%',   fontSize: 150, transform: 'rotate(12deg)' }}>♣</div>
      <div style={{ ...s.suit, top: '8%',  right: '4%',  fontSize: 170, color: '#c03030', transform: 'rotate(10deg)' }}>♥</div>
      <div style={{ ...s.suit, top: '58%', right: '3%',  fontSize: 130, color: '#1a50c8', transform: 'rotate(-8deg)' }}>♦</div>

      <div style={s.wrap}>
        <div style={s.logoWrap}>
          <div style={s.logoSuit}>♠</div>
          <div>
            <div style={s.logoName}>RunItBack</div>
            <div style={s.logoSub}>Tu historial de torneos</div>
          </div>
        </div>

        <div style={s.card}>
          <div style={s.header}>
            <div style={s.title}>Nueva contraseña</div>
            <div style={s.sub}>Elige una contraseña segura</div>
          </div>

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Nueva contraseña</label>
              <input
                style={s.input}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Confirmar contraseña</label>
              <input
                style={s.input}
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
              />
            </div>

            {error && <div style={s.error}>{error}</div>}

            <button style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar contraseña'}
            </button>
          </form>
        </div>

        <div style={s.footer}>♠ ♥ ♦ ♣</div>
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 30% 20%, #1a2a3a 0%, #0d1520 40%, #050b10 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    position: 'relative',
    overflow: 'hidden',
  },
  suit: {
    position: 'absolute',
    color: '#ffffff',
    opacity: 0.04,
    lineHeight: 1,
    pointerEvents: 'none',
    userSelect: 'none',
  },
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 28,
    zIndex: 1,
    width: 380,
  },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 14 },
  logoSuit: {
    fontSize: 54,
    color: '#60b0ff',
    textShadow: '0 0 30px rgba(60,140,255,0.7), 0 0 70px rgba(60,140,255,0.3)',
    lineHeight: 1,
  },
  logoName: {
    fontSize: 34, fontWeight: 900, color: '#e8f0ff',
    letterSpacing: '-0.5px', textShadow: '0 0 40px rgba(100,160,255,0.25)',
  },
  logoSub: {
    fontSize: 11, color: '#3a5070', fontWeight: 600,
    letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 3,
  },
  card: {
    background: 'linear-gradient(160deg, #1a2030 0%, #111828 100%)',
    border: '1px solid #2a3a52',
    borderRadius: 18,
    padding: '32px 32px 28px',
    width: '100%',
    boxSizing: 'border-box',
    boxShadow: '0 30px 90px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  header: { textAlign: 'center' },
  title: { fontSize: 18, fontWeight: 800, color: '#e8f0ff' },
  sub: { fontSize: 12, color: '#3a5070', marginTop: 4 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: {
    fontSize: 10, fontWeight: 800, color: '#3a5a7a',
    letterSpacing: '1px', textTransform: 'uppercase',
  },
  input: {
    background: '#080e18',
    border: '1px solid #1e2e42',
    borderRadius: 9,
    padding: '11px 14px',
    color: '#c8d4e8',
    fontSize: 14,
    outline: 'none',
  },
  btn: {
    background: 'linear-gradient(135deg, #1e5cad 0%, #1040a0 50%, #0c3080 100%)',
    border: '1px solid #2a4a80',
    borderRadius: 10,
    padding: '13px',
    color: '#d0e8ff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    marginTop: 6,
    letterSpacing: '0.5px',
    boxShadow: '0 4px 24px rgba(20,60,160,0.45)',
  },
  error: {
    color: '#e07070', fontSize: 12, textAlign: 'center',
    padding: '7px 12px', background: 'rgba(160,30,30,0.12)',
    borderRadius: 7, border: '1px solid rgba(160,30,30,0.25)',
  },
  footer: { fontSize: 18, color: '#1a2a3a', letterSpacing: 12 },
}
