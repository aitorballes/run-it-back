// One-off backfill for hands imported before the hand_datetime column existed.
// Populates hand_datetime from each hand's already-stored raw.datetime (no re-import needed).
//
// Run scripts/migrate-hand-datetime.sql in the Supabase SQL editor FIRST, then:
//   node scripts/backfill-hand-datetime.mjs
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
        .from('hands').select('id, tournament_id, hand_datetime, raw')
        .in('tournament_id', chunk)
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (error) throw error
      if (!hands?.length) break

      const updates = []
      for (const h of hands) {
        scanned++
        const correct = h.raw?.datetime ? h.raw.datetime.replace(/\//g, '-') : null
        if (correct && correct !== h.hand_datetime) {
          updates.push({ id: h.id, tournament_id: h.tournament_id, hand_datetime: correct })
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

  console.log(`\nListo. ${fixed} de ${scanned} manos tenían hand_datetime sin rellenar y se han actualizado.`)
}

main().catch(e => { console.error(e); process.exit(1) })
