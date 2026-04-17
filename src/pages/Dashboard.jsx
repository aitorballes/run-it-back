import { useState, useEffect, useRef } from 'react'
import ggIcon from '../assets/ggpoker.png'
import wmIcon from '../assets/winamax.png'
import icon888 from '../assets/888poker.png'
import coinIcon from '../assets/coinpoker.png'
import ipokerIcon from '../assets/ipoker.png'
import psIcon from '../assets/pokerstars.png'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { parseFile, groupByTournament, parseSummaryFile } from '../lib/parser'
import { saveTournament, fetchTournaments, deleteTournament, updateTournamentSummary, generateShareToken, fetchExistingTournamentIds, fetchAllUserHands } from '../lib/db'
import { getPositionLabel, heroFoldedPreflop, preflopRaiseCount, playersWhoSawFlop } from '../lib/handUtils'

function extractBuyin(name) {
  if (!name) return null
  const m = name.match(/\$\s*([\d,]+(?:\.\d+)?)/)
  return m ? parseFloat(m[1].replace(',', '')) : null
}

const EMPTY_FILTERS = { name: '', dateFrom: '', dateTo: '', buyinMin: '', buyinMax: '' }
const EMPTY_STUDY   = { positions: [], notFoldedPreflop: false, potType: null, players: null }
const ALL_POSITIONS = ['BTN', 'CO', 'HJ', 'LJ', 'MP', 'MP+1', 'UTG', 'UTG+1', 'SB', 'BB']

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const fileInputRef = useRef()

  const [tournaments,   setTournaments]   = useState([])
  const [loading,       setLoading]       = useState(true)
  const [uploading,     setUploading]     = useState(false)
  const [uploadStatus,  setUploadStatus]  = useState(null)
  const [progress,      setProgress]      = useState(null)
  const [expandedDays,  setExpandedDays]  = useState(new Set())
  const [showFilter,    setShowFilter]    = useState(false)
  const [filters,       setFilters]       = useState(EMPTY_FILTERS)
  const [draft,         setDraft]         = useState(EMPTY_FILTERS)
  const [confirmDelete,    setConfirmDelete]    = useState(null) // { id, name }
  const [deleting,         setDeleting]         = useState(false)
  const [isMobile,         setIsMobile]         = useState(() => window.innerWidth < 768)
  const [openMenu,         setOpenMenu]         = useState(null) // tournament id with open menu
  const [copied,           setCopied]           = useState(false)
  const [showStudy,        setShowStudy]        = useState(false)
  const [studyDraft,       setStudyDraft]       = useState(EMPTY_STUDY)
  const [studyLoading,     setStudyLoading]     = useState(false)
  const [studyNoResults,   setStudyNoResults]   = useState(false)
  const [studyError,       setStudyError]       = useState(null)

  async function handleStudySearch() {
    setStudyLoading(true)
    setStudyNoResults(false)
    setStudyError(null)
    try {
      const rows = await fetchAllUserHands(user.id)
      const matched = rows.filter(({ raw: h }) => {
        if (studyDraft.positions.length > 0) {
          const heroSeat = h.seats?.find(s => s.player === 'Hero')
          if (!heroSeat) return false
          const pos = getPositionLabel(heroSeat.num, h.seats, h.buttonSeat)
          if (!studyDraft.positions.includes(pos)) return false
        }
        if (studyDraft.notFoldedPreflop && heroFoldedPreflop(h)) return false
        if (studyDraft.potType === 'srp'      && preflopRaiseCount(h) !== 1) return false
        if (studyDraft.potType === 'threebet' && preflopRaiseCount(h) < 2)   return false
        if (studyDraft.players !== null) {
          if (!h.board?.flop?.length) return false
          const cnt = playersWhoSawFlop(h)
          if (studyDraft.players === 'hu'       && cnt !== 2) return false
          if (studyDraft.players === 'multiway' && cnt < 3)   return false
        }
        return true
      })
      if (matched.length === 0) {
        setStudyNoResults(true)
      } else {
        setShowStudy(false)
        navigate('/study/results', { state: { studyHands: matched } })
      }
    } catch (e) {
      console.error(e)
      setStudyError('Error al buscar manos. Inténtalo de nuevo.')
    } finally {
      setStudyLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTournament(confirmDelete.id)
      setConfirmDelete(null)
      await loadTournaments()
    } catch (e) {
      console.error(e)
    } finally {
      setDeleting(false)
    }
  }

  async function handleShare(tournamentDbId) {
    setOpenMenu(null)
    try {
      const token = await generateShareToken(tournamentDbId)
      const url = `${window.location.origin}/share/${token}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (!openMenu) return
    function handleClick() { setOpenMenu(null) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [openMenu])

  function toggleDay(day) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  function openFilter() {
    setDraft({ ...filters })
    setShowFilter(true)
  }

  function applyFilter() {
    setFilters({ ...draft })
    setShowFilter(false)
  }

  function clearFilter() {
    setFilters(EMPTY_FILTERS)
    setDraft(EMPTY_FILTERS)
    setShowFilter(false)
  }

  useEffect(() => { loadTournaments() }, [])
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  async function loadTournaments() {
    try {
      const data = await fetchTournaments(user.id)
      setTournaments(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    setUploadStatus(null)
    setProgress(null)
    try {
      const texts = await Promise.all(files.map(f => f.text()))

      const isSummary = t => {
        const tr = t.trimStart()
        return tr.startsWith('Winamax Poker - Tournament summary')
          || tr.startsWith('Tournament #')
          || tr.startsWith('PokerTracker 4 Tournament Summary')
      }
      const summaryTexts = texts.filter(isSummary)
      const handTexts    = texts.filter(t => !isSummary(t))

      let saved = 0, skipped = 0, summariesUpdated = 0

      if (handTexts.length > 0) {
        const allHands = handTexts.flatMap(t => parseFile(t))
        const grouped  = groupByTournament(allHands)

        // Dedup en batch: una sola query para todos los torneos
        const existingIds = await fetchExistingTournamentIds(user.id, grouped.map(t => t.id))
        const toSave = grouped.filter(t => !existingIds.has(t.id))
        skipped = grouped.length - toSave.length
        saved   = toSave.length

        setProgress({ current: skipped, total: grouped.length })

        // Saves en paralelo (3 a la vez)
        const CONCURRENCY = 3
        for (let i = 0; i < toSave.length; i += CONCURRENCY) {
          await Promise.all(
            toSave.slice(i, i + CONCURRENCY).map(async t => {
              await saveTournament(t, user.id)
              setProgress(p => ({ ...p, current: p.current + 1 }))
            })
          )
        }
      }

      for (const text of summaryTexts) {
        const summary = parseSummaryFile(text)
        if (summary?.tournamentId) {
          await updateTournamentSummary(summary.tournamentId, user.id, summary)
          summariesUpdated++
        }
      }

      const parts = []
      if (saved             > 0) parts.push(`${saved} torneo${saved > 1 ? 's' : ''} guardado${saved > 1 ? 's' : ''}`)
      if (skipped           > 0) parts.push(`${skipped} ya existía${skipped > 1 ? 'n' : ''}`)
      if (summariesUpdated  > 0) parts.push(`${summariesUpdated} resumen${summariesUpdated > 1 ? 'es' : ''} actualizado${summariesUpdated > 1 ? 's' : ''}`)
      setUploadStatus({ ok: true, message: parts.join(' · ') || 'Sin cambios' })
      await loadTournaments()
    } catch (err) {
      console.error(err)
      setUploadStatus({ ok: false, message: 'Error al procesar los archivos.' })
    } finally {
      setUploading(false)
      setProgress(null)
      e.target.value = ''
    }
  }

  function formatTime(dateStr) {
    if (!dateStr) return '—'
    const m = dateStr.match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2})/)
    return m ? m[4] : dateStr
  }

  function formatDayHeader(dayKey) {
    const [y, mo, d] = dayKey.split('/')
    const date = new Date(+y, +mo - 1, +d)
    return date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  function groupByDay(list) {
    const map = new Map()
    for (const t of list) {
      const day = t.date ? t.date.slice(0, 10) : '—'
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(t)
    }
    return Array.from(map.entries()).map(([day, items]) => ({ day, items }))
  }

  const hasFilters = Object.values(filters).some(v => v !== '')

  const filtered = (() => {
    let list = tournaments
    if (filters.name) {
      const q = filters.name.toLowerCase()
      list = list.filter(t => t.name?.toLowerCase().includes(q))
    }
    if (filters.dateFrom) {
      const from = filters.dateFrom // YYYY-MM-DD
      list = list.filter(t => t.date && t.date.slice(0, 10).replace(/\//g, '-') >= from)
    }
    if (filters.dateTo) {
      const to = filters.dateTo
      list = list.filter(t => t.date && t.date.slice(0, 10).replace(/\//g, '-') <= to)
    }
    if (filters.buyinMin || filters.buyinMax) {
      const min = filters.buyinMin ? parseFloat(filters.buyinMin) : 0
      const max = filters.buyinMax ? parseFloat(filters.buyinMax) : Infinity
      list = list.filter(t => {
        const b = extractBuyin(t.name)
        return b !== null && b >= min && b <= max
      })
    }
    return list
  })()

  const grouped = groupByDay(filtered)

  return (
    <div style={s.page}>
      {/* Decorative suits */}
      <div style={{ ...s.suit, top: '6%',    left: '5%',   fontSize: 200, transform: 'rotate(-15deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '55%',   left: '2%',   fontSize: 150, transform: 'rotate(12deg)' }}>♣</div>
      <div style={{ ...s.suit, top: '8%',    right: '4%',  fontSize: 170, color: '#c03030', transform: 'rotate(10deg)' }}>♥</div>
      <div style={{ ...s.suit, top: '58%',   right: '3%',  fontSize: 130, color: '#1a50c8', transform: 'rotate(-8deg)' }}>♦</div>
      <div style={{ ...s.suit, bottom: '4%', left: '22%',  fontSize: 90,  transform: 'rotate(5deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '28%',   right: '16%', fontSize: 80,  color: '#c03030', transform: 'rotate(-22deg)' }}>♦</div>

      {/* HEADER */}
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logo}>
            <span style={s.logoSpade}>♠</span>
            <span style={s.logoText}>RunItBack</span>
          </div>
          <div style={s.headerRight}>
            <input ref={fileInputRef} type="file" accept=".txt" multiple style={{ display:'none' }} onChange={handleFiles} />

            {/* Study button */}
            <button style={s.studyBtn} onClick={() => { setStudyDraft(EMPTY_STUDY); setStudyNoResults(false); setStudyError(null); setShowStudy(true) }}>
              ♟ Estudia tu juego
            </button>

            {/* Filter button */}
            <button style={{ ...s.filterBtn, ...(hasFilters ? s.filterBtnActive : {}) }} onClick={openFilter}>
              <span style={{ fontSize: 15, lineHeight: 1 }}>⌕</span>
              Filtrar
              {hasFilters && <span style={s.filterDot} />}
            </button>

            {!isMobile && (uploading && progress ? (
              <div style={s.progressWrap}>
                <div style={s.progressBar}>
                  <div style={{ ...s.progressFill, width: `${(progress.current / progress.total) * 100}%` }} />
                </div>
                <span style={s.progressText}>{progress.current} / {progress.total} torneos</span>
              </div>
            ) : (
              <button
                style={{ ...s.uploadBtn, opacity: uploading ? 0.6 : 1 }}
                onClick={() => fileInputRef.current.click()}
                disabled={uploading}
              >
                + Cargar torneos
              </button>
            ))}
            {!isMobile && <span style={s.email}>{user?.email}</span>}
            <button style={s.signOutBtn} onClick={signOut}>Salir</button>
          </div>
        </div>
      </div>

      {/* STATUS */}
      {uploadStatus && (
        <div style={{ ...s.status, ...(uploadStatus.ok ? s.statusOk : s.statusErr) }}>
          {uploadStatus.message}
        </div>
      )}

      {/* CONTENT */}
      <div style={{ ...s.content, padding: isMobile ? '20px 12px' : '48px 24px' }}>
        {loading ? (
          <div style={s.hint}>Cargando...</div>
        ) : tournaments.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptySpade}>♠</div>
            <div style={s.emptyTitle}>No hay torneos todavía</div>
            <div style={s.hint}>Sube archivos .txt de GGPoker para empezar</div>
            <button style={s.emptyBtn} onClick={() => fileInputRef.current.click()}>
              Cargar torneos
            </button>
          </div>
        ) : (
          <div style={s.listWrap}>
            <div style={s.listHeader}>
              <span style={s.listTitle}>Mis torneos</span>
              <span style={s.listCount}>{tournaments.length}</span>
              {hasFilters && (
                <span style={s.filterInfo}>
                  {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
                  <button style={s.clearFiltersBtn} onClick={clearFilter}>✕ Limpiar filtros</button>
                </span>
              )}
            </div>

            <div style={s.list}>
              {grouped.length === 0 ? (
                <div style={{ ...s.hint, marginTop: 40 }}>Sin resultados para los filtros aplicados.</div>
              ) : grouped.map(({ day, items }) => {
                const isExpanded = hasFilters || expandedDays.has(day)
                const totalHands = items.reduce((sum, t) => sum + (t.hands_count || 0), 0)
                const sorted = [...items].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                const firstStart = formatTime(sorted[0]?.date)
                const lastEnd    = formatTime(sorted[sorted.length - 1]?.end_time || sorted[sorted.length - 1]?.date)
                const timeRange  = firstStart && lastEnd && firstStart !== lastEnd
                  ? `${firstStart} – ${lastEnd}`
                  : firstStart ?? '—'
                return (
                  <div key={day} style={{ marginBottom: 6 }}>
                    {/* Session card */}
                    <div style={{ ...s.sessionCard, ...(isExpanded ? s.sessionCardOpen : {}) }}
                      onClick={() => toggleDay(day)}>
                      <div style={s.sessionTop}>
                        <div>
                          <div style={{ ...s.sessionDay, fontSize: isMobile ? 11 : 13 }}>{formatDayHeader(day)}</div>
                        </div>
                        <span style={{ fontSize: 11, color: '#2a5070', transition: 'transform 0.2s',
                          display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                      </div>
                      <div style={s.sessionStats}>
                        <div style={s.stat}>
                          <span style={{ ...s.statValue, fontSize: isMobile ? 14 : 18 }}>{items.length}</span>
                          <span style={s.statLabel}>torneos</span>
                        </div>
                        <div style={s.statDivider} />
                        <div style={s.stat}>
                          <span style={{ ...s.statValue, fontSize: isMobile ? 14 : 18 }}>{totalHands.toLocaleString('es-ES')}</span>
                          <span style={s.statLabel}>manos</span>
                        </div>
                        <div style={s.statDivider} />
                        <div style={s.stat}>
                          <span style={{ ...s.statValue, fontSize: isMobile ? 12 : 18, whiteSpace: 'nowrap' }}>{timeRange}</span>
                          <span style={s.statLabel}>horario</span>
                        </div>
                      </div>
                    </div>

                    {/* Tournament rows */}
                    {isExpanded && (
                      <div style={s.sessionRows}>
                        {items.map(t => (
                          <div key={t.id} style={s.row} onClick={() => navigate(`/tournament/${t.id}`)}>
                            <img
                              src={{ winamax: wmIcon, '888poker': icon888, coinpoker: coinIcon, ipoker: ipokerIcon, pokerstars: psIcon }[t.platform] ?? ggIcon}
                              alt={t.platform || 'ggpoker'}
                              style={s.rowIcon}
                            />
                            <div style={s.rowInfo}>
                              <div style={s.rowName}>{t.name}</div>
                              <div style={s.rowMeta}>
                                <span style={s.rowTime}>{formatTime(t.date)}</span>
                                {t.finish_position != null && (
                                  <span style={s.rowPos}>
                                    {t.finish_position}º{t.players ? ` / ${t.players.toLocaleString('es-ES')}` : ''}
                                  </span>
                                )}
                                {t.prize_won > 0 && (
                                  <span style={s.rowPrize}>+{t.prize_won.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                )}
                              </div>
                            </div>
                            <div style={s.rowBadge}>{t.hands_count} manos</div>
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <button
                                style={s.menuBtn}
                                onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === t.id ? null : t.id) }}
                              >
                                ⋯
                              </button>
                              {openMenu === t.id && (
                                <div style={s.dropdown} onClick={e => e.stopPropagation()}>
                                  <button style={s.dropdownItem} onClick={() => { setOpenMenu(null); setConfirmDelete({ id: t.id, name: t.name }) }}>
                                    Eliminar
                                  </button>
                                  <button style={s.dropdownItem} onClick={() => handleShare(t.id)}>
                                    Compartir
                                  </button>
                                </div>
                              )}
                            </div>
                            <div style={s.rowArrow}>›</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* COPIED TOAST */}
      {copied && (
        <div style={s.toast}>¡Enlace copiado!</div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {confirmDelete && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div style={{ ...s.modal, width: 'min(380px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Borrar torneo</span>
              <button style={s.modalClose} onClick={() => setConfirmDelete(null)}>✕</button>
            </div>
            <div style={{ padding: '22px 22px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 13, color: '#8ab0cc', margin: 0 }}>
                ¿Seguro que quieres borrar este torneo? Esta acción no se puede deshacer.
              </p>
              <p style={{ fontSize: 12, color: '#3a6080', margin: 0, fontWeight: 700 }}>
                {confirmDelete.name}
              </p>
            </div>
            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setConfirmDelete(null)} disabled={deleting}>
                Cancelar
              </button>
              <button
                style={{ ...s.applyBtn, background: 'linear-gradient(135deg, #8a1a1a, #5a0a0a)', borderColor: '#6a2020', opacity: deleting ? 0.6 : 1 }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Borrando...' : 'Sí, borrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STUDY MODAL */}
      {showStudy && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowStudy(false)}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>♟ Estudia tu juego</span>
              <button style={s.modalClose} onClick={() => setShowStudy(false)}>✕</button>
            </div>

            <div style={s.modalBody}>
              {/* Posición */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Posición del Hero</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ALL_POSITIONS.map(pos => {
                    const active = studyDraft.positions.includes(pos)
                    return (
                      <button key={pos}
                        style={{ ...s.chipBtn, ...(active ? s.chipBtnActive : {}) }}
                        onClick={() => setStudyDraft(d => ({
                          ...d,
                          positions: active ? d.positions.filter(p => p !== pos) : [...d.positions, pos],
                        }))}
                      >{pos}</button>
                    )
                  })}
                </div>
              </div>

              {/* Solo jugadas */}
              <div style={s.field}>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={studyDraft.notFoldedPreflop}
                    onChange={e => setStudyDraft(d => ({ ...d, notFoldedPreflop: e.target.checked }))}
                    style={{ accentColor: '#50d080', width: 15, height: 15 }} />
                  Solo manos jugadas (Hero no foldea preflop)
                </label>
              </div>

              {/* Tipo de bote */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Tipo de bote</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[{ value: null, label: 'Cualquiera' }, { value: 'srp', label: 'SRP' }, { value: 'threebet', label: '3-bet pot' }].map(opt => {
                    const active = studyDraft.potType === opt.value
                    return (
                      <button key={String(opt.value)}
                        style={{ ...s.chipBtn, flex: 1, ...(active ? s.chipBtnActive : {}) }}
                        onClick={() => setStudyDraft(d => ({ ...d, potType: opt.value }))}
                      >{opt.label}</button>
                    )
                  })}
                </div>
              </div>

              {/* Jugadores en el bote */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Jugadores en el bote</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[{ value: null, label: 'Cualquiera' }, { value: 'hu', label: 'Heads Up' }, { value: 'multiway', label: 'Multiway' }].map(opt => {
                    const active = studyDraft.players === opt.value
                    return (
                      <button key={String(opt.value)}
                        style={{ ...s.chipBtn, flex: 1, ...(active ? s.chipBtnActive : {}) }}
                        onClick={() => setStudyDraft(d => ({ ...d, players: opt.value }))}
                      >{opt.label}</button>
                    )
                  })}
                </div>
              </div>

              {studyError && <div style={s.studyError}>{studyError}</div>}
              {studyNoResults && <div style={s.studyNoResults}>No se encontraron manos con esos filtros.</div>}
            </div>

            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setShowStudy(false)} disabled={studyLoading}>Cancelar</button>
              <button style={{ ...s.studySearchBtn, opacity: studyLoading ? 0.6 : 1 }}
                onClick={handleStudySearch} disabled={studyLoading}>
                {studyLoading ? 'Buscando...' : 'Buscar manos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILTER MODAL */}
      {showFilter && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowFilter(false)}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Filtrar torneos</span>
              <button style={s.modalClose} onClick={() => setShowFilter(false)}>✕</button>
            </div>

            <div style={s.modalBody}>
              {/* Nombre */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Nombre</label>
                <input
                  style={s.fieldInput}
                  type="text"
                  placeholder="Ej: NLH, Freezeout, GGMasters..."
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                />
              </div>

              {/* Fechas */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Rango de fechas</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    style={{ ...s.fieldInput, flex: 1 }}
                    type="date"
                    value={draft.dateFrom}
                    onChange={e => setDraft(d => ({ ...d, dateFrom: e.target.value }))}
                  />
                  <span style={{ color: '#3a5a70', fontSize: 12, flexShrink: 0 }}>—</span>
                  <input
                    style={{ ...s.fieldInput, flex: 1 }}
                    type="date"
                    value={draft.dateTo}
                    onChange={e => setDraft(d => ({ ...d, dateTo: e.target.value }))}
                  />
                </div>
              </div>

              {/* Buy-in */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Buy-in ($)</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={s.priceInput}>
                    <span style={s.priceSymbol}>$</span>
                    <input
                      style={s.priceField}
                      type="number"
                      min="0"
                      placeholder="Mín"
                      value={draft.buyinMin}
                      onChange={e => setDraft(d => ({ ...d, buyinMin: e.target.value }))}
                    />
                  </div>
                  <span style={{ color: '#3a5a70', fontSize: 12, flexShrink: 0 }}>—</span>
                  <div style={s.priceInput}>
                    <span style={s.priceSymbol}>$</span>
                    <input
                      style={s.priceField}
                      type="number"
                      min="0"
                      placeholder="Máx"
                      value={draft.buyinMax}
                      onChange={e => setDraft(d => ({ ...d, buyinMax: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={clearFilter}>Limpiar</button>
              <button style={s.applyBtn} onClick={applyFilter}>Aplicar filtros</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 30% 20%, #1a2a3a 0%, #0d1520 40%, #050b10 100%)',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: '#dde0e8',
    position: 'relative',
    overflow: 'hidden',
  },
  suit: {
    position: 'absolute',
    color: '#ffffff',
    opacity: 0.04,
    lineHeight: 1,
    pointerEvents: 'none',
    userSelect: 'none',
  },

  // Header
  header: {
    background: 'rgba(10,15,25,0.85)',
    borderBottom: '1px solid #1a2a3a',
    backdropFilter: 'blur(10px)',
    flexShrink: 0,
    zIndex: 2,
  },
  headerInner: {
    maxWidth: 860,
    margin: '0 auto',
    padding: '12px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  logoSpade: {
    fontSize: 22,
    color: '#60b0ff',
    textShadow: '0 0 20px rgba(60,140,255,0.6)',
    lineHeight: 1,
  },
  logoText: {
    fontSize: 18,
    fontWeight: 900,
    color: '#e8f0ff',
    letterSpacing: '-0.3px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  filterBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: '1px solid #2a4a62',
    borderRadius: 8,
    padding: '6px 13px',
    color: '#4a7090',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    position: 'relative',
  },
  filterBtnActive: {
    border: '1px solid #3a6a9a',
    color: '#70b0e0',
  },
  filterDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#60b0ff',
  },
  uploadBtn: {
    background: 'linear-gradient(135deg, #1e5cad, #0c3080)',
    border: '1px solid #2a4a80',
    borderRadius: 8,
    padding: '7px 16px',
    color: '#d0e8ff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 12px rgba(20,60,160,0.35)',
  },
  email: {
    fontSize: 12,
    color: '#4a7090',
  },
  signOutBtn: {
    background: 'none',
    border: '1px solid #2a4a62',
    borderRadius: 6,
    color: '#4a7090',
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: 12,
  },

  // Status
  status: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 16px',
    zIndex: 2,
    flexShrink: 0,
  },
  statusOk: {
    color: '#50d080',
    background: 'rgba(30,150,60,0.1)',
    borderBottom: '1px solid rgba(30,150,60,0.15)',
  },
  statusErr: {
    color: '#e07070',
    background: 'rgba(160,30,30,0.1)',
    borderBottom: '1px solid rgba(160,30,30,0.15)',
  },

  // Content
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '48px 24px',
    zIndex: 1,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    marginTop: 80,
  },
  emptySpade: {
    fontSize: 56,
    color: '#1a2a3a',
    textShadow: '0 0 30px rgba(60,140,255,0.1)',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#2a4a6a',
  },
  hint: {
    fontSize: 13,
    color: '#2a3a50',
    marginTop: 60,
  },
  emptyBtn: {
    marginTop: 8,
    background: 'linear-gradient(135deg, #1e5cad, #0c3080)',
    border: '1px solid #2a4a80',
    borderRadius: 8,
    padding: '11px 28px',
    color: '#d0e8ff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(20,60,160,0.35)',
  },

  // List
  listWrap: {
    width: '100%',
    maxWidth: 780,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 4,
  },
  listTitle: {
    fontSize: 11,
    fontWeight: 800,
    color: '#5a8aaa',
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
  },
  listCount: {
    fontSize: 10,
    fontWeight: 800,
    color: '#5a8aaa',
    background: '#0a1520',
    border: '1px solid #1a3048',
    borderRadius: 10,
    padding: '1px 8px',
  },
  filterInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginLeft: 4,
    fontSize: 11,
    color: '#70b0e0',
    fontWeight: 600,
  },
  clearFiltersBtn: {
    background: 'none',
    border: 'none',
    color: '#3a6888',
    fontSize: 11,
    cursor: 'pointer',
    padding: 0,
    fontWeight: 700,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  row: {
    background: 'linear-gradient(160deg, #0d1622 0%, #090e18 100%)',
    borderBottom: '1px solid #0e1828',
    padding: '13px 18px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    cursor: 'pointer',
  },
  rowIcon: {
    flexShrink: 0,
    width: 24,
    height: 24,
    borderRadius: 5,
    objectFit: 'contain',
  },
  rowInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  rowName: {
    fontSize: 14,
    fontWeight: 700,
    color: '#7ab0d8',
  },
  rowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rowTime: {
    fontSize: 11,
    color: '#4a7090',
  },
  rowPos: {
    fontSize: 11,
    color: '#5a8aaa',
    fontWeight: 700,
  },
  rowPrize: {
    fontSize: 11,
    color: '#40c070',
    fontWeight: 800,
  },
  rowBadge: {
    fontSize: 12,
    fontWeight: 700,
    color: '#7ab0d8',
    background: '#0e1e30',
    border: '1px solid #2a4a6a',
    borderRadius: 6,
    padding: '3px 10px',
    flexShrink: 0,
  },
  menuBtn: {
    background: 'none',
    border: 'none',
    fontSize: 20,
    cursor: 'pointer',
    opacity: 0.45,
    padding: '2px 6px',
    flexShrink: 0,
    lineHeight: 1,
    color: '#dde0e8',
    letterSpacing: 2,
  },
  dropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    marginTop: 4,
    background: 'linear-gradient(160deg, #131c2c 0%, #0c1420 100%)',
    border: '1px solid #2a3a52',
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 50,
    minWidth: 130,
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid #1a2a3a',
    padding: '10px 16px',
    color: '#c0d8f0',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'left',
  },
  toast: {
    position: 'fixed',
    bottom: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#0e2a1a',
    border: '1px solid #2a6a3a',
    color: '#50d080',
    padding: '10px 26px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 700,
    zIndex: 200,
    boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
    whiteSpace: 'nowrap',
  },
  rowArrow: {
    fontSize: 20,
    color: '#1e3050',
    flexShrink: 0,
    lineHeight: 1,
  },
  sessionCard: {
    background: 'linear-gradient(160deg, #0e1828 0%, #090f1a 100%)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#1a2a3a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    padding: '16px 20px',
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  },
  sessionCardOpen: {
    borderColor: '#2a4a6a',
    borderBottomColor: '#0e1a28',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  sessionTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sessionDay: {
    fontSize: 13,
    fontWeight: 800,
    color: '#7ab0d8',
    textTransform: 'capitalize',
    letterSpacing: '0.2px',
  },
  sessionStats: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 900,
    color: '#c0d8f0',
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: '#2a5070',
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
  },
  statDivider: {
    width: 1,
    height: 30,
    background: '#0e1a28',
    flexShrink: 0,
  },
  sessionRows: {
    border: '1px solid #2a4a6a',
    borderTop: 'none',
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    overflow: 'hidden',
  },
  // Progress
  progressWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 160,
  },
  progressBar: {
    width: '100%',
    height: 4,
    background: '#0a1520',
    borderRadius: 4,
    overflow: 'hidden',
    border: '1px solid #1a2a3a',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(to right, #1e5cad, #60b0ff)',
    borderRadius: 4,
    transition: 'width 0.2s ease',
  },
  progressText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#4a80b0',
    letterSpacing: '0.3px',
  },

  // Modal
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  modal: {
    background: 'linear-gradient(160deg, #131c2c 0%, #0c1420 100%)',
    border: '1px solid #2a3a52',
    borderRadius: 18,
    width: 'min(420px, calc(100vw - 32px))',
    boxShadow: '0 30px 90px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 22px 14px',
    borderBottom: '1px solid #1a2a3a',
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 800,
    color: '#c0d8f0',
    letterSpacing: '0.3px',
  },
  modalClose: {
    background: 'none',
    border: 'none',
    color: '#3a5a70',
    cursor: 'pointer',
    fontSize: 14,
    padding: '2px 6px',
  },
  modalBody: {
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: 800,
    color: '#3a6080',
    letterSpacing: '1px',
    textTransform: 'uppercase',
  },
  fieldInput: {
    background: '#080e18',
    border: '1px solid #1e2e42',
    borderRadius: 9,
    padding: '10px 13px',
    color: '#c8d4e8',
    fontSize: 13,
    outline: 'none',
    colorScheme: 'dark',
  },
  priceInput: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    background: '#080e18',
    border: '1px solid #1e2e42',
    borderRadius: 9,
    padding: '0 13px',
    gap: 4,
  },
  priceSymbol: {
    fontSize: 13,
    color: '#3a6080',
    flexShrink: 0,
  },
  priceField: {
    flex: 1,
    background: 'none',
    border: 'none',
    outline: 'none',
    padding: '10px 0',
    color: '#c8d4e8',
    fontSize: 13,
    width: 0,
  },
  modalFooter: {
    display: 'flex',
    gap: 10,
    padding: '14px 22px 20px',
    borderTop: '1px solid #1a2a3a',
  },
  clearBtn: {
    flex: 1,
    background: 'none',
    border: '1px solid #2a3a52',
    borderRadius: 9,
    padding: '10px',
    color: '#4a7090',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
  },
  applyBtn: {
    flex: 2,
    background: 'linear-gradient(135deg, #1e5cad, #0c3080)',
    border: '1px solid #2a4a80',
    borderRadius: 9,
    padding: '10px',
    color: '#d0e8ff',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(20,60,160,0.35)',
  },
  chipBtn: {
    background: 'none', border: '1px solid #2a3a52', borderRadius: 7,
    padding: '7px 13px', color: '#4a7090', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  chipBtnActive: { background: 'rgba(60,180,120,0.12)', border: '1px solid #3a8a5a', color: '#50d080' },
  checkLabel: {
    display: 'flex', alignItems: 'center', gap: 9,
    cursor: 'pointer', fontSize: 13, color: '#7ab0d8', fontWeight: 600,
  },
  studyError: {
    fontSize: 12, color: '#e07070', background: 'rgba(160,30,30,0.1)',
    border: '1px solid rgba(160,30,30,0.2)', borderRadius: 8, padding: '10px 14px',
  },
  studyNoResults: {
    fontSize: 12, color: '#4a7090', background: 'rgba(30,60,90,0.1)',
    border: '1px solid rgba(30,60,90,0.2)', borderRadius: 8, padding: '10px 14px',
  },
  studySearchBtn: {
    flex: 2,
    background: 'linear-gradient(135deg, #1a3a20, #0c2014)', border: '1px solid #2a6a3a',
    borderRadius: 9, padding: '10px', color: '#50d080', fontSize: 13, fontWeight: 800,
    cursor: 'pointer', boxShadow: '0 4px 20px rgba(20,100,50,0.3)',
  },
  studyBtn: {
    background: 'linear-gradient(135deg, #1a3a20, #0c2014)',
    border: '1px solid #2a6a3a',
    borderRadius: 8,
    padding: '7px 14px',
    color: '#50d080',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 12px rgba(20,100,50,0.25)',
  },
}
