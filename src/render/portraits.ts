import * as THREE from 'three';
import { BUILDINGS, getUnit, raceBuildings } from '../game/data/index';
import type { BuildingModel, RaceId } from '../game/types';
import type { Assets } from './assets';
import { createUnitModel, placeModel } from './models';

/** The unit that represents each race on the race picker. */
export const RACE_MASCOT: Record<RaceId, string> = {
  human: 'human_knight',
  elf: 'elf_archer',
  dwarf: 'dwarf_shieldguard',
  demon: 'demon_berserker',
  angel: 'angel_judicator',
};

const SIZE = 320;

/**
 * Renders a still portrait of each race's mascot unit into data URLs.
 * Uses a short-lived offscreen renderer so the game's own canvas and camera are untouched.
 */
export function renderRacePortraits(assets: Assets): Map<RaceId, string> {
  const out = new Map<RaceId, string>();
  const canvas = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#6b5a48', 1.9));
  const key = new THREE.DirectionalLight('#fff4e0', 2.6);
  key.position.set(2.5, 4, 5);
  const rim = new THREE.DirectionalLight('#cfe4ff', 1.4);
  rim.position.set(-3, 3, -4);
  scene.add(key, rim);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);

  for (const [race, unitId] of Object.entries(RACE_MASCOT) as [RaceId, string][]) {
    const model = createUnitModel(assets, getUnit(unitId));
    model.actions.idle.stop();
    const pose = assets.clips.get('Idle_Combat') ?? assets.clips.get('Idle')!;
    model.mixer.clipAction(pose).play();
    model.mixer.update(0.35);
    model.root.rotation.y = 0.45;
    scene.add(model.root);
    model.root.updateMatrixWorld(true);

    // Frame the whole figure, wings and weapons included.
    const box = new THREE.Box3().setFromObject(model.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.y, size.x * 0.8) * 1.02;
    const dist = extent / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(center.x + dist * 0.08, center.y + extent * 0.12, center.z + dist);
    camera.lookAt(center);

    renderer.render(scene, camera);
    out.set(race, canvas.toDataURL('image/png'));
    scene.remove(model.root);
    model.mixer.stopAllAction();
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

const THUMB = 192;
/** Same viewing direction as the battle camera, so thumbnails match the town. */
const THUMB_VIEW = new THREE.Vector3(0.57 * Math.cos(THREE.MathUtils.degToRad(50)), Math.sin(THREE.MathUtils.degToRad(50)), 0.82 * Math.cos(THREE.MathUtils.degToRad(50))).normalize();

/** Small rendered pictures of each building, recoloured for the player's race. */
export class BuildingThumbs {
  private renderer: THREE.WebGLRenderer | null | undefined;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(22, 1, 0.1, 300);
  private readonly cache = new Map<string, string>();

  constructor(private readonly assets: Assets) {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6b5a48', 2.1));
    const key = new THREE.DirectionalLight('#fff4e0', 2.4);
    key.position.set(4, 8, 6);
    this.scene.add(key);
  }

  private ensure(): THREE.WebGLRenderer | null {
    if (this.renderer !== undefined) return this.renderer;
    try {
      const canvas = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(THUMB, THUMB, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    } catch {
      this.renderer = null;
    }
    return this.renderer;
  }

  /** Renders every building the race can use (its own, the campaign specials and its castle). */
  prepare(race: RaceId): void {
    const defs = [...raceBuildings(race), ...[...BUILDINGS.values()].filter((b) => b.campaignOnly)];
    for (const def of defs) this.render(race, def.id, def.model);
    this.render(race, 'castle', { pack: 'buildings', key: 'castle', scale: 1.15 });
  }

  get(defId: string, race: RaceId): string | undefined {
    return this.cache.get(`${race}:${defId}`);
  }

  private render(race: RaceId, id: string, model: BuildingModel): void {
    const key = `${race}:${id}`;
    if (this.cache.has(key)) return;
    const renderer = this.ensure();
    if (!renderer) return;
    const obj = placeModel(this.assets, model, race, 0.82);
    obj.rotation.y = Math.PI / 2;
    this.scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = (radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.82;
    this.camera.position.copy(center).addScaledVector(THUMB_VIEW, dist);
    this.camera.lookAt(center);
    renderer.render(this.scene, this.camera);
    this.cache.set(key, renderer.domElement.toDataURL('image/png'));
    this.scene.remove(obj);
  }
}
