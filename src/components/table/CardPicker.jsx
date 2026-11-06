import { useState } from 'react'
import { SUITS } from './cardAssets'

const RANK_ORDER = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUIT_ORDER = ['s', 'h', 'd', 'c']
// Four-colour deck, easy to tell apart on a small screen
const SUIT_COLOR = { s: '#2a2a3a', h: '#c0202a', d: '#1a50c8', c: '#1a8a2a' }

// Bottom sheet to pick `count` cards. Cards in `used` are disabled (already dealt elsewhere in the hand).
export default function CardPicker({ title, count, initial = [], used, onDone, onClose, clearLabel, doneLabel, allowEmpty }) {
  const [sel, setSel] = useState(initial.filter(Boolean))

  function toggle(code) {
    if (count === 1) { onDone([code]); return } // one card: done on tap
    setSel(cur => (cur.includes(code) ? cur.filter(c => c !== code) : [...cur, code].slice(-count)))
  }

  return (
    <div style={st.backdrop} onClick={onClose}>
      <div style={st.sheet} onClick={e => e.stopPropagation()}>
        <div style={st.head}>
          <span style={st.title}>{title}</span>
          <span style={st.count}>{sel.length}/{count}</span>
        </div>
        <div style={st.grid}>
          {SUIT_ORDER.map(su => RANK_ORDER.map(r => {
            const code = r + su
            const on = sel.includes(code)
            const disabled = used?.has(code) && !initial.includes(code)
            return (
              <button key={code} type="button" disabled={disabled} onClick={() => toggle(code)}
                style={{
                  ...st.card,
                  background: disabled ? '#1a1f2a' : SUIT_COLOR[su],
                  color: disabled ? '#3a4558' : '#fff',
                  outline: on ? '2px solid #ffe566' : 'none',
                  transform: on ? 'scale(1.06)' : 'none',
                  cursor: disabled ? 'default' : 'pointer',
                }}>
                <span style={{ fontWeight: 900 }}>{r === 'T' ? '10' : r}</span>
                <span style={{ fontSize: 10 }}>{SUITS[su]}</span>
              </button>
            )
          }))}
        </div>
        <div style={st.actions}>
          {allowEmpty && <button type="button" style={st.ghost} onClick={() => onDone([])}>{clearLabel}</button>}
          <button type="button" style={st.ghost} onClick={onClose}>✕</button>
          {count > 1 && (
            <button type="button" style={{ ...st.done, opacity: sel.length === count ? 1 : 0.4 }}
              disabled={sel.length !== count} onClick={() => onDone(sel)}>{doneLabel}</button>
          )}
        </div>
      </div>
    </div>
  )
}

const st = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 560, background: '#111828', borderTop: '1px solid #2a3a52',
    borderRadius: '16px 16px 0 0', padding: '14px 12px calc(14px + env(safe-area-inset-bottom))',
    display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 -10px 40px rgba(0,0,0,0.6)',
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: 800, color: '#c8d8f0' },
  count: { fontSize: 12, fontWeight: 700, color: '#5a8ab0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(13, minmax(0, 1fr))', gap: 3 },
  card: {
    border: 'none', borderRadius: 5, padding: '6px 0', fontSize: 12, fontFamily: 'inherit',
    display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1, minWidth: 0, transition: 'transform .1s',
  },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  ghost: {
    background: 'none', border: '1px solid #1a3048', borderRadius: 8, color: '#5a8ab0',
    padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
  },
  done: {
    background: 'linear-gradient(135deg, #1e5cad 0%, #0c3080 100%)', border: '1px solid #2a4a80', borderRadius: 8,
    color: '#d0e8ff', padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 800,
  },
}
