import { getUnit, raceBuildings } from '../data/index';
import type { BuildingDef, RaceId } from '../types';

/**
 * War doctrines: before every territory battle the prince picks one. Its buildings fight harder,
 * the other half of the roster fights worse, so the army that suits one territory's enemies
 * (thorns and flyers want ranged fire) is the wrong one somewhere else.
 */
export type DoctrineId = 'front' | 'ranged';

export const DOCTRINE_IDS: DoctrineId[] = ['front', 'ranged'];

/** Hit points and damage of the chosen doctrine's soldiers and towers, and of everything else. */
export const DOCTRINE_MULT = { chosen: 1.25, other: 0.85 };

const NAMES: Record<RaceId, Record<DoctrineId, string>> = {
  human: { front: '鐵騎衝鋒', ranged: '箭雨城防' },
  elf: { front: '林地守衛', ranged: '遊俠箭雨' },
  dwarf: { front: '盾牆軍團', ranged: '砲火城防' },
  angel: { front: '聖盾方陣', ranged: '天光審判' },
};

/** Which doctrine a combat building belongs to: towers and ranged soldiers are `ranged`. */
export function doctrineOf(def: BuildingDef): DoctrineId | null {
  if (def.kind === 'tower') return 'ranged';
  if (def.kind !== 'barracks' || !def.unit) return null;
  return getUnit(def.unit).range > 2.5 ? 'ranged' : 'front';
}

/** Battle multiplier for a building's soldiers or tower shots under a doctrine. */
export function doctrineMult(def: BuildingDef | null | undefined, doctrine: DoctrineId | undefined): number {
  const own = def ? doctrineOf(def) : null;
  if (!doctrine || !own) return 1;
  return own === doctrine ? DOCTRINE_MULT.chosen : DOCTRINE_MULT.other;
}

export interface DoctrineInfo {
  id: DoctrineId;
  name: string;
  /** Names of the race's buildings the doctrine favours. */
  buildings: string[];
}

export function doctrineInfo(race: RaceId, id: DoctrineId): DoctrineInfo {
  return {
    id,
    name: NAMES[race][id],
    buildings: raceBuildings(race)
      .filter((b) => !b.campaignOnly && doctrineOf(b) === id)
      .map((b) => b.name),
  };
}

const pct = (x: number) => Math.round(Math.abs(x - 1) * 100);

/** One line on what a doctrine does. */
export function doctrineDesc(race: RaceId, id: DoctrineId): string {
  const info = doctrineInfo(race, id);
  return `${info.buildings.join('、')}的士兵與攻擊 +${pct(DOCTRINE_MULT.chosen)}%，其他兵營與塔 −${pct(DOCTRINE_MULT.other)}%。`;
}
