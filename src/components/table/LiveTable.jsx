import { useEffect, useRef, useState } from 'react'
import { Card, CardBack } from './Cards'
import { feltStyle } from './geometry'
import { fmtNumber } from '../../i18n/core'

// Portrait poker table for the live hand recorder: same felt and cards as the Visualizer, laid out for a
// phone (seat 0 = hero at the bottom). Tapping a seat calls onSeatClick(i).
//
// seats: [{ name, pos, stack, stackUnknown, cards, showCards, folded, allin, bet, active, winner, hasNote, selected }]
// hideCards: no hole cards at all (just who sits where)
export default function LiveTable({ seats, dealer, board, pot, potLabel, onSeatClick, hideCards }) {
  const ref = useRef(null)
  const [w, setW] = useState(0)

  useEffect(() => {
    const el = ref.current
    const measure = () => setW(Math.min(520, Math.floor(el.getBoundingClientRect().width)))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const raf = requestAnimationFrame(measure)
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  const h = Math.round(w * 1.18)
  const cx = w / 2, cy = h / 2
  const rx = w / 2 - 40, ry = h / 2 - 46
  const n = seats.length
  const at = (i, k = 1) => {
    const rad = (180 + 360 * i / n) * Math.PI / 180
    return { x: cx + rx * k * Math.sin(rad), y: cy - ry * k * Math.cos(rad) }
  }
  const boardCards = [...(board?.flop ?? []), board?.turn, board?.river].filter(Boolean)

  return (
    <div ref={ref} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {w > 0 && (
        <div style={{ position: 'relative', width: w, height: h }}>
          <div style={{ ...feltStyle, top: 40, bottom: 40, left: 22, right: 22, borderWidth: 12 }} />

          {/* Board and pot */}
          <div style={st.center(cx, cy)}>
            {boardCards.length > 0 && (
              <div style={{ display: 'flex', gap: 3 }}>{boardCards.map((c, i) => <Card key={i} code={c} size="xs" />)}</div>
            )}
            {pot > 0 && (
              <div style={st.pot}>
                <span style={st.potLabel}>{potLabel}</span>
                <span style={st.potValue}>{fmtNumber(pot)}</span>
              </div>
            )}
          </div>

          {/* Bets in front of each seat */}
          {seats.map((s, i) => s.bet > 0 && (
            <div key={`b${i}`} style={{ ...st.bet, left: at(i, 0.58).x, top: at(i, 0.58).y }}>{fmtNumber(s.bet)}</div>
          ))}

          {/* Dealer button */}
          {dealer != null && (() => {
            const p = at(dealer, 0.74)
            return <div style={{ ...st.dealer, left: p.x + 16, top: p.y - 6 }}>D</div>
          })()}

          {/* Seats */}
          {seats.map((s, i) => {
            const p = at(i)
            const isHero = i === 0
            const border = s.winner || s.selected ? '#ffe566' : s.active ? '#5090d0' : isHero ? '#c8a800' : s.allin ? '#cc3333' : '#253045'
            return (
              <button key={i} type="button" onClick={() => onSeatClick?.(i)}
                style={{ ...st.seat, left: p.x, top: p.y, opacity: s.folded ? 0.38 : 1, cursor: onSeatClick ? 'pointer' : 'default' }}>
                {!hideCards && <div style={{ display: 'flex', gap: 2, height: 39 }}>
                  {s.folded ? null : s.cards?.length === 2 && s.showCards
                    ? s.cards.map((c, k) => <Card key={k} code={c} size="xs" />)
                    : [0, 1].map(k => <CardBack key={k} size="xs" />)}
                </div>}
                <div style={{
                  ...st.box,
                  border: `1px solid ${border}`,
                  background: isHero ? 'linear-gradient(to bottom,#2a2210,#1a1600)' : 'linear-gradient(to bottom,#1a2035,#101520)',
                  boxShadow: s.active ? '0 0 10px rgba(60,130,220,0.5)' : s.winner || s.selected ? '0 0 12px rgba(200,168,0,0.45)' : '0 2px 8px rgba(0,0,0,0.6)',
                }}>
                  <div style={{ ...st.name, color: isHero ? '#ffe566' : '#c8d4e8' }}>
                    {s.hasNote && <span style={{ color: '#f0c070' }}>✎ </span>}{s.name}
                  </div>
                  <div style={st.meta}>
                    <span style={st.pos}>{s.pos}</span>
                    <span style={{ color: s.allin ? '#ff7070' : '#50e080', fontWeight: 700 }}>
                      {s.allin ? 'AI' : s.stackUnknown ? '' : fmtNumber(s.stack ?? 0)}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const st = {
  center: (x, y) => ({
    position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none',
  }),
  pot: {
    background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(200,160,0,0.25)', borderRadius: 7,
    padding: '3px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  potLabel: { fontSize: 8, color: 'rgba(255,200,0,0.55)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  potValue: { fontSize: 13, color: '#ffd060', fontWeight: 900 },
  bet: {
    position: 'absolute', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
    background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,200,0,0.35)', color: '#ffd060',
    fontSize: 10, fontWeight: 800, borderRadius: 10, padding: '1px 7px', whiteSpace: 'nowrap',
  },
  dealer: {
    position: 'absolute', transform: 'translate(-50%,-50%)', width: 16, height: 16, borderRadius: '50%',
    background: '#f0f0f0', color: '#111', fontSize: 9, fontWeight: 900, display: 'flex',
    alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.6)', pointerEvents: 'none',
  },
  seat: {
    position: 'absolute', transform: 'translate(-50%,-62%)', width: 76, padding: 0, background: 'none', border: 'none',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: 'inherit',
    transition: 'opacity .2s',
  },
  box: { borderRadius: 7, padding: '3px 5px', width: '100%', boxSizing: 'border-box', textAlign: 'center' },
  name: { fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  meta: { display: 'flex', justifyContent: 'space-between', gap: 3, fontSize: 10, marginTop: 1 },
  pos: { color: '#5a7a9a', fontWeight: 700 },
}
