export const POS_LABELS = {
  2: ['BTN','BB'], 3: ['BTN','SB','BB'], 4: ['BTN','SB','BB','CO'],
  5: ['BTN','SB','BB','HJ','CO'], 6: ['BTN','SB','BB','LJ','HJ','CO'],
  7: ['BTN','SB','BB','UTG','LJ','HJ','CO'],
  8: ['BTN','SB','BB','UTG','UTG+1','LJ','HJ','CO'],
  9: ['BTN','SB','BB','UTG','UTG+1','MP','LJ','HJ','CO'],
  10:['BTN','SB','BB','UTG','UTG+1','MP','MP+1','LJ','HJ','CO'],
}

export function getPositionLabel(seatNum, seats, buttonSeatNum) {
  const sorted = [...seats].sort((a, b) => a.num - b.num)
  const n = sorted.length
  const btnIdx = sorted.findIndex(s => s.num === buttonSeatNum)
  if (btnIdx < 0) return ''
  const seatIdx = sorted.findIndex(s => s.num === seatNum)
  if (seatIdx < 0) return ''
  const offset = (seatIdx - btnIdx + n) % n
  return (POS_LABELS[n] ?? [])[offset] ?? ''
}

export function heroFoldedPreflop(hand) {
  return (hand.actions?.preflop ?? []).some(a => a.player === 'Hero' && a.type === 'fold')
}

export function heroNet(hand) {
  const heroSeat = hand.seats?.find(s => s.player === 'Hero')
  if (!heroSeat) return null
  let inv = hand.ante || 0
  if (heroSeat.pos === 'SB') inv += hand.sb
  if (heroSeat.pos === 'BB') inv += hand.bb
  const all = [...(hand.actions?.preflop??[]), ...(hand.actions?.flop??[]),
               ...(hand.actions?.turn??[]), ...(hand.actions?.river??[])]
  for (const a of all) {
    if (a.player !== 'Hero') continue
    if (['call','raise','bet'].includes(a.type)) inv += a.amount
    if (a.type === 'uncalled') inv -= a.amount
  }
  const won = (hand.winners??[]).filter(w => w.player === 'Hero').reduce((s, w) => s + w.amount, 0)
  return won - inv
}

export function preflopIsClean(hand) {
  const actions = hand.actions?.preflop ?? []
  for (const a of actions) {
    if (a.player === 'Hero') break
    if (a.type === 'call' || a.type === 'raise') return false
  }
  return true
}

export function preflopIsLimped(hand) {
  const actions = hand.actions?.preflop ?? []
  let hasLimp = false
  for (const a of actions) {
    if (a.player === 'Hero') break
    if (a.type === 'raise') return false
    if (a.type === 'call') hasLimp = true
  }
  return hasLimp
}

export function preflopRaiseCount(hand) {
  return (hand.actions?.preflop ?? []).filter(a => a.type === 'raise').length
}

export function playersWhoSawFlop(hand) {
  const folded = new Set(
    (hand.actions?.preflop ?? []).filter(a => a.type === 'fold').map(a => a.player)
  )
  return (hand.seats ?? []).filter(s => !folded.has(s.player)).length
}

// Postflop acting order rank: 0 = acts first (most out of position), n-1 = acts last (button, most in position)
function postflopRank(seatNum, seats, buttonSeatNum) {
  const sorted = [...seats].sort((a, b) => a.num - b.num)
  const n = sorted.length
  const btnIdx = sorted.findIndex(s => s.num === buttonSeatNum)
  const seatIdx = sorted.findIndex(s => s.num === seatNum)
  if (btnIdx < 0 || seatIdx < 0) return null
  const offset = (seatIdx - btnIdx + n) % n
  return (offset - 1 + n) % n
}

export function heroIsPfr(hand) {
  return (hand.actions?.preflop ?? []).some(a => a.player === 'Hero' && a.type === 'raise')
}

// 'ip' if Hero acts last postflop among the players who didn't fold preflop (has position on the whole field),
// 'oop' if at least one of them acts after Hero. null if Hero folded preflop or has no opponents left.
export function heroPositionVsField(hand) {
  const seats = hand.seats ?? []
  const heroSeat = seats.find(s => s.player === 'Hero')
  if (!heroSeat) return null
  const folded = new Set((hand.actions?.preflop ?? []).filter(a => a.type === 'fold').map(a => a.player))
  if (folded.has('Hero')) return null
  const active = seats.filter(s => !folded.has(s.player))
  if (active.length < 2) return null
  const heroRank = postflopRank(heroSeat.num, seats, hand.buttonSeat)
  const maxRank = Math.max(...active.map(s => postflopRank(s.num, seats, hand.buttonSeat)))
  return heroRank === maxRank ? 'ip' : 'oop'
}

// BB folds preflop without ever calling or raising — doesn't join the hand.
export function bbFoldedPreflop(hand) {
  const seats = hand.seats ?? []
  const bbSeat = seats.find(s => getPositionLabel(s.num, seats, hand.buttonSeat) === 'BB')
  if (!bbSeat || bbSeat.player === 'Hero') return false
  return (hand.actions?.preflop ?? []).some(a => a.player === bbSeat.player && a.type === 'fold')
}

// Hero's starting stack in big blinds, or null if it can't be determined.
export function heroBBStack(hand) {
  const heroSeat = hand.seats?.find(s => s.player === 'Hero')
  if (!heroSeat || !hand.bb) return null
  return heroSeat.chips / hand.bb
}

export function computeHandStats(hand) {
  const preflop = hand.actions?.preflop ?? []

  const vpip = preflop.some(a => a.player === 'Hero' && ['call', 'raise', 'bet'].includes(a.type))
  const pfr  = preflop.some(a => a.player === 'Hero' && a.type === 'raise')

  // 3Bet: hero raises after another player already raised
  let seenOtherRaise = false
  let three_bet = false
  for (const a of preflop) {
    if (a.player !== 'Hero' && a.type === 'raise') seenOtherRaise = true
    if (a.player === 'Hero' && a.type === 'raise' && seenOtherRaise) { three_bet = true; break }
  }

  // Fold vs 3Bet: hero open-raised, opponent re-raised (3bet), hero folded
  let heroOpenRaised = false
  let facedThreeBet  = false
  let fold_vs_3bet   = false
  for (const a of preflop) {
    if (!heroOpenRaised && a.player === 'Hero'  && a.type === 'raise') heroOpenRaised = true
    else if (heroOpenRaised && a.player !== 'Hero'  && a.type === 'raise') facedThreeBet = true
    else if (facedThreeBet  && a.player === 'Hero'  && a.type === 'fold')  { fold_vs_3bet = true; break }
  }

  const heroFolded = preflop.some(a => a.player === 'Hero' && a.type === 'fold')
  const saw_flop   = !heroFolded && (hand.board?.flop?.length ?? 0) > 0

  const went_to_sd = hand.heroResult !== 'folded' && hand.board?.river != null
  const won_sd     = hand.heroResult === 'won'    && hand.board?.river != null

  // seat.pos is only ever set by the parser for BTN/SB/BB — every other position (UTG, MP, CO...)
  // has to be derived the same way the rest of the app does, from seat offset relative to the button.
  const heroSeat = hand.seats?.find(s => s.player === 'Hero')
  const hero_pos = heroSeat ? (getPositionLabel(heroSeat.num, hand.seats, hand.buttonSeat) || null) : null

  return { vpip, pfr, three_bet, fold_vs_3bet, saw_flop, went_to_sd, won_sd, hero_pos }
}

// Denormalized columns backing the "Estudia tu juego" filters that computeHandStats doesn't
// already cover, so the search can run as a single Supabase query instead of a client-side scan.
export function computeStudyFilterColumns(hand) {
  return {
    preflop_raise_count: preflopRaiseCount(hand),
    preflop_clean:       preflopIsClean(hand),
    preflop_limped:      preflopIsLimped(hand),
    pos_vs_field:        heroPositionVsField(hand),
    bb_folded:           bbFoldedPreflop(hand),
    hero_stack_bb:       heroBBStack(hand),
    flop_players_count:  hand.board?.flop?.length ? playersWhoSawFlop(hand) : null,
    hero_folded_preflop: heroFoldedPreflop(hand),
  }
}
