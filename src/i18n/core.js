import { createContext, useContext } from 'react'
import es from './es'
import en from './en'
import fr from './fr'
import de from './de'
import it from './it'
import pt from './pt'

const DICTS = { es, en, fr, de, it, pt }

// Names shown in the language picker, each in its own language
export const LANGUAGES = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português (Brasil)' },
]

export const DEFAULT_LANG = 'en'

export const LOCALES = { es: 'es-ES', en: 'en-GB', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-BR' }

const COUNTRY_LANG = {
  es: ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR', 'GQ'],
  fr: ['FR', 'BE', 'LU', 'MC', 'SN', 'CI', 'ML', 'BF', 'NE', 'TG', 'BJ', 'GA', 'CG', 'CD', 'CM', 'MG', 'HT', 'DJ', 'KM', 'TD', 'CF', 'GN', 'BI'],
  de: ['DE', 'AT', 'CH', 'LI'],
  it: ['IT', 'SM', 'VA'],
  pt: ['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL'],
}

export const isSupported = code => Object.hasOwn(DICTS, code ?? '')

// Country of residence → site language; anything not covered falls back to English
export function langFromCountry(country) {
  if (!country) return null
  for (const [lang, countries] of Object.entries(COUNTRY_LANG)) {
    if (countries.includes(country)) return lang
  }
  return DEFAULT_LANG
}

// Language before signing in: last one used on this device, else the browser's
export function guestLang() {
  try {
    const saved = localStorage.getItem('lang')
    if (isSupported(saved)) return saved
  } catch { /* storage unavailable */ }
  const nav = navigator.language?.slice(0, 2)
  return isSupported(nav) ? nav : DEFAULT_LANG
}

// Module-level copy so plain helpers (formatters outside components) follow the active language
let activeLang = DEFAULT_LANG
export const setActiveLang = lang => { activeLang = lang }
export const getLocale = () => LOCALES[activeLang]
export const fmtNumber = (n, opts) => Number(n ?? 0).toLocaleString(getLocale(), opts)

function lookup(dict, key) {
  return key.split('.').reduce((node, part) => node?.[part], dict)
}

export function translate(lang, key, vars) {
  let value = lookup(DICTS[lang], key) ?? lookup(DICTS[DEFAULT_LANG], key)
  if (value == null) return key
  if (typeof value === 'function') return value(vars ?? {})
  if (vars && typeof value === 'string') value = value.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m))
  return value
}

// For code outside React components (e.g. module-level helpers)
export const tActive = (key, vars) => translate(activeLang, key, vars)

export const I18nContext = createContext(null)
export const useI18n = () => useContext(I18nContext)
