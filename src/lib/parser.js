const RANKS = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }

function parseAmt(s) {
  return parseInt((s || '0').replace(/,/g, ''), 10) || 0
}

function setSeatPos(seats, player, pos) {
  const s = seats.find(s => s.player === player)
  if (s && !s.pos) s.pos = pos
}

// ── GGPoker action parser (lines with colon) ──────────────────────────
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

  // CoinPoker: "raises X and is all-in" without "to Y"
  m = line.match(/^(.+): raises ([\d,]+) and is all-in$/)
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

// ── Winamax action parser (lines without colon) ───────────────────────
function parseWinamaxAction(line) {
  let m
  m = line.match(/^(.+) folds$/)
  if (m) return { player: m[1], type: 'fold', amount: 0, allin: false }

  m = line.match(/^(.+) checks$/)
  if (m) return { player: m[1], type: 'check', amount: 0, allin: false }

  m = line.match(/^(.+) calls (\d+) and is all-in$/)
  if (m) return { player: m[1], type: 'call', amount: parseAmt(m[2]), allin: true }

  m = line.match(/^(.+) calls (\d+)$/)
  if (m) return { player: m[1], type: 'call', amount: parseAmt(m[2]), allin: false }

  m = line.match(/^(.+) raises \d+ to (\d+) and is all-in$/)
  if (m) return { player: m[1], type: 'raise', amount: parseAmt(m[2]), allin: true }

  m = line.match(/^(.+) raises \d+ to (\d+)$/)
  if (m) return { player: m[1], type: 'raise', amount: parseAmt(m[2]), allin: false }

  m = line.match(/^(.+) bets (\d+) and is all-in$/)
  if (m) return { player: m[1], type: 'bet', amount: parseAmt(m[2]), allin: true }

  m = line.match(/^(.+) bets (\d+)$/)
  if (m) return { player: m[1], type: 'bet', amount: parseAmt(m[2]), allin: false }

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

// ── GGPoker hand parser ───────────────────────────────────────────────
function parseHand(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const h = {
    id: '', tournamentId: '', tournamentName: '', level: '',
    datetime: '', tableNum: '', platform: 'ggpoker',
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

// ── Winamax helpers ───────────────────────────────────────────────────
function normalizeHero(hand, heroName) {
  const rename = p => (p === heroName ? 'Hero' : p)
  hand.seats = hand.seats.map(s => ({ ...s, player: rename(s.player) }))
  if (hand.holeCards[heroName]) {
    hand.holeCards['Hero'] = hand.holeCards[heroName]
    delete hand.holeCards[heroName]
  }
  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    hand.actions[street] = hand.actions[street].map(a => ({ ...a, player: rename(a.player) }))
  }
  hand.winners = hand.winners.map(w => ({ ...w, player: rename(w.player) }))
}

// ── Winamax hand parser ───────────────────────────────────────────────
function parseWinamaxHand(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const h = {
    id: '', tournamentId: '', tournamentName: '', level: '',
    datetime: '', tableNum: '', platform: 'winamax',
    sb: 0, bb: 0, ante: 0,
    buttonSeat: 0, maxSeats: 6,
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

  let heroName = null
  const preflopPosts = []
  let street = null
  let inSummary = false
  let seating = true

  for (const line of lines) {
    // ── Summary (handle early to avoid false matches below) ──
    if (inSummary) {
      const m = line.match(/^Total pot (\d+)/)
      if (m) h.totalPot = parseAmt(m[1])
      continue
    }

    let m

    // ── Header ──
    // Format: Winamax Poker - Tournament "NAME" buyIn: X€ + Y€ level: N - HandId: #T-H-X - Holdem no limit (ante/sb/bb) - YYYY/MM/DD HH:MM:SS UTC
    m = line.match(/^Winamax Poker - Tournament "(.+?)" buyIn:.+level: (\d+) - HandId: #(\d+)-(\d+)-\d+ - Holdem no limit \((\d+)\/(\d+)\/(\d+)\) - (\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/)
    if (m) {
      h.tournamentName = m[1]
      h.level          = m[2]
      h.tournamentId   = m[3]           // fallback; overwritten by table line
      h.id             = `${m[3]}-${m[4]}`
      h.ante           = parseAmt(m[5]) // Winamax order: ante/sb/bb
      h.sb             = parseAmt(m[6])
      h.bb             = parseAmt(m[7])
      h.datetime       = m[8]
      continue
    }

    // ── Table ──
    // Format: Table: 'NAME(TOURNAMENT_ID)#TABLE_NUM' N-max (real money) Seat #N is the button
    m = line.match(/^Table: '(.+?)\((\d+)\)#(\w+)' (\d+)-max .* Seat #(\d+) is the button/)
    if (m) {
      h.tournamentId = m[2]
      h.tableNum     = `${m[1].trim()}#${m[3]}`
      h.maxSeats     = +m[4]
      h.buttonSeat   = +m[5]
      continue
    }

    // ── Seats ──
    // Format: Seat N: PLAYER (chips, optional bounty)
    if (seating) {
      m = line.match(/^Seat (\d+): (.+?) \((\d+)/)
      if (m) {
        h.seats.push({ num: +m[1], player: m[2], chips: parseAmt(m[3]), pos: '', folded: false, allin: false, foldedStreet: null, allinStreet: null })
        continue
      }
    }

    // ── Section markers ──
    if (line === '*** ANTE/BLINDS ***') { seating = false; continue }

    if (line === '*** SUMMARY ***') { inSummary = true; street = null; continue }

    if (line === '*** SHOW DOWN ***') { street = 'sd'; continue }

    m = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/)
    if (m) { street = 'flop'; h.board.flop = m[1].split(' '); continue }

    // Winamax: [prev][card] with no space between bracket groups
    m = line.match(/^\*\*\* TURN \*\*\* \[.*?\]\[([^\]]+)\]/)
    if (m) { street = 'turn'; h.board.turn = m[1]; continue }

    m = line.match(/^\*\*\* RIVER \*\*\* \[.*?\]\[([^\]]+)\]/)
    if (m) { street = 'river'; h.board.river = m[1]; continue }

    if (line === '*** PRE-FLOP ***') {
      street = 'preflop'
      const bs = h.seats.find(s => s.num === h.buttonSeat)
      if (bs && !bs.pos) bs.pos = 'BTN'
      continue
    }

    // ── Antes and blinds (in ANTE/BLINDS section, street is null) ──
    m = line.match(/^(.+) posts ante \d+$/)
    if (m) continue  // ante amount already parsed from header

    m = line.match(/^(.+) posts small blind (\d+)$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'SB')
      preflopPosts.push({ player: m[1], type: 'post-sb', amount: parseAmt(m[2]), allin: false })
      continue
    }

    m = line.match(/^(.+) posts big blind (\d+)$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'BB')
      preflopPosts.push({ player: m[1], type: 'post-bb', amount: parseAmt(m[2]), allin: false })
      continue
    }

    // ── Dealt to hero (appears before PRE-FLOP in Winamax) ──
    m = line.match(/^Dealt to (.+?) \[([^\]]+)\]/)
    if (m) {
      heroName = m[1]
      h.holeCards[m[1]] = m[2].split(' ')
      continue
    }

    // ── Shows (other players' cards at showdown) ──
    m = line.match(/^(.+) shows \[([^\]]+)\]/)
    if (m && !h.holeCards[m[1]]) { h.holeCards[m[1]] = m[2].split(' ') }

    // ── Winner ──
    m = line.match(/^(.+) collected (\d+) from/)
    if (m) {
      h.winners.push({ player: m[1], amount: parseAmt(m[2]) })
      // Add 'won' badge to sequence
      const wonStreet = street === 'sd' ? 'river' : (street ?? 'preflop')
      if (['preflop', 'flop', 'turn', 'river'].includes(wonStreet)) {
        h.actions[wonStreet].push({ player: m[1], type: 'won', amount: parseAmt(m[2]), allin: false })
      }
      continue
    }

    // ── Actions ──
    if (street && street !== 'sd') {
      const act = parseWinamaxAction(line)
      if (act) {
        h.actions[street].push(act)
        const seat = h.seats.find(s => s.player === act.player)
        if (seat) {
          if (act.type === 'fold' && !seat.foldedStreet) { seat.folded = true; seat.foldedStreet = street }
          if (act.allin && !seat.allinStreet)            { seat.allin  = true; seat.allinStreet  = street }
        }
      }
    }
  }

  h.actions.preflop = [...preflopPosts, ...h.actions.preflop]
  h.sequence = buildSequence(h)

  // Normalize hero username → "Hero"
  if (heroName && heroName !== 'Hero') {
    normalizeHero(h, heroName)
  }

  // Compute heroResult from parsed data
  if (h.winners.some(w => w.player === 'Hero')) {
    h.heroResult = 'won'
  } else {
    const allActs = [...h.actions.preflop, ...h.actions.flop, ...h.actions.turn, ...h.actions.river]
    h.heroResult = allActs.some(a => a.player === 'Hero' && a.type === 'fold') ? 'folded' : 'lost'
  }

  return h
}

// ── iPoker helpers ────────────────────────────────────────────────────
function parseIPokerAmt(s) {
  return Math.round(parseFloat((s || '0').replace(/[€,]/g, ''))) || 0
}

function convertIPokerCard(card) {
  // iPoker notation: SuitRank (e.g. DK=Kd, S7=7s, D10=Td, HA=Ah)
  const suitMap = { S: 's', D: 'd', C: 'c', H: 'h' }
  const suit = suitMap[card[0]]
  if (!suit) return card
  const rank = card.slice(1) === '10' ? 'T' : card.slice(1)
  return rank + suit
}

function parseIPokerAction(line) {
  let m
  m = line.match(/^(.+): Fold$/)
  if (m) return { player: m[1], type: 'fold', amount: 0, allin: false }

  m = line.match(/^(.+): Check$/)
  if (m) return { player: m[1], type: 'check', amount: 0, allin: false }

  m = line.match(/^(.+): Call \(AI\) €([\d,.]+)$/)
  if (m) return { player: m[1], type: 'call', amount: parseIPokerAmt(m[2]), allin: true }

  m = line.match(/^(.+): Call €([\d,.]+)$/)
  if (m) return { player: m[1], type: 'call', amount: parseIPokerAmt(m[2]), allin: false }

  m = line.match(/^(.+): Raise \(AI\) €([\d,.]+)$/)
  if (m) return { player: m[1], type: 'raise', amount: parseIPokerAmt(m[2]), allin: true }

  m = line.match(/^(.+): Raise \(NF\) €([\d,.]+)$/)
  if (m) return { player: m[1], type: 'raise', amount: parseIPokerAmt(m[2]), allin: false }

  m = line.match(/^(.+): Bet \(AI\) €([\d,.]+)$/)
  if (m) return { player: m[1], type: 'bet', amount: parseIPokerAmt(m[2]), allin: true }

  m = line.match(/^(.+): Bet €([\d,.]+)$/)
  if (m) return { player: m[1], type: 'bet', amount: parseIPokerAmt(m[2]), allin: false }

  return null
}

// ── iPoker hand parser ────────────────────────────────────────────────
function parseIPokerHand(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const h = {
    id: '', tournamentId: '', tournamentName: '', level: '',
    datetime: '', tableNum: '', platform: 'ipoker',
    sb: 0, bb: 0, ante: 0,
    buttonSeat: 0, maxSeats: 6,
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

  let heroName = null
  const preflopPosts = []
  let street = null
  let inSummary = false

  for (const line of lines) {
    let m

    // Header: GAME #ID Version:... Texas Hold'em NL  Tournament 2026-03-23 22:35:25/GMT
    m = line.match(/^GAME #(\d+).+Tournament\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/)
    if (m) {
      h.id = m[1]
      h.datetime = m[2].replace(/-/g, '/')
      continue
    }

    // Table Info: Size: 6, Blinds: 1800.00/3600.00, Ante: 360.00
    m = line.match(/^Table Info: Size: (\d+), Blinds: ([\d.]+)\/([\d.]+), Ante: ([\d.]+)/)
    if (m) {
      h.maxSeats = +m[1]
      h.sb = Math.round(parseFloat(m[2])); h.bb = Math.round(parseFloat(m[3])); h.ante = Math.round(parseFloat(m[4]))
      continue
    }

    // Table NAME, sessionID, tournamentID (Tournament: NAME Buy-In: ...)
    m = line.match(/^Table (.+?), \d+, (\d+) \(Tournament: (.+?) Buy-In:/)
    if (m) { h.tournamentId = m[2]; h.tournamentName = m[3].trim(); continue }

    // Seats: Seat 8: player (€amount in chips)  [DEALER]
    m = line.match(/^Seat (\d+): (.+?) \(€([\d,.]+) in chips\)(\s+DEALER)?/)
    if (m) {
      const num = +m[1]; const player = m[2].trim()
      h.seats.push({ num, player, chips: parseIPokerAmt(m[3]), pos: '', folded: false, allin: false, foldedStreet: null, allinStreet: null })
      if (m[4]) { h.buttonSeat = num }
      continue
    }

    // Antes/blinds
    m = line.match(/^(.+): Post Ante €([\d,.]+)$/)
    if (m) { h.ante = h.ante || parseIPokerAmt(m[2]); continue }

    m = line.match(/^(.+): Post SB €([\d,.]+)$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'SB')
      preflopPosts.push({ player: m[1], type: 'post-sb', amount: parseIPokerAmt(m[2]), allin: false })
      continue
    }

    m = line.match(/^(.+): Post BB €([\d,.]+)$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'BB')
      preflopPosts.push({ player: m[1], type: 'post-bb', amount: parseIPokerAmt(m[2]), allin: false })
      continue
    }

    if (line === '*** HOLE CARDS ***') {
      street = 'preflop'
      const bs = h.seats.find(s => s.num === h.buttonSeat)
      if (bs && !bs.pos) bs.pos = 'BTN'
      continue
    }

    // Hole cards: Dealt to kkAAt [DK DA]
    m = line.match(/^Dealt to (.+?) \[([^\]]+)\]$/)
    if (m) {
      heroName = m[1].trim()
      h.holeCards[heroName] = m[2].split(' ').map(convertIPokerCard)
      continue
    }

    // Board (iPoker shows only the new card per street)
    m = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]$/)
    if (m) { street = 'flop'; h.board.flop = m[1].split(' ').map(convertIPokerCard); continue }

    m = line.match(/^\*\*\* TURN \*\*\* \[([^\]]+)\]$/)
    if (m) { street = 'turn'; h.board.turn = convertIPokerCard(m[1].trim()); continue }

    m = line.match(/^\*\*\* RIVER \*\*\* \[([^\]]+)\]$/)
    if (m) { street = 'river'; h.board.river = convertIPokerCard(m[1].trim()); continue }

    if (line === '*** SHOW DOWN ***') { street = 'sd'; continue }
    if (line === '*** SUMMARY ***') { inSummary = true; street = null; continue }

    if (inSummary) {
      m = line.match(/^Total pot €([\d,.]+) Rake/)
      if (m) h.totalPot = parseIPokerAmt(m[1])
      // Winner: player: wins €amount
      m = line.match(/^(.+): wins €([\d,.]+)$/)
      if (m) h.winners.push({ player: m[1], amount: parseIPokerAmt(m[2]) })
      continue
    }

    if (street && street !== 'sd') {
      const act = parseIPokerAction(line)
      if (act) {
        h.actions[street].push(act)
        const seat = h.seats.find(s => s.player === act.player)
        if (seat) {
          if (act.type === 'fold' && !seat.foldedStreet) { seat.folded = true; seat.foldedStreet = street }
          if (act.allin && !seat.allinStreet)            { seat.allin  = true; seat.allinStreet  = street }
        }
      }
    }
  }

  h.actions.preflop = [...preflopPosts, ...h.actions.preflop]
  h.sequence = buildSequence(h)

  if (heroName && heroName !== 'Hero') normalizeHero(h, heroName)

  if (h.winners.some(w => w.player === 'Hero')) {
    h.heroResult = 'won'
  } else {
    const allActs = [...h.actions.preflop, ...h.actions.flop, ...h.actions.turn, ...h.actions.river]
    h.heroResult = allActs.some(a => a.player === 'Hero' && a.type === 'fold') ? 'folded' : 'lost'
  }

  return h
}

// ── 888poker helpers ──────────────────────────────────────────────────
function parse888Amt(s) {
  // European thousands separator: 1.600 = 1600, 18.429 = 18429
  return parseInt((s || '0').replace(/\./g, ''), 10) || 0
}

function parse888Action(line) {
  let m
  m = line.match(/^(.+) folds$/)
  if (m) return { player: m[1], type: 'fold', amount: 0, allin: false }

  m = line.match(/^(.+) checks$/)
  if (m) return { player: m[1], type: 'check', amount: 0, allin: false }

  m = line.match(/^(.+) calls \[([\d.]+)\] and is all-in$/)
  if (m) return { player: m[1], type: 'call', amount: parse888Amt(m[2]), allin: true }

  m = line.match(/^(.+) calls \[([\d.]+)\]$/)
  if (m) return { player: m[1], type: 'call', amount: parse888Amt(m[2]), allin: false }

  m = line.match(/^(.+) raises \[([\d.]+)\] and is all-in$/)
  if (m) return { player: m[1], type: 'raise', amount: parse888Amt(m[2]), allin: true }

  m = line.match(/^(.+) raises \[([\d.]+)\]$/)
  if (m) return { player: m[1], type: 'raise', amount: parse888Amt(m[2]), allin: false }

  m = line.match(/^(.+) bets \[([\d.]+)\] and is all-in$/)
  if (m) return { player: m[1], type: 'bet', amount: parse888Amt(m[2]), allin: true }

  m = line.match(/^(.+) bets \[([\d.]+)\]$/)
  if (m) return { player: m[1], type: 'bet', amount: parse888Amt(m[2]), allin: false }

  return null
}

// ── 888poker hand parser ──────────────────────────────────────────────
function parse888Hand(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const h = {
    id: '', tournamentId: '', tournamentName: '', level: '',
    datetime: '', tableNum: '', platform: '888poker',
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

  let heroName = null
  const preflopPosts = []
  let street = null
  let inSummary = false

  for (const line of lines) {
    let m

    // Header line 1: ***** 888.es Hand History for Game 557161107 *****
    m = line.match(/^\*{5} \S+ Hand History for Game (\d+) \*{5}$/)
    if (m) { h.id = m[1]; continue }

    // Header line 2: 800/1.600 Blinds No Limit Holdem - *** 23 03 2026 22:21:09
    m = line.match(/^([\d.]+)\/([\d.]+) Blinds.+\*{3} (\d{2}) (\d{2}) (\d{4}) (\d{2}:\d{2}:\d{2})/)
    if (m) {
      h.sb = parse888Amt(m[1]); h.bb = parse888Amt(m[2])
      h.datetime = `${m[5]}/${m[4]}/${m[3]} ${m[6]}`
      continue
    }

    // Tournament line: Tournament #287856940 4,95 € + 0,55 € - Table #8 8 Max (Real Money)
    m = line.match(/^Tournament #(\d+) (.+?) - Table #(\S+)/)
    if (m) { h.tournamentId = m[1]; h.tournamentName = m[2].trim(); h.tableNum = m[3]; continue }

    // Button: Seat 3 is the button
    m = line.match(/^Seat (\d+) is the button$/)
    if (m) { h.buttonSeat = +m[1]; continue }

    if (line.startsWith('Total number of players')) continue

    // Seats: Seat 1: tiagoliam23 ( 18.429 )
    m = line.match(/^Seat (\d+): (.+?) \( ([\d.]+) \)$/)
    if (m) {
      h.seats.push({ num: +m[1], player: m[2].trim(), chips: parse888Amt(m[3]), pos: '', folded: false, allin: false, foldedStreet: null, allinStreet: null })
      const bs = h.seats.find(s => s.num === h.buttonSeat)
      if (bs && !bs.pos) bs.pos = 'BTN'
      continue
    }

    // Antes/blinds
    m = line.match(/^(.+) posts ante \[([\d.]+)\]$/)
    if (m) { h.ante = parse888Amt(m[2]); continue }

    m = line.match(/^(.+) posts small blind \[([\d.]+)\]$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'SB')
      preflopPosts.push({ player: m[1], type: 'post-sb', amount: parse888Amt(m[2]), allin: false })
      if (!h.sb) h.sb = parse888Amt(m[2])
      continue
    }

    m = line.match(/^(.+) posts big blind \[([\d.]+)\]$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'BB')
      preflopPosts.push({ player: m[1], type: 'post-bb', amount: parse888Amt(m[2]), allin: false })
      if (!h.bb) h.bb = parse888Amt(m[2])
      continue
    }

    if (line === '** Dealing down cards **') {
      street = 'preflop'; continue
    }

    // Hole cards: Dealt to OzBeast [ Qd, 4d ]
    m = line.match(/^Dealt to (.+?) \[ (.+?) \]$/)
    if (m) {
      heroName = m[1].trim()
      h.holeCards[heroName] = m[2].split(', ').map(c => c.trim())
      continue
    }

    // Board cards
    m = line.match(/^\*\* Dealing flop \*\* \[ (.+?) \]$/)
    if (m) { street = 'flop'; h.board.flop = m[1].split(', ').map(c => c.trim()); continue }

    m = line.match(/^\*\* Dealing turn \*\* \[ (.+?) \]$/)
    if (m) { street = 'turn'; h.board.turn = m[1].trim(); continue }

    m = line.match(/^\*\* Dealing river \*\* \[ (.+?) \]$/)
    if (m) { street = 'river'; h.board.river = m[1].trim(); continue }

    // Runout markers (ignore)
    if (line === '** First runout **' || line === '** Second runout **') continue

    if (line === '** Summary **') { inSummary = true; street = null; continue }

    if (inSummary) {
      // Winner: [First runout] player collected [ 5.600 ]
      m = line.match(/^(?:(?:First|Second) runout )?(.+?) collected \[ ([\d.]+) \]$/)
      if (m) h.winners.push({ player: m[1].trim(), amount: parse888Amt(m[2]) })
      continue
    }

    // Shows: player shows [ Qd, 4d ]
    m = line.match(/^(.+) shows \[ (.+?) \]$/)
    if (m && !h.holeCards[m[1]]) { h.holeCards[m[1]] = m[2].split(', ').map(c => c.trim()) }

    if (street && !inSummary) {
      const act = parse888Action(line)
      if (act) {
        h.actions[street].push(act)
        const seat = h.seats.find(s => s.player === act.player)
        if (seat) {
          if (act.type === 'fold' && !seat.foldedStreet) { seat.folded = true; seat.foldedStreet = street }
          if (act.allin && !seat.allinStreet)            { seat.allin  = true; seat.allinStreet  = street }
        }
      }
    }
  }

  h.actions.preflop = [...preflopPosts, ...h.actions.preflop]
  // Compute totalPot from winners if not available
  if (!h.totalPot && h.winners.length > 0) {
    h.totalPot = h.winners.reduce((s, w) => s + w.amount, 0)
  }
  h.sequence = buildSequence(h)

  if (heroName && heroName !== 'Hero') normalizeHero(h, heroName)

  if (h.winners.some(w => w.player === 'Hero')) {
    h.heroResult = 'won'
  } else {
    const allActs = [...h.actions.preflop, ...h.actions.flop, ...h.actions.turn, ...h.actions.river]
    h.heroResult = allActs.some(a => a.player === 'Hero' && a.type === 'fold') ? 'folded' : 'lost'
  }

  return h
}

// ── CoinPoker helpers ─────────────────────────────────────────────────
function parseCoinPokerAmt(s) {
  return Math.round(parseFloat((s || '0').replace(/,/g, ''))) || 0
}

function parseCoinPokerAction(line) {
  let m
  m = line.match(/^(.+): folds$/)
  if (m) return { player: m[1], type: 'fold', amount: 0, allin: false }

  m = line.match(/^(.+): checks$/)
  if (m) return { player: m[1], type: 'check', amount: 0, allin: false }

  m = line.match(/^(.+): calls ([\d,.]+)$/)
  if (m) return { player: m[1], type: 'call', amount: parseCoinPokerAmt(m[2]), allin: false }

  m = line.match(/^(.+): raises [\d,.]+ to ([\d,.]+)$/)
  if (m) return { player: m[1], type: 'raise', amount: parseCoinPokerAmt(m[2]), allin: false }

  m = line.match(/^(.+): bets ([\d,.]+)$/)
  if (m) return { player: m[1], type: 'bet', amount: parseCoinPokerAmt(m[2]), allin: false }

  // ALLIN: all remaining chips go in (raise or call all-in)
  m = line.match(/^(.+): ALLIN ([\d,.]+)$/)
  if (m) return { player: m[1], type: 'raise', amount: parseCoinPokerAmt(m[2]), allin: true }

  // RETURN: uncalled portion returned, ignored for net calc
  m = line.match(/^(.+): RETURN ([\d,.]+)$/)
  if (m) return { player: m[1], type: 'uncalled', amount: parseCoinPokerAmt(m[2]), allin: false }

  return null
}

// ── CoinPoker hand parser ─────────────────────────────────────────────
// Format differs significantly from GGPoker/PokerStars:
//   Line 1: CoinPoker Hand #ID: NLH (SB/BB/ANTE) DATETIME TZ
//   Line 2: Tournament 'Name' 'ID' N-max Seat #N is the button
//   Chip amounts are decimal (e.g. 7,009.47); ALLIN/RETURN instead of
//   "raises X and is all-in" / "Uncalled bet returned"
function parseCoinPokerHand(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const h = {
    id: '', tournamentId: '', tournamentName: '', level: '',
    datetime: '', tableNum: '', platform: 'coinpoker',
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
    let m

    // Line 1a: CoinPoker Hand #185560013: NLH (125/250/31) 2026/03/03 20:09:16 CET
    // Blind amounts can have comma thousands separators at higher levels: (500/1,000/125)
    m = line.match(/^CoinPoker Hand #(\w+): \w+ \(([\d,]+)\/([\d,]+)\/([\d,]+)\) (.+?) [A-Z]+$/)
    if (m) {
      h.id = m[1]
      h.sb = parseCoinPokerAmt(m[2]); h.bb = parseCoinPokerAmt(m[3]); h.ante = parseCoinPokerAmt(m[4])
      h.datetime = m[5]
      continue
    }

    // Line 1b: CoinPoker Hand #5656240044: Tournament #52494, WPM-L ₮22 6-Max PKO Hold'em No Limit (500/1000 ante 170 play) 2026/05/21 22:44:13 GMT
    m = line.match(/^CoinPoker Hand #(\w+): Tournament #(\d+), (.+?) Hold'em No Limit \(([\d,]+)\/([\d,]+) ante ([\d,]+) play\) (.+?) [A-Z]+$/)
    if (m) {
      h.id = m[1]; h.tournamentId = m[2]; h.tournamentName = m[3].trim()
      h.sb = parseCoinPokerAmt(m[4]); h.bb = parseCoinPokerAmt(m[5]); h.ante = parseCoinPokerAmt(m[6])
      h.datetime = m[7]
      continue
    }

    // Line 2a: Tournament 'Name' 'ID' 7-max Seat #1 is the button (old format)
    m = line.match(/^Tournament '(.+?)' '(\d+)' (\d+)-max Seat #(\d+) is the button/)
    if (m) {
      h.tournamentName = m[1]; h.tournamentId = m[2]
      h.maxSeats = +m[3]; h.buttonSeat = +m[4]
      continue
    }

    // Line 2b: Table 'T52494-1' 6-max Seat #1 is the button (new tournament format)
    m = line.match(/^Table '(.+?)' (\d+)-max Seat #(\d+) is the button/)
    if (m) {
      h.tableNum = m[1]; h.maxSeats = +m[2]; h.buttonSeat = +m[3]
      continue
    }

    if (seating) {
      m = line.match(/^Seat (\d+): (.+?) \(([\d,.]+) in chips\)/)
      if (m) {
        h.seats.push({ num: +m[1], player: m[2], chips: parseCoinPokerAmt(m[3]), pos: '', folded: false, allin: false, foldedStreet: null, allinStreet: null })
        continue
      }
    }

    m = line.match(/^(.+): posts ante ([\d,.]+)$/)
    if (m) { h.ante = h.ante || parseCoinPokerAmt(m[2]); continue }

    m = line.match(/^(.+): posts small blind ([\d,.]+)$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'SB')
      preflopPosts.push({ player: m[1], type: 'post-sb', amount: parseCoinPokerAmt(m[2]), allin: false })
      continue
    }

    m = line.match(/^(.+): posts big blind ([\d,.]+)$/)
    if (m) {
      setSeatPos(h.seats, m[1], 'BB')
      preflopPosts.push({ player: m[1], type: 'post-bb', amount: parseCoinPokerAmt(m[2]), allin: false })
      continue
    }

    if (line === '*** HOLE CARDS ***') {
      seating = false; street = 'preflop'
      const bs = h.seats.find(s => s.num === h.buttonSeat)
      if (bs && !bs.pos) bs.pos = 'BTN'
      continue
    }

    m = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/)
    if (m) { street = 'flop'; h.board.flop = m[1].trim().split(/\s+/); continue }

    m = line.match(/^\*\*\* TURN \*\*\* \[.*?\] \[([^\]]+)\]/)
    if (m) { street = 'turn'; h.board.turn = m[1].trim(); continue }

    m = line.match(/^\*\*\* RIVER \*\*\* \[.*?\] \[([^\]]+)\]/)
    if (m) { street = 'river'; h.board.river = m[1].trim(); continue }

    if (line === '*** SHOWDOWN ***') { street = 'sd'; continue }
    if (line === '*** SUMMARY ***') { inSummary = true; street = null; continue }

    if (inSummary) {
      m = line.match(/^Total pot ([\d,.]+)/)
      if (m) h.totalPot = parseCoinPokerAmt(m[1])
      continue
    }

    // Hole cards — CoinPoker already labels hero as "Hero"
    m = line.match(/^Dealt to (.+?) \[([^\]]+)\]/)
    if (m) { h.holeCards[m[1]] = m[2].trim().split(/\s+/); continue }

    m = line.match(/^(.+): shows \[([^\]]+)\]/)
    if (m && !h.holeCards[m[1]]) { h.holeCards[m[1]] = m[2].trim().split(/\s+/) }

    m = line.match(/^(.+) collected ([\d,.]+) from/)
    if (m && !inSummary) {
      h.winners.push({ player: m[1], amount: parseCoinPokerAmt(m[2]) })
      if (street === 'sd') {
        h.actions.river.push({ player: m[1], type: 'won', amount: parseCoinPokerAmt(m[2]), allin: false })
      }
    }

    if (street && street !== 'sd' && !inSummary) {
      const act = parseCoinPokerAction(line)
      if (act) {
        h.actions[street].push(act)
        const seat = h.seats.find(s => s.player === act.player)
        if (seat) {
          if (act.type === 'fold' && !seat.foldedStreet) { seat.folded = true; seat.foldedStreet = street }
          if (act.allin && !seat.allinStreet)            { seat.allin  = true; seat.allinStreet  = street }
        }
      }
    }
  }

  h.actions.preflop = [...preflopPosts, ...h.actions.preflop]
  h.sequence = buildSequence(h)

  if (h.winners.some(w => w.player === 'Hero')) {
    h.heroResult = 'won'
  } else {
    const allActs = [...h.actions.preflop, ...h.actions.flop, ...h.actions.turn, ...h.actions.river]
    h.heroResult = allActs.some(a => a.player === 'Hero' && a.type === 'fold') ? 'folded' : 'lost'
  }

  return h
}

// ── PokerStars hand parser ────────────────────────────────────────────
function parsePokerStarsHand(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)

  const h = {
    id: '', tournamentId: '', tournamentName: '', level: '',
    datetime: '', tableNum: '', platform: 'pokerstars',
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

  let heroName = null
  const preflopPosts = []
  let street = null
  let inSummary = false
  let seating = true

  for (const line of lines) {
    let m

    // Header: PokerStars Hand #ID: Tournament #TID, ... - Level NAME (SB/BB) - DATETIME TZ
    m = line.match(/^PokerStars Hand #(\w+): Tournament #(\d+), (.+?) - Level (\w+) \(([\d,]+)\/([\d,]+)\) - ([\d\/]+ [\d:]+)/)
    if (m) {
      h.id = m[1]; h.tournamentId = m[2]
      h.tournamentName = m[3].replace(/Hold'em No Limit$/, '').replace(/EUR\s*$/, '').trim()
      h.level = m[4]; h.sb = parseAmt(m[5]); h.bb = parseAmt(m[6]); h.datetime = m[7]
      continue
    }

    // Table: Table '3975958030 56' 8-max Seat #1 is the button
    m = line.match(/^Table '(.+?)' (\d+)-max Seat #(\d+) is the button/)
    if (m) { h.tableNum = m[1]; h.maxSeats = +m[2]; h.buttonSeat = +m[3]; continue }

    if (seating) {
      // Seat with optional bounty: Seat 1: player (chips in chips, €X bounty)
      m = line.match(/^Seat (\d+): (.+?) \(([\d,]+) in chips/)
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

    if (line === '*** SHOW DOWN ***') { street = 'sd'; continue }
    if (line === '*** SUMMARY ***') { inSummary = true; street = null; continue }

    if (inSummary) {
      m = line.match(/^Total pot ([\d,]+)/)
      if (m) h.totalPot = parseAmt(m[1])
      continue
    }

    m = line.match(/^Dealt to (.+?) \[([^\]]+)\]/)
    if (m) { heroName = m[1]; h.holeCards[m[1]] = m[2].split(' '); continue }

    m = line.match(/^(.+): shows \[([^\]]+)\]/)
    if (m && !h.holeCards[m[1]]) { h.holeCards[m[1]] = m[2].split(' ') }

    m = line.match(/^(.+) collected ([\d,]+) from/)
    if (m && !inSummary) {
      h.winners.push({ player: m[1], amount: parseAmt(m[2]) })
      if (street === 'sd') {
        h.actions.river.push({ player: m[1], type: 'won', amount: parseAmt(m[2]), allin: false })
      }
    }

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
  }

  h.actions.preflop = [...preflopPosts, ...h.actions.preflop]
  h.sequence = buildSequence(h)

  if (heroName && heroName !== 'Hero') normalizeHero(h, heroName)

  if (h.winners.some(w => w.player === 'Hero')) {
    h.heroResult = 'won'
  } else {
    const allActs = [...h.actions.preflop, ...h.actions.flop, ...h.actions.turn, ...h.actions.river]
    h.heroResult = allActs.some(a => a.player === 'Hero' && a.type === 'fold') ? 'folded' : 'lost'
  }

  return h
}

// ── GGPoker summary parser ────────────────────────────────────────────
function parseGGSummary(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const m0 = lines[0]?.match(/Tournament #(\d+)/)
  if (!m0) return null
  const result = { tournamentId: m0[1] }

  for (const line of lines) {
    let m
    m = line.match(/Buy-in: \$?([\d,.]+)\+\$?([\d,.]+)/)
    if (m) { result.buyin = parseFloat(m[1].replace(',', '')); result.buyinRake = parseFloat(m[2].replace(',', '')) }

    m = line.match(/^([\d,]+) Players$/)
    if (m) result.players = parseInt(m[1].replace(',', ''))

    m = line.match(/Total Prize Pool: \$?([\d,.]+)/)
    if (m) result.prizePool = parseFloat(m[1].replace(',', ''))

    m = line.match(/^(\d+)\w+ : Hero, \$?([\d,.]+)/)
    if (m) { result.finishPosition = parseInt(m[1]); result.prizeWon = parseFloat(m[2].replace(',', '')) }
  }
  return result
}

// ── Winamax summary parser ────────────────────────────────────────────
function parseWinamaxSummary(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const m0 = lines[0]?.match(/\((\d+)\)/)
  if (!m0) return null
  const result = { tournamentId: m0[1] }

  for (const line of lines) {
    let m
    m = line.match(/Buy-In : ([\d.]+)€ \+ ([\d.]+)€/)
    if (m) { result.buyin = parseFloat(m[1]); result.buyinRake = parseFloat(m[2]) }

    m = line.match(/Registered players : (\d+)/)
    if (m) result.players = parseInt(m[1])

    m = line.match(/Prizepool : ([\d.]+)€/)
    if (m) result.prizePool = parseFloat(m[1])

    m = line.match(/You finished in (\d+)\w+ place/)
    if (m) result.finishPosition = parseInt(m[1])

    m = line.match(/You won ([\d.]+)€/)
    if (m) result.prizeWon = parseFloat(m[1])

    m = line.match(/You played (.+)/)
    if (m) result.duration = m[1].trim()
  }
  return result
}

// ── PokerTracker 4 summary parser (888, CoinPoker, iPoker, PokerStars) ─
function parsePT4Summary(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const result = {}

  for (const line of lines) {
    let m
    m = line.match(/^Tournament #: (\d+)$/)
    if (m) result.tournamentId = m[1]

    m = line.match(/^Players: (\d+)$/)
    if (m) result.players = parseInt(m[1])

    m = line.match(/^Buyin: [€$]([\d,.]+)$/)
    if (m) result.buyin = parseFloat(m[1].replace(',', ''))

    m = line.match(/^Fee: [€$]([\d,.]+)$/)
    if (m) result.buyinRake = parseFloat(m[1].replace(',', ''))

    m = line.match(/^Prize Pool: [€$]([\d,.]+)$/)
    if (m) result.prizePool = parseFloat(m[1].replace(',', ''))
  }

  return result.tournamentId ? result : null
}

export function parseSummaryFile(text) {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('Winamax Poker - Tournament summary')) return parseWinamaxSummary(trimmed)
  if (trimmed.startsWith('PokerTracker 4 Tournament Summary')) return parsePT4Summary(trimmed)
  if (trimmed.startsWith('Tournament #')) return parseGGSummary(trimmed)
  return null
}

// ── Public API ────────────────────────────────────────────────────────
export function parseFile(text) {
  const trimmed = text.trimStart()

  if (trimmed.startsWith('Winamax Poker')) {
    // Winamax files are already in chronological order (oldest first)
    return trimmed
      .split(/(?=Winamax Poker)/)
      .filter(s => s.trimStart().startsWith('Winamax Poker'))
      .map(parseWinamaxHand)
      .filter(Boolean)
  }

  if (trimmed.startsWith('GAME #')) {
    return trimmed
      .split(/(?=GAME #\d+)/)
      .filter(s => s.trimStart().startsWith('GAME #'))
      .map(parseIPokerHand)
      .filter(Boolean)
  }

  if (trimmed.startsWith('***** 888')) {
    return trimmed
      .split(/(?=\*{5} 888)/)
      .filter(s => s.trimStart().startsWith('*****'))
      .map(parse888Hand)
      .filter(Boolean)
  }

  if (trimmed.startsWith('CoinPoker Hand #')) {
    return trimmed
      .split(/(?=CoinPoker Hand #)/)
      .filter(s => s.trimStart().startsWith('CoinPoker Hand #'))
      .map(parseCoinPokerHand)
      .filter(Boolean)
  }

  if (trimmed.startsWith('PokerStars Hand #')) {
    return trimmed
      .split(/(?=PokerStars Hand #)/)
      .filter(s => s.trimStart().startsWith('PokerStars Hand #'))
      .map(parsePokerStarsHand)
      .filter(Boolean)
  }

  // GGPoker files are newest-first — reverse to get chronological order
  return trimmed
    .split(/(?=Poker Hand #)/)
    .filter(s => s.trimStart().startsWith('Poker Hand #'))
    .map(parseHand)
    .filter(Boolean)
    .reverse()
}

export function groupByTournament(allHands) {
  const map = new Map()
  for (const hand of allHands) {
    const tid = hand.tournamentId || 'unknown'
    if (!map.has(tid)) {
      map.set(tid, { id: tid, name: hand.tournamentName || tid, datetime: hand.datetime, platform: hand.platform, hands: [] })
    } else if (hand.datetime && hand.datetime < map.get(tid).datetime) {
      // Always keep the earliest hand datetime as the tournament start time,
      // regardless of hand order in the file (re-exported files arrive in
      // chronological order and get reversed on re-import, which would
      // otherwise assign the last hand's date as the tournament date).
      map.get(tid).datetime = hand.datetime
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
