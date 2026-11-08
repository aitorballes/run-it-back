import { supabase } from './supabase'
import { computeHandStats } from './handUtils'
import * as importer from './importer.js'

// La importación vive en importer.js (compartida con la Edge Function); aquí se usa con el cliente de la web.
export const fetchExistingTournamentIds = (userId, tournamentIds) => importer.fetchExistingTournamentIds(supabase, userId, tournamentIds)
export const refreshTournamentHands = (tournament, userId) => importer.refreshTournamentHands(supabase, tournament, userId)
export const saveTournament = (tournament, userId) => importer.saveTournament(supabase, tournament, userId)
export const updateTournamentSummary = (tournamentId, userId, data) => importer.updateTournamentSummary(supabase, tournamentId, userId, data)
export const importHandHistories = (userId, texts, options) => importer.importHandHistories(supabase, userId, texts, options)
export const insertLiveHand = (hand, tournamentDbId) => importer.insertLiveHand(supabase, hand, tournamentDbId)
export const updateLiveHand = (hand, handDbId, tournamentDbId) => importer.updateLiveHand(supabase, hand, handDbId, tournamentDbId)

export async function fetchTournaments(userId) {
  const PAGE = 1000
  const COLS = 'id, tournament_id, name, date, end_time, hands_count, platform, buyin, buyin_rake, players, prize_pool, finish_position, prize_won, bounty_won, duration, created_at, entries, reviewed'
  const results = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from('tournaments')
      .select(COLS)
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    // Live tournaments created before the date fix were saved as ISO dates
    results.push(...data.map(t => (t.platform === 'live' && /^\d{4}-\d{2}-\d{2}T/.test(t.date ?? '') ? { ...t, date: toTournamentDate(t.date) } : t)))
    if (data.length < PAGE) break
    page++
  }
  return results
}

export async function deleteAllTournaments(userId) {
  const HAND_BATCH = 200
  const TOUR_BATCH = 20
  const DEP_CHUNK  = 200

  // Live tournaments go too (their FK to tournaments only sets the link to null)
  const { error: liveError } = await supabase.from('live_tournaments').delete().eq('user_id', userId)
  if (liveError) throw liveError

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

  // A live tournament linked to this row goes with it (its FK only sets the link to null)
  let live = supabase.from('live_tournaments').delete().eq('tournament_db_id', tournamentDbId)
  if (userId) live = live.eq('user_id', userId)
  const { error: liveError } = await live
  if (liveError) throw liveError

  let q = supabase.from('tournaments').delete().eq('id', tournamentDbId)
  if (userId) q = q.eq('user_id', userId)
  const { error } = await q
  if (error) throw error
}

export async function setTournamentReviewed(tournamentDbId, reviewed) {
  const { error } = await supabase
    .from('tournaments')
    .update({ reviewed })
    .eq('id', tournamentDbId)
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

// Runs the whole "Estudia tu juego" search as a single Postgres query — every filter maps to a
// denormalized column on `hands` (see computeStudyFilterColumns), so Supabase does the
// filtering/sorting/limiting instead of downloading the history and scanning it in the browser.
function studyDraftHasOtherFilters(draft) {
  return (
    draft.positions.length > 0 || draft.notFoldedPreflop || draft.heroPfr ||
    draft.potType !== null || draft.posVsField !== null || draft.bbFold ||
    draft.stackBB !== null || draft.players !== null || draft.dateRange !== null
  )
}

export async function fetchStudyHands(userId, draft, onProgress) {
  function buildQuery() {
    let q = supabase
      .from('hands')
      .select('id, raw, tournament_id, tournaments!inner(user_id, name)')
      .eq('tournaments.user_id', userId)

    if (draft.positions.length > 0) q = q.in('hero_pos', draft.positions)
    if (draft.notFoldedPreflop) q = q.eq('hero_folded_preflop', false)
    if (draft.heroPfr) q = q.eq('pfr', true)
    if (draft.potType === 'srp')      q = q.eq('preflop_raise_count', 1)
    if (draft.potType === 'threebet') q = q.gte('preflop_raise_count', 2)
    if (draft.potType === 'clean')    q = q.eq('preflop_clean', true)
    if (draft.potType === 'limped')   q = q.eq('preflop_limped', true)
    if (draft.posVsField) q = q.eq('pos_vs_field', draft.posVsField)
    if (draft.bbFold) q = q.eq('bb_folded', true)
    if (draft.stackBB !== null) {
      q = draft.stackBB >= 100 ? q.gte('hero_stack_bb', 100) : q.lte('hero_stack_bb', draft.stackBB)
    }
    if (draft.players === 'hu')       q = q.eq('flop_players_count', 2)
    if (draft.players === 'multiway') q = q.gte('flop_players_count', 3)

    if (draft.dateRange === 'month')   q = q.gte('hand_datetime', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    if (draft.dateRange === '3months') q = q.gte('hand_datetime', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
    if (draft.dateRange === 'custom') {
      if (draft.dateFrom) q = q.gte('hand_datetime', new Date(draft.dateFrom).toISOString())
      if (draft.dateTo) {
        const to = new Date(draft.dateTo); to.setHours(23, 59, 59)
        q = q.lte('hand_datetime', to.toISOString())
      }
    }

    return q
  }

  const mapRows = data => (data ?? []).map(h => ({
    id: h.id, raw: h.raw, tournament_id: h.tournament_id, tournamentName: h.tournaments?.name,
  }))

  const lastN = parseInt(draft.lastN, 10)

  if (lastN > 0 && !studyDraftHasOtherFilters(draft)) {
    // Nothing narrows the match rate — every row qualifies, so Postgres can walk the
    // hand_datetime index straight to the newest N rows. Safe and fast.
    const { data, error } = await buildQuery().order('hand_datetime', { ascending: false }).limit(lastN)
    if (error) throw error
    return mapRows(data)
  }

  // Any other filter present: don't combine ORDER BY hand_datetime with LIMIT here — if the
  // filter is selective (few matches), Postgres would walk the date index row by row hunting
  // for N matches that may not exist, and can time out. Instead fetch every match with a plain
  // filtered scan (ordered by id for stable pagination, not date), then sort/trim in JS — the
  // filtered set is already far smaller than the full history, so that's cheap.
  const PAGE = 1000
  const results = []
  let page = 0
  while (true) {
    const { data, error } = await buildQuery().order('id', { ascending: true }).range(page * PAGE, (page + 1) * PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    results.push(...data)
    onProgress?.(results.length)
    if (data.length < PAGE) break
    page++
  }
  let rows = mapRows(results)
  rows.sort((a, b) => (b.raw.datetime || '').localeCompare(a.raw.datetime || ''))
  if (lastN > 0) rows = rows.slice(0, lastN)
  return rows
}

export async function fetchTournamentsInRange(userId, fromDate, toDate) {
  // fromDate/toDate are "YYYY-MM-DD"; DB stores "YYYY/MM/DD HH:MM:SS"
  const from = fromDate.replace(/-/g, '/')
  const to   = toDate.replace(/-/g, '/') + ' 99:99:99'

  const { data, error } = await supabase
    .from('tournaments')
    .select('id, tournament_id, name, date, end_time, hands_count, platform, buyin, buyin_rake, players, prize_pool, finish_position, prize_won, bounty_won, duration, created_at, entries')
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
  const chunks = []
  for (let i = 0; i < handDbIds.length; i += CHUNK) chunks.push(handDbIds.slice(i, i + CHUNK))
  const results = await Promise.all(chunks.map(chunk =>
    supabase.from('hand_notes').select('hand_id, note').eq('user_id', userId).in('hand_id', chunk)
  ))
  const map = {}
  for (const { data, error } of results) {
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
  const chunks = []
  for (let i = 0; i < handDbIds.length; i += CHUNK) chunks.push(handDbIds.slice(i, i + CHUNK))
  const results = await Promise.all(chunks.map(chunk =>
    supabase
      .from('review_list_hands')
      .select('hand_id, review_lists!inner(user_id)')
      .eq('review_lists.user_id', userId)
      .in('hand_id', chunk)
  ))
  const set = new Set()
  for (const { data, error } of results) {
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


// ── Avatars (Storage bucket "avatars", see scripts/migrate-avatars.sql) ──

const avatarPath = userId => `${userId}/avatar.jpg`

// Uploads (or replaces) the user's avatar and returns a cache-busted public URL
export async function uploadAvatar(userId, blob) {
  const path = avatarPath(userId)
  const { error } = await supabase.storage.from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function removeAvatar(userId) {
  const { error } = await supabase.storage.from('avatars').remove([avatarPath(userId)])
  if (error) throw error
}


// ── Live tournaments (table "live_tournaments", see scripts/migrate-live-tournaments.sql) ──

export async function fetchLiveTournaments(userId) {
  const { data, error } = await supabase
    .from('live_tournaments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function fetchLiveTournament(id) {
  const { data, error } = await supabase.from('live_tournaments').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export async function createLiveTournament(userId, fields) {
  const { data, error } = await supabase
    .from('live_tournaments')
    .insert({ ...fields, user_id: userId })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateLiveTournament(id, patch) {
  const { error } = await supabase
    .from('live_tournaments')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteLiveTournament(id) {
  const { error } = await supabase.from('live_tournaments').delete().eq('id', id)
  if (error) throw error
}

// Each live tournament gets a row in "tournaments" (platform 'live') so its hands live in "hands"
// like any imported tournament. Needs scripts/migrate-live-hands.sql; errors are swallowed so the
// live tracker keeps working if the migration hasn't been run yet.
// Tournament dates are stored like the imported ones: local "YYYY/MM/DD HH:MM:SS" (the Dashboard groups by it)
function toTournamentDate(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function liveTournamentFields(live) {
  return {
    date: toTournamentDate(live.created_at),
    name: `${live.name} · ${live.venue}`,
    buyin: live.buyin,
    players: live.entries,
    finish_position: live.finish_position ?? null,
    prize_won: live.prize_won ?? null,
    // Hero's entries: 1 + rebuys recorded in the live history (the Dashboard shows [n] when > 1)
    entries: 1 + (live.history ?? []).filter(h => h.rebuy).length,
  }
}

export async function ensureLiveTournamentRow(live) {
  if (!live) return null
  if (live.tournament_db_id) return live.tournament_db_id
  try {
    const tournamentId = `live-${live.id}`
    // Reuse a row left by an earlier attempt (or a double-mounted effect) before inserting
    const { data: existing } = await supabase
      .from('tournaments').select('id')
      .eq('user_id', live.user_id).eq('tournament_id', tournamentId)
      .maybeSingle()
    let dbId = existing?.id
    if (!dbId) {
      const { data, error } = await supabase
        .from('tournaments')
        .insert({
          user_id: live.user_id,
          tournament_id: tournamentId,
          platform: 'live',
          entries: 1,
          hands_count: 0,
          ...liveTournamentFields(live),
        })
        .select('id')
        .single()
      if (error) throw error
      dbId = data.id
    }
    const { error: linkError } = await supabase
      .from('live_tournaments').update({ tournament_db_id: dbId }).eq('id', live.id)
    if (linkError) throw linkError
    return dbId
  } catch (e) {
    console.warn('ensureLiveTournamentRow:', e?.message ?? e)
    return null
  }
}

export async function syncLiveTournamentRow(live) {
  if (!live?.tournament_db_id) return
  try {
    const { error } = await supabase
      .from('tournaments').update(liveTournamentFields(live)).eq('id', live.tournament_db_id)
    if (error) throw error
  } catch (e) {
    console.warn('syncLiveTournamentRow:', e?.message ?? e)
  }
}

// Map tournaments.id → { id, status } of the live tournament linked to it
export async function fetchLiveIdsByTournamentDbId(userId) {
  const map = new Map()
  try {
    const { data, error } = await supabase
      .from('live_tournaments')
      .select('id, status, tournament_db_id')
      .eq('user_id', userId)
      .not('tournament_db_id', 'is', null)
    if (error) throw error
    for (const row of data ?? []) map.set(row.tournament_db_id, { id: row.id, status: row.status })
  } catch (e) {
    console.warn('fetchLiveIdsByTournamentDbId:', e?.message ?? e)
  }
  return map
}


// ── Live hands (rows in `hands` under the live tournament's `tournaments` row) ──

export async function fetchLiveHands(tournamentDbId) {
  const { data, error } = await supabase
    .from('hands').select('id, raw, hand_datetime')
    .eq('tournament_id', tournamentDbId)
    .order('hand_datetime', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function fetchLiveHand(handDbId) {
  const { data, error } = await supabase.from('hands').select('id, raw, tournament_id').eq('id', handDbId).single()
  if (error) throw error
  return data
}

export async function deleteLiveHand(handDbId, tournamentDbId) {
  const deps = await Promise.all([
    supabase.from('hand_reviews').delete().eq('hand_id', handDbId),
    supabase.from('hand_notes').delete().eq('hand_id', handDbId),
    supabase.from('review_list_hands').delete().eq('hand_id', handDbId),
  ])
  for (const r of deps) if (r.error) throw r.error
  const { error } = await supabase.from('hands').delete().eq('id', handDbId)
  if (error) throw error
  await importer.refreshTournamentCounts(supabase, tournamentDbId)
}

// ── Notes on live players (table "player_notes", one per live tournament and name,
//    see scripts/migrate-live-hands.sql + scripts/migrate-player-notes-per-tournament.sql) ──

export const playerNameKey = name => name.trim().toLowerCase().replace(/\s+/g, ' ')

const PLAYER_NOTE_COLS = 'id, name, name_key, note, table_no, seat, updated_at'

export async function fetchPlayerNotes(liveTournamentId) {
  const { data, error } = await supabase
    .from('player_notes').select(PLAYER_NOTE_COLS)
    .eq('live_tournament_id', liveTournamentId).order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Notes of the live tournament linked to a `tournaments` row (for the Visualizer)
export async function fetchPlayerNotesForTournamentDb(tournamentDbId) {
  const { data, error } = await supabase
    .from('live_tournaments').select('id').eq('tournament_db_id', tournamentDbId).maybeSingle()
  if (error) throw error
  return data ? fetchPlayerNotes(data.id) : []
}

// Key of a note: the player's name, or their table and seat when there's no name
export const playerNoteKey = (name, tableNo, seat) =>
  name?.trim() ? playerNameKey(name) : `#${tableNo ?? ''}-${seat ?? ''}`

// Creates or updates the note for `name` in this tournament (an empty note still keeps the player in the list).
// `place` = { tableNo, seat } is optional: when left out, a note that already exists keeps its table and seat.
export async function savePlayerNote(userId, liveTournamentId, name, note, place) {
  const { data, error } = await supabase
    .from('player_notes')
    .upsert({
      user_id: userId, live_tournament_id: liveTournamentId, name: (name ?? '').trim(),
      name_key: playerNoteKey(name, place?.tableNo, place?.seat), note,
      ...(place ? { table_no: place.tableNo ?? null, seat: place.seat ?? null } : null),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'live_tournament_id,name_key' })
    .select(PLAYER_NOTE_COLS).single()
  if (error) throw error
  return data
}

// Updates an existing note by id. `patch` may hold name, note, tableNo, seat, nameKey (overrides the computed key)
export async function updatePlayerNote(id, patch) {
  const row = { updated_at: new Date().toISOString() }
  if ('note' in patch) row.note = patch.note
  if ('tableNo' in patch) row.table_no = patch.tableNo ?? null
  if ('seat' in patch) row.seat = patch.seat ?? null
  if ('name' in patch) {
    row.name = (patch.name ?? '').trim()
    row.name_key = playerNoteKey(patch.name, patch.tableNo, patch.seat)
  }
  if ('nameKey' in patch) row.name_key = patch.nameKey
  const { data, error } = await supabase.from('player_notes').update(row).eq('id', id).select(PLAYER_NOTE_COLS).single()
  if (error) throw error
  return data
}

export async function deletePlayerNote(id) {
  const { error } = await supabase.from('player_notes').delete().eq('id', id)
  if (error) throw error
}
