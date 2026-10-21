import { getBuilding } from './data/index';
import {
  build,
  canBuild,
  canExpand,
  canUpgrade,
  canUpgradeCastle,
  castleMaxHp,
  castleUpgradeCost,
  expand,
  isCastleTile,
  isExpandable,
  repairCastle,
  tileAt,
  upgrade,
  upgradeCastle,
  type GameState,
} from './state';
import type { RaceId, Stance } from './types';

/** Build orders used by the balance bot: a reasonable, not optimal, player. */
export const BOT_PLANS: Record<RaceId, string[]> = {
  human: [
    'human_b_militia', 'gold_mine', 'human_b_pikeman', 'gold_mine', 'human_b_archer', 'human_market', 'human_tower',
    'human_b_archer', 'human_b_priest', 'human_b_pikeman', 'human_market', 'human_b_knight', 'human_tower',
    'human_b_knight', 'human_b_champion', 'human_b_archer', 'human_b_priest', 'human_tower',
  ],
  elf: [
    'elf_b_sentinel', 'gold_mine', 'elf_b_archer', 'gold_mine', 'elf_b_druid', 'elf_moonwell', 'elf_b_archer',
    'elf_tower', 'elf_b_windrunner', 'elf_b_druid', 'elf_b_sentinel', 'elf_b_priestess', 'elf_b_windrunner',
    'elf_b_treant', 'elf_b_archer', 'elf_tower', 'elf_b_sentinel',
  ],
  dwarf: [
    'dwarf_ballista', 'gold_mine', 'dwarf_b_shieldguard', 'gold_mine', 'dwarf_cannon', 'dwarf_forge', 'dwarf_ballista',
    'dwarf_b_engineer', 'dwarf_runetower', 'dwarf_b_runepriest', 'dwarf_cannon', 'dwarf_b_shieldguard',
    'dwarf_flametower', 'dwarf_b_musketeer', 'dwarf_b_golem', 'dwarf_runetower', 'dwarf_flametower',
  ],
  demon: [
    'demon_b_imp', 'gold_mine', 'demon_b_berserker', 'gold_mine', 'demon_b_warlock', 'demon_pit', 'demon_b_imp',
    'demon_tower', 'demon_b_succubus', 'demon_b_warlock', 'demon_b_cultist', 'demon_b_berserker', 'demon_b_pitlord',
    'demon_b_imp', 'demon_b_succubus', 'demon_tower',
  ],
  angel: [
    'angel_b_guardian', 'gold_mine', 'angel_b_archer', 'gold_mine', 'angel_b_healer', 'angel_sanctum',
    'angel_b_guardian', 'angel_tower', 'angel_b_aegis', 'angel_b_archer', 'angel_b_judicator', 'angel_b_seraph',
    'angel_b_healer', 'angel_b_judicator', 'angel_tower', 'angel_b_archer',
  ],
};

/** Stance the bot fights with: the tower race holds, everyone else meets the enemy in the field. */
export const BOT_STANCE: Record<RaceId, Stance> = {
  human: 'advance',
  elf: 'advance',
  dwarf: 'hold',
  demon: 'advance',
  angel: 'advance',
};

/** Castle level the bot aims for at each wave. */
const CASTLE_SCHEDULE = [0, 3, 7, 12, 17];

function placeScore(state: GameState, i: number, j: number, kind: string): number {
  let adj = 0;
  for (const [di, dj] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const t = tileAt(state, i + di, j + dj);
    if (t?.building && getBuilding(t.building.defId).kind === kind) adj++;
  }
  const front = kind === 'resource' ? -i : i;
  return front * 10 + adj * 3 - Math.abs(j);
}

function bestTile(state: GameState, defId: string): { i: number; j: number } | null {
  const kind = getBuilding(defId).kind;
  let best: { i: number; j: number } | null = null;
  let bestScore = -Infinity;
  for (const t of state.tiles) {
    if (!t.owned || t.building || isCastleTile(t.i, t.j)) continue;
    const s = placeScore(state, t.i, t.j, kind);
    if (s > bestScore) {
      bestScore = s;
      best = { i: t.i, j: t.j };
    }
  }
  return best;
}

function tryExpand(state: GameState): boolean {
  const options = state.tiles.filter((t) => isExpandable(state, t.i, t.j) && canExpand(state, t.i, t.j).ok);
  if (!options.length) return false;
  options.sort((a, b) => b.i - a.i || Math.abs(a.j) - Math.abs(b.j));
  return expand(state, options[0].i, options[0].j);
}

/** Spend the treasury for one prep phase. */
export function botPrepare(state: GameState, planIndex: { n: number }): void {
  const plan = BOT_PLANS[state.race];
  state.stance = BOT_STANCE[state.race];
  // Keep the castle alive.
  if (state.castleHp < castleMaxHp(state) * 0.55) repairCastle(state);

  for (let guard = 0; guard < 60; guard++) {
    const targetCastle = CASTLE_SCHEDULE.filter((w) => state.wave >= w).length;
    if (state.castleLevel < targetCastle) {
      if (canUpgradeCastle(state).ok) {
        upgradeCastle(state);
        continue;
      }
      // Save up, but never sit on gold while the plot is still empty early on.
      if (state.gold < (castleUpgradeCost(state) ?? 0)) break;
    }
    const nextId = plan[planIndex.n % plan.length];
    const def = getBuilding(nextId);
    const resources = state.tiles.filter((t) => t.building && getBuilding(t.building.defId).kind === 'resource').length;
    if (def.kind === 'resource' && (planIndex.n >= plan.length || resources >= 4)) {
      planIndex.n++;
      continue;
    }
    if (def.castleLevel <= state.castleLevel) {
      const spot = bestTile(state, nextId);
      if (!spot) {
        if (tryExpand(state)) continue;
      } else if (canBuild(state, spot.i, spot.j, nextId).ok) {
        build(state, spot.i, spot.j, nextId);
        planIndex.n++;
        continue;
      }
    } else {
      planIndex.n++;
      if (planIndex.n > plan.length * 3) break;
      continue;
    }
    // Upgrades: cheapest first, combat buildings before economy late game.
    const upgrades = state.tiles
      .filter((t) => t.building && canUpgrade(state, t.i, t.j).ok)
      .map((t) => {
        const cost = (canUpgrade(state, t.i, t.j) as { cost: number }).cost;
        const combat = getBuilding(t.building!.defId).kind !== 'resource';
        return { t, cost, weight: cost * (combat ? 0.6 : 1) };
      })
      .sort((a, b) => a.weight - b.weight);
    if (upgrades.length && state.gold - upgrades[0].cost > 40) {
      upgrade(state, upgrades[0].t.i, upgrades[0].t.j);
      continue;
    }
    break;
  }
}
