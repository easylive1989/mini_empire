import { CASTLE } from '../constants';
import { castleMaxHp, CAMPAIGN_ECONOMY, newGame, type GameState } from '../state';
import { RACE_MAP } from '../data/index';
import type { RaceId } from '../types';
import { territoryWaveCount } from './campaignWaves';
import type { DoctrineId } from './doctrines';
import { PERK_MAP, type PerkDef } from './perks';
import { CAPITAL_TERRITORY, getTerritory, neighbours, START_TERRITORY, TERRITORIES, territoryTier } from './territories';

export interface CampaignState {
  version: 1;
  race: RaceId;
  /** Liberated territories, including the starting refuge. */
  conquered: string[];
  capitalTaken: boolean;
  battles: number;
  victories: number;
  kills: number;
  createdAt: number;
  /** Best star rating per liberated territory (1–3); absent in older saves. */
  stars?: Record<string, number>;
  /** War doctrine last picked on the map; the next battle starts with it. */
  doctrine?: DoctrineId;
}

/** What each star of a territory battle asks for (castle damage counts every hit across all waves). */
export const STAR_RULES = ['收復領地', '主堡累計受損少於最大生命的 50%', '主堡累計受損不超過最大生命的 10%'] as const;

/** Stars for a won territory battle, from the castle damage taken over all its waves. */
export function battleStars(castleDamage: number, castleMax: number): number {
  const ratio = castleDamage / Math.max(1, castleMax);
  return 1 + (ratio < 0.5 ? 1 : 0) + (ratio <= 0.1 ? 1 : 0);
}

export function territoryStars(c: CampaignState, id: string): number {
  return c.stars?.[id] ?? 0;
}

/** Stars earned over the whole map, and the most there are (three for every territory but the refuge). */
export function starTotal(c: CampaignState): { got: number; max: number } {
  const fights = TERRITORIES.filter((t) => !t.start);
  return { got: fights.reduce((n, t) => n + territoryStars(c, t.id), 0), max: fights.length * 3 };
}

export const SAVE_KEY = 'mini-empire.campaign.v1';
export const UNLOCK_KEY = 'mini-empire.unlocks.v1';

/** Minimal storage interface so tests can run without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function newCampaign(race: RaceId): CampaignState {
  return {
    version: 1,
    race,
    conquered: [START_TERRITORY.id],
    capitalTaken: false,
    battles: 0,
    victories: 0,
    kills: 0,
    createdAt: Date.now(),
  };
}

export function saveCampaign(c: CampaignState, store = defaultStore()): void {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(c));
  } catch {
    // Private mode or full storage: progress just won't persist.
  }
}

export function loadCampaign(store = defaultStore()): CampaignState | null {
  try {
    const raw = store?.getItem(SAVE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as CampaignState;
    // Saves of a race that no longer exists (the demons were retired) start over.
    if (c.version !== 1 || !Array.isArray(c.conquered) || !RACE_MAP.has(c.race)) return null;
    c.conquered = c.conquered.filter((id) => TERRITORIES.some((t) => t.id === id));
    if (!c.conquered.includes(START_TERRITORY.id)) c.conquered.unshift(START_TERRITORY.id);
    // Saves from before star ratings: every territory already liberated has its first star.
    if (c.doctrine !== 'front' && c.doctrine !== 'ranged') delete c.doctrine;
    c.stars ??= Object.fromEntries(c.conquered.filter((id) => id !== START_TERRITORY.id).map((id) => [id, 1]));
    return c;
  } catch {
    return null;
  }
}

export function clearCampaign(store = defaultStore()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

/** The classic 30-wave mode unlocks once the capital has been retaken (kept across campaigns). */
export function isClassicUnlocked(store = defaultStore()): boolean {
  try {
    return store?.getItem(UNLOCK_KEY) === 'classic';
  } catch {
    return false;
  }
}

export function unlockClassic(store = defaultStore()): void {
  try {
    store?.setItem(UNLOCK_KEY, 'classic');
  } catch {
    // ignore
  }
}

export function isConquered(c: CampaignState, id: string): boolean {
  return c.conquered.includes(id);
}

/** A territory can be attacked when it borders liberated land. */
export function isAttackable(c: CampaignState, id: string): boolean {
  if (isConquered(c, id)) return false;
  return neighbours(getTerritory(id)).some((n) => isConquered(c, n.id));
}

/** A liberated territory (not the refuge) may be fought again for a better star rating. */
export function isReplayable(c: CampaignState, id: string): boolean {
  return isConquered(c, id) && !getTerritory(id).start;
}

export function campaignPerks(c: CampaignState): string[] {
  return c.conquered.map((id) => getTerritory(id).reward.perk).filter((p): p is string => !!p);
}

export function campaignPerkDefs(perks: string[]): PerkDef[] {
  return perks.map((p) => PERK_MAP.get(p)).filter((p): p is PerkDef => !!p);
}

export function campaignUnlocks(c: CampaignState): string[] {
  return c.conquered.map((id) => getTerritory(id).reward.unlock).filter((u): u is string => !!u);
}

/** War chest for a territory battle: grows with distance from the refuge, plus perks. */
export function startingGold(c: CampaignState, territoryId: string): number {
  const tier = territoryTier(getTerritory(territoryId));
  return CAMPAIGN_ECONOMY.startGold[tier] + campaignPerks(c).reduce((s, p) => s + (PERK_MAP.get(p)?.startGold ?? 0), 0);
}

export function startingCastle(c: CampaignState): number {
  return Math.min(CASTLE.maxLevel, Math.max(1, ...campaignPerks(c).map((p) => PERK_MAP.get(p)?.startCastle ?? 1)));
}

/** Builds a fresh 3x3 battle for one territory with all campaign bonuses applied. */
export function createLevelState(c: CampaignState, territoryId: string, seed = Date.now(), doctrine: DoctrineId = c.doctrine ?? 'front'): GameState {
  const t = getTerritory(territoryId);
  const s = newGame(c.race, seed);
  s.level = { territoryId, name: t.name, terrain: t.terrain, totalWaves: territoryWaveCount(territoryId), trait: t.trait, doctrine };
  s.perks = campaignPerks(c);
  s.unlocks = campaignUnlocks(c);
  s.gold = startingGold(c, territoryId);
  s.castleLevel = startingCastle(c);
  s.castleHp = castleMaxHp(s);
  return s;
}

export interface BattleRecord {
  liberated: boolean;
  capital: boolean;
  allLiberated: boolean;
  /** Stars this battle earned, and the best the territory had before it. */
  stars: number;
  prevStars: number;
}

/** Records the result of a territory battle and returns what changed. */
export function recordBattle(c: CampaignState, territoryId: string, won: boolean, kills: number, stars = 1): BattleRecord {
  c.battles += 1;
  c.kills += kills;
  const prevStars = territoryStars(c, territoryId);
  const record: BattleRecord = { liberated: false, capital: false, allLiberated: false, stars: won ? stars : 0, prevStars };
  if (!won) return record;
  c.victories += 1;
  c.stars = { ...c.stars, [territoryId]: Math.max(prevStars, stars) };
  if (!isConquered(c, territoryId)) {
    c.conquered.push(territoryId);
    record.liberated = true;
  }
  if (territoryId === CAPITAL_TERRITORY.id && !c.capitalTaken) {
    c.capitalTaken = true;
    record.capital = true;
  }
  record.allLiberated = TERRITORIES.every((t) => isConquered(c, t.id));
  return record;
}
