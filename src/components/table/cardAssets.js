// Card images and suit/rank constants (shared)
const cardImages = import.meta.glob('../../assets/card_deck/*.png', { eager: true })

export function getCardImage(code) {
  if (!code) return null
  const rank = code.slice(0, -1)
  const suit = code.slice(-1).toLowerCase()
  return cardImages[`../../assets/card_deck/${rank}${suit}.png`]?.default ?? null
}

export const SUITS   = { h: '♥', d: '♦', s: '♠', c: '♣' }
export const COLORS  = { h: 'hearts', d: 'diamonds', s: 'spades', c: 'clubs' }
export const RANKS   = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }
export const SUIT_BG = { hearts: '#c0202a', diamonds: '#1a50c8', spades: '#222230', clubs: '#1a8a2a' }

