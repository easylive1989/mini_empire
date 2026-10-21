import * as THREE from 'three';

const bgMat = new THREE.MeshBasicMaterial({ color: '#1c1917', transparent: true, opacity: 0.75, depthTest: false });
const fillMats = {
  player: new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, depthTest: false }),
  enemy: new THREE.MeshBasicMaterial({ color: '#f87171', transparent: true, depthTest: false }),
  building: new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, depthTest: false }),
};
const shieldMat = new THREE.MeshBasicMaterial({ color: '#bfdbfe', transparent: true, opacity: 0.95, depthTest: false });
const plane = new THREE.PlaneGeometry(1, 1);
plane.translate(0.5, 0, 0);

/** Camera-facing health bar (with optional shield overlay). */
export class HpBar {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private shield: THREE.Mesh;
  private readonly width: number;

  constructor(kind: keyof typeof fillMats, width: number, camera: THREE.Camera) {
    this.width = width;
    const h = width * 0.14;
    const bg = new THREE.Mesh(plane, bgMat);
    bg.scale.set(width + 0.08, h + 0.08, 1);
    bg.position.x = -width / 2 - 0.04;
    this.fill = new THREE.Mesh(plane, fillMats[kind]);
    this.fill.scale.set(width, h, 1);
    this.fill.position.set(-width / 2, 0, 0.001);
    this.shield = new THREE.Mesh(plane, shieldMat);
    this.shield.scale.set(0.0001, h * 0.45, 1);
    this.shield.position.set(-width / 2, h * 0.3, 0.002);
    this.group.add(bg, this.fill, this.shield);
    this.group.quaternion.copy(camera.quaternion);
    bg.renderOrder = 20;
    this.fill.renderOrder = 21;
    this.shield.renderOrder = 22;
  }

  set(ratio: number, shieldRatio = 0): void {
    this.fill.scale.x = Math.max(0.0001, Math.min(1, ratio)) * this.width;
    this.shield.scale.x = Math.max(0.0001, Math.min(1, shieldRatio)) * this.width;
  }
}
