import {
  ADJACENT_BARRACKS_SPAWN_BONUS,
  ADJACENT_RESOURCE_INCOME_BONUS,
  ADJACENT_TOWER_DMG_BONUS,
  BOON_EVERY,
  CASTLE,
  DEMOLISH_REFUND,
  EXPAND_BASE_COST,
  EXPAND_STEP_COST,
  FINAL_WAVE,
  GRID_RADIUS,
  MAX_BUILDING_LEVEL,
  REPAIR_GOLD_PER_HP,
  START_GOLD,
  START_RADIUS,
  UPGRADE_COST_MULT,
} from './constants';
import { PERK_MAP } from './campaign/perks';
import { TERRAINS, type TerrainId } from './campaign/terrain';
import { BOONS, BOON_MAP } from './data/boons';
import { BUILDINGS, getBuilding, RACE_MAP, raceBuildings, sortBuildings } from './data/index';
import { Rng } from './rng';
import type { BuildingDef, Modifiers, RaceId } from './types';

export interface PlacedBuilding {
  uid: number;
  defId: string;
  level: number;
  invested: number;
}

export interface Tile {
  i: number;
  j: number;
  owned: boolean;
  building: PlacedBuilding | null;
}

export type Phase = 'prep' | 'battle' | 'boon' | 'over' | 'victory';

export interface IncomeLine {
  label: string;
  amount: number;
}

export interface WaveReport {
  wave: number;
  won: boolean;
  income: IncomeLine[];
  total: number;
  kills: number;
  deaths: number;
  castleDamage: number;
  castleRepair: number;
}

/** What a finished battle reports back to the game state. */
export interface BattleOutcome {
  won: boolean;
  castleHp: number;
  kills: number;
  bounty: number;
  playerDeaths: number;
  /** Gold pocketed by goblin thieves this wave. */
  goldStolen?: number;
}

/** A campaign battle for one territory of the world map. */
export interface LevelInfo {
  territoryId: string;
  name: string;
  terrain: TerrainId;
  totalWaves: number;
}

/**
 * Campaign battles run a quicker economy so a 6-wave fight still reaches the late game. The war chest
 * grows with the territory's distance from the refuge (index = tier, 5 = capital).
 */
export const CAMPAIGN_ECONOMY = { startGold: [0, 360, 650, 1000, 1400, 1900], castleIncome: 1.7, income: 1.35 };

export interface GameState {
  race: RaceId;
  gold: number;
  wave: number;
  castleLevel: number;
  castleHp: number;
  tiles: Tile[];
  expansions: number;
  boons: string[];
  endless: boolean;
  /** Campaign battle info; null in the classic 30-wave mode. */
  level: LevelInfo | null;
  /** Permanent campaign perks from liberated territories. */
  perks: string[];
  /** Campaign special buildings this battle may use. */
  unlocks: string[];
  phase: Phase;
  boonChoices: string[];
  report: WaveReport | null;
  nextUid: number;
  seed: number;
  stats: { kills: number; deaths: number; goldEarned: number };
}

export type Check = { ok: true; cost: number } | { ok: false; reason: string; cost?: number };

export const CASTLE_UID = 0;

export function newGame(race: RaceId, seed = Date.now()): GameState {
  const tiles: Tile[] = [];
  for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i++) {
    for (let j = -GRID_RADIUS; j <= GRID_RADIUS; j++) {
      const owned = Math.abs(i) <= START_RADIUS && Math.abs(j) <= START_RADIUS;
      tiles.push({ i, j, owned, building: null });
    }
  }
  const state: GameState = {
    race,
    gold: START_GOLD,
    wave: 1,
    castleLevel: 1,
    castleHp: 0,
    tiles,
    expansions: 0,
    boons: [],
    endless: false,
    level: null,
    perks: [],
    unlocks: [],
    phase: 'prep',
    boonChoices: [],
    report: null,
    nextUid: 1,
    seed: seed >>> 0,
    stats: { kills: 0, deaths: 0, goldEarned: 0 },
  };
  state.castleHp = castleMaxHp(state);
  return state;
}

export function tileAt(state: GameState, i: number, j: number): Tile | undefined {
  if (Math.abs(i) > GRID_RADIUS || Math.abs(j) > GRID_RADIUS) return undefined;
  return state.tiles[(i + GRID_RADIUS) * (GRID_RADIUS * 2 + 1) + (j + GRID_RADIUS)];
}

export function isCastleTile(i: number, j: number): boolean {
  return i === 0 && j === 0;
}

export function baseModifiers(): Modifiers {
  return {
    incomeMult: 1,
    costMult: 1,
    buildingHpMult: 1,
    towerDmgMult: 1,
    towerAtkSpeedMult: 1,
    unitHpMult: 1,
    unitDmgMult: 1,
    unitArmorAdd: 0,
    unitEvasionAdd: 0,
    unitSpeedMult: 1,
    spawnSpeedMult: 1,
    maxAliveAdd: 0,
    bountyMult: 1,
    castleHpMult: 1,
    expandCostMult: 1,
    interest: 0,
    regenPct: 0,
    startShieldPct: 0,
    overhealShieldCap: 0,
    combinedArms: 0,
    rootDurationAdd: 0,
    critMult: 0,
    rangeAdd: {},
    chargeMult: 0,
    explosionMult: 1,
    resurrectSpeedMult: 1,
    engineerMult: 1,
    healMult: 1,
    castleDmgMult: 1,
    castleIncomeMult: 1,
    rangeAddAll: 0,
    towerRangeAdd: 0,
    enemyHpMult: 1,
    enemyDmgMult: 1,
    enemySpeedMult: 1,
    enemyEvasionAdd: 0,
  };
}

export function getModifiers(state: GameState): Modifiers {
  const m = baseModifiers();
  const r = RACE_MAP.get(state.race)!.mods;
  m.incomeMult *= r.incomeMult ?? 1;
  m.costMult *= r.costMult ?? 1;
  m.buildingHpMult *= r.buildingHpMult ?? 1;
  m.towerDmgMult *= r.towerDmgMult ?? 1;
  m.castleDmgMult *= r.towerDmgMult ?? 1;
  m.unitArmorAdd += r.unitArmorAdd ?? 0;
  m.unitEvasionAdd += r.unitEvasionAdd ?? 0;
  m.spawnSpeedMult *= r.spawnSpeedMult ?? 1;
  m.maxAliveAdd += r.maxAliveAdd ?? 0;
  m.unitHpMult *= r.unitHpMult ?? 1;
  m.regenPct += r.regenPct ?? 0;
  m.startShieldPct += r.startShieldPct ?? 0;
  m.overhealShieldCap += r.overhealShieldCap ?? 0;
  m.combinedArms += r.combinedArms ?? 0;
  for (const id of state.boons) BOON_MAP.get(id)?.apply(m);
  for (const id of state.perks ?? []) PERK_MAP.get(id)?.apply(m);
  if (state.level) {
    m.castleIncomeMult *= CAMPAIGN_ECONOMY.castleIncome;
    m.incomeMult *= CAMPAIGN_ECONOMY.income;
    TERRAINS[state.level.terrain].apply(m);
  }
  return m;
}

export function castleMaxHp(state: GameState): number {
  return Math.round(CASTLE.hp[state.castleLevel - 1] * getModifiers(state).castleHpMult);
}

export function buildCost(state: GameState, def: BuildingDef): number {
  return Math.round(def.cost * getModifiers(state).costMult);
}

export function upgradeCostFor(state: GameState, b: PlacedBuilding): number | null {
  if (b.level >= MAX_BUILDING_LEVEL) return null;
  const def = getBuilding(b.defId);
  return Math.round(def.cost * UPGRADE_COST_MULT[b.level] * getModifiers(state).costMult);
}

export function availableToRace(state: GameState, def: BuildingDef): boolean {
  return def.race === 'all' || def.race === state.race;
}

export function canBuild(state: GameState, i: number, j: number, defId: string): Check {
  const def = getBuilding(defId);
  const tile = tileAt(state, i, j);
  const cost = buildCost(state, def);
  if (state.phase !== 'prep') return { ok: false, reason: '只能在準備階段建造' };
  if (!tile || !tile.owned) return { ok: false, reason: '這塊土地尚未擁有' };
  if (isCastleTile(i, j) || tile.building) return { ok: false, reason: '這裡已經有建築' };
  if (!availableToRace(state, def)) return { ok: false, reason: '其他種族的建築' };
  if (def.campaignOnly) {
    if (!(state.unlocks ?? []).includes(def.id)) return { ok: false, reason: '尚未解鎖的特殊建築' };
    if (state.tiles.some((t) => t.building?.defId === def.id)) return { ok: false, reason: '每種特殊建築限蓋 1 座', cost };
  }
  if (state.castleLevel < def.castleLevel) return { ok: false, reason: `需要主堡等級 ${def.castleLevel}`, cost };
  if (state.gold < cost) return { ok: false, reason: '金幣不足', cost };
  return { ok: true, cost };
}

export function build(state: GameState, i: number, j: number, defId: string): boolean {
  const check = canBuild(state, i, j, defId);
  if (!check.ok) return false;
  const tile = tileAt(state, i, j)!;
  state.gold -= check.cost;
  tile.building = { uid: state.nextUid++, defId, level: 1, invested: check.cost };
  return true;
}

export function canUpgrade(state: GameState, i: number, j: number): Check {
  const tile = tileAt(state, i, j);
  if (state.phase !== 'prep') return { ok: false, reason: '只能在準備階段升級' };
  if (!tile?.building) return { ok: false, reason: '沒有建築' };
  const cost = upgradeCostFor(state, tile.building);
  if (cost === null) return { ok: false, reason: '已達最高等級' };
  const next = tile.building.level + 1;
  if (state.castleLevel < next) return { ok: false, reason: `需要主堡等級 ${next}`, cost };
  if (state.gold < cost) return { ok: false, reason: '金幣不足', cost };
  return { ok: true, cost };
}

export function upgrade(state: GameState, i: number, j: number): boolean {
  const check = canUpgrade(state, i, j);
  if (!check.ok) return false;
  const b = tileAt(state, i, j)!.building!;
  state.gold -= check.cost;
  b.level += 1;
  b.invested += check.cost;
  return true;
}

export function demolishRefund(b: PlacedBuilding): number {
  return Math.floor(b.invested * DEMOLISH_REFUND);
}

export function demolish(state: GameState, i: number, j: number): number {
  const tile = tileAt(state, i, j);
  if (state.phase !== 'prep' || !tile?.building) return 0;
  const refund = demolishRefund(tile.building);
  state.gold += refund;
  tile.building = null;
  return refund;
}

export function expansionCap(state: GameState): number {
  return CASTLE.expansionCap[state.castleLevel - 1];
}

export function expandCost(state: GameState): number {
  return Math.round((EXPAND_BASE_COST + EXPAND_STEP_COST * state.expansions) * getModifiers(state).expandCostMult);
}

export function isExpandable(state: GameState, i: number, j: number): boolean {
  const tile = tileAt(state, i, j);
  if (!tile || tile.owned) return false;
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([di, dj]) => tileAt(state, i + di, j + dj)?.owned);
}

export function canExpand(state: GameState, i: number, j: number): Check {
  const cost = expandCost(state);
  if (state.phase !== 'prep') return { ok: false, reason: '只能在準備階段擴張' };
  if (!isExpandable(state, i, j)) return { ok: false, reason: '只能擴張相鄰的土地' };
  if (state.expansions >= expansionCap(state)) {
    return state.castleLevel >= CASTLE.maxLevel
      ? { ok: false, reason: '已達土地上限', cost }
      : { ok: false, reason: `升級主堡以解鎖更多土地（目前 ${state.expansions}/${expansionCap(state)}）`, cost };
  }
  if (state.gold < cost) return { ok: false, reason: '金幣不足', cost };
  return { ok: true, cost };
}

export function expand(state: GameState, i: number, j: number): boolean {
  const check = canExpand(state, i, j);
  if (!check.ok) return false;
  state.gold -= check.cost;
  tileAt(state, i, j)!.owned = true;
  state.expansions += 1;
  return true;
}

export function castleUpgradeCost(state: GameState): number | null {
  if (state.castleLevel >= CASTLE.maxLevel) return null;
  return Math.round(CASTLE.upgradeCost[state.castleLevel] * getModifiers(state).costMult);
}

export function canUpgradeCastle(state: GameState): Check {
  const cost = castleUpgradeCost(state);
  if (state.phase !== 'prep') return { ok: false, reason: '只能在準備階段升級' };
  if (cost === null) return { ok: false, reason: '主堡已達最高等級' };
  if (state.gold < cost) return { ok: false, reason: '金幣不足', cost };
  return { ok: true, cost };
}

export function upgradeCastle(state: GameState): boolean {
  const check = canUpgradeCastle(state);
  if (!check.ok) return false;
  const before = castleMaxHp(state);
  state.gold -= check.cost;
  state.castleLevel += 1;
  state.castleHp += castleMaxHp(state) - before;
  return true;
}

/** Gold needed to fully repair the castle. */
export function fullRepairCost(state: GameState): number {
  return Math.ceil((castleMaxHp(state) - state.castleHp) * REPAIR_GOLD_PER_HP);
}

/** Repair as much as the treasury allows. Returns HP restored. */
export function repairCastle(state: GameState): number {
  if (state.phase !== 'prep') return 0;
  const missing = castleMaxHp(state) - state.castleHp;
  if (missing <= 0) return 0;
  const affordable = Math.floor(state.gold / REPAIR_GOLD_PER_HP);
  const hp = Math.min(missing, affordable);
  state.gold -= Math.ceil(hp * REPAIR_GOLD_PER_HP);
  state.castleHp += hp;
  return hp;
}

const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Orthogonally adjacent buildings. The castle counts as a building with def `null`. */
export function adjacentBuildings(state: GameState, i: number, j: number): (BuildingDef | null)[] {
  const out: (BuildingDef | null)[] = [];
  for (const [di, dj] of ORTHO) {
    const t = tileAt(state, i + di, j + dj);
    if (!t?.owned) continue;
    if (isCastleTile(i + di, j + dj)) out.push(null);
    else if (t.building) out.push(getBuilding(t.building.defId));
  }
  return out;
}

export interface TileBonuses {
  incomeMult: number;
  spawnMult: number;
  towerDmgMult: number;
  unitHpMult: number;
  lines: string[];
}

/** Placement bonuses a building gets from its neighbours. */
export function tileBonuses(state: GameState, i: number, j: number): TileBonuses {
  const res: TileBonuses = { incomeMult: 1, spawnMult: 1, towerDmgMult: 1, unitHpMult: 1, lines: [] };
  const tile = tileAt(state, i, j);
  if (!tile?.building) return res;
  const def = getBuilding(tile.building.defId);
  const adj = adjacentBuildings(state, i, j);
  if (def.kind === 'resource') {
    const n = adj.filter((d) => d?.kind === 'resource').length;
    if (n) {
      res.incomeMult += ADJACENT_RESOURCE_INCOME_BONUS * n;
      res.lines.push(`相鄰資源建築 ×${n}：產量 +${Math.round(ADJACENT_RESOURCE_INCOME_BONUS * n * 100)}%`);
    }
  }
  if (def.kind === 'barracks') {
    const n = adj.filter((d) => d?.kind === 'barracks').length;
    if (n) {
      res.spawnMult += ADJACENT_BARRACKS_SPAWN_BONUS * n;
      res.lines.push(`相鄰兵營 ×${n}：出兵速度 +${Math.round(ADJACENT_BARRACKS_SPAWN_BONUS * n * 100)}%`);
    }
    for (const [di, dj] of ORTHO) {
      const t = tileAt(state, i + di, j + dj);
      const sp = t?.building ? getBuilding(t.building.defId).special : undefined;
      if (sp?.type === 'moonwell') {
        const v = sp.hpBonus[t!.building!.level - 1];
        res.unitHpMult += v;
        res.lines.push(`相鄰月井：士兵生命 +${Math.round(v * 100)}%`);
      }
    }
  }
  if (def.kind === 'tower') {
    const n = adj.filter((d) => d?.kind === 'tower').length;
    if (n) {
      res.towerDmgMult += ADJACENT_TOWER_DMG_BONUS * n;
      res.lines.push(`相鄰防禦塔 ×${n}：傷害 +${Math.round(ADJACENT_TOWER_DMG_BONUS * n * 100)}%`);
    }
    for (const [di, dj] of ORTHO) {
      const t = tileAt(state, i + di, j + dj);
      const sp = t?.building ? getBuilding(t.building.defId).special : undefined;
      if (sp?.type === 'forge') {
        const v = sp.towerDmg[t!.building!.level - 1];
        res.towerDmgMult += v;
        res.lines.push(`相鄰鍛爐：傷害 +${Math.round(v * 100)}%`);
      }
    }
  }
  return res;
}

/** Gold a resource building yields at the end of a wave (without per-death bonuses). */
export function buildingIncome(state: GameState, i: number, j: number): number {
  const tile = tileAt(state, i, j);
  if (!tile?.building) return 0;
  const def = getBuilding(tile.building.defId);
  if (def.kind !== 'resource' || !def.income) return 0;
  const lvl = tile.building.level - 1;
  let gold = def.income[lvl];
  if (def.special?.type === 'market') {
    gold += def.special.perAdjacent[lvl] * adjacentBuildings(state, i, j).length;
  }
  return Math.round(gold * tileBonuses(state, i, j).incomeMult * getModifiers(state).incomeMult);
}

export function castleIncome(state: GameState): number {
  return Math.round(CASTLE.baseIncome[state.castleLevel - 1] * getModifiers(state).castleIncomeMult);
}

/** Buildings the player may pick from: race roster plus unlocked campaign specials. */
export function availableBuildings(state: GameState): BuildingDef[] {
  const specials = [...BUILDINGS.values()].filter((b) => b.campaignOnly && (state.unlocks ?? []).includes(b.id));
  return [...raceBuildings(state.race), ...sortBuildings(specials)];
}

/** Income lines the player can expect next wave (excluding bounty and death bonuses). */
export function projectedIncome(state: GameState): IncomeLine[] {
  const lines: IncomeLine[] = [{ label: '主堡稅收', amount: castleIncome(state) }];
  let resources = 0;
  for (const t of state.tiles) resources += buildingIncome(state, t.i, t.j);
  if (resources) lines.push({ label: '資源建築', amount: resources });
  return lines;
}

export function isBoonWave(wave: number): boolean {
  return wave % BOON_EVERY === 0;
}

export function rollBoons(state: GameState): string[] {
  const rng = new Rng(state.seed ^ (state.wave * 2654435761));
  const pool = BOONS.filter((b) => (!b.race || b.race === state.race) && !state.boons.includes(b.id));
  const raceBoons = rng.shuffle(pool.filter((b) => b.race));
  const generic = rng.shuffle(pool.filter((b) => !b.race));
  const picks = [...(raceBoons.length ? [raceBoons[0]] : []), ...generic].slice(0, 3);
  return rng.shuffle(picks).map((b) => b.id);
}

export function chooseBoon(state: GameState, id: string): boolean {
  if (state.phase !== 'boon' || !state.boonChoices.includes(id)) return false;
  const before = castleMaxHp(state);
  state.boons.push(id);
  state.boonChoices = [];
  const after = castleMaxHp(state);
  if (id === 'b_castle') state.castleHp = after;
  else state.castleHp = Math.min(after, state.castleHp + Math.max(0, after - before));
  state.phase = state.wave > FINAL_WAVE && !state.endless ? 'victory' : 'prep';
  return true;
}

/** Applies a finished battle: income, repairs, wave advance and next phase. */
export function applyBattleOutcome(state: GameState, outcome: BattleOutcome): WaveReport {
  const wave = state.wave;
  const castleDamage = Math.max(0, state.castleHp - outcome.castleHp);
  state.castleHp = Math.max(0, outcome.castleHp);
  state.stats.kills += outcome.kills;
  state.stats.deaths += outcome.playerDeaths;
  const report: WaveReport = {
    wave,
    won: outcome.won,
    income: [],
    total: 0,
    kills: outcome.kills,
    deaths: outcome.playerDeaths,
    castleDamage,
    castleRepair: 0,
  };
  if (!outcome.won) {
    state.phase = 'over';
    state.report = report;
    return report;
  }
  const mods = getModifiers(state);
  report.income.push(...projectedIncome(state));
  let repair = 0;
  for (const t of state.tiles) {
    if (!t.building) continue;
    const def = getBuilding(t.building.defId);
    const lvl = t.building.level - 1;
    if (def.special?.type === 'sanctum') repair += def.special.castleRepair[lvl];
  }
  if (outcome.bounty) report.income.push({ label: `擊殺獎勵（${outcome.kills}）`, amount: outcome.bounty });
  if (mods.interest > 0) {
    report.income.push({ label: '國庫利息', amount: Math.min(120, Math.floor(state.gold * mods.interest)) });
  }
  const gross = report.income.reduce((s, l) => s + l.amount, 0);
  if (outcome.goldStolen) {
    report.income.push({ label: '哥布林偷走的金幣', amount: -Math.min(outcome.goldStolen, state.gold + gross) });
  }
  report.total = report.income.reduce((s, l) => s + l.amount, 0);
  state.gold += report.total;
  state.stats.goldEarned += report.total;
  if (repair) {
    const before = state.castleHp;
    state.castleHp = Math.min(castleMaxHp(state), state.castleHp + repair);
    report.castleRepair = state.castleHp - before;
  }
  state.report = report;
  state.wave += 1;
  if (state.level) {
    // Campaign battles: no boons; the territory is liberated after its last wave.
    state.phase = wave >= state.level.totalWaves ? 'victory' : 'prep';
    return report;
  }
  if (isBoonWave(wave)) {
    state.boonChoices = rollBoons(state);
    state.phase = state.boonChoices.length ? 'boon' : 'prep';
  } else {
    state.phase = 'prep';
  }
  if (wave === FINAL_WAVE && !state.endless && state.phase === 'prep') state.phase = 'victory';
  return report;
}

export function continueEndless(state: GameState): void {
  state.endless = true;
  if (state.phase === 'victory') state.phase = 'prep';
}

export function ownedBuildings(state: GameState): { tile: Tile; def: BuildingDef; b: PlacedBuilding }[] {
  return state.tiles
    .filter((t) => t.building)
    .map((t) => ({ tile: t, def: getBuilding(t.building!.defId), b: t.building! }));
}
