import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { TILE } from '../game/constants';
import type { BuildingModel, RaceId, UnitDef } from '../game/types';
import { packItem, type Assets } from './assets';
import { addExtras } from './extras';
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
