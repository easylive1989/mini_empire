import { FINAL_WAVE } from '../constants';
import { Rng } from '../rng';
import type { UnitDef, WaveDef, WaveGroup } from '../types';
import { MONSTERS } from './monsters';

/** Global difficulty knobs (tuned with `npm run balance`). */
export const DIFFICULTY = {
  /** Army strength per wave number (sum of sqrt(hp * dps) over all monsters). */
  base: 136,
  /** Extra pressure by the final wave: the safety margin shrinks as the campaign goes on. */
  ramp: 1.3,
  endlessGrowth: 1.1,
  hpPerWave: 0.06,
  dmgPerWave: 0.04,
  /** Above this many regular monsters, extra strength goes into HP instead of numbers. */
  maxCount: 70,
};

type Theme = { mix: [string, number][]; boss?: string; title?: string; scale?: number };

const THEMES: Theme[] = [
  { mix: [['m_minion', 1]] },
  { mix: [['m_minion', 0.8], ['m_rogue', 0.2]] },
  { mix: [['m_minion', 0.6], ['m_rogue', 0.4]] },
  { mix: [['m_minion', 0.6], ['m_crossbow', 0.4]] },
  { mix: [['m_minion', 0.4], ['m_rogue', 0.3], ['m_crossbow', 0.3]] },
  { mix: [['m_minion', 0.4], ['m_warrior', 0.4], ['m_crossbow', 0.2]], title: '重甲來襲' },
  { mix: [['m_minion', 0.5], ['m_ghost', 0.5]], title: '空中威脅' },
  { mix: [['m_minion', 0.4], ['m_bloater', 0.3], ['m_crossbow', 0.3]], title: '屍爆潮' },
  { mix: [['m_warrior', 0.3], ['m_rogue', 0.3], ['m_crossbow', 0.2], ['m_ghost', 0.2]] },
  { mix: [['m_minion', 0.5], ['m_warrior', 0.5]], boss: 'm_skeleton_king', title: '首領：骷髏王' },
  { mix: [['m_minion', 0.4], ['m_mage', 0.3], ['m_warrior', 0.3]], title: '火焰法師團' },
  { mix: [['m_minion', 0.3], ['m_brute', 0.4], ['m_crossbow', 0.3]], title: '攻城部隊' },
  { mix: [['m_ghost', 0.6], ['m_rogue', 0.4]], title: '幽魂之夜', scale: 1.2 },
  { mix: [['m_necromancer', 0.4], ['m_warrior', 0.4], ['m_crossbow', 0.2]], title: '死靈儀式' },
  { mix: [['m_darkknight', 0.4], ['m_bloater', 0.3], ['m_minion', 0.3]], title: '墮落騎士團' },
  { mix: [['m_mage', 0.35], ['m_warrior', 0.35], ['m_ghost', 0.3]] },
  { mix: [['m_brute', 0.4], ['m_rogue', 0.35], ['m_crossbow', 0.25]], title: '攻城部隊' },
  { mix: [['m_necromancer', 0.35], ['m_darkknight', 0.35], ['m_minion', 0.3]], title: '死靈儀式' },
  { mix: [['m_ghost', 0.4], ['m_mage', 0.3], ['m_bloater', 0.3]] },
  { mix: [['m_ghost', 0.3], ['m_warrior', 0.4], ['m_mage', 0.3]], boss: 'm_lich', title: '首領：巫妖' },
  { mix: [['m_darkknight', 0.4], ['m_warrior', 0.35], ['m_crossbow', 0.25]], title: '鐵壁軍團' },
  { mix: [['m_brute', 0.4], ['m_bloater', 0.3], ['m_rogue', 0.3]], title: '攻城部隊' },
  { mix: [['m_necromancer', 0.35], ['m_mage', 0.35], ['m_ghost', 0.3]], title: '死靈儀式' },
  { mix: [['m_darkknight', 0.4], ['m_ghost', 0.3], ['m_crossbow', 0.3]] },
  { mix: [['m_brute', 0.3], ['m_warrior', 0.3], ['m_necromancer', 0.2], ['m_minion', 0.2]] },
  { mix: [['m_ghost', 0.5], ['m_mage', 0.3], ['m_bloater', 0.2]], title: '幽魂之夜', scale: 1.4 },
  { mix: [['m_darkknight', 0.45], ['m_brute', 0.3], ['m_crossbow', 0.25]], title: '鐵壁軍團' },
  { mix: [['m_necromancer', 0.3], ['m_warrior', 0.4], ['m_rogue', 0.3]], title: '死靈儀式' },
  { mix: [['m_darkknight', 0.35], ['m_ghost', 0.3], ['m_mage', 0.2], ['m_brute', 0.15]], title: '決戰前夕' },
  {
    mix: [['m_darkknight', 0.3], ['m_warrior', 0.3], ['m_ghost', 0.2], ['m_mage', 0.2]],
    boss: 'm_deathknight',
    title: '最終首領：死亡騎士',
    scale: 1.25,
  },
];

const ENDLESS_KINDS = ['m_minion', 'm_rogue', 'm_crossbow', 'm_warrior', 'm_ghost', 'm_bloater', 'm_mage', 'm_necromancer', 'm_brute', 'm_darkknight'];
const ENDLESS_BOSSES = ['m_skeleton_king', 'm_lich', 'm_deathknight'];

const MONSTER_MAP = new Map(MONSTERS.map((m) => [m.id, m]));

/** Rough fighting value of one monster: sqrt(effective hp * dps). */
export function unitThreat(u: UnitDef, hpMult = 1, dmgMult = 1): number {
  const hp = ((u.hp * hpMult) / (1 - (u.armor ?? 0) * 0.6)) * (u.flying ? 1.4 : 1);
  let dps = (u.damage * dmgMult) / u.attackInterval;
  if (u.splash) dps *= 1.8;
  let summoned = 0;
  for (const t of u.traits ?? []) {
    if (t.type === 'selfDestruct') dps += (t.damage * dmgMult) / 3;
    if (t.type === 'cleave') dps *= 1 + t.ratio;
    // A summoner brings roughly 20 seconds' worth of extra bodies.
    if (t.type === 'summon') summoned += (20 / t.interval) * t.count * unitThreat(MONSTER_MAP.get(t.unitId)!, hpMult, dmgMult);
  }
  return Math.sqrt(hp * Math.max(dps, 1)) + summoned;
}

/** Target army strength of a wave. */
export function waveBudget(wave: number): number {
  const w = Math.min(wave, FINAL_WAVE);
  const endless = Math.max(0, wave - FINAL_WAVE);
  const campaign = DIFFICULTY.base * w * (1 + (DIFFICULTY.ramp * (w - 1)) / (FINAL_WAVE - 1));
  return campaign * Math.pow(DIFFICULTY.endlessGrowth, endless);
}

export function baseScaling(wave: number): { hp: number; dmg: number } {
  return { hp: 1 + DIFFICULTY.hpPerWave * (wave - 1), dmg: 1 + DIFFICULTY.dmgPerWave * (wave - 1) };
}

export function getWave(wave: number): WaveDef {
  let theme: Theme;
  if (wave <= FINAL_WAVE) {
    theme = THEMES[wave - 1];
  } else {
    const rng = new Rng(wave * 7919);
    const kinds = rng.shuffle(ENDLESS_KINDS.slice()).slice(0, 3);
    const n = wave - FINAL_WAVE;
    theme = {
      mix: kinds.map((k) => [k, 1 / 3] as [string, number]),
      boss: n % 10 === 0 ? ENDLESS_BOSSES[(n / 10 - 1) % ENDLESS_BOSSES.length] : undefined,
      title: n % 10 === 0 ? '無盡首領' : '無盡模式',
    };
  }
  const sc = baseScaling(wave);
  // Boss waves spend part of the budget on the boss itself.
  const budget = waveBudget(wave) * (theme.boss ? 0.7 : 1) * (theme.scale ?? 1);
  const raw = theme.mix.map(([unit, w]) => {
    const u = MONSTER_MAP.get(unit)!;
    return { unit, count: (budget * w) / unitThreat(u, sc.hp, sc.dmg) };
  });
  const total = raw.reduce((s, g) => s + g.count, 0);
  // Too many bodies: make each one tougher instead (threat ~ sqrt(hp), so hp grows with the square).
  const crowd = Math.max(1, total / DIFFICULTY.maxCount);
  const groups: WaveGroup[] = raw.map((g) => ({ unit: g.unit, count: Math.max(1, Math.round(g.count / crowd)) }));
  return {
    wave,
    groups,
    boss: theme.boss,
    title: theme.title,
    hpMult: sc.hp * crowd * crowd,
    dmgMult: sc.dmg,
    bossHpMult: wave > FINAL_WAVE ? Math.pow(1.12, wave - FINAL_WAVE) * 2 : 1,
  };
}
