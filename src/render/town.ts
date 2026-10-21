import * as THREE from 'three';
import type { Battle } from '../game/battle';
import { GRID_RADIUS, TILE } from '../game/constants';
import { getBuilding } from '../game/data/index';
import { canExpand, isCastleTile, isExpandable, type GameState } from '../game/state';
import type { RaceId } from '../game/types';
import type { Assets } from './assets';
import { HpBar } from './bars';
import { placeModel } from './models';
import { TILE_TOP, type World } from './world';

interface BuildingView {
  uid: number;
  defId: string;
  level: number;
  group: THREE.Group;
  model: THREE.Object3D;
  rubble: THREE.Object3D | null;
  pips: THREE.Group;
  bar: HpBar | null;
  pop: number;
  height: number;
}

const key = (i: number, j: number) => `${i},${j}`;

const slabGeo = new THREE.BoxGeometry(TILE * 0.97, TILE_TOP + 0.3, TILE * 0.97);
slabGeo.translate(0, (TILE_TOP - 0.3) / 2, 0);
const grassTop = new THREE.MeshStandardMaterial({ color: '#93cf6c', roughness: 1 });
const dirtSide = new THREE.MeshStandardMaterial({ color: '#8a6a45', roughness: 1 });
const ownedMats = [dirtSide, dirtSide, grassTop, dirtSide, dirtSide, dirtSide];
const ghostMat = new THREE.MeshStandardMaterial({ color: '#e7f5c8', transparent: true, opacity: 0.32, roughness: 1, depthWrite: false });
const hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
const pipMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#7c4a03', roughness: 0.4, metalness: 0.3 });
const pipGeo = new THREE.OctahedronGeometry(0.2, 0);

function outline(color: string, opacity: number, width = 0.12): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const L = TILE * 0.97;
  for (const [x, z, w, d] of [
    [0, -L / 2, L, width],
    [0, L / 2, L, width],
    [-L / 2, 0, width, L],
    [L / 2, 0, width, L],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), m);
    bar.position.set(x, TILE_TOP + 0.03, z);
    g.add(bar);
  }
  return g;
}

function plusMarker(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.28), m);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 1.1), m);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 32), m);
  ring.rotation.x = -Math.PI / 2;
  g.add(a, b, ring);
  g.position.y = TILE_TOP + 0.05;
  // Face the fixed camera so the cross reads as "+".
  g.rotation.y = Math.atan2(0.57, 0.82);
  return g;
}

export class TownView {
  private readonly slabs = new Map<string, THREE.Mesh>();
  private readonly frames = new Map<string, THREE.Group>();
  private readonly pluses = new Map<string, THREE.Group>();
  private readonly views = new Map<string, BuildingView>();
  private readonly hover = outline('#ffffff', 0.9);
  private readonly selected = outline('#fde047', 1, 0.2);
  private race: RaceId = 'human';
  private time = 0;
  onBuilt: (x: number, z: number) => void = () => {};

  constructor(
    private readonly world: World,
    private readonly assets: Assets,
  ) {
    for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i++) {
      for (let j = -GRID_RADIUS; j <= GRID_RADIUS; j++) {
        const slab = new THREE.Mesh(slabGeo, ownedMats);
        slab.position.set(i * TILE, 0, j * TILE);
        slab.receiveShadow = true;
        slab.userData = { i, j };
        world.tiles.add(slab);
        this.slabs.set(key(i, j), slab);
        const frame = outline('#ffffff', 0.25, 0.06);
        frame.position.copy(slab.position);
        world.tiles.add(frame);
        this.frames.set(key(i, j), frame);
        const plus = plusMarker();
        plus.position.x = i * TILE;
        plus.position.z = j * TILE;
        world.tiles.add(plus);
        this.pluses.set(key(i, j), plus);
      }
    }
    this.hover.visible = false;
    this.selected.visible = false;
    world.tiles.add(this.hover, this.selected);
  }

  get pickables(): THREE.Object3D[] {
    return [...this.slabs.values()].filter((s) => s.visible);
  }

  pickTile(x: number, y: number): { i: number; j: number } | null {
    const hit = this.world.raycast(x, y, this.pickables);
    if (!hit) return null;
    const { i, j } = hit.object.userData as { i: number; j: number };
    return { i, j };
  }

  setHover(t: { i: number; j: number } | null): void {
    this.hover.visible = !!t;
    if (t) this.hover.position.set(t.i * TILE, 0, t.j * TILE);
  }

  setSelected(t: { i: number; j: number } | null): void {
    this.selected.visible = !!t;
    if (t) this.selected.position.set(t.i * TILE, 0, t.j * TILE);
  }

  /** Bring tiles and buildings in line with the game state. */
  sync(state: GameState, animate = true): void {
    const raceChanged = this.race !== state.race;
    this.race = state.race;
    for (const t of state.tiles) {
      const k = key(t.i, t.j);
      const slab = this.slabs.get(k)!;
      const expandable = !t.owned && isExpandable(state, t.i, t.j);
      if (t.owned) slab.material = ownedMats;
      const plus = this.pluses.get(k)!;
      // Only advertise tiles that can be bought now (or once gold allows).
      const check = expandable ? canExpand(state, t.i, t.j) : null;
      const reachable = !!check && (check.ok || check.reason === '金幣不足');
      plus.visible = reachable && state.phase === 'prep';
      ((plus.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(check?.ok ? '#ffffff' : '#d6d3d1');
      slab.visible = t.owned || reachable;
      if (!t.owned) slab.material = reachable ? ghostMat : hiddenMat;
      this.frames.get(k)!.visible = !t.owned;

      const wantCastle = isCastleTile(t.i, t.j);
      const defId = wantCastle ? 'castle' : t.building?.defId;
      const level = wantCastle ? state.castleLevel : t.building?.level ?? 0;
      const uid = wantCastle ? 0 : t.building?.uid ?? -1;
      const cur = this.views.get(k);
      if (!defId) {
        if (cur) this.removeView(k);
        continue;
      }
      if (cur && cur.defId === defId && cur.uid === uid && cur.level === level && !raceChanged) continue;
      const isNew = !cur || cur.uid !== uid || cur.defId !== defId;
      if (cur) this.removeView(k);
      this.addView(k, t.i, t.j, defId, level, uid, animate && !raceChanged, isNew);
    }
  }

  private addView(k: string, i: number, j: number, defId: string, level: number, uid: number, animate: boolean, isNew: boolean): void {
    const group = new THREE.Group();
    group.position.set(i * TILE, TILE_TOP, j * TILE);
    let model: THREE.Object3D;
    if (defId === 'castle') {
      model = placeModel(this.assets, { pack: 'buildings', key: 'castle', scale: 1.15 }, this.race, 0.96);
      model.scale.setScalar(0.86 + level * 0.035);
    } else {
      const def = getBuilding(defId);
      model = placeModel(this.assets, def.model, this.race, 0.82);
      model.scale.setScalar(0.88 + level * 0.06);
    }
    model.rotation.y = Math.PI / 2;
    group.add(model);
    const pips = new THREE.Group();
    for (let n = 0; n < level; n++) {
      const p = new THREE.Mesh(pipGeo, pipMat);
      p.position.set(-TILE * 0.38 + n * 0.45, 0.35, TILE * 0.4);
      p.castShadow = true;
      pips.add(p);
    }
    group.add(pips);
    const box = new THREE.Box3().setFromObject(model);
    const view: BuildingView = {
      uid,
      defId,
      level,
      group,
      model,
      rubble: null,
      pips,
      bar: null,
      pop: animate ? 0 : 1,
      height: box.max.y - box.min.y,
    };
    this.world.buildings.add(group);
    this.views.set(k, view);
    if (animate) this.onBuilt(i * TILE, j * TILE);
    void isNew;
  }

  private removeView(k: string): void {
    const v = this.views.get(k);
    if (!v) return;
    this.world.buildings.remove(v.group);
    this.views.delete(k);
  }

  private byUid(uid: number): BuildingView | undefined {
    for (const v of this.views.values()) if (v.uid === uid) return v;
    return undefined;
  }

  /** Top of a building in world space (for projectiles and effects). */
  buildingTop(uid: number): number {
    return (this.byUid(uid)?.height ?? 3) + TILE_TOP;
  }

  beginBattle(): void {
    for (const v of this.views.values()) {
      v.bar = new HpBar('building', v.uid === 0 ? 2.6 : 1.8, this.world.camera);
      v.bar.group.position.set(0, v.height + 0.6, 0);
      v.bar.group.visible = false;
      v.group.add(v.bar.group);
    }
  }

  updateBattle(battle: Battle): void {
    for (const b of battle.buildings) {
      const v = this.byUid(b.uid);
      if (!v) continue;
      if (v.bar) {
        v.bar.set(b.hp / b.maxHp);
        v.bar.group.visible = b.hp < b.maxHp && !b.destroyed;
      }
      if (b.destroyed && !v.rubble) {
        v.model.visible = false;
        v.pips.visible = false;
        v.rubble = placeModel(this.assets, { pack: 'env', key: 'building_destroyed' }, null, 0.8);
        v.group.add(v.rubble);
      }
    }
  }

  endBattle(): void {
    for (const v of this.views.values()) {
      if (v.bar) v.group.remove(v.bar.group);
      v.bar = null;
      if (v.rubble) {
        v.group.remove(v.rubble);
        v.rubble = null;
        v.model.visible = true;
        v.pips.visible = true;
        v.pop = 0;
      }
    }
  }

  /** Flash a building being hit. */
  shake(uid: number): void {
    const v = this.byUid(uid);
    if (v) v.pop = Math.min(v.pop, 0.85);
  }

  update(dt: number): void {
    this.time += dt;
    for (const v of this.views.values()) {
      if (v.pop < 1) {
        v.pop = Math.min(1, v.pop + dt * 2.5);
        const t = v.pop;
        const s = 1 + Math.sin(t * Math.PI) * 0.12 * (1 - t) - (1 - t) * 0.25;
        v.group.scale.set(s, s, s);
      } else v.group.scale.setScalar(1);
      v.pips.children.forEach((p, n) => {
        p.rotation.y = this.time * 1.5 + n;
        p.position.y = 0.35 + Math.sin(this.time * 2 + n) * 0.05;
      });
    }
    for (const p of this.pluses.values()) {
      if (!p.visible) continue;
      const s = 1 + Math.sin(this.time * 3) * 0.06;
      p.scale.set(s, 1, s);
    }
  }
}
