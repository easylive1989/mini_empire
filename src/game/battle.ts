import { doctrineMult } from './campaign/doctrines';
import { CASTLE, DT, SPAWN_X, SPAWN_Z_SPREAD, TILE, UNIT_LEVEL_MULT, BUILDING_LEVEL_HP_MULT } from './constants';
import { getBuilding, getUnit, RACE_MAP } from './data/index';
import { getCampaignWave } from './campaign/campaignWaves';
import { getWave } from './data/waves';
import { Rng } from './rng';
import { castleMaxHp, getModifiers, tileBonuses, type BattleOutcome, type GameState } from './state';
import type {
  BuildingDef,
  DamageType,
  WaveDef,
  Modifiers,
  ProjectileKind,
  StatusId,
  Team,
  Trait,
  UnitDef,
} from './types';

export interface StatusState {
  t: number;
  v: number;
  src?: number;
  /** Who gets credit for damage over time (see `Battle.bySource`). */
  key?: string;
}

export interface Entity {
  id: number;
  def: UnitDef;
  team: Team;
  baseTeam: Team;
  x: number;
  z: number;
  px: number;
  pz: number;
  facing: number;
  hp: number;
  maxHp: number;
  shield: number;
  alive: boolean;
  deadAt: number;
  removed: boolean;
  cooldown: number;
  targetId: number | null;
  targetBuilding: number | null;
  retarget: number;
  statuses: Partial<Record<StatusId, StatusState>>;
  traitTimers: number[];
  attackCount: number;
  moved: number;
  lastDamagedAt: number;
  stacks: number;
  dodged: boolean;
  homeUid: number | null;
  levelMult: number;
  dmgScale: number;
  rallyZ: number;
  radius: number;
  flying: boolean;
  moving: boolean;
  attackAnim: number;
  summoned: boolean;
  resurrected: boolean;
  /** Set once an `enrage` trait has fired. */
  enraged: boolean;
  /** Enemies this soldier finished off. */
  kills: number;
  // Per-tick derived multipliers.
  dmgMult: number;
  atkSpeedMult: number;
  armorAdd: number;
  evasionAdd: number;
}

export interface BBuilding {
  uid: number;
  def: BuildingDef | null;
  isCastle: boolean;
  i: number;
  j: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  level: number;
  destroyed: boolean;
  spawnTimer: number;
  spawnInterval: number;
  maxAlive: number;
  unitHpMult: number;
  cooldown: number;
  healTimer: number;
  baseDmgMult: number;
  dmgMult: number;
  atkSpeedMult: number;
  radius: number;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  team: Team;
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  fromY: number;
  targetId: number | null;
  targetBuilding: number | null;
  tx: number;
  tz: number;
  speed: number;
  done: boolean;
  onHit: (b: Battle, x: number, z: number) => void;
}

export type BattleEvent =
  | { type: 'spawn'; id: number }
  | { type: 'attack'; id: number }
  | { type: 'projectile'; pid: number; kind: ProjectileKind; fromY: number; flying: boolean }
  | { type: 'hit'; x: number; z: number; y: number; dmgType: DamageType; amount: number; crit: boolean }
  | { type: 'dodge'; id: number }
  | { type: 'death'; id: number }
  | { type: 'heal'; id: number; amount: number }
  | { type: 'explode'; x: number; z: number; radius: number; kind: 'fire' | 'toxic' | 'holy' | 'shadow' }
  | { type: 'aoe'; x: number; z: number; radius: number; kind: 'root' | 'taunt' | 'shield' | 'summon' }
  | { type: 'status'; id: number; status: StatusId }
  | { type: 'buildingHit'; uid: number; amount: number }
  | { type: 'buildingDestroyed'; uid: number }
  | { type: 'towerAttack'; uid: number }
  | { type: 'repair'; uid: number; amount: number }
  | { type: 'resurrect'; id: number }
  | { type: 'gold'; x: number; z: number; amount: number }
  | { type: 'chain'; points: { x: number; z: number }[] }
  | { type: 'steal'; x: number; z: number; amount: number }
  | { type: 'enrage'; id: number };

/** Damage dealt to enemies and enemies finished off by one kind of source. */
export interface SourceStats {
  damage: number;
  kills: number;
}

/** One sample of the field: army strength of each side and the castle's health share. */
export interface StrengthSample {
  t: number;
  ours: number;
  theirs: number;
  castle: number;
}

/** The soldier with the most kills this wave. */
export interface MvpRecord {
  id: number;
  unitId: string;
  kills: number;
}

/** Fighting value of a unit: √(effective HP × damage per second), scaled by the HP it has left. */
export function unitPower(e: Entity): number {
  return Math.sqrt(e.maxHp * ((e.def.damage * e.dmgScale) / e.def.attackInterval + 1)) * (e.hp / e.maxHp);
}

interface SpawnOpts {
  homeUid?: number | null;
  levelMult?: number;
  hpMult?: number;
  rallyZ?: number;
  summoned?: boolean;
}

interface DamageOpts {
  crit?: boolean;
  canDodge?: boolean;
  /** Skip the hit event (damage over time). */
  silent?: boolean;
}

interface SpawnEntry {
  at: number;
  unit: string;
  boss: boolean;
}

const RETARGET = 0.3;
const BUILDING_RADIUS = 1.7;

/**
 * How far the formation may push (x offsets from the front edge of the plot), how far a soldier looks
 * for targets, and the furthest x (from the front edge) it will chase an enemy to.
 */
export const FORMATION = { minPush: 3, maxPush: 13, acquire: 12, leash: 19 };
/** Soldiers that must gather at the line before the formation moves forward. */
const MIN_GROUP = 4;
const PUSH_SPEED = 1.8;
const RETREAT_SPEED = 3;
const AGGRESSIVE_BONUS = 5;

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** The wave a game state is about to fight (campaign territory or classic mode). */
export function waveForState(state: GameState): WaveDef {
  return state.level ? getCampaignWave(state.level.territoryId, Math.min(state.wave, state.level.totalWaves)) : getWave(state.wave);
}

export class Battle {
  readonly state: GameState;
  readonly mods: Modifiers;
  readonly rng: Rng;
  readonly wave: number;
  readonly waveDef: WaveDef;
  /** Current x of the formation's front line; moves with the balance of forces. */
  pushLine: number;
  entities: Entity[] = [];
  buildings: BBuilding[] = [];
  projectiles: Projectile[] = [];
  events: BattleEvent[] = [];
  time = 0;
  kills = 0;
  bounty = 0;
  playerDeaths = 0;
  goldStolen = 0;
  /**
   * Damage dealt to enemies and kills, by source: a soldier's unit id, a tower's building id or
   * `castle`. Bookkeeping only: nothing here feeds back into the fight.
   */
  readonly bySource = new Map<string, SourceStats>();
  /** Strength of both sides once per second, for the battle meter's history and the wave report. */
  readonly timeline: StrengthSample[] = [];
  mvp: MvpRecord | null = null;
  private nextSample = 0;
  /** Damage / speed bonus from a standing war monument this tick. */
  bannerDmg = 0;
  bannerSpeed = 0;
  result: 'win' | 'lose' | null = null;
  private endTimer = -1;
  private nextId = 1;
  private schedule: SpawnEntry[] = [];
  private frontX: number;
  private dead: Entity[] = [];
  combinedArmsBonus = 0;

  constructor(state: GameState) {
    this.state = state;
    this.mods = getModifiers(state);
    this.wave = state.wave;
    this.waveDef = waveForState(state);
    this.rng = new Rng(state.seed ^ (state.wave * 0x9e3779b1));
    let maxI = 1;
    for (const t of state.tiles) if (t.owned) maxI = Math.max(maxI, t.i);
    this.frontX = maxI * TILE + TILE / 2;
    this.pushLine = this.frontX + FORMATION.minPush;
    this.setupBuildings();
    this.setupSchedule();
  }

  // ---------------------------------------------------------------- setup

  private setupBuildings(): void {
    const s = this.state;
    const m = this.mods;
    this.buildings.push({
      uid: 0,
      def: null,
      isCastle: true,
      i: 0,
      j: 0,
      x: 0,
      z: 0,
      hp: s.castleHp,
      maxHp: castleMaxHp(s),
      level: s.castleLevel,
      destroyed: false,
      spawnTimer: 0,
      spawnInterval: 0,
      maxAlive: 0,
      unitHpMult: 1,
      cooldown: 0.5,
      healTimer: 0,
      baseDmgMult: m.castleDmgMult,
      dmgMult: 1,
      atkSpeedMult: 1,
      radius: BUILDING_RADIUS + 0.3,
    });
    for (const t of s.tiles) {
      if (!t.building) continue;
      const def = getBuilding(t.building.defId);
      const lvl = t.building.level;
      const bonus = tileBonuses(s, t.i, t.j);
      const maxHp = Math.round(def.hp * BUILDING_LEVEL_HP_MULT[lvl - 1] * m.buildingHpMult);
      let spawnInterval = 0;
      let maxAlive = 0;
      if (def.kind === 'barracks') {
        spawnInterval = def.spawnInterval![lvl - 1] / (m.spawnSpeedMult * bonus.spawnMult);
        maxAlive = def.maxAlive![lvl - 1] + m.maxAliveAdd;
      }
      this.buildings.push({
        uid: t.building.uid,
        def,
        isCastle: false,
        i: t.i,
        j: t.j,
        x: t.i * TILE,
        z: t.j * TILE,
        hp: maxHp,
        maxHp,
        level: lvl,
        destroyed: false,
        spawnTimer: 0.4 + this.rng.next() * 1.2,
        spawnInterval,
        maxAlive,
        unitHpMult: bonus.unitHpMult,
        cooldown: 0.5 + this.rng.next() * 0.5,
        healTimer: 1,
        baseDmgMult: bonus.towerDmgMult * m.towerDmgMult * doctrineMult(def, this.state.level?.doctrine),
        dmgMult: 1,
        atkSpeedMult: 1,
        radius: BUILDING_RADIUS,
      });
    }
  }

  private setupSchedule(): void {
    const w = this.waveDef;
    let groupStart = 0;
    for (const g of w.groups) {
      const step = Math.max(0.35, Math.min(1.1, 14 / g.count));
      for (let k = 0; k < g.count; k++) {
        this.schedule.push({ at: groupStart + k * step + this.rng.next() * 0.3, unit: g.unit, boss: false });
      }
      groupStart += 3 + this.rng.next() * 2;
    }
    if (w.boss) this.schedule.push({ at: 7, unit: w.boss, boss: true });
    this.schedule.sort((a, b) => a.at - b.at);
  }

  get pendingSpawns(): number {
    return this.schedule.length;
  }

  /** Wave enemies still to beat, by unit id: alive or yet to arrive (summons excluded). */
  remainingEnemies(): Map<string, number> {
    const left = new Map<string, number>();
    for (const e of this.entities) if (e.alive && e.baseTeam === 'enemy' && !e.summoned) left.set(e.def.id, (left.get(e.def.id) ?? 0) + 1);
    for (const s of this.schedule) left.set(s.unit, (left.get(s.unit) ?? 0) + 1);
    return left;
  }

  /** The wave's boss while it is on the field. */
  get boss(): Entity | undefined {
    return this.entities.find((e) => e.alive && e.def.boss && e.baseTeam === 'enemy');
  }

  // ---------------------------------------------------------------- entity creation

  private createEntity(def: UnitDef, team: Team, x: number, z: number, opts: SpawnOpts = {}): Entity {
    const isPlayer = team === 'player';
    const levelMult = opts.levelMult ?? 1;
    let maxHp = def.hp;
    let dmgScale = 1;
    if (isPlayer) {
      maxHp = def.hp * levelMult * this.mods.unitHpMult * (opts.hpMult ?? 1);
      dmgScale = levelMult;
    } else {
      const w = this.waveDef;
      maxHp = def.hp * (def.boss ? w.bossHpMult : w.hpMult) * this.mods.enemyHpMult;
      dmgScale = (def.boss ? Math.max(1, w.bossHpMult / 2) ** 0.5 : w.dmgMult) * this.mods.enemyDmgMult;
    }
    maxHp = Math.round(maxHp);
    const e: Entity = {
      id: this.nextId++,
      def,
      team,
      baseTeam: team,
      x,
      z,
      px: x,
      pz: z,
      facing: isPlayer ? 0 : Math.PI,
      hp: maxHp,
      maxHp,
      shield: isPlayer ? maxHp * this.mods.startShieldPct : 0,
      alive: true,
      deadAt: 0,
      removed: false,
      cooldown: 0.3 + this.rng.next() * 0.4,
      targetId: null,
      targetBuilding: null,
      retarget: 0,
      statuses: {},
      traitTimers: (def.traits ?? []).map((t) => ('interval' in t ? t.interval * (0.4 + this.rng.next() * 0.4) : 0)),
      attackCount: 0,
      moved: 0,
      lastDamagedAt: -99,
      stacks: 0,
      dodged: false,
      homeUid: opts.homeUid ?? null,
      levelMult,
      dmgScale,
      rallyZ: opts.rallyZ ?? (this.rng.next() * 2 - 1) * 7,
      radius: def.radius ?? (def.large ? 0.8 : 0.45),
      flying: !!def.flying,
      moving: false,
      attackAnim: 0,
      summoned: opts.summoned ?? false,
      resurrected: false,
      enraged: false,
      kills: 0,
      dmgMult: 1,
      atkSpeedMult: 1,
      armorAdd: 0,
      evasionAdd: 0,
    };
    this.entities.push(e);
    this.events.push({ type: 'spawn', id: e.id });
    return e;
  }

  spawnPlayerUnit(b: BBuilding): Entity {
    const def = getUnit(b.def!.unit!);
    const x = b.x + TILE * 0.45;
    const z = b.z + (this.rng.next() - 0.5) * TILE * 0.6;
    return this.createEntity(def, 'player', x, z, {
      homeUid: b.uid,
      levelMult: UNIT_LEVEL_MULT[b.level - 1] * doctrineMult(b.def, this.state.level?.doctrine),
      hpMult: b.unitHpMult,
      rallyZ: Math.max(-9, Math.min(9, b.z + (this.rng.next() * 2 - 1) * 5)),
    });
  }

  spawnEnemy(unitId: string): Entity {
    const def = getUnit(unitId);
    const z = (this.rng.next() * 2 - 1) * SPAWN_Z_SPREAD;
    return this.createEntity(def, 'enemy', SPAWN_X + this.rng.next() * 3, z);
  }

  // ---------------------------------------------------------------- queries

  getEntity(id: number | null): Entity | undefined {
    if (id === null) return undefined;
    for (const e of this.entities) if (e.id === id) return e;
    return undefined;
  }

  getBuilding(uid: number | null): BBuilding | undefined {
    if (uid === null) return undefined;
    return this.buildings.find((b) => b.uid === uid);
  }

  get castle(): BBuilding {
    return this.buildings[0];
  }

  /** Can `a` attack `t`? (team, alive, air restrictions) */
  private canTarget(a: { team: Team; canHitAir: boolean }, t: Entity): boolean {
    return t.alive && t.team !== a.team && (!t.flying || a.canHitAir);
  }

  private nearestFoe(e: Entity, maxRange: number, maxX = Infinity): Entity | undefined {
    let best: Entity | undefined;
    let bestD = maxRange * maxRange;
    const canHitAir = !!e.def.canHitAir;
    for (const o of this.entities) {
      if (!this.canTarget({ team: e.team, canHitAir }, o) || o.x > maxX) continue;
      const d = dist2(e.x, e.z, o.x, o.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** The nearest foe within range that is currently targeting `e`. */
  private attackerOf(e: Entity, maxRange: number): Entity | undefined {
    let best: Entity | undefined;
    let bestD = maxRange * maxRange;
    const canHitAir = !!e.def.canHitAir;
    for (const o of this.entities) {
      if (o.targetId !== e.id || !this.canTarget({ team: e.team, canHitAir }, o)) continue;
      const d = dist2(e.x, e.z, o.x, o.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private nearestBuilding(x: number, z: number): BBuilding | undefined {
    let best: BBuilding | undefined;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.destroyed) continue;
      const d = dist2(x, z, b.x, b.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  foesInRadius(team: Team, x: number, z: number, r: number, canHitAir = true): Entity[] {
    const r2 = r * r;
    return this.entities.filter((o) => o.alive && o.team !== team && (!o.flying || canHitAir) && dist2(x, z, o.x, o.z) <= r2);
  }

  alliesInRadius(team: Team, x: number, z: number, r: number): Entity[] {
    const r2 = r * r;
    return this.entities.filter((o) => o.alive && o.team === team && dist2(x, z, o.x, o.z) <= r2);
  }

  private has(e: Entity, s: StatusId): boolean {
    return (e.statuses[s]?.t ?? 0) > 0;
  }

  isDisabled(e: Entity): boolean {
    return this.has(e, 'root') || this.has(e, 'stun') || this.has(e, 'slow') || this.has(e, 'rune');
  }

  // ---------------------------------------------------------------- statuses

  applyStatus(target: Entity, status: StatusId, duration: number, value = 1, src?: number, key?: string): void {
    if (!target.alive) return;
    let d = duration;
    if (status === 'root' && target.baseTeam === 'enemy') d += this.mods.rootDurationAdd;
    const hardCC = status === 'stun' || status === 'root' || status === 'taunted';
    if (target.def.boss && hardCC) {
      d *= 0.35;
    } else if (target.def.large && (status === 'stun' || status === 'root')) {
      d *= 0.6;
    }
    const cur = target.statuses[status];
    target.statuses[status] = {
      t: Math.max(d, cur?.t ?? 0),
      v: cur ? (status === 'slow' ? Math.min(cur.v, value) : Math.max(cur.v, value)) : value,
      src: src ?? cur?.src,
      key: key ?? cur?.key,
    };
    if (!cur) this.events.push({ type: 'status', id: target.id, status });
  }

  // ---------------------------------------------------------------- damage

  /** Outgoing damage multiplier of an attacker against a target (no armour). */
  private outgoingMult(a: Entity, t: Entity | null): { mult: number; crit: boolean } {
    let mult = a.dmgMult;
    let crit = false;
    for (const tr of a.def.traits ?? []) {
      switch (tr.type) {
        case 'focusFire':
          if (t && this.entities.some((o) => o.alive && o.team === a.team && o.def.range < 2.5 && dist2(o.x, o.z, t.x, t.z) < tr.radius * tr.radius)) {
            mult *= tr.dmgMult;
          }
          break;
        case 'bonusVsLarge':
          if (t && (t.def.large || t.def.boss)) mult *= tr.dmgMult;
          break;
        case 'critVsDisabled':
          if (t && this.isDisabled(t)) {
            mult *= tr.mult + this.mods.critMult;
            crit = true;
          }
          break;
        case 'shieldPower': {
          const ratio = Math.min(1, a.shield / (a.maxHp * 0.3));
          mult *= 1 + (tr.maxMult - 1) * ratio;
          break;
        }
        case 'berserk': {
          // handled in attack speed
          break;
        }
        case 'counter':
          if (a.dodged) {
            mult *= tr.mult;
            crit = true;
            a.dodged = false;
          }
          break;
        case 'charge':
          if (a.moved >= tr.distance) {
            mult *= tr.dmgMult + this.mods.chargeMult;
            crit = true;
          }
          break;
        default:
          break;
      }
    }
    return { mult, crit };
  }

  /** The `bySource` key for damage from `src`; undefined for enemies and unattributed damage. */
  private sourceKey(src: { entity?: Entity; building?: BBuilding; key?: string }): string | undefined {
    if (src.key) return src.key;
    if (src.entity) return src.entity.baseTeam === 'player' ? src.entity.def.id : undefined;
    if (src.building) return src.building.isCastle ? 'castle' : src.building.def?.id;
    return undefined;
  }

  private credit(key: string | undefined, damage: number, kills: number): void {
    if (!key) return;
    const s = this.bySource.get(key);
    if (s) {
      s.damage += damage;
      s.kills += kills;
    } else this.bySource.set(key, { damage, kills });
  }

  /** Deal damage to an entity. Returns damage actually dealt to HP+shield. */
  damageEntity(
    target: Entity,
    amount: number,
    type: DamageType,
    src: { entity?: Entity; building?: BBuilding; key?: string },
    opts: DamageOpts = {},
  ): number {
    if (!target.alive || amount <= 0) return 0;
    const crit = opts.crit ?? false;
    if (type === 'physical' && (opts.canDodge ?? true) && src.entity) {
      const ev = Math.min(0.75, (target.def.evasion ?? 0) + target.evasionAdd);
      if (ev > 0 && this.rng.chance(ev)) {
        target.dodged = true;
        this.events.push({ type: 'dodge', id: target.id });
        return 0;
      }
    }
    let dmg = amount;
    // Shield wall: enemies shrug off part of what towers, the castle and ranged soldiers throw at them.
    if (this.mods.enemyRangedResist > 0 && target.baseTeam === 'enemy' && (src.building || (src.entity?.baseTeam === 'player' && src.entity.def.range > 2.5))) {
      dmg *= 1 - this.mods.enemyRangedResist;
    }
    const ex = target.statuses.exposed;
    if (ex && ex.t > 0) dmg *= ex.v;
    const mk = target.statuses.mark;
    if (mk && mk.t > 0) dmg *= mk.v;
    const rn = target.statuses.rune;
    if (rn && rn.t > 0 && src.building) dmg *= rn.v;
    if (type === 'physical') {
      const armor = Math.min(0.85, Math.max(0, (target.def.armor ?? 0) + target.armorAdd));
      dmg *= 1 - armor;
      // Thorns: soldiers who hit an enemy in melee take part of the blow back.
      const attacker = src.entity;
      if (this.mods.enemyThorns > 0 && target.baseTeam === 'enemy' && attacker?.baseTeam === 'player' && attacker.def.range <= 2.5) {
        this.damageEntity(attacker, dmg * this.mods.enemyThorns, 'magic', { entity: target }, { canDodge: false, silent: true });
      }
    }
    const before = target.hp + target.shield;
    let absorbed = 0;
    if (target.shield > 0) {
      absorbed = Math.min(target.shield, dmg);
      target.shield -= absorbed;
    }
    const hpDmg = dmg - absorbed;
    target.hp -= hpDmg;
    if (target.hp > 0) this.checkEnrage(target);
    target.lastDamagedAt = this.time;
    if (!opts.silent) {
      this.events.push({ type: 'hit', x: target.x, z: target.z, y: target.flying ? 2 : 0.8, dmgType: type, amount: dmg, crit });
    }
    if (src.entity) {
      const ls = src.entity.def.traits?.find((t) => t.type === 'lifesteal') as { ratio: number } | undefined;
      if (ls && src.entity.alive) this.heal(src.entity, dmg * ls.ratio, false);
    }
    const key = target.baseTeam === 'enemy' ? this.sourceKey(src) : undefined;
    this.credit(key, Math.min(dmg, Math.max(0, before)), 0);
    if (target.hp <= 0) this.kill(target, src.entity, key);
    return dmg;
  }

  damageBuilding(b: BBuilding, amount: number, attacker?: Entity): void {
    if (b.destroyed) return;
    let dmg = amount;
    const siege = attacker?.def.traits?.find((t) => t.type === 'siege') as { buildingDmgMult: number } | undefined;
    if (siege) dmg *= siege.buildingDmgMult;
    const steal = attacker?.def.traits?.find((t) => t.type === 'stealGold') as { amount: number } | undefined;
    if (steal && !b.destroyed) {
      this.goldStolen += steal.amount;
      this.events.push({ type: 'steal', x: b.x, z: b.z, amount: steal.amount });
    }
    b.hp -= dmg;
    this.events.push({ type: 'buildingHit', uid: b.uid, amount: dmg });
    if (b.hp <= 0) {
      b.hp = 0;
      b.destroyed = true;
      this.events.push({ type: 'buildingDestroyed', uid: b.uid });
      if (b.isCastle) this.result = 'lose';
    }
  }

  heal(e: Entity, amount: number, overheal = true): number {
    if (!e.alive || amount <= 0) return 0;
    const missing = e.maxHp - e.hp;
    const toHp = Math.min(missing, amount);
    e.hp += toHp;
    let total = toHp;
    if (overheal && e.team === 'player' && this.mods.overhealShieldCap > 0) {
      const cap = e.maxHp * this.mods.overhealShieldCap;
      const extra = Math.min(amount - toHp, Math.max(0, cap - e.shield));
      if (extra > 0) {
        e.shield += extra;
        total += extra;
      }
    }
    if (total > 0.5) this.events.push({ type: 'heal', id: e.id, amount: total });
    return total;
  }

  addShield(e: Entity, amount: number): void {
    if (!e.alive) return;
    const cap = e.maxHp * Math.max(0.6, this.mods.overhealShieldCap);
    e.shield = Math.min(cap, e.shield + amount);
  }

  private kill(e: Entity, killer?: Entity, key?: string): void {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    e.deadAt = this.time;
    this.events.push({ type: 'death', id: e.id });
    const wasPlayer = e.baseTeam === 'player';
    if (!wasPlayer) {
      this.kills += 1;
      this.credit(key, 0, 1);
      if (killer && killer.baseTeam === 'player') {
        killer.kills += 1;
        if (!this.mvp || killer.kills > this.mvp.kills) this.mvp = { id: killer.id, unitId: killer.def.id, kills: killer.kills };
      }
      const g = e.summoned ? 0 : Math.round((e.def.bounty ?? 0) * this.mods.bountyMult);
      if (g > 0) {
        this.bounty += g;
        this.events.push({ type: 'gold', x: e.x, z: e.z, amount: g });
      }
    } else {
      if (!e.summoned) this.playerDeaths += 1;
      this.dead.push(e);
    }
    // Death triggers on the dying unit.
    for (const tr of e.def.traits ?? []) {
      if (tr.type === 'explodeOnDeath') this.explode(e, tr.damage, tr.radius);
    }
    // Killer rewards.
    if (killer?.alive) {
      const sok = killer.def.traits?.find((t) => t.type === 'shieldOnKill') as { amount: number; radius: number } | undefined;
      if (sok) {
        for (const a of this.alliesInRadius(killer.team, killer.x, killer.z, sok.radius)) this.addShield(a, sok.amount);
        this.events.push({ type: 'aoe', x: killer.x, z: killer.z, radius: sok.radius, kind: 'shield' });
      }
    }
  }

  private explode(e: Entity, damage: number, radius: number): void {
    const mult = e.baseTeam === 'player' ? this.mods.explosionMult * e.levelMult : this.waveDef.dmgMult;
    const dmg = damage * mult;
    for (const t of this.foesInRadius(e.baseTeam, e.x, e.z, radius)) this.damageEntity(t, dmg, 'magic', { entity: e }, { canDodge: false });
    if (e.baseTeam === 'enemy') {
      for (const b of this.buildings) {
        if (!b.destroyed && dist2(e.x, e.z, b.x, b.z) <= (radius + b.radius) ** 2) this.damageBuilding(b, dmg);
      }
    }
    this.events.push({ type: 'explode', x: e.x, z: e.z, radius, kind: e.baseTeam === 'player' ? 'fire' : 'toxic' });
  }

  // ---------------------------------------------------------------- simulation step

  step(dt = DT): void {
    if (this.result && this.endTimer < 0) this.endTimer = 0;
    this.time += dt;
    for (const e of this.entities) {
      e.px = e.x;
      e.pz = e.z;
    }

    // Enemy arrivals.
    while (this.schedule.length && this.schedule[0].at <= this.time) {
      const s = this.schedule.shift()!;
      this.spawnEnemy(s.unit);
    }

    this.updateBarracks(dt);
    this.updateFormation(dt);
    this.updateStatuses(dt);
    this.updateDerived();
    for (const e of this.entities) if (e.alive) this.updateTraits(e, dt);
    for (const e of this.entities) if (e.alive) this.updateEntity(e, dt);
    this.separate();
    this.updateBuildingsCombat(dt);
    this.updateProjectiles(dt);

    // Remove long-dead entities.
    for (const e of this.entities) {
      if (!e.alive && !e.removed && this.time - e.deadAt > 2.5) e.removed = true;
    }
    if (this.entities.length > 400) this.entities = this.entities.filter((e) => !e.removed);

    if (this.time >= this.nextSample) {
      this.nextSample += 1;
      const s = this.strength();
      this.timeline.push({ t: Math.round(this.time), ours: s.ours, theirs: s.theirs, castle: Math.max(0, this.castle.hp) / this.castle.maxHp });
    }

    if (!this.result) {
      if (this.castle.destroyed) this.result = 'lose';
      else if (!this.schedule.length && !this.entities.some((e) => e.alive && e.baseTeam === 'enemy')) this.result = 'win';
      // A wave that is still not repelled after 7 minutes counts as lost: stalling is not a defence.
      if (this.time > 420 && !this.result) this.result = 'lose';
    } else {
      this.endTimer += dt;
    }
  }

  /** True once the result is known and the short outro has played. */
  get finished(): boolean {
    return this.result !== null && this.endTimer > 1.5;
  }

  /**
   * Fighting strength on the field: our soldiers and standing towers against the enemies that have
   * arrived. Both use `unitPower`; a tower counts as √(max HP × damage per second) times its HP share.
   */
  strength(): { ours: number; theirs: number } {
    let ours = 0;
    let theirs = 0;
    for (const e of this.entities) {
      if (!e.alive) continue;
      if (e.team === 'player') ours += unitPower(e);
      else theirs += unitPower(e);
    }
    for (const b of this.buildings) {
      const spec = b.def?.tower;
      if (b.destroyed || !spec) continue;
      const dps = (spec.damage[b.level - 1] * b.dmgMult) / spec.attackInterval;
      ours += Math.sqrt(b.maxHp * dps) * (b.hp / b.maxHp);
    }
    return { ours, theirs };
  }

  /** Sources sorted by damage dealt, most first. */
  topSources(): ({ key: string } & SourceStats)[] {
    return [...this.bySource.entries()].map(([key, s]) => ({ key, damage: Math.round(s.damage), kills: s.kills })).sort((a, b) => b.damage - a.damage);
  }

  outcome(): BattleOutcome {
    return {
      won: this.result === 'win',
      castleHp: Math.max(0, Math.round(this.castle.hp)),
      kills: this.kills,
      bounty: this.bounty,
      playerDeaths: this.playerDeaths,
      goldStolen: this.goldStolen,
      sources: this.topSources(),
      mvp: this.mvp,
      timeline: this.timeline.map((p) => ({ ...p })),
      duration: Math.round(this.time),
    };
  }

  private updateBarracks(dt: number): void {
    if (this.result) return;
    for (const b of this.buildings) {
      if (b.destroyed || !b.def || b.def.kind !== 'barracks') continue;
      b.spawnTimer -= dt;
      if (b.spawnTimer > 0) continue;
      let alive = 0;
      for (const e of this.entities) if (e.alive && e.homeUid === b.uid && e.baseTeam === 'player') alive++;
      if (alive < b.maxAlive) {
        this.spawnPlayerUnit(b);
        b.spawnTimer = b.spawnInterval;
      } else {
        b.spawnTimer = 0.25;
      }
    }
  }

  private updateStatuses(dt: number): void {
    for (const e of this.entities) {
      if (!e.alive) continue;
      for (const key of Object.keys(e.statuses) as StatusId[]) {
        const s = e.statuses[key]!;
        if (s.t <= 0) continue;
        s.t -= dt;
        if (key === 'burn') {
          this.damageEntity(e, s.v * dt, 'magic', { key: s.key }, { silent: true });
          if (!e.alive) break;
        }
        if (s.t <= 0) delete e.statuses[key];
      }
      const regen = e.def.traits?.find((t) => t.type === 'regen') as { pct: number } | undefined;
      if (e.alive && regen && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * regen.pct * dt);
      if (e.alive && e.baseTeam === 'player' && this.mods.regenPct > 0 && this.time - e.lastDamagedAt > 3 && e.hp < e.maxHp) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * this.mods.regenPct * dt);
      }
    }
  }

  /** Recompute auras and passive multipliers. */
  /** Attack range including campaign/boon range bonuses for ranged soldiers. */
  rangeOf(e: Entity): number {
    const r = e.def.range;
    if (e.baseTeam !== 'player' || r <= 2.5) return r;
    return r + this.mods.rangeAddAll + (this.mods.rangeAdd[e.def.id] ?? 0);
  }

  /** Fires an `enrage` trait the first time its owner drops below the threshold. */
  private checkEnrage(e: Entity): void {
    if (e.enraged) return;
    const en = e.def.traits?.find((t) => t.type === 'enrage') as
      | { threshold: number; summon?: { unitId: string; count: number } }
      | undefined;
    if (!en || e.hp / e.maxHp > en.threshold) return;
    e.enraged = true;
    this.events.push({ type: 'enrage', id: e.id });
    if (en.summon) {
      for (let k = 0; k < en.summon.count; k++) {
        const a = (k / en.summon.count) * Math.PI * 2;
        const u = this.createEntity(getUnit(en.summon.unitId), e.team, e.x + Math.cos(a) * 2, e.z + Math.sin(a) * 2, { summoned: true });
        u.cooldown = 1;
      }
      this.events.push({ type: 'aoe', x: e.x, z: e.z, radius: 3.5, kind: 'summon' });
    }
  }

  private updateDerived(): void {
    this.bannerDmg = 0;
    this.bannerSpeed = 0;
    for (const b of this.buildings) {
      const sp = b.def?.special;
      if (sp?.type === 'warBanner' && !b.destroyed) {
        this.bannerDmg = Math.max(this.bannerDmg, sp.dmg[b.level - 1]);
        this.bannerSpeed = Math.max(this.bannerSpeed, sp.speed[b.level - 1]);
      }
    }
    const m = this.mods;
    // Human combined arms.
    let combined = 0;
    if (m.combinedArms > 0) {
      const kinds = new Set<string>();
      let champion = false;
      for (const e of this.entities) {
        if (e.alive && e.baseTeam === 'player' && e.def.race === 'human') {
          kinds.add(e.def.id);
          if (e.def.id === 'human_champion') champion = true;
        }
      }
      combined = kinds.size * m.combinedArms * (champion ? 1.5 : 1);
    }
    this.combinedArmsBonus = combined;

    for (const e of this.entities) {
      if (!e.alive) continue;
      let dmg = 1;
      let spd = 1;
      let armor = 0;
      let eva = 0;
      if (e.baseTeam === 'player') {
        dmg *= m.unitDmgMult * (1 + combined + this.bannerDmg);
        spd *= 1 + combined;
        armor += m.unitArmorAdd;
        eva += m.unitEvasionAdd;
      } else {
        eva += m.enemyEvasionAdd;
        armor += m.enemyArmorAdd;
      }
      if (e.enraged) {
        const en = e.def.traits?.find((t) => t.type === 'enrage') as { dmgMult: number; atkSpeedMult: number } | undefined;
        if (en) {
          dmg *= en.dmgMult;
          spd *= en.atkSpeedMult;
        }
      }
      for (const tr of e.def.traits ?? []) {
        if (tr.type === 'phalanx') {
          const n = this.entities.filter(
            (o) => o !== e && o.alive && o.team === e.team && o.def.id === e.def.id && dist2(o.x, o.z, e.x, e.z) <= tr.radius * tr.radius,
          ).length;
          if (n >= tr.minAllies) {
            armor += tr.armorAdd;
            dmg *= tr.dmgMult;
          }
        }
        if (tr.type === 'berserk') spd *= 1 + tr.maxAtkSpeed * (1 - e.hp / e.maxHp);
      }
      const bl = e.statuses.blessed;
      if (bl && bl.t > 0) dmg *= bl.v;
      e.dmgMult = dmg;
      e.atkSpeedMult = spd;
      e.armorAdd = armor;
      e.evasionAdd = eva;
    }
    // Unit auras. A unique aura affects each unit once, however many of its source stand nearby.
    const uniqueAuras = new Map<Entity, Set<string>>();
    for (const src of this.entities) {
      if (!src.alive) continue;
      for (const tr of src.def.traits ?? []) {
        if (tr.type !== 'aura') continue;
        for (const o of this.alliesInRadius(src.team, src.x, src.z, tr.radius)) {
          if (o === src && tr.atkSpeedMult) continue;
          if (tr.unique) {
            const got = uniqueAuras.get(o) ?? new Set<string>();
            if (got.has(src.def.id)) continue;
            got.add(src.def.id);
            uniqueAuras.set(o, got);
          }
          if (tr.dmgMult) o.dmgMult *= tr.dmgMult;
          if (tr.atkSpeedMult) o.atkSpeedMult *= tr.atkSpeedMult;
          if (tr.evasionAdd) o.evasionAdd += tr.evasionAdd;
          if (tr.armorAdd) o.armorAdd += tr.armorAdd;
        }
      }
    }
    // Tower auras.
    for (const b of this.buildings) {
      b.dmgMult = b.baseDmgMult;
      b.atkSpeedMult = m.towerAtkSpeedMult;
    }
    for (const src of this.entities) {
      if (!src.alive || src.baseTeam !== 'player' || src.team !== 'player') continue;
      for (const tr of src.def.traits ?? []) {
        if (tr.type !== 'towerAura') continue;
        for (const b of this.buildings) {
          if (b.destroyed || !(b.isCastle || b.def?.kind === 'tower')) continue;
          if (dist2(src.x, src.z, b.x, b.z) > tr.radius * tr.radius) continue;
          if (tr.dmgMult) b.dmgMult *= tr.dmgMult;
          if (tr.atkSpeedMult) {
            const bonus = (tr.atkSpeedMult - 1) * this.mods.engineerMult;
            // Engineers stack up to two times.
            const cap = 1 + bonus * 2;
            b.atkSpeedMult = Math.min(b.atkSpeedMult * (1 + bonus), m.towerAtkSpeedMult * cap);
          }
        }
      }
    }
  }

  private updateTraits(e: Entity, dt: number): void {
    const traits = e.def.traits;
    if (!traits) return;
    const stunned = this.has(e, 'stun');
    for (let k = 0; k < traits.length; k++) {
      const tr = traits[k];
      if (!('interval' in tr)) continue;
      e.traitTimers[k] -= dt;
      if (e.traitTimers[k] > 0 || stunned) continue;
      const fired = this.fireTrait(e, tr);
      e.traitTimers[k] = fired ? tr.interval * (tr.type === 'resurrect' ? 1 / this.mods.resurrectSpeedMult : 1) : 0.4;
    }
  }

  /** Executes a periodic trait. Returns true when it actually triggered. */
  private fireTrait(e: Entity, tr: Trait): boolean {
    switch (tr.type) {
      case 'heal': {
        let best: Entity | undefined;
        let bestRatio = this.mods.overhealShieldCap > 0 && e.team === 'player' ? 1 + this.mods.overhealShieldCap - 0.01 : 0.999;
        for (const o of this.alliesInRadius(e.team, e.x, e.z, tr.range)) {
          const ratio = (o.hp + o.shield) / o.maxHp;
          if (ratio < bestRatio) {
            bestRatio = ratio;
            best = o;
          }
        }
        if (!best) return false;
        const amount = tr.amount * e.levelMult * this.mods.healMult;
        this.heal(best, amount);
        const bless = e.def.traits?.find((t) => t.type === 'blessOnHeal') as { dmgMult: number; duration: number } | undefined;
        if (bless) this.applyStatus(best, 'blessed', bless.duration, bless.dmgMult);
        e.attackAnim = 0.4;
        this.events.push({ type: 'attack', id: e.id });
        return true;
      }
      case 'rootAoe': {
        const center = this.densestFoe(e, tr.range, tr.radius);
        if (!center) return false;
        const foes = this.foesInRadius(e.team, center.x, center.z, tr.radius, false);
        for (const f of foes) this.applyStatus(f, 'root', tr.duration, 1, e.id);
        this.events.push({ type: 'aoe', x: center.x, z: center.z, radius: tr.radius, kind: 'root' });
        return true;
      }
      case 'taunt': {
        const foes = this.foesInRadius(e.team, e.x, e.z, tr.radius);
        if (!foes.length) return false;
        for (const f of foes) {
          if (f.def.traits?.some((t) => t.type === 'siege')) continue;
          this.applyStatus(f, 'taunted', tr.duration, 1, e.id);
          f.targetId = e.id;
          f.targetBuilding = null;
        }
        this.events.push({ type: 'aoe', x: e.x, z: e.z, radius: tr.radius, kind: 'taunt' });
        return true;
      }
      case 'repair': {
        let best: BBuilding | undefined;
        let bestRatio = 0.999;
        for (const b of this.buildings) {
          if (b.destroyed) continue;
          if (dist2(e.x, e.z, b.x, b.z) > (tr.range + b.radius) ** 2) continue;
          const r = b.hp / b.maxHp;
          if (r < bestRatio) {
            bestRatio = r;
            best = b;
          }
        }
        if (!best) return false;
        const amount = tr.amount * e.levelMult * this.mods.engineerMult;
        best.hp = Math.min(best.maxHp, best.hp + amount);
        this.events.push({ type: 'repair', uid: best.uid, amount });
        e.attackAnim = 0.5;
        this.events.push({ type: 'attack', id: e.id });
        return true;
      }
      case 'shieldPulse': {
        const allies = this.alliesInRadius(e.team, e.x, e.z, tr.radius);
        if (!this.foesInRadius(e.team, e.x, e.z, 16).length) return false;
        for (const a of allies) this.addShield(a, a.maxHp * tr.pctMaxHp * e.levelMult);
        this.events.push({ type: 'aoe', x: e.x, z: e.z, radius: tr.radius, kind: 'shield' });
        e.attackAnim = 0.4;
        this.events.push({ type: 'attack', id: e.id });
        return true;
      }
      case 'resurrect': {
        const r2 = tr.radius * tr.radius;
        const idx = this.dead.findIndex(
          (d) => d.def.race === e.def.race && !d.def.large && !d.resurrected && dist2(d.x, d.z, e.x, e.z) <= r2,
        );
        if (idx < 0) return false;
        const d = this.dead.splice(idx, 1)[0];
        const r = this.createEntity(d.def, 'player', d.x, d.z, { levelMult: d.levelMult, summoned: true, homeUid: null });
        r.hp = r.maxHp * tr.hpPct;
        r.resurrected = true;
        this.events.push({ type: 'resurrect', id: r.id });
        return true;
      }
      case 'summon': {
        if (e.team !== e.baseTeam) return false;
        for (let k = 0; k < tr.count; k++) {
          const def = getUnit(tr.unitId);
          const u = this.createEntity(def, e.team, e.x + this.rng.range(-1.5, 1.5), e.z + this.rng.range(-1.5, 1.5), { summoned: true });
          u.cooldown = 1;
        }
        this.events.push({ type: 'aoe', x: e.x, z: e.z, radius: 2, kind: 'summon' });
        e.attackAnim = 0.6;
        this.events.push({ type: 'attack', id: e.id });
        return true;
      }
      default:
        return false;
    }
  }

  private densestFoe(e: Entity, range: number, radius: number): Entity | undefined {
    const foes = this.foesInRadius(e.team, e.x, e.z, range, false);
    let best: Entity | undefined;
    let bestN = 0;
    for (const f of foes) {
      const n = this.foesInRadius(e.team, f.x, f.z, radius, false).length;
      if (n > bestN) {
        bestN = n;
        best = f;
      }
    }
    return best;
  }

  private moveToward(e: Entity, tx: number, tz: number, stopDist: number, dt: number): boolean {
    const dx = tx - e.x;
    const dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist) return false;
    if (this.has(e, 'root') || this.has(e, 'stun')) return false;
    let speed =
      e.def.speed *
      (e.baseTeam === 'player' ? this.mods.unitSpeedMult * (1 + this.bannerSpeed) : this.mods.enemySpeedMult);
    if (e.enraged) speed *= (e.def.traits?.find((t) => t.type === 'enrage') as { speedMult: number } | undefined)?.speedMult ?? 1;
    const sl = e.statuses.slow;
    if (sl && sl.t > 0) speed *= sl.v;
    if (this.has(e, 'rune')) speed *= 0.75;
    const stepLen = Math.min(d - stopDist, speed * dt);
    e.x += (dx / d) * stepLen;
    e.z += (dz / d) * stepLen;
    e.facing = Math.atan2(dx, dz);
    e.moved += stepLen;
    e.moving = true;
    return true;
  }

  private updateEntity(e: Entity, dt: number): void {
    e.moving = false;
    e.cooldown -= dt * e.atkSpeedMult;
    if (e.attackAnim > 0) e.attackAnim -= dt;
    if (this.has(e, 'stun')) return;
    if (this.result === 'lose') return;

    const actsAsPlayer = e.team === 'player';
    e.retarget -= dt;

    // Taunt overrides targeting for enemies.
    const taunt = e.statuses.taunted;
    if (taunt && taunt.t > 0 && taunt.src !== undefined) {
      const t = this.getEntity(taunt.src);
      if (t?.alive && t.team !== e.team) {
        e.targetId = t.id;
        e.targetBuilding = null;
      }
    } else if (e.retarget <= 0) {
      e.retarget = RETARGET;
      this.chooseTarget(e, actsAsPlayer);
    }

    let target = this.getEntity(e.targetId);
    if (target && (!target.alive || target.team === e.team)) {
      target = undefined;
      e.targetId = null;
    }
    const building = this.getBuilding(e.targetBuilding);
    if (building?.destroyed) e.targetBuilding = null;

    if (target) {
      const reach = this.rangeOf(e) + target.radius + e.radius * 0.5;
      const d = Math.hypot(target.x - e.x, target.z - e.z);
      if (d > reach) {
        if (e.def.ai === 'engineer' && !this.engineerMayChase(e, target)) {
          this.engineerIdle(e, dt);
        } else {
          this.moveToward(e, target.x, target.z, reach * 0.9, dt);
        }
      } else {
        e.facing = Math.atan2(target.x - e.x, target.z - e.z);
        if (e.cooldown <= 0) this.attack(e, target, null);
      }
      return;
    }
    if (e.targetBuilding !== null && !actsAsPlayer) {
      const b = this.getBuilding(e.targetBuilding)!;
      const reach = this.rangeOf(e) + b.radius;
      const d = Math.hypot(b.x - e.x, b.z - e.z);
      if (d > reach) this.moveToward(e, b.x, b.z, reach * 0.9, dt);
      else {
        e.facing = Math.atan2(b.x - e.x, b.z - e.z);
        if (e.cooldown <= 0) this.attack(e, null, b);
      }
      return;
    }
    // No target: player units form up on the push line, enemies march on.
    if (actsAsPlayer) {
      if (e.def.ai === 'engineer') this.engineerIdle(e, dt);
      else this.moveToward(e, this.rallyX(e), e.rallyZ, 0.4, dt);
      if (!e.moving) e.moved = 0;
    } else {
      this.moveToward(e, 0, 0, 2, dt);
    }
  }

  /** Where a soldier without a target stands: melee on the line, ranged and support behind it. */
  rallyX(e: Entity): number {
    if (e.def.ai === 'support') return Math.max(this.frontX - 0.5, this.pushLine - 5);
    if (e.def.range > 2.5) return Math.max(this.frontX + 0.5, this.pushLine - 3.5);
    return this.pushLine + (e.def.ai === 'aggressive' ? 2 : 0);
  }

  /**
   * Moves the formation line: once enough soldiers have gathered and they are not outmatched by
   * the enemies ahead, the line marches forward; if the enemy clearly has the upper hand it falls back.
   */
  private updateFormation(dt: number): void {
    const min = this.frontX + FORMATION.minPush;
    const max = Math.min(this.frontX + FORMATION.maxPush, SPAWN_X - 2);
    let ours = 0;
    let gathered = 0;
    let theirs = 0;
    for (const e of this.entities) {
      if (!e.alive || e.def.ai === 'engineer') continue;
      const power = unitPower(e);
      if (e.team === 'player') {
        if (e.def.ai === 'support') continue;
        ours += power;
        if (e.x >= this.pushLine - 4) gathered++;
      } else if (e.x < this.pushLine + 14) {
        theirs += power;
      }
    }
    if (gathered >= MIN_GROUP && ours >= theirs * 0.8) this.pushLine = Math.min(max, this.pushLine + PUSH_SPEED * dt);
    else if (ours < theirs * 0.6) this.pushLine = Math.max(min, this.pushLine - RETREAT_SPEED * dt);
  }

  private engineerMayChase(e: Entity, t: Entity): boolean {
    return dist2(e.x, e.z, t.x, t.z) < 4 * 4;
  }

  private engineerIdle(e: Entity, dt: number): void {
    // Stand next to the front-most tower (or castle) so the boost aura covers it.
    let best: BBuilding | undefined;
    let bestScore = -Infinity;
    for (const b of this.buildings) {
      if (b.destroyed || !(b.def?.kind === 'tower' || b.isCastle)) continue;
      const damaged = 1 - b.hp / b.maxHp;
      const score = b.x + damaged * 20 + (b.isCastle ? -6 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (!best) best = this.castle;
    const offset = ((e.id % 5) - 2) * 0.7;
    this.moveToward(e, best.x + 1.6, best.z + offset, 0.3, dt);
  }

  private chooseTarget(e: Entity, actsAsPlayer: boolean): void {
    const siege = e.def.traits?.some((t) => t.type === 'siege');
    if (actsAsPlayer) {
      const aggressive = e.def.ai === 'aggressive';
      const acquire =
        e.def.ai === 'engineer'
          ? 4
          : e.def.ai === 'support'
            ? Math.max(this.rangeOf(e) + 1, 7)
            : Math.max(FORMATION.acquire + (aggressive ? AGGRESSIVE_BONUS : 0), this.rangeOf(e) + 1.5);
      // Never chase past the formation's leash.
      const maxX = this.frontX + FORMATION.leash + (aggressive ? AGGRESSIVE_BONUS : 0) + this.rangeOf(e);
      const cur = this.getEntity(e.targetId);
      // Past the leash, still answer whoever is attacking this soldier: otherwise a lone archer
      // standing just outside it could stall the wave until it times out.
      const foe = this.nearestFoe(e, acquire, maxX) ?? this.attackerOf(e, acquire);
      // Stick to the current target unless something is much closer.
      if (cur?.alive && cur.team !== e.team && foe && cur !== foe) {
        const dc = dist2(e.x, e.z, cur.x, cur.z);
        const df = dist2(e.x, e.z, foe.x, foe.z);
        e.targetId = df < dc * 0.6 ? foe.id : cur.id;
      } else {
        e.targetId = foe?.id ?? null;
      }
      e.targetBuilding = null;
      return;
    }
    if (!siege) {
      const aggro = Math.max(5, e.def.range + 3);
      const foe = this.nearestFoe(e, aggro);
      if (foe) {
        e.targetId = foe.id;
        e.targetBuilding = null;
        return;
      }
    }
    e.targetId = null;
    const b = this.nearestBuilding(e.x, e.z);
    e.targetBuilding = b?.uid ?? null;
  }

  private attack(e: Entity, target: Entity | null, building: BBuilding | null): void {
    e.cooldown = e.def.attackInterval;
    e.attackCount += 1;
    e.attackAnim = 0.45;
    this.events.push({ type: 'attack', id: e.id });

    const sd = e.def.traits?.find((t) => t.type === 'selfDestruct') as { damage: number; radius: number } | undefined;
    if (sd) {
      const dmg = sd.damage * e.dmgScale;
      for (const t of this.foesInRadius(e.team, e.x, e.z, sd.radius)) this.damageEntity(t, dmg, 'magic', { entity: e }, { canDodge: false });
      if (e.baseTeam === 'enemy') {
        for (const b of this.buildings) {
          if (!b.destroyed && dist2(e.x, e.z, b.x, b.z) <= (sd.radius + b.radius) ** 2) this.damageBuilding(b, dmg, e);
        }
      }
      this.events.push({ type: 'explode', x: e.x, z: e.z, radius: sd.radius, kind: 'toxic' });
      // Exploding consumes the bloater; skip its regular death explosion.
      e.alive = false;
      e.hp = 0;
      e.deadAt = this.time;
      this.events.push({ type: 'death', id: e.id });
      return;
    }

    const base = e.def.damage * e.dmgScale;
    const ranged = !!e.def.projectile;
    if (building) {
      const dmg = base * e.dmgMult;
      if (ranged) {
        this.fireProjectile(e.def.projectile!, e.team, e.x, e.z, e.flying ? 2.2 : 1.1, null, building, (bt) => {
          const b = bt.getBuilding(building.uid);
          if (b) bt.damageBuilding(b, dmg, e);
        });
      } else {
        this.damageBuilding(building, dmg, e);
      }
      return;
    }
    if (!target) return;

    const targets: Entity[] = [target];
    const multi = e.def.traits?.find((t) => t.type === 'multishot') as { count: number } | undefined;
    if (multi) {
      const range = this.rangeOf(e);
      const extra = this.foesInRadius(e.team, e.x, e.z, range, true)
        .filter((o) => o !== target)
        .sort((a, b) => dist2(e.x, e.z, a.x, a.z) - dist2(e.x, e.z, b.x, b.z))
        .slice(0, multi.count - 1);
      targets.push(...extra);
    }
    const charging = e.def.traits?.find((t) => t.type === 'charge') as
      | { distance: number; stun: number; exposedDuration: number }
      | undefined;
    const isCharge = !!charging && e.moved >= charging.distance;

    for (const t of targets) {
      const { mult, crit } = this.outgoingMult(e, t);
      const dmg = base * mult;
      const hit = (bt: Battle, hx: number, hz: number) => bt.resolveHit(e, t, dmg, crit, hx, hz);
      if (ranged) {
        this.fireProjectile(e.def.projectile!, e.team, e.x, e.z, e.flying ? 2.2 : 1.1, t, null, (bt, hx, hz) => hit(bt, hx, hz));
      } else {
        hit(this, t.x, t.z);
      }
    }
    if (isCharge && charging) {
      this.applyStatus(target, 'stun', charging.stun, 1, e.id);
      this.applyStatus(target, 'exposed', charging.exposedDuration, 1.3, e.id);
    }
    e.moved = 0;
  }

  /** Applies a landed attack: primary damage, splash, cleave, on-hit statuses, chains. */
  resolveHit(e: Entity, t: Entity, dmg: number, crit: boolean, hx: number, hz: number): void {
    const type = e.def.damageType ?? 'physical';
    if (t.alive) {
      this.damageEntity(t, dmg, type, { entity: e }, { crit });
      for (const tr of e.def.traits ?? []) {
        if (tr.type === 'onHit') {
          if (tr.everyN && e.attackCount % tr.everyN !== 0) continue;
          this.applyStatus(t, tr.status, tr.duration, tr.value ?? 1, e.id, e.baseTeam === 'player' ? e.def.id : undefined);
        }
      }
    }
    const splash = e.def.splash;
    if (splash) {
      for (const o of this.foesInRadius(e.team, hx, hz, splash, !!e.def.canHitAir)) {
        if (o !== t) this.damageEntity(o, dmg * 0.6, type, { entity: e }, { canDodge: false });
      }
      this.events.push({ type: 'explode', x: hx, z: hz, radius: splash, kind: type === 'magic' ? (e.team === 'player' ? 'holy' : 'shadow') : 'fire' });
    }
    const cleave = e.def.traits?.find((tr) => tr.type === 'cleave') as { radius: number; ratio: number } | undefined;
    if (cleave) {
      for (const o of this.foesInRadius(e.team, hx, hz, cleave.radius, false)) {
        if (o !== t) this.damageEntity(o, dmg * cleave.ratio, type, { entity: e }, { canDodge: false });
      }
    }
  }

  fireProjectile(
    kind: ProjectileKind,
    team: Team,
    x: number,
    z: number,
    y: number,
    target: Entity | null,
    building: BBuilding | null,
    onHit: (b: Battle, x: number, z: number) => void,
  ): Projectile {
    const speeds: Partial<Record<ProjectileKind, number>> = { arrow: 20, bolt: 22, bullet: 30, rock: 11, lightning: 40, fire: 14 };
    const p: Projectile = {
      id: this.nextId++,
      kind,
      team,
      x,
      z,
      fromX: x,
      fromZ: z,
      fromY: y,
      targetId: target?.id ?? null,
      targetBuilding: building?.uid ?? null,
      tx: target?.x ?? building?.x ?? x,
      tz: target?.z ?? building?.z ?? z,
      speed: speeds[kind] ?? 15,
      done: false,
      onHit,
    };
    this.projectiles.push(p);
    this.events.push({ type: 'projectile', pid: p.id, kind, fromY: y, flying: !!target?.flying });
    return p;
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (p.done) continue;
      const t = this.getEntity(p.targetId);
      if (t?.alive) {
        p.tx = t.x;
        p.tz = t.z;
      }
      const dx = p.tx - p.x;
      const dz = p.tz - p.z;
      const d = Math.hypot(dx, dz);
      const stepLen = p.speed * dt;
      if (d <= stepLen + 0.05) {
        p.x = p.tx;
        p.z = p.tz;
        p.done = true;
        p.onHit(this, p.x, p.z);
      } else {
        p.x += (dx / d) * stepLen;
        p.z += (dz / d) * stepLen;
      }
    }
    if (this.projectiles.length > 200) this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  // ---------------------------------------------------------------- towers & castle

  private updateBuildingsCombat(dt: number): void {
    if (this.result) return;
    for (const b of this.buildings) {
      if (b.destroyed) continue;
      // Light tower heal.
      const sp = b.def?.special;
      if (sp?.type === 'healAura') {
        b.healTimer -= dt;
        if (b.healTimer <= 0) {
          b.healTimer = 0.5;
          for (const a of this.alliesInRadius('player', b.x, b.z, sp.radius)) {
            if (a.hp >= a.maxHp) continue;
            const amount = Math.min(a.maxHp - a.hp, a.maxHp * sp.pctPerSec[b.level - 1] * 0.5 * this.mods.healMult);
            a.hp += amount;
            if (this.rng.chance(0.25)) this.events.push({ type: 'heal', id: a.id, amount });
          }
        }
      }
      if (sp?.type === 'lightTower') {
        b.healTimer -= dt;
        if (b.healTimer <= 0) {
          b.healTimer = sp.interval;
          let best: Entity | undefined;
          let bestR = 0.999;
          for (const a of this.alliesInRadius('player', b.x, b.z, sp.range)) {
            const r = a.hp / a.maxHp;
            if (r < bestR) {
              bestR = r;
              best = a;
            }
          }
          if (best) this.heal(best, sp.heal[b.level - 1] * this.mods.healMult);
        }
      }
      const spec = b.isCastle
        ? {
            damage: [CASTLE.damage[b.level - 1]],
            range: CASTLE.range,
            attackInterval: CASTLE.attackInterval,
            damageType: 'physical' as DamageType,
            canHitAir: true,
            projectile: 'arrow' as ProjectileKind,
            splash: undefined,
            traits: undefined as Trait[] | undefined,
          }
        : b.def?.tower;
      if (!spec) continue;
      b.cooldown -= dt * b.atkSpeedMult;
      if (b.cooldown > 0) continue;
      const range = spec.range + this.mods.towerRangeAdd;
      let target: Entity | undefined;
      let bestD = range * range;
      for (const o of this.entities) {
        if (!o.alive || o.team === 'player' || (o.flying && !spec.canHitAir)) continue;
        const d = dist2(b.x, b.z, o.x, o.z);
        if (d < bestD) {
          bestD = d;
          target = o;
        }
      }
      if (!target) {
        b.cooldown = 0.15;
        continue;
      }
      b.cooldown = spec.attackInterval;
      const dmg = (b.isCastle ? spec.damage[0] : spec.damage[b.level - 1]) * b.dmgMult;
      const t = target;
      this.events.push({ type: 'towerAttack', uid: b.uid });
      this.fireProjectile(spec.projectile, 'player', b.x, b.z, b.isCastle ? 4.2 : 3.4, t, null, (bt, hx, hz) =>
        bt.resolveTowerHit(b, spec, t, dmg, hx, hz),
      );
    }
  }

  resolveTowerHit(
    b: BBuilding,
    spec: { damage: number[]; damageType: DamageType; splash?: number; traits?: Trait[]; canHitAir: boolean },
    t: Entity,
    dmg: number,
    hx: number,
    hz: number,
  ): void {
    const baseDamage = spec.damage[0];
    const hitOne = (o: Entity, amount: number) => {
      this.damageEntity(o, amount, spec.damageType, { building: b }, { canDodge: false });
      for (const tr of spec.traits ?? []) {
        if (tr.type !== 'onHit') continue;
        // Damage-over-time scales with the tower's level and bonuses.
        const value = tr.status === 'burn' ? (tr.value ?? 1) * (amount / baseDamage) : tr.value ?? 1;
        this.applyStatus(o, tr.status, tr.duration, value, undefined, b.isCastle ? 'castle' : b.def?.id);
      }
    };
    if (t.alive) hitOne(t, dmg);
    if (spec.splash) {
      for (const o of this.foesInRadius('player', hx, hz, spec.splash, spec.canHitAir)) if (o !== t) hitOne(o, dmg * 0.7);
      this.events.push({ type: 'explode', x: hx, z: hz, radius: spec.splash, kind: 'fire' });
    }
    for (const tr of spec.traits ?? []) {
      if (tr.type === 'pierce') {
        const dx = hx - b.x;
        const dz = hz - b.z;
        const len = Math.hypot(dx, dz) || 1;
        const behind = this.foesInRadius('player', hx + (dx / len) * tr.range * 0.5, hz + (dz / len) * tr.range * 0.5, tr.range * 0.6, spec.canHitAir)
          .filter((o) => o !== t)
          .slice(0, tr.count);
        for (const o of behind) hitOne(o, dmg * 0.8);
      }
      if (tr.type === 'chain') {
        const hitSet = new Set<number>([t.id]);
        const points = [{ x: b.x, z: b.z }, { x: hx, z: hz }];
        let cx = hx;
        let cz = hz;
        let amount = dmg;
        for (let k = 0; k < tr.count; k++) {
          amount *= tr.falloff;
          const next = this.foesInRadius('player', cx, cz, tr.range, spec.canHitAir)
            .filter((o) => !hitSet.has(o.id))
            .sort((a, c) => dist2(cx, cz, a.x, a.z) - dist2(cx, cz, c.x, c.z))[0];
          if (!next) break;
          hitSet.add(next.id);
          hitOne(next, amount);
          cx = next.x;
          cz = next.z;
          points.push({ x: cx, z: cz });
        }
        if (points.length > 2) this.events.push({ type: 'chain', points });
      }
    }
  }

  // ---------------------------------------------------------------- crowding

  private separate(): void {
    const list = this.entities.filter((e) => e.alive && !e.flying);
    const n = list.length;
    for (let a = 0; a < n; a++) {
      const ea = list[a];
      for (let b = a + 1; b < n; b++) {
        const eb = list[b];
        const dx = eb.x - ea.x;
        const dz = eb.z - ea.z;
        const min = (ea.radius + eb.radius) * 0.85;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        const wa = ea.def.large ? 0.25 : 1;
        const wb = eb.def.large ? 0.25 : 1;
        const rootedA = this.has(ea, 'root') || this.has(ea, 'stun');
        const rootedB = this.has(eb, 'root') || this.has(eb, 'stun');
        if (!rootedA) {
          ea.x -= nx * push * wa;
          ea.z -= nz * push * wa;
        }
        if (!rootedB) {
          eb.x += nx * push * wb;
          eb.z += nz * push * wb;
        }
      }
    }
  }

  /** Drain queued events (renderer/audio consume them each frame). */
  drainEvents(): BattleEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  raceName(): string {
    return RACE_MAP.get(this.state.race)!.name;
  }
}

/** Runs a whole battle headlessly (tests, balance tools). */
export function simulateBattle(state: GameState, maxTime = 420): Battle {
  const b = new Battle(state);
  while (!b.finished && b.time < maxTime + 5) {
    b.step();
    b.events.length = 0;
  }
  return b;
}
