// Importación de historiales: separa manos y summaries, agrupa por torneo y guarda en la BD.
// Lo usan la web (Dashboard) y la Edge Function import-hand-histories (GrindSet), así que no
// depende del navegador: recibe el cliente de Supabase como parámetro y solo importa módulos
// puros (con extensión, para que también resuelvan en Deno).

import { parseFile, groupByTournament, parseSummaryFile, calcHeroNet } from './parser.js'
import { computeHandStats, computeStudyFilterColumns } from './handUtils.js'

const HAND_BATCH   = 200
const ACTION_BATCH = 1000
const STREETS      = ['preflop', 'flop', 'turn', 'river']

export function isSummaryText(text) {
  const tr = text.trimStart()
  return tr.startsWith('Winamax Poker - Tournament summary')
    || tr.startsWith('Tournament #')
    || tr.startsWith('PokerTracker 4 Tournament Summary')
}

/**
 * Importa los textos de uno o varios archivos (manos y/o summaries).
 * `extraSummaries`: datos de resumen que no vienen en un archivo (p. ej. el puesto que
 * GrindSet lee de CoinPoker), con la misma forma que devuelve parseSummaryFile.
 * Devuelve { saved, updated, summariesUpdated, platform, tournaments: [{ dbId, tournamentId, name, hands, created }] }.
 */
export async function importHandHistories(supabase, userId, texts, { extraSummaries = [], onProgress } = {}) {
  const summaryTexts = texts.filter(isSummaryText)
  const handTexts    = texts.filter(text => !isSummaryText(text))

  const result = { saved: 0, updated: 0, summariesUpdated: 0, platform: null, tournaments: [] }

  if (handTexts.length > 0) {
    const parsedPerFile = handTexts.map(text => parseFile(text))
    const entriesMap = new Map()
    for (const fileHands of parsedPerFile) {
      const tids = new Set(fileHands.map(h => h.tournamentId).filter(Boolean))
      for (const tid of tids) entriesMap.set(tid, (entriesMap.get(tid) || 0) + 1)
    }
    const allHands = parsedPerFile.flat()
    // Sala mayoritaria de las manos importadas
    const platformCounts = {}
    for (const h of allHands) if (h.platform) platformCounts[h.platform] = (platformCounts[h.platform] || 0) + 1
    result.platform = Object.keys(platformCounts).sort((a, b) => platformCounts[b] - platformCounts[a])[0] ?? null
    const grouped = groupByTournament(allHands)
    for (const tour of grouped) tour.entries = entriesMap.get(tour.id) || 1

    // Dedup en batch: una sola query para todos los torneos
    const existingIds = await fetchExistingTournamentIds(supabase, userId, grouped.map(tour => tour.id))
    const toSave    = grouped.filter(tour => !existingIds.has(tour.id))
    const toRefresh = grouped.filter(tour => existingIds.has(tour.id))
    result.saved   = toSave.length
    result.updated = toRefresh.length

    onProgress?.({ current: 0, total: grouped.length })

    // Saves en paralelo (3 a la vez); los torneos ya existentes se reescriben conservando notas y marcas
    const CONCURRENCY = 3
    const jobs = [
      ...toSave.map(tour => async () => ({ tour, dbId: (await saveTournament(supabase, tour, userId)).id, created: true })),
      ...toRefresh.map(tour => async () => ({ tour, dbId: await refreshTournamentHands(supabase, tour, userId), created: false })),
    ]
    let done = 0
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      const batch = await Promise.all(jobs.slice(i, i + CONCURRENCY).map(async job => {
        const r = await job()
        onProgress?.({ current: ++done, total: grouped.length })
        return r
      }))
      for (const { tour, dbId, created } of batch) {
        result.tournaments.push({ dbId, tournamentId: tour.id, name: tour.name, hands: tour.hands.length, created })
      }
    }
  }

  const summaries = [...summaryTexts.map(parseSummaryFile), ...extraSummaries]
  for (const summary of summaries) {
    if (summary?.tournamentId) {
      await updateTournamentSummary(supabase, summary.tournamentId, userId, summary)
      result.summariesUpdated++
    }
  }
  return result
}

export async function fetchExistingTournamentIds(supabase, userId, tournamentIds) {
  const CHUNK = 50
  const result = new Set()
  for (let i = 0; i < tournamentIds.length; i += CHUNK) {
    const { data } = await supabase
      .from('tournaments')
      .select('tournament_id')
      .eq('user_id', userId)
      .in('tournament_id', tournamentIds.slice(i, i + CHUNK))
    data?.forEach(r => result.add(r.tournament_id))
  }
  return result
}

function buildHandRow(h, tournamentDbId) {
  return {
    tournament_id: tournamentDbId,
    hand_id:       h.id,
    hero_result:   h.heroResult,
    net:           calcHeroNet(h),
    bb:            h.bb,
    sb:            h.sb,
    total_pot:     h.totalPot,
    board:         h.board,
    hole_cards:    h.holeCards,
    sequence:      { sequence: h.sequence, streetStartStep: h.streetStartStep },
    hand_datetime: h.datetime ? h.datetime.replace(/\//g, '-') : null,
    raw:           h,
    ...computeHandStats(h),
    ...computeStudyFilterColumns(h),
  }
}

function lastHandDatetime(hands) {
  return hands.map(h => h.datetime).filter(Boolean).sort().pop() || null
}

// Inserta manos nuevas de un torneo con sus acciones
async function insertHands(supabase, hands, tournamentDbId) {
  const insertedHands = []
  const rows = hands.map(h => buildHandRow(h, tournamentDbId))
  for (let i = 0; i < rows.length; i += HAND_BATCH) {
    const { data, error } = await supabase
      .from('hands')
      .insert(rows.slice(i, i + HAND_BATCH))
      .select('id, hand_id')
    if (error) throw error
    insertedHands.push(...data)
  }

  // Mapear hand_id → db id para construir acciones
  const handIdMap = new Map(insertedHands.map(h => [h.hand_id, h.id]))
  const actionsToInsert = []
  for (const hand of hands) {
    const dbHandId = handIdMap.get(hand.id)
    if (!dbHandId) continue
    for (const street of STREETS) {
      for (const act of (hand.actions[street] || [])) {
        actionsToInsert.push({
          hand_id: dbHandId,
          street,
          player:  act.player,
          type:    act.type,
          amount:  act.amount,
          is_hero: act.player === 'Hero',
        })
      }
    }
  }
  for (let i = 0; i < actionsToInsert.length; i += ACTION_BATCH) {
    const { error } = await supabase
      .from('actions')
      .insert(actionsToInsert.slice(i, i + ACTION_BATCH))
    if (error) throw error
  }
}

// Re-import of an existing tournament: rewrite its hands in place (same DB ids) so notes,
// review marks and share tokens survive, and add the hands that weren't imported yet (a
// later re-entry, or an import made before the tournament ended). Returns the tournament DB id.
export async function refreshTournamentHands(supabase, tournament, userId) {
  const { data: tourRows, error: tourErr } = await supabase
    .from('tournaments')
    .select('id, end_time')
    .eq('user_id', userId)
    .eq('tournament_id', tournament.id)
    .limit(1)
  if (tourErr) throw tourErr
  const tourRow = tourRows?.[0]
  if (!tourRow) return null

  const PAGE = 1000
  const dbIdByHandId = new Map()
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('hands')
      .select('id, hand_id')
      .eq('tournament_id', tourRow.id)
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw error
    data.forEach(r => dbIdByHandId.set(r.hand_id, r.id))
    if (data.length < PAGE) break
  }

  const rows = tournament.hands
    .filter(h => dbIdByHandId.has(h.id))
    .map(h => ({ id: dbIdByHandId.get(h.id), ...buildHandRow(h, tourRow.id) }))
  for (let i = 0; i < rows.length; i += HAND_BATCH) {
    const { error } = await supabase
      .from('hands')
      .upsert(rows.slice(i, i + HAND_BATCH), { onConflict: 'id' })
    if (error) throw error
  }

  const newHands = tournament.hands.filter(h => !dbIdByHandId.has(h.id))
  if (newHands.length > 0) {
    await insertHands(supabase, newHands, tourRow.id)
    const lastNew = lastHandDatetime(newHands)
    const { error } = await supabase
      .from('tournaments')
      .update({
        hands_count: dbIdByHandId.size + newHands.length,
        end_time:    [tourRow.end_time, lastNew].filter(Boolean).sort().pop() || null,
      })
      .eq('id', tourRow.id)
    if (error) throw error
  }
  return tourRow.id
}

export async function saveTournament(supabase, tournament, userId) {
  // Insertar torneo
  const { data: tourRow, error: tourErr } = await supabase
    .from('tournaments')
    .insert({
      user_id:       userId,
      tournament_id: tournament.id,
      name:          tournament.name,
      date:          tournament.datetime,
      end_time:      lastHandDatetime(tournament.hands),
      hands_count:   tournament.hands.length,
      platform:      tournament.platform || null,
      entries:       tournament.entries || 1,
    })
    .select('id')
    .single()

  if (tourErr) throw tourErr
  await insertHands(supabase, tournament.hands, tourRow.id)
  return { id: tourRow.id }
}

export async function updateTournamentSummary(supabase, tournamentId, userId, data) {
  const { error } = await supabase
    .from('tournaments')
    .update({
      buyin:           data.buyin           ?? null,
      buyin_rake:      data.buyinRake        ?? null,
      players:         data.players          ?? null,
      prize_pool:      data.prizePool        ?? null,
      finish_position: data.finishPosition   ?? null,
      prize_won:       data.prizeWon         ?? null,
      bounty_won:      data.bountyWon        ?? null,
      duration:        data.duration         ?? null,
    })
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
  if (error) throw error
}
