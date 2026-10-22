import { describe, expect, it } from 'vitest';
import { adviceFor, analyzeWave, badgeFor, countersOf, defeatTip, threatsOf } from '../src/game/advisor';
import { getBuilding, getUnit } from '../src/game/data/index';
import { getWave } from '../src/game/data/waves';
import { build, newGame, upgradeCastle } from '../src/game/state';

/** Wave 7 of the classic mode: 23 skeleton minions and 12 flying ghosts. */
const AIR_WAVE = getWave(7);

function humanTown() {
  const s = newGame('human', 1);
  s.gold = 5000;
  build(s, 1, 0, 'human_b_militia');
  return s;
}

describe('counter advisor', () => {
  it('knows what each building answers', () => {
    expect(countersOf(getBuilding('human_tower'))).toEqual(expect.arrayContaining(['air', 'raider']));
    expect(countersOf(getBuilding('dwarf_cannon'))).toEqual(expect.arrayContaining(['horde', 'raider']));
    expect(countersOf(getBuilding('dwarf_cannon'))).not.toContain('air');
    expect(countersOf(getBuilding('elf_tower'))).toEqual(expect.arrayContaining(['air', 'armor']));
    expect(countersOf(getBuilding('human_b_knight'))).toContain('boss');
    expect(countersOf(getBuilding('human_b_militia'))).toEqual(['shield']);
  });

  it('reads threats off enemy units', () => {
    expect(threatsOf(getUnit('m_ghost'))).toContain('air');
    expect(threatsOf(getUnit('m_warrior'))).toContain('armor');
    expect(threatsOf(getUnit('m_necromancer'))).toContain('backline');
    expect(threatsOf(getUnit('g_thief'))).toContain('raider');
    expect(threatsOf(getUnit('m_skeleton_king'))).toEqual(['boss']);
  });

  it('warns about flyers when nothing can shoot them, and points at what unlocks it', () => {
    const s = humanTown();
    const air = analyzeWave(s, AIR_WAVE).find((t) => t.id === 'air')!;
    expect(air.count).toBe(12);
    expect(air.severity).toBe('warn');
    expect(air.suggest).toEqual([]);
    expect(air.later[0][0]).toBe(2);
    expect(adviceFor(air)).toContain('主堡 Lv.2');

    upgradeCastle(s);
    const now = analyzeWave(s, AIR_WAVE).find((t) => t.id === 'air')!;
    expect(now.suggest).toContain('箭塔');
    expect(badgeFor(getBuilding('human_tower'), analyzeWave(s, AIR_WAVE)).map((t) => t.id)).toContain('air');

    build(s, 1, 1, 'human_tower');
    const answered = analyzeWave(s, AIR_WAVE).find((t) => t.id === 'air')!;
    expect(answered.severity).toBe('ok');
    expect(answered.have).toEqual(['箭塔']);
    expect(badgeFor(getBuilding('human_tower'), analyzeWave(s, AIR_WAVE))).toEqual([]);
  });

  it('flags a big crowd of fodder and a boss', () => {
    const threats = analyzeWave(humanTown(), getWave(10));
    expect(threats.find((t) => t.id === 'boss')?.units).toEqual(['骷髏王']);
    const horde = analyzeWave(humanTown(), getWave(13)).find((t) => t.id === 'horde');
    expect(horde?.count).toBeGreaterThanOrEqual(30);
  });

  it('explains a lost wave', () => {
    expect(defeatTip(humanTown(), AIR_WAVE)).toContain('飛行');
    expect(defeatTip(humanTown(), getWave(6))).toContain('重甲');
    const s = newGame('human', 1);
    s.wave = 2;
    expect(defeatTip(s, getWave(2)).length).toBeGreaterThan(10);
  });
});
