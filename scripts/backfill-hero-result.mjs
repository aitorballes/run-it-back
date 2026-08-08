// One-off repair for hands imported before the GGPoker no-showdown-win parser fix.
// Recomputes heroResult from each hand's already-stored winners/actions (no re-import needed)
// and updates any hand whose stored result was wrong.
//
// Usage: node scripts/backfill-hero-result.mjs
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

function calcHeroNet(raw) {
  const heroSeat = raw.seats?.find(s => s.player === 'Hero')
  if (!heroSeat) return 0
  let invested = raw.ante || 0
  if (heroSeat.pos === 'SB') invested += raw.sb
  if (heroSeat.pos === 'BB') invested += raw.bb
  const allActs = [
    ...(raw.actions?.preflop ?? []),
    ...(raw.actions?.flop ?? []),
    ...(raw.actions?.turn ?? []),
    ...(raw.actions?.river ?? []),
  ]
  for (const a of allActs) {
    if (a.player !== 'Hero') continue
    if (['call', 'raise', 'bet'].includes(a.type)) invested += a.amount
    if (a.type === 'uncalled') invested -= a.amount
  }
  const won = (raw.winners ?? []).filter(w => w.player === 'Hero').reduce((s, w) => s + w.amount, 0)
  return won - invested
}

function computeHeroResult(raw) {
  const allActs = [
    ...(raw.actions?.preflop ?? []),
    ...(raw.actions?.flop ?? []),
    ...(raw.actions?.turn ?? []),
    ...(raw.actions?.river ?? []),
  ]
  if (allActs.some(a => a.player === 'Hero' && a.type === 'fold')) return 'folded'
  return calcHeroNet(raw) > 0 ? 'won' : 'lost'
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
        .from('hands').select('id, tournament_id, hero_result, net, raw')
        .in('tournament_id', chunk)
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (error) throw error
      if (!hands?.length) break

      const updates = []
      for (const h of hands) {
        scanned++
        const correctNet = calcHeroNet(h.raw)
        const correctResult = computeHeroResult(h.raw)
        if (correctResult !== h.raw?.heroResult || correctResult !== h.hero_result || correctNet !== h.net) {
          updates.push({
            id: h.id,
            tournament_id: h.tournament_id,
            hero_result: correctResult,
            net: correctNet,
            raw: { ...h.raw, heroResult: correctResult },
          })
        }
      }

      if (updates.length) {
        const { error: upsertErr } = await supabase.from('hands').upsert(updates, { onConflict: 'id' })
        if (upsertErr) throw upsertErr
        fixed += updates.length
      }

      console.log(`Revisadas ${scanned} manos · corregidas ${fixed}`)
      if (hands.length < PAGE) break
      page++
    }
  }

  console.log(`\nListo. ${fixed} de ${scanned} manos tenían el resultado mal y se han corregido.`)
}

main().catch(e => { console.error(e); process.exit(1) })
