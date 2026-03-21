import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { parseFile, groupByTournament } from '../lib/parser'
import { saveTournament, fetchTournaments } from '../lib/db'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const fileInputRef = useRef()

  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading]         = useState(true)
  const [uploading, setUploading]     = useState(false)
  const [uploadStatus, setUploadStatus] = useState(null) // { ok, message }

  useEffect(() => {
    loadTournaments()
  }, [])

  async function loadTournaments() {
    try {
      const data = await fetchTournaments(user.id)
      setTournaments(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return

    setUploading(true)
    setUploadStatus(null)

    try {
      const texts = await Promise.all(files.map(f => f.text()))
      const allHands = texts.flatMap(t => parseFile(t).reverse())
      const grouped  = groupByTournament(allHands)

      let saved = 0, skipped = 0
      for (const tournament of grouped) {
        const result = await saveTournament(tournament, user.id)
        result.skipped ? skipped++ : saved++
      }

      const parts = []
      if (saved   > 0) parts.push(`${saved} torneo${saved > 1 ? 's' : ''} guardado${saved > 1 ? 's' : ''}`)
      if (skipped > 0) parts.push(`${skipped} ya existía${skipped > 1 ? 'n' : ''}`)
      setUploadStatus({ ok: true, message: parts.join(' · ') })

      await loadTournaments()
    } catch (err) {
      console.error(err)
      setUploadStatus({ ok: false, message: 'Error al procesar los archivos.' })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    const m = dateStr.match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : dateStr
  }

  return (
    <div style={styles.container}>
      {/* HEADER */}
      <div style={styles.header}>
        <div style={styles.logo}>♠ RunItBack</div>
        <div style={styles.right}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            multiple
            style={{ display: 'none' }}
            onChange={handleFiles}
          />
          <button
            style={{ ...styles.uploadBtn, opacity: uploading ? 0.6 : 1 }}
            onClick={() => fileInputRef.current.click()}
            disabled={uploading}
          >
            {uploading ? 'Procesando...' : '+ Cargar torneos'}
          </button>
          <span style={styles.email}>{user?.email}</span>
          <button style={styles.signOut} onClick={signOut}>Salir</button>
        </div>
      </div>

      {/* STATUS */}
      {uploadStatus && (
        <div style={{ ...styles.status, color: uploadStatus.ok ? '#50d080' : '#e05050' }}>
          {uploadStatus.message}
        </div>
      )}

      {/* CONTENT */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.hint}>Cargando...</div>
        ) : tournaments.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>♠</div>
            <div style={styles.emptyTitle}>No hay torneos todavía</div>
            <div style={styles.hint}>Sube archivos .txt de GGPoker para empezar</div>
            <button style={styles.emptyBtn} onClick={() => fileInputRef.current.click()}>
              Cargar torneos
            </button>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Torneo</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Fecha</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Manos</th>
                </tr>
              </thead>
              <tbody>
                {tournaments.map(t => (
                  <tr key={t.id} style={styles.tr}>
                    <td style={styles.tdName}>{t.name}</td>
                    <td style={styles.tdDate}>{formatDate(t.date)}</td>
                    <td style={styles.tdHands}>{t.hands_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
    padding: '10px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  logo: {
    fontSize: '18px',
    fontWeight: '800',
    color: '#90b8e0',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  uploadBtn: {
    background: 'linear-gradient(to bottom, #2a5cad, #1a4080)',
    border: 'none',
    borderRadius: '6px',
    padding: '7px 16px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
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
  status: {
    textAlign: 'center',
    fontSize: '13px',
    fontWeight: '600',
    padding: '8px',
    background: '#0f1520',
    borderBottom: '1px solid #1e2a3a',
  },
  content: {
    flex: 1,
    padding: '40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    marginTop: '80px',
  },
  emptyIcon:  { fontSize: '48px', color: '#2a3a4a' },
  emptyTitle: { fontSize: '20px', fontWeight: '700', color: '#5a7090' },
  hint:       { fontSize: '13px', color: '#4a5568' },
  emptyBtn: {
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
  tableWrap: {
    width: '100%',
    maxWidth: '800px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  th: {
    padding: '8px 16px',
    fontSize: '10px',
    fontWeight: '800',
    letterSpacing: '1px',
    color: '#3a5060',
    borderBottom: '2px solid #1e2e42',
    textAlign: 'left',
  },
  tr: {
    borderBottom: '1px solid #131d2a',
    cursor: 'pointer',
  },
  tdName: {
    padding: '14px 16px',
    fontSize: '14px',
    color: '#7aa0c8',
    fontWeight: '700',
  },
  tdDate: {
    padding: '14px 16px',
    fontSize: '12px',
    color: '#3a5268',
    textAlign: 'right',
    whiteSpace: 'nowrap',
  },
  tdHands: {
    padding: '14px 16px',
    fontSize: '13px',
    color: '#607888',
    fontWeight: '700',
    textAlign: 'right',
  },
}
