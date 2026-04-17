import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchAllUserHands } from '../lib/db'
import { getPositionLabel, heroFoldedPreflop, preflopRaiseCount, playersWhoSawFlop } from '../lib/handUtils'

const EMPTY_STUDY   = { positions: [], notFoldedPreflop: false, potType: null, players: null }
const ALL_POSITIONS = ['BTN', 'CO', 'HJ', 'LJ', 'MP', 'MP+1', 'UTG', 'UTG+1', 'SB', 'BB']

export default function StudyPage() {
  const { user }   = useAuth()
  const navigate   = useNavigate()

  const [draft,     setDraft]     = useState(EMPTY_STUDY)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [noResults, setNoResults] = useState(false)

  async function handleSearch() {
    setLoading(true)
    setNoResults(false)
    setError(null)
    try {
      const rows = await fetchAllUserHands(user.id)
      const matched = rows.filter(({ raw: h }) => {
        if (draft.positions.length > 0) {
          const heroSeat = h.seats?.find(s => s.player === 'Hero')
          if (!heroSeat) return false
          const pos = getPositionLabel(heroSeat.num, h.seats, h.buttonSeat)
          if (!draft.positions.includes(pos)) return false
        }
        if (draft.notFoldedPreflop && heroFoldedPreflop(h)) return false
        if (draft.potType === 'srp'      && preflopRaiseCount(h) !== 1) return false
        if (draft.potType === 'threebet' && preflopRaiseCount(h) < 2)   return false
        if (draft.players !== null) {
          if (!h.board?.flop?.length) return false
          const cnt = playersWhoSawFlop(h)
          if (draft.players === 'hu'       && cnt !== 2) return false
          if (draft.players === 'multiway' && cnt < 3)   return false
        }
        return true
      })
      if (matched.length === 0) {
        setNoResults(true)
      } else {
        navigate('/study/results', { state: { studyHands: matched } })
      }
    } catch (e) {
      console.error(e)
      setError('Error al buscar manos. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={{ ...s.suit, top: '6%',  left: '5%',  fontSize: 200, transform: 'rotate(-15deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '55%', left: '2%',  fontSize: 150, transform: 'rotate(12deg)' }}>♣</div>
      <div style={{ ...s.suit, top: '8%',  right: '4%', fontSize: 170, color: '#c03030', transform: 'rotate(10deg)' }}>♥</div>
      <div style={{ ...s.suit, top: '58%', right: '3%', fontSize: 130, color: '#1a50c8', transform: 'rotate(-8deg)' }}>♦</div>

      {/* HEADER */}
      <div style={s.header}>
        <div style={s.headerInner}>
          <button style={s.backBtn} onClick={() => navigate('/')}>‹ Dashboard</button>
          <div style={s.logo}>
            <span style={{ fontSize: 20, color: '#50d080', lineHeight: 1 }}>♟</span>
            <span style={s.logoText}>Estudia tu juego</span>
          </div>
          <div style={{ width: 100 }} />
        </div>
      </div>

      {/* CONTENT */}
      <div style={s.content}>
        <div style={s.card}>
          <div style={s.cardTitle}>Filtros de búsqueda</div>

          <div style={s.field}>
            <label style={s.fieldLabel}>Posición del Hero</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ALL_POSITIONS.map(pos => {
                const active = draft.positions.includes(pos)
                return (
                  <button key={pos}
                    style={{ ...s.chipBtn, ...(active ? s.chipBtnActive : {}) }}
                    onClick={() => setDraft(d => ({
                      ...d,
                      positions: active ? d.positions.filter(p => p !== pos) : [...d.positions, pos],
                    }))}
                  >{pos}</button>
                )
              })}
            </div>
          </div>

          <div style={s.field}>
            <label style={s.checkLabel}>
              <input type="checkbox" checked={draft.notFoldedPreflop}
                onChange={e => setDraft(d => ({ ...d, notFoldedPreflop: e.target.checked }))}
                style={{ accentColor: '#50d080', width: 15, height: 15 }} />
              Solo manos jugadas (Hero no foldea preflop)
            </label>
          </div>

          <div style={s.field}>
            <label style={s.fieldLabel}>Tipo de bote</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ value: null, label: 'Cualquiera' }, { value: 'srp', label: 'SRP' }, { value: 'threebet', label: '3-bet pot' }].map(opt => {
                const active = draft.potType === opt.value
                return (
                  <button key={String(opt.value)}
                    style={{ ...s.chipBtn, flex: 1, ...(active ? s.chipBtnActive : {}) }}
                    onClick={() => setDraft(d => ({ ...d, potType: opt.value }))}
                  >{opt.label}</button>
                )
              })}
            </div>
          </div>

          <div style={s.field}>
            <label style={s.fieldLabel}>Jugadores en el bote</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {[{ value: null, label: 'Cualquiera' }, { value: 'hu', label: 'Heads Up' }, { value: 'multiway', label: 'Multiway' }].map(opt => {
                const active = draft.players === opt.value
                return (
                  <button key={String(opt.value)}
                    style={{ ...s.chipBtn, flex: 1, ...(active ? s.chipBtnActive : {}) }}
                    onClick={() => setDraft(d => ({ ...d, players: opt.value }))}
                  >{opt.label}</button>
                )
              })}
            </div>
          </div>

          {error && <div style={s.errorMsg}>{error}</div>}
          {noResults && (
            <div style={s.noResults}>
              No se encontraron manos con esos filtros.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={{ ...s.searchBtn, opacity: loading ? 0.6 : 1 }}
              onClick={handleSearch} disabled={loading}>
              {loading ? 'Buscando...' : 'Buscar manos'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 30% 20%, #1a2a3a 0%, #0d1520 40%, #050b10 100%)',
    display: 'flex', flexDirection: 'column',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: '#dde0e8', position: 'relative', overflow: 'hidden',
  },
  suit: {
    position: 'absolute', color: '#ffffff', opacity: 0.04,
    lineHeight: 1, pointerEvents: 'none', userSelect: 'none',
  },
  header: {
    background: 'rgba(10,15,25,0.85)', borderBottom: '1px solid #1a2a3a',
    backdropFilter: 'blur(10px)', flexShrink: 0, zIndex: 2,
  },
  headerInner: {
    maxWidth: 860, margin: '0 auto', padding: '12px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: {
    background: 'none', border: '1px solid #2a4a62', borderRadius: 7,
    padding: '6px 13px', color: '#4a7090', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', width: 100,
  },
  logo: { display: 'flex', alignItems: 'center', gap: 8 },
  logoText: { fontSize: 17, fontWeight: 900, color: '#e8f0ff', letterSpacing: '-0.3px' },
  content: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '40px 24px', zIndex: 1,
  },

  // Filters card
  card: {
    width: '100%', maxWidth: 480,
    background: 'linear-gradient(160deg, #131c2c 0%, #0c1420 100%)',
    border: '1px solid #2a3a52', borderRadius: 18, padding: '28px 28px 24px',
    display: 'flex', flexDirection: 'column', gap: 22,
    boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
  },
  cardTitle: { fontSize: 11, fontWeight: 800, color: '#3a6080', letterSpacing: '1.5px', textTransform: 'uppercase' },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  fieldLabel: { fontSize: 10, fontWeight: 800, color: '#3a6080', letterSpacing: '1px', textTransform: 'uppercase' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', fontSize: 13, color: '#7ab0d8', fontWeight: 600 },
  chipBtn: {
    background: 'none', border: '1px solid #2a3a52', borderRadius: 7,
    padding: '7px 13px', color: '#4a7090', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  chipBtnActive: { background: 'rgba(60,180,120,0.12)', border: '1px solid #3a8a5a', color: '#50d080' },
  errorMsg: {
    fontSize: 12, color: '#e07070', background: 'rgba(160,30,30,0.1)',
    border: '1px solid rgba(160,30,30,0.2)', borderRadius: 8, padding: '10px 14px',
  },
  noResults: {
    fontSize: 12, color: '#4a7090', background: 'rgba(30,60,90,0.1)',
    border: '1px solid rgba(30,60,90,0.2)', borderRadius: 8, padding: '10px 14px',
  },
  searchBtn: {
    background: 'linear-gradient(135deg, #1a3a20, #0c2014)', border: '1px solid #2a6a3a',
    borderRadius: 9, padding: '11px 28px', color: '#50d080', fontSize: 14, fontWeight: 800,
    cursor: 'pointer', boxShadow: '0 4px 20px rgba(20,100,50,0.3)',
  },

}
