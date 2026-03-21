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

  // Insertar torneo
  const { data: tourRow, error: tourErr } = await supabase
    .from('tournaments')
    .insert({
      user_id:       userId,
      tournament_id: tournament.id,
      name:          tournament.name,
      date:          tournament.datetime,
      hands_count:   tournament.hands.length,
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
    .select('id, tournament_id, name, date, hands_count, created_at')
    .eq('user_id', userId)
    .order('date', { ascending: false })

  if (error) throw error
  return data
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
