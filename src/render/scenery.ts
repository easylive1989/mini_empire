import * as THREE from 'three';
import type { TerrainId } from '../game/campaign/terrain';
import { GRID_RADIUS, SPAWN_X, TILE } from '../game/constants';
import type { FactionId } from '../game/data/factions';
import { Rng } from '../game/rng';
import type { RaceId } from '../game/types';
import type { Assets } from './assets';
import { decoModel, placeModel } from './models';

/** Where a battle takes place: the classic mode is plains against the undead. */
export interface BattleSetting {
  terrain: TerrainId;
  faction: FactionId;
  race: RaceId;
}

export interface EnvStyle {
  sky: string;
  grass: string;
  blotches: [string, string];
  earth: [number, number, number];
  hemi: [string, string, number];
  sun: [string, number];
}

const BASE: EnvStyle = {
  sky: '#9fd3e8',
  grass: '#7cb85a',
  blotches: ['rgba(98,160,70,0.35)', 'rgba(150,205,110,0.3)'],
  earth: [170, 135, 85],
  hemi: ['#f4fbff', '#6d8a4e', 1.6],
  sun: ['#fff1d6', 2.6],
};

export const ENV_STYLES: Record<TerrainId, EnvStyle> = {
  plains: BASE,
  town: { ...BASE, grass: '#82b862', earth: [176, 150, 112] },
  forest: { ...BASE, sky: '#a9d8c8', grass: '#5f9a45', blotches: ['rgba(70,125,50,0.4)', 'rgba(120,175,90,0.3)'], earth: [140, 110, 70] },
  hills: { ...BASE, grass: '#8dbb5c', blotches: ['rgba(120,170,80,0.35)', 'rgba(170,210,120,0.3)'] },
  swamp: {
    sky: '#a7b89a',
    grass: '#5d7a45',
    blotches: ['rgba(60,80,50,0.45)', 'rgba(110,130,70,0.35)'],
    earth: [95, 90, 60],
    hemi: ['#e2ecd6', '#4a5a38', 1.45],
    sun: ['#f1f0d0', 2.2],
  },
  mountain: {
    sky: '#c4d8e6',
    grass: '#93a383',
    blotches: ['rgba(230,236,240,0.4)', 'rgba(120,135,110,0.35)'],
    earth: [150, 140, 125],
    hemi: ['#f2f8ff', '#79806e', 1.7],
    sun: ['#f6f8ff', 2.5],
  },
  badlands: {
    sky: '#e3b38a',
    grass: '#b0703f',
    blotches: ['rgba(120,60,30,0.4)', 'rgba(210,140,80,0.3)'],
    earth: [90, 50, 30],
    hemi: ['#ffe6cc', '#7a4a2a', 1.5],
    sun: ['#ffd2a0', 2.7],
  },
  mine: { ...BASE, sky: '#c9d3cf', grass: '#8f8a6a', blotches: ['rgba(120,115,95,0.4)', 'rgba(170,165,140,0.3)'], earth: [110, 100, 85] },
  graveyard: {
    sky: '#8f9bab',
    grass: '#5e7550',
    blotches: ['rgba(60,70,60,0.4)', 'rgba(110,125,100,0.3)'],
    earth: [105, 95, 80],
    hemi: ['#dde4f2', '#4b5640', 1.35],
    sun: ['#dfe6ff', 2.1],
  },
  holy: {
    sky: '#d4ecf7',
    grass: '#a3cf78',
    blotches: ['rgba(255,255,240,0.35)', 'rgba(140,200,110,0.3)'],
    earth: [200, 180, 140],
    hemi: ['#fffdf2', '#7a9a5e', 1.75],
    sun: ['#fff6dc', 2.8],
  },
  river: { ...BASE, grass: '#79b85a' },
  capital: {
    sky: '#5d4a5e',
    grass: '#5a5048',
    blotches: ['rgba(40,30,30,0.45)', 'rgba(120,40,30,0.3)'],
    earth: [60, 40, 35],
    hemi: ['#e8c8d0', '#3a2a2a', 1.25],
    sun: ['#ffb08a', 2.2],
  },
};

const GROUND_CENTER_X = 15;
const GROUND_SIZE = 160;

/** Hand-painted ground texture: grass with a trampled battlefield leading to the plot. */
export function paintGround(style: EnvStyle, terrain: TerrainId): THREE.Texture {
  const px = 1024;
  const size = GROUND_SIZE;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d')!;
  const toPx = (x: number, z: number) => [((x - GROUND_CENTER_X + size / 2) / size) * px, ((z + size / 2) / size) * px];
  const disc = (x: number, y: number, r: number, fill: string | CanvasGradient) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.fillStyle = style.grass;
  ctx.fillRect(0, 0, px, px);
  const rng = new Rng(7);
  for (let k = 0; k < 2600; k++) disc(rng.next() * px, rng.next() * px, 2 + rng.next() * 9, rng.chance(0.5) ? style.blotches[0] : style.blotches[1]);

  if (terrain === 'swamp') {
    for (let k = 0; k < 70; k++) {
      const [x, y] = [rng.next() * px, rng.next() * px];
      disc(x, y, 12 + rng.next() * 30, 'rgba(58,74,62,0.55)');
    }
  }
  if (terrain === 'holy') {
    for (let k = 0; k < 900; k++) disc(rng.next() * px, rng.next() * px, 1.5 + rng.next() * 2, rng.chance(0.5) ? 'rgba(255,255,255,0.8)' : 'rgba(253,224,71,0.75)');
  }
  if (terrain === 'badlands' || terrain === 'capital') {
    ctx.strokeStyle = terrain === 'capital' ? 'rgba(190,40,20,0.35)' : 'rgba(70,35,20,0.4)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 120; k++) {
      let [x, y] = [rng.next() * px, rng.next() * px];
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        x += (rng.next() - 0.5) * 40;
        y += (rng.next() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  if (terrain === 'river') {
    // A river running behind the plot and the battlefield.
    ctx.strokeStyle = '#4f9fd0';
    ctx.lineWidth = (7 / size) * px;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = -70; x <= 100; x += 5) {
      const [a, b] = toPx(x, -21 + Math.sin(x * 0.08) * 2.5);
      if (x === -70) ctx.moveTo(a, b);
      else ctx.lineTo(a, b);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,235,255,0.5)';
    ctx.lineWidth = (1.2 / size) * px;
    ctx.stroke();
  }

  // Battlefield: trampled earth widening towards the enemy camp.
  const [er, eg, eb] = style.earth;
  const [ax, az] = toPx(TILE * 2.6, 0);
  const [bx] = toPx(SPAWN_X + 10, 0);
  const halfNear = (13 / size) * px;
  const halfFar = (17 / size) * px;
  for (let k = 0; k < 900; k++) {
    const t = rng.next();
    const x = ax + (bx - ax) * t;
    const half = halfNear + (halfFar - halfNear) * t;
    const y = az + (rng.next() * 2 - 1) * half * Math.sqrt(rng.next());
    disc(x, y, 6 + rng.next() * 18, `rgba(${er + rng.int(30)},${eg + rng.int(25)},${eb + rng.int(20)},0.16)`);
  }
  // Soft clearing around the plot.
  const [ox, oz] = toPx(0, 0);
  const g = ctx.createRadialGradient(ox, oz, 10, ox, oz, (16 / size) * px);
  g.addColorStop(0, `rgba(${er - 10},${eg + 5},${eb + 10},0.35)`);
  g.addColorStop(1, `rgba(${er - 10},${eg + 5},${eb + 10},0)`);
  disc(ox, oz, (16 / size) * px, g);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

type Pack = 'env' | 'halloween' | 'dungeon';
type Placer = (pack: Pack, key: string, x: number, z: number, scale: number, rotY?: number) => void;

/** Builds the ground plane plus terrain scenery and the enemy camp into `group`. */
export function buildScenery(group: THREE.Group, assets: Assets, setting: BattleSetting): void {
  const style = ENV_STYLES[setting.terrain];
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ map: paintGround(style, setting.terrain), roughness: 1 }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(GROUND_CENTER_X, 0, 0);
  plane.receiveShadow = true;
  group.add(plane);

  const rng = new Rng(20261021);
  const add: Placer = (pack, key, x, z, scale, rotY = rng.next() * Math.PI * 2) => {
    const o = decoModel(assets, pack, key, scale);
    o.position.set(x, 0, z);
    o.rotation.y = rotY;
    group.add(o);
  };
  const addBuilding = (key: string, x: number, z: number, rotY: number, fit = 0.8) => {
    const o = placeModel(assets, { pack: 'buildings', key }, setting.race, fit);
    o.position.set(x, 0, z);
    o.rotation.y = rotY;
    group.add(o);
  };

  buildCamp(add, rng, setting.faction);

  // Scenery around the plot, kept off the plot and the battlefield.
  const r = GRID_RADIUS * TILE + TILE;
  const free = (x: number, z: number) => !(Math.abs(x) < r + 1 && Math.abs(z) < r + 1) && !(x > r - 2 && x < SPAWN_X + 14 && Math.abs(z) < 15);
  const scatter = (kinds: [Pack, string, number][], count: number) => {
    let placed = 0;
    for (let k = 0; k < count * 6 && placed < count; k++) {
      const x = -32 + rng.next() * 92;
      const z = -30 + rng.next() * 60;
      if (!free(x, z)) continue;
      const [pack, key, scale] = kinds[rng.int(kinds.length)];
      add(pack, key, x, z, scale * (0.85 + rng.next() * 0.4));
      placed++;
    }
  };
  const trees: [Pack, string, number][] = [
    ['env', 'tree_single_A', 1.9],
    ['env', 'tree_single_B', 1.9],
    ['env', 'trees_A_small', 1.9],
    ['env', 'trees_A_medium', 1.9],
    ['env', 'trees_B_small', 1.9],
    ['env', 'trees_B_medium', 1.9],
  ];
  const rocks: [Pack, string, number][] = [
    ['env', 'rock_single_C', 4.4],
    ['env', 'rock_single_E', 4.4],
    ['env', 'rock_single_A', 4.4],
  ];
  const deadTrees: [Pack, string, number][] = [
    ['halloween', 'tree_dead_large', 0.8],
    ['halloween', 'tree_dead_medium', 0.8],
    ['halloween', 'tree_dead_small', 0.8],
  ];
  const mountains = () => {
    add('env', 'mountain_A_grass_trees', -34, -26, 4.5);
    add('env', 'mountain_B_grass_trees', -22, -38, 4.2);
    add('env', 'mountain_A_grass_trees', 6, -42, 4.6);
  };

  switch (setting.terrain) {
    case 'plains':
    case 'river':
      scatter([...trees, ...rocks.slice(0, 2)], 100);
      for (let k = 0; k < 6; k++) add('env', 'building_grain', -26 + (k % 3) * 4.2, 14 + Math.floor(k / 3) * 4.2, 2.1, 0);
      mountains();
      if (setting.terrain === 'river') {
        for (let k = 0; k < 14; k++) add('env', k % 2 ? 'waterlily_A' : 'waterplant_A', -40 + k * 7 + rng.next() * 3, -21 + (rng.next() - 0.5) * 4, 2.2);
        add('env', 'building_bridge_A', 4, -21, 3.6, 0);
      }
      break;
    case 'town': {
      scatter(trees, 45);
      const homes: [string, number, number][] = [
        ['home_A', -17, -14],
        ['home_B', -10, -16],
        ['well', -4, -15],
        ['market', 3, -17],
        ['home_A', 10, -17],
        ['tavern', -18, 9],
        ['home_B', -13, 15],
        ['church', -21, -3],
      ];
      homes.forEach(([key, x, z]) => addBuilding(key, x, z, z < 0 ? 0 : Math.PI));
      for (let k = 0; k < 5; k++) add('env', 'fence_stone_straight', -18 + k * 4.2, -12, 2.2, 0);
      mountains();
      break;
    }
    case 'forest':
      scatter([...trees, ['env', 'trees_A_large', 2.2], ['env', 'trees_B_large', 2.2], ['env', 'trees_A_large', 2.2]], 170);
      break;
    case 'hills':
      scatter([...trees, ...rocks, ['env', 'trees_A_large', 2.2]], 110);
      mountains();
      break;
    case 'swamp':
      scatter([...deadTrees, ['env', 'waterlily_A', 2.4], ['env', 'waterplant_A', 2.4], ['env', 'waterplant_B', 2.4], ['env', 'trees_B_small', 1.8]], 120);
      break;
    case 'mountain':
      scatter([...rocks, ...rocks, ['env', 'tree_single_B', 1.9], ['env', 'trees_B_medium', 1.9]], 110);
      mountains();
      break;
    case 'badlands':
      scatter([...rocks, ...deadTrees, ['halloween', 'skull', 1.2], ['halloween', 'ribcage', 1.1]], 90);
      break;
    case 'mine':
      scatter([...rocks, ...rocks, ['env', 'resource_stone', 2.6], ['env', 'tree_single_B', 1.8], ['env', 'wheelbarrow', 2.2]], 100);
      addBuilding('mine', -16, -14, 0.4, 1);
      addBuilding('mine', -16, 13, Math.PI, 1);
      break;
    case 'graveyard':
      scatter(
        [...deadTrees, ['halloween', 'gravestone', 0.8], ['halloween', 'grave_A', 0.8], ['halloween', 'gravemarker_A', 0.8], ['halloween', 'lantern_standing', 0.8]],
        140,
      );
      break;
    case 'holy':
      scatter([...trees, ['dungeon', 'pillar_decorated', 1.6], ['dungeon', 'column', 1.6]], 80);
      addBuilding('church', -16, -14, 0.3, 1);
      add('halloween', 'shrine_candles', -14, 13, 1.2, Math.PI);
      break;
    case 'capital': {
      scatter([...deadTrees, ['env', 'building_destroyed', 2.2], ['dungeon', 'rubble_large', 1.0], ['dungeon', 'torch_lit', 1.6]], 70);
      for (let k = 0; k < 7; k++) add('env', k === 3 ? 'wall_straight_gate' : 'wall_straight', -26 + k * 4.4, -14, 2.2, 0);
      add('env', 'wall_corner_A_outside', 5, -14, 2.2, 0);
      for (let k = 0; k < 4; k++) add('dungeon', 'banner_patternA_red', -23 + k * 8, -13.2, 1.2, 0);
      break;
    }
  }
}

/** The enemy camp at the far end of the battlefield. */
function buildCamp(add: Placer, rng: Rng, faction: FactionId): void {
  const X = SPAWN_X;
  const sideRows = (keys: [Pack, string, number][], count: number, xFrom = -3, xTo = 12, zMin = 5, zMax = 14) => {
    for (let k = 0; k < count; k++) {
      const z = (k % 2 ? 1 : -1) * (zMin + rng.next() * (zMax - zMin));
      const [pack, key, scale] = keys[k % keys.length];
      add(pack, key, X + xFrom + rng.next() * (xTo - xFrom), z, scale, -Math.PI / 2 + (rng.next() - 0.5) * 0.8);
    }
  };
  switch (faction) {
    case 'undead':
      add('halloween', 'crypt', X + 9, 0, 0.55, -Math.PI / 2);
      add('halloween', 'arch_gate', X + 3.5, 0, 0.75, Math.PI / 2);
      sideRows(
        [
          ['halloween', 'gravestone', 0.75],
          ['halloween', 'grave_A', 0.75],
          ['halloween', 'gravemarker_A', 0.75],
          ['halloween', 'post_skull', 0.75],
          ['halloween', 'skull', 0.75],
          ['halloween', 'lantern_standing', 0.75],
        ],
        18,
      );
      for (let k = 0; k < 8; k++) add('halloween', ['tree_dead_large', 'tree_dead_medium', 'tree_dead_small'][k % 3], X - 4 + rng.next() * 16, (k % 2 ? 1 : -1) * (12 + rng.next() * 8), 0.75);
      for (const side of [-1, 1]) for (let k = 0; k < 3; k++) add('halloween', k === 1 ? 'fence_broken' : 'fence', X + 3.5, side * (4.5 + k * 3), 0.75, Math.PI / 2);
      break;
    case 'goblin':
      for (const [dx, dz] of [[9, -5], [11, 3], [7, 9], [8, -12]]) add('env', 'tent', X + dx, dz, 5.2, -Math.PI / 2 + (rng.next() - 0.5));
      sideRows(
        [
          ['env', 'crate_A_big', 2.2],
          ['env', 'barrel', 2.2],
          ['env', 'sack', 2.4],
          ['env', 'crate_open', 2.2],
          ['dungeon', 'coin_stack_large', 1.6],
          ['env', 'tree_single_A_cut', 2],
        ],
        16,
      );
      add('env', 'flag_green', X + 4, -4.5, 2.6, 0);
      add('env', 'flag_green', X + 4, 4.5, 2.6, 0);
      for (const side of [-1, 1]) for (let k = 0; k < 2; k++) add('env', 'fence_wood_straight', X + 3.5, side * (7 + k * 4.2), 2.2, Math.PI / 2);
      break;
    case 'orc':
      for (const [dx, dz] of [[10, -6], [12, 4], [8, 11], [9, -13]]) add('env', 'tent', X + dx, dz, 5.6, -Math.PI / 2 + (rng.next() - 0.5));
      sideRows(
        [
          ['env', 'weaponrack', 2.2],
          ['halloween', 'post_skull', 0.9],
          ['env', 'target', 2.2],
          ['halloween', 'bone_A', 1],
          ['env', 'barrel', 2.2],
          ['dungeon', 'torch_lit', 1.6],
        ],
        18,
      );
      add('env', 'flag_red', X + 4, -4.5, 2.8, 0);
      add('env', 'flag_red', X + 4, 4.5, 2.8, 0);
      add('env', 'rock_single_D', X + 6, 0, 3.5);
      break;
    case 'rebel':
      for (const [dx, dz] of [[10, -6], [11, 5], [8, 12]]) add('env', 'tent', X + dx, dz, 5.2, -Math.PI / 2 + (rng.next() - 0.5) * 0.6);
      sideRows(
        [
          ['env', 'crate_A_big', 2.2],
          ['env', 'weaponrack', 2.2],
          ['env', 'wheelbarrow', 2.2],
          ['env', 'barrel', 2.2],
          ['env', 'bucket_arrows', 2.2],
          ['env', 'pallet', 2.2],
        ],
        14,
      );
      add('env', 'flag_yellow', X + 4, -4.5, 2.6, 0);
      add('env', 'flag_yellow', X + 4, 4.5, 2.6, 0);
      for (const side of [-1, 1]) {
        add('env', 'fence_wood_straight_gate', X + 3.5, side * 6.5, 2.2, Math.PI / 2);
        add('env', 'fence_wood_straight', X + 3.5, side * 10.7, 2.2, Math.PI / 2);
      }
      break;
    case 'demonlord':
      add('halloween', 'crypt', X + 10, 0, 0.7, -Math.PI / 2);
      add('halloween', 'arch_gate', X + 3.5, 0, 0.9, Math.PI / 2);
      sideRows(
        [
          ['halloween', 'shrine_candles', 0.9],
          ['dungeon', 'torch_lit', 1.6],
          ['halloween', 'post_skull', 0.9],
          ['dungeon', 'rubble_large', 1.6],
          ['dungeon', 'banner_patternA_red', 1.5],
        ],
        16,
      );
      for (let k = 0; k < 6; k++) add('halloween', ['tree_dead_large', 'tree_dead_medium'][k % 2], X - 2 + rng.next() * 14, (k % 2 ? 1 : -1) * (13 + rng.next() * 6), 0.85);
      break;
  }
}
