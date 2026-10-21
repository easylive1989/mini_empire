import * as THREE from 'three';

/** Shared helpers for the perspective scenes (world map and cutscenes). */

/** Vertical sky gradient used as a scene background. */
export function skyTexture(top: string, bottom: string, glow?: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  if (glow) g.addColorStop(0.75, glow);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let puff: THREE.Texture | null = null;
/** Soft round puff for smoke, miasma and glows. */
export function puffTexture(): THREE.Texture {
  if (puff) return puff;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puff = new THREE.CanvasTexture(c);
  return puff;
}

/** Pointy-top axial hex coordinates to world XZ (KayKit hex tiles are 2 units across the flats). */
export function hexToWorld(q: number, r: number, size: number): THREE.Vector3 {
  return new THREE.Vector3(size * 2 * (q + r / 2), 0, size * Math.sqrt(3) * r);
}

/** The six corners of a pointy-top hex of the given circumradius. */
export function hexCorners(radius: number, y = 0): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 3) * k;
    pts.push(new THREE.Vector3(Math.sin(a) * radius, y, Math.cos(a) * radius));
  }
  return pts;
}

const MAX = 2000;

/** Distance-attenuated additive particles for perspective cameras. */
export class SoftParticles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly vel = new Float32Array(MAX * 3);
  private readonly life = new Float32Array(MAX);
  private readonly maxLife = new Float32Array(MAX);
  private readonly baseSize = new Float32Array(MAX);
  private readonly gravity = new Float32Array(MAX);
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(additive = true) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vAlpha; varying vec3 vColor; uniform float uScale;
        void main() {
          vAlpha = alpha; vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / max(0.1, -mv.z);
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.1, d));
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  /** Pixel height of the viewport, so sizes stay in world units. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = (heightPx * Math.min(window.devicePixelRatio, 2)) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, gravity = 0): void {
    const k = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos.set([p.x, p.y, p.z], k * 3);
    this.vel.set([v.x, v.y, v.z], k * 3);
    this.col.set([color.r, color.g, color.b], k * 3);
    this.baseSize[k] = size;
    this.life[k] = life;
    this.maxLife[k] = life;
    this.gravity[k] = gravity;
  }

  burst(at: THREE.Vector3, color: string, count: number, speed: number, size: number, life: number, up = 1, gravity = 4): void {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const v = new THREE.Vector3(Math.cos(a) * s, up * (1 + Math.random() * 2), Math.sin(a) * s);
      this.emit(at, v, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity);
    }
  }

  update(dt: number): void {
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.alpha[k] = 0;
        continue;
      }
      this.life[k] -= dt;
      const t = Math.max(0, this.life[k] / this.maxLife[k]);
      this.vel[k * 3 + 1] -= this.gravity[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.alpha[k] = Math.min(1, t * 2);
      this.size[k] = this.baseSize[k] * (0.4 + 0.6 * t);
    }
    const geo = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha']) geo.getAttribute(name).needsUpdate = true;
  }
}

/** Standard lighting rig for the perspective scenes; returns handles for mood changes. */
export function addLights(scene: THREE.Scene, shadowSize = 30): { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight } {
  const hemi = new THREE.HemisphereLight('#f4fbff', '#6d8a4e', 1.5);
  const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
  sun.position.set(12, 30, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -shadowSize;
  sc.right = shadowSize;
  sc.top = shadowSize;
  sc.bottom = -shadowSize;
  sc.near = 1;
  sc.far = 120;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(hemi, sun, sun.target);
  return { hemi, sun };
}

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
