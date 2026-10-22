import { describe, expect, it } from 'vitest';
import { Battle } from '../src/game/battle';
import { BattleCallouts, CALLOUT_COOLDOWN } from '../src/game/callouts';
import { build, newGame, upgradeCastle } from '../src/game/state';

function battle(): Battle {
  const s = newGame('human', 5);
  s.gold = 5000;
  upgradeCastle(s);
  build(s, 1, 0, 'human_b_militia');
  build(s, 1, 1, 'human_tower');
  s.phase = 'battle';
  return new Battle(s);
}

describe('battle callouts', () => {
  it('announces a boss arriving and falling', () => {
    const b = battle();
    const c = new BattleCallouts();
    b.drainEvents();
    const boss = b.spawnEnemy('m_skeleton_king');
    const arrive = c.feed(b, b.drainEvents());
    expect(arrive.find((x) => x.banner)?.banner?.title).toBe('首領登場');
    b.damageEntity(boss, 1e9, 'magic', { building: b.castle });
    const fall = c.feed(b, b.drainEvents());
    expect(fall.find((x) => x.banner)?.banner).toEqual({ title: '首領倒下', sub: '骷髏王被擊敗了' });
    expect(b.bySource.get('castle')?.kills).toBe(1);
  });

  it('warns once per cooldown that the castle is under attack', () => {
    const b = battle();
    const c = new BattleCallouts();
    const lines = () => c.feed(b, b.drainEvents()).filter((x) => x.text.includes('主堡'));
    b.drainEvents();
    b.damageBuilding(b.castle, 5);
    expect(lines()).toHaveLength(1);
    b.damageBuilding(b.castle, 5);
    expect(lines()).toHaveLength(0);
    b.time += CALLOUT_COOLDOWN.castle + 0.1;
    b.damageBuilding(b.castle, 5);
    expect(lines()).toHaveLength(1);
  });

  it('reports buildings lost together in one line', () => {
    const b = battle();
    const c = new BattleCallouts();
    b.drainEvents();
    for (const bb of b.buildings.filter((x) => !x.isCastle)) b.damageBuilding(bb, 1e9);
    expect(c.feed(b, b.drainEvents()).some((x) => x.text.includes('被摧毀'))).toBe(false);
    b.time += 1;
    const out = c.feed(b, []);
    expect(out.map((x) => x.text)).toContain('2 座建築被摧毀了');
  });

  it('measures our share of the field and calls a turning point when the lead flips', () => {
    const b = battle();
    const c = new BattleCallouts();
    b.time = 5;
    const ours = b.spawnPlayerUnit(b.buildings.find((x) => x.def?.kind === 'barracks')!);
    const foe = b.spawnEnemy('m_minion');
    c.feed(b, b.drainEvents());
    expect(c.share).not.toBeNull();
    expect(c.share!).toBeGreaterThan(0.56);
    // A big enemy group arrives: the lead changes hands.
    for (let k = 0; k < 30; k++) b.spawnEnemy('m_warrior');
    b.time += 1;
    const out = c.feed(b, b.drainEvents());
    expect(c.share!).toBeLessThan(0.44);
    expect(c.turned).toBe('bad');
    expect(out.some((x) => x.text.startsWith('戰局逆轉'))).toBe(true);
    // Nobody of theirs left: no meter.
    for (const e of b.entities) if (e.baseTeam === 'enemy') e.alive = false;
    b.time += 1;
    c.feed(b, []);
    expect(c.share).toBeNull();
    expect(ours.alive && !foe.alive).toBe(true);
  });
});
