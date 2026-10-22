// Campaign balance check: the bot liberates the map with two strategies and
// reports how close each territory battle was.
// Usage: npm run campaign-sim   (env RACE=elf to filter, STRAT=straight|full|lazy|adaptive|mono)
// `adaptive` reads each wave preview and builds counters; `mono` spams one combat building. Both take the full route.
// `lazy` takes the straight road with level-1 starter barracks only and should fail by tier 2-3.
import { simulateBattle } from '../src/game/battle';
import { adaptivePrepare, botPrepare, lazyPrepare, monoPrepare } from '../src/game/bot';
import { createLevelState, isAttackable, newCampaign, recordBattle, type CampaignState } from '../src/game/campaign/campaign';
import { CAPITAL_TERRITORY, TERRITORIES, territoryTier } from '../src/game/campaign/territories';
import { RACES } from '../src/game/data/index';
import { DIFFICULTY } from '../src/game/data/waves';
import { applyBattleOutcome } from '../src/game/state';

const base = DIFFICULTY.base;

/** Plays a whole territory battle with the bot; returns whether it was won. */
type Strategy = 'straight' | 'full' | 'lazy' | 'adaptive' | 'mono';

function playLevel(c: CampaignState, id: string, seed: number, mult = 1, prepare = botPrepare): { won: boolean; kills: number } {
  DIFFICULTY.base = base * mult;
  const s = createLevelState(c, id, seed);
  const plan = { n: 0 };
  let kills = 0;
  while (s.phase === 'prep') {
    prepare(s, plan);
    s.phase = 'battle';
    const b = simulateBattle(s);
    kills += b.kills;
    applyBattleOutcome(s, b.outcome());
  }
  DIFFICULTY.base = base;
  return { won: s.phase === 'victory', kills };
}

/** Largest enemy-strength multiplier the bot still beats this territory with. */
function margin(c: CampaignState, id: string, prepare = botPrepare): number {
  let lo = 0.3;
  let hi = 4;
  if (!playLevel(c, id, 11, lo, prepare).won) return 0;
  if (playLevel(c, id, 11, hi, prepare).won) return hi;
  for (let k = 0; k < 6; k++) {
    const mid = Math.sqrt(lo * hi);
    if (playLevel(c, id, 11, mid, prepare).won) lo = mid;
    else hi = mid;
  }
  return lo;
}

const STRAIGHT = ['t_wheat', 't_ravenhold', 't_royalcamp', CAPITAL_TERRITORY.id];

function run(race: (typeof RACES)[number]['id'], strategy: Strategy): string {
  const prepare = ({ lazy: lazyPrepare, adaptive: adaptivePrepare, mono: monoPrepare } as Partial<Record<Strategy, typeof botPrepare>>)[strategy] ?? botPrepare;
  const c = newCampaign(race);
  const out: string[] = [];
  const order =
    strategy === 'straight' || strategy === 'lazy'
      ? STRAIGHT
      : [...TERRITORIES.filter((t) => !t.start && !t.capital).sort((a, b) => territoryTier(a) - territoryTier(b)).map((t) => t.id), CAPITAL_TERRITORY.id];
  for (const id of order) {
    if (!isAttackable(c, id)) continue;
    const m = margin(c, id, prepare);
    let tries = 0;
    let res = playLevel(c, id, 1, 1, prepare);
    while (!res.won && tries < 3) {
      tries++;
      res = playLevel(c, id, 1 + tries, 1, prepare);
    }
    recordBattle(c, id, res.won, res.kills);
    const t = TERRITORIES.find((x) => x.id === id)!;
    out.push(`${t.name}(${territoryTier(t)}):${m.toFixed(2)}${res.won ? '' : '✗'}${tries ? `+${tries}` : ''}`);
    if (!res.won) break;
  }
  return out.join(' ');
}

const only = process.env.RACE;
const strategies = (process.env.STRAT ?? 'straight,full,lazy').split(',') as Strategy[];
for (const r of RACES.filter((x) => !only || x.id === only)) {
  for (const strat of strategies) console.log(`${r.name} ${strat.padEnd(8)} ${run(r.id, strat)}`);
}
