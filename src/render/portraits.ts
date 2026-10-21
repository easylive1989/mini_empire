import * as THREE from 'three';
import { getUnit } from '../game/data/index';
import type { RaceId } from '../game/types';
import type { Assets } from './assets';
import { createUnitModel } from './models';

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
