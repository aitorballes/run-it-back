const RANK_MAP = { A: 14, K: 13, Q: 12, J: 11, T: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2 }
const ALL_RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const ALL_SUITS = ['h', 'd', 's', 'c']
const ALL_CARDS = ALL_RANKS.flatMap(r => ALL_SUITS.map(s => r + s))

// Encode an array of rank values into a single comparable integer.
// Each rank occupies one "digit" in base 15 (safe since max rank = 14).
function tiebreakerScore(rankValues) {
  let s = 0
  for (const r of rankValues) s = s * 15 + r
  return s
}

// Evaluate a 5-card hand (array of card strings like 'Ah').
// Returns a comparable integer: higher = better hand.
function evaluate5(cards) {
  const ranks = cards.map(c => RANK_MAP[c[0]]).sort((a, b) => b - a)
  const suits = cards.map(c => c[1])

  const isFlush = suits.every(s => s === suits[0])

  const freq = {}
  for (const r of ranks) freq[r] = (freq[r] || 0) + 1
  // Sort by count desc, then rank desc (so pairs come before kickers, high pairs before low)
  const groups = Object.entries(freq)
    .map(([r, n]) => [+r, n])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])

  // Straight detection (requires 5 distinct ranks)
  let straightHigh = 0
  if (Object.keys(freq).length === 5) {
    if (ranks[0] - ranks[4] === 4) {
      straightHigh = ranks[0]
    } else if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
      // Wheel: A-2-3-4-5
      straightHigh = 5
    }
  }

  const CAT = 1e8
  const isStraight = straightHigh > 0

  if (isFlush && isStraight)                           return 8 * CAT + straightHigh
  if (groups[0][1] === 4)                              return 7 * CAT + tiebreakerScore([groups[0][0], groups[1][0]])
  if (groups[0][1] === 3 && groups[1][1] === 2)        return 6 * CAT + tiebreakerScore([groups[0][0], groups[1][0]])
  if (isFlush)                                         return 5 * CAT + tiebreakerScore(ranks)
  if (isStraight)                                      return 4 * CAT + straightHigh
  if (groups[0][1] === 3)                              return 3 * CAT + tiebreakerScore([groups[0][0], groups[1][0], groups[2][0]])
  if (groups[0][1] === 2 && groups[1][1] === 2)        return 2 * CAT + tiebreakerScore([groups[0][0], groups[1][0], groups[2][0]])
  if (groups[0][1] === 2)                              return 1 * CAT + tiebreakerScore([groups[0][0], groups[1][0], groups[2][0], groups[3][0]])
  return tiebreakerScore(ranks)
}

// Evaluate the best 5-card hand from 7 cards. C(7,5) = 21 subsets.
function evaluate7(cards) {
  let best = -1
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const five = cards.filter((_, k) => k !== i && k !== j)
      const s = evaluate5(five)
      if (s > best) best = s
    }
  }
  return best
}

// Generator: all k-combinations of arr.
function* combinations(arr, k) {
  if (k === 0) { yield []; return }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...rest]
    }
  }
}

// Partial Fisher-Yates shuffle — returns n random elements from arr without replacement.
function shuffleSlice(arr, n) {
  const a = [...arr]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

/**
 * Calculate equity for each player given their hole cards and the current board.
 *
 * @param {Object} playerCards  - { [playerName]: ['Ah', 'Kd'] }
 * @param {string[]} board      - 0-5 community cards already dealt
 * @param {number} mcIterations - Monte Carlo samples used when board < 3 cards
 * @returns {Object}            - { [playerName]: winPct, tie?: tiePct }
 *   winPct includes the player's fractional share of split pots.
 *   tie is only present when split-pot probability > 0.5%.
 */
export function calculateEquity(playerCards, board, mcIterations = 3000) {
  const names = Object.keys(playerCards)
  const known = new Set([...board, ...Object.values(playerCards).flat()])
  const deck  = ALL_CARDS.filter(c => !known.has(c))
  const needed = 5 - board.length

  const wins = Object.fromEntries(names.map(n => [n, 0]))
  let tieBoards = 0
  let total = 0

  function runBoard(extra) {
    const fullBoard = [...board, ...extra]
    const scores = names.map(n => evaluate7([...playerCards[n], ...fullBoard]))
    const maxScore = Math.max(...scores)
    const winners = names.filter((_, i) => scores[i] === maxScore)
    if (winners.length === 1) {
      wins[winners[0]]++
    } else {
      tieBoards++
      const share = 1 / winners.length
      for (const w of winners) wins[w] += share
    }
    total++
  }

  if (needed <= 2) {
    // Exact enumeration: flop → C(~45,2)=990, turn → ~44, river → 1
    for (const combo of combinations(deck, needed)) runBoard(combo)
  } else {
    // Monte Carlo: preflop has too many boards to enumerate (~1.7M for 2 players)
    for (let i = 0; i < mcIterations; i++) runBoard(shuffleSlice(deck, needed))
  }

  const result = Object.fromEntries(names.map(n => [n, wins[n] / total * 100]))
  const tiePct = tieBoards / total * 100
  if (tiePct > 0.5) result.tie = tiePct
  return result
}
