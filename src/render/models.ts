import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TILE } from '../game/constants';
import type { BuildingModel, Extra, RaceId, UnitDef } from '../game/types';
import { packItem, type Assets } from './assets';
import { buildingMaterial, characterMaterial } from './recolor';

/** KayKit characters are ~2.2 units tall; units are drawn this tall in world space. */
const UNIT_HEIGHT = 2.0;
const CHAR_SOURCE_HEIGHT = 2.2;

export interface UnitModel {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<'idle' | 'move' | 'attack' | 'death', THREE.AnimationAction>;
  height: number;
}

function findNode(root: THREE.Object3D, ...names: string[]): THREE.Object3D | undefined {
  for (const n of names) {
    const found = root.getObjectByName(n);
    if (found) return found;
  }
  return undefined;
}

const extraMats = new Map<string, THREE.Material>();
function mat(color: string, emissive?: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.Material {
  const key = `${color}|${emissive ?? ''}|${JSON.stringify(opts)}`;
  let m = extraMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: emissive ?? '#000000', ...opts });
    extraMats.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  return m;
}

function wingPair(color: string, size: number, dark: boolean): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  if (dark) {
    shape.moveTo(0, 0);
    shape.lineTo(0.9, 0.55);
    shape.lineTo(0.75, 0.15);
    shape.lineTo(0.6, 0.25);
    shape.lineTo(0.45, -0.05);
    shape.lineTo(0.3, 0.05);
    shape.lineTo(0.12, -0.3);
    shape.closePath();
  } else {
    shape.moveTo(0, 0);
    shape.bezierCurveTo(0.3, 0.6, 0.8, 0.75, 1.05, 0.6);
    shape.bezierCurveTo(0.8, 0.35, 0.6, 0.0, 0.15, -0.45);
    shape.closePath();
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
  const m = mat(color, dark ? '#200000' : '#2a2a20', { side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const w = mesh(geo, m);
    w.scale.set(side * size, size, size);
    w.position.set(side * 0.15, 0.15, -0.32);
    w.rotation.y = side * 0.5;
    g.add(w);
  }
  return g;
}

function addExtras(root: THREE.Object3D, extras: Extra[], palette: string | undefined): void {
  const head = findNode(root, 'head');
  const chest = findNode(root, 'chest');
  const handR = findNode(root, 'handslotr', 'handslot.r');
  const handL = findNode(root, 'handslotl', 'handslot.l');
  const skin = palette === 'demon' || palette === 'imp' || palette === 'cultist' || palette === 'warlock' ? '#b91c1c' : '#f6d2b8';
  for (const ex of extras) {
    switch (ex) {
      case 'wings':
        chest?.add(wingPair('#fbfaf3', 1.05, false));
        break;
      case 'bigWings': {
        const a = wingPair('#fff8e1', 1.3, false);
        const b = wingPair('#fde68a', 0.9, false);
        b.position.y = -0.35;
        chest?.add(a, b);
        break;
      }
      case 'batWings':
        chest?.add(wingPair('#3b0a14', 0.9, true));
        break;
      case 'halo': {
        const h = mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 24), mat('#fde047', '#a16207'));
        h.rotation.x = Math.PI / 2;
        h.position.set(0, 1.25, 0);
        head?.add(h);
        break;
      }
      case 'horns':
      case 'bigHorns': {
        const big = ex === 'bigHorns';
        const geo = new THREE.ConeGeometry(big ? 0.13 : 0.08, big ? 0.6 : 0.32, 6);
        for (const side of [-1, 1]) {
          const h = mesh(geo, mat('#2b1b17'));
          h.position.set(side * 0.32, big ? 0.95 : 0.85, 0.05);
          h.rotation.z = -side * 0.5;
          h.rotation.x = -0.2;
          head?.add(h);
        }
        break;
      }
      case 'ears': {
        const geo = new THREE.ConeGeometry(0.1, 0.5, 5);
        for (const side of [-1, 1]) {
          const e = mesh(geo, mat(skin));
          e.position.set(side * 0.55, 0.5, -0.02);
          e.rotation.z = -side * 1.15;
          head?.add(e);
        }
        break;
      }
      case 'beard': {
        const b = mesh(new THREE.ConeGeometry(0.42, 0.75, 7), mat('#b9541f'));
        b.position.set(0, 0.05, 0.46);
        b.rotation.x = Math.PI;
        head?.add(b);
        break;
      }
      case 'leaves': {
        const geo = new THREE.IcosahedronGeometry(0.22, 0);
        const spots: [number, number, number, THREE.Object3D | undefined][] = [
          [0, 1.05, 0, head],
          [0.25, 0.9, -0.1, head],
          [-0.25, 0.92, 0.05, head],
          [0.45, 0.35, 0, chest],
          [-0.45, 0.35, 0, chest],
        ];
        spots.forEach(([x, y, z, parent], k) => {
          const l = mesh(geo, mat(k % 2 ? '#3f8f2a' : '#5bb33d'));
          l.position.set(x, y, z);
          l.rotation.set(k, k * 2, k * 3);
          parent?.add(l);
        });
        break;
      }
      case 'chimney': {
        const c = mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.7, 8), mat('#3f3f46'));
        c.position.set(0.2, 0.55, -0.4);
        const glow = mesh(new THREE.TorusGeometry(0.12, 0.04, 6, 12), mat('#f97316', '#f97316'));
        glow.rotation.x = Math.PI / 2;
        glow.position.y = 0.36;
        c.add(glow);
        chest?.add(c);
        break;
      }
      case 'crown': {
        const g = new THREE.Group();
        const band = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.18, 10, 1, true), mat('#facc15', '#713f12', { side: THREE.DoubleSide }));
        g.add(band);
        for (let k = 0; k < 5; k++) {
          const sp = mesh(new THREE.ConeGeometry(0.07, 0.22, 4), mat('#facc15', '#713f12'));
          const a = (k / 5) * Math.PI * 2;
          sp.position.set(Math.cos(a) * 0.33, 0.18, Math.sin(a) * 0.33);
          g.add(sp);
        }
        g.position.set(0, 0.98, 0);
        head?.add(g);
        break;
      }
      case 'spear': {
        const g = new THREE.Group();
        const shaft = mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.1, 6), mat('#7c4a24'));
        const tip = mesh(new THREE.ConeGeometry(0.09, 0.32, 6), mat('#d4d4d8', undefined, { metalness: 0.6 }));
        tip.position.y = 1.2;
        g.add(shaft, tip);
        g.position.y = 0.35;
        handR?.add(g);
        break;
      }
      case 'bow': {
        const g = new THREE.Group();
        const arc = mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 18, Math.PI * 0.85), mat('#8b5a2b'));
        arc.rotation.z = Math.PI / 2 + Math.PI * 0.075;
        const str = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.95, 3), mat('#f5f5f4'));
        str.position.x = -0.03;
        g.add(arc, str);
        g.rotation.y = Math.PI / 2;
        g.position.set(0, 0.05, 0.05);
        handL?.add(g);
        break;
      }
      case 'hammer': {
        const g = new THREE.Group();
        const handle = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6), mat('#7c4a24'));
        const headM = mesh(new THREE.BoxGeometry(0.32, 0.18, 0.18), mat('#52525b', undefined, { metalness: 0.5 }));
        headM.position.y = 0.38;
        g.add(handle, headM);
        g.position.y = 0.25;
        handR?.add(g);
        break;
      }
      case 'banner': {
        const g = new THREE.Group();
        const pole = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), mat('#78350f'));
        const flag = mesh(new THREE.PlaneGeometry(0.6, 0.8), mat('#1d4ed8', '#0b1d4d', { side: THREE.DoubleSide }));
        flag.position.set(0.32, 0.45, 0);
        const emblem = mesh(new THREE.CircleGeometry(0.16, 12), mat('#facc15', '#5a4300', { side: THREE.DoubleSide }));
        emblem.position.set(0.32, 0.5, 0.005);
        g.add(pole, flag, emblem);
        g.position.set(-0.25, 0.7, -0.35);
        chest?.add(g);
        break;
      }
    }
  }
}

const HAND_SLOTS = ['handslotr', 'handslotl', 'handslot.r', 'handslot.l'];

export function createUnitModel(assets: Assets, def: UnitDef): UnitModel {
  const spec = def.model;
  const template = assets.chars.get(spec.base)!;
  const body = SkeletonUtils.clone(template);
  const keep = new Set(spec.keep ?? []);
  const hide = new Set(spec.hide ?? []);

  for (const slotName of HAND_SLOTS) {
    const slot = body.getObjectByName(slotName);
    if (!slot) continue;
    for (const item of slot.children) item.visible = keep.has(item.name);
  }
  for (const name of hide) {
    const n = body.getObjectByName(name);
    if (n) n.visible = false;
  }
  for (const a of spec.attach ?? []) {
    const slot = findNode(body, a.slot.replace('.', ''), a.slot);
    if (!slot) continue;
    const item = packItem(assets, 'weapons', a.item).clone();
    item.position.set(0, 0, 0);
    slot.add(item);
  }
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = characterMaterial(m.material as THREE.Material, spec.base, spec.palette);
      m.castShadow = false;
      m.frustumCulled = false;
    }
  });
  if (spec.extras?.length) addExtras(body, spec.extras, spec.palette);

  const s = (UNIT_HEIGHT / CHAR_SOURCE_HEIGHT) * (spec.scale ?? 1);
  const sq = spec.squash ?? [1, 1, 1];
  body.scale.set(s * sq[0], s * sq[1], s * sq[2]);
  const root = new THREE.Group();
  root.add(body);

  const mixer = new THREE.AnimationMixer(body);
  const melee = !def.projectile;
  const clipName = {
    idle: spec.anims?.idle ?? 'Idle',
    move: spec.anims?.move ?? (def.speed < 2.4 ? 'Walking_A' : 'Running_A'),
    attack:
      spec.anims?.attack ??
      (melee ? '1H_Melee_Attack_Chop' : def.damageType === 'magic' ? 'Spellcast_Shoot' : '1H_Ranged_Shoot'),
    death: spec.anims?.death ?? 'Death_A',
  };
  const action = (name: string) => {
    const clip = assets.clips.get(name) ?? assets.clips.get('Idle')!;
    return mixer.clipAction(clip);
  };
  const actions = {
    idle: action(clipName.idle),
    move: action(clipName.move),
    attack: action(clipName.attack),
    death: action(clipName.death),
  };
  actions.attack.setLoop(THREE.LoopOnce, 1);
  actions.attack.clampWhenFinished = false;
  const attackLen = actions.attack.getClip().duration;
  actions.attack.timeScale = Math.max(1, (attackLen / Math.max(0.5, def.attackInterval)) * 1.1);
  actions.death.setLoop(THREE.LoopOnce, 1);
  actions.death.clampWhenFinished = true;
  actions.move.timeScale = Math.min(1.6, Math.max(0.7, def.speed / 3));
  actions.idle.play();
  actions.idle.time = Math.random() * actions.idle.getClip().duration;

  return { root, mixer, actions, height: UNIT_HEIGHT * (spec.scale ?? 1) * sq[1] };
}

const footprints = new Map<THREE.Object3D, THREE.Box3>();
function footprint(obj: THREE.Object3D): THREE.Box3 {
  let box = footprints.get(obj);
  if (!box) {
    obj.updateWorldMatrix(true, true);
    box = new THREE.Box3().setFromObject(obj);
    footprints.set(obj, box);
  }
  return box;
}

/** Clone a pack model scaled to fit a tile, sitting on y = 0. */
export function placeModel(assets: Assets, model: BuildingModel, race: RaceId | null, fit = 0.82): THREE.Group {
  const src = packItem(assets, model.pack, model.key);
  const box = footprint(src);
  const size = new THREE.Vector3();
  box.getSize(size);
  // KayKit buildings share one scale so their relative sizes survive; other packs are fitted to the tile.
  const fitScale = (TILE * fit) / Math.max(size.x, size.z, 0.01);
  const s = (model.pack === 'buildings' ? Math.min(2.05, fitScale) : fitScale) * (model.scale ?? 1);
  const obj = src.clone();
  obj.position.set(0, 0, 0);
  if (model.pack === 'buildings' && race) {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = buildingMaterial(m.material as THREE.Material, race);
    });
  }
  const wrap = new THREE.Group();
  const center = new THREE.Vector3();
  box.getCenter(center);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  obj.scale.setScalar(s);
  wrap.add(obj);
  return wrap;
}

/** Plain decoration clone with its native scale multiplied. */
export function decoModel(assets: Assets, pack: 'env' | 'halloween' | 'dungeon', key: string, scale: number): THREE.Object3D {
  const obj = packItem(assets, pack, key).clone();
  obj.position.set(0, 0, 0);
  obj.scale.setScalar(scale);
  return obj;
}
