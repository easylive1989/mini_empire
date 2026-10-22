import type { TerrainId } from './terrain';
import { bit, HEX_DIRS } from './hexTiles';
import { hexDistance, neighbours, regionAt, TERRITORIES, territoryTier, type Territory, type WildKind } from './territories';

/**
 * The world map drawn in fine hexes. Each territory keeps its place on the coarse board
 * (`territories.ts`) and becomes a province of fine hexes around `WORLD_SCALE` × its coordinates:
 * every fine hex within two steps belongs to the nearest territory centre, so provinces of neighbouring
 * territories share a border and the others never touch. Around them lie the wild lands, a sea along
 * the south and east coast, a river from 亡者之湖 past the capital out to the sea, and roads that join
 * every territory to the one it is conquered from.
 *
 * Everything is derived deterministically from the territory list, so the map looks the same on every
 * device and the tests can check its shape.
 */

/** Fine hexes per coarse board step. */
export const WORLD_SCALE = 3;
/** Radius of the fine board. */
export const WORLD_RADIUS = 15;

export interface WorldCell {
  q: number;
  r: number;
  /** The territory whose province this hex belongs to, if any. */
  owner: string | null;
  /** The hex the territory's town or landmark stands on. */
  centre: boolean;
  /** What grows here: the wild kind, or for a province the land typical of its terrain. */
  kind: WildKind;
  /** Openings of the road, river and shore on this hex, as masks of `HEX_DIRS` directions. */
  road: number;
  river: number;
  shore: number;
}

export interface World {
  cells: WorldCell[];
  at: (q: number, r: number) => WorldCell | undefined;
  /** The province hexes of each territory, centre first. */
  provinces: Map<string, WorldCell[]>;
  /** Pairs of territories joined by a road (child, then the territory it is conquered from). */
  roads: [string, string][];
}

const key = (q: number, r: number) => `${q},${r}`;

/** The fine hex at the centre of a territory's province. */
export function provinceCentre(t: { q: number; r: number }): { q: number; r: number } {
  return { q: t.q * WORLD_SCALE, r: t.r * WORLD_SCALE };
}

/** Deterministic hash noise in [0, 1) for integer inputs. */
export function hash(q: number, r: number, salt = 0): number {
  let h = Math.imul(q * 374761393 + r * 668265263 + salt * 1442695041, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]: nearby cells get similar values, so kinds come in clusters. */
function valueNoise(x: number, z: number, salt = 0): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi, salt);
  const b = hash(xi + 1, zi, salt);
  const c = hash(xi, zi + 1, salt);
  const d = hash(xi + 1, zi + 1, salt);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Ground position of a fine hex in hex-width units (for noise, so clusters are round). */
function ground(q: number, r: number): { x: number; z: number } {
  return { x: q + r / 2, z: (r * Math.sqrt(3)) / 2 };
}

/** The coarse board cell a fine hex lies in (cube rounding of its scaled-down coordinates). */
function coarse(q: number, r: number): { q: number; r: number } {
  const fq = q / WORLD_SCALE;
  const fr = r / WORLD_SCALE;
  return cubeRound(fq, fr);
}

function cubeRound(fq: number, fr: number): { q: number; r: number } {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

/** What wild land grows next to each territory terrain (and on its province). */
export const KIND_NEAR: Record<TerrainId, WildKind> = {
  plains: 'meadow',
  town: 'meadow',
  forest: 'forest',
  hills: 'hills',
  swamp: 'marsh',
  mountain: 'mountains',
  badlands: 'badlands',
  mine: 'hills',
  graveyard: 'blight',
  holy: 'meadow',
  river: 'meadow',
  capital: 'blight',
};

/** How far into the south-east sea a hex lies (positive = water). */
function seaDepth(q: number, r: number): number {
  const { x, z } = ground(q, r);
  return Math.max(z + 0.35 * x - 10.5, x - 0.35 * z - 11.5) + valueNoise(x * 0.25 + 40, z * 0.25, 9) * 1.6;
}

/** The kind of a wild hex, from the named regions, the sea and the territories nearby. */
function wildKind(q: number, r: number, near: Territory, d: number): WildKind {
  if (seaDepth(q, r) > 0) return 'sea';
  const c = coarse(q, r);
  const region = regionAt(c.q, c.r);
  // Named lakes keep to the hexes round their middle; the other regions fill their whole patch.
  if (region && (region.kind !== 'lake' || hexDistance({ q, r }, provinceCentre(c)) <= 1)) return region.kind;
  const { x, z } = ground(q, r);
  const grove = valueNoise(x * 0.2, z * 0.2, 3);
  const rise = valueNoise(x * 0.15 + 11, z * 0.15, 5);
  const base = KIND_NEAR[near.terrain];
  if (d <= 3) {
    if (base === 'meadow') return grove > 0.3 ? 'forest' : 'meadow';
    return hash(q, r, 1) < 0.75 ? base : grove > 0 ? 'forest' : 'meadow';
  }
  if (d <= 6) {
    if (base !== 'meadow' && hash(q, r, 1) < 0.45) return base;
    return grove > 0.05 ? 'forest' : rise > 0.45 ? 'mountains' : grove < -0.7 ? 'lake' : hash(q, r, 2) < 0.5 ? 'hills' : 'meadow';
  }
  // Beyond the realm: forest on the low ground, mountains climbing the farther out.
  if (rise > 0.5 - (d - 7) * 0.08) return 'mountains';
  if (grove < -0.75 && d < 9) return 'lake';
  return grove > -0.1 ? 'forest' : hash(q, r, 2) < 0.6 ? 'hills' : 'meadow';
}

export const isWater = (c: WorldCell | undefined) => !!c && (c.kind === 'sea' || c.kind === 'lake');

/**
 * The river's course: it leaves 亡者之湖, runs between the abbey and the capital, past the river
 * valley fortress and through 霜脊山脈 to the eastern sea.
 */
const RIVER_COURSE: [number, number][] = [
  [3, -9],
  [4, -7],
  [5, -5],
  [7, -4],
  [8, -2],
  [16, -2],
];

/** Hexes on the straight line between two hexes, both ends included. */
function line(a: [number, number], b: [number, number]): [number, number][] {
  const n = hexDistance({ q: a[0], r: a[1] }, { q: b[0], r: b[1] });
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    // A nudge keeps points that sit exactly between two hexes from rounding both ways.
    const c = cubeRound(a[0] + (b[0] - a[0]) * t + 1e-6, a[1] + (b[1] - a[1]) * t + 2e-6);
    out.push([c.q, c.r]);
  }
  return out;
}

function dirTo(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return HEX_DIRS.findIndex(([dq, dr]) => a.q + dq === b.q && a.r + dr === b.r);
}

/** The territory each territory is conquered from: a neighbour one tier easier, nearest the main road. */
function roadParent(t: Territory): Territory | undefined {
  const tier = territoryTier(t);
  const easier = neighbours(t).filter((n) => territoryTier(n) < tier);
  easier.sort((a, b) => territoryTier(b) - territoryTier(a) || Math.abs(a.q + a.r) - Math.abs(b.q + b.r));
  return easier[0];
}

export function buildWorld(): World {
  const cells: WorldCell[] = [];
  const index = new Map<string, WorldCell>();
  const at = (q: number, r: number) => index.get(key(q, r));
  const centres = TERRITORIES.map((t) => ({ t, c: provinceCentre(t) }));

  for (let q = -WORLD_RADIUS; q <= WORLD_RADIUS; q++) {
    for (let r = -WORLD_RADIUS; r <= WORLD_RADIUS; r++) {
      if (hexDistance({ q, r }, { q: 0, r: 0 }) > WORLD_RADIUS) continue;
      let near = centres[0];
      let d = Infinity;
      for (const o of centres) {
        const dd = hexDistance(o.c, { q, r });
        if (dd < d || (dd === d && hash(o.t.q, o.t.r, q * 7 + r) < 0.5)) {
          d = dd;
          near = o;
        }
      }
      // Provinces: the hexes next to the centre, and most of the ring beyond.
      const owned = d <= 1 || (d === 2 && hash(q, r, 9) < 0.8);
      const cell: WorldCell = {
        q,
        r,
        owner: owned ? near.t.id : null,
        centre: d === 0,
        kind: owned ? KIND_NEAR[near.t.terrain] : wildKind(q, r, near.t, d),
        road: 0,
        river: 0,
        shore: 0,
      };
      cells.push(cell);
      index.set(key(q, r), cell);
    }
  }

  const around = (c: { q: number; r: number }) => HEX_DIRS.map(([dq, dr]) => at(c.q + dq, c.r + dr));

  // Wild land almost surrounded by water goes under: shore pieces face at most four water edges.
  const flood = cells.filter((c) => !c.owner && !isWater(c) && around(c).filter(isWater).length >= 5);
  for (const c of flood) c.kind = around(c).some((n) => n?.kind === 'sea') ? 'sea' : 'lake';

  // The river, from its lake to the sea.
  const course: [number, number][] = [];
  for (let i = 1; i < RIVER_COURSE.length; i++) {
    for (const p of line(RIVER_COURSE[i - 1], RIVER_COURSE[i])) {
      const last = course[course.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) course.push(p);
    }
  }
  let prev: WorldCell | undefined;
  for (const [q, r] of course) {
    const c = at(q, r);
    if (!c) break;
    if (isWater(c)) {
      if (prev && !isWater(prev)) {
        prev.river |= bit(dirTo(prev, c));
        if (c.kind === 'sea') break;
      }
      prev = c;
      continue;
    }
    c.river |= prev ? bit(dirTo(c, prev)) : 0;
    if (prev && !isWater(prev)) prev.river |= bit(dirTo(prev, c));
    prev = c;
  }

  // Roads: each territory to the one it is conquered from, through the two provinces.
  const roads: [string, string][] = [];
  for (const t of TERRITORIES) {
    const p = roadParent(t);
    if (!p) continue;
    const path = roadPath(at, provinceCentre(t), provinceCentre(p), new Set([t.id, p.id]));
    if (!path) throw new Error(`no road from ${t.id} to ${p.id}`);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      a.road |= bit(dirTo(a, b));
      b.road |= bit(dirTo(b, a));
    }
    roads.push([t.id, p.id]);
  }

  for (const c of cells) {
    if (isWater(c)) continue;
    around(c).forEach((n, d) => {
      if (isWater(n)) c.shore |= bit(d);
    });
  }

  const provinces = new Map<string, WorldCell[]>(TERRITORIES.map((t) => [t.id, []]));
  for (const c of cells) if (c.owner) provinces.get(c.owner)!.push(c);
  for (const list of provinces.values()) list.sort((a, b) => Number(b.centre) - Number(a.centre));
  return { cells, at, provinces, roads };
}

/**
 * The cheapest road between two hexes over land of the given provinces (or any land, failing that).
 * A road may only cross a river where it runs straight, square or slanting across it, so a bridge
 * piece fits.
 */
function roadPath(
  at: (q: number, r: number) => WorldCell | undefined,
  from: { q: number; r: number },
  to: { q: number; r: number },
  owners: Set<string>,
): WorldCell[] | null {
  for (const anyLand of [false, true]) {
    const ok = (c: WorldCell | undefined): c is WorldCell =>
      !!c && !isWater(c) && (anyLand ? c.kind !== 'mountains' || !!c.owner : !!c.owner && owners.has(c.owner));
    const start = at(from.q, from.r)!;
    const goal = at(to.q, to.r)!;
    const dist = new Map<WorldCell, number>([[start, 0]]);
    const back = new Map<WorldCell, WorldCell[]>();
    const open = new Set([start]);
    while (open.size) {
      let cur: WorldCell | undefined;
      for (const c of open) if (!cur || dist.get(c)! < dist.get(cur)!) cur = c;
      open.delete(cur!);
      if (cur === goal) break;
      const base = dist.get(cur!)!;
      HEX_DIRS.forEach(([dq, dr], d) => {
        const n = at(cur!.q + dq, cur!.r + dr);
        if (!ok(n)) return;
        let steps: WorldCell[] = [n];
        let cost = 1 + hash(n.q, n.r, 21) * 0.4;
        if (n.river) {
          // Over a bridge: straight on, across a straight stretch of river.
          const over = at(n.q + dq, n.r + dr);
          const axis = bit(d) | bit(d + 3);
          const straight = [0, 1, 2].some((a) => n.river === (bit(a) | bit(a + 3)));
          if (!straight || n.river & axis || (n.road && n.road !== axis) || !ok(over) || over.river) return;
          steps = [n, over];
          cost = 3;
        }
        const end = steps[steps.length - 1];
        const nd = base + cost;
        if (nd < (dist.get(end) ?? Infinity)) {
          dist.set(end, nd);
          back.set(end, [cur!, ...steps.slice(0, -1)]);
          open.add(end);
        }
      });
    }
    if (!dist.has(goal)) continue;
    const path: WorldCell[] = [goal];
    let c = goal;
    while (c !== start) {
      const [p, ...mid] = back.get(c)!;
      path.push(...mid.reverse(), p);
      c = p;
    }
    return path.reverse();
  }
  return null;
}

let cached: World | null = null;

/** The world map (built once). */
export function getWorld(): World {
  cached ??= buildWorld();
  return cached;
}
