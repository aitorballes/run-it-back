import { useEffect, useRef, useState } from 'react'
import { fmtNumber } from '../i18n/core'

// Line chart of the stack over the tournament (one point per update), with the average stack
// at each update as a second line. Hover/touch shows a crosshair and the values at that point.
// Colors validated for the dark card surface (dataviz validator: lightness, CVD, contrast).
const C_STACK = '#36a862'
const C_AVG   = '#4a96e0'
const H = 190
const PAD = { top: 12, right: 14, bottom: 24, left: 44 }

const compact = n => (n >= 1e6 ? `${fmtNumber(n / 1e6, { maximumFractionDigits: 1 })}M`
  : n >= 1e4 ? `${fmtNumber(n / 1e3, { maximumFractionDigits: 0 })}K` : fmtNumber(n))

function niceStep(max, ticks = 4) {
  const raw = max / ticks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
}

// points: [{ idx, day, at, stack, avg, level, bb }]. Tapping the chart calls onSelect(idx) of the nearest point.
// Points are evenly spaced (not by time) so a multi-day tournament doesn't squeeze each day by the night between
export default function StackChart({ points, labels, locale, selected, onSelect, multiDay }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const raf = requestAnimationFrame(measure) // first size even if the observer is delayed
    return () => { ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  const pts = points.filter(p => p.stack != null)
  const hasAvg = pts.some(p => p.avg != null)
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = H - PAD.top - PAD.bottom

  const maxV = Math.max(...pts.map(p => Math.max(p.stack, p.avg ?? 0)), 1)
  const step = niceStep(maxV)
  const yMax = Math.ceil((maxV * 1.05) / step) * step
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step)

  const x = i => PAD.left + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW)
  // Where a new day starts: between the last point of one day and the first of the next
  const dayStarts = pts.map((p, i) => (i > 0 && p.day !== pts[i - 1].day ? i : null)).filter(i => i != null)
  const y = v => PAD.top + plotH - (v / yMax) * plotH
  const path = key => pts.map((p, i) => (p[key] == null ? null : `${x(i)},${y(p[key])}`)).filter(Boolean).join(' L')
  const fmtTime = at => new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  function nearest(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    let best = 0
    pts.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i })
    return best
  }
  const onPointer = e => setHover(nearest(e))
  const sel = pts.findIndex(p => p.idx === selected)

  const h = hover != null ? pts[hover] : null
  const last = pts.length - 1

  return (
    <div ref={wrapRef} style={st.wrap}>
      {hasAvg && (
        <div style={st.legend}>
          <span style={st.key}><span style={{ ...st.line, background: C_STACK }} />{labels.stack}</span>
          <span style={st.key}><span style={{ ...st.line, background: C_AVG }} />{labels.average}</span>
        </div>
      )}
      {width > 0 && pts.length > 0 && (
        <svg width={width} height={H} style={{ display: 'block', touchAction: 'pan-y', cursor: onSelect ? 'pointer' : 'default' }}
          onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHover(null)}
          onClick={e => onSelect?.(pts[nearest(e)].idx)}
          role="img" aria-label={labels.title}>
          {ticks.map(v => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} stroke="#1e2a3c" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" style={st.axis}>{compact(v)}</text>
            </g>
          ))}
          <text x={PAD.left} y={H - 6} textAnchor="start" style={st.axis}>{fmtTime(pts[0].at)}</text>
          {last > 0 && <text x={PAD.left + plotW} y={H - 6} textAnchor="end" style={st.axis}>{fmtTime(pts[last].at)}</text>}

          {dayStarts.map(i => {
            const dx = (x(i - 1) + x(i)) / 2
            return (
              <g key={`d${i}`}>
                <line x1={dx} x2={dx} y1={PAD.top} y2={PAD.top + plotH} stroke="#2e4058" strokeWidth="1" />
                <text x={dx > width - 60 ? dx - 4 : dx + 4} y={PAD.top + 9} textAnchor={dx > width - 60 ? 'end' : 'start'} style={st.axis}>{labels.day(pts[i].day)}</text>
              </g>
            )
          })}
          {hasAvg && <path d={`M${path('avg')}`} fill="none" stroke={C_AVG} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          <path d={`M${path('stack')}`} fill="none" stroke={C_STACK} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {h && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="#4a6a8a" strokeWidth="1" />}
          {/* Every update is a point you can tap; the selected one gets a ring */}
          {pts.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.stack)} r={i === last || i === hover || i === sel ? 4.5 : 3}
              fill={C_STACK} stroke="#151c2c" strokeWidth="2" />
          ))}
          {sel >= 0 && <circle cx={x(sel)} cy={y(pts[sel].stack)} r="8" fill="none" stroke="#e0ecff" strokeWidth="1.5" />}
          {h?.avg != null && <circle cx={x(hover)} cy={y(h.avg)} r="4.5" fill={C_AVG} stroke="#151c2c" strokeWidth="2" />}
        </svg>
      )}
      {h && (
        <div style={{ ...st.tip, ...(x(hover) > width / 2 ? { right: width - x(hover) + 10 } : { left: x(hover) + 10 }) }}>
          <div style={st.tipHead}>{multiDay ? `${labels.day(h.day)} · ` : ''}{fmtTime(h.at)} · {labels.level} {h.level}</div>
          <div style={st.tipRow}>
            <span style={{ ...st.line, background: C_STACK }} />
            <b style={st.tipVal}>{fmtNumber(h.stack)}</b>
            {h.bb != null && <span style={st.tipSub}>{fmtNumber(h.bb, { maximumFractionDigits: h.bb < 10 ? 1 : 0 })} BB</span>}
          </div>
          {h.avg != null && (
            <div style={st.tipRow}>
              <span style={{ ...st.line, background: C_AVG }} />
              <b style={st.tipVal}>{fmtNumber(Math.round(h.avg))}</b>
              <span style={st.tipSub}>{labels.average}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const st = {
  wrap: { position: 'relative', width: '100%' },
  legend: { display: 'flex', gap: 14, marginBottom: 6, fontSize: 11, color: '#7a94b0', fontWeight: 600 },
  key: { display: 'flex', alignItems: 'center', gap: 6 },
  line: { display: 'inline-block', width: 14, height: 2, borderRadius: 1, flexShrink: 0 },
  axis: { fontSize: 10, fill: '#4a6a8a', fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums' },
  tip: {
    position: 'absolute', top: 24, pointerEvents: 'none',
    background: 'rgba(8,14,24,0.96)', border: '1px solid #2a3a52', borderRadius: 8,
    padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 4, whiteSpace: 'nowrap',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  tipHead: { fontSize: 10, color: '#7a94b0', fontWeight: 700 },
  tipRow: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 },
  tipVal: { color: '#e0ecff', fontVariantNumeric: 'tabular-nums' },
  tipSub: { color: '#7a94b0', fontSize: 11 },
}
