import { describe, expect, it } from 'vitest';
import { Battle, simulateBattle, waveForState } from '../src/game/battle';
import {
  battleStars,
  campaignPerks,
  campaignUnlocks,
  createLevelState,
  isAttackable,
  isReplayable,
  loadCampaign,
  newCampaign,
  recordBattle,
  saveCampaign,
  startingCastle,
  startingGold,
  starTotal,
  territoryStars,
  SAVE_KEY,
  type KeyValueStore,
} from '../src/game/campaign/campaign';
import { getCampaignWave, territoryWaveCount } from '../src/game/campaign/campaignWaves';
import { PERK_MAP } from '../src/game/campaign/perks';
import { TERRAINS } from '../src/game/campaign/terrain';
import {
  CAPITAL_TERRITORY,
  hexDistance,
  neighbours,
  START_TERRITORY,
  TERRITORIES,
  territoryTier,
} from '../src/game/campaign/territories';
import { BUILDINGS, getUnit, UNITS } from '../src/game/data/index';
import { applyBattleOutcome, availableBuildings, build, canBuild, getModifiers, newGame, upgradeCastle } from '../src/game/state';

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('world map', () => {
  it('is a radius-2 hex grid of 19 territories from the refuge to the capital', () => {
    expect(TERRITORIES).toHaveLength(19);
    const keys = new Set(TERRITORIES.map((t) => `${t.q},${t.r}`));
    expect(keys.size).toBe(19);
    for (const t of TERRITORIES) expect(hexDistance(t, { q: 0, r: 0 })).toBeLessThanOrEqual(2);
    expect(hexDistance(START_TERRITORY, CAPITAL_TERRITORY)).toBe(4);
  });

  it('has four factions plus the demon lord, and six special-building rewards', () => {
    const factions = new Set(TERRITORIES.map((t) => t.faction).filter(Boolean));
    expect([...factions].sort()).toEqual(['demonlord', 'goblin', 'orc', 'rebel', 'undead']);
    const unlocks = TERRITORIES.map((t) => t.reward.unlock).filter(Boolean);
    expect(unlocks).toHaveLength(6);
    for (const u of unlocks) expect(BUILDINGS.get(u!)?.campaignOnly).toBe(true);
    for (const t of TERRITORIES) {
      if (t.reward.perk) expect(PERK_MAP.has(t.reward.perk)).toBe(true);
      expect(TERRAINS[t.terrain]).toBeDefined();
    }
  });

  it('only lets the prince attack territories bordering liberated land', () => {
    const c = newCampaign('human');
    const open = TERRITORIES.filter((t) => isAttackable(c, t.id)).map((t) => t.id);
    expect(open.sort()).toEqual(neighbours(START_TERRITORY).map((t) => t.id).sort());
    expect(isAttackable(c, CAPITAL_TERRITORY.id)).toBe(false);
  });

  it('can reach the capital in four battles', () => {
    const c = newCampaign('elf');
    for (const id of ['t_wheat', 't_ravenhold', 't_royalcamp']) {
      expect(isAttackable(c, id)).toBe(true);
      recordBattle(c, id, true, 10);
    }
    expect(isAttackable(c, CAPITAL_TERRITORY.id)).toBe(true);
    const rec = recordBattle(c, CAPITAL_TERRITORY.id, true, 50);
    expect(rec.capital).toBe(true);
    expect(c.capitalTaken).toBe(true);
    expect(rec.allLiberated).toBe(false);
  });

  it('does not change the map on a defeat', () => {
    const c = newCampaign('dwarf');
    const rec = recordBattle(c, 't_wheat', false, 3);
    expect(rec.liberated).toBe(false);
    expect(c.conquered).toEqual([START_TERRITORY.id]);
    expect(c.battles).toBe(1);
  });
});

describe('star ratings', () => {
  it('rates a win by the castle damage taken over all waves', () => {
    expect(battleStars(0, 1000)).toBe(3);
    expect(battleStars(100, 1000)).toBe(3);
    expect(battleStars(101, 1000)).toBe(2);
    expect(battleStars(499, 1000)).toBe(2);
    expect(battleStars(500, 1000)).toBe(1);
    expect(battleStars(3000, 1000)).toBe(1);
  });

  it('keeps the best rating and lets liberated territories be fought again', () => {
    const c = newCampaign('human');
    expect(isReplayable(c, START_TERRITORY.id)).toBe(false);
    expect(isReplayable(c, 't_wheat')).toBe(false);
    const first = recordBattle(c, 't_wheat', true, 10, 2);
    expect(first).toMatchObject({ liberated: true, stars: 2, prevStars: 0 });
    expect(isReplayable(c, 't_wheat')).toBe(true);
    const worse = recordBattle(c, 't_wheat', true, 10, 1);
    expect(worse.liberated).toBe(false);
    expect(territoryStars(c, 't_wheat')).toBe(2);
    recordBattle(c, 't_wheat', false, 4);
    expect(territoryStars(c, 't_wheat')).toBe(2);
    recordBattle(c, 't_wheat', true, 10, 3);
    expect(territoryStars(c, 't_wheat')).toBe(3);
    expect(c.conquered.filter((id) => id === 't_wheat')).toHaveLength(1);
    expect(starTotal(c)).toEqual({ got: 3, max: (TERRITORIES.length - 1) * 3 });
  });

  it('gives territories liberated before star ratings their first star', () => {
    const store = memoryStore();
    const c = newCampaign('elf');
    recordBattle(c, 't_wheat', true, 5);
    const old = { ...c } as Partial<typeof c>;
    delete old.stars;
    store.setItem(SAVE_KEY, JSON.stringify(old));
    const loaded = loadCampaign(store)!;
    expect(territoryStars(loaded, 't_wheat')).toBe(1);
    expect(territoryStars(loaded, START_TERRITORY.id)).toBe(0);
  });
});

describe('campaign progression', () => {
  it('saves and loads progress', () => {
    const store = memoryStore();
    const c = newCampaign('angel');
    recordBattle(c, 't_caravan', true, 12);
    saveCampaign(c, store);
    const loaded = loadCampaign(store)!;
    expect(loaded.race).toBe('angel');
    expect(loaded.conquered).toContain('t_caravan');
    expect(loadCampaign(memoryStore())).toBeNull();
  });

  it('drops saves of a retired race', () => {
    const store = memoryStore();
    saveCampaign({ ...newCampaign('human'), race: 'demon' as never }, store);
    expect(loadCampaign(store)).toBeNull();
  });

  it('turns liberated territories into perks, gold and special buildings', () => {
    const c = newCampaign('human');
    const baseGold = startingGold(c, 't_greystone');
    recordBattle(c, 't_wheat', true, 0); // +80 gold
    recordBattle(c, 't_caravan', true, 0); // mercenary camp
    expect(startingGold(c, 't_greystone')).toBe(baseGold + 80);
    expect(startingGold(c, CAPITAL_TERRITORY.id)).toBeGreaterThan(startingGold(c, 't_greystone') + 1000);
    expect(campaignUnlocks(c)).toEqual(['sp_mercenary']);
    expect(campaignPerks(c)).toContain('p_gold');
    recordBattle(c, 't_ravenhold', true, 0);
    recordBattle(c, 't_royalcamp', true, 0);
    recordBattle(c, 't_oblivion', true, 0);
    expect(startingCastle(c)).toBe(2);
  });

  it('creates a 6-wave battle on the territory with its terrain and unlocks', () => {
    const c = newCampaign('human');
    recordBattle(c, 't_caravan', true, 0);
    const s = createLevelState(c, 't_greystone', 1);
    expect(s.level?.totalWaves).toBe(6);
    expect(s.level?.terrain).toBe('town');
    expect(getModifiers(s).castleHpMult).toBeCloseTo(1.25);
    expect(availableBuildings(s).some((b) => b.id === 'sp_mercenary')).toBe(true);
    expect(territoryWaveCount(CAPITAL_TERRITORY.id)).toBe(10);
  });

  it('limits each special building to one per battle', () => {
    const c = newCampaign('human');
    recordBattle(c, 't_caravan', true, 0);
    const s = createLevelState(c, 't_wheat', 1);
    s.gold = 9999;
    upgradeCastle(s);
    expect(build(s, 1, 0, 'sp_mercenary')).toBe(true);
    const again = canBuild(s, 1, 1, 'sp_mercenary');
    expect(again.ok).toBe(false);
    // Locked specials are not offered in battles without the unlock.
    const fresh = createLevelState(newCampaign('human'), 't_wheat', 1);
    expect(availableBuildings(fresh).some((b) => b.campaignOnly)).toBe(false);
  });

  it('ends the territory battle after its last wave, without boons', () => {
    const s = createLevelState(newCampaign('human'), 't_wheat', 1);
    for (let w = 1; w <= 6; w++) {
      s.phase = 'battle';
      applyBattleOutcome(s, { won: true, castleHp: s.castleHp, kills: 0, bounty: 0, playerDeaths: 0 });
      expect(s.phase).toBe(w === 6 ? 'victory' : 'prep');
    }
    expect(s.boons).toHaveLength(0);
  });

  it('deducts gold stolen by goblin thieves', () => {
    const s = createLevelState(newCampaign('human'), 't_whisper', 1);
    s.phase = 'battle';
    const before = s.gold;
    const rep = applyBattleOutcome(s, { won: true, castleHp: s.castleHp, kills: 0, bounty: 0, playerDeaths: 0, goldStolen: 30 });
    expect(rep.income.some((l) => l.amount === -30)).toBe(true);
    expect(s.gold).toBe(before + rep.total);
  });
});

describe('campaign waves', () => {
  it('builds every territory wave from its faction with a boss at the end', () => {
    for (const t of TERRITORIES) {
      if (!t.faction) continue;
      const n = territoryWaveCount(t.id);
      for (let w = 1; w <= n; w++) {
        const wave = getCampaignWave(t.id, w);
        expect(wave.groups.length).toBeGreaterThan(0);
        for (const g of wave.groups) expect(UNITS.has(g.unit)).toBe(true);
        if (w === n) expect(wave.boss).toBeDefined();
        else expect(wave.boss).toBeUndefined();
      }
    }
    expect(getCampaignWave(CAPITAL_TERRITORY.id, 10).boss).toBe('b_demonlord');
  });

  it('gets harder with distance from the refuge', () => {
    const near = TERRITORIES.find((t) => t.faction === 'rebel' && territoryTier(t) === 1)!;
    const far = TERRITORIES.find((t) => t.faction === 'undead' && territoryTier(t) === 4)!;
    const total = (id: string) => getCampaignWave(id, 3).groups.reduce((s, g) => s + g.count, 0) * getCampaignWave(id, 3).hpMult;
    expect(total(far.id)).toBeGreaterThan(total(near.id) * 2);
  });

  it('one barracks holds the first wave of the first territory', () => {
    const s = createLevelState(newCampaign('human'), 't_wheat', 7);
    build(s, 1, 0, 'human_b_militia');
    s.phase = 'battle';
    expect(simulateBattle(s).result).toBe('win');
  });
});

describe('faction mechanics', () => {
  function level(territory: string) {
    const s = createLevelState(newCampaign('human'), territory, 3);
    s.phase = 'battle';
    const b = new Battle(s);
    (b as unknown as { schedule: unknown[] }).schedule = [];
    return b;
  }

  it('goblin thieves steal gold when they hit buildings', () => {
    const b = level('t_whisper');
    const thief = b.spawnEnemy('g_thief');
    thief.x = 4;
    thief.z = 0;
    b.damageBuilding(b.castle, 5, thief);
    expect(b.goldStolen).toBe(3);
    expect(b.outcome().goldStolen).toBe(3);
  });

  it('trolls regenerate', () => {
    const b = level('t_mushroom');
    const troll = b.spawnEnemy('g_troll');
    troll.hp = troll.maxHp / 2;
    for (let k = 0; k < 30; k++) b.step();
    expect(troll.hp).toBeGreaterThan(troll.maxHp / 2 + troll.maxHp * 0.015);
  });

  it('the orc warlord enrages below half health and calls berserkers', () => {
    const b = level('t_arena');
    const boss = b.spawnEnemy('o_warlord');
    const before = b.entities.length;
    b.damageEntity(boss, boss.maxHp * 0.6, 'magic', {});
    expect(boss.enraged).toBe(true);
    expect(b.entities.filter((e) => e.def.id === 'o_berserker').length).toBe(3);
    expect(b.entities.length).toBe(before + 3);
  });

  it('orc shaman war cries do not stack', () => {
    const b = level('t_ember');
    const grunt = b.spawnEnemy('o_grunt');
    for (let k = 0; k < 6; k++) {
      const sh = b.spawnEnemy('o_shaman');
      sh.x = grunt.x;
      sh.z = grunt.z + 1;
    }
    b.step();
    // One shaman's +25% damage, not 1.25^6.
    expect(grunt.dmgMult / b.mods.enemyDmgMult).toBeLessThan(1.3);
    expect(grunt.dmgMult).toBeGreaterThan(1.2);
  });

  it('a game state knows which wave it faces next', () => {
    const s = createLevelState(newCampaign('elf'), 't_whisper', 1);
    expect(waveForState(s).groups.every((g) => g.unit.startsWith('g_'))).toBe(true);
    s.wave = 99;
    expect(waveForState(s).boss).toBe('g_king');
    expect(waveForState(newGame('elf', 1)).groups.every((g) => g.unit.startsWith('m_'))).toBe(true);
  });

  it('terrain changes enemy stats (swamp slows everyone)', () => {
    const swamp = level('t_mushroom');
    expect(swamp.mods.enemySpeedMult).toBeCloseTo(0.8);
    expect(swamp.mods.unitSpeedMult).toBeCloseTo(0.8);
    expect(getUnit('b_demonlord').boss).toBe(true);
  });
});
