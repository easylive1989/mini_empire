import * as THREE from 'three';

const bgMat = new THREE.MeshBasicMaterial({ color: '#1c1917', transparent: true, opacity: 0.75, depthTest: false });
const fillMats = {
  player: new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, depthTest: false }),
  enemy: new THREE.MeshBasicMaterial({ color: '#f87171', transparent: true, depthTest: false }),
  building: new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, depthTest: false }),
};
/** The blink colour of an enemy bar below `LOW` health. */
const lowMat = new THREE.MeshBasicMaterial({ color: '#fde68a', transparent: true, depthTest: false });
/** Recently lost health: a pale chunk that lingers, then drains. */
const trailMat = new THREE.MeshBasicMaterial({ color: '#fff7ed', transparent: true, opacity: 0.85, depthTest: false });
const shieldMat = new THREE.MeshBasicMaterial({ color: '#bfdbfe', transparent: true, opacity: 0.95, depthTest: false });
const plane = new THREE.PlaneGeometry(1, 1);
plane.translate(0.5, 0, 0);

/** Seconds the lost chunk holds before draining, and how fast it drains (share of max HP per second). */
const TRAIL_HOLD = 0.3;
const TRAIL_DRAIN = 1.5;
/** Enemy bars blink below this share of health, at 2 Hz. */
const LOW = 0.25;

/**
 * Camera-facing health bar (with optional shield overlay). Damage leaves a pale trail that holds for
 * a moment and then drains, so bursts read at a glance; timed on the wall clock so pausing never
 * freezes it.
 */
export class HpBar {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private trail: THREE.Mesh;
  private shield: THREE.Mesh;
  private readonly width: number;
  private readonly kind: keyof typeof fillMats;
  private trailRatio = 1;
  private shown = 1;
  private holdUntil = 0;
  private last = performance.now() / 1000;

  constructor(kind: keyof typeof fillMats, width: number, camera: THREE.Camera) {
    this.width = width;
    this.kind = kind;
    const h = width * 0.14;
    const bg = new THREE.Mesh(plane, bgMat);
    bg.scale.set(width + 0.08, h + 0.08, 1);
    bg.position.x = -width / 2 - 0.04;
    this.trail = new THREE.Mesh(plane, trailMat);
    this.trail.scale.set(width, h, 1);
    this.trail.position.set(-width / 2, 0, 0.0005);
    this.fill = new THREE.Mesh(plane, fillMats[kind]);
    this.fill.scale.set(width, h, 1);
    this.fill.position.set(-width / 2, 0, 0.001);
    this.shield = new THREE.Mesh(plane, shieldMat);
    this.shield.scale.set(0.0001, h * 0.45, 1);
    this.shield.position.set(-width / 2, h * 0.3, 0.002);
    this.group.add(bg, this.trail, this.fill, this.shield);
    this.group.quaternion.copy(camera.quaternion);
    bg.renderOrder = 20;
    this.trail.renderOrder = 21;
    this.fill.renderOrder = 22;
    this.shield.renderOrder = 23;
  }

  set(ratio: number, shieldRatio = 0): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this.last);
    this.last = now;
    const r = Math.max(0, Math.min(1, ratio));
    if (r < this.shown - 1e-4 && this.trailRatio <= this.shown + 1e-4) this.holdUntil = now + TRAIL_HOLD;
    this.shown = r;
    if (r >= this.trailRatio) this.trailRatio = r;
    else if (now > this.holdUntil) this.trailRatio = Math.max(r, this.trailRatio - TRAIL_DRAIN * dt);
    this.fill.scale.x = Math.max(0.0001, r) * this.width;
    this.trail.scale.x = Math.max(0.0001, this.trailRatio) * this.width;
    this.shield.scale.x = Math.max(0.0001, Math.min(1, shieldRatio)) * this.width;
    if (this.kind === 'enemy') this.fill.material = r < LOW && Math.floor(now * 4) % 2 === 0 ? lowMat : fillMats.enemy;
  }
}
