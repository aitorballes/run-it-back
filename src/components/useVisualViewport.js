import { useEffect, useState } from 'react'

// Part of the screen still visible when the on-screen keyboard is open (iOS keeps fixed elements behind it).
// Returns { top, height } in CSS px, or null where the browser has no visualViewport.
export function useVisualViewport() {
  const [box, setBox] = useState(() => read())

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setBox(read())
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])

  return box
}

function read() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  return vv ? { top: vv.offsetTop, height: vv.height } : null
}
