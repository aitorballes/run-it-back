import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { validatePassword, MIN_AGE, ALIAS_MAX, maxBirthDate, resizeAvatar } from '../lib/account'
import { useI18n, LANGUAGES } from '../i18n/core'
import { uploadAvatar, removeAvatar } from '../lib/db'
import Avatar from '../components/Avatar'
import Logo from '../components/Logo'

// Supabase error codes we translate; anything else shows Supabase's own message
const PASSWORD_ERRORS = ['invalid_credentials', 'same_password', 'weak_password', 'reauthentication_needed']

export default function Profile() {
  const { user, signIn, signOut, updatePassword, updateUserData } = useAuth()
  const navigate = useNavigate()
  const { t, lang, locale } = useI18n()
  const meta = user?.user_metadata ?? {}

  // Datos personales
  const [firstName, setFirstName] = useState(meta.first_name ?? '')
  const [lastName, setLastName]   = useState(meta.last_name ?? '')
  const [alias, setAlias]         = useState(meta.alias ?? '')
  const [birthDate, setBirthDate] = useState(meta.birth_date ?? '')
  const [language, setLanguage]   = useState(lang)
  const [dataError, setDataError]     = useState('')
  const [dataMessage, setDataMessage] = useState('')
  const [savingData, setSavingData]   = useState(false)

  // Contraseña
  const [current, setCurrent]   = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [pwError, setPwError]     = useState('')
  const [pwMessage, setPwMessage] = useState('')
  const [savingPw, setSavingPw]   = useState(false)

  // Avatar
  const avatarInputRef = useRef(null)
  const [avatarHover, setAvatarHover] = useState(false)
  const [avatarBusy, setAvatarBusy]   = useState(false)
  const [avatarError, setAvatarError] = useState('')

  async function handleAvatarFile(file) {
    if (!file) return
    setAvatarError('')
    if (!file.type.startsWith('image/')) { setAvatarError(t('profile.avatar.notImage')); return }
    if (file.size > 10 * 1024 * 1024)    { setAvatarError(t('profile.avatar.tooBig', { mb: 10 })); return }
    setAvatarBusy(true)
    try {
      const blob = await resizeAvatar(file)
      const url  = await uploadAvatar(user.id, blob)
      const { error } = await updateUserData({ avatar_url: url })
      if (error) throw error
    } catch (e) {
      setAvatarError(t(e.message === 'decode' ? 'profile.avatar.decodeError' : 'profile.avatar.uploadError'))
    } finally {
      setAvatarBusy(false)
    }
  }

  async function handleRemoveAvatar() {
    setAvatarError('')
    setAvatarBusy(true)
    try {
      await removeAvatar(user.id)
      const { error } = await updateUserData({ avatar_url: null })
      if (error) throw error
    } catch {
      setAvatarError(t('profile.avatar.removeError'))
    } finally {
      setAvatarBusy(false)
    }
  }

  const dataDirty =
    firstName.trim() !== (meta.first_name ?? '') ||
    lastName.trim()  !== (meta.last_name ?? '') ||
    alias.trim()     !== (meta.alias ?? '') ||
    birthDate        !== (meta.birth_date ?? '') ||
    language         !== lang

  const pwRules   = validatePassword(password)
  const pwValid   = pwRules.every(r => r.ok)
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  async function handleSaveData(e) {
    e.preventDefault()
    setDataError(''); setDataMessage('')
    if (!firstName.trim() || !lastName.trim()) { setDataError(t('account.errors.nameRequired')); return }
    if (!birthDate || birthDate > maxBirthDate()) { setDataError(t('account.errors.minAge', { age: MIN_AGE })); return }

    setSavingData(true)
    const { error } = await updateUserData({
      first_name: firstName.trim(),
      last_name:  lastName.trim(),
      alias:      alias.trim(),
      birth_date: birthDate,
      language,
    })
    setSavingData(false)
    if (error) setDataError(error.message)
    else setDataMessage('profile.saved') // key, so it shows in the newly saved language
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwError(''); setPwMessage('')
    if (!pwValid)            { setPwError(t('password.errors.rulesNew')); return }
    if (password !== confirm) { setPwError(t('password.errors.mismatch')); return }
    if (password === current) { setPwError(t('password.errors.same_password')); return }

    setSavingPw(true)
    // Supabase no pide la contraseña actual: la comprobamos volviendo a iniciar sesión
    const { error: authError } = await signIn(user.email, current)
    if (authError) {
      setSavingPw(false)
      setPwError(t('password.errors.invalid_credentials'))
      return
    }
    const { error } = await updatePassword(password)
    setSavingPw(false)
    if (error) setPwError(PASSWORD_ERRORS.includes(error.code) ? t(`password.errors.${error.code}`) : error.message)
    else {
      setCurrent(''); setPassword(''); setConfirm('')
      setPwMessage(t('password.updated'))
    }
  }

  return (
    <div style={s.page}>
      <div style={{ ...s.suit, top: '8%',  left: '5%',  fontSize: 200, transform: 'rotate(-15deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '58%', right: '3%', fontSize: 130, color: '#1a50c8', transform: 'rotate(-8deg)' }}>♦</div>

      {/* HEADER */}
      <div style={s.header}>
        <Logo onClick={() => navigate('/')} title={t('nav.goHome')} />
        <button style={s.signOutBtn} onClick={signOut}>{t('nav.signOut')}</button>
      </div>

      <div style={s.content}>
        <div style={s.titleRow}>
          <div style={s.avatarCol}>
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
              onChange={e => { handleAvatarFile(e.target.files[0]); e.target.value = '' }} />
            <button
              type="button"
              style={s.avatarBtn}
              onClick={() => avatarInputRef.current.click()}
              onMouseEnter={() => setAvatarHover(true)}
              onMouseLeave={() => setAvatarHover(false)}
              disabled={avatarBusy}
              title={t('profile.avatar.change')}
            >
              <Avatar url={meta.avatar_url} name={meta.first_name || user?.email} size={72} />
              {(avatarHover || avatarBusy) && (
                <span style={s.avatarOverlay}>{avatarBusy ? '...' : t('profile.avatar.changeShort')}</span>
              )}
            </button>
            {meta.avatar_url && !avatarBusy && (
              <button type="button" style={s.avatarRemove} onClick={handleRemoveAvatar}>{t('profile.avatar.remove')}</button>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={s.title}>
              {meta.first_name ? `${meta.first_name} ${meta.last_name ?? ''}` : t('nav.profile')}
            </div>
            <div style={s.subtitle}>
              {user?.email}{createdAt && ` · ${t('profile.memberSince', { date: createdAt })}`}
            </div>
          </div>
        </div>

        {avatarError && <div style={s.error}>{avatarError}</div>}

        {/* DATOS PERSONALES */}
        <form style={s.card} onSubmit={handleSaveData}>
          <div style={s.cardTitle}>{t('profile.personalData')}</div>

          <div style={s.row}>
            <div style={{ ...s.field, ...s.half }}>
              <label style={s.label}>{t('account.firstName')}</label>
              <input style={s.input} type="text" autoComplete="given-name"
                value={firstName} onChange={e => setFirstName(e.target.value)} required />
            </div>
            <div style={{ ...s.field, ...s.half }}>
              <label style={s.label}>{t('account.lastName')}</label>
              <input style={s.input} type="text" autoComplete="family-name"
                value={lastName} onChange={e => setLastName(e.target.value)} required />
            </div>
          </div>

          <div style={s.field}>
            <label style={s.label}>{t('profile.alias')}</label>
            <input
              style={s.input}
              type="text"
              placeholder="Hero"
              autoComplete="nickname"
              maxLength={ALIAS_MAX}
              value={alias}
              onChange={e => setAlias(e.target.value)}
            />
            <div style={s.fieldHint}>
              {t('profile.aliasHint')}
            </div>
          </div>

          <div style={s.row}>
            <div style={{ ...s.field, ...s.half }}>
              <label style={s.label}>{t('account.birthDate')}</label>
              <input
                style={{ ...s.input, colorScheme: 'dark', cursor: 'pointer' }}
                type="date"
                autoComplete="bday"
                max={maxBirthDate()}
                onClick={e => { try { e.currentTarget.showPicker() } catch { /* unsupported */ } }}
                value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
                required
              />
            </div>
            <div style={{ ...s.field, ...s.half }}>
              <label style={s.label}>{t('profile.language')}</label>
              {/* Saved with the rest of the form; the site switches language once saved */}
              <select
                style={{ ...s.input, ...s.select }}
                value={language}
                onChange={e => setLanguage(e.target.value)}
              >
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div style={s.field}>
            <label style={s.label}>{t('account.email')}</label>
            <input style={{ ...s.input, ...s.inputReadOnly }} type="email" value={user?.email ?? ''} readOnly />
          </div>

          {dataError   && <div style={s.error}>{dataError}</div>}
          {dataMessage && <div style={s.success}>{t(dataMessage)}</div>}

          <div style={s.actions}>
            <button
              style={{ ...s.btn, opacity: !dataDirty || savingData ? 0.5 : 1, cursor: dataDirty ? 'pointer' : 'default' }}
              type="submit"
              disabled={!dataDirty || savingData}
            >
              {savingData ? t('common.saving') : t('profile.saveChanges')}
            </button>
          </div>
        </form>

        {/* CONTRASEÑA */}
        <form style={s.card} onSubmit={handleChangePassword}>
          <div style={s.cardTitle}>{t('password.changeTitle')}</div>

          <input type="email" autoComplete="username" value={user?.email ?? ''} readOnly hidden />

          <div style={s.field}>
            <label style={s.label}>{t('password.current')}</label>
            <input style={s.input} type="password" placeholder="••••••••" autoComplete="current-password"
              value={current} onChange={e => setCurrent(e.target.value)} required />
          </div>

          <div style={s.row}>
            <div style={{ ...s.field, ...s.half }}>
              <label style={s.label}>{t('password.new')}</label>
              <input style={s.input} type="password" placeholder="••••••••" autoComplete="new-password"
                value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div style={{ ...s.field, ...s.half }}>
              <label style={s.label}>{t('password.confirmNew')}</label>
              <input
                style={{ ...s.input, borderColor: confirm && confirm !== password ? '#8b3030' : '#1e2e42' }}
                type="password" placeholder="••••••••" autoComplete="new-password"
                value={confirm} onChange={e => setConfirm(e.target.value)} required
              />
            </div>
          </div>

          {password && (
            <div style={s.rules}>
              {pwRules.map(r => (
                <div key={r.key} style={{ ...s.rule, color: r.ok ? '#50d080' : '#e07070' }}>
                  {r.ok ? '✓' : '✗'} {t(r.key)}
                </div>
              ))}
              {confirm && confirm !== password && (
                <div style={{ ...s.rule, color: '#e07070' }}>✗ {t('password.mismatchShort')}</div>
              )}
            </div>
          )}

          {pwError   && <div style={s.error}>{pwError}</div>}
          {pwMessage && <div style={s.success}>{pwMessage}</div>}

          <div style={s.actions}>
            <button style={{ ...s.btn, opacity: savingPw ? 0.7 : 1 }} type="submit" disabled={savingPw}>
              {savingPw ? t('common.saving') : t('password.changeButton')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 30% 20%, #1a2a3a 0%, #0d1520 40%, #050b10 100%)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: '#dde0e8',
    position: 'relative',
    overflowX: 'hidden',
  },
  suit: {
    position: 'absolute', color: '#ffffff', opacity: 0.04,
    lineHeight: 1, pointerEvents: 'none', userSelect: 'none',
  },
  header: {
    position: 'sticky', top: 0, zIndex: 10,
    background: 'rgba(10,15,25,0.92)', borderBottom: '1px solid #0e1828', backdropFilter: 'blur(12px)',
    padding: '11px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  signOutBtn: {
    background: 'none', border: '1px solid #1a3048', borderRadius: 6, color: '#3a6080',
    padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
  },
  content: {
    position: 'relative', zIndex: 1,
    maxWidth: 600, margin: '0 auto', padding: '24px 16px 48px',
    display: 'flex', flexDirection: 'column', gap: 18,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 },
  avatarCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 },
  avatarBtn: {
    position: 'relative', padding: 0, border: 'none', background: 'none',
    borderRadius: '50%', cursor: 'pointer', display: 'block',
  },
  avatarOverlay: {
    position: 'absolute', inset: 0, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(5,10,18,0.65)', color: '#d0e8ff', fontSize: 11, fontWeight: 800,
  },
  avatarRemove: {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    color: '#3a6080', fontSize: 10, fontWeight: 600, textDecoration: 'underline',
  },
  title:    { fontSize: 22, fontWeight: 900, color: '#e8f0ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  subtitle: { fontSize: 12, color: '#3a5a7a', marginTop: 3 },
  card: {
    background: 'linear-gradient(160deg, #1a2030 0%, #111828 100%)',
    border: '1px solid #2a3a52', borderRadius: 14,
    padding: '22px 22px 20px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  cardTitle: { fontSize: 14, fontWeight: 800, color: '#c8d8f0', marginBottom: 2 },
  row:   { display: 'flex', gap: 10, flexWrap: 'wrap' },
  half:  { flex: '1 1 200px', minWidth: 0 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  fieldHint: { fontSize: 11, color: '#3a5a7a' },
  label: { fontSize: 10, fontWeight: 800, color: '#3a5a7a', letterSpacing: '1px', textTransform: 'uppercase' },
  input: {
    background: '#080e18', border: '1px solid #1e2e42', borderRadius: 9,
    padding: '11px 14px', color: '#c8d4e8', fontSize: 14, outline: 'none',
    width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  inputReadOnly: { color: '#5a6a80', cursor: 'not-allowed', background: '#0a1018' },
  select: {
    colorScheme: 'dark',
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    paddingRight: 38,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%235a7a9a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 14px center',
  },
  rules: {
    display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 12px',
    background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: '1px solid #1a2a3a',
  },
  rule: { fontSize: 11, fontWeight: 600 },
  actions: { display: 'flex', justifyContent: 'flex-end' },
  btn: {
    background: 'linear-gradient(135deg, #1e5cad 0%, #1040a0 50%, #0c3080 100%)',
    border: '1px solid #2a4a80', borderRadius: 9, padding: '10px 20px',
    color: '#d0e8ff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(20,60,160,0.35)',
  },
  error: {
    color: '#e07070', fontSize: 12, padding: '7px 12px', background: 'rgba(160,30,30,0.12)',
    borderRadius: 7, border: '1px solid rgba(160,30,30,0.25)',
  },
  success: {
    color: '#50d080', fontSize: 12, padding: '7px 12px', background: 'rgba(30,150,60,0.12)',
    borderRadius: 7, border: '1px solid rgba(30,150,60,0.25)',
  },
}
