// src/logic/combat/rng.ts
// Deterministic, seeded pseudo-random numbers. The PRNG "position" is captured
// entirely by an integer cursor, so a serialized BattleState round-trips and can
// be replayed or resumed from any point — no hidden 32-bit state to persist.

export function hash32(seed: number, cursor: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (cursor + 0x6d2b79f5), 0x85ebca6b) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

// Maps a 32-bit state to a float in [0, 1).
export function mulberry32Once(s: number): number {
  let t = (s + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export interface RngHolder {
  seed: number
  rngCursor: number
}

// Draw one float in [0,1) from a state-like holder, returning the value plus the
// advanced cursor. Callers must thread the new cursor back into their state.
export function nextRandom<T extends RngHolder>(state: T): { value: number; state: T } {
  const value = mulberry32Once(hash32(state.seed, state.rngCursor))
  return { value, state: { ...state, rngCursor: state.rngCursor + 1 } }
}

export function nextInt<T extends RngHolder>(state: T, n: number): { value: number; state: T } {
  const r = nextRandom(state)
  return { value: Math.floor(r.value * n), state: r.state }
}

// A stateless closure for one-shot generation (army/terrain) that isn't tied to a
// BattleState. Deterministic per seed; advances its own internal counter.
export function makeRng(seed: number): () => number {
  let cursor = 0
  return () => {
    const v = mulberry32Once(hash32(seed, cursor))
    cursor++
    return v
  }
}

// Deterministic weighted pick from a { key: weight } map using an rng closure.
export function weightedPick<K extends string>(weights: Partial<Record<K, number>>, rng: () => number): K {
  const entries = Object.entries(weights) as [K, number][]
  let total = 0
  for (const [, w] of entries) total += w > 0 ? w : 0
  if (total <= 0) return entries[0][0]
  let roll = rng() * total
  for (const [k, w] of entries) {
    if (w <= 0) continue
    roll -= w
    if (roll < 0) return k
  }
  return entries[entries.length - 1][0]
}
