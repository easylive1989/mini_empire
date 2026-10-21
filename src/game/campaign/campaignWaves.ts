import { getUnit } from '../data/index';
import type { FactionId } from '../data/factions';
import { baseScaling, DIFFICULTY, unitThreat, waveBudget } from '../data/waves';
import type { WaveDef, WaveGroup } from '../types';
import { getTerritory, territoryTier } from './territories';

type Mix = [unit: string, weight: number, minTier?: number];

/** Campaign pacing knobs (tuned with tools/campaign-sim.ts). */
export const CAMPAIGN = {
  normalWaves: 6,
  capitalWaves: 10,
  /** Classic-wave equivalent of a territory's first wave, by tier (index = tier). */
  tierStart: [0, 1.5, 3.5, 6, 8.5, 9],
  /** Classic-wave equivalent added per wave inside a territory. */
  waveStep: 1.9,
  capitalStep: 1.9,
  /** Boss HP relative to its classic stats, by tier. */
  bossHp: [0, 0.4, 0.6, 0.85, 1.05, 1],
};

const FACTION_WAVES: Record<Exclude<FactionId, 'demonlord'>, Mix[][]> = {
  undead: [
    [['m_minion', 0.6], ['m_rogue', 0.4]],
    [['m_minion', 0.5], ['m_crossbow', 0.5]],
    [['m_warrior', 0.5], ['m_ghost', 0.5]],
    [['m_necromancer', 0.3], ['m_minion', 0.4], ['m_bloater', 0.3]],
    [['m_mage', 0.4], ['m_warrior', 0.3], ['m_ghost', 0.3]],
    [['m_warrior', 0.4], ['m_mage', 0.3], ['m_darkknight', 0.3, 3], ['m_minion', 0.3]],
  ],
  goblin: [
    [['g_goblin', 0.7], ['g_thief', 0.3]],
    [['g_goblin', 0.5], ['g_bomber', 0.3], ['g_thief', 0.2]],
    [['g_goblin', 0.4], ['g_shaman', 0.2], ['g_bomber', 0.4]],
    [['g_troll', 0.4, 2], ['g_goblin', 0.4], ['g_thief', 0.2]],
    [['g_troll', 0.3, 2], ['g_bomber', 0.3], ['g_shaman', 0.2], ['g_goblin', 0.2]],
    [['g_goblin', 0.5], ['g_troll', 0.3, 3], ['g_shaman', 0.2]],
  ],
  orc: [
    [['o_grunt', 1]],
    [['o_grunt', 0.6], ['o_spearman', 0.4]],
    [['o_berserker', 0.5], ['o_grunt', 0.3], ['o_spearman', 0.2]],
    [['o_brute', 0.4, 3], ['o_grunt', 0.3], ['o_shaman', 0.3]],
    [['o_berserker', 0.4], ['o_spearman', 0.3], ['o_brute', 0.3, 3]],
    [['o_grunt', 0.4], ['o_berserker', 0.3], ['o_shaman', 0.3]],
  ],
  rebel: [
    [['r_soldier', 0.7], ['r_archer', 0.3]],
    [['r_soldier', 0.4], ['r_archer', 0.4], ['r_assassin', 0.2]],
    [['r_mage', 0.3], ['r_soldier', 0.4], ['r_archer', 0.3]],
    [['r_knight', 0.4, 2], ['r_soldier', 0.3], ['r_archer', 0.3]],
    [['r_assassin', 0.3], ['r_knight', 0.3, 2], ['r_mage', 0.4]],
    [['r_soldier', 0.4], ['r_knight', 0.3, 2], ['r_archer', 0.3]],
  ],
};

const CAPITAL_WAVES: Mix[][] = [
  [['r_soldier', 0.5], ['r_archer', 0.3], ['r_assassin', 0.2]],
  [['g_goblin', 0.4], ['g_bomber', 0.3], ['g_troll', 0.3]],
  [['o_grunt', 0.4], ['o_berserker', 0.3], ['o_shaman', 0.3]],
  [['m_warrior', 0.4], ['m_ghost', 0.3], ['m_necromancer', 0.3]],
  [['r_knight', 0.4], ['r_mage', 0.3], ['r_assassin', 0.3]],
  [['o_brute', 0.4], ['o_berserker', 0.3], ['o_spearman', 0.3]],
  [['g_troll', 0.4], ['g_shaman', 0.3], ['g_thief', 0.3]],
  [['m_darkknight', 0.4], ['m_necromancer', 0.3], ['m_mage', 0.3]],
  [['r_knight', 0.25], ['o_brute', 0.25], ['g_troll', 0.25], ['m_darkknight', 0.25]],
  [['o_berserker', 0.3], ['r_assassin', 0.3], ['m_ghost', 0.4]],
];

const FACTION_BOSS: Record<Exclude<FactionId, 'demonlord'>, (tier: number) => string> = {
  undead: (tier) => (tier >= 4 ? 'm_deathknight' : tier === 3 ? 'm_lich' : 'm_skeleton_king'),
  goblin: () => 'g_king',
  orc: () => 'o_warlord',
  rebel: () => 'r_usurper',
};

const WAVE_TITLES: Record<FactionId, string> = {
  undead: '亡靈來襲',
  goblin: '哥布林大軍',
  orc: '獸人戰團',
  rebel: '叛軍部隊',
  demonlord: '王城決戰',
};

export function territoryWaveCount(territoryId: string): number {
  return getTerritory(territoryId).capital ? CAMPAIGN.capitalWaves : CAMPAIGN.normalWaves;
}

/** Classic-wave equivalent of a campaign wave (drives budget and stat scaling). */
export function effectiveWave(territoryId: string, wave: number): number {
  const t = getTerritory(territoryId);
  const tier = territoryTier(t);
  const step = t.capital ? CAMPAIGN.capitalStep : CAMPAIGN.waveStep;
  return CAMPAIGN.tierStart[tier] + (wave - 1) * step;
}

export function getCampaignWave(territoryId: string, wave: number): WaveDef {
  const t = getTerritory(territoryId);
  if (!t.faction) throw new Error(`${t.id} has no enemies`);
  const tier = territoryTier(t);
  const total = territoryWaveCount(territoryId);
  const last = wave >= total;
  const mixes = t.capital ? CAPITAL_WAVES : FACTION_WAVES[t.faction as Exclude<FactionId, 'demonlord'>];
  const mix = mixes[Math.min(wave, mixes.length) - 1].filter(([, , minTier]) => (minTier ?? 0) <= tier);
  const boss = last ? (t.capital ? 'b_demonlord' : FACTION_BOSS[t.faction as Exclude<FactionId, 'demonlord'>](tier)) : undefined;

  const e = effectiveWave(territoryId, wave);
  const sc = baseScaling(e);
  const budget = waveBudget(e) * (boss ? 0.6 : 1);
  const weight = mix.reduce((s, [, w]) => s + w, 0);
  const raw = mix.map(([unit, w]) => ({ unit, count: (budget * (w / weight)) / unitThreat(getUnit(unit), sc.hp, sc.dmg) }));
  const totalCount = raw.reduce((s, g) => s + g.count, 0);
  const crowd = Math.max(1, totalCount / DIFFICULTY.maxCount);
  const groups: WaveGroup[] = raw.map((g) => ({ unit: g.unit, count: Math.max(1, Math.round(g.count / crowd)) }));
  return {
    wave,
    groups,
    boss,
    title: last ? (t.capital ? '最終決戰：魔王莫爾加斯' : `首領：${getUnit(boss!).name}`) : WAVE_TITLES[t.faction],
    hpMult: sc.hp * crowd * crowd,
    dmgMult: sc.dmg,
    bossHpMult: CAMPAIGN.bossHp[tier],
  };
}
