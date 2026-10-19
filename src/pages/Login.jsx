import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { validatePassword, countriesFor, MIN_AGE, isValidEmail, sameEmail, maxBirthDate } from '../lib/account'
import { useI18n, langFromCountry } from '../i18n/core'

// Supabase sign-in error codes we translate; anything else shows Supabase's own message
const SIGN_IN_ERRORS = ['invalid_credentials', 'email_not_confirmed']

export default function Login() {
  const { signIn, signUp, resetPassword } = useAuth()
  const navigate = useNavigate()
  const { t, lang } = useI18n()

  const [mode, setMode]         = useState('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [emailConfirm, setEmailConfirm] = useState('')
  const [emailTouched, setEmailTouched] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [country, setCountry]     = useState('')
  const [error, setError]       = useState('')
  const [message, setMessage]   = useState('')
  const [loading, setLoading]   = useState(false)

  const pwRules   = validatePassword(password)
  const pwValid   = pwRules.every(r => r.ok)
  const showRules = mode === 'register' && password.length > 0

  function switchMode(m) {
    setMode(m); setError(''); setMessage('')
    setPassword(''); setConfirm('')
    setFirstName(''); setLastName(''); setBirthDate(''); setCountry('')
    setEmailConfirm(''); setEmailTouched(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (mode === 'register') {
      if (!firstName.trim() || !lastName.trim()) { setError(t('account.errors.nameRequired')); return }
      if (!birthDate || birthDate > maxBirthDate()) { setError(t('account.errors.minAge', { age: MIN_AGE })); return }
      if (!country)              { setError(t('account.errors.countryRequired')); return }
      if (!isValidEmail(email))  { setError(t('account.errors.emailInvalid')); return }
      if (!sameEmail(email, emailConfirm)) { setError(t('account.errors.emailMismatch')); return }
      if (!pwValid)             { setError(t('password.errors.rules')); return }
      if (password !== confirm)  { setError(t('password.errors.mismatch')); return }
    }

    setLoading(true)

    if (mode === 'login') {
      const { error } = await signIn(email, password)
      if (error) setError(SIGN_IN_ERRORS.includes(error.code) ? t(`auth.errors.${error.code}`) : error.message)
      else navigate('/')
    } else if (mode === 'register') {
      const { data, error } = await signUp(email.trim(), password, {
        first_name: firstName.trim(),
        last_name:  lastName.trim(),
        birth_date: birthDate,
        country,
        language: langFromCountry(country),
      })
      // With email confirmation on, Supabase returns no error for an existing
      // email — just a user with an empty identities array
      if (error) setError(error.message)
      else if (data.user?.identities?.length === 0) setError(t('auth.emailExists'))
      else setMessage(t('auth.checkEmail'))
    } else {
      const { error } = await resetPassword(email)
      if (error) setError(error.message)
      else setMessage(t('auth.resetSent'))
    }

    setLoading(false)
  }

  return (
    <div style={s.page}>
      <div style={{ ...s.suit, top: '6%',  left: '5%',   fontSize: 200, transform: 'rotate(-15deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '55%', left: '2%',   fontSize: 150, transform: 'rotate(12deg)' }}>♣</div>
      <div style={{ ...s.suit, top: '8%',  right: '4%',  fontSize: 170, color: '#c03030', transform: 'rotate(10deg)' }}>♥</div>
      <div style={{ ...s.suit, top: '58%', right: '3%',  fontSize: 130, color: '#1a50c8', transform: 'rotate(-8deg)' }}>♦</div>
      <div style={{ ...s.suit, bottom: '4%', left: '22%', fontSize: 90, transform: 'rotate(5deg)' }}>♠</div>
      <div style={{ ...s.suit, top: '28%', right: '16%', fontSize: 80,  color: '#c03030', transform: 'rotate(-22deg)' }}>♦</div>

      <div style={s.wrap}>
        <div style={s.logoWrap}>
          <div style={s.logoSuit}>♠</div>
          <div>
            <div style={s.logoName}>RunItBack</div>
            <div style={s.logoSub}>{t('auth.tagline')}</div>
          </div>
        </div>

        <div style={s.card}>
          {mode !== 'forgot' && (
            <div style={s.tabs}>
              <button
                style={{ ...s.tab, ...(mode === 'login' ? s.tabActive : {}) }}
                onClick={() => switchMode('login')}
              >
                {t('auth.signIn')}
              </button>
              <button
                style={{ ...s.tab, ...(mode === 'register' ? s.tabActive : {}) }}
                onClick={() => switchMode('register')}
              >
                {t('auth.signUp')}
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <div style={s.forgotHeader}>
              <div style={s.forgotTitle}>{t('auth.recoverTitle')}</div>
              <div style={s.forgotSub}>{t('auth.recoverSubtitle')}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={s.form}>
            {mode === 'register' && (
              <>
                <div style={s.row}>
                  <div style={{ ...s.field, ...s.half }}>
                    <label style={s.label}>{t('account.firstName')}</label>
                    <input
                      style={s.input}
                      type="text"
                      autoComplete="given-name"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ ...s.field, ...s.half }}>
                    <label style={s.label}>{t('account.lastName')}</label>
                    <input
                      style={s.input}
                      type="text"
                      autoComplete="family-name"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      required
                    />
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
                    <label style={s.label}>{t('account.country')}</label>
                    <select
                      style={{ ...s.input, ...s.select, color: country ? '#c8d4e8' : '#5a6a80' }}
                      autoComplete="country"
                      value={country}
                      onChange={e => setCountry(e.target.value)}
                      required
                    >
                      <option value="" disabled>{t('common.select')}</option>
                      {countriesFor(lang).map(c => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            <div style={s.field}>
              <label style={s.label}>{t('account.email')}</label>
              <input
                style={s.input}
                type="email"
                placeholder={t('account.emailPlaceholder')}
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                required
              />
              {mode === 'register' && emailTouched && email && !isValidEmail(email) && (
                <div style={s.inlineError}>{t('account.emailInvalidShort')}</div>
              )}
            </div>

            {/* Confirmar email — solo en registro */}
            {mode === 'register' && (
              <div style={s.field}>
                <label style={s.label}>{t('account.confirmEmail')}</label>
                <input
                  style={{
                    ...s.input,
                    borderColor: emailConfirm && !sameEmail(email, emailConfirm) ? '#8b3030' : '#1e2e42',
                  }}
                  type="email"
                  placeholder={t('account.emailPlaceholder')}
                  autoComplete="off"
                  value={emailConfirm}
                  onChange={e => setEmailConfirm(e.target.value)}
                  required
                />
                {emailConfirm && !sameEmail(email, emailConfirm) && (
                  <div style={s.inlineError}>{t('account.emailMismatchShort')}</div>
                )}
              </div>
            )}

            {mode !== 'forgot' && (
              <div style={s.field}>
                <label style={s.label}>{t('password.password')}</label>
                <input
                  style={s.input}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {/* Reglas de contraseña — solo en registro */}
            {showRules && (
              <div style={s.rules}>
                {pwRules.map(r => (
                  <div key={r.key} style={{ ...s.rule, color: r.ok ? '#50d080' : '#e07070' }}>
                    {r.ok ? '✓' : '✗'} {t(r.key)}
                  </div>
                ))}
              </div>
            )}

            {/* Confirmar contraseña — solo en registro */}
            {mode === 'register' && (
              <div style={s.field}>
                <label style={s.label}>{t('password.confirm')}</label>
                <input
                  style={{
                    ...s.input,
                    borderColor: confirm && confirm !== password ? '#8b3030' : '#1e2e42',
                  }}
                  type="password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                />
                {confirm && confirm !== password && (
                  <div style={s.inlineError}>{t('password.mismatchShort')}</div>
                )}
              </div>
            )}

            {error   && <div style={s.error}>{error}</div>}
            {message && <div style={s.success}>{message}</div>}

            <button style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
              {loading ? t('common.loading') : mode === 'login' ? t('auth.enter') : mode === 'register' ? t('auth.createAccount') : t('auth.sendLink')}
            </button>

            {mode === 'login' && (
              <button type="button" style={s.forgotLink} onClick={() => switchMode('forgot')}>
                {t('auth.forgot')}
              </button>
            )}
            {mode === 'forgot' && (
              <button type="button" style={s.forgotLink} onClick={() => switchMode('login')}>
                {t('auth.backToSignIn')}
              </button>
            )}
          </form>
        </div>

        <div style={s.footer}>♠ ♥ ♦ ♣</div>
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at 30% 20%, #1a2a3a 0%, #0d1520 40%, #050b10 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
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
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 28,
    zIndex: 1,
    width: 380,
  },
  logoWrap: { display: 'flex', alignItems: 'center', gap: 14 },
  logoSuit: {
    fontSize: 54,
    color: '#60b0ff',
    textShadow: '0 0 30px rgba(60,140,255,0.7), 0 0 70px rgba(60,140,255,0.3)',
    lineHeight: 1,
  },
  logoName: {
    fontSize: 34, fontWeight: 900, color: '#e8f0ff',
    letterSpacing: '-0.5px', textShadow: '0 0 40px rgba(100,160,255,0.25)',
  },
  logoSub: {
    fontSize: 11, color: '#3a5070', fontWeight: 600,
    letterSpacing: '1.5px', textTransform: 'uppercase', marginTop: 3,
  },
  card: {
    background: 'linear-gradient(160deg, #1a2030 0%, #111828 100%)',
    border: '1px solid #2a3a52',
    borderRadius: 18,
    padding: '32px 32px 28px',
    width: '100%',
    boxSizing: 'border-box',
    boxShadow: '0 30px 90px rgba(0,0,0,0.8), 0 0 0 1px rgba(60,100,160,0.08), inset 0 1px 0 rgba(255,255,255,0.04)',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  tabs: {
    display: 'flex',
    background: '#0a0f18',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1, padding: '9px 0', background: 'none', border: 'none',
    color: '#3a5070', cursor: 'pointer', fontSize: 13, fontWeight: 700,
    borderRadius: 8, transition: 'all 0.15s',
  },
  tabActive: {
    background: 'linear-gradient(to bottom, #1e3a5c, #142840)',
    color: '#70c0ff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
  },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  row: { display: 'flex', gap: 10 },
  half: { flex: 1, minWidth: 0 },
  label: {
    fontSize: 10, fontWeight: 800, color: '#3a5a7a',
    letterSpacing: '1px', textTransform: 'uppercase',
  },
  input: {
    background: '#080e18',
    border: '1px solid #1e2e42',
    borderRadius: 9,
    padding: '11px 14px',
    color: '#c8d4e8',
    fontSize: 14,
    outline: 'none',
  },
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
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '8px 12px',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 8,
    border: '1px solid #1a2a3a',
  },
  rule: { fontSize: 11, fontWeight: 600 },
  inlineError: {
    fontSize: 11,
    color: '#e07070',
    marginTop: 2,
  },
  btn: {
    background: 'linear-gradient(135deg, #1e5cad 0%, #1040a0 50%, #0c3080 100%)',
    border: '1px solid #2a4a80',
    borderRadius: 10,
    padding: '13px',
    color: '#d0e8ff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    marginTop: 6,
    letterSpacing: '0.5px',
    boxShadow: '0 4px 24px rgba(20,60,160,0.45)',
  },
  error: {
    color: '#e07070', fontSize: 12, textAlign: 'center',
    padding: '7px 12px', background: 'rgba(160,30,30,0.12)',
    borderRadius: 7, border: '1px solid rgba(160,30,30,0.25)',
  },
  success: {
    color: '#50d080', fontSize: 12, textAlign: 'center',
    padding: '7px 12px', background: 'rgba(30,150,60,0.12)',
    borderRadius: 7, border: '1px solid rgba(30,150,60,0.25)',
  },
  footer: { fontSize: 18, color: '#1a2a3a', letterSpacing: 12 },
  forgotLink: {
    background: 'none', border: 'none', color: '#3a7ab8',
    fontSize: 12, cursor: 'pointer', textAlign: 'center',
    padding: 0, textDecoration: 'underline',
  },
  forgotHeader: { textAlign: 'center' },
  forgotTitle: { fontSize: 18, fontWeight: 800, color: '#e8f0ff' },
  forgotSub: { fontSize: 12, color: '#3a5070', marginTop: 4 },
}
