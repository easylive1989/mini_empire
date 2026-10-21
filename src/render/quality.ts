import * as THREE from 'three';

/** Rendering presets: 'low' (效能模式) trades sharpness and soft shadows for frame rate on weak GPUs. */
export type Quality = 'high' | 'low';

export interface QualityPreset {
  antialias: boolean;
  maxPixelRatio: number;
  shadowType: THREE.ShadowMapType;
  shadowMapSize: number;
  /** Shadow maps are re-rendered every N frames. */
  shadowEvery: number;
  /** Fraction of the map's miasma puffs that are drawn. */
  puffs: number;
}

export const PRESETS: Record<Quality, QualityPreset> = {
  high: { antialias: true, maxPixelRatio: 2, shadowType: THREE.PCFSoftShadowMap, shadowMapSize: 2048, shadowEvery: 1, puffs: 1 },
  low: { antialias: false, maxPixelRatio: 1, shadowType: THREE.BasicShadowMap, shadowMapSize: 1024, shadowEvery: 2, puffs: 0.5 },
};

const STORE_KEY = 'mini-empire.quality.v1';

/** The player's saved choice, or null when it was never set (auto). */
export function loadQuality(): Quality | null {
  try {
    const q = localStorage.getItem(STORE_KEY);
    return q === 'high' || q === 'low' ? q : null;
  } catch {
    return null;
  }
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(STORE_KEY, q);
  } catch {
    // ignore
  }
}

/** Integrated, mobile and software GPUs start in the light preset. */
export function detectQuality(): Quality {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'low';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|basic render|mali|adreno|powervr|intel(?!.*\barc\b)/i.test(name) ? 'low' : 'high';
  } catch {
    return 'high';
  }
}

/** Watches real frame times and reports when the game stays under ~40 fps. */
export class FrameWatch {
  private time = 0;
  private frames = 0;
  private grace = 5;

  /** Returns true once a 4-second window averages under 40 fps. */
  sample(dt: number): boolean {
    // Hidden tabs, loading and shader compiles show up as long single frames: start over.
    if (dt > 0.25) {
      this.time = 0;
      this.frames = 0;
      return false;
    }
    if (this.grace > 0) {
      this.grace -= dt;
      return false;
    }
    this.time += dt;
    this.frames++;
    if (this.time < 4) return false;
    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;
    return fps < 40;
  }
}
