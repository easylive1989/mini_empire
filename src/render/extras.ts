import * as THREE from 'three';
import type { Extra } from '../game/types';
import { characterEnv, paletteSkin, PALETTES } from './recolor';
import { puffTexture } from './sceneKit';

/**
 * Procedural add-ons for the KayKit characters (ears, wings, horns, weapons...).
 * Geometry and materials are shared between every unit that uses them, so a full battlefield
 * only pays for each shape once. Positions are in the local space of the bone they hang on.
 */

const geos = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geos.get(key);
  if (!g) {
    g = make();
    geos.set(key, g);
  }
  return g;
}

interface MatOpts {
  emissive?: string;
  emissiveIntensity?: number;
  metal?: boolean;
  roughness?: number;
  side?: THREE.Side;
  opacity?: number;
  vertexColors?: boolean;
}
const mats = new Map<string, THREE.Material>();
function mat(color: string, o: MatOpts = {}): THREE.Material {
  const key = `${color}|${JSON.stringify(o)}`;
  let m = mats.get(key);
  if (!m) {
    const s = new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? (o.metal ? 0.32 : 0.75),
      metalness: o.metal ? 0.85 : 0,
      emissive: o.emissive ?? '#000000',
      emissiveIntensity: o.emissiveIntensity ?? 1,
      side: o.side ?? THREE.FrontSide,
      vertexColors: o.vertexColors ?? false,
    });
    if (o.metal) {
      s.envMap = characterEnv();
      s.envMapIntensity = 0.9;
    }
    if (o.opacity !== undefined) {
      s.transparent = true;
      s.opacity = o.opacity;
      s.depthWrite = false;
    }
    m = s;
    mats.set(key, m);
  }
  return m;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const out = new THREE.Mesh(g, m);
  out.castShadow = true;
  return out;
}

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const now = () => performance.now() / 1000;

/** A tube that tapers from r0 to r1 along the curve; `ridges` adds growth rings (horns). */
function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segs = 20, radial = 8, ridges = 0): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    let r = r0 + (r1 - r0) * Math.pow(t, 0.85);
    if (ridges) r *= 1 + 0.13 * Math.max(0, Math.sin(t * ridges * Math.PI * 2));
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      pos.setXYZ(k, p.x + nrm.getX(k) * r, p.y + nrm.getY(k) * r, p.z + nrm.getZ(k) * r);
    }
  }
  return g;
}

/** Paints a gradient along a tube (base -> tip) into a vertex colour attribute. */
function gradeTube(g: THREE.BufferGeometry, segs: number, radial: number, base: string, tip: string): THREE.BufferGeometry {
  const a = new THREE.Color(base);
  const b = new THREE.Color(tip);
  const c = new THREE.Color();
  const cols = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i <= segs; i++) {
    c.copy(a).lerp(b, Math.pow(i / segs, 1.6));
    for (let j = 0; j <= radial; j++) c.toArray(cols, (i * (radial + 1) + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function extrude(shape: THREE.Shape, depth: number, bevel: number, curveSegments = 10): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

function mirrored(make: (side: 1 | -1) => THREE.Object3D): THREE.Object3D[] {
  return [make(1), make(-1)];
}

// ------------------------------------------------------------------ elves

function elfEar(skin: string, side: 1 | -1): THREE.Object3D {
  const outer = geo('ear', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.11);
    s.quadraticCurveTo(0.3, -0.12, 0.62, 0.16);
    s.quadraticCurveTo(0.32, 0.12, 0.02, 0.13);
    s.quadraticCurveTo(-0.04, 0.01, 0, -0.11);
    return extrude(s, 0.04, 0.018);
  });
  const inner = geo('earInner', () => {
    const s = new THREE.Shape();
    s.moveTo(0.06, -0.05);
    s.quadraticCurveTo(0.3, -0.06, 0.5, 0.12);
    s.quadraticCurveTo(0.3, 0.07, 0.07, 0.07);
    s.closePath();
    return extrude(s, 0.02, 0.006);
  });
  const g = new THREE.Group();
  const shade = new THREE.Color(skin).multiplyScalar(0.82).getStyle();
  g.add(mesh(outer, mat(skin, { roughness: 0.6, side: THREE.DoubleSide })));
  const i = mesh(inner, mat(shade, { roughness: 0.7, side: THREE.DoubleSide }));
  i.position.z = 0.03;
  g.add(i);
  g.position.set(side * 0.48, 0.52, -0.06);
  g.rotation.set(0, side === 1 ? -0.5 : Math.PI + 0.5, 0.42);
  g.scale.setScalar(0.72);
  return g;
}

function recurveBow(): THREE.Object3D {
  const limb = geo('bowLimb', () => {
    const c = new THREE.CatmullRomCurve3([v(0.07, -0.62), v(0.02, -0.52), v(-0.08, -0.32), v(-0.15, -0.08), v(-0.15, 0.08), v(-0.08, 0.32), v(0.02, 0.52), v(0.07, 0.62)]);
    return gradeTube(taperedTube(c, 0.038, 0.016, 32, 6), 32, 6, '#5a3518', '#9a6a3a');
  });
  const grip = geo('bowGrip', () => new THREE.CylinderGeometry(0.048, 0.048, 0.2, 8));
  const string = geo('bowString', () => new THREE.CylinderGeometry(0.006, 0.006, 1.24, 3));
  const tip = geo('bowTip', () => new THREE.ConeGeometry(0.03, 0.08, 6));
  const g = new THREE.Group();
  g.add(mesh(limb, mat('#ffffff', { vertexColors: true, roughness: 0.55 })));
  const gr = mesh(grip, mat('#3b2414', { roughness: 0.9 }));
  gr.position.x = -0.15;
  g.add(gr);
  const st = mesh(string, mat('#f1efe7'));
  st.position.x = 0.07;
  g.add(st);
  for (const y of [-1, 1]) {
    const t = mesh(tip, mat('#d4b25a', { metal: true }));
    t.position.set(0.075, y * 0.65, 0);
    t.rotation.z = y === 1 ? 0 : Math.PI;
    g.add(t);
  }
  g.rotation.y = Math.PI / 2;
  g.position.set(0, 0.05, 0.05);
  return g;
}

function leafCluster(colors: string[], scale: number, seed: number): THREE.Object3D {
  const leaf = geo('leaf', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.13, 0.08, 0.15, 0.3, 0, 0.44);
    s.bezierCurveTo(-0.15, 0.3, -0.13, 0.08, 0, 0);
    const g = extrude(s, 0.012, 0.008, 8);
    // Fold along the midrib so the leaf catches light on two planes.
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, p.getZ(k) + Math.abs(p.getX(k)) * 0.35);
    g.computeVertexNormals();
    return g;
  });
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const l = mesh(leaf, mat(colors[(k + seed) % colors.length], { roughness: 0.65, side: THREE.DoubleSide }));
    l.rotation.set(-0.5 + k * 0.15, (seed + k) * 1.3, (k - 1) * 0.75);
    l.scale.setScalar(scale * (0.85 + ((seed + k) % 3) * 0.12));
    g.add(l);
  }
  return g;
}

// ------------------------------------------------------------------ angels

const featherGeo = () =>
  geo('feather', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.07);
    s.quadraticCurveTo(0.5, -0.15, 0.96, -0.06);
    s.quadraticCurveTo(1.05, 0.0, 0.95, 0.06);
    s.quadraticCurveTo(0.5, 0.13, 0, 0.07);
    s.closePath();
    const g = extrude(s, 0.018, 0.01, 8);
    // A gentle downward curve along the vane.
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, p.getZ(k) - p.getX(k) * p.getX(k) * 0.08);
    g.computeVertexNormals();
    return g;
  });

/** One feathered wing on the +x side: primaries fanning out under a row of shorter coverts. */
function featherWing(primary: string, covert: string): THREE.Group {
  const g = new THREE.Group();
  const arm = new THREE.CatmullRomCurve3([v(0.02, 0.08), v(0.3, 0.32), v(0.62, 0.52), v(0.88, 0.62)]);
  const fp = mat(primary, { emissive: '#2a2618', roughness: 0.6, side: THREE.DoubleSide });
  const fc = mat(covert, { emissive: '#2a2618', roughness: 0.6, side: THREE.DoubleSide });
  const n = 11;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const p = arm.getPointAt(0.1 + t * 0.9);
    const f = mesh(featherGeo(), fp);
    f.position.set(p.x, p.y, -0.01 * k);
    f.rotation.z = -1.6 + t * 1.25;
    f.scale.set(0.5 + t * 0.45, 1.5, 1);
    g.add(f);
  }
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const p = arm.getPointAt(0.04 + t * 0.9);
    const f = mesh(featherGeo(), fc);
    f.position.set(p.x, p.y + 0.02, 0.03);
    f.rotation.z = -1.45 + t * 1.15;
    f.scale.set(0.28 + t * 0.2, 1.7, 1.2);
    g.add(f);
  }
  const edge = geo('wingEdge', () => taperedTube(arm, 0.06, 0.025, 16, 6));
  g.add(mesh(edge, fc));
  return g;
}

function angelWings(size: number, primary: string, covert: string): THREE.Group {
  const g = new THREE.Group();
  for (const side of [1, -1]) {
    const w = featherWing(primary, covert);
    w.scale.set(side * size, size, size);
    w.position.set(side * 0.15, 0.15, -0.3);
    w.rotation.y = side * 0.5;
    g.add(w);
  }
  return g;
}

function halo(): THREE.Object3D {
  const ring = geo('halo', () => new THREE.TorusGeometry(0.32, 0.034, 10, 40));
  const glowGeo = geo('haloGlow', () => new THREE.RingGeometry(0.2, 0.46, 40));
  const g = new THREE.Group();
  const r = mesh(ring, mat('#ffe27a', { emissive: '#e0a821', emissiveIntensity: 1.4, metal: true }));
  r.castShadow = false;
  const glow = new THREE.Mesh(
    glowGeo,
    new THREE.MeshBasicMaterial({ color: '#ffe9a6', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  g.add(r, glow);
  g.rotation.x = Math.PI / 2;
  g.position.set(0, 1.25, 0);
  const phase = Math.random() * 6;
  r.onBeforeRender = () => {
    const t = now() + phase;
    g.position.y = 1.25 + Math.sin(t * 2) * 0.03;
    g.rotation.z = t * 0.6;
    glow.material.opacity = 0.22 + Math.sin(t * 3) * 0.08;
  };
  return g;
}

// ------------------------------------------------------------------ horns and bat wings (dwarf helms and enemy bosses)

function horn(big: boolean, side: 1 | -1): THREE.Object3D {
  const key = big ? 'hornBig' : 'horn';
  const g = geo(key, () => {
    const pts = big
      ? [v(0, 0, 0), v(0.16, 0.14, -0.06), v(0.34, 0.26, -0.04), v(0.46, 0.46, 0.08), v(0.42, 0.66, 0.22)]
      : [v(0, 0, 0), v(0.07, 0.16, -0.04), v(0.12, 0.31, 0), v(0.09, 0.44, 0.09)];
    const segs = big ? 28 : 18;
    return gradeTube(taperedTube(new THREE.CatmullRomCurve3(pts), big ? 0.13 : 0.08, 0.006, segs, 8, big ? 6 : 4), segs, 8, '#1a100e', '#d8c7a4');
  });
  const m = mesh(g, mat('#ffffff', { vertexColors: true, roughness: 0.45 }));
  m.scale.x = side;
  m.position.set(side * (big ? 0.3 : 0.26), big ? 0.82 : 0.8, 0.02);
  return m;
}

/** One bat wing on the +x side: finger bones with a scalloped membrane stretched between them. */
function batWing(): THREE.Group {
  const wrist = v(0.45, 0.4);
  const fingers = [v(1.02, 0.58), v(0.98, 0.08), v(0.72, -0.34)];
  const body = v(0.1, -0.22);
  const membrane = geo('batMembrane', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(wrist.x, wrist.y);
    s.lineTo(fingers[0].x, fingers[0].y);
    const scallop = (a: THREE.Vector3, b: THREE.Vector3) => {
      const mid = a.clone().add(b).multiplyScalar(0.5).lerp(wrist, 0.32);
      s.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
    };
    scallop(fingers[0], fingers[1]);
    scallop(fingers[1], fingers[2]);
    scallop(fingers[2], body);
    s.lineTo(0, 0);
    return extrude(s, 0.008, 0, 12);
  });
  const bones = geo('batBones', () => {
    const parts = [taperedTube(new THREE.LineCurve3(v(0, 0), wrist), 0.04, 0.03, 4, 6), ...fingers.map((f) => taperedTube(new THREE.LineCurve3(wrist, f), 0.028, 0.008, 6, 5))];
    const merged = mergeGeometries(parts);
    return merged;
  });
  const claw = geo('batClaw', () => new THREE.ConeGeometry(0.035, 0.14, 5));
  const g = new THREE.Group();
  g.add(mesh(membrane, mat('#5c0f1f', { emissive: '#1a0206', roughness: 0.55, side: THREE.DoubleSide, opacity: 0.92 })));
  g.add(mesh(bones, mat('#231014', { roughness: 0.5 })));
  const c = mesh(claw, mat('#d8c7a4', { roughness: 0.4 }));
  c.position.copy(wrist).add(v(0, 0.06));
  c.rotation.z = 0.4;
  g.add(c);
  return g;
}

function batWings(size: number): THREE.Group {
  const g = new THREE.Group();
  for (const side of [1, -1]) {
    const w = batWing();
    w.scale.set(side * size, size, size);
    w.position.set(side * 0.15, 0.2, -0.32);
    w.rotation.y = side * 0.45;
    g.add(w);
  }
  return g;
}

/** Concatenates non-indexed copies of several geometries (positions, normals and vertex colours). */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const count = flat.reduce((n, p) => n + p.attributes.position.count, 0);
  const withColor = flat.every((p) => p.attributes.color);
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const col = withColor ? new Float32Array(count * 3) : null;
  let off = 0;
  for (const p of flat) {
    pos.set(p.attributes.position.array as Float32Array, off * 3);
    nrm.set(p.attributes.normal.array as Float32Array, off * 3);
    col?.set(p.attributes.color.array as Float32Array, off * 3);
    off += p.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Swaps two corners of every triangle (a mirrored copy would otherwise face inwards). */
function flipWinding(g: THREE.BufferGeometry): void {
  for (const name of ['position', 'normal', 'color']) {
    const a = g.attributes[name];
    if (!a) continue;
    for (let t = 0; t < a.count; t += 3) {
      for (let c = 0; c < 3; c++) {
        const tmp = a.getComponent(t + 1, c);
        a.setComponent(t + 1, c, a.getComponent(t + 2, c));
        a.setComponent(t + 2, c, tmp);
      }
    }
  }
}

const bakedParts = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }[]>();

/**
 * Builds a static accessory once and merges its meshes per material, so every unit wearing it
 * costs a couple of draw calls instead of dozens. The returned group keeps the root placement.
 */
function bake(key: string, build: () => THREE.Object3D): THREE.Object3D {
  const src = build();
  let parts = bakedParts.get(key);
  if (!parts) {
    const keep = { p: src.position.clone(), q: src.quaternion.clone(), s: src.scale.clone() };
    src.position.set(0, 0, 0);
    src.quaternion.identity();
    src.scale.set(1, 1, 1);
    src.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      if (m.matrixWorld.determinant() < 0) flipWinding(g);
      const mt = m.material as THREE.Material;
      byMat.set(mt, [...(byMat.get(mt) ?? []), g]);
    });
    parts = [...byMat].map(([material, gs]) => ({ geometry: mergeGeometries(gs), material }));
    bakedParts.set(key, parts);
    src.position.copy(keep.p);
    src.quaternion.copy(keep.q);
    src.scale.copy(keep.s);
  }
  const out = new THREE.Group();
  out.position.copy(src.position);
  out.quaternion.copy(src.quaternion);
  out.scale.copy(src.scale);
  for (const p of parts) out.add(mesh(p.geometry, p.material));
  return out;
}

// ------------------------------------------------------------------ dwarves

function dwarfBeard(): THREE.Object3D {
  const beard = geo('beard', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.44, 0.22);
    s.quadraticCurveTo(-0.48, -0.2, -0.22, -0.5);
    s.lineTo(-0.1, -0.4);
    s.lineTo(0, -0.66);
    s.lineTo(0.1, -0.4);
    s.lineTo(0.22, -0.5);
    s.quadraticCurveTo(0.48, -0.2, 0.44, 0.22);
    s.quadraticCurveTo(0.22, 0.02, 0, 0.04);
    s.quadraticCurveTo(-0.22, 0.02, -0.44, 0.22);
    const g = extrude(s, 0.2, 0.07, 12);
    // Round the front so it hugs the jaw instead of reading as a flat plate.
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, p.getZ(k) - p.getX(k) * p.getX(k) * 0.6);
    g.computeVertexNormals();
    return g;
  });
  const stache = geo('moustache', () =>
    taperedTube(new THREE.CatmullRomCurve3([v(0, 0, 0), v(0.16, -0.02, 0.02), v(0.3, -0.1, -0.02), v(0.36, -0.24, -0.06)]), 0.06, 0.018, 14, 6),
  );
  const braid = geo('braid', () => new THREE.SphereGeometry(0.07, 8, 6));
  const bead = geo('bead', () => new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10));
  const hair = mat('#b9541f', { roughness: 0.85 });
  const dark = mat('#8a3a14', { roughness: 0.85 });
  const g = new THREE.Group();
  const b = mesh(beard, hair);
  g.add(b);
  for (const side of [1, -1]) {
    const m = mesh(stache, dark);
    m.scale.x = side;
    m.position.set(0, 0.06, 0.16);
    g.add(m);
    for (let k = 0; k < 3; k++) {
      const s = mesh(braid, k % 2 ? dark : hair);
      s.position.set(side * 0.2, -0.5 - k * 0.1, 0.02);
      s.scale.set(1, 1.25, 1);
      g.add(s);
    }
    const bd = mesh(bead, mat('#d4a640', { metal: true }));
    bd.position.set(side * 0.2, -0.82, 0.02);
    g.add(bd);
  }
  g.position.set(0, 0.16, 0.38);
  g.rotation.x = -0.12;
  return g;
}

function dwarfHelm(metalColor: string): THREE.Object3D {
  const dome = geo('helmDome', () => new THREE.SphereGeometry(0.56, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2));
  const brim = geo('helmBrim', () => new THREE.TorusGeometry(0.56, 0.06, 8, 28));
  const crest = geo('helmCrest', () => new THREE.TorusGeometry(0.56, 0.045, 6, 20, Math.PI));
  const nasal = geo('helmNasal', () => new THREE.BoxGeometry(0.1, 0.34, 0.06));
  const rivet = geo('rivet', () => new THREE.SphereGeometry(0.035, 6, 4));
  const steel = mat(metalColor, { metal: true });
  const trim = mat('#d4a640', { metal: true });
  const g = new THREE.Group();
  g.add(mesh(dome, steel));
  const b = mesh(brim, trim);
  b.rotation.x = Math.PI / 2;
  g.add(b);
  const c = mesh(crest, trim);
  c.rotation.y = Math.PI / 2;
  g.add(c);
  const n = mesh(nasal, trim);
  n.position.set(0, -0.12, 0.57);
  g.add(n);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const r = mesh(rivet, trim);
    r.position.set(Math.sin(a) * 0.6, 0.02, Math.cos(a) * 0.6);
    g.add(r);
  }
  for (const side of [1, -1]) {
    const h = horn(false, side as 1 | -1);
    h.position.set(side * 0.5, 0.15, 0);
    h.rotation.z = -side * 0.6;
    h.scale.multiplyScalar(0.8);
    g.add(h);
  }
  g.position.set(0, 0.72, 0);
  g.scale.set(1.02, 0.95, 1.02);
  return g;
}

function runeHammer(): THREE.Object3D {
  const handle = geo('hammerHandle', () => new THREE.CylinderGeometry(0.035, 0.04, 0.8, 8));
  const wrap = geo('hammerWrap', () => new THREE.TorusGeometry(0.043, 0.012, 4, 10));
  const head = geo('hammerHead', () => {
    const s = new THREE.Shape();
    const w = 0.2;
    const h = 0.11;
    s.moveTo(-w, -h + 0.03);
    s.lineTo(-w, h - 0.03);
    s.lineTo(-w + 0.03, h);
    s.lineTo(w - 0.03, h);
    s.lineTo(w, h - 0.03);
    s.lineTo(w, -h + 0.03);
    s.lineTo(w - 0.03, -h);
    s.lineTo(-w + 0.03, -h);
    s.closePath();
    return extrude(s, 0.18, 0.02, 1);
  });
  const band = geo('hammerBand', () => new THREE.BoxGeometry(0.06, 0.26, 0.22));
  const rune = geo('hammerRune', () => new THREE.PlaneGeometry(0.1, 0.12));
  const g = new THREE.Group();
  g.add(mesh(handle, mat('#6b3f1f', { roughness: 0.85 })));
  for (let k = 0; k < 4; k++) {
    const w = mesh(wrap, mat('#3b2414', { roughness: 0.9 }));
    w.rotation.x = Math.PI / 2;
    w.position.y = -0.3 + k * 0.07;
    g.add(w);
  }
  const hd = mesh(head, mat('#6b7280', { metal: true }));
  hd.position.y = 0.4;
  g.add(hd);
  for (const x of [-0.12, 0.12]) {
    const b = mesh(band, mat('#d4a640', { metal: true }));
    b.position.set(x, 0.4, 0);
    g.add(b);
  }
  for (const z of [1, -1]) {
    const r = new THREE.Mesh(rune, mat('#7dd3fc', { emissive: '#38bdf8', emissiveIntensity: 1.6, side: THREE.DoubleSide }));
    r.position.set(0, 0.4, z * 0.115);
    g.add(r);
  }
  g.position.y = 0.22;
  return g;
}

function steamChimney(): THREE.Object3D {
  const pipe = geo('chimney', () => new THREE.CylinderGeometry(0.12, 0.15, 0.7, 12));
  const rim = geo('chimneyRim', () => new THREE.TorusGeometry(0.135, 0.035, 6, 16));
  const rivet = geo('rivet', () => new THREE.SphereGeometry(0.035, 6, 4));
  const g = new THREE.Group();
  g.add(mesh(pipe, mat('#4b4f57', { metal: true, roughness: 0.5 })));
  for (const y of [-0.3, 0.05]) {
    const band = mesh(rim, mat('#b45309', { metal: true }));
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = mesh(rivet, mat('#d4a640', { metal: true }));
      r.position.set(Math.sin(a) * 0.15, y, Math.cos(a) * 0.15);
      r.scale.setScalar(0.7);
      g.add(r);
    }
  }
  const glow = mesh(rim, mat('#f97316', { emissive: '#f97316', emissiveIntensity: 1.6 }));
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.36;
  g.add(glow);
  // Rising puffs of steam, cycled by time so every golem breathes on its own beat.
  const puffMat = new THREE.SpriteMaterial({ map: puffTexture(), color: '#d9dde3', transparent: true, depthWrite: false });
  const puffs: THREE.Sprite[] = [];
  for (let k = 0; k < 4; k++) {
    const p = new THREE.Sprite(puffMat.clone());
    g.add(p);
    puffs.push(p);
  }
  const phase = Math.random() * 4;
  glow.onBeforeRender = () => {
    const t = now() + phase;
    puffs.forEach((p, k) => {
      const f = (t * 0.55 + k / puffs.length) % 1;
      p.position.set(Math.sin((t + k) * 1.7) * 0.05, 0.42 + f * 0.9, -f * 0.2);
      p.scale.setScalar(0.18 + f * 0.45);
      p.material.opacity = 0.55 * (1 - f) * Math.min(1, f * 5);
    });
  };
  g.position.set(0.2, 0.55, -0.4);
  return g;
}

// ------------------------------------------------------------------ humans

function spear(): THREE.Object3D {
  const shaft = geo('spearShaft', () => new THREE.CylinderGeometry(0.032, 0.036, 2.1, 8));
  const blade = geo('spearBlade', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.11, 0.1, 0.07, 0.24);
    s.lineTo(0, 0.44);
    s.lineTo(-0.07, 0.24);
    s.quadraticCurveTo(-0.11, 0.1, 0, 0);
    return extrude(s, 0.02, 0.012, 8);
  });
  const collar = geo('spearCollar', () => new THREE.CylinderGeometry(0.05, 0.04, 0.12, 10));
  const grip = geo('spearGrip', () => new THREE.TorusGeometry(0.04, 0.012, 4, 10));
  const tassel = geo('tassel', () => new THREE.ConeGeometry(0.03, 0.26, 5));
  const g = new THREE.Group();
  g.add(mesh(shaft, mat('#7c4a24', { roughness: 0.8 })));
  for (let k = 0; k < 3; k++) {
    const w = mesh(grip, mat('#3b2414', { roughness: 0.9 }));
    w.rotation.x = Math.PI / 2;
    w.position.y = -0.1 + k * 0.06;
    g.add(w);
  }
  const c = mesh(collar, mat('#d4a640', { metal: true }));
  c.position.y = 1.06;
  g.add(c);
  const b = mesh(blade, mat('#dfe5ec', { metal: true }));
  b.position.y = 1.1;
  b.scale.setScalar(1.35);
  g.add(b);
  for (let k = 0; k < 5; k++) {
    const t = mesh(tassel, mat('#b91c1c', { roughness: 0.9 }));
    const a = (k / 5) * Math.PI * 2;
    t.position.set(Math.sin(a) * 0.03, 0.92, Math.cos(a) * 0.03);
    t.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25 + Math.PI);
    g.add(t);
  }
  g.position.y = 0.35;
  return g;
}

function royalBanner(team: string): THREE.Object3D {
  const pole = geo('bannerPole', () => new THREE.CylinderGeometry(0.03, 0.035, 1.9, 8));
  const bar = geo('bannerBar', () => new THREE.CylinderGeometry(0.022, 0.022, 0.7, 6));
  const finial = geo('bannerFinial', () => new THREE.ConeGeometry(0.06, 0.16, 8));
  const knob = geo('bannerKnob', () => new THREE.SphereGeometry(0.055, 10, 8));
  const emblem = geo('bannerEmblem', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.18);
    s.quadraticCurveTo(0.15, -0.08, 0.14, 0.12);
    s.lineTo(-0.14, 0.12);
    s.quadraticCurveTo(-0.15, -0.08, 0, -0.18);
    return extrude(s, 0.01, 0.006, 8);
  });
  const fringe = geo('bannerFringe', () => new THREE.CylinderGeometry(0.008, 0.008, 0.08, 3));
  // Swallow-tailed cloth with its own geometry per banner so it can ripple independently.
  const cloth = new THREE.PlaneGeometry(0.62, 0.85, 8, 10);
  const base = (cloth.attributes.position.array as Float32Array).slice();
  for (let k = 0; k < base.length; k += 3) {
    const y = base[k + 1];
    const x = base[k] + 0.31;
    if (y < -0.25) base[k + 1] = y + Math.max(0, 0.18 - Math.abs(x - 0.31) * 0.6) * ((y + 0.25) / -0.18);
  }
  cloth.attributes.position.array.set(base);
  const flag = mesh(cloth, mat(team, { emissive: '#06102a', roughness: 0.85, side: THREE.DoubleSide }));
  flag.position.set(0.33, 0.45, 0);
  const phase = Math.random() * 6;
  flag.onBeforeRender = () => {
    const t = now() + phase;
    const p = cloth.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = base[k * 3] + 0.31;
      p.setZ(k, Math.sin(x * 7 - t * 4) * 0.05 * x * 1.6);
    }
    p.needsUpdate = true;
    cloth.computeVertexNormals();
  };
  const gold = mat('#e2b34a', { metal: true });
  const g = new THREE.Group();
  g.add(mesh(pole, mat('#5a2d0c', { roughness: 0.8 })));
  const cb = mesh(bar, gold);
  cb.rotation.z = Math.PI / 2;
  cb.position.set(0.33, 0.88, 0);
  const fn = mesh(finial, gold);
  fn.position.y = 1.03;
  const kn = mesh(knob, gold);
  kn.position.y = 0.95;
  const em = mesh(emblem, gold);
  em.position.set(0.33, 0.52, 0.04);
  g.add(flag, cb, fn, kn, em);
  for (let k = 0; k < 7; k++) {
    const f = mesh(fringe, gold);
    f.position.set(0.05 + k * 0.095, 0.0 - Math.max(0, 0.18 - Math.abs(k * 0.095 + 0.05 - 0.33) * 0.6) - 0.02, 0);
    g.add(f);
  }
  g.position.set(-0.25, 0.7, -0.35);
  return g;
}

// ------------------------------------------------------------------ enemy-only extras

function crown(): THREE.Object3D {
  const g = new THREE.Group();
  const gold = mat('#facc15', { emissive: '#713f12', metal: true, side: THREE.DoubleSide });
  g.add(mesh(geo('crownBand', () => new THREE.CylinderGeometry(0.36, 0.36, 0.18, 14, 1, true)), gold));
  for (let k = 0; k < 5; k++) {
    const sp = mesh(geo('crownSpike', () => new THREE.ConeGeometry(0.07, 0.22, 4)), gold);
    const a = (k / 5) * Math.PI * 2;
    sp.position.set(Math.cos(a) * 0.33, 0.18, Math.sin(a) * 0.33);
    g.add(sp);
  }
  g.position.set(0, 0.98, 0);
  return g;
}

export function addExtras(root: THREE.Object3D, extras: Extra[], palette: string | undefined): void {
  const head = root.getObjectByName('head');
  const chest = root.getObjectByName('chest');
  const handR = root.getObjectByName('handslotr') ?? root.getObjectByName('handslot.r');
  const handL = root.getObjectByName('handslotl') ?? root.getObjectByName('handslot.l');
  const skin = paletteSkin(palette, '#f6d2b8');
  const pal = palette ? PALETTES[palette] : undefined;
  for (const ex of extras) {
    switch (ex) {
      case 'wings':
        chest?.add(bake('wings', () => angelWings(1.0, '#fbfaf3', '#fff4d6')));
        break;
      case 'bigWings':
        chest?.add(
          bake('bigWings', () => {
            const g = new THREE.Group();
            const lower = angelWings(0.85, '#fde68a', '#fff4d6');
            lower.position.y = -0.3;
            g.add(angelWings(1.3, '#fffaf0', '#ffe9a8'), lower);
            return g;
          }),
        );
        break;
      case 'batWings':
        chest?.add(bake('batWings', () => batWings(0.95)));
        break;
      case 'halo':
        head?.add(halo());
        break;
      case 'horns':
      case 'bigHorns':
        head?.add(...mirrored((side) => horn(ex === 'bigHorns', side)));
        break;
      case 'ears':
        head?.add(...mirrored((side) => bake(`ear:${skin}:${side}`, () => elfEar(skin, side))));
        break;
      case 'goblinEars': {
        const g = geo('goblinEar', () => new THREE.ConeGeometry(0.11, 0.7, 5));
        for (const side of [-1, 1]) {
          const e = mesh(g, mat(skin));
          e.position.set(side * 0.62, 0.55, -0.05);
          e.rotation.z = -side * 1.35;
          e.rotation.y = side * 0.25;
          head?.add(e);
        }
        break;
      }
      case 'tusks': {
        const g = geo('tusk', () => new THREE.ConeGeometry(0.06, 0.26, 6));
        for (const side of [-1, 1]) {
          const t = mesh(g, mat('#f5f0e1'));
          t.position.set(side * 0.18, 0.18, 0.5);
          t.rotation.x = -0.25;
          t.rotation.z = side * 0.2;
          head?.add(t);
        }
        break;
      }
      case 'beard':
        head?.add(bake('beard', dwarfBeard));
        break;
      case 'dwarfHelm': {
        const metal = pal?.metal ?? '#b7c3d0';
        head?.add(bake(`helm:${metal}`, () => dwarfHelm(metal)));
        break;
      }
      case 'leaves': {
        const greens = ['#3f8f2a', '#5bb33d', '#2f6f22'];
        const spots: [number, number, number, number, THREE.Object3D | undefined][] = [
          [0, 1.02, 0, 1.1, head],
          [0.28, 0.9, -0.1, 0.9, head],
          [-0.28, 0.92, 0.05, 0.95, head],
          [0.45, 0.35, 0, 0.8, chest],
          [-0.45, 0.35, 0, 0.8, chest],
        ];
        spots.forEach(([x, y, z, s, parent], k) => {
          const c = bake(`leaves:${k}:${s}`, () => leafCluster(greens, s, k));
          c.position.set(x, y, z);
          parent?.add(c);
        });
        break;
      }
      case 'chimney':
        chest?.add(steamChimney());
        break;
      case 'crown':
        head?.add(crown());
        break;
      case 'spear':
        handR?.add(bake('spear', spear));
        break;
      case 'bow':
        handL?.add(bake('bow', recurveBow));
        break;
      case 'hammer':
        handR?.add(bake('hammer', runeHammer));
        break;
      case 'banner':
        chest?.add(royalBanner(pal?.team ?? '#1d4ed8'));
        break;
    }
  }
}
