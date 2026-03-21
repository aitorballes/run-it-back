const RANKS = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }

function parseAmt(s) {
  return parseInt((s || '0').replace(/,/g, ''), 10) || 0
}

function setSeatPos(seats, player, pos) {
  const s = seats.find(s => s.player === player)
  if (s && !s.pos) s.pos = pos
}

function parseAction(line) {
  let m
  m = line.match(/^(.+): folds$/)
  if (m) return { player: m[1], type: 'fold', amount: 0, allin: false }

  m = line.match(/^(.+): checks$/)
  if (m) return { player: m[1], type: 'check', amount: 0, allin: false }

  m = line.match(/^(.+): calls ([\d,]+) and is all-in$/)
  if (m) return { player: m[1], type: 'call', amount: parseAmt(m[2]), allin: true }

  m = line.match(/^(.+): calls ([\d,]+)$/)
  if (m) return { player: m[1], type: 'call', amount: parseAmt(m[2]), allin: false }

  m = line.match(/^(.+): raises [\d,]+ to ([\d,]+) and is all-in$/)
  if (m) return { player: m[1], type: 'raise', amount: parseAmt(m[2]), allin: true }

  m = line.match(/^(.+): raises [\d,]+ to ([\d,]+)$/)
  if (m) return { player: m[1], type: 'raise', amount: parseAmt(m[2]), allin: false }

  m = line.match(/^(.+): bets ([\d,]+) and is all-in$/)
  if (m) return { player: m[1], type: 'bet', amount: parseAmt(m[2]), allin: true }

  m = line.match(/^(.+): bets ([\d,]+)$/)
  if (m) return { player: m[1], type: 'bet', amount: parseAmt(m[2]), allin: false }

  m = line.match(/^Uncalled bet \(([\d,]+)\) returned to (.+)$/)
  if (m) return { player: m[2], type: 'uncalled', amount: parseAmt(m[1]), allin: false }

  return null
}

function buildSequence(hand) {
  const seq = []
  const streets = ['preflop', 'flop', 'turn', 'river']

  for (const street of streets) {
    if (street === 'flop'  && hand.board.flop.length > 0) seq.push({ street, type: 'reveal', idx: -1 })
    if (street === 'turn'  && hand.board.turn  != null)   seq.push({ street, type: 'reveal', idx: -1 })
    if (street === 'river' && hand.board.river != null)    seq.push({ street, type: 'reveal', idx: -1 })

    const acts = hand.actions[street] || []
    for (let i = 0; i < acts.length; i++) {
      seq.push({ street, type: 'action', idx: i })
    }
  }

  hand.streetStartStep = {}
  seq.forEach((step, i) => {
    if (!(step.street in hand.streetStartStep)) hand.streetStartStep[step.street] = i
  })

  return seq
}

function parseHand(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const h = {
    id: '', tournamentId: '', tournamentName: '', level: '',
    datetime: '', tableNum: '',
    sb: 0, bb: 0, ante: 0,
    buttonSeat: 0, maxSeats: 8,
    seats: [],
    holeCards: {},
    board: { flop: [], turn: null, river: null },
    actions: { preflop: [], flop: [], turn: [], river: [] },
    winners: [],
    totalPot: 0,
    heroResult: null,
    sequence: [],
    streetStartStep: {},
  }

  const preflopPosts = []
  let street = null
  let inSummary = false
  let seating = true

  for (const line of lines) {
    let m = line.match(/Poker Hand #(\w+): Tournament #(\d+), (.+?) - Level(\w+)\(([\d,]+)\/([\d,]+)(?:\([\d,]+\))?\) - (.+)/)
    if (m) {
      h.id = m[1]
      h.tournamentId   = m[2]
      h.tournamentName = m[3].replace(/\s*Hold'em No Limit$/, '').trim()
      h.level = m[4]
      h.sb = parseAmt(m[5]); h.bb = parseAmt(m[6]); h.datetime = m[7]
      continue
    }

    m = line.match(/Table '(\S+)' (\d+)-max Seat #(\d+) is the button/)
    if (m) { h.tableNum = m[1]; h.maxSeats = +m[2]; h.buttonSeat = +m[3]; continue }

    if (seating) {
      m = line.match(/^Seat (\d+): (.+?) \(([\d,]+) in chips\)/)
      if (m) {
        h.seats.push({ num: +m[1], player: m[2], chips: parseAmt(m[3]), pos: '', folded: false, allin: false, foldedStreet: null, allinStreet: null })
        continue
      }
    }

    m = line.match(/^(.+): posts the ante ([\d,]+)/)
    if (m) { h.ante = parseAmt(m[2]); continue }

    m = line.match(/^(.+): posts small blind ([\d,]+)/)
    if (m) {
      setSeatPos(h.seats, m[1], 'SB')
      preflopPosts.push({ player: m[1], type: 'post-sb', amount: parseAmt(m[2]), allin: false })
      if (!h.sb) h.sb = parseAmt(m[2])
      continue
    }

    m = line.match(/^(.+): posts big blind ([\d,]+)/)
    if (m) {
      setSeatPos(h.seats, m[1], 'BB')
      preflopPosts.push({ player: m[1], type: 'post-bb', amount: parseAmt(m[2]), allin: false })
      if (!h.bb) h.bb = parseAmt(m[2])
      continue
    }

    if (line === '*** HOLE CARDS ***') {
      seating = false; street = 'preflop'
      const bs = h.seats.find(s => s.num === h.buttonSeat)
      if (bs && !bs.pos) bs.pos = 'BTN'
      continue
    }

    m = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/)
    if (m) { street = 'flop'; h.board.flop = m[1].split(' '); continue }

    m = line.match(/^\*\*\* TURN \*\*\* \[.*?\] \[([^\]]+)\]/)
    if (m) { street = 'turn'; h.board.turn = m[1]; continue }

    m = line.match(/^\*\*\* RIVER \*\*\* \[.*?\] \[([^\]]+)\]/)
    if (m) { street = 'river'; h.board.river = m[1]; continue }

    if (line === '*** SHOWDOWN ***') { street = 'sd'; continue }
    if (line === '*** SUMMARY ***') { inSummary = true; street = null; continue }

    if (inSummary) {
      m = line.match(/^Total pot ([\d,]+)/)
      if (m) h.totalPot = parseAmt(m[1])
      if (line.includes('Hero') && !h.heroResult) {
        if (line.includes(' won '))       h.heroResult = 'won'
        else if (line.includes('lost'))   h.heroResult = 'lost'
        else if (line.includes('folded')) h.heroResult = 'folded'
      }
      continue
    }

    m = line.match(/^Dealt to (.+?) \[([^\]]+)\]/)
    if (m) { h.holeCards[m[1]] = m[2].split(' '); continue }

    m = line.match(/^(.+): shows \[([^\]]+)\]/)
    if (m && !h.holeCards[m[1]]) { h.holeCards[m[1]] = m[2].split(' ') }

    m = line.match(/^(.+) collected ([\d,]+) from/)
    if (m && !inSummary) h.winners.push({ player: m[1], amount: parseAmt(m[2]) })

    if (street && street !== 'sd' && !inSummary) {
      const act = parseAction(line)
      if (act) {
        h.actions[street].push(act)
        const seat = h.seats.find(s => s.player === act.player)
        if (seat) {
          if (act.type === 'fold' && !seat.foldedStreet) { seat.folded = true; seat.foldedStreet = street }
          if (act.allin && !seat.allinStreet)            { seat.allin  = true; seat.allinStreet  = street }
        }
      }
    }

    m = line.match(/^(.+) collected ([\d,]+) from/)
    if (m && street === 'sd' && !inSummary) {
      h.actions.river.push({ player: m[1], type: 'won', amount: parseAmt(m[2]), allin: false })
    }
  }

  h.actions.preflop = [...preflopPosts, ...h.actions.preflop]
  h.sequence = buildSequence(h)

  return h
}

export function parseFile(text) {
  return text
    .split(/(?=Poker Hand #)/)
    .filter(s => s.trimStart().startsWith('Poker Hand #'))
    .map(parseHand)
    .filter(Boolean)
}

export function groupByTournament(allHands) {
  const map = new Map()
  for (const hand of allHands) {
    const tid = hand.tournamentId || 'unknown'
    if (!map.has(tid)) {
      map.set(tid, { id: tid, name: hand.tournamentName || tid, datetime: hand.datetime, hands: [] })
    }
    map.get(tid).hands.push(hand)
  }
  return Array.from(map.values()).sort((a, b) => a.datetime.localeCompare(b.datetime))
}

export function calcHeroNet(hand) {
  const heroSeat = hand.seats.find(s => s.player === 'Hero')
  if (!heroSeat) return 0
  let invested = hand.ante
  if (heroSeat.pos === 'SB') invested += hand.sb
  if (heroSeat.pos === 'BB') invested += hand.bb
  const allActs = [...hand.actions.preflop, ...hand.actions.flop, ...hand.actions.turn, ...hand.actions.river]
  for (const a of allActs) {
    if (a.player !== 'Hero') continue
    if (['call', 'raise', 'bet'].includes(a.type)) invested += a.amount
  }
  const won = hand.winners.filter(w => w.player === 'Hero').reduce((s, w) => s + w.amount, 0)
  return won - invested
}
