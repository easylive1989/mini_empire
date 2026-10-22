import { countersOf, analyzeWave } from './advisor';
import { waveForState } from './battle';
import { doctrineOf, type DoctrineId } from './campaign/doctrines';
import { getTerritory } from './campaign/territories';
import { getBuilding, raceBuildings } from './data/index';
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
  availableBuildings,
  buildCost,
  type GameState,
} from './state';
import type { RaceId } from './types';

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
  angel: [
    'angel_b_guardian', 'gold_mine', 'angel_b_archer', 'gold_mine', 'angel_b_healer', 'angel_sanctum',
    'angel_b_guardian', 'angel_tower', 'angel_b_aegis', 'angel_b_archer', 'angel_b_judicator', 'angel_b_seraph',
    'angel_b_healer', 'angel_b_judicator', 'angel_tower', 'angel_b_archer',
  ],
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
export function botPrepare(state: GameState, planIndex: { n: number }, plan = BOT_PLANS[state.race]): void {
  // Keep the castle alive.
  if (state.castleHp < castleMaxHp(state) * 0.55) repairCastle(state);

  for (let guard = 0; guard < 60; guard++) {
    const combat = state.tiles.filter((t) => t.building && getBuilding(t.building.defId).kind !== 'resource').length;
    // Campaign battles are short: build an army first, tech up once it is in place.
    const targetCastle = state.level
      ? combat >= state.castleLevel * 2 + 2
        ? state.castleLevel + 1
        : state.castleLevel
      : CASTLE_SCHEDULE.filter((w) => state.wave >= w).length;
    if (state.castleLevel < targetCastle) {
      if (canUpgradeCastle(state).ok) {
        upgradeCastle(state);
        continue;
      }
      // Save up, but never sit on gold while the plot is still empty early on.
      if (state.gold < (castleUpgradeCost(state) ?? 0)) break;
    }
    // Campaign: once a core army stands, alternate between upgrades and new buildings.
    if (state.level && combat >= 2 + state.castleLevel) {
      const up = state.tiles
        .filter((t) => t.building && getBuilding(t.building.defId).kind !== 'resource' && canUpgrade(state, t.i, t.j).ok)
        .sort((a, b) => a.building!.level - b.building!.level);
      if (up.length && (guard % 2 === 0 || !state.tiles.some((t) => t.owned && !t.building && !isCastleTile(t.i, t.j)))) {
        upgrade(state, up[0].i, up[0].j);
        continue;
      }
    }
    // Campaign specials are slotted in once the core of the plan is built.
    const specials = (state.unlocks ?? []).filter((id) => !state.tiles.some((t) => t.building?.defId === id));
    const builtSpecials = state.tiles.filter((t) => t.building && getBuilding(t.building.defId).campaignOnly).length;
    const special = planIndex.n >= plan.length && builtSpecials < 2 ? specials.find((id) => getBuilding(id).castleLevel <= state.castleLevel) : undefined;
    if (special) {
      const spot = bestTile(state, special);
      if (spot && canBuild(state, spot.i, spot.j, special).ok) {
        build(state, spot.i, spot.j, special);
        continue;
      }
    }
    const nextId = plan[planIndex.n % plan.length];
    const def = getBuilding(nextId);
    const resources = state.tiles.filter((t) => t.building && getBuilding(t.building.defId).kind === 'resource').length;
    if (def.kind === 'resource' && (planIndex.n >= plan.length || resources >= (state.level ? 2 : 4))) {
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

/**
 * A lazy player for difficulty checks: fills the plot with level-1 starter barracks and never
 * upgrades anything. Campaign territories should not be winnable this way past the first tier.
 */
export function lazyPrepare(state: GameState, planIndex: { n: number }): void {
  const plan = raceBuildings(state.race)
    .filter((b) => b.kind === 'barracks' && b.castleLevel === 1)
    .map((b) => b.id);
  if (state.castleHp < castleMaxHp(state) * 0.55) repairCastle(state);
  for (;;) {
    const id = plan[planIndex.n % plan.length];
    const spot = bestTile(state, id);
    if (!spot || !canBuild(state, spot.i, spot.j, id).ok) return;
    build(state, spot.i, spot.j, id);
    planIndex.n++;
  }
}

/**
 * A player who reads the wave preview: before following the usual plan, answers every threat of
 * the next wave that the town has no counter for with the cheapest building that counters it.
 * Comparing it with `botPrepare` shows how much reading the enemy is worth.
 */
export function adaptivePrepare(state: GameState, planIndex: { n: number }): void {
  if (state.castleHp < castleMaxHp(state) * 0.55) repairCastle(state);
  const wave = waveForState(state);
  // Enemies the army cannot touch (flyers) or barely scratch (heavy armor) get an answer first,
  // upgrading the castle when the answer needs it.
  for (const threat of analyzeWave(state, wave)) {
    if (threat.severity !== 'warn' || (threat.id !== 'air' && threat.id !== 'armor')) continue;
    const answerAt = (level: number) =>
      availableBuildings(state)
        .filter((b) => b.kind !== 'resource' && b.castleLevel <= level && countersOf(b).includes(threat.id))
        .sort((a, b) => buildCost(state, a) - buildCost(state, b))[0];
    if (!answerAt(state.castleLevel) && answerAt(state.castleLevel + 1) && canUpgradeCastle(state).ok) upgradeCastle(state);
    const answer = answerAt(state.castleLevel);
    if (!answer) continue;
    const spot = bestTile(state, answer.id);
    if (spot && canBuild(state, spot.i, spot.j, answer.id).ok) build(state, spot.i, spot.j, answer.id);
  }
  // Armor and shield walls cover the whole army: every other building of the plan answers them.
  const plan = BOT_PLANS[state.race];
  const need = wave.trait === 'armored' ? 'armor' : wave.trait === 'shieldwall' ? 'shield' : null;
  const counters = need ? plan.filter((id) => countersOf(getBuilding(id)).includes(need)) : [];
  botPrepare(state, planIndex, counters.length ? plan.flatMap((id, k) => [counters[k % counters.length], id]) : plan);
}

/** A one-trick player: the race's first combat building over and over, upgraded like the normal bot. */
export function monoPrepare(state: GameState, planIndex: { n: number }): void {
  const core = BOT_PLANS[state.race].find((id) => getBuilding(id).kind !== 'resource')!;
  // A long plan keeps the bot from ever reaching the campaign specials.
  botPrepare(state, planIndex, [core, 'gold_mine', core, 'gold_mine', ...Array<string>(30).fill(core)]);
}

/** The doctrine most of a build order belongs to (what a player sticking to one army would pick). */
export function planDoctrine(plan: string[]): DoctrineId {
  const ranged = plan.filter((id) => doctrineOf(getBuilding(id)) === 'ranged').length;
  const front = plan.filter((id) => doctrineOf(getBuilding(id)) === 'front').length;
  return ranged > front ? 'ranged' : 'front';
}

/** Doctrine for each strategy: the one-trick and fixed bots keep theirs, the wave reader adapts. */
export function botDoctrine(race: RaceId, territoryId: string, strategy: 'fixed' | 'adaptive' | 'mono'): DoctrineId {
  const plan = BOT_PLANS[race];
  if (strategy === 'mono') return doctrineOf(getBuilding(plan.find((id) => getBuilding(id).kind !== 'resource')!)) ?? 'front';
  // A shield wall is broken in melee; thorns, flyers, raiders and armor are answered from range.
  const trait = getTerritory(territoryId).trait;
  if (strategy === 'adaptive' && trait) return trait === 'shieldwall' ? 'front' : 'ranged';
  return planDoctrine(plan);
}
