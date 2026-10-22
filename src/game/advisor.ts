import { getBuilding, getUnit } from './data/index';
import { availableBuildings, type GameState } from './state';
import type { BuildingDef, UnitDef, WaveDef } from './types';

/**
 * Counter advisor: reads the next wave and the town you have built, and says which threats you have
 * no answer for and which buildings answer them. Pure functions of the game state, no rendering.
 */
export type ThreatId = 'air' | 'armor' | 'thorns' | 'horde' | 'raider' | 'backline' | 'boss';

export interface ThreatDef {
  id: ThreatId;
  /** Short name of the threat. */
  name: string;
  /** Two-character tag a counter building wears in the build list. */
  tag: string;
  /** What answers it, in words. */
  answer: string;
}

export const THREATS: Record<ThreatId, ThreatDef> = {
  air: { id: 'air', name: '飛行單位', tag: '對空', answer: '可對空的塔或遠程兵' },
  armor: { id: 'armor', name: '重甲敵人', tag: '破甲', answer: '魔法傷害（無視護甲）' },
  thorns: { id: 'thorns', name: '荊棘護甲', tag: '遠程', answer: '遠程士兵或防禦塔（近戰會受到反彈傷害）' },
  horde: { id: 'horde', name: '大批雜兵', tag: '範圍', answer: '範圍、連鎖或多重攻擊' },
  raider: { id: 'raider', name: '直衝建築', tag: '守城', answer: '防禦塔或嘲諷的坦克' },
  backline: { id: 'backline', name: '後排支援', tag: '狙擊', answer: '長射程或衝鋒型的士兵' },
  boss: { id: 'boss', name: '首領', tag: '屠巨', answer: '對大型敵人的加成、衝鋒或控場' },
};

export interface Threat extends ThreatDef {
  count: number;
  /** Enemy unit names that pose it. */
  units: string[];
  /** Names of your buildings that answer it. */
  have: string[];
  /** Buildings you could build right now that answer it. */
  suggest: string[];
  /** Answers that unlock at the next castle levels: [castle level, building name]. */
  later: [number, string][];
  /** `warn`: nothing of yours answers it; `info`: worth knowing; `ok`: answered. */
  severity: 'warn' | 'info' | 'ok';
}

/** Whether a unit, or a building's tower, has a trait of this type. */
const has = (u: UnitDef | BuildingDef | undefined, type: string) => {
  const traits = !u ? undefined : 'kind' in u ? u.tower?.traits : u.traits;
  return !!traits?.some((t) => t.type === type);
};

/** Which threats a building answers. */
export function countersOf(def: BuildingDef): ThreatId[] {
  const out: ThreatId[] = [];
  const t = def.tower;
  const u = def.kind === 'barracks' && def.unit ? getUnit(def.unit) : undefined;
  if (t?.canHitAir || u?.canHitAir) out.push('air');
  if (t?.damageType === 'magic' || u?.damageType === 'magic') out.push('armor');
  if (t?.splash || has(def, 'chain') || has(def, 'pierce') || u?.splash || has(u, 'cleave') || has(u, 'multishot') || has(u, 'rootAoe')) out.push('horde');
  if (t || has(u, 'taunt')) out.push('raider');
  if (t || (u && u.range > 2.5)) out.push('thorns');
  if (u && (u.range >= 8 || u.ai === 'aggressive')) out.push('backline');
  const bossy = u && (has(u, 'bonusVsLarge') || has(u, 'charge') || has(u, 'critVsDisabled') || u.traits?.some((tr) => tr.type === 'onHit' && (tr.status === 'mark' || tr.status === 'rune')));
  if (bossy || (u && def.castleLevel >= 5)) out.push('boss');
  return out;
}

/** Threat kinds an enemy poses (bosses only count as `boss`). */
export function threatsOf(u: UnitDef): ThreatId[] {
  if (u.boss) return ['boss'];
  const out: ThreatId[] = [];
  if (u.flying) out.push('air');
  if ((u.armor ?? 0) >= 0.4) out.push('armor');
  if (has(u, 'siege') || has(u, 'stealGold')) out.push('raider');
  if (has(u, 'summon') || has(u, 'heal') || (has(u, 'aura') && u.ai !== 'aggressive' && u.range > 2.5)) out.push('backline');
  return out;
}

/** Small, numerous units: a big group of them calls for area damage. */
const isFodder = (u: UnitDef) => !u.boss && u.hp <= 80;

/** Threats of a wave against the town as it stands. */
export function analyzeWave(state: GameState, wave: WaveDef): Threat[] {
  const counts = new Map<ThreatId, { count: number; units: Set<string> }>();
  const add = (id: ThreatId, n: number, name: string) => {
    const c = counts.get(id) ?? { count: 0, units: new Set<string>() };
    c.count += n;
    c.units.add(name);
    counts.set(id, c);
  };
  let fodder = 0;
  const fodderNames = new Set<string>();
  for (const g of wave.groups) {
    const u = getUnit(g.unit);
    const ids = threatsOf(u);
    // Battle traits: armor and thorns cover the whole army.
    if (wave.trait === 'armored' && !ids.includes('armor')) ids.push('armor');
    if (wave.trait === 'thorns') ids.push('thorns');
    for (const id of ids) add(id, g.count, u.name);
    if (isFodder(u)) {
      fodder += g.count;
      fodderNames.add(u.name);
    }
  }
  if (fodder >= 30) for (const n of fodderNames) add('horde', 0, n);
  if (counts.has('horde')) counts.get('horde')!.count = fodder;
  if (wave.boss) add('boss', 1, getUnit(wave.boss).name);

  const built: BuildingDef[] = [];
  for (const t of state.tiles) if (t.building) built.push(getBuilding(t.building.defId));
  const options = availableBuildings(state).filter((b) => !(b.campaignOnly && built.some((x) => x.id === b.id)));
  const out: Threat[] = [];
  for (const id of ['air', 'armor', 'thorns', 'raider', 'horde', 'backline', 'boss'] as ThreatId[]) {
    const c = counts.get(id);
    if (!c) continue;
    const answers = (b: BuildingDef) => countersOf(b).includes(id);
    const have = [...new Set(built.filter(answers).map((b) => b.name))];
    const now = options.filter((b) => answers(b) && b.castleLevel <= state.castleLevel);
    // Only the next castle level: an answer three upgrades away is no advice for this wave.
    const later = options
      .filter((b) => answers(b) && b.castleLevel === state.castleLevel + 1)
      .sort((a, b) => a.castleLevel - b.castleLevel)
      .map((b): [number, string] => [b.castleLevel, b.name]);
    // Missing anti-air or magic leaves enemies you cannot touch; the rest just make the wave harder.
    const critical = id === 'air' || id === 'thorns' || (id === 'armor' && c.count >= 3) || (id === 'raider' && c.count >= 3);
    const severity = have.length ? 'ok' : critical ? 'warn' : 'info';
    out.push({ ...THREATS[id], count: c.count, units: [...c.units], have, suggest: now.map((b) => b.name), later, severity });
  }
  return out;
}

/** Threats in the wave that a building would answer (for its badge in the build list). */
export function badgeFor(def: BuildingDef, threats: Threat[]): Threat[] {
  const ids = countersOf(def);
  return threats.filter((t) => ids.includes(t.id) && t.severity !== 'ok');
}

const list = (names: string[], n = 2) => names.slice(0, n).join('、');

/** One line on what to build for a threat. */
export function adviceFor(t: Threat): string {
  if (t.severity === 'ok') return `已有${list(t.have)}`;
  if (t.suggest.length) return `建造${list(t.suggest)}`;
  if (t.later.length) return `主堡 Lv.${t.later[0][0]} 解鎖${t.later[0][1]}`;
  return t.answer;
}

/**
 * One rule-picked tip after a lost wave: the most likely reason the defence broke and what to do
 * next time. `bossSurvived` is whether the wave's boss was still standing at the end.
 */
export function defeatTip(state: GameState, wave: WaveDef, opts: { bossSurvived?: boolean } = {}): string {
  const threats = analyzeWave(state, wave);
  const find = (id: ThreatId) => threats.find((t) => t.id === id && t.severity !== 'ok');
  const air = find('air');
  if (air) return `這一波有 ${air.count} 名飛行單位，但你沒有能對空的塔或士兵，只能靠主堡。${adviceFor(air)}。`;
  const armor = find('armor');
  if (armor) return `${list(armor.units)}身穿重甲，物理攻擊打不痛它們。${adviceFor(armor)}，魔法傷害會無視護甲。`;
  const thorns = find('thorns');
  if (thorns) return `敵人的荊棘護甲把近戰傷害反彈回去。${adviceFor(thorns)}，遠程攻擊不會被反彈。`;
  const raider = find('raider');
  if (raider) return `${list(raider.units)}會無視士兵、直衝建築。${adviceFor(raider)}守住最前線。`;
  const boss = threats.find((t) => t.id === 'boss');
  if (boss && opts.bossSurvived) {
    const tip = boss.suggest.length ? `建造${list(boss.suggest)}，` : '';
    return `首領${boss.units[0]}突破了防線。${tip}並把兵營升級到更高等級，讓士兵撐得更久。`;
  }
  if (state.castleLevel < Math.min(5, 1 + Math.floor(state.wave / 3))) return '升級主堡可以解鎖更強的建築、提高建築等級上限，也能擴張更多土地。';
  const combat = state.tiles.filter((t) => t.building && ['barracks', 'tower'].includes(getBuilding(t.building.defId).kind)).length;
  if (combat < 4) return `你只有 ${combat} 座兵營與防禦塔。資源建築能賺錢，但守城要靠戰鬥建築。`;
  if (state.gold >= 200) return `你還有 ${state.gold} 金沒有花掉。開戰前把金幣投入升級，戰力會明顯提升。`;
  return '把兵營集中在最前線並讓同類建築相鄰（出兵更快、塔更痛），優先升級主力兵營。';
}
