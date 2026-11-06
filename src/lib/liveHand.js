// Live hand engine: records a hand played at a live table as a log of inputs and turns it into the same
// `raw` hand shape the online parsers produce (see parseHand in parser.js), so the Visualizer, sharing,
// notes and study work on live hands unchanged.
//
// Pure module (no React, no Supabase). The hand is `setup` + `log`; the state is always recomputed by
// replaying the log, so undo = drop the last log entry, and a saved hand can be reopened and edited.
//
// setup = {
//   n, heroPos,                       // table size (2-10) and hero position label (POS_LABELS)
//   sb, bb, ante, anteType,           // anteType: 'bb' (big blind ante, paid once) | 'all' (every player)
//   players: [{ name, stack, cards }] // index 0 is the hero; stack null = unknown; cards optional
//   revealHoleCards,                  // show opponents' cards from the start in the Visualizer
// }
// log entries:
//   { type: 'action', player, kind: 'fold'|'check'|'call'|'bet'|'raise'|'allin', to? }  (to = total this street)
//   { type: 'board', cards: [...] }   (3 cards for the flop, 1 for turn/river)
//   { type: 'showdown', cards: { [player]: [c1, c2] }, winners?: [player...] }  (winners: manual pick)

import { POS_LABELS } from './handUtils.js'
import { buildSequence } from './parser.js'
import { evaluateShowdown } from './equityCalculator.js'

export const STREETS = ['preflop', 'flop', 'turn', 'river']
const UNKNOWN = 1e12 // stack of a player whose stack wasn't entered: covers everybody

export const positionLabels = n => POS_LABELS[n] ?? []

// Seat index of the button so that the hero (index 0) gets `heroPos`; labels[i] = position of seat i
export function seatLayout(n, heroPos) {
  const labels = positionLabels(n)
  const offset = Math.max(0, labels.indexOf(heroPos))
  const btn = (n - offset) % n
  return { btn, labels: Array.from({ length: n }, (_, i) => labels[(i - btn + n) % n]) }
}

const isHU = n => n === 2

// Seat indexes in preflop / postflop acting order
function actingOrder(n, btn, street) {
  const seats = Array.from({ length: n }, (_, k) => (btn + k) % n) // BTN, SB, BB, ...
  if (isHU(n)) return street === 'preflop' ? [seats[0], seats[1]] : [seats[1], seats[0]]
  return street === 'preflop'
    ? [...seats.slice(3), seats[0], seats[1], seats[2]]
    : [...seats.slice(1), seats[0]]
}

export const blindSeats = (n, btn) => (isHU(n) ? { sb: btn, bb: (btn + 1) % n } : { sb: (btn + 1) % n, bb: (btn + 2) % n })

// Rivals without a name are called by their position (UTG, CO...)
export const playerName = (setup, i) =>
  i === 0 ? 'Hero' : setup.players[i]?.name?.trim() || seatLayout(setup.n, setup.heroPos).labels[i] || `Seat ${i + 1}`

// Unique display names (two "?" rivals would collide as keys in the raw hand)
export function playerNames(setup) {
  const used = new Map()
  return setup.players.map((_, i) => {
    let name = playerName(setup, i)
    const seen = used.get(name) ?? 0
    used.set(name, seen + 1)
    if (seen) name = `${name} (${seen + 1})`
    return name
  })
}

// ── Replay ─────────────────────────────────────────────────────────────────────

export function replay(setup, log) {
  const { n } = setup
  const { btn, labels } = seatLayout(n, setup.heroPos)
  const names = playerNames(setup)
  const blinds = blindSeats(n, btn)

  const st = {
    n, btn, labels, names, blinds, bb: setup.bb,
    street: 'preflop',
    startStack: setup.players.map(p => (p.stack > 0 ? p.stack : UNKNOWN)),
    stack: [], committed: Array(n).fill(0), contributed: Array(n).fill(0), dead: Array(n).fill(0), // dead = antes
    folded: Array(n).fill(false), allin: Array(n).fill(false), acted: Array(n).fill(false),
    currentBet: 0, minRaise: setup.bb,
    board: { flop: [], turn: null, river: null },
    actions: { preflop: [], flop: [], turn: [], river: [] },
    lastActor: null,
    need: null, // what the hand is waiting for
    result: null,
    shown: {},
  }
  st.stack = [...st.startStack]

  const pay = (i, amount) => {
    const paid = Math.min(amount, st.stack[i])
    st.stack[i] -= paid
    st.contributed[i] += paid
    if (st.stack[i] <= 0) st.allin[i] = true
    return paid
  }

  // Antes are dead money (not part of the street's bets), then the blinds
  if (setup.ante > 0) {
    if (setup.anteType === 'all') for (let i = 0; i < n; i++) st.dead[i] = pay(i, setup.ante)
    else st.dead[blinds.bb] = pay(blinds.bb, setup.ante)
  }
  const sbPaid = pay(blinds.sb, setup.sb)
  st.committed[blinds.sb] = sbPaid
  st.actions.preflop.push({ player: names[blinds.sb], type: 'post-sb', amount: sbPaid, allin: st.allin[blinds.sb] })
  const bbPaid = pay(blinds.bb, setup.bb)
  st.committed[blinds.bb] = bbPaid
  st.actions.preflop.push({ player: names[blinds.bb], type: 'post-bb', amount: bbPaid, allin: st.allin[blinds.bb] })
  st.currentBet = setup.bb

  advance(st)
  for (const entry of log) {
    if (!st.need || st.need.type === 'done') break
    applyEntry(st, setup, entry, pay)
    advance(st)
  }
  return st
}

const active = st => st.folded.map((f, i) => (f ? null : i)).filter(i => i != null)
const needsToAct = (st, i) => !st.folded[i] && !st.allin[i] && (!st.acted[i] || st.committed[i] < st.currentBet)

// Works out what the hand needs next: a player's action, board cards, the showdown, or nothing (done)
function advance(st) {
  if (st.result) { st.need = { type: 'done' }; return }
  const live = active(st)
  if (live.length === 1) { finishUncontested(st, live[0]); return }

  const order = actingOrder(st.n, st.btn, st.street)
  const start = st.lastActor == null ? 0 : order.indexOf(st.lastActor) + 1
  for (let k = 0; k < order.length; k++) {
    const i = order[(start + k) % order.length]
    if (needsToAct(st, i)) {
      // Nobody left to play against: a lone player facing no bet doesn't act
      const others = live.filter(j => j !== i && !st.allin[j])
      if (others.length === 0 && st.committed[i] >= st.currentBet) break
      st.need = { type: 'action', player: i }
      return
    }
  }

  // Street complete
  if (st.street === 'river') { st.need = { type: 'showdown', contenders: live }; return }
  const next = STREETS[STREETS.indexOf(st.street) + 1]
  st.need = { type: 'board', street: next, count: next === 'flop' ? 3 : 1 }
}

function nextStreet(st) {
  st.street = STREETS[STREETS.indexOf(st.street) + 1]
  st.committed.fill(0)
  st.acted.fill(false)
  st.currentBet = 0
  st.minRaise = st.bb
  st.lastActor = null
}

function applyEntry(st, setup, entry, pay) {
  const need = st.need
  if (entry.type === 'action' && need.type === 'action' && entry.player === need.player) {
    applyAction(st, setup, entry, pay)
  } else if (entry.type === 'board' && need.type === 'board') {
    nextStreet(st)
    if (st.street === 'flop') st.board.flop = entry.cards.slice(0, 3)
    else st.board[st.street] = entry.cards[0]
  } else if (entry.type === 'showdown' && need.type === 'showdown') {
    resolveShowdown(st, setup, entry)
  }
}

function applyAction(st, setup, { player: i, kind, to }, pay) {
  const name = st.names[i]
  const street = st.street
  const toCall = st.currentBet - st.committed[i]
  st.acted[i] = true
  st.lastActor = i

  if (kind === 'fold') {
    st.folded[i] = true
    st.actions[street].push({ player: name, type: 'fold', amount: 0, allin: false })
    return
  }
  if (kind === 'check') {
    st.actions[street].push({ player: name, type: 'check', amount: 0, allin: false })
    return
  }
  if (kind === 'call') {
    const paid = pay(i, toCall)
    st.committed[i] += paid
    st.actions[street].push({ player: name, type: 'call', amount: paid, allin: st.allin[i] })
    return
  }

  // bet / raise / all-in: `to` is the player's total for this street
  let target = to
  if (kind === 'allin') {
    // An unknown stack going all-in: `to` tells us how much it was
    if (st.startStack[i] === UNKNOWN && to > 0) {
      const known = to - st.committed[i]
      st.startStack[i] = st.contributed[i] + known
      st.stack[i] = known
    }
    target = st.committed[i] + st.stack[i]
  }
  const paid = pay(i, Math.max(0, target - st.committed[i]))
  const total = st.committed[i] + paid
  st.committed[i] = total

  if (total <= st.currentBet) {
    // All-in for less than (or equal to) a call
    st.actions[street].push({ player: name, type: 'call', amount: paid, allin: st.allin[i] })
    return
  }
  const raiseBy = total - st.currentBet
  if (raiseBy >= st.minRaise) st.minRaise = raiseBy
  const wasBet = st.currentBet === 0
  st.currentBet = total
  st.actions[street].push(wasBet
    ? { player: name, type: 'bet', amount: total, allin: st.allin[i] }
    : { player: name, type: 'raise', amount: total, allin: st.allin[i] })
}

const liveMoney = st => st.contributed.map((c, i) => c - st.dead[i])

// Returns the part of the biggest bet nobody matched (the "uncalled bet"); antes don't count
function returnUncalled(st) {
  const order = liveMoney(st).map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c)
  const [top, second] = order
  const excess = top.c - (second?.c ?? 0)
  if (excess > 0) {
    st.contributed[top.i] -= excess
    st.stack[top.i] += excess
    st.actions[st.street].push({ player: st.names[top.i], type: 'uncalled', amount: excess, allin: false })
  }
}

function finishUncontested(st, winner) {
  returnUncalled(st)
  const pot = st.contributed.reduce((a, b) => a + b, 0)
  st.result = { pots: [{ amount: pot, eligible: [winner], winners: [winner] }], winnings: { [winner]: pot }, showdown: false }
  st.need = { type: 'done' }
}

// Main pot and side pots from each player's live money; dead money (antes) goes to the main pot
export function buildPots(contributed, folded, dead = 0) {
  const levels = [...new Set(contributed.filter((c, i) => !folded[i] && c > 0))].sort((a, b) => a - b)
  const pots = []
  let prev = 0
  for (const level of levels) {
    const amount = contributed.reduce((sum, c) => sum + Math.max(0, Math.min(c, level) - prev), 0)
    const eligible = contributed.map((c, i) => (!folded[i] && c >= level ? i : null)).filter(i => i != null)
    if (amount > 0) pots.push({ amount, eligible })
    prev = level
  }
  // Dead money above the last live level (folded players who put in more) goes to the last pot
  const rest = contributed.reduce((sum, c) => sum + Math.max(0, c - prev), 0)
  if (rest > 0 && pots.length) pots[pots.length - 1].amount += rest
  if (dead > 0 && pots.length) pots[0].amount += dead
  return pots
}

function resolveShowdown(st, setup, { cards = {}, winners: manual }) {
  returnUncalled(st)
  st.shown = cards
  const pots = buildPots(liveMoney(st), st.folded, st.dead.reduce((a, b) => a + b, 0))
  const board = [...st.board.flop, st.board.turn, st.board.river].filter(Boolean)
  const winnings = {}
  for (const pot of pots) {
    let winners
    const known = pot.eligible.filter(i => (cards[i] ?? holeCards(setup, i))?.length === 2)
    if (manual?.length) winners = pot.eligible.filter(i => manual.includes(i))
    if (!winners?.length && known.length === pot.eligible.length && board.length === 5) {
      const res = evaluateShowdown(Object.fromEntries(known.map(i => [i, cards[i] ?? holeCards(setup, i)])), board)
      winners = res.winners.map(Number)
    }
    if (!winners?.length) winners = pot.eligible.length === 1 ? pot.eligible : (manual?.length ? manual.filter(i => pot.eligible.includes(i)) : [])
    if (!winners.length) winners = [pot.eligible[0]]
    pot.winners = winners
    const share = Math.floor(pot.amount / winners.length)
    winners.forEach((w, k) => { winnings[w] = (winnings[w] ?? 0) + share + (k === 0 ? pot.amount - share * winners.length : 0) })
  }
  st.result = { pots, winnings, showdown: true }
  st.need = { type: 'done' }
}

const holeCards = (setup, i) => (i === 0 ? setup.players[0]?.cards : setup.players[i]?.cards)

// Whether the showdown can be settled automatically (every contender's cards known and a full board)
export function canAutoResolve(st, setup, cards = {}) {
  const board = [...st.board.flop, st.board.turn, st.board.river].filter(Boolean)
  return board.length === 5 && st.need?.contenders?.every(i => (cards[i] ?? holeCards(setup, i))?.length === 2)
}

// ── Helpers for the recorder UI ────────────────────────────────────────────────

export const potTotal = st => st.contributed.reduce((a, b) => a + b, 0)

// What the player to act may do. Amounts are totals for this street ("raise to")
export function legalActions(st) {
  if (st.need?.type !== 'action') return null
  const i = st.need.player
  const toCall = Math.max(0, st.currentBet - st.committed[i])
  const stack = st.stack[i]
  const unknown = st.startStack[i] === UNKNOWN
  const maxTo = st.committed[i] + stack
  const canRaise = stack > toCall
  return {
    player: i,
    toCall: Math.min(toCall, stack),
    fold: toCall > 0,
    check: toCall === 0,
    call: toCall > 0,
    bet: st.currentBet === 0 && canRaise,
    raise: st.currentBet > 0 && canRaise,
    minTo: Math.min(maxTo, st.currentBet === 0 ? st.bb : st.currentBet + st.minRaise),
    maxTo: unknown ? null : maxTo,
    stackUnknown: unknown,
  }
}

// Seats that would have to fold for the action to reach player `target` (tapping a seat in the recorder)
export function foldsUntil(st, target) {
  if (st.need?.type !== 'action') return []
  const order = actingOrder(st.n, st.btn, st.street)
  const out = []
  let i = st.need.player
  for (let guard = 0; guard < st.n && i !== target; guard++) {
    if (needsToAct(st, i)) out.push(i)
    i = order[(order.indexOf(i) + 1) % order.length]
  }
  return i === target ? out : []
}

// Cards already in use (hero, known opponents, board, shown) — the card picker disables them
export function usedCards(setup, st, extra = []) {
  const set = new Set(extra)
  setup.players.forEach(p => p.cards?.forEach(c => c && set.add(c)))
  if (st) {
    st.board.flop.forEach(c => set.add(c))
    if (st.board.turn) set.add(st.board.turn)
    if (st.board.river) set.add(st.board.river)
    Object.values(st.shown ?? {}).forEach(cs => cs?.forEach(c => set.add(c)))
  }
  return set
}

// ── Raw hand (parser format) ───────────────────────────────────────────────────

const pad = v => String(v).padStart(2, '0')
export const formatHandDate = d =>
  `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

// meta = { id, tournamentId, tournamentName, level, day, date }
export function buildRawHand(setup, log, meta) {
  const st = replay(setup, log)
  if (st.need?.type !== 'done') throw new Error('Hand is not finished')
  const { n, btn, labels, names, result } = st

  const seats = names.map((player, i) => {
    const unknown = st.startStack[i] === UNKNOWN
    const chips = unknown ? Math.max(st.contributed[i], setup.players[0].stack || 0) : st.startStack[i]
    const foldedStreet = STREETS.find(s => st.actions[s].some(a => a.player === player && a.type === 'fold')) ?? null
    const allinStreet = STREETS.find(s => st.actions[s].some(a => a.player === player && a.allin)) ?? null
    return {
      num: i + 1, player, chips, pos: labels[i],
      folded: !!foldedStreet, allin: !!allinStreet, foldedStreet, allinStreet,
      ...(unknown ? { stackUnknown: true } : null),
    }
  })

  const holeCards = {}
  setup.players.forEach((p, i) => { if (p.cards?.length === 2) holeCards[names[i]] = p.cards })
  Object.entries(st.shown ?? {}).forEach(([i, cs]) => { if (cs?.length === 2) holeCards[names[i]] = cs })

  const actions = { preflop: [...st.actions.preflop], flop: [...st.actions.flop], turn: [...st.actions.turn], river: [...st.actions.river] }
  const winners = Object.entries(result.winnings).map(([i, amount]) => ({ player: names[i], amount }))
  // Like the GGPoker parser, showdown winnings appear as 'won' actions at the end of the hand
  if (result.showdown) winners.forEach(w => actions.river.push({ player: w.player, type: 'won', amount: w.amount, allin: false }))

  const totalPot = st.contributed.reduce((a, b) => a + b, 0)
  const heroInvested = st.contributed[0]
  const heroNet = (result.winnings[0] ?? 0) - heroInvested

  const hand = {
    id: meta.id,
    tournamentId: meta.tournamentId,
    tournamentName: meta.tournamentName,
    level: String(meta.level ?? ''),
    datetime: formatHandDate(meta.date ?? new Date()),
    tableNum: '',
    platform: 'live',
    sb: setup.sb, bb: setup.bb, ante: setup.ante || 0,
    anteType: setup.anteType === 'all' ? 'all' : 'bb',
    buttonSeat: btn + 1,
    maxSeats: n,
    seats,
    holeCards,
    board: { ...st.board, flop: [...st.board.flop] },
    actions,
    winners,
    totalPot,
    heroResult: st.folded[0] ? 'folded' : heroNet > 0 ? 'won' : 'lost',
    revealHoleCards: !!setup.revealHoleCards,
    day: meta.day ?? 1,
    sequence: [],
    streetStartStep: {},
    live: { setup, log },
  }
  hand.sequence = buildSequence(hand)
  return hand
}
