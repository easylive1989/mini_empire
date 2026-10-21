/** World size of one grid tile. Tile (i, j) is centred at (i * TILE, 0, j * TILE). */
export const TILE = 4;
/** The plot grows from 3x3 (|i|,|j| <= 1) up to 5x5 (|i|,|j| <= 2). */
export const GRID_RADIUS = 2;
export const START_RADIUS = 1;

/** Enemies always march in from +X (bottom-right of the screen). */
export const SPAWN_X = 34;
export const SPAWN_Z_SPREAD = 9;

export const FINAL_WAVE = 30;
export const BOSS_WAVES = [10, 20, 30];
export const BOON_EVERY = 5;

export const START_GOLD = 260;
export const MAX_BUILDING_LEVEL = 3;

export const CASTLE = {
  maxLevel: 5,
  hp: [1000, 1500, 2100, 2800, 3600],
  upgradeCost: [0, 220, 420, 680, 1000],
  baseIncome: [45, 60, 75, 90, 110],
  /** Total tiles that may be bought on top of the starting 3x3, per castle level. */
  expansionCap: [0, 4, 8, 12, 16],
  damage: [16, 26, 40, 58, 80],
  range: 10,
  attackInterval: 1.0,
};

/** Upgrade cost multipliers (of base cost) to reach level 2 and 3. */
export const UPGRADE_COST_MULT = [0, 0.9, 1.7];
/** Unit stat multiplier by the level of the barracks that spawned it. */
export const UNIT_LEVEL_MULT = [1, 1.35, 1.75];
export const BUILDING_LEVEL_HP_MULT = [1, 1.3, 1.65];

export const ADJACENT_BARRACKS_SPAWN_BONUS = 0.1;
export const ADJACENT_RESOURCE_INCOME_BONUS = 0.1;
export const ADJACENT_TOWER_DMG_BONUS = 0.1;

export const EXPAND_BASE_COST = 80;
export const EXPAND_STEP_COST = 30;
export const REPAIR_GOLD_PER_HP = 0.5;
export const DEMOLISH_REFUND = 0.5;

/** Battle tick length (seconds). */
export const DT = 1 / 30;
