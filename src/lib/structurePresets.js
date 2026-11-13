// Known blind structures, picked by tournament name when creating a live tournament.
// Levels are [sb, bb] with a big blind ante (ante = bb), or [sb, bb, ante] when it differs.

const OPENER = [
  [100, 100], [100, 200], [200, 300], [200, 400], [300, 500], [300, 600], [400, 800],
  [500, 1000], [600, 1200], [700, 1400], [800, 1600], [1000, 2000], // 12: end of registration
  [1000, 2500], [1000, 3000], [2000, 4000],
  // Day 2
  [2000, 5000], [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000], [8000, 16000],
  [10000, 20000], [10000, 25000], [10000, 30000], [20000, 40000], [25000, 50000], [30000, 60000],
  [40000, 80000], [50000, 100000], [60000, 120000], [80000, 160000], [100000, 200000],
  [100000, 250000], [150000, 300000], [200000, 400000], [250000, 500000], [300000, 600000],
  [400000, 800000], [500000, 1000000],
]

const MAIN_EVENT = [
  // Day 1
  [100, 100], [100, 200], [200, 300], [200, 400], [300, 500], [300, 600], [400, 800],
  [500, 1000], [600, 1200], [800, 1600], [1000, 2000],
  // Day 2A / 2B
  [1000, 2000], [1000, 3000], [2000, 4000], [2000, 5000], [3000, 6000], [4000, 8000],
  [5000, 10000], [6000, 12000], [8000, 16000], [10000, 20000], [10000, 25000], [10000, 30000],
  // Days 3 and 4 (60 min from level 30)
  [20000, 40000], [20000, 50000], [30000, 60000], [40000, 80000], [50000, 100000], [60000, 120000],
  [80000, 160000], [100000, 200000], [100000, 250000], [150000, 300000], [200000, 400000],
  [250000, 500000], [300000, 600000], [400000, 800000], [500000, 1000000], [600000, 1200000],
  [800000, 1600000], [1000000, 2000000], [2000000, 4000000], [3000000, 6000000],
  [4000000, 8000000], [5000000, 10000000],
]

const HIGH_ROLLER = [
  // Day 1
  [100, 200], [100, 300], [200, 400], [300, 500], [300, 600], [400, 800],
  [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1000, 3000],
  // Day 2 (registration closes in the break after 13)
  [2000, 4000], [3000, 5000], [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000],
  [8000, 16000], [10000, 20000], [10000, 25000], [10000, 30000], [20000, 40000], [20000, 50000],
  [30000, 60000], [40000, 80000], [50000, 100000], [60000, 120000], [80000, 160000],
  [100000, 200000], [150000, 300000], [200000, 400000], [250000, 500000], [300000, 600000],
  [400000, 800000], [500000, 1000000],
]

// Side events: used for any tournament that isn't one of the named presets
const SIDE_EVENT = {
  key: 'side', label: 'Paralelos', match: [], minutes: 20, startingStack: 30000,
  levels: [
    [100, 200, 0], [100, 300], [200, 400], [300, 600], [400, 800], [500, 1000], [700, 1400],
    [1000, 2000], // 8: end of registration
    [1000, 3000], [2000, 4000], [2000, 5000], [3000, 6000], [4000, 8000], [5000, 10000],
    [7000, 14000], [10000, 20000], [10000, 30000], [20000, 40000], [30000, 60000], [40000, 80000],
    [50000, 100000], [70000, 140000], [100000, 200000], [100000, 300000], [200000, 400000],
    [250000, 500000], [300000, 600000], [400000, 800000], [500000, 1000000],
  ],
}

// minutes / startingStack prefill the form; longFrom makes levels from that one on longer
const PRESETS = [
  { key: 'opener', label: 'Opener', match: ['opener', 'apertura'], minutes: 30, levels: OPENER },
  {
    key: 'main', label: 'Main Event', match: ['main event', 'evento principal'],
    minutes: 45, startingStack: 50000, longFrom: { level: 30, minutes: 60 }, levels: MAIN_EVENT,
  },
  {
    key: 'highroller', label: 'High Roller', match: ['high roller', 'highroller'],
    minutes: 45, startingStack: 80000, levels: HIGH_ROLLER,
    // Level after which there's a break → break minutes
    breaks: { 3: 15, 6: 60, 9: 15, 13: 15, 17: 60, 20: 15, 23: 15 },
  },
]

const fold = str => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Preset whose aliases appear in the tournament name, the side event one otherwise (null with no name)
export function findStructurePreset(name) {
  const n = fold(name || '')
  if (!n.trim()) return null
  return PRESETS.find(p => p.match.some(m => n.includes(m))) ?? SIDE_EVENT
}

export const SIDE_EVENT_DEFAULTS = { minutes: SIDE_EVENT.minutes, startingStack: SIDE_EVENT.startingStack }

// Structure in the app's format ({ sb, bb, ante, minutes })
export function presetStructure(preset, minutes) {
  const long = preset.longFrom
  return preset.levels.map(([sb, bb, ante = bb], i) => ({
    sb, bb, ante,
    minutes: long && i + 1 >= long.level ? long.minutes : minutes,
    ...(preset.breaks?.[i + 1] ? { breakAfter: preset.breaks[i + 1] } : null),
  }))
}
