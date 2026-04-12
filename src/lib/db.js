import { supabase } from './supabase'
import { calcHeroNet } from './parser'

export async function saveTournament(tournament, userId) {
  // Evitar duplicados: comprobar si ya existe este torneo para este usuario
  const { data: existing } = await supabase
    .from('tournaments')
    .select('id')
    .eq('user_id', userId)
    .eq('tournament_id', tournament.id)
    .single()

  if (existing) return { id: existing.id, skipped: true }

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

  // Insertar manos y acciones en lotes
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

  const { data: insertedHands, error: handsErr } = await supabase
    .from('hands')
    .insert(handsToInsert)
    .select('id, hand_id')

  if (handsErr) throw handsErr

  // Insertar acciones (para filtros futuros)
  const actionsToInsert = []
  const streets = ['preflop', 'flop', 'turn', 'river']

  tournament.hands.forEach((hand, i) => {
    const dbHandId = insertedHands[i]?.id
    if (!dbHandId) return

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
  })

  if (actionsToInsert.length > 0) {
    const { error: actErr } = await supabase.from('actions').insert(actionsToInsert)
    if (actErr) throw actErr
  }

  return { id: tourRow.id, skipped: false }
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
  const TOUR_BATCH = 20
  const HAND_BATCH = 300

  const { data: tours, error: toursErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('user_id', userId)

  if (toursErr) throw toursErr
  if (!tours?.length) return

  // Process in batches to avoid Supabase URL length limits
  for (let i = 0; i < tours.length; i += TOUR_BATCH) {
    const tourIds = tours.slice(i, i + TOUR_BATCH).map(t => t.id)

    const { data: hands } = await supabase
      .from('hands')
      .select('id')
      .in('tournament_id', tourIds)

    if (hands?.length) {
      const handIds = hands.map(h => h.id)
      for (let j = 0; j < handIds.length; j += HAND_BATCH) {
        const { error: actErr } = await supabase
          .from('actions')
          .delete()
          .in('hand_id', handIds.slice(j, j + HAND_BATCH))
        if (actErr) throw actErr
      }
    }

    const { error: handsErr } = await supabase.from('hands').delete().in('tournament_id', tourIds)
    if (handsErr) throw handsErr

    const { error: tourErr } = await supabase.from('tournaments').delete().in('id', tourIds)
    if (tourErr) throw tourErr
  }
}

export async function deleteTournament(tournamentDbId) {
  // Borrar acciones → manos → torneo (en orden por FK)
  const { data: hands } = await supabase
    .from('hands')
    .select('id')
    .eq('tournament_id', tournamentDbId)

  if (hands?.length) {
    const handIds = hands.map(h => h.id)
    const { error: actErr } = await supabase.from('actions').delete().in('hand_id', handIds)
    if (actErr) throw actErr
  }

  const { error: handsErr } = await supabase.from('hands').delete().eq('tournament_id', tournamentDbId)
  if (handsErr) throw handsErr

  const { error: tourErr } = await supabase.from('tournaments').delete().eq('id', tournamentDbId)
  if (tourErr) throw tourErr
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

export async function fetchHands(tournamentDbId) {
  const { data, error } = await supabase
    .from('hands')
    .select('id, hand_id, hero_result, net, bb, sb, total_pot, board, hole_cards, sequence, raw')
    .eq('tournament_id', tournamentDbId)
    .order('id', { ascending: true })

  if (error) throw error
  return data
}
