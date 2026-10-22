import { describe, expect, it } from 'vitest';
import { bit, crossingTile, HEX_DIRS, maskOf, riverTile, roadTile, rotateMask, shoreTile } from '../src/game/campaign/hexTiles';
import { hexDistance, neighbours, START_TERRITORY, TERRITORIES, TERRITORY_MAP } from '../src/game/campaign/territories';
import { buildWorld, isWater, provinceCentre, WORLD_RADIUS, type WorldCell } from '../src/game/campaign/world';

const world = buildWorld();
const step = (c: WorldCell, d: number) => world.at(c.q + HEX_DIRS[d][0], c.r + HEX_DIRS[d][1]);

describe('hex tile pieces', () => {
  it('has a road piece for every way roads can meet, and a river piece for every way but a dead end', () => {
    for (let m = 1; m < 64; m++) {
      expect(roadTile(m), `road ${m}`).toBeDefined();
      const ends = [0, 1, 2, 3, 4, 5].filter((d) => m & bit(d)).length;
      if (ends > 1) expect(riverTile(m), `river ${m}`).toBeDefined();
    }
  });

  it('turns a piece so its openings land on the asked edges', () => {
    expect(rotateMask(maskOf(0, 3), 1)).toBe(maskOf(5, 2));
    const pick = roadTile(maskOf(1, 2))!;
    expect(pick.key).toBe('hex_road_C');
    expect(rotateMask(maskOf(3, 4), pick.turns)).toBe(maskOf(1, 2));
    expect(crossingTile(maskOf(1, 4), maskOf(2, 5))!.key).toBe('hex_river_crossing_A');
    expect(crossingTile(maskOf(1, 4), maskOf(0, 3))!.key).toBe('hex_river_crossing_B');
    expect(crossingTile(maskOf(1, 3), maskOf(0, 4))).toBeUndefined();
    expect(shoreTile(maskOf(4, 5, 0))).toEqual({ key: 'hex_coast_C', turns: 2 });
  });
});

describe('world map', () => {
  it('fills the fine board with provinces around each territory', () => {
    expect(world.cells.length).toBe(3 * WORLD_RADIUS * (WORLD_RADIUS + 1) + 1);
    for (const t of TERRITORIES) {
      const cells = world.provinces.get(t.id)!;
      const c = provinceCentre(t);
      expect(cells[0]).toMatchObject({ ...c, centre: true, owner: t.id });
      expect(cells.length).toBeGreaterThanOrEqual(7);
      expect(cells.every((x) => hexDistance(x, c) <= 2 && !isWater(x))).toBe(true);
      // One piece of land: every hex is reached from the centre without leaving the province.
      const seen = new Set([cells[0]]);
      const queue = [cells[0]];
      while (queue.length) {
        const x = queue.shift()!;
        for (let d = 0; d < 6; d++) {
          const n = step(x, d);
          if (n?.owner === t.id && !seen.has(n)) seen.add(n), queue.push(n);
        }
      }
      expect(seen.size).toBe(cells.length);
    }
  });

  it('lets provinces touch exactly when their territories are neighbours', () => {
    const touching = new Set<string>();
    for (const c of world.cells) {
      if (!c.owner) continue;
      for (let d = 0; d < 6; d++) {
        const n = step(c, d);
        if (n?.owner && n.owner !== c.owner) touching.add(`${c.owner}|${n.owner}`);
      }
    }
    for (const a of TERRITORIES) {
      for (const b of TERRITORIES) {
        if (a === b) continue;
        expect(touching.has(`${a.id}|${b.id}`), `${a.id} ${b.id}`).toBe(neighbours(a).includes(b));
      }
    }
  });

  it('joins every territory to the refuge by road', () => {
    expect(world.roads).toHaveLength(TERRITORIES.length - 1);
    const start = world.at(provinceCentre(START_TERRITORY).q, provinceCentre(START_TERRITORY).r)!;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const c = queue.shift()!;
      for (let d = 0; d < 6; d++) {
        if (!(c.road & bit(d))) continue;
        const n = step(c, d)!;
        // Roads meet up: the next hex opens back towards this one.
        expect(n.road & bit(d + 3)).toBeTruthy();
        expect(isWater(n)).toBe(false);
        if (!seen.has(n)) seen.add(n), queue.push(n);
      }
    }
    for (const t of TERRITORIES) expect(seen.has(world.at(provinceCentre(t).q, provinceCentre(t).r)!), t.id).toBe(true);
  });

  it('runs one river from a lake to the sea, bridged where roads cross it', () => {
    const river = world.cells.filter((c) => c.river);
    expect(river.length).toBeGreaterThan(10);
    let source = 0;
    let mouth = 0;
    for (const c of river) {
      expect(c.centre).toBe(false);
      expect(isWater(c)).toBe(false);
      expect(riverTile(c.river)).toBeDefined();
      if (c.road) expect(crossingTile(c.river, c.road)).toBeDefined();
      for (let d = 0; d < 6; d++) {
        if (!(c.river & bit(d))) continue;
        const n = step(c, d)!;
        if (isWater(n)) n.kind === 'sea' ? mouth++ : source++;
        else expect(n.river & bit(d + 3)).toBeTruthy();
      }
    }
    expect([source, mouth]).toEqual([1, 1]);
    // It flows past the capital and the river valley fortress that guards it.
    const owners = new Set(river.map((c) => c.owner));
    expect(owners.has('t_capital')).toBe(true);
    expect(owners.has('t_oblivion')).toBe(true);
  });

  it('has a coast along the south-east, and a shore piece on every hex that meets water', () => {
    expect(world.cells.filter((c) => c.kind === 'sea').length).toBeGreaterThan(60);
    expect(world.provinces.get('t_ember')!.some((c) => c.shore)).toBe(true);
    for (const c of world.cells) {
      if (isWater(c)) expect(c.shore).toBe(0);
      else if (c.shore) expect(shoreTile(c.shore)).toBeDefined();
    }
  });

  it('is the same on every build', () => {
    const again = buildWorld();
    expect(again.cells.map((c) => [c.owner, c.kind, c.road, c.river])).toEqual(world.cells.map((c) => [c.owner, c.kind, c.road, c.river]));
    expect(TERRITORY_MAP.size).toBe(world.provinces.size);
  });
});
