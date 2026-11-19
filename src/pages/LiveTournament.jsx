import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n, fmtNumber } from '../i18n/core'
import {
  fetchLiveTournament, updateLiveTournament, deleteLiveTournament, ensureLiveTournamentRow, syncLiveTournamentRow,
  fetchLiveHands, deleteLiveHand, generateHandShareToken, deleteTournament,
} from '../lib/db'
import { heroNet } from '../lib/handUtils'
import { Card, CardBack } from '../components/table/Cards'
import {
  levelAt, levelMinutes, breakMinutes, extrapolateLevel, recalcAfter, addBreaks, editLevelValue, isPaused, periodSeconds, remainingSeconds, typeChips, typeMoney, parseMoney, groupDigits, advanceClock, setLevelClock,
  averageStack, inBigBlinds, formatClock, parseChips, nextBreakIn, formatDuration,
} from '../lib/liveTournament'
import { getCachedTour, cacheTour, forgetTour, getPending, addPending, clearPending } from '../lib/liveOffline'
import Logo from '../components/Logo'
import StackChart from '../components/StackChart'
import { base } from '../components/liveStyles'

const fmtBlinds = l => `${fmtNumber(l.sb)}/${fmtNumber(l.bb)}${l.ante ? ` (${fmtNumber(l.ante)})` : ''}`
const fmtBB = n => (n == null ? '—' : fmtNumber(n, { maximumFractionDigits: n < 10 ? 1 : 0 }))

export default function LiveTournament() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, locale } = useI18n()

  const [tour, setTour]   = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | notFound | error
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmNextDay, setConfirmNextDay] = useState(false)
  const [confirmFinish, setConfirmFinish] = useState(false) // finish or rebuy?
  const [rebuyFlash, setRebuyFlash] = useState(null)
  const [now, setNow]     = useState(() => Date.now())

  // Update form
  const [stackIn, setStackIn]     = useState('')
  const [playersIn, setPlayersIn] = useState('')
  const [entriesIn, setEntriesIn] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const [showUpdate, setShowUpdate] = useState(false)
  const [showBreak, setShowBreak]   = useState(false)

  const [editingTime, setEditingTime] = useState(false)
  const [timeIn, setTimeIn]   = useState('')
  const [showStructure, setShowStructure] = useState(false)
  const [draft, setDraft]     = useState(null) // structure being edited, saved with the button
  const [recalc, setRecalc]   = useState(true) // editing a level recalculates the following ones
  const [extraLevels, setExtraLevels] = useState(0) // structure table: levels shown beyond the next 10
  const [showPast, setShowPast] = useState(false)  // structure table: levels already played
  const [brk, setBrk] = useState({ after: '', minutes: '15', every: '' }) // "add break" form
  const [breakAdded, setBreakAdded] = useState(false)
  const [editIdx, setEditIdx]   = useState(null) // history entry being corrected
  const [editVals, setEditVals] = useState({ stack: '', players: '', entries: '' })
  const editRef = useRef(null)
  const [finishPos, setFinishPos]     = useState('')
  const [finishPrize, setFinishPrize] = useState('')
  const [paidIn, setPaidIn]           = useState('')
  const [focusField, setFocusField]   = useState('stack') // field focused when the update modal opens

  // The clock card flashes when a level or break starts
  const [flash, setFlash]   = useState(false)

  // Changes not yet in the database (no signal at the venue): kept on the phone and retried
  const [offline, setOffline] = useState(false)
  const flushingRef = useRef(false)

  useEffect(() => {
    fetchLiveTournament(id)
      .then(row => {
        if (!row) { forgetTour(id); setStatus('notFound'); return }
        const pending = getPending(id)
        const merged = pending ? { ...row, ...pending } : row
        tourRef.current = merged
        setTour(merged)
        setStatus('ready')
        if (pending) flush()
        if (!row.tournament_db_id) {
          ensureLiveTournamentRow(row).then(dbId => {
            if (dbId) setTour(prev => (prev ? { ...prev, tournament_db_id: dbId } : prev))
          })
        }
      })
      .catch(() => {
        // No connection: open the copy saved on this phone
        const cached = getCachedTour(id)
        if (!cached) { setStatus('error'); return }
        const merged = { ...cached, ...getPending(id) }
        tourRef.current = merged
        setTour(merged)
        setStatus('ready')
        setOffline(true)
      })
    // flush only reads refs and storage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const tourRef = useRef(null)
  useEffect(() => {
    tourRef.current = tour
    if (tour) cacheTour(tour)
  }, [tour])

  // Sends every pending change in one update. Network errors keep them for later; an error from the
  // database itself (it won't go through by retrying) drops them and says so
  async function flush() {
    if (flushingRef.current) return
    const fields = getPending(id)
    if (!fields) { setOffline(false); return }
    flushingRef.current = true
    clearPending(id)
    let ok = true
    try {
      await updateLiveTournament(id, fields)
    } catch (e) {
      ok = false
      if (e?.code) setError(t('live.saveError'))
      else addPending(id, { ...fields, ...getPending(id) }) // newer changes win over the ones that failed
    }
    flushingRef.current = false
    const left = !!getPending(id)
    setOffline(left)
    if (ok && left) return flush()
  }

  // Retry when the phone gets signal back, when the page comes back to the front, and every 20 s
  useEffect(() => {
    const retry = () => { if (getPending(id)) flush() }
    const onVisible = () => { if (document.visibilityState === 'visible') retry() }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
    const iv = setInterval(retry, 20000)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const flashTimer = useRef(null)
  function notify() {
    setFlash(true)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(false), 4000)
  }
  const notifyRef = useRef(notify)
  const patchRef = useRef(null)
  useEffect(() => { notifyRef.current = notify; patchRef.current = patch })

  // Hands recorded in this tournament (rows in `hands` under its tournaments row)
  const [hands, setHands] = useState([])
  const [sharedHand, setSharedHand] = useState(null) // { id, url } of the last shared hand
  const tournamentDbId = tour?.tournament_db_id
  useEffect(() => {
    if (!tournamentDbId) return
    fetchLiveHands(tournamentDbId).then(setHands).catch(() => {})
  }, [tournamentDbId])

  // Ticks every second; when the level's time runs out the clock moves on to the next level by itself
  // (and the clock card flashes)
  useEffect(() => {
    const iv = setInterval(() => {
      const ts = Date.now()
      setNow(ts)
      const cur = tourRef.current
      if (!cur) return
      const advance = advanceClock(cur, ts)
      if (advance) {
        patchRef.current?.(advance)
        notifyRef.current()
      }
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  // Saves on the phone at once and in the database in the background (or later, without signal)
  function patch(fields) {
    tourRef.current = { ...tourRef.current, ...fields } // so quick repeated taps build on each other
    setTour(prev => ({ ...prev, ...fields }))
    setError('')
    addPending(id, fields)
    return flush()
  }

  // Paid places need their own column (scripts/migrate-live-paid-places.sql), so they're saved
  // on their own: if the column is missing, nothing else is held back
  function savePaidPlaces(n) {
    setTour(prev => ({ ...prev, paid_places: n }))
    updateLiveTournament(id, { paid_places: n }).catch(e => {
      setError(e?.code === 'PGRST204' || /paid_places/.test(e?.message ?? '') ? t('live.paid.migration') : t('live.saveError'))
    })
  }

  if (status !== 'ready') {
    return (
      <div style={base.page}>
        <Header navigate={navigate} t={t} />
        <div style={base.content}>
          <div style={status === 'loading' ? base.muted : base.error}>
            {status === 'loading' ? t('common.loading') : status === 'notFound' ? t('live.notFound') : t('live.loadError')}
          </div>
        </div>
      </div>
    )
  }

  const running   = tour.status === 'running'
  const paused    = isPaused(tour)
  const day       = tour.day ?? 1
  const onBreak   = !!tour.on_break
  const levelNo   = tour.current_level            // during a break: the level the break comes after
  const playLevel = onBreak ? levelNo + 1 : levelNo // level being played (or played after the break)
  const level     = levelAt(tour.structure, playLevel)
  const nextLevel = levelAt(tour.structure, playLevel + 1)
  const breakNext = onBreak ? 0 : breakMinutes(tour, levelNo) // break due when this level ends
  const remaining = remainingSeconds(tour, now)
  const avg       = averageStack(tour)
  const myBB      = inBigBlinds(tour.my_stack, level)
  const avgBB     = inBigBlinds(avg, level)
  const pctAvg    = avg && tour.my_stack != null ? Math.round((tour.my_stack / avg) * 100) : null
  const myEntries = 1 + tour.history.filter(h => h.rebuy).length // the Dashboard shows [n] when > 1
  const totalChips = tour.entries && tour.starting_stack ? tour.entries * tour.starting_stack : null
  const clockTime = secs => new Date(now + secs * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const endsAt    = running && !paused ? clockTime(remaining) : null
  const breakIn   = running && breakNext === 0 ? nextBreakIn(tour, now) : null // a break right after this level already shows above
  const paid      = tour.paid_places || null
  const toCash    = paid && tour.players_left != null ? tour.players_left - paid : null
  const invested  = (Number(tour.buyin) || 0) * myEntries
  const net       = (Number(tour.prize_won) || 0) - invested

  function goToLevel(n) {
    if (n < 1) return
    patch(setLevelClock(tour, n, levelMinutes(tour, n) * 60, now))
  }

  // ⏭ goes to the break due after this level, if any, else to the next level; ⏮ from a break goes back to its level
  function goNext() {
    if (breakNext > 0) patch(setLevelClock(tour, levelNo, breakNext * 60, now, true))
    else goToLevel(levelNo + 1)
  }

  function goPrev() {
    goToLevel(onBreak ? levelNo : levelNo - 1)
  }

  // A new day starts with the clock paused, keeping the time left in the level
  function nextDay() {
    setConfirmNextDay(false)
    patch({ day: day + 1, paused_remaining: remaining, level_ends_at: null })
  }

  // Moves the clock by whole minutes: − down to 0 (which ends the level if the clock is running),
  // + never above the level's (or break's) full length, so levels can't be made longer than the structure says
  function adjustTime(deltaSeconds) {
    const cur = tourRef.current
    const secs = Math.min(periodSeconds(cur), Math.max(0, remainingSeconds(cur) + deltaSeconds))
    patch(setLevelClock(cur, cur.current_level, secs, undefined, !!cur.on_break))
  }

  function togglePause() {
    patch(paused
      ? { paused_remaining: null, level_ends_at: new Date(now + remaining * 1000).toISOString() }
      : { paused_remaining: remaining, level_ends_at: null })
  }

  function saveTime(e) {
    e.preventDefault()
    const minutes = parseFloat(String(timeIn).replace(',', '.'))
    if (Number.isFinite(minutes) && minutes >= 0) patch(setLevelClock(tour, levelNo, Math.min(periodSeconds(tour), Math.round(minutes * 60)), now, onBreak))
    setEditingTime(false)
  }

  function saveUpdate(e) {
    e.preventDefault()
    const stack   = parseChips(stackIn)   ?? tour.my_stack
    const players = parseChips(playersIn) ?? tour.players_left
    const entries = parseChips(entriesIn) ?? tour.entries
    const paidPlaces = parseChips(paidIn)
    if (paidPlaces != null && paidPlaces !== tour.paid_places) savePaidPlaces(paidPlaces)
    if (stackIn || playersIn || entriesIn) {
      patch({
        my_stack: stack,
        players_left: players,
        entries,
        history: [...tour.history, { at: new Date().toISOString(), day, level: playLevel, stack, players, entries }],
      })
    }
    setStackIn(''); setPlayersIn(''); setEntriesIn(''); setPaidIn('')
    closeUpdate()
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
  }

  // Structure edits stay in a draft until saved; with `recalc`, levels after the edited one follow from it
  const rows = draft ?? tour.structure

  function editLevel(index, key, value) {
    let next = rows.map((l, i) => (i === index ? editLevelValue(l, key, parseChips(value) ?? 0) : l))
    if (recalc) next = recalcAfter(next, index, Math.max(next.length, levelNo))
    setDraft(next)
  }

  function addBreak(e) {
    e.preventDefault()
    const after = parseChips(brk.after) ?? levelNo
    const minutes = parseChips(brk.minutes)
    if (!minutes) return
    const every = parseChips(brk.every)
    patch({ structure: addBreaks(tour.structure, after, minutes, every) })
    if (draft) setDraft(addBreaks(draft, after, minutes, every))
    setBrk(b => ({ ...b, after: '', every: '' }))
    setShowBreak(false)
    setBreakAdded(true)
    setTimeout(() => setBreakAdded(false), 1500)
  }

  // Breaks still ahead (from the current level on), for the summary in the breaks card
  const upcomingBreaks = tour.structure
    .map((l, i) => ({ level: i + 1, minutes: l.breakAfter }))
    .filter(b => b.minutes > 0 && b.level >= levelNo && !(onBreak && b.level === levelNo))
    .slice(0, 4)

  function editBreak(index, value) {
    setDraft(rows.map((l, i) => (i === index ? { ...l, breakAfter: parseChips(value) ?? 0 } : l)))
  }

  function removeBreak(index) {
    setDraft(rows.map((l, i) => {
      if (i !== index) return l
      const { breakAfter: _drop, ...rest } = l
      return rest
    }))
  }

  function saveStructure() {
    patch({ structure: draft })
    setDraft(null)
  }

  function finish(e) {
    e.preventDefault()
    patch({
      status: 'finished',
      finish_position: parseChips(finishPos),
      prize_won: parseMoney(finishPrize) || null,
      paused_remaining: remaining,
      level_ends_at: null,
    }).then(() => syncLiveTournamentRow(tourRef.current))
  }

  // Rebuy: back to the starting stack with one more entry in the field; the tournament keeps running
  function rebuy() {
    setConfirmFinish(false)
    const stack = tour.starting_stack ?? tour.my_stack
    const entries = tour.entries ? tour.entries + 1 : tour.entries
    patch({
      my_stack: stack,
      entries,
      history: [...tour.history, { at: new Date().toISOString(), day, level: playLevel, stack, players: tour.players_left, entries, rebuy: true }],
    }).then(() => syncLiveTournamentRow(tourRef.current))
    setFinishPos(''); setFinishPrize('')
    setRebuyFlash(myEntries + 1)
    setTimeout(() => setRebuyFlash(null), 2500)
  }

  async function handleDelete() {
    setConfirmDelete(false)
    try {
      // Its tournaments row goes too, with the recorded hands
      if (tour.tournament_db_id) await deleteTournament(tour.tournament_db_id, tour.user_id)
      await deleteLiveTournament(id)
      forgetTour(id)
      navigate('/live')
    } catch {
      setError(t('live.saveError'))
    }
  }

  async function shareHand(handId) {
    try {
      const token = await generateHandShareToken(handId)
      const url = `${window.location.origin}/hand-share/${token}`
      try { await navigator.clipboard.writeText(url) } catch { /* clipboard unavailable */ }
      setSharedHand({ id: handId, url })
    } catch {
      setError(t('live.saveError'))
    }
  }

  async function removeHand(handId) {
    if (!window.confirm(t('live.hands.deleteConfirm'))) return
    try {
      await deleteLiveHand(handId, tour.tournament_db_id)
      setHands(hs => hs.filter(h => h.id !== handId))
    } catch {
      setError(t('live.saveError'))
    }
  }

  // Newest first, keeping each entry's index in tour.history
  const history = tour.history.map((h, idx) => ({ h, idx })).reverse()
  const multiDay = day > 1 || tour.history.some(h => (h.day ?? 1) > 1)
  const chartPoints = tour.history.map((h, idx) => ({
    idx,
    day: h.day ?? 1,
    at: h.at,
    level: h.level,
    stack: h.stack,
    bb: inBigBlinds(h.stack, levelAt(tour.structure, h.level)),
    avg: averageStack({ entries: h.entries, players_left: h.players, starting_stack: tour.starting_stack }),
  }))

  const editing = editIdx != null ? tour.history[editIdx] : null

  // Opens the updates modal with that entry ready to correct (from a chart point or a row in the modal)
  function startEdit(idx, scroll = false) {
    const h = tour.history[idx]
    setEditVals({ stack: typeChips(h.stack), players: typeChips(h.players), entries: typeChips(h.entries) })
    setEditIdx(idx)
    setShowUpdate(true)
    if (scroll) requestAnimationFrame(() => editRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  function closeUpdate() {
    setShowUpdate(false)
    setEditIdx(null)
  }

  // From the update button or by tapping a stat: the modal opens on that field
  function openUpdate(field = 'stack') {
    setFocusField(running ? field : null)
    setEditIdx(null)
    setShowUpdate(true)
  }

  // What the typed values mean before saving: stack in BB and against the average
  const pvStack   = parseChips(stackIn)
  const pvAvg     = averageStack({
    entries: parseChips(entriesIn) ?? tour.entries,
    players_left: parseChips(playersIn) ?? tour.players_left,
    starting_stack: tour.starting_stack,
  })
  const pvBB      = inBigBlinds(pvStack, level)
  const pvPct     = pvAvg && pvStack != null ? Math.round((pvStack / pvAvg) * 100) : null

  // Editing the latest update also corrects the tournament's current stack/players/entries
  function syncCurrent(newHistory) {
    const latest = newHistory[newHistory.length - 1]
    return latest ? { my_stack: latest.stack, players_left: latest.players, entries: latest.entries } : {}
  }

  function saveHistoryEdit(e) {
    e.preventDefault()
    const newHistory = tour.history.map((h, i) => (i === editIdx ? {
      ...h,
      stack: parseChips(editVals.stack),
      players: parseChips(editVals.players),
      entries: parseChips(editVals.entries),
    } : h))
    patch({ history: newHistory, ...(editIdx === tour.history.length - 1 ? syncCurrent(newHistory) : null) })
    setEditIdx(null)
  }

  function deleteHistory(idx) {
    if (!window.confirm(t('live.history.deleteConfirm'))) return
    const newHistory = tour.history.filter((_, i) => i !== idx)
    const saved = patch({ history: newHistory, ...(idx === tour.history.length - 1 ? syncCurrent(newHistory) : null) })
    if (tour.history[idx].rebuy) saved.then(() => syncLiveTournamentRow(tourRef.current))
    setEditIdx(null)
  }

  return (
    <div style={base.page}>
      <Header navigate={navigate} t={t} />

      <div style={base.content}>
        <div>
          <div style={base.title}>
            {tour.name}{myEntries > 1 && <span style={s.entriesTag}> [{myEntries}]</span>}
          </div>
          <div style={base.subtitle}>
            {tour.venue} · {t('live.form.buyin')} {fmtNumber(tour.buyin)}{tour.currency} · {t('live.levelMinutesShort', { n: levelMinutes(tour, levelNo) })}
          </div>
        </div>

        {error && <div style={base.error}>{error}</div>}

        {offline && (
          <div style={s.offlineBox}>
            <span>📶 {t('live.sync.offline')}</span>
            <button style={s.offlineBtn} onClick={flush}>{t('live.sync.retry')}</button>
          </div>
        )}

        {!running && (
          <div style={s.resultCard}>
            <div style={s.resultMain}>
              {tour.finish_position ? t('live.finish.position', { pos: tour.finish_position }) : t('live.finished')}
            </div>
            {tour.prize_won > 0 && (
              <div style={s.resultPrize}>{t('live.finish.prize')}: {fmtNumber(tour.prize_won)}{tour.currency}</div>
            )}
            {invested > 0 && (
              <div style={s.resultSub}>
                {t('live.finish.invested', { n: `${fmtNumber(invested)}${tour.currency}` })} ·{' '}
                <span style={{ color: net >= 0 ? '#50d080' : '#e07070', fontWeight: 800 }}>
                  {t('live.finish.net', { n: `${net > 0 ? '+' : ''}${fmtNumber(net)}${tour.currency}` })}
                </span>
              </div>
            )}
            <button style={base.ghostBtn} onClick={() => patch({ status: 'running' }).then(() => syncLiveTournamentRow(tourRef.current))}>{t('live.finish.reopen')}</button>
          </div>
        )}

        {/* CLOCK */}
        <div style={{ ...s.clockCard, ...(onBreak ? s.clockCardBreak : null), ...(flash ? s.clockCardFlash : null) }}>
          <div style={s.clockTop}>
            <span style={s.levelLabel}>
              {t('live.day', { n: day })} · {onBreak ? t('live.break') : t('live.level', { n: levelNo })}
            </span>
            {running && paused && <span style={s.pausedTag}>{t('live.paused')}</span>}
          </div>
          <div style={{ ...s.blinds, ...(onBreak ? { color: '#f0c070' } : null) }}>
            {onBreak ? `☕ ${t('live.break')}` : fmtBlinds(level)}
          </div>
          {running && (
            editingTime ? (
              <form style={s.timeForm} onSubmit={saveTime}>
                <input style={{ ...base.input, width: 110, textAlign: 'center' }} type="number" min="0" max={periodSeconds(tour) / 60} step="any"
                  inputMode="decimal" autoFocus value={timeIn} onChange={e => setTimeIn(e.target.value)}
                  placeholder={t('live.minutes')} />
                <button style={base.btn} type="submit">{t('common.save')}</button>
                <button style={base.ghostBtn} type="button" onClick={() => setEditingTime(false)}>{t('common.cancel')}</button>
              </form>
            ) : (
              <button style={{ ...s.clock, color: paused ? '#5a7a9a' : remaining <= 60 ? '#f0a040' : '#e8f0ff' }}
                onClick={() => { setTimeIn(String(Math.round(remaining / 60))); setEditingTime(true) }}
                title={t('live.setTime')}>
                {formatClock(remaining)}
              </button>
            )
          )}
          <div style={s.next}>
            {onBreak ? t('live.backTo', { n: playLevel, blinds: fmtBlinds(level) })
              : breakNext > 0 ? t('live.nextBreak', { m: breakNext })
              : t('live.nextLevel', { blinds: fmtBlinds(nextLevel) })}
          </div>
          {(endsAt || breakIn) && (
            <div style={s.clockInfo}>
              {endsAt && <span>🕒 {t(onBreak ? 'live.breakEndsAt' : 'live.endsAt', { time: endsAt })}</span>}
              {breakIn && (
                <span style={{ color: '#c8a060' }}>
                  ☕ {paused
                    ? t('live.breakIn', { d: formatDuration(breakIn.seconds) })
                    : t('live.breakInAt', { d: formatDuration(breakIn.seconds), time: clockTime(breakIn.seconds) })}
                </span>
              )}
            </div>
          )}
          {running && (
            <div style={s.clockBtns}>
              <CtrlButton icon={'⏮\uFE0E'} caption={t('live.structure.level')} title={t('live.prevLevel')}
                disabled={levelNo <= 1 && !onBreak} onClick={goPrev} />
              <CtrlButton icon={'⏪\uFE0E'} caption="−1 min" title={t('live.minusMinute')}
                disabled={remaining <= 0} onClick={() => adjustTime(-60)} />
              <CtrlButton icon={paused ? '▶\uFE0E' : '⏸\uFE0E'} caption={paused ? t('live.resume') : t('live.pause')}
                title={paused ? t('live.resume') : t('live.pause')} active={!paused} onClick={togglePause} />
              <CtrlButton icon={'⏩\uFE0E'} caption="+1 min" title={t('live.plusMinute')}
                disabled={remaining >= periodSeconds(tour)} onClick={() => adjustTime(60)} />
              <CtrlButton icon={'⏭\uFE0E'} caption={breakNext > 0 ? t('live.break') : t('live.structure.level')}
                title={breakNext > 0 ? t('live.goToBreak') : t('live.nextLevelBtn')} onClick={goNext} />
            </div>
          )}
          {running && (
            <div style={s.clockUpdate}>
              <button style={{ ...base.btn, ...s.bigBtn }} onClick={() => openUpdate('stack')}>
                {t('live.update.button')}
              </button>
              {savedFlash && <span style={s.saved}>✓ {t('live.update.saved')}</span>}
            </div>
          )}
        </div>

        <div style={s.quickBtns}>
          {running && (
            <button style={{ ...s.newHandBtn, ...s.quickBtn }} onClick={() => navigate(`/live/${id}/hand/new`)}>🂡 {t('live.hands.new')}</button>
          )}
          <button style={{ ...s.tableBtn, ...s.quickBtn }} onClick={() => navigate(`/live/${id}/table`)}>
            {t('live.myTable.title')}{tour.tables?.length ? ` · ${t('live.notes.tableN', { n: tour.tables.at(-1).no })}` : ''}
          </button>
        </div>

        {/* STATS */}
        <div style={s.stats}>
          {/* Tapping a stat opens the update on that value */}
          <Stat label={t('live.stats.myStack')} value={tour.my_stack != null ? fmtNumber(tour.my_stack) : '—'}
            big={t('live.stats.bb', { n: fmtBB(myBB) })} accent={myBB != null && myBB < 15 ? '#f0a040' : '#50d080'}
            sub={pctAvg != null ? t('live.stats.ofAverage', { pct: pctAvg }) : null}
            onClick={running ? () => openUpdate('stack') : null} />
          <Stat label={t('live.stats.average')} value={avg != null ? fmtNumber(Math.round(avg)) : '—'}
            big={t('live.stats.bb', { n: fmtBB(avgBB) })} accent="#60b0ff"
            sub={avg == null ? t('live.stats.averageHint') : null}
            onClick={running ? () => openUpdate('players') : null} />
          <Stat label={t('live.stats.players')}
            value={tour.players_left != null ? `${fmtNumber(tour.players_left)}${tour.entries ? ` / ${fmtNumber(tour.entries)}` : ''}` : '—'}
            sub={toCash == null ? (running ? t('live.paid.add') : null)
              : toCash > 0 ? t('live.paid.bubble', { n: fmtNumber(toCash), paid: fmtNumber(paid) })
              : t('live.paid.itm', { paid: fmtNumber(paid) })}
            subColor={toCash == null ? null : toCash > 0 ? (toCash <= Math.max(3, paid * 0.1) ? '#f0a040' : null) : '#50d080'}
            onClick={running ? () => openUpdate(paid ? 'players' : 'paid') : null} />
          <Stat label={t('live.stats.chips')} value={totalChips != null ? fmtNumber(totalChips) : '—'}
            sub={t('live.stats.startingStack', { n: fmtNumber(tour.starting_stack) })}
            onClick={running ? () => openUpdate('entries') : null} />
        </div>

        {/* STACK CHART + button that opens the updates modal */}
        <div style={base.card}>
          {tour.history.length === 0 ? (
            <div style={base.hint}>{t('live.history.empty')}</div>
          ) : (
            <StackChart points={chartPoints} locale={locale} labels={{
              title: t('live.history.chartTitle'), stack: t('live.stats.myStack'),
              average: t('live.stats.average'), level: t('live.structure.level'),
              day: n => t('live.day', { n }),
            }} multiDay={multiDay} selected={editIdx} onSelect={startEdit} />
          )}
          {!running && (
            <div style={s.cardBtnRow}>
              <button style={{ ...base.btn, ...s.bigBtn }} onClick={() => openUpdate('stack')}>
                {t('live.history.title')}
              </button>
            </div>
          )}
        </div>

        {/* BREAKS */}
        {running && (
          <div style={s.cardBtnRow}>
            {breakAdded && <span style={s.saved}>✓ {t('live.update.saved')}</span>}
            <button style={{ ...base.ghostBtn, ...s.breakBtn }} onClick={() => setShowBreak(true)}>
              ☕ {t('live.structure.addBreak')}
            </button>
          </div>
        )}

        {/* UPDATE modal: new update (or correcting one) + the list of updates */}
        {showUpdate && (
          <Modal title={running ? t('live.update.button') : t('live.history.title')} onClose={closeUpdate} closeLabel={t('common.cancel')}>
            {editing && (
              <form key={editIdx} ref={editRef} style={s.editRow} onSubmit={saveHistoryEdit}>
                <div style={s.editHead}>
                  {new Date(editing.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} · {t('live.level', { n: editing.level })}
                </div>
                <div style={base.row}>
                  {[['stack', t('live.update.stack')], ['players', t('live.update.players')], ['entries', t('live.update.entries')]].map(([k, label]) => (
                    <label key={k} style={{ ...base.field, flex: k === 'stack' ? '1 1 120px' : '1 1 80px', minWidth: 0 }}>
                      <span style={base.label}>{label}</span>
                      <input style={base.input} inputMode="numeric" value={editVals[k]}
                        autoFocus={k === 'stack'} onFocus={e => e.target.select()} onChange={e => setEditVals(v => ({ ...v, [k]: typeChips(e.target.value) }))} />
                    </label>
                  ))}
                </div>
                <div style={{ ...base.actions, justifyContent: 'space-between' }}>
                  <button type="button" style={{ ...base.ghostBtn, ...s.dangerBtn }} onClick={() => deleteHistory(editIdx)}>
                    {t('common.delete')}
                  </button>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" style={base.ghostBtn} onClick={() => setEditIdx(null)}>{t('common.cancel')}</button>
                    <button type="submit" style={base.btn}>{t('common.save')}</button>
                  </div>
                </div>
              </form>
            )}
            {running && !editing && (
              <form style={s.modalForm} onSubmit={saveUpdate}>
                <label style={base.field}>
                  <span style={base.label}>{t('live.update.stack')}</span>
                  <input style={{ ...base.input, fontSize: 20, fontWeight: 800 }} inputMode="numeric" value={stackIn}
                    onChange={e => setStackIn(typeChips(e.target.value))} autoFocus={focusField === 'stack'}
                    placeholder={tour.my_stack != null ? fmtNumber(tour.my_stack) : ''} />
                  {pvBB != null && (
                    <span style={s.preview}>
                      <b style={{ color: pvBB < 15 ? '#f0a040' : '#50d080' }}>{t('live.stats.bb', { n: fmtBB(pvBB) })}</b>
                      {pvPct != null && <> · {t('live.stats.ofAverage', { pct: pvPct })}</>}
                    </span>
                  )}
                </label>
                <div style={base.row}>
                  <label style={{ ...base.field, flex: '1 1 130px', minWidth: 0 }}>
                    <span style={base.label}>{t('live.update.players')}</span>
                    <input style={base.input} inputMode="numeric" value={playersIn} onChange={e => setPlayersIn(typeChips(e.target.value))}
                      autoFocus={focusField === 'players'}
                      placeholder={tour.players_left != null ? fmtNumber(tour.players_left) : ''} />
                  </label>
                  <label style={{ ...base.field, flex: '1 1 90px', minWidth: 0 }}>
                    <span style={base.label}>{t('live.update.entries')}</span>
                    <input style={base.input} inputMode="numeric" value={entriesIn} onChange={e => setEntriesIn(typeChips(e.target.value))}
                      autoFocus={focusField === 'entries'}
                      placeholder={tour.entries != null ? fmtNumber(tour.entries) : ''} />
                  </label>
                  <label style={{ ...base.field, flex: '1 1 90px', minWidth: 0 }}>
                    <span style={base.label}>{t('live.paid.label')}</span>
                    <input style={base.input} inputMode="numeric" value={paidIn} onChange={e => setPaidIn(typeChips(e.target.value))}
                      autoFocus={focusField === 'paid'}
                      placeholder={tour.paid_places ? String(tour.paid_places) : t('live.structure.optional')} />
                  </label>
                </div>
                <div style={base.actions}>
                  <button style={base.ghostBtn} type="button" onClick={closeUpdate}>{t('common.cancel')}</button>
                  <button style={base.btn} type="submit" disabled={!stackIn && !playersIn && !entriesIn && !paidIn}>
                    {t('live.update.save')}
                  </button>
                </div>
              </form>
            )}
            {tour.history.length === 0 ? (
              <div style={base.hint}>{t('live.history.empty')}</div>
            ) : (
              <div style={s.modalSection}>
                <div style={base.label}>{t('live.history.title')}</div>
                <div style={s.table}>
                  <div style={{ ...s.hr, ...s.th }}>
                    <span>{t('live.history.time')}</span>
                    <span title={t('live.structure.level')}>#</span>
                    <span style={{ textAlign: 'right' }}>{t('live.history.stack')}</span>
                    <span style={{ textAlign: 'right' }}>BB</span>
                    <span style={{ textAlign: 'right' }}>{t('live.history.players')}</span>
                    <span />
                  </div>
                  {history.map(({ h, idx }, k) => (
                    <Fragment key={idx}>
                      {multiDay && (k === 0 || (history[k - 1].h.day ?? 1) !== (h.day ?? 1)) && (
                        <div style={s.daySep}>{t('live.day', { n: h.day ?? 1 })}</div>
                      )}
                      <button style={{ ...s.hr, ...s.hrBtn, ...(idx === editIdx ? s.hrSelected : null) }}
                        onClick={() => startEdit(idx, true)} title={t('live.history.edit')}>
                        <span style={{ color: '#4a6a8a' }}>
                          {new Date(h.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                          {h.rebuy && <span title={t('live.finish.rebuyRow')}> 🔁</span>}
                        </span>
                        <span>{h.level}</span>
                        <span style={{ textAlign: 'right', fontWeight: 700 }}>{h.stack != null ? fmtNumber(h.stack) : '—'}</span>
                        <span style={{ textAlign: 'right', color: '#50d080' }}>{fmtBB(inBigBlinds(h.stack, levelAt(tour.structure, h.level)))}</span>
                        <span style={{ textAlign: 'right' }}>{h.players != null ? fmtNumber(h.players) : '—'}</span>
                        <span style={s.editIcon}>✎</span>
                      </button>
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </Modal>
        )}

        {/* BREAK modal */}
        {running && showBreak && (
          <Modal title={`☕ ${t('live.structure.addBreak')}`} onClose={() => setShowBreak(false)} closeLabel={t('common.cancel')}>
            <form style={s.modalForm} onSubmit={addBreak}>
              <div style={s.breakGrid}>
                <label style={{ ...base.field, minWidth: 0 }}>
                  <span style={base.label}>{t('live.structure.afterLevel')}</span>
                  <input style={base.input} inputMode="numeric" value={brk.after} placeholder={String(levelNo)}
                    onChange={e => setBrk(b => ({ ...b, after: e.target.value }))} />
                </label>
                <label style={{ ...base.field, minWidth: 0 }}>
                  <span style={base.label}>{t('live.structure.breakMinutes')}</span>
                  <input style={base.input} inputMode="numeric" value={brk.minutes}
                    onChange={e => setBrk(b => ({ ...b, minutes: e.target.value }))} />
                </label>
                <label style={{ ...base.field, minWidth: 0, gridColumn: '1 / -1' }}>
                  <span style={base.label}>{t('live.structure.every')}</span>
                  <input style={base.input} inputMode="numeric" value={brk.every} placeholder={t('live.structure.optional')}
                    onChange={e => setBrk(b => ({ ...b, every: e.target.value }))} />
                </label>
              </div>
              <div style={base.hint}>{t('live.structure.breakHint')}</div>
              {upcomingBreaks.length > 0 && (
                <div style={s.breakList}>
                  {t('live.structure.upcomingBreaks')}{' '}
                  {upcomingBreaks.map(b => t('live.structure.breakItem', { n: b.level, m: b.minutes })).join(' · ')}
                </div>
              )}
              <div style={base.actions}>
                <button style={base.ghostBtn} type="button" onClick={() => setShowBreak(false)}>{t('common.cancel')}</button>
                <button type="submit" style={base.btn} disabled={!parseChips(brk.minutes)}>+ {t('live.structure.addBreak')}</button>
              </div>
            </form>
          </Modal>
        )}

        {/* HANDS */}
        {hands.length > 0 && (
          <div style={base.card}>
            <div style={base.cardTitle}>{t('live.hands.title', { n: hands.length })}</div>
            {[...hands].reverse().map(({ id: handId, raw }) => {
              const net = heroNet(raw) ?? 0
              const netBB = raw.bb ? net / raw.bb : 0
              const hero = raw.holeCards?.Hero
              return (
                <div key={handId} style={s.handRow}>
                  <div style={s.handMain}>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {hero ? hero.map(c => <Card key={c} code={c} size="xs" />) : [0, 1].map(k => <CardBack key={k} size="xs" />)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={s.handMeta}>
                        {raw.datetime?.slice(11, 16)} · {t('live.level', { n: raw.level })} · {raw.seats?.find(x => x.player === 'Hero')?.pos}
                      </div>
                      <div style={{ ...s.handNet, color: raw.heroResult === 'folded' ? '#7a94b0' : net > 0 ? '#50d080' : '#e07070' }}>
                        {raw.heroResult === 'folded' && net === 0 ? 'Fold' : `${net > 0 ? '+' : ''}${fmtNumber(netBB, { maximumFractionDigits: 1 })} BB`}
                      </div>
                    </div>
                  </div>
                  <div style={s.handBtns}>
                    <button style={s.iconBtn} title={t('live.hand.view')}
                      onClick={() => navigate(`/tournament/${tour.tournament_db_id}`, { state: { handDbId: handId } })}>▶</button>
                    <button style={s.iconBtn} title={t('common.share')} onClick={() => shareHand(handId)}>🔗</button>
                    <button style={s.iconBtn} title={t('live.hands.edit')} onClick={() => navigate(`/live/${id}/hand/${handId}`)}>✎</button>
                    <button style={{ ...s.iconBtn, color: '#e07070' }} title={t('common.delete')} onClick={() => removeHand(handId)}>✕</button>
                  </div>
                  {sharedHand?.id === handId && (
                    <div style={s.shareBox}>{t('common.linkCopied')} <span style={{ color: '#9ab4d0' }}>{sharedHand.url}</span></div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {/* STRUCTURE */}
        <div style={base.card}>
          <button style={s.sectionToggle} onClick={() => setShowStructure(v => !v)}>
            <span style={base.cardTitle}>{t('live.structure.title')}</span>
            <span style={{ color: '#3a6080' }}>{showStructure ? '▲' : '▼'}</span>
          </button>
          {showStructure && (
            <>
              <div style={base.hint}>{t('live.structure.hint')}</div>
              <label style={s.checkRow}>
                <input type="checkbox" checked={recalc} onChange={e => setRecalc(e.target.checked)} />
                {t('live.structure.recalc')}
              </label>
              {(() => {
                // Only the current level and the next 10 by default; the rest on demand. On a break it
                // starts at the level before it, so the break row shows
                const cur = Math.max(0, Math.min(levelNo, rows.length) - 1)
                const from = showPast ? 0 : cur
                const to = cur + 11 + extraLevels
                const shown = rows.slice(from, to).map((l, k) => [l, from + k])
                const left = rows.length - Math.min(to, rows.length)
                return (
              <>
              {from > 0 && (
                <button style={s.moreBtn} onClick={() => setShowPast(true)}>
                  ▲ {t('live.structure.showPast', { n: from })}
                </button>
              )}
              <div style={s.table}>
                <div style={{ ...s.tr, ...s.th }}>
                  <span title={t('live.structure.level')}>#</span>
                  <span title={t('live.structure.sbFull')}>SB</span>
                  <span title={t('live.structure.bbFull')}>BB</span>
                  <span>Ante</span>
                  <span title={t('live.structure.minutesFull')}>Min</span>
                  <span />
                </div>
                {shown.map(([l, i]) => (
                  <Fragment key={i}>
                  <div style={{ ...s.tr, ...(i + 1 === playLevel && !onBreak ? s.trCurrent : null) }}>
                    <button style={s.levelNo} onClick={() => running && goToLevel(i + 1)} title={t('live.structure.goTo')}>
                      {i + 1}
                    </button>
                    {['sb', 'bb', 'ante'].map(k => (
                      <input key={k} style={s.cell} inputMode="numeric" value={l[k] ? groupDigits(l[k]) : ''}
                        onChange={e => editLevel(i, k, e.target.value)} placeholder="0" />
                    ))}
                    <input style={s.cell} inputMode="numeric" value={l.minutes || tour.level_minutes}
                      onChange={e => editLevel(i, 'minutes', e.target.value)} />
                    <button style={s.removeBtn} title={t('live.structure.remove')}
                      disabled={rows.length <= 1}
                      onClick={() => setDraft(rows.filter((_, j) => j !== i))}>×</button>
                  </div>
                  {l.breakAfter != null && (
                    <div style={{ ...s.tr, ...s.breakRow, ...(onBreak && i + 1 === levelNo ? s.trCurrent : null) }}>
                      <span style={{ textAlign: 'center' }}>☕</span>
                      <span style={s.breakLabel}>{t('live.break')}</span>
                      <input style={s.cell} inputMode="numeric" value={l.breakAfter || ''} placeholder="0"
                        onChange={e => editBreak(i, e.target.value)} title={t('live.structure.breakMinutes')} />
                      <button style={s.removeBtn} title={t('live.structure.removeBreak')} onClick={() => removeBreak(i)}>×</button>
                    </div>
                  )}
                  </Fragment>
                ))}
              </div>
              {left > 0 && (
                <button style={s.moreBtn} onClick={() => setExtraLevels(n => n + 10)}>
                  ▼ {t('live.structure.showMore', { n: Math.min(10, left) })}
                </button>
              )}
              </>
                )
              })()}
              <div style={s.structureActions}>
                <button style={base.ghostBtn}
                  onClick={() => {
                    setDraft([...rows, extrapolateLevel(rows[rows.length - 1])])
                    setExtraLevels(rows.length) // the new level is the last one: show up to it
                  }}>
                  + {t('live.structure.add')}
                </button>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {draft && <button style={base.ghostBtn} onClick={() => setDraft(null)}>{t('common.cancel')}</button>}
                  <button style={{ ...base.btn, opacity: draft ? 1 : 0.4, cursor: draft ? 'pointer' : 'default' }}
                    onClick={saveStructure} disabled={!draft}>
                    {t('common.save')}
                  </button>
                </div>
              </div>
              {draft && <div style={s.unsaved}>{t('live.structure.unsaved')}</div>}
            </>
          )}
        </div>
        {/* FINISH */}
        {running && (
          <form style={base.card} onSubmit={finish}>
            <div style={base.cardTitle}>{t('live.finish.title')}</div>
            <div style={base.row}>
              <label style={{ ...base.field, ...base.half }}>
                <span style={base.label}>{t('live.finish.positionLabel')}</span>
                <input style={base.input} inputMode="numeric" value={finishPos} onChange={e => setFinishPos(typeChips(e.target.value))} />
              </label>
              <label style={{ ...base.field, ...base.half }}>
                <span style={base.label}>{t('live.finish.prize')} ({tour.currency})</span>
                <input style={base.input} inputMode="decimal" value={finishPrize} onChange={e => setFinishPrize(typeMoney(e.target.value))} placeholder="0" />
              </label>
            </div>
            {rebuyFlash && <div style={s.rebuyFlash}>🔁 {t('live.finish.rebuyDone', { n: rebuyFlash })}</div>}
            {confirmFinish ? (
              <div style={s.dayConfirmBox}>
                <div style={s.dayConfirmText}>{t('live.finish.confirm')}</div>
                <div style={{ ...base.actions, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button type="button" style={base.ghostBtn} onClick={() => setConfirmFinish(false)}>{t('common.cancel')}</button>
                  <button type="button" style={s.rebuyBtn} onClick={rebuy}>🔁 {t('live.finish.rebuy')}</button>
                  <button type="submit" style={base.btn}>{t('live.finish.button')}</button>
                </div>
              </div>
            ) : confirmNextDay ? (
              <div style={s.dayConfirmBox}>
                <div style={s.dayConfirmText}>{t('live.nextDayConfirm', { n: day + 1 })}</div>
                <div style={{ ...base.actions, justifyContent: 'center' }}>
                  <button type="button" style={base.ghostBtn} onClick={() => setConfirmNextDay(false)}>{t('common.cancel')}</button>
                  <button type="button" style={base.btn} onClick={nextDay}>🌙 {t('live.nextDayTitle', { n: day + 1 })}</button>
                </div>
              </div>
            ) : (
              <div style={{ ...base.actions, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <button type="button" style={base.ghostBtn} onClick={() => setConfirmNextDay(true)} title={t('live.nextDayTitle', { n: day + 1 })}>
                  🌙 {t('live.nextDay')}
                </button>
                <button style={base.btn} type="button" onClick={() => { setConfirmNextDay(false); setConfirmFinish(true) }}>{t('live.finish.button')}</button>
              </div>
            )}
          </form>
        )}

        {/* In-app confirmation: mobile browsers can silence window.confirm */}
        {confirmDelete ? (
          <div style={s.confirmBox}>
            <div style={s.confirmText}>{t('live.deleteConfirm')}</div>
            <div style={{ ...base.actions, justifyContent: 'center' }}>
              <button style={base.ghostBtn} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
              <button style={s.confirmDeleteBtn} onClick={handleDelete}>{t('live.delete')}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex' }}>
            <button style={{ ...base.ghostBtn, flex: 1, padding: '13px 14px', fontSize: 14, color: '#e07070', border: '1px solid rgba(160,30,30,0.35)' }} onClick={() => setConfirmDelete(true)}>
              {t('live.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Header({ navigate, t }) {
  return (
    <div style={base.header}>
      <Logo onClick={() => navigate('/')} title={t('nav.goHome')} />
      <button style={base.ghostBtn} onClick={() => navigate('/live')}>← {t('live.title')}</button>
    </div>
  )
}

// Same look as the hand player buttons in the Visualizer
function CtrlButton({ icon, caption, title, active, disabled, onClick }) {
  return (
    <div style={s.ctrlCol}>
      <button style={{ ...s.ctrlBtn, ...(active ? s.ctrlBtnPlaying : null), ...(disabled ? s.ctrlBtnDisabled : null) }}
        disabled={disabled} onClick={onClick} title={title} aria-label={title}>
        {icon}
      </button>
      <span style={s.ctrlCaption}>{caption}</span>
    </div>
  )
}

// Centred dialog; closes with Esc or a tap outside
function Modal({ title, onClose, closeLabel, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <span style={base.cardTitle}>{title}</span>
          <button style={s.modalClose} onClick={onClose} aria-label={closeLabel} title={closeLabel}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Stat({ label, value, big, sub, subColor, accent, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag style={{ ...s.stat, ...(onClick ? s.statBtn : null) }} onClick={onClick ?? undefined}>
      <div style={base.label}>{label}</div>
      {big && <div style={{ ...s.statBig, color: accent }}>{big}</div>}
      <div style={big ? s.statValueSmall : s.statValue}>{value}</div>
      {sub && <div style={{ ...s.statSub, ...(subColor ? { color: subColor, fontWeight: 700 } : null) }}>{sub}</div>}
    </Tag>
  )
}

const s = {
  clockCard: {
    ...base.card,
    alignItems: 'center', textAlign: 'center', gap: 6, padding: '18px 16px',
  },
  clockCardBreak: { borderColor: '#6a5420', background: 'linear-gradient(160deg, #241f14 0%, #15130c 100%)' },
  clockCardFlash: { borderColor: '#50d080', boxShadow: '0 0 0 3px rgba(80,208,128,0.45), 0 20px 60px rgba(0,0,0,0.5)', transition: 'box-shadow 0.3s' },
  clockInfo: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 14px', fontSize: 12, fontWeight: 700, color: '#7a94b0' },
  clockUpdate: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, marginTop: 10, textAlign: 'center' },
  offlineBox: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12, lineHeight: 1.4,
    color: '#f0c070', background: 'rgba(240,160,64,0.1)', border: '1px solid rgba(240,160,64,0.35)', borderRadius: 10, padding: '10px 12px',
  },
  offlineBtn: {
    background: 'none', border: '1px solid rgba(240,160,64,0.5)', borderRadius: 8, color: '#f0c070',
    padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
  },
  statBtn: { cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', width: '100%' },
  preview: { fontSize: 12, color: '#7a94b0' },
  resultSub: { fontSize: 13, color: '#9ab4d0' },
  clockTop: { display: 'flex', alignItems: 'center', gap: 8 },
  levelLabel: { fontSize: 12, fontWeight: 800, color: '#5a8ab0', letterSpacing: '1.5px', textTransform: 'uppercase' },
  pausedTag: {
    fontSize: 10, fontWeight: 800, color: '#f0a040', border: '1px solid rgba(240,160,64,0.4)',
    borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '1px',
  },
  blinds: { fontSize: 30, fontWeight: 900, color: '#e8f0ff', letterSpacing: '0.5px' },
  clock: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
    fontSize: 56, fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
  },
  timeForm: { display: 'flex', gap: 6, alignItems: 'center', margin: '8px 0' },
  next: { fontSize: 12, color: '#4a6a8a' },
  clockBtns: { display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center' },
  ctrlCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 },
  // Same buttons as the hand player in the Visualizer
  ctrlBtn: {
    background: 'linear-gradient(to bottom,#cccccc 0%,#a2a2a2 100%)',
    border: '1px solid #787878', borderRadius: 10, color: '#1a1a1a',
    width: 52, height: 44, fontSize: 20, cursor: 'pointer', padding: 0,
    boxShadow: '0 3px 6px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.55)',
    transition: 'all 0.1s', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
  },
  ctrlBtnPlaying: {
    background: 'linear-gradient(to bottom,#3a8040 0%,#1e5028 100%)',
    color: '#a0ffa0', borderColor: '#2a6030',
  },
  ctrlBtnDisabled: {
    background: 'linear-gradient(to bottom,#3a3a3a 0%,#252525 100%)',
    color: '#484848', borderColor: '#303030', cursor: 'default', boxShadow: 'none',
  },
  ctrlCaption: { fontSize: 10, fontWeight: 700, color: '#4a6a8a', whiteSpace: 'nowrap' },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  stat: {
    background: 'rgba(16,24,38,0.85)', border: '1px solid #1e2e42', borderRadius: 12,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
  },
  statBig: { fontSize: 26, fontWeight: 900, lineHeight: 1.15 },
  statValue: { fontSize: 20, fontWeight: 800, color: '#e0ecff', overflow: 'hidden', textOverflow: 'ellipsis' },
  statValueSmall: { fontSize: 13, fontWeight: 700, color: '#a0b8d0' },
  statSub: { fontSize: 11, color: '#4a6a8a' },
  saved: { fontSize: 12, color: '#50d080', fontWeight: 700, alignSelf: 'center' },
  sectionToggle: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
    background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
  },
  table: { display: 'flex', flexDirection: 'column', gap: 4 },
  tr: { display: 'grid', gridTemplateColumns: '30px repeat(3, minmax(0, 1fr)) minmax(0, 0.7fr) 22px', gap: 5, alignItems: 'center', borderRadius: 8, padding: '2px 4px' },
  trCurrent: { background: 'rgba(30,92,173,0.25)', boxShadow: 'inset 0 0 0 1px #2a4a80' },
  th: { fontSize: 10, fontWeight: 800, color: '#3a5a7a', letterSpacing: '1px', textTransform: 'uppercase' },
  levelNo: {
    background: 'none', border: 'none', color: '#7ab0d8', fontWeight: 800, fontSize: 13,
    cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit',
  },
  cell: {
    background: '#080e18', border: '1px solid #1e2e42', borderRadius: 7, padding: '7px 8px',
    color: '#c8d4e8', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', minWidth: 0,
  },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#7ab0d8', cursor: 'pointer' },
  moreBtn: {
    alignSelf: 'center', background: 'none', border: '1px solid #24405e', borderRadius: 8,
    color: '#7ab0d8', fontSize: 12, fontWeight: 700, padding: '9px 14px', minHeight: 40, cursor: 'pointer',
  },
  structureActions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  unsaved: { fontSize: 11, color: '#f0a040', textAlign: 'right' },
  removeBtn: { background: 'none', border: 'none', color: '#5a4050', fontSize: 18, cursor: 'pointer', padding: 0 },
  hr: {
    display: 'grid', gridTemplateColumns: '46px 28px minmax(0, 1fr) 44px 52px 14px', gap: 6, alignItems: 'center',
    fontSize: 13, padding: '6px 4px', borderBottom: '1px solid #142030',
  },
  hrBtn: {
    width: '100%', background: 'none', border: 'none', borderBottom: '1px solid #142030', color: 'inherit',
    fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
  },
  breakRow: { background: 'rgba(240,192,112,0.07)', color: '#f0c070' },
  breakLabel: { gridColumn: '2 / 5', fontSize: 12, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase' },
  newHandBtn: {
    background: 'linear-gradient(135deg, #2a2210 0%, #1a1600 100%)', border: '1px solid #c8a800', borderRadius: 12,
    color: '#ffe566', padding: '14px 18px', fontSize: 16, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 4px 20px rgba(200,168,0,0.15)',
  },
  handRow: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    padding: '8px 0', borderBottom: '1px solid #142030',
  },
  handMain: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  handMeta: { fontSize: 11, color: '#5a7a9a', fontWeight: 600 },
  handNet: { fontSize: 14, fontWeight: 800 },
  // Full-width row of big tap targets (used from the phone at the table)
  handBtns: { display: 'flex', gap: 8, width: '100%' },
  iconBtn: {
    flex: '1 1 0', minWidth: 0, height: 46, fontSize: 18, borderRadius: 10, border: '1px solid #1e2e42', background: '#0a1422',
    color: '#7ab0d8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  shareBox: { width: '100%', fontSize: 11, color: '#50d080', wordBreak: 'break-all' },
  breakList: { fontSize: 12, color: '#f0c070' },
  daySep: {
    fontSize: 10, fontWeight: 800, color: '#7ab0d8', letterSpacing: '1px', textTransform: 'uppercase',
    padding: '10px 4px 4px', borderBottom: '1px solid #1e2e42',
  },
  hrSelected: { background: 'rgba(30,92,173,0.2)', borderRadius: 6 },
  editIcon: { color: '#3a5a7a', fontSize: 12, textAlign: 'right' },
  editRow: {
    display: 'flex', flexDirection: 'column', gap: 10, padding: 12, margin: '4px 0',
    background: 'rgba(30,92,173,0.12)', border: '1px solid #2a4a80', borderRadius: 10,
  },
  editHead: { fontSize: 11, fontWeight: 800, color: '#7ab0d8' },
  cardBtnRow: { display: 'flex', alignItems: 'center', gap: 10 },
  quickBtns: { display: 'flex', gap: 10 },
  quickBtn: { flex: '1 1 0', minWidth: 0, padding: '14px 10px', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tableBtn: {
    background: 'linear-gradient(135deg, #12223a 0%, #0c1626 100%)', border: '1px solid #2a4a80', borderRadius: 12,
    color: '#9ac8f0', fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
  },
  bigBtn: { flex: 1, padding: '13px 14px', fontSize: 14 },
  modalSection: { display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #1e2e42', paddingTop: 12 },
  breakBtn: { flex: 1, padding: '11px 14px', fontSize: 13, color: '#f0c070', borderColor: 'rgba(240,192,112,0.35)' },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(3px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  modal: {
    ...base.card, width: 'min(560px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box',
  },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  modalClose: { background: 'none', border: 'none', color: '#5a7a9a', fontSize: 18, cursor: 'pointer', padding: 4, lineHeight: 1 },
  modalForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  dangerBtn: { color: '#e07070', border: '1px solid rgba(160,30,30,0.35)' },

  resultCard: {
    ...base.card, alignItems: 'center', textAlign: 'center', gap: 8,
    borderColor: '#2a6a3a', background: 'linear-gradient(160deg, #142a1c 0%, #0c1a12 100%)',
  },
  resultMain: { fontSize: 22, fontWeight: 900, color: '#50d080' },
  resultPrize: { fontSize: 14, fontWeight: 700, color: '#c8e8d0' },
  breakGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, alignItems: 'end' },
  confirmBox: {
    display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', borderRadius: 12,
    background: 'rgba(160,30,30,0.12)', border: '1px solid rgba(160,30,30,0.4)',
  },
  confirmText: { fontSize: 14, fontWeight: 700, color: '#f0b0b0', textAlign: 'center', lineHeight: 1.4 },
  confirmDeleteBtn: {
    background: 'linear-gradient(135deg, #a02828 0%, #701818 100%)', border: '1px solid #c04040', borderRadius: 9,
    padding: '10px 18px', color: '#ffe0e0', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  dayConfirmBox: {
    display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', borderRadius: 12,
    background: 'rgba(30,92,173,0.12)', border: '1px solid #2a4a80',
  },
  entriesTag: { color: '#7ab0d8', fontWeight: 800 },
  rebuyFlash: { fontSize: 13, fontWeight: 700, color: '#50d080', textAlign: 'center' },
  rebuyBtn: {
    background: 'linear-gradient(135deg, #2a2210 0%, #1a1600 100%)', border: '1px solid #c8a800', borderRadius: 9,
    padding: '10px 18px', color: '#ffe566', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  dayConfirmText: { fontSize: 14, fontWeight: 700, color: '#c8d8f0', textAlign: 'center', lineHeight: 1.4 },
}
