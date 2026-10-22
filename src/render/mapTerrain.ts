import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TerrainId } from '../game/campaign/terrain';
import { hexDistance, regionAt, TERRITORIES, type Territory, type WildKind } from '../game/campaign/territories';
import { packItem, type Assets, type PackName } from './assets';
import { hexToWorld } from './sceneKit';

/**
 * The world map's wild land: every board cell without a territory is a hex tile of forest,
 * mountains, lake, hills, marsh, badlands, blight or meadow that no army can enter. The named regions
 * (`REGIONS`) are fixed; the other cells take after the territories nearby, in clusters (a smooth
 * noise decides, so neighbouring cells tend to share a kind and forests, ranges and lakes grow
 * across several tiles), and the farther from the realm the more forest and mountain.
 *
 * Everything here is static, so it is merged into a few meshes (one per material, tinted per tile
 * with vertex colours) instead of hundreds of separate models.
 */

/** What wild land grows next to each territory terrain. */
const KIND_NEAR: Record<TerrainId, WildKind> = {
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
  river: 'marsh',
  capital: 'blight',
};

/** Tint of each kind's ground (multiplied with the tile texture). */
const GROUND: Record<WildKind, string> = {
  meadow: '#f2ffe0',
  forest: '#b8dc9c',
  hills: '#e2efbf',
  mountains: '#d0d2c2',
  lake: '#ffffff',
  marsh: '#c4d0b0',
  badlands: '#f2b47e',
  blight: '#a6a294',
};

/** Deterministic hash noise in [0, 1) for integer inputs. */
function hash(q: number, r: number, salt = 0): number {
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

/** The kind of wild land on a board cell (cells with a territory are not wild). */
export function wildKind(q: number, r: number): WildKind {
  const region = regionAt(q, r);
  if (region) return region.kind;
  let near: Territory = TERRITORIES[0];
  let d = Infinity;
  for (const t of TERRITORIES) {
    const dd = hexDistance(t, { q, r });
    if (dd < d || (dd === d && hash(t.q, t.r, q * 7 + r) < 0.5)) {
      d = dd;
      near = t;
    }
  }
  // Sample the noise in world-like coordinates so clusters are round, not skewed by the axial axes.
  const x = q + r / 2;
  const z = r * 0.866;
  const grove = valueNoise(x * 0.55, z * 0.55, 3);
  const rise = valueNoise(x * 0.4 + 11, z * 0.4, 5);
  const base = KIND_NEAR[near.terrain];
  if (d <= 1) return base === 'meadow' && grove > 0.3 ? 'forest' : base;
  if (d === 2) {
    if (base !== 'meadow' && hash(q, r, 1) < 0.55) return base;
    return grove > 0.05 ? 'forest' : rise > 0.45 ? 'mountains' : grove < -0.55 ? 'lake' : 'hills';
  }
  // Beyond the realm: forest on the low ground, mountains climbing the farther out.
  const mountain = 0.55 - (d - 3) * 0.18;
  if (rise > mountain) return 'mountains';
  if (grove < -0.6 && d < 5) return 'lake';
  return grove > -0.25 ? 'forest' : 'hills';
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

/** A model to place: `size` is its height when `tall`, else its footprint. */
interface Prop {
  pack: PackName;
  key: string;
  size: number;
  tall?: boolean;
  tint?: string;
}

/** Wild tiles sit a little below the territories, so the playable hexes stand out. */
const WILD_Y = -0.08;

/**
 * Builds the wild tiles of the board out to `radius`. `size` is the hex apothem; `lite` thins out the
 * props for 效能模式.
 */
export function buildWild(assets: Assets, size: number, radius: number, lite = false): Land {
  const taken = new Set(TERRITORIES.map((t) => `${t.q},${t.r}`));
  const ground = new Batch();
  const near = new Batch();
  const far = new Batch();
  const tint = new THREE.Color();
  const boxes = new Map<string, THREE.Box3>();

  const tile = (key: string, q: number, r: number, color: string) => {
    const o = packItem(assets, 'env', key).clone();
    o.scale.set(size, 1, size);
    o.position.copy(hexToWorld(q, r, size)).setY(WILD_Y);
    o.rotation.y = Math.floor(hash(q, r, 7) * 6) * (Math.PI / 3);
    ground.add(o, tint.set(color));
  };
  const place = (batch: Batch, q: number, r: number, x: number, z: number, p: Prop, rot: number, y = WILD_Y) => {
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
    const c = hexToWorld(q, r, size);
    o.position.set(c.x + x * size, y - box.min.y * s, c.z + z * size);
    o.rotation.y = rot;
    batch.add(o, tint.set(p.tint ?? '#ffffff'));
  };
  /** `n` props spread over the tile (kept inside the hex), so neighbouring tiles of a kind run together. */
  const scatter = (batch: Batch, q: number, r: number, salt: number, n: number, pick: (w: number, k: number) => Prop, spread = 0.7, y = WILD_Y) => {
    for (let k = 0; k < n; k++) {
      const a = hash(q, r, salt + k * 3) * Math.PI * 2;
      const d = spread * Math.sqrt(hash(q, r, salt + k * 3 + 1));
      place(batch, q, r, Math.cos(a) * d, Math.sin(a) * d, pick(hash(q, r, salt + k * 3 + 2), k), a * 5, y);
    }
  };

  const tree = (w: number): Prop => ({ pack: 'env', key: w < 0.3 ? 'trees_A_medium' : w < 0.55 ? 'trees_B_medium' : w < 0.8 ? 'trees_A_large' : 'trees_B_large', size: 1.0 + w * 0.6 });
  const single = (w: number): Prop => ({ pack: 'env', key: w < 0.5 ? 'tree_single_A' : 'tree_single_B', size: 0.8 + w * 0.4 });
  const mountain = (w: number, s: number): Prop => ({ pack: 'env', key: w < 0.4 ? 'mountain_A' : w < 0.75 ? 'mountain_B_grass_trees' : 'mountain_C_grass', size: s, tall: true });

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const ring = hexDistance({ q, r }, { q: 0, r: 0 });
      if (ring > radius || taken.has(`${q},${r}`)) continue;
      const kind = wildKind(q, r);
      const v = hash(q, r);
      const batch = ring > 5 ? far : near;
      // The outer rings sit in the haze: fewer props there (and fewer still in 效能模式).
      const sparse = ring > 5 || (lite && ring > 4);
      switch (kind) {
        case 'forest':
          tile('hex_grass', q, r, GROUND.forest);
          // Trees right up to the hex's edges, so neighbouring forest tiles grow into one wood.
          place(batch, q, r, 0, 0, tree(0.6 + v * 0.4), v * 9);
          scatter(batch, q, r, 11, sparse ? (lite ? 2 : 4) : 6, (w) => (sparse ? tree(w * 0.55) : tree(w)), 0.86);
          break;
        case 'mountains':
          tile('hex_grass', q, r, GROUND.mountains);
          place(batch, q, r, (v - 0.5) * 0.3, (hash(q, r, 2) - 0.5) * 0.3, mountain(v, 2.6 + v * 0.8 + Math.max(0, ring - 4) * 0.3), v * 9);
          scatter(batch, q, r, 13, sparse ? 1 : 2, (w) => mountain(w, 1.5 + w * 0.7), 0.7);
          break;
        case 'lake':
          tile('hex_water', q, r, GROUND.lake);
          scatter(batch, q, r, 17, sparse ? 1 : 3, (_w, k) => ({ pack: 'env', key: k === 0 ? 'waterlily_A' : k === 1 ? 'waterplant_A' : 'waterplant_B', size: 0.5 }), 0.6, -0.28);
          break;
        case 'hills':
          tile('hex_grass', q, r, GROUND.hills);
          place(batch, q, r, 0, 0, { pack: 'env', key: v < 0.4 ? 'hills_A_trees' : v < 0.7 ? 'hills_B' : 'hill_single_C', size: 1.9 }, v * 9);
          scatter(batch, q, r, 19, sparse ? 1 : 2, (w) => (w < 0.5 ? single(w) : { pack: 'env', key: 'hill_single_A', size: 1.0 }), 0.75);
          break;
        case 'marsh':
          tile(v < 0.5 ? 'hex_water' : 'hex_grass', q, r, v < 0.5 ? '#b8c4a0' : GROUND.marsh);
          scatter(batch, q, r, 23, sparse ? 2 : 4, (w) =>
            w < 0.45 ? { pack: 'env', key: w < 0.2 ? 'waterplant_A' : 'waterplant_B', size: 0.5 } : { pack: 'halloween', key: w < 0.75 ? 'tree_dead_small' : 'tree_dead_medium', size: 1.0 + w * 0.4, tall: true },
          );
          break;
        case 'badlands':
          tile('hex_grass', q, r, GROUND.badlands);
          if (v < 0.35) place(batch, q, r, 0, 0, { pack: 'env', key: 'mountain_C_grass', size: 1.7, tall: true, tint: '#e6b48c' }, v * 9);
          scatter(batch, q, r, 29, sparse ? 2 : 3, (w) =>
            w < 0.55 ? { pack: 'env', key: w < 0.25 ? 'rock_single_D' : 'rock_single_B', size: 0.6 + w * 0.6, tint: '#f0c49a' } : { pack: 'halloween', key: 'tree_dead_medium', size: 1.2 + w * 0.4, tall: true },
          );
          break;
        case 'blight':
          tile('hex_grass', q, r, GROUND.blight);
          scatter(batch, q, r, 31, sparse ? 2 : 4, (w) =>
            w < 0.45
              ? { pack: 'halloween', key: w < 0.2 ? 'tree_dead_large' : 'tree_dead_medium', size: 1.3 + w * 1.2, tall: true }
              : { pack: 'halloween', key: w < 0.75 ? 'gravestone' : 'grave_A', size: 0.4 },
          );
          break;
        case 'meadow':
          tile('hex_grass', q, r, GROUND.meadow);
          scatter(batch, q, r, 37, sparse ? 1 : 3, (w) => (w < 0.6 ? single(w) : w < 0.85 ? { pack: 'env', key: 'building_grain', size: 0.75 } : { pack: 'env', key: 'rock_single_C', size: 0.45 }), 0.7);
          break;
      }
    }
  }

  const group = new THREE.Group();
  const meshes = [...ground.build({ cast: false, receive: true }), ...near.build({ cast: true, receive: true }), ...far.build({ cast: false, receive: true })];
  group.add(...meshes);
  return {
    group,
    materials: meshes.map((m) => m.material as THREE.MeshStandardMaterial),
    vertices: ground.vertices + near.vertices + far.vertices,
  };
}
