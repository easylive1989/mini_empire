import { describe, expect, it } from 'vitest';
import { analyzeWave } from '../src/game/advisor';
import { Battle, waveForState } from '../src/game/battle';
import { createLevelState, newCampaign } from '../src/game/campaign/campaign';
import { getCampaignWave, territoryWaveCount } from '../src/game/campaign/campaignWaves';
import { TERRITORIES } from '../src/game/campaign/territories';
import { TRAITS } from '../src/game/campaign/traits';
import { BUILDINGS, getUnit } from '../src/game/data/index';
import { getModifiers } from '../src/game/state';

function battleIn(territoryId: string) {
  const s = createLevelState(newCampaign('human'), territoryId, 3);
  s.phase = 'battle';
  const b = new Battle(s);
  (b as unknown as { schedule: unknown[] }).schedule = [];
  return b;
}

function soldier(b: Battle, unit: string) {
  const e = b.spawnPlayerUnit({ ...b.castle, def: { ...BUILDINGS.get('gold_mine')!, unit } } as never);
  e.def = getUnit(unit);
  return e;
}

describe('battle traits', () => {
  it('sit on territories off the first tier, never on the refuge or the capital', () => {
    const traited = TERRITORIES.filter((t) => t.trait);
    expect(traited.length).toBeGreaterThanOrEqual(6);
    for (const t of traited) {
      expect(t.start || t.capital).toBeFalsy();
      expect(TRAITS[t.trait!]).toBeDefined();
    }
  });

  it('mix their units into regular waves but leave the boss wave alone', () => {
    const ghosts = getCampaignWave('t_wailing', 2).groups.find((g) => g.unit === 'm_ghost');
    expect(ghosts?.count).toBeGreaterThan(0);
    expect(getCampaignWave('t_goblincave', 1).groups.find((g) => g.unit === 'g_thief')!.count).toBeGreaterThan(
      getCampaignWave('t_whisper', 1).groups.find((g) => g.unit === 'g_thief')!.count,
    );
    const last = getCampaignWave('t_wailing', territoryWaveCount('t_wailing'));
    expect(last.boss).toBeDefined();
    expect(last.groups.some((g) => g.unit === 'm_ghost')).toBe(false);
  });

  it('armor the enemies of an armored territory', () => {
    const s = createLevelState(newCampaign('elf'), 't_oblivion', 1);
    expect(getModifiers(s).enemyArmorAdd).toBeCloseTo(0.35);
    const plain = createLevelState(newCampaign('elf'), 't_wheat', 1);
    expect(getModifiers(plain).enemyArmorAdd).toBe(0);
  });

  it('thorns hurt melee attackers but not archers', () => {
    const b = battleIn('t_arena');
    const foe = b.spawnEnemy('o_grunt');
    const militia = soldier(b, 'human_militia');
    const archer = soldier(b, 'human_archer');
    b.damageEntity(foe, 20, 'physical', { entity: militia }, { canDodge: false });
    b.damageEntity(foe, 20, 'physical', { entity: archer }, { canDodge: false });
    expect(militia.hp).toBeLessThan(militia.maxHp);
    expect(archer.hp).toBe(archer.maxHp);
  });

  it('show up in the counter advisor', () => {
    const s = createLevelState(newCampaign('human'), 't_arena', 1);
    expect(analyzeWave(s, waveForState(s)).find((t) => t.id === 'thorns')?.severity).toBe('warn');
    const armored = createLevelState(newCampaign('human'), 't_oblivion', 1);
    expect(analyzeWave(armored, waveForState(armored)).find((t) => t.id === 'armor')?.count).toBeGreaterThan(5);
  });
});
