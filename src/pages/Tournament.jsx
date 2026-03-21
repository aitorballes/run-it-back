import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchHands } from '../lib/db'
import { supabase } from '../lib/supabase'

const SUITS  = { h: '♥', d: '♦', s: '♠', c: '♣' }
const COLORS = { h: 'hearts', d: 'diamonds', s: 'spades', c: 'clubs' }
const RANKS  = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }

function HeroCard({ code }) {
  if (!code) return null
  const rank = code.slice(0, -1)
  const suit = code.slice(-1).toLowerCase()
  const r    = RANKS[rank] || rank
  const s    = SUITS[suit] || suit
  const col  = COLORS[suit] || 'spades'
  const bg   = { hearts: '#c0202a', diamonds: '#1a50c8', spades: '#222230', clubs: '#1a8a2a' }[col]
  return (
    <div style={{ ...styles.card, background: bg }}>
      <span style={styles.cardSuit}>{s}</span>
      <span style={styles.cardRank}>{r}</span>
    </div>
  )
}

function fmtChips(n) {
  return n?.toLocaleString('es-ES') ?? '—'
}

export default function Tournament() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [tournament, setTournament] = useState(null)
  const [hands, setHands]           = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const { data: t } = await supabase
          .from('tournaments')
          .select('id, name, date, hands_count')
          .eq('id', id)
          .single()
        setTournament(t)

        const handsData = await fetchHands(id)
        setHands(handsData)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    const m = dateStr.match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : dateStr
  }

  return (
    <div style={styles.container}>
      {/* HEADER */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>
          ← Torneos
        </button>
        <div style={styles.headerCenter}>
          <div style={styles.tournamentName}>{tournament?.name ?? '...'}</div>
          {tournament && (
            <div style={styles.tournamentMeta}>
              {formatDate(tournament.date)} · {tournament.hands_count} manos
            </div>
          )}
        </div>
        <div style={{ width: 100 }} />
      </div>

      {/* HANDS LIST */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.hint}>Cargando manos...</div>
        ) : hands.length === 0 ? (
          <div style={styles.hint}>No hay manos en este torneo.</div>
        ) : (
          <div style={styles.list}>
            {hands.map((hand, i) => {
              const holeCards = hand.hole_cards?.Hero ?? []
              const net       = hand.net ?? 0
              const result    = hand.hero_result
              const resultTxt = result === 'won' ? 'Ganó' : result === 'folded' ? 'Fold' : 'Perdió'
              const resultCls = result === 'won' ? '#30a860' : result === 'folded' ? '#556070' : '#d04040'
              const netColor  = net > 0 ? '#30a860' : net < 0 ? '#d04040' : '#506070'
              const netStr    = (net >= 0 ? '+' : '') + fmtChips(net)

              return (
                <div
                  key={hand.id}
                  style={styles.handRow}
                  onClick={() => navigate(`/tournament/${id}/hand/${hand.id}`)}
                >
                  {/* Cartas */}
                  <div style={styles.cards}>
                    {holeCards.length > 0
                      ? holeCards.map((c, ci) => <HeroCard key={ci} code={c} />)
                      : [0, 1].map(ci => <div key={ci} style={styles.cardBack} />)
                    }
                  </div>

                  {/* Info */}
                  <div style={styles.handInfo}>
                    <div style={styles.handNum}>#{i + 1}</div>
                    <div style={{ ...styles.result, color: resultCls }}>{resultTxt}</div>
                  </div>

                  {/* Neto */}
                  <div style={{ ...styles.net, color: netColor }}>{netStr}</div>
                </div>
              )
            })}
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
  backBtn: {
    background: 'none',
    border: '1px solid #2a3a50',
    borderRadius: '5px',
    color: '#5080a8',
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '700',
    width: 100,
  },
  headerCenter: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  },
  tournamentName: {
    fontSize: '15px',
    fontWeight: '800',
    color: '#90b8e0',
  },
  tournamentMeta: {
    fontSize: '11px',
    color: '#4a6a88',
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '32px 24px',
  },
  hint: {
    fontSize: '13px',
    color: '#4a5568',
    marginTop: '60px',
  },
  list: {
    width: '100%',
    maxWidth: '500px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  handRow: {
    background: '#0f1520',
    border: '1px solid #1e2a3a',
    borderRadius: '8px',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  cards: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  card: {
    width: '32px',
    height: '46px',
    borderRadius: '5px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.6)',
  },
  cardSuit: {
    fontSize: '18px',
    color: '#fff',
    lineHeight: 1,
  },
  cardRank: {
    fontSize: '11px',
    fontWeight: '900',
    color: '#fff',
    lineHeight: 1,
  },
  cardBack: {
    width: '32px',
    height: '46px',
    borderRadius: '5px',
    background: 'linear-gradient(145deg, #2a6a38, #163c1e)',
    border: '1px solid #1a4a28',
    boxShadow: '0 2px 5px rgba(0,0,0,0.6)',
  },
  handInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  handNum: {
    fontSize: '10px',
    color: '#2e4050',
    fontWeight: '700',
  },
  result: {
    fontSize: '13px',
    fontWeight: '800',
  },
  net: {
    fontSize: '13px',
    fontWeight: '800',
    flexShrink: 0,
  },
}
