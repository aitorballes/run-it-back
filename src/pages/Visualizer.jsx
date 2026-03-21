import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// ── Constants ─────────────────────────────────────────────────────────
const SUITS       = { h: '♥', d: '♦', s: '♠', c: '♣' }
const COLORS      = { h: 'hearts', d: 'diamonds', s: 'spades', c: 'clubs' }
const RANKS       = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
const SUIT_BG     = { hearts: '#c0202a', diamonds: '#1a50c8', spades: '#222230', clubs: '#1a8a2a' }
const STREET_ORDER = ['preflop', 'flop', 'turn', 'river']
const STREET_LABEL = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' }
const CX = 360, CY = 248, RX = 300, RY = 178

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
  return <div style={{ width:d[0], height:d[1], background:'linear-gradient(145deg,#2a6a38,#163c1e)',
    borderRadius:7, border:'2px solid #1a4a28', boxShadow:'inset 0 0 8px rgba(0,0,0,.4),0 2px 6px rgba(0,0,0,.6)', flexShrink:0 }} />
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
  const { id } = useParams()
  const navigate = useNavigate()

  const [tournament, setTournament] = useState(null)
  const [hands,      setHands]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [curIdx,     setCurIdx]     = useState(0)
  const [curStep,    setCurStep]    = useState(0)
  const [playing,    setPlaying]    = useState(false)
  const [scale,      setScale]      = useState(1)
  const [displayBB,  setDisplayBB]  = useState(false)

  const areaRef    = useRef()
  const timerRef   = useRef()

  // ── Load ──
  useEffect(() => {
    async function load() {
      try {
        const { data: t } = await supabase.from('tournaments').select('*').eq('id', id).single()
        setTournament(t)
        const { data: rows } = await supabase
          .from('hands').select('raw').eq('tournament_id', id).order('id', { ascending: true })
        setHands(rows.map(r => r.raw))
      } catch(e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [id])

  // ── Rescale ──
  useEffect(() => {
    function rescale() {
      const area = areaRef.current
      if (!area) return
      const availW = area.clientWidth - 24
      const availH = area.clientHeight - 130
      setScale(Math.min(availW / 720, availH / 500, 1.0))
    }
    rescale()
    window.addEventListener('resize', rescale)
    return () => window.removeEventListener('resize', rescale)
  }, [loading])

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
        if (e.key === 'ArrowLeft')  goHand(curIdx - 1)
        if (e.key === 'ArrowRight') goHand(curIdx + 1)
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
    setPlaying(false); setCurIdx(idx); setCurStep(0)
  }

  function jumpToStreet(street) {
    const h = hands[curIdx]
    const start = h?.streetStartStep[street]
    if (start != null) setCurStep(start)
  }

  if (loading) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Cargando...</div>
  if (!hands.length) return <div style={{...page, alignItems:'center', justifyContent:'center', color:'#4a6080'}}>Sin manos.</div>

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

  const fmt  = makeFmt(displayBB, hand.bb)
  const bets = getBetsByStep(hand, curStep)
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
        <button style={hdr.back} onClick={() => navigate('/')}>← Torneos</button>
        <div style={hdr.center}>
          <span style={hdr.name}>{tournament?.name}</span>
          <span style={hdr.level}>Nivel {hand.level} · {fmtChips(hand.sb)}/{fmtChips(hand.bb)}</span>
          <span style={hdr.meta}>Mesa {hand.tableNum} · {hand.datetime}</span>
        </div>
        <div style={hdr.counter}>{curIdx + 1} / {hands.length}</div>
      </div>

      {/* ── BODY ── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ── TABLE AREA ── */}
        <div ref={areaRef} style={ta.root}>

          {/* Table */}
          <div style={{ position:'relative', width:720, height:500, flexShrink:0,
            transform:`scale(${scale})`, transformOrigin:'top center',
            marginBottom: Math.round(500*(scale-1))+'px',
            marginLeft: Math.round(720*(scale-1)/2)+'px',
            marginRight: Math.round(720*(scale-1)/2)+'px' }}>

            {/* Felt */}
            <div style={ta.felt} />

            {/* Board */}
            <div style={ta.boardWrap}>
              <div style={{ display:'flex', gap:7 }}>
                {boardCards.map((c,i) => <Card key={i} code={c} size="lg" />)}
              </div>
              {totalWon > 0 && <div style={ta.pot}>Bote: {fmt(totalWon)}</div>}
            </div>

            {/* Seats */}
            {ordered.map((seat, i) => {
              const pos      = positions[i]
              const isHero   = seat.player === 'Hero'
              const isFolded = foldedPlayers.has(seat.player)
              const isAllin  = allinPlayers.has(seat.player)
              const isWinner = winnerPlayers.has(seat.player)
              const isActive = seat.player === activePlayer
              const cards    = hand.holeCards[seat.player]

              const badgeTxt = seat.num === hand.buttonSeat ? 'BTN'
                : seat.pos === 'SB' ? 'SB' : seat.pos === 'BB' ? 'BB'
                : isHero ? 'HERO' : ''
              const badgeStyle = seat.num === hand.buttonSeat
                ? { background:'#8c6010', color:'#ffe580' }
                : seat.pos === 'SB' ? { background:'#1a4060', color:'#70c0ff' }
                : seat.pos === 'BB' ? { background:'#1a3a1a', color:'#70e070' }
                : { background:'#6a5000', color:'#ffe566' }

              const ab = isActive && activeAction ? badgeInfo(activeAction, fmt) : null

              return (
                <div key={seat.num} style={{
                  position:'absolute', left:pos.x, top:pos.y,
                  transform:'translate(-50%,-50%)',
                  display:'flex', flexDirection:'column', alignItems:'center',
                  gap:2, width:114, opacity: isFolded ? 0.35 : 1, pointerEvents:'none' }}>

                  {/* Top cards */}
                  {!isHero && (
                    <div style={{ display:'flex', gap:3, marginBottom:2 }}>
                      {cards
                        ? cards.map((c,ci) => <Card key={ci} code={c} size="sm" />)
                        : [0,1].map(ci => <CardBack key={ci} size="sm" />)}
                    </div>
                  )}

                  {/* Position badge */}
                  {badgeTxt && (
                    <div style={{ fontSize:9, fontWeight:800, letterSpacing:1, padding:'1px 7px', borderRadius:3, ...badgeStyle }}>
                      {badgeTxt}{isAllin ? ' · AI' : ''}
                    </div>
                  )}

                  {/* Seat box */}
                  <div style={{
                    background: isHero ? 'linear-gradient(to bottom,#252010,#181600)' : 'linear-gradient(to bottom,#222830,#161c24)',
                    border:`1px solid ${isWinner ? '#ffe566' : isHero ? '#b89800' : isAllin ? '#cc3333' : '#30384a'}`,
                    borderRadius:6, padding:'5px 8px', textAlign:'center', width:'100%',
                    boxShadow: isWinner ? '0 0 10px #c8a80066' : 'none' }}>
                    <div style={{ fontSize:11, fontWeight:700, color: isHero ? '#ffe566' : '#c8d4e8',
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:96 }}>
                      {isHero ? '★ Hero' : seat.player.slice(0,8)}
                    </div>
                    <div style={{ fontSize:11, color:'#40d840', fontWeight:700, marginTop:2 }}>
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

                  {/* Hero bottom cards */}
                  {isHero && cards && (
                    <div style={{ display:'flex', gap:3, marginTop:4 }}>
                      {cards.map((c,ci) => <Card key={ci} code={c} size="md" />)}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Chip bets */}
            {Array.from(bets.entries()).map(([player, amount]) => {
              const si = ordered.findIndex(s => s.player === player)
              if (si < 0) return null
              const pos = positions[si]
              return (
                <div key={player} style={{ position:'absolute',
                  left: pos.x + (CX - pos.x) * 0.38,
                  top:  pos.y + (CY - pos.y) * 0.38,
                  transform:'translate(-50%,-50%)', pointerEvents:'none' }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'#ffe080',
                    textShadow:'0 1px 4px rgba(0,0,0,.95)', whiteSpace:'nowrap',
                    background:'rgba(0,0,0,.75)', border:'1px solid rgba(200,160,0,.35)',
                    borderRadius:4, padding:'2px 7px' }}>
                    {fmt(amount)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Controls ── */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, flexShrink:0 }}>

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
                { id:'prev',      icon:'⏮\uFE0E', disabled: curIdx === 0,           action: () => goHand(curIdx-1) },
                { id:'stepPrev',  icon:'⏪\uFE0E', disabled: curStep <= 0,           action: () => { setPlaying(false); setCurStep(s => Math.max(0, s-1)) } },
              ].map(b => <button key={b.id} style={ctrlBtn} disabled={b.disabled} onClick={b.action}>{b.icon}</button>)}

              <div style={{ minWidth:80, textAlign:'center' }}>
                <div style={{ fontSize:12, color:'#8090a8', fontWeight:700 }}>{curIdx+1} / {hands.length}</div>
                <div style={{ fontSize:10, color:'#4a6070' }}>paso {curStep+1}/{seq.length} · {STREET_LABEL[street]}</div>
              </div>

              {[
                { id:'stepNext', icon:'⏩\uFE0E', disabled: curStep >= seq.length-1, action: () => { setPlaying(false); setCurStep(s => Math.min(seq.length-1, s+1)) } },
                { id:'next',     icon:'⏭\uFE0E', disabled: curIdx >= hands.length-1,action: () => goHand(curIdx+1) },
              ].map(b => <button key={b.id} style={ctrlBtn} disabled={b.disabled} onClick={b.action}>{b.icon}</button>)}

              <button style={{ ...ctrlBtn, ...(playing ? ctrlBtnPlaying : {}) }}
                onClick={() => setPlaying(p => !p)}>
                {playing ? '⏸\uFE0E' : '▶\uFE0E'}
              </button>
            </div>

            {/* BB toggle */}
            <div style={{ alignSelf:'flex-start', display:'flex', alignItems:'center', gap:7, marginLeft:4 }}>
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
        <div style={rp.root}>
          <div style={rp.handsHeader}>MANOS ({hands.length})</div>
          <div style={rp.handsList}>
            {hands.map((h, i) => {
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
    </div>
  )
}


// ── Styles ────────────────────────────────────────────────────────────
const page = { height:'100vh', background:'radial-gradient(ellipse at 50% 45%,#585858 0%,#2c2c2c 40%,#0e0e0e 100%)',
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
  counter: { fontSize:12, color:'#607080', fontWeight:700, textAlign:'right', whiteSpace:'nowrap' },
}

const ta = {
  root:      { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
               position:'relative', overflow:'hidden', gap:10 },
  info:      { display:'flex', flexDirection:'column', alignItems:'center', gap:3, flexShrink:0 },
  infoName:  { fontSize:15, fontWeight:800, color:'#90b8e0' },
  infoLevel: { fontSize:12, fontWeight:600, color:'#4a6a88' },
  felt:      { position:'absolute', top:88, left:78, right:78, bottom:88,
               background:'radial-gradient(ellipse at 50% 40%,#2e7a3c 0%,#1c5228 60%,#113a1c 100%)',
               borderRadius:'50%', border:'22px solid #1a1a1a',
               boxShadow:'0 0 0 5px #4e4e4e,0 0 0 6px #1a1a1a,0 16px 60px rgba(0,0,0,.98),inset 0 0 70px rgba(0,0,0,.25)' },
  boardWrap: { position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-56%)',
               display:'flex', flexDirection:'column', alignItems:'center', gap:6 },
  pot:       { background:'#0e0e0e', border:'1px solid #2a5a2a', borderRadius:5, padding:'4px 18px',
               fontSize:13, color:'#50e050', fontWeight:700, textAlign:'center',
               textShadow:'0 0 10px rgba(60,220,60,.5)', letterSpacing:'0.5px' },
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
  handsHeader:    { padding:'8px 12px', fontSize:10, fontWeight:800, letterSpacing:1, color:'#3a5060',
                    borderBottom:'1px solid #1e2a3a', background:'#0a1018', flexShrink:0 },
  handsList:      { flex:1, overflowY:'auto' },
  handItem:       { padding:'8px 10px', cursor:'pointer', borderBottom:'1px solid #0f1820',
                    borderLeft:'3px solid transparent', transition:'background 0.12s',
                    display:'flex', alignItems:'center', gap:10 },
  handItemActive: { background:'#111e2e', borderLeftColor:'#3a7abf' },
}
