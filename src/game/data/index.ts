import type { BuildingDef, RaceDef, RaceId, UnitDef } from '../types';
import { ANGEL, ANGEL_BUILDINGS, ANGEL_UNITS } from './angel';
import { COMMON_BUILDINGS } from './common';
import { DWARF, DWARF_BUILDINGS, DWARF_UNITS } from './dwarf';
import { ELF, ELF_BUILDINGS, ELF_UNITS } from './elf';
import { HUMAN, HUMAN_BUILDINGS, HUMAN_UNITS } from './human';
import { FACTION_UNITS } from './factions';
import { MONSTERS } from './monsters';
import { SPECIAL_BUILDINGS, SPECIAL_UNITS } from './specials';

export const RACES: RaceDef[] = [HUMAN, ELF, DWARF, ANGEL];
export const RACE_MAP = new Map<RaceId, RaceDef>(RACES.map((r) => [r.id, r]));

export const UNITS = new Map<string, UnitDef>(
  [...HUMAN_UNITS, ...ELF_UNITS, ...DWARF_UNITS, ...ANGEL_UNITS, ...MONSTERS, ...FACTION_UNITS, ...SPECIAL_UNITS].map(
    (u) => [u.id, u],
  ),
);

export const BUILDINGS = new Map<string, BuildingDef>(
  [
    ...COMMON_BUILDINGS,
    ...HUMAN_BUILDINGS,
    ...ELF_BUILDINGS,
    ...DWARF_BUILDINGS,
    ...ANGEL_BUILDINGS,
    ...SPECIAL_BUILDINGS,
  ].map((b) => [b.id, b]),
);

export function getUnit(id: string): UnitDef {
  const u = UNITS.get(id);
  if (!u) throw new Error(`unknown unit ${id}`);
  return u;
}

export function getBuilding(id: string): BuildingDef {
  const b = BUILDINGS.get(id);
  if (!b) throw new Error(`unknown building ${id}`);
  return b;
}

const KIND_ORDER = { resource: 0, tower: 1, support: 2, barracks: 3 } as const;

export function sortBuildings(list: BuildingDef[]): BuildingDef[] {
  return list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.castleLevel - b.castleLevel || a.cost - b.cost);
}

/** Buildings available to a race (without campaign specials), in menu order. */
export function raceBuildings(race: RaceId): BuildingDef[] {
  return sortBuildings([...BUILDINGS.values()].filter((b) => !b.campaignOnly && (b.race === 'all' || b.race === race)));
}

export function raceUnits(race: RaceId): UnitDef[] {
  return [...UNITS.values()].filter((u) => u.race === race);
}
