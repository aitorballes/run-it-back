// Helpers for live tournaments: blind structure and level clock.
// A level is { sb, bb, ante }; level N (1-based) is structure[N - 1].
import { getLocale } from '../i18n/core'

const DEFAULT_BBS = [
  200, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000,
  6000, 8000, 10000, 12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000,
]

// Typical live structure with big blind ante; every value can be edited per tournament
export function defaultStructure() {
  return DEFAULT_BBS.map(bb => ({ sb: bb / 2, bb, ante: bb }))
}

// Standard big blind ladder: 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10^k
const LADDER = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8]
function nextOnLadder(bb) {
  for (let mag = 10 ** Math.floor(Math.log10(bb)); ; mag *= 10) {
    for (const n of LADDER) {
      const v = Math.round(n * mag)
      if (v > bb) return v
    }
  }
}

// Rounds small blinds and antes to chip-friendly steps (125/250 stay as they are)
function roundChips(x) {
  if (!(x > 0)) return 0
  const step = Math.max(1, 5 * 10 ** (Math.floor(Math.log10(x)) - 2))
  return Math.max(step, Math.round(x / step) * step)
}

// Next level after `last`: next big blind on the ladder and the same duration. SB/BB and ante/BB ratios
// come from `ref` (by default `last`), so a chain of levels doesn't drift with rounding
export function extrapolateLevel(last, ref = last) {
  if (!last?.bb) return { sb: 100, bb: 200, ante: 200, ...(last?.minutes ? { minutes: last.minutes } : null) }
  const bb = nextOnLadder(last.bb)
  return {
    sb: ref.sb && ref.bb ? roundChips(bb * (ref.sb / ref.bb)) : 0,
    bb,
    ante: ref.ante && ref.bb ? roundChips(bb * (ref.ante / ref.bb)) : 0,
    ...(last.minutes ? { minutes: last.minutes } : null),
  }
}

// Keeps levels up to index `fromIndex` and recalculates the following ones from it, up to `length` levels.
// Breaks stay where they were (a break belongs to the schedule, not to the blinds)
export function recalcAfter(structure, fromIndex, length = structure.length) {
  const out = structure.slice(0, fromIndex + 1)
  const ref = out[fromIndex]
  while (out.length < length) {
    const lvl = extrapolateLevel(out[out.length - 1], ref)
    const breakAfter = structure[out.length]?.breakAfter
    out.push(breakAfter ? { ...lvl, breakAfter } : lvl)
  }
  return out
}

// Sets a break of `minutes` after level `after` and, with `every`, after every `every` levels from there
export function addBreaks(structure, after, minutes, every) {
  const out = structure.map(l => ({ ...l }))
  for (let n = after; n >= 1 && n <= out.length; n += every > 0 ? every : Infinity) out[n - 1].breakAfter = minutes
  return out
}

// Edits one value of a level. Changing the big blind carries along a big blind ante (ante = BB)
// and a small blind that was exactly half of it
export function editLevelValue(level, key, value) {
  const next = { ...level, [key]: value }
  if (key === 'bb') {
    if (level.ante && level.ante === level.bb) next.ante = value
    if (level.sb && level.sb * 2 === level.bb) next.sb = Math.round(value / 2)
  }
  return next
}

// Level n (1-based); beyond the end of the structure it keeps growing from the last level
export function levelAt(structure, n) {
  if (n <= structure.length) return structure[n - 1]
  const ref = structure[structure.length - 1]
  let lvl = ref
  for (let i = structure.length; i < n; i++) lvl = extrapolateLevel(lvl, ref)
  return lvl
}

// Duration of level n in minutes; levels without their own duration use the tournament's
export const levelMinutes = (t, n) => levelAt(t.structure, n)?.minutes || t.level_minutes

// Minutes of the break after level n (0 = no break)
export const breakMinutes = (t, n) => (n <= t.structure.length ? t.structure[n - 1]?.breakAfter || 0 : 0)

export const isPaused = t => t.level_ends_at == null

// Full length in seconds of what is being played now (the level, or the break after it): the clock can't go above it
export const periodSeconds = t => (t.on_break ? breakMinutes(t, t.current_level) : levelMinutes(t, t.current_level)) * 60

// Seconds left in the current level
export function remainingSeconds(t, now = Date.now()) {
  if (isPaused(t)) return Math.max(0, t.paused_remaining ?? (t.on_break ? breakMinutes(t, t.current_level) : levelMinutes(t, t.current_level)) * 60)
  return Math.max(0, Math.ceil((new Date(t.level_ends_at).getTime() - now) / 1000))
}

// With the clock running, moves on as many levels (and breaks) as have elapsed. Returns the patch or null.
// While on_break, current_level is the level the break comes after
export function advanceClock(t, now = Date.now()) {
  if (isPaused(t) || t.status !== 'running') return null
  let ends = new Date(t.level_ends_at).getTime()
  if (ends > now) return null
  let level = t.current_level
  let onBreak = !!t.on_break
  while (ends <= now) {
    const pause = onBreak ? 0 : breakMinutes(t, level)
    if (pause > 0) { onBreak = true; ends += pause * 60 * 1000 }
    else { onBreak = false; level++; ends += levelMinutes(t, level) * 60 * 1000 }
  }
  return { current_level: level, on_break: onBreak, level_ends_at: new Date(ends).toISOString() }
}

// Clock patch for jumping to `level` (or the break after it) with `seconds` left, keeping the clock paused or running
export function setLevelClock(t, level, seconds, now = Date.now(), onBreak = false) {
  return isPaused(t)
    ? { current_level: level, on_break: onBreak, paused_remaining: seconds, level_ends_at: null }
    : { current_level: level, on_break: onBreak, paused_remaining: null, level_ends_at: new Date(now + seconds * 1000).toISOString() }
}

export function averageStack(t) {
  if (!t.entries || !t.players_left || !t.starting_stack) return null
  return (t.entries * t.starting_stack) / t.players_left
}

export const inBigBlinds = (chips, level) => (chips != null && level?.bb ? chips / level.bb : null)

export function formatClock(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

// Parses user input like "25000", "25.000" or "25,000" into an integer (null if empty/invalid).
// Also "45k", "1,2m" or "1.5M", the way players say stacks at the table
export function parseChips(value) {
  const str = String(value ?? '').trim()
  const short = /^(\d+(?:[.,]\d+)?)\s*([km])$/i.exec(str)
  if (short) return Math.round(parseFloat(short[1].replace(',', '.')) * (short[2].toLowerCase() === 'k' ? 1e3 : 1e6))
  const digits = str.replace(/[^\d]/g, '')
  return digits ? parseInt(digits, 10) : null
}

// Seconds of play until the next break (counting from the clock as it is now), with the break's
// level and minutes; null on a break or when no break is set ahead
export function nextBreakIn(t, now = Date.now()) {
  if (t.on_break) return null
  let level = t.current_level
  let seconds = remainingSeconds(t, now)
  for (let guard = 0; level <= t.structure.length && guard < 60; guard++) {
    const minutes = breakMinutes(t, level)
    if (minutes > 0) return { seconds, level, minutes }
    level++
    seconds += levelMinutes(t, level) * 60
  }
  return null
}

// "1 h 05 min" / "25 min"
export function formatDuration(seconds) {
  const mins = Math.max(0, Math.round(seconds / 60))
  const h = Math.floor(mins / 60)
  return h ? `${h} h ${String(mins % 60).padStart(2, '0')} min` : `${mins} min`
}

// ── Number fields: thousands separators appear as you type ("109000" → "109.000" in Spanish) ──
const decimalSep = () => (1.5).toLocaleString(getLocale()).charAt(1)
// 'always' so Spanish also groups 4 digits (1.500, not 1500)
export const groupDigits = digits => (digits === '' || digits == null ? '' : Number(digits).toLocaleString(getLocale(), { useGrouping: 'always' }))

// Whole numbers (chips, players, entries). A typed "k"/"m" shorthand (109k) is kept as written
export function typeChips(value) {
  const str = String(value ?? '')
  if (/^\s*\d+([.,]\d+)?\s*[km]\s*$/i.test(str)) return str
  return groupDigits(str.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))
}

// Money (buy-in, prize): whole part grouped, up to 2 decimals. A "." or "," typed at the end starts the
// decimals whatever the language (formatting never ends in a separator), so either key on the pad works.
export function typeMoney(value) {
  const sep = decimalSep()
  let str = String(value ?? '')
  if (/[.,]$/.test(str) && !str.slice(0, -1).includes(sep)) str = str.slice(0, -1) + sep
  const at = str.indexOf(sep)
  const whole = (at < 0 ? str : str.slice(0, at)).replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  if (at < 0) return groupDigits(whole)
  return `${groupDigits(whole) || '0'}${sep}${str.slice(at + 1).replace(/\D/g, '').slice(0, 2)}`
}

// Reads back what typeMoney wrote
export function parseMoney(value) {
  const sep = decimalSep()
  const str = String(value ?? '')
  const at = str.indexOf(sep)
  const whole = (at < 0 ? str : str.slice(0, at)).replace(/\D/g, '')
  const frac = at < 0 ? '' : str.slice(at + 1).replace(/\D/g, '')
  if (!whole && !frac) return null
  return parseFloat(`${whole || 0}.${frac || 0}`)
}
