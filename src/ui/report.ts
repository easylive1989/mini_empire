import type { MvpRecord, SourceStats, StrengthSample } from '../game/battle';
import { BUILDINGS, getUnit, UNITS } from '../game/data/index';
import { h } from './dom';
import { icon } from './icons';

/** Epithets that name a wave's best soldier, picked by its id. */
const CALLSIGNS = ['疾風', '鐵壁', '獵鷹', '雷霆', '銀刃', '赤焰', '磐石', '夜梟', '破曉', '怒濤', '寒星', '蒼狼', '金獅', '青嵐', '白鷺', '流星', '烈陽', '霜牙', '長虹', '鐵砧', '飛燕', '孤狼', '落雷', '鳴鏑'];

export function callsign(id: number): string {
  return CALLSIGNS[(Math.imul(id, 2654435761) >>> 0) % CALLSIGNS.length];
}

/** Display name of a damage source: a unit, a building or the castle. */
export function sourceName(key: string): string {
  if (key === 'castle') return '主堡';
  return BUILDINGS.get(key)?.name ?? UNITS.get(key)?.name ?? key;
}

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Army strength over a wave: our soldiers and towers (green) against the enemies on the field (red),
 * the castle's health as a thin brass line along the top.
 */
export function strengthChart(timeline: StrengthSample[], width = 268, height = 70): HTMLElement {
  const wrap = h('div', { class: 'chart' });
  if (timeline.length < 2) return wrap;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, preserveAspectRatio: 'none', role: 'img', 'aria-label': '雙方戰力變化' }) as SVGSVGElement;
  const maxT = timeline[timeline.length - 1].t || 1;
  const maxV = Math.max(1, ...timeline.map((p) => Math.max(p.ours, p.theirs)));
  const top = 8;
  const x = (t: number) => ((t / maxT) * width).toFixed(1);
  const y = (v: number) => (height - (v / maxV) * (height - top - 2)).toFixed(1);
  for (const [key, cls] of [['theirs', 'theirs'], ['ours', 'ours']] as const) {
    const line = timeline.map((p) => `${x(p.t)},${y(p[key])}`).join(' ');
    svg.append(svgEl('polygon', { points: `0,${height} ${line} ${width},${height}`, class: `area ${cls}` }));
    svg.append(svgEl('polyline', { points: line, class: `line ${cls}` }));
  }
  const castle = timeline.map((p) => `${x(p.t)},${(1 + (1 - p.castle) * (top - 2)).toFixed(1)}`).join(' ');
  svg.append(svgEl('polyline', { points: castle, class: 'line castle' }));
  wrap.append(
    svg,
    h(
      'div',
      { class: 'chart-legend' },
      h('span', { class: 'ours' }, '我軍'),
      h('span', { class: 'theirs' }, '敵軍'),
      h('span', { class: 'castle' }, '主堡'),
      h('em', { class: 'num' }, clock(maxT)),
    ),
  );
  return wrap;
}

/** The sources that did the most damage, as bars relative to the best one. */
export function damageRows(sources: ({ key: string } & SourceStats)[], limit = 4): HTMLElement {
  const top = sources.slice(0, limit);
  const best = Math.max(1, top[0]?.damage ?? 1);
  const total = Math.max(1, sources.reduce((s, x) => s + x.damage, 0));
  return h(
    'div',
    { class: 'dmg-rows' },
    top.map((s) =>
      h(
        'div',
        { class: 'dmg-row' },
        h('div', { class: 'kv' }, h('span', {}, sourceName(s.key)), h('span', { class: 'num' }, `${Math.round((s.damage / total) * 100)}%`, h('em', {}, `・擊殺 ${s.kills}`))),
        h('div', { class: 'meter thin' }, h('i', { style: `width:${(s.damage / best) * 100}%` })),
      ),
    ),
  );
}

/** The wave's best soldier, with a callsign. */
export function mvpCard(mvp: MvpRecord): HTMLElement {
  const u = getUnit(mvp.unitId);
  return h(
    'div',
    { class: 'mvp-card' },
    h('span', { class: 'mvp-ico' }, icon('medal', 20, { strokeWidth: 1.6 })),
    h('span', {}, h('small', {}, '本波 MVP'), h('b', {}, `「${callsign(mvp.id)}」${u.name}`), h('em', {}, `擊殺 ${mvp.kills} 名敵人`)),
  );
}
