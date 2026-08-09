import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { generateHandShareToken, fetchHandByShareToken, fetchHandNotes, saveHandNote, createSharedList, fetchSharedList, fetchHandsByIds, fetchUserReviewLists, fetchMarkedHandIds, fetchListsForHand, addHandToList, removeHandFromList, createReviewList } from '../lib/db'
import { calculateEquity } from '../lib/equityCalculator'
import StudyModal from '../components/StudyModal'
import ggIcon from '../assets/ggpoker.png'
import wmIcon from '../assets/winamax.png'
import icon888 from '../assets/888poker.png'
import coinIcon from '../assets/coinpoker.png'
import ipokerIcon from '../assets/ipoker.png'
import psIcon from '../assets/pokerstars.png'

// ── Card image assets ──────────────────────────────────────────────────
const cardImages = import.meta.glob('../assets/card_deck/*.png', { eager: true })
function getCardImage(code) {
  if (!code) return null
  const rank = code.slice(0, -1)
  const suit = code.slice(-1).toLowerCase()
  return cardImages[`../assets/card_deck/${rank}${suit}.png`]?.default ?? null
}

// ── Constants ─────────────────────────────────────────────────────────
const SUITS       = { h: '♥', d: '♦', s: '♠', c: '♣' }
const COLORS      = { h: 'hearts', d: 'diamonds', s: 'spades', c: 'clubs' }
const RANKS       = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
const SUIT_BG     = { hearts: '#c0202a', diamonds: '#1a50c8', spades: '#222230', clubs: '#1a8a2a' }
const STREET_ORDER = ['preflop', 'flop', 'turn', 'river']
const STREET_LABEL = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' }
const DECK_RANKS   = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
const DECK_SUITS   = ['s','h','d','c']
const CX = 400, CY = 270, RX = 368, RY = 228

// ── Range grid ────────────────────────────────────────────────────────
const GRID_RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2']
const RANK_VAL   = Object.fromEntries(GRID_RANKS.map((r, i) => [r, 12 - i]))

function holeCardsToCombo(cards) {
  if (!cards || cards.length !== 2) return null
  const r1 = cards[0].slice(0, -1), s1 = cards[0].slice(-1)
  const r2 = cards[1].slice(0, -1), s2 = cards[1].slice(-1)
  if (RANK_VAL[r1] == null || RANK_VAL[r2] == null) return null
  const [hi, lo] = RANK_VAL[r1] >= RANK_VAL[r2] ? [[r1,s1],[r2,s2]] : [[r2,s2],[r1,s1]]
  if (hi[0] === lo[0]) return hi[0] + lo[0]
  return hi[0] + lo[0] + (hi[1] === lo[1] ? 's' : 'o')
}

function gridCellLabel(row, col) {
  const r = GRID_RANKS[row], c = GRID_RANKS[col]
  if (row === col) return r + c
  if (row < col)  return r + c + 's'
  return c + r + 'o'
}

// Combo count per hand type: 6 for pairs, 4 for suited, 12 for offsuit (1326 total combos in a deck).
const TOTAL_COMBOS = 1326
function comboWeight(label) {
  if (label.length === 2) return 6
  return label.endsWith('s') ? 4 : 12
}

// Position labels by offset from BTN (clockwise), indexed by table size
const POS_LABELS = {
  2:  ['BTN','BB'],
  3:  ['BTN','SB','BB'],
  4:  ['BTN','SB','BB','CO'],
  5:  ['BTN','SB','BB','HJ','CO'],
  6:  ['BTN','SB','BB','LJ','HJ','CO'],
  7:  ['BTN','SB','BB','UTG','LJ','HJ','CO'],
  8:  ['BTN','SB','BB','UTG','UTG+1','LJ','HJ','CO'],
  9:  ['BTN','SB','BB','UTG','UTG+1','MP','LJ','HJ','CO'],
  10: ['BTN','SB','BB','UTG','UTG+1','MP','MP+1','LJ','HJ','CO'],
}

function getPositionLabel(seatNum, seats, buttonSeatNum) {
  const sorted = [...seats].sort((a, b) => a.num - b.num)
  const n = sorted.length
  const btnIdx = sorted.findIndex(s => s.num === buttonSeatNum)
  if (btnIdx < 0) return ''
  const seatIdx = sorted.findIndex(s => s.num === seatNum)
  if (seatIdx < 0) return ''
  const offset = (seatIdx - btnIdx + n) % n
  return (POS_LABELS[n] ?? [])[offset] ?? ''
}
const FELT_IRX = 318, FELT_IRY = 182  // felt inner semi-axes (inside the rail)

// Returns a point just inside the felt rim in the direction of seat (px,py)
function feltRim(px, py, inset = 0) {
  const dx = px - CX, dy = py - CY
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return { x: CX, y: CY }
  const nx = dx / len, ny = dy / len
  const a = FELT_IRX - inset, b = FELT_IRY - inset
  const r = (a * b) / Math.sqrt(b * b * nx * nx + a * a * ny * ny)
  return { x: CX + nx * r, y: CY + ny * r }
}

// Returns a point `gap` px outside the near face of the seat container, toward center.
// W/H are the approximate half-extents of the seat box (cards + badge + seat).
function seatEdge(px, py, gap) {
  const dx = px - CX, dy = py - CY
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return { x: CX, y: CY }
  const nx = dx / len, ny = dy / len
  const extent = Math.abs(nx) * 57 + Math.abs(ny) * 80 // half-width=57, half-height=80
  const d = Math.max(0, len - extent - gap)
  return { x: CX + nx * d, y: CY + ny * d }
}

// ── Helpers ───────────────────────────────────────────────────────────
const fmtChips = n => (n ?? 0).toLocaleString('es-ES')
const makeFmt  = (displayBB, bb) => n => {
  if (displayBB && bb > 0) {
    const bbs = n / bb
    return (Number.isInteger(bbs) ? bbs.toString() : bbs.toFixed(1).replace(/\.0$/, '')) + ' BB'
  }
  return fmtChips(n)
}
const streetIdx = s => STREET_ORDER.indexOf(s)
const fmtSearchDuration = ms => ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`

function seatPositions(n) {
  return Array.from({ length: n }, (_, i) => {
    const rad = (180 + 360 * i / n) * Math.PI / 180
    return { x: CX + RX * Math.sin(rad), y: CY - RY * Math.cos(rad) }
  })
}

function getFoldedByStep(hand, upTo) {
  const s = new Set()
  for (let i = 0; i < upTo; i++) {
    const step = hand.sequence[i]
    if (step?.type === 'action') {
      const a = hand.actions[step.street]?.[step.idx]
      if (a?.type === 'fold') s.add(a.player)
    }
  }
  return s
}

function getAllinByStep(hand, upTo) {
  const s = new Set()
  for (let i = 0; i <= upTo; i++) {
    const step = hand.sequence[i]
    if (step?.type === 'action') {
      const a = hand.actions[step.street]?.[step.idx]
      if (a?.allin) s.add(a.player)
    }
  }
  return s
}

function getPotByStep(hand, stepIdx) {
  if (!hand.sequence.length || stepIdx < 0) return 0

  let pot = 0
  // Track total committed per player per street to handle raise increments correctly
  const committed = new Map() // 'street:player' → total committed this street

  const maxStep = Math.min(stepIdx, hand.sequence.length - 1)
  for (let i = 0; i <= maxStep; i++) {
    const step = hand.sequence[i]
    if (!step || step.type !== 'action') continue
    const a = hand.actions[step.street]?.[step.idx]
    if (!a) continue

    const key = `${step.street}:${a.player}`
    const prev = committed.get(key) ?? 0

    if (['post-sb', 'post-bb', 'bet'].includes(a.type) && a.amount > 0) {
      pot += a.amount
      committed.set(key, prev + a.amount)
    } else if (a.type === 'call' && a.amount > 0) {
      pot += a.amount
      committed.set(key, prev + a.amount)
    } else if (a.type === 'raise' && a.amount > 0) {
      // raise.amount is the total raise-to, not the increment
      const increment = Math.max(0, a.amount - prev)
      pot += increment
      committed.set(key, a.amount)
    } else if (a.type === 'uncalled' && a.amount > 0) {
      pot -= a.amount
    }
  }

  // Antes are not in the sequence — approximate with ante × seats
  if (hand.ante > 0) pot += hand.ante * hand.seats.length

  return pot
}

function getStacksByStep(hand, stepIdx) {
  const stacks = new Map()
  for (const seat of hand.seats) {
    stacks.set(seat.player, seat.chips - (hand.ante > 0 ? hand.ante : 0))
  }
  if (!hand.sequence.length || stepIdx < 0) return stacks

  const committed = new Map() // 'street:player' → total committed this street
  const maxStep = Math.min(stepIdx, hand.sequence.length - 1)
  for (let i = 0; i <= maxStep; i++) {
    const step = hand.sequence[i]
    if (!step || step.type !== 'action') continue
    const a = hand.actions[step.street]?.[step.idx]
    if (!a) continue

    const key = `${step.street}:${a.player}`
    const prev = committed.get(key) ?? 0
    const cur = stacks.get(a.player) ?? 0

    if (['post-sb', 'post-bb', 'bet', 'call'].includes(a.type) && a.amount > 0) {
      stacks.set(a.player, cur - a.amount)
      committed.set(key, prev + a.amount)
    } else if (a.type === 'raise' && a.amount > 0) {
      const increment = Math.max(0, a.amount - prev)
      stacks.set(a.player, cur - increment)
      committed.set(key, a.amount)
    } else if (a.type === 'uncalled' && a.amount > 0) {
      stacks.set(a.player, cur + a.amount)
    }
  }
  return stacks
}

function getBetsByStep(hand, stepIdx) {
  const bets = new Map()
  if (!hand.sequence.length || stepIdx < 0) return bets
  const cur = hand.sequence[Math.min(stepIdx, hand.sequence.length - 1)]
  const streetStart = hand.streetStartStep[cur.street] ?? 0
  for (let i = streetStart; i <= stepIdx; i++) {
    const step = hand.sequence[i]
    if (!step || step.type !== 'action') continue
    const a = hand.actions[step.street]?.[step.idx]
    if (!a) continue
    if (['post-sb', 'post-bb', 'call', 'raise', 'bet'].includes(a.type) && a.amount > 0) {
      bets.set(a.player, a.amount)
    } else if (a.type === 'fold' || a.type === 'uncalled') {
      bets.delete(a.player)
    }
  }
  return bets
}

function heroFoldedPreflop(hand) {
  return (hand.actions?.preflop ?? []).some(a => a.player === 'Hero' && a.type === 'fold')
}

function heroNet(hand) {
  const heroSeat = hand.seats.find(s => s.player === 'Hero')
  if (!heroSeat) return null
  let inv = hand.ante
  if (heroSeat.pos === 'SB') inv += hand.sb
  if (heroSeat.pos === 'BB') inv += hand.bb
  const all = [...hand.actions.preflop, ...hand.actions.flop, ...hand.actions.turn, ...hand.actions.river]
  for (const a of all) {
    if (a.player !== 'Hero') continue
    if (['call','raise','bet'].includes(a.type)) inv += a.amount
    if (a.type === 'uncalled') inv -= a.amount
  }
  const won = hand.winners.filter(w => w.player === 'Hero').reduce((s, w) => s + w.amount, 0)
  return won - inv
}

// ── Sub-components ────────────────────────────────────────────────────
function Card({ code, size = 'sm' }) {
  if (!code) return null
  const img = getCardImage(code)
  const d = { sm: [44,62], md: [58,82], lg: [70,98] }[size]
  if (img) {
    return (
      <img src={img} alt={code} width={d[0]} height={d[1]}
        style={{ borderRadius:7, boxShadow:'0 2px 6px rgba(0,0,0,0.6)', flexShrink:0, display:'block' }} />
    )
  }
  // Fallback: render CSS card if image not found
  const rank = code.slice(0, -1)
  const suit = code.slice(-1).toLowerCase()
  const r  = RANKS[rank] || rank
  const s  = SUITS[suit] || suit
  const bg = SUIT_BG[COLORS[suit]] || '#222'
  const fd = { sm: [44,62,26,13,4], md: [58,82,36,16,5], lg: [70,98,44,19,6] }[size]
  return (
    <div style={{ width:fd[0], height:fd[1], background:bg, borderRadius:7, border:'1px solid rgba(0,0,0,0.3)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      fontWeight:900, lineHeight:1, boxShadow:'0 2px 6px rgba(0,0,0,0.6)', userSelect:'none',
      position:'relative', color:'#fff', flexShrink:0 }}>
      <div style={{ position:'absolute', top:fd[4], left:fd[4]+1, fontSize:fd[3], fontWeight:900, lineHeight:1 }}>{r}</div>
      <span style={{ fontSize:fd[2], lineHeight:1 }}>{s}</span>
    </div>
  )
}

function CardBack({ size = 'sm' }) {
  const d = { sm:[44,62], md:[58,82], lg:[70,98] }[size]
  return (
    <div style={{ width:d[0], height:d[1], flexShrink:0, borderRadius:7, position:'relative', overflow:'hidden',
      background:'linear-gradient(145deg, #a01818 0%, #6a0c0c 50%, #460808 100%)',
      border:'2px solid #801010',
      boxShadow:'0 2px 8px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,80,80,.15)' }}>
      <div style={{ position:'absolute', inset:4, border:'1px solid rgba(200,60,60,0.25)', borderRadius:3 }} />
      <div style={{ position:'absolute', inset:7, border:'1px solid rgba(200,60,60,0.15)', borderRadius:2 }} />
    </div>
  )
}

function badgeInfo(action, fmt = fmtChips) {
  const amt = action.amount > 0 ? ` ${fmt(action.amount)}` : ''
  const map = {
    fold:    ['#232b38','#6a7a90','#3a4555', '✗ FOLD'],
    check:   ['#142040','#60a0e0','#2a4070', '✓ CHECK'],
    'post-sb':['#102038','#50b0e0','#1e4060',`SB${amt}`],
    'post-bb':['#103018','#50d060','#205030',`BB${amt}`],
    won:     ['#282200','#ffe040','#504400', `★ WON${amt}`],
  }
  if (map[action.type]) {
    const [bg,color,border,label] = map[action.type]
    return { bg, color, border, label }
  }
  if (action.allin) return { bg:'#380a0a', color:'#ff6060', border:'#702020', label:`⚡ ALL-IN${amt}` }
  if (action.type === 'call')  return { bg:'#103040', color:'#40c0d0', border:'#1a5060', label:`→ CALL${amt}` }
  if (action.type === 'raise') return { bg:'#302800', color:'#e0c040', border:'#5a4800', label:`↑ RAISE${amt}` }
  if (action.type === 'bet')   return { bg:'#301800', color:'#e08040', border:'#5a3000', label:`↑ BET${amt}` }
  return { bg:'#1e2838', color:'#7090a0', border:'#3a4a55', label: action.type.toUpperCase() }
}

// ── Main Component ────────────────────────────────────────────────────
export default function Visualizer() {
  const { id, token, handToken, listToken } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const [tournament, setTournament] = useState(null)
  const [hands,      setHands]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [curIdx,     setCurIdx]     = useState(0)
  const [curStep,    setCurStep]    = useState(0)
  const [playing,    setPlaying]    = useState(false)
  const [scale,      setScale]      = useState(1)
  const [displayBB,  setDisplayBB]  = useState(true)
  const [showFilter,      setShowFilter]      = useState(false)
  const [filterPlayed,    setFilterPlayed]    = useState(false)
  const [filterCards,     setFilterCards]     = useState([])
  const [filterPositions, setFilterPositions] = useState([])
  const [draftPlayed,     setDraftPlayed]     = useState(false)
  const [draftCards,      setDraftCards]      = useState([])
  const [draftPositions,  setDraftPositions]  = useState([])
  const [handCopied,      setHandCopied]      = useState(false)
  const [listCopied,      setListCopied]      = useState(false)
  const [showMobileHands, setShowMobileHands] = useState(false)
  const [isMobile,        setIsMobile]        = useState(() => window.innerWidth < 768)

  const areaRef         = useRef()
  const timerRef        = useRef()
  const noteDebounceRef = useRef()

  const [handNotes,   setHandNotes]   = useState({})
  const [noteSaved,   setNoteSaved]   = useState(true)
  const textareaRef = useRef()

  const [showRangeModal,   setShowRangeModal]   = useState(false)
  const [rangeFilter,      setRangeFilter]      = useState(null) // null | 'raise' | 'fold' | 'call'
  const [isComboStudy,     setIsComboStudy]     = useState(false)
  const originalHandsRef = useRef(null)
  const [showStudyModal,   setShowStudyModal]   = useState(false)
  const [toast,            setToast]            = useState(null)

  const [userLists,        setUserLists]        = useState([])
  const [markedHandIds,    setMarkedHandIds]     = useState(new Set())
  const [showListPopover,  setShowListPopover]   = useState(false)
  const [handCurrentLists, setHandCurrentLists]  = useState(new Set()) // committed state (DB)
  const [popoverDraft,     setPopoverDraft]      = useState(new Set()) // draft (checkboxes)
  const [popoverLoading,   setPopoverLoading]    = useState(false)
  const [listSaving,       setListSaving]        = useState(false)
  const [newListName,      setNewListName]       = useState('')
  const [showNewListForm,  setShowNewListForm]   = useState(false)
  const [newListSaving,    setNewListSaving]     = useState(false)
  const popoverRef = useRef()

  // ── Range map (aggregated across all loaded hands) ──
  const rangeMap = useMemo(() => {
    const map = new Map()
    for (let i = 0; i < hands.length; i++) {
      const hand = hands[i]
      const cards = hand.holeCards?.Hero
      if (!cards || cards.length !== 2) continue
      const combo = holeCardsToCombo(cards)
      if (!combo) continue
      // Classify by the most aggressive preflop action Hero took, not just the first one —
      // a hand where Hero cold-calls then later 4-bets a squeeze is still a raised hand (PFR).
      const heroActs = (hand.actions?.preflop ?? []).filter(a => a.player === 'Hero' && !['post-sb', 'post-bb'].includes(a.type))
      const raised   = heroActs.some(a => a.type === 'raise' || a.type === 'bet')
      const folded   = heroActs.some(a => a.type === 'fold')
      if (!map.has(combo)) map.set(combo, { raise: 0, fold: 0, call: 0, firstIdx: i, firstRaiseIdx: -1, firstFoldIdx: -1, firstCallIdx: -1 })
      const e = map.get(combo)
      if (raised)      { e.raise++; if (e.firstRaiseIdx === -1) e.firstRaiseIdx = i }
      else if (folded) { e.fold++;  if (e.firstFoldIdx  === -1) e.firstFoldIdx  = i }
      else              { e.call++;  if (e.firstCallIdx  === -1) e.firstCallIdx  = i }
    }
    return map
  }, [hands])

  const rangePct = useMemo(() => {
    let combos = 0
    for (const [label, data] of rangeMap.entries()) {
      const matches = rangeFilter === 'raise' ? data.raise > 0
                    : rangeFilter === 'fold'  ? data.fold > 0
                    : rangeFilter === 'call'  ? data.call > 0
                    : true
      if (matches) combos += comboWeight(label)
    }
    return (combos / TOTAL_COMBOS) * 100
  }, [rangeMap, rangeFilter])
  const rangePctLabel = rangeFilter === 'raise' ? 'del rango subido'
                       : rangeFilter === 'fold'  ? 'del rango foldeado'
                       : rangeFilter === 'call'  ? 'del rango pagado'
                       : 'del rango jugado'

  // ── Load ──
  useEffect(() => {
    async function load() {
      try {
        if (location.state?.studyHands) {
          const rows = location.state.studyHands
          setTournament({ name: 'Búsqueda', isStudy: true })
          setHands(rows.map(row => ({ ...row.raw, _dbId: row.id, _tournamentName: row.tournamentName })))
          if (location.state.searchDurationMs != null) {
            setToast(`${rows.length.toLocaleString('es-ES')} manos · búsqueda en ${fmtSearchDuration(location.state.searchDurationMs)}`)
            setTimeout(() => setToast(null), 4000)
          }
          if (user) {
            fetchUserReviewLists(user.id).then(setUserLists)
            const ids = rows.map(row => row.id)
            const [nts, marked] = await Promise.all([
              fetchHandNotes(ids, user.id),
              fetchMarkedHandIds(ids, user.id),
            ])
            setHandNotes(nts)
            setMarkedHandIds(marked)
          }
          setLoading(false)
          return
        }
        if (listToken) {
          const handIds = await fetchSharedList(listToken)
          const rows = await fetchHandsByIds(handIds)
          setTournament({ name: 'Lista compartida', isSharedList: true })
          const mapped = rows.map(r => ({ ...r.raw, _dbId: r.id, _tournamentName: r.tournamentName }))
          setHands(mapped)
          if (user) {
            fetchUserReviewLists(user.id).then(setUserLists)
            const ids = mapped.map(h => h._dbId)
            const [nts, marked] = await Promise.all([
              fetchHandNotes(ids, user.id),
              fetchMarkedHandIds(ids, user.id),
            ])
            setHandNotes(nts)
            setMarkedHandIds(marked)
          }
          return
        }
        if (handToken) {
          const row = await fetchHandByShareToken(handToken)
          const { data: t } = await supabase.from('tournaments').select('*').eq('id', row.tournament_id).single()
          setTournament(t)
          setHands([{ ...row.raw, _dbId: row.id }])
          if (user) {
            fetchUserReviewLists(user.id).then(setUserLists)
            const [nts, marked] = await Promise.all([
              fetchHandNotes([row.id], user.id),
              fetchMarkedHandIds([row.id], user.id),
            ])
            setHandNotes(nts)
            setMarkedHandIds(marked)
          }
          return
        }
        let t, tournamentId
        if (token) {
          const { data } = await supabase.from('tournaments').select('*').eq('share_token', token).single()
          t = data
          tournamentId = data?.id
        } else {
          const { data } = await supabase.from('tournaments').select('*').eq('id', id).single()
          t = data
          tournamentId = id
        }
        setTournament(t)
        if (!tournamentId) return
        const { data: rows } = await supabase
          .from('hands').select('id, raw').eq('tournament_id', tournamentId).order('id', { ascending: true })
        const sorted = (rows || [])
          .map(r => ({ ...r.raw, _dbId: r.id }))
          .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))
        setHands(sorted)
        if (user && sorted.length > 0) {
          fetchUserReviewLists(user.id).then(setUserLists)
          const ids = sorted.map(h => h._dbId)
          const [nts, marked] = await Promise.all([
            fetchHandNotes(ids, user.id),
            fetchMarkedHandIds(ids, user.id),
          ])
          setHandNotes(nts)
          setMarkedHandIds(marked)
        }
      } catch(e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [id, token, handToken])

  // ── Rescale ──
  useEffect(() => {
    function rescale() {
      const area = areaRef.current
      if (!area) return
      const mobile = window.innerWidth < 768
      const availW = area.clientWidth - (mobile ? 48 : 24)
      // Height formula derived analytically so table + controls + notes + seat overflow all fit:
      //   content_height(s) = s*540 (table) + s*80 (controls paddingTop) + 88 (nav) + 10 (gap) + 142 (notes) + 20 (gaps) = s*620 + 260
      //   seat_overflow(s)  = 23 * s  (top seats extend ~23px above canvas top)
      //   require: s*620 + 260 + 2*(23*s) ≤ h - 40  → s ≤ (h - 300) / 666
      const scaleFromH = mobile
        ? (area.clientHeight - 200) / 540
        : (area.clientHeight - 300) / 666
      setScale(Math.max(0.2, Math.min(availW / 800, scaleFromH, 1.0)))
    }
    rescale()
    window.addEventListener('resize', rescale)
    return () => window.removeEventListener('resize', rescale)
  }, [loading])

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  // ── Autoplay ──
  useEffect(() => {
    clearInterval(timerRef.current)
    if (!playing) return
    timerRef.current = setInterval(() => {
      setCurStep(prev => {
        const hand = hands[curIdx]
        if (!hand) return prev
        if (prev < hand.sequence.length - 1) return prev + 1
        setPlaying(false)
        return prev
      })
    }, 750)
    return () => clearInterval(timerRef.current)
  }, [playing, curIdx, hands])

  // ── Sync note on hand change ──
  useEffect(() => {
    const dbId = hands[curIdx]?._dbId
    clearTimeout(noteDebounceRef.current)
    if (textareaRef.current) textareaRef.current.value = dbId ? (handNotes[dbId] ?? '') : ''
    setNoteSaved(true)
  }, [curIdx, hands])

  useEffect(() => () => clearTimeout(noteDebounceRef.current), [])

  // ── Keyboard ──
  useEffect(() => {
    function onKey(e) {
      if (['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName)) return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      if (e.shiftKey) {
        if (e.key === 'ArrowLeft')  goHand(displayHandsWithIdx[dispIdx - 1]?.i)
        if (e.key === 'ArrowRight') goHand(displayHandsWithIdx[dispIdx + 1]?.i)
      } else {
        if (e.key === 'ArrowLeft')  { setPlaying(false); setCurStep(s => Math.max(0, s - 1)) }
        if (e.key === 'ArrowRight') { setPlaying(false); setCurStep(s => {
          const h = hands[curIdx]; return h ? Math.min(h.sequence.length - 1, s + 1) : s
        })}
        if (e.key === 'ArrowUp')   { e.preventDefault(); goHand(displayHandsWithIdx[dispIdx - 1]?.i) }
        if (e.key === 'ArrowDown') { e.preventDefault(); goHand(displayHandsWithIdx[dispIdx + 1]?.i) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [curIdx, hands, filterPlayed, filterCards, filterPositions])

  useEffect(() => {
    if (!showListPopover) return
    const onKey = e => { if (e.key === 'Escape') setShowListPopover(false) }
    const onClick = e => { if (popoverRef.current && !popoverRef.current.contains(e.target)) setShowListPopover(false) }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [showListPopover])

  async function applyStudyHands(rows, filters, elapsedMs) {
    setTournament({ name: 'Búsqueda', isStudy: true })
    setHands(rows.map(row => ({ ...row.raw, _dbId: row.id, _tournamentName: row.tournamentName })))
    setCurIdx(0); setCurStep(0)
    if (elapsedMs != null) {
      setToast(`${rows.length.toLocaleString('es-ES')} manos · búsqueda en ${fmtSearchDuration(elapsedMs)}`)
      setTimeout(() => setToast(null), 4000)
    }
    if (user) {
      fetchUserReviewLists(user.id).then(setUserLists)
      const ids = rows.map(row => row.id)
      const [nts, marked] = await Promise.all([
        fetchHandNotes(ids, user.id),
        fetchMarkedHandIds(ids, user.id),
      ])
      setHandNotes(nts)
      setMarkedHandIds(marked)
    }
    setShowStudyModal(false)
    navigate(location.pathname, { replace: true, state: { studyHands: rows, studyFilters: filters, searchDurationMs: elapsedMs } })
  }

  function goHand(idx) {
    if (idx == null || idx < 0 || idx >= hands.length) return
    setPlaying(false); setCurIdx(idx); setCurStep(0); setShowMobileHands(false)
  }

  function openFilter() {
    setDraftPlayed(filterPlayed)
    setDraftCards([...filterCards])
    setDraftPositions([...filterPositions])
    setShowFilter(true)
  }
  function applyFilter() {
    setFilterPlayed(draftPlayed)
    setFilterCards(draftCards)
    setFilterPositions(draftPositions)
    setShowFilter(false)
    // Jump to first hand that passes the new filter
    const firstIdx = hands.findIndex(h => {
      if (draftPlayed && heroFoldedPreflop(h)) return false
      if (draftCards.length > 0 && !draftCards.every(c => (h.holeCards?.Hero ?? []).includes(c))) return false
      if (draftPositions.length > 0) {
        const heroSeat = h.seats.find(s => s.player === 'Hero')
        const heroPos  = heroSeat ? getPositionLabel(heroSeat.num, h.seats, h.buttonSeat) : ''
        if (!draftPositions.includes(heroPos)) return false
      }
      return true
    })
    if (firstIdx >= 0) { setCurIdx(firstIdx); setCurStep(0); setPlaying(false) }
  }
  function clearFilter() {
    setFilterPlayed(false); setFilterCards([]); setFilterPositions([])
    setDraftPlayed(false);  setDraftCards([]);  setDraftPositions([])
    setShowFilter(false)
  }
  function toggleDraftCard(code) {
    setDraftCards(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code)
      if (prev.length >= 2) return [prev[1], code]
      return [...prev, code]
    })
  }
  function toggleDraftPosition(pos) {
    setDraftPositions(prev =>
      prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
    )
  }

  async function shareCurrentHand() {
    const dbId = hands[curIdx]?._dbId
    if (!dbId) return
    try {
      const t = await generateHandShareToken(dbId)
      await navigator.clipboard.writeText(`${window.location.origin}/hand-share/${t}`)
      setHandCopied(true)
      setTimeout(() => setHandCopied(false), 2500)
    } catch(e) { console.error(e) }
  }

  async function shareHandList() {
    const ids = displayHandsWithIdx.map(({ h }) => h._dbId).filter(Boolean)
    if (!ids.length || !user) return
    try {
      const t = await createSharedList(ids, user.id)
      await navigator.clipboard.writeText(`${window.location.origin}/list-share/${t}`)
      setListCopied(true)
      setTimeout(() => setListCopied(false), 2500)
    } catch(e) { console.error(e) }
  }

  function handleNoteChange(e) {
    const text = e.target.value
    const dbId = hands[curIdx]?._dbId
    setNoteSaved(false)
    clearTimeout(noteDebounceRef.current)
    if (!user || !dbId) return
    noteDebounceRef.current = setTimeout(async () => {
      try {
        await saveHandNote(dbId, user.id, text)
        setHandNotes(prev => ({ ...prev, [dbId]: text }))
        setNoteSaved(true)
      } catch (err) {
        console.error('Error saving note:', err)
      }
    }, 800)
  }

  async function openListPopover() {
    const dbId = hands[curIdx]?._dbId
    if (!user || !dbId || popoverLoading) return
    setPopoverLoading(true)
    setShowListPopover(true)
    setShowNewListForm(false)
    setNewListName('')
    try {
      const [lists, currentLists] = await Promise.all([
        fetchUserReviewLists(user.id),
        fetchListsForHand(dbId, user.id),
      ])
      setUserLists(lists)
      setHandCurrentLists(currentLists)
      setPopoverDraft(new Set(currentLists))
    } catch (err) { console.error(err) }
    finally { setPopoverLoading(false) }
  }

  function toggleDraftList(listId) {
    setPopoverDraft(prev => {
      const n = new Set(prev)
      n.has(listId) ? n.delete(listId) : n.add(listId)
      return n
    })
  }

  async function saveListChanges() {
    const dbId = hands[curIdx]?._dbId
    if (!user || !dbId) return
    setListSaving(true)
    try {
      const toAdd    = [...popoverDraft].filter(id => !handCurrentLists.has(id))
      const toRemove = [...handCurrentLists].filter(id => !popoverDraft.has(id))
      await Promise.all([
        ...toAdd.map(id => addHandToList(id, dbId)),
        ...toRemove.map(id => removeHandFromList(id, dbId)),
      ])
      setHandCurrentLists(new Set(popoverDraft))
      const isMarked = popoverDraft.size > 0
      setMarkedHandIds(prev => { const n = new Set(prev); isMarked ? n.add(dbId) : n.delete(dbId); return n })
      setShowListPopover(false)
    } catch (err) { console.error(err) }
    finally { setListSaving(false) }
  }

  async function handleCreateList() {
    const dbId = hands[curIdx]?._dbId
    if (!user || !newListName.trim()) return
    setNewListSaving(true)
    try {
      const newList = await createReviewList(user.id, newListName.trim())
      const refreshed = await fetchUserReviewLists(user.id)
      setUserLists(refreshed)
      // Add to draft so it shows as checked — user still needs to hit Guardar
      setPopoverDraft(prev => new Set([...prev, newList.id]))
      setNewListName('')
      setShowNewListForm(false)
    } catch (err) { console.error(err) }
    finally { setNewListSaving(false) }
  }

  function jumpToStreet(street) {
    const h = hands[curIdx]
    const start = h?.streetStartStep[street]
    if (start != null) setCurStep(start)
  }

  // Showdown equity — must be before conditional returns (Rules of Hooks)
  const showdownCards = useMemo(() => {
    const h = hands[curIdx]
    if (!h?.holeCards) return {}
    return Object.fromEntries(
      Object.entries(h.holeCards).filter(([name]) =>
        h.seats.some(s => s.player === name && !s.folded)
      )
    )
  }, [hands, curIdx])
  const isShowdown = Object.keys(showdownCards).length >= 2

  const equity = useMemo(() => {
    if (!isShowdown) return null
    const h = hands[curIdx]
    if (!h) return null
    const step   = h.sequence[curStep] ?? h.sequence[0]
    const sv     = STREET_ORDER.indexOf(step?.street ?? 'preflop')
    const board  = []
    if (sv >= 1) board.push(...h.board.flop)
    if (sv >= 2 && h.board.turn)  board.push(h.board.turn)
    if (sv >= 3 && h.board.river) board.push(h.board.river)
    return calculateEquity(showdownCards, board)
  }, [isShowdown, showdownCards, hands, curIdx, curStep])

  if (loading) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Cargando...</div>
  if (!tournament && (token || handToken)) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Contenido no encontrado o enlace inválido.</div>
  if (!hands.length) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Sin manos.</div>

  const hasFilters = filterPlayed || filterCards.length > 0 || filterPositions.length > 0
  const displayHandsWithIdx = hands
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => {
      if (filterPlayed && heroFoldedPreflop(h)) return false
      if (filterCards.length > 0) {
        const heroCards = h.holeCards?.Hero ?? []
        if (!filterCards.every(c => heroCards.includes(c))) return false
      }
      if (filterPositions.length > 0) {
        const heroSeat = h.seats.find(s => s.player === 'Hero')
        const heroPos  = heroSeat ? getPositionLabel(heroSeat.num, h.seats, h.buttonSeat) : ''
        if (!filterPositions.includes(heroPos)) return false
      }
      return true
    })
  const dispIdx = displayHandsWithIdx.findIndex(({ i }) => i === curIdx)

  const hand    = hands[curIdx]
  const seq     = hand.sequence
  const step    = seq[curStep] ?? seq[0]
  const street  = step?.street ?? 'preflop'
  const vi      = streetIdx(street)

  const foldedPlayers = getFoldedByStep(hand, curStep)
  const allinPlayers  = getAllinByStep(hand, curStep)
  const winnerPlayers = curStep === seq.length - 1
    ? new Set(hand.winners.map(w => w.player)) : new Set()
  // Show cards face-up when someone is all-in and no more real betting actions remain.
  // 'uncalled', 'won', 'post-sb', 'post-bb' are not betting decisions — exclude them.
  const PASSIVE_TYPES = new Set(['uncalled', 'won', 'post-sb', 'post-bb'])
  const remainingActions = seq.slice(curStep + 1).some(s => {
    if (s.type !== 'action') return false
    const a = hand.actions[s.street]?.[s.idx]
    return a != null && !PASSIVE_TYPES.has(a.type)
  })
  const allInRunout = allinPlayers.size >= 1 && !remainingActions && curStep < seq.length - 1

  let activePlayer = null, activeAction = null
  if (step?.type === 'action') {
    activeAction = hand.actions[street]?.[step.idx]
    activePlayer = activeAction?.player
  }

  const fmt        = makeFmt(displayBB, hand.bb)
  const bets       = getBetsByStep(hand, curStep)
  const stacks     = getStacksByStep(hand, curStep)
  const runningPot = getPotByStep(hand, curStep)
  const boardCards = []
  if (vi >= 1) boardCards.push(...hand.board.flop)
  if (vi >= 2 && hand.board.turn)  boardCards.push(hand.board.turn)
  if (vi >= 3 && hand.board.river) boardCards.push(hand.board.river)

  const heroIdx = hand.seats.findIndex(s => s.player === 'Hero')
  const ordered = heroIdx >= 0
    ? [...hand.seats.slice(heroIdx), ...hand.seats.slice(0, heroIdx)]
    : hand.seats
  const positions = seatPositions(ordered.length)
  const totalWon  = hand.winners.reduce((s, w) => s + w.amount, 0) || hand.totalPot

  return (
    <div style={page}>

      {/* ── HEADER ── */}
      <div style={hdr.root}>
        {!token && !handToken && !listToken && !isComboStudy && <button style={hdr.back} onClick={() => navigate('/')}>{isMobile ? '←' : '← Torneos'}</button>}
        {!token && !handToken && !listToken && !isComboStudy && tournament?.isStudy && (
          <button style={hdr.studyBtn} onClick={() => setShowStudyModal(true)}>
            {isMobile ? '🎓' : '🎓 Estudia tu juego'}
          </button>
        )}
        {isComboStudy && (
          <button style={hdr.back} onClick={() => {
            setHands(originalHandsRef.current)
            originalHandsRef.current = null
            setIsComboStudy(false)
            setCurIdx(0)
            setCurStep(0)
            setShowRangeModal(true)
          }}>{isMobile ? '←' : '← Rango'}</button>
        )}
        {(token || handToken || listToken) && (
          <a href="#" style={hdr.logo} onClick={e => { e.preventDefault(); navigate(user ? '/' : '/login') }}>
            <span style={hdr.logoSpade}>♠</span>
            <span style={hdr.logoText}>RunItBack</span>
          </a>
        )}
        <div style={hdr.center}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <img
              src={{ winamax: wmIcon, '888poker': icon888, coinpoker: coinIcon, ipoker: ipokerIcon, pokerstars: psIcon }[tournament?.platform] ?? ggIcon}
              alt={tournament?.platform || 'ggpoker'}
              style={{ width:22, height:22, borderRadius:5, objectFit:'contain', flexShrink:0 }}
            />
            <span style={hdr.name}>{hand._tournamentName ?? tournament?.name}</span>
          </div>
          <span style={hdr.level}>Nivel {hand.level} · {fmtChips(hand.sb)}/{fmtChips(hand.bb)}</span>
          <span style={hdr.meta}>Mesa {hand.tableNum} · {hand.datetime}</span>
        </div>
        {!handToken && isMobile && (
          <button style={hdr.handsBtn} onClick={() => setShowMobileHands(true)}>
            ☰ {dispIdx+1}/{displayHandsWithIdx.length}
          </button>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0, marginLeft:'auto' }}>
          {!handToken && (
            <button style={{ ...hdr.filterBtn, ...(hasFilters ? hdr.filterBtnActive : {}) }} onClick={openFilter}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="7"/>
                <line x1="16.5" y1="16.5" x2="22" y2="22"/>
              </svg>
              {!isMobile && 'Filtrar'}
              {hasFilters && <span style={hdr.filterDot} />}
            </button>
          )}
          {!handToken && tournament?.isStudy && (
            <button style={{ ...hdr.filterBtn, display:'flex', alignItems:'center', gap:5 }}
              onClick={() => setShowRangeModal(true)}
              title="Ver rango de manos">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3"  y="3"  width="7" height="7" rx="1"/>
                <rect x="14" y="3"  width="7" height="7" rx="1"/>
                <rect x="3"  y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              {!isMobile && 'Rango'}
            </button>
          )}
          {!token && !handToken && (
            <button style={{ ...hdr.filterBtn, display: 'flex', alignItems: 'center', gap: 5 }} onClick={shareCurrentHand}>
              {handCopied ? (
                <>{!isMobile ? '✓ Copiado' : '✓'}</>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="8 6 12 2 16 6"/>
                    <line x1="12" y1="2" x2="12" y2="15"/>
                    <path d="M4 15v6h16v-6"/>
                  </svg>
                  {!isMobile && 'Compartir'}
                </>
              )}
            </button>
          )}
          {user && !handToken && (() => {
            const marked = markedHandIds.has(hands[curIdx]?._dbId)
            return (
              <div ref={popoverRef} style={{ position:'relative' }}>
                <button
                  style={{ ...hdr.filterBtn, display:'flex', alignItems:'center', gap:5,
                    ...(marked ? { border:'1px solid #8a6200', color:'#c89a10' } : {}) }}
                  onClick={openListPopover}
                  title={marked ? 'Mano en una lista de revisión — gestionar listas' : 'Añadir esta mano a una lista de revisión'}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  {!isMobile && (marked ? 'En lista' : 'Añadir a lista')}
                </button>
                {showListPopover && (
                  <div style={listPopover.root}>
                    <div style={listPopover.header}>LISTAS DE REVISIÓN</div>
                    {popoverLoading ? <div style={listPopover.loading}>Cargando...</div> : <>
                      {userLists.length === 0 && !showNewListForm &&
                        <div style={listPopover.empty}>Todavía no tienes listas.<br/>Crea tu primera lista abajo.</div>}
                      {userLists.map(list => (
                        <label key={list.id} style={listPopover.item}>
                          <input type="checkbox" checked={popoverDraft.has(list.id)}
                            onChange={() => toggleDraftList(list.id)}
                            style={{ accentColor:'#c89a10', width:14, height:14, flexShrink:0, cursor:'pointer' }} />
                          <span style={{ flex:1, fontSize:12, color:'#c8d4e8', fontWeight:600 }}>{list.name}</span>
                          <span style={{ fontSize:10, color:'#3a6080' }}>{list.hand_count}</span>
                        </label>
                      ))}
                      {showNewListForm ? (
                        <div style={{ borderTop:'1px solid #1a2a3a' }}>
                          <div style={listPopover.newForm}>
                            <input autoFocus style={listPopover.newInput} type="text"
                              maxLength={100}
                              placeholder="Nombre de la lista" value={newListName}
                              onChange={e => setNewListName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleCreateList()
                                if (e.key === 'Escape') { setShowNewListForm(false); setNewListName('') }
                              }} />
                            <button style={{ ...listPopover.createBtn, opacity: !newListName.trim() || newListSaving ? 0.5 : 1 }}
                              onClick={handleCreateList} disabled={!newListName.trim() || newListSaving}>
                              {newListSaving ? '...' : 'Crear'}
                            </button>
                          </div>
                          <button
                            style={{ display:'block', width:'100%', background:'none', border:'none',
                              padding:'6px 14px 10px', color:'#3a5060', fontSize:11, cursor:'pointer', textAlign:'center' }}
                            onClick={() => { setShowNewListForm(false); setNewListName('') }}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div style={listPopover.footer}>
                          <button style={listPopover.addBtn} onClick={() => setShowNewListForm(true)}>+ Crear lista</button>
                          <button style={{ ...listPopover.saveBtn, opacity: listSaving ? 0.6 : 1 }}
                            onClick={saveListChanges} disabled={listSaving}>
                            {listSaving ? '...' : 'Guardar'}
                          </button>
                        </div>
                      )}
                    </>}
                  </div>
                )}
              </div>
            )
          })()}
          {!handToken && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:11, color:'#70aaff', fontWeight:700, whiteSpace:'nowrap', letterSpacing:'0.3px' }}>#{hand.id}</div>
              <div style={hdr.counter}>{dispIdx + 1} / {displayHandsWithIdx.length}</div>
            </div>
          )}
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ── TABLE AREA ── */}
        <div ref={areaRef} style={ta.root}>

          {/* Table */}
          <div style={{ position:'relative', width:800, height:540, flexShrink:0,
            transform:`scale(${scale})`, transformOrigin:'top center',
            marginBottom: Math.round(540*(scale-1))+'px',
            marginLeft: Math.round(800*(scale-1)/2)+'px',
            marginRight: Math.round(800*(scale-1)/2)+'px' }}>

            {/* Felt */}
            <div style={ta.felt}>
              {/* Watermark */}
              <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
                fontSize:160, color:'rgba(255,255,255,0.022)', pointerEvents:'none', userSelect:'none', lineHeight:1 }}>♠</div>
            </div>

            {/* Board */}
            <div style={ta.boardWrap}>
              {boardCards.length > 0 && (
                <div style={{ display:'flex', gap:7 }}>
                  {boardCards.map((c,i) => <Card key={i} code={c} size="lg" />)}
                </div>
              )}
              {isShowdown && (curStep === seq.length - 1 || allInRunout) && equity?.tie > 0.5 && (
                <div style={{ fontSize:10, color:'#8899aa', marginTop:4, letterSpacing:'0.3px' }}>
                  Empate: {equity.tie.toFixed(1)}%
                </div>
              )}
              {runningPot > 0 && (
                <div style={ta.pot}>
                  <span style={{ fontSize:10, color:'rgba(255,200,0,0.5)', fontWeight:600, letterSpacing:1, textTransform:'uppercase' }}>Bote total</span>
                  <span style={{ fontSize:16, color:'#ffd060', fontWeight:900, textShadow:'0 0 20px rgba(255,200,0,0.5)', letterSpacing:'0.5px' }}>
                    {fmt(runningPot)}
                  </span>
                </div>
              )}
            </div>

            {/* Seats */}
            {ordered.map((seat, i) => {
              const isHeroSeat = seat.player === 'Hero'
              const pos = { ...positions[i], y: positions[i].y + (isHeroSeat ? -20 : 0) }
              const isHero   = seat.player === 'Hero'
              const isFolded = foldedPlayers.has(seat.player)
              const isAllin  = allinPlayers.has(seat.player)
              const isWinner = winnerPlayers.has(seat.player)
              const isActive = seat.player === activePlayer
              const cards    = hand.holeCards[seat.player]

              const posLabel   = getPositionLabel(seat.num, hand.seats, hand.buttonSeat)
              const badgeTxt   = posLabel
              const badgeStyle = posLabel === 'BTN' ? { background:'#8c6010', color:'#ffe580' }
                : posLabel === 'SB'  ? { background:'#1a4060', color:'#70c0ff' }
                : posLabel === 'BB'  ? { background:'#1a3a1a', color:'#70e070' }
                : posLabel === 'CO'  ? { background:'#2a1040', color:'#c080f0' }
                : posLabel === 'HJ'  ? { background:'#102040', color:'#6090d0' }
                : { background:'#101828', color:'#4a6878' }

              const ab = isActive && activeAction ? badgeInfo(activeAction, fmt) : null

              return (
                <div key={seat.num} style={{
                  position:'absolute', left:pos.x, top:pos.y,
                  transform:'translate(-50%,-50%)',
                  display:'flex', flexDirection:'column', alignItems:'center',
                  gap:2, width:114, opacity: isFolded ? 0.35 : 1, pointerEvents:'none', zIndex:2 }}>

                  {/* Cards — opponents revealed at showdown or when all active players are all-in */}
                  <div style={{ display:'flex', gap:3 }}>
                    {cards && (isHero || curStep === seq.length - 1 || allInRunout)
                      ? cards.map((c,ci) => <Card key={ci} code={c} size="lg" />)
                      : [0,1].map(ci => <CardBack key={ci} size="lg" />)}
                  </div>

                  {/* Position badge */}
                  {badgeTxt && (
                    <div style={{ fontSize:9, fontWeight:800, letterSpacing:1, padding:'1px 7px', borderRadius:3, ...badgeStyle }}>
                      {badgeTxt}{isAllin ? ' · AI' : ''}
                    </div>
                  )}

                  {/* Seat box */}
                  <div style={{
                    background: isHero
                      ? 'linear-gradient(to bottom,#2a2210,#1a1600)'
                      : 'linear-gradient(to bottom,#1a2035,#101520)',
                    border:`1px solid ${isWinner ? '#ffe566' : isActive ? '#5090d0' : isHero ? '#c8a800' : isAllin ? '#cc3333' : '#253045'}`,
                    borderRadius:8, padding:'5px 8px', textAlign:'center', width:'100%',
                    boxShadow: isWinner ? '0 0 14px rgba(200,168,0,0.4)' : isActive ? '0 0 10px rgba(60,130,220,0.35)' : '0 2px 8px rgba(0,0,0,0.6)' }}>
                    <div style={{ fontSize:11, fontWeight:800, color: isHero ? '#ffe566' : '#c8d4e8',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:96 }}>
                      {isHero ? '★ Hero' : seat.player.slice(0,10)}
                    </div>
                    <div style={{ fontSize:13, color: isAllin ? '#ff7070' : '#50e080', fontWeight:700, marginTop:2 }}>
                      {fmt(stacks.get(seat.player) ?? seat.chips)}
                    </div>
                  </div>

                  {/* Action badge */}
                  {ab && (
                    <div style={{ fontSize:10, fontWeight:800, padding:'3px 9px', borderRadius:4,
                      background:ab.bg, color:ab.color, border:`1px solid ${ab.border}`, whiteSpace:'nowrap' }}>
                      {ab.label}
                    </div>
                  )}

                  {/* Equity badge — only when cards are face-up */}
                  {isShowdown && (curStep === seq.length - 1 || allInRunout) && equity?.[seat.player] != null && (
                    <div style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4,
                      background:'#0d1f12', color:'#50e080', border:'1px solid #1a4025', whiteSpace:'nowrap' }}>
                      {equity[seat.player].toFixed(1)}%
                    </div>
                  )}
                </div>
              )
            })}

            {/* Dealer button */}
            {(() => {
              const btnIdx = ordered.findIndex(s => s.num === hand.buttonSeat)
              if (btnIdx < 0) return null
              const pos = positions[btnIdx]
              const isHeroBtn = ordered[btnIdx]?.player === 'Hero'
              const adjY = pos.y + (isHeroBtn ? -20 : 0)
              const rim = seatEdge(pos.x, adjY, 15)
              return (
                <div style={{ position:'absolute', pointerEvents:'none',
                  left: rim.x,
                  top:  rim.y,
                  transform:'translate(-50%,-50%)',
                  width:22, height:22, borderRadius:'50%',
                  background:'radial-gradient(circle at 38% 35%, #ffe898, #c89000)',
                  border:'2px solid #806000',
                  boxShadow:'0 2px 8px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,240,150,.4)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:9, fontWeight:900, color:'#3a2000' }}>
                  D
                </div>
              )
            })()}

            {/* Chip bets */}
            {Array.from(bets.entries()).map(([player, amount]) => {
              const si = ordered.findIndex(s => s.player === player)
              if (si < 0) return null
              const pos = positions[si]
              const isHeroChip = ordered[si]?.player === 'Hero'
              const adjY = pos.y + (isHeroChip ? -20 : 0)
              const rim = seatEdge(pos.x, adjY, 45)
              return (
                <div key={player} style={{ position:'absolute',
                  left: rim.x,
                  top:  rim.y,
                  transform:'translate(-50%,-50%)', pointerEvents:'none',
                  display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  {/* Chip stack */}
                  <div style={{ width:28, height:28, borderRadius:'50%',
                    background:'radial-gradient(circle at 38% 35%, #6699ee, #1a3aaa)',
                    border:'2px solid rgba(120,170,255,0.5)',
                    boxShadow:'0 3px 10px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.2)',
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ width:17, height:17, borderRadius:'50%',
                      border:'1px dashed rgba(150,200,255,0.35)' }} />
                  </div>
                  {/* Amount */}
                  <div style={{ fontSize:10, fontWeight:800, color:'#ffe080',
                    textShadow:'0 1px 6px rgba(0,0,0,1)', whiteSpace:'nowrap',
                    background:'rgba(0,0,0,.8)', borderRadius:3, padding:'1px 6px' }}>
                    {fmt(amount)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Controls ── */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0, paddingTop: isMobile ? 12 : Math.round(scale * 80) }}>

            {/* Street nav */}
            <div style={{ display:'flex', gap:8 }}>
              {STREET_ORDER.map(s => {
                const exists = s === 'preflop'
                  || (s === 'flop'  && hand.board.flop.length > 0)
                  || (s === 'turn'  && hand.board.turn  != null)
                  || (s === 'river' && hand.board.river != null)
                const active = s === street
                return (
                  <button key={s} disabled={!exists || !(s in hand.streetStartStep)}
                    onClick={() => jumpToStreet(s)}
                    style={{ ...stBtn, ...(active ? stBtnActive : {}),
                      opacity: (!exists || !(s in hand.streetStartStep)) ? 0.32 : 1 }}>
                    {s.toUpperCase()}
                  </button>
                )
              })}
            </div>

            {/* Step nav */}
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {[
                { id:'prev',     icon:'⏮\uFE0E', disabled: dispIdx <= 0 || displayHandsWithIdx.length <= 1,            action: () => goHand(displayHandsWithIdx[dispIdx-1]?.i) },
                { id:'stepPrev', icon:'⏪\uFE0E', disabled: curStep <= 0,            action: () => { setPlaying(false); setCurStep(s => Math.max(0, s-1)) } },
              ].map(b => <button key={b.id} style={{ ...ctrlBtn, ...(b.disabled ? ctrlBtnDisabled : {}) }} disabled={b.disabled} onClick={b.action}>{b.icon}</button>)}

              <button style={{ ...ctrlBtn, ...(playing ? ctrlBtnPlaying : {}) }}
                onClick={() => setPlaying(p => !p)}>
                {playing ? '⏸\uFE0E' : '▶\uFE0E'}
              </button>

              {[
                { id:'stepNext', icon:'⏩\uFE0E', disabled: curStep >= seq.length-1, action: () => { setPlaying(false); setCurStep(s => Math.min(seq.length-1, s+1)) } },
                { id:'next',     icon:'⏭\uFE0E', disabled: dispIdx >= displayHandsWithIdx.length-1 || displayHandsWithIdx.length <= 1, action: () => goHand(displayHandsWithIdx[dispIdx+1]?.i) },
              ].map(b => <button key={b.id} style={{ ...ctrlBtn, ...(b.disabled ? ctrlBtnDisabled : {}) }} disabled={b.disabled} onClick={b.action}>{b.icon}</button>)}

              {/* BB toggle */}
              <button style={{ ...ctrlBtn, ...(displayBB ? ctrlBtnPlaying : {}), fontSize:13, fontWeight:900, width:46, marginLeft:14 }}
                onClick={() => setDisplayBB(p => !p)}>
                {displayBB
                  ? <span style={{ textDecoration:'line-through', textDecorationThickness:2 }}>BB</span>
                  : 'BB'}
              </button>
            </div>
          </div>

          {/* ── Notes ── */}
          {user && !loading && hand && (
            <div style={{ ...noteStyle.root, ...(isMobile ? { paddingBottom: 36 } : {}) }}>
              <div style={noteStyle.header}>
                <span style={noteStyle.label}>NOTAS</span>
                <span style={noteStyle.indicator}>
                  {noteSaved ? '' : 'Guardando...'}
                </span>
              </div>
              <textarea
                className="hand-note-textarea"
                style={{ ...noteStyle.textarea, resize:'none' }}
                ref={textareaRef}
                rows={4}
                maxLength={10000}
                placeholder="Añade notas sobre esta mano..."
                defaultValue=""
                onChange={handleNoteChange}
              />
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ ...rp.root, display: isMobile || handToken ? 'none' : 'flex' }}>

          {/* Header */}
          <div style={{ ...rp.handsHeader, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span>MANOS ({displayHandsWithIdx.length}{hasFilters ? ` / ${hands.length}` : ''})</span>
            {user && !handToken && (
              <button style={rp.shareBtn} onClick={shareHandList}
                title="Compartir esta lista de manos">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="8 6 12 2 16 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                  <path d="M4 15v6h16v-6"/>
                </svg>
              </button>
            )}
          </div>

          {/* Hand list */}
          <div style={rp.handsList}>
            {displayHandsWithIdx.map(({ h, i }) => {
              const cards  = h.holeCards?.Hero ?? []
              const net    = heroNet(h)
              const resCls = h.heroResult === 'won' ? '#30a860' : h.heroResult === 'folded' ? '#556070' : '#d04040'
              const resTxt = h.heroResult === 'won' ? 'Ganó' : h.heroResult === 'folded' ? 'Fold' : 'Perdió'
              const netCol = net > 0 ? '#30a860' : net < 0 ? '#d04040' : '#506070'
              return (
                <div key={i} data-idx={i}
                  style={{ ...rp.handItem, ...(handNotes[h._dbId] ? rp.handItemNoted : {}), ...(i === curIdx ? rp.handItemActive : {}) }}
                  onClick={() => goHand(i)}>
                  <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                    {cards.length > 0
                      ? cards.map((c, ci) => {
                          const img = getCardImage(c)
                          return img
                            ? <img key={ci} src={img} alt={c} width={30} height={44}
                                style={{ borderRadius:5, boxShadow:'0 2px 5px rgba(0,0,0,.6)', flexShrink:0, display:'block' }} />
                            : null
                        })
                      : [0,1].map(ci => (
                          <div key={ci} style={{ width:30, height:44, borderRadius:5,
                            background:'linear-gradient(145deg,#2a6a38,#163c1e)', border:'1px solid #1a4a28' }} />
                        ))
                    }
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:9, color:'#2e4050', fontWeight:700 }}>#{i+1}</div>
                    <div style={{ fontSize:12, fontWeight:800, color:resCls }}>{resTxt}</div>
                  </div>
                  {net !== null && (
                    <div style={{ fontSize:11, fontWeight:800, color:netCol, flexShrink:0 }}>
                      {(net >= 0 ? '+' : '') + makeFmt(true, h.bb)(net)}
                    </div>
                  )}
                  {handNotes[h._dbId] && (
                    <div style={{ fontSize:10, fontWeight:800, color:'#c89a10', background:'rgba(180,140,0,0.15)',
                      border:'1px solid rgba(180,140,0,0.28)', borderRadius:4, padding:'2px 5px', flexShrink:0 }}>
                      📝
                    </div>
                  )}
                  {markedHandIds.has(h._dbId) && (
                    <div style={{ fontSize:10, fontWeight:800, color:'#c89a10', background:'rgba(180,140,0,0.15)',
                      border:'1px solid rgba(180,140,0,0.28)', borderRadius:4, padding:'2px 5px', flexShrink:0 }}>
                      ★
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── MOBILE HANDS DRAWER ── */}
      {isMobile && showMobileHands && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:50,
          display:'flex', flexDirection:'column', justifyContent:'flex-end' }}
          onClick={() => setShowMobileHands(false)}>
          <div style={{ background:'#0f1520', borderTop:'1px solid #1e2a3a',
            borderTopLeftRadius:18, borderTopRightRadius:18,
            maxHeight:'72vh', display:'flex', flexDirection:'column', overflow:'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'12px 16px', fontSize:10, fontWeight:800, letterSpacing:1,
              color:'#3a5060', borderBottom:'1px solid #1e2a3a', background:'#0a1018',
              display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <span>MANOS ({displayHandsWithIdx.length}{hasFilters ? ` / ${hands.length}` : ''})</span>
              <button style={{ background:'none', border:'none', color:'#3a5060', cursor:'pointer',
                fontSize:18, lineHeight:1 }} onClick={() => setShowMobileHands(false)}>✕</button>
            </div>
            <div style={{ ...rp.handsList }}>
              {displayHandsWithIdx.map(({ h, i }) => {
                const cards  = h.holeCards?.Hero ?? []
                const net    = heroNet(h)
                const resCls = h.heroResult === 'won' ? '#30a860' : h.heroResult === 'folded' ? '#556070' : '#d04040'
                const resTxt = h.heroResult === 'won' ? 'Ganó' : h.heroResult === 'folded' ? 'Fold' : 'Perdió'
                const netCol = net > 0 ? '#30a860' : net < 0 ? '#d04040' : '#506070'
                return (
                  <div key={i} data-idx={i}
                    style={{ ...rp.handItem, ...(handNotes[h._dbId] ? rp.handItemNoted : {}), ...(i === curIdx ? rp.handItemActive : {}) }}
                    onClick={() => goHand(i)}>
                    <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                      {cards.length > 0
                        ? cards.map((c, ci) => {
                            const img = getCardImage(c)
                            return img
                              ? <img key={ci} src={img} alt={c} width={30} height={44}
                                  style={{ borderRadius:5, boxShadow:'0 2px 5px rgba(0,0,0,.6)', flexShrink:0, display:'block' }} />
                              : null
                          })
                        : [0,1].map(ci => (
                            <div key={ci} style={{ width:30, height:44, borderRadius:5,
                              background:'linear-gradient(145deg,#2a6a38,#163c1e)', border:'1px solid #1a4a28' }} />
                          ))
                      }
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:9, color:'#2e4050', fontWeight:700 }}>#{i+1}</div>
                      <div style={{ fontSize:12, fontWeight:800, color:resCls }}>{resTxt}</div>
                    </div>
                    {net !== null && (
                      <div style={{ fontSize:11, fontWeight:800, color:netCol, flexShrink:0 }}>
                        {(net >= 0 ? '+' : '') + makeFmt(true, h.bb)(net)}
                      </div>
                    )}
                    {handNotes[h._dbId] && (
                      <div style={{ fontSize:10, fontWeight:800, color:'#c89a10', background:'rgba(180,140,0,0.15)',
                        border:'1px solid rgba(180,140,0,0.28)', borderRadius:4, padding:'2px 5px', flexShrink:0 }}>
                        ✏
                      </div>
                    )}
                    {markedHandIds.has(h._dbId) && (
                      <div style={{ fontSize:10, fontWeight:800, color:'#c89a10', background:'rgba(180,140,0,0.15)',
                        border:'1px solid rgba(180,140,0,0.28)', borderRadius:4, padding:'2px 5px', flexShrink:0 }}>
                        ★
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── FILTER MODAL ── */}
      {showFilter && (
        <div style={modal.backdrop} onClick={e => e.target === e.currentTarget && setShowFilter(false)}>
          <div style={modal.root}>
            <div style={modal.header}>
              <span style={modal.title}>Filtrar manos</span>
              <button style={modal.close} onClick={() => setShowFilter(false)}>✕</button>
            </div>

            <div style={modal.body}>
              {/* Manos jugadas */}
              <div style={modal.field}>
                <label style={modal.fieldLabel}>Manos jugadas</label>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={draftPlayed}
                    onChange={e => setDraftPlayed(e.target.checked)}
                    style={{ accentColor:'#3a7abf', width:14, height:14, cursor:'pointer' }} />
                  <span style={{ fontSize:13, color:'#c8d4e8' }}>Solo manos no foldeadas preflop</span>
                </label>
              </div>

              {/* Posición del Hero */}
              <div style={modal.field}>
                <label style={modal.fieldLabel}>Posición del Hero</label>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {['BTN','CO','HJ','LJ','MP','MP+1','UTG','UTG+1','SB','BB'].map(pos => {
                    const sel = draftPositions.includes(pos)
                    return (
                      <button key={pos} onClick={() => toggleDraftPosition(pos)} style={{
                        padding:'5px 11px', borderRadius:7, fontSize:12, fontWeight:700,
                        cursor:'pointer', border:`1px solid ${sel ? '#70c0ff' : '#2a3a52'}`,
                        background: sel ? '#1a5090' : 'rgba(255,255,255,0.04)',
                        color: sel ? '#d0e8ff' : '#4a6880',
                        boxShadow: sel ? '0 0 6px rgba(100,180,255,0.3)' : 'none',
                        transition:'all 0.1s'
                      }}>
                        {pos}
                      </button>
                    )
                  })}
                </div>
                {draftPositions.length > 0 && (
                  <button onClick={() => setDraftPositions([])} style={{
                    alignSelf:'flex-start', fontSize:11, background:'#2a1a1a', color:'#d06060',
                    border:'1px solid #4a2020', borderRadius:6, padding:'4px 9px', cursor:'pointer', marginTop:2
                  }}>
                    ✕ Borrar
                  </button>
                )}
              </div>

              {/* Buscar cartas */}
              <div style={modal.field}>
                <label style={modal.fieldLabel}>Buscar cartas ({draftCards.length}/2)</label>
                <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                  {DECK_SUITS.map(suit => (
                    <div key={suit} style={{ display:'flex', gap:2 }}>
                      {DECK_RANKS.map(rank => {
                        const code = rank + suit
                        const sel  = draftCards.includes(code)
                        const bg   = SUIT_BG[COLORS[suit]]
                        return (
                          <div key={code} onClick={() => toggleDraftCard(code)} style={{
                            width:26, height:36, borderRadius:4,
                            background: sel ? '#1a5090' : bg,
                            border:`1px solid ${sel ? '#70c0ff' : 'rgba(0,0,0,0.5)'}`,
                            boxShadow: sel ? '0 0 6px rgba(100,180,255,0.5)' : 'none',
                            display:'flex', flexDirection:'column', alignItems:'center',
                            justifyContent:'center', cursor:'pointer', flexShrink:0,
                            opacity: sel ? 1 : 0.82, transition:'all 0.1s' }}>
                            <span style={{ fontSize:11, lineHeight:1, color:'#fff' }}>{SUITS[suit]}</span>
                            <span style={{ fontSize:9, fontWeight:900, lineHeight:1, color:'#fff' }}>
                              {RANKS[rank] || rank}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
                {draftCards.length > 0 && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
                    <span style={{ fontSize:11, color:'#4a6880' }}>Seleccionadas:</span>
                    <div style={{ display:'flex', gap:4 }}>
                      {draftCards.map(c => <Card key={c} code={c} size="sm" />)}
                    </div>
                    <button onClick={() => setDraftCards([])} style={{
                      marginLeft:'auto', fontSize:11, background:'#2a1a1a', color:'#d06060',
                      border:'1px solid #4a2020', borderRadius:6, padding:'4px 9px', cursor:'pointer' }}>
                      ✕ Borrar
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={modal.footer}>
              <button style={modal.clearBtn} onClick={clearFilter}>Limpiar</button>
              <button style={modal.applyBtn} onClick={applyFilter}>Aplicar filtros</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {listCopied && (
        <div style={{ position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
          background:'#0e2a1a', border:'1px solid #2a6a3a', color:'#50d080',
          padding:'10px 26px', borderRadius:10, fontSize:13, fontWeight:700,
          zIndex:200, boxShadow:'0 4px 20px rgba(0,0,0,0.7)' }}>
          ¡Enlace copiado!
        </div>
      )}

      {/* ── RANGE GRID MODAL ── */}
      {showRangeModal && (
        <div style={modal.backdrop} onClick={e => { if (e.target === e.currentTarget) { setShowRangeModal(false); setRangeFilter(null) } }}>
          <div style={{ ...modal.root, width:'min(820px, calc(100vw - 24px))', maxHeight:'92vh', display:'flex', flexDirection:'column' }}>
            <div style={modal.header}>
              <span style={modal.title}>Rango de manos</span>
              <button style={modal.close} onClick={() => { setShowRangeModal(false); setRangeFilter(null) }}>✕</button>
            </div>

            {/* Legend */}
            <div style={{ display:'flex', gap:8, padding:'8px 22px 0', flexShrink:0, flexWrap:'wrap' }}>
              {[['raise','#b02828','Subió'],['fold','#2a4898','Foldeó'],['call','#1a7a3a','CC']].map(([key, bg, label]) => {
                const active = rangeFilter === key
                return (
                  <button key={key}
                    onClick={() => setRangeFilter(active ? null : key)}
                    style={{
                      display:'flex', alignItems:'center', gap:5,
                      background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                      border: active ? `1px solid ${bg}` : '1px solid transparent',
                      borderRadius:4, padding:'3px 8px 3px 5px', cursor:'pointer',
                      outline:'none',
                    }}
                  >
                    <div style={{ width:12, height:12, borderRadius:2, background:bg, border:'1px solid rgba(255,255,255,0.12)', flexShrink:0 }}/>
                    <span style={{ fontSize:11, color: active ? '#dde0e8' : '#4a7090', fontWeight:600 }}>{label}</span>
                  </button>
                )
              })}
              <div style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 8px 3px 5px' }}>
                <div style={{ width:12, height:12, borderRadius:2, background:'#141e2e', border:'1px solid rgba(255,255,255,0.12)', flexShrink:0 }}/>
                <span style={{ fontSize:11, color:'#4a7090', fontWeight:600 }}>No jugada</span>
              </div>
            </div>

            {/* Grid */}
            <div style={{ padding:'12px 22px 20px', overflowY:'auto' }}>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(13, 1fr)', gap:3 }}>
                {GRID_RANKS.map((_, row) =>
                  GRID_RANKS.map((_, col) => {
                    const label = gridCellLabel(row, col)
                    const data  = rangeMap.get(label)
                    const hasRaise = (data?.raise ?? 0) > 0
                    const hasFold  = (data?.fold  ?? 0) > 0
                    const hasCall  = (data?.call  ?? 0) > 0

                    // Determine if this cell matches the active filter
                    const matchesFilter = rangeFilter === 'raise' ? hasRaise
                                        : rangeFilter === 'fold'  ? hasFold
                                        : rangeFilter === 'call'  ? hasCall
                                        : true
                    const dimmed = rangeFilter !== null && !matchesFilter

                    // Colors per action
                    const C_RAISE = '#b02828', C_FOLD = '#2a4898', C_CALL = '#1a7a3a'
                    const bg = rangeFilter === 'raise' && hasRaise ? C_RAISE
                             : rangeFilter === 'fold'  && hasFold  ? C_FOLD
                             : rangeFilter === 'call'  && hasCall  ? C_CALL
                             : hasRaise && hasFold && hasCall
                               ? `linear-gradient(135deg, ${C_RAISE} 33%, ${C_FOLD} 33% 66%, ${C_CALL} 66%)`
                             : hasRaise && hasFold
                               ? `linear-gradient(135deg, ${C_RAISE} 50%, ${C_FOLD} 50%)`
                             : hasRaise && hasCall
                               ? `linear-gradient(135deg, ${C_RAISE} 50%, ${C_CALL} 50%)`
                             : hasFold && hasCall
                               ? `linear-gradient(135deg, ${C_FOLD} 50%, ${C_CALL} 50%)`
                             : hasRaise ? C_RAISE
                             : hasFold  ? C_FOLD
                             : hasCall  ? C_CALL
                             : '#141e2e'

                    // Clickable only if it matches the active filter (or no filter)
                    const targetIdx = rangeFilter === 'raise' ? data?.firstRaiseIdx
                                    : rangeFilter === 'fold'  ? data?.firstFoldIdx
                                    : rangeFilter === 'call'  ? data?.firstCallIdx
                                    : data?.firstIdx
                    const clickable = !dimmed && data && (hasRaise || hasFold || hasCall) && targetIdx != null && targetIdx >= 0

                    const count = data
                      ? rangeFilter === 'raise' ? data.raise
                      : rangeFilter === 'fold'  ? data.fold
                      : rangeFilter === 'call'  ? data.call
                      : data.raise + data.fold + data.call
                      : 0

                    return (
                      <div key={label}
                        onClick={() => {
                          if (!clickable) return
                          const filtered = hands.filter(hand => {
                            const cards = hand.holeCards?.Hero
                            if (!cards || cards.length !== 2) return false
                            if (holeCardsToCombo(cards) !== label) return false
                            if (!rangeFilter) return true
                            const heroActs = (hand.actions?.preflop ?? []).filter(a => a.player === 'Hero' && !['post-sb','post-bb'].includes(a.type))
                            const action   = heroActs.some(a => a.type === 'raise' || a.type === 'bet') ? 'raise'
                                           : heroActs.some(a => a.type === 'fold') ? 'fold'
                                           : 'call'
                            return action === rangeFilter
                          })
                          originalHandsRef.current = hands
                          setHands(filtered)
                          setCurIdx(0)
                          setCurStep(0)
                          setIsComboStudy(true)
                          setShowRangeModal(false)
                        }}
                        title={data
                          ? `${label} — Subió: ${data.raise}  Foldeó: ${data.fold}  CC: ${data.call}`
                          : label}
                        style={{
                          aspectRatio:'1', background:bg, borderRadius:3,
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:'clamp(7px, 1.5vw, 13px)', fontWeight:800,
                          color: data ? '#fff' : '#2a3a50',
                          cursor: clickable ? 'pointer' : 'default',
                          border: clickable ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                          transition:'filter 0.1s, opacity 0.15s',
                          opacity: dimmed ? 0.15 : 1,
                          position:'relative',
                        }}
                        onMouseEnter={e => { if (clickable) e.currentTarget.style.filter='brightness(1.25)' }}
                        onMouseLeave={e => { e.currentTarget.style.filter='' }}
                      >
                        {label}
                        {rangeFilter && count > 0 && (
                          <span style={{
                            position:'absolute', bottom:1, right:2,
                            fontSize:'clamp(7px, 1.2vw, 12px)', fontWeight:700,
                            color:'rgba(255,255,255,0.65)', lineHeight:1,
                          }}>{count}</span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div style={{ ...modal.footer, borderTop:'1px solid #1a2a3a', justifyContent:'center' }}>
              <span style={{ fontSize:13, fontWeight:800, color:'#c0d8f0' }}>
                {(Number.isInteger(rangePct) ? rangePct.toString() : rangePct.toFixed(1))}%
              </span>
              <span style={{ fontSize:12, color:'#4a7090', fontWeight:600 }}>{rangePctLabel}</span>
            </div>
          </div>
        </div>
      )}

      {showStudyModal && (
        <StudyModal
          onClose={() => setShowStudyModal(false)}
          user={user}
          initialFilters={location.state?.studyFilters}
          onSearchResults={applyStudyHands}
          onOpenListHands={(rows) => applyStudyHands(rows, undefined)}
        />
      )}

      {toast && <div style={vzToast}>{toast}</div>}
    </div>
  )
}


// ── Styles ────────────────────────────────────────────────────────────
const page = { height:'100vh', background:'radial-gradient(ellipse at 30% 20%,#1a2a3a 0%,#0d1520 40%,#050b10 100%)',
  display:'flex', flexDirection:'column', fontFamily:"'Segoe UI',system-ui,sans-serif", color:'#dde0e8', overflow:'hidden' }

const vzToast = {
  position:'fixed', bottom:28, left:'50%', transform:'translateX(-50%)',
  background:'#0e2a1a', border:'1px solid #2a6a3a', color:'#50d080',
  padding:'10px 26px', borderRadius:10, fontSize:13, fontWeight:700,
  zIndex:200, boxShadow:'0 4px 20px rgba(0,0,0,0.7)', whiteSpace:'nowrap',
}

const hdr = {
  root:    { background:'#1a1e2a', borderBottom:'1px solid #2a3040', padding:'8px 16px',
             display:'flex', alignItems:'center', gap:16, flexShrink:0, flexWrap:'wrap' },
  logo:    { display:'flex', alignItems:'center', gap:6, textDecoration:'none', flexShrink:0 },
  logoSpade: { fontSize:20, color:'#60b0ff', textShadow:'0 0 16px rgba(60,140,255,0.6)', lineHeight:1 },
  logoText:  { fontSize:14, fontWeight:800, color:'#e8f0ff', letterSpacing:'0.5px' },
  back:    { background:'#1a2838', color:'#5080a8', border:'1px solid #2a3a50', padding:'5px 12px',
             borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, whiteSpace:'nowrap' },
  studyBtn: { background:'linear-gradient(135deg, #1a3a20, #0c2014)', border:'1px solid #2a6a3a',
             borderRadius:6, padding:'5px 12px', color:'#50d080', fontSize:12, fontWeight:700,
             cursor:'pointer', whiteSpace:'nowrap', boxShadow:'0 2px 12px rgba(20,100,50,0.25)' },
  center:  { flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 },
  name:    { fontSize:14, fontWeight:800, color:'#90b8e0' },
  level:   { fontSize:11, fontWeight:600, color:'#4a6a88', letterSpacing:'0.3px' },
  meta:    { fontSize:10, color:'#506070' },
  counter:         { fontSize:12, color:'#607080', fontWeight:700, textAlign:'right', whiteSpace:'nowrap' },
  filterBtn:       { display:'flex', alignItems:'center', gap:6, background:'none',
                     border:'1px solid #2a4a62', borderRadius:8, padding:'6px 13px',
                     color:'#4a7090', fontSize:13, fontWeight:700, cursor:'pointer', position:'relative' },
  filterBtnActive: { border:'1px solid #3a6a9a', color:'#70b0e0' },
  handsBtn:        { display:'flex', alignItems:'center', gap:5, background:'none',
                     border:'1px solid #2a4a62', borderRadius:8, padding:'6px 12px',
                     color:'#4a7090', fontSize:12, fontWeight:700, cursor:'pointer' },
  filterDot:       { position:'absolute', top:4, right:4, width:6, height:6,
                     borderRadius:'50%', background:'#60b0ff' },
}

const ta = {
  root:      { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
               position:'relative', overflow:'hidden', gap:10, paddingTop:20, paddingBottom:20 },
  info:      { display:'flex', flexDirection:'column', alignItems:'center', gap:3, flexShrink:0 },
  infoName:  { fontSize:15, fontWeight:800, color:'#90b8e0' },
  infoLevel: { fontSize:12, fontWeight:600, color:'#4a6a88' },
  felt:      { position:'absolute', top:62, left:56, right:56, bottom:62,
               background:'radial-gradient(ellipse at 50% 38%, #1e4070 0%, #102348 55%, #070f28 100%)',
               borderRadius:'50%', border:'26px solid #080808',
               boxShadow:'0 0 0 3px #1a1a1a, 0 0 0 4px #0a0a0a, 0 0 0 6px rgba(150,120,40,0.18), 0 20px 80px rgba(0,0,0,.98), inset 0 0 90px rgba(0,0,0,.35)' },
  boardWrap: { position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-56%)',
               display:'flex', flexDirection:'column', alignItems:'center', gap:8 },
  pot:       { background:'rgba(0,0,0,0.75)', border:'1px solid rgba(200,160,0,0.25)', borderRadius:8,
               padding:'5px 22px', display:'flex', flexDirection:'column', alignItems:'center', gap:1,
               backdropFilter:'blur(4px)' },
}

const stBtn = {
  background:'linear-gradient(to bottom,#cccccc 0%,#a2a2a2 100%)',
  border:'1px solid #787878', borderRadius:10, color:'#1a1a1a',
  padding:'6px 18px', height:32, cursor:'pointer', fontSize:11, fontWeight:800,
  letterSpacing:'0.8px', boxShadow:'0 3px 6px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.55)',
  transition:'all 0.1s',
}
const stBtnActive = {
  background:'linear-gradient(to bottom,#3a8040 0%,#1e5028 100%)',
  color:'#a0ffa0', borderColor:'#2a6030',
  boxShadow:'0 3px 6px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.2)',
}
const ctrlBtn = {
  background:'linear-gradient(to bottom,#cccccc 0%,#a2a2a2 100%)',
  border:'1px solid #787878', borderRadius:10, color:'#1a1a1a',
  width:58, height:46, fontSize:22, cursor:'pointer',
  boxShadow:'0 3px 6px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.55)',
  transition:'all 0.1s', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1,
}
const ctrlBtnPlaying = {
  background:'linear-gradient(to bottom,#3a8040 0%,#1e5028 100%)',
  color:'#a0ffa0', borderColor:'#2a6030',
}
const ctrlBtnDisabled = {
  background:'linear-gradient(to bottom,#3a3a3a 0%,#252525 100%)',
  color:'#484848', borderColor:'#303030', cursor:'default',
  boxShadow:'none',
}

const rp = {
  root:           { width:280, background:'#0f1520', borderLeft:'1px solid #1e2a3a',
                    display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0 },
  handsHeader:    { padding:'7px 12px', fontSize:10, fontWeight:800, letterSpacing:1, color:'#3a5060',
                    borderBottom:'1px solid #1e2a3a', background:'#0a1018', flexShrink:0 },
  handsList:      { flex:1, overflowY:'auto' },
  handItem:       { padding:'8px 10px', cursor:'pointer', borderBottom:'1px solid #0f1820',
                    borderLeft:'3px solid transparent', transition:'background 0.12s',
                    display:'flex', alignItems:'center', gap:10 },
  handItemActive: { background:'#111e2e', borderLeftColor:'#3a7abf' },
  handItemNoted:  { background:'rgba(160,120,0,0.07)', borderLeftColor:'#7a5e00' },
  shareBtn:       { background:'none', border:'1px solid #2a4a62', borderRadius:6,
                    padding:'3px 7px', color:'#4a7090', cursor:'pointer',
                    display:'flex', alignItems:'center', lineHeight:1, fontSize:11, fontWeight:700 },
}

const modal = {
  backdrop: { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)',
              display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 },
  root:     { background:'linear-gradient(160deg,#131c2c 0%,#0c1420 100%)', border:'1px solid #2a3a52',
              borderRadius:18, width:'min(420px, calc(100vw - 32px))', boxShadow:'0 30px 90px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
              overflow:'hidden' },
  header:   { display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'18px 22px 14px', borderBottom:'1px solid #1a2a3a' },
  title:    { fontSize:14, fontWeight:800, color:'#c0d8f0', letterSpacing:'0.3px' },
  close:    { background:'none', border:'none', color:'#3a5a70', cursor:'pointer', fontSize:14, padding:'2px 6px' },
  body:     { padding:'20px 22px', display:'flex', flexDirection:'column', gap:18 },
  field:    { display:'flex', flexDirection:'column', gap:8 },
  fieldLabel: { fontSize:10, fontWeight:800, color:'#3a6080', letterSpacing:'1px', textTransform:'uppercase' },
  footer:   { display:'flex', gap:10, padding:'14px 22px 20px', borderTop:'1px solid #1a2a3a' },
  clearBtn: { flex:1, background:'none', border:'1px solid #2a3a52', borderRadius:9, padding:'10px',
              color:'#4a7090', fontSize:13, fontWeight:700, cursor:'pointer' },
  applyBtn: { flex:2, background:'linear-gradient(135deg,#1e5cad,#0c3080)', border:'1px solid #2a4a80',
              borderRadius:9, padding:'10px', color:'#d0e8ff', fontSize:13, fontWeight:800,
              cursor:'pointer', boxShadow:'0 4px 20px rgba(20,60,160,0.35)' },
}

const noteStyle = {
  root:      { width:'100%', maxWidth:800, padding:'0 12px 20px',
               display:'flex', flexDirection:'column', gap:6, flexShrink:0, boxSizing:'border-box' },
  header:    { display:'flex', alignItems:'center', justifyContent:'space-between' },
  label:     { fontSize:10, fontWeight:800, letterSpacing:'1px', color:'#3a5060' },
  indicator: { fontSize:10, color:'#3a6080', fontWeight:600 },
  textarea:  { width:'100%', background:'#0a1018', border:'1px solid #1e2a3a',
               borderRadius:8, color:'#c8d4e8', fontSize:13, lineHeight:1.5,
               padding:'8px 12px', resize:'vertical', outline:'none',
               fontFamily:'inherit', boxSizing:'border-box' },
}

const listPopover = {
  root:     { position:'absolute', top:'calc(100% + 8px)', right:0,
              background:'linear-gradient(160deg,#131c2c 0%,#0c1420 100%)',
              border:'1px solid #2a3a52', borderRadius:12, width:240, zIndex:300,
              boxShadow:'0 12px 40px rgba(0,0,0,0.8)', overflow:'hidden' },
  header:   { padding:'10px 14px 6px', fontSize:9, fontWeight:800, letterSpacing:'1px',
              color:'#3a6080', borderBottom:'1px solid #1a2a3a' },
  loading:  { padding:'14px', fontSize:12, color:'#3a6080', textAlign:'center' },
  empty:    { padding:'14px', fontSize:12, color:'#3a6080', textAlign:'center', lineHeight:1.6 },
  item:     { display:'flex', alignItems:'center', gap:10, padding:'9px 14px',
              borderBottom:'1px solid #0e1828', cursor:'pointer' },
  newForm:  { display:'flex', gap:6, padding:'8px 10px', borderTop:'1px solid #1a2a3a' },
  newInput: { flex:1, background:'#080e18', border:'1px solid #1e2e42', borderRadius:7,
              padding:'6px 10px', color:'#c8d4e8', fontSize:12, outline:'none' },
  createBtn:{ background:'linear-gradient(135deg,#1a3a20,#0c2014)', border:'1px solid #2a6a3a',
              borderRadius:7, padding:'6px 12px', color:'#50d080', fontSize:12,
              fontWeight:700, cursor:'pointer', flexShrink:0, whiteSpace:'nowrap' },
  footer:   { display:'flex', alignItems:'center', justifyContent:'space-between',
              borderTop:'1px solid #1a2a3a' },
  addBtn:   { background:'none', border:'none', padding:'10px 14px', color:'#3a7a5a',
              fontSize:12, fontWeight:700, cursor:'pointer', textAlign:'left' },
  saveBtn:  { background:'linear-gradient(135deg,#1a4a28,#0c2814)', border:'1px solid #2a7a3a',
              borderRadius:7, margin:'6px 10px 6px 0', padding:'6px 14px',
              color:'#50d080', fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' },
}
