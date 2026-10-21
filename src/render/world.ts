import * as THREE from 'three';
import { GRID_RADIUS, SPAWN_X, TILE } from '../game/constants';
import type { Assets } from './assets';
import { PRESETS, type Quality } from './quality';
import { buildScenery, ENV_STYLES, type BattleSetting } from './scenery';

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
  renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly ground = new THREE.Group();
  readonly tiles = new THREE.Group();
  readonly buildings = new THREE.Group();
  readonly units = new THREE.Group();
  readonly fx = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private envKey = '';
  insets: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  /** World units per CSS pixel after fitting. */
  unitsPerPixel = 0.05;
  private readonly target = new THREE.Vector3(14, 0, 0);
  private frame = 0;
  private lastScene: THREE.Scene | null = null;

  constructor(
    container: HTMLElement,
    public quality: Quality,
  ) {
    this.renderer = this.createRenderer();
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#9fd3e8');
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);

    this.hemi = new THREE.HemisphereLight('#f4fbff', '#6d8a4e', 1.6);
    this.scene.add(this.hemi);
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

  private createRenderer(): THREE.WebGLRenderer {
    const p = PRESETS[this.quality];
    const r = new THREE.WebGLRenderer({ antialias: p.antialias, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, p.maxPixelRatio));
    r.shadowMap.enabled = true;
    r.shadowMap.type = p.shadowType;
    r.outputColorSpace = THREE.SRGBColorSpace;
    return r;
  }

  /** Switch presets. Antialiasing is fixed per WebGL context, so this swaps in a new canvas and returns it. */
  setQuality(q: Quality): HTMLCanvasElement | null {
    if (q === this.quality) return null;
    this.quality = q;
    const old = this.renderer;
    this.renderer = this.createRenderer();
    old.domElement.replaceWith(this.renderer.domElement);
    old.dispose();
    old.forceContextLoss();
    this.lastScene = null;
    this.resize();
    return this.renderer.domElement;
  }

  /** Draw any scene; the light preset only refreshes shadow maps every few frames. */
  draw(scene: THREE.Scene, camera: THREE.Camera): void {
    const preset = PRESETS[this.quality];
    if (scene !== this.lastScene) setShadowSize(scene, preset.shadowMapSize);
    const shadows = this.renderer.shadowMap;
    shadows.autoUpdate = preset.shadowEvery <= 1;
    if (!shadows.autoUpdate) shadows.needsUpdate = scene !== this.lastScene || this.frame % preset.shadowEvery === 0;
    this.lastScene = scene;
    this.frame++;
    this.renderer.render(scene, camera);
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
      new THREE.Vector3(SPAWN_X + 5, 0, 0),
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
    this.draw(this.scene, this.camera);
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

  /** Ground, battlefield, enemy camp and scenery for a battle setting (rebuilt only when it changes). */
  buildEnvironment(assets: Assets, setting: BattleSetting = CLASSIC_SETTING): void {
    const key = `${setting.terrain}|${setting.faction}|${setting.race}`;
    if (key === this.envKey) return;
    this.envKey = key;
    disposeTree(this.ground);
    this.ground.clear();
    buildScenery(this.ground, assets, setting);
    const style = ENV_STYLES[setting.terrain];
    (this.scene.background as THREE.Color).set(style.sky);
    this.hemi.color.set(style.hemi[0]);
    this.hemi.groundColor.set(style.hemi[1]);
    this.hemi.intensity = style.hemi[2];
    this.sun.color.set(style.sun[0]);
    this.sun.intensity = style.sun[1];
  }
}

export const CLASSIC_SETTING: BattleSetting = { terrain: 'plains', faction: 'undead', race: 'human' };

/** Resize the sun's shadow map in a scene (the render target is recreated on the next frame). */
function setShadowSize(scene: THREE.Scene, size: number): void {
  scene.traverse((o) => {
    const light = o as THREE.DirectionalLight;
    if (!light.isDirectionalLight || !light.castShadow || light.shadow.mapSize.x === size) return;
    light.shadow.mapSize.set(size, size);
    light.shadow.map?.dispose();
    light.shadow.map = null;
  });
}

/** Frees the GPU resources owned by generated meshes (shared pack geometry is left alone). */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.geometry instanceof THREE.PlaneGeometry)) return;
    m.geometry.dispose();
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.dispose();
  });
}
