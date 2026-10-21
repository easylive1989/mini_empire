// Campaign balance check: the bot liberates the map with two strategies and
// reports how close each territory battle was.
// Usage: npx vite-node tools/campaign-sim.ts   (env RACE=elf to filter)
import { simulateBattle } from '../src/game/battle';
import { botPrepare } from '../src/game/bot';
import { createLevelState, isAttackable, newCampaign, recordBattle, type CampaignState } from '../src/game/campaign/campaign';
import { CAPITAL_TERRITORY, TERRITORIES, territoryTier } from '../src/game/campaign/territories';
import { RACES } from '../src/game/data/index';
import { DIFFICULTY } from '../src/game/data/waves';
import { applyBattleOutcome, type GameState } from '../src/game/state';

const base = DIFFICULTY.base;

/** Plays a whole territory battle; returns whether it was won and the castle HP left. */
function playLevel(c: CampaignState, id: string, seed: number, mult = 1): { won: boolean; hp: number; kills: number } {
  DIFFICULTY.base = base * mult;
  const s = createLevelState(c, id, seed);
  const plan = { n: 0 };
  let kills = 0;
  while (s.phase === 'prep') {
    botPrepare(s, plan);
    s.phase = 'battle';
    const b = simulateBattle(s);
    kills += b.kills;
    applyBattleOutcome(s, b.outcome());
  }
  DIFFICULTY.base = base;
  return { won: s.phase === 'victory', hp: s.castleHp / (s as GameState).castleHp, kills };
}

/** Largest enemy-strength multiplier the bot still beats this territory with. */
function margin(c: CampaignState, id: string): number {
  let lo = 0.3;
  let hi = 4;
  if (!playLevel(c, id, 11, lo).won) return 0;
  if (playLevel(c, id, 11, hi).won) return hi;
  for (let k = 0; k < 6; k++) {
    const mid = Math.sqrt(lo * hi);
    if (playLevel(c, id, 11, mid).won) lo = mid;
    else hi = mid;
  }
  return lo;
}

const STRAIGHT = ['t_wheat', 't_ravenhold', 't_royalcamp', CAPITAL_TERRITORY.id];

function run(race: (typeof RACES)[number]['id'], strategy: 'straight' | 'full'): string {
  const c = newCampaign(race);
  const out: string[] = [];
  const order =
    strategy === 'straight'
      ? STRAIGHT
      : [...TERRITORIES.filter((t) => !t.start && !t.capital).sort((a, b) => territoryTier(a) - territoryTier(b)).map((t) => t.id), CAPITAL_TERRITORY.id];
  for (const id of order) {
    if (!isAttackable(c, id)) continue;
    const m = margin(c, id);
    let tries = 0;
    let res = playLevel(c, id, 1);
    while (!res.won && tries < 3) {
      tries++;
      res = playLevel(c, id, 1 + tries);
    }
    recordBattle(c, id, res.won, res.kills);
    const t = TERRITORIES.find((x) => x.id === id)!;
    out.push(`${t.name}(${territoryTier(t)}):${m.toFixed(2)}${res.won ? '' : '✗'}${tries ? `+${tries}` : ''}`);
    if (!res.won) break;
  }
  return out.join(' ');
}

const only = process.env.RACE;
const strategies = (process.env.STRAT ?? 'straight,full').split(',') as ('straight' | 'full')[];
for (const r of RACES.filter((x) => !only || x.id === only)) {
  for (const strat of strategies) console.log(`${r.name} ${strat.padEnd(8)} ${run(r.id, strat)}`);
}
