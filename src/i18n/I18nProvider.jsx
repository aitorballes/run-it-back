import { useEffect, useMemo, useCallback, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { I18nContext, LOCALES, DEFAULT_LANG, isSupported, langFromCountry, guestLang, setActiveLang, translate } from './core'

// Signed in: language saved in the profile, else derived from the sign-up country.
// Signed out: last language used on this device, else the browser's.
export default function I18nProvider({ children }) {
  const { user, updateUserData } = useAuth()
  const meta = user?.user_metadata
  const [guest, setGuest] = useState(guestLang)

  const lang = user
    ? (isSupported(meta?.language) ? meta.language : langFromCountry(meta?.country) ?? DEFAULT_LANG)
    : guest
  setActiveLang(lang)

  useEffect(() => {
    document.documentElement.lang = lang
    try { localStorage.setItem('lang', lang) } catch { /* storage unavailable */ }
  }, [lang])

  const setLang = useCallback(async (code) => {
    if (!isSupported(code)) return
    setGuest(code)
    if (user) return updateUserData({ language: code })
  }, [user, updateUserData])

  const value = useMemo(() => ({
    lang,
    locale: LOCALES[lang],
    setLang,
    t: (key, vars) => translate(lang, key, vars),
  }), [lang, setLang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
