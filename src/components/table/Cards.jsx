// Playing cards shared by the Visualizer and the live hand recorder
import { getCardImage, SUITS, COLORS, RANKS, SUIT_BG } from './cardAssets'

export function Card({ code, size = 'sm' }) {
  if (!code) return null
  const img = getCardImage(code)
  const d = { xs: [28,39], sm: [44,62], md: [58,82], lg: [70,98] }[size]
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
  const fd = { xs: [28,39,16,9,2], sm: [44,62,26,13,4], md: [58,82,36,16,5], lg: [70,98,44,19,6] }[size]
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

export function CardBack({ size = 'sm' }) {
  const d = { xs:[28,39], sm:[44,62], md:[58,82], lg:[70,98] }[size]
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

