// Shared sign-up / profile helpers

export function validatePassword(pw) {
  const rules = [
    { ok: pw.length >= 8,          text: 'Mínimo 8 caracteres' },
    { ok: /[0-9]/.test(pw),        text: 'Al menos un número' },
    { ok: /[^a-zA-Z0-9]/.test(pw), text: 'Al menos un carácter especial' },
  ]
  return rules
}

const COUNTRY_CODES = [
  'AD','AE','AF','AG','AL','AM','AO','AR','AT','AU','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ',
  'BN','BO','BR','BS','BT','BW','BY','BZ','CA','CD','CF','CG','CH','CI','CL','CM','CN','CO','CR','CU',
  'CV','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','ER','ES','ET','FI','FJ','FM','FR','GA',
  'GB','GD','GE','GH','GM','GN','GQ','GR','GT','GW','GY','HN','HR','HT','HU','ID','IE','IL','IN','IQ',
  'IR','IS','IT','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KZ','LA','LB','LC','LI',
  'LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MG','MH','MK','ML','MM','MN','MR','MT','MU',
  'MV','MW','MX','MY','MZ','NA','NE','NG','NI','NL','NO','NP','NR','NZ','OM','PA','PE','PG','PH','PK',
  'PL','PR','PS','PT','PW','PY','QA','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SI','SK','SL',
  'SM','SN','SO','SR','SS','ST','SV','SY','SZ','TD','TG','TH','TJ','TL','TM','TN','TO','TR','TT','TV',
  'TW','TZ','UA','UG','US','UY','UZ','VA','VC','VE','VN','VU','WS','XK','YE','ZA','ZM','ZW',
]

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' })
export const COUNTRIES = COUNTRY_CODES
  .map(code => ({ code, name: regionNames.of(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'))

export const MIN_AGE = 18

export const ALIAS_MAX = 16

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const isValidEmail = e => EMAIL_RE.test(e.trim())
export const sameEmail = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function maxBirthDate() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - MIN_AGE)
  return d.toISOString().slice(0, 10)
}

export const AVATAR_SIZE = 256

// Center-crops an image file to a square JPEG of AVATAR_SIZE px
export function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = AVATAR_SIZE
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, AVATAR_SIZE, AVATAR_SIZE)
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('encode'))), 'image/jpeg', 0.88)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })
}
