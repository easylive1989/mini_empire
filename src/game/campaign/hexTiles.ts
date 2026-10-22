/**
 * Which KayKit hex tile draws a road, river or shore, and how far to turn it.
 *
 * A tile's openings are a 6-bit mask of hex directions: bit d is set when the piece runs out through
 * the edge towards `HEX_DIRS[d]` (0 = +x, then clockwise seen from above: 1 = +r, 2 = (-1, +1),
 * 3 = -x, 4 = -r, 5 = (+1, -1)). Turning a model by `k` × 60° about the up axis moves the opening on
 * edge d to edge d - k.
 */

/** Axial offsets of the six neighbours, in direction order. */
export const HEX_DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

export const bit = (d: number) => 1 << (((d % 6) + 6) % 6);

export function maskOf(...dirs: number[]): number {
  return dirs.reduce((m, d) => m | bit(d), 0);
}

/** The mask after turning the model by `k` × 60°. */
export function rotateMask(mask: number, k: number): number {
  let out = 0;
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) out |= bit(d - k);
  return out;
}

/** A tile model and the number of 60° turns to apply to it. */
export interface TilePick {
  key: string;
  turns: number;
}

function table(prefix: string, pieces: Record<string, number[]>): Map<number, TilePick> {
  const out = new Map<number, TilePick>();
  for (const [name, dirs] of Object.entries(pieces)) {
    const m = maskOf(...dirs);
    for (let k = 0; k < 6; k++) {
      const r = rotateMask(m, k);
      if (!out.has(r)) out.set(r, { key: `${prefix}${name}`, turns: k });
    }
  }
  return out;
}

/** Openings of each road and river piece as modelled (the river set has no dead end). */
const PIECES: Record<string, number[]> = {
  A: [0, 3],
  B: [3, 5],
  C: [3, 4],
  D: [1, 3, 5],
  E: [0, 3, 5],
  F: [0, 1, 3],
  G: [2, 3, 4],
  H: [0, 2, 3, 4],
  I: [1, 2, 4, 5],
  J: [0, 1, 2, 3],
  K: [1, 2, 3, 4, 5],
  L: [0, 1, 2, 3, 4, 5],
};

const ROADS = table('hex_road_', { ...PIECES, M: [3] });
const RIVERS = table('hex_river_', PIECES);

/** The road piece for a mask of road openings. */
export function roadTile(mask: number): TilePick | undefined {
  return ROADS.get(mask);
}

/** The river piece for a mask of river openings. */
export function riverTile(mask: number): TilePick | undefined {
  return RIVERS.get(mask);
}

/**
 * A straight river with a road across it: crossing A carries the road one edge round from the river's
 * axis, crossing B two.
 */
export function crossingTile(river: number, road: number): TilePick | undefined {
  for (let a = 0; a < 3; a++) {
    if (river !== maskOf(a, a + 3)) continue;
    const k = (6 - a) % 6;
    if (road === maskOf(a + 1, a + 4)) return { key: 'hex_river_crossing_A', turns: k };
    if (road === maskOf(a + 2, a + 5)) return { key: 'hex_river_crossing_B', turns: k };
  }
  return undefined;
}

/** Shore pieces facing 1, 2, 3 and 4 water edges in a row, with the first of those edges as modelled. */
const SHORES: [string, number][] = [
  ['hex_coast_A', 1],
  ['hex_coast_B', 1],
  ['hex_coast_C', 0],
  ['hex_coast_D', 5],
];

/** The longest run of consecutive set bits (wrapping round), as [first edge, length]. */
export function longestRun(mask: number): [number, number] {
  let best: [number, number] = [0, 0];
  for (let s = 0; s < 6; s++) {
    if (!(mask & bit(s)) || mask & bit(s - 1)) continue;
    let n = 0;
    while (n < 6 && mask & bit(s + n)) n++;
    if (n > best[1]) best = [s, n];
  }
  if (mask === 63) best = [0, 6];
  return best;
}

/**
 * The shore piece for a land tile with water on the edges in `water`: it faces the longest stretch of
 * water (at most four edges; land with more water around it should have been flooded).
 */
export function shoreTile(water: number): TilePick | undefined {
  const [s, n] = longestRun(water);
  if (n === 0) return undefined;
  const [key, first] = SHORES[Math.min(n, 4) - 1];
  // Turning by k moves edge `first` to `first - k`, which must land on the run's start.
  return { key, turns: (((first - s) % 6) + 6) % 6 };
}
