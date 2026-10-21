// Measures how much stronger a wave could be before the bot's defence breaks.
// Usage: npx vite-node tools/margin.ts   (env RACE=elf to filter)
import { simulateBattle } from '../src/game/battle';
import { botPrepare } from '../src/game/bot';
import { RACES } from '../src/game/data/index';
import { DIFFICULTY } from '../src/game/data/waves';
import { applyBattleOutcome, chooseBoon, newGame, type GameState } from '../src/game/state';

const CHECKPOINTS = [2, 4, 6, 8, 10, 13, 16, 20, 23, 26, 29, 30];
const base = DIFFICULTY.base;

function clone(s: GameState): GameState {
  return structuredClone(s);
}

function survives(s: GameState, mult: number): boolean {
  DIFFICULTY.base = base * mult;
  const st = clone(s);
  st.castleHp = Math.max(st.castleHp, 1);
  const b = simulateBattle(st);
  DIFFICULTY.base = base;
  return b.result === 'win';
}

function margin(s: GameState): number {
  let lo = 0.25;
  let hi = 6;
  if (!survives(s, lo)) return 0;
  if (survives(s, hi)) return hi;
  for (let k = 0; k < 7; k++) {
    const mid = Math.sqrt(lo * hi);
    if (survives(s, mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const only = process.env.RACE;
for (const race of RACES.filter((r) => !only || r.id === only)) {
  const out: string[] = [];
  const state = newGame(race.id, 1013);
  const plan = { n: 0 };
  while (state.wave <= 30 && state.phase !== 'over') {
    if (state.phase === 'boon') chooseBoon(state, state.boonChoices[0]);
    botPrepare(state, plan);
    state.phase = 'battle';
    if (CHECKPOINTS.includes(state.wave)) out.push(`w${state.wave}:${margin(state).toFixed(2)}`);
    const b = simulateBattle(state);
    applyBattleOutcome(state, b.outcome());
    if ((state.phase as string) === 'victory') break;
  }
  console.log(race.name.padEnd(4), out.join('  '), state.phase === 'over' ? `(lost at ${state.wave})` : '');
}
