// "My table": the tables you sit at in a live tournament (live_tournaments.tables) and the notes on who sits where
import { savePlayerNote, updatePlayerNote, deletePlayerNote, playerNameKey, playerNoteKey } from './db'

export const TABLE_SIZES = [2, 3, 4, 5, 6, 7, 8, 9, 10]

// The table you're at now is the last one you added
export const currentTable = tour => tour?.tables?.at(-1) ?? null
export const findTable = (tour, no) => tour?.tables?.find(tb => tb.no === no) ?? null

// Physical seat of the player `i` places to your left (i = 0 is you); seats are numbered clockwise
export const physicalSeat = (table, i) => ((table.mySeat - 1 + i) % table.seats) + 1

export const noteAtSeat = (notes, tableNo, seat) =>
  tableNo != null && seat != null ? notes.find(n => n.table_no === tableNo && n.seat === seat) ?? null : null

export const noteByName = (notes, name) => (name?.trim() ? notes.find(n => n.name && n.name_key === playerNameKey(name)) ?? null : null)

// The player left the table (busted, moved…): the note is kept, with its table, but frees the seat.
// A note with no name is named after its old seat (`leftName`, e.g. "Seat 7") and gets a key of its own,
// so the next player at that seat starts a fresh note.
export async function leaveSeat(note, leftName) {
  return updatePlayerNote(note.id, note.name
    ? { seat: null }
    : { seat: null, name: leftName, tableNo: note.table_no, nameKey: `#left-${note.id}` })
}

// Saves what you know about whoever sits at `seat` of table `tableNo`.
// - same player as the note already on that seat (or that note has no name yet) → that note is updated
// - a name you already have a note on (the player moved here) → that note moves to this seat
// - otherwise a new note
// A different player on a seat that had a note → that note leaves the seat (see leaveSeat; `leftName` names it if unnamed).
// Returns { saved, removedId, left } (removedId: a note merged into the seat's one and deleted; left: the note that left)
export async function saveSeatNote({ userId, tourId, notes, tableNo, seat, name, note, leftName }) {
  const place = { tableNo: tableNo ?? null, seat: seat ?? null }
  const atSeat = noteAtSeat(notes, tableNo, seat)
  const named = noteByName(notes, name)
  const samePerson = atSeat && (!atSeat.name || !name?.trim() || atSeat.name_key === playerNameKey(name))
  let removedId = null
  let left = null
  let saved
  if (atSeat && !samePerson) left = await leaveSeat(atSeat, leftName)
  if (samePerson) {
    // Names are unique per tournament: if this name is on another note, that one gives way
    if (named && named.id !== atSeat.id) { await deletePlayerNote(named.id); removedId = named.id }
    saved = await updatePlayerNote(atSeat.id, { name: name ?? '', note, ...place })
  } else if (named) {
    saved = await updatePlayerNote(named.id, { name, note, ...place })
  } else {
    // An unnamed note keyed by its seat could already exist with that key elsewhere in `notes` → update it
    const key = playerNoteKey(name, tableNo, seat)
    const sameKey = notes.find(n => n.name_key === key && n.id !== left?.id)
    saved = sameKey
      ? await updatePlayerNote(sameKey.id, { name: name ?? '', note, ...place })
      : await savePlayerNote(userId, tourId, name ?? '', note, place)
  }
  return { saved, removedId, left }
}

// Applies a saveSeatNote result to a notes array (newest first)
export const applySaved = (notes, { saved, removedId, left }) =>
  [saved, ...notes.filter(n => n.id !== saved.id && n.id !== removedId).map(n => (n.id === left?.id ? left : n))]
