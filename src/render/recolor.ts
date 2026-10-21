import * as THREE from 'three';
import type { CharacterBase, RaceId } from '../game/types';

/** Building atlas: the team-coloured parts sample the bottom-left cell of the palette texture. */
const BUILDING_TEAM: Record<RaceId, [string, string] | null> = {
  human: null,
  elf: ['#6fe08c', '#14532d'],
  dwarf: ['#ffd27a', '#b4441a'],
  demon: ['#d0343a', '#2a0610'],
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
export function buildingMaterial(original: THREE.Material, race: RaceId): THREE.Material {
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
  skin?: string;
  tint?: string;
  emissive?: string;
  opacity?: number;
}

export const PALETTES: Record<string, Palette> = {
  human: { team: '#2f6fd6', accent: '#e8c05a' },
  priest: { team: '#f4f4f5', accent: '#3b82f6' },
  royal: { team: '#1d4ed8', accent: '#facc15' },
  elf: { team: '#2e9e4f', accent: '#d4b25a', skin: '#f6dcc0' },
  druid: { team: '#5b7f1e', accent: '#8b5a2b', skin: '#f6dcc0' },
  wind: { team: '#0fa293', accent: '#e5e7eb', skin: '#f6dcc0' },
  moon: { team: '#c7d2fe', accent: '#818cf8', skin: '#f3e3d8' },
  treant: { team: '#3f7d2a', accent: '#6b4423', skin: '#7a5230', tint: '#c7ab7f' },
  dwarf: { team: '#d97706', accent: '#92400e' },
  engineer: { team: '#b45309', accent: '#fbbf24' },
  rune: { team: '#2563eb', accent: '#93c5fd' },
  metal: { team: '#57534e', accent: '#f59e0b', skin: '#9ca3af', tint: '#c9ccd1' },
  imp: { team: '#7f1d1d', accent: '#f97316', skin: '#e0362f' },
  demon: { team: '#3f0a0a', accent: '#f97316', skin: '#b91c1c' },
  warlock: { team: '#6d28d9', accent: '#22c55e', skin: '#b91c1c' },
  succubus: { team: '#be185d', accent: '#7c3aed', skin: '#c084fc' },
  cultist: { team: '#7f1d1d', accent: '#111827', skin: '#b91c1c' },
  pitlord: { team: '#1c1917', accent: '#f97316', skin: '#991b1b', tint: '#e8c0b0' },
  angel: { team: '#fafafa', accent: '#facc15', skin: '#ffe9dc' },
  aegis: { team: '#e0f2fe', accent: '#60a5fa', skin: '#ffe9dc' },
  judicator: { team: '#fde68a', accent: '#f59e0b', skin: '#ffe9dc' },
  seraph: { team: '#fffbeb', accent: '#fbbf24', skin: '#ffe9dc', emissive: '#3a2a08' },
  ghost: { tint: '#a5ecff', emissive: '#1f6a80', opacity: 0.55 },
  toxic: { tint: '#a8e070', emissive: '#1b3300' },
  necro: { tint: '#c4a7ff', emissive: '#14002a' },
  brute: { tint: '#d9b38c' },
  dark: { team: '#4c1d95', accent: '#1f2937', skin: '#94a3b8', tint: '#9a90b0' },
  king: { tint: '#ffe08a', emissive: '#3a2a00' },
  lich: { tint: '#b794f4', emissive: '#2a0a4a' },
  deathknight: { team: '#7f1d1d', accent: '#111827', skin: '#475569', tint: '#8a7a7a', emissive: '#200000' },
};

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

/** Reshade a pixel to the target colour keeping its relative brightness. */
function reshade(l: number, target: THREE.Color, refL: number): [number, number, number] {
  const hsl = { h: 0, s: 0, l: 0 };
  target.getHSL(hsl, THREE.SRGBColorSpace);
  const nl = Math.min(0.97, Math.max(0.03, hsl.l * (l / refL)));
  const c = new THREE.Color().setHSL(hsl.h, hsl.s, nl, THREE.SRGBColorSpace);
  const rgb = { r: 0, g: 0, b: 0 };
  c.getRGB(rgb, THREE.SRGBColorSpace);
  return [rgb.r * 255, rgb.g * 255, rgb.b * 255];
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
  if (src.map?.image && (pal.team || pal.skin || pal.accent)) {
    const canvas = imageToCanvas(src.map.image as HTMLImageElement, 256);
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    const team = pal.team ? new THREE.Color(pal.team) : null;
    const accent = pal.accent ? new THREE.Color(pal.accent) : null;
    const skin = pal.skin ? new THREE.Color(pal.skin) : null;
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      let out: [number, number, number] | null = null;
      if (team && cloth && inRange(h, s, cloth.team)) out = reshade(l, team, 0.5);
      else if (accent && cloth && inRange(h, s, cloth.accent)) out = reshade(l, accent, 0.55);
      else if (skin && h >= 12 && h <= 40 && l > 0.6 && s > 0.3) out = reshade(l, skin, 0.8);
      if (out) {
        px[i] = out[0];
        px[i + 1] = out[1];
        px[i + 2] = out[2];
      }
    }
    ctx.putImageData(data, 0, 0);
    mat.map = canvasTexture(canvas, src.map);
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
