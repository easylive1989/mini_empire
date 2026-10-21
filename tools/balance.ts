// Headless balance check: the bot plays every race through the campaign.
// Usage: npm run balance [-- seeds]
import { simulateBattle } from '../src/game/battle';
import { botPrepare } from '../src/game/bot';
import { FINAL_WAVE } from '../src/game/constants';
import { RACES } from '../src/game/data/index';
import { DIFFICULTY } from '../src/game/data/waves';
import { applyBattleOutcome, castleMaxHp, chooseBoon, newGame } from '../src/game/state';

const seeds = Number(process.argv[2] ?? 3);
const verbose = process.argv.includes('-v');
for (const key of Object.keys(DIFFICULTY) as (keyof typeof DIFFICULTY)[]) {
  const env = process.env[key];
  if (env) (DIFFICULTY as Record<string, number>)[key] = Number(env);
}
console.log('difficulty', DIFFICULTY);

const only = process.env.RACE;
for (const race of RACES.filter((r) => !only || r.id === only)) {
  const reached: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const state = newGame(race.id, seed * 1013);
    const plan = { n: 0 };
    const log: string[] = [];
    while (state.phase !== 'over' && state.wave <= FINAL_WAVE + 10) {
      if (state.phase === 'victory') state.endless = true;
      if (state.phase === 'boon') chooseBoon(state, state.boonChoices[0]);
      botPrepare(state, plan);
      state.phase = 'battle';
      const battle = simulateBattle(state);
      const hpBefore = state.castleHp;
      const out = battle.outcome();
      const players = battle.entities.filter((e) => e.baseTeam === 'player').length;
      applyBattleOutcome(state, out);
      log.push(
        `w${String(out.won ? state.wave - 1 : state.wave).padStart(2)} t=${battle.time.toFixed(0).padStart(3)}s castle ${hpBefore}->${out.castleHp}/${castleMaxHp(state)} gold=${state.gold} L${state.castleLevel} units=${players} kills=${out.kills}`,
      );
    }
    reached.push(state.phase === 'over' ? state.wave : state.wave - 1);
    if (verbose && seed === 1) console.log(`--- ${race.name}\n` + log.join('\n'));
  }
  console.log(`${race.name.padEnd(4)} reached waves: ${reached.join(', ')}`);
}
