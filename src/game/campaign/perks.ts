import type { Modifiers } from '../types';

/** Permanent rewards granted by liberated territories; they stack across the campaign. */
export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  apply: (m: Modifiers) => void;
  /** Gold added to every battle's starting treasury. */
  startGold?: number;
  /** Castle level every battle starts at (highest perk wins). */
  startCastle?: number;
}

export const PERKS: PerkDef[] = [
  { id: 'p_gold', name: '麥田糧倉', desc: '每場戰鬥起始金幣 +80。', startGold: 80, apply: () => {} },
  { id: 'p_castle', name: '城鎮工匠', desc: '主堡生命 +15%。', apply: (m) => (m.castleHpMult *= 1.15) },
  { id: 'p_tower', name: '黑鴉堡軍械', desc: '防禦塔與主堡傷害 +12%。', apply: (m) => {
    m.towerDmgMult *= 1.12;
    m.castleDmgMult *= 1.12;
  } },
  { id: 'p_range', name: '林中獵手', desc: '所有遠程士兵射程 +0.5。', apply: (m) => (m.rangeAddAll += 0.5) },
  { id: 'p_heal', name: '沼澤藥草', desc: '治療效果 +20%。', apply: (m) => (m.healMult *= 1.2) },
  { id: 'p_bounty', name: '哥布林寶庫', desc: '擊殺獎勵 +25%。', apply: (m) => (m.bountyMult *= 1.25) },
  { id: 'p_dmg', name: '荒原戰魂', desc: '所有士兵傷害 +8%。', apply: (m) => (m.unitDmgMult *= 1.08) },
  { id: 'p_hp', name: '山口鐵甲', desc: '所有士兵生命 +8%。', apply: (m) => (m.unitHpMult *= 1.08) },
  { id: 'p_spawn', name: '墓園英靈', desc: '所有兵營出兵速度 +10%。', apply: (m) => (m.spawnSpeedMult *= 1.1) },
  { id: 'p_income', name: '沼地商路', desc: '每波主堡稅收與資源產量 +10%。', apply: (m) => {
    m.incomeMult *= 1.1;
    m.castleIncomeMult *= 1.1;
  } },
  { id: 'p_startcastle', name: '河谷要塞', desc: '每場戰鬥的主堡從 Lv.2 開始。', startCastle: 2, apply: () => {} },
  { id: 'p_refuge', name: '曙光堡', desc: '王子最後的據點，讓每場戰鬥起始金幣 +40。', startGold: 40, apply: () => {} },
];

export const PERK_MAP = new Map(PERKS.map((p) => [p.id, p]));
