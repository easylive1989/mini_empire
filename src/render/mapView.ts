import * as THREE from 'three';
import { isAttackable, isConquered, type CampaignState } from '../game/campaign/campaign';
import type { TerrainId } from '../game/campaign/terrain';
import { HEX_DIRS } from '../game/campaign/hexTiles';
import { REGIONS, TERRITORIES, type Territory } from '../game/campaign/territories';
import { getWorld, provinceCentre, WORLD_SCALE } from '../game/campaign/world';
import { FACTIONS } from '../game/data/factions';
import { RACE_MAP } from '../game/data/index';
import type { RaceId } from '../game/types';
import { packItem, type Assets, type PackName } from './assets';
import { PRESETS, type Quality } from './quality';
import { buildingMaterial } from './recolor';
import { Batch, buildWild, Painter, type Land } from './mapTerrain';
import { addLights, clamp01, ease, hexToWorld, puffTexture, SoftParticles } from './sceneKit';
import type { ViewInsets } from './world';

export type TerritoryStatus = 'liberated' | 'attackable' | 'occupied';

/** Hex apothem of one fine hex of the map (a territory is a province of several). */
const SIZE = 1.6;
const HEX_R = SIZE * 1.1547;

const TINT: Record<TerrainId, string> = {
  plains: '#b5e3a0',
  town: '#c8e0b0',
  forest: '#9fd08a',
  hills: '#c4e3a0',
  swamp: '#8fa880',
  mountain: '#c9cec4',
  badlands: '#e0a070',
  mine: '#c0b8a0',
  graveyard: '#9aa498',
  holy: '#d8f5c8',
  river: '#b5e3a0',
  capital: '#a08680',
};
const OCCUPIED_SHADE = new THREE.Color('#4a3550');

/** One placed model: landmark buildings get the race colours once liberated, the dark ones before. */
type Item = { pack: PackName; key: string; x: number; z: number; size: number; rot?: number; landmark?: boolean; tall?: boolean };
const I = (pack: PackName, key: string, x: number, z: number, size: number, rot = 0, tall = false): Item => ({ pack, key, x, z, size, rot, tall });
const L = (key: string, x: number, z: number, size: number, rot = 0): Item => ({ pack: 'buildings', key, x, z, size, rot, landmark: true, tall: true });

const DECOR: Record<string, Item[]> = {
  t_refuge: [L('castle', 0, -0.1, 2.3), I('env', 'tree_single_A', 1.5, 0.9, 1.1), I('env', 'tree_single_B', -1.5, 0.7, 1.1), L('home_A', 1.1, -1, 0.9, 0.6)],
  t_wheat: [L('windmill', 0.7, -0.5, 1.7), I('env', 'building_grain', -0.8, 0.5, 1.2), I('env', 'building_grain', 0.1, 1.2, 1.2), I('env', 'tree_single_A', -1.2, -0.9, 1)],
  t_greystone: [L('home_A', -0.8, 0.2, 1.1, 0.4), L('home_B', 0.7, -0.6, 1.1, -0.3), L('well', 0.4, 0.9, 0.7), I('env', 'rock_single_C', -1, -1, 0.7)],
  t_caravan: [L('tavern', -0.5, -0.2, 1.4, 0.3), L('market', 0.9, 0.6, 1.1, -0.4), I('env', 'crate_A_big', -0.2, 1.2, 0.45), I('env', 'barrel', 0.2, 1.3, 0.35)],
  t_ravenhold: [L('tower_A', 0, -0.4, 1.9), L('tower_B', 1.1, 0.6, 1.5), I('env', 'wall_straight', -0.9, 0.7, 1.1, 0.5), I('env', 'hill_single_A', -1.3, -0.8, 1.1)],
  t_whisper: [I('env', 'trees_A_large', -0.8, 0.3, 1.9), I('env', 'trees_B_large', 0.7, -0.6, 1.9), I('env', 'trees_A_medium', 0.6, 1, 1.4), I('env', 'trees_B_medium', -0.5, -1.1, 1.4)],
  t_goblincave: [I('env', 'hills_A_trees', -0.5, -0.4, 2.4), L('tower_catapult', 0.9, 0.7, 1.3), I('env', 'tent', -0.6, 1.1, 0.7, 0.6)],
  t_mushroom: [I('halloween', 'tree_dead_large', -0.6, -0.4, 1.5, 0, true), I('env', 'waterlily_A', 0.7, 0.5, 0.9), I('env', 'waterplant_A', -0.4, 0.9, 0.8), I('env', 'waterplant_B', 0.9, -0.8, 0.8), I('halloween', 'tree_dead_small', 1.2, 0.2, 0.9, 0, true)],
  t_fanghills: [I('env', 'hill_single_A', -0.6, -0.5, 1.8), I('env', 'hill_single_C', 0.8, 0.2, 1.6), I('dungeon', 'chest_gold', -0.4, 0.9, 0.55), I('dungeon', 'coin_stack_large', 0.1, 1.1, 0.4)],
  t_ember: [I('env', 'rock_single_A', -0.7, -0.4, 0.9), I('env', 'rock_single_D', 0.8, 0.5, 0.8), I('halloween', 'tree_dead_medium', 0.4, -0.9, 1.3, 0, true), I('halloween', 'skull', -0.2, 0.8, 0.3)],
  t_arena: [I('env', 'building_stage_A', 0, -0.1, 2.2), I('env', 'weaponrack', -1.2, 0.8, 0.5), I('env', 'target', 1.2, 0.8, 0.5)],
  t_frostfang: [I('env', 'mountain_A', -0.2, -0.3, 3.0), I('env', 'mountain_C_grass', 1.1, 0.7, 1.8), I('env', 'rock_single_E', -1.1, 0.9, 0.6)],
  t_oldvein: [L('mine', 0.5, 0.4, 1.4), I('env', 'mountain_A', -0.7, -0.6, 2.2), I('env', 'resource_stone', 1, -0.7, 0.5), I('env', 'wheelbarrow', -0.4, 1.1, 0.5)],
  t_royalcamp: [I('env', 'tent', -0.8, -0.4, 1.0, 0.4), I('env', 'tent', 0.9, -0.6, 1.0, -0.4), I('dungeon', 'sword_shield_gold', 0.1, 0.5, 0.9, 0, true), I('dungeon', 'banner_patternA_blue', -0.9, 0.9, 1.1, 0, true)],
  t_wailing: [I('halloween', 'crypt', 0, -0.4, 1.9), I('halloween', 'gravestone', -1, 0.6, 0.45), I('halloween', 'grave_A', 0.9, 0.7, 0.5), I('halloween', 'tree_dead_medium', 1.2, -0.7, 1.4, 0, true)],
  t_spring: [L('church', 0, -0.3, 1.6), I('dungeon', 'pillar_decorated', 1, 0.8, 1.0, 0, true), I('env', 'tree_single_A', -1.2, 0.7, 1.0)],
  t_bonemarsh: [I('halloween', 'tree_dead_large', -0.5, -0.5, 1.6, 0, true), I('env', 'waterlily_A', 0.7, 0.4, 0.9), I('halloween', 'ribcage', 0.4, -0.9, 0.6), I('halloween', 'skull', -0.6, 0.9, 0.3)],
  t_oblivion: [L('tower_B', 0.9, -0.9, 1.5), I('env', 'waterplant_A', -0.9, 0.8, 0.7)],
  t_capital: [L('castle', 0, -0.2, 3.0), I('env', 'wall_straight', -1.3, 0.9, 1.3, 0.5), I('env', 'wall_straight', 1.3, 0.9, 1.3, -0.5), I('dungeon', 'banner_patternA_red', 0, 1.3, 1.0, 0, true)],
};

interface Node {
  t: Territory;
  group: Group;
  tiles: THREE.Mesh[];
  tileMats: THREE.MeshStandardMaterial[];
  freeObjs: THREE.Object3D[];
  darkObjs: THREE.Object3D[];
  flag: THREE.Group;
  flagCloth: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  puffs: THREE.Sprite[];
  status: TerritoryStatus;
  /** 0 = occupied look, 1 = liberated look (animated during a conquest). */
  light: number;
  conquest: number;
  elev: number;
}
type Group = THREE.Group;

const sizeCache = new Map<THREE.Object3D, THREE.Vector3>();
function nativeSize(obj: THREE.Object3D): { size: THREE.Vector3; box: THREE.Box3 } {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  let size = sizeCache.get(obj);
  if (!size) {
    size = box.getSize(new THREE.Vector3());
    sizeCache.set(obj, size);
  }
  return { size, box };
}

export class MapView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.5, 300);
  private readonly root = new THREE.Group();
  private readonly nodes = new Map<string, Node>();
  private readonly particles = new SoftParticles();
  private readonly lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight };
  private readonly capitalGlow = new THREE.PointLight('#ff3b3b', 30, 14, 1.6);
  private land: Land | null = null;
  private landLite: boolean | null = null;
  /** Where each named wild region's label sits: the middle of its cells. */
  private readonly regionCenters = REGIONS.map((g) => {
    const c = new THREE.Vector3();
    for (const [q, r] of g.cells) c.add(hexToWorld(q * WORLD_SCALE, r * WORLD_SCALE, SIZE));
    return c.divideScalar(g.cells.length);
  });
  private readonly fog = new THREE.Fog('#1d1622', 60, 140);
  /** Centre of the realm, and its half-extent on the ground (x, z). */
  private readonly realm = { center: new THREE.Vector3(), half: new THREE.Vector2(1, 1) };
  private race: RaceId | null = null;
  private hover: string | null = null;
  private selected: string | null = null;
  private time = 0;
  private emberTimer = 0;
  private width = 1;
  private height = 1;
  private progress = 0;
  private shownProgress = 0;
  /** Share of the miasma puffs drawn (fewer on the light preset: they are large overlapping sprites). */
  private puffShare = 1;
  /** Camera mode: the interactive map pose, a slow orbit (title) or a fly-in from above. */
  mode: 'map' | 'orbit' = 'map';
  private fly = 1;
  private flyDuration = 1;
  private readonly basePose = { target: new THREE.Vector3(0.4, 0, 0.8), dist: 40, pitch: 56, yaw: 0 };
  /** The player's own view on the map: a pan on the ground and a zoom factor (wheel and drag). */
  private readonly pan = new THREE.Vector2();
  private zoom = 1;
  private shownZoom = 1;
  private readonly shownPan = new THREE.Vector2();

  constructor(private readonly assets: Assets) {
    this.scene.add(this.root, this.particles.points);
    this.scene.fog = this.fog;
    this.lights = addLights(this.scene, 64);
    this.lights.sun.position.set(-24, 50, 30);
    this.lights.sun.shadow.camera.far = 180;
    this.capitalGlow.position.set(0, 3, 0);
    this.scene.add(this.capitalGlow);
    // The realm's extent on the ground (every province hex), for the camera.
    const pts = getWorld()
      .cells.filter((c) => c.owner)
      .map((c) => hexToWorld(c.q, c.r, SIZE));
    const box = new THREE.Box3().setFromPoints(pts);
    box.getCenter(this.realm.center);
    this.realm.half.set((box.max.x - box.min.x) / 2 + HEX_R, (box.max.z - box.min.z) / 2 + HEX_R);
    this.basePose.target.copy(this.realm.center);
  }

  private territoryPos(t: Territory): THREE.Vector3 {
    const c = provinceCentre(t);
    return hexToWorld(c.q, c.r, SIZE);
  }

  /** (Re)builds the land; the light preset gets fewer props far out. */
  private ensureLand(lite: boolean): void {
    if (this.landLite === lite) return;
    if (this.land) {
      this.root.remove(this.land.group);
      for (const m of this.land.group.children as THREE.Mesh[]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    }
    this.land = buildWild(this.assets, SIZE, lite);
    this.landLite = lite;
    this.root.add(this.land.group);
    this.moodKey = -1;
  }

  // ---------------------------------------------------------------- construction

  private clone(pack: PackName, key: string): THREE.Object3D {
    const o = packItem(this.assets, pack, key).clone();
    o.position.set(0, 0, 0);
    return o;
  }

  private place(item: Item, race: RaceId | 'shadow', parent: THREE.Object3D): THREE.Object3D {
    const src = packItem(this.assets, item.pack, item.key);
    const { size, box } = nativeSize(src);
    const extent = item.tall ? size.y : Math.max(size.x, size.z);
    const s = item.size / Math.max(extent, 0.01);
    const o = this.clone(item.pack, item.key);
    if (item.pack === 'buildings') {
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (mesh.isMesh) mesh.material = buildingMaterial(mesh.material as THREE.Material, race);
      });
    }
    const holder = new THREE.Group();
    o.scale.setScalar(s);
    o.position.y = -box.min.y * s;
    holder.add(o);
    holder.position.set(item.x * (SIZE / 2.4), 0, item.z * (SIZE / 2.4));
    holder.rotation.y = item.rot ?? 0;
    parent.add(holder);
    return holder;
  }

  private makeFlag(): { flag: THREE.Group; cloth: THREE.MeshStandardMaterial } {
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), new THREE.MeshStandardMaterial({ color: '#5b3a1e' }));
    pole.position.y = 0.8;
    pole.castShadow = true;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.75, -0.2);
    shape.lineTo(0, -0.45);
    shape.closePath();
    const cloth = new THREE.MeshStandardMaterial({ color: '#888888', side: THREE.DoubleSide, emissive: '#000000' });
    const c = new THREE.Mesh(new THREE.ShapeGeometry(shape), cloth);
    c.position.set(0.03, 1.55, 0);
    c.castShadow = true;
    flag.add(pole, c);
    return { flag, cloth };
  }

  private build(race: RaceId): void {
    for (const n of this.nodes.values()) this.root.remove(n.group);
    this.nodes.clear();
    const world = getWorld();
    for (const t of TERRITORIES) {
      const group = new THREE.Group();
      group.position.copy(this.territoryPos(t));
      const elev = 0;
      // The province: its hexes (roads, rivers and shores joined up) and the farms, woods or rocks of
      // its land, merged into meshes of its own so the whole province darkens and lights up together.
      const paint = new Painter(this.assets, SIZE, group.position.clone());
      const ground = new Batch();
      const props = new Batch();
      for (const c of world.provinces.get(t.id)!) {
        paint.tile(ground, c, TINT[t.terrain], 0);
        if (!c.centre) paint.props(props, c, c.kind, 0, { settled: true });
      }
      const tiles = [...ground.build({ cast: false, receive: true }), ...props.build({ cast: true, receive: true })];
      const tileMats: THREE.MeshStandardMaterial[] = [];
      for (const mesh of tiles) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.userData.base = new THREE.Color('#ffffff');
        mesh.userData.territory = t.id;
        tileMats.push(mat);
        group.add(mesh);
      }

      const deco = new THREE.Group();
      deco.position.y = elev;
      group.add(deco);
      const freeObjs: THREE.Object3D[] = [];
      const darkObjs: THREE.Object3D[] = [];
      for (const item of DECOR[t.id] ?? []) {
        if (item.landmark) {
          freeObjs.push(this.place(item, race, deco));
          darkObjs.push(this.place(item, 'shadow', deco));
        } else this.place(item, race, deco);
      }

      const { flag, cloth } = this.makeFlag();
      flag.position.set(-1.45 * (SIZE / 2.4), 0, -0.75 * (SIZE / 2.4));
      deco.add(flag);

      const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(this.outline(t.id, group.position), ringMat);
      ring.position.y = 0.05;
      ring.renderOrder = 3;
      group.add(ring);

      const puffs: THREE.Sprite[] = [];
      const count = t.capital ? 12 : 6;
      for (let k = 0; k < count; k++) {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: puffTexture(), color: t.capital ? '#3b0d2e' : '#1e1028', transparent: true, opacity: 0, depthWrite: false }),
        );
        sp.userData.phase = Math.random() * Math.PI * 2;
        sp.userData.radius = 0.4 + Math.random() * SIZE * 2;
        sp.userData.height = 0.9 + Math.random() * (t.capital ? 2.5 : 1.1);
        sp.userData.scale = (t.capital ? 2.6 : 2) + Math.random() * 1.4;
        sp.renderOrder = 4;
        group.add(sp);
        puffs.push(sp);
      }

      this.root.add(group);
      this.nodes.set(t.id, {
        t,
        group,
        tiles,
        tileMats,
        freeObjs,
        darkObjs,
        flag,
        flagCloth: cloth,
        ring,
        ringMat,
        puffs,
        status: 'occupied',
        light: 0,
        conquest: 1,
        elev,
      });
      if (t.capital) this.capitalGlow.position.set(group.position.x, 3.2, group.position.z);
    }
    this.race = race;
  }

  /** A band just inside the edge of a province, where it meets other land: its border. */
  private outline(id: string, origin: THREE.Vector3): THREE.BufferGeometry {
    const world = getWorld();
    const pos: number[] = [];
    const outer = HEX_R * 0.98;
    const inner = outer - 0.16;
    for (const c of world.provinces.get(id)!) {
      const at = hexToWorld(c.q, c.r, SIZE).sub(origin);
      HEX_DIRS.forEach(([dq, dr], d) => {
        if (world.at(c.q + dq, c.r + dr)?.owner === id) return;
        // The edge facing direction d runs between the corners 30° either side of it.
        const corner = (deg: number, rad: number) => [at.x + Math.cos((deg * Math.PI) / 180) * rad, at.z + Math.sin((deg * Math.PI) / 180) * rad];
        const [o0, o1, i0, i1] = [corner(d * 60 - 30, outer), corner(d * 60 + 30, outer), corner(d * 60 - 30, inner), corner(d * 60 + 30, inner)];
        for (const [x, z] of [o0, o1, i1, o0, i1, i0]) pos.push(x, 0, z);
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }

  // ---------------------------------------------------------------- state

  /** Applies the campaign state; `null` shows the darkened world of the title screen. */
  setCampaign(c: CampaignState | null, race: RaceId): void {
    if (this.race !== race) this.build(race);
    const raceColor = RACE_MAP.get(race)!.color;
    let liberated = 0;
    for (const n of this.nodes.values()) {
      const t = n.t;
      const status: TerritoryStatus = c
        ? isConquered(c, t.id)
          ? 'liberated'
          : isAttackable(c, t.id)
            ? 'attackable'
            : 'occupied'
        : t.start
          ? 'liberated'
          : 'occupied';
      n.status = status;
      if (status === 'liberated') liberated++;
      if (n.conquest >= 1) n.light = status === 'liberated' ? 1 : 0;
      n.flagCloth.color.set(status === 'liberated' ? raceColor : t.faction ? FACTIONS[t.faction].color : raceColor);
      this.applyLook(n);
    }
    this.progress = liberated / this.nodes.size;
  }

  /** Screen positions (CSS px) of the named wild regions' labels, in `REGIONS` order. */
  regionLabelPositions(): { x: number; y: number }[] {
    return this.regionCenters.map((c) => {
      const v = c.clone().setY(0.6).project(this.camera);
      return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
    });
  }

  /** Plays the liberation animation of one territory (call after setCampaign). */
  playConquest(id: string): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.conquest = 0;
    n.light = 0;
    this.applyLook(n);
  }

  private applyLook(n: Node): void {
    const k = n.light;
    for (const m of n.tileMats) m.color.copy(OCCUPIED_SHADE).lerp(m.userData.base as THREE.Color, 0.38 + 0.62 * k);
    for (const o of n.freeObjs) o.visible = k >= 0.5;
    for (const o of n.darkObjs) o.visible = k < 0.5;
  }

  setHover(id: string | null): void {
    this.hover = id;
  }

  setSelected(id: string | null): void {
    this.selected = id;
  }

  statusOf(id: string): TerritoryStatus {
    return this.nodes.get(id)?.status ?? 'occupied';
  }

  // ---------------------------------------------------------------- camera

  resize(w: number, h: number, insets: ViewInsets): void {
    this.width = w;
    this.height = h;
    this.camera.aspect = w / h;
    const availW = Math.max(200, w - insets.left - insets.right);
    const availH = Math.max(200, h - insets.top - insets.bottom);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    // Frame the realm (its depth foreshortened by the pitch); the wild land around it fills the rest.
    const spanW = this.realm.half.x * 2;
    const spanH = this.realm.half.y * 2 * Math.sin(THREE.MathUtils.degToRad(this.basePose.pitch)) + 3;
    const dH = (spanH * h) / (availH * 2 * tan);
    const dW = (spanW * h) / (availW * 2 * tan);
    this.basePose.dist = Math.max(dH, dW) * 0.98;
    const dx = insets.left + availW / 2 - w / 2;
    const dy = insets.top + availH / 2 - h / 2;
    this.camera.setViewOffset(w, h, -dx, -dy, w, h);
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(h, this.camera.fov);
  }

  /** Swoop down from high above onto the map pose. */
  flyIn(duration: number): void {
    this.fly = 0;
    this.flyDuration = duration;
    this.resetView();
  }

  /** Back to the whole realm in view. */
  resetView(): void {
    this.pan.set(0, 0);
    this.zoom = 1;
  }

  /** Zooms in (negative steps) or out, between a close look and a little past the whole realm. */
  zoomBy(steps: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.pow(1.12, steps), 0.55, 1.3);
    this.clampPan();
  }

  /** Drags the map by a screen-space offset in CSS pixels (the ground follows the pointer). */
  panBy(dx: number, dy: number): void {
    const dist = this.basePose.dist * this.zoom;
    const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / this.height;
    const pitch = THREE.MathUtils.degToRad(this.basePose.pitch);
    this.pan.x -= dx * perPx;
    this.pan.y -= (dy * perPx) / Math.sin(pitch);
    this.clampPan();
  }

  /** Keeps the view over the realm: the closer the zoom, the farther it may wander. */
  private clampPan(): void {
    const slack = 0.35 + (1.3 - this.zoom) * 0.6;
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -this.realm.half.x * slack, this.realm.half.x * slack);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -this.realm.half.y * slack, this.realm.half.y * slack);
  }

  private updateCamera(dt: number): void {
    const p = this.basePose;
    let yaw = p.yaw + Math.sin(this.time * 0.15) * 0.04;
    let pitch = THREE.MathUtils.degToRad(p.pitch);
    // The player's pan and zoom ease in; the title orbit and the fly-in ignore them.
    const k = Math.min(1, dt * 10);
    const user = this.mode === 'map' && this.fly >= 1;
    this.shownZoom += ((user ? this.zoom : 1) - this.shownZoom) * k;
    this.shownPan.lerp(user ? this.pan : new THREE.Vector2(), k);
    let dist = p.dist * this.shownZoom;
    if (this.mode === 'orbit') {
      yaw = this.time * 0.05;
      pitch = THREE.MathUtils.degToRad(42);
      dist = p.dist * 1.1;
    }
    if (this.fly < 1) {
      const k = ease(this.fly);
      pitch = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(84), pitch, k);
      dist = THREE.MathUtils.lerp(dist * 1.9, dist, k);
      yaw = THREE.MathUtils.lerp(-0.6, yaw, k);
    }
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const target = p.target.clone().add(new THREE.Vector3(this.shownPan.x, 0, this.shownPan.y));
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.camera.lookAt(target);
    // The land past the realm fades into the haze; the realm itself stays clear.
    this.fog.near = dist * 0.92;
    this.fog.far = dist * 1.75;
  }

  // ---------------------------------------------------------------- picking & labels

  pick(clientX: number, clientY: number): string | null {
    const ndc = new THREE.Vector2((clientX / this.width) * 2 - 1, -(clientY / this.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const meshes = [...this.nodes.values()].flatMap((n) => n.tiles);
    const hit = ray.intersectObjects(meshes, false)[0];
    return (hit?.object.userData.territory as string | undefined) ?? null;
  }

  /** Screen positions (CSS px) of the territory name labels. */
  labelPositions(): { id: string; x: number; y: number }[] {
    const out: { id: string; x: number; y: number }[] = [];
    for (const n of this.nodes.values()) {
      const p = n.group.position.clone();
      p.y = n.elev + 0.1;
      // Just below the centre hex, so the name does not hide the town.
      p.z += SIZE * 1.9;
      const v = p.project(this.camera);
      out.push({ id: n.t.id, x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height });
    }
    return out;
  }

  /** Screen position of a territory centre (for effects anchored in the UI). */
  centerOnScreen(id: string): { x: number; y: number } | null {
    const n = this.nodes.get(id);
    if (!n) return null;
    const v = n.group.position.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  // ---------------------------------------------------------------- frame update

  setQuality(q: Quality): void {
    this.puffShare = PRESETS[q].puffs;
    this.ensureLand(q === 'low');
  }

  update(dt: number): void {
    this.time += dt;
    if (this.fly < 1) this.fly = Math.min(1, this.fly + dt / this.flyDuration);
    this.updateCamera(dt);

    // The world brightens as territories are liberated.
    this.shownProgress += (this.progress - this.shownProgress) * Math.min(1, dt * 1.5);
    const p = clamp01(this.shownProgress * 1.4);
    this.applyMood(p);

    const raceColor = this.race ? RACE_MAP.get(this.race)!.color : '#ffffff';
    this.emberTimer -= dt;
    const emit = this.emberTimer <= 0;
    if (emit) this.emberTimer = 0.12;
    for (const n of this.nodes.values()) {
      if (n.conquest < 1) {
        const before = n.conquest;
        n.conquest = Math.min(1, n.conquest + dt / 2.6);
        n.light = clamp01((n.conquest - 0.25) / 0.45);
        if (before < 0.4 && n.conquest >= 0.4) {
          const at = n.group.position.clone().setY(n.elev + 1);
          this.particles.burst(at, '#fde68a', 70, 5, 0.55, 1.6, 2.5, 5);
          this.particles.burst(at, raceColor, 40, 3, 0.45, 1.4, 3, 4);
          n.flagCloth.color.set(raceColor);
        }
        this.applyLook(n);
        // Liberated landmarks pop up.
        const pop = n.conquest > 0.4 ? 1 + Math.sin(clamp01((n.conquest - 0.4) / 0.3) * Math.PI) * 0.18 : 1;
        for (const o of n.freeObjs) o.scale.setScalar(pop);
      }
      // Dark miasma over occupied land.
      const dark = 1 - n.light;
      const shown = Math.ceil(n.puffs.length * this.puffShare);
      n.puffs.forEach((sp, k) => {
        const ph = sp.userData.phase + this.time * (0.25 + k * 0.03);
        const rise = n.conquest < 1 ? (1 - dark) * 2.5 : 0;
        sp.position.set(Math.cos(ph) * sp.userData.radius, n.elev + sp.userData.height + Math.sin(ph * 1.7) * 0.15 + rise, Math.sin(ph) * sp.userData.radius);
        sp.scale.setScalar(sp.userData.scale);
        (sp.material as THREE.SpriteMaterial).opacity = (n.t.capital ? 0.72 : 0.5) * dark;
        sp.visible = dark > 0.01 && k < shown;
      });
      if (emit && dark > 0.5 && Math.random() < (n.t.capital ? 0.9 : 0.12)) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * SIZE * 3;
        const at = n.group.position.clone().add(new THREE.Vector3(Math.cos(a) * r, n.elev + 0.3, Math.sin(a) * r));
        this.particles.emit(at, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.8 + Math.random(), (Math.random() - 0.5) * 0.3), new THREE.Color(n.t.capital ? '#ff4d4d' : '#ff8a3d'), 0.22, 2.4, -0.1);
      }
      // Outline: attackable pulses gold, selection is white.
      const sel = this.selected === n.t.id;
      const hov = this.hover === n.t.id;
      let color = '#ffffff';
      let opacity = 0;
      if (n.status === 'attackable') {
        color = '#facc15';
        opacity = 0.55 + Math.sin(this.time * 3.2) * 0.3;
      } else if (n.status === 'liberated') {
        color = raceColor;
        opacity = 0.45;
      } else if (n.t.faction) {
        // Occupied land shows whose it is.
        color = FACTIONS[n.t.faction].color;
        opacity = 0.4;
      }
      if (hov) opacity = Math.max(opacity, 0.75);
      if (sel) {
        color = '#ffffff';
        opacity = 0.95;
      }
      n.ringMat.color.set(color);
      n.ringMat.opacity = opacity;
      const lift = sel ? 0.3 : hov ? 0.15 : 0;
      n.group.position.y += (lift - n.group.position.y) * Math.min(1, dt * 10);
      n.flag.rotation.y = Math.sin(this.time * 2 + n.t.q) * 0.15;
    }
    const cap = [...this.nodes.values()].find((n) => n.t.capital);
    this.capitalGlow.intensity = cap && cap.light < 0.5 ? 26 + Math.sin(this.time * 2.3) * 8 : 0;
    this.particles.update(dt);
  }

  private moodKey = -1;
  private applyMood(p: number): void {
    const key = Math.round(p * 40);
    if (key === this.moodKey) return;
    this.moodKey = key;
    const lerp = (a: string, b: string) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), p).getHexString();
    // No sky or sea around the realm: the land runs on and fades into a haze, dusky while the demon
    // lord holds the realm, warm parchment as it is won back.
    const haze = lerp('#3a2f3c', '#d8cca6');
    this.scene.background = new THREE.Color(haze);
    this.fog.color.set(haze);
    for (const m of this.land?.materials ?? []) m.color.set(lerp('#b3aabb', '#ffffff'));
    this.lights.hemi.color.set(lerp('#c4b8dc', '#f4fbff'));
    this.lights.hemi.groundColor.set(lerp('#4a4050', '#6d8a4e'));
    this.lights.hemi.intensity = 1.25 + 0.4 * p;
    this.lights.sun.color.set(lerp('#f0c6c0', '#fff1d6'));
    this.lights.sun.intensity = 1.8 + 0.9 * p;
  }
}

