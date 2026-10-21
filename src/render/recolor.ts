import * as THREE from 'three';
import type { CharacterBase, RaceId } from '../game/types';

/** Building atlas: the team-coloured parts sample the bottom-left cell of the palette texture. */
const BUILDING_TEAM: Record<RaceId | 'shadow', [string, string] | null> = {
  shadow: ['#5b5266', '#1a1420'],
  human: null,
  elf: ['#6fe08c', '#14532d'],
  dwarf: ['#ffd27a', '#b4441a'],
  angel: ['#ffffff', '#d9b54a'],
};

function imageToCanvas(image: CanvasImageSource & { width: number; height: number }, size?: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size ?? image.width;
  c.height = size ?? image.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, c.width, c.height);
  return c;
}

function canvasTexture(canvas: HTMLCanvasElement, like: THREE.Texture): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = like.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = like.wrapS;
  t.wrapT = like.wrapT;
  t.magFilter = like.magFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const buildingMats = new Map<string, THREE.Material>();

/** Returns a material for buildings of a race, recolouring the shared atlas once per race. */
export function buildingMaterial(original: THREE.Material, race: RaceId | 'shadow'): THREE.Material {
  const key = `${original.uuid}:${race}`;
  const cached = buildingMats.get(key);
  if (cached) return cached;
  const src = original as THREE.MeshStandardMaterial;
  const colors = BUILDING_TEAM[race];
  let mat: THREE.Material = original;
  if (colors && src.map?.image) {
    const img = src.map.image as HTMLImageElement;
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d')!;
    const cell = canvas.width / 8;
    const grad = ctx.createLinearGradient(0, canvas.height - cell * 2, 0, canvas.height);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, canvas.height - cell * 2, cell, cell * 2);
    const clone = src.clone();
    clone.map = canvasTexture(canvas, src.map);
    mat = clone;
  }
  buildingMats.set(key, mat);
  return mat;
}

export interface Palette {
  team?: string;
  accent?: string;
  /** Armour and blade steel. */
  metal?: string;
  skin?: string;
  tint?: string;
  emissive?: string;
  opacity?: number;
}

export const PALETTES: Record<string, Palette> = {
  human: { team: '#2f6fd6', accent: '#e8c05a', metal: '#b7c3d0' },
  priest: { team: '#f4f4f5', accent: '#3b82f6' },
  royal: { team: '#1d4ed8', accent: '#facc15', metal: '#c8d2de' },
  elf: { team: '#1f7a3a', accent: '#d4b25a', metal: '#c3d3b4', skin: '#f6dcc0' },
  druid: { team: '#4a6618', accent: '#8b5a2b', skin: '#f6dcc0' },
  wind: { team: '#0b8073', accent: '#e5e7eb', metal: '#b9d6d0', skin: '#f6dcc0' },
  moon: { team: '#7c86e0', accent: '#6366f1', metal: '#d6dcf5', skin: '#f3e3d8' },
  treant: { team: '#3f7d2a', accent: '#6b4423', skin: '#7a5230', tint: '#c7ab7f' },
  dwarf: { team: '#d97706', accent: '#92400e', metal: '#dba25e' },
  engineer: { team: '#b45309', accent: '#fbbf24', metal: '#b98d5a' },
  rune: { team: '#2563eb', accent: '#93c5fd', metal: '#9fb2c8' },
  metal: { team: '#57534e', accent: '#f59e0b', metal: '#8f949b', skin: '#9ca3af', tint: '#c9ccd1' },
  angel: { team: '#fafafa', accent: '#facc15', metal: '#e4d8b8', skin: '#ffe9dc' },
  aegis: { team: '#e0f2fe', accent: '#60a5fa', metal: '#e3ecf6', skin: '#ffe9dc' },
  judicator: { team: '#fde68a', accent: '#f59e0b', metal: '#f0d58a', skin: '#ffe9dc' },
  seraph: { team: '#fffbeb', accent: '#fbbf24', metal: '#f3e2b0', skin: '#ffe9dc', emissive: '#3a2a08' },
  ghost: { tint: '#a5ecff', emissive: '#1f6a80', opacity: 0.55 },
  toxic: { tint: '#a8e070', emissive: '#1b3300' },
  necro: { tint: '#c4a7ff', emissive: '#14002a' },
  brute: { tint: '#d9b38c' },
  dark: { team: '#4c1d95', accent: '#1f2937', skin: '#94a3b8', tint: '#9a90b0' },
  king: { tint: '#ffe08a', emissive: '#3a2a00' },
  lich: { tint: '#b794f4', emissive: '#2a0a4a' },
  deathknight: { team: '#7f1d1d', accent: '#111827', skin: '#475569', tint: '#8a7a7a', emissive: '#200000' },
  // Campaign factions.
  goblin: { team: '#6b4a2b', accent: '#a8a29e', skin: '#7cc04b' },
  goblinShaman: { team: '#4d7c0f', accent: '#facc15', skin: '#7cc04b' },
  troll: { team: '#57534e', accent: '#3f3f46', skin: '#6f9c8a', tint: '#c3d1bf' },
  goblinKing: { team: '#b45309', accent: '#facc15', skin: '#7cc04b', emissive: '#1a1000' },
  orc: { team: '#44403c', accent: '#991b1b', skin: '#5f8f3a' },
  orcShaman: { team: '#7c2d12', accent: '#fbbf24', skin: '#5f8f3a' },
  orcBoss: { team: '#1c1917', accent: '#dc2626', skin: '#4f7d2e', emissive: '#140400' },
  orcAlly: { team: '#1d4ed8', accent: '#facc15', skin: '#5f8f3a' },
  rebel: { team: '#57534e', accent: '#9f1239' },
  assassin: { team: '#1f2937', accent: '#9f1239' },
  usurper: { team: '#581c87', accent: '#facc15', emissive: '#12001f' },
  demonlord: { team: '#0c0a09', accent: '#f97316', skin: '#7f1d1d', tint: '#e5b8a8', emissive: '#3a0800' },
  mercenary: { team: '#92400e', accent: '#d6d3d1' },
};

/** Skin colour used for model extras (ears, tusks...) so they match the palette. */
export function paletteSkin(paletteId: string | undefined, fallback: string): string {
  return (paletteId && PALETTES[paletteId]?.skin) || fallback;
}

type HueRange = [number, number, number];
/** Hue ranges (deg) + min saturation that count as clothing in each character texture. */
const CLOTH: Partial<Record<CharacterBase, { team: HueRange[]; accent: HueRange[] }>> = {
  Knight: { team: [[330, 15, 0.4]], accent: [[40, 60, 0.5]] },
  Barbarian: { team: [[190, 230, 0.15]], accent: [[35, 50, 0.5]] },
  Mage: { team: [[235, 275, 0.15]], accent: [[310, 345, 0.4]] },
  Rogue: { team: [[125, 180, 0.3]], accent: [[60, 100, 0.3]] },
  Rogue_Hooded: { team: [[125, 180, 0.3]], accent: [[60, 100, 0.3]] },
};

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function inRange(h: number, s: number, ranges: HueRange[]): boolean {
  return ranges.some(([a, b, smin]) => s >= smin && (a <= b ? h >= a && h <= b : h >= a || h <= b));
}

/** Reshade a pixel to the target colour keeping its relative brightness (softened so light colours don't blow out). */
function reshade(l: number, target: THREE.Color, refL: number): [number, number, number] {
  const hsl = { h: 0, s: 0, l: 0 };
  target.getHSL(hsl, THREE.SRGBColorSpace);
  const nl = Math.min(0.97, Math.max(0.03, hsl.l * Math.pow(l / refL, 0.7)));
  const c = new THREE.Color().setHSL(hsl.h, hsl.s, nl, THREE.SRGBColorSpace);
  const rgb = { r: 0, g: 0, b: 0 };
  c.getRGB(rgb, THREE.SRGBColorSpace);
  return [rgb.r * 255, rgb.g * 255, rgb.b * 255];
}

let envTex: THREE.Texture | null = null;
/** Soft sky/ground gradient that armour reflects, so metal reads as metal without a full scene probe. */
export function characterEnv(): THREE.Texture {
  if (envTex) return envTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#e4f1ff');
  g.addColorStop(0.42, '#bcd6ea');
  g.addColorStop(0.5, '#fff1d6');
  g.addColorStop(0.56, '#8a9a66');
  g.addColorStop(1, '#3f4a30');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 128);
  envTex = new THREE.CanvasTexture(c);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  return envTex;
}

/** Surface classes of the KayKit palette atlas, judged on the original (un-recoloured) pixel. */
function isSteel(h: number, s: number, l: number): boolean {
  return h >= 175 && h <= 245 && s >= 0.03 && s <= 0.32 && l >= 0.12 && l <= 0.85;
}
function isGold(h: number, s: number, l: number): boolean {
  return h >= 35 && h <= 58 && s > 0.55 && l > 0.4;
}
/** Only the peach skin ramp; blond hair and beards sit just outside it. */
function isSkin(h: number, s: number, l: number): boolean {
  return h >= 17 && h <= 32 && s >= 0.7 && l >= 0.68 && l <= 0.9;
}

const charMats = new Map<string, THREE.Material>();

export function characterMaterial(original: THREE.Material, base: CharacterBase, paletteId?: string): THREE.Material {
  const key = `${original.uuid}:${paletteId ?? '-'}`;
  const cached = charMats.get(key);
  if (cached) return cached;
  const src = original as THREE.MeshStandardMaterial;
  const pal = paletteId ? PALETTES[paletteId] : undefined;
  if (!pal) {
    charMats.set(key, original);
    return original;
  }
  const mat = src.clone();
  const cloth = CLOTH[base];
  if (src.map?.image && cloth) {
    const canvas = imageToCanvas(src.map.image as HTMLImageElement, 256);
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    // Roughness in G, metalness in B (the glTF layout three.js expects for both maps).
    const surf = document.createElement('canvas');
    surf.width = canvas.width;
    surf.height = canvas.height;
    const sctx = surf.getContext('2d')!;
    const sdata = sctx.createImageData(surf.width, surf.height);
    const sp = sdata.data;
    const team = pal.team ? new THREE.Color(pal.team) : null;
    const accent = pal.accent ? new THREE.Color(pal.accent) : null;
    const metal = pal.metal ? new THREE.Color(pal.metal) : null;
    const skin = pal.skin ? new THREE.Color(pal.skin) : null;
    // Each atlas paints its cloth at a different brightness; shade around its own average so the
    // palette colour comes through as specified (a white robe stays white on dark-green cloth).
    const sum = { team: 0, nTeam: 0, accent: 0, nAccent: 0 };
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      if (inRange(h, s, cloth.team)) {
        sum.team += l;
        sum.nTeam++;
      } else if (inRange(h, s, cloth.accent)) {
        sum.accent += l;
        sum.nAccent++;
      }
    }
    const ref = (total: number, n: number, fallback: number) => (n ? Math.min(0.6, Math.max(0.25, total / n)) : fallback);
    const teamRef = ref(sum.team, sum.nTeam, 0.5);
    const accentRef = ref(sum.accent, sum.nAccent, 0.55);
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      let out: [number, number, number] | null = null;
      let rough = 0.85;
      let metallic = 0;
      if (isSteel(h, s, l)) {
        rough = 0.34;
        metallic = 0.85;
        if (metal) out = reshade(l, metal, 0.55);
      } else if (isGold(h, s, l)) {
        rough = 0.3;
        metallic = 0.9;
      }
      if (team && inRange(h, s, cloth.team)) out = reshade(l, team, teamRef);
      else if (accent && inRange(h, s, cloth.accent)) out = reshade(l, accent, accentRef);
      else if (skin && isSkin(h, s, l)) {
        out = reshade(l, skin, 0.8);
        rough = 0.6;
      }
      if (out) {
        px[i] = out[0];
        px[i + 1] = out[1];
        px[i + 2] = out[2];
      }
      sp[i] = 255;
      sp[i + 1] = Math.round(rough * 255);
      sp[i + 2] = Math.round(metallic * 255);
      sp[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    sctx.putImageData(sdata, 0, 0);
    mat.map = canvasTexture(canvas, src.map);
    const surface = canvasTexture(surf, src.map);
    surface.colorSpace = THREE.NoColorSpace;
    mat.roughnessMap = surface;
    mat.metalnessMap = surface;
    mat.roughness = 1;
    mat.metalness = 1;
    mat.envMap = characterEnv();
    mat.envMapIntensity = 0.9;
  }
  if (pal.tint) mat.color = new THREE.Color(pal.tint);
  if (pal.emissive) {
    mat.emissive = new THREE.Color(pal.emissive);
    mat.emissiveIntensity = 1;
  }
  if (pal.opacity !== undefined) {
    mat.transparent = true;
    mat.opacity = pal.opacity;
    mat.depthWrite = false;
  }
  charMats.set(key, mat);
  return mat;
}
