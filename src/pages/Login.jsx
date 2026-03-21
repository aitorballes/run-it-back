import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) setError(error.message)
      else navigate('/')
    } else {
      const { error } = await signUp(email, password)
      if (error) setError(error.message)
      else setMessage('Revisa tu email para confirmar la cuenta.')
    }

    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logo}>♠ RunItBack</div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => setMode('login')}
          >
            Iniciar sesión
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}
            onClick={() => setMode('register')}
          >
            Registrarse
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />

          {error && <div style={styles.error}>{error}</div>}
          {message && <div style={styles.success}>{message}</div>}

          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Cargando...' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 50% 45%, #585858 0%, #2c2c2c 40%, #0e0e0e 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    background: '#1a1e2a',
    border: '1px solid #2a3040',
    borderRadius: '12px',
    padding: '40px',
    width: '360px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  logo: {
    textAlign: 'center',
    fontSize: '22px',
    fontWeight: '800',
    color: '#90b8e0',
    letterSpacing: '0.5px',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid #2a3040',
  },
  tab: {
    flex: 1,
    padding: '8px',
    background: 'none',
    border: 'none',
    color: '#4a6080',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '700',
    borderBottom: '2px solid transparent',
    marginBottom: '-1px',
  },
  tabActive: {
    color: '#60c0ff',
    borderBottomColor: '#60c0ff',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    background: '#0f1520',
    border: '1px solid #2a3a50',
    borderRadius: '6px',
    padding: '10px 14px',
    color: '#dde0e8',
    fontSize: '14px',
    outline: 'none',
  },
  button: {
    background: 'linear-gradient(to bottom, #2a5cad, #1a4080)',
    border: 'none',
    borderRadius: '6px',
    padding: '11px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    marginTop: '4px',
  },
  error: {
    color: '#e05050',
    fontSize: '12px',
    textAlign: 'center',
  },
  success: {
    color: '#50d080',
    fontSize: '12px',
    textAlign: 'center',
  },
}
