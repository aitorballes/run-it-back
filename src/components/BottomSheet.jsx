import { useEffect } from 'react'
import { useVisualViewport } from './useVisualViewport'
import { base } from './liveStyles'

// Bottom sheet for the live pages (seat of a hand, note on a player). It stays inside the part of the
// screen the keyboard leaves visible and keeps the focused field in view; Esc or a tap outside closes it.
// `nav` = { onPrev, onNext, prevLabel, nextLabel } adds ‹ › buttons in the header.
export default function BottomSheet({ title, subtitle, onClose, closeLabel, nav, footer, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const vv = useVisualViewport()
  const fit = vv ? { inset: 'auto', left: 0, right: 0, top: vv.top, height: vv.height } : null
  function reveal(e) {
    const el = e.target
    if (el.matches('input:not([type=checkbox]), textarea')) setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300)
  }

  return (
    <div style={{ ...st.backdrop, ...fit }} onClick={onClose}>
      <div style={st.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} onFocus={reveal}>
        <div style={st.grabber} />
        <div style={st.head}>
          {nav && <button type="button" style={st.navBtn} onClick={nav.onPrev} disabled={!nav.onPrev} aria-label={nav.prevLabel} title={nav.prevLabel}>‹</button>}
          <div style={st.titles}>
            <div style={st.title}>{title}</div>
            {subtitle && <div style={st.subtitle}>{subtitle}</div>}
          </div>
          {nav && <button type="button" style={st.navBtn} onClick={nav.onNext} disabled={!nav.onNext} aria-label={nav.nextLabel} title={nav.nextLabel}>›</button>}
          <button type="button" style={st.close} onClick={onClose} aria-label={closeLabel} title={closeLabel}>✕</button>
        </div>
        <div style={st.body}>{children}</div>
        {footer && <div style={st.footer}>{footer}</div>}
      </div>
    </div>
  )
}

const st = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    ...base.card, gap: 0, width: '100%', maxWidth: 560, borderRadius: '16px 16px 0 0', borderBottom: 'none',
    padding: 0, maxHeight: '100%', boxSizing: 'border-box', overflow: 'hidden',
  },
  grabber: { width: 36, height: 4, borderRadius: 2, background: '#2a3a52', margin: '8px auto 0', flexShrink: 0 },
  head: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 10px 16px', borderBottom: '1px solid #1e2e42', flexShrink: 0 },
  titles: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: 800, color: '#e0ecff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  subtitle: { fontSize: 11, fontWeight: 700, color: '#5a7a9a', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  navBtn: {
    width: 44, height: 44, flexShrink: 0, borderRadius: 10, border: '1px solid #1e2e42', background: '#0a1422',
    color: '#9ac8f0', fontSize: 24, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
  },
  close: {
    width: 44, height: 44, flexShrink: 0, background: 'none', border: 'none', color: '#5a7a9a',
    fontSize: 18, cursor: 'pointer', padding: 0,
  },
  body: {
    display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px',
    overflowY: 'auto', overscrollBehavior: 'contain', minHeight: 0, flex: '1 1 auto',
  },
  footer: {
    display: 'flex', gap: 8, padding: '10px 16px calc(12px + env(safe-area-inset-bottom))',
    borderTop: '1px solid #1e2e42', flexShrink: 0,
  },
}
