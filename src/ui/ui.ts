import type { Battle } from '../game/battle';
import { CASTLE, FINAL_WAVE, MAX_BUILDING_LEVEL, UNIT_LEVEL_MULT } from '../game/constants';
import { BOON_MAP } from '../game/data/boons';
import { BUILDINGS, getBuilding, getUnit, RACE_MAP, RACES, raceBuildings, raceUnits } from '../game/data/index';
import { waveForState } from '../game/battle';
import { campaignPerkDefs } from '../game/campaign/campaign';
import { TERRAINS } from '../game/campaign/terrain';
import {
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
  availableBuildings,
  type GameState,
} from '../game/state';
import type { BuildingDef, RaceId, Stance, UnitDef } from '../game/types';
import { RACE_MASCOT } from '../render/portraits';

import { coin, h } from './dom';

export const STANCE_INFO: Record<Stance, { icon: string; name: string; desc: string }> = {
  hold: { icon: '🛡', name: '堅守', desc: '士兵留在防禦塔射程內，不追擊遠方的敵人；護甲 +15%。適合依賴防禦塔的陣容。' },
  advance: { icon: '⚔', name: '迎擊', desc: '士兵集結成隊後推進到中場迎敵，兵力不利時退回前線。' },
  assault: { icon: '🔥', name: '突擊', desc: '全軍壓上直攻墓園、搶先打掉後排敵人；傷害 +10%、移速 +15%，但會脫離防禦塔掩護。' },
};
const KIND_LABEL = { resource: '資源', tower: '防禦塔', support: '支援', barracks: '兵營' } as const;

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
  setStance(stance: Stance): void;
  chooseBoon(id: string): void;
  backToTitle(): void;
  continueEndless(): void;
  toggleMusic(): boolean;
  toggleSfx(): boolean;
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
};

/** Fallback dot colours for the campaign factions, by unit id prefix. */
const FACTION_DOT: Record<string, string> = { g_: '#84cc16', o_: '#d97706', r_: '#f87171', b_: '#ef4444', sp: '#60a5fa' };

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export class Ui {
  private readonly top = h('div', { class: 'topbar hidden' });
  private readonly left = h('div', { class: 'panel left hidden' });
  private readonly right = h('div', { class: 'panel right hidden' });
  private readonly bottom = h('div', { class: 'bottombar hidden' });
  private readonly overlay = h('div', { class: 'overlay hidden' });
  private readonly toasts = h('div', { class: 'toast-area' });
  private readonly tooltip = h('div', { class: 'tooltip hidden' });
  private readonly loading = h('div', { class: 'loading' });
  private titleRace: RaceId = 'human';
  private titleMode: 'campaign' | 'classic' = 'campaign';
  private speed = 1;
  audio: AudioState = { music: true, sfx: true };
  /** Rendered portraits of each race's mascot unit for the race picker. */
  portraits = new Map<RaceId, string>();
  private battleStatus: HTMLElement | null = null;
  private liveBox: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: UiActions,
  ) {
    root.append(this.top, this.left, this.right, this.bottom, this.overlay, this.toasts, this.tooltip, this.loading);
    document.addEventListener('mousemove', (e) => {
      if (this.tooltip.classList.contains('hidden')) return;
      const x = Math.min(e.clientX + 16, window.innerWidth - 320);
      const y = Math.min(e.clientY + 12, window.innerHeight - this.tooltip.offsetHeight - 10);
      this.tooltip.style.left = `${x}px`;
      this.tooltip.style.top = `${y}px`;
    });
  }

  /** Free screen area the 3D view should frame. */
  get insets() {
    const inGame = !this.left.classList.contains('hidden');
    return inGame ? { left: 340, right: 320, top: 70, bottom: 90 } : { left: 40, right: 40, top: 40, bottom: 40 };
  }

  // ---------------------------------------------------------------- loading & toasts

  setLoading(done: number, total: number): void {
    this.loading.replaceChildren(
      h('div', { class: 'title-logo modal', style: 'background:none;border:none;box-shadow:none;padding:0;width:auto' }, '迷你帝國'),
      h('div', { class: 'bar' }, h('div', { style: `width:${(done / total) * 100}%` })),
      h('div', { class: 'muted' }, `載入素材中… ${done}/${total}`),
    );
  }

  hideLoading(): void {
    this.loading.classList.add('hidden');
  }

  toast(msg: string, kind: 'bad' | 'good' | '' = ''): void {
    const t = h('div', { class: `toast ${kind}` }, msg);
    this.toasts.append(t);
    setTimeout(() => t.remove(), 2200);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
  }

  banner(text: string, sub = ''): void {
    const b = h('div', { class: 'banner' }, text, sub ? h('small', {}, sub) : null);
    this.root.append(b);
    setTimeout(() => b.remove(), 2500);
  }

  private tip(el: HTMLElement, html: () => string): HTMLElement {
    el.addEventListener('mouseenter', () => {
      this.tooltip.innerHTML = html();
      this.tooltip.classList.remove('hidden');
    });
    el.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
    return el;
  }

  private hideTip(): void {
    this.tooltip.classList.add('hidden');
  }

  // ---------------------------------------------------------------- title

  /** Race selection: for a new campaign, or for the unlocked classic mode. */
  showTitle(race: RaceId = this.titleRace, mode: 'campaign' | 'classic' = this.titleMode): void {
    this.titleRace = race;
    this.titleMode = mode;
    for (const p of [this.top, this.left, this.right, this.bottom]) p.classList.add('hidden');
    const r = RACE_MAP.get(race)!;
    const units = raceUnits(race);
    const towers = raceBuildings(race).filter((b) => b.kind === 'tower');
    const modal = h(
      'div',
      { class: 'modal' },
      h('h1', { class: 'title-logo' }, mode === 'campaign' ? '選擇你的王國' : '無盡挑戰'),
      h(
        'p',
        { class: 'title-sub' },
        mode === 'campaign'
          ? '王子將帶領哪一族的子民收復失土？種族決定你能使用的兵種與建築，整場戰役都無法更換。'
          : '經典模式：在九宮格領地上建立王國，抵禦一波波的亡靈大軍。撐過 30 波即可獲勝！',
      ),
      h(
        'div',
        { class: 'race-grid' },
        RACES.map((rc) =>
          h(
            'button',
            {
              class: `race-card ${rc.id === race ? 'selected' : ''}`,
              style: `--c:${rc.color}`,
              onclick: () => {
                this.actions.previewRace(rc.id);
                this.showTitle(rc.id);
              },
            },
            this.portraits.get(rc.id)
              ? h('div', { class: 'portrait' }, h('img', { src: this.portraits.get(rc.id), alt: getUnit(RACE_MASCOT[rc.id]).name, draggable: 'false' }))
              : h('div', { class: 'emblem' }),
            h('div', { class: 'rname' }, rc.name),
            h('div', { class: 'rtitle' }, rc.title),
          ),
        ),
      ),
      h(
        'div',
        { class: 'race-detail' },
        h(
          'div',
          {},
          h('h2', { style: `color:${r.color};margin:0` }, `${r.name}・${r.title}`),
          h('p', {}, r.desc),
          h('ul', { class: 'pros' }, r.strengths.map((s) => h('li', {}, s))),
          h('ul', { class: 'cons' }, r.weaknesses.map((s) => h('li', {}, s))),
          h('p', {}, h('b', {}, `種族特性：${r.passive.name}`), h('br'), h('span', { class: 'muted' }, r.passive.desc)),
        ),
        h(
          'div',
          {},
          h('b', {}, '兵種'),
          h(
            'div',
            { class: 'unit-list' },
            units.map((u) => h('div', { class: 'unit-chip' }, h('b', {}, u.name), u.role)),
            towers.map((t) => h('div', { class: 'unit-chip' }, h('b', {}, t.name), '防禦塔')),
          ),
          h('p', { class: 'muted', style: 'font-size:12px;margin-top:10px' }, `招牌協同：${r.synergies[0].name} — ${r.synergies[0].desc}`),
        ),
      ),
      h(
        'div',
        { style: 'display:flex;gap:10px;margin-top:18px' },
        h('button', { class: 'btn', style: 'flex:0 0 140px;padding:14px', onclick: () => this.actions.backToTitle() }, '← 返回'),
        h(
          'button',
          { class: 'btn primary', style: 'font-size:18px;padding:14px;flex:1', onclick: () => this.actions.startGame(race) },
          mode === 'campaign' ? `以${r.name}展開復國之戰` : `以${r.name}開始遊戲`,
        ),
      ),
    );
    this.overlay.replaceChildren(modal);
    this.overlay.style.background = 'linear-gradient(180deg, rgba(12,10,9,0.15), rgba(12,10,9,0.7))';
    this.overlay.classList.remove('hidden');
  }

  /** Hides the in-game HUD panels and any modal. */
  hideHud(): void {
    for (const p of [this.top, this.left, this.right, this.bottom]) p.classList.add('hidden');
    this.closeOverlay();
  }

  closeOverlay(): void {
    this.overlay.classList.add('hidden');
    this.overlay.style.background = '';
    this.overlay.replaceChildren();
  }

  // ---------------------------------------------------------------- main HUD

  render(state: GameState, sel: Selection | null, battle: Battle | null): void {
    this.hideTip();
    for (const p of [this.top, this.left, this.right, this.bottom]) p.classList.remove('hidden');
    document.documentElement.style.setProperty('--race', RACE_MAP.get(state.race)!.color);
    this.renderTop(state);
    this.renderLeft(state, sel, battle);
    this.renderRight(state, battle);
    this.renderBottom(state, battle);
  }

  private renderTop(state: GameState): void {
    const r = RACE_MAP.get(state.race)!;
    const max = castleMaxHp(state);
    const hpRatio = state.castleHp / max;
    const wave = waveForState(state);
    const waveText = state.level
      ? `${state.level.name}・第 ${Math.min(state.wave, state.level.totalWaves)} / ${state.level.totalWaves} 波`
      : state.wave > FINAL_WAVE
        ? `無盡模式・第 ${state.wave} 波`
        : `第 ${state.wave} / ${FINAL_WAVE} 波`;
    this.top.replaceChildren(
      h('div', { class: 'race-badge' }, h('div', { class: 'race-dot' }), h('div', {}, `${r.name}`, h('small', {}, `${r.castleName} Lv.${state.castleLevel}`))),
      h('div', { class: 'stat', title: '金幣' }, coin(), String(state.gold)),
      h(
        'div',
        { class: 'castle-hp' },
        h('div', { class: 'label' }, h('span', {}, '主堡生命'), h('span', {}, `${Math.round(state.castleHp)} / ${max}`)),
        h('div', { class: `bar ${hpRatio < 0.35 ? 'low' : ''}` }, h('div', { style: `width:${hpRatio * 100}%` })),
      ),
      h('div', { class: 'wave-label' }, waveText, wave.title ? h('small', {}, wave.title) : null),
      ...this.audioButtons(),
      h('button', { class: 'icon-btn', onclick: () => this.showHelp(!!state.level) }, '❔ 說明'),
      ...(state.level && state.phase === 'prep' ? [h('button', { class: 'icon-btn', onclick: () => this.confirmRetreat() }, '🏳 撤退')] : []),
    );
  }

  /** Separate music and sound-effect toggles. */
  audioButtons(): HTMLElement[] {
    const music = h('button', { class: 'icon-btn', title: '背景音樂開關' }, this.audio.music ? '🎵 音樂' : '🔇 音樂');
    const sfx = h('button', { class: 'icon-btn', title: '音效開關' }, this.audio.sfx ? '🔊 音效' : '🔇 音效');
    music.addEventListener('click', () => {
      this.audio.music = this.actions.toggleMusic();
      music.textContent = this.audio.music ? '🎵 音樂' : '🔇 音樂';
    });
    sfx.addEventListener('click', () => {
      this.audio.sfx = this.actions.toggleSfx();
      sfx.textContent = this.audio.sfx ? '🔊 音效' : '🔇 音效';
    });
    return [music, sfx];
  }

  private confirmRetreat(): void {
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:440px;text-align:center' },
      h('h1', {}, '撤退？'),
      h('p', { class: 'subtitle' }, '放棄這場戰鬥並返回世界地圖。這塊領地之後仍可再次進攻。'),
      h('button', { class: 'btn danger', onclick: () => this.actions.retreat() }, '撤退回地圖'),
      h('button', { class: 'btn', onclick: () => this.closeOverlay() }, '繼續作戰'),
    );
    this.overlay.replaceChildren(modal);
    this.overlay.classList.remove('hidden');
  }

  private renderBottom(state: GameState, battle: Battle | null): void {
    if (battle) {
      this.battleStatus = h('div', {});
      this.bottom.replaceChildren(
        h(
          'div',
          { class: 'battle-status' },
          h('span', { class: 'stance-label', title: STANCE_INFO[state.stance].desc }, `${STANCE_INFO[state.stance].icon} ${STANCE_INFO[state.stance].name}`),
          this.battleStatus,
          h(
            'div',
            { class: 'speed' },
            [1, 2, 4].map((s) =>
              h(
                'button',
                {
                  class: s === this.speed ? 'on' : '',
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
        ),
      );
      this.updateBattle(battle);
    } else if (state.phase === 'prep') {
      this.battleStatus = null;
      const w = waveForState(state);
      this.bottom.replaceChildren(
        h(
          'div',
          { class: 'stance' },
          h('div', { class: 'stance-title' }, '作戰姿態'),
          h(
            'div',
            { class: 'stance-buttons' },
            (Object.keys(STANCE_INFO) as Stance[]).map((s) =>
              this.tip(
                h(
                  'button',
                  {
                    class: s === state.stance ? 'on' : '',
                    onclick: () => {
                      this.actions.setStance(s);
                      this.renderBottom(state, null);
                    },
                  },
                  `${STANCE_INFO[s].icon} ${STANCE_INFO[s].name}`,
                ),
                () => `<b>${STANCE_INFO[s].icon} ${STANCE_INFO[s].name}</b><br>${STANCE_INFO[s].desc}`,
              ),
            ),
          ),
        ),
        h('button', { class: 'start-btn', onclick: () => this.actions.startWave() }, `⚔ 開始第 ${state.wave} 波`, h('small', {}, w.boss ? '首領來襲！' : '準備好了就按空白鍵')),
      );
    } else {
      this.bottom.replaceChildren();
    }
  }

  setSpeedLabel(speed: number): void {
    this.speed = speed;
  }

  /** Cheap per-frame refresh of live battle numbers. */
  updateBattle(battle: Battle): void {
    if (this.battleStatus) {
      const enemies = battle.entities.filter((e) => e.alive && e.baseTeam === 'enemy').length + battle.pendingSpawns;
      const allies = battle.entities.filter((e) => e.alive && e.team === 'player').length;
      this.battleStatus.replaceChildren(
        h('span', { style: 'color:#fca5a5' }, `☠ 敵軍 ${enemies}`),
        h('span', { style: 'margin-left:14px;color:#86efac' }, `⚔ 我軍 ${allies}`),
        h('span', { style: 'margin-left:14px;color:#fde68a' }, `擊殺 ${battle.kills}`),
      );
    }
    if (this.liveBox) {
      const lines: string[] = [];
      if (battle.mods.combinedArms > 0) lines.push(`聯合兵種加成：+${pct(battle.combinedArmsBonus)}`);
      if (battle.mods.soulDmg > 0) lines.push(`靈魂收割：+${pct(battle.soulBonus)}（陣亡 ${battle.souls}）`);
      lines.push(`主堡生命：${Math.round(battle.castle.hp)} / ${battle.castle.maxHp}`);
      this.liveBox.innerHTML = lines.join('<br>');
    }
  }

  // ---------------------------------------------------------------- left panel

  private renderLeft(state: GameState, sel: Selection | null, battle: Battle | null): void {
    const el = this.left;
    if (battle) {
      el.replaceChildren(
        h('h2', {}, '戰鬥進行中'),
        h('p', { class: 'muted' }, '士兵會從兵營自動出擊。戰鬥結束後，被摧毀的建築會自動修復，主堡的損傷則會保留。'),
        h('h3', {}, '即時加成'),
        (this.liveBox = h('div', { class: 'synergy' })),
        h('h3', {}, '操作'),
        h('p', { class: 'muted' }, h('span', { class: 'kbd' }, '1'), ' ', h('span', { class: 'kbd' }, '2'), ' ', h('span', { class: 'kbd' }, '3'), ' 切換戰鬥速度'),
      );
      this.updateBattle(battle);
      return;
    }
    this.liveBox = null;
    if (state.phase !== 'prep') {
      el.replaceChildren();
      return;
    }
    if (!sel) {
      el.replaceChildren(
        h('div', { class: 'hint' }, '點選一塊地來建造建築', h('br'), '點選建築可以升級', h('br'), '點選主堡可升級或修復', h('br'), h('br'), h('span', { class: 'kbd' }, 'Esc'), ' 取消選取'),
      );
      return;
    }
    const tile = tileAt(state, sel.i, sel.j)!;
    if (isCastleTile(sel.i, sel.j)) el.replaceChildren(...this.castlePanel(state));
    else if (tile.building) el.replaceChildren(...this.buildingPanel(state, sel));
    else if (tile.owned) el.replaceChildren(...this.buildPanel(state, sel));
    else if (isExpandable(state, sel.i, sel.j)) el.replaceChildren(...this.expandPanel(state, sel));
    else el.replaceChildren(h('div', { class: 'hint' }, '這塊土地離領地太遠，', h('br'), '先擴張相鄰的土地。'));
  }

  private buildPanel(state: GameState, sel: Selection): Node[] {
    const list = availableBuildings(state).filter((b) => !b.campaignOnly);
    const specials = availableBuildings(state).filter((b) => b.campaignOnly);
    const groups: [string, BuildingDef[]][] = [
      ['資源建築', list.filter((b) => b.kind === 'resource')],
      ['防禦塔', list.filter((b) => b.kind === 'tower')],
      ['兵營', list.filter((b) => b.kind === 'barracks')],
    ];
    if (specials.length) groups.push(['特殊建築（每場限 1 座）', specials]);
    return [
      h('h2', {}, '空地'),
      h('p', { class: 'muted' }, `位置 (${sel.i}, ${sel.j})${sel.i === Math.max(...state.tiles.filter((t) => t.owned).map((t) => t.i)) ? '・最前線，最先遭受攻擊' : ''}`),
      ...groups.flatMap(([title, defs]) => [h('h3', {}, title), ...defs.map((d) => this.buildCard(state, sel, d))]),
    ];
  }

  private buildCard(state: GameState, sel: Selection, def: BuildingDef): HTMLElement {
    const check = canBuild(state, sel.i, sel.j, def.id);
    const locked = !check.ok && state.castleLevel < def.castleLevel;
    const poor = !check.ok && !locked;
    let sub = '';
    const already = def.campaignOnly && state.tiles.some((t) => t.building?.defId === def.id);
    if (already) sub = '本場已建造';
    else if (locked) sub = `需要主堡等級 ${def.castleLevel}`;
    else if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      sub = `產出 ${u.name}（${u.role}）`;
    } else if (def.kind === 'resource') sub = `每波 +${def.income![0]} 金起`;
    else sub = def.desc;
    const card = h(
      'button',
      {
        class: `card ${locked ? 'locked' : ''} ${poor ? 'poor' : ''}`,
        onclick: () => this.actions.build(def.id),
      },
      h('span', { class: 'name' }, def.name, ' ', h('span', { class: `tag kind-${def.kind}` }, KIND_LABEL[def.kind])),
      h('span', { class: 'cost' }, coin(), String(buildCost(state, def))),
      h('span', { class: 'sub' }, sub),
    );
    return this.tip(card, () => this.buildingTip(def));
  }

  private buildingTip(def: BuildingDef): string {
    let html = `<b>${def.name}</b><br>${def.desc}`;
    if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      html += `<hr style="border-color:#444">${this.unitTip(u)}<br><span class="muted">出兵間隔 ${def.spawnInterval!.join(' / ')} 秒・上限 ${def.maxAlive!.join(' / ')}</span>`;
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

  private buildingPanel(state: GameState, sel: Selection): Node[] {
    const tile = tileAt(state, sel.i, sel.j)!;
    const b = tile.building!;
    const def = getBuilding(b.defId);
    const bonus = tileBonuses(state, sel.i, sel.j);
    const mods = getModifiers(state);
    const stats: [string, string][] = [];
    const lvl = b.level - 1;
    if (def.kind === 'resource') {
      stats.push(['每波產出', `${buildingIncome(state, sel.i, sel.j)} 金`]);
      if (def.special?.type === 'sacrificePit') stats.push(['陣亡獻祭', `每名 +${def.special.perDeath[lvl]} 金`]);
      if (def.special?.type === 'sanctum') stats.push(['修復主堡', `每波 +${def.special.castleRepair[lvl]}`]);
      if (def.special?.type === 'moonwell') stats.push(['相鄰兵營', `士兵生命 +${pct(def.special.hpBonus[lvl])}`]);
      if (def.special?.type === 'forge') stats.push(['相鄰防禦塔', `傷害 +${pct(def.special.towerDmg[lvl])}`]);
    }
    if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      const interval = def.spawnInterval![lvl] / (mods.spawnSpeedMult * bonus.spawnMult);
      stats.push(['兵種', `${u.name}（${u.role}）`]);
      stats.push(['出兵間隔', `${interval.toFixed(1)} 秒`]);
      stats.push(['兵力上限', `${def.maxAlive![lvl] + mods.maxAliveAdd}`]);
      stats.push(['士兵強度', `×${UNIT_LEVEL_MULT[lvl]}`]);
    }
    if (def.special?.type === 'healAura') {
      stats.push(['士兵回復', `每秒 ${pct(def.special.pctPerSec[lvl])} 最大生命`]);
      stats.push(['範圍', `${def.special.radius} 格`]);
    }
    if (def.special?.type === 'warBanner') {
      stats.push(['全軍傷害', `+${pct(def.special.dmg[lvl])}`]);
      stats.push(['全軍移速', `+${pct(def.special.speed[lvl])}`]);
    }
    if (def.kind === 'tower') {
      const t = def.tower!;
      stats.push(['傷害', `${Math.round(t.damage[lvl] * mods.towerDmgMult * bonus.towerDmgMult)}${t.damageType === 'magic' ? '（魔法）' : ''}`]);
      stats.push(['射程', `${t.range}`]);
      stats.push(['攻擊間隔', `${t.attackInterval} 秒`]);
      stats.push(['對空', t.canHitAir ? '可以' : '不行']);
    }
    const up = canUpgrade(state, sel.i, sel.j);
    const nodes: Node[] = [
      h('h2', {}, def.name, ' ', h('span', { class: 'level-pips' }, '★'.repeat(b.level) + '☆'.repeat(MAX_BUILDING_LEVEL - b.level))),
      h('span', { class: `tag kind-${def.kind}` }, KIND_LABEL[def.kind]),
      h('p', {}, def.desc),
      h('dl', { class: 'stats' }, stats.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      ...bonus.lines.map((l) => h('div', { class: 'bonus-line' }, `✦ ${l}`)),
    ];
    if (def.kind === 'barracks') {
      const u = getUnit(def.unit!);
      nodes.push(h('h3', {}, '兵種資料'), h('div', { class: 'synergy', html: this.unitTip(u) }));
    }
    if (b.level < MAX_BUILDING_LEVEL) {
      nodes.push(
        h(
          'button',
          { class: 'btn primary', disabled: !up.ok, onclick: () => this.actions.upgrade() },
          `升級到 Lv.${b.level + 1}`,
          up.cost !== undefined ? h('small', {}, `（${up.cost} 金）`) : null,
        ),
      );
      if (!up.ok) nodes.push(h('p', { class: 'muted', style: 'text-align:center;font-size:12px' }, up.reason));
      else nodes.push(h('p', { class: 'muted', style: 'text-align:center;font-size:12px' }, this.upgradePreview(def, b.level)));
    } else {
      nodes.push(h('p', { class: 'muted', style: 'text-align:center' }, '已達最高等級'));
    }
    nodes.push(h('button', { class: 'btn danger', onclick: () => this.actions.demolish() }, '拆除', h('small', {}, `（退還 ${demolishRefund(b)} 金）`)));
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
      h('h2', {}, r.castleName, ' ', h('span', { class: 'level-pips' }, '★'.repeat(state.castleLevel) + '☆'.repeat(CASTLE.maxLevel - state.castleLevel))),
      h('p', {}, '主堡被摧毀就失敗。主堡等級決定能建造哪些建築、建築能升到幾級，以及可以擴張多少土地。'),
      h(
        'dl',
        { class: 'stats' },
        h('dt', {}, '生命'),
        h('dd', {}, `${Math.round(state.castleHp)} / ${max}`),
        h('dt', {}, '每波稅收'),
        h('dd', {}, `${castleIncome(state)} 金`),
        h('dt', {}, '城防攻擊'),
        h('dd', {}, `${Math.round(CASTLE.damage[state.castleLevel - 1] * getModifiers(state).castleDmgMult)}`),
        h('dt', {}, '土地擴張'),
        h('dd', {}, `${state.expansions} / ${expansionCap(state)}`),
      ),
    ];
    if (state.castleLevel < CASTLE.maxLevel) {
      nodes.push(
        h('h3', {}, `Lv.${next} 解鎖`),
        h(
          'p',
          { class: 'muted' },
          unlocks.length ? unlocks.map((u) => u.name).join('、') : '—',
          h('br'),
          `建築可升到 Lv.${Math.min(MAX_BUILDING_LEVEL, next)}・土地上限 ${CASTLE.expansionCap[next - 1]}・生命 ${CASTLE.hp[next - 1]}`,
        ),
        h(
          'button',
          { class: 'btn primary', disabled: !up.ok, onclick: () => this.actions.upgradeCastle() },
          `升級主堡到 Lv.${next}`,
          h('small', {}, `（${castleUpgradeCost(state)} 金）`),
        ),
      );
    }
    nodes.push(
      h(
        'button',
        { class: 'btn', disabled: repair <= 0 || state.gold <= 0, onclick: () => this.actions.repairCastle() },
        repair > 0 ? '修復主堡' : '主堡完好',
        repair > 0 ? h('small', {}, `（全修 ${repair} 金，不足則部分修復）`) : null,
      ),
    );
    return nodes;
  }

  private expandPanel(state: GameState, sel: Selection): Node[] {
    const check = canExpand(state, sel.i, sel.j);
    return [
      h('h2', {}, '未開墾的土地'),
      h('p', {}, '擴張後可以在這裡建造建築。最多可擴張到 5×5，可擴張的數量由主堡等級決定。'),
      h('dl', { class: 'stats' }, h('dt', {}, '已擴張'), h('dd', {}, `${state.expansions} / ${expansionCap(state)}`)),
      h('button', { class: 'btn primary', disabled: !check.ok, onclick: () => this.actions.expand() }, '擴張土地', check.cost !== undefined ? h('small', {}, `（${check.cost} 金）`) : null),
      !check.ok ? h('p', { class: 'muted', style: 'text-align:center;font-size:12px' }, check.reason) : null,
    ].filter(Boolean) as Node[];
  }

  // ---------------------------------------------------------------- right panel

  private renderRight(state: GameState, battle: Battle | null): void {
    const r = RACE_MAP.get(state.race)!;
    const wave = waveForState(state);
    const counts = [...wave.groups];
    const enemyRows = [
      ...(wave.boss ? [{ unit: wave.boss, count: 1 }] : []),
      ...counts,
    ].map((g) => {
      const u = getUnit(g.unit);
      const row = h(
        'div',
        { class: `enemy-row ${u.boss ? 'boss' : ''}` },
        h('span', { class: 'enemy-dot', style: `background:${ENEMY_COLORS[u.id] ?? FACTION_DOT[u.id.slice(0, 2)] ?? '#aaa'}` }),
        h('span', {}, u.name, ' ', ...unitTags(u).map((t) => h('span', { class: 'tag' }, t))),
        h('span', { class: 'count' }, `×${g.count}`),
      );
      return this.tip(row, () => this.unitTip(u));
    });

    const built = new Set(state.tiles.filter((t) => t.building).map((t) => t.building!.defId));
    const builtUnits = new Set([...built].map((id) => BUILDINGS.get(id)?.unit).filter(Boolean) as string[]);
    const synergyCards = r.synergies.map((s) => {
      const active = s.parts.every((p) => built.has(p) || builtUnits.has(p));
      const names = s.parts.map((p) => (BUILDINGS.has(p) ? getBuilding(p).name : getUnit(p).name)).join(' + ');
      return h('div', { class: `synergy ${active ? 'active' : ''}` }, h('span', { class: 'state' }, active ? '已啟動' : '未啟動'), h('b', {}, s.name), h('br'), h('span', { class: 'muted' }, names), h('br'), s.desc);
    });

    const nodes: Node[] = [
      state.level ? this.levelInfo(state) : null,
      h('h3', { style: state.level ? '' : 'margin-top:0' }, battle ? `本波敵軍・第 ${state.wave} 波` : `下一波・第 ${state.wave} 波`),
      wave.title ? h('p', { style: 'color:#fde68a;font-weight:700;margin-top:0' }, wave.title) : null,
      ...enemyRows,
    ].filter(Boolean) as Node[];
    if (!battle) {
      const income = projectedIncome(state);
      nodes.push(
        h('h3', {}, '預計收入（不含擊殺獎勵）'),
        h('div', { class: 'report-lines' }, income.map((l) => h('div', {}, h('span', {}, l.label), h('b', {}, `+${l.amount}`)))),
      );
    }
    nodes.push(
      h('h3', {}, `種族特性・${r.passive.name}`),
      h('p', { style: 'font-size:12px' }, r.passive.desc),
      h('h3', {}, '協同組合'),
      ...synergyCards,
    );
    if (state.level && state.perks.length) {
      nodes.push(
        h('h3', {}, '收復領地的加成'),
        ...campaignPerkDefs(state.perks).map((p) => h('div', { class: 'synergy active' }, h('b', {}, p.name), h('br'), p.desc)),
      );
    }
    if (state.boons.length) {
      nodes.push(
        h('h3', {}, '已獲得的祝福'),
        ...state.boons.map((id) => {
          const b = BOON_MAP.get(id)!;
          return h('div', { class: 'synergy' }, h('b', {}, b.name), h('br'), b.desc);
        }),
      );
    }
    if (state.report && !battle) {
      const rep = state.report;
      nodes.push(
        h('h3', {}, `上一波戰報・第 ${rep.wave} 波`),
        h(
          'div',
          { class: 'report-lines' },
          h('div', {}, h('span', {}, '擊殺'), h('b', {}, rep.kills)),
          h('div', {}, h('span', {}, '我方陣亡'), h('b', {}, rep.deaths)),
          h('div', {}, h('span', {}, '主堡受損'), h('b', {}, rep.castleDamage)),
          rep.castleRepair ? h('div', {}, h('span', {}, '聖所修復'), h('b', {}, `+${rep.castleRepair}`)) : null,
          ...rep.income.map((l) => h('div', {}, h('span', {}, l.label), h('b', { style: 'color:#fde68a' }, `+${l.amount}`))),
        ),
      );
    }
    this.right.replaceChildren(...nodes);
  }

  private levelInfo(state: GameState): HTMLElement {
    const terrain = TERRAINS[state.level!.terrain];
    return h(
      'div',
      { class: 'synergy', style: 'margin-top:0' },
      h('b', {}, `⚑ ${state.level!.name}`),
      h('br'),
      h('span', { class: 'muted' }, `地形：${terrain.name}`),
      h('br'),
      terrain.effect,
    );
  }

  // ---------------------------------------------------------------- modals

  showBoons(state: GameState): void {
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:820px' },
      h('h1', {}, '✨ 選擇一項祝福'),
      h('p', { class: 'subtitle' }, `撐過了第 ${state.wave - 1} 波！從以下三項永久強化中選擇一項。`),
      h(
        'div',
        { class: 'boon-grid' },
        state.boonChoices.map((id) => {
          const b = BOON_MAP.get(id)!;
          return h(
            'button',
            { class: 'boon', onclick: () => this.actions.chooseBoon(id) },
            b.race ? h('div', { class: 'race-tag' }, `${RACE_MAP.get(b.race)!.name}專屬`) : null,
            h('div', { class: 'bname' }, b.name),
            h('div', {}, b.desc),
          );
        }),
      ),
    );
    this.overlay.replaceChildren(modal);
    this.overlay.classList.remove('hidden');
  }

  showGameOver(state: GameState): void {
    const r = RACE_MAP.get(state.race)!;
    if (state.level) {
      const modal = h(
        'div',
        { class: 'modal', style: 'max-width:520px;text-align:center' },
        h('h1', { style: 'color:#f87171' }, '收復失敗'),
        h('p', { class: 'subtitle' }, `${state.level.name}的守軍擊退了我們（第 ${state.wave} / ${state.level.totalWaves} 波）。重整旗鼓，再戰一次！`),
        this.summary(state),
        h('button', { class: 'btn primary', onclick: () => this.actions.retry() }, '重新挑戰'),
        h('button', { class: 'btn', onclick: () => this.actions.backToMap() }, '返回世界地圖'),
      );
      this.overlay.replaceChildren(modal);
      this.overlay.classList.remove('hidden');
      return;
    }
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:520px;text-align:center' },
      h('h1', { style: 'color:#f87171' }, '主堡淪陷'),
      h('p', { class: 'subtitle' }, `${r.name}王國在第 ${state.wave} 波倒下了。`),
      this.summary(state),
      h('button', { class: 'btn primary', onclick: () => this.actions.backToTitle() }, '再玩一次'),
    );
    this.overlay.replaceChildren(modal);
    this.overlay.classList.remove('hidden');
  }

  showVictory(state: GameState): void {
    const r = RACE_MAP.get(state.race)!;
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:540px;text-align:center' },
      h('h1', { style: 'color:#fde68a' }, '🏆 勝利！'),
      h('p', { class: 'subtitle' }, `${r.name}王國擊敗了死亡騎士，撐過全部 ${FINAL_WAVE} 波！`),
      this.summary(state),
      h('button', { class: 'btn primary', onclick: () => this.actions.continueEndless() }, '繼續挑戰無盡模式'),
      h('button', { class: 'btn', onclick: () => this.actions.backToTitle() }, '回到標題'),
    );
    this.overlay.replaceChildren(modal);
    this.overlay.classList.remove('hidden');
  }

  private summary(state: GameState): HTMLElement {
    return h(
      'div',
      { class: 'report-lines', style: 'text-align:left' },
      state.phase === 'over'
        ? h('div', {}, h('span', {}, '倒下的波數'), h('b', {}, state.wave))
        : h('div', {}, h('span', {}, '撐過的波數'), h('b', {}, state.wave - 1)),
      h('div', {}, h('span', {}, '總擊殺'), h('b', {}, state.stats.kills)),
      h('div', {}, h('span', {}, '我方陣亡'), h('b', {}, state.stats.deaths)),
      h('div', {}, h('span', {}, '總收入'), h('b', {}, state.stats.goldEarned)),
      h('div', {}, h('span', {}, '主堡等級'), h('b', {}, state.castleLevel)),
      state.level ? null : h('div', {}, h('span', {}, '祝福'), h('b', {}, state.boons.map((b) => BOON_MAP.get(b)!.name).join('、') || '—')),
    );
  }

  showHelp(campaign = false): void {
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:640px' },
      h('h1', {}, '遊戲說明'),
      h(
        'div',
        { style: 'line-height:1.8;margin-top:12px' },
        h('p', {}, '🏰 中央是你的主堡。點選空地建造建築，點選建築可以升級或拆除。'),
        h('p', {}, '💰 金幣在每波結束時結算：主堡稅收＋資源建築產出＋擊殺獎勵。'),
        h('p', {}, '⚔ 兵營會在戰鬥中自動出兵，上限與速度隨等級提升；每波結束後士兵會解散。'),
        h('p', {}, '🚩 開戰前可選擇作戰姿態：堅守（留在塔的射程內）、迎擊（集結後推進到中場）、突擊（全軍壓上）。衝鋒型兵種會比隊伍更積極地往前。'),
        h('p', {}, '🗼 防禦塔自動攻擊射程內的敵人。注意有些兵種與塔無法攻擊飛行單位！'),
        h('p', {}, '🧩 相鄰加成：兵營相鄰兵營出兵更快，資源相鄰資源產量更高，塔相鄰塔傷害更高。'),
        h('p', {}, '↘ 敵人永遠從右下方來襲，最靠近前線的建築會先被攻擊。被摧毀的建築戰後自動修復，主堡的損傷會保留，需要花金幣修復。'),
        campaign
          ? h('p', {}, '⭐ 主堡等級決定能蓋什麼、能升到幾級、能擴張多少土地。每塊領地都從新的九宮格與 Lv.1 主堡開始。')
          : h('p', {}, '⭐ 主堡等級決定能蓋什麼、能升到幾級、能擴張多少土地。每 5 波可以選一項祝福。'),
        campaign
          ? h('p', {}, '🗺 擊退全部敵軍（最後一波是首領）就能收復領地。收復的領地會給予永久加成或特殊建築，地形則會影響這場戰鬥。')
          : h('p', {}, '🏆 撐過 30 波（第 10、20、30 波有首領）即可獲勝，之後可挑戰無盡模式。'),
        h('p', { class: 'muted' }, '快捷鍵：空白鍵開始下一波・1/2/3 切換速度・Q/W/E 切換作戰姿態・Esc 取消選取'),
      ),
      h('button', { class: 'btn primary', onclick: () => this.closeOverlay() }, '知道了'),
    );
    this.overlay.replaceChildren(modal);
    this.overlay.classList.remove('hidden');
  }

  get overlayOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }
}
