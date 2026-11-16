// Live tournaments are played in casinos with poor signal. Every change is kept on the phone first
// (a copy of the tournament plus the fields not yet saved) and sent to the database when it can be.

const tourKey    = id => `live-tour:${id}`
const pendingKey = id => `live-pending:${id}`
const LIST_KEY   = 'live-list'

function read(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* storage full or unavailable: the app keeps working online */ }
}

export const getCachedTour = id => read(tourKey(id))
export const cacheTour     = tour => tour?.id && write(tourKey(tour.id), tour)
export const forgetTour    = id => { write(tourKey(id), null); write(pendingKey(id), null) }

// Fields waiting to be saved; later changes to the same field win
export const getPending   = id => read(pendingKey(id))
export const addPending   = (id, fields) => write(pendingKey(id), { ...getPending(id), ...fields })
export const clearPending = id => write(pendingKey(id), null)

export const getCachedList = () => read(LIST_KEY)
export const cacheList     = rows => write(LIST_KEY, rows)
