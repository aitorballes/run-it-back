import { useAuth } from '../context/AuthContext'

export default function Dashboard() {
  const { user, signOut } = useAuth()

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.logo}>♠ Poker Tracker</div>
        <div style={styles.right}>
          <span style={styles.email}>{user?.email}</span>
          <button style={styles.signOut} onClick={signOut}>Salir</button>
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>♠</div>
          <div style={styles.emptyTitle}>No hay torneos cargados</div>
          <div style={styles.emptyText}>Sube un archivo .txt de GGPoker para empezar</div>
          <button style={styles.uploadBtn}>Cargar torneo</button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 50% 45%, #585858 0%, #2c2c2c 40%, #0e0e0e 100%)',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: '#dde0e8',
  },
  header: {
    background: '#1a1e2a',
    borderBottom: '1px solid #2a3040',
    padding: '12px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    fontSize: '18px',
    fontWeight: '800',
    color: '#90b8e0',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  email: {
    fontSize: '12px',
    color: '#4a6080',
  },
  signOut: {
    background: 'none',
    border: '1px solid #2a3a50',
    borderRadius: '5px',
    color: '#4a6080',
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  content: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    color: '#4a5568',
  },
  emptyIcon: {
    fontSize: '48px',
    color: '#2a3a4a',
  },
  emptyTitle: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#5a7090',
  },
  emptyText: {
    fontSize: '14px',
  },
  uploadBtn: {
    marginTop: '8px',
    background: 'linear-gradient(to bottom, #2a5cad, #1a4080)',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 24px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },
}
