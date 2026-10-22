import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerrainId } from '../game/campaign/terrain';
import { barrierBetween, hexDistance, TERRITORIES, type Barrier, type Territory } from '../game/campaign/territories';
import { packItem, type Assets, type PackName } from './assets';
import { hexToWorld } from './sceneKit';

/**
 * The world map's land: one continuous low-poly landscape under the territories. Territories sit
 * two tiles apart on a finer hex grid and stand on it as raised plates; between them lies wild
 * country in the character of the lands nearby — meadows, forests, hills, badlands, marshes,
 * blighted ground — and past the realm the land climbs into forested hills and snow-capped
 * mountains that fade into the haze. The cell between two bordering territories carries their road,
 * or the barrier (mountain range, lake, dense forest) that keeps them apart.
 *
 * Everything here is static: the props are merged into a few meshes (one per material, tinted with
 * vertex colours) instead of hundreds of separate models.
 */

/** Territories sit this many fine tiles apart. */
export const SPREAD = 2;

/** Fine-grid coordinates of a territory. */
export function fineOf(t: { q: number; r: number }): { q: number; r: number } {
  return { q: t.q * SPREAD, r: t.r * SPREAD };
}

/** Wild country types, from the territory terrain nearby. */
type Biome = 'meadow' | 'forest' | 'hills' | 'rocky' | 'scorched' | 'marsh' | 'blight' | 'frontier';

const BIOME_OF: Record<TerrainId, Biome> = {
  plains: 'meadow',
  town: 'meadow',
  forest: 'forest',
  hills: 'hills',
  swamp: 'marsh',
  mountain: 'rocky',
  badlands: 'scorched',
  mine: 'rocky',
  graveyard: 'blight',
  holy: 'meadow',
  river: 'marsh',
  capital: 'blight',
};

/** Ground colour of each biome. */
const GROUND: Record<Biome, string> = {
  meadow: '#8dbd57',
  forest: '#5b9142',
  hills: '#9bbd5e',
  rocky: '#98a084',
  scorched: '#c39257',
  marsh: '#6f8d5b',
  blight: '#76705f',
  frontier: '#6a9a49',
};
const ROCK = new THREE.Color('#8f8b7c');
const SNOW = new THREE.Color('#eef1f2');
const SAND = new THREE.Color('#cdbb86');
const WATER_LEVEL = -0.22;

export interface LinkTile {
  a: Territory;
  b: Territory;
  /** Centre of the tile between them, in world space. */
  pos: THREE.Vector3;
  barrier?: Barrier;
}

/** The tile between each pair of bordering territories: where their road, or their barrier, lies. */
export function borderLinks(size: number): LinkTile[] {
  const links: LinkTile[] = [];
  for (let i = 0; i < TERRITORIES.length; i++) {
    for (let j = i + 1; j < TERRITORIES.length; j++) {
      const a = TERRITORIES[i];
      const b = TERRITORIES[j];
      if (hexDistance(a, b) !== 1) continue;
      // Fine coordinates are doubled, so the midpoint tile is the plain sum.
      links.push({ a, b, pos: hexToWorld(a.q + b.q, a.r + b.r, size), barrier: barrierBetween(a.id, b.id) });
    }
  }
  return links;
}

/** Deterministic hash noise in [0, 1) for integer inputs. */
function hash(q: number, r: number, salt = 0): number {
  let h = Math.imul(q * 374761393 + r * 668265263 + salt * 1442695041, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
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

function fbm(x: number, z: number, salt = 0): number {
  return valueNoise(x, z, salt) * 0.6 + valueNoise(x * 2.1, z * 2.1, salt + 9) * 0.28 + valueNoise(x * 4.3, z * 4.3, salt + 17) * 0.12;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance from a point to a segment on the ground plane. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Copies a (quantized, possibly interleaved) geometry into plain float attributes, ready to merge. */
function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = src.getAttribute('position').count;
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    const size = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(n * size);
    if (a) {
      for (let i = 0; i < n; i++) {
        arr[i * size] = a.getX(i);
        arr[i * size + 1] = a.getY(i);
        if (size === 3) arr[i * size + 2] = a.getZ(i);
      }
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  g.setIndex(src.index ? Array.from(src.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i));
  if (!src.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Collects transformed, tinted copies of models and merges them per material. */
class Batch {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  vertices = 0;

  add(obj: THREE.Object3D, tint: THREE.Color): void {
    obj.updateMatrixWorld(true);
    obj.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = floatGeometry(mesh.geometry).applyMatrix4(mesh.matrixWorld);
      const n = g.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([tint.r, tint.g, tint.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = mesh.material as THREE.Material;
      const list = this.parts.get(mat) ?? [];
      list.push(g);
      this.parts.set(mat, list);
      this.vertices += n;
    });
  }

  build(shadows: { cast: boolean; receive: boolean }): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const m = (mat as THREE.MeshStandardMaterial).clone();
      m.vertexColors = true;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = shadows.cast;
      mesh.receiveShadow = shadows.receive;
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

export interface Land {
  group: THREE.Group;
  /** Materials whose colour the map's mood tints (darker while the realm is occupied). */
  materials: THREE.MeshStandardMaterial[];
  vertices: number;
}

interface Lake {
  x: number;
  z: number;
  r: number;
}

interface Prop {
  pack: PackName;
  key: string;
  size: number;
  tall?: boolean;
  tint?: string;
}

/**
 * Builds the land around the territories. `size` is the hex apothem; `radius` the fine-grid radius of
 * the land; `lite` lowers the terrain resolution and thins the far props for 效能模式.
 */
export function buildLand(assets: Assets, size: number, radius: number, lite = false): Land {
  const step = size * 2;
  const hexR = size * 1.1547;
  const terr = TERRITORIES.map((t) => {
    const f = fineOf(t);
    return { t, f, p: hexToWorld(f.q, f.r, size), color: new THREE.Color(GROUND[BIOME_OF[t.terrain]]) };
  });
  const center = new THREE.Vector3();
  for (const x of terr) center.add(x.p);
  center.divideScalar(terr.length);
  const realmR = Math.max(...terr.map((x) => Math.hypot(x.p.x - center.x, x.p.z - center.z))) + hexR;
  const links = borderLinks(size);
  const roads = links.filter((l) => !l.barrier).map((l) => [hexToWorld(fineOf(l.a).q, fineOf(l.a).r, size), hexToWorld(fineOf(l.b).q, fineOf(l.b).r, size)] as const);
  const linkAt = new Map(links.map((l) => [`${l.a.q + l.b.q},${l.a.r + l.b.r}`, l]));
  const taken = new Set(terr.map((x) => `${x.f.q},${x.f.r}`));

  // ---------------------------------------------------------------- what each wild cell holds
  type Cell = { q: number; r: number; c: THREE.Vector3; biome: Biome; v: number; close: boolean; ring: number; link?: LinkTile };
  const cells: Cell[] = [];
  const lakes: Lake[] = [];
  const mounds: { x: number; z: number; r: number; h: number }[] = [];
  const paints: { x: number; z: number; r: number; color: THREE.Color }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const here = { q, r };
      const ring = hexDistance(here, { q: 0, r: 0 });
      if (ring > radius || taken.has(`${q},${r}`)) continue;
      const c = hexToWorld(q, r, size);
      const v = hash(q, r);
      let best = Infinity;
      let nearest = terr[0];
      for (const x of terr) {
        const d = hexDistance(here, x.f) + hash(x.f.q, x.f.r, q * 31 + r) * 0.3;
        if (d < best) {
          best = d;
          nearest = x;
        }
      }
      const biome: Biome = best >= 2.5 ? 'frontier' : BIOME_OF[nearest.t.terrain];
      const cell: Cell = { q, r, c, biome, v, close: best < 1.5, ring, link: linkAt.get(`${q},${r}`) };
      cells.push(cell);
      const kind = cell.link?.barrier?.kind;
      if (kind === 'lake') lakes.push({ x: c.x, z: c.z, r: step * 0.62 });
      else if (kind === 'mountains') mounds.push({ x: c.x, z: c.z, r: step * 0.75, h: 1.3 });
      else if (kind === 'forest') paints.push({ x: c.x, z: c.z, r: step * 0.7, color: new THREE.Color('#467a33') });
      else if (!cell.link && !cell.close) {
        // A few lakes and ponds in the open country, more of them in the marshes.
        const wet = biome === 'marsh' ? 0.4 : biome === 'meadow' || biome === 'blight' ? 0.1 : biome === 'frontier' ? 0.05 : 0;
        if (v < wet) lakes.push({ x: c.x + (hash(q, r, 3) - 0.5) * size, z: c.z + (hash(q, r, 4) - 0.5) * size, r: step * (0.32 + hash(q, r, 5) * 0.3) });
      }
    }
  }

  // ---------------------------------------------------------------- the ground
  /** Ground height: gentle rolls in the realm, rising into mountains beyond it; flat at plates and roads. */
  const height = (x: number, z: number): number => {
    const rr = Math.hypot(x - center.x, z - center.z);
    const frontier = smooth(realmR + 1, realmR + 16, rr);
    let h = fbm(x * 0.16, z * 0.16) * 0.3 + frontier * (2.2 + fbm(x * 0.07, z * 0.07, 5) * 1.6 + Math.max(0, fbm(x * 0.12, z * 0.12, 7)) * 3.2);
    for (const m of mounds) h += m.h * (1 - smooth(0, m.r, Math.hypot(x - m.x, z - m.z)));
    let flat = 1;
    for (const x0 of terr) flat = Math.min(flat, smooth(hexR * 1.02, hexR * 1.9, Math.hypot(x - x0.p.x, z - x0.p.z)));
    for (const [a, b] of roads) flat = Math.min(flat, smooth(0.45, 1.5, segDist(x, z, a.x, a.z, b.x, b.z)));
    h = h * flat - 0.14 * (1 - flat);
    for (const l of lakes) {
      const d = Math.hypot(x - l.x, z - l.z) / l.r;
      if (d < 1.25) h = Math.min(h, -0.62 + 0.62 * smooth(0.55, 1.25, d) + Math.min(0, h));
    }
    return h;
  };

  const extent = (radius + 1) * step;
  const seg = lite ? 96 : 150;
  const geo = new THREE.PlaneGeometry(extent * 2, extent * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  geo.translate(center.x, 0, center.z);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const tmp = new THREE.Color();
  const frontierColor = new THREE.Color(GROUND.frontier);
  const sigma2 = (step * 0.95) ** 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);
    // Colour: the territories' biomes blended by distance, the frontier beyond, rock and snow up high.
    col.setRGB(0, 0, 0);
    let wsum = 0;
    for (const t of terr) {
      const w = Math.exp(-((x - t.p.x) ** 2 + (z - t.p.z) ** 2) / sigma2);
      col.r += t.color.r * w;
      col.g += t.color.g * w;
      col.b += t.color.b * w;
      wsum += w;
    }
    const fw = 0.04 + smooth(realmR - 4, realmR + 6, Math.hypot(x - center.x, z - center.z)) * 3;
    col.r += frontierColor.r * fw;
    col.g += frontierColor.g * fw;
    col.b += frontierColor.b * fw;
    col.multiplyScalar(1 / (wsum + fw));
    for (const p of paints) {
      const k = 1 - smooth(p.r * 0.5, p.r, Math.hypot(x - p.x, z - p.z));
      if (k > 0) col.lerp(p.color, k);
    }
    for (const l of lakes) {
      const d = Math.hypot(x - l.x, z - l.z) / l.r;
      if (d < 1.35) col.lerp(SAND, (1 - smooth(1, 1.35, d)) * 0.8);
    }
    col.lerp(ROCK, smooth(1.7, 2.8, h));
    col.lerp(SNOW, smooth(3.9, 4.7, h));
    const shade = 1 + fbm(x * 0.5, z * 0.5, 23) * 0.08;
    colors.set([col.r * shade, col.g * shade, col.b * shade], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const groundMesh = new THREE.Mesh(geo, groundMat);
  groundMesh.receiveShadow = true;
  groundMesh.matrixAutoUpdate = false;

  // Water: one low-poly disc per lake, slightly ragged.
  const discs: THREE.BufferGeometry[] = [];
  for (const [k, l] of lakes.entries()) {
    const n = 14;
    const ring: THREE.Vector2[] = [];
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2;
      const rr = l.r * (1.02 + (hash(k, s, 41) - 0.5) * 0.25);
      ring.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
    }
    const g = new THREE.ShapeGeometry(new THREE.Shape(ring));
    g.rotateX(-Math.PI / 2);
    g.translate(l.x, WATER_LEVEL, l.z);
    discs.push(g);
  }
  const waterMat = new THREE.MeshStandardMaterial({ color: '#4e93ad', roughness: 0.2, metalness: 0.15, transparent: true, opacity: 0.9, flatShading: true });
  const water = discs.length ? new THREE.Mesh(mergeGeometries(discs)!, waterMat) : null;
  if (water) {
    water.receiveShadow = true;
    water.matrixAutoUpdate = false;
  }

  // ---------------------------------------------------------------- props
  const near = new Batch();
  const far = new Batch();
  const boxes = new Map<string, THREE.Box3>();
  const blocked = (x: number, z: number, wet = false): boolean => {
    for (const t of terr) if (Math.hypot(x - t.p.x, z - t.p.z) < hexR * 1.12) return true;
    for (const [a, b] of roads) if (segDist(x, z, a.x, a.z, b.x, b.z) < 0.65) return true;
    if (!wet) for (const l of lakes) if (Math.hypot(x - l.x, z - l.z) < l.r * 1.08) return true;
    return false;
  };
  const place = (batch: Batch, x: number, z: number, p: Prop, rot: number, wet = false): void => {
    if (blocked(x, z, wet)) return;
    const src = packItem(assets, p.pack, p.key);
    let box = boxes.get(`${p.pack}/${p.key}`);
    if (!box) {
      box = new THREE.Box3().setFromObject(src);
      boxes.set(`${p.pack}/${p.key}`, box);
    }
    const dim = box.getSize(new THREE.Vector3());
    const s = p.size / Math.max(0.01, p.tall ? dim.y : Math.max(dim.x, dim.z));
    const o = src.clone();
    o.scale.multiplyScalar(s);
    o.position.set(x, (wet ? WATER_LEVEL : height(x, z)) - box.min.y * s - 0.05, z);
    o.rotation.y = rot;
    batch.add(o, tmp.set(p.tint ?? '#ffffff'));
  };
  /** Scatters `n` props over a cell, spread across the whole hex so no grid shows. */
  const scatter = (cell: Cell, salt: number, n: number, pick: (w: number, k: number) => Prop, spread = 0.95, wet = false) => {
    const batch = cell.ring > 7 ? far : near;
    for (let k = 0; k < n; k++) {
      const a = hash(cell.q, cell.r, salt + k * 3) * Math.PI * 2;
      const d = Math.sqrt(hash(cell.q, cell.r, salt + k * 3 + 1)) * spread * size;
      const w = hash(cell.q, cell.r, salt + k * 3 + 2);
      place(batch, cell.c.x + Math.cos(a) * d, cell.c.z + Math.sin(a) * d, pick(w, k), a * 5, wet);
    }
  };

  const tree = (w: number): Prop => ({ pack: 'env', key: w < 0.3 ? 'trees_A_medium' : w < 0.6 ? 'trees_B_medium' : w < 0.8 ? 'trees_A_small' : 'trees_B_small', size: 0.9 + w * 0.6 });
  const bigTree = (w: number): Prop => ({ pack: 'env', key: w < 0.5 ? 'trees_A_large' : 'trees_B_large', size: 1.3 + w * 0.5 });
  const mountain = (w: number, s: number): Prop => ({ pack: 'env', key: w < 0.4 ? 'mountain_A' : w < 0.75 ? 'mountain_B_grass_trees' : 'mountain_C_grass', size: s, tall: true });
  const single = (w: number): Prop => ({ pack: 'env', key: w < 0.5 ? 'tree_single_A' : 'tree_single_B', size: 0.8 + w * 0.4 });

  for (const cell of cells) {
    const { v } = cell;
    const kind = cell.link?.barrier?.kind;
    if (cell.link) {
      if (kind === 'lake') scatter(cell, 11, 5, (_w, k) => ({ pack: 'env', key: k % 3 === 0 ? 'waterlily_A' : k % 3 === 1 ? 'waterplant_A' : 'waterplant_B', size: 0.5 }), 1.1, true);
      else if (kind === 'mountains') {
        place(near, cell.c.x, cell.c.z, mountain(0.1, 3.4), v * 6);
        scatter(cell, 13, 4, (w) => mountain(w, 2 + w * 0.9), 0.95);
      } else if (kind === 'forest') {
        place(near, cell.c.x, cell.c.z, bigTree(v), v * 6);
        scatter(cell, 17, 9, (w) => (w < 0.5 ? bigTree(w) : tree(w)), 1.0);
      } else if (v < 0.5) scatter(cell, 19, 2, single, 0.9);
      continue;
    }
    const lite2 = lite && cell.ring > 7;
    switch (cell.biome) {
      case 'meadow':
        scatter(cell, 29, cell.close ? 2 : 3, (w) => (w < 0.55 ? single(w) : w < 0.85 ? tree(w) : { pack: 'env', key: 'rock_single_C', size: 0.45 }));
        if (!cell.close && v < 0.3) scatter(cell, 31, 1, () => ({ pack: 'env', key: 'building_grain', size: 0.75 }), 0.6);
        else if (!cell.close && v > 0.85) scatter(cell, 33, 1, () => ({ pack: 'env', key: 'hill_single_A', size: 1.6 }), 0.5);
        break;
      case 'forest':
        scatter(cell, 37, cell.close ? 4 : 6, (w) => (w < 0.25 && !cell.close ? bigTree(w) : tree(w)));
        break;
      case 'hills':
        scatter(cell, 41, 1, (w) => ({ pack: 'env', key: w < 0.5 ? 'hills_A_trees' : 'hills_B', size: 1.8 }), 0.6);
        scatter(cell, 43, 3, (w) => (w < 0.5 ? tree(w) : { pack: 'env', key: 'hill_single_B', size: 1.0 }));
        break;
      case 'rocky':
        if (!cell.close && v < 0.6) scatter(cell, 47, 2, (w) => mountain(w, 1.8 + w * 1.2), 0.7);
        scatter(cell, 49, 3, (w) => ({ pack: 'env', key: w < 0.33 ? 'rock_single_A' : w < 0.66 ? 'rock_single_E' : 'hill_single_C', size: 0.6 + w * 0.6 }));
        break;
      case 'scorched':
        scatter(cell, 53, 3, (w) =>
          w < 0.45 ? { pack: 'env', key: w < 0.2 ? 'rock_single_D' : 'rock_single_B', size: 0.6 + w * 0.6, tint: '#f0c49a' } : { pack: 'halloween', key: 'tree_dead_medium', size: 1.1 + w * 0.4, tall: true },
        );
        if (!cell.close && v < 0.2) scatter(cell, 55, 1, () => ({ pack: 'env', key: 'mountain_C_grass', size: 1.7, tall: true, tint: '#e6b48c' }), 0.5);
        break;
      case 'marsh':
        scatter(cell, 59, 4, (w) =>
          w < 0.45 ? { pack: 'env', key: w < 0.2 ? 'waterplant_A' : 'waterplant_B', size: 0.5 } : { pack: 'halloween', key: w < 0.75 ? 'tree_dead_small' : 'tree_dead_medium', size: 1.0 + w * 0.4, tall: true },
        );
        break;
      case 'blight':
        scatter(cell, 61, cell.close ? 2 : 4, (w) =>
          w < 0.45
            ? { pack: 'halloween', key: w < 0.2 ? 'tree_dead_large' : 'tree_dead_medium', size: 1.3 + w * 1.2, tall: true }
            : { pack: 'halloween', key: w < 0.75 ? 'gravestone' : 'grave_A', size: 0.38 },
        );
        break;
      case 'frontier': {
        // Beyond the realm: forest on the slopes, mountains on the heights.
        const h = height(cell.c.x, cell.c.z);
        if (h > 1.6 && v < 0.75) scatter(cell, 67, lite2 ? 1 : 2, (w) => mountain(w, 2.4 + w * 1.4 + Math.min(1.5, h * 0.25)), 0.8);
        else scatter(cell, 71, lite2 ? 2 : 4, (w) => (w < 0.15 ? bigTree(w) : tree(w)));
        break;
      }
    }
  }

  const group = new THREE.Group();
  const propMeshes = [...near.build({ cast: true, receive: true }), ...far.build({ cast: false, receive: true })];
  group.add(groundMesh, ...propMeshes);
  if (water) group.add(water);
  return {
    group,
    materials: [groundMat, ...propMeshes.map((m) => m.material as THREE.MeshStandardMaterial)],
    vertices: pos.count + near.vertices + far.vertices,
  };
}
