import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ggIcon from '../assets/ggpoker.png'
import wmIcon from '../assets/winamax.png'
import icon888 from '../assets/888poker.png'
import coinIcon from '../assets/coinpoker.png'
import ipokerIcon from '../assets/ipoker.png'
import psIcon from '../assets/pokerstars.png'

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
  for (const a of all) if (a.player === 'Hero' && ['call','raise','bet'].includes(a.type)) inv += a.amount
  const won = hand.winners.filter(w => w.player === 'Hero').reduce((s, w) => s + w.amount, 0)
  return won - inv
}

// ── Sub-components ────────────────────────────────────────────────────
function Card({ code, size = 'sm' }) {
  if (!code) return null
  const rank = code.slice(0, -1)
  const suit = code.slice(-1).toLowerCase()
  const r  = RANKS[rank] || rank
  const s  = SUITS[suit] || suit
  const bg = SUIT_BG[COLORS[suit]] || '#222'
  const d  = { sm: [44,62,26,13,4], md: [58,82,36,16,5], lg: [70,98,44,19,6] }[size]
  return (
    <div style={{ width:d[0], height:d[1], background:bg, borderRadius:7, border:'1px solid rgba(0,0,0,0.3)',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      fontWeight:900, lineHeight:1, boxShadow:'0 2px 6px rgba(0,0,0,0.6)', userSelect:'none',
      position:'relative', color:'#fff', flexShrink:0 }}>
      <div style={{ position:'absolute', top:d[4], left:d[4]+1, fontSize:d[3], fontWeight:900, lineHeight:1 }}>{r}</div>
      <span style={{ fontSize:d[2], lineHeight:1 }}>{s}</span>
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
  const { id, token } = useParams()
  const navigate = useNavigate()

  const [tournament, setTournament] = useState(null)
  const [hands,      setHands]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [curIdx,     setCurIdx]     = useState(0)
  const [curStep,    setCurStep]    = useState(0)
  const [playing,    setPlaying]    = useState(false)
  const [scale,      setScale]      = useState(1)
  const [displayBB,  setDisplayBB]  = useState(false)
  const [showFilter,      setShowFilter]      = useState(false)
  const [filterPlayed,    setFilterPlayed]    = useState(false)
  const [filterCards,     setFilterCards]     = useState([])
  const [draftPlayed,     setDraftPlayed]     = useState(false)
  const [draftCards,      setDraftCards]      = useState([])
  const [showMobileHands, setShowMobileHands] = useState(false)
  const [isMobile,        setIsMobile]        = useState(() => window.innerWidth < 768)

  const areaRef    = useRef()
  const timerRef   = useRef()

  // ── Load ──
  useEffect(() => {
    async function load() {
      try {
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
          .from('hands').select('raw').eq('tournament_id', tournamentId).order('id', { ascending: true })
        const sorted = (rows || [])
          .map(r => r.raw)
          .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))
        setHands(sorted)
      } catch(e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [id, token])

  // ── Rescale ──
  useEffect(() => {
    function rescale() {
      const area = areaRef.current
      if (!area) return
      const availW = area.clientWidth - 24
      const availH = area.clientHeight - 130
      setScale(Math.min(availW / 800, availH / 540, 1.0))
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

  // ── Keyboard ──
  useEffect(() => {
    function onKey(e) {
      if (['SELECT','INPUT'].includes(e.target.tagName)) return
      if (e.key === ' ') { e.preventDefault(); setPlaying(p => !p) }
      if (e.shiftKey) {
        if (e.key === 'ArrowLeft')  goHand(displayHandsWithIdx[dispIdx - 1]?.i)
        if (e.key === 'ArrowRight') goHand(displayHandsWithIdx[dispIdx + 1]?.i)
      } else {
        if (e.key === 'ArrowLeft')  { setPlaying(false); setCurStep(s => Math.max(0, s - 1)) }
        if (e.key === 'ArrowRight') { setPlaying(false); setCurStep(s => {
          const h = hands[curIdx]; return h ? Math.min(h.sequence.length - 1, s + 1) : s
        })}
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [curIdx, hands])

  function goHand(idx) {
    if (idx < 0 || idx >= hands.length) return
    setPlaying(false); setCurIdx(idx); setCurStep(0); setShowMobileHands(false)
  }

  function openFilter() {
    setDraftPlayed(filterPlayed)
    setDraftCards([...filterCards])
    setShowFilter(true)
  }
  function applyFilter() {
    setFilterPlayed(draftPlayed)
    setFilterCards(draftCards)
    setShowFilter(false)
    // Jump to first hand that passes the new filter
    const firstIdx = hands.findIndex(h => {
      if (draftPlayed && heroFoldedPreflop(h)) return false
      if (draftCards.length > 0 && !draftCards.every(c => (h.holeCards?.Hero ?? []).includes(c))) return false
      return true
    })
    if (firstIdx >= 0) { setCurIdx(firstIdx); setCurStep(0); setPlaying(false) }
  }
  function clearFilter() {
    setFilterPlayed(false); setFilterCards([])
    setDraftPlayed(false);  setDraftCards([])
    setShowFilter(false)
  }
  function toggleDraftCard(code) {
    setDraftCards(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code)
      if (prev.length >= 2) return [prev[1], code]
      return [...prev, code]
    })
  }

  function jumpToStreet(street) {
    const h = hands[curIdx]
    const start = h?.streetStartStep[street]
    if (start != null) setCurStep(start)
  }

  if (loading) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Cargando...</div>
  if (!tournament && token) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Torneo no encontrado o enlace inválido.</div>
  if (!hands.length) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Sin manos.</div>

  const hasFilters = filterPlayed || filterCards.length > 0
  const displayHandsWithIdx = hands
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => {
      if (filterPlayed && heroFoldedPreflop(h)) return false
      if (filterCards.length > 0) {
        const heroCards = h.holeCards?.Hero ?? []
        if (!filterCards.every(c => heroCards.includes(c))) return false
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

  let activePlayer = null, activeAction = null
  if (step?.type === 'action') {
    activeAction = hand.actions[street]?.[step.idx]
    activePlayer = activeAction?.player
  }

  const fmt        = makeFmt(displayBB, hand.bb)
  const bets       = getBetsByStep(hand, curStep)
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
        {!token && <button style={hdr.back} onClick={() => navigate('/')}>← Torneos</button>}
        <div style={hdr.center}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <img
              src={{ winamax: wmIcon, '888poker': icon888, coinpoker: coinIcon, ipoker: ipokerIcon, pokerstars: psIcon }[tournament?.platform] ?? ggIcon}
              alt={tournament?.platform || 'ggpoker'}
              style={{ width:22, height:22, borderRadius:5, objectFit:'contain', flexShrink:0 }}
            />
            <span style={hdr.name}>{tournament?.name}</span>
          </div>
          <span style={hdr.level}>Nivel {hand.level} · {fmtChips(hand.sb)}/{fmtChips(hand.bb)}</span>
          <span style={hdr.meta}>Mesa {hand.tableNum} · {hand.datetime}</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
          {isMobile && (
            <button style={hdr.handsBtn} onClick={() => setShowMobileHands(true)}>
              ☰ {dispIdx+1}/{displayHandsWithIdx.length}
            </button>
          )}
          <button style={{ ...hdr.filterBtn, ...(hasFilters ? hdr.filterBtnActive : {}) }} onClick={openFilter}>
            <span style={{ fontSize:15, lineHeight:1 }}>⌕</span>
            Filtrar
            {hasFilters && <span style={hdr.filterDot} />}
          </button>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#70aaff', fontWeight:700, whiteSpace:'nowrap', letterSpacing:'0.3px' }}>#{hand.id}</div>
            <div style={hdr.counter}>{dispIdx + 1} / {displayHandsWithIdx.length}</div>
          </div>
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

                  {/* Cards — opponents only at showdown (last step) */}
                  <div style={{ display:'flex', gap:3 }}>
                    {cards && (isHero || curStep === seq.length - 1)
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
                    <div style={{ fontSize:11, color: isAllin ? '#ff7070' : '#50e080', fontWeight:700, marginTop:2 }}>
                      {fmt(seat.chips)}
                    </div>
                  </div>

                  {/* Action badge */}
                  {ab && (
                    <div style={{ fontSize:10, fontWeight:800, padding:'3px 9px', borderRadius:4,
                      background:ab.bg, color:ab.color, border:`1px solid ${ab.border}`, whiteSpace:'nowrap' }}>
                      {ab.label}
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
              const rim = feltRim(pos.x, pos.y, 14)
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
              const rim = feltRim(pos.x, pos.y, 50)
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
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0, paddingTop:80 }}>

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
                { id:'prev',     icon:'⏮\uFE0E', disabled: dispIdx <= 0,            action: () => goHand(displayHandsWithIdx[dispIdx-1]?.i) },
                { id:'stepPrev', icon:'⏪\uFE0E', disabled: curStep <= 0,            action: () => { setPlaying(false); setCurStep(s => Math.max(0, s-1)) } },
              ].map(b => <button key={b.id} style={ctrlBtn} disabled={b.disabled} onClick={b.action}>{b.icon}</button>)}

              <button style={{ ...ctrlBtn, ...(playing ? ctrlBtnPlaying : {}) }}
                onClick={() => setPlaying(p => !p)}>
                {playing ? '⏸\uFE0E' : '▶\uFE0E'}
              </button>

              {[
                { id:'stepNext', icon:'⏩\uFE0E', disabled: curStep >= seq.length-1, action: () => { setPlaying(false); setCurStep(s => Math.min(seq.length-1, s+1)) } },
                { id:'next',     icon:'⏭\uFE0E', disabled: dispIdx >= displayHandsWithIdx.length-1, action: () => goHand(displayHandsWithIdx[dispIdx+1]?.i) },
              ].map(b => <button key={b.id} style={ctrlBtn} disabled={b.disabled} onClick={b.action}>{b.icon}</button>)}
            </div>

            {/* BB toggle */}
            <div style={{ display:'flex', alignItems:'center', gap:7, alignSelf:'flex-start' }}>
              <input type="checkbox" id="bb-toggle" checked={displayBB}
                onChange={e => setDisplayBB(e.target.checked)}
                style={{ width:15, height:15, accentColor:'#3a7abf', cursor:'pointer' }} />
              <label htmlFor="bb-toggle" style={{ fontSize:12, color:'#6080a0', cursor:'pointer', userSelect:'none' }}>
                Ver en Big Blinds
              </label>
            </div>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ ...rp.root, display: isMobile ? 'none' : 'flex' }}>

          {/* Header */}
          <div style={rp.handsHeader}>
            MANOS ({displayHandsWithIdx.length}{hasFilters ? ` / ${hands.length}` : ''})
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
                  style={{ ...rp.handItem, ...(i === curIdx ? rp.handItemActive : {}) }}
                  onClick={() => goHand(i)}>
                  <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                    {cards.length > 0
                      ? cards.map((c, ci) => {
                          const suit = c.slice(-1).toLowerCase()
                          const bg   = SUIT_BG[COLORS[suit]] || '#222'
                          const r    = RANKS[c.slice(0,-1)] || c.slice(0,-1)
                          const s    = SUITS[suit] || suit
                          return (
                            <div key={ci} style={{ width:30, height:44, borderRadius:5, background:bg,
                              border:'1px solid rgba(0,0,0,.3)', display:'flex', flexDirection:'column',
                              alignItems:'center', justifyContent:'center', color:'#fff', gap:1,
                              boxShadow:'0 2px 5px rgba(0,0,0,.6)', flexShrink:0 }}>
                              <span style={{ fontSize:14, lineHeight:1 }}>{s}</span>
                              <span style={{ fontSize:11, fontWeight:900, lineHeight:1 }}>{r}</span>
                            </div>
                          )
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
                      {(net >= 0 ? '+' : '') + fmtChips(net)}
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
                    style={{ ...rp.handItem, ...(i === curIdx ? rp.handItemActive : {}) }}
                    onClick={() => goHand(i)}>
                    <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                      {cards.length > 0
                        ? cards.map((c, ci) => {
                            const suit = c.slice(-1).toLowerCase()
                            const bg   = SUIT_BG[COLORS[suit]] || '#222'
                            const r    = RANKS[c.slice(0,-1)] || c.slice(0,-1)
                            const sv   = SUITS[suit] || suit
                            return (
                              <div key={ci} style={{ width:30, height:44, borderRadius:5, background:bg,
                                border:'1px solid rgba(0,0,0,.3)', display:'flex', flexDirection:'column',
                                alignItems:'center', justifyContent:'center', color:'#fff', gap:1,
                                boxShadow:'0 2px 5px rgba(0,0,0,.6)', flexShrink:0 }}>
                                <span style={{ fontSize:14, lineHeight:1 }}>{sv}</span>
                                <span style={{ fontSize:11, fontWeight:900, lineHeight:1 }}>{r}</span>
                              </div>
                            )
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
                        {(net >= 0 ? '+' : '') + fmtChips(net)}
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
    </div>
  )
}


// ── Styles ────────────────────────────────────────────────────────────
const page = { height:'100vh', background:'radial-gradient(ellipse at 30% 20%,#1a2a3a 0%,#0d1520 40%,#050b10 100%)',
  display:'flex', flexDirection:'column', fontFamily:"'Segoe UI',system-ui,sans-serif", color:'#dde0e8', overflow:'hidden' }

const hdr = {
  root:    { background:'#1a1e2a', borderBottom:'1px solid #2a3040', padding:'8px 16px',
             display:'flex', alignItems:'center', gap:16, flexShrink:0, flexWrap:'wrap' },
  back:    { background:'#1a2838', color:'#5080a8', border:'1px solid #2a3a50', padding:'5px 12px',
             borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700, whiteSpace:'nowrap' },
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
               position:'relative', overflow:'hidden', gap:10 },
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
