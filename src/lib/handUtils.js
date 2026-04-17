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
  for (const a of all)
    if (a.player === 'Hero' && ['call','raise','bet'].includes(a.type)) inv += a.amount
  const won = (hand.winners??[]).filter(w => w.player === 'Hero').reduce((s, w) => s + w.amount, 0)
  return won - inv
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
