// Carpetas de hand histories vinculadas (File System Access API).
// Los handles se guardan en IndexedDB para no tener que volver a elegir la carpeta.

const DB_NAME = 'run-it-back'
const STORE   = 'linkedFolders'

export const supportsFolderAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function withStore(mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => { db.close(); resolve(req?.result) }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}

export function listLinkedFolders() {
  return withStore('readonly', store => store.getAll())
}

export function saveLinkedFolder(folder) {
  return withStore('readwrite', store => store.put(folder))
}

export function removeLinkedFolder(id) {
  return withStore('readwrite', store => store.delete(id))
}

export async function pickFolder() {
  const handle = await window.showDirectoryPicker({ id: 'hand-histories', mode: 'read' })
  const folder = { id: crypto.randomUUID(), name: handle.name, handle, lastSync: 0 }
  await saveLinkedFolder(folder)
  return folder
}

// Pide permiso de lectura si el navegador lo ha olvidado (requiere gesto del usuario)
export async function ensurePermission(handle) {
  const opts = { mode: 'read' }
  if (await handle.queryPermission(opts) === 'granted') return true
  return await handle.requestPermission(opts) === 'granted'
}

// Recorre la carpeta recursivamente y devuelve los .txt modificados después de `since`
export async function collectTxtFiles(dirHandle, since = 0) {
  const files = []
  async function walk(dir) {
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') {
        await walk(entry)
      } else if (entry.name.toLowerCase().endsWith('.txt')) {
        const file = await entry.getFile()
        if (file.lastModified > since) files.push(file)
      }
    }
  }
  await walk(dirHandle)
  return files
}
