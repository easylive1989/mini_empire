// Dev-only unit gallery: `npm run dev` then open /preview.html.
// Query: ?race=elf (or all) &units=elf_archer,angel_seraph &view=close|game &anim=idle|move|attack &spin=1 &yaw=30
import * as THREE from 'three';
import { getUnit, RACES, raceUnits } from './game/data/index';
import type { RaceId } from './game/types';
import { loadAssets } from './render/assets';
import { createUnitModel, type UnitModel } from './render/models';

const params = new URLSearchParams(location.search);
const race = (params.get('race') ?? 'all') as RaceId | 'all';
const view = params.get('view') ?? 'close';
const anim = (params.get('anim') ?? 'idle') as 'idle' | 'move' | 'attack';
const spin = params.get('spin') === '1';
const yaw = (Number(params.get('yaw') ?? 25) * Math.PI) / 180;
const only = params.get('units')?.split(',');

const bar = document.getElementById('bar')!;
const link = (label: string, key: string, value: string) => {
  const b = document.createElement('button');
  b.textContent = label;
  if ((params.get(key) ?? (key === 'race' ? 'all' : key === 'view' ? 'close' : key === 'anim' ? 'idle' : '')) === value) b.className = 'on';
  b.onclick = () => {
    params.set(key, value);
    location.search = params.toString();
  };
  bar.append(b);
};
link('全部', 'race', 'all');
for (const r of RACES) link(r.name, 'race', r.id);
link('近看', 'view', 'close');
link('遊戲視角', 'view', 'game');
link('待機', 'anim', 'idle');
link('移動', 'anim', 'move');
link('攻擊', 'anim', 'attack');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

// Same lights as the battle scene so the gallery matches what players see.
const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd3e8');
scene.add(new THREE.HemisphereLight('#f4fbff', '#6d8a4e', 1.6));
const sun = new THREE.DirectionalLight('#fff1d6', 2.6);
sun.position.set(20, 45, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#7da45a', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const races = RACES.filter((r) => race === 'all' || r.id === race);
const rows = only ? [only.map((id) => getUnit(id))] : races.map((r) => raceUnits(r.id));
const cols = Math.max(...rows.map((r) => r.length));
const GAP_X = 3.2;
const GAP_Z = 4.2;
const width = (cols - 1) * GAP_X;
const depth = (rows.length - 1) * GAP_Z;

const camera =
  view === 'game'
    ? new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400)
    : new THREE.PerspectiveCamera(30, 1, 0.1, 400);

function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    const dist = Math.max(width / aspect, depth + 4) * 1.55 + 8;
    camera.position.set(width / 2, dist * 0.42 + 1.5, depth / 2 + dist);
    camera.lookAt(width / 2, 1.1, depth / 2);
  } else {
    // Battle camera: looking down from the front-right at roughly the same angle as the game.
    const half = Math.max(width / 2 + 2.5, ((depth / 2 + 3) * aspect) / 1.2) / aspect;
    Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    camera.position.set(width / 2 + 30, 40, depth / 2 + 30);
    camera.lookAt(width / 2, 0, depth / 2);
  }
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const labels = document.getElementById('labels')!;
const models: { model: UnitModel; label: HTMLElement; head: THREE.Vector3 }[] = [];

const assets = await loadAssets(() => {});
rows.forEach((units, z) =>
  units.forEach((def, x) => {
    const model = createUnitModel(assets, def);
    model.root.position.set(x * GAP_X, 0, z * GAP_Z);
    model.root.rotation.y = yaw;
    model.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
    if (anim !== 'idle') {
      model.actions.idle.stop();
      const a = model.actions[anim];
      if (anim === 'attack') a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
    }
    scene.add(model.root);
    const label = document.createElement('span');
    label.textContent = def.name;
    labels.append(label);
    models.push({ model, label, head: new THREE.Vector3(x * GAP_X, -0.25, z * GAP_Z) });
  }),
);

const clock = new THREE.Clock();
const v = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  for (const m of models) {
    m.model.mixer.update(dt);
    if (spin) m.model.root.rotation.y += dt * 0.6;
    v.copy(m.head).project(camera);
    m.label.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
    m.label.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
  renderer.render(scene, camera);
});
(window as unknown as { previewReady: boolean }).previewReady = true;
