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
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { parseFile } from '../lib/parser'
import { supportsFolderAccess, listLinkedFolders, saveLinkedFolder, removeLinkedFolder, pickFolder, ensurePermission, collectTxtFiles } from '../lib/folderSync'
import { importHandHistories, fetchTournaments, deleteTournament, generateShareToken, fetchHandsByIds, fetchAllUserListHandIds } from '../lib/db'
import StudyModal from '../components/StudyModal'
import OnboardingTour from '../components/OnboardingTour'
import Avatar from '../components/Avatar'
import Logo from '../components/Logo'
import { useI18n, fmtNumber, getLocale } from '../i18n/core'
import Rich from '../i18n/Rich'

const TOUR_STEPS = [
  { target: 'import',       key: 'import' },
  { target: 'empty-upload', key: 'emptyUpload' },
  { target: 'study',        key: 'study' },
  { target: 'filter',       key: 'filter' },
  { target: 'list-menu',    key: 'listMenu' },
  { target: 'calendar',     key: 'calendar' },
  { target: 'tournament',   key: 'tournament' },
  { target: 'profile',      key: 'profile' },
  { target: 'help',         key: 'help' },
]

function extractBuyin(name) {
  if (!name) return null
  const m = name.match(/\$\s*([\d,]+(?:\.\d+)?)/)
  return m ? parseFloat(m[1].replace(',', '')) : null
}

const EMPTY_FILTERS = { name: '', dateFrom: '', dateTo: '', buyinMin: '', buyinMax: '' }

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

// Monday-first narrow weekday names (L M X J V S D in Spanish); 2024-01-01 was a Monday
const dayLabels = locale => Array.from({ length: 7 }, (_, i) =>
  new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' }))

function CalendarWidget({ sessionGroups, onDayClick, selectedDay, monthOffset, onMonthChange }) {
  const { t, locale } = useI18n()
  const today = new Date()
  const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthLabel = base.toLocaleDateString(locale, { month: 'long', year: 'numeric' }).replace(' de ', ' ')
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const offset = (firstDay + 6) % 7 // Monday-first
  const todayKey = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`

  const sessionDays = new Set(sessionGroups.map(g => g.day))

  const monthKey = `${year}/${String(month + 1).padStart(2, '0')}`
  const monthDayGroups = sessionGroups.filter(g => g.day.startsWith(monthKey))
  const monthTournaments = monthDayGroups.reduce((s, g) => s + g.items.length, 0)
  const monthHands = monthDayGroups.reduce((s, g) => s + g.items.reduce((ss, tour) => ss + (tour.hands_count || 0), 0), 0)

  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div style={calStyle.outer} data-tour="calendar">
      <div style={calStyle.title}>{t('dashboard.calendar.title')}</div>
      <div style={calStyle.widget}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <button style={calStyle.navBtn} onClick={() => onMonthChange(-1)}>‹</button>
          <div style={calStyle.month}>{monthLabel}</div>
          <button style={{ ...calStyle.navBtn, ...(monthOffset === 0 ? calStyle.navBtnDisabled : {}) }} onClick={() => onMonthChange(+1)} disabled={monthOffset === 0}>›</button>
        </div>
        <div key={monthOffset} style={{ animation: 'calMonthIn 0.2s ease' }}>
          <div style={calStyle.grid}>
            {dayLabels(locale).map((l, i) => (
              <div key={i} style={calStyle.dayLabel}>{l}</div>
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
                <span style={calStyle.monthStatLabel}>{t('dashboard.tournamentsLabel')}</span>
              </div>
              <div style={{ width: 1, background: '#1a2a3a', margin: '0 8px' }} />
              <div style={calStyle.monthStatItem}>
                <span style={calStyle.monthStatValue}>{fmtNumber(monthHands)}</span>
                <span style={calStyle.monthStatLabel}>{t('dashboard.handsLabel')}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const formatMoney = n => n.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PLATFORM_ICONS = { ggpoker: ggIcon, winamax: wmIcon, '888poker': icon888, coinpoker: coinIcon, ipoker: ipokerIcon, pokerstars: psIcon }
const PLATFORM_NAMES = { ggpoker: 'GGPoker', winamax: 'Winamax', '888poker': '888poker', coinpoker: 'CoinPoker', ipoker: 'iPoker', pokerstars: 'PokerStars' }

export default function Dashboard() {
  const { user, signOut, updateUserData } = useAuth()
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const fileInputRef    = useRef()
  const folderInputRef  = useRef()
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
  const [showTour,         setShowTour]         = useState(false)
  const [showUserMenu,     setShowUserMenu]     = useState(false)
  const [dragOver,         setDragOver]         = useState(false)
  const [linkedFolders,    setLinkedFolders]    = useState([])
  const [showFolderHelp,   setShowFolderHelp]   = useState(false)
  const [showStudy,        setShowStudy]        = useState(false)
  const [studyInitialFilters, setStudyInitialFilters] = useState(null)

  const [showListMenu,      setShowListMenu]      = useState(false)
  const [showExport,        setShowExport]        = useState(false)
  const [exportMode,        setExportMode]        = useState('date') // 'date' | 'count'
  const [exportDateFrom,    setExportDateFrom]    = useState('')
  const [exportDateTo,      setExportDateTo]      = useState('')
  const [exportHandCount,   setExportHandCount]   = useState('')
  const [exportHandLimits,  setExportHandLimits]  = useState({}) // { [tournamentId]: handsToKeep }
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
    setExportMode('date')
    setExportTournaments([])
    setExportSelected(new Set())
    setExportHandLimits({})
    setExportHandCount('')
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
      setExportHandLimits({})
      setExportTournaments(data)
      setExportSelected(new Set(data.map(tour => tour.id)))
      setExportLoaded(true)
    } catch (e) {
      console.error(e)
      setExportError(t('dashboard.export.loadError'))
    } finally {
      setExportLoading(false)
    }
  }

  function loadExportByHandCount() {
    const n = parseInt(exportHandCount, 10)
    if (!n || n <= 0) return
    setExportError(null)
    setExportDone(null)
    setExportLoaded(false)

    // `tournaments` is already loaded (dashboard list), sorted by date desc
    const selected = []
    let acc = 0
    for (const tour of tournaments) {
      if (acc >= n) break
      selected.push(tour)
      acc += tour.hands_count || 0
    }

    const limits = {}
    if (selected.length) {
      const last = selected[selected.length - 1]
      const before = acc - (last.hands_count || 0)
      limits[last.id] = Math.max(0, Math.min(last.hands_count || 0, n - before))
    }

    setExportHandLimits(limits)
    setExportTournaments(selected)
    setExportSelected(new Set(selected.map(tour => tour.id)))
    setExportLoaded(true)
  }

  function toggleExportTournament(id) {
    setExportSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleExportAll() {
    const allSelected = exportTournaments.every(tour => exportSelected.has(tour.id))
    setExportSelected(allSelected ? new Set() : new Set(exportTournaments.map(tour => tour.id)))
  }

  function toggleExportSession(items) {
    const allSelected = items.every(tour => exportSelected.has(tour.id))
    setExportSelected(prev => {
      const next = new Set(prev)
      if (allSelected) { items.forEach(tour => next.delete(tour.id)) }
      else             { items.forEach(tour => next.add(tour.id)) }
      return next
    })
  }

  async function handleExport() {
    const selected = exportTournaments.filter(tour => exportSelected.has(tour.id))
    if (!selected.length) return
    setExporting(true)
    setExportProgress({ current: 0, total: selected.length })
    setExportError(null)
    setExportDone(null)
    try {
      const handsMap = await fetchHandsBatch(selected.map(tour => tour.id))
      let totalHands = 0
      const files = {}

      for (let i = 0; i < selected.length; i++) {
        const tour = selected[i]
        let hands = handsMap.get(tour.id) || []
        const limit = exportHandLimits[tour.id]
        if (limit != null) hands = hands.slice(-limit)
        totalHands += hands.length
        const text    = serializeTournament(tour, hands)
        const summary = exportIncludeSummary ? serializeSummary(tour) : null
        const fname   = `${sanitizeFilename(tour.name)}_${tour.tournament_id}`

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
        const zipName = exportMode === 'count'
          ? `${t('dashboard.export.zipLast', { n: exportHandCount })}.zip`
          : `${t('dashboard.export.zipRange', { from: exportDateFrom, to: exportDateTo })}.zip`
        downloadBlob(zip, zipName, 'application/zip')
      }

      setShowExport(false)
      const msg = t('dashboard.export.done', { n: selected.length, hands: fmtNumber(totalHands) })
      setToast(msg)
      setTimeout(() => setToast(null), 3500)
    } catch (e) {
      console.error(e)
      setExportError(t('dashboard.export.error'))
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  async function handleDeleteSession() {
    if (!confirmDeleteSession) return
    setDeletingSession(true)
    try {
      for (const tour of confirmDeleteSession.items) {
        await deleteTournament(tour.id, user.id)
      }
      setConfirmDeleteSession(null)
      await loadTournaments()
    } catch (e) {
      console.error(e.message ?? e)
      setToast(t('dashboard.deleteError'))
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
      setToast(t('dashboard.deleteError'))
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
      setToast(t('common.linkCopied'))
      setTimeout(() => setToast(null), 2500)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (supportsFolderAccess) listLinkedFolders().then(setLinkedFolders).catch(console.error)
  }, [])

  // Al abrir el modal, detecta la sala de las carpetas que aún no la tienen (si ya hay permiso)
  useEffect(() => {
    if (!showImport) return
    for (const folder of linkedFolders) {
      if (folder.platform) continue
      folder.handle.queryPermission({ mode: 'read' })
        .then(state => state === 'granted' && detectFolderPlatform(folder))
        .catch(console.error)
    }
  }, [showImport]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!showUserMenu) return
    function handleClick() { setShowUserMenu(false) }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showUserMenu])

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
    if (location.state?.openStudy && user) {
      setStudyInitialFilters(location.state.studyFilters ?? null)
      setShowStudy(true)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, user])
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
        setUploadStatus({ ok: false, message: t('dashboard.import.fileTooBig', { name: f.name, mb: 10 }) })
        setTimeout(() => setUploadStatus(null), 4000)
        return false
      }
      return true
    })
    if (!files.length) return null
    setShowImport(false)
    setUploading(true)
    setUploadStatus(null)
    setProgress(null)
    try {
      const texts = await Promise.all(files.map(f => f.text()))
      const { saved, updated: skipped, summariesUpdated, platform } = await importHandHistories(user.id, texts, {
        onProgress: setProgress,
      })

      const parts = []
      if (saved             > 0) parts.push(t('dashboard.import.saved', { n: saved }))
      if (skipped           > 0) parts.push(t('dashboard.import.updated', { n: skipped }))
      if (summariesUpdated  > 0) parts.push(t('dashboard.import.summaries', { n: summariesUpdated }))
      setUploadStatus({ ok: true, message: parts.join(' · ') || t('dashboard.import.noChanges') })
      setTimeout(() => setUploadStatus(null), 4000)
      await loadTournaments()
      return { platform }
    } catch (err) {
      console.error(err)
      setUploadStatus({ ok: false, message: t('dashboard.import.processError') })
      setTimeout(() => setUploadStatus(null), 4000)
      return null
    } finally {
      setUploading(false)
      setProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleLinkFolder() {
    if (!supportsFolderAccess) return folderInputRef.current.click()
    try {
      const folder = await pickFolder()
      setLinkedFolders(prev => [...prev, folder])
      await handleSyncFolder(folder)
    } catch (err) {
      // Chrome no avisa a la web cuando bloquea una carpeta de sistema: el usuario cancela y llega un AbortError
      if (err.name === 'AbortError') return setShowFolderHelp(true)
      console.error(err)
      setUploadStatus({ ok: false, message: t('dashboard.folders.accessError') })
      setTimeout(() => setUploadStatus(null), 4000)
    }
  }

  async function handleSyncFolder(folder) {
    try {
      await syncFolder(folder)
    } catch (err) {
      console.error(err)
      setUploadStatus({ ok: false, message: t('dashboard.folders.syncError', { name: folder.name }) })
      setTimeout(() => setUploadStatus(null), 4000)
    }
  }

  async function syncFolder(folder) {
    if (!await ensurePermission(folder.handle)) {
      setUploadStatus({ ok: false, message: t('dashboard.folders.noPermission', { name: folder.name }) })
      setTimeout(() => setUploadStatus(null), 4000)
      return
    }
    const files = await collectTxtFiles(folder.handle, folder.lastSync)
    if (!files.length) {
      if (!folder.platform) await detectFolderPlatform(folder)
      setShowImport(false)
      setUploadStatus({ ok: true, message: t('dashboard.folders.noNewFiles', { name: folder.name }) })
      setTimeout(() => setUploadStatus(null), 4000)
      return
    }
    const result = await handleFiles(files)
    if (!result) return
    const updated = {
      ...folder,
      platform: result.platform ?? folder.platform,
      lastSync: Math.max(...files.map(f => f.lastModified)),
    }
    await saveLinkedFolder(updated)
    setLinkedFolders(prev => prev.map(f => f.id === updated.id ? updated : f))
    if (!updated.platform) await detectFolderPlatform(updated)
  }

  // Sin manos en la importación (p.ej. solo summaries): detecta la sala del primer archivo de manos
  async function detectFolderPlatform(folder) {
    for (const file of await collectTxtFiles(folder.handle)) {
      const platform = parseFile(await file.text())[0]?.platform
      if (!platform) continue
      const updated = { ...folder, platform }
      await saveLinkedFolder(updated)
      setLinkedFolders(prev => prev.map(f => f.id === updated.id ? updated : f))
      return
    }
  }

  async function handleUnlinkFolder(folder) {
    await removeLinkedFolder(folder.id)
    setLinkedFolders(prev => prev.filter(f => f.id !== folder.id))
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
    for (const tour of items) {
      const start = parseDate(tour.date)
      const end   = parseDate(tour.end_time)
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
    return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  function groupByDay(list) {
    const map = new Map()
    for (const tour of list) {
      const day = tour.date ? tour.date.slice(0, 10) : '—'
      if (!map.has(day)) map.set(day, [])
      map.get(day).push(tour)
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
    const label = new Date(+y, +m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    return label.replace(' de ', ' ').replace(/^\w/, c => c.toUpperCase())
  }

  const hasFilters = Object.values(filters).some(v => v !== '')

  const filtered = (() => {
    let list = tournaments
    if (filters.name) {
      const q = filters.name.toLowerCase()
      list = list.filter(tour => tour.name?.toLowerCase().includes(q))
    }
    if (filters.dateFrom) {
      const from = filters.dateFrom // YYYY-MM-DD
      list = list.filter(tour => tour.date && tour.date.slice(0, 10).replace(/\//g, '-') >= from)
    }
    if (filters.dateTo) {
      const to = filters.dateTo
      list = list.filter(tour => tour.date && tour.date.slice(0, 10).replace(/\//g, '-') <= to)
    }
    if (filters.buyinMin || filters.buyinMax) {
      const min = filters.buyinMin ? parseFloat(filters.buyinMin) : 0
      const max = filters.buyinMax ? parseFloat(filters.buyinMax) : Infinity
      list = list.filter(tour => {
        const b = extractBuyin(tour.name)
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

  // Guía de bienvenida: se abre sola una vez, solo si el usuario aún no tiene torneos
  const onboardingSeen = !!user?.user_metadata?.onboarding_seen
  const hasTournaments = tournaments.length > 0
  useEffect(() => {
    if (!loading && user && !hasTournaments && !onboardingSeen) setShowTour(true)
  }, [loading, user, hasTournaments, onboardingSeen])

  const closeTour = useCallback(() => {
    setShowTour(false)
    if (!onboardingSeen) updateUserData({ onboarding_seen: true })
  }, [onboardingSeen, updateUserData])

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
      setEmptyMonthNotice(t('dashboard.calendar.emptyMonth', { month: formatMonthHeader(targetMonthKey) }))
      return
    }

    isAutoScrolling.current = true
    setTimeout(() => {
      document.getElementById(`month-${targetMonthKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    setTimeout(() => { isAutoScrolling.current = false }, 1000)
  }, [calMonthOffset, t]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <input ref={folderInputRef} type="file" webkitdirectory="" style={{ display: 'none' }}
            onChange={e => { handleFiles(Array.from(e.target.files).filter(f => f.name.toLowerCase().endsWith('.txt'))); e.target.value = '' }} />
          <div style={s.headerLeft}>
            <Logo />
            {!isMobile && (uploading && progress ? (
              <div style={s.headerProgress}>
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,70,140,0.25)', width: `${(progress.current / progress.total) * 100}%`, transition: 'width 0.2s', borderRadius: 8 }} />
                <span style={s.toolbarProgressText}>{t('dashboard.import.progress', { current: progress.current, total: progress.total })}</span>
              </div>
            ) : (
              <button style={s.importBtn} data-tour="import" onClick={() => setShowImport(true)} disabled={uploading}>
                📂 {t('dashboard.import.title')}
              </button>
            ))}
          </div>
          <div style={s.headerRight}>
            <button style={s.studyBtn} data-tour="study" onClick={() => { setStudyInitialFilters(null); setShowStudy(true) }}>
              🎓 {t('study.title')}
            </button>
            {!loading && !hasTournaments && (
              <button style={s.helpBtn} data-tour="help" onClick={() => setShowTour(true)} title={t('tour.show')}>?</button>
            )}
            <div style={{ position: 'relative' }}>
              <button
                style={s.profileBtn}
                data-tour="profile"
                onClick={e => { e.stopPropagation(); setShowUserMenu(v => !v) }}
                title={t('nav.profile')}
              >
                <Avatar url={user?.user_metadata?.avatar_url} name={user?.user_metadata?.first_name || user?.email} />
                {!isMobile && <span style={s.email}>{t('nav.profile')}</span>}
              </button>
              {showUserMenu && (
                <div style={{ ...s.listMenuDropdown, minWidth: 200 }} onClick={e => e.stopPropagation()}>
                  <div style={s.userMenuHeader}>
                    {user?.user_metadata?.first_name && (
                      <div style={s.userMenuName}>
                        {user.user_metadata.first_name} {user.user_metadata.last_name ?? ''}
                      </div>
                    )}
                    <div style={s.userMenuEmail}>{user?.email}</div>
                  </div>
                  <button style={s.dropdownItem} onClick={() => { setShowUserMenu(false); navigate('/profile') }}>
                    {t('nav.profile')}
                  </button>
                  <button style={{ ...s.dropdownItem, color: '#e07070', borderBottom: 'none' }} onClick={signOut}>
                    {t('nav.signOut')}
                  </button>
                </div>
              )}
            </div>
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
          <div style={s.hint}>{t('common.loading')}</div>
        ) : tournaments.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptySpade}>♠</div>
            <div style={s.emptyTitle}>{t('dashboard.empty.title')}</div>
            <div style={s.hint}>
              <Rich text={t('dashboard.empty.hint')} />
            </div>
            <button style={s.emptyBtn} data-tour="empty-upload" onClick={() => fileInputRef.current.click()}>
              {t('dashboard.empty.button')}
            </button>
          </div>
        ) : (
          <div style={s.listWrap}>
            <div style={s.listHeader}>
              <span style={s.listTitle}>{t('dashboard.myTournaments')}</span>
              <span style={s.listCount}>{tournaments.length}</span>
              {hasFilters && (
                <span style={s.filterInfo}>
                  {t('dashboard.results', { n: filtered.length })}
                  <button style={s.clearFiltersBtn} onClick={clearFilter}>✕ {t('dashboard.clearFilters')}</button>
                </span>
              )}
              <button
                style={{ ...s.listFilterBtn, ...(hasFilters ? s.listFilterBtnActive : {}) }}
                data-tour="filter"
                onClick={openFilter}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="11" cy="11" r="7"/>
                  <line x1="16.5" y1="16.5" x2="22" y2="22"/>
                </svg>
                {t('common.filter')}
                {hasFilters && <span style={s.filterDot} />}
              </button>
              {!isMobile && <div style={{ position: 'relative' }}>
                <button
                  style={s.listMenuBtn}
                  data-tour="list-menu"
                  onClick={e => { e.stopPropagation(); setShowListMenu(v => !v) }}
                >
                  ⋯
                </button>
                {showListMenu && (
                  <div style={s.listMenuDropdown} onClick={e => e.stopPropagation()}>
                    <button style={{ ...s.dropdownItem, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }} onClick={() => { setShowListMenu(false); openExportModal() }}>
                      {t('dashboard.export.title')}
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
                <div style={{ ...s.hint, marginTop: 40 }}>{t('dashboard.noFilterResults')}</div>
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
                const totalHands = items.reduce((sum, tour) => sum + (tour.hands_count || 0), 0)
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
                                  {t('dashboard.session.delete')}
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
                          <span style={s.statLabel}>{t('dashboard.tournamentsLabel')}</span>
                        </div>
                        <div style={s.statDivider} />
                        <div style={s.stat}>
                          <span style={{ ...s.statValue, fontSize: isMobile ? 14 : 18 }}>{fmtNumber(totalHands)}</span>
                          <span style={s.statLabel}>{t('dashboard.handsLabel')}</span>
                        </div>
                        <div style={s.statDivider} />
                        <div style={s.stat}>
                          <span style={{ ...s.statValue, fontSize: isMobile ? 12 : 18, whiteSpace: 'nowrap' }}>{playDuration}</span>
                          <span style={s.statLabel}>{t('dashboard.durationLabel')}</span>
                        </div>
                      </div>
                    </div>

                    {/* Tournament rows */}
                    {isExpanded && (
                      <div style={s.sessionRows}>
                        {items.map(tour => (
                          <div key={tour.id} style={s.row} data-tour="tournament" onClick={() => navigate(`/tournament/${tour.id}`)}>
                            <img
                              src={PLATFORM_ICONS[tour.platform] ?? ggIcon}
                              alt={tour.platform || 'ggpoker'}
                              style={s.rowIcon}
                            />
                            <div style={s.rowInfo}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                <div style={s.rowName}>{tour.name}</div>
                                {tour.entries > 1 && (
                                  <span style={s.rowReentry}>[{tour.entries}]</span>
                                )}
                              </div>
                              <div style={s.rowMeta}>
                                <span style={s.rowTime}>{formatTime(tour.date)}</span>
                                {tour.finish_position != null && (
                                  <span style={s.rowPos}>
                                    {tour.finish_position}º{tour.players ? ` / ${fmtNumber(tour.players)}` : ''}
                                  </span>
                                )}
                                {tour.prize_won > 0 && (
                                  <span style={s.rowPrize}>+{formatMoney(tour.prize_won)}</span>
                                )}
                                {tour.bounty_won > 0 && (
                                  <span style={s.rowBounty}>KO {formatMoney(tour.bounty_won)}</span>
                                )}
                              </div>
                            </div>
                            <div style={{ ...s.rowBadge, ...(tour.reviewed ? s.rowBadgeReviewed : {}) }}>
                              {t('common.hands', { n: tour.hands_count })}{tour.reviewed ? ` · ${t('visualizer.reviewed.done')}` : ''}
                            </div>
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <button
                                style={s.menuBtn}
                                onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === tour.id ? null : tour.id) }}
                              >
                                ⋯
                              </button>
                              {openMenu === tour.id && (
                                <div style={{ ...s.dropdown, minWidth: 160 }} onClick={e => e.stopPropagation()}>
                                  <button style={{ ...s.dropdownItem, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }} onClick={() => handleShare(tour.id)}>
                                    {t('common.share')}
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                      <polyline points="8 6 12 2 16 6"/>
                                      <line x1="12" y1="2" x2="12" y2="15"/>
                                      <path d="M4 15v6h16v-6"/>
                                    </svg>
                                  </button>
                                  <button style={{ ...s.dropdownItem, color: '#e07070', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }} onClick={() => { setOpenMenu(null); setConfirmDelete({ id: tour.id, name: tour.name }) }}>
                                    {t('common.delete')}
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
              <span style={s.modalTitle}>{t('dashboard.deleteTournament.title')}</span>
              <button style={s.modalClose} onClick={() => setConfirmDelete(null)}>✕</button>
            </div>
            <div style={{ padding: '22px 22px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 13, color: '#8ab0cc', margin: 0 }}>
                {t('dashboard.deleteTournament.confirm')}
              </p>
              <p style={{ fontSize: 12, color: '#3a6080', margin: 0, fontWeight: 700 }}>
                {confirmDelete.name}
              </p>
            </div>
            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setConfirmDelete(null)} disabled={deleting}>
                {t('common.cancel')}
              </button>
              <button
                style={{ ...s.applyBtn, background: 'linear-gradient(135deg, #8a1a1a, #5a0a0a)', borderColor: '#6a2020', opacity: deleting ? 0.6 : 1 }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? t('common.deleting') : t('dashboard.deleteTournament.button')}
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
              <span style={s.modalTitle}>{t('dashboard.session.deleteTitle')}</span>
              <button style={s.modalClose} onClick={() => !deletingSession && setConfirmDeleteSession(null)}>✕</button>
            </div>
            <div style={{ padding: '22px 22px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 13, color: '#8ab0cc', margin: 0 }}>
                {t('dashboard.session.deleteConfirm')}
              </p>
              <p style={{ fontSize: 12, color: '#3a6080', margin: 0, fontWeight: 700 }}>
                {formatDayHeader(confirmDeleteSession.day)} — {t('common.tournaments', { n: confirmDeleteSession.items.length })}
              </p>
            </div>
            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setConfirmDeleteSession(null)} disabled={deletingSession}>
                {t('common.cancel')}
              </button>
              <button
                style={{ ...s.applyBtn, background: 'linear-gradient(135deg, #8a1a1a, #5a0a0a)', borderColor: '#6a2020', opacity: deletingSession ? 0.6 : 1 }}
                onClick={handleDeleteSession}
                disabled={deletingSession}
              >
                {deletingSession ? t('common.deleting') : t('dashboard.session.deleteButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ONBOARDING TOUR */}
      {showTour && <OnboardingTour steps={TOUR_STEPS} onClose={closeTour} />}

      {/* STUDY MODAL */}
      {showStudy && (
        <StudyModal
          onClose={() => setShowStudy(false)}
          user={user}
          initialFilters={studyInitialFilters}
          onSearchResults={(hands, filters) => {
            setShowStudy(false)
            navigate('/study/results', { state: { studyHands: hands, studyFilters: filters } })
          }}
          onOpenListHands={(hands) => {
            setShowStudy(false)
            navigate('/study/results', { state: { studyHands: hands } })
          }}
        />
      )}

      {/* FILTER MODAL */}
      {showFilter && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowFilter(false)}>
          <div style={s.modal}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>{t('dashboard.filter.title')}</span>
              <button style={s.modalClose} onClick={() => setShowFilter(false)}>✕</button>
            </div>

            <div style={s.modalBody}>
              {/* Nombre */}
              <div style={s.field}>
                <label style={s.fieldLabel}>{t('dashboard.filter.name')}</label>
                <input
                  style={s.fieldInput}
                  type="text"
                  placeholder={t('dashboard.filter.namePlaceholder')}
                  value={draft.name}
                  onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                />
              </div>

              {/* Fechas */}
              <div style={s.field}>
                <label style={s.fieldLabel}>{t('dashboard.dateRange')}</label>
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
                      placeholder={t('common.min')}
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
                      placeholder={t('common.max')}
                      value={draft.buyinMax}
                      onChange={e => setDraft(d => ({ ...d, buyinMax: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={clearFilter}>{t('common.reset')}</button>
              <button style={s.applyBtn} onClick={applyFilter}>{t('common.applyFilters')}</button>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT MODAL */}
      {showImport && (
        <div style={s.backdrop} onClick={e => e.target === e.currentTarget && setShowImport(false)}>
          <div style={{ ...s.modal, width: 'min(460px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>📂 {t('dashboard.import.title')}</span>
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
                <span style={{ fontSize: 14, fontWeight: 700 }}>{t('dashboard.import.dropHere')}</span>
                <span style={{ fontSize: 12, color: '#2a5070' }}>{t('dashboard.import.dropHint')}</span>
              </div>

              {/* Separador */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <div style={{ flex: 1, height: 1, background: '#1a2a3a' }} />
                <span style={{ fontSize: 11, color: '#2a4060' }}>{t('common.or')}</span>
                <div style={{ flex: 1, height: 1, background: '#1a2a3a' }} />
              </div>

              {/* Botón buscar */}
              <button style={{ ...s.applyBtn, alignSelf: 'stretch' }}
                onClick={() => fileInputRef.current.click()}>
                {t('dashboard.import.browse')}
              </button>

              {/* Carpetas vinculadas */}
              <div style={s.folderSection}>
                <span style={s.fieldLabel}>{t('dashboard.folders.title')}</span>
                {linkedFolders.map(folder => (
                  <div key={folder.id} style={s.folderRow}>
                    {folder.platform
                      ? <img src={PLATFORM_ICONS[folder.platform]} alt={folder.platform} style={s.rowIcon} />
                      : <span>📁</span>}
                    <span style={s.folderName} title={folder.handle.name}>
                      {PLATFORM_NAMES[folder.platform] ?? folder.name}
                    </span>
                    <span style={s.folderMeta}>
                      {folder.lastSync ? new Date(folder.lastSync).toLocaleDateString(locale) : t('common.never')}
                    </span>
                    <button style={s.chipBtn} onClick={() => handleSyncFolder(folder)} disabled={uploading}>{t('dashboard.folders.sync')}</button>
                    <button style={s.modalClose} onClick={() => handleUnlinkFolder(folder)} title={t('dashboard.folders.unlink')}>✕</button>
                  </div>
                ))}
                <button style={{ ...s.clearBtn, flex: 'none' }} onClick={handleLinkFolder} disabled={uploading}>
                  {supportsFolderAccess ? `+ ${t('dashboard.folders.link')}` : t('dashboard.folders.importFolder')}
                </button>
                <span style={s.folderHint}>
                  <Rich text={t('dashboard.folders.hint')} />
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOLDER HELP MODAL */}
      {showFolderHelp && (
        <div style={{ ...s.backdrop, zIndex: 110 }} onClick={e => e.target === e.currentTarget && setShowFolderHelp(false)}>
          <div style={{ ...s.modal, width: 'min(440px, calc(100vw - 32px))' }}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>{t('dashboard.folderHelp.title')}</span>
              <button style={s.modalClose} onClick={() => setShowFolderHelp(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <span style={s.folderHelpText}>
                <Rich text={t('dashboard.folderHelp.intro')} />
              </span>
              <ol style={s.folderHelpList}>
                {['step1', 'step2', 'step3', 'step4'].map(k => (
                  <li key={k}><Rich text={t(`dashboard.folderHelp.${k}`)} /></li>
                ))}
              </ol>
            </div>
            <div style={s.modalFooter}>
              <button style={s.clearBtn} onClick={() => setShowFolderHelp(false)}>{t('common.close')}</button>
              <button style={s.applyBtn} onClick={() => { setShowFolderHelp(false); handleLinkFolder() }}>
                {t('dashboard.folderHelp.chooseAnother')}
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
              <span style={s.modalTitle}>{t('dashboard.export.title')}</span>
              <button style={s.modalClose} onClick={() => setShowExport(false)}>✕</button>
            </div>

            <div style={s.modalBody}>
              {/* Mode toggle */}
              <div style={s.field}>
                <label style={s.fieldLabel}>{t('dashboard.export.selectBy')}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    style={{ ...s.chipBtn, flex: 1, ...(exportMode === 'date' ? s.chipBtnActive : {}) }}
                    onClick={() => { setExportMode('date'); setExportLoaded(false) }}
                  >{t('dashboard.dateRange')}</button>
                  <button
                    style={{ ...s.chipBtn, flex: 1, ...(exportMode === 'count' ? s.chipBtnActive : {}) }}
                    onClick={() => { setExportMode('count'); setExportLoaded(false) }}
                  >{t('dashboard.export.handCount')}</button>
                </div>
              </div>

              {/* Date range */}
              {exportMode === 'date' && (
                <div style={s.field}>
                  <label style={s.fieldLabel}>{t('dashboard.dateRange')}</label>
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
              )}

              {/* Hand count */}
              {exportMode === 'count' && (
                <div style={s.field}>
                  <label style={s.fieldLabel}>{t('dashboard.export.handCount')}</label>
                  <input
                    style={s.fieldInput}
                    type="number"
                    min="1"
                    placeholder={t('dashboard.export.handCountPlaceholder')}
                    value={exportHandCount}
                    onChange={e => { setExportHandCount(e.target.value); setExportLoaded(false) }}
                  />
                  <span style={{ fontSize: 11, color: '#4a7090' }}>
                    {t('dashboard.export.handCountHint', { n: exportHandCount || 'N' })}
                  </span>
                </div>
              )}

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
                  {t('dashboard.export.includeSummary')}
                </label>
              </div>

              {/* Load button (visible before loading) */}
              {!exportLoaded && exportMode === 'date' && (
                <button
                  style={{ ...s.applyBtn, opacity: exportLoading || !exportDateFrom || !exportDateTo ? 0.5 : 1 }}
                  onClick={loadExportTournaments}
                  disabled={exportLoading || !exportDateFrom || !exportDateTo}
                >
                  {exportLoading ? t('common.loading') : t('dashboard.export.load')}
                </button>
              )}
              {!exportLoaded && exportMode === 'count' && (
                <button
                  style={{ ...s.applyBtn, opacity: !exportHandCount || Number(exportHandCount) <= 0 ? 0.5 : 1 }}
                  onClick={loadExportByHandCount}
                  disabled={!exportHandCount || Number(exportHandCount) <= 0}
                >
                  {t('dashboard.export.load')}
                </button>
              )}

              {/* Tournament list */}
              {exportLoaded && (
                <>
                  {exportTournaments.length === 0 ? (
                    <div style={{ fontSize: 13, color: '#4a7090', textAlign: 'center', padding: '10px 0' }}>
                      {exportMode === 'count' ? t('dashboard.export.noHands') : t('dashboard.export.noTournaments')}
                    </div>
                  ) : (
                    <>
                      {/* Select all + counter */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ ...s.checkLabel, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={exportTournaments.every(tour => exportSelected.has(tour.id))}
                            onChange={toggleExportAll}
                            style={{ accentColor: '#50d080', width: 14, height: 14 }}
                          />
                          {t('common.selectAll')}
                        </label>
                        <span style={{ fontSize: 11, color: '#4a7090', fontWeight: 700 }}>
                          {exportSelected.size}/{exportTournaments.length}
                        </span>
                      </div>

                      {/* Scrollable grouped list */}
                      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {groupByDay(exportTournaments).map(({ day, items }) => {
                          const allSel  = items.every(tour => exportSelected.has(tour.id))
                          const someSel = items.some(tour => exportSelected.has(tour.id))
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
                                  {t('common.tournaments', { n: items.length })}
                                </span>
                              </label>
                              {/* Tournament rows */}
                              {items.map(tour => (
                                <label key={tour.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 6px 6px 28px', cursor: 'pointer', borderBottom: '1px solid #0e1828' }}>
                                  <input
                                    type="checkbox"
                                    checked={exportSelected.has(tour.id)}
                                    onChange={() => toggleExportTournament(tour.id)}
                                    style={{ accentColor: '#50d080', width: 14, height: 14, flexShrink: 0 }}
                                  />
                                  <span style={{ flex: 1, fontSize: 12, color: '#7ab0d8', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {tour.name}
                                  </span>
                                  <span style={{ fontSize: 11, color: '#2a5070', flexShrink: 0 }}>
                                    {t('common.hands', { n: exportHandLimits[tour.id] != null ? `${exportHandLimits[tour.id]}/${tour.hands_count}` : tour.hands_count })}
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
                          <span style={s.progressText}>{t('dashboard.import.progress', { current: exportProgress.current, total: exportProgress.total })}</span>
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
                {t('common.close')}
              </button>
              {exportLoaded && exportTournaments.length > 0 && (
                <button
                  style={{ ...s.applyBtn, opacity: exporting || exportSelected.size === 0 ? 0.5 : 1 }}
                  onClick={handleExport}
                  disabled={exporting || exportSelected.size === 0}
                >
                  {exporting ? t('dashboard.export.exporting') : t('dashboard.export.button', { n: exportSelected.size })}
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
  profileBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
  },
  userMenuHeader: {
    padding: '10px 16px',
    borderBottom: '1px solid #1a2a3a',
    background: 'rgba(0,0,0,0.2)',
  },
  userMenuName: { fontSize: 13, fontWeight: 800, color: '#e0ecff' },
  userMenuEmail: { fontSize: 11, color: '#3a5a7a', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  helpBtn: {
    background: 'none',
    border: '1px solid #1a3048',
    borderRadius: '50%',
    color: '#3a6080',
    width: 26,
    height: 26,
    padding: 0,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 800,
    flexShrink: 0,
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
    maxWidth: 420,
    lineHeight: 1.6,
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
  rowBounty: {
    fontSize: 11,
    color: '#e0a040',
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
  rowBadgeReviewed: {
    color: '#40c070',
    background: 'rgba(64, 192, 112, 0.10)',
    border: '1px solid rgba(64, 192, 112, 0.35)',
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
  folderSection: {
    width: '100%', display: 'flex', flexDirection: 'column', gap: 8,
    borderTop: '1px solid #1a2a3a', paddingTop: 16,
  },
  folderRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'rgba(10,20,35,0.5)', border: '1px solid #1a2a3a', borderRadius: 9, padding: '6px 6px 6px 12px',
  },
  folderName: {
    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    fontSize: 13, fontWeight: 700, color: '#7ab0d8',
  },
  folderMeta: { fontSize: 11, color: '#3a5a70', whiteSpace: 'nowrap' },
  folderHelpText: { fontSize: 13, color: '#7ab0d8', lineHeight: 1.6 },
  folderHelpList: { margin: 0, paddingLeft: 20, fontSize: 13, color: '#c0d8f0', lineHeight: 1.7 },
  folderHint: { fontSize: 11, color: '#2a5070', lineHeight: 1.5, wordBreak: 'break-word' },
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
