import type { BuildingDef } from '../types';

/** Buildings every race can build. */
export const COMMON_BUILDINGS: BuildingDef[] = [
  {
    id: 'gold_mine',
    name: '金礦',
    race: 'all',
    kind: 'resource',
    cost: 80,
    castleLevel: 1,
    hp: 320,
    desc: '每波結束時產出金幣。與其他資源建築相鄰時，每個相鄰的資源建築 +10% 產量。',
    model: { pack: 'buildings', key: 'mine' },
    income: [32, 56, 86],
  },
];
