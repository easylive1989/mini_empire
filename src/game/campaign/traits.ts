import type { Modifiers } from '../types';

/**
 * Battle traits: a territory's enemies fight in a way that one kind of army cannot answer, so the
 * army that wins elsewhere has to change here. Every trait has an answer every race can build by
 * castle Lv.2 or Lv.3, and the counter advisor knows each one.
 */
export type TraitId = 'armored' | 'thorns' | 'airborne' | 'raiders';

export interface TraitDef {
  id: TraitId;
  name: string;
  /** What the enemies do, in words. */
  desc: string;
  /** What answers it, in words. */
  answer: string;
  apply?: (m: Modifiers) => void;
  /** Units mixed into every regular wave, as [unit, weight] next to the wave's own mix (weights sum to 1). */
  extraMix?: [string, number][];
}

export const TRAITS: Record<TraitId, TraitDef> = {
  armored: {
    id: 'armored',
    name: '鐵甲軍團',
    desc: '敵人全員披上重甲：護甲 +35%。',
    answer: '魔法傷害無視護甲',
    apply: (m) => (m.enemyArmorAdd += 0.35),
  },
  thorns: {
    id: 'thorns',
    name: '荊棘護甲',
    desc: '敵人的護甲長滿尖刺：近戰攻擊者受到與造成傷害等量的反彈。',
    answer: '遠程士兵與防禦塔不受反彈',
    apply: (m) => (m.enemyThorns += 1),
  },
  airborne: {
    id: 'airborne',
    name: '幽魂空襲',
    desc: '魔王派出成群的幽魂從空中越過防線，直撲建築。',
    answer: '可對空的遠程兵或防禦塔',
    extraMix: [['m_ghost', 0.35]],
  },
  raiders: {
    id: 'raiders',
    name: '偷襲小隊',
    desc: '大批小偷繞過士兵直衝建築，每次得手都偷走金幣。',
    answer: '防禦塔或嘲諷的坦克守住前線',
    extraMix: [['g_thief', 0.5]],
  },
};
