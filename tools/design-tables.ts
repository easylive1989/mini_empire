// Prints the unit / building / monster tables used in docs/DESIGN.md from the game data.
// Usage: npx vite-node tools/design-tables.ts > /tmp/tables.md
import { BOONS } from '../src/game/data/boons';
import { getUnit, RACES, raceBuildings, raceUnits, UNITS } from '../src/game/data/index';
import type { UnitDef } from '../src/game/types';

const pct = (x?: number) => (x ? `${Math.round(x * 100)}%` : '—');
const KIND = { resource: '資源', tower: '防禦塔', barracks: '兵營' } as const;

function unitRow(u: UnitDef): string {
  const dmg = `${u.damage}${u.damageType === 'magic' ? '（魔）' : ''}`;
  const tags = [u.canHitAir ? '對空' : '', u.flying ? '飛行' : '', u.splash ? '範圍' : ''].filter(Boolean).join('、');
  return `| ${u.name} | ${u.role} | ${u.hp} | ${dmg} / ${u.attackInterval}s | ${u.range} | ${pct(u.armor)} | ${tags || '—'} | ${u.desc} |`;
}

for (const r of RACES) {
  console.log(`### ${r.name}・${r.title}\n`);
  console.log(`${r.desc}\n`);
  console.log(`- **種族特性・${r.passive.name}**：${r.passive.desc}`);
  for (const s of r.synergies) console.log(`- **協同・${s.name}**：${s.desc}`);
  console.log('\n| 兵種 | 定位 | 生命 | 攻擊 / 間隔 | 射程 | 護甲 | 特性 | 說明 |\n| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const u of raceUnits(r.id)) console.log(unitRow(u));
  console.log('\n| 建築 | 類型 | 主堡等級 | 費用 | 說明 |\n| --- | --- | --- | --- | --- |');
  for (const b of raceBuildings(r.id)) {
    let extra = '';
    if (b.kind === 'barracks') extra = `（${getUnit(b.unit!).name}・出兵 ${b.spawnInterval!.join('/')} 秒・上限 ${b.maxAlive!.join('/')}）`;
    if (b.kind === 'tower') extra = `（傷害 ${b.tower!.damage.join('/')}・射程 ${b.tower!.range}）`;
    if (b.kind === 'resource') extra = `（產量 ${b.income!.join('/')}）`;
    console.log(`| ${b.name} | ${KIND[b.kind]} | ${b.castleLevel} | ${b.cost} | ${b.desc}${extra} |`);
  }
  console.log('');
}

console.log('### 亡靈軍團\n\n| 怪物 | 定位 | 生命 | 攻擊 / 間隔 | 射程 | 護甲 | 特性 | 說明 |\n| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const u of UNITS.values()) if (u.race === 'monster') console.log(unitRow(u));

console.log('\n### 祝福\n\n| 祝福 | 限定 | 效果 |\n| --- | --- | --- |');
for (const b of BOONS) console.log(`| ${b.name} | ${b.race ? RACES.find((r) => r.id === b.race)!.name : '通用'} | ${b.desc} |`);
