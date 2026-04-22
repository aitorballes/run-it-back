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

export async function fetchTournamentsInRange(userId, fromDate, toDate) {
  // fromDate/toDate are "YYYY-MM-DD"; DB stores "YYYY/MM/DD HH:MM:SS"
  const from = fromDate.replace(/-/g, '/')
  const to   = toDate.replace(/-/g, '/') + ' 99:99:99'

  const { data, error } = await supabase
    .from('tournaments')
    .select('id, tournament_id, name, date, end_time, hands_count, platform, buyin, buyin_rake, players, prize_pool, finish_position, prize_won, duration, created_at')
    .eq('user_id', userId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })

  if (error) throw error
  return data
}

export async function fetchHandsBatch(tournamentDbIds) {
  if (!tournamentDbIds.length) return new Map()
  const CHUNK = 20
  const result = new Map()

  for (let i = 0; i < tournamentDbIds.length; i += CHUNK) {
    const chunk = tournamentDbIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('hands')
      .select('id, hand_id, raw, tournament_id')
      .in('tournament_id', chunk)
      .order('id', { ascending: true })
    if (error) throw error
    if (data) {
      for (const hand of data) {
        if (!result.has(hand.tournament_id)) result.set(hand.tournament_id, [])
        result.get(hand.tournament_id).push(hand)
      }
    }
  }

  return result
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

export async function fetchHandNotes(handDbIds, userId) {
  if (!handDbIds.length || !userId) return {}
  const CHUNK = 100
  const map = {}
  for (let i = 0; i < handDbIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('hand_notes')
      .select('hand_id, note')
      .eq('user_id', userId)
      .in('hand_id', handDbIds.slice(i, i + CHUNK))
    if (error) throw error
    for (const row of (data ?? [])) map[row.hand_id] = row.note
  }
  return map
}

export async function saveHandNote(handDbId, userId, note) {
  const { error } = await supabase
    .from('hand_notes')
    .upsert(
      { hand_id: handDbId, user_id: userId, note, updated_at: new Date().toISOString() },
      { onConflict: 'hand_id,user_id' }
    )
  if (error) throw error
}

export async function fetchHandsByIds(handIds) {
  if (!handIds.length) return []
  const CHUNK = 100
  const results = []
  for (let i = 0; i < handIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('hands')
      .select('id, raw, tournament_id, tournaments(name)')
      .in('id', handIds.slice(i, i + CHUNK))
    if (error) throw error
    if (data) results.push(...data.map(h => ({ ...h, tournamentName: h.tournaments?.name })))
  }
  return results
}

export async function fetchReviewMarks(handDbIds, userId) {
  if (!handDbIds.length || !userId) return new Set()
  const CHUNK = 100
  const set = new Set()
  for (let i = 0; i < handDbIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('hand_reviews')
      .select('hand_id')
      .eq('user_id', userId)
      .in('hand_id', handDbIds.slice(i, i + CHUNK))
    if (error) throw error
    for (const row of (data ?? [])) set.add(row.hand_id)
  }
  return set
}

export async function fetchUserReviewMarks(userId) {
  if (!userId) return new Set()
  const { data, error } = await supabase
    .from('hand_reviews')
    .select('hand_id')
    .eq('user_id', userId)
  if (error) throw error
  return new Set((data ?? []).map(r => r.hand_id))
}

export async function createSharedList(handIds, userId) {
  const { data, error } = await supabase
    .from('shared_lists')
    .insert({ hand_ids: handIds, user_id: userId })
    .select('token')
    .single()
  if (error) throw error
  return data.token
}

export async function fetchSharedList(token) {
  const { data, error } = await supabase
    .from('shared_lists')
    .select('hand_ids')
    .eq('token', token)
    .single()
  if (error) throw error
  return data.hand_ids
}

export async function setReviewMark(handDbId, userId, marked) {
  if (marked) {
    const { error } = await supabase
      .from('hand_reviews')
      .insert({ hand_id: handDbId, user_id: userId })
    if (error && error.code !== '23505') throw error  // 23505 = ya existe, correcto
  } else {
    const { error } = await supabase
      .from('hand_reviews')
      .delete()
      .eq('hand_id', handDbId)
      .eq('user_id', userId)
    if (error) throw error
  }
}
