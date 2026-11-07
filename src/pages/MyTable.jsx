import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/core'
import { fetchLiveTournament, updateLiveTournament, fetchPlayerNotes, updatePlayerNote, deletePlayerNote, playerNameKey } from '../lib/db'
import { TABLE_SIZES, currentTable, findTable, physicalSeat, noteAtSeat, saveSeatNote, applySaved } from '../lib/liveTable'
import Logo from '../components/Logo'
import LiveTable from '../components/table/LiveTable'
import { base } from '../components/liveStyles'

const toInt = v => { const n = parseInt(String(v).replace(/[^\d]/g, ''), 10); return n > 0 ? n : null }

// "My table": which table you're at and your seat there, and notes on the players around you.
// Moved to another table → add it; the last table added is where you are now.
export default function MyTable() {
  const { user } = useAuth()
  const { id } = useParams() // live tournament
  const navigate = useNavigate()
  const { t, locale } = useI18n()

  const [tour, setTour]     = useState(null)
  const [notes, setNotes]   = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError]   = useState('')
  const [viewNo, setViewNo] = useState(null)   // table being shown
  const [tableForm, setTableForm] = useState(null) // { mode: 'new' | 'edit', no, seats, mySeat }
  const [seat, setSeat]     = useState(null)   // seat being edited
  const [name, setName]     = useState('')
  const [text, setText]     = useState('')
  const [query, setQuery]   = useState('')
  const [editing, setEditing] = useState(null) // note id edited from the list
  const [draft, setDraft]   = useState('')

  useEffect(() => {
    fetchLiveTournament(id).then(row => {
      if (!row) { setStatus('notFound'); return }
      setTour(row)
      const cur = currentTable(row)
      setViewNo(cur?.no ?? null)
      if (!cur) setTableForm({ mode: 'new', no: '', seats: 9, mySeat: null })
      setStatus('ready')
    }).catch(() => setStatus('error'))
    fetchPlayerNotes(id).then(setNotes).catch(() => { setNotes([]); setError(t('live.notes.loadError')) })
  }, [id, t])

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

  const tables = tour.tables ?? []
  const cur = currentTable(tour)
  const table = findTable(tour, viewNo)
  const allNotes = notes ?? []
  const displayName = n => n.name || t('live.notes.seatN', { n: n.seat ?? '?' })

  // ── Tables ──
  function openNewTable() {
    closeSeat()
    setTableForm({ mode: 'new', no: '', seats: cur?.seats ?? 9, mySeat: null })
  }

  async function saveTable(e) {
    e.preventDefault()
    const no = toInt(tableForm.no)
    if (!no || !tableForm.mySeat) return
    const entry = { no, seats: tableForm.seats, mySeat: Math.min(tableForm.mySeat, tableForm.seats) }
    let next
    if (tableForm.mode === 'edit') {
      next = tables.map(tb => (tb.no === viewNo ? { ...tb, ...entry } : tb))
    } else {
      // Back to a table you already were at → it becomes the current one again
      next = [...tables.filter(tb => tb.no !== no), { ...entry, at: new Date().toISOString() }]
    }
    try {
      await updateLiveTournament(tour.id, { tables: next })
      // Renaming a table carries its notes along
      if (tableForm.mode === 'edit' && no !== viewNo) {
        const moved = allNotes.filter(n => n.table_no === viewNo)
        const updated = await Promise.all(moved.map(n => updatePlayerNote(n.id, { tableNo: no })))
        setNotes(ns => ns.map(n => updated.find(u => u.id === n.id) ?? n))
      }
      setTour(tr => ({ ...tr, tables: next }))
      setViewNo(no)
      setTableForm(null)
    } catch {
      setError(t('live.saveError'))
    }
  }

  // ── Seats ──
  function openSeat(sn) {
    const n = noteAtSeat(allNotes, table.no, sn)
    setSeat(sn); setName(n?.name ?? ''); setText(n?.note ?? '')
  }
  function closeSeat() { setSeat(null); setName(''); setText('') }

  async function saveSeat(e) {
    e.preventDefault()
    try {
      const res = await saveSeatNote({ userId: user.id, tourId: tour.id, notes: allNotes, tableNo: table.no, seat, name, note: text.trim() })
      setNotes(ns => applySaved(ns, res))
      closeSeat()
    } catch {
      setError(t('live.notes.saveError'))
    }
  }

  async function remove(noteId) {
    if (!window.confirm(t('live.notes.deleteConfirm'))) return
    try {
      await deletePlayerNote(noteId)
      setNotes(ns => ns.filter(n => n.id !== noteId))
      closeSeat()
    } catch {
      setError(t('live.saveError'))
    }
  }

  async function saveEdit(n) {
    try {
      const saved = await updatePlayerNote(n.id, { note: draft.trim() })
      setNotes(ns => applySaved(ns, { saved }))
      setEditing(null)
    } catch {
      setError(t('live.notes.saveError'))
    }
  }

  // Seats on the felt: you at the bottom, the rest clockwise
  const feltSeats = table ? Array.from({ length: table.seats }, (_, i) => {
    const sn = physicalSeat(table, i)
    const n = i ? noteAtSeat(allNotes, table.no, sn) : null
    return {
      name: i === 0 ? t('live.hand.me') : n ? (n.name || '?') : '—',
      pos: t('live.myTable.seatShort', { n: sn }),
      stackUnknown: true,
      hasNote: !!n?.note,
      selected: seat === sn,
    }
  }) : []
  const seatOf = i => physicalSeat(table, i)
  const seatNote = table && seat ? noteAtSeat(allNotes, table.no, seat) : null
  const otherNamed = name.trim() ? allNotes.find(n => n.name && n.name_key === playerNameKey(name) && n.id !== seatNote?.id) : null

  const q = playerNameKey(query)
  const listed = q
    ? allNotes.filter(n => n.name_key.includes(q) || n.note.toLowerCase().includes(q))
    : allNotes.filter(n => n.table_no === viewNo).sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99))

  return (
    <div style={base.page}>
      <Header navigate={navigate} t={t} id={id} />
      <div style={base.content}>
        <div>
          <div style={base.title}>{t('live.myTable.title')}</div>
          <div style={base.subtitle}>{tour.name} · {tour.venue}</div>
        </div>

        {error && <div style={base.error}>{error}</div>}

        {/* Table picker */}
        {tables.length > 0 && (
          <div style={st.chips}>
            {[...tables].reverse().map(tb => (
              <button key={tb.no} type="button" style={{ ...st.chip, ...(viewNo === tb.no ? st.chipOn : null) }}
                onClick={() => { setViewNo(tb.no); setTableForm(null); closeSeat() }}>
                {t('live.notes.tableN', { n: tb.no })}{tb === cur ? ` · ${t('live.myTable.now')}` : ''}
              </button>
            ))}
            {!tableForm && <button type="button" style={st.addChip} onClick={openNewTable}>+ {t('live.myTable.newTable')}</button>}
          </div>
        )}

        {/* New / edit table */}
        {tableForm && (
          <form style={base.card} onSubmit={saveTable}>
            <div style={base.cardTitle}>{tableForm.mode === 'edit' ? t('live.myTable.editTable') : t('live.myTable.newTable')}</div>
            {tableForm.mode === 'new' && tables.length > 0 && <div style={base.hint}>{t('live.myTable.movedHint')}</div>}
            <div style={base.row}>
              <label style={{ ...base.field, flex: '1 1 100px' }}>
                <span style={base.label}>{t('live.myTable.tableNo')}</span>
                <input style={base.input} inputMode="numeric" value={tableForm.no} autoFocus placeholder="12"
                  onChange={e => setTableForm(f => ({ ...f, no: e.target.value }))} />
              </label>
              <label style={{ ...base.field, flex: '1 1 100px' }}>
                <span style={base.label}>{t('live.myTable.seats')}</span>
                <select style={{ ...base.input, ...base.select }} value={tableForm.seats}
                  onChange={e => setTableForm(f => ({ ...f, seats: Number(e.target.value), mySeat: f.mySeat > Number(e.target.value) ? null : f.mySeat }))}>
                  {TABLE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div style={base.field}>
              <span style={base.label}>{t('live.myTable.mySeat')}</span>
              <div style={st.chips}>
                {Array.from({ length: tableForm.seats }, (_, k) => k + 1).map(sn => (
                  <button key={sn} type="button" style={{ ...st.chip, ...(tableForm.mySeat === sn ? st.chipOn : null) }}
                    onClick={() => setTableForm(f => ({ ...f, mySeat: sn }))}>{sn}</button>
                ))}
              </div>
            </div>
            <div style={base.actions}>
              {tables.length > 0 && <button style={base.ghostBtn} type="button" onClick={() => setTableForm(null)}>{t('common.cancel')}</button>}
              <button style={{ ...base.btn, opacity: toInt(tableForm.no) && tableForm.mySeat ? 1 : 0.4 }}
                disabled={!(toInt(tableForm.no) && tableForm.mySeat)} type="submit">{t('common.save')}</button>
            </div>
          </form>
        )}

        {/* The table */}
        {table && !tableForm && (
          <div style={{ ...base.card, padding: '12px 8px' }}>
            <div style={st.tableHead}>
              <span style={st.tableTitle}>
                {t('live.notes.tableN', { n: table.no })} · {t('live.myTable.youAt', { n: table.mySeat })}
              </span>
              <button style={base.ghostBtn} onClick={() => { closeSeat(); setTableForm({ mode: 'edit', no: String(table.no), seats: table.seats, mySeat: table.mySeat }) }}>
                ✎ {t('live.myTable.editTable')}
              </button>
            </div>
            <LiveTable seats={feltSeats} hideCards onSeatClick={i => (i === 0 ? null : seat === seatOf(i) ? closeSeat() : openSeat(seatOf(i)))} />
            <div style={{ ...base.hint, textAlign: 'center', padding: '0 8px' }}>{t('live.myTable.tapSeat')}</div>
          </div>
        )}

        {/* Seat editor */}
        {table && seat && !tableForm && (
          <form style={base.card} onSubmit={saveSeat}>
            <div style={base.cardTitle}>{t('live.notes.tableN', { n: table.no })} · {t('live.notes.seatN', { n: seat })}</div>
            <label style={base.field}>
              <span style={base.label}>{t('live.hand.rivalName')} ({t('live.hand.optional')})</span>
              <input style={base.input} value={name} autoFocus list="my-table-names" placeholder={t('live.hand.rivalNamePh')}
                onChange={e => setName(e.target.value)} />
              <datalist id="my-table-names">{allNotes.filter(n => n.name).map(n => <option key={n.id} value={n.name} />)}</datalist>
            </label>
            <label style={base.field}>
              <span style={base.label}>{t('live.notes.note')}</span>
              <textarea style={{ ...base.input, minHeight: 80, resize: 'vertical' }} value={text}
                onChange={e => setText(e.target.value)} placeholder={t('live.notes.notePh')} />
            </label>
            {otherNamed && (
              <div style={base.hint}>
                {otherNamed.table_no != null && otherNamed.table_no !== table.no
                  ? t('live.myTable.movesHere', { name: otherNamed.name, place: t('live.notes.tableN', { n: otherNamed.table_no }) })
                  : t('live.notes.willReplace', { name: otherNamed.name })}
              </div>
            )}
            <div style={{ ...base.actions, justifyContent: 'space-between' }}>
              <div>{seatNote && <button style={{ ...base.ghostBtn, color: '#e07070' }} type="button" onClick={() => remove(seatNote.id)}>{t('common.delete')}</button>}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={base.ghostBtn} type="button" onClick={closeSeat}>{t('common.cancel')}</button>
                <button style={base.btn} type="submit">{t('common.save')}</button>
              </div>
            </div>
          </form>
        )}

        {/* Notes: this table's players, or a search across every table */}
        {notes !== null && (allNotes.length > 0 || query) && (
          <>
            <input style={base.input} value={query} onChange={e => setQuery(e.target.value)} placeholder={`🔍 ${t('live.notes.search')}`} />
            {!q && <div style={base.sectionTitle}>{t('live.myTable.players')}</div>}
          </>
        )}
        {notes === null && <div style={base.muted}>{t('common.loading')}</div>}
        {notes !== null && listed.length === 0 && table && !q && <div style={base.muted}>{t('live.myTable.noPlayers')}</div>}

        {listed.map(n => (
          <div key={n.id} style={st.item}>
            <div style={st.head}>
              <div style={{ minWidth: 0 }}>
                <div style={st.name}>{displayName(n)}</div>
                <div style={st.meta}>
                  {[
                    n.table_no != null && (q || n.table_no !== viewNo) && t('live.notes.tableN', { n: n.table_no }),
                    n.seat != null && n.name && t('live.notes.seatN', { n: n.seat }),
                    new Date(n.updated_at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              {editing !== n.id && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button style={st.iconBtn} title={t('live.notes.edit')} onClick={() => { setEditing(n.id); setDraft(n.note) }}>✎</button>
                  <button style={{ ...st.iconBtn, color: '#e07070' }} title={t('common.delete')} onClick={() => remove(n.id)}>✕</button>
                </div>
              )}
            </div>
            {editing === n.id ? (
              <>
                <textarea style={{ ...base.input, minHeight: 80, resize: 'vertical' }} value={draft} autoFocus onChange={e => setDraft(e.target.value)} />
                <div style={base.actions}>
                  <button style={base.ghostBtn} onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                  <button style={base.btn} onClick={() => saveEdit(n)}>{t('common.save')}</button>
                </div>
              </>
            ) : (
              <div style={st.note}>{n.note || <span style={{ color: '#4a6a8a' }}>{t('live.notes.noNote')}</span>}</div>
            )}
          </div>
        ))}
      </div>
    </div>
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

const st = {
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    background: '#080e18', border: '1px solid #1e2e42', borderRadius: 8, color: '#7a94b0',
    padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', minWidth: 42,
  },
  chipOn: { background: 'linear-gradient(135deg, #2a2210, #1a1600)', borderColor: '#c8a800', color: '#ffe566' },
  addChip: {
    background: 'none', border: '1px dashed #2a4a80', borderRadius: 8, color: '#5a8ab0',
    padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  },
  tableHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '0 8px' },
  tableTitle: { fontSize: 14, fontWeight: 800, color: '#c8d8f0' },
  item: {
    background: 'rgba(16,24,38,0.85)', border: '1px solid #1e2e42', borderRadius: 11,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  name: { fontSize: 15, fontWeight: 800, color: '#f0c070' },
  meta: { fontSize: 11, color: '#4a6a8a', marginTop: 2 },
  note: { fontSize: 13, color: '#c8d4e8', lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  iconBtn: {
    width: 32, height: 32, borderRadius: 8, border: '1px solid #1e2e42', background: '#0a1422',
    color: '#7ab0d8', cursor: 'pointer', fontSize: 13,
  },
}
