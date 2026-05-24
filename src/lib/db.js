import { supabase } from './supabase'
import { calcHeroNet } from './parser'
import { computeHandStats } from './handUtils'

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
      entries:       tournament.entries || 1,
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
    ...computeHandStats(h),
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
    .select('id, tournament_id, name, date, end_time, hands_count, platform, buyin, buyin_rake, players, prize_pool, finish_position, prize_won, duration, created_at, entries')
    .eq('user_id', userId)
    .order('date', { ascending: false })

  if (error) throw error
  return data
}

export async function deleteAllTournaments(userId) {
  const HAND_BATCH = 200
  const TOUR_BATCH = 20
  const DEP_CHUNK  = 200

  const { data: tours, error: toursErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('user_id', userId)

  if (toursErr) throw toursErr
  if (!tours?.length) return

  const tourIds = tours.map(t => t.id)
  for (let i = 0; i < tourIds.length; i += TOUR_BATCH) {
    const batch = tourIds.slice(i, i + TOUR_BATCH)

    // Collect all hand IDs for this batch of tournaments
    const allHandIds = []
    let offset = 0
    while (true) {
      const { data: hands, error } = await supabase
        .from('hands').select('id').in('tournament_id', batch)
        .range(offset, offset + HAND_BATCH - 1)
      if (error) throw error
      if (!hands?.length) break
      allHandIds.push(...hands.map(h => h.id))
      if (hands.length < HAND_BATCH) break
      offset += HAND_BATCH
    }

    // Delete FK-dependent records before deleting hands
    for (let j = 0; j < allHandIds.length; j += DEP_CHUNK) {
      const chunk = allHandIds.slice(j, j + DEP_CHUNK)
      const [r1, r2, r3] = await Promise.all([
        supabase.from('hand_reviews').delete().in('hand_id', chunk),
        supabase.from('hand_notes').delete().in('hand_id', chunk),
        supabase.from('review_list_hands').delete().in('hand_id', chunk),
      ])
      if (r1.error) throw r1.error
      if (r2.error) throw r2.error
      if (r3.error) throw r3.error
    }

    // Delete hands in batches (CASCADE handles actions automatically)
    for (let j = 0; j < allHandIds.length; j += HAND_BATCH) {
      const { error } = await supabase.from('hands').delete().in('id', allHandIds.slice(j, j + HAND_BATCH))
      if (error) throw error
    }
  }

  const { error } = await supabase.from('tournaments').delete().eq('user_id', userId)
  if (error) throw error
}

export async function deleteTournament(tournamentDbId, userId) {
  const HAND_BATCH = 200
  const DEP_CHUNK  = 200

  // Collect all hand IDs for this tournament first
  const allHandIds = []
  while (true) {
    const { data: hands, error } = await supabase
      .from('hands')
      .select('id')
      .eq('tournament_id', tournamentDbId)
      .range(allHandIds.length, allHandIds.length + HAND_BATCH - 1)
    if (error) throw error
    if (!hands?.length) break
    allHandIds.push(...hands.map(h => h.id))
    if (hands.length < HAND_BATCH) break
  }

  // Delete FK-dependent records before deleting hands
  for (let i = 0; i < allHandIds.length; i += DEP_CHUNK) {
    const chunk = allHandIds.slice(i, i + DEP_CHUNK)
    const [r1, r2, r3] = await Promise.all([
      supabase.from('hand_reviews').delete().in('hand_id', chunk),
      supabase.from('hand_notes').delete().in('hand_id', chunk),
      supabase.from('review_list_hands').delete().in('hand_id', chunk),
    ])
    if (r1.error) throw r1.error
    if (r2.error) throw r2.error
    if (r3.error) throw r3.error
  }

  // Delete hands in batches (CASCADE handles actions automatically)
  for (let i = 0; i < allHandIds.length; i += HAND_BATCH) {
    const { error } = await supabase.from('hands').delete().in('id', allHandIds.slice(i, i + HAND_BATCH))
    if (error) throw error
  }

  let q = supabase.from('tournaments').delete().eq('id', tournamentDbId)
  if (userId) q = q.eq('user_id', userId)
  const { error } = await q
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
    .select('id, tournament_id, name, date, end_time, hands_count, platform, buyin, buyin_rake, players, prize_pool, finish_position, prize_won, duration, created_at, entries')
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
  const PAGE_SIZE = 1000
  const result = new Map()

  for (let i = 0; i < tournamentDbIds.length; i += CHUNK) {
    const chunk = tournamentDbIds.slice(i, i + CHUNK)
    let page = 0
    while (true) {
      const { data, error } = await supabase
        .from('hands')
        .select('id, hand_id, raw, tournament_id')
        .in('tournament_id', chunk)
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      for (const hand of data) {
        if (!result.has(hand.tournament_id)) result.set(hand.tournament_id, [])
        result.get(hand.tournament_id).push(hand)
      }
      if (data.length < PAGE_SIZE) break
      page++
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

// ── Review Lists ──────────────────────────────────────────────────────

export async function fetchUserReviewLists(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('review_lists_with_counts')
    .select('id, name, hand_count, last_hand_added_at, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createReviewList(userId, name, handId = null) {
  const { data: list, error } = await supabase
    .from('review_lists').insert({ user_id: userId, name })
    .select('id, name, created_at, updated_at').single()
  if (error) throw error
  if (handId) {
    await supabase.from('review_list_hands').insert({ list_id: list.id, hand_id: handId })
    await supabase.from('review_lists').update({ updated_at: new Date().toISOString() }).eq('id', list.id)
  }
  return list
}

export async function renameReviewList(listId, name, userId) {
  let q = supabase.from('review_lists')
    .update({ name, updated_at: new Date().toISOString() }).eq('id', listId)
  if (userId) q = q.eq('user_id', userId)
  const { error } = await q
  if (error) throw error
}

export async function deleteReviewList(listId, userId) {
  let q = supabase.from('review_lists').delete().eq('id', listId)
  if (userId) q = q.eq('user_id', userId)
  const { error } = await q
  if (error) throw error
}

export async function fetchListsForHand(handId, userId) {
  if (!handId || !userId) return new Set()
  const { data, error } = await supabase
    .from('review_list_hands')
    .select('list_id, review_lists!inner(user_id)')
    .eq('hand_id', handId).eq('review_lists.user_id', userId)
  if (error) throw error
  return new Set((data ?? []).map(r => r.list_id))
}

export async function addHandToList(listId, handId) {
  const { error } = await supabase.from('review_list_hands').insert({ list_id: listId, hand_id: handId })
  if (error && error.code !== '23505') throw error
  await supabase.from('review_lists').update({ updated_at: new Date().toISOString() }).eq('id', listId)
}

export async function removeHandFromList(listId, handId) {
  const { error } = await supabase.from('review_list_hands').delete()
    .eq('list_id', listId).eq('hand_id', handId)
  if (error) throw error
  await supabase.from('review_lists').update({ updated_at: new Date().toISOString() }).eq('id', listId)
}

export async function fetchMarkedHandIds(handDbIds, userId) {
  if (!handDbIds.length || !userId) return new Set()
  const CHUNK = 100
  const set = new Set()
  for (let i = 0; i < handDbIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('review_list_hands')
      .select('hand_id, review_lists!inner(user_id)')
      .eq('review_lists.user_id', userId)
      .in('hand_id', handDbIds.slice(i, i + CHUNK))
    if (error) throw error
    for (const row of (data ?? [])) set.add(row.hand_id)
  }
  return set
}

export async function fetchAllUserListHandIds(userId) {
  if (!userId) return new Set()
  const { data, error } = await supabase
    .from('review_list_hands')
    .select('hand_id, review_lists!inner(user_id)')
    .eq('review_lists.user_id', userId)
  if (error) throw error
  return new Set((data ?? []).map(r => r.hand_id))
}

export async function fetchHandsInList(listId) {
  const { data: links, error: linksErr } = await supabase
    .from('review_list_hands').select('hand_id, added_at')
    .eq('list_id', listId).order('added_at', { ascending: true })
  if (linksErr) throw linksErr
  if (!links?.length) return []
  const handIds = links.map(l => l.hand_id)
  const CHUNK = 100
  const results = []
  for (let i = 0; i < handIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('hands').select('id, raw, tournament_id, tournaments(name)').in('id', handIds.slice(i, i + CHUNK))
    if (error) throw error
    if (data) results.push(...data.map(h => ({ ...h, tournamentName: h.tournaments?.name })))
  }
  return results
}

export async function migrateHandStats(userId, onProgress) {
  const { data: tours, error: tourErr } = await supabase
    .from('tournaments').select('id').eq('user_id', userId)
  if (tourErr) throw tourErr

  const tourIds = tours.map(t => t.id)
  const CHUNK = 20
  const PAGE  = 200
  let processed = 0

  let total = 0
  for (let i = 0; i < tourIds.length; i += CHUNK) {
    const { count } = await supabase
      .from('hands').select('id', { count: 'exact', head: true })
      .in('tournament_id', tourIds.slice(i, i + CHUNK))
    total += count ?? 0
  }

  const agg = { total: 0, vpip: 0, pfr: 0, three_bet: 0, fold_vs_3bet_num: 0, fold_vs_3bet_den: 0,
                saw_flop: 0, wwsf_num: 0, went_to_sd: 0, won_sd: 0 }

  for (let i = 0; i < tourIds.length; i += CHUNK) {
    const chunk = tourIds.slice(i, i + CHUNK)
    let page = 0
    while (true) {
      const { data: hands, error } = await supabase
        .from('hands').select('id, tournament_id, raw')
        .in('tournament_id', chunk)
        .range(page * PAGE, (page + 1) * PAGE - 1)
      if (error) throw error
      if (!hands?.length) break

      const updates = hands.map(h => {
        const st = computeHandStats(h.raw)
        agg.total++
        if (st.vpip)         agg.vpip++
        if (st.pfr)          agg.pfr++
        if (st.three_bet)    agg.three_bet++
        if (st.pfr)          agg.fold_vs_3bet_den++
        if (st.fold_vs_3bet) agg.fold_vs_3bet_num++
        if (st.saw_flop)     agg.saw_flop++
        if (st.saw_flop && h.raw?.heroResult === 'won') agg.wwsf_num++
        if (st.went_to_sd)   agg.went_to_sd++
        if (st.won_sd)       agg.won_sd++
        return { id: h.id, tournament_id: h.tournament_id, ...st }
      })
      const { error: upsertErr } = await supabase.from('hands').upsert(updates, { onConflict: 'id' })
      if (upsertErr) throw upsertErr

      processed += hands.length
      onProgress?.(processed, total)
      if (hands.length < PAGE) break
      page++
    }
  }

  const pct = (n, d) => d > 0 ? Math.round(n / d * 1000) / 10 : null
  const stats = {
    total_hands:  agg.total,
    vpip:         pct(agg.vpip, agg.total),
    pfr:          pct(agg.pfr, agg.total),
    three_bet:    pct(agg.three_bet, agg.total),
    fold_vs_3bet: pct(agg.fold_vs_3bet_num, agg.fold_vs_3bet_den),
    wwsf:         pct(agg.wwsf_num, agg.saw_flop),
    wtsd:         pct(agg.went_to_sd, agg.saw_flop),
    won_sd:       pct(agg.won_sd, agg.went_to_sd),
  }

  const { error: saveErr } = await supabase.from('user_stats').upsert(
    { user_id: userId, ...stats, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
  if (saveErr) throw saveErr

  return { processed, stats }
}

export async function fetchHeroStats(userId) {
  const { data, error } = await supabase
    .from('user_stats')
    .select('total_hands,vpip,pfr,three_bet,fold_vs_3bet,wwsf,wtsd,won_sd')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

