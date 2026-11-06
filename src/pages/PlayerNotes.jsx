import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/core'
import { fetchPlayerNotes, savePlayerNote, deletePlayerNote, playerNameKey } from '../lib/db'
import Logo from '../components/Logo'
import { base } from '../components/liveStyles'

// Notes on the players met at live tables (one per name), to keep in mind for future decisions
export default function PlayerNotes() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t, locale } = useI18n()

  const [notes, setNotes]   = useState(null)
  const [error, setError]   = useState('')
  const [query, setQuery]   = useState('')
  const [editing, setEditing] = useState(null) // id being edited
  const [draft, setDraft]   = useState('')
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')

  useEffect(() => {
    fetchPlayerNotes(user.id).then(setNotes).catch(() => { setNotes([]); setError(t('live.notes.loadError')) })
  }, [user.id, t])

  async function save(name, note) {
    try {
      const saved = await savePlayerNote(user.id, name, note)
      setNotes(ns => [saved, ...ns.filter(n => n.id !== saved.id)])
      return true
    } catch {
      setError(t('live.notes.saveError'))
      return false
    }
  }

  async function add(e) {
    e.preventDefault()
    if (!newName.trim()) return
    if (await save(newName, newNote.trim())) { setNewName(''); setNewNote('') }
  }

  async function remove(id) {
    if (!window.confirm(t('live.notes.deleteConfirm'))) return
    try {
      await deletePlayerNote(id)
      setNotes(ns => ns.filter(n => n.id !== id))
    } catch {
      setError(t('live.saveError'))
    }
  }

  const q = playerNameKey(query)
  const shown = (notes ?? []).filter(n => !q || n.name_key.includes(q) || n.note.toLowerCase().includes(q))
  const existing = newName.trim() ? notes?.find(n => n.name_key === playerNameKey(newName)) : null

  return (
    <div style={base.page}>
      <div style={base.header}>
        <Logo onClick={() => navigate('/')} title={t('nav.goHome')} />
        <button style={base.ghostBtn} onClick={() => navigate('/live')}>← {t('live.title')}</button>
      </div>
      <div style={base.content}>
        <div>
          <div style={base.title}>{t('live.notes.title')}</div>
          <div style={base.subtitle}>{t('live.notes.subtitle')}</div>
        </div>

        {error && <div style={base.error}>{error}</div>}

        <form style={base.card} onSubmit={add}>
          <div style={base.cardTitle}>{t('live.notes.add')}</div>
          <label style={base.field}>
            <span style={base.label}>{t('live.hand.rivalName')}</span>
            <input style={base.input} value={newName} onChange={e => setNewName(e.target.value)} placeholder={t('live.hand.rivalNamePh')} />
          </label>
          <label style={base.field}>
            <span style={base.label}>{t('live.notes.note')}</span>
            <textarea style={{ ...base.input, minHeight: 70, resize: 'vertical' }} value={newNote}
              onChange={e => setNewNote(e.target.value)} placeholder={t('live.notes.notePh')} />
          </label>
          {existing && <div style={base.hint}>{t('live.notes.willReplace', { name: existing.name })}</div>}
          <div style={base.actions}>
            <button style={{ ...base.btn, opacity: newName.trim() ? 1 : 0.4 }} disabled={!newName.trim()} type="submit">{t('common.save')}</button>
          </div>
        </form>

        <input style={base.input} value={query} onChange={e => setQuery(e.target.value)} placeholder={`🔍 ${t('live.notes.search')}`} />

        {notes === null && <div style={base.muted}>{t('common.loading')}</div>}
        {notes?.length === 0 && !error && <div style={base.muted}>{t('live.notes.empty')}</div>}

        {shown.map(n => (
          <div key={n.id} style={st.item}>
            <div style={st.head}>
              <div style={{ minWidth: 0 }}>
                <div style={st.name}>{n.name}</div>
                <div style={st.meta}>
                  {[n.last_venue, new Date(n.updated_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ')}
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
                  <button style={base.btn} onClick={async () => { if (await save(n.name, draft.trim())) setEditing(null) }}>{t('common.save')}</button>
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

const st = {
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
