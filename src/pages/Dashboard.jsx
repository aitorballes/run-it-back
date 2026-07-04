import { useState, useEffect, useRef, useCallback } from 'react'
import { strToU8, zipSync } from 'fflate'
import { serializeTournament, serializeSummary } from '../lib/serializer'
import { fetchTournamentsInRange, fetchHandsBatch } from '../lib/db'
import ggIcon from '../assets/ggpoker.png'
import wmIcon from '../assets/winamax.png'
import icon888 from '../assets/888poker.png'
import coinIcon from '../assets/coinpoker.png'
import ipokerIcon from '../assets/ipoker.png'
import psIcon from '../assets/pokerstars.png'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { parseFile, groupByTournament, parseSummaryFile } from '../lib/parser'
import { saveTournament, fetchTournaments, deleteTournament, updateTournamentSummary, generateShareToken, fetchExistingTournamentIds, fetchAllUserHands, fetchHandsByIds, fetchAllUserListHandIds, fetchUserReviewLists, fetchHandsInList, createReviewList, renameReviewList, deleteReviewList, fetchHeroStats, migrateHandStats } from '../lib/db'
import { getPositionLabel, heroFoldedPreflop, preflopRaiseCount, playersWhoSawFlop, preflopIsClean, preflopIsLimped, heroIsPfr, heroPositionVsField, bbFoldedPreflop } from '../lib/handUtils'

function extractBuyin(name) {
  if (!name) return null
  const m = name.match(/\$\s*([\d,]+(?:\.\d+)?)/)
  return m ? parseFloat(m[1].replace(',', '')) : null
}

const EMPTY_FILTERS = { name: '', dateFrom: '', dateTo: '', buyinMin: '', buyinMax: '' }
const EMPTY_STUDY   = { positions: [], notFoldedPreflop: false, potType: null, players: null, dateRange: null, dateFrom: '', dateTo: '', heroPfr: false, posVsField: null, bbFold: false }
const ALL_POSITIONS = ['BTN', 'CO', 'HJ', 'LJ', 'MP', 'MP+1', 'UTG', 'UTG+1', 'SB', 'BB']

const calStyle = {
  outer: {
    position: 'fixed',
    top: 82,
    right: 24,
    width: 282,
    zIndex: 2,
  },
  title: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color: '#5a8aaa',
    marginBottom: 10,
    textAlign: 'right',
  },
  widget: {
    background: '#0d1622',
    border: '1px solid #1a2a3a',
    borderRadius: 14,
    padding: '16px 16px 12px',
  },
  month: {
    fontSize: 15,
    fontWeight: 600,
    color: '#dde0e8',
    marginBottom: 0,
    textTransform: 'capitalize',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 2,
  },
  dayLabel: {
    textAlign: 'center',
    fontSize: 11,
    color: '#4a7090',
    fontWeight: 600,
    padding: '2px 0 6px',
    letterSpacing: '0.04em',
  },
  day: {
    textAlign: 'center',
    fontSize: 13,
    borderRadius: 6,
    minHeight: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayActive: {
    color: '#60b0ff',
    fontWeight: 700,
    cursor: 'pointer',
    background: 'rgba(96, 176, 255, 0.12)',
  },
  dayInactive: {
    color: '#4a7090',
    cursor: 'default',
  },
  dayToday: {
    color: '#50d080',
    fontWeight: 700,
    cursor: 'pointer',
    background: 'rgba(80, 208, 128, 0.12)',
    outline: '1px solid rgba(80, 208, 128, 0.4)',
    outlineOffset: '-1px',
  },
  daySelected: {
    outline: '2px solid rgba(96, 176, 255, 0.6)',
    outlineOffset: '-1px',
  },
  navBtn: {
    background: 'none',
    border: 'none',
    color: '#7ab0d8',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 4px',
    borderRadius: 5,
  },
  navBtnDisabled: {
    color: '#2a4a62',
    cursor: 'default',
  },
  monthStats: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTop: '1px solid #1a2a3a',
  },
  monthStatItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  monthStatValue: {
    fontSize: 18,
    fontWeight: 700,
    color: '#dde0e8',
    lineHeight: 1,
  },
  monthStatLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#4a7090',
  },
}

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function CalendarWidget({ sessionGroups, onDayClick, selectedDay, monthOffset, onMonthChange }) {
  const today = new Date()
  const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthLabel = base.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).replace(' de ', ' ')
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const offset = (firstDay + 6) % 7 // Monday-first
  const todayKey = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`

  const sessionDays = new Set(sessionGroups.map(g => g.day))

  const monthKey = `${year}/${String(month + 1).padStart(2, '0')}`
  const monthDayGroups = sessionGroups.filter(g => g.day.startsWith(monthKey))
  const monthTournaments = monthDayGroups.reduce((s, g) => s + g.items.length, 0)
  const monthHands = monthDayGroups.reduce((s, g) => s + g.items.reduce((ss, t) => ss + (t.hands_count || 0), 0), 0)

  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div style={calStyle.outer}>
      <div style={calStyle.title}>Tus sesiones</div>
      <div style={calStyle.widget}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button style={calStyle.navBtn} onClick={() => onMonthChange(-1)}>‹</button>
          <div style={calStyle.month}>{monthLabel}</div>
          <button style={{ ...calStyle.navBtn, ...(monthOffset === 0 ? calStyle.navBtnDisabled : {}) }} onClick={() => onMonthChange(+1)} disabled={monthOffset === 0}>›</button>
        </div>
        <div key={monthOffset} style={{ animation: 'calMonthIn 0.2s ease' }}>
          <div style={calStyle.grid}>
            {DAY_LABELS.map(l => (
              <div key={l} style={calStyle.dayLabel}>{l}</div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={`e-${i}`} />
              const mm = String(month + 1).padStart(2, '0')
              const dd = String(d).padStart(2, '0')
              const dayKey = `${year}/${mm}/${dd}`
              const hasSession = sessionDays.has(dayKey)
              const isToday = dayKey === todayKey
              const isSelected = dayKey === selectedDay
              return (
                <div
                  key={dayKey}
                  style={{
                    ...calStyle.day,
                    ...(isToday ? calStyle.dayToday : hasSession ? calStyle.dayActive : calStyle.dayInactive),
                    ...(isSelected ? calStyle.daySelected : {}),
                  }}
                  onClick={hasSession ? () => onDayClick(dayKey) : undefined}
                >
                  {d}
                </div>
              )
            })}
          </div>
          {monthTournaments > 0 && (
            <div style={calStyle.monthStats}>
              <div style={calStyle.monthStatItem}>
                <span style={calStyle.monthStatValue}>{monthTournaments}</span>
                <span style={calStyle.monthStatLabel}>Torneos</span>
              </div>
              <div style={{ width: 1, background: '#1a2a3a', margin: '0 8px' }} />
              <div style={calStyle.monthStatItem}>
                <span style={calStyle.monthStatValue}>{monthHands.toLocaleString('es-ES')}</span>
                <span style={calStyle.monthStatLabel}>Manos</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const fileInputRef    = useRef()
  const monthHeaderRefs = useRef({})
  const isAutoScrolling = useRef(false)

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
  const [isWide,           setIsWide]           = useState(() => window.innerWidth >= 1280)
  const [calendarExpandedDay, setCalendarExpandedDay] = useState(null)
  const [calMonthOffset,      setCalMonthOffset]      = useState(0)
  const [emptyMonthNotice,    setEmptyMonthNotice]    = useState(null)
  const [openMenu,         setOpenMenu]         = useState(null) // tournament id with open menu
  const [toast,            setToast]            = useState(null)
  const [showImport,       setShowImport]       = useState(false)
  const [dragOver,         setDragOver]         = useState(false)
  const [showStudy,        setShowStudy]        = useState(false)
  const [studyDraft,       setStudyDraft]       = useState(EMPTY_STUDY)
  const [studyLoading,     setStudyLoading]     = useState(false)
  const [studyNoResults,   setStudyNoResults]   = useState(false)
  const [studyError,       setStudyError]       = useState(null)
  const [studyTab,         setStudyTab]         = useState('filters')
  const [reviewLists,      setReviewLists]      = useState([])
  const [listsLoading,     setListsLoading]     = useState(false)
  const [listHandsLoading, setListHandsLoading] = useState(false)
  const [renamingListId,   setRenamingListId]   = useState(null)
  const [renameValue,      setRenameValue]      = useState('')
  const [confirmDeleteList, setConfirmDeleteList] = useState(null)
  const [deletingList,     setDeletingList]     = useState(false)
  const [showCreateList,   setShowCreateList]   = useState(false)
  const [newListNameDash,  setNewListNameDash]  = useState('')
  const [creatingList,     setCreatingList]     = useState(false)

  const [showListMenu,      setShowListMenu]      = useState(false)
  const [showExport,        setShowExport]        = useState(false)
  const [exportDateFrom,    setExportDateFrom]    = useState('')
  const [exportDateTo,      setExportDateTo]      = useState('')
  const [exportTournaments, setExportTournaments] = useState([])
  const [exportSelected,    setExportSelected]    = useState(new Set())
  const [exportLoading,        setExportLoading]        = useState(false)
  const [exporting,            setExporting]            = useState(false)
  const [exportProgress,       setExportProgress]       = useState(null)
  const [exportDone,           setExportDone]           = useState(null)
  const [exportError,          setExportError]          = useState(null)
  const [exportLoaded,         setExportLoaded]         = useState(false)
  const [exportIncludeSummary, setExportIncludeSummary] = useState(true)

  const [confirmDeleteSession, setConfirmDeleteSession] = useState(null) // { day, items }
  const [deletingSession,      setDeletingSession]      = useState(false)
  const [openSessionMenu,      setOpenSessionMenu]      = useState(null)  // day key
  const [heroStats,            setHeroStats]            = useState(null)
  const [statsLoading,         setStatsLoading]         = useState(false)
  const [statsError,           setStatsError]           = useState(null)
  const [migrating,            setMigrating]            = useState(false)
  const [migrationProgress,    setMigrationProgress]    = useState(null)

  function sanitizeFilename(name) {
    return (name || 'torneo').replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 80)
  }

  function downloadBlob(uint8Array, filename, mime) {
    const blob = new Blob([uint8Array], { type: mime })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  function downloadText(text, filename) {
    downloadBlob(new TextEncoder().encode(text), filename, 'text/plain')
  }

  function openExportModal() {
    setShowExport(true)
    setExportTournaments([])
    setExportSelected(new Set())
    setExportLoading(false)
    setExporting(false)
    setExportProgress(null)
    setExportDone(null)
    setExportError(null)
    setExportLoaded(false)
    setExportIncludeSummary(true)
  }

  async function loadExportTournaments() {
    if (!exportDateFrom || !exportDateTo) return
    setExportLoading(true)
    setExportError(null)
    setExportDone(null)
    setExportLoaded(false)
    try {
      const data = await fetchTournamentsInRange(user.id, exportDateFrom, exportDateTo)
      setExportTournaments(data)
      setExportSelected(new Set(data.map(t => t.id)))
      setExportLoaded(true)
    } catch (e) {
      console.error(e)
      setExportError('Error al cargar torneos.')
    } finally {
      setExportLoading(false)
    }
  }

  function toggleExportTournament(id) {
    setExportSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleExportAll() {
    const allSelected = exportTournaments.every(t => exportSelected.has(t.id))
    setExportSelected(allSelected ? new Set() : new Set(exportTournaments.map(t => t.id)))
  }

  function toggleExportSession(items) {
    const allSelected = items.every(t => exportSelected.has(t.id))
    setExportSelected(prev => {
      const next = new Set(prev)
      if (allSelected) { items.forEach(t => next.delete(t.id)) }
      else             { items.forEach(t => next.add(t.id)) }
      return next
    })
  }

  async function handleExport() {
    const selected = exportTournaments.filter(t => exportSelected.has(t.id))
    if (!selected.length) return
    setExporting(true)
    setExportProgress({ current: 0, total: selected.length })
    setExportError(null)
    setExportDone(null)
    try {
      const handsMap = await fetchHandsBatch(selected.map(t => t.id))
      let totalHands = 0
      const files = {}

      for (let i = 0; i < selected.length; i++) {
        const t = selected[i]
        const hands = handsMap.get(t.id) || []
        totalHands += hands.length
        const text    = serializeTournament(t, hands)
        const summary = exportIncludeSummary ? serializeSummary(t) : null
        const fname   = `${sanitizeFilename(t.name)}_${t.tournament_id}`

        if (selected.length === 1) {
          downloadText(text, `${fname}.txt`)
          if (summary) downloadText(summary, `${fname}_summary.txt`)
        } else {
          files[`${fname}.txt`] = strToU8(text)
          if (summary) files[`${fname}_summary.txt`] = strToU8(summary)
        }
        setExportProgress({ current: i + 1, total: selected.length })
      }

      if (selected.length > 1) {
        const zip = zipSync(files)
        downloadBlob(zip, `torneos_${exportDateFrom}_${exportDateTo}.zip`, 'application/zip')
      }

      setShowExport(false)
      const msg = `${selected.length} torneo${selected.length !== 1 ? 's' : ''} exportado${selected.length !== 1 ? 's' : ''} · ${totalHands.toLocaleString('es-ES')} manos`
      setToast(msg)
      setTimeout(() => setToast(null), 3500)
    } catch (e) {
      console.error(e)
      setExportError('Error al exportar. Inténtalo de nuevo.')
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  async function handleStudySearch() {
    setStudyLoading(true)
    setStudyNoResults(false)
    setStudyError(null)
    try {
      let rows
      rows = await fetchAllUserHands(user.id)
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
        if (studyDraft.potType === 'clean'    && !preflopIsClean(h))          return false
        if (studyDraft.potType === 'limped'   && !preflopIsLimped(h))         return false
        if (studyDraft.heroPfr && !heroIsPfr(h)) return false
        if (studyDraft.posVsField && heroPositionVsField(h) !== studyDraft.posVsField) return false
        if (studyDraft.bbFold && !bbFoldedPreflop(h)) return false
        if (studyDraft.players !== null) {
          if (!h.board?.flop?.length) return false
          const cnt = playersWhoSawFlop(h)
          if (studyDraft.players === 'hu'       && cnt !== 2) return false
          if (studyDraft.players === 'multiway' && cnt < 3)   return false
        }
        if (studyDraft.dateRange && h.datetime) {
          const handDate = new Date(h.datetime.replace(/\//g, '-'))
          const now = new Date()
          if (studyDraft.dateRange === 'month') {
            if (handDate < new Date(now - 30 * 24 * 60 * 60 * 1000)) return false
          }
          if (studyDraft.dateRange === '3months') {
            if (handDate < new Date(now - 90 * 24 * 60 * 60 * 1000)) return false
          }
          if (studyDraft.dateRange === 'custom') {
            if (studyDraft.dateFrom && handDate < new Date(studyDraft.dateFrom)) return false
            if (studyDraft.dateTo) {
              const to = new Date(studyDraft.dateTo); to.setHours(23, 59, 59)
              if (handDate > to) return false
            }
          }
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

  async function loadHeroStats() {
    if (heroStats) return
    setStatsLoading(true)
    setStatsError(null)
    try {
      const data = await fetchHeroStats(user.id)
      setHeroStats(data)
    } catch (e) {
      console.error(e)
      setStatsError('No se pudieron cargar las stats.')
    } finally {
      setStatsLoading(false)
    }
  }

  async function runMigration() {
    setMigrating(true)
    setMigrationProgress({ current: 0, total: null })
    setStatsError(null)
    try {
      const { stats } = await migrateHandStats(user.id, (current, total) => {
        setMigrationProgress({ current, total })
      })
      setHeroStats(stats)
    } catch (e) {
      console.error(e)
      setStatsError(`Error: ${e?.message || e?.toString() || 'desconocido'}`)
    } finally {
      setMigrating(false)
      setMigrationProgress(null)
    }
  }

  async function loadReviewLists() {
    setListsLoading(true)
    try {
      const data = await fetchUserReviewLists(user.id)
      setReviewLists(data)
    } catch (e) { console.error(e) }
    finally { setListsLoading(false) }
  }

  async function openListInVisualizer(listId) {
    setListHandsLoading(true)
    try {
      const hands = await fetchHandsInList(listId)
      if (!hands.length) return
      setShowStudy(false)
      navigate('/study/results', { state: { studyHands: hands } })
    } catch (e) { console.error(e) }
    finally { setListHandsLoading(false) }
  }

  async function handleCreateListDash() {
    if (!newListNameDash.trim()) return
    setCreatingList(true)
    try {
      await createReviewList(user.id, newListNameDash.trim())
      setNewListNameDash('')
      setShowCreateList(false)
      await loadReviewLists()
    } catch (e) { console.error(e) }
    finally { setCreatingList(false) }
  }

  async function handleRenameList() {
    if (!renamingListId || !renameValue.trim()) return
    try {
      await renameReviewList(renamingListId, renameValue.trim(), user.id)
      setRenamingListId(null)
      setRenameValue('')
      await loadReviewLists()
    } catch (e) { console.error(e.message ?? e) }
  }

  async function handleDeleteList() {
    if (!confirmDeleteList) return
    setDeletingList(true)
    try {
      await deleteReviewList(confirmDeleteList.id, user.id)
      setConfirmDeleteList(null)
      await loadReviewLists()
    } catch (e) { console.error(e.message ?? e) }
    finally { setDeletingList(false) }
  }

  async function handleDeleteSession() {
    if (!confirmDeleteSession) return
    setDeletingSession(true)
    try {
      for (const t of confirmDeleteSession.items) {
        await deleteTournament(t.id, user.id)
      }
      setConfirmDeleteSession(null)
      await loadTournaments()
    } catch (e) {
      console.error(e.message ?? e)
      setToast('Error al eliminar. Inténtalo de nuevo.')
      setTimeout(() => setToast(null), 3500)
    } finally {
      setDeletingSession(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTournament(confirmDelete.id, user.id)
      setConfirmDelete(null)
      await loadTournaments()
    } catch (e) {
      console.error(e.message ?? e)
      setToast('Error al eliminar. Inténtalo de nuevo.')
      setTimeout(() => setToast(null), 3500)
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
      setToast('¡Enlace copiado!')
      setTimeout(() => setToast(null), 2500)
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

  useEffect(() => {
    if (!showListMenu) return
    function handleClick() { setShowListMenu(false) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showListMenu])

  useEffect(() => {
    if (!openSessionMenu) return
    function handleClick() { setOpenSessionMenu(null) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [openSessionMenu])

  function toggleDay(day) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  const handleCalendarDayClick = useCallback((day) => {
    const isSameDay = calendarExpandedDay === day
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (calendarExpandedDay) next.delete(calendarExpandedDay)
      if (!isSameDay) next.add(day)
      return next
    })
    setCalendarExpandedDay(isSameDay ? null : day)
    if (!isSameDay) {
      setTimeout(() => {
        document.getElementById(`day-${day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }, [calendarExpandedDay])

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
    const fn = () => {
      setIsMobile(window.innerWidth < 768)
      setIsWide(window.innerWidth >= 1280)
    }
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

  async function handleFiles(fileList) {
    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
    const files = Array.from(fileList).filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        setUploadStatus({ ok: false, message: `El archivo "${f.name}" supera el límite de 10 MB.` })
        setTimeout(() => setUploadStatus(null), 4000)
        return false
      }
      return true
    })
    if (!files.length) return
    setShowImport(false)
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
        const parsedPerFile = handTexts.map(t => parseFile(t))
        const entriesMap = new Map()
        for (const fileHands of parsedPerFile) {
          const tids = new Set(fileHands.map(h => h.tournamentId).filter(Boolean))
          for (const tid of tids) entriesMap.set(tid, (entriesMap.get(tid) || 0) + 1)
        }
        const allHands = parsedPerFile.flat()
        const grouped  = groupByTournament(allHands)
        for (const t of grouped) t.entries = entriesMap.get(t.id) || 1

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
      setTimeout(() => setUploadStatus(null), 4000)
      await loadTournaments()
    } catch (err) {
      console.error(err)
      setUploadStatus({ ok: false, message: 'Error al procesar los archivos.' })
      setTimeout(() => setUploadStatus(null), 4000)
    } finally {
      setUploading(false)
      setProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (files.length) handleFiles(files)
  }

  function formatTime(dateStr) {
    if (!dateStr) return '—'
    const m = dateStr.match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2})/)
    return m ? m[4] : dateStr
  }

  function formatPlayDuration(items) {
    const parseDate = s => {
      const m = s && s.match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/)
      return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null
    }
    const intervals = []
    for (const t of items) {
      const start = parseDate(t.date)
      const end   = parseDate(t.end_time)
      if (start && end && end > start) intervals.push([start.getTime(), end.getTime()])
    }
    if (intervals.length === 0) return '—'
    intervals.sort((a, b) => a[0] - b[0])
    let totalMs = 0
    let [curStart, curEnd] = intervals[0]
    for (let i = 1; i < intervals.length; i++) {
      const [s, e] = intervals[i]
      if (s <= curEnd) { curEnd = Math.max(curEnd, e) }
      else { totalMs += curEnd - curStart; curStart = s; curEnd = e }
    }
    totalMs += curEnd - curStart
    if (totalMs === 0) return '—'
    const h = Math.floor(totalMs / 3600000)
    const m = Math.round((totalMs % 3600000) / 60000)
    return h === 0 ? `${m}min` : `${h}h ${String(m).padStart(2, '0')}min`
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

  function groupByMonth(dayGroups) {
    const map = new Map()
    for (const g of dayGroups) {
      const monthKey = g.day.slice(0, 7) // 'YYYY/MM'
      if (!map.has(monthKey)) map.set(monthKey, [])
      map.get(monthKey).push(g)
    }
    return Array.from(map.entries()).map(([month, days]) => ({ month, days }))
  }

  function formatMonthHeader(monthKey) {
    const [y, m] = monthKey.split('/')
    const label = new Date(+y, +m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
    return label.replace(' de ', ' ').replace(/^\w/, c => c.toUpperCase())
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
  const monthGroups = groupByMonth(grouped)

  useEffect(() => {
    if (!isWide) return
    function recalcActiveMonth() {
      if (isAutoScrolling.current) return
      const THRESHOLD = 90
      let activeMonth = null
      for (const [month, el] of Object.entries(monthHeaderRefs.current)) {
        if (el.getBoundingClientRect().top <= THRESHOLD) activeMonth = month
      }
      if (!activeMonth) return
      const today = new Date()
      const [y, m] = activeMonth.split('/').map(Number)
      const newOffset = Math.min(0, (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth()))
      setCalMonthOffset(prev => prev === newOffset ? prev : newOffset)
      setEmptyMonthNotice(null)
    }
    const observer = new IntersectionObserver(
      () => recalcActiveMonth(),
      { rootMargin: '-90px 0px 0px 0px', threshold: 0 }
    )
    Object.values(monthHeaderRefs.current).forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [isWide, monthGroups])

  const handleCalendarMonthChange = useCallback((delta) => {
    const newOffset = Math.min(0, calMonthOffset + delta)
    if (newOffset === calMonthOffset) return
    setCalMonthOffset(newOffset)
    setEmptyMonthNotice(null)

    const today = new Date()
    const targetDate = new Date(today.getFullYear(), today.getMonth() + newOffset, 1)
    const targetMonthKey = `${targetDate.getFullYear()}/${String(targetDate.getMonth() + 1).padStart(2, '0')}`

    const el = document.getElementById(`month-${targetMonthKey}`)
    if (!el) {
      setEmptyMonthNotice(`No hay torneos en ${formatMonthHeader(targetMonthKey)}`)
      return
    }

    isAutoScrolling.current = true
    setTimeout(() => {
      document.getElementById(`month-${targetMonthKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    setTimeout(() => { isAutoScrolling.current = false }, 1000)
  }, [calMonthOffset])

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
          <input ref={fileInputRef} type="file" accept=".txt" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          <div style={s.headerLeft}>
            <div style={s.logo}>
              <span style={s.logoSpade}>♠</span>
              <span style={s.logoText}>RunItBack</span>
            </div>
            {!isMobile && (uploading && progress ? (
              <div style={s.headerProgress}>
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,70,140,0.25)', width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.2s', borderRadius: 8 }} />
                <span style={s.toolbarProgressText}>{progress.current}/{progress.total} torneos</span>
              </div>
            ) : (
              <button style={s.importBtn} onClick={() => setShowImport(true)} disabled={uploading}>
                📂 Importar torneos
              </button>
            ))}
          </div>
          <div style={s.headerRight}>
            <button style={s.studyBtn} onClick={() => { setStudyDraft(EMPTY_STUDY); setStudyNoResults(false); setStudyError(null); setStudyTab('filters'); setShowStudy(true); loadReviewLists() }}>
              🎓 Estudia tu juego
            </button>
            {!isMobile && <span style={s.email}>{user?.email}</span>}
            <button style={s.signOutBtn} onClick={signOut}>Salir</button>
          </div>
        </div>
      </div>

      {/* CALENDAR WIDGET */}
      {isWide && !loading && tournaments.length > 0 && (
        <>
          <CalendarWidget
            sessionGroups={grouped}
            onDayClick={handleCalendarDayClick}
            selectedDay={calendarExpandedDay}
            monthOffset={calMonthOffset}
            onMonthChange={handleCalendarMonthChange}
          />
          {emptyMonthNotice && (
            <div style={{
              position: 'fixed', top: 82 + 310, right: 24, width: 282, zIndex: 2,
              fontSize: 11, color: '#4a7090', fontWeight: 600,
              textAlign: 'center', padding: '6px 0', letterSpacing: '0.3px',
            }}>
              {emptyMonthNotice}
            </div>
          )}
        </>
      )}

      {/* STATUS */}
      {uploadStatus && (
        <div style={{ ...s.status, ...(uploadStatus.ok ? s.statusOk : s.statusErr) }}>
          {uploadStatus.message}
        </div>
      )}

      {/* CONTENT */}
      <div style={{ ...s.content, paddingTop: isMobile ? 16 : 24, paddingBottom: isMobile ? 20 : 48, paddingLeft: isMobile ? 12 : 24, paddingRight: isWide ? 322 : isMobile ? 12 : 24 }}>
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
              <button
                style={{ ...s.listFilterBtn, ...(hasFilters ? s.listFilterBtnActive : {}) }}
                onClick={openFilter}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="7"/>
                  <line x1="16.5" y1="16.5" x2="22" y2="22"/>
                </svg>
                Filtrar
                {hasFilters && <span style={s.filterDot} />}
              </button>
              {!isMobile && <div style={{ position: 'relative' }}>
                <button
                  style={s.listMenuBtn}
                  onClick={e => { e.stopPropagation(); setShowListMenu(v => !v) }}
                >
                  ⋯
                </button>
                {showListMenu && (
                  <div style={s.listMenuDropdown} onClick={e => e.stopPropagation()}>
                    <button style={{ ...s.dropdownItem, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }} onClick={() => { setShowListMenu(false); openExportModal() }}>
                      Exportar torneos
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <polyline points="8 18 12 22 16 18"/>
                        <line x1="12" y1="22" x2="12" y2="9"/>
                        <path d="M4 9V3h16v6"/>
                      </svg>
                    </button>
                  </div>
                )}
              </div>}
            </div>

            <div style={s.list}>
              {monthGroups.length === 0 ? (
                <div style={{ ...s.hint, marginTop: 40 }}>Sin resultados para los filtros aplicados.</div>
              ) : monthGroups.map(({ month, days }) => (
                <div key={month}>
                  <div
                    id={`month-${month}`}
                    ref={el => { if (el) monthHeaderRefs.current[month] = el; else delete monthHeaderRefs.current[month] }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 10px', scrollMarginTop: 78 }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#5a8aaa', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {formatMonthHeader(month)}
                    </span>
                    <div style={{ flex: 1, height: 1, background: '#1a2a3a' }} />
                  </div>
                  {days.map(({ day, items }) => {
                const isExpanded = hasFilters || expandedDays.has(day)
                const totalHands = items.reduce((sum, t) => sum + (t.hands_count || 0), 0)
                const playDuration = formatPlayDuration(items)
                return (
                  <div key={day} id={`day-${day}`} style={{ marginBottom: 6, scrollMarginTop: 78 }}>
                    {/* Session card */}
                    <div style={{ ...s.sessionCard, ...(isExpanded ? s.sessionCardOpen : {}) }}
                      onClick={() => toggleDay(day)}>
                      <div style={s.sessionTop}>
                        <div>
                          <div style={{ ...s.sessionDay, fontSize: isMobile ? 11 : 13 }}>{formatDayHeader(day)}</div>
                        </div>
                        {/* Session context menu */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ position: 'relative' }}>
                            <button
                              style={s.menuBtn}
                              onClick={e => { e.stopPropagation(); setOpenSessionMenu(openSessionMenu === day ? null : day) }}
                            >
                              ⋯
                            </button>
                            {openSessionMenu === day && (
                              <div style={{ ...s.dropdown, minWidth: 160 }} onClick={e => e.stopPropagation()}>
                                <button
                                  style={{ ...s.dropdownItem, color: '#e07070', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                                  onClick={() => { setOpenSessionMenu(null); setConfirmDeleteSession({ day, items }) }}
                                >
                                  Eliminar sesión
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e07070" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                    <polyline points="3 6 5 6 21 6"/>
                                    <path d="M19 6l-1 14H6L5 6"/>
                                    <line x1="10" y1="11" x2="10" y2="17"/>
                                    <line x1="14" y1="11" x2="14" y2="17"/>
                                    <path d="M9 6V4h6v2"/>
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                          <span style={{ fontSize: 11, color: '#2a5070', transition: 'transform 0.2s',
                            display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                        </div>
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
                          <span style={{ ...s.statValue, fontSize: isMobile ? 12 : 18, whiteSpace: 'nowrap' }}>{playDuration}</span>
                          <span style={s.statLabel}>duración</span>
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
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <div style={s.rowName}>{t.name}</div>
                                {t.entries > 1 && (
                                  <span style={s.rowReentry}>[{t.entries}]</span>
                                )}
                              </div>
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
                                <div style={{ ...s.dropdown, minWidth: 160 }} onClick={e => e.stopPropagation()}>
                                  <button style={{ ...s.dropdownItem, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }} onClick={() => handleShare(t.id)}>
                                    Compartir
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                      <polyline points="8 6 12 2 16 6"/>
                                      <line x1="12" y1="2" x2="12" y2="15"/>
                                      <path d="M4 15v6h16v-6"/>
                                    </svg>
                                  </button>
                                  <button style={{ ...s.dropdownItem, color: '#e07070', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }} onClick={() => { setOpenMenu(null); setConfirmDelete({ id: t.id, name: t.name }) }}>
                                    Eliminar
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e07070" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                      <polyline points="3 6 5 6 21 6"/>
                                      <path d="M19 6l-1 14H6L5 6"/>
                                      <line x1="10" y1="11" x2="10" y2="17"/>
                                      <line x1="14" y1="11" x2="14" y2="17"/>
                                      <path d="M9 6V4h6v2"/>
                                    </svg>
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
              ))}
            </div>
          </div>
        )}
      </div>

      {/* TOAST */}
      {toast && (
        <div style={s.toast}>{toast}</div>
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

      {/* DELETE SESSION CONFIRM MODAL */}
      {confirmDeleteSession && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && !deletingSession && setConfirmDeleteSession(null)}>
          <div style={{ ...s.modal, width: 'min(380px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Borrar sesión</span>
              <button style={s.modalClose} onClick={() => !deletingSession && setConfirmDeleteSession(null)}>✕</button>
            </div>
            <div style={{ padding: '22px 22px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 13, color: '#8ab0cc', margin: 0 }}>
                ¿Seguro que quieres borrar esta sesión? Se eliminarán todos sus torneos. Esta acción no se puede deshacer.
              </p>
              <p style={{ fontSize: 12, color: '#3a6080', margin: 0, fontWeight: 700 }}>
                {formatDayHeader(confirmDeleteSession.day)} — {confirmDeleteSession.items.length} torneo{confirmDeleteSession.items.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setConfirmDeleteSession(null)} disabled={deletingSession}>
                Cancelar
              </button>
              <button
                style={{ ...s.applyBtn, background: 'linear-gradient(135deg, #8a1a1a, #5a0a0a)', borderColor: '#6a2020', opacity: deletingSession ? 0.6 : 1 }}
                onClick={handleDeleteSession}
                disabled={deletingSession}
              >
                {deletingSession ? 'Borrando...' : `Sí, borrar sesión`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE LIST CONFIRM MODAL */}
      {/* STUDY MODAL */}
      {showStudy && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowStudy(false)}>
          <div style={{ ...s.modal, width:'min(560px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>🎓 Estudia tu juego</span>
              <button style={s.modalClose} onClick={() => setShowStudy(false)}>✕</button>
            </div>

            {/* Tab bar */}
            <div style={{ display:'flex', borderBottom:'1px solid #1a2a3a', flexShrink:0 }}>
              {[{ key:'filters', label:'Filtros' }, { key:'lists', label:'Listas de manos marcadas' }, { key:'stats', label:'Mis stats' }].map(tab => (
                <button key={tab.key}
                  style={{ flex:1, background:'none', border:'none',
                    borderBottom: studyTab === tab.key ? '2px solid #50d080' : '2px solid transparent',
                    padding:'10px 0', color: studyTab === tab.key ? '#50d080' : '#3a6080',
                    fontSize:12, fontWeight:800, cursor:'pointer', letterSpacing:'0.3px', marginBottom:-1 }}
                  onClick={() => { setStudyTab(tab.key); if (tab.key === 'stats') loadHeroStats() }}>{tab.label}</button>
              ))}
            </div>

            {studyTab === 'filters' && (<>
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

                {/* Tipo de bote */}
                <div style={s.field}>
                  <label style={s.fieldLabel}>Tipo de bote</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[[{ value: null, label: 'Cualquiera' }, { value: 'limped', label: 'Limped pot' }],
                      [{ value: 'srp', label: 'SRP' }, { value: 'threebet', label: '3-bet pot' }, { value: 'clean', label: 'Sin acción previa' }]
                    ].map((row, ri) => (
                      <div key={ri} style={{ display: 'flex', gap: 6 }}>
                        {row.map(opt => {
                          const active = studyDraft.potType === opt.value
                          return (
                            <button key={String(opt.value)}
                              style={{ ...s.chipBtn, flex: 1, ...(active ? s.chipBtnActive : {}) }}
                              onClick={() => setStudyDraft(d => ({ ...d, potType: opt.value }))}
                            >{opt.label}</button>
                          )
                        })}
                      </div>
                    ))}
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

                {/* Fecha */}
                <div style={s.field}>
                  <label style={s.fieldLabel}>Fecha</label>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {[
                      { value: null,      label: 'Cualquiera' },
                      { value: 'month',   label: 'Último mes' },
                      { value: '3months', label: 'Últimos 3 meses' },
                      { value: 'custom',  label: 'Custom' },
                    ].map(opt => {
                      const active = studyDraft.dateRange === opt.value
                      return (
                        <button key={String(opt.value)}
                          style={{ ...s.chipBtn, ...(active ? s.chipBtnActive : {}) }}
                          onClick={() => setStudyDraft(d => ({ ...d, dateRange: opt.value, dateFrom: '', dateTo: '' }))}>
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                  {studyDraft.dateRange === 'custom' && (
                    <div style={{ display:'flex', gap:10, marginTop:8, alignItems:'center', flexWrap:'wrap' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:11, color:'#3a6080', fontWeight:700 }}>Desde</span>
                        <input type="date"
                          style={{ ...s.fieldInput, padding:'6px 10px', fontSize:12, colorScheme:'dark' }}
                          value={studyDraft.dateFrom}
                          onChange={e => setStudyDraft(d => ({ ...d, dateFrom: e.target.value }))} />
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:11, color:'#3a6080', fontWeight:700 }}>Hasta</span>
                        <input type="date"
                          style={{ ...s.fieldInput, padding:'6px 10px', fontSize:12, colorScheme:'dark' }}
                          value={studyDraft.dateTo}
                          onChange={e => setStudyDraft(d => ({ ...d, dateTo: e.target.value }))} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Solo jugadas */}
                <div style={s.field}>
                  <label style={s.checkLabel}>
                    <input type="checkbox" checked={studyDraft.notFoldedPreflop}
                      onChange={e => setStudyDraft(d => ({ ...d, notFoldedPreflop: e.target.checked }))}
                      style={{ accentColor: '#50d080', width: 15, height: 15 }} />
                    VPIP
                  </label>
                </div>

                {/* Hero PFR */}
                <div style={s.field}>
                  <label style={s.checkLabel}>
                    <input type="checkbox" checked={studyDraft.heroPfr}
                      onChange={e => setStudyDraft(d => ({ ...d, heroPfr: e.target.checked }))}
                      style={{ accentColor: '#50d080', width: 15, height: 15 }} />
                    Hero PFR
                  </label>
                </div>

                {/* Posición vs el resto de la mano */}
                <div style={s.field}>
                  <label style={s.fieldLabel}>Posición vs el resto de la mano</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[{ value: null, label: 'Cualquiera' }, { value: 'oop', label: 'OOP' }, { value: 'ip', label: 'IP' }].map(opt => {
                      const active = studyDraft.posVsField === opt.value
                      return (
                        <button key={String(opt.value)}
                          style={{ ...s.chipBtn, flex: 1, ...(active ? s.chipBtnActive : {}) }}
                          onClick={() => setStudyDraft(d => ({ ...d, posVsField: opt.value }))}
                        >{opt.label}</button>
                      )
                    })}
                  </div>
                </div>

                {/* BB no se une a la mano */}
                <div style={s.field}>
                  <label style={s.checkLabel}>
                    <input type="checkbox" checked={studyDraft.bbFold}
                      onChange={e => setStudyDraft(d => ({ ...d, bbFold: e.target.checked }))}
                      style={{ accentColor: '#50d080', width: 15, height: 15 }} />
                    BB no se une a la mano
                  </label>
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
            </>)}

            {studyTab === 'lists' && (<>
              <div style={{ ...s.modalBody, padding:'16px 18px', minHeight:280, maxHeight:'60vh', overflowY:'auto' }}>
                {listsLoading ? (
                  <div style={{ color:'#3a6080', fontSize:12, textAlign:'center', padding:'20px 0' }}>Cargando...</div>
                ) : reviewLists.length === 0 ? (
                  <div style={{ color:'#3a6080', fontSize:13, textAlign:'center', padding:'20px 0', lineHeight:1.7 }}>
                    No tienes listas de revisión aún.<br/>Márcalas desde el visualizador de manos.
                  </div>
                ) : reviewLists.map(list => (
                  <div key={list.id}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                      borderBottom:'1px solid #0e1828', borderRadius:6, marginBottom:3,
                      cursor: renamingListId === list.id ? 'default' : 'pointer',
                      background:'rgba(255,255,255,0.02)',
                      opacity: listHandsLoading ? 0.6 : 1 }}
                    onClick={() => { if (renamingListId !== list.id) openListInVisualizer(list.id) }}>
                    {renamingListId === list.id ? (
                      <div style={{ flex:1, display:'flex', gap:6, alignItems:'center' }} onClick={e => e.stopPropagation()}>
                        <input autoFocus
                          style={{ flex:1, background:'#080e18', border:'1px solid #2a5a8a',
                            borderRadius:6, padding:'5px 9px', color:'#c8d4e8', fontSize:13, outline:'none' }}
                          maxLength={100}
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameList()
                            if (e.key === 'Escape') setRenamingListId(null)
                          }} />
                        <button
                          style={{ background:'none', border:'1px solid #2a6a3a', borderRadius:6,
                            padding:'4px 8px', color:'#50d080', cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center' }}
                          onClick={handleRenameList}
                          title="Guardar">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <span style={{ flex:1, fontSize:13, color:'#7ab0d8', fontWeight:700 }}>{list.name}</span>
                    )}
                    <span style={{ fontSize:11, color:'#3a6080', flexShrink:0 }}>
                      {list.hand_count ?? 0} mano{list.hand_count !== 1 ? 's' : ''}
                    </span>
                    {list.last_hand_added_at && (
                      <span style={{ fontSize:10, color:'#2a5070', flexShrink:0 }}>
                        {new Date(list.last_hand_added_at).toLocaleDateString('es-ES')}
                      </span>
                    )}
                    <button style={{ background:'none', border:'none', color:'#3a6080', cursor:'pointer', fontSize:13, padding:'2px 6px' }}
                      onClick={e => { e.stopPropagation(); setRenamingListId(list.id); setRenameValue(list.name) }}
                      title="Renombrar">✎</button>
                    <button style={{ background:'none', border:'none', color:'#803030', cursor:'pointer', fontSize:13, padding:'2px 6px' }}
                      onClick={e => { e.stopPropagation(); setConfirmDeleteList({ id: list.id, name: list.name }) }}
                      title="Eliminar lista">✕</button>
                  </div>
                ))}

              </div>

              <div style={s.modalFooter}>
                <button style={s.clearBtn} onClick={() => setShowStudy(false)}>Cerrar</button>
                <button style={s.studySearchBtn} onClick={() => { setNewListNameDash(''); setShowCreateList(true) }}>
                  + Nueva lista
                </button>
              </div>
            </>)}

            {studyTab === 'stats' && (<>
              <div style={{ ...s.modalBody, padding:'20px 22px', minHeight:320 }}>
                {(statsLoading || migrating) && (
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    <div style={s.hint}>{migrating ? 'Calculando stats...' : 'Cargando...'}</div>
                    {migrating && migrationProgress?.total && (
                      <div style={{ position:'relative', height:6, background:'#0e1828', borderRadius:4, overflow:'hidden' }}>
                        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to right,#1e5cad,#60b0ff)', width:`${(migrationProgress.current/migrationProgress.total)*100}%`, transition:'width 0.3s', borderRadius:4 }} />
                      </div>
                    )}
                    {migrating && migrationProgress && (
                      <div style={{ fontSize:11, color:'#4a7090', textAlign:'center' }}>
                        {migrationProgress.current?.toLocaleString('es-ES')}{migrationProgress.total ? ` / ${migrationProgress.total.toLocaleString('es-ES')}` : ''} manos
                      </div>
                    )}
                  </div>
                )}
                {statsError && !statsLoading && !migrating && (
                  <div style={{ fontSize:12, color:'#e07070' }}>{statsError}</div>
                )}
                {!heroStats?.total_hands && !statsLoading && !migrating && !statsError && (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, marginTop:32 }}>
                    <div style={{ fontSize:13, color:'#7ab0d8', textAlign:'center', lineHeight:1.6 }}>
                      Las stats se calculan una vez a partir de tus manos importadas.<br/>
                      <span style={{ color:'#4a7090', fontSize:12 }}>Tardará unos segundos según el volumen.</span>
                    </div>
                    <button style={s.studySearchBtn} onClick={runMigration}>Calcular mis stats</button>
                  </div>
                )}
                {heroStats?.total_hands > 0 && !statsLoading && !migrating && (
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    <div style={{ fontSize:11, fontWeight:800, letterSpacing:'1.5px', textTransform:'uppercase', color:'#5a8aaa', marginBottom:8 }}>
                      General Stats · {heroStats.total_hands?.toLocaleString('es-ES')} manos
                    </div>
                    {[
                      { label:'VPIP',         value: heroStats.vpip,         desc:'Entra voluntariamente al bote preflop' },
                      { label:'PFR',          value: heroStats.pfr,          desc:'Raise preflop' },
                      { label:'3Bet %',       value: heroStats.three_bet,    desc:'Re-raise preflop tras un raise previo' },
                      { label:'Fold vs 3Bet', value: heroStats.fold_vs_3bet, desc:'Foldea su RFI cuando le hacen 3bet' },
                      { label:'WWSF %',       value: heroStats.wwsf,         desc:'Gana el bote habiendo visto el flop' },
                      { label:'WTSD %',       value: heroStats.wtsd,         desc:'Va a showdown habiendo visto el flop' },
                      { label:'WonSD %',      value: heroStats.won_sd,       desc:'Gana cuando llega a showdown' },
                    ].map(({ label, value, desc }) => (
                      <div key={label} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 10px', background:'#090e18', borderRadius:8, border:'1px solid #1a2a3a' }}>
                        <span style={{ fontSize:12, fontWeight:800, color:'#dde0e8', minWidth:90 }}>{label}</span>
                        <span style={{ fontSize:18, fontWeight:800, color:'#60b0ff', minWidth:52 }}>{value != null ? `${value}%` : '—'}</span>
                        <span style={{ fontSize:11, color:'#3a6080' }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={s.modalFooter}>
                <button style={s.clearBtn} onClick={() => setShowStudy(false)}>Cerrar</button>
                {heroStats?.total_hands > 0 && !migrating && (
                  <button style={{ ...s.studySearchBtn, opacity: migrating ? 0.5 : 1 }} onClick={() => { setHeroStats(null); runMigration() }} disabled={migrating}>↺ Recalcular</button>
                )}
              </div>
            </>)}
          </div>
        </div>
      )}

      {/* DELETE LIST CONFIRM MODAL */}
      {confirmDeleteList && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setConfirmDeleteList(null)}>
          <div style={{ ...s.modal, width:'min(380px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Eliminar lista</span>
              <button style={s.modalClose} onClick={() => setConfirmDeleteList(null)}>✕</button>
            </div>
            <div style={{ padding:'20px 22px 10px', display:'flex', flexDirection:'column', gap:8 }}>
              <p style={{ fontSize:13, color:'#8ab0cc', margin:0 }}>
                ¿Seguro que quieres eliminar esta lista? Las manos no se borran, solo se elimina la lista.
              </p>
              <p style={{ fontSize:12, color:'#3a6080', margin:0, fontWeight:700 }}>
                {confirmDeleteList.name}
              </p>
            </div>
            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setConfirmDeleteList(null)} disabled={deletingList}>Cancelar</button>
              <button
                style={{ ...s.studySearchBtn, background:'linear-gradient(135deg,#8a1a1a,#5a0a0a)',
                  borderColor:'#6a2020', opacity: deletingList ? 0.6 : 1 }}
                onClick={handleDeleteList}
                disabled={deletingList}>
                {deletingList ? 'Eliminando...' : 'Eliminar lista'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE LIST MODAL */}
      {showCreateList && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowCreateList(false)}>
          <div style={{ ...s.modal, width:'min(360px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Nueva lista</span>
              <button style={s.modalClose} onClick={() => setShowCreateList(false)}>✕</button>
            </div>
            <div style={{ padding:'20px 22px 10px' }}>
              <input
                autoFocus
                style={{ ...s.fieldInput, width:'100%', padding:'10px 14px', fontSize:14, boxSizing:'border-box' }}
                type="text"
                maxLength={100}
                placeholder="Nombre de la lista"
                value={newListNameDash}
                onChange={e => setNewListNameDash(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateListDash()
                  if (e.key === 'Escape') setShowCreateList(false)
                }}
              />
            </div>
            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setShowCreateList(false)} disabled={creatingList}>Cancelar</button>
              <button
                style={{ ...s.studySearchBtn, opacity: !newListNameDash.trim() || creatingList ? 0.5 : 1 }}
                onClick={handleCreateListDash}
                disabled={!newListNameDash.trim() || creatingList}>
                {creatingList ? 'Creando...' : 'Crear lista'}
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

      {/* IMPORT MODAL */}
      {showImport && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowImport(false)}>
          <div style={{ ...s.modal, width: 'min(460px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>📂 Importar torneos</span>
              <button style={s.modalClose} onClick={() => setShowImport(false)}>✕</button>
            </div>
            <div style={{ padding: '24px 22px', display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>

              {/* Drop zone */}
              <div
                style={{ ...s.dropZone, ...(dragOver ? s.dropZoneActive : {}) }}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ opacity: 0.5, marginBottom: 4 }}>
                  <polyline points="8 6 12 2 16 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                  <path d="M4 15v6h16v-6"/>
                </svg>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Arrastra aquí tus archivos</span>
                <span style={{ fontSize: 12, color: '#2a5070' }}>.txt de GGPoker, Winamax, PokerStars, 888poker…</span>
              </div>

              {/* Separador */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <div style={{ flex: 1, height: 1, background: '#1a2a3a' }} />
                <span style={{ fontSize: 11, color: '#2a4060' }}>o</span>
                <div style={{ flex: 1, height: 1, background: '#1a2a3a' }} />
              </div>

              {/* Botón buscar */}
              <button style={{ ...s.applyBtn, alignSelf: 'stretch' }}
                onClick={() => fileInputRef.current.click()}>
                Buscar en mi ordenador
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXPORT MODAL */}
      {showExport && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowExport(false)}>
          <div style={{ ...s.modal, width: 'min(700px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>Exportar torneos</span>
              <button style={s.modalClose} onClick={() => setShowExport(false)}>✕</button>
            </div>

            <div style={s.modalBody}>
              {/* Date range */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Rango de fechas</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    style={{ ...s.fieldInput, flex: 1 }}
                    type="date"
                    value={exportDateFrom}
                    onChange={e => { setExportDateFrom(e.target.value); setExportLoaded(false) }}
                  />
                  <span style={{ color: '#3a5a70', fontSize: 12, flexShrink: 0 }}>—</span>
                  <input
                    style={{ ...s.fieldInput, flex: 1 }}
                    type="date"
                    value={exportDateTo}
                    onChange={e => { setExportDateTo(e.target.value); setExportLoaded(false) }}
                  />
                </div>
              </div>

              {/* Include summary toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="includeSummary"
                  checked={exportIncludeSummary}
                  onChange={e => setExportIncludeSummary(e.target.checked)}
                  style={{ accentColor: '#50d080', width: 14, height: 14 }}
                />
                <label htmlFor="includeSummary" style={{ fontSize: 12, color: '#4a7090', cursor: 'pointer', userSelect: 'none' }}>
                  Incluir summary de torneo
                </label>
              </div>

              {/* Load button (visible before loading) */}
              {!exportLoaded && (
                <button
                  style={{ ...s.applyBtn, opacity: exportLoading || !exportDateFrom || !exportDateTo ? 0.5 : 1 }}
                  onClick={loadExportTournaments}
                  disabled={exportLoading || !exportDateFrom || !exportDateTo}
                >
                  {exportLoading ? 'Cargando...' : 'Cargar torneos'}
                </button>
              )}

              {/* Tournament list */}
              {exportLoaded && (
                <>
                  {exportTournaments.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#4a7090', textAlign: 'center', padding: '10px 0' }}>
                      No hay torneos en ese rango de fechas.
                    </div>
                  ) : (
                    <>
                      {/* Select all + counter */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ ...s.checkLabel, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={exportTournaments.every(t => exportSelected.has(t.id))}
                            onChange={toggleExportAll}
                            style={{ accentColor: '#50d080', width: 14, height: 14 }}
                          />
                          Seleccionar todos
                        </label>
                        <span style={{ fontSize: 11, color: '#4a7090', fontWeight: 700 }}>
                          {exportSelected.size}/{exportTournaments.length}
                        </span>
                      </div>

                      {/* Scrollable grouped list */}
                      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {groupByDay(exportTournaments).map(({ day, items }) => {
                          const allSel  = items.every(t => exportSelected.has(t.id))
                          const someSel = items.some(t => exportSelected.has(t.id))
                          return (
                            <div key={day}>
                              {/* Session header */}
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 6px', cursor: 'pointer', borderBottom: '1px solid #1a2a3a', background: 'rgba(255,255,255,0.02)', borderRadius: '6px 6px 0 0' }}>
                                <input
                                  type="checkbox"
                                  checked={allSel}
                                  ref={el => { if (el) el.indeterminate = !allSel && someSel }}
                                  onChange={() => toggleExportSession(items)}
                                  style={{ accentColor: '#50d080', width: 14, height: 14, flexShrink: 0 }}
                                />
                                <span style={{ flex: 1, fontSize: 12, fontWeight: 800, color: '#5a8aaa', textTransform: 'capitalize', letterSpacing: '0.2px' }}>
                                  {formatDayHeader(day)}
                                </span>
                                <span style={{ fontSize: 11, color: '#2a5070', fontWeight: 700, flexShrink: 0 }}>
                                  {items.length} torneo{items.length !== 1 ? 's' : ''}
                                </span>
                              </label>
                              {/* Tournament rows */}
                              {items.map(t => (
                                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 6px 6px 28px', cursor: 'pointer', borderBottom: '1px solid #0e1828' }}>
                                  <input
                                    type="checkbox"
                                    checked={exportSelected.has(t.id)}
                                    onChange={() => toggleExportTournament(t.id)}
                                    style={{ accentColor: '#50d080', width: 14, height: 14, flexShrink: 0 }}
                                  />
                                  <span style={{ flex: 1, fontSize: 12, color: '#7ab0d8', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {t.name}
                                  </span>
                                  <span style={{ fontSize: 11, color: '#2a5070', flexShrink: 0 }}>
                                    {t.hands_count} manos
                                  </span>
                                </label>
                              ))}
                            </div>
                          )
                        })}
                      </div>

                      {/* Progress bar */}
                      {exporting && exportProgress && (
                        <div style={s.progressWrap}>
                          <div style={s.progressBar}>
                            <div style={{ ...s.progressFill, width: `${(exportProgress.current / exportProgress.total) * 100}%` }} />
                          </div>
                          <span style={s.progressText}>{exportProgress.current} / {exportProgress.total} torneos</span>
                        </div>
                      )}


                      {/* Error message */}
                      {exportError && (
                        <div style={s.studyError}>{exportError}</div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setShowExport(false)}>
                Cerrar
              </button>
              {exportLoaded && exportTournaments.length > 0 && (
                <button
                  style={{ ...s.applyBtn, opacity: exporting || exportSelected.size === 0 ? 0.5 : 1 }}
                  onClick={handleExport}
                  disabled={exporting || exportSelected.size === 0}
                >
                  {exporting ? 'Exportando...' : `Exportar ${exportSelected.size} torneo${exportSelected.size !== 1 ? 's' : ''}`}
                </button>
              )}
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
    overflow: 'clip',
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
    position: 'sticky',
    top: 0,
    background: 'rgba(10,15,25,0.92)',
    borderBottom: '1px solid #0e1828',
    backdropFilter: 'blur(12px)',
    flexShrink: 0,
    zIndex: 3,
  },
  headerInner: {
    padding: '11px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
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
    gap: 10,
    flexShrink: 0,
  },
  headerProgress: {
    position: 'relative',
    padding: '7px 14px',
    minWidth: 130,
    display: 'flex',
    alignItems: 'center',
    overflow: 'hidden',
    background: 'rgba(8,14,26,0.8)',
    border: '1px solid #1a2e44',
    borderRadius: 8,
  },
  toolbarProgressText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#5a90c0',
    letterSpacing: '0.3px',
    position: 'relative',
    zIndex: 1,
  },
  signOutBtn: {
    background: 'none',
    border: '1px solid #1a3048',
    borderRadius: 6,
    color: '#3a6080',
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  filterDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: '#60b0ff',
  },
  email: {
    fontSize: 11,
    color: '#2a4a62',
    fontWeight: 600,
    letterSpacing: '0.2px',
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
    alignItems: 'stretch',
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
    textAlign: 'center',
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
    minWidth: 0,
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
  listFilterBtn: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'none',
    border: '1px solid #1a2e44',
    borderRadius: 7,
    padding: '5px 11px',
    color: '#3a5a70',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    position: 'relative',
  },
  listFilterBtnActive: {
    border: '1px solid #2a5a8a',
    color: '#60a0d0',
    background: 'rgba(40,100,180,0.08)',
  },
  listMenuBtn: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    opacity: 0.45,
    padding: '2px 6px',
    lineHeight: 1,
    color: '#dde0e8',
    letterSpacing: 2,
  },
  listMenuDropdown: {
    position: 'absolute',
    right: 0,
    top: '100%',
    marginTop: 4,
    background: 'linear-gradient(160deg, #131c2c 0%, #0c1420 100%)',
    border: '1px solid #2a3a52',
    borderRadius: 10,
    overflow: 'hidden',
    zIndex: 50,
    minWidth: 175,
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
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
  rowReentry: {
    fontSize: 14,
    fontWeight: 700,
    color: '#60b0ff',
    background: 'rgba(96, 176, 255, 0.10)',
    border: '1px solid rgba(96, 176, 255, 0.30)',
    borderRadius: 5,
    padding: '2px 6px',
    flexShrink: 0,
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
  importBtn: {
    background: 'linear-gradient(135deg, #0e2a4a, #071830)',
    border: '1px solid #1a4a7a',
    borderRadius: 8,
    padding: '7px 14px',
    color: '#60b0ff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 2px 12px rgba(20,80,180,0.25)',
    whiteSpace: 'nowrap',
  },
  dropZone: {
    width: '100%', border: '2px dashed #1e3a52', borderRadius: 14,
    padding: '40px 20px', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 8, cursor: 'default',
    background: 'rgba(10,20,35,0.5)', transition: 'border-color 0.15s, background 0.15s',
    color: '#3a6080', fontSize: 13, fontWeight: 600, textAlign: 'center',
  },
  dropZoneActive: {
    borderColor: '#60b0ff', background: 'rgba(20,60,140,0.12)', color: '#7ab0d8',
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
