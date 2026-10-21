import type { FactionId } from '../data/factions';
import type { TerrainId } from './terrain';

/**
 * The world map: a radius-2 hex grid in axial coordinates (q, r).
 * The prince starts in the south-west corner; the fallen capital lies in the opposite corner.
 * The straight road (q + r = 0) goes through rebel land and one undead stronghold; the two flanks
 * belong to the goblins (q + r < 0) and the orcs (q + r > 0).
 */
export interface Territory {
  id: string;
  name: string;
  q: number;
  r: number;
  faction: FactionId | null;
  terrain: TerrainId;
  desc: string;
  reward: { perk?: string; unlock?: string };
  start?: boolean;
  capital?: boolean;
}

export const TERRITORIES: Territory[] = [
  { id: 't_refuge', name: '曙光堡', q: -2, r: 2, faction: null, terrain: 'town', start: true, desc: '王國最後的據點，王子在此重整旗鼓。', reward: { perk: 'p_refuge' } },

  // Rebels: the betrayers nearest the refuge.
  { id: 't_wheat', name: '麥浪平原', q: -1, r: 1, faction: 'rebel', terrain: 'plains', desc: '王國的糧倉，如今被叛軍強徵。', reward: { perk: 'p_gold' } },
  { id: 't_greystone', name: '灰岩鎮', q: -2, r: 1, faction: 'rebel', terrain: 'town', desc: '石匠之鎮，鎮民被叛軍奴役修築工事。', reward: { perk: 'p_castle' } },
  { id: 't_caravan', name: '商隊驛站', q: -1, r: 2, faction: 'rebel', terrain: 'town', desc: '往來商旅聚集之地，叛軍在這裡招募傭兵。', reward: { unlock: 'sp_mercenary' } },
  { id: 't_ravenhold', name: '黑鴉堡', q: 0, r: 0, faction: 'rebel', terrain: 'hills', desc: '篡位叛臣的大本營，扼守通往王城的大道。', reward: { perk: 'p_tower' } },

  // Goblins: the forested western flank.
  { id: 't_whisper', name: '幽語森林', q: -2, r: 0, faction: 'goblin', terrain: 'forest', desc: '樹影間迴盪著哥布林的竊笑聲。', reward: { perk: 'p_range' } },
  { id: 't_goblincave', name: '哥布林窟', q: -1, r: 0, faction: 'goblin', terrain: 'hills', desc: '哥布林工匠在洞窟裡打造危險的火箭。', reward: { unlock: 'sp_rocket' } },
  { id: 't_mushroom', name: '蘑菇沼澤', q: -1, r: -1, faction: 'goblin', terrain: 'swamp', desc: '長滿巨大蘑菇的沼地，盛產珍貴藥草。', reward: { perk: 'p_heal' } },
  { id: 't_fanghills', name: '碎牙丘陵', q: 0, r: -1, faction: 'goblin', terrain: 'hills', desc: '哥布林王堆滿搶來的金銀財寶的巢穴。', reward: { perk: 'p_bounty' } },

  // Orcs: the scorched eastern flank.
  { id: 't_ember', name: '赤焰荒原', q: 0, r: 2, faction: 'orc', terrain: 'badlands', desc: '終年燃燒的荒原，獸人戰團在此集結。', reward: { perk: 'p_dmg' } },
  { id: 't_arena', name: '獸人鬥技場', q: 0, r: 1, faction: 'orc', terrain: 'badlands', desc: '最強的獸人勇士在這裡廝殺取樂。', reward: { unlock: 'sp_arena' } },
  { id: 't_frostfang', name: '霜牙山口', q: 1, r: 1, faction: 'orc', terrain: 'mountain', desc: '寒風刺骨的山口，獸人在此打造鐵甲。', reward: { perk: 'p_hp' } },
  { id: 't_oldvein', name: '古老礦脈', q: 1, r: 0, faction: 'orc', terrain: 'mine', desc: '矮人留下的古老礦坑，蘊藏大量黃金。', reward: { unlock: 'sp_deepmine' } },

  // Undead: the blighted lands around the capital.
  { id: 't_royalcamp', name: '王家舊營', q: 1, r: -1, faction: 'undead', terrain: 'plains', desc: '老國王最後一次點兵的營地，他的佩劍仍插在這裡。', reward: { unlock: 'sp_monument' } },
  { id: 't_wailing', name: '哀嚎墓園', q: 0, r: -2, faction: 'undead', terrain: 'graveyard', desc: '戰死的王國士兵被魔王喚醒，在墓園中徘徊。', reward: { perk: 'p_spawn' } },
  { id: 't_spring', name: '聖泉修道院', q: 1, r: -2, faction: 'undead', terrain: 'holy', desc: '被亡靈玷污的聖地，聖泉仍在微微發光。', reward: { unlock: 'sp_spring' } },
  { id: 't_bonemarsh', name: '枯骨沼澤', q: 2, r: 0, faction: 'undead', terrain: 'swamp', desc: '昔日的商路如今只剩白骨與爛泥。', reward: { perk: 'p_income' } },
  { id: 't_oblivion', name: '遺忘河谷', q: 2, r: -1, faction: 'undead', terrain: 'river', desc: '守護王城的河谷要塞，奪回它就能在家門口重建防線。', reward: { perk: 'p_startcastle' } },

  // The goal.
  { id: 't_capital', name: '淪陷的王城', q: 2, r: -2, faction: 'demonlord', terrain: 'capital', capital: true, desc: '老國王戰死之地。魔王莫爾加斯坐在染血的王座上。', reward: {} },
];

export const TERRITORY_MAP = new Map(TERRITORIES.map((t) => [t.id, t]));
export const START_TERRITORY = TERRITORIES.find((t) => t.start)!;
export const CAPITAL_TERRITORY = TERRITORIES.find((t) => t.capital)!;

export function getTerritory(id: string): Territory {
  const t = TERRITORY_MAP.get(id);
  if (!t) throw new Error(`unknown territory ${id}`);
  return t;
}

export function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/** Difficulty tier 1-4: hex distance from the refuge (the capital is tier 5). */
export function territoryTier(t: Territory): number {
  return t.capital ? 5 : hexDistance(t, START_TERRITORY);
}

export function neighbours(t: Territory): Territory[] {
  return TERRITORIES.filter((o) => hexDistance(o, t) === 1);
}
