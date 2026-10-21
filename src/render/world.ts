import * as THREE from 'three';
import { GRID_RADIUS, SPAWN_X, TILE } from '../game/constants';
import { Rng } from '../game/rng';
import type { Assets } from './assets';
import { decoModel } from './models';

export const TILE_TOP = 0.2;

/** Screen area (in CSS px) not covered by UI panels; the camera frames the map inside it. */
export interface ViewInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Fixed camera direction: enemies (+X) arrive from the lower right of the screen. */
const VIEW_DIR = new THREE.Vector3(0.57, 0, 0.82).normalize().multiplyScalar(Math.cos(THREE.MathUtils.degToRad(50)));
VIEW_DIR.y = Math.sin(THREE.MathUtils.degToRad(50));

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly ground = new THREE.Group();
  readonly tiles = new THREE.Group();
  readonly buildings = new THREE.Group();
  readonly units = new THREE.Group();
  readonly fx = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  insets: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  /** World units per CSS pixel after fitting. */
  unitsPerPixel = 0.05;
  private readonly target = new THREE.Vector3(14, 0, 0);

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#9fd3e8');
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);

    const hemi = new THREE.HemisphereLight('#f4fbff', '#6d8a4e', 1.6);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.6);
    this.sun.position.set(20, 45, 30);
    this.sun.target.position.set(14, 0, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -42;
    sc.right = 42;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 1;
    sc.far = 140;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.ground, this.tiles, this.buildings, this.units, this.fx);
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.fit(w, h);
  }

  /** Frame the plot and the battlefield inside the area left free by the UI. */
  private fit(w: number, h: number): void {
    const cam = this.camera;
    cam.position.copy(this.target).addScaledVector(VIEW_DIR, 120);
    cam.lookAt(this.target);
    cam.updateMatrixWorld(true);
    const r = GRID_RADIUS * TILE + TILE / 2;
    const pts = [
      new THREE.Vector3(-r, 0, -r),
      new THREE.Vector3(-r, 5, -r),
      new THREE.Vector3(r, 0, -r),
      new THREE.Vector3(-r, 0, r),
      new THREE.Vector3(r, 0, r),
      new THREE.Vector3(SPAWN_X - 3, 0, -7),
      new THREE.Vector3(SPAWN_X - 8, 0, 8),
    ];
    const inv = cam.matrixWorldInverse;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      const v = p.clone().applyMatrix4(inv);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
    const ins = this.insets;
    const availW = Math.max(200, w - ins.left - ins.right);
    const availH = Math.max(200, h - ins.top - ins.bottom);
    const upp = Math.max((maxX - minX) / availW, (maxY - minY) / availH);
    this.unitsPerPixel = upp;
    // Place the content centre at the centre of the free area.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const freeCx = ins.left + availW / 2 - w / 2;
    const freeCy = -(ins.top + availH / 2 - h / 2);
    cam.left = cx - freeCx * upp - (w / 2) * upp;
    cam.right = cam.left + w * upp;
    cam.top = cy - freeCy * upp + (h / 2) * upp;
    cam.bottom = cam.top - h * upp;
    cam.updateProjectionMatrix();
  }

  setInsets(insets: ViewInsets): void {
    this.insets = insets;
    this.resize();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Project a world point to CSS pixel coordinates. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  raycast(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection | undefined {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.intersectObjects(objects, true)[0];
  }

  /** Ground, battlefield road, graveyard and scenery. */
  buildEnvironment(assets: Assets): void {
    this.ground.clear();
    const size = 160;
    const tex = paintGround(size);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(GROUND_CENTER_X, 0, 0);
    plane.receiveShadow = true;
    this.ground.add(plane);

    const rng = new Rng(20261021);
    const add = (pack: 'env' | 'halloween' | 'dungeon', key: string, x: number, z: number, scale: number, rotY = rng.next() * Math.PI * 2) => {
      const o = decoModel(assets, pack, key, scale);
      o.position.set(x, 0, z);
      o.rotation.y = rotY;
      this.ground.add(o);
    };

    // Graveyard the undead pour out of.
    add('halloween', 'crypt', SPAWN_X + 9, 0, 0.55, -Math.PI / 2);
    add('halloween', 'arch_gate', SPAWN_X + 3.5, 0, 0.75, Math.PI / 2);
    for (let k = 0; k < 18; k++) {
      const z = (k % 2 ? 1 : -1) * (5 + rng.next() * 9);
      const x = SPAWN_X - 3 + rng.next() * 12;
      add('halloween', ['gravestone', 'grave_A', 'gravemarker_A', 'post_skull', 'skull', 'lantern_standing'][k % 6], x, z, 0.75, -Math.PI / 2 + (rng.next() - 0.5) * 0.6);
    }
    for (let k = 0; k < 8; k++) {
      add('halloween', ['tree_dead_large', 'tree_dead_medium', 'tree_dead_small'][k % 3], SPAWN_X - 4 + rng.next() * 16, (k % 2 ? 1 : -1) * (12 + rng.next() * 8), 0.75);
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        add('halloween', k === 1 ? 'fence_broken' : 'fence', SPAWN_X + 3.5, side * (4.5 + k * 3), 0.75, Math.PI / 2);
      }
    }

    // Scenery around the plot, kept off the plot and the battlefield.
    const r = GRID_RADIUS * TILE + TILE;
    const nature = ['tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_A_medium', 'trees_B_small', 'trees_B_medium', 'rock_single_C', 'rock_single_E'];
    let placed = 0;
    for (let k = 0; k < 600 && placed < 110; k++) {
      const x = -40 + rng.next() * 110;
      const z = -40 + rng.next() * 80;
      if (Math.abs(x) < r + 1 && Math.abs(z) < r + 1) continue;
      if (x > r - 2 && x < SPAWN_X + 14 && Math.abs(z) < 15) continue;
      const kind = nature[rng.int(nature.length)];
      add('env', kind, x, z, (kind.startsWith('rock') ? 4 : 1.7) + rng.next() * 0.8);
      placed++;
    }
    add('env', 'mountain_A_grass_trees', -34, -26, 4.5);
    add('env', 'mountain_B_grass_trees', -22, -38, 4.2);
    add('env', 'mountain_A_grass_trees', 6, -42, 4.6);
  }
}

const GROUND_CENTER_X = 15;

/** Hand-painted ground texture: grass with a trampled battlefield leading to the plot. */
function paintGround(size: number): THREE.Texture {
  const px = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const toPx = (x: number, z: number) => [((x - GROUND_CENTER_X + size / 2) / size) * px, ((z + size / 2) / size) * px];
  ctx.fillStyle = '#7cb85a';
  ctx.fillRect(0, 0, px, px);
  const rng = new Rng(7);
  for (let k = 0; k < 2600; k++) {
    const x = rng.next() * px;
    const y = rng.next() * px;
    const r = 2 + rng.next() * 9;
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(98,160,70,0.35)' : 'rgba(150,205,110,0.3)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Battlefield: trampled earth widening towards the graveyard.
  const [ax, az] = toPx(TILE * 2.6, 0);
  const [bx] = toPx(SPAWN_X + 10, 0);
  const halfNear = (13 / size) * px;
  const halfFar = (17 / size) * px;
  for (let k = 0; k < 900; k++) {
    const t = rng.next();
    const x = ax + (bx - ax) * t;
    const half = halfNear + (halfFar - halfNear) * t;
    const y = az + (rng.next() * 2 - 1) * half * Math.sqrt(rng.next());
    const r = 6 + rng.next() * 18;
    ctx.fillStyle = `rgba(${170 + rng.int(30)},${135 + rng.int(25)},${85 + rng.int(20)},0.16)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Soft clearing around the plot.
  const [ox, oz] = toPx(0, 0);
  const g = ctx.createRadialGradient(ox, oz, 10, ox, oz, (16 / size) * px);
  g.addColorStop(0, 'rgba(160,140,95,0.35)');
  g.addColorStop(1, 'rgba(160,140,95,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ox, oz, (16 / size) * px, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
