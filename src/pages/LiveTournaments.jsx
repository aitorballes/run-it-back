import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n, fmtNumber } from '../i18n/core'
import { fetchLiveTournaments, createLiveTournament, ensureLiveTournamentRow } from '../lib/db'
import { defaultStructure, levelAt, parseChips } from '../lib/liveTournament'
import Logo from '../components/Logo'
import { base as s } from '../components/liveStyles'

const CURRENCIES = ['€', '$', '£']

const EMPTY_FORM = {
  venue: '', name: '', buyin: '', currency: '€', levelMinutes: '20', startingStack: '20000',
  currentLevel: '1', entries: '', playersLeft: '', myStack: '',
}

export default function LiveTournaments() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t, locale } = useI18n()

  const [list, setList]       = useState(null)
  const [loadError, setLoadError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]       = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchLiveTournaments(user.id)
      .then(rows => { setList(rows); if (!rows.length) setShowForm(true) })
      .catch(() => { setList([]); setLoadError(t('live.loadError')) })
  }, [user.id, t])

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    if (!form.venue.trim() || !form.name.trim()) { setFormError(t('live.form.required')); return }
    const levelMinutes  = Math.max(1, parseInt(form.levelMinutes, 10) || 20)
    const currentLevel  = Math.max(1, parseInt(form.currentLevel, 10) || 1)
    const startingStack = parseChips(form.startingStack) ?? 0
    const entries       = parseChips(form.entries)
    const playersLeft   = parseChips(form.playersLeft) ?? entries
    const myStack       = parseChips(form.myStack) ?? (startingStack || null)
    const now = new Date()

    // The structure always covers the current level, so editing it shows the right blinds
    const structure = defaultStructure().map(l => ({ ...l, minutes: levelMinutes }))
    while (structure.length < currentLevel) structure.push(levelAt(structure, structure.length + 1))

    setCreating(true)
    try {
      const row = await createLiveTournament(user.id, {
        venue: form.venue.trim(),
        name: form.name.trim(),
        buyin: parseFloat(String(form.buyin).replace(',', '.')) || 0,
        currency: form.currency,
        level_minutes: levelMinutes,
        starting_stack: startingStack,
        structure,
        current_level: currentLevel,
        level_ends_at: new Date(now.getTime() + levelMinutes * 60 * 1000).toISOString(),
        paused_remaining: null,
        my_stack: myStack,
        entries,
        players_left: playersLeft,
        history: myStack != null
          ? [{ at: now.toISOString(), level: currentLevel, stack: myStack, players: playersLeft, entries }]
          : [],
      })
      await ensureLiveTournamentRow(row)
      navigate(`/live/${row.id}`)
    } catch {
      setFormError(t('live.saveError'))
      setCreating(false)
    }
  }

  const running  = list?.filter(x => x.status === 'running') ?? []
  const finished = list?.filter(x => x.status === 'finished') ?? []

  return (
    <div style={s.page}>
      <div style={s.header}>
        <Logo onClick={() => navigate('/')} title={t('nav.goHome')} />
        <button style={s.ghostBtn} onClick={() => navigate('/')}>{t('nav.goHome')}</button>
      </div>

      <div style={s.content}>
        <div style={s.titleRow}>
          <div style={{ minWidth: 0 }}>
            <div style={s.title}>{t('live.title')}</div>
            <div style={s.subtitle}>{t('live.subtitle')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={s.ghostBtn} onClick={() => navigate('/live/players')}>✎ {t('live.notes.title')}</button>
            {!showForm && (
              <button style={s.btn} onClick={() => setShowForm(true)}>+ {t('live.newTournament')}</button>
            )}
          </div>
        </div>

        {loadError && <div style={s.error}>{loadError}</div>}

        {showForm && (
          <form style={s.card} onSubmit={handleCreate}>
            <div style={s.cardTitle}>{t('live.newTournament')}</div>

            <div style={s.row}>
              <Field label={t('live.form.venue')} half>
                <input style={s.input} value={form.venue} onChange={set('venue')}
                  placeholder={t('live.form.venuePlaceholder')} autoFocus required />
              </Field>
              <Field label={t('live.form.name')} half>
                <input style={s.input} value={form.name} onChange={set('name')}
                  placeholder={t('live.form.namePlaceholder')} required />
              </Field>
            </div>

            <div style={s.row}>
              <Field label={t('live.form.buyin')} half>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={s.input} inputMode="decimal" value={form.buyin} onChange={set('buyin')} placeholder="150" />
                  <select style={{ ...s.input, ...s.select, width: 70, flexShrink: 0 }} value={form.currency} onChange={set('currency')}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </Field>
              <Field label={t('live.form.startingStack')} half>
                <input style={s.input} inputMode="numeric" value={form.startingStack} onChange={set('startingStack')} />
              </Field>
            </div>

            <div style={s.row}>
              <Field label={t('live.form.levelMinutes')} half>
                <input style={s.input} type="number" min="1" inputMode="numeric" value={form.levelMinutes} onChange={set('levelMinutes')} />
              </Field>
              <Field label={t('live.form.currentLevel')} half>
                <input style={s.input} type="number" min="1" inputMode="numeric" value={form.currentLevel} onChange={set('currentLevel')} />
              </Field>
            </div>

            <Field label={t('live.form.myStack')}>
              <input style={s.input} inputMode="numeric" value={form.myStack} onChange={set('myStack')}
                placeholder={form.startingStack} />
            </Field>

            <div style={s.row}>
              <Field label={t('live.form.entries')} half>
                <input style={s.input} inputMode="numeric" value={form.entries} onChange={set('entries')} placeholder="120" />
              </Field>
              <Field label={t('live.form.playersLeft')} half>
                <input style={s.input} inputMode="numeric" value={form.playersLeft} onChange={set('playersLeft')}
                  placeholder={form.entries} />
              </Field>
            </div>

            <div style={s.hint}>{t('live.form.structureHint')}</div>

            {formError && <div style={s.error}>{formError}</div>}

            <div style={s.actions}>
              {list?.length > 0 && (
                <button type="button" style={s.ghostBtn} onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}>
                  {t('common.cancel')}
                </button>
              )}
              <button style={{ ...s.btn, opacity: creating ? 0.6 : 1 }} type="submit" disabled={creating}>
                {creating ? t('common.creating') : t('live.form.create')}
              </button>
            </div>
          </form>
        )}

        {list === null && <div style={s.muted}>{t('common.loading')}</div>}

        {[[running, 'live.running'], [finished, 'live.finished']].map(([items, label]) => items.length > 0 && (
          <div key={label} style={s.section}>
            <div style={s.sectionTitle}>{t(label)}</div>
            {items.map(x => (
              <button key={x.id} style={s.item} onClick={() => navigate(`/live/${x.id}`)}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={s.itemName}>{x.name}</div>
                  <div style={s.itemMeta}>
                    {x.venue} · {new Date(x.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <div style={s.itemRight}>
                  <div style={s.itemBuyin}>{fmtNumber(x.buyin)}{x.currency}</div>
                  <div style={s.itemMeta}>
                    {x.status === 'running'
                      ? t('live.level', { n: x.current_level })
                      : x.finish_position ? t('live.finish.position', { pos: x.finish_position }) : '—'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Field({ label, half, children }) {
  return (
    <label style={{ ...s.field, ...(half ? s.half : null) }}>
      <span style={s.label}>{label}</span>
      {children}
    </label>
  )
}
