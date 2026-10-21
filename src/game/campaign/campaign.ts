import { CASTLE } from '../constants';
import { castleMaxHp, CAMPAIGN_ECONOMY, newGame, type GameState } from '../state';
import type { RaceId } from '../types';
import { territoryWaveCount } from './campaignWaves';
import { PERK_MAP } from './perks';
import { CAPITAL_TERRITORY, getTerritory, neighbours, START_TERRITORY, TERRITORIES } from './territories';

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
    if (c.version !== 1 || !Array.isArray(c.conquered)) return null;
    c.conquered = c.conquered.filter((id) => TERRITORIES.some((t) => t.id === id));
    if (!c.conquered.includes(START_TERRITORY.id)) c.conquered.unshift(START_TERRITORY.id);
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

export function campaignPerks(c: CampaignState): string[] {
  return c.conquered.map((id) => getTerritory(id).reward.perk).filter((p): p is string => !!p);
}

export function campaignUnlocks(c: CampaignState): string[] {
  return c.conquered.map((id) => getTerritory(id).reward.unlock).filter((u): u is string => !!u);
}

export function startingGold(c: CampaignState): number {
  return CAMPAIGN_ECONOMY.startGold + campaignPerks(c).reduce((s, p) => s + (PERK_MAP.get(p)?.startGold ?? 0), 0);
}

export function startingCastle(c: CampaignState): number {
  return Math.min(CASTLE.maxLevel, Math.max(1, ...campaignPerks(c).map((p) => PERK_MAP.get(p)?.startCastle ?? 1)));
}

/** Builds a fresh 3x3 battle for one territory with all campaign bonuses applied. */
export function createLevelState(c: CampaignState, territoryId: string, seed = Date.now()): GameState {
  const t = getTerritory(territoryId);
  const s = newGame(c.race, seed);
  s.level = { territoryId, name: t.name, terrain: t.terrain, totalWaves: territoryWaveCount(territoryId) };
  s.perks = campaignPerks(c);
  s.unlocks = campaignUnlocks(c);
  s.gold = startingGold(c);
  s.castleLevel = startingCastle(c);
  s.castleHp = castleMaxHp(s);
  return s;
}

export interface BattleRecord {
  liberated: boolean;
  capital: boolean;
  allLiberated: boolean;
}

/** Records the result of a territory battle and returns what changed. */
export function recordBattle(c: CampaignState, territoryId: string, won: boolean, kills: number): BattleRecord {
  c.battles += 1;
  c.kills += kills;
  const record: BattleRecord = { liberated: false, capital: false, allLiberated: false };
  if (!won) return record;
  c.victories += 1;
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
