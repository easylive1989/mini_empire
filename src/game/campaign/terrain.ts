import type { Modifiers } from '../types';

export type TerrainId =
  | 'plains'
  | 'town'
  | 'forest'
  | 'hills'
  | 'swamp'
  | 'mountain'
  | 'badlands'
  | 'mine'
  | 'graveyard'
  | 'holy'
  | 'river'
  | 'capital';

export interface TerrainDef {
  id: TerrainId;
  name: string;
  /** Battle effect while fighting on this terrain. */
  effect: string;
  apply: (m: Modifiers) => void;
}

export const TERRAINS: Record<TerrainId, TerrainDef> = {
  plains: { id: 'plains', name: '平原', effect: '一望無際的平原，沒有特殊效果。', apply: () => {} },
  town: {
    id: 'town',
    name: '城鎮',
    effect: '城鎮的石牆：主堡生命 +25%。',
    apply: (m) => (m.castleHpMult *= 1.25),
  },
  forest: {
    id: 'forest',
    name: '森林',
    effect: '茂密的樹林：雙方閃避 +10%。',
    apply: (m) => {
      m.unitEvasionAdd += 0.1;
      m.enemyEvasionAdd += 0.1;
    },
  },
  hills: {
    id: 'hills',
    name: '丘陵',
    effect: '居高臨下：防禦塔射程 +1.5。',
    apply: (m) => (m.towerRangeAdd += 1.5),
  },
  swamp: {
    id: 'swamp',
    name: '沼澤',
    effect: '泥濘難行：雙方移動速度 -20%。',
    apply: (m) => {
      m.unitSpeedMult *= 0.8;
      m.enemySpeedMult *= 0.8;
    },
  },
  mountain: {
    id: 'mountain',
    name: '山地',
    effect: '崎嶇山路：敵人移動速度 -15%，防禦塔射程 +1。',
    apply: (m) => {
      m.enemySpeedMult *= 0.85;
      m.towerRangeAdd += 1;
    },
  },
  badlands: {
    id: 'badlands',
    name: '荒地',
    effect: '灼熱的荒原讓人殺紅了眼：雙方傷害 +15%。',
    apply: (m) => {
      m.unitDmgMult *= 1.15;
      m.enemyDmgMult *= 1.15;
    },
  },
  mine: {
    id: 'mine',
    name: '礦脈',
    effect: '遍地礦石：資源建築產量 +25%。',
    apply: (m) => (m.incomeMult *= 1.25),
  },
  graveyard: {
    id: 'graveyard',
    name: '墓地',
    effect: '陰氣森森：敵人生命 +10%，擊殺獎勵 +30%。',
    apply: (m) => {
      m.enemyHpMult *= 1.1;
      m.bountyMult *= 1.3;
    },
  },
  holy: {
    id: 'holy',
    name: '聖地',
    effect: '聖光庇佑：士兵脫戰後每秒回復 2% 生命，治療效果 +20%。',
    apply: (m) => {
      m.regenPct += 0.02;
      m.healMult *= 1.2;
    },
  },
  river: {
    id: 'river',
    name: '河谷',
    effect: '敵人必須涉水而來：敵人移動速度 -15%。',
    apply: (m) => (m.enemySpeedMult *= 0.85),
  },
  capital: {
    id: 'capital',
    name: '王城廢墟',
    effect: '魔王的威壓：敵人傷害 +10%。但這是王國的故土——士兵生命 +10%。',
    apply: (m) => {
      m.enemyDmgMult *= 1.1;
      m.unitHpMult *= 1.1;
    },
  },
};
