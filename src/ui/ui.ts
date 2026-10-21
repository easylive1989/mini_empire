import { waveForState, type Battle } from '../game/battle';
import { campaignPerkDefs } from '../game/campaign/campaign';
import { getCampaignWave } from '../game/campaign/campaignWaves';
import { LORE } from '../game/campaign/story';
import { TERRAINS } from '../game/campaign/terrain';
import { getTerritory } from '../game/campaign/territories';
import { BOSS_WAVES, CASTLE, FINAL_WAVE, MAX_BUILDING_LEVEL, UNIT_LEVEL_MULT } from '../game/constants';
import { BOON_MAP } from '../game/data/boons';
import { FACTIONS } from '../game/data/factions';
import { BUILDINGS, getBuilding, getUnit, RACE_MAP, RACES, raceBuildings, raceUnits } from '../game/data/index';
import { getWave } from '../game/data/waves';
import {
  availableBuildings,
  buildCost,
  buildingIncome,
  canBuild,
  canExpand,
  canUpgrade,
  canUpgradeCastle,
  castleIncome,
  castleMaxHp,
  castleUpgradeCost,
  demolishRefund,
  expansionCap,
  fullRepairCost,
  getModifiers,
  isCastleTile,
  isExpandable,
  projectedIncome,
  tileAt,
  tileBonuses,
  type GameState,
} from '../game/state';
import type { BuildingDef, BuildingKind, RaceId, UnitDef } from '../game/types';
import { RACE_MASCOT } from '../render/portraits';
import { coin, h } from './dom';
import { coinIcon, crest, icon, type IconName } from './icons';

const KIND_LABEL: Record<Exclude<BuildingKind, 'castle'>, string> = { resource: '資源', tower: '防禦塔', support: '支援', barracks: '兵營' };

type BuildTab = 'all' | 'resource' | 'tower' | 'barracks' | 'special';
const BUILD_TABS: [BuildTab, string][] = [
  ['all', '全部'],
  ['resource', '資源'],
  ['tower', '防禦'],
  ['barracks', '兵營'],
  ['special', '特殊'],
];

export interface Selection {
  i: number;
  j: number;
}

export interface UiActions {
  previewRace(race: RaceId): void;
  startGame(race: RaceId): void;
  build(defId: string): void;
  upgrade(): void;
  demolish(): void;
  expand(): void;
  upgradeCastle(): void;
  repairCastle(): void;
  startWave(): void;
  setSpeed(speed: number): void;
  chooseBoon(id: string): void;
  backToTitle(): void;
  continueEndless(): void;
  toggleMusic(): boolean;
  toggleSfx(): boolean;
  /** Flips 效能模式 and returns whether it is now on. */
  toggleQuality(): boolean;
  deselect(): void;
  /** Campaign levels: give up and return to the world map. */
  retreat(): void;
  retry(): void;
  backToMap(): void;
}

export interface AudioState {
  music: boolean;
  sfx: boolean;
}

function unitTags(u: UnitDef): string[] {
  const tags: string[] = [];
  if (u.boss) tags.push('首領');
  if (u.flying) tags.push('飛行');
  if ((u.armor ?? 0) >= 0.4) tags.push('重甲');
  if (u.traits?.some((t) => t.type === 'siege')) tags.push('攻城');
  if (u.traits?.some((t) => t.type === 'summon')) tags.push('召喚');
  if (u.traits?.some((t) => t.type === 'selfDestruct')) tags.push('自爆');
  if (u.projectile) tags.push(u.damageType === 'magic' ? '法術' : '遠程');
  if (u.speed >= 4) tags.push('快速');
  if (u.ai === 'aggressive') tags.push('衝鋒型');
  return tags;
}

const ENEMY_COLORS: Record<string, string> = {
  m_minion: '#d6d3d1',
  m_rogue: '#a3e635',
  m_crossbow: '#fbbf24',
  m_warrior: '#94a3b8',
  m_ghost: '#67e8f9',
  m_bloater: '#84cc16',
  m_mage: '#fb923c',
  m_necromancer: '#c084fc',
  m_brute: '#d97706',
  m_darkknight: '#7c3aed',
  m_skeleton_king: '#facc15',
  m_lich: '#a855f7',
  m_deathknight: '#ef4444',
  g_troll: '#2dd4bf',
  g_thief: '#facc15',
};

/** Fallback dot colours for the campaign factions, by unit id prefix. */
const FACTION_DOT: Record<string, string> = { g_: '#84cc16', o_: '#d97706', r_: '#f87171', b_: '#ef4444', sp: '#60a5fa' };
const enemyColor = (u: UnitDef) => (u.boss ? '#c8452f' : (ENEMY_COLORS[u.id] ?? FACTION_DOT[u.id.slice(0, 2)] ?? '#aaa'));

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** First sentence of a description, for compact rows. */
function firstClause(text: string): string {
  const i = text.indexOf('。');
  return i > 0 ? text.slice(0, i) : text;
}

/** Adds the brass corner brackets of the ornate modal frame. */
export function ornate<T extends HTMLElement>(el: T): T {
  for (const c of ['tl', 'tr', 'bl', 'br']) el.append(h('span', { class: `corner ${c}`, 'aria-hidden': 'true' }));
  return el;
}

/** Round emblem that crowns a result modal. */
export function medallion(name: IconName, tone: 'gold' | 'crimson' | 'race' = 'gold'): HTMLElement {
  return h('div', { class: `medallion ${tone}` }, icon(name, 38));
}

export class Ui {
  private readonly top = h('div', { class: 'topbar hidden' });
  private readonly left = h('div', { class: 'panel left hidden' });
  private readonly right = h('div', { class: 'panel right hidden' });
  private readonly bottom = h('div', { class: 'bottombar hidden' });
  private readonly bossBar = h('div', { class: 'boss-bar hidden', role: 'status' });
  private readonly overlay = h('div', { class: 'overlay hidden' });
  private readonly toasts = h('div', { class: 'toast-area' });
  private readonly tooltip = h('div', { class: 'tooltip hidden' });
  private readonly loading = h('div', { class: 'loading' });
  private titleRace: RaceId = 'human';
  private titleMode: 'campaign' | 'classic' = 'campaign';
  private speed = 1;
  private buildTab: BuildTab = 'all';
  private mouse = { x: -1000, y: -1000 };
  audio: AudioState = { music: true, sfx: true };
  lowQuality = false;
  /** Rendered portraits of each race's mascot unit for the race picker. */
  portraits = new Map<RaceId, string>();
  /** Rendered building pictures for the build list and building panels. */
  thumbs: { get(defId: string, race: RaceId): string | undefined } | null = null;
  /** Live battle readouts refreshed by updateBattle(). */
  private live: {
    allies?: HTMLElement;
    enemies?: HTMLElement;
    kills?: HTMLElement;
    bonuses?: HTMLElement;
    hpFill?: HTMLElement;
    hpText?: HTMLElement;
    rows: Map<string, { count: HTMLElement; fill: HTMLElement; total: number }>;
  } = { rows: new Map() };

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: UiActions,
  ) {
    root.append(this.top, this.left, this.right, this.bottom, this.bossBar, this.overlay, this.toasts, this.tooltip, this.loading);
    document.addEventListener('mousemove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (!this.tooltip.classList.contains('hidden')) this.placeTip();
    });
  }

  /** Free screen area the 3D view should frame. */
  get insets() {
    const inGame = !this.left.classList.contains('hidden');
    return inGame ? { left: 336, right: 332, top: 80, bottom: 100 } : { left: 40, right: 40, top: 40, bottom: 40 };
  }

  // ---------------------------------------------------------------- loading & toasts

  setLoading(done: number, total: number): void {
    this.loading.replaceChildren(
      h('div', { class: 'loading-logo' }, '迷你帝國'),
      h('div', { class: 'meter gold' }, h('i', { style: `width:${(done / total) * 100}%` })),
      h('div', { class: 'muted' }, `載入素材中… ${done} / ${total}`),
    );
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  toast(msg: string, kind: 'bad' | 'good' | '' = '', ms = 2200): void {
    const t = h('div', { class: `toast ${kind}` }, msg);
    this.toasts.append(t);
    setTimeout(() => t.remove(), ms);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
  }

  banner(text: string, sub = ''): void {
    const b = h('div', { class: 'banner' }, text, sub ? h('small', {}, sub) : null);
    this.root.append(b);
    setTimeout(() => b.remove(), 2500);
  }

  private placeTip(): void {
    const x = Math.min(this.mouse.x + 16, window.innerWidth - 320);
    const y = Math.min(this.mouse.y + 12, window.innerHeight - this.tooltip.offsetHeight - 10);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${y}px`;
  }

  private tip(el: HTMLElement, html: () => string): HTMLElement {
    el.addEventListener('mouseenter', () => {
      this.tooltip.innerHTML = html();
      this.tooltip.classList.remove('hidden');
      this.placeTip();
    });
    el.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
    return el;
  }

  private hideTip(): void {
    this.tooltip.classList.add('hidden');
  }

  private openOverlay(content: HTMLElement, cls = ''): void {
    this.overlay.className = `overlay ${cls}`.trim();
    this.overlay.replaceChildren(content);
  }

  // ---------------------------------------------------------------- race selection

  /** Race selection: for a new campaign, or for the unlocked classic mode. */
  showTitle(race: RaceId = this.titleRace, mode: 'campaign' | 'classic' = this.titleMode): void {
    this.titleRace = race;
    this.titleMode = mode;
    for (const p of [this.top, this.left, this.right, this.bottom, this.bossBar]) p.classList.add('hidden');
    const r = RACE_MAP.get(race)!;
    const lore = LORE[race];
    const roster: [string, string][] = [
      ...raceUnits(race).map((u): [string, string] => [u.name, u.role]),
      ...raceBuildings(race)
        .filter((b) => b.kind === 'tower')
        .map((b): [string, string] => [b.name, '防禦塔']),
    ];
    const screen = h(
      'div',
      { class: 'race-screen' },
      h(
        'header',
        { class: 'rs-head' },
        h('div', { class: 'eyebrow wide' }, mode === 'campaign' ? '開始新戰役' : '無盡挑戰'),
        h('h1', {}, '選擇你的王國'),
        h(
          'p',
          {},
          mode === 'campaign'
            ? '王子將帶領哪一族的子民收復失土？種族決定整場戰役能使用的兵種與建築。'
            : '經典模式：在九宮格領地上抵禦一波波的亡靈大軍，撐過 30 波即可獲勝。',
        ),
      ),
      h(
        'div',
        { class: 'race-row', role: 'radiogroup', 'aria-label': '種族' },
        RACES.map((rc) => {
          const selected = rc.id === race;
          const portrait = this.portraits.get(rc.id);
          const mascot = getUnit(RACE_MASCOT[rc.id]).name;
          return h(
            'button',
            {
              class: `race-card ${selected ? 'selected' : ''}`,
              role: 'radio',
              'aria-checked': String(selected),
              style: `--c:${rc.color}`,
              onclick: () => {
                this.actions.previewRace(rc.id);
                this.showTitle(rc.id);
              },
            },
            h('span', { class: 'plinth' }),
            portrait ? h('img', { src: portrait, alt: mascot, draggable: 'false' }) : h('span', { class: 'orb' }),
            h('span', { class: 'rname' }, rc.name),
            h('span', { class: 'rtitle' }, `${rc.title}・${mascot}`),
            selected ? h('span', { class: 'race-check' }, icon('check', 15, { strokeWidth: 3 })) : null,
          );
        }),
      ),
      h(
        'section',
        { class: 'race-info', style: `--c:${r.color}`, 'aria-label': '種族詳情' },
        h(
          'div',
          { class: 'ri-col' },
          h('h2', {}, `${r.name}・${r.title}`),
          mode === 'campaign' ? h('div', { class: 'ri-lore' }, `${lore.kingdom}・${lore.prince}`) : null,
          h('p', {}, r.desc),
          h(
            'ul',
            { class: 'proscons' },
            r.strengths.map((s) => h('li', { class: 'pro' }, icon('plus', 14, { strokeWidth: 2.6 }), s)),
            r.weaknesses.map((s) => h('li', { class: 'con' }, icon('minus', 14, { strokeWidth: 2.6 }), s)),
          ),
        ),
        h(
          'div',
          { class: 'ri-col ruled' },
          h('div', { class: 'eyebrow' }, '種族特性'),
          h('h3', {}, r.passive.name),
          h('p', {}, r.passive.desc),
          h('div', { class: 'eyebrow' }, '招牌協同'),
          h('h3', {}, r.synergies[0].name),
          h('p', {}, r.synergies[0].desc),
        ),
        h(
          'div',
          { class: 'ri-col ruled' },
          h('div', { class: 'eyebrow' }, '兵種與防禦塔'),
          h(
            'div',
            { class: 'roster' },
            roster.map(([name, role]) => h('div', {}, h('b', {}, name), h('span', {}, role))),
          ),
        ),
      ),
      h(
        'footer',
        { class: 'rs-foot' },
        h('button', { class: 'btn ghost-btn', onclick: () => this.actions.backToTitle() }, icon('back', 18), '返回標題'),
        h(
          'div',
          { class: 'rs-go' },
          mode === 'campaign' ? h('span', { class: 'muted' }, '接著播放開場動畫（可跳過）') : null,
          h(
            'button',
            { class: 'btn primary big', onclick: () => this.actions.startGame(race) },
            mode === 'campaign' ? `以${r.name}展開復國之戰` : `以${r.name}開始遊戲`,
            icon('next', 20, { strokeWidth: 2.4 }),
          ),
        ),
      ),
    );
    this.openOverlay(screen, 'race-overlay');
  }

  /** Hides the in-game HUD panels and any modal. */
  hideHud(): void {
    for (const p of [this.top, this.left, this.right, this.bottom, this.bossBar]) p.classList.add('hidden');
    this.closeOverlay();
  }

  closeOverlay(): void {
    this.overlay.className = 'overlay hidden';
    this.overlay.replaceChildren();
  }

  // ---------------------------------------------------------------- main HUD

  render(state: GameState, sel: Selection | null, battle: Battle | null): void {
    this.hideTip();
    for (const p of [this.top, this.left, this.right, this.bottom]) p.classList.remove('hidden');
    document.documentElement.style.setProperty('--race', RACE_MAP.get(state.race)!.color);
    this.live = { rows: new Map() };
    this.renderTop(state);
    this.renderLeft(state, sel, battle);
    this.renderRight(state, battle);
    this.renderBottom(state, battle);
    if (battle) this.updateBattle(battle);
    else this.bossBar.classList.add('hidden');
  }

  private renderTop(state: GameState): void {
    const r = RACE_MAP.get(state.race)!;
    const max = castleMaxHp(state);
    const ratio = state.castleHp / max;
    this.live.hpFill = h('i', { style: `width:${ratio * 100}%` });
    this.live.hpText = h('span', { class: 'num' }, `${Math.round(state.castleHp)} / ${max}`);
    this.top.replaceChildren(
      h('div', { class: 'hud-crest' }, crest(r.color, 26), h('div', {}, h('b', {}, r.name), h('small', {}, `${r.castleName} Lv.${state.castleLevel}`))),
      h('div', { class: 'gold-pill', title: '金幣' }, coinIcon(20), h('span', { class: 'num' }, String(state.gold))),
      h(
        'div',
        { class: 'hp' },
        h('div', { class: 'hp-row' }, h('span', {}, '主堡生命'), this.live.hpText),
        h('div', { class: `meter ${ratio < 0.35 ? 'low' : ''}` }, this.live.hpFill),
      ),
      this.waveHeader(state),
      h(
        'div',
        { class: 'hud-actions' },
        ...this.toggleButtons(),
        this.iconButton('help', '說明', () => this.showHelp(!!state.level)),
        state.level && state.phase === 'prep'
          ? h('button', { class: 'icon-btn text warn', onclick: () => this.confirmRetreat() }, icon('flag', 16, { strokeWidth: 2 }), '撤退')
          : null,
      ),
    );
  }

  /** Territory/wave title with wave pips in the middle of the top bar. */
  private waveHeader(state: GameState): HTMLElement {
    const wave = waveForState(state);
    if (state.level) {
      const t = getTerritory(state.level.territoryId);
      const total = state.level.totalWaves;
      const current = Math.min(state.wave, total);
      const sub = state.phase === 'battle' && current === total ? '最終波' : t.faction ? `${FACTIONS[t.faction].name}佔領` : '';
      return h(
        'div',
        { class: 'hud-center' },
        h('div', { class: 'hud-title' }, state.level.name, sub ? h('small', {}, `・${sub}`) : null),
        h(
          'div',
          { class: 'pips', role: 'img', 'aria-label': `第 ${current} 波，共 ${total} 波` },
          Array.from({ length: total }, (_, k) => h('span', { class: k + 1 < current ? 'done' : k + 1 === current ? 'cur' : k + 1 === total ? 'boss' : '' })),
          h('span', { class: 'pip-count num' }, String(current), h('em', {}, ` / ${total}`)),
        ),
      );
    }
    const text = state.wave > FINAL_WAVE ? `無盡模式・第 ${state.wave} 波` : `第 ${state.wave} / ${FINAL_WAVE} 波`;
    return h('div', { class: 'hud-center' }, h('div', { class: 'hud-title' }, text), h('div', { class: 'hud-sub' }, wave.title ?? '亡靈來襲'));
  }

  private iconButton(name: IconName, label: string, onclick: () => void): HTMLElement {
    return h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick }, icon(name, 18));
  }

  /** Music, sound-effect and 效能模式 toggles. */
  toggleButtons(): HTMLElement[] {
    const make = (kind: 'music' | 'sfx') => {
      const on = () => (kind === 'music' ? this.audio.music : this.audio.sfx);
      const label = kind === 'music' ? '背景音樂' : '音效';
      const btn = h('button', { class: 'icon-btn', title: label });
      const paint = () => {
        btn.replaceChildren(icon(kind === 'music' ? (on() ? 'music' : 'musicOff') : on() ? 'sound' : 'soundOff', 18));
        btn.classList.toggle('off', !on());
        btn.setAttribute('aria-label', `${label}：${on() ? '開' : '關'}`);
      };
      btn.addEventListener('click', () => {
        if (kind === 'music') this.audio.music = this.actions.toggleMusic();
        else this.audio.sfx = this.actions.toggleSfx();
        paint();
      });
      paint();
      return btn;
    };
    const quality = h('button', { class: 'icon-btn', 'data-quality': '' }, icon('gauge', 18));
    quality.addEventListener('click', () => {
      this.lowQuality = this.actions.toggleQuality();
      this.toast(this.lowQuality ? '效能模式：開（降低畫質換取流暢度）' : '效能模式：關（高畫質）');
    });
    this.paintQuality(quality);
    return [make('music'), make('sfx'), quality];
  }

  private paintQuality(btn: Element): void {
    const label = `效能模式：${this.lowQuality ? '開' : '關'}`;
    btn.classList.toggle('on', this.lowQuality);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(this.lowQuality));
  }

  /** Refresh every 效能模式 button on screen (title, map and battle bars). */
  paintQualityButtons(): void {
    document.querySelectorAll('[data-quality]').forEach((b) => this.paintQuality(b));
  }

  private confirmRetreat(): void {
    const modal = ornate(
      h(
        'div',
        { class: 'modal narrow center', role: 'dialog' },
        medallion('flag', 'crimson'),
        h('h1', {}, '撤退？'),
        h('p', { class: 'subtitle' }, '放棄這場戰鬥並返回世界地圖。這塊領地之後仍可再次進攻。'),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn danger', onclick: () => this.actions.retreat() }, '撤退回地圖'), h('button', { class: 'btn', onclick: () => this.closeOverlay() }, '繼續作戰')),
      ),
    );
    this.openOverlay(modal);
  }

  private renderBottom(state: GameState, battle: Battle | null): void {
    if (battle) {
      this.bottom.replaceChildren(
        h(
          'div',
          { class: 'speed-bar' },
          h(
            'div',
            { class: 'speed-opts', role: 'radiogroup', 'aria-label': '戰鬥速度' },
            [1, 2, 4].map((s) =>
              h(
                'button',
                {
                  class: s === this.speed ? 'on' : '',
                  role: 'radio',
                  'aria-checked': String(s === this.speed),
                  onclick: () => {
                    this.speed = s;
                    this.actions.setSpeed(s);
                    this.renderBottom(state, battle);
                  },
                },
                `${s}x`,
              ),
            ),
          ),
          h('span', { class: 'muted small' }, '鍵盤 1 / 2 / 3'),
        ),
      );
    } else if (state.phase === 'prep') {
      const w = waveForState(state);
      this.bottom.replaceChildren(
        h(
          'button',
          { class: 'start-btn', onclick: () => this.actions.startWave() },
          h('b', {}, icon('swords', 20, { strokeWidth: 2.2 }), `開始第 ${state.wave} 波`),
          h('small', {}, w.boss ? '首領來襲！' : '準備好了就按 空白鍵'),
        ),
      );
    } else {
      this.bottom.replaceChildren();
    }
  }

  setSpeedLabel(speed: number): void {
    this.speed = speed;
  }

  /** Cheap refresh of live battle numbers (called a few times per second). */
  updateBattle(battle: Battle): void {
    const L = this.live;
    if (L.allies) L.allies.textContent = String(battle.entities.filter((e) => e.alive && e.team === 'player').length);
    if (L.enemies) L.enemies.textContent = String(battle.entities.filter((e) => e.alive && e.baseTeam === 'enemy').length + battle.pendingSpawns);
    if (L.kills) L.kills.textContent = String(battle.kills);
    if (L.hpFill && L.hpText) {
      const c = battle.castle;
      L.hpFill.style.width = `${(Math.max(0, c.hp) / c.maxHp) * 100}%`;
      L.hpFill.parentElement?.classList.toggle('low', c.hp / c.maxHp < 0.35);
      L.hpText.textContent = `${Math.max(0, Math.round(c.hp))} / ${c.maxHp}`;
    }
    if (L.bonuses) {
      const lines: [string, string][] = [];
      if (battle.mods.combinedArms > 0) lines.push(['聯合兵種', `+${pct(battle.combinedArmsBonus)}`]);
      if (battle.bannerDmg > 0) lines.push(['先王紀念碑', `+${pct(battle.bannerDmg)}`]);
      L.bonuses.replaceChildren(
        ...(lines.length ? lines.map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('b', { class: 'num good' }, v))) : [h('div', { class: 'muted small' }, '目前沒有啟動中的加成')]),
      );
    }
    if (L.rows.size) {
      const left = battle.remainingEnemies();
      for (const [id, row] of L.rows) {
        const n = left.get(id) ?? 0;
        row.count.textContent = String(n);
        row.fill.style.width = `${(n / row.total) * 100}%`;
      }
    }
    this.updateBossBar(battle);
  }

  private updateBossBar(battle: Battle): void {
    const boss = battle.boss;
    if (!boss) {
      this.bossBar.classList.add('hidden');
      return;
    }
    const enrage = boss.def.traits?.find((t) => t.type === 'enrage') as { threshold: number } | undefined;
    const ratio = Math.max(0, boss.hp) / boss.maxHp;
    const note = enrage ? (boss.enraged ? '已狂暴！傷害與攻速大增' : `▲ ${pct(enrage.threshold)}：狂暴`) : '';
    this.bossBar.classList.remove('hidden');
    this.bossBar.replaceChildren(
      h('div', { class: 'boss-name' }, h('span', { class: 'eyebrow' }, '首領'), boss.def.name),
      h(
        'div',
        { class: `boss-meter ${boss.enraged ? 'enraged' : ''}` },
        h('i', { style: `width:${ratio * 100}%` }),
        enrage && !boss.enraged ? h('span', { class: 'boss-mark', style: `left:${enrage.threshold * 100}%` }) : null,
      ),
      h('div', { class: 'boss-foot' }, h('span', { class: boss.enraged ? 'bad' : 'warn' }, note), h('span', { class: 'num' }, `${Math.round(boss.hp).toLocaleString('en-US')} / ${Math.round(boss.maxHp).toLocaleString('en-US')}`)),
    );
  }

  // ---------------------------------------------------------------- left panel

  private renderLeft(state: GameState, sel: Selection | null, battle: Battle | null): void {
    const el = this.left;
    el.classList.toggle('compact', !!battle);
    if (battle) {
      this.live.allies = h('b', { class: 'num' }, '0');
      this.live.enemies = h('b', { class: 'num' }, '0');
      this.live.kills = h('b', { class: 'num' }, '0');
      this.live.bonuses = h('div', { class: 'kv-list' });
      el.replaceChildren(
        h(
          'div',
          { class: 'tiles three' },
          h('div', { class: 'tile good' }, this.live.allies, h('small', {}, '我軍')),
          h('div', { class: 'tile bad' }, this.live.enemies, h('small', {}, '敵軍')),
          h('div', { class: 'tile' }, this.live.kills, h('small', {}, '擊殺')),
        ),
        h('div', { class: 'sec-title' }, h('span', {}, '即時加成')),
        this.live.bonuses,
        h('p', { class: 'muted small' }, '被摧毀的建築戰後自動修復；主堡的損傷會保留。'),
      );
      return;
    }
    if (state.phase !== 'prep') {
      el.replaceChildren();
      return;
    }
    if (!sel) {
      el.replaceChildren(
        h('div', { class: 'p-head' }, h('h2', {}, '建造')),
        h(
          'div',
          { class: 'guide' },
          h('div', {}, icon('plus', 18), h('span', {}, '點選空地建造建築')),
          h('div', {}, icon('up', 18), h('span', {}, '點選建築升級或拆除')),
          h('div', {}, icon('castle', 18), h('span', {}, '點選主堡升級或修復')),
          h('div', {}, icon('flag', 18), h('span', {}, '點選外圍土地擴張領地')),
        ),
        h('p', { class: 'muted small' }, h('span', { class: 'kbd' }, 'Esc'), ' 取消選取・', h('span', { class: 'kbd' }, 'U'), ' 升級選取的建築'),
      );
      return;
    }
    const tile = tileAt(state, sel.i, sel.j)!;
    if (isCastleTile(sel.i, sel.j)) el.replaceChildren(...this.castlePanel(state));
    else if (tile.building) el.replaceChildren(...this.buildingPanel(state, sel));
    else if (tile.owned) el.replaceChildren(...this.buildPanel(state, sel));
    else if (isExpandable(state, sel.i, sel.j)) el.replaceChildren(...this.expandPanel(state, sel));
    else el.replaceChildren(h('div', { class: 'p-head' }, h('h2', {}, '荒野')), h('div', { class: 'hint' }, '這塊土地離領地太遠，先擴張相鄰的土地。'));
  }

  private buildPanel(state: GameState, sel: Selection): Node[] {
    const all = availableBuildings(state);
    // Only what can be built now: castle-level locks and specials already placed stay out of the list.
    const buildable = all.filter((b) => b.castleLevel <= state.castleLevel && !(b.campaignOnly && state.tiles.some((t) => t.building?.defId === b.id)));
    const hasSpecials = buildable.some((b) => b.campaignOnly);
    if (this.buildTab === 'special' && !hasSpecials) this.buildTab = 'all';
    const tab = this.buildTab;
    const inTab = (b: BuildingDef) => (tab === 'all' ? true : tab === 'special' ? !!b.campaignOnly : !b.campaignOnly && (b.kind === tab || (tab === 'tower' && b.kind === 'support')));
    const shown = buildable.filter(inTab);
    const front = sel.i === Math.max(...state.tiles.filter((t) => t.owned).map((t) => t.i));
    const nextLevel = Math.min(...all.filter((b) => b.castleLevel > state.castleLevel).map((b) => b.castleLevel));
    const upcoming = Number.isFinite(nextLevel) ? all.filter((b) => b.castleLevel === nextLevel) : [];
    return [
      h(
        'div',
        { class: 'p-head row' },
        h('div', {}, h('h2', {}, '建造'), h('div', { class: 'muted small' }, `空地 (${sel.i}, ${sel.j})`)),
        front ? h('span', { class: 'tag front' }, '最前線・最先挨打') : null,
      ),
      h(
        'div',
        { class: 'tabs', role: 'tablist', 'aria-label': '建築類型' },
        BUILD_TABS.filter(([id]) => id !== 'special' || hasSpecials).map(([id, label]) =>
          h(
            'button',
            {
              class: id === tab ? 'on' : '',
              role: 'tab',
              'aria-selected': String(id === tab),
              onclick: () => {
                this.buildTab = id;
                this.renderLeft(state, sel, null);
              },
            },
            label,
          ),
        ),
      ),
      shown.length
        ? h('div', { class: 'build-grid' }, shown.map((d) => this.buildCard(state, sel, d)))
        : h('div', { class: 'hint' }, '這個分類目前沒有可建造的建築。'),
      upcoming.length
        ? h(
            'div',
            { class: 'unlock-hint' },
            icon('lock', 15),
            h('span', {}, `主堡升到 Lv.${nextLevel} 解鎖：`, h('b', {}, upcoming.map((b) => b.name).join('、'))),
          )
        : null,
      h('p', { class: 'muted small foot' }, '相鄰的同類建築互相加成：兵營出兵 +15%、資源 +10%、塔 +10%。'),
    ].filter((n): n is HTMLDivElement => !!n);
  }

  private buildCard(state: GameState, sel: Selection, def: BuildingDef): HTMLElement {
    const poor = !canBuild(state, sel.i, sel.j, def.id).ok;
    let sub: string;
    if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      sub = `${u.name}・${u.role}`;
    } else if (def.kind === 'resource') sub = `每波 +${def.income![0]} 金`;
    else if (def.kind === 'tower') sub = `射程 ${def.tower!.range}${def.tower!.canHitAir ? '・對空' : ''}${def.tower!.splash ? '・範圍' : ''}`;
    else sub = firstClause(def.desc);
    const kind = def.campaignOnly ? 'special' : def.kind;
    const thumb = this.thumbs?.get(def.id, state.race);
    const card = h(
      'button',
      {
        class: `bcard kind-${kind} ${poor ? 'poor' : ''}`,
        onclick: () => this.actions.build(def.id),
      },
      h('span', { class: 'bc-top' }, h('span', { class: 'k' }, def.campaignOnly ? '特殊' : KIND_LABEL[def.kind as keyof typeof KIND_LABEL]), h('span', { class: 'cost num' }, coin(), String(buildCost(state, def)))),
      thumb ? h('span', { class: 'bc-img' }, h('img', { src: thumb, alt: '', draggable: 'false' })) : null,
      h('span', { class: 'nm' }, def.name),
      h('span', { class: 'sb' }, sub),
    );
    return this.tip(card, () => this.buildingTip(def));
  }

  private buildingTip(def: BuildingDef): string {
    let html = `<b>${def.name}</b><br>${def.desc}`;
    if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      html += `<hr>${this.unitTip(u)}<br><span class="muted">出兵間隔 ${def.spawnInterval!.join(' / ')} 秒・上限 ${def.maxAlive!.join(' / ')}</span>`;
    }
    if (def.kind === 'tower') {
      const t = def.tower!;
      html += `<br><span class="muted">傷害 ${t.damage.join(' / ')}・射程 ${t.range}・每 ${t.attackInterval} 秒${t.canHitAir ? '・可對空' : '・無法對空'}${t.splash ? '・範圍傷害' : ''}</span>`;
    }
    if (def.kind === 'resource') html += `<br><span class="muted">產量 ${def.income!.join(' / ')}（Lv1/2/3）</span>`;
    if (def.special?.type === 'healAura') html += `<br><span class="muted">每秒回復 ${def.special.pctPerSec.map((v) => pct(v)).join(' / ')} 生命・範圍 ${def.special.radius}</span>`;
    if (def.special?.type === 'warBanner') html += `<br><span class="muted">全軍傷害 +${def.special.dmg.map((v) => pct(v)).join(' / ')}</span>`;
    return html;
  }

  private unitTip(u: UnitDef): string {
    const tags = unitTags(u);
    return `<b>${u.name}</b>・${u.role}<br>${u.desc}<br><span class="muted">生命 ${u.hp}・攻擊 ${u.damage}${u.damageType === 'magic' ? '（魔法）' : ''}・每 ${u.attackInterval} 秒・射程 ${u.range}・移速 ${u.speed}${u.armor ? `・護甲 ${pct(u.armor)}` : ''}${u.evasion ? `・閃避 ${pct(u.evasion)}` : ''}${u.canHitAir ? '・可對空' : ''}${tags.length ? `<br>${tags.join('・')}` : ''}</span>`;
  }

  /** Large building picture on top of a building panel. */
  private hero(defId: string, race: RaceId): HTMLElement[] {
    const src = this.thumbs?.get(defId, race);
    return src ? [h('div', { class: 'bp-hero' }, h('img', { src, alt: '', draggable: 'false' }))] : [];
  }

  private levelStars(level: number, max: number): HTMLElement {
    return h(
      'span',
      { class: 'stars', 'aria-label': `等級 ${level} / ${max}` },
      Array.from({ length: max }, (_, k) => icon('star', 14, k < level ? { fill: true } : { strokeWidth: 1.6, cls: 'empty' })),
    );
  }

  private stats(rows: [string, string][]): HTMLElement {
    return h('dl', { class: 'stats' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  private costButton(label: string, cost: number | undefined, cls: string, disabled: boolean, onclick: () => void): HTMLElement {
    return h('button', { class: `btn ${cls}`, disabled, onclick }, label, cost !== undefined ? h('span', { class: 'btn-cost num' }, coinIcon(15), String(cost)) : null);
  }

  private buildingPanel(state: GameState, sel: Selection): Node[] {
    const tile = tileAt(state, sel.i, sel.j)!;
    const b = tile.building!;
    const def = getBuilding(b.defId);
    const bonus = tileBonuses(state, sel.i, sel.j);
    const mods = getModifiers(state);
    const rows: [string, string][] = [];
    const lvl = b.level - 1;
    if (def.kind === 'resource') {
      rows.push(['每波產出', `${buildingIncome(state, sel.i, sel.j)} 金`]);
      if (def.special?.type === 'sanctum') rows.push(['修復主堡', `每波 +${def.special.castleRepair[lvl]}`]);
      if (def.special?.type === 'moonwell') rows.push(['相鄰兵營', `士兵生命 +${pct(def.special.hpBonus[lvl])}`]);
      if (def.special?.type === 'forge') rows.push(['相鄰防禦塔', `傷害 +${pct(def.special.towerDmg[lvl])}`]);
    }
    if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      const interval = def.spawnInterval![lvl] / (mods.spawnSpeedMult * bonus.spawnMult);
      rows.push(['兵種', `${u.name}（${u.role}）`]);
      rows.push(['出兵間隔', `${interval.toFixed(1)} 秒`]);
      rows.push(['兵力上限', `${def.maxAlive![lvl] + mods.maxAliveAdd}`]);
      rows.push(['士兵強度', `×${UNIT_LEVEL_MULT[lvl]}`]);
    }
    if (def.special?.type === 'healAura') {
      rows.push(['士兵回復', `每秒 ${pct(def.special.pctPerSec[lvl])} 最大生命`]);
      rows.push(['範圍', `${def.special.radius} 格`]);
    }
    if (def.special?.type === 'warBanner') {
      rows.push(['全軍傷害', `+${pct(def.special.dmg[lvl])}`]);
      rows.push(['全軍移速', `+${pct(def.special.speed[lvl])}`]);
    }
    if (def.kind === 'tower') {
      const t = def.tower!;
      rows.push(['傷害', `${Math.round(t.damage[lvl] * mods.towerDmgMult * bonus.towerDmgMult)}${t.damageType === 'magic' ? '（魔法）' : ''}`]);
      rows.push(['射程', `${t.range}`]);
      rows.push(['攻擊間隔', `${t.attackInterval} 秒`]);
      rows.push(['對空', t.canHitAir ? '可以' : '不行']);
    }
    const up = canUpgrade(state, sel.i, sel.j);
    const kindLabel = def.campaignOnly ? '特殊建築' : KIND_LABEL[def.kind as keyof typeof KIND_LABEL];
    const nodes: Node[] = [
      ...this.hero(def.id, state.race),
      h('div', { class: 'p-head' }, h('div', { class: 'eyebrow' }, kindLabel), h('div', { class: 'title-row' }, h('h2', {}, def.name), this.levelStars(b.level, MAX_BUILDING_LEVEL))),
      h('p', {}, def.desc),
      this.stats(rows),
      ...bonus.lines.map((l) => h('div', { class: 'bonus-line' }, icon('sparkle', 14), l)),
    ];
    if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      nodes.push(h('div', { class: 'sec-title' }, h('span', {}, '兵種資料')), h('div', { class: 'info-card', html: this.unitTip(u) }));
    }
    const actions = h('div', { class: 'panel-actions' });
    if (b.level < MAX_BUILDING_LEVEL) {
      actions.append(this.costButton(`升級到 Lv.${b.level + 1}`, up.cost, 'primary', !up.ok, () => this.actions.upgrade()));
      actions.append(h('p', { class: 'muted small center' }, up.ok ? this.upgradePreview(def, b.level) : (up.reason ?? '')));
    } else {
      actions.append(h('p', { class: 'muted small center' }, '已達最高等級'));
    }
    actions.append(h('button', { class: 'btn danger', onclick: () => this.actions.demolish() }, '拆除', h('span', { class: 'btn-cost num' }, `退還 ${demolishRefund(b)}`)));
    nodes.push(actions);
    return nodes;
  }

  private upgradePreview(def: BuildingDef, level: number): string {
    if (def.special?.type === 'healAura') return `回復 ${pct(def.special.pctPerSec[level - 1])} → ${pct(def.special.pctPerSec[level])}／秒`;
    if (def.special?.type === 'warBanner') return `全軍傷害 +${pct(def.special.dmg[level - 1])} → +${pct(def.special.dmg[level])}`;
    if (def.kind === 'support') return '提高建築生命';
    if (def.kind === 'resource') return `產量 ${def.income![level - 1]} → ${def.income![level]}`;
    if (def.kind === 'tower') return `傷害 ${def.tower!.damage[level - 1]} → ${def.tower!.damage[level]}`;
    return `出兵 ${def.spawnInterval![level - 1]}→${def.spawnInterval![level]} 秒・上限 ${def.maxAlive![level - 1]}→${def.maxAlive![level]}・士兵 ×${UNIT_LEVEL_MULT[level]}`;
  }

  private castlePanel(state: GameState): Node[] {
    const r = RACE_MAP.get(state.race)!;
    const max = castleMaxHp(state);
    const up = canUpgradeCastle(state);
    const next = state.castleLevel + 1;
    const unlocks = raceBuildings(state.race).filter((b) => b.castleLevel === next);
    const repair = fullRepairCost(state);
    const nodes: Node[] = [
      ...this.hero('castle', state.race),
      h('div', { class: 'p-head' }, h('div', { class: 'eyebrow' }, '主堡'), h('div', { class: 'title-row' }, h('h2', {}, r.castleName), this.levelStars(state.castleLevel, CASTLE.maxLevel))),
      h('p', {}, '主堡被摧毀就失敗。主堡等級決定能建造哪些建築、建築能升到幾級，以及可以擴張多少土地。'),
      this.stats([
        ['生命', `${Math.round(state.castleHp)} / ${max}`],
        ['每波稅收', `${castleIncome(state)} 金`],
        ['城防攻擊', `${Math.round(CASTLE.damage[state.castleLevel - 1] * getModifiers(state).castleDmgMult)}`],
        ['土地擴張', `${state.expansions} / ${expansionCap(state)}`],
      ]),
    ];
    const actions = h('div', { class: 'panel-actions' });
    if (state.castleLevel < CASTLE.maxLevel) {
      nodes.push(
        h('div', { class: 'sec-title' }, h('span', {}, `Lv.${next} 解鎖`)),
        h('div', { class: 'info-card' }, h('b', {}, unlocks.length ? unlocks.map((u) => u.name).join('、') : '—'), h('br'), h('span', { class: 'muted' }, `建築可升到 Lv.${Math.min(MAX_BUILDING_LEVEL, next)}・土地上限 ${CASTLE.expansionCap[next - 1]}・生命 ${CASTLE.hp[next - 1]}`)),
      );
      actions.append(this.costButton(`升級主堡到 Lv.${next}`, castleUpgradeCost(state) ?? undefined, 'primary', !up.ok, () => this.actions.upgradeCastle()));
    }
    actions.append(
      h(
        'button',
        { class: 'btn', disabled: repair <= 0 || state.gold <= 0, onclick: () => this.actions.repairCastle() },
        repair > 0 ? '修復主堡' : '主堡完好',
        repair > 0 ? h('span', { class: 'btn-cost num' }, coinIcon(15), String(repair)) : null,
      ),
    );
    if (repair > 0) actions.append(h('p', { class: 'muted small center' }, '金幣不足時會部分修復'));
    nodes.push(actions);
    return nodes;
  }

  private expandPanel(state: GameState, sel: Selection): Node[] {
    const check = canExpand(state, sel.i, sel.j);
    return [
      h('div', { class: 'p-head' }, h('div', { class: 'eyebrow' }, '土地'), h('h2', {}, '未開墾的土地')),
      h('p', {}, '擴張後可以在這裡建造建築。最多可擴張到 5×5，可擴張的數量由主堡等級決定。'),
      this.stats([['已擴張', `${state.expansions} / ${expansionCap(state)}`]]),
      h(
        'div',
        { class: 'panel-actions' },
        this.costButton('擴張土地', check.cost, 'primary', !check.ok, () => this.actions.expand()),
        !check.ok ? h('p', { class: 'muted small center' }, check.reason ?? '') : null,
      ),
    ];
  }

  // ---------------------------------------------------------------- right panel

  private renderRight(state: GameState, battle: Battle | null): void {
    this.right.classList.toggle('compact', !!battle);
    const wave = waveForState(state);
    const groups = [...(wave.boss ? [{ unit: wave.boss, count: 1 }] : []), ...wave.groups];
    if (battle) {
      this.right.replaceChildren(
        h('div', { class: 'sec-title' }, h('span', {}, `本波敵軍・剩餘`)),
        ...groups.map((g) => {
          const u = getUnit(g.unit);
          const count = h('b', { class: 'num' }, String(g.count));
          const fill = h('i', { style: `width:100%;background:${enemyColor(u)}` });
          this.live.rows.set(g.unit, { count, fill, total: g.count });
          return this.tip(
            h('div', { class: 'remain-row' }, h('div', { class: 'kv' }, h('span', { class: 'nm' }, u.name), h('span', {}, count, h('em', { class: 'num' }, ` / ${g.count}`))), h('div', { class: 'meter thin' }, fill)),
            () => this.unitTip(u),
          );
        }),
      );
      return;
    }

    const r = RACE_MAP.get(state.race)!;
    const nodes: Node[] = [h('div', { class: 'p-head' }, h('div', { class: 'eyebrow' }, `下一波・第 ${state.wave} 波`), h('h2', {}, wave.title ?? '敵軍來襲'))];
    nodes.push(
      h(
        'div',
        { class: 'enemy-list' },
        groups.map((g) => {
          const u = getUnit(g.unit);
          const note = [u.role, ...unitTags(u).filter((t) => t !== '首領')].slice(0, 3).join('・');
          return this.tip(
            h(
              'div',
              { class: `enemy-row ${u.boss ? 'boss' : ''}` },
              h('span', { class: 'enemy-dot', style: `background:${enemyColor(u)}` }),
              h('span', { class: 'nm' }, h('b', {}, u.name, u.boss ? h('span', { class: 'tag boss' }, '首領') : null), h('small', {}, note)),
              h('span', { class: 'count num' }, `×${g.count}`),
            ),
            () => this.unitTip(u),
          );
        }),
      ),
    );
    const upcoming = this.upcomingBoss(state);
    if (upcoming) {
      const u = getUnit(upcoming.unit);
      nodes.push(h('div', { class: 'boss-card' }, icon('skull', 20), h('span', {}, `第 ${upcoming.wave} 波首領：`, h('b', {}, u.name), h('br'), h('small', {}, firstClause(u.desc)))));
    }
    const income = projectedIncome(state);
    const thieves = wave.groups.some((g) => g.unit === 'g_thief') || wave.boss === 'g_king';
    nodes.push(
      h('div', { class: 'sec-title' }, h('span', {}, '預計收入'), h('small', {}, '不含擊殺獎勵')),
      h(
        'div',
        { class: 'kv-list' },
        income.map((l) => h('div', { class: 'kv' }, h('span', {}, l.label), h('b', { class: 'num gold' }, `+${l.amount}`))),
        thieves ? h('div', { class: 'kv bad' }, h('span', {}, '哥布林小偷會偷走金幣'), h('b', { class: 'num' }, '−3 / 次')) : null,
      ),
    );

    const built = new Set(state.tiles.filter((t) => t.building).map((t) => t.building!.defId));
    const builtUnits = new Set([...built].map((id) => BUILDINGS.get(id)?.unit).filter(Boolean) as string[]);
    const syn = r.synergies.map((s) => ({ s, active: s.parts.every((p) => built.has(p) || builtUnits.has(p)) }));
    nodes.push(
      h('div', { class: 'sec-title' }, h('span', {}, '協同組合'), h('small', {}, `${syn.filter((x) => x.active).length} / ${syn.length} 啟動`)),
      h(
        'div',
        { class: 'chips' },
        syn.map(({ s, active }) =>
          this.tip(h('span', { class: `chip ${active ? 'on' : ''}` }, s.name), () => {
            const names = s.parts.map((p) => (BUILDINGS.has(p) ? getBuilding(p).name : getUnit(p).name)).join(' + ');
            return `<b>${s.name}</b>${active ? '（已啟動）' : ''}<br><span class="muted">${names}</span><br>${s.desc}`;
          }),
        ),
      ),
      this.tip(h('div', { class: 'info-card' }, h('b', {}, `種族特性・${r.passive.name}`), h('br'), h('span', { class: 'muted' }, firstClause(r.passive.desc))), () => `<b>${r.passive.name}</b><br>${r.passive.desc}`),
    );
    if (state.level && state.perks.length) {
      nodes.push(
        h('div', { class: 'sec-title' }, h('span', {}, '收復領地的加成'), h('small', {}, String(state.perks.length))),
        h('div', { class: 'perk-list' }, campaignPerkDefs(state.perks).map((p) => h('div', { class: 'perk-row' }, h('span', { class: 'perk-ico' }, icon('up', 13, { strokeWidth: 2.2 })), h('span', {}, h('b', {}, p.name), h('small', {}, p.desc))))),
      );
    }
    if (state.boons.length) {
      nodes.push(
        h('div', { class: 'sec-title' }, h('span', {}, '已獲得的祝福')),
        h('div', { class: 'perk-list' }, state.boons.map((id) => {
          const b = BOON_MAP.get(id)!;
          return h('div', { class: 'perk-row' }, h('span', { class: 'perk-ico' }, icon('sparkle', 13)), h('span', {}, h('b', {}, b.name), h('small', {}, b.desc)));
        })),
      );
    }
    if (state.report) {
      const rep = state.report;
      nodes.push(
        h('div', { class: 'sec-title' }, h('span', {}, `上一波戰報・第 ${rep.wave} 波`)),
        h(
          'div',
          { class: 'kv-list' },
          h('div', { class: 'kv' }, h('span', {}, '擊殺'), h('b', { class: 'num' }, String(rep.kills))),
          h('div', { class: 'kv' }, h('span', {}, '我方陣亡'), h('b', { class: 'num' }, String(rep.deaths))),
          h('div', { class: 'kv' }, h('span', {}, '主堡受損'), h('b', { class: 'num' }, String(rep.castleDamage))),
          rep.castleRepair ? h('div', { class: 'kv' }, h('span', {}, '聖所修復'), h('b', { class: 'num good' }, `+${rep.castleRepair}`)) : null,
          ...rep.income.map((l) => h('div', { class: `kv ${l.amount < 0 ? 'bad' : ''}` }, h('span', {}, l.label), h('b', { class: `num ${l.amount < 0 ? '' : 'gold'}` }, l.amount < 0 ? `${l.amount}` : `+${l.amount}`))),
        ),
      );
    }
    if (state.level) {
      const terrain = TERRAINS[state.level.terrain];
      nodes.push(h('div', { class: 'info-card terrain' }, h('b', {}, `地形・${terrain.name}`), '　', terrain.effect));
    }
    this.right.replaceChildren(...nodes);
  }

  /** The next boss after the current wave (campaign: the territory's last wave). */
  private upcomingBoss(state: GameState): { wave: number; unit: string } | null {
    if (state.level) {
      const total = state.level.totalWaves;
      if (state.wave >= total) return null;
      const boss = getCampaignWave(state.level.territoryId, total).boss;
      return boss ? { wave: total, unit: boss } : null;
    }
    const next = BOSS_WAVES.find((w) => w > state.wave);
    if (!next) return null;
    const boss = getWave(next).boss;
    return boss ? { wave: next, unit: boss } : null;
  }

  // ---------------------------------------------------------------- modals

  showBoons(state: GameState): void {
    const modal = ornate(
      h(
        'div',
        { class: 'modal wide', role: 'dialog' },
        medallion('sparkle'),
        h('div', { class: 'eyebrow wide center' }, '祝福'),
        h('h1', { class: 'center' }, '選擇一項祝福'),
        h('p', { class: 'subtitle center' }, `撐過了第 ${state.wave - 1} 波！從以下三項永久強化中選擇一項。`),
        h(
          'div',
          { class: 'boon-grid' },
          state.boonChoices.map((id) => {
            const b = BOON_MAP.get(id)!;
            return h(
              'button',
              { class: 'boon', onclick: () => this.actions.chooseBoon(id) },
              b.race ? h('span', { class: 'tag special' }, `${RACE_MAP.get(b.race)!.name}專屬`) : h('span', { class: 'tag' }, '通用'),
              h('span', { class: 'bname' }, b.name),
              h('span', {}, b.desc),
            );
          }),
        ),
      ),
    );
    this.openOverlay(modal);
  }

  showGameOver(state: GameState): void {
    const r = RACE_MAP.get(state.race)!;
    const level = state.level;
    const modal = ornate(
      h(
        'div',
        { class: 'modal narrow center', role: 'dialog' },
        medallion('skull', 'crimson'),
        h('div', { class: 'eyebrow wide bad' }, level ? '收復失敗' : '主堡淪陷'),
        h('h1', {}, level ? level.name : `${r.name}王國`),
        h('p', { class: 'subtitle' }, level ? `守軍擊退了我們（第 ${state.wave} / ${level.totalWaves} 波）。重整旗鼓，再戰一次！` : `王國在第 ${state.wave} 波倒下了。`),
        this.summary(state),
        h(
          'div',
          { class: 'modal-actions' },
          level
            ? [h('button', { class: 'btn primary', onclick: () => this.actions.retry() }, '重新挑戰'), h('button', { class: 'btn', onclick: () => this.actions.backToMap() }, icon('map', 18), '返回世界地圖')]
            : [h('button', { class: 'btn primary', onclick: () => this.actions.backToTitle() }, '回到標題')],
        ),
      ),
    );
    this.openOverlay(modal);
  }

  showVictory(state: GameState): void {
    const r = RACE_MAP.get(state.race)!;
    const modal = ornate(
      h(
        'div',
        { class: 'modal narrow center', role: 'dialog' },
        medallion('crown'),
        h('div', { class: 'eyebrow wide' }, '勝利'),
        h('h1', {}, `${r.name}王國屹立不搖`),
        h('p', { class: 'subtitle' }, `擊敗了死亡騎士，撐過全部 ${FINAL_WAVE} 波！`),
        this.summary(state),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn primary', onclick: () => this.actions.continueEndless() }, '繼續挑戰無盡模式'),
          h('button', { class: 'btn', onclick: () => this.actions.backToTitle() }, '回到標題'),
        ),
      ),
    );
    this.openOverlay(modal);
  }

  private summary(state: GameState): HTMLElement {
    return h(
      'div',
      { class: 'tiles three' },
      h('div', { class: 'tile' }, h('b', { class: 'num' }, String(state.phase === 'over' ? state.wave : state.wave - 1)), h('small', {}, state.phase === 'over' ? '倒下的波數' : '撐過的波數')),
      h('div', { class: 'tile' }, h('b', { class: 'num' }, String(state.stats.kills)), h('small', {}, '總擊殺')),
      h('div', { class: 'tile' }, h('b', { class: 'num' }, String(state.stats.goldEarned)), h('small', {}, '總收入')),
    );
  }

  showHelp(campaign = false): void {
    const line = (name: IconName, text: string) => h('li', {}, icon(name, 18), h('span', {}, text));
    const modal = ornate(
      h(
        'div',
        { class: 'modal', role: 'dialog', style: 'max-width:640px' },
        h('div', { class: 'eyebrow wide' }, '說明'),
        h('h1', {}, '怎麼玩'),
        h(
          'ul',
          { class: 'help-list' },
          line('castle', '中央是你的主堡。點選空地建造建築，點選建築可以升級或拆除。'),
          line('coin', '金幣在每波結束時結算：主堡稅收＋資源建築產出＋擊殺獎勵。'),
          line('army', '兵營會在戰鬥中自動出兵，上限與速度隨等級提升；每波結束後士兵會解散。'),
          line('flag', '士兵會集結成隊推進到中場迎敵，兵力不利時退回前線。'),
          line('tower', '防禦塔自動攻擊射程內的敵人。注意有些兵種與塔無法攻擊飛行單位！'),
          line('sparkle', '相鄰加成：兵營相鄰兵營出兵更快，資源相鄰資源產量更高，塔相鄰塔傷害更高。'),
          line('shield', '敵人永遠從右下方來襲，最靠近前線的建築會先被攻擊。被摧毀的建築戰後自動修復，主堡的損傷會保留。'),
          campaign
            ? line('map', '擊退全部敵軍（最後一波是首領）就能收復領地。收復的領地會給予永久加成或特殊建築，地形則會影響這場戰鬥。')
            : line('star', '撐過 30 波（第 10、20、30 波有首領）即可獲勝，每 5 波可以選一項祝福。'),
        ),
        h('p', { class: 'muted small' }, '快捷鍵：空白鍵開始下一波・1/2/3 切換速度・U 升級・Esc 取消選取'),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: () => this.closeOverlay() }, '知道了')),
      ),
    );
    this.openOverlay(modal);
  }

  get overlayOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }
}
