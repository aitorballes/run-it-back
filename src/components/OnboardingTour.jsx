import { useState, useEffect, useLayoutEffect, useCallback } from 'react'

// Each step points at an element marked with data-tour="<target>".
// Steps whose element isn't on screen when the tour starts are skipped.
const PAD = 6
const GAP = 12
const CARD_W = 300

export default function OnboardingTour({ steps, onClose }) {
  const [active] = useState(() => steps.filter(st => document.querySelector(`[data-tour="${st.target}"]`)))
  const [index, setIndex] = useState(0)
  const [rect, setRect]   = useState(null)

  const step   = active[index]
  const isLast = index === active.length - 1

  const measure = useCallback(() => {
    const el = step && document.querySelector(`[data-tour="${step.target}"]`)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step])

  useLayoutEffect(() => {
    const el = step && document.querySelector(`[data-tour="${step.target}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top < 70 || r.bottom > window.innerHeight - 20) el.scrollIntoView({ block: 'center' })
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [step, measure])

  useEffect(() => {
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure])

  const next = useCallback(() => (isLast ? onClose() : setIndex(i => i + 1)), [isLast, onClose])
  const prev = useCallback(() => setIndex(i => Math.max(0, i - 1)), [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, onClose])

  useEffect(() => {
    if (active.length === 0) onClose()
  }, [active, onClose])

  if (!step || !rect) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const cardW = Math.min(CARD_W, vw - 24)
  const below = rect.bottom + GAP + 180 < vh || rect.top < vh / 2
  const left  = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 12)
  const arrowLeft = Math.min(Math.max(16, rect.left + rect.width / 2 - left - 7), cardW - 30)

  return (
    <div style={t.root}>
      {/* Click-catcher so the page underneath can't be used mid-tour */}
      <div style={t.backdrop} />
      <div style={{
        ...t.spot,
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }} />

      <div
        role="dialog"
        aria-label={step.title}
        style={{
          ...t.card,
          width: cardW,
          left,
          ...(below
            ? { top: rect.bottom + PAD + GAP }
            : { bottom: vh - rect.top + PAD + GAP }),
        }}
      >
        <div style={{ ...t.arrow, left: arrowLeft, ...(below ? t.arrowTop : t.arrowBottom) }} />
        <div style={t.counter}>{index + 1} / {active.length}</div>
        <div style={t.title}>{step.title}</div>
        <div style={t.body}>{step.body}</div>
        <div style={t.actions}>
          {!isLast && <button style={t.skip} onClick={onClose}>Saltar guía</button>}
          <div style={{ flex: 1 }} />
          {index > 0 && <button style={t.secondary} onClick={prev}>Anterior</button>}
          <button style={t.primary} onClick={next} autoFocus>
            {isLast ? 'Entendido' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>
  )
}

const t = {
  root: { position: 'fixed', inset: 0, zIndex: 1000 },
  backdrop: { position: 'absolute', inset: 0 },
  spot: {
    position: 'fixed',
    borderRadius: 10,
    boxShadow: '0 0 0 9999px rgba(3,8,14,0.72), 0 0 0 2px #3a8ae0, 0 0 24px rgba(60,140,255,0.45)',
    pointerEvents: 'none',
    transition: 'all 0.25s ease',
  },
  card: {
    position: 'fixed',
    boxSizing: 'border-box',
    background: 'linear-gradient(160deg, #1a2030 0%, #111828 100%)',
    border: '1px solid #2a3a52',
    borderRadius: 12,
    padding: '16px 18px 14px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    transition: 'top 0.25s ease, bottom 0.25s ease, left 0.25s ease',
  },
  arrow: {
    position: 'absolute',
    width: 14,
    height: 14,
    background: '#1a2030',
    border: '1px solid #2a3a52',
    transform: 'rotate(45deg)',
  },
  arrowTop:    { top: -8, borderRight: 'none', borderBottom: 'none' },
  arrowBottom: { bottom: -8, borderLeft: 'none', borderTop: 'none', background: '#111828' },
  counter: { fontSize: 10, fontWeight: 800, color: '#3a5a7a', letterSpacing: '1px', marginBottom: 4 },
  title:   { fontSize: 15, fontWeight: 800, color: '#e8f0ff', marginBottom: 6 },
  body:    { fontSize: 13, lineHeight: 1.55, color: '#9ab0c8' },
  actions: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 },
  skip: {
    background: 'none', border: 'none', color: '#3a6080',
    fontSize: 12, cursor: 'pointer', padding: 0,
  },
  secondary: {
    background: 'none', border: '1px solid #1e3048', borderRadius: 7,
    color: '#5a8aaa', fontSize: 12, fontWeight: 700, padding: '6px 12px', cursor: 'pointer',
  },
  primary: {
    background: 'linear-gradient(135deg, #1e5cad, #0c3080)', border: '1px solid #2a4a80', borderRadius: 7,
    color: '#d0e8ff', fontSize: 12, fontWeight: 800, padding: '6px 14px', cursor: 'pointer',
  },
}
