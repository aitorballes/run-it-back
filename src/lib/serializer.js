// ── Helpers ───────────────────────────────────────────────────────────

function ordinalSuffix(n) {
  const v = n % 100
  if (v >= 11 && v <= 13) return 'th'
  switch (v % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

function ordinal(n) {
  return `${n}${ordinalSuffix(n)}`
}

// 888poker uses European dot-thousands notation: 1600 → "1.600"
function to888(n) {
  return Number(n).toLocaleString('de-DE')
}

// iPoker uses €X.XX amounts
function toEur(n) {
  return Number(n).toFixed(2)
}

// ── GGPoker / PokerStars / CoinPoker action serializer ────────────────

function serializeGGAction(a) {
  switch (a.type) {
    case 'fold':     return `${a.player}: folds`
    case 'check':    return `${a.player}: checks`
    case 'call':     return a.allin
      ? `${a.player}: calls ${a.amount} and is all-in`
      : `${a.player}: calls ${a.amount}`
    case 'raise':    return a.allin
      ? `${a.player}: raises ${a.amount} to ${a.amount} and is all-in`
      : `${a.player}: raises ${a.amount} to ${a.amount}`
    case 'bet':      return a.allin
      ? `${a.player}: bets ${a.amount} and is all-in`
      : `${a.player}: bets ${a.amount}`
    case 'uncalled': return `Uncalled bet (${a.amount}) returned to ${a.player}`
    default:         return ''
  }
}

// CoinPoker: all-in raises omit "to Y"
function serializeCoinPokerAction(a) {
  if (a.type === 'raise' && a.allin) return `${a.player}: raises ${a.amount} and is all-in`
  return serializeGGAction(a)
}

// ── Winamax action serializer (no colon) ──────────────────────────────

function serializeWinamaxAction(a) {
  switch (a.type) {
    case 'fold':  return `${a.player} folds`
    case 'check': return `${a.player} checks`
    case 'call':  return a.allin
      ? `${a.player} calls ${a.amount} and is all-in`
      : `${a.player} calls ${a.amount}`
    case 'raise': return a.allin
      ? `${a.player} raises ${a.amount} to ${a.amount} and is all-in`
      : `${a.player} raises ${a.amount} to ${a.amount}`
    case 'bet':   return a.allin
      ? `${a.player} bets ${a.amount} and is all-in`
      : `${a.player} bets ${a.amount}`
    default:      return ''
  }
}

// ── 888poker action serializer (brackets, European amounts) ───────────

function serialize888Action(a) {
  switch (a.type) {
    case 'fold':  return `${a.player} folds`
    case 'check': return `${a.player} checks`
    case 'call':  return a.allin
      ? `${a.player} calls [${to888(a.amount)}] and is all-in`
      : `${a.player} calls [${to888(a.amount)}]`
    case 'raise': return a.allin
      ? `${a.player} raises [${to888(a.amount)}] and is all-in`
      : `${a.player} raises [${to888(a.amount)}]`
    case 'bet':   return a.allin
      ? `${a.player} bets [${to888(a.amount)}] and is all-in`
      : `${a.player} bets [${to888(a.amount)}]`
    default:      return ''
  }
}

// ── iPoker action serializer (capitalized, €) ─────────────────────────

function serializeIPokerAction(a) {
  switch (a.type) {
    case 'fold':  return `${a.player}: Fold`
    case 'check': return `${a.player}: Check`
    case 'call':  return a.allin
      ? `${a.player}: Call (AI) €${toEur(a.amount)}`
      : `${a.player}: Call €${toEur(a.amount)}`
    case 'raise': return a.allin
      ? `${a.player}: Raise (AI) €${toEur(a.amount)}`
      : `${a.player}: Raise (NF) €${toEur(a.amount)}`
    case 'bet':   return a.allin
      ? `${a.player}: Bet (AI) €${toEur(a.amount)}`
      : `${a.player}: Bet €${toEur(a.amount)}`
    default:      return ''
  }
}

// ── Street action line builders ───────────────────────────────────────

// For GGPoker-like platforms: filter posts and 'won', serialize the rest
function ggStreetLines(actions, serializeFn) {
  return actions
    .filter(a => !['won', 'post-sb', 'post-bb'].includes(a.type))
    .map(serializeFn)
    .filter(Boolean)
}

// For Winamax: 'won' actions become "collected" lines inline in the street
function winamaxStreetLines(actions) {
  const lines = []
  for (const a of actions) {
    if (['post-sb', 'post-bb'].includes(a.type)) continue
    if (a.type === 'won') {
      lines.push(`${a.player} collected ${a.amount} from pot`)
    } else {
      const line = serializeWinamaxAction(a)
      if (line) lines.push(line)
    }
  }
  return lines
}

// ── GGPoker hand serializer ───────────────────────────────────────────

function serializeGGHand(h) {
  const level = h.level || 'I'
  const ante = h.ante ? `(${h.ante})` : ''
  const lines = []

  lines.push(`Poker Hand #${h.id}: Tournament #${h.tournamentId}, ${h.tournamentName} Hold'em No Limit - Level${level}(${h.sb}/${h.bb}${ante}) - ${h.datetime}`)

  const tableNum = h.tableNum || `T${h.tournamentId}-1`
  lines.push(`Table '${tableNum}' ${h.maxSeats}-max Seat #${h.buttonSeat} is the button`)

  for (const seat of h.seats) {
    lines.push(`Seat ${seat.num}: ${seat.player} (${seat.chips} in chips)`)
  }

  if (h.ante > 0) {
    for (const seat of h.seats) {
      lines.push(`${seat.player}: posts the ante ${h.ante}`)
    }
  }

  const preflopActs = h.actions.preflop
  const sbPost = preflopActs.find(a => a.type === 'post-sb')
  const bbPost = preflopActs.find(a => a.type === 'post-bb')
  if (sbPost) lines.push(`${sbPost.player}: posts small blind ${sbPost.amount}`)
  if (bbPost) lines.push(`${bbPost.player}: posts big blind ${bbPost.amount}`)

  lines.push('*** HOLE CARDS ***')
  if (h.holeCards['Hero']) {
    lines.push(`Dealt to Hero [${h.holeCards['Hero'].join(' ')}]`)
  }

  lines.push(...ggStreetLines(preflopActs, serializeGGAction))

  if (h.board.flop.length > 0) {
    lines.push(`*** FLOP *** [${h.board.flop.join(' ')}]`)
    lines.push(...ggStreetLines(h.actions.flop, serializeGGAction))
  }

  if (h.board.turn) {
    lines.push(`*** TURN *** [${h.board.flop.join(' ')}] [${h.board.turn}]`)
    lines.push(...ggStreetLines(h.actions.turn, serializeGGAction))
  }

  if (h.board.river) {
    lines.push(`*** RIVER *** [${h.board.flop.join(' ')} ${h.board.turn}] [${h.board.river}]`)
    lines.push(...ggStreetLines(h.actions.river, serializeGGAction))
  }

  for (const w of h.winners) {
    lines.push(`${w.player} collected ${w.amount} from pot`)
  }

  lines.push('*** SUMMARY ***')
  lines.push(`Total pot ${h.totalPot}`)

  if (h.board.flop.length > 0) {
    const board = [...h.board.flop, h.board.turn, h.board.river].filter(Boolean)
    lines.push(`Board [${board.join(' ')}]`)
  }

  for (const seat of h.seats) {
    const won = h.winners.filter(w => w.player === seat.player).reduce((s, w) => s + w.amount, 0)
    const desc = won > 0 ? `collected ${won}` : (seat.folded ? 'folded before Flop' : 'showed hands')
    lines.push(`Seat ${seat.num}: ${seat.player} (${desc})`)
  }

  return lines.join('\n')
}

// ── PokerStars hand serializer ────────────────────────────────────────

function serializePokerStarsHand(h) {
  const level = h.level || 'I'
  const lines = []

  lines.push(`PokerStars Hand #${h.id}: Tournament #${h.tournamentId}, ${h.tournamentName} Hold'em No Limit - Level ${level} (${h.sb}/${h.bb}) - ${h.datetime}`)

  const tableNum = h.tableNum || `${h.tournamentId} 1`
  lines.push(`Table '${tableNum}' ${h.maxSeats}-max Seat #${h.buttonSeat} is the button`)

  for (const seat of h.seats) {
    lines.push(`Seat ${seat.num}: ${seat.player} (${seat.chips} in chips)`)
  }

  if (h.ante > 0) {
    for (const seat of h.seats) {
      lines.push(`${seat.player}: posts the ante ${h.ante}`)
    }
  }

  const preflopActs = h.actions.preflop
  const sbPost = preflopActs.find(a => a.type === 'post-sb')
  const bbPost = preflopActs.find(a => a.type === 'post-bb')
  if (sbPost) lines.push(`${sbPost.player}: posts small blind ${sbPost.amount}`)
  if (bbPost) lines.push(`${bbPost.player}: posts big blind ${bbPost.amount}`)

  lines.push('*** HOLE CARDS ***')
  if (h.holeCards['Hero']) {
    lines.push(`Dealt to Hero [${h.holeCards['Hero'].join(' ')}]`)
  }

  lines.push(...ggStreetLines(preflopActs, serializeGGAction))

  if (h.board.flop.length > 0) {
    lines.push(`*** FLOP *** [${h.board.flop.join(' ')}]`)
    lines.push(...ggStreetLines(h.actions.flop, serializeGGAction))
  }

  if (h.board.turn) {
    lines.push(`*** TURN *** [${h.board.flop.join(' ')}] [${h.board.turn}]`)
    lines.push(...ggStreetLines(h.actions.turn, serializeGGAction))
  }

  if (h.board.river) {
    lines.push(`*** RIVER *** [${h.board.flop.join(' ')} ${h.board.turn}] [${h.board.river}]`)
    lines.push(...ggStreetLines(h.actions.river, serializeGGAction))
  }

  for (const w of h.winners) {
    lines.push(`${w.player} collected ${w.amount} from pot`)
  }

  lines.push('*** SUMMARY ***')
  lines.push(`Total pot ${h.totalPot}`)

  if (h.board.flop.length > 0) {
    const board = [...h.board.flop, h.board.turn, h.board.river].filter(Boolean)
    lines.push(`Board [${board.join(' ')}]`)
  }

  for (const seat of h.seats) {
    const won = h.winners.filter(w => w.player === seat.player).reduce((s, w) => s + w.amount, 0)
    const desc = won > 0 ? `collected ${won}` : (seat.folded ? 'folded before Flop' : 'showed hands')
    lines.push(`Seat ${seat.num}: ${seat.player} (${desc})`)
  }

  return lines.join('\n')
}

// ── Winamax hand serializer ───────────────────────────────────────────

function serializeWinamaxHand(h, tournament) {
  const buyin = tournament?.buyin ?? 0
  const rake  = tournament?.buyin_rake ?? 0
  const lines = []

  lines.push(`Winamax Poker - Tournament "${h.tournamentName}" buyIn: ${buyin}€ + ${rake}€ level: ${h.level || 1} - HandId: #${h.id}-0 - Holdem no limit (${h.ante}/${h.sb}/${h.bb}) - ${h.datetime} UTC`)

  // Reconstruct table line: h.tableNum stored as "TournamentName#TableNum"
  const hashIdx = (h.tableNum || '').lastIndexOf('#')
  let tname, tnum
  if (hashIdx > 0) {
    tname = h.tableNum.slice(0, hashIdx)
    tnum  = h.tableNum.slice(hashIdx + 1)
  } else {
    tname = h.tournamentName
    tnum  = '1'
  }
  lines.push(`Table: '${tname}(${h.tournamentId})#${tnum}' ${h.maxSeats}-max (real money) Seat #${h.buttonSeat} is the button`)

  for (const seat of h.seats) {
    lines.push(`Seat ${seat.num}: ${seat.player} (${seat.chips})`)
  }

  lines.push('*** ANTE/BLINDS ***')
  if (h.ante > 0) {
    for (const seat of h.seats) {
      lines.push(`${seat.player} posts ante ${h.ante}`)
    }
  }

  const preflopActs = h.actions.preflop
  const sbPost = preflopActs.find(a => a.type === 'post-sb')
  const bbPost = preflopActs.find(a => a.type === 'post-bb')
  if (sbPost) lines.push(`${sbPost.player} posts small blind ${sbPost.amount}`)
  if (bbPost) lines.push(`${bbPost.player} posts big blind ${bbPost.amount}`)

  // Dealt to hero appears BEFORE *** PRE-FLOP ***
  if (h.holeCards['Hero']) {
    lines.push(`Dealt to Hero [${h.holeCards['Hero'].join(' ')}]`)
  }

  lines.push('*** PRE-FLOP ***')
  lines.push(...winamaxStreetLines(preflopActs))

  if (h.board.flop.length > 0) {
    lines.push(`*** FLOP *** [${h.board.flop.join(' ')}]`)
    lines.push(...winamaxStreetLines(h.actions.flop))
  }

  if (h.board.turn) {
    lines.push(`*** TURN *** [${h.board.flop.join(' ')}][${h.board.turn}]`)
    lines.push(...winamaxStreetLines(h.actions.turn))
  }

  if (h.board.river) {
    lines.push(`*** RIVER *** [${h.board.flop.join(' ')} ${h.board.turn}][${h.board.river}]`)
    lines.push(...winamaxStreetLines(h.actions.river))
  }

  lines.push('*** SUMMARY ***')
  lines.push(`Total pot ${h.totalPot}`)

  return lines.join('\n')
}

// ── 888poker hand serializer ──────────────────────────────────────────

function serialize888Hand(h) {
  const lines = []

  lines.push(`***** 888.es Hand History for Game ${h.id} *****`)

  const [datePart, timePart] = (h.datetime || '').split(' ')
  const [y, mo, d] = (datePart || '').split('/')
  lines.push(`${to888(h.sb)}/${to888(h.bb)} Blinds No Limit Holdem - *** ${d} ${mo} ${y} ${timePart}`)

  const tableNum = h.tableNum || '1'
  lines.push(`Tournament #${h.tournamentId} ${h.tournamentName} - Table #${tableNum} ${h.maxSeats} Max (Real Money)`)

  lines.push(`Seat ${h.buttonSeat} is the button`)
  lines.push(`Total number of players : ${h.seats.length}`)

  for (const seat of h.seats) {
    lines.push(`Seat ${seat.num}: ${seat.player} ( ${to888(seat.chips)} )`)
  }

  if (h.ante > 0) {
    for (const seat of h.seats) {
      lines.push(`${seat.player} posts ante [${to888(h.ante)}]`)
    }
  }

  const preflopActs = h.actions.preflop
  const sbPost = preflopActs.find(a => a.type === 'post-sb')
  const bbPost = preflopActs.find(a => a.type === 'post-bb')
  if (sbPost) lines.push(`${sbPost.player} posts small blind [${to888(sbPost.amount)}]`)
  if (bbPost) lines.push(`${bbPost.player} posts big blind [${to888(bbPost.amount)}]`)

  lines.push('** Dealing down cards **')
  if (h.holeCards['Hero']) {
    lines.push(`Dealt to Hero [ ${h.holeCards['Hero'].join(', ')} ]`)
  }

  lines.push(...ggStreetLines(preflopActs, serialize888Action))

  if (h.board.flop.length > 0) {
    lines.push(`** Dealing flop ** [ ${h.board.flop.join(', ')} ]`)
    lines.push(...ggStreetLines(h.actions.flop, serialize888Action))
  }

  if (h.board.turn) {
    lines.push(`** Dealing turn ** [ ${h.board.turn} ]`)
    lines.push(...ggStreetLines(h.actions.turn, serialize888Action))
  }

  if (h.board.river) {
    lines.push(`** Dealing river ** [ ${h.board.river} ]`)
    lines.push(...ggStreetLines(h.actions.river, serialize888Action))
  }

  lines.push('** Summary **')
  for (const w of h.winners) {
    lines.push(`${w.player} collected [ ${to888(w.amount)} ]`)
  }

  return lines.join('\n')
}

// ── CoinPoker hand serializer ─────────────────────────────────────────

function serializeCoinPokerHand(h) {
  const lines = []

  lines.push(`CoinPoker Hand #${h.id}: Tournament #${h.tournamentId}, ${h.tournamentName} Hold'em No Limit (${h.sb}/${h.bb} ante ${h.ante} play) ${h.datetime} GMT`)

  const tableNum = h.tableNum || `T${h.tournamentId}-1`
  lines.push(`Table '${tableNum}' ${h.maxSeats}-max Seat #${h.buttonSeat} is the button`)

  for (const seat of h.seats) {
    lines.push(`Seat ${seat.num}: ${seat.player} (${seat.chips} in chips)`)
  }

  if (h.ante > 0) {
    for (const seat of h.seats) {
      lines.push(`${seat.player}: posts the ante ${h.ante}`)
    }
  }

  const preflopActs = h.actions.preflop
  const sbPost = preflopActs.find(a => a.type === 'post-sb')
  const bbPost = preflopActs.find(a => a.type === 'post-bb')
  if (sbPost) lines.push(`${sbPost.player}: posts small blind ${sbPost.amount}`)
  if (bbPost) lines.push(`${bbPost.player}: posts big blind ${bbPost.amount}`)

  lines.push('*** HOLE CARDS ***')
  if (h.holeCards['Hero']) {
    lines.push(`Dealt to Hero [${h.holeCards['Hero'].join(' ')}]`)
  }

  lines.push(...ggStreetLines(preflopActs, serializeCoinPokerAction))

  if (h.board.flop.length > 0) {
    lines.push(`*** FLOP *** [${h.board.flop.join(' ')}]`)
    lines.push(...ggStreetLines(h.actions.flop, serializeCoinPokerAction))
  }

  if (h.board.turn) {
    lines.push(`*** TURN *** [${h.board.flop.join(' ')}] [${h.board.turn}]`)
    lines.push(...ggStreetLines(h.actions.turn, serializeCoinPokerAction))
  }

  if (h.board.river) {
    lines.push(`*** RIVER *** [${h.board.flop.join(' ')} ${h.board.turn}] [${h.board.river}]`)
    lines.push(...ggStreetLines(h.actions.river, serializeCoinPokerAction))
  }

  for (const w of h.winners) {
    lines.push(`${w.player} collected ${w.amount} from pot`)
  }

  lines.push('*** SUMMARY ***')
  lines.push(`Total pot ${h.totalPot}`)

  if (h.board.flop.length > 0) {
    const board = [...h.board.flop, h.board.turn, h.board.river].filter(Boolean)
    lines.push(`Board [${board.join(' ')}]`)
  }

  return lines.join('\n')
}

// ── iPoker hand serializer ────────────────────────────────────────────

function serializeIPokerHand(h) {
  // iPoker datetime: stored as YYYY/MM/DD HH:MM:SS, output as YYYY-MM-DD HH:MM:SS
  const datetime = (h.datetime || '').replace(/\//g, '-')
  const lines = []

  lines.push(`GAME #${h.id} Version:RC/3.15 Texas Hold'em NL  Tournament ${datetime}/GMT`)
  lines.push(`Table Info: Size: ${h.maxSeats}, Blinds: ${h.sb}.00/${h.bb}.00, Ante: ${h.ante}.00`)
  lines.push(`Table ${h.tournamentName}, 1, ${h.tournamentId} (Tournament: ${h.tournamentName} Buy-In: 0)`)

  for (const seat of h.seats) {
    const dealer = seat.num === h.buttonSeat ? '  DEALER' : ''
    lines.push(`Seat ${seat.num}: ${seat.player} (€${toEur(seat.chips)} in chips)${dealer}`)
  }

  if (h.ante > 0) {
    for (const seat of h.seats) {
      lines.push(`${seat.player}: Post Ante €${toEur(h.ante)}`)
    }
  }

  const preflopActs = h.actions.preflop
  const sbPost = preflopActs.find(a => a.type === 'post-sb')
  const bbPost = preflopActs.find(a => a.type === 'post-bb')
  if (sbPost) lines.push(`${sbPost.player}: Post SB €${toEur(sbPost.amount)}`)
  if (bbPost) lines.push(`${bbPost.player}: Post BB €${toEur(bbPost.amount)}`)

  lines.push('*** HOLE CARDS ***')
  if (h.holeCards['Hero']) {
    lines.push(`Dealt to Hero [${h.holeCards['Hero'].join(' ')}]`)
  }

  lines.push(...ggStreetLines(preflopActs, serializeIPokerAction))

  if (h.board.flop.length > 0) {
    lines.push(`*** FLOP *** [${h.board.flop.join(' ')}]`)
    lines.push(...ggStreetLines(h.actions.flop, serializeIPokerAction))
  }

  // iPoker TURN/RIVER show only the new card
  if (h.board.turn) {
    lines.push(`*** TURN *** [${h.board.turn}]`)
    lines.push(...ggStreetLines(h.actions.turn, serializeIPokerAction))
  }

  if (h.board.river) {
    lines.push(`*** RIVER *** [${h.board.river}]`)
    lines.push(...ggStreetLines(h.actions.river, serializeIPokerAction))
  }

  lines.push('*** SUMMARY ***')
  lines.push(`Total pot €${toEur(h.totalPot)} Rake €0.00`)
  for (const w of h.winners) {
    lines.push(`${w.player}: wins €${toEur(w.amount)}`)
  }

  return lines.join('\n')
}

// ── Dispatcher ────────────────────────────────────────────────────────

const SERIALIZERS = {
  ggpoker:    serializeGGHand,
  pokerstars: serializePokerStarsHand,
  winamax:    serializeWinamaxHand,
  '888poker': serialize888Hand,
  coinpoker:  serializeCoinPokerHand,
  ipoker:     serializeIPokerHand,
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Serialize all hands of a tournament to a hand history text file.
 * @param {object} tournament - DB tournament row (id, tournament_id, name, platform, buyin, ...)
 * @param {Array}  hands      - DB hand rows with .raw field (parsed hand object)
 * @returns {string}
 */
export function serializeTournament(tournament, hands) {
  const platform    = tournament.platform || 'ggpoker'
  const serializeHand = SERIALIZERS[platform] || serializeGGHand
  return hands
    .map(hand => serializeHand(hand.raw, tournament))
    .join('\n\n')
}

/**
 * Serialize the tournament summary to text (for import into trackers).
 * Returns null if no buyin data is available.
 * @param {object} tournament - DB tournament row
 * @returns {string|null}
 */
export function serializeSummary(tournament) {
  if (tournament.buyin == null) return null

  const platform   = tournament.platform || 'ggpoker'
  const tid        = tournament.tournament_id
  const buyin      = tournament.buyin      ?? 0
  const rake       = tournament.buyin_rake ?? 0
  const players    = tournament.players    ?? 0
  const prizePool  = tournament.prize_pool ?? 0
  const finish     = tournament.finish_position
  const prizeWon   = tournament.prize_won  ?? 0

  if (platform === 'ggpoker') {
    const lines = [`Tournament #${tid}`]
    lines.push(`Buy-in: $${buyin}+$${rake}`)
    lines.push(`${players} Players`)
    lines.push(`Total Prize Pool: $${prizePool}`)
    if (finish != null) lines.push(`${ordinal(finish)} : Hero, $${prizeWon}`)
    return lines.join('\n')
  }

  if (platform === 'winamax') {
    const lines = [`Winamax Poker - Tournament summary : "${tournament.name}" (${tid})`]
    lines.push(`Buy-In : ${buyin}€ + ${rake}€`)
    lines.push(`Registered players : ${players}`)
    lines.push(`Prizepool : ${prizePool}€`)
    if (finish != null) {
      lines.push(`You finished in ${ordinal(finish)} place`)
      lines.push(`You won ${prizeWon}€`)
    }
    if (tournament.duration) lines.push(`You played ${tournament.duration}`)
    return lines.join('\n')
  }

  // PT4 format for: pokerstars, 888poker, coinpoker, ipoker
  const lines = ['PokerTracker 4 Tournament Summary']
  lines.push(`Tournament #: ${tid}`)
  lines.push(`Players: ${players}`)
  lines.push(`Buyin: $${buyin}`)
  lines.push(`Fee: $${rake}`)
  lines.push(`Prize Pool: $${prizePool}`)
  return lines.join('\n')
}
