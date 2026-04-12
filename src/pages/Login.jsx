import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

function validatePassword(pw) {
  const rules = [
    { ok: pw.length >= 8,          text: 'Mínimo 8 caracteres' },
    { ok: /[0-9]/.test(pw),        text: 'Al menos un número' },
    { ok: /[^a-zA-Z0-9]/.test(pw), text: 'Al menos un carácter especial' },
  ]
  return rules
}

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode]         = useState('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [message, setMessage]   = useState('')
  const [loading, setLoading]   = useState(false)

  const pwRules   = validatePassword(password)
  const pwValid   = pwRules.every(r => r.ok)
  const showRules = mode === 'register' && password.length > 0

  function switchMode(m) {
    setMode(m); setError(''); setMessage('')
    setPassword(''); setConfirm('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (mode === 'register') {
      if (!pwValid)              { setError('La contraseña no cumple los requisitos.'); return }
      if (password !== confirm)  { setError('Las contraseñas no coinciden.'); return }
    }

    setLoading(true)

    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
      else navigate('/')
    } else if (mode === 'register') {
      const { error } = await signUp(email, password)
      if (error) setError(error.message)
      else setMessage('Revisa tu email para confirmar la cuenta.')
    } else {
      const { error } = await resetPassword(email)
      if (error) setError(error.message)
      else setMessage('Te hemos enviado un email para restablecer tu contraseña.')
    }

    setLoading(false)
  }

  return (
    <div style={s.page}>
      <div style={{ ...s.suit, top: '6%',  left: '5%',   fontSize: 200, transform: 'rotate(-15deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '55%', left: '2%',   fontSize: 150, transform: 'rotate(12deg)' }}>♣</div>
      <div style={{ ...s.suit, top: '8%',  right: '4%',  fontSize: 170, color: '#c03030', transform: 'rotate(10deg)' }}>♥</div>
      <div style={{ ...s.suit, top: '58%', right: '3%',  fontSize: 130, color: '#1a50c8', transform: 'rotate(-8deg)' }}>♦</div>
      <div style={{ ...s.suit, bottom: '4%', left: '22%', fontSize: 90, transform: 'rotate(5deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '28%', right: '16%', fontSize: 80,  color: '#c03030', transform: 'rotate(-22deg)' }}>♦</div>

      <div style={s.wrap}>
        <div style={s.logoWrap}>
          <div style={s.logoSuit}>♠</div>
          <div>
            <div style={s.logoName}>RunItBack</div>
            <div style={s.logoSub}>Tu historial de torneos</div>
          </div>
        </div>

        <div style={s.card}>
          {mode !== 'forgot' && (
            <div style={s.tabs}>
              <button
                style={{ ...s.tab, ...(mode === 'login' ? s.tabActive : {}) }}
                onClick={() => switchMode('login')}
              >
                Iniciar sesión
              </button>
              <button
                style={{ ...s.tab, ...(mode === 'register' ? s.tabActive : {}) }}
                onClick={() => switchMode('register')}
              >
                Registrarse
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <div style={s.forgotHeader}>
              <div style={s.forgotTitle}>Recuperar contraseña</div>
              <div style={s.forgotSub}>Te enviaremos un enlace a tu email</div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Email</label>
              <input
                style={s.input}
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>

            {mode !== 'forgot' && (
              <div style={s.field}>
                <label style={s.label}>Contraseña</label>
                <input
                  style={s.input}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {/* Reglas de contraseña — solo en registro */}
            {showRules && (
              <div style={s.rules}>
                {pwRules.map(r => (
                  <div key={r.text} style={{ ...s.rule, color: r.ok ? '#50d080' : '#e07070' }}>
                    {r.ok ? '✓' : '✗'} {r.text}
                  </div>
                ))}
              </div>
            )}

            {/* Confirmar contraseña — solo en registro */}
            {mode === 'register' && (
              <div style={s.field}>
                <label style={s.label}>Confirmar contraseña</label>
                <input
                  style={{
                    ...s.input,
                    borderColor: confirm && confirm !== password ? '#8b3030' : '#1e2e42',
                  }}
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
                {confirm && confirm !== password && (
                  <div style={s.inlineError}>Las contraseñas no coinciden</div>
                )}
              </div>
            )}

            {error   && <div style={s.error}>{error}</div>}
            {message && <div style={s.success}>{message}</div>}

            <button style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
              {loading ? 'Cargando...' : mode === 'login' ? 'Entrar' : mode === 'register' ? 'Crear cuenta' : 'Enviar enlace'}
            </button>

            {mode === 'login' && (
              <button type="button" style={s.forgotLink} onClick={() => switchMode('forgot')}>
                ¿Olvidaste tu contraseña?
              </button>
            )}
            {mode === 'forgot' && (
              <button type="button" style={s.forgotLink} onClick={() => switchMode('login')}>
                Volver al inicio de sesión
              </button>
            )}
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
    boxShadow: '0 30px 90px rgba(0,0,0,0.8), 0 0 0 1px rgba(60,100,160,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  tabs: {
    display: 'flex',
    background: '#0a0f18',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1, padding: '9px 0', background: 'none', border: 'none',
    color: '#3a5070', cursor: 'pointer', fontSize: 13, fontWeight: 700,
    borderRadius: 8, transition: 'all 0.15s',
  },
  tabActive: {
    background: 'linear-gradient(to bottom, #1e3a5c, #142840)',
    color: '#70c0ff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  },
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
  rules: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '8px 12px',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 8,
    border: '1px solid #1a2a3a',
  },
  rule: { fontSize: 11, fontWeight: 600 },
  inlineError: {
    fontSize: 11,
    color: '#e07070',
    marginTop: 2,
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
  success: {
    color: '#50d080', fontSize: 12, textAlign: 'center',
    padding: '7px 12px', background: 'rgba(30,150,60,0.12)',
    borderRadius: 7, border: '1px solid rgba(30,150,60,0.25)',
  },
  footer: { fontSize: 18, color: '#1a2a3a', letterSpacing: 12 },
  forgotLink: {
    background: 'none', border: 'none', color: '#3a7ab8',
    fontSize: 12, cursor: 'pointer', textAlign: 'center',
    padding: 0, textDecoration: 'underline',
  },
  forgotHeader: { textAlign: 'center' },
  forgotTitle: { fontSize: 18, fontWeight: 800, color: '#e8f0ff' },
  forgotSub: { fontSize: 12, color: '#3a5070', marginTop: 4 },
}
