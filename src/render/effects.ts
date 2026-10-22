import * as THREE from 'three';
import type { ProjectileKind } from '../game/types';
import { packItem, type Assets } from './assets';
import type { World } from './world';

const MAX_PARTICLES = 3000;

/** CPU-driven soft particles rendered as a single Points object. */
class Particles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly col = new Float32Array(MAX_PARTICLES * 3);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly alpha = new Float32Array(MAX_PARTICLES);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly maxLife = new Float32Array(MAX_PARTICLES);
  private readonly baseSize = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 20 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying float vAlpha; varying vec3 vColor; uniform float uScale;
        void main() {
          vAlpha = alpha; vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale;
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
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setScale(pixelsPerUnit: number): void {
    this.material.uniforms.uScale.value = pixelsPerUnit * Math.min(window.devicePixelRatio, 2);
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, size: number, life: number, gravity = 0): void {
    const k = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.pos.set([p.x, p.y, p.z], k * 3);
    this.vel.set([v.x, v.y, v.z], k * 3);
    this.col.set([color.r, color.g, color.b], k * 3);
    this.life[k] = life;
    this.maxLife[k] = life;
    this.baseSize[k] = size;
    this.gravity[k] = gravity;
  }

  update(dt: number): void {
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (this.life[k] <= 0) {
        this.alpha[k] = 0;
        this.size[k] = 0;
        continue;
      }
      this.life[k] -= dt;
      const t = Math.max(0, this.life[k] / this.maxLife[k]);
      this.vel[k * 3 + 1] -= this.gravity[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.alpha[k] = t;
      this.size[k] = this.baseSize[k] * (0.4 + 0.6 * t);
    }
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha']) g.getAttribute(name).needsUpdate = true;
  }
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

interface ProjectileView {
  obj: THREE.Object3D;
  kind: ProjectileKind;
  fromY: number;
  toY: number;
  total: number;
  color: THREE.Color;
  trail: boolean;
  last: THREE.Vector3;
}

const PROJECTILE_COLORS: Record<ProjectileKind, string> = {
  arrow: '#e7e5e4',
  bolt: '#d6d3d1',
  bullet: '#44403c',
  magic: '#a78bfa',
  fire: '#fb923c',
  holy: '#fde68a',
  nature: '#86efac',
  shadow: '#c084fc',
  frost: '#bae6fd',
  rock: '#78716c',
  lightning: '#93c5fd',
};

export class Effects {
  readonly particles = new Particles();
  private rings: Ring[] = [];
  private readonly projectiles = new Map<number, ProjectileView>();
  private lines: { line: THREE.Line; life: number }[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  private readonly orbGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly world: World,
    private readonly assets: Assets,
  ) {
    world.fx.add(this.particles.points);
  }

  resize(): void {
    this.particles.setScale(1 / this.world.unitsPerPixel);
  }

  burst(x: number, y: number, z: number, color: string, count: number, speed: number, size = 0.35, life = 0.6, gravity = 0, spread = 1): void {
    const c = new THREE.Color(color);
    const p = new THREE.Vector3(x, y, z);
    for (let k = 0; k < count; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2 * spread, Math.random(), (Math.random() - 0.5) * 2 * spread)
        .normalize()
        .multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      this.particles.emit(p, v, c, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity);
    }
  }

  rise(x: number, y: number, z: number, color: string, count: number, size = 0.3, radius = 0.5): void {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const p = new THREE.Vector3(x + Math.cos(a) * radius * Math.random(), y + Math.random() * 0.4, z + Math.sin(a) * radius * Math.random());
      this.particles.emit(p, new THREE.Vector3(0, 1.2 + Math.random(), 0), c, size, 0.9 + Math.random() * 0.4);
    }
  }

  ring(x: number, z: number, radius: number, color: string, life = 0.5, y = 0.12): void {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.ringGeo, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.2);
    this.world.fx.add(mesh);
    this.rings.push({ mesh, life, max: life, radius });
  }

  explosion(x: number, z: number, radius: number, kind: 'fire' | 'toxic' | 'holy' | 'shadow'): void {
    const colors = { fire: ['#fb923c', '#fde047'], toxic: ['#84cc16', '#d9f99d'], holy: ['#fde68a', '#ffffff'], shadow: ['#a855f7', '#f0abfc'] }[kind];
    this.ring(x, z, radius, colors[0], 0.45);
    this.burst(x, 0.6, z, colors[0], 18 + radius * 6, radius * 3, 0.6, 0.55, 2);
    this.burst(x, 0.6, z, colors[1], 10, radius * 2, 0.4, 0.35);
  }

  chain(points: { x: number; z: number }[], y: number): void {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k];
      const b = points[k + 1];
      const ya = k === 0 ? y : 0.9;
      for (let s = 0; s <= 4; s++) {
        const t = s / 4;
        const jitter = s === 0 || s === 4 ? 0 : 0.35;
        pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * jitter, ya + (0.9 - ya) * t + (Math.random() - 0.5) * jitter, a.z + (b.z - a.z) * t + (Math.random() - 0.5) * jitter));
      }
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: '#bfdbfe', transparent: true, opacity: 1, blending: THREE.AdditiveBlending }),
    );
    this.world.fx.add(line);
    this.lines.push({ line, life: 0.18 });
  }

  addProjectile(pid: number, kind: ProjectileKind, x: number, z: number, fromY: number, toY: number, total: number): void {
    let obj: THREE.Object3D;
    const color = new THREE.Color(PROJECTILE_COLORS[kind]);
    if (kind === 'arrow' || kind === 'bolt') {
      obj = packItem(this.assets, 'weapons', kind === 'arrow' ? 'arrow' : 'Skeleton_Arrow').clone();
      obj.scale.setScalar(0.9);
      const wrap = new THREE.Group();
      obj.rotation.x = Math.PI / 2;
      wrap.add(obj);
      obj = wrap;
    } else if (kind === 'rock') {
      obj = packItem(this.assets, 'env', 'projectile_catapult').clone();
      obj.scale.setScalar(1.6);
    } else {
      obj = new THREE.Mesh(this.orbGeo, new THREE.MeshBasicMaterial({ color }));
      if (kind === 'bullet') obj.scale.setScalar(0.5);
    }
    obj.position.set(x, fromY, z);
    this.world.fx.add(obj);
    this.projectiles.set(pid, {
      obj,
      kind,
      fromY,
      toY,
      total: Math.max(0.5, total),
      color,
      trail: !['arrow', 'bolt', 'bullet', 'rock'].includes(kind),
      last: new THREE.Vector3(x, fromY, z),
    });
  }

  /** Move a projectile to its simulated position; `remaining` is distance left to the target. */
  moveProjectile(pid: number, x: number, z: number, remaining: number): void {
    const v = this.projectiles.get(pid);
    if (!v) return;
    const t = 1 - Math.min(1, remaining / v.total);
    const arc = v.kind === 'rock' ? v.total * 0.35 : v.kind === 'arrow' || v.kind === 'bolt' ? v.total * 0.12 : 0;
    const y = v.fromY + (v.toY - v.fromY) * t + Math.sin(t * Math.PI) * arc;
    this.tmp.set(x, y, z);
    if (v.kind === 'arrow' || v.kind === 'bolt') {
      const dir = this.tmp.clone().sub(v.last);
      if (dir.lengthSq() > 1e-6) v.obj.lookAt(this.tmp.clone().add(dir));
    }
    v.obj.position.copy(this.tmp);
    if (v.trail && Math.random() < 0.8) {
      this.particles.emit(this.tmp, new THREE.Vector3(0, 0.3, 0), v.color, 0.45, 0.3);
    }
    v.last.copy(this.tmp);
  }

  removeProjectile(pid: number): void {
    const v = this.projectiles.get(pid);
    if (!v) return;
    this.world.fx.remove(v.obj);
    if (v.kind === 'rock') this.burst(v.obj.position.x, 0.4, v.obj.position.z, '#a8a29e', 10, 3, 0.5, 0.5, 4);
    this.projectiles.delete(pid);
  }

  hasProjectile(pid: number): boolean {
    return this.projectiles.has(pid);
  }

  clearProjectiles(): void {
    for (const pid of [...this.projectiles.keys()]) this.removeProjectile(pid);
  }

  update(dt: number): void {
    // The camera glides between framings, so particle sizes follow its zoom every frame.
    this.particles.setScale(1 / this.world.unitsPerPixel);
    this.particles.update(dt);
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      const t = 1 - r.life / r.max;
      r.mesh.scale.setScalar(0.2 + (r.radius - 0.2) * Math.min(1, t * 1.6));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      if (r.life <= 0) {
        this.world.fx.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
    this.lines = this.lines.filter((l) => {
      l.life -= dt;
      (l.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, l.life / 0.18);
      if (l.life <= 0) {
        this.world.fx.remove(l.line);
        l.line.geometry.dispose();
        return false;
      }
      return true;
    });
  }
}
