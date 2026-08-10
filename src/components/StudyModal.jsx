import { useState, useEffect } from 'react'
import {
  fetchStudyHands, fetchHandsInList, fetchUserReviewLists,
  createReviewList, renameReviewList, deleteReviewList,
  fetchHeroStats, migrateHandStats,
} from '../lib/db'

const EMPTY_STUDY = {
  positions: [], notFoldedPreflop: false, potType: null, players: null,
  dateRange: null, dateFrom: '', dateTo: '', heroPfr: false, posVsField: null,
  bbFold: false, stackBB: null, lastN: '',
}
const ALL_POSITIONS = ['UTG', 'UTG+1', 'MP', 'MP+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']

// onSearchResults(hands, filters) and onOpenListHands(hands) let the caller decide
// whether to navigate to a new page or update hands in place (e.g. from study/results).
export default function StudyModal({ onClose, user, initialFilters, onSearchResults, onOpenListHands }) {
  const [studyDraft,       setStudyDraft]       = useState(initialFilters ?? EMPTY_STUDY)
  const [studyLoading,     setStudyLoading]     = useState(false)
  const [studyProgress,    setStudyProgress]    = useState(null)
  const [studyNoResults,   setStudyNoResults]   = useState(false)
  const [studyError,       setStudyError]       = useState(null)
  const [studyTab,         setStudyTab]         = useState('filters')

  const [reviewLists,      setReviewLists]      = useState([])
  const [listsLoading,     setListsLoading]     = useState(true)
  const [listHandsLoading, setListHandsLoading] = useState(false)
  const [renamingListId,   setRenamingListId]   = useState(null)
  const [renameValue,      setRenameValue]      = useState('')
  const [confirmDeleteList, setConfirmDeleteList] = useState(null)
  const [deletingList,     setDeletingList]     = useState(false)
  const [showCreateList,   setShowCreateList]   = useState(false)
  const [newListNameDash,  setNewListNameDash]  = useState('')
  const [creatingList,     setCreatingList]     = useState(false)

  const [heroStats,         setHeroStats]         = useState(null)
  const [statsLoading,      setStatsLoading]      = useState(false)
  const [statsError,        setStatsError]        = useState(null)
  const [migrating,         setMigrating]         = useState(false)
  const [migrationProgress, setMigrationProgress] = useState(null)

  useEffect(() => { loadReviewLists() }, [])

  async function handleStudySearch() {
    setStudyLoading(true)
    setStudyNoResults(false)
    setStudyError(null)
    setStudyProgress(null)
    try {
      const result = await fetchStudyHands(user.id, studyDraft, handsFound => setStudyProgress({ handsFound }))
      if (result.length === 0) {
        setStudyNoResults(true)
      } else {
        onSearchResults(result, studyDraft)
      }
    } catch (e) {
      console.error(e)
      setStudyError('Error al buscar manos. Inténtalo de nuevo.')
    } finally {
      setStudyLoading(false)
      setStudyProgress(null)
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

  async function openList(listId) {
    setListHandsLoading(true)
    try {
      const hands = await fetchHandsInList(listId)
      if (!hands.length) return
      onOpenListHands(hands)
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

  return (<>
    <div style={s.backdrop} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...s.modal, width:'min(560px, calc(100vw - 32px))' }}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>🎓 Estudia tu juego</span>
          <button style={s.modalClose} onClick={onClose}>✕</button>
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
            {/* ---------- HERO ---------- */}
            <div style={{ ...s.filterSection, borderTop: 'none', paddingTop: 0 }}>
              <div style={s.sectionTitle}>Hero</div>

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

              {/* Solo jugadas / Hero PFR */}
              <div style={{ display: 'flex', gap: 20 }}>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={studyDraft.notFoldedPreflop}
                    onChange={e => setStudyDraft(d => ({ ...d, notFoldedPreflop: e.target.checked }))}
                    style={{ accentColor: '#50d080', width: 15, height: 15 }} />
                  VPIP
                </label>
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

              {/* Profundidad de stack del hero */}
              <div style={s.field}>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={studyDraft.stackBB !== null}
                    onChange={e => setStudyDraft(d => ({ ...d, stackBB: e.target.checked ? 100 : null }))}
                    style={{ accentColor: '#50d080', width: 15, height: 15 }} />
                  Profundidad de stack del hero
                </label>
                {studyDraft.stackBB !== null && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
                    <input type="range" min={10} max={100} step={5}
                      value={studyDraft.stackBB}
                      onChange={e => setStudyDraft(d => ({ ...d, stackBB: Number(e.target.value) }))}
                      style={s.stackSlider} />
                    <div style={s.stackSliderValue}>
                      {studyDraft.stackBB >= 100 ? '100 BBs o más' : `${studyDraft.stackBB} BBs o menos`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ---------- BOTE ---------- */}
            <div style={s.filterSection}>
              <div style={s.sectionTitle}>Bote</div>

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

              {/* BB no se une a la mano */}
              <div style={s.field}>
                <label style={s.checkLabel}>
                  <input type="checkbox" checked={studyDraft.bbFold}
                    onChange={e => setStudyDraft(d => ({ ...d, bbFold: e.target.checked }))}
                    style={{ accentColor: '#50d080', width: 15, height: 15 }} />
                  BB no se une a la mano
                </label>
              </div>
            </div>

            {/* ---------- MUESTRA ---------- */}
            <div style={s.filterSection}>
              <div style={s.sectionTitle}>Muestra</div>

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

              {/* Últimas X manos */}
              <div style={s.field}>
                <label style={s.fieldLabel}>Últimas X manos</label>
                <input type="number" min="1" placeholder="Ej: 50000"
                  style={s.fieldInput}
                  value={studyDraft.lastN}
                  onChange={e => setStudyDraft(d => ({ ...d, lastN: e.target.value }))} />
                {studyDraft.lastN > 0 && (
                  <div style={s.stackSliderValue}>Se mostrarán ordenadas de más reciente a más antigua</div>
                )}
              </div>
            </div>

            {studyLoading && (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ fontSize:13, color:'#7ab0d8', textAlign:'center', fontWeight:600 }}>Buscando manos...</div>
                {studyProgress && (
                  <div style={{ fontSize:11, color:'#4a7090', textAlign:'center' }}>
                    {studyProgress.handsFound.toLocaleString('es-ES')} manos encontradas
                  </div>
                )}
              </div>
            )}
            {studyError && <div style={s.studyError}>{studyError}</div>}
            {studyNoResults && <div style={s.studyNoResults}>No se encontraron manos con esos filtros.</div>}
          </div>

          <div style={s.modalFooter}>
            <button style={s.clearBtn} onClick={onClose} disabled={studyLoading}>Cancelar</button>
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
                onClick={() => { if (renamingListId !== list.id) openList(list.id) }}>
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
            <button style={s.clearBtn} onClick={onClose}>Cerrar</button>
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
            <button style={s.clearBtn} onClick={onClose}>Cerrar</button>
            {heroStats?.total_hands > 0 && !migrating && (
              <button style={{ ...s.studySearchBtn, opacity: migrating ? 0.5 : 1 }} onClick={() => { setHeroStats(null); runMigration() }} disabled={migrating}>↺ Recalcular</button>
            )}
          </div>
        </>)}
      </div>
    </div>

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
  </>)
}

const s = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: 'linear-gradient(160deg, #131c2c 0%, #0c1420 100%)',
    border: '1px solid #2a3a52', borderRadius: 18,
    width: 'min(420px, calc(100vw - 32px))',
    boxShadow: '0 30px 90px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 22px 14px', borderBottom: '1px solid #1a2a3a',
  },
  modalTitle: { fontSize: 14, fontWeight: 800, color: '#c0d8f0', letterSpacing: '0.3px' },
  modalClose: { background: 'none', border: 'none', color: '#3a5a70', cursor: 'pointer', fontSize: 14, padding: '2px 6px' },
  modalBody: { padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 },
  modalFooter: { display: 'flex', gap: 10, padding: '14px 22px 20px', borderTop: '1px solid #1a2a3a' },
  field: { display: 'flex', flexDirection: 'column', gap: 7 },
  filterSection: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14, borderTop: '1px solid #16233388' },
  sectionTitle: { fontSize: 11, fontWeight: 800, color: '#50d080', letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: -4 },
  fieldLabel: { fontSize: 10, fontWeight: 800, color: '#3a6080', letterSpacing: '1px', textTransform: 'uppercase' },
  fieldInput: {
    background: '#080e18', border: '1px solid #1e2e42', borderRadius: 9, padding: '10px 13px',
    color: '#c8d4e8', fontSize: 13, outline: 'none', colorScheme: 'dark',
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
  stackSlider: { width: '100%', accentColor: '#50d080', cursor: 'pointer' },
  stackSliderValue: { textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#50d080' },
  studyError: {
    fontSize: 12, color: '#e07070', background: 'rgba(160,30,30,0.1)',
    border: '1px solid rgba(160,30,30,0.2)', borderRadius: 8, padding: '10px 14px',
  },
  studyNoResults: {
    fontSize: 12, color: '#4a7090', background: 'rgba(30,60,90,0.1)',
    border: '1px solid rgba(30,60,90,0.2)', borderRadius: 8, padding: '10px 14px',
  },
  studySearchBtn: {
    flex: 2, background: 'linear-gradient(135deg, #1a3a20, #0c2014)', border: '1px solid #2a6a3a',
    borderRadius: 9, padding: '10px', color: '#50d080', fontSize: 13, fontWeight: 800,
    cursor: 'pointer', boxShadow: '0 4px 20px rgba(20,100,50,0.3)',
  },
  clearBtn: {
    flex: 1, background: 'none', border: '1px solid #2a3a52', borderRadius: 9,
    padding: '10px', color: '#4a7090', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  hint: { fontSize: 13, color: '#2a3a50', marginTop: 60, textAlign: 'center' },
}
