import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n, fmtNumber } from '../i18n/core'
import {
  fetchLiveTournament, updateLiveTournament, ensureLiveTournamentRow, insertLiveHand, updateLiveHand,
  fetchLiveHand, generateHandShareToken, fetchPlayerNotes, savePlayerNote,
} from '../lib/db'
import { TABLE_SIZES, currentTable, findTable, physicalSeat, noteAtSeat, noteByName, saveSeatNote, applySaved } from '../lib/liveTable'
import { levelAt } from '../lib/liveTournament'
import {
  positionLabels, seatLayout, replay, legalActions, foldsUntil, usedCards, potTotal, buildRawHand,
  canAutoResolve, playerNames,
} from '../lib/liveHand'
import Logo from '../components/Logo'
import LiveTable from '../components/table/LiveTable'
import CardPicker from '../components/table/CardPicker'
import { Card, CardBack } from '../components/table/Cards'
import { base } from '../components/liveStyles'
import BottomSheet from '../components/BottomSheet'
import NoteTags from '../components/NoteTags'

const STREET_KEYS = { flop: 'live.hand.flop', turn: 'live.hand.turn', river: 'live.hand.river' }

// A hand being recorded is kept on the phone until it's saved: leaving the page, a reload or the phone
// locking doesn't lose it
const draftKey = id => `live-hand-draft:${id}`
function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(draftKey(id)) ?? 'null') } catch { return null }
}
function writeDraft(id, draft) {
  try {
    if (draft) localStorage.setItem(draftKey(id), JSON.stringify(draft))
    else localStorage.removeItem(draftKey(id))
  } catch { /* storage unavailable */ }
}

const emptyPlayers = n => Array.from({ length: n }, () => ({ name: '', stack: null, cards: null }))

// Sits the hand at one of your tables: as many players as seats, each rival with their physical seat and,
// if you have a note on whoever sits there, their name. `table` null = no table (players keep no seat).
function atTable(setup, table, notes) {
  if (!table) return { ...setup, tableNo: null, players: setup.players.map(p => ({ ...p, seat: undefined })) }
  const n = table.seats
  const labels = positionLabels(n)
  return {
    ...setup, n, tableNo: table.no,
    heroPos: labels.includes(setup.heroPos) ? setup.heroPos : labels[0],
    players: Array.from({ length: n }, (_, i) => {
      const p = setup.players[i] ?? { name: '', stack: null, cards: null }
      if (i === 0) return p
      const seat = physicalSeat(table, i)
      return { ...p, seat, name: noteAtSeat(notes, table.no, seat)?.name ?? '' }
    }),
  }
}

// Records a live hand: setup → seats → play the action → save into `hands` (see lib/liveHand.js)
export default function LiveHandRecorder() {
  const { id, handDbId } = useParams()
  const navigate = useNavigate()
  const { t, locale } = useI18n()

  const [tour, setTour]     = useState(null)
  const [notes, setNotes]   = useState([])      // player_notes of this tournament
  const [status, setStatus] = useState('loading')
  const [step, setStep]     = useState('setup') // setup | table | play | saved
  const [setup, setSetup]   = useState(null)
  const [level, setLevel]   = useState(1)
  const [log, setLog]       = useState([])
  const [meta, setMeta]     = useState(null)    // id/date of the hand being edited
  const [picker, setPicker] = useState(null)    // { title, count, initial, onDone, allowEmpty }
  const [seatSheet, setSeatSheet] = useState(null) // index of the seat being edited
  const [amount, setAmount] = useState('')      // bet/raise input
  const [showdownCards, setShowdownCards] = useState({})
  const [manualWinners, setManualWinners] = useState([])
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState(null)
  const [error, setError]   = useState('')
  const [shareMsg, setShareMsg] = useState('')
  const [stackUpdated, setStackUpdated] = useState(false)
  const [savedDraft, setSavedDraft] = useState(null) // unsaved hand found when opening a new one

  useEffect(() => {
    async function load() {
      try {
        const row = await fetchLiveTournament(id)
        if (!row) { setStatus('notFound'); return }
        setTour(row)
        const ns = await fetchPlayerNotes(row.id).catch(() => []) // table missing until the migration runs
        setNotes(ns)
        if (handDbId) {
          const hand = await fetchLiveHand(handDbId)
          const live = hand.raw?.live
          if (!live) { setStatus('notFound'); return }
          setSetup(live.setup)
          setLog(live.log)
          setLevel(Number(hand.raw.level) || row.current_level)
          setMeta({ id: hand.raw.id, date: hand.raw.datetime, day: hand.raw.day })
          setStep('play')
        } else {
          setSavedDraft(readDraft(row.id))
          const playLevel = row.on_break ? row.current_level + 1 : row.current_level
          const l = levelAt(row.structure, playLevel)
          setLevel(playLevel)
          // The hand is played at the table you're at now (you can pick another one in the setup)
          setSetup(atTable({
            n: 9, heroPos: 'BTN', sb: l.sb, bb: l.bb, ante: l.ante || 0, anteType: 'bb',
            players: [{ name: 'Hero', stack: row.my_stack ?? null, cards: null }, ...emptyPlayers(8)],
            revealHoleCards: false,
          }, currentTable(row), ns))
        }
        setStatus('ready')
      } catch {
        setStatus('error')
      }
    }
    load()
  }, [id, handDbId])

  // Keeps the hand being recorded (not an edit of a saved one) on the phone while it's in progress
  useEffect(() => {
    if (handDbId || !setup || (step !== 'table' && step !== 'play')) return
    writeDraft(id, { setup, log, level, step, showdownCards, manualWinners, at: new Date().toISOString() })
  }, [id, handDbId, setup, log, level, step, showdownCards, manualWinners])

  const st = useMemo(() => (setup && step !== 'setup' && step !== 'table' ? replay(setup, log) : null), [setup, log, step])
  // Stack after the hand (what's left plus what was won)
  const finalStack = i => (st?.result ? st.stack[i] + (st.result.winnings[i] ?? 0) : st?.stack[i])
  const names = useMemo(() => (setup ? playerNames(setup) : []), [setup])
  const layout = useMemo(() => (setup ? seatLayout(setup.n, setup.heroPos) : null), [setup])
  // Note on a rival: by their name, or the one on their seat (if it has no name yet or you left the name empty)
  const noteFor = p => {
    const byName = noteByName(notes, p?.name)
    if (byName) return byName
    const bySeat = setup?.tableNo != null ? noteAtSeat(notes, setup.tableNo, p?.seat) : null
    return bySeat && (!bySeat.name || !p.name?.trim()) ? bySeat : null
  }

  async function storeNote(p, note) {
    try {
      if (setup.tableNo != null && p.seat) {
        const res = await saveSeatNote({
          userId: tour.user_id, tourId: tour.id, notes, tableNo: setup.tableNo, seat: p.seat, name: p.name, note,
          leftName: t('live.notes.seatN', { n: p.seat }),
        })
        setNotes(ns => applySaved(ns, res))
      } else {
        const saved = await savePlayerNote(tour.user_id, tour.id, p.name, note)
        setNotes(ns => applySaved(ns, { saved }))
      }
    } catch {
      setError(t('live.notes.saveError'))
    }
  }

  if (status !== 'ready') {
    return (
      <div style={base.page}>
        <Header navigate={navigate} t={t} id={id} />
        <div style={base.content}>
          <div style={status === 'loading' ? base.muted : base.error}>
            {status === 'loading' ? t('common.loading') : status === 'notFound' ? t('live.notFound') : t('live.loadError')}
          </div>
        </div>
      </div>
    )
  }

  const updateSetup = patch => setSetup(s => ({ ...s, ...patch }))
  const updatePlayer = (i, patch) => setSetup(s => ({ ...s, players: s.players.map((p, k) => (k === i ? { ...p, ...patch } : p)) }))

  function changeLevel(value) {
    const n = Math.max(1, parseInt(value, 10) || 1)
    setLevel(n)
    const l = levelAt(tour.structure, n)
    updateSetup({ sb: l.sb, bb: l.bb, ante: l.ante || 0 })
  }

  function changeTableSize(n) {
    const labels = positionLabels(n)
    const table = findTable(tour, setup.tableNo)
    setSetup(s => ({
      ...s, n,
      heroPos: labels.includes(s.heroPos) ? s.heroPos : labels[0],
      players: Array.from({ length: n }, (_, i) => {
        if (s.players[i]) return s.players[i]
        if (!table) return { name: '', stack: null, cards: null }
        const seat = physicalSeat(table, i)
        return { name: noteAtSeat(notes, table.no, seat)?.name ?? '', stack: null, cards: null, seat }
      }),
    }))
  }

  const chooseTable = no => setSetup(s => atTable(s, findTable(tour, no), notes))

  function openPicker(opts) { setPicker(opts) }

  // ── Table seats for LiveTable ──
  function tableSeats() {
    return setup.players.map((p, i) => {
      const playing = !!st
      const shown = st?.shown?.[i] ?? showdownCards[i]
      const cards = shown ?? p.cards
      const showCards = i === 0 || setup.revealHoleCards || !!shown || (st?.need?.type === 'done' && !!cards)
      return {
        name: i === 0 ? t('live.hand.me') : (p.name?.trim() || '—'),
        pos: layout.labels[i],
        stack: playing ? finalStack(i) : p.stack,
        stackUnknown: playing ? st.startStack[i] >= 1e12 : !(p.stack > 0) && i !== 0,
        cards, showCards,
        folded: playing && st.folded[i],
        allin: playing && st.allin[i],
        bet: playing && !st.result ? st.committed[i] : 0,
        active: playing && st.need?.type === 'action' && st.need.player === i,
        winner: playing && st.result && (st.result.winnings[i] ?? 0) > 0,
        hasNote: i !== 0 && !!noteFor(p)?.note,
      }
    })
  }

  // ── Actions ──
  const push = entries => { setLog(l => [...l, ...entries]); setAmount('') }
  const undo = () => {
    if (log.length === 0) { setStep('table'); return }
    setLog(l => l.slice(0, -1))
    setAmount('')
  }

  function onSeatClick(i) {
    if (step === 'table' || step === 'setup') { setSeatSheet(i); return }
    if (st?.need?.type === 'action' && i !== st.need.player) {
      const folds = foldsUntil(st, i)
      if (folds.length) push(folds.map(p => ({ type: 'action', player: p, kind: 'fold' })))
    }
  }

  function act(kind, to) {
    push([{ type: 'action', player: st.need.player, kind, ...(to != null ? { to } : null) }])
  }

  async function save() {
    setSaving(true); setError('')
    try {
      const tournamentDbId = tour.tournament_db_id || await ensureLiveTournamentRow(tour)
      if (!tournamentDbId) throw new Error('no tournament row')
      const raw = buildRawHand(setup, log, {
        id: meta?.id ?? `L${Date.now()}`,
        tournamentId: `live-${tour.id}`,
        tournamentName: `${tour.name} · ${tour.venue}`,
        level,
        day: meta?.day ?? tour.day ?? 1,
        date: meta?.date ? new Date(meta.date.replace(/\//g, '-')) : new Date(),
      })
      if (handDbId) { await updateLiveHand(raw, handDbId, tournamentDbId); setSavedId(handDbId) }
      else setSavedId(await insertLiveHand(raw, tournamentDbId))
      setTour(tr => ({ ...tr, tournament_db_id: tournamentDbId }))
      if (!handDbId) writeDraft(id, null)
      setStep('saved')
    } catch {
      setError(t('live.hand.saveError'))
    } finally {
      setSaving(false)
    }
  }

  async function share() {
    try {
      const token = await generateHandShareToken(savedId)
      const url = `${window.location.origin}/hand-share/${token}`
      try { await navigator.clipboard.writeText(url) } catch { /* clipboard unavailable */ }
      setShareMsg(url)
    } catch {
      setError(t('live.saveError'))
    }
  }

  // After the hand, update the tournament's stack with the hero's final stack
  async function updateMyStack() {
    const stack = finalStack(0)
    const entry = { at: new Date().toISOString(), day: tour.day ?? 1, level, stack, players: tour.players_left, entries: tour.entries }
    try {
      await updateLiveTournament(tour.id, { my_stack: stack, history: [...(tour.history ?? []), entry] })
      setStackUpdated(true)
    } catch {
      setError(t('live.saveError'))
    }
  }

  function newHand() {
    setLog([]); setMeta(null); setShowdownCards({}); setManualWinners([]); setSavedId(null); setShareMsg(''); setStackUpdated(false)
    setSetup(s => ({
      ...s,
      players: s.players.map((p, i) => ({ ...p, cards: null, stack: i === 0 ? finalStack(0) : p.stack })),
    }))
    setStep('setup')
  }

  const heroCards = setup.players[0].cards

  function resumeDraft() {
    const d = savedDraft
    setSetup(d.setup); setLog(d.log ?? []); setLevel(d.level ?? level)
    setShowdownCards(d.showdownCards ?? {}); setManualWinners(d.manualWinners ?? [])
    setStep(d.step === 'play' ? 'play' : 'table')
    setSavedDraft(null)
  }

  function discardDraft() {
    writeDraft(id, null)
    setSavedDraft(null)
  }

  // Seat sheet: ‹ › walk round the table without closing it (skipping you)
  const seatNav = i => ({
    onPrev: () => setSeatSheet((i - 1 + setup.n) % setup.n || setup.n - 1),
    onNext: () => setSeatSheet((i + 1) % setup.n || 1),
    prevLabel: t('live.hand.prevSeat'), nextLabel: t('live.hand.nextSeat'),
  })

  const STEPS = ['setup', 'table', 'play']
  const stepIdx = STEPS.indexOf(step)
  const seatedNotes = step !== 'setup'
    ? setup.players.map((p, i) => ({ i, note: i ? noteFor(p) : null })).filter(x => x.note?.note)
    : []

  return (
    <div style={base.page}>
      <Header navigate={navigate} t={t} id={id} />
      <div style={base.content}>
        <div style={s.titleBlock}>
          <div style={base.title}>{handDbId ? t('live.hand.editTitle') : t('live.hand.newTitle')}</div>
          <div style={base.subtitle}>
            {tour.name} · {t('live.level', { n: level })} · {fmtNumber(setup.sb)}/{fmtNumber(setup.bb)}{setup.ante ? ` (${fmtNumber(setup.ante)})` : ''}
          </div>
        </div>

        {/* Where you are in the flow */}
        {!handDbId && stepIdx >= 0 && (
          <ol style={s.stepper} aria-label={t('live.hand.stepsLabel')}>
            {STEPS.map((k, n) => (
              <li key={k} style={{ ...s.stepItem, ...(n === stepIdx ? s.stepNow : n < stepIdx ? s.stepDone : null) }}
                aria-current={n === stepIdx ? 'step' : undefined}>
                <span style={{ ...s.stepDot, ...(n === stepIdx ? s.stepDotNow : n < stepIdx ? s.stepDotDone : null) }}>{n < stepIdx ? '✓' : n + 1}</span>
                <span style={s.stepLabel}>{t(`live.hand.steps.${k}`)}</span>
              </li>
            ))}
          </ol>
        )}

        {error && <div style={base.error}>{error}</div>}

        {/* Unsaved hand from before: carry on with it or drop it */}
        {step === 'setup' && savedDraft && (
          <div style={s.draftBox}>
            <div style={s.draftTitle}>{t('live.hand.draftTitle')}</div>
            <div style={s.draftMeta}>
              {savedDraft.setup?.players?.[0]?.cards && (
                <span style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle', marginRight: 6 }}>
                  {savedDraft.setup.players[0].cards.map(c => <Card key={c} code={c} size="xs" />)}
                </span>
              )}
              {t('live.level', { n: savedDraft.level })} · {savedDraft.setup?.heroPos}
              {' · '}{t('live.hand.draftActions', { n: (savedDraft.log ?? []).length })}
              {savedDraft.at && ` · ${new Date(savedDraft.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`}
            </div>
            <div style={s.ctaRow}>
              <button type="button" style={s.secondaryCta} onClick={discardDraft}>{t('live.hand.draftDiscard')}</button>
              <button type="button" style={s.primaryCta} onClick={resumeDraft}>{t('live.hand.draftResume')} →</button>
            </div>
          </div>
        )}

        {/* ── 1. SETUP ── */}
        {step === 'setup' && (
          <div style={base.card}>
            <div style={base.field}>
              <span style={base.label}>{t('live.hand.whichTable')}</span>
              <div style={s.chips}>
                {[...(tour.tables ?? [])].reverse().map(tb => (
                  <button key={tb.no} type="button" style={{ ...s.chip, ...(setup.tableNo === tb.no ? s.chipOn : null) }}
                    aria-pressed={setup.tableNo === tb.no} onClick={() => chooseTable(tb.no)}>{t('live.notes.tableN', { n: tb.no })}</button>
                ))}
                <button type="button" style={{ ...s.chip, ...(setup.tableNo == null ? s.chipOn : null) }}
                  aria-pressed={setup.tableNo == null} onClick={() => chooseTable(null)}>{t('live.hand.noTable')}</button>
                <button type="button" style={s.addChip} onClick={() => navigate(`/live/${id}/table`)}>+ {t('live.myTable.newTable')}</button>
              </div>
              {(tour.tables ?? []).length === 0 && <span style={base.hint}>{t('live.hand.noTablesHint')}</span>}
            </div>

            <div style={s.divider} />

            <div style={s.grid4}>
              <Field label={t('live.structure.level')}>
                <input style={{ ...base.input, ...s.num }} type="number" min="1" inputMode="numeric" value={level} onChange={e => changeLevel(e.target.value)} />
              </Field>
              <Field label="SB">
                <input style={{ ...base.input, ...s.num }} inputMode="numeric" value={chips(setup.sb)} onChange={e => updateSetup({ sb: num(e.target.value) })} />
              </Field>
              <Field label="BB">
                <input style={{ ...base.input, ...s.num }} inputMode="numeric" value={chips(setup.bb)} onChange={e => updateSetup({ bb: num(e.target.value) })} />
              </Field>
              <Field label="Ante">
                <input style={{ ...base.input, ...s.num }} inputMode="numeric" value={chips(setup.ante)} placeholder="0" onChange={e => updateSetup({ ante: num(e.target.value) })} />
              </Field>
            </div>
            {setup.ante > 0 && (
              <div style={s.segment} role="radiogroup">
                {['bb', 'all'].map(k => (
                  <button key={k} type="button" role="radio" aria-checked={setup.anteType === k}
                    style={{ ...s.segBtn, ...(setup.anteType === k ? s.segOn : null) }}
                    onClick={() => updateSetup({ anteType: k })}>{t(`live.hand.ante.${k}`)}</button>
                ))}
              </div>
            )}

            <div style={s.grid2}>
              <Field label={t('live.form.myStack')}>
                <input style={{ ...base.input, ...s.num }} inputMode="numeric" value={chips(setup.players[0].stack)}
                  onChange={e => updatePlayer(0, { stack: num(e.target.value) || null })} />
              </Field>
              <Field label={t('live.hand.tableSize')}>
                <select style={{ ...base.input, ...base.select }} value={setup.n} onChange={e => changeTableSize(Number(e.target.value))}>
                  {TABLE_SIZES.map(n => <option key={n} value={n}>{t('live.hand.players', { n })}</option>)}
                </select>
              </Field>
            </div>

            <div style={s.divider} />

            <div style={base.field}>
              <span style={base.label}>{t('live.hand.myPosition')}</span>
              <div style={{ ...s.posGrid, gridTemplateColumns: `repeat(${Math.min(setup.n, 5)}, minmax(0, 1fr))` }}>
                {positionLabels(setup.n).map(p => (
                  <button key={p} type="button" aria-pressed={setup.heroPos === p}
                    style={{ ...s.chip, ...s.posChip, ...(setup.heroPos === p ? s.chipOn : null) }}
                    onClick={() => updateSetup({ heroPos: p })}>{p}</button>
                ))}
              </div>
            </div>

            <div style={base.field}>
              <span style={base.label}>{t('live.hand.myCards')}</span>
              <button type="button" style={s.cardSlot} onClick={() => openPicker({
                title: t('live.hand.myCards'), count: 2, initial: heroCards ?? [],
                onDone: cards => updatePlayer(0, { cards: cards.length === 2 ? cards : null }),
              })}>
                {heroCards ? heroCards.map(c => <Card key={c} code={c} size="sm" />) : [0, 1].map(k => <CardBack key={k} size="sm" />)}
                <span style={s.slotHint}>{heroCards ? t('live.hand.change') : t('live.hand.pickCards')}</span>
              </button>
            </div>

            <label style={s.checkRow}>
              <input type="checkbox" style={s.checkbox} checked={!!setup.revealHoleCards} onChange={e => updateSetup({ revealHoleCards: e.target.checked })} />
              <span>{t('live.hand.revealHoleCards')}</span>
            </label>

            <button style={{ ...s.primaryCta, ...(setup.bb > 0 ? null : s.ctaDisabled) }} disabled={!(setup.bb > 0)} onClick={() => { setSavedDraft(null); setStep('table') }}>
              {t('live.hand.toTable')} →
            </button>
          </div>
        )}

        {/* ── 2. TABLE (who is sitting) / 3. PLAY ── */}
        {step !== 'setup' && (
          <div style={{ ...base.card, padding: '12px 8px', gap: 8 }}>
            <LiveTable
              seats={tableSeats()}
              dealer={layout.btn}
              board={st?.board}
              pot={st ? potTotal(st) : 0}
              potLabel={t('visualizer.totalPot')}
              onSeatClick={step === 'saved' ? null : onSeatClick}
            />
            {(step === 'table' || st?.need?.type === 'action') && (
              <div style={s.tableHint}>
                {step === 'table' ? t('live.hand.tableHint') : t('live.hand.foldHint')}
              </div>
            )}
          </div>
        )}

        {seatedNotes.length > 0 && (
          <div style={s.tableNotes}>
            <div style={{ ...base.label, color: '#a08040' }}>✎ {t('live.notes.atTable')}</div>
            {seatedNotes.map(({ i, note }) => (
              <button key={i} type="button" style={s.tableNote} onClick={step === 'saved' ? undefined : () => setSeatSheet(i)}
                disabled={step === 'saved'}>
                <span style={s.tableNotePos}>{layout.labels[i]}</span>
                <span style={{ minWidth: 0 }}>
                  <b style={{ color: '#f0c070' }}>{note.name || t('live.notes.seatN', { n: note.seat })}</b>
                  <span style={{ color: '#9ab4d0' }}> — {note.note}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 'table' && (
          <div style={s.ctaRow}>
            <button style={s.secondaryCta} onClick={() => setStep('setup')}>← {t('live.hand.back')}</button>
            <button style={s.primaryCta} onClick={() => { setLog([]); setStep('play') }}>▶ {t('live.hand.start')}</button>
          </div>
        )}

        {step === 'play' && st && (
          <ActionPanel
            st={st} setup={setup} names={names} layout={layout} t={t}
            amount={amount} setAmount={setAmount} act={act} push={push} undo={undo}
            openPicker={openPicker} showdownCards={showdownCards} setShowdownCards={setShowdownCards}
            manualWinners={manualWinners} setManualWinners={setManualWinners}
            onSave={save} saving={saving}
          />
        )}

        {step === 'saved' && (
          <div style={base.card}>
            <div style={s.savedTitle}>✓ {t('live.hand.saved')}</div>
            <ResultLine st={st} names={names} t={t} />
            {!stackUpdated && finalStack(0) !== tour.my_stack && (
              <button style={s.stackCta} onClick={updateMyStack}>
                <span style={{ fontSize: 18 }}>⟳</span>
                <span>{t('live.hand.updateStack', { n: fmtNumber(finalStack(0)) })}</span>
              </button>
            )}
            {stackUpdated && <div style={s.ok}>✓ {t('live.hand.stackUpdated', { n: fmtNumber(finalStack(0)) })}</div>}
            {shareMsg && <div style={s.shareBox}>{t('common.linkCopied')}<br /><span style={s.shareUrl}>{shareMsg}</span></div>}
            <div style={s.grid2}>
              <button style={s.secondaryCta} onClick={share}>🔗 {t('common.share')}</button>
              <button style={s.secondaryCta} onClick={() => navigate(`/tournament/${tour.tournament_db_id}`, { state: { handDbId: savedId } })}>
                ▶ {t('live.hand.viewShort')}
              </button>
            </div>
            {!handDbId && <button style={s.primaryCta} onClick={newHand}>+ {t('live.hand.another')}</button>}
            <button style={s.linkBtn} onClick={() => navigate(`/live/${id}`)}>← {t('live.hand.backToTournament')}</button>
          </div>
        )}
      </div>

      {seatSheet != null && (
        <SeatSheet
          key={seatSheet}
          i={seatSheet} setup={setup} layout={layout} t={t} notes={notes} noteFor={noteFor} storeNote={storeNote}
          table={findTable(tour, setup.tableNo)}
          onChange={patch => updatePlayer(seatSheet, patch)}
          onClose={() => setSeatSheet(null)}
          nav={step === 'table' && setup.n > 2 ? seatNav(seatSheet) : null}
          openPicker={openPicker}
        />
      )}

      {picker && (
        <CardPicker
          {...picker}
          used={usedCards(setup, st, Object.values(showdownCards).flat())}
          doneLabel={t('common.save')} clearLabel={t('common.clear')}
          onClose={() => setPicker(null)}
          onDone={cards => { setPicker(null); picker.onDone(cards) }}
        />
      )}
    </div>
  )
}

const num = v => parseInt(String(v).replace(/[^\d]/g, ''), 10) || 0
// Chip amounts in inputs with thousands separators (num() reads them back)
const chips = v => (v ? fmtNumber(v) : '')

// ── Action panel: whose turn it is and what they can do, board cards, showdown, save ──
function ActionPanel({ st, setup, names, layout, t, amount, setAmount, act, push, undo, openPicker,
  showdownCards, setShowdownCards, manualWinners, setManualWinners, onSave, saving }) {
  const need = st.need
  const la = legalActions(st)
  const who = i => (i === 0 ? t('live.hand.me') : names[i] === layout.labels[i] ? names[i] : `${names[i]} (${layout.labels[i]})`)
  const pot = potTotal(st)

  // Undo always sits on the left of the bottom row, the step's main button on the right
  const footer = main => (
    <div style={s.ctaRow}>
      <button type="button" style={{ ...s.secondaryCta, flex: '0 0 auto' }} onClick={undo}>↶ {t('live.hand.undo')}</button>
      {main}
    </div>
  )
  const header = (title, extra) => (
    <div style={s.turn}>
      <span style={s.turnTitle}>{title}</span>
      {extra}
    </div>
  )
  const streetTag = <span style={s.street}>{t(`live.hand.street.${st.street}`)}</span>

  if (need.type === 'action') {
    const sizes = st.currentBet === 0
      ? [[1 / 3, '⅓'], [1 / 2, '½'], [3 / 4, '¾'], [1, t('live.hand.pot')]].map(([f, label]) => [Math.round(pot * f), label])
      : (st.street === 'preflop'
        ? [2, 2.5, 3].map(x => [Math.round(st.currentBet * x), `${x}x`])
        : [2.5, 3].map(x => [Math.round(st.currentBet * x), `${x}x`]))
    const toValue = num(amount)
    const validTo = toValue >= la.minTo && (la.maxTo == null || toValue <= la.maxTo)
    const buttons = [
      la.fold && <button key="f" style={{ ...s.actBtn, ...s.fold }} onClick={() => act('fold')}>{t('live.hand.fold')}</button>,
      la.check && <button key="x" style={s.actBtn} onClick={() => act('check')}>{t('live.hand.check')}</button>,
      la.call && (
        <button key="c" style={{ ...s.actBtn, ...s.call }} onClick={() => act('call')}>
          <span>{t('live.hand.callShort')}</span><span style={s.actAmount}>{fmtNumber(la.toCall)}</span>
        </button>
      ),
      (!la.stackUnknown || la.call) && (
        <button key="a" style={{ ...s.actBtn, ...s.allin, ...(la.stackUnknown ? s.actDisabled : null) }}
          onClick={() => (la.stackUnknown ? null : act('allin'))} disabled={la.stackUnknown}>
          <span>{t('live.hand.allin')}</span>{la.maxTo ? <span style={s.actAmount}>{fmtNumber(la.maxTo)}</span> : null}
        </button>
      ),
    ].filter(Boolean)
    const fitSizes = sizes.filter(([v]) => v >= la.minTo && (la.maxTo == null || v <= la.maxTo))
    return (
      <div style={base.card}>
        {header(t('live.hand.toAct', { who: who(need.player) }), streetTag)}
        {/* One row with as many columns as buttons: no button left alone on a second row */}
        <div style={{ ...s.actGrid, gridTemplateColumns: `repeat(${buttons.length}, minmax(0, 1fr))` }}>{buttons}</div>
        {(la.bet || la.raise || la.stackUnknown) && (
          <div style={s.raiseBox}>
            {fitSizes.length > 0 && (
              <div style={{ ...s.sizes, gridTemplateColumns: `repeat(${fitSizes.length}, minmax(0, 1fr))` }}>
                {fitSizes.map(([v, label]) => (
                  <button key={label} type="button" style={{ ...s.sizeBtn, ...(toValue === v ? s.sizeOn : null) }} onClick={() => setAmount(String(v))}>
                    <span>{label}</span><span style={s.sizeVal}>{fmtNumber(v)}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ ...base.input, ...s.num, flex: 1 }} inputMode="numeric" value={chips(toValue)}
                placeholder={t('live.hand.amountPh', { n: fmtNumber(la.minTo) })} onChange={e => setAmount(e.target.value)} />
              <button style={{ ...base.btn, padding: '0 18px', minHeight: 46, ...(validTo ? null : s.ctaDisabled) }} disabled={!validTo}
                onClick={() => act(la.maxTo != null && toValue >= la.maxTo ? 'allin' : la.bet ? 'bet' : 'raise', toValue)}>
                {la.bet ? t('live.hand.bet') : t('live.hand.raiseTo')}
              </button>
            </div>
            {la.stackUnknown && (
              <button type="button" style={{ ...s.secondaryCta, ...(validTo ? null : s.ctaDisabled) }} disabled={!validTo}
                onClick={() => act('allin', toValue)}>{t('live.hand.allinAmount')}</button>
            )}
          </div>
        )}
        {footer(null)}
      </div>
    )
  }

  if (need.type === 'board') {
    return (
      <div style={base.card}>
        {header(t('live.hand.dealStreet', { street: t(STREET_KEYS[need.street]) }), streetTag)}
        {footer(
          <button style={s.primaryCta} onClick={() => openPicker({
            title: t(STREET_KEYS[need.street]), count: need.count,
            onDone: cards => cards.length === need.count && push([{ type: 'board', cards }]),
          })}>🂠 {t('live.hand.pickStreet', { street: t(STREET_KEYS[need.street]) })}</button>,
        )}
      </div>
    )
  }

  if (need.type === 'showdown') {
    const contenders = need.contenders
    const auto = canAutoResolve(st, setup, showdownCards)
    const resolve = () => push([{ type: 'showdown', cards: showdownCards, ...(auto ? null : { winners: manualWinners }) }])
    const ready = auto || manualWinners.length > 0
    return (
      <div style={base.card}>
        {header(t('live.hand.showdown'))}
        <div style={base.hint}>{t('live.hand.showdownHint')}</div>
        <div style={s.sdList}>
          {contenders.map(i => {
            const cards = showdownCards[i] ?? setup.players[i]?.cards
            const won = manualWinners.includes(i)
            return (
              <div key={i} style={s.sdRow}>
                <button type="button" style={s.sdCards} disabled={i === 0} onClick={() => openPicker({
                  title: who(i), count: 2, initial: showdownCards[i] ?? [], allowEmpty: true,
                  onDone: cs => setShowdownCards(m => { const next = { ...m }; if (cs.length === 2) next[i] = cs; else delete next[i]; return next }),
                })}>
                  {cards ? cards.map(c => <Card key={c} code={c} size="xs" />) : [0, 1].map(k => <CardBack key={k} size="xs" />)}
                </button>
                <span style={s.sdName}>{who(i)}</span>
                {!auto && (
                  <button type="button" aria-pressed={won} style={{ ...s.winnerBtn, ...(won ? s.winnerOn : null) }}
                    onClick={() => setManualWinners(w => (won ? w.filter(x => x !== i) : [...w, i]))}>
                    {won ? '🏆 ' : ''}{t('live.hand.winner')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {footer(
          <button style={{ ...s.primaryCta, ...(ready ? null : s.ctaDisabled) }} disabled={!ready} onClick={resolve}>
            {auto ? t('live.hand.resolveAuto') : t('live.hand.resolve')}
          </button>,
        )}
      </div>
    )
  }

  // done
  return (
    <div style={base.card}>
      {header(t('live.hand.finished'))}
      <ResultLine st={st} names={names} t={t} />
      {footer(
        <button style={{ ...s.primaryCta, ...(saving ? s.ctaDisabled : null) }} onClick={onSave} disabled={saving}>
          {saving ? t('common.saving') : `💾 ${t('live.hand.save')}`}
        </button>,
      )}
    </div>
  )
}

function ResultLine({ st, names, t }) {
  if (!st?.result) return null
  const net = (st.result.winnings[0] ?? 0) - st.contributed[0]
  return (
    <div style={s.result}>
      {Object.entries(st.result.winnings).map(([i, amount]) => (
        <div key={i}>🏆 {Number(i) === 0 ? t('live.hand.me') : names[i]} · {fmtNumber(amount)}</div>
      ))}
      <div style={{ color: net > 0 ? '#50d080' : net < 0 ? '#e07070' : '#7a94b0', fontWeight: 800 }}>
        {t('live.hand.myResult')}: {net > 0 ? '+' : ''}{fmtNumber(net)}
      </div>
    </div>
  )
}

// ── Seat sheet: name/description, note, stack and known cards of whoever sits there ──
function SeatSheet({ i, setup, table, layout, t, notes, noteFor, storeNote, onChange, onClose, nav, openPicker }) {
  const p = setup.players[i]
  const isHero = i === 0
  const [noteText, setNoteText] = useState(() => noteFor(p)?.note ?? '')
  const [noteDirty, setNoteDirty] = useState(false)
  const canNote = !!(p.name?.trim() || (table && p.seat))
  const tags = t('live.notes.tags')

  function changeName(name) {
    onChange({ name })
    if (!noteDirty) setNoteText(noteFor({ ...p, name })?.note ?? '') // a known player brings their note
  }

  // Someone else sits there (a seat was empty): whoever you have a note on at that seat comes along
  function changeSeat(seat) {
    const n = noteAtSeat(notes, table.no, seat)
    onChange({ seat, name: n?.name ?? '' })
    if (!noteDirty) setNoteText(n?.note ?? '')
  }

  function editNote(text) { setNoteText(text); setNoteDirty(true) }

  // The note is saved when leaving the seat, by any way (button, ✕, outside, ‹ ›)
  function commit() {
    if (!isHero && noteDirty && canNote) storeNote(p, noteText.trim())
  }
  function close() { commit(); onClose() }
  const go = fn => (fn ? () => { commit(); fn() } : null)

  const title = isHero ? t('live.hand.me') : t('live.hand.seatTitle', { pos: layout.labels[i] })
  const subtitle = !isHero && (p.name?.trim() || (table && p.seat ? t('live.notes.seatN', { n: p.seat }) : null))

  return (
    <BottomSheet title={title} subtitle={subtitle} onClose={close} closeLabel={t('common.close')}
      nav={nav ? { ...nav, onPrev: go(nav.onPrev), onNext: go(nav.onNext) } : null}
      footer={<button style={{ ...s.primaryCta }} onClick={close}>{noteDirty ? t('common.save') : t('live.hand.done')}</button>}>
      {!isHero && (
        <div style={table ? s.grid2Name : null}>
          {table && (
            <Field label={t('live.notes.seat')}>
              <select style={{ ...base.input, ...base.select }} value={p.seat ?? ''} onChange={e => changeSeat(Number(e.target.value))}>
                {Array.from({ length: table.seats }, (_, k) => k + 1).filter(sn => sn !== table.mySeat)
                  .map(sn => <option key={sn} value={sn}>{sn}</option>)}
              </select>
            </Field>
          )}
          <Field label={t('live.hand.rivalName')}>
            <input style={base.input} value={p.name ?? ''} autoFocus={!p.name} placeholder={t('live.hand.rivalNamePh')}
              list="player-note-names" autoComplete="off" autoCapitalize="words" onChange={e => changeName(e.target.value)} />
            <datalist id="player-note-names">{notes.filter(n => n.name).map(n => <option key={n.id} value={n.name} />)}</datalist>
          </Field>
        </div>
      )}
      {!isHero && (
        <Field label={t('live.notes.note')}>
          <textarea style={{ ...base.input, minHeight: 72, resize: 'vertical', lineHeight: 1.45 }} value={noteText}
            placeholder={canNote ? t('live.notes.notePh') : t('live.notes.needName')} disabled={!canNote}
            onChange={e => editNote(e.target.value)} />
        </Field>
      )}
      {!isHero && Array.isArray(tags) && <NoteTags tags={tags} text={noteText} onChange={editNote} disabled={!canNote} />}
      <div style={s.grid2}>
        <Field label={t('live.hand.stack')}>
          <input style={{ ...base.input, ...s.num }} inputMode="numeric" value={chips(p.stack)} placeholder={t('live.hand.stackUnknown')}
            onChange={e => onChange({ stack: num(e.target.value) || null })} />
        </Field>
        <Field label={t('live.hand.knownCards')}>
          <button type="button" style={{ ...s.cardSlot, width: '100%' }} onClick={() => openPicker({
            title: t('live.hand.knownCards'), count: 2, initial: p.cards ?? [], allowEmpty: true,
            onDone: cards => onChange({ cards: cards.length === 2 ? cards : null }),
          })}>
            {p.cards ? p.cards.map(c => <Card key={c} code={c} size="xs" />) : [0, 1].map(k => <CardBack key={k} size="xs" />)}
            <span style={s.slotHint}>{p.cards ? t('live.hand.change') : t('live.hand.optional')}</span>
          </button>
        </Field>
      </div>
    </BottomSheet>
  )
}

function Field({ label, flex, children }) {
  return (
    <label style={{ ...base.field, ...(flex ? { flex, minWidth: 0 } : null) }}>
      <span style={base.label}>{label}</span>
      {children}
    </label>
  )
}

function Header({ navigate, t, id }) {
  return (
    <div style={base.header}>
      <Logo onClick={() => navigate('/')} title={t('nav.goHome')} />
      <button style={base.ghostBtn} onClick={() => navigate(`/live/${id}`)}>← {t('live.hand.backToTournament')}</button>
    </div>
  )
}

const CTA = {
  minHeight: 48, borderRadius: 11, fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 16px',
  touchAction: 'manipulation', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box',
}

const s = {
  titleBlock: { display: 'flex', flexDirection: 'column' },
  stepper: { display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0 },
  stepItem: {
    flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px',
    borderRadius: 10, border: '1px solid #1a2a3e', color: '#3a5a7a',
  },
  stepNow: { borderColor: '#2a4a80', background: 'rgba(30,92,173,0.16)', color: '#d0e8ff' },
  stepDone: { color: '#5a8ab0' },
  stepDot: {
    width: 20, height: 20, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 900, border: '1px solid currentColor',
  },
  stepDotNow: { background: '#1e5cad', borderColor: '#1e5cad', color: '#fff' },
  stepDotDone: { background: 'rgba(80,208,128,0.15)', borderColor: 'rgba(80,208,128,0.5)', color: '#50d080' },
  stepLabel: { fontSize: 12, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  divider: { height: 1, background: '#1e2e42', margin: '2px 0' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
  grid2Name: { display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', gap: 10 },
  grid4: { display: 'grid', gridTemplateColumns: '64px repeat(3, minmax(0, 1fr))', gap: 8 },
  num: { fontVariantNumeric: 'tabular-nums' },
  primaryCta: {
    ...CTA, flex: '1 1 auto', width: '100%', color: '#e0f0ff', border: '1px solid #2a5aa0',
    background: 'linear-gradient(135deg, #1e5cad 0%, #1040a0 50%, #0c3080 100%)', boxShadow: '0 4px 20px rgba(20,60,160,0.35)',
  },
  secondaryCta: { ...CTA, flex: '1 1 auto', color: '#9ac8f0', background: '#0a1422', border: '1px solid #24405e' },
  ctaDisabled: { opacity: 0.4, cursor: 'default', boxShadow: 'none' },
  ctaRow: { display: 'flex', gap: 8, alignItems: 'stretch' },
  linkBtn: {
    background: 'none', border: 'none', color: '#5a8ab0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit', minHeight: 44, alignSelf: 'center', padding: '0 12px',
  },
  segment: { display: 'flex', gap: 6 },
  segBtn: {
    flex: 1, background: '#080e18', border: '1px solid #1e2e42', borderRadius: 9, color: '#5a7a9a',
    minHeight: 40, padding: '0 6px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  segOn: { borderColor: '#2a4a80', color: '#d0e8ff', background: 'rgba(30,92,173,0.3)' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    background: '#080e18', border: '1px solid #1e2e42', borderRadius: 9, color: '#7a94b0',
    minHeight: 40, padding: '0 12px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', minWidth: 48,
    touchAction: 'manipulation',
  },
  chipOn: { background: 'linear-gradient(135deg, #2a2210, #1a1600)', borderColor: '#c8a800', color: '#ffe566' },
  addChip: {
    background: 'none', border: '1px dashed #2a4a80', borderRadius: 9, color: '#5a8ab0',
    minHeight: 40, padding: '0 12px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  },
  posGrid: { display: 'grid', gap: 6 },
  posChip: { minWidth: 0, padding: 0, minHeight: 44 },
  cardSlot: {
    display: 'flex', alignItems: 'center', gap: 6, background: '#080e18', border: '1px dashed #2a3a52',
    borderRadius: 10, padding: 8, minHeight: 46, cursor: 'pointer', fontFamily: 'inherit', width: 'fit-content', boxSizing: 'border-box',
  },
  slotHint: { fontSize: 12, color: '#5a8ab0', fontWeight: 700, marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#9ab4d0', cursor: 'pointer', lineHeight: 1.45 },
  checkbox: { width: 20, height: 20, margin: 0, flexShrink: 0, accentColor: '#1e5cad' },
  tableHint: { fontSize: 12, color: '#5a7a9a', textAlign: 'center', padding: '0 12px 4px', lineHeight: 1.45 },
  turn: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, minHeight: 24 },
  turnTitle: { fontSize: 16, fontWeight: 800, color: '#e0ecff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  street: {
    fontSize: 10, fontWeight: 800, color: '#7ab0d8', letterSpacing: 1, textTransform: 'uppercase', flexShrink: 0,
    border: '1px solid #24405e', borderRadius: 6, padding: '3px 7px',
  },
  actGrid: { display: 'grid', gap: 8 },
  actBtn: {
    background: '#0c1626', border: '1px solid #2a3a52', borderRadius: 11, color: '#d0e0f0', minHeight: 56,
    padding: '6px 4px', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, touchAction: 'manipulation',
  },
  actAmount: { fontSize: 12, fontWeight: 700, opacity: 0.85, fontVariantNumeric: 'tabular-nums', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' },
  actDisabled: { opacity: 0.35, cursor: 'default' },
  fold: { color: '#e07070', borderColor: 'rgba(160,30,30,0.5)' },
  call: { color: '#50d080', borderColor: 'rgba(30,150,60,0.5)' },
  allin: { color: '#f0a040', borderColor: 'rgba(200,120,30,0.5)' },
  raiseBox: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: 'rgba(8,14,24,0.5)', border: '1px solid #1e2e42', borderRadius: 11 },
  sizes: { display: 'grid', gap: 6 },
  sizeBtn: {
    background: '#080e18', border: '1px solid #1e3a58', borderRadius: 9, color: '#7ab0d8', minHeight: 44, minWidth: 0,
    padding: '2px 2px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', touchAction: 'manipulation',
  },
  sizeOn: { borderColor: '#4a8ad0', background: 'rgba(30,92,173,0.25)', color: '#d0e8ff' },
  sizeVal: { fontSize: 10, fontWeight: 700, color: '#5a7a9a', fontVariantNumeric: 'tabular-nums', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' },
  sdList: { display: 'flex', flexDirection: 'column', gap: 6 },
  sdRow: {
    display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '4px 8px',
    background: 'rgba(8,14,24,0.5)', border: '1px solid #1e2e42', borderRadius: 10,
  },
  sdCards: { display: 'flex', gap: 3, background: 'none', border: 'none', padding: 4, margin: -4, cursor: 'pointer', flexShrink: 0 },
  sdName: { fontSize: 14, fontWeight: 700, color: '#c8d4e8', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  winnerBtn: {
    flexShrink: 0, minHeight: 40, padding: '0 12px', borderRadius: 9, border: '1px solid #3a3420', background: 'none',
    color: '#a09060', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  },
  winnerOn: { borderColor: '#c8a800', color: '#ffe566', background: 'rgba(200,168,0,0.12)' },
  result: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, color: '#e0ecff' },
  savedTitle: { fontSize: 18, fontWeight: 900, color: '#50d080' },
  stackCta: {
    ...CTA, width: '100%', justifyContent: 'flex-start', gap: 10, color: '#a0e8b8', textAlign: 'left',
    background: 'rgba(40,120,60,0.15)', border: '1px solid #2a6a3a', whiteSpace: 'normal', padding: '10px 14px', fontSize: 14,
  },
  ok: { fontSize: 13, color: '#50d080', fontWeight: 700 },
  tableNotes: {
    display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 6px 6px',
    background: 'rgba(240,192,112,0.06)', border: '1px solid rgba(240,192,112,0.25)', borderRadius: 12,
  },
  tableNote: {
    display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none',
    padding: '8px 6px', minHeight: 40, fontSize: 13, color: '#c8d4e8', lineHeight: 1.4, cursor: 'pointer', fontFamily: 'inherit', borderRadius: 8,
  },
  tableNotePos: {
    flexShrink: 0, minWidth: 34, fontSize: 10, fontWeight: 800, color: '#a08040', letterSpacing: 0.5,
    border: '1px solid rgba(240,192,112,0.3)', borderRadius: 5, padding: '1px 4px', textAlign: 'center',
  },
  draftBox: {
    display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px', borderRadius: 14,
    background: 'rgba(240,160,64,0.08)', border: '1px solid rgba(240,160,64,0.4)',
  },
  draftTitle: { fontSize: 14, fontWeight: 800, color: '#f0c070' },
  draftMeta: { fontSize: 12, color: '#c8b090', lineHeight: 1.6 },
  shareBox: { fontSize: 12, color: '#50d080', background: 'rgba(30,150,60,0.1)', borderRadius: 8, padding: '8px 10px', wordBreak: 'break-all' },
  shareUrl: { color: '#9ab4d0' },
}
