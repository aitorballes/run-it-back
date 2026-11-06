import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n, fmtNumber } from '../i18n/core'
import {
  fetchLiveTournament, updateLiveTournament, ensureLiveTournamentRow, insertLiveHand, updateLiveHand,
  fetchLiveHand, generateHandShareToken, fetchPlayerNotes, savePlayerNote, playerNameKey,
} from '../lib/db'
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
import { useVisualViewport } from '../components/useVisualViewport'

const TABLE_SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10]
const STREET_KEYS = { flop: 'live.hand.flop', turn: 'live.hand.turn', river: 'live.hand.river' }

const emptyPlayers = n => Array.from({ length: n }, () => ({ name: '', stack: null, cards: null }))

// Records a live hand: setup → seats → play the action → save into `hands` (see lib/liveHand.js)
export default function LiveHandRecorder() {
  const { id, handDbId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()

  const [tour, setTour]     = useState(null)
  const [notes, setNotes]   = useState([])      // player_notes of this user
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

  useEffect(() => {
    async function load() {
      try {
        const row = await fetchLiveTournament(id)
        if (!row) { setStatus('notFound'); return }
        setTour(row)
        fetchPlayerNotes(row.user_id).then(setNotes).catch(() => {}) // table missing until the migration runs
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
          const playLevel = row.on_break ? row.current_level + 1 : row.current_level
          const l = levelAt(row.structure, playLevel)
          setLevel(playLevel)
          setSetup({
            n: 9, heroPos: 'BTN', sb: l.sb, bb: l.bb, ante: l.ante || 0, anteType: 'bb',
            players: [{ name: 'Hero', stack: row.my_stack ?? null, cards: null }, ...emptyPlayers(8)],
            revealHoleCards: false,
          })
        }
        setStatus('ready')
      } catch {
        setStatus('error')
      }
    }
    load()
  }, [id, handDbId])

  const st = useMemo(() => (setup && step !== 'setup' && step !== 'table' ? replay(setup, log) : null), [setup, log, step])
  // Stack after the hand (what's left plus what was won)
  const finalStack = i => (st?.result ? st.stack[i] + (st.result.winnings[i] ?? 0) : st?.stack[i])
  const names = useMemo(() => (setup ? playerNames(setup) : []), [setup])
  const layout = useMemo(() => (setup ? seatLayout(setup.n, setup.heroPos) : null), [setup])
  const noteFor = name => (name?.trim() ? notes.find(n => n.name_key === playerNameKey(name)) : null)

  async function storeNote(name, note) {
    try {
      const saved = await savePlayerNote(tour.user_id, name, note, tour.venue)
      setNotes(ns => [saved, ...ns.filter(n => n.id !== saved.id)])
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
    setSetup(s => ({
      ...s, n,
      heroPos: labels.includes(s.heroPos) ? s.heroPos : labels[0],
      players: Array.from({ length: n }, (_, i) => s.players[i] ?? { name: '', stack: null, cards: null }),
    }))
  }

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
        hasNote: i !== 0 && !!noteFor(p.name)?.note,
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

  return (
    <div style={base.page}>
      <Header navigate={navigate} t={t} id={id} />
      <div style={base.content}>
        <div>
          <div style={base.title}>{handDbId ? t('live.hand.editTitle') : t('live.hand.newTitle')}</div>
          <div style={base.subtitle}>
            {tour.name} · {t('live.level', { n: level })} · {fmtNumber(setup.sb)}/{fmtNumber(setup.bb)}{setup.ante ? ` (${fmtNumber(setup.ante)})` : ''}
          </div>
        </div>

        {error && <div style={base.error}>{error}</div>}

        {/* ── 1. SETUP ── */}
        {step === 'setup' && (
          <div style={base.card}>
            <div style={base.cardTitle}>{t('live.hand.setupTitle')}</div>
            <div style={base.row}>
              <Field label={t('live.structure.level')} flex="1 1 70px">
                <input style={base.input} type="number" min="1" inputMode="numeric" value={level} onChange={e => changeLevel(e.target.value)} />
              </Field>
              <Field label="SB" flex="1 1 70px">
                <input style={base.input} inputMode="numeric" value={setup.sb || ''} onChange={e => updateSetup({ sb: num(e.target.value) })} />
              </Field>
              <Field label="BB" flex="1 1 70px">
                <input style={base.input} inputMode="numeric" value={setup.bb || ''} onChange={e => updateSetup({ bb: num(e.target.value) })} />
              </Field>
              <Field label="Ante" flex="1 1 70px">
                <input style={base.input} inputMode="numeric" value={setup.ante || ''} placeholder="0" onChange={e => updateSetup({ ante: num(e.target.value) })} />
              </Field>
            </div>
            {setup.ante > 0 && (
              <div style={s.segment}>
                {['bb', 'all'].map(k => (
                  <button key={k} type="button" style={{ ...s.segBtn, ...(setup.anteType === k ? s.segOn : null) }}
                    onClick={() => updateSetup({ anteType: k })}>{t(`live.hand.ante.${k}`)}</button>
                ))}
              </div>
            )}

            <div style={base.row}>
              <Field label={t('live.form.myStack')} flex="1 1 140px">
                <input style={base.input} inputMode="numeric" value={setup.players[0].stack ?? ''}
                  onChange={e => updatePlayer(0, { stack: num(e.target.value) || null })} />
              </Field>
              <Field label={t('live.hand.tableSize')} flex="1 1 100px">
                <select style={{ ...base.input, ...base.select }} value={setup.n} onChange={e => changeTableSize(Number(e.target.value))}>
                  {TABLE_SIZES.map(n => <option key={n} value={n}>{t('live.hand.players', { n })}</option>)}
                </select>
              </Field>
            </div>

            <div style={base.field}>
              <span style={base.label}>{t('live.hand.myPosition')}</span>
              <div style={s.chips}>
                {positionLabels(setup.n).map(p => (
                  <button key={p} type="button" style={{ ...s.chip, ...(setup.heroPos === p ? s.chipOn : null) }}
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
              <input type="checkbox" checked={!!setup.revealHoleCards} onChange={e => updateSetup({ revealHoleCards: e.target.checked })} />
              <span>{t('live.hand.revealHoleCards')}</span>
            </label>

            <div style={base.actions}>
              <button style={{ ...base.btn, opacity: setup.bb > 0 ? 1 : 0.4 }} disabled={!(setup.bb > 0)} onClick={() => setStep('table')}>
                {t('live.hand.toTable')} →
              </button>
            </div>
          </div>
        )}

        {/* ── 2. TABLE (who is sitting) / 3. PLAY ── */}
        {step !== 'setup' && (
          <div style={{ ...base.card, padding: '12px 8px' }}>
            <LiveTable
              seats={tableSeats()}
              dealer={layout.btn}
              board={st?.board}
              pot={st ? potTotal(st) : 0}
              potLabel={t('visualizer.totalPot')}
              onSeatClick={step === 'saved' ? null : onSeatClick}
            />
            <div style={{ ...base.hint, textAlign: 'center', padding: '0 8px' }}>
              {step === 'table' ? t('live.hand.tableHint') : st?.need?.type === 'action' ? t('live.hand.foldHint') : ''}
            </div>
          </div>
        )}

        {step !== 'setup' && (() => {
          const seated = setup.players.map((p, i) => ({ i, note: i ? noteFor(p.name) : null })).filter(x => x.note?.note)
          return seated.length > 0 && (
            <div style={s.tableNotes}>
              <div style={base.label}>✎ {t('live.notes.atTable')}</div>
              {seated.map(({ i, note }) => (
                <div key={i} style={s.tableNote}><b style={{ color: '#f0c070' }}>{note.name}</b> ({layout.labels[i]}): {note.note}</div>
              ))}
            </div>
          )
        })()}

        {step === 'table' && (
          <div style={{ ...base.actions, justifyContent: 'space-between' }}>
            <button style={base.ghostBtn} onClick={() => setStep('setup')}>← {t('live.hand.back')}</button>
            <button style={base.btn} onClick={() => { setLog([]); setStep('play') }}>▶ {t('live.hand.start')}</button>
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
              <button style={base.ghostBtn} onClick={updateMyStack}>
                {t('live.hand.updateStack', { n: fmtNumber(finalStack(0)) })}
              </button>
            )}
            {stackUpdated && <div style={s.ok}>✓ {t('live.hand.stackUpdated', { n: fmtNumber(finalStack(0)) })}</div>}
            {shareMsg && <div style={s.shareBox}>{t('common.linkCopied')}<br /><span style={s.shareUrl}>{shareMsg}</span></div>}
            <div style={s.savedActions}>
              <button style={base.ghostBtn} onClick={share}>🔗 {t('common.share')}</button>
              <button style={base.ghostBtn} onClick={() => navigate(`/tournament/${tour.tournament_db_id}`, { state: { handDbId: savedId } })}>
                ▶ {t('live.hand.view')}
              </button>
              <button style={base.ghostBtn} onClick={() => navigate(`/live/${id}`)}>{t('live.hand.backToTournament')}</button>
              {!handDbId && <button style={base.btn} onClick={newHand}>+ {t('live.hand.another')}</button>}
            </div>
          </div>
        )}
      </div>

      {seatSheet != null && (
        <SeatSheet
          i={seatSheet} setup={setup} layout={layout} t={t} notes={notes} noteFor={noteFor} storeNote={storeNote}
          onChange={patch => updatePlayer(seatSheet, patch)}
          onClose={() => setSeatSheet(null)}
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

// ── Action panel: whose turn it is and what they can do, board cards, showdown, save ──
function ActionPanel({ st, setup, names, layout, t, amount, setAmount, act, push, undo, openPicker,
  showdownCards, setShowdownCards, manualWinners, setManualWinners, onSave, saving }) {
  const need = st.need
  const la = legalActions(st)
  const who = i => (i === 0 ? t('live.hand.me') : names[i] === layout.labels[i] ? names[i] : `${names[i]} (${layout.labels[i]})`)
  const pot = potTotal(st)

  const undoBtn = <button type="button" style={base.ghostBtn} onClick={undo}>↶ {t('live.hand.undo')}</button>

  if (need.type === 'action') {
    const sizes = st.currentBet === 0
      ? [[1 / 3, '⅓'], [1 / 2, '½'], [3 / 4, '¾'], [1, t('live.hand.pot')]].map(([f, label]) => [Math.round(pot * f), label])
      : (st.street === 'preflop'
        ? [2, 2.5, 3].map(x => [Math.round(st.currentBet * x), `${x}x`])
        : [2.5, 3].map(x => [Math.round(st.currentBet * x), `${x}x`]))
    const toValue = num(amount)
    const validTo = toValue >= la.minTo && (la.maxTo == null || toValue <= la.maxTo)
    return (
      <div style={base.card}>
        <div style={s.turn}>{t('live.hand.toAct', { who: who(need.player) })}
          <span style={s.street}>{t(`live.hand.street.${st.street}`)}</span>
        </div>
        <div style={s.actGrid}>
          {la.fold && <button style={{ ...s.actBtn, ...s.fold }} onClick={() => act('fold')}>{t('live.hand.fold')}</button>}
          {la.check && <button style={s.actBtn} onClick={() => act('check')}>{t('live.hand.check')}</button>}
          {la.call && <button style={{ ...s.actBtn, ...s.call }} onClick={() => act('call')}>{t('live.hand.call', { n: fmtNumber(la.toCall) })}</button>}
          {(!la.stackUnknown || la.call) && (
            <button style={{ ...s.actBtn, ...s.allin }} onClick={() => (la.stackUnknown ? null : act('allin'))}
              disabled={la.stackUnknown}>{t('live.hand.allin')}{la.maxTo ? ` ${fmtNumber(la.maxTo)}` : ''}</button>
          )}
        </div>
        {(la.bet || la.raise || la.stackUnknown) && (
          <div style={s.raiseBox}>
            <div style={s.sizes}>
              {sizes.filter(([v]) => v >= la.minTo && (la.maxTo == null || v <= la.maxTo)).map(([v, label]) => (
                <button key={label} type="button" style={s.sizeBtn} onClick={() => setAmount(String(v))}>{label}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...base.input, flex: 1 }} inputMode="numeric" value={amount}
                placeholder={t('live.hand.amountPh', { n: fmtNumber(la.minTo) })} onChange={e => setAmount(e.target.value)} />
              <button style={{ ...base.btn, opacity: validTo ? 1 : 0.4 }} disabled={!validTo}
                onClick={() => act(la.maxTo != null && toValue >= la.maxTo ? 'allin' : la.bet ? 'bet' : 'raise', toValue)}>
                {la.bet ? t('live.hand.bet') : t('live.hand.raiseTo')}
              </button>
            </div>
            {la.stackUnknown && (
              <button type="button" style={{ ...base.ghostBtn, alignSelf: 'flex-start' }} disabled={!validTo}
                onClick={() => act('allin', toValue)}>{t('live.hand.allinAmount')}</button>
            )}
          </div>
        )}
        <div style={base.actions}>{undoBtn}</div>
      </div>
    )
  }

  if (need.type === 'board') {
    return (
      <div style={base.card}>
        <div style={s.turn}>{t('live.hand.dealStreet', { street: t(STREET_KEYS[need.street]) })}</div>
        <div style={{ ...base.actions, justifyContent: 'space-between' }}>
          {undoBtn}
          <button style={base.btn} onClick={() => openPicker({
            title: t(STREET_KEYS[need.street]), count: need.count,
            onDone: cards => cards.length === need.count && push([{ type: 'board', cards }]),
          })}>🂠 {t('live.hand.pickStreet', { street: t(STREET_KEYS[need.street]) })}</button>
        </div>
      </div>
    )
  }

  if (need.type === 'showdown') {
    const contenders = need.contenders
    const auto = canAutoResolve(st, setup, showdownCards)
    const resolve = () => push([{ type: 'showdown', cards: showdownCards, ...(auto ? null : { winners: manualWinners }) }])
    return (
      <div style={base.card}>
        <div style={s.turn}>{t('live.hand.showdown')}</div>
        <div style={base.hint}>{t('live.hand.showdownHint')}</div>
        {contenders.map(i => {
          const cards = showdownCards[i] ?? setup.players[i]?.cards
          return (
            <div key={i} style={s.sdRow}>
              <span style={s.sdName}>{who(i)}</span>
              <button type="button" style={s.cardSlotSm} disabled={i === 0} onClick={() => openPicker({
                title: who(i), count: 2, initial: showdownCards[i] ?? [], allowEmpty: true,
                onDone: cs => setShowdownCards(m => { const next = { ...m }; if (cs.length === 2) next[i] = cs; else delete next[i]; return next }),
              })}>
                {cards ? cards.map(c => <Card key={c} code={c} size="xs" />) : [0, 1].map(k => <CardBack key={k} size="xs" />)}
              </button>
              {!auto && (
                <label style={s.winnerCheck}>
                  <input type="checkbox" checked={manualWinners.includes(i)}
                    onChange={e => setManualWinners(w => (e.target.checked ? [...w, i] : w.filter(x => x !== i)))} />
                  {t('live.hand.winner')}
                </label>
              )}
            </div>
          )
        })}
        <div style={{ ...base.actions, justifyContent: 'space-between' }}>
          {undoBtn}
          <button style={{ ...base.btn, opacity: auto || manualWinners.length ? 1 : 0.4 }} disabled={!auto && !manualWinners.length} onClick={resolve}>
            {auto ? t('live.hand.resolveAuto') : t('live.hand.resolve')}
          </button>
        </div>
      </div>
    )
  }

  // done
  return (
    <div style={base.card}>
      <div style={s.turn}>{t('live.hand.finished')}</div>
      <ResultLine st={st} names={names} t={t} />
      <div style={{ ...base.actions, justifyContent: 'space-between' }}>
        {undoBtn}
        <button style={base.btn} onClick={onSave} disabled={saving}>{saving ? t('common.saving') : `💾 ${t('live.hand.save')}`}</button>
      </div>
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

// ── Seat sheet: name/description, stack, known cards of a rival ──
function SeatSheet({ i, setup, layout, t, notes, noteFor, storeNote, onChange, onClose, openPicker }) {
  const p = setup.players[i]
  const isHero = i === 0
  const [noteText, setNoteText] = useState(() => noteFor(p.name)?.note ?? '')
  const [noteDirty, setNoteDirty] = useState(false)

  function changeName(name) {
    onChange({ name })
    if (!noteDirty) setNoteText(noteFor(name)?.note ?? '') // a known player brings their note
  }

  function close() {
    if (!isHero && noteDirty && p.name?.trim()) storeNote(p.name, noteText.trim())
    onClose()
  }

  // Keep the sheet inside the part of the screen the keyboard leaves visible, and the focused field in view
  const vv = useVisualViewport()
  const fit = vv ? { inset: 'auto', left: 0, right: 0, top: vv.top, height: vv.height } : null
  function reveal(e) {
    const el = e.target
    if (el.matches('input:not([type=checkbox]), textarea')) setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300)
  }

  return (
    <div style={{ ...s.backdrop, ...fit }} onClick={close}>
      <div style={s.sheet} onClick={e => e.stopPropagation()} onFocus={reveal}>
        <div style={base.cardTitle}>{isHero ? t('live.hand.me') : t('live.hand.seatTitle', { pos: layout.labels[i] })}</div>
        {!isHero && (
          <Field label={t('live.hand.rivalName')}>
            <input style={base.input} value={p.name ?? ''} autoFocus placeholder={t('live.hand.rivalNamePh')}
              list="player-note-names" onChange={e => changeName(e.target.value)} />
            <datalist id="player-note-names">{notes.map(n => <option key={n.id} value={n.name} />)}</datalist>
          </Field>
        )}
        {!isHero && (
          <Field label={t('live.notes.note')}>
            <textarea style={{ ...base.input, minHeight: 64, resize: 'vertical' }} value={noteText}
              placeholder={p.name?.trim() ? t('live.notes.notePh') : t('live.notes.needName')} disabled={!p.name?.trim()}
              onChange={e => { setNoteText(e.target.value); setNoteDirty(true) }} />
          </Field>
        )}
        <Field label={t('live.hand.stack')}>
          <input style={base.input} inputMode="numeric" value={p.stack ?? ''} placeholder={t('live.hand.stackUnknown')}
            onChange={e => onChange({ stack: num(e.target.value) || null })} />
        </Field>
        <Field label={t('live.hand.knownCards')}>
          <button type="button" style={s.cardSlot} onClick={() => openPicker({
            title: t('live.hand.knownCards'), count: 2, initial: p.cards ?? [], allowEmpty: true,
            onDone: cards => onChange({ cards: cards.length === 2 ? cards : null }),
          })}>
            {p.cards ? p.cards.map(c => <Card key={c} code={c} size="sm" />) : [0, 1].map(k => <CardBack key={k} size="sm" />)}
            <span style={s.slotHint}>{p.cards ? t('live.hand.change') : t('live.hand.optional')}</span>
          </button>
        </Field>
        <div style={base.actions}><button style={base.btn} onClick={close}>{noteDirty ? t('common.save') : t('common.close')}</button></div>
      </div>
    </div>
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

const s = {
  segment: { display: 'flex', gap: 6 },
  segBtn: {
    flex: 1, background: '#080e18', border: '1px solid #1e2e42', borderRadius: 8, color: '#5a7a9a',
    padding: '8px 6px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  segOn: { borderColor: '#2a4a80', color: '#d0e8ff', background: 'rgba(30,92,173,0.3)' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    background: '#080e18', border: '1px solid #1e2e42', borderRadius: 8, color: '#7a94b0',
    padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', minWidth: 46,
  },
  chipOn: { background: 'linear-gradient(135deg, #2a2210, #1a1600)', borderColor: '#c8a800', color: '#ffe566' },
  cardSlot: {
    display: 'flex', alignItems: 'center', gap: 6, background: '#080e18', border: '1px dashed #2a3a52',
    borderRadius: 10, padding: 8, cursor: 'pointer', fontFamily: 'inherit', width: 'fit-content',
  },
  cardSlotSm: { display: 'flex', gap: 3, background: 'none', border: 'none', padding: 0, cursor: 'pointer' },
  slotHint: { fontSize: 12, color: '#5a8ab0', fontWeight: 700, marginLeft: 6 },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#9ab4d0', cursor: 'pointer', lineHeight: 1.4 },
  turn: { fontSize: 15, fontWeight: 800, color: '#e0ecff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  street: { fontSize: 10, fontWeight: 800, color: '#5a8ab0', letterSpacing: 1, textTransform: 'uppercase' },
  actGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 8 },
  actBtn: {
    background: '#0c1626', border: '1px solid #2a3a52', borderRadius: 10, color: '#d0e0f0',
    padding: '12px 8px', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  },
  fold: { color: '#e07070', borderColor: 'rgba(160,30,30,0.5)' },
  call: { color: '#50d080', borderColor: 'rgba(30,150,60,0.5)' },
  allin: { color: '#f0a040', borderColor: 'rgba(200,120,30,0.5)' },
  raiseBox: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: '1px solid #1e2e42', borderRadius: 10 },
  sizes: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  sizeBtn: {
    background: '#080e18', border: '1px solid #1e3a58', borderRadius: 7, color: '#7ab0d8',
    padding: '6px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  },
  sdRow: { display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  sdName: { fontSize: 13, fontWeight: 700, color: '#c8d4e8', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  winnerCheck: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#ffe566', cursor: 'pointer' },
  result: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, color: '#e0ecff' },
  savedTitle: { fontSize: 18, fontWeight: 900, color: '#50d080' },
  savedActions: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  ok: { fontSize: 12, color: '#50d080', fontWeight: 700 },
  tableNotes: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px',
    background: 'rgba(240,192,112,0.06)', border: '1px solid rgba(240,192,112,0.25)', borderRadius: 10,
  },
  tableNote: { fontSize: 12, color: '#c8d4e8', lineHeight: 1.4 },
  shareBox: { fontSize: 12, color: '#50d080', background: 'rgba(30,150,60,0.1)', borderRadius: 8, padding: '8px 10px', wordBreak: 'break-all' },
  shareUrl: { color: '#9ab4d0' },
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    ...base.card, width: '100%', maxWidth: 560, borderRadius: '16px 16px 0 0',
    padding: '18px 16px calc(18px + env(safe-area-inset-bottom))',
    maxHeight: '100%', overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box',
  },
}
