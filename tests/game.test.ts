import { describe, expect, it } from 'vitest';
import { Battle, FORMATION, simulateBattle } from '../src/game/battle';
import { ADJACENT_BARRACKS_SPAWN_BONUS, CASTLE, FINAL_WAVE, START_GOLD } from '../src/game/constants';
import { BUILDINGS, getUnit, RACES, raceBuildings, UNITS } from '../src/game/data/index';
import { getWave } from '../src/game/data/waves';
import {
  applyBattleOutcome,
  build,
  buildingIncome,
  canBuild,
  canExpand,
  castleMaxHp,
  chooseBoon,
  demolish,
  expand,
  newGame,
  tileAt,
  tileBonuses,
  upgrade,
  upgradeCastle,
} from '../src/game/state';

describe('game state', () => {
  it('starts with a 3x3 plot and a full-health castle', () => {
    const s = newGame('human', 1);
    expect(s.tiles.filter((t) => t.owned)).toHaveLength(9);
    expect(s.gold).toBe(START_GOLD);
    expect(s.castleHp).toBe(CASTLE.hp[0]);
  });

  it('gates buildings behind the castle level', () => {
    const s = newGame('human', 1);
    s.gold = 5000;
    expect(canBuild(s, 1, 0, 'human_b_knight').ok).toBe(false);
    for (let i = 0; i < 3; i++) upgradeCastle(s);
    expect(s.castleLevel).toBe(4);
    expect(canBuild(s, 1, 0, 'human_b_knight').ok).toBe(true);
  });

  it('rejects other races buildings and the castle tile', () => {
    const s = newGame('elf', 1);
    expect(canBuild(s, 1, 0, 'human_b_militia').ok).toBe(false);
    expect(canBuild(s, 0, 0, 'gold_mine').ok).toBe(false);
  });

  it('refunds half of what was invested on demolish', () => {
    const s = newGame('dwarf', 1);
    s.gold = 1000;
    upgradeCastle(s);
    build(s, 1, 1, 'dwarf_ballista');
    upgrade(s, 1, 1);
    const invested = tileAt(s, 1, 1)!.building!.invested;
    const before = s.gold;
    expect(demolish(s, 1, 1)).toBe(Math.floor(invested / 2));
    expect(s.gold).toBe(before + Math.floor(invested / 2));
  });

  it('only expands to adjacent tiles within the castle allowance', () => {
    const s = newGame('angel', 1);
    s.gold = 5000;
    expect(canExpand(s, 2, 0).ok).toBe(false); // castle level 1 has no allowance
    upgradeCastle(s);
    expect(canExpand(s, 2, 0).ok).toBe(true);
    expect(canExpand(s, 0, 0).ok).toBe(false);
    for (const [i, j] of [
      [2, 0],
      [2, 1],
      [2, -1],
      [-2, 0],
    ]) {
      expect(expand(s, i, j)).toBe(true);
    }
    expect(canExpand(s, 0, 2).ok).toBe(false); // cap of 4 reached at level 2
  });

  it('applies adjacency bonuses', () => {
    const s = newGame('human', 1);
    s.gold = 5000;
    upgradeCastle(s);
    build(s, 1, 1, 'human_b_militia');
    build(s, 1, 0, 'human_b_pikeman');
    expect(tileBonuses(s, 1, 1).spawnMult).toBeCloseTo(1 + ADJACENT_BARRACKS_SPAWN_BONUS);
    build(s, -1, 0, 'human_market');
    build(s, -1, 1, 'gold_mine');
    // market: base 24 + 8 per neighbour (castle + mine) = 40, +10% adjacent resource, human +10%
    expect(buildingIncome(s, -1, 0)).toBe(Math.round(40 * 1.1 * 1.1));
  });

  it('pays income and advances the wave after a win', () => {
    const s = newGame('angel', 1);
    s.phase = 'battle';
    const report = applyBattleOutcome(s, { won: true, castleHp: 900, kills: 6, bounty: 18, playerDeaths: 0 });
    expect(s.wave).toBe(2);
    expect(s.phase).toBe('prep');
    expect(report.total).toBe(CASTLE.baseIncome[0] + 18);
    expect(s.castleHp).toBe(900);
  });

  it('offers boons every 5 waves and declares victory after the final wave', () => {
    const s = newGame('elf', 7);
    s.wave = 5;
    s.phase = 'battle';
    applyBattleOutcome(s, { won: true, castleHp: s.castleHp, kills: 0, bounty: 0, playerDeaths: 0 });
    expect(s.phase).toBe('boon');
    expect(s.boonChoices).toHaveLength(3);
    expect(chooseBoon(s, s.boonChoices[0])).toBe(true);
    expect(s.phase).toBe('prep');

    s.wave = FINAL_WAVE;
    s.phase = 'battle';
    applyBattleOutcome(s, { won: true, castleHp: s.castleHp, kills: 0, bounty: 0, playerDeaths: 0 });
    expect(s.phase).toBe('boon');
    chooseBoon(s, s.boonChoices[0]);
    expect(s.phase).toBe('victory');
  });

  it('ends the game when the castle falls', () => {
    const s = newGame('human', 1);
    s.phase = 'battle';
    applyBattleOutcome(s, { won: false, castleHp: 0, kills: 0, bounty: 0, playerDeaths: 0 });
    expect(s.phase).toBe('over');
  });

  it('raises castle max hp with the castle boon', () => {
    const s = newGame('human', 1);
    s.phase = 'boon';
    s.boonChoices = ['b_castle'];
    s.castleHp = 10;
    chooseBoon(s, 'b_castle');
    expect(castleMaxHp(s)).toBe(Math.round(CASTLE.hp[0] * 1.3));
    expect(s.castleHp).toBe(castleMaxHp(s));
  });
});

describe('data integrity', () => {
  it('every barracks spawns an existing unit of its race', () => {
    for (const b of BUILDINGS.values()) {
      if (b.kind !== 'barracks') continue;
      const u = getUnit(b.unit!);
      expect(u.race).toBe(b.campaignOnly ? 'mercenary' : b.race);
      expect(b.spawnInterval).toHaveLength(3);
      expect(b.maxAlive).toHaveLength(3);
    }
  });

  it('each race has 5-6 unit types, a castle-5 ultimate and at least one tower', () => {
    for (const r of RACES) {
      const units = [...UNITS.values()].filter((u) => u.race === r.id);
      expect(units.length).toBeGreaterThanOrEqual(5);
      expect(units.length).toBeLessThanOrEqual(6);
      const list = raceBuildings(r.id);
      expect(list.some((b) => b.kind === 'tower')).toBe(true);
      expect(list.some((b) => b.kind === 'barracks' && b.castleLevel === 5)).toBe(true);
    }
  });

  it('dwarves rely on towers', () => {
    expect(raceBuildings('dwarf').filter((b) => b.kind === 'tower').length).toBeGreaterThanOrEqual(4);
  });

  it('synergy parts reference real units or buildings', () => {
    for (const r of RACES) {
      for (const syn of r.synergies) {
        for (const id of syn.parts) expect(UNITS.has(id) || BUILDINGS.has(id)).toBe(true);
      }
    }
  });

  it('builds 30 campaign waves with bosses on 10, 20 and 30', () => {
    for (let w = 1; w <= FINAL_WAVE + 5; w++) {
      const wave = getWave(w);
      expect(wave.groups.length).toBeGreaterThan(0);
      for (const g of wave.groups) expect(UNITS.has(g.unit)).toBe(true);
    }
    expect(getWave(10).boss).toBe('m_skeleton_king');
    expect(getWave(20).boss).toBe('m_lich');
    expect(getWave(30).boss).toBe('m_deathknight');
  });
});

/** Puts two fresh entities face to face for synergy checks. */
function arena(race: Parameters<typeof newGame>[0]) {
  const s = newGame(race, 3);
  s.phase = 'battle';
  const b = new Battle(s);
  (b as unknown as { schedule: unknown[] }).schedule = [];
  return b;
}

function run(b: Battle, seconds: number) {
  for (let k = 0; k < seconds * 30; k++) b.step();
}

function spawn(b: Battle, unit: string, team: 'player' | 'enemy', x: number, z = 0) {
  const def = getUnit(unit);
  const e = team === 'enemy' ? b.spawnEnemy(unit) : b.spawnPlayerUnit({ ...b.castle, def: { ...BUILDINGS.get('gold_mine')!, unit } } as never);
  e.x = x;
  e.z = z;
  e.def = def;
  return e;
}

describe('battle', () => {
  it('a lone castle holds wave 1 deterministically', () => {
    const a = simulateBattle({ ...newGame('human', 42), phase: 'battle' });
    const b = simulateBattle({ ...newGame('human', 42), phase: 'battle' });
    expect(a.result).toBe('win');
    expect(a.outcome()).toEqual(b.outcome());
  });

  it('elf archers always crit rooted enemies', () => {
    const b = arena('elf');
    const archer = spawn(b, 'elf_archer', 'player', 0);
    const foe = spawn(b, 'm_warrior', 'enemy', 5);
    b.step();
    const hp0 = foe.hp;
    b.resolveHit(archer, foe, 10, false, foe.x, foe.z);
    const plain = hp0 - foe.hp;
    b.applyStatus(foe, 'root', 5);
    const hp1 = foe.hp;
    const mult = (b as unknown as { outgoingMult: (a: unknown, t: unknown) => { mult: number; crit: boolean } }).outgoingMult(
      archer,
      foe,
    );
    expect(mult.crit).toBe(true);
    b.resolveHit(archer, foe, 10 * mult.mult, true, foe.x, foe.z);
    expect(hp1 - foe.hp).toBeGreaterThan(plain * 2.4);
  });

  it('human combined arms scales with distinct unit types', () => {
    const b = arena('human');
    spawn(b, 'human_militia', 'player', 0);
    const solo = spawn(b, 'human_pikeman', 'player', 0, 5);
    spawn(b, 'm_minion', 'enemy', 30);
    b.step();
    expect(b.combinedArmsBonus).toBeCloseTo(0.1);
    expect(solo.atkSpeedMult).toBeCloseTo(1.1);
  });

  it('rune-marked enemies take more damage from buildings', () => {
    const b = arena('dwarf');
    const foe = spawn(b, 'm_minion', 'enemy', 5);
    foe.hp = foe.maxHp = 1000;
    b.damageEntity(foe, 100, 'magic', { building: b.castle });
    const plain = 1000 - foe.hp;
    b.applyStatus(foe, 'rune', 5, 1.35);
    const before = foe.hp;
    b.damageEntity(foe, 100, 'magic', { building: b.castle });
    expect(before - foe.hp).toBeCloseTo(plain * 1.35);
  });

  it('bloaters explode when killed', () => {
    const b = arena('human');
    const bloater = spawn(b, 'm_bloater', 'enemy', 10);
    const militia = spawn(b, 'human_militia', 'player', 10.5);
    const hp0 = militia.hp;
    b.damageEntity(bloater, 9999, 'magic', {});
    expect(militia.hp).toBeLessThan(hp0);
  });

  it('angel overheal turns into shields', () => {
    const b = arena('angel');
    const g = spawn(b, 'angel_guardian', 'player', 0);
    g.shield = 0;
    b.heal(g, 50);
    expect(g.shield).toBeCloseTo(50);
  });

  it('flying enemies cannot be hit by melee units', () => {
    const b = arena('human');
    const militia = spawn(b, 'human_militia', 'player', 10);
    const ghost = spawn(b, 'm_ghost', 'enemy', 11);
    for (let k = 0; k < 30; k++) b.step();
    expect(militia.targetId).not.toBe(ghost.id);
  });
});

describe('battle timeout', () => {
  it('a wave that is still alive after 7 minutes counts as lost', () => {
    const b = arena('human');
    const ghost = spawn(b, 'm_minion', 'enemy', 32);
    ghost.def = { ...ghost.def, speed: 0 };
    run(b, 425);
    expect(b.castle.destroyed).toBe(false);
    expect(b.result).toBe('lose');
  });
});

describe('army formation', () => {
  // 3x3 plot: the front edge of the plot is at x = 6.
  const FRONT = 6;

  it('a gathered army pushes the line forward up to the midfield limit', () => {
    const b = arena('human');
    const start = b.pushLine;
    expect(start).toBeCloseTo(FRONT + FORMATION.minPush);
    for (let k = 0; k < 5; k++) spawn(b, 'human_militia', 'player', start, k - 2);
    run(b, 3);
    expect(b.pushLine).toBeGreaterThan(start + 3);
    run(b, 20);
    expect(b.pushLine).toBeCloseTo(FRONT + FORMATION.maxPush);
  });

  it('soldiers answer an attacker standing past the chase limit', () => {
    const b = arena('human');
    const militia = spawn(b, 'human_militia', 'player', FRONT + 13);
    const archer = spawn(b, 'r_archer', 'enemy', FRONT + 20.5);
    archer.def = { ...archer.def, speed: 0 };
    run(b, 0.5);
    expect(archer.targetId).toBe(militia.id);
    expect(militia.targetId).toBe(archer.id);
  });

  it('falls back when the enemy ahead is much stronger', () => {
    const b = arena('human');
    b.pushLine = FRONT + 12;
    spawn(b, 'human_militia', 'player', FRONT + 12);
    for (let k = 0; k < 4; k++) {
      const brute = spawn(b, 'm_brute', 'enemy', FRONT + 22, k);
      brute.def = { ...brute.def, speed: 0 };
    }
    run(b, 2);
    expect(b.pushLine).toBeLessThan(FRONT + 8);
  });

  it('lets charging units lead the formation and keeps ranged units behind', () => {
    const b = arena('human');
    const knight = spawn(b, 'human_knight', 'player', FRONT);
    const militia = spawn(b, 'human_militia', 'player', FRONT);
    expect(b.rallyX(knight)).toBeGreaterThan(b.rallyX(militia));
    const archer = spawn(b, 'human_archer', 'player', FRONT);
    expect(b.rallyX(archer)).toBeLessThan(b.rallyX(militia));
  });
});

describe('battle statistics', () => {
  /** A human town with a militia camp, an archery range and an arrow tower, fighting wave 3. */
  function town(): ReturnType<typeof newGame> {
    const s = newGame('human', 7);
    s.gold = 5000;
    upgradeCastle(s);
    build(s, 1, 0, 'human_b_militia');
    build(s, 1, 1, 'human_b_archer');
    build(s, 1, -1, 'human_tower');
    s.wave = 3;
    s.phase = 'battle';
    return s;
  }

  it('credits every kill to a soldier, a tower or the castle', () => {
    const b = simulateBattle(town());
    expect(b.result).toBe('win');
    const credited = [...b.bySource.values()].reduce((n, s) => n + s.kills, 0);
    expect(credited).toBe(b.kills);
    const keys = [...b.bySource.keys()];
    expect(keys).toContain('human_tower');
    expect(keys).toContain('human_militia');
    for (const k of keys) expect(k === 'castle' || BUILDINGS.has(k) || UNITS.has(k)).toBe(true);
  });

  it('names the soldier with the most kills as MVP', () => {
    const b = simulateBattle(town());
    expect(b.mvp).not.toBeNull();
    const killers = b.entities.filter((e) => e.baseTeam === 'player');
    expect(b.mvp!.kills).toBe(Math.max(...killers.map((e) => e.kills)));
    expect(b.topSources()[0].damage).toBeGreaterThanOrEqual(b.topSources().at(-1)!.damage);
  });

  it('samples both armies once per second and reports them with the wave', () => {
    const s = town();
    const b = simulateBattle(s);
    expect(b.timeline.length).toBeGreaterThanOrEqual(Math.floor(b.time) - 1);
    expect(b.timeline.some((p) => p.theirs > 0)).toBe(true);
    expect(b.timeline.every((p) => p.ours >= 0 && p.castle > 0 && p.castle <= 1)).toBe(true);
    const report = applyBattleOutcome(s, b.outcome());
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.timeline).toHaveLength(b.timeline.length);
    expect(report.duration).toBe(Math.round(b.time));
  });

  it('keeps the fight itself unchanged by the bookkeeping', () => {
    const a = simulateBattle(town());
    const b = simulateBattle(town());
    expect(a.outcome()).toEqual(b.outcome());
  });

  it('adds castle damage to the running total', () => {
    const s = newGame('human', 3);
    s.phase = 'battle';
    applyBattleOutcome(s, { won: true, castleHp: s.castleHp - 120, kills: 0, bounty: 0, playerDeaths: 0 });
    expect(s.stats.castleDamage).toBe(120);
  });
});
