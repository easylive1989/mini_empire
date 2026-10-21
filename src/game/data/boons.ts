import type { BoonDef } from '../types';

export const BOONS: BoonDef[] = [
  { id: 'b_income', name: '戰爭財', desc: '所有資源建築產量 +25%。', apply: (m) => (m.incomeMult *= 1.25) },
  { id: 'b_hp', name: '精兵訓練', desc: '所有士兵最大生命 +15%。', apply: (m) => (m.unitHpMult *= 1.15) },
  { id: 'b_dmg', name: '磨利刀鋒', desc: '所有士兵傷害 +15%。', apply: (m) => (m.unitDmgMult *= 1.15) },
  { id: 'b_spawn', name: '快速徵召', desc: '所有兵營出兵速度 +20%。', apply: (m) => (m.spawnSpeedMult *= 1.2) },
  { id: 'b_castle', name: '堅固城牆', desc: '主堡最大生命 +30%（立即回滿）。', apply: (m) => (m.castleHpMult *= 1.3) },
  { id: 'b_cost', name: '建築學', desc: '建造與升級費用 -12%。', apply: (m) => (m.costMult *= 0.88) },
  { id: 'b_bounty', name: '賞金獵人', desc: '擊殺獎勵 +60%。', apply: (m) => (m.bountyMult *= 1.6) },
  {
    id: 'b_tower',
    name: '強弩城防',
    desc: '防禦塔與主堡傷害 +25%。',
    apply: (m) => {
      m.towerDmgMult *= 1.25;
      m.castleDmgMult *= 1.25;
    },
  },
  { id: 'b_expand', name: '開拓詔令', desc: '擴張土地費用 -50%。', apply: (m) => (m.expandCostMult *= 0.5) },
  { id: 'b_cap', name: '擴編', desc: '所有兵營兵力上限 +1。', apply: (m) => (m.maxAliveAdd += 1) },
  { id: 'b_interest', name: '國庫利息', desc: '每波結束獲得目前金幣 10% 的利息（最多 120）。', apply: (m) => (m.interest += 0.1) },
  { id: 'b_speed', name: '急行軍', desc: '士兵移動速度 +20%，護甲 +5%。', apply: (m) => {
    m.unitSpeedMult *= 1.2;
    m.unitArmorAdd += 0.05;
  } },
  {
    id: 'b_heal',
    name: '野戰醫療',
    desc: '所有治療效果 +40%。',
    apply: (m) => (m.healMult *= 1.4),
  },
  // Race specific
  {
    id: 'b_human_banner',
    race: 'human',
    name: '王國旗幟',
    desc: '「聯合兵種」每種兵種的加成由 5% 提升為 8%。',
    apply: (m) => (m.combinedArms += 0.03),
  },
  {
    id: 'b_human_charge',
    race: 'human',
    name: '騎士精神',
    desc: '騎士衝鋒傷害倍率 +1.5。',
    apply: (m) => (m.chargeMult += 1.5),
  },
  {
    id: 'b_elf_roots',
    race: 'elf',
    name: '纏繞之根',
    desc: '所有定身效果持續時間 +1 秒。',
    apply: (m) => (m.rootDurationAdd += 1),
  },
  {
    id: 'b_elf_eagle',
    race: 'elf',
    name: '鷹眼',
    desc: '精靈弓手與風行者射程 +2，爆擊倍率 +0.5。',
    apply: (m) => {
      m.rangeAdd.elf_archer = (m.rangeAdd.elf_archer ?? 0) + 2;
      m.rangeAdd.elf_windrunner = (m.rangeAdd.elf_windrunner ?? 0) + 2;
      m.critMult += 0.5;
    },
  },
  {
    id: 'b_dwarf_runes',
    race: 'dwarf',
    name: '符文鍛造',
    desc: '所有防禦塔攻速 +25%。',
    apply: (m) => (m.towerAtkSpeedMult *= 1.25),
  },
  {
    id: 'b_dwarf_engineering',
    race: 'dwarf',
    name: '精密工程',
    desc: '工程師的維修量與塔攻速加成翻倍。',
    apply: (m) => (m.engineerMult *= 2),
  },
  {
    id: 'b_angel_light',
    race: 'angel',
    name: '神聖之光',
    desc: '出場護盾提升至 30%，護盾上限提升至 80%。',
    apply: (m) => {
      m.startShieldPct += 0.15;
      m.overhealShieldCap += 0.2;
    },
  },
  {
    id: 'b_angel_gate',
    race: 'angel',
    name: '天國之門',
    desc: '熾天使復活頻率加倍；所有天使出兵速度 +15%。',
    apply: (m) => {
      m.resurrectSpeedMult *= 2;
      m.spawnSpeedMult *= 1.15;
    },
  },
];

export const BOON_MAP = new Map(BOONS.map((b) => [b.id, b]));
