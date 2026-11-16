// Table aids for the live clock: keeping the screen on and beeping/vibrating when the level changes
import { useEffect } from 'react'

let audioCtx = null

// Browsers only let a page play sound after a tap: call this from one (it's cheap to repeat)
export function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    audioCtx ??= new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume()
  } catch { /* no audio */ }
}

// Plays tones one after another: [[frequency Hz, milliseconds], ...]
function tones(seq) {
  if (!audioCtx || audioCtx.state !== 'running') return
  let at = audioCtx.currentTime + 0.02
  for (const [freq, ms] of seq) {
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(at)
    osc.stop(at + ms / 1000 + 0.02)
    at += ms / 1000 + 0.08
  }
}

const vibrate = pattern => { try { navigator.vibrate?.(pattern) } catch { /* not supported (iPhone) */ } }

// 'minute': one minute left in the level · 'level': new level · 'break': a break starts
export function playAlert(kind) {
  if (kind === 'minute') { tones([[880, 180]]); vibrate(200) }
  else if (kind === 'break') { tones([[660, 260], [520, 400]]); vibrate([300, 150, 300]) }
  else { tones([[660, 180], [880, 180], [1100, 320]]); vibrate([200, 100, 200, 100, 400]) }
}

export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator

// Keeps the screen on while `enabled`; the browser drops the lock when the page is hidden, so it's
// taken again when the page comes back
export function useWakeLock(enabled) {
  useEffect(() => {
    if (!enabled || !wakeLockSupported()) return
    let lock = null
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const l = await navigator.wakeLock.request('screen')
        if (cancelled) l.release().catch(() => {})
        else lock = l
      } catch { /* denied (e.g. battery saver) */ }
    }
    acquire()
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [enabled])
}

// Per-device on/off preference
export function readPref(key) {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
export function writePref(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0') } catch { /* storage unavailable */ }
}
