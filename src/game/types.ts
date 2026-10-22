export type RaceId = 'human' | 'elf' | 'dwarf' | 'angel';
export type Team = 'player' | 'enemy';
export type DamageType = 'physical' | 'magic';
export type ProjectileKind =
  | 'arrow'
  | 'bolt'
  | 'bullet'
  | 'magic'
  | 'fire'
  | 'holy'
  | 'nature'
  | 'shadow'
  | 'frost'
  | 'rock'
  | 'lightning';

export type StatusId =
  | 'root'
  | 'stun'
  | 'slow'
  | 'burn'
  | 'mark'
  | 'rune'
  | 'exposed'
  | 'taunted'
  | 'blessed'
  | 'moonlight';

/** Data-driven abilities. The battle engine implements each `type`. */
export type Trait =
  | { type: 'heal'; amount: number; interval: number; range: number }
  | { type: 'blessOnHeal'; dmgMult: number; duration: number }
  | { type: 'aura'; radius: number; dmgMult?: number; atkSpeedMult?: number; evasionAdd?: number; armorAdd?: number; unique?: boolean }
  | { type: 'towerAura'; radius: number; dmgMult?: number; atkSpeedMult?: number }
  | { type: 'phalanx'; radius: number; minAllies: number; armorAdd: number; dmgMult: number }
  | { type: 'focusFire'; radius: number; dmgMult: number }
  | { type: 'charge'; distance: number; dmgMult: number; stun: number; exposedDuration: number }
  | { type: 'bonusVsLarge'; dmgMult: number }
  | { type: 'onHit'; status: StatusId; duration: number; value?: number; everyN?: number }
  | { type: 'critVsDisabled'; mult: number }
  | { type: 'counter'; mult: number }
  | { type: 'rootAoe'; interval: number; radius: number; duration: number; range: number }
  | { type: 'taunt'; interval: number; radius: number; duration: number }
  | { type: 'multishot'; count: number }
  | { type: 'chain'; count: number; range: number; falloff: number }
  | { type: 'pierce'; count: number; range: number }
  | { type: 'explodeOnDeath'; radius: number; damage: number }
  | { type: 'berserk'; maxAtkSpeed: number }
  | { type: 'lifesteal'; ratio: number }
  | { type: 'repair'; amount: number; interval: number; range: number }
  | { type: 'shieldPulse'; interval: number; radius: number; pctMaxHp: number }
  | { type: 'shieldPower'; maxMult: number }
  | { type: 'shieldOnKill'; amount: number; radius: number }
  | { type: 'resurrect'; interval: number; radius: number; hpPct: number }
  | { type: 'summon'; unitId: string; interval: number; count: number }
  | { type: 'selfDestruct'; damage: number; radius: number }
  | { type: 'siege'; buildingDmgMult: number }
  | { type: 'cleave'; radius: number; ratio: number }
  /** Every hit on a building pockets gold from the player's treasury. */
  | { type: 'stealGold'; amount: number }
  /** Regenerates a share of max HP per second. */
  | { type: 'regen'; pct: number }
  /** Once below `threshold` HP: transforms, gaining power and calling reinforcements. */
  | { type: 'enrage'; threshold: number; dmgMult: number; atkSpeedMult: number; speedMult: number; summon?: { unitId: string; count: number } };

export type CharacterBase =
  | 'Knight'
  | 'Barbarian'
  | 'Mage'
  | 'Rogue'
  | 'Rogue_Hooded'
  | 'Skeleton_Minion'
  | 'Skeleton_Warrior'
  | 'Skeleton_Mage'
  | 'Skeleton_Rogue';

export type Extra =
  | 'wings'
  | 'bigWings'
  | 'batWings'
  | 'halo'
  | 'horns'
  | 'bigHorns'
  | 'ears'
  | 'beard'
  | 'dwarfHelm'
  | 'leaves'
  | 'chimney'
  | 'crown'
  | 'spear'
  | 'bow'
  | 'hammer'
  | 'banner'
  | 'goblinEars'
  | 'tusks';

export interface ModelSpec {
  base: CharacterBase;
  scale?: number;
  /** Per-axis multiplier on top of `scale`, e.g. stocky dwarves. */
  squash?: [number, number, number];
  /** Names of built-in hand/head meshes to keep; every other hand item is hidden. */
  keep?: string[];
  /** Built-in meshes to hide (helmets, capes...). */
  hide?: string[];
  /** Extra items from weapons.glb attached to the rig. */
  attach?: { item: string; slot: 'handslot.r' | 'handslot.l' }[];
  extras?: Extra[];
  /** Recolour scheme for the character texture. */
  palette?: string;
  ghost?: boolean;
  anims?: { idle?: string; move?: string; attack?: string; death?: string };
}

export interface UnitDef {
  id: string;
  name: string;
  race: RaceId | 'monster' | 'mercenary';
  role: string;
  desc: string;
  hp: number;
  damage: number;
  attackInterval: number;
  range: number;
  speed: number;
  armor?: number;
  evasion?: number;
  damageType?: DamageType;
  canHitAir?: boolean;
  flying?: boolean;
  large?: boolean;
  boss?: boolean;
  projectile?: ProjectileKind;
  splash?: number;
  radius?: number;
  traits?: Trait[];
  bounty?: number;
  /** AI behaviour override. `aggressive` units charge ahead of the formation. */
  ai?: 'support' | 'engineer' | 'aggressive';
  model: ModelSpec;
}

export interface TowerSpec {
  damage: number[];
  range: number;
  attackInterval: number;
  damageType: DamageType;
  canHitAir: boolean;
  projectile: ProjectileKind;
  splash?: number;
  traits?: Trait[];
}

export type BuildingSpecial =
  | { type: 'market'; perAdjacent: number[] }
  | { type: 'moonwell'; hpBonus: number[] }
  | { type: 'forge'; towerDmg: number[] }
  | { type: 'sanctum'; castleRepair: number[] }
  | { type: 'lightTower'; heal: number[]; interval: number; range: number }
  /** Heals every soldier in range by a share of max HP per second. */
  | { type: 'healAura'; pctPerSec: number[]; radius: number }
  /** While standing, every soldier deals more damage and moves faster. */
  | { type: 'warBanner'; dmg: number[]; speed: number[] };

export type BuildingKind = 'castle' | 'resource' | 'barracks' | 'tower' | 'support';

export interface BuildingModel {
  pack: 'buildings' | 'env' | 'halloween' | 'dungeon';
  key: string;
  scale?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  race: RaceId | 'all';
  kind: Exclude<BuildingKind, 'castle'>;
  /** Campaign-only building that must be unlocked by liberating a territory; limited to one per battle. */
  campaignOnly?: boolean;
  cost: number;
  castleLevel: number;
  hp: number;
  desc: string;
  model: BuildingModel;
  income?: number[];
  unit?: string;
  spawnInterval?: number[];
  maxAlive?: number[];
  tower?: TowerSpec;
  special?: BuildingSpecial;
}

export interface RaceMods {
  incomeMult?: number;
  costMult?: number;
  buildingHpMult?: number;
  towerDmgMult?: number;
  unitArmorAdd?: number;
  unitEvasionAdd?: number;
  spawnSpeedMult?: number;
  maxAliveAdd?: number;
  unitHpMult?: number;
  regenPct?: number;
  startShieldPct?: number;
  overhealShieldCap?: number;
  combinedArms?: number;
}

export interface Synergy {
  name: string;
  /** Unit or building ids that make up the combo. */
  parts: string[];
  desc: string;
}

export interface RaceDef {
  id: RaceId;
  name: string;
  title: string;
  color: string;
  desc: string;
  strengths: string[];
  weaknesses: string[];
  passive: { name: string; desc: string };
  synergies: Synergy[];
  mods: RaceMods;
  castleName: string;
}

/** Aggregated numeric modifiers from race + boons. */
export interface Modifiers {
  incomeMult: number;
  costMult: number;
  buildingHpMult: number;
  towerDmgMult: number;
  towerAtkSpeedMult: number;
  unitHpMult: number;
  unitDmgMult: number;
  unitArmorAdd: number;
  unitEvasionAdd: number;
  unitSpeedMult: number;
  spawnSpeedMult: number;
  maxAliveAdd: number;
  bountyMult: number;
  castleHpMult: number;
  expandCostMult: number;
  interest: number;
  regenPct: number;
  startShieldPct: number;
  overhealShieldCap: number;
  combinedArms: number;
  rootDurationAdd: number;
  critMult: number;
  rangeAdd: Record<string, number>;
  chargeMult: number;
  explosionMult: number;
  resurrectSpeedMult: number;
  engineerMult: number;
  healMult: number;
  castleDmgMult: number;
  castleIncomeMult: number;
  /** Extra range for all ranged soldiers. */
  rangeAddAll: number;
  towerRangeAdd: number;
  enemyHpMult: number;
  enemyDmgMult: number;
  enemySpeedMult: number;
  enemyEvasionAdd: number;
  enemyArmorAdd: number;
  /** Share of physical damage a melee attacker takes back when it hits an enemy. */
  enemyThorns: number;
}

export interface BoonDef {
  id: string;
  name: string;
  desc: string;
  race?: RaceId;
  apply: (m: Modifiers) => void;
}

export interface WaveGroup {
  unit: string;
  count: number;
}

export interface WaveDef {
  wave: number;
  groups: WaveGroup[];
  boss?: string;
  title?: string;
  /** Stat multipliers for regular monsters (bosses are tuned for their wave). */
  hpMult: number;
  dmgMult: number;
  bossHpMult: number;
  /** Campaign battle trait of the territory (see campaign/traits.ts). */
  trait?: string;
}
