// One-off backfill for hands imported before the study-filter columns existed.
// Computes them from each hand's already-stored raw JSON (no re-import needed).
//
// Run scripts/migrate-study-filters.sql in the Supabase SQL editor FIRST, then:
//   node scripts/backfill-study-columns.mjs
// Prompts for your RunItBack email/password (same login as the app).

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const POS_LABELS = {
  2: ['BTN','BB'], 3: ['BTN','SB','BB'], 4: ['BTN','SB','BB','CO'],
  5: ['BTN','SB','BB','HJ','CO'], 6: ['BTN','SB','BB','LJ','HJ','CO'],
  7: ['BTN','SB','BB','UTG','LJ','HJ','CO'],
  8: ['BTN','SB','BB','UTG','UTG+1','LJ','HJ','CO'],
  9: ['BTN','SB','BB','UTG','UTG+1','MP','LJ','HJ','CO'],
  10:['BTN','SB','BB','UTG','UTG+1','MP','MP+1','LJ','HJ','CO'],
}

function getPositionLabel(seatNum, seats, buttonSeatNum) {
  const sorted = [...seats].sort((a, b) => a.num - b.num)
  const n = sorted.length
  const btnIdx = sorted.findIndex(s => s.num === buttonSeatNum)
  if (btnIdx < 0) return ''
  const seatIdx = sorted.findIndex(s => s.num === seatNum)
  if (seatIdx < 0) return ''
  const offset = (seatIdx - btnIdx + n) % n
  return (POS_LABELS[n] ?? [])[offset] ?? ''
}

function preflopIsClean(hand) {
  const actions = hand.actions?.preflop ?? []
  for (const a of actions) {
    if (a.player === 'Hero') break
    if (a.type === 'call' || a.type === 'raise') return false
  }
  return true
}

function preflopIsLimped(hand) {
  const actions = hand.actions?.preflop ?? []
  let hasLimp = false
  for (const a of actions) {
    if (a.player === 'Hero') break
    if (a.type === 'raise') return false
    if (a.type === 'call') hasLimp = true
  }
  return hasLimp
}

function preflopRaiseCount(hand) {
  return (hand.actions?.preflop ?? []).filter(a => a.type === 'raise').length
}

function playersWhoSawFlop(hand) {
  const folded = new Set((hand.actions?.preflop ?? []).filter(a => a.type === 'fold').map(a => a.player))
  return (hand.seats ?? []).filter(s => !folded.has(s.player)).length
}

function postflopRank(seatNum, seats, buttonSeatNum) {
  const sorted = [...seats].sort((a, b) => a.num - b.num)
  const n = sorted.length
  const btnIdx = sorted.findIndex(s => s.num === buttonSeatNum)
  const seatIdx = sorted.findIndex(s => s.num === seatNum)
  if (btnIdx < 0 || seatIdx < 0) return null
  const offset = (seatIdx - btnIdx + n) % n
  return (offset - 1 + n) % n
}

function heroPositionVsField(hand) {
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

function bbFoldedPreflop(hand) {
  const seats = hand.seats ?? []
  const bbSeat = seats.find(s => getPositionLabel(s.num, seats, hand.buttonSeat) === 'BB')
  if (!bbSeat || bbSeat.player === 'Hero') return false
  return (hand.actions?.preflop ?? []).some(a => a.player === bbSeat.player && a.type === 'fold')
}

function heroBBStack(hand) {
  const heroSeat = hand.seats?.find(s => s.player === 'Hero')
  if (!heroSeat || !hand.bb) return null
  return heroSeat.chips / hand.bb
}

function heroFoldedPreflop(hand) {
  return (hand.actions?.preflop ?? []).some(a => a.player === 'Hero' && a.type === 'fold')
}

function computeStudyFilterColumns(hand) {
  const heroSeat = hand.seats?.find(s => s.player === 'Hero')
  return {
    // hero_pos already existed but was only ever set correctly for BTN/SB/BB — recompute it
    // here too so hands at any other position (UTG, MP, CO...) become filterable/indexable.
    hero_pos:            heroSeat ? (getPositionLabel(heroSeat.num, hand.seats, hand.buttonSeat) || null) : null,
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

async function main() {
  const env = loadEnvLocal()
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const email = await rl.question('Email: ')
  const password = await rl.question('Password: ')
  rl.close()

  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password })
  if (authErr) throw authErr
  const userId = authData.user.id
  console.log(`Autenticado como ${email}`)

  const { data: tours, error: toursErr } = await supabase
    .from('tournaments').select('id').eq('user_id', userId)
  if (toursErr) throw toursErr
  if (!tours?.length) { console.log('No hay torneos.'); return }

  const tourIds = tours.map(t => t.id)
  const CHUNK = 20
  const PAGE = 200
  let scanned = 0
  let fixed = 0

  for (let i = 0; i < tourIds.length; i += CHUNK) {
    const chunk = tourIds.slice(i, i + CHUNK)
    let page = 0
    while (true) {
      const { data: hands, error } = await supabase
        .from('hands').select('id, tournament_id, hero_pos, preflop_raise_count, raw')
        .in('tournament_id', chunk)
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (error) throw error
      if (!hands?.length) break

      const updates = []
      for (const h of hands) {
        scanned++
        const cols = computeStudyFilterColumns(h.raw)
        if (h.preflop_raise_count == null || cols.hero_pos !== h.hero_pos) {
          updates.push({ id: h.id, tournament_id: h.tournament_id, ...cols })
        }
      }

      if (updates.length) {
        const { error: upsertErr } = await supabase.from('hands').upsert(updates, { onConflict: 'id' })
        if (upsertErr) throw upsertErr
        fixed += updates.length
      }

      console.log(`Revisadas ${scanned} manos · actualizadas ${fixed}`)
      if (hands.length < PAGE) break
      page++
    }
  }

  console.log(`\nListo. ${fixed} de ${scanned} manos se han actualizado.`)
}

main().catch(e => { console.error(e); process.exit(1) })
