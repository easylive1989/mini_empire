import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { crossingTile, riverTile, roadTile, shoreTile, type TilePick } from '../game/campaign/hexTiles';
import type { WildKind } from '../game/campaign/territories';
import { getWorld, hash, isWater, type WorldCell } from '../game/campaign/world';
import { packItem, type Assets, type PackName } from './assets';
import { hexToWorld } from './sceneKit';

/**
 * The world map's land, hex by hex (`world.ts` decides what lies where): grass, forest, mountains,
 * lakes and sea, with the road, river, bridge and shore pieces turned to join their neighbours. The
 * wild land is built here; `mapView.ts` paints the provinces with the same `Painter`, one mesh per
 * territory so each can darken and light up on its own.
 *
 * Everything here is static, so it is merged into a few meshes (one per material, tinted per tile
 * with vertex colours) instead of hundreds of separate models.
 */

/** Tint of each kind's ground (multiplied with the tile texture). */
export const GROUND: Record<WildKind, string> = {
  meadow: '#f2ffe0',
  forest: '#b8dc9c',
  hills: '#e2efbf',
  mountains: '#d0d2c2',
  lake: '#ffffff',
  sea: '#e4f0ff',
  marsh: '#c4d0b0',
  badlands: '#f2b47e',
  blight: '#a6a294',
};

/** The tile model for a hex: its road, river or shore piece, else plain grass or water. */
export function cellTile(c: WorldCell): TilePick {
  if (isWater(c)) return { key: 'hex_water', turns: Math.floor(hash(c.q, c.r, 7) * 6) };
  if (c.river) return (c.road ? crossingTile(c.river, c.road) : riverTile(c.river)) ?? { key: 'hex_river_A', turns: 0 };
  if (c.road) return roadTile(c.road) ?? { key: 'hex_grass', turns: 0 };
  if (c.shore) return shoreTile(c.shore) ?? { key: 'hex_grass', turns: 0 };
  return { key: 'hex_grass', turns: Math.floor(hash(c.q, c.r, 7) * 6) };
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
export class Batch {
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

/** A model to place: `size` is its height when `tall`, else its footprint (at the original 2.4 hex). */
interface Prop {
  pack: PackName;
  key: string;
  size: number;
  tall?: boolean;
  tint?: string;
}

/** Wild tiles sit a little below the provinces, so the playable land stands out. */
export const WILD_Y = -0.08;

/** The hex size the props were sized for; smaller hexes get smaller props. */
const PROP_HEX = 2.4;

const tree = (w: number): Prop => ({ pack: 'env', key: w < 0.3 ? 'trees_A_medium' : w < 0.55 ? 'trees_B_medium' : w < 0.8 ? 'trees_A_large' : 'trees_B_large', size: 1.0 + w * 0.6 });
const single = (w: number): Prop => ({ pack: 'env', key: w < 0.5 ? 'tree_single_A' : 'tree_single_B', size: 0.8 + w * 0.4 });
const mountain = (w: number, s: number): Prop => ({ pack: 'env', key: w < 0.4 ? 'mountain_A' : w < 0.75 ? 'mountain_B_grass_trees' : 'mountain_C_grass', size: s, tall: true });

/**
 * Places hex tiles and their props into batches. `size` is the hex apothem; positions are relative to
 * `origin`, so a province's meshes can sit inside its own group.
 */
export class Painter {
  private readonly tint = new THREE.Color();
  private readonly boxes = new Map<string, THREE.Box3>();
  private readonly scale: number;

  constructor(
    private readonly assets: Assets,
    private readonly size: number,
    private readonly origin = new THREE.Vector3(),
  ) {
    this.scale = size / PROP_HEX;
  }

  private at(q: number, r: number): THREE.Vector3 {
    return hexToWorld(q, r, this.size).sub(this.origin);
  }

  /** The hex's tile, turned to join its road, river or shore to the neighbours. */
  tile(batch: Batch, c: WorldCell, color: string, y: number): void {
    const pick = cellTile(c);
    const o = packItem(this.assets, 'env', pick.key).clone();
    o.scale.set(this.size, 1, this.size);
    o.position.copy(this.at(c.q, c.r)).setY(y);
    o.rotation.y = pick.turns * (Math.PI / 3);
    batch.add(o, this.tint.set(color));
  }

  place(batch: Batch, q: number, r: number, x: number, z: number, p: Prop, rot: number, y: number): void {
    const src = packItem(this.assets, p.pack, p.key);
    let box = this.boxes.get(`${p.pack}/${p.key}`);
    if (!box) {
      box = new THREE.Box3().setFromObject(src);
      this.boxes.set(`${p.pack}/${p.key}`, box);
    }
    const dim = box.getSize(new THREE.Vector3());
    const s = (p.size * this.scale) / Math.max(0.01, p.tall ? dim.y : Math.max(dim.x, dim.z));
    const o = src.clone();
    o.scale.multiplyScalar(s);
    const c = this.at(q, r);
    o.position.set(c.x + x * this.size, y - box.min.y * s, c.z + z * this.size);
    o.rotation.y = rot;
    batch.add(o, this.tint.set(p.tint ?? '#ffffff'));
  }

  /** `n` props spread over the tile (kept inside the hex), so neighbouring tiles of a kind run together. */
  scatter(batch: Batch, q: number, r: number, salt: number, n: number, pick: (w: number, k: number) => Prop, spread: number, y: number): void {
    for (let k = 0; k < n; k++) {
      const a = hash(q, r, salt + k * 3) * Math.PI * 2;
      const d = spread * Math.sqrt(hash(q, r, salt + k * 3 + 1));
      this.place(batch, q, r, Math.cos(a) * d, Math.sin(a) * d, pick(hash(q, r, salt + k * 3 + 2), k), a * 5, y);
    }
  }

  /**
   * The props of a kind of land on one hex. `sparse` thins them out (far away, or 效能模式); `settled`
   * is province land, where farms take the place of the wilder growth. A hex with a road, river or
   * shore keeps only small props, off its middle.
   */
  props(batch: Batch, c: WorldCell, kind: WildKind, y: number, opts: { sparse?: boolean; lite?: boolean; settled?: boolean; tall?: number } = {}): void {
    const { q, r } = c;
    const v = hash(q, r);
    const sparse = !!opts.sparse;
    const busy = !!(c.road || c.river || c.shore);
    if (busy) {
      if (c.river && !c.road && v < 0.5) this.scatter(batch, q, r, 17, 1, () => ({ pack: 'env', key: 'waterplant_A', size: 0.5 }), 0.75, y - 0.2);
      else if (c.road && kind === 'meadow' && v < 0.3) this.scatter(batch, q, r, 41, 1, (w) => single(w), 0.85, y);
      else if (c.shore && !c.road && v < 0.35) this.scatter(batch, q, r, 43, 1, (w) => ({ pack: 'env', key: w < 0.5 ? 'rock_single_B' : 'rock_single_C', size: 0.5 }), 0.4, y);
      return;
    }
    switch (kind) {
      case 'forest':
        // Trees right up to the hex's edges, so neighbouring forest tiles grow into one wood.
        this.place(batch, q, r, 0, 0, tree(0.6 + v * 0.4), v * 9, y);
        this.scatter(batch, q, r, 11, opts.settled ? 1 : sparse ? (opts.lite ? 1 : 2) : 4, (w) => (sparse ? tree(w * 0.55) : tree(w)), 0.86, y);
        break;
      case 'mountains': {
        const big = opts.settled ? 1.8 : 2.6 + v * 0.8 + (opts.tall ?? 0);
        this.place(batch, q, r, (v - 0.5) * 0.3, (hash(q, r, 2) - 0.5) * 0.3, mountain(v, big), v * 9, y);
        if (!sparse) this.scatter(batch, q, r, 13, 1, (w) => mountain(w, 1.5 + w * 0.7), 0.7, y);
        break;
      }
      case 'lake':
        this.scatter(batch, q, r, 17, sparse ? 1 : 2, (_w, k) => ({ pack: 'env', key: k === 0 ? 'waterlily_A' : 'waterplant_B', size: 0.5 }), 0.6, y - 0.2);
        break;
      case 'sea':
        break;
      case 'hills':
        this.place(batch, q, r, 0, 0, { pack: 'env', key: v < 0.4 ? 'hills_A_trees' : v < 0.7 ? 'hills_B' : 'hill_single_C', size: 1.9 }, v * 9, y);
        if (!sparse) this.scatter(batch, q, r, 19, 1, (w) => (w < 0.5 ? single(w) : { pack: 'env', key: 'hill_single_A', size: 1.0 }), 0.75, y);
        break;
      case 'marsh':
        this.scatter(batch, q, r, 23, sparse ? 1 : 3, (w) =>
          w < 0.45 ? { pack: 'env', key: w < 0.2 ? 'waterplant_A' : 'waterplant_B', size: 0.5 } : { pack: 'halloween', key: w < 0.75 ? 'tree_dead_small' : 'tree_dead_medium', size: 1.0 + w * 0.4, tall: true },
          0.7, y,
        );
        break;
      case 'badlands':
        if (v < 0.35) this.place(batch, q, r, 0, 0, { pack: 'env', key: 'mountain_C_grass', size: 1.7, tall: true, tint: '#e6b48c' }, v * 9, y);
        this.scatter(batch, q, r, 29, sparse ? 1 : 2, (w) =>
          w < 0.55 ? { pack: 'env', key: w < 0.25 ? 'rock_single_D' : 'rock_single_B', size: 0.6 + w * 0.6, tint: '#f0c49a' } : { pack: 'halloween', key: 'tree_dead_medium', size: 1.2 + w * 0.4, tall: true },
          0.7, y,
        );
        break;
      case 'blight':
        this.scatter(batch, q, r, 31, sparse ? 1 : 3, (w) =>
          w < 0.45
            ? { pack: 'halloween', key: w < 0.2 ? 'tree_dead_large' : 'tree_dead_medium', size: 1.3 + w * 1.2, tall: true }
            : { pack: 'halloween', key: w < 0.75 ? 'gravestone' : 'grave_A', size: 0.4 },
          0.7, y,
        );
        break;
      case 'meadow':
        if (opts.settled) {
          // Farmland: grain stores and a fence round the fields.
          this.scatter(batch, q, r, 37, sparse ? 1 : 2, (w) => (w < 0.55 ? { pack: 'env', key: 'building_grain', size: 0.8 } : w < 0.8 ? single(w) : { pack: 'env', key: 'fence_wood_straight', size: 0.9 }), 0.6, y);
        } else {
          this.scatter(batch, q, r, 37, sparse ? 1 : 2, (w) => (w < 0.6 ? single(w) : w < 0.85 ? { pack: 'env', key: 'building_grain', size: 0.75 } : { pack: 'env', key: 'rock_single_C', size: 0.45 }), 0.7, y);
        }
        break;
    }
  }
}

/** How high a hex's tile sits: wild land a step down, the water level the same everywhere. */
export function tileY(c: WorldCell): number {
  return c.owner || isWater(c) || c.river || c.shore ? 0 : WILD_Y;
}

/** Builds every hex outside the provinces. `size` is the hex apothem; `lite` thins out the props for 效能模式. */
export function buildWild(assets: Assets, size: number, lite = false): Land {
  const world = getWorld();
  const paint = new Painter(assets, size);
  const ground = new Batch();
  const near = new Batch();
  const far = new Batch();
  for (const c of world.cells) {
    if (c.owner) continue;
    const ring = Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r));
    const y = tileY(c);
    paint.tile(ground, c, GROUND[c.kind], y);
    // The outer rings sit in the haze: fewer props there (and fewer still in 效能模式).
    const sparse = ring > 11 || (lite && ring > 8);
    paint.props(ring > 11 ? far : near, c, c.kind, y, { sparse, lite, tall: Math.max(0, ring - 10) * 0.25 });
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
