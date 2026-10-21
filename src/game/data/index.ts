import type { BuildingDef, RaceDef, RaceId, UnitDef } from '../types';
import { ANGEL, ANGEL_BUILDINGS, ANGEL_UNITS } from './angel';
import { COMMON_BUILDINGS } from './common';
import { DEMON, DEMON_BUILDINGS, DEMON_UNITS } from './demon';
import { DWARF, DWARF_BUILDINGS, DWARF_UNITS } from './dwarf';
import { ELF, ELF_BUILDINGS, ELF_UNITS } from './elf';
import { HUMAN, HUMAN_BUILDINGS, HUMAN_UNITS } from './human';
import { MONSTERS } from './monsters';

export const RACES: RaceDef[] = [HUMAN, ELF, DWARF, DEMON, ANGEL];
export const RACE_MAP = new Map<RaceId, RaceDef>(RACES.map((r) => [r.id, r]));

export const UNITS = new Map<string, UnitDef>(
  [...HUMAN_UNITS, ...ELF_UNITS, ...DWARF_UNITS, ...DEMON_UNITS, ...ANGEL_UNITS, ...MONSTERS].map((u) => [u.id, u]),
);

export const BUILDINGS = new Map<string, BuildingDef>(
  [...COMMON_BUILDINGS, ...HUMAN_BUILDINGS, ...ELF_BUILDINGS, ...DWARF_BUILDINGS, ...DEMON_BUILDINGS, ...ANGEL_BUILDINGS].map(
    (b) => [b.id, b],
  ),
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

/** Buildings available to a race, in menu order. */
export function raceBuildings(race: RaceId): BuildingDef[] {
  const kindOrder = { resource: 0, tower: 1, barracks: 2 } as const;
  return [...BUILDINGS.values()]
    .filter((b) => b.race === 'all' || b.race === race)
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.castleLevel - b.castleLevel || a.cost - b.cost);
}

export function raceUnits(race: RaceId): UnitDef[] {
  return [...UNITS.values()].filter((u) => u.race === race);
}
