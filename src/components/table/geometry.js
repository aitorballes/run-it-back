// Table geometry shared by the Visualizer and the live hand recorder: an 800×540 table, seat 0 at the bottom
export const CX = 400, CY = 270, RX = 368, RY = 228

export function seatPositions(n) {
  return Array.from({ length: n }, (_, i) => {
    const rad = (180 + 360 * i / n) * Math.PI / 180
    return { x: CX + RX * Math.sin(rad), y: CY - RY * Math.cos(rad) }
  })
}


// Felt (the oval) of the table
export const feltStyle = {
  position: 'absolute', top: 62, left: 56, right: 56, bottom: 62,
  background: 'radial-gradient(ellipse at 50% 38%, #1e4070 0%, #102348 55%, #070f28 100%)',
  borderRadius: '50%', border: '26px solid #080808',
  boxShadow: '0 0 0 3px #1a1a1a, 0 0 0 4px #0a0a0a, 0 0 0 6px rgba(150,120,40,0.18), 0 20px 80px rgba(0,0,0,.98), inset 0 0 90px rgba(0,0,0,.35)',
}
