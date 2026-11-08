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
  levelAt, levelMinutes, breakMinutes, extrapolateLevel, recalcAfter, addBreaks, editLevelValue, isPaused, remainingSeconds, advanceClock, setLevelClock,
  averageStack, inBigBlinds, formatClock, parseChips,
} from '../lib/liveTournament'
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
  const [brk, setBrk] = useState({ after: '', minutes: '15', every: '' }) // "add break" form
  const [breakAdded, setBreakAdded] = useState(false)
  const [editIdx, setEditIdx]   = useState(null) // history entry being corrected
  const [editVals, setEditVals] = useState({ stack: '', players: '', entries: '' })
  const editRef = useRef(null)
  const [finishPos, setFinishPos]     = useState('')
  const [finishPrize, setFinishPrize] = useState('')

  useEffect(() => {
    fetchLiveTournament(id)
      .then(row => {
        if (!row) { setStatus('notFound'); return }
        setTour(row)
        setStatus('ready')
        if (!row.tournament_db_id) {
          ensureLiveTournamentRow(row).then(dbId => {
            if (dbId) setTour(prev => (prev ? { ...prev, tournament_db_id: dbId } : prev))
          })
        }
      })
      .catch(() => setStatus('error'))
  }, [id])

  const tourRef = useRef(null)
  useEffect(() => { tourRef.current = tour }, [tour])

  // Hands recorded in this tournament (rows in `hands` under its tournaments row)
  const [hands, setHands] = useState([])
  const [sharedHand, setSharedHand] = useState(null) // { id, url } of the last shared hand
  const tournamentDbId = tour?.tournament_db_id
  useEffect(() => {
    if (!tournamentDbId) return
    fetchLiveHands(tournamentDbId).then(setHands).catch(() => {})
  }, [tournamentDbId])

  // Ticks every second; when the level's time runs out the clock moves on to the next level by itself
  useEffect(() => {
    const iv = setInterval(() => {
      const ts = Date.now()
      setNow(ts)
      const cur = tourRef.current
      const advance = cur && advanceClock(cur, ts)
      if (!advance) return
      tourRef.current = { ...cur, ...advance }
      setTour(prev => ({ ...prev, ...advance }))
      updateLiveTournament(id, advance).catch(() => setError(t('live.saveError')))
    }, 1000)
    return () => clearInterval(iv)
  }, [id, t])

  // Saves locally at once and in the database in the background
  function patch(fields) {
    tourRef.current = { ...tourRef.current, ...fields } // so quick repeated taps build on each other
    setTour(prev => ({ ...prev, ...fields }))
    setError('')
    return updateLiveTournament(id, fields).catch(() => setError(t('live.saveError')))
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
  const totalChips = tour.entries && tour.starting_stack ? tour.entries * tour.starting_stack : null

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

  // Moves the clock by whole minutes (the − button down to 0, which ends the level if the clock is running)
  function adjustTime(deltaSeconds) {
    const cur = tourRef.current
    patch(setLevelClock(cur, cur.current_level, Math.max(0, remainingSeconds(cur) + deltaSeconds), undefined, !!cur.on_break))
  }

  function togglePause() {
    patch(paused
      ? { paused_remaining: null, level_ends_at: new Date(now + remaining * 1000).toISOString() }
      : { paused_remaining: remaining, level_ends_at: null })
  }

  function saveTime(e) {
    e.preventDefault()
    const minutes = parseFloat(String(timeIn).replace(',', '.'))
    if (Number.isFinite(minutes) && minutes >= 0) patch(setLevelClock(tour, levelNo, Math.round(minutes * 60), now, onBreak))
    setEditingTime(false)
  }

  function saveUpdate(e) {
    e.preventDefault()
    const stack   = parseChips(stackIn)   ?? tour.my_stack
    const players = parseChips(playersIn) ?? tour.players_left
    const entries = parseChips(entriesIn) ?? tour.entries
    patch({
      my_stack: stack,
      players_left: players,
      entries,
      history: [...tour.history, { at: new Date().toISOString(), day, level: playLevel, stack, players, entries }],
    })
    setStackIn(''); setPlayersIn(''); setEntriesIn('')
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
      prize_won: parseFloat(String(finishPrize).replace(',', '.')) || null,
      paused_remaining: remaining,
      level_ends_at: null,
    }).then(() => syncLiveTournamentRow(tourRef.current))
  }

  async function handleDelete() {
    setConfirmDelete(false)
    try {
      // Its tournaments row goes too, with the recorded hands
      if (tour.tournament_db_id) await deleteTournament(tour.tournament_db_id, tour.user_id)
      await deleteLiveTournament(id)
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

  // Opens the edit panel under the chart in the update modal (from a chart point or a history row)
  function startEdit(idx, scroll = false) {
    const h = tour.history[idx]
    setEditVals({ stack: h.stack ?? '', players: h.players ?? '', entries: h.entries ?? '' })
    setEditIdx(idx)
    setShowUpdate(true)
    if (scroll) requestAnimationFrame(() => editRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  function closeUpdate() {
    setShowUpdate(false)
    setEditIdx(null)
  }

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
    patch({ history: newHistory, ...(idx === tour.history.length - 1 ? syncCurrent(newHistory) : null) })
    setEditIdx(null)
  }

  return (
    <div style={base.page}>
      <Header navigate={navigate} t={t} />

      <div style={base.content}>
        <div>
          <div style={base.title}>{tour.name}</div>
          <div style={base.subtitle}>
            {tour.venue} · {t('live.form.buyin')} {fmtNumber(tour.buyin)}{tour.currency} · {t('live.levelMinutesShort', { n: levelMinutes(tour, levelNo) })}
          </div>
        </div>

        {error && <div style={base.error}>{error}</div>}

        {!running && (
          <div style={s.resultCard}>
            <div style={s.resultMain}>
              {tour.finish_position ? t('live.finish.position', { pos: tour.finish_position }) : t('live.finished')}
            </div>
            {tour.prize_won > 0 && (
              <div style={s.resultPrize}>{t('live.finish.prize')}: {fmtNumber(tour.prize_won)}{tour.currency}</div>
            )}
            <button style={base.ghostBtn} onClick={() => patch({ status: 'running' }).then(() => syncLiveTournamentRow(tourRef.current))}>{t('live.finish.reopen')}</button>
          </div>
        )}

        {/* CLOCK */}
        <div style={{ ...s.clockCard, ...(onBreak ? s.clockCardBreak : null) }}>
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
                <input style={{ ...base.input, width: 110, textAlign: 'center' }} type="number" min="0" step="any"
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
          {running && (
            <div style={s.clockBtns}>
              <CtrlButton icon={'⏮\uFE0E'} caption={t('live.structure.level')} title={t('live.prevLevel')}
                disabled={levelNo <= 1 && !onBreak} onClick={goPrev} />
              <CtrlButton icon={'⏪\uFE0E'} caption="−1 min" title={t('live.minusMinute')}
                disabled={remaining <= 0} onClick={() => adjustTime(-60)} />
              <CtrlButton icon={paused ? '▶\uFE0E' : '⏸\uFE0E'} caption={paused ? t('live.resume') : t('live.pause')}
                title={paused ? t('live.resume') : t('live.pause')} active={!paused} onClick={togglePause} />
              <CtrlButton icon={'⏩\uFE0E'} caption="+1 min" title={t('live.plusMinute')} onClick={() => adjustTime(60)} />
              <CtrlButton icon={'⏭\uFE0E'} caption={breakNext > 0 ? t('live.break') : t('live.structure.level')}
                title={breakNext > 0 ? t('live.goToBreak') : t('live.nextLevelBtn')} onClick={goNext} />
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
          <Stat label={t('live.stats.myStack')} value={tour.my_stack != null ? fmtNumber(tour.my_stack) : '—'}
            big={t('live.stats.bb', { n: fmtBB(myBB) })} accent={myBB != null && myBB < 15 ? '#f0a040' : '#50d080'}
            sub={pctAvg != null ? t('live.stats.ofAverage', { pct: pctAvg }) : null} />
          <Stat label={t('live.stats.average')} value={avg != null ? fmtNumber(Math.round(avg)) : '—'}
            big={t('live.stats.bb', { n: fmtBB(avgBB) })} accent="#60b0ff"
            sub={avg == null ? t('live.stats.averageHint') : null} />
          <Stat label={t('live.stats.players')}
            value={tour.players_left != null ? `${fmtNumber(tour.players_left)}${tour.entries ? ` / ${fmtNumber(tour.entries)}` : ''}` : '—'} />
          <Stat label={t('live.stats.chips')} value={totalChips != null ? fmtNumber(totalChips) : '—'}
            sub={t('live.stats.startingStack', { n: fmtNumber(tour.starting_stack) })} />
        </div>

        {/* STACK: opens the chart + update modal */}
        <div style={s.cardBtnRow}>
          {savedFlash && <span style={s.saved}>✓ {t('live.update.saved')}</span>}
          <button style={{ ...base.btn, ...s.bigBtn }} onClick={() => setShowUpdate(true)}>
            📈 {running ? t('live.update.button') : t('live.history.chartTitle')}
          </button>
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

        {/* UPDATE modal: stack chart (tap a point to correct it) + new update */}
        {showUpdate && (
          <Modal title={running ? t('live.update.button') : t('live.history.chartTitle')} onClose={closeUpdate} closeLabel={t('common.cancel')}>
            {tour.history.length === 0 ? (
              <div style={base.hint}>{t('live.history.empty')}</div>
            ) : (
              <>
                <StackChart points={chartPoints} locale={locale} labels={{
                  title: t('live.history.chartTitle'), stack: t('live.stats.myStack'),
                  average: t('live.stats.average'), level: t('live.structure.level'),
                  day: n => t('live.day', { n }),
                }} multiDay={multiDay} selected={editIdx} onSelect={startEdit} />
                {editing ? (
                  <form key={editIdx} ref={editRef} style={s.editRow} onSubmit={saveHistoryEdit}>
                    <div style={s.editHead}>
                      {new Date(editing.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} · {t('live.level', { n: editing.level })}
                    </div>
                    <div style={base.row}>
                      {[['stack', t('live.update.stack')], ['players', t('live.update.players')], ['entries', t('live.update.entries')]].map(([k, label]) => (
                        <label key={k} style={{ ...base.field, flex: k === 'stack' ? '1 1 120px' : '1 1 80px', minWidth: 0 }}>
                          <span style={base.label}>{label}</span>
                          <input style={base.input} inputMode="numeric" value={editVals[k]}
                            autoFocus={k === 'stack'} onFocus={e => e.target.select()} onChange={e => setEditVals(v => ({ ...v, [k]: e.target.value }))} />
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
                ) : (
                  <div style={base.hint}>{t('live.history.editHint')}</div>
                )}
              </>
            )}
            {running && !editing && (
              <form style={{ ...s.modalForm, ...s.modalUpdate }} onSubmit={saveUpdate}>
                <div style={base.row}>
                  <label style={{ ...base.field, flex: '1 1 140px', minWidth: 0 }}>
                    <span style={base.label}>{t('live.update.stack')}</span>
                    <input style={base.input} inputMode="numeric" value={stackIn} onChange={e => setStackIn(e.target.value)}
                      placeholder={tour.my_stack != null ? fmtNumber(tour.my_stack) : ''} />
                  </label>
                  <label style={{ ...base.field, flex: '1 1 100px', minWidth: 0 }}>
                    <span style={base.label}>{t('live.update.players')}</span>
                    <input style={base.input} inputMode="numeric" value={playersIn} onChange={e => setPlayersIn(e.target.value)}
                      placeholder={tour.players_left != null ? String(tour.players_left) : ''} />
                  </label>
                  <label style={{ ...base.field, flex: '1 1 100px', minWidth: 0 }}>
                    <span style={base.label}>{t('live.update.entries')}</span>
                    <input style={base.input} inputMode="numeric" value={entriesIn} onChange={e => setEntriesIn(e.target.value)}
                      placeholder={tour.entries != null ? String(tour.entries) : ''} />
                  </label>
                </div>
                <div style={base.actions}>
                  <button style={base.ghostBtn} type="button" onClick={closeUpdate}>{t('common.cancel')}</button>
                  <button style={base.btn} type="submit" disabled={!stackIn && !playersIn && !entriesIn}>
                    {t('live.update.save')}
                  </button>
                </div>
              </form>
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
              <div style={s.table}>
                <div style={{ ...s.tr, ...s.th }}>
                  <span title={t('live.structure.level')}>#</span>
                  <span title={t('live.structure.sbFull')}>SB</span>
                  <span title={t('live.structure.bbFull')}>BB</span>
                  <span>Ante</span>
                  <span title={t('live.structure.minutesFull')}>Min</span>
                  <span />
                </div>
                {rows.map((l, i) => (
                  <Fragment key={i}>
                  <div style={{ ...s.tr, ...(i + 1 === playLevel && !onBreak ? s.trCurrent : null) }}>
                    <button style={s.levelNo} onClick={() => running && goToLevel(i + 1)} title={t('live.structure.goTo')}>
                      {i + 1}
                    </button>
                    {['sb', 'bb', 'ante'].map(k => (
                      <input key={k} style={s.cell} inputMode="numeric" value={l[k] ? fmtNumber(l[k]) : ''}
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
              <div style={s.structureActions}>
                <button style={base.ghostBtn}
                  onClick={() => setDraft([...rows, extrapolateLevel(rows[rows.length - 1])])}>
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
        {/* HISTORY */}
        {tour.history.length > 0 && (
          <div style={base.card}>
            <div style={base.cardTitle}>{t('live.history.title')}</div>
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

        {/* FINISH */}
        {running && (
          <form style={base.card} onSubmit={finish}>
            <div style={base.cardTitle}>{t('live.finish.title')}</div>
            <div style={base.row}>
              <label style={{ ...base.field, ...base.half }}>
                <span style={base.label}>{t('live.finish.positionLabel')}</span>
                <input style={base.input} inputMode="numeric" value={finishPos} onChange={e => setFinishPos(e.target.value)} />
              </label>
              <label style={{ ...base.field, ...base.half }}>
                <span style={base.label}>{t('live.finish.prize')} ({tour.currency})</span>
                <input style={base.input} inputMode="decimal" value={finishPrize} onChange={e => setFinishPrize(e.target.value)} placeholder="0" />
              </label>
            </div>
            {confirmNextDay ? (
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
                <button style={base.btn} type="submit">{t('live.finish.button')}</button>
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
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button style={{ ...base.ghostBtn, color: '#e07070', border: '1px solid rgba(160,30,30,0.35)' }} onClick={() => setConfirmDelete(true)}>
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

function Stat({ label, value, big, sub, accent }) {
  return (
    <div style={s.stat}>
      <div style={base.label}>{label}</div>
      {big && <div style={{ ...s.statBig, color: accent }}>{big}</div>}
      <div style={big ? s.statValueSmall : s.statValue}>{value}</div>
      {sub && <div style={s.statSub}>{sub}</div>}
    </div>
  )
}

const s = {
  clockCard: {
    ...base.card,
    alignItems: 'center', textAlign: 'center', gap: 6, padding: '18px 16px',
  },
  clockCardBreak: { borderColor: '#6a5420', background: 'linear-gradient(160deg, #241f14 0%, #15130c 100%)' },
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
  handBtns: { display: 'flex', gap: 4 },
  iconBtn: {
    width: 34, height: 34, borderRadius: 8, border: '1px solid #1e2e42', background: '#0a1422',
    color: '#7ab0d8', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
  modalUpdate: { borderTop: '1px solid #1e2e42', paddingTop: 12 },
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
  dayConfirmText: { fontSize: 14, fontWeight: 700, color: '#c8d8f0', textAlign: 'center', lineHeight: 1.4 },
}
