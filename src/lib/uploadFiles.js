// Normaliza lo que el usuario suelta o elige: .txt sueltos, ZIPs (p.ej. descargas de PokerCraft) y carpetas.
import { unzip } from 'fflate'

const isTxt = name => name.toLowerCase().endsWith('.txt')
const isZip = name => name.toLowerCase().endsWith('.zip')

export const isUploadable = file => isTxt(file.name) || isZip(file.name)

function unzipAsync(buffer) {
  return new Promise((resolve, reject) =>
    unzip(new Uint8Array(buffer), (err, data) => err ? reject(err) : resolve(data)))
}

// Extrae los .txt de un ZIP como File (ignora carpetas y basura de macOS)
async function txtFilesFromZip(zipFile) {
  const entries = await unzipAsync(await zipFile.arrayBuffer())
  return Object.entries(entries)
    .filter(([path]) => isTxt(path) && !path.startsWith('__MACOSX/') && !path.split('/').pop().startsWith('._'))
    .map(([path, data]) => new File([data], path.split('/').pop(), { lastModified: zipFile.lastModified }))
}

// Sustituye cada ZIP por los .txt que contiene; descarta lo que no sea .txt ni .zip
export async function expandUploads(files) {
  const out = []
  for (const file of files) {
    if (isTxt(file.name)) out.push(file)
    else if (isZip(file.name)) out.push(...await txtFilesFromZip(file))
  }
  return out
}

// Archivos de un drop, entrando recursivamente en las carpetas soltadas
export async function filesFromDrop(dataTransfer) {
  const entries = Array.from(dataTransfer.items ?? [])
    .map(item => item.webkitGetAsEntry?.())
    .filter(Boolean)
  if (!entries.length) return Array.from(dataTransfer.files)

  const files = []
  async function walk(entry) {
    if (entry.isFile) {
      files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)))
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      // readEntries devuelve los hijos por lotes: hay que llamarlo hasta que venga vacío
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return files
}
