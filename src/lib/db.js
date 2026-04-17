import { supabase } from './supabase'
import { calcHeroNet } from './parser'

const HAND_BATCH   = 200
const ACTION_BATCH = 1000

export async function fetchExistingTournamentIds(userId, tournamentIds) {
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

export async function saveTournament(tournament, userId) {
  // Hora de la última mano del torneo
  const lastHandDatetime = tournament.hands
    .map(h => h.datetime).filter(Boolean).sort().pop() || null

  // Insertar torneo
  const { data: tourRow, error: tourErr } = await supabase
    .from('tournaments')
    .insert({
      user_id:       userId,
      tournament_id: tournament.id,
      name:          tournament.name,
      date:          tournament.datetime,
      end_time:      lastHandDatetime,
      hands_count:   tournament.hands.length,
      platform:      tournament.platform || null,
    })
    .select('id')
    .single()

  if (tourErr) throw tourErr

  // Insertar manos en lotes
  const handsToInsert = tournament.hands.map(h => ({
    tournament_id: tourRow.id,
    hand_id:       h.id,
    hero_result:   h.heroResult,
    net:           calcHeroNet(h),
    bb:            h.bb,
    sb:            h.sb,
    total_pot:     h.totalPot,
    board:         h.board,
    hole_cards:    h.holeCards,
    sequence:      { sequence: h.sequence, streetStartStep: h.streetStartStep },
    raw:           h,
  }))

  const insertedHands = []
  for (let i = 0; i < handsToInsert.length; i += HAND_BATCH) {
    const { data, error } = await supabase
      .from('hands')
      .insert(handsToInsert.slice(i, i + HAND_BATCH))
      .select('id, hand_id')
    if (error) throw error
    insertedHands.push(...data)
  }

  // Mapear hand_id → db id para construir acciones
  const handIdMap = new Map(insertedHands.map(h => [h.hand_id, h.id]))
  const streets = ['preflop', 'flop', 'turn', 'river']
  const actionsToInsert = []

  for (const hand of tournament.hands) {
    const dbHandId = handIdMap.get(hand.id)
    if (!dbHandId) continue
    for (const street of streets) {
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

  // Insertar acciones en lotes
  for (let i = 0; i < actionsToInsert.length; i += ACTION_BATCH) {
    const { error } = await supabase
      .from('actions')
      .insert(actionsToInsert.slice(i, i + ACTION_BATCH))
    if (error) throw error
  }

  return { id: tourRow.id }
}

export async function fetchTournaments(userId) {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, tournament_id, name, date, end_time, hands_count, platform, buyin, buyin_rake, players, prize_pool, finish_position, prize_won, duration, created_at')
    .eq('user_id', userId)
    .order('date', { ascending: false })

  if (error) throw error
  return data
}

export async function deleteAllTournaments(userId) {
  const HAND_BATCH = 200
  const TOUR_BATCH = 20

  const { data: tours, error: toursErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('user_id', userId)

  if (toursErr) throw toursErr
  if (!tours?.length) return

  // Delete hands in batches per group of tournaments (CASCADE handles actions)
  const tourIds = tours.map(t => t.id)
  for (let i = 0; i < tourIds.length; i += TOUR_BATCH) {
    const batch = tourIds.slice(i, i + TOUR_BATCH)
    while (true) {
      const { data: hands } = await supabase
        .from('hands')
        .select('id')
        .in('tournament_id', batch)
        .limit(HAND_BATCH)
      if (!hands?.length) break
      const { error } = await supabase.from('hands').delete().in('id', hands.map(h => h.id))
      if (error) throw error
    }
  }

  const { error } = await supabase.from('tournaments').delete().eq('user_id', userId)
  if (error) throw error
}

export async function deleteTournament(tournamentDbId) {
  const HAND_BATCH = 200

  // Delete hands in batches (CASCADE handles actions automatically)
  while (true) {
    const { data: hands } = await supabase
      .from('hands')
      .select('id')
      .eq('tournament_id', tournamentDbId)
      .limit(HAND_BATCH)
    if (!hands?.length) break
    const { error } = await supabase.from('hands').delete().in('id', hands.map(h => h.id))
    if (error) throw error
  }

  const { error } = await supabase.from('tournaments').delete().eq('id', tournamentDbId)
  if (error) throw error
}

export async function updateTournamentSummary(tournamentId, userId, data) {
  const { error } = await supabase
    .from('tournaments')
    .update({
      buyin:           data.buyin           ?? null,
      buyin_rake:      data.buyinRake        ?? null,
      players:         data.players          ?? null,
      prize_pool:      data.prizePool        ?? null,
      finish_position: data.finishPosition   ?? null,
      prize_won:       data.prizeWon         ?? null,
      duration:        data.duration         ?? null,
    })
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
  if (error) throw error
}

export async function generateShareToken(tournamentDbId) {
  const { data: existing } = await supabase
    .from('tournaments')
    .select('share_token')
    .eq('id', tournamentDbId)
    .single()

  if (existing?.share_token) return existing.share_token

  const token = crypto.randomUUID()
  const { data, error } = await supabase
    .from('tournaments')
    .update({ share_token: token })
    .eq('id', tournamentDbId)
    .select('share_token')
    .single()

  if (error) throw error
  return data.share_token
}

export async function generateHandShareToken(handDbId) {
  const { data: existing } = await supabase
    .from('hands').select('share_token').eq('id', handDbId).single()
  if (existing?.share_token) return existing.share_token
  const token = crypto.randomUUID()
  const { data, error } = await supabase
    .from('hands').update({ share_token: token }).eq('id', handDbId)
    .select('share_token').single()
  if (error) throw error
  return data.share_token
}

export async function fetchHandByShareToken(handToken) {
  const { data, error } = await supabase
    .from('hands').select('id, raw, tournament_id').eq('share_token', handToken).single()
  if (error) throw error
  return data
}

export async function fetchAllUserHands(userId) {
  const { data: tours } = await supabase
    .from('tournaments').select('id, name').eq('user_id', userId)
  if (!tours?.length) return []
  const tourMap = new Map(tours.map(t => [t.id, t.name]))
  const tourIds = tours.map(t => t.id)
  const CHUNK = 20
  const results = []
  for (let i = 0; i < tourIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('hands').select('id, raw, tournament_id')
      .in('tournament_id', tourIds.slice(i, i + CHUNK))
    if (error) throw error
    if (data) results.push(...data.map(h => ({ ...h, tournamentName: tourMap.get(h.tournament_id) })))
  }
  return results
}

export async function fetchHands(tournamentDbId) {
  const { data, error } = await supabase
    .from('hands')
    .select('id, hand_id, hero_result, net, bb, sb, total_pot, board, hole_cards, sequence, raw')
    .eq('tournament_id', tournamentDbId)
    .order('id', { ascending: true })

  if (error) throw error
  return data
}
