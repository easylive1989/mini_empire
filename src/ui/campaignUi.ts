import {
  campaignPerkDefs,
  campaignPerks,
  campaignUnlocks,
  isAttackable,
  isConquered,
  isReplayable,
  STAR_RULES,
  starTotal,
  startingGold,
  territoryStars,
  type BattleRecord,
  type CampaignState,
} from '../game/campaign/campaign';
import { getCampaignWave, territoryWaveCount } from '../game/campaign/campaignWaves';
import { DOCTRINE_IDS, doctrineDesc, doctrineInfo, type DoctrineId } from '../game/campaign/doctrines';
import { PERK_MAP } from '../game/campaign/perks';
import { DEMON_LORD, LORE } from '../game/campaign/story';
import { TERRAINS } from '../game/campaign/terrain';
import { TRAITS } from '../game/campaign/traits';
import { getTerritory, REGIONS, TERRITORIES, territoryTier, WILD_KIND_NAME, type Territory } from '../game/campaign/territories';
import { FACTIONS } from '../game/data/factions';
import { getBuilding, getUnit, RACE_MAP } from '../game/data/index';
import type { CutsceneFrame } from '../render/cutscene';
import { RACE_MASCOT } from '../render/portraits';
import type { ViewInsets } from '../render/world';
import { h } from './dom';
import { coinIcon, crest, icon, type IconName } from './icons';
import { medallion, ornate, type Ui } from './ui';

export interface CampaignActions {
  continueCampaign(): void;
  newCampaign(): void;
  classic(): void;
  exit(): void;
  skipCutscene(): void;
  /** A cutscene moment that wants a sound: an intertitle card or the finale's logo slam. */
  cue(name: 'card' | 'slam'): void;
  /** Plays the campaign's opening film again (from the title menu). */
  replayIntro(): void;
  selectTerritory(id: string | null): void;
  attack(id: string): void;
  backToTitle(): void;
}

/** Characters revealed per second by the subtitle typewriter. */
const TYPE_SPEED = 16;
/** Seconds of the fade through black at the edges of each shot, and of an intertitle card's fades. */
const SHOT_FADE = 0.5;
const CARD_IN = 0.35;
const CARD_OUT = 0.45;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG ornament from path data, stroked in the current colour. */
function ornament(cls: string, viewBox: string, paths: string[], dots: [number, number, number][] = []): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  for (const [cx, cy, r] of dots) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(cx));
    c.setAttribute('cy', String(cy));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', 'currentColor');
    c.setAttribute('stroke', 'none');
    svg.append(c);
  }
  return svg;
}

/** A corner flourish of the intertitle frame (drawn for the top-left corner, mirrored by CSS). */
const corner = () =>
  ornament(
    'cc-corner',
    '0 0 120 120',
    ['M6 114V30Q6 6 30 6h84', 'M16 100V38q0-22 22-22h62', 'M16 70c0-30 14-46 40-48M70 16c-30 0-46 14-48 40', 'M30 30c10-10 26-6 24 6c-2 9-14 9-14 2c0-5 6-6 8-3'],
    [[30, 30, 2.6], [84, 11, 1.6], [11, 84, 1.6]],
  );
/** The divider above and below an intertitle's line. */
const fleuron = () =>
  ornament('cc-fleuron', '0 0 160 24', ['M4 12h52M104 12h52', 'M80 4c-6 0-10 4-10 8s4 8 10 8s10-4 10-8s-4-8-10-8z', 'M70 12c-6-8-14-8-16 0c-2 6 6 8 8 3M90 12c6-8 14-8 16 0c2 6-6 8-8 3'], [[80, 12, 2.2]]);

type Status = 'liberated' | 'attackable' | 'occupied';

function statusOf(c: CampaignState, id: string): Status {
  return isConquered(c, id) ? 'liberated' : isAttackable(c, id) ? 'attackable' : 'occupied';
}

/** 19 small segments showing how much of the kingdom is liberated (the capital last, in red). */
function progressSegments(c: CampaignState): HTMLElement {
  const color = RACE_MAP.get(c.race)!.color;
  const n = c.conquered.length;
  return h(
    'div',
    { class: 'segs', role: 'img', 'aria-label': `已收復 ${n} / ${TERRITORIES.length}` },
    TERRITORIES.map((_, k) => h('span', { style: k < n ? `background:${color}` : k === TERRITORIES.length - 1 && !c.capitalTaken ? 'background:#c8452f' : '' })),
  );
}

function stars(n: number): HTMLElement {
  return h(
    'span',
    { class: 'stars', 'aria-label': `難度 ${n} 星` },
    Array.from({ length: 5 }, (_, k) => icon('star', 14, k < n ? { fill: true } : { strokeWidth: 1.6, cls: 'empty' })),
  );
}

/** A territory's star rating: three stars, the earned ones gold (`fresh` ones pop in, one after another). */
function rating(got: number, fresh = 0, size = 14): HTMLElement {
  return h(
    'span',
    { class: 'rating', 'aria-label': `評價 ${got} / 3 星` },
    Array.from({ length: 3 }, (_, k) =>
      h('i', { class: `${k < got ? 'on' : ''} ${k >= got - fresh && k < got ? 'fresh' : ''}`, style: `--k:${k}` }, icon('star', size, k < got ? { fill: true } : { strokeWidth: 1.6 })),
    ),
  );
}

/** The three star conditions, each ticked when the best rating has reached it. */
function starRules(best: number): HTMLElement {
  return h(
    'ul',
    { class: 'star-rules' },
    STAR_RULES.map((rule, k) => h('li', { class: k < best ? 'done' : '' }, icon(k < best ? 'check' : 'star', 13, { strokeWidth: 2.2 }), h('span', {}, `${'★'.repeat(k + 1)}　${rule}`))),
  );
}

export class CampaignUi {
  private readonly menu = h('div', { class: 'overlay hidden' });
  private readonly cut = h('div', { class: 'cutscene-layer hidden' });
  private readonly subtitle = h('div', { class: 'subtitle-text' });
  private readonly dots = h('div', { class: 'shot-dots' });
  private readonly chapter = h('div', { class: 'cut-chapter' });
  private readonly fade = h('div', { class: 'cut-fade' });
  private readonly cardEyebrow = h('div', { class: 'cc-eyebrow' });
  private readonly cardText = h('p', { class: 'cc-text' });
  private readonly card = h(
    'div',
    { class: 'cut-card hidden' },
    h('div', { class: 'cc-frame' }, ['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `cc-c ${c}` }, corner())), fleuron(), this.cardEyebrow, this.cardText, fleuron()),
  );
  private readonly slamTitle = h('b', {});
  private readonly slamSub = h('small', {});
  private readonly slam = h('div', { class: 'cut-slam hidden' }, h('i', { class: 'slam-flash' }), h('div', { class: 'slam-logo' }, this.slamTitle, h('span', { class: 'slam-rule' }), this.slamSub));
  private slamShown = false;
  private cutStart = 0;
  private readonly labels = h('div', { class: 'map-labels hidden' });
  private readonly legend = h(
    'div',
    { class: 'map-legend hidden' },
    h('span', {}, h('i', { class: 'lg-free' }), '已收復'),
    h('span', {}, h('i', { class: 'lg-attack' }), '可出征'),
    h('span', {}, h('i', { class: 'lg-enemy' }), '敵軍佔領'),
    h('span', {}, h('i', { class: 'lg-wild' }), '森林・山脈・湖泊無法進入'),
    h('span', { class: 'lg-hint' }, '滾輪縮放・拖曳移動'),
  );
  private readonly mapTop = h('div', { class: 'topbar hidden' });
  private readonly mapLeft = h('div', { class: 'panel left map-left hidden' });
  private readonly mapRight = h('div', { class: 'panel right map-right hidden' });
  private readonly labelEls = new Map<string, HTMLElement>();
  /** Names of the wild regions, drawn over the map. */
  private readonly regionEls = REGIONS.map((g) => h('span', { class: `region-label ${g.kind}` }, g.name, h('small', {}, WILD_KIND_NAME[g.kind])));
  private lastLine = -1;

  constructor(
    root: HTMLElement,
    private readonly actions: CampaignActions,
    private readonly ui: Ui,
  ) {
    const skip = h(
      'button',
      {
        class: 'skip-btn',
        onclick: (e: Event) => {
          e.stopPropagation();
          this.actions.skipCutscene();
        },
      },
      '跳過',
      icon('skip', 16, { strokeWidth: 2 }),
    );
    const fx = h('div', { class: 'cut-fx', 'aria-hidden': 'true' }, h('i', { class: 'fx-grain' }), h('i', { class: 'fx-flick' }), h('i', { class: 'fx-vig' }));
    this.cut.append(
      this.fade,
      fx,
      h('div', { class: 'letterbox top' }, this.chapter),
      h('div', { class: 'letterbox bottom' }, this.subtitle, this.dots),
      this.card,
      this.slam,
      skip,
    );
    // A click anywhere skips too (after a moment, so the click that started the film doesn't).
    this.cut.addEventListener('click', () => {
      if (performance.now() - this.cutStart > 1000) this.actions.skipCutscene();
    });
    for (const t of TERRITORIES) {
      const el = h('button', { class: 'map-label', type: 'button' });
      el.addEventListener('click', () => this.actions.selectTerritory(t.id));
      this.labelEls.set(t.id, el);
      this.labels.append(el);
    }
    for (const el of this.regionEls) this.labels.append(el);
    root.append(this.labels, this.legend, this.mapTop, this.mapLeft, this.mapRight, this.cut, this.menu);
  }

  /** Screen area left free for the world map. */
  get mapInsets(): ViewInsets {
    return { left: 300, right: 362, top: 80, bottom: 40 };
  }

  get menuOpen(): boolean {
    return !this.menu.classList.contains('hidden');
  }

  hideAll(): void {
    for (const el of [this.menu, this.cut, this.labels, this.legend, this.mapTop, this.mapLeft, this.mapRight]) el.classList.add('hidden');
    this.menu.replaceChildren();
  }

  private openMenu(content: HTMLElement, cls = ''): void {
    this.menu.className = `overlay ${cls}`.trim();
    this.menu.replaceChildren(content);
  }

  // ---------------------------------------------------------------- title

  /**
   * The title screen. With `gate` (the first visit of a session) it opens on a press-start screen —
   * browsers only allow sound after a gesture — then the logo slams in on a flash, `onStart` starts
   * the fanfare and music on that beat, the logo glides to its place and the menu pops in row by row.
   */
  showTitleMenu(save: CampaignState | null, classicUnlocked: boolean, opts: { gate?: boolean; onStart?: () => void } = {}): void {
    this.hideAll();
    const item = (cls: string, iconName: IconName, label: string, sub: string, onclick: (() => void) | null, kbd?: string) =>
      h(
        'button',
        { class: `menu-item ${cls}`, disabled: !onclick, onclick: onclick ?? undefined },
        h('span', { class: 'mi-icon' }, icon(iconName, cls.includes('primary') ? 16 : 18, cls.includes('primary') ? { fill: true } : { strokeWidth: 1.8 })),
        h('span', { class: 'mi-text' }, h('b', {}, label), sub ? h('small', {}, sub) : null),
        kbd ? h('span', { class: 'kbd' }, kbd) : null,
      );
    const lore = save ? LORE[save.race] : null;
    const screen = h(
      'div',
      { class: 'title-screen' },
      h('div', { class: 'ts-scrim' }),
      h(
        'div',
        { class: 'ts-col' },
        h('div', { class: 'eyebrow wide' }, '序章　王國的黃昏'),
        h('h1', { class: 'ts-logo' }, '迷你帝國'),
        h('div', { class: 'ts-tagline' }, h('i', {}), h('span', {}, '王子的復國之戰'), h('i', { class: 'fade' })),
        h(
          'nav',
          { class: 'ts-menu', 'aria-label': '主選單' },
          save && lore ? item('primary', 'play', '繼續遊戲', `${lore.kingdom}・已收復 ${save.conquered.length} / ${TERRITORIES.length} 塊領地`, () => this.actions.continueCampaign(), 'Enter') : null,
          item(
            '',
            'flag',
            save ? '開始新戰役' : '開始遊戲',
            save ? '選擇王國，從曙光堡重新出發' : '王國危在旦夕，王子必須奪回失土',
            () => (save ? this.confirm('開始新的戰役會覆蓋目前的進度，確定嗎？', () => this.actions.newCampaign(), () => this.showTitleMenu(save, classicUnlocked)) : this.actions.newCampaign()),
          ),
          classicUnlocked
            ? item('', 'sparkle', '無盡挑戰', '經典 30 波守城與無盡模式', () => this.actions.classic())
            : item('locked', 'lock', '無盡挑戰', '收復王城後解鎖經典 30 波守城', null),
          save ? item('plain', 'replay', '重看開場動畫', '', () => this.actions.replayIntro()) : null,
          item('plain', 'exit', '離開', '', () => this.actions.exit()),
        ),
      ),
      h('div', { class: 'ts-foot' }, ...this.ui.toggleButtons(), h('span', { class: 'muted small' }, '3D 素材：KayKit（CC0）')),
      save ? this.saveCard(save) : null,
    );
    this.openMenu(screen, 'title-overlay');
    this.runTitle(screen, opts);
  }

  /** The title's entrance: press-start gate, logo slam and glide, then the menu cascade. */
  private runTitle(screen: HTMLElement, opts: { gate?: boolean; onStart?: () => void }): void {
    const col = screen.querySelector<HTMLElement>('.ts-col')!;
    let k = 0;
    for (const el of [...col.children, ...col.querySelectorAll('.ts-menu > *'), ...screen.querySelectorAll(':scope > .ts-foot, :scope > .save-card')]) {
      if (!el.classList.contains('ts-menu')) (el as HTMLElement).style.setProperty('--i', String(k++));
    }
    const stage = (name: string) => {
      screen.classList.remove('ts-wait', 'ts-slam', 'ts-in', 'ts-done', 'ts-quick');
      screen.classList.add(name);
    };
    if (!opts.gate) {
      stage('ts-quick');
      return;
    }
    const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
    const big = h('div', { class: 'ts-big', 'aria-hidden': 'true' }, h('b', {}, '迷你帝國'), h('span', {}, '王子的復國之戰'));
    screen.append(
      h(
        'div',
        { class: 'ts-gate' },
        h('div', { class: 'ts-presents' }, '王國編年史・卷一'),
        h('div', { class: 'ts-press' }, fleuron(), h('span', {}, touch ? '輕觸畫面開始' : '按任意鍵開始'), fleuron()),
      ),
      h('i', { class: 'ts-flash' }),
      big,
    );
    stage('ts-wait');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.removeEventListener('keydown', onKey, true);
      screen.removeEventListener('pointerdown', start, true);
      opts.onStart?.();
      if (reduced) return stage('ts-done');
      stage('ts-slam');
      // The logo flies from the middle of the screen into the menu's title.
      setTimeout(() => {
        const logo = col.querySelector<HTMLElement>('.ts-logo')!;
        const a = big.querySelector('b')!.getBoundingClientRect();
        const b = logo.getBoundingClientRect();
        stage('ts-in');
        const anim = big.animate(
          [{ transform: 'none' }, { transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${b.height / a.height})`, opacity: 1 }],
          { duration: 750, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'forwards' },
        );
        anim.onfinish = () => screen.classList.add('ts-done');
      }, 1100);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!screen.isConnected) return window.removeEventListener('keydown', onKey, true);
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      start(e);
    };
    window.addEventListener('keydown', onKey, true);
    screen.addEventListener('pointerdown', start, true);
  }

  private saveCard(save: CampaignState): HTMLElement {
    const r = RACE_MAP.get(save.race)!;
    const lore = LORE[save.race];
    const portrait = this.ui.portraits.get(save.race);
    return h(
      'section',
      { class: 'save-card', 'aria-label': '目前存檔', style: `--c:${r.color}` },
      h('div', { class: 'sc-portrait' }, portrait ? h('img', { src: portrait, alt: getUnit(RACE_MASCOT[save.race]).name }) : crest(r.color, 40)),
      h(
        'div',
        { class: 'sc-body' },
        h('div', { class: 'eyebrow' }, '目前存檔'),
        h('b', { class: 'sc-name' }, lore.kingdom),
        h('div', { class: 'muted small' }, `${lore.prince}・${r.name}・${save.capitalTaken ? `${lore.capital}已光復` : `目標：${lore.capital}`}`),
        progressSegments(save),
        h(
          'div',
          { class: 'kv small' },
          h('span', {}, `已收復 ${save.conquered.length} / ${TERRITORIES.length}`),
          h('span', { class: 'star-total' }, icon('star', 12, { fill: true }), `${starTotal(save).got} / ${starTotal(save).max}`),
          h('span', {}, `勝 ${save.victories}`),
        ),
      ),
    );
  }

  confirm(text: string, onYes: () => void, onNo?: () => void): void {
    const box = ornate(
      h(
        'div',
        { class: 'modal narrow center', role: 'dialog' },
        medallion('help'),
        h('h1', {}, '確認'),
        h('p', { class: 'subtitle' }, text),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn danger', onclick: onYes }, '確定'), h('button', { class: 'btn', onclick: () => (onNo ? onNo() : this.hideAll()) }, '取消')),
      ),
    );
    this.openMenu(box);
  }

  showFarewell(onBack: () => void): void {
    this.hideAll();
    this.openMenu(
      ornate(
        h(
          'div',
          { class: 'modal narrow center', role: 'dialog' },
          medallion('flag'),
          h('h1', {}, '感謝遊玩！'),
          h('p', { class: 'subtitle' }, '王國會等待王子歸來。現在可以關閉這個分頁了。'),
          h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: onBack }, icon('home', 18), '回到標題')),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------- cutscene

  showCutscene(): void {
    this.hideAll();
    this.lastLine = -1;
    this.slamShown = false;
    this.cutStart = performance.now();
    this.subtitle.replaceChildren();
    this.chapter.replaceChildren();
    this.card.classList.add('hidden');
    this.slam.classList.add('hidden');
    this.fade.style.opacity = '1';
    this.cut.classList.remove('hidden', 'opening');
    void this.cut.offsetWidth;
    this.cut.classList.add('opening');
  }

  /** A new beat: the card or the shot's chapter heading, and its subtitle one character at a time. */
  private startBeat(frame: CutsceneFrame): void {
    const line = frame.line!;
    this.lastLine = frame.index;
    this.dots.replaceChildren(...Array.from({ length: frame.count }, (_, k) => h('span', { class: k === frame.index ? 'on' : k < frame.index ? 'done' : '' })));
    const isCard = line.shot === 'card';
    this.card.classList.toggle('hidden', !isCard);
    this.subtitle.replaceChildren();
    if (isCard) {
      this.cardEyebrow.textContent = line.eyebrow ?? '';
      this.cardText.textContent = line.text;
      this.card.classList.remove('card-in');
      void this.card.offsetWidth;
      this.card.classList.add('card-in');
      this.chapter.replaceChildren();
      this.actions.cue('card');
      return;
    }
    // Each character fades in on its own delay: no per-frame text updates.
    this.subtitle.append(...[...line.text].map((ch, k) => h('span', { style: `animation-delay:${(k / TYPE_SPEED).toFixed(3)}s` }, ch)));
    const [part, name] = (line.chapter ?? '').split('・');
    this.chapter.replaceChildren(...(line.chapter ? [h('small', {}, part), h('b', {}, name ?? '')] : []));
    this.chapter.classList.remove('in');
    void this.chapter.offsetWidth;
    this.chapter.classList.add('in');
  }

  updateCutscene(frame: CutsceneFrame): void {
    const line = frame.line;
    if (!line) return;
    if (frame.index !== this.lastLine) this.startBeat(frame);
    const t = frame.lineTime;
    const left = line.duration - t;
    if (line.shot === 'card') {
      // Cards sit on black; they fade in and out themselves.
      this.fade.style.opacity = '1';
      this.card.style.opacity = String(Math.max(0, Math.min(1, t / CARD_IN, left / CARD_OUT)));
      return;
    }
    // Shots fade up from black and back down into it.
    this.fade.style.opacity = String(Math.max(0, 1 - Math.min(t, left) / SHOT_FADE));
    let sub = Math.min(1, left / 0.6, t / 0.3);
    const slam = line.slam;
    if (slam) {
      // The subtitle clears the stage for the logo.
      sub = Math.min(sub, Math.max(0, 1 - (t - (slam.at - 0.4)) / 0.3));
      if (t >= slam.at && !this.slamShown) {
        this.slamShown = true;
        this.slamTitle.textContent = slam.title;
        this.slamSub.textContent = slam.sub;
        this.slam.classList.remove('hidden', 'go');
        void this.slam.offsetWidth;
        this.slam.classList.add('go');
        this.actions.cue('slam');
      }
    }
    this.subtitle.style.opacity = String(Math.max(0, sub));
  }

  // ---------------------------------------------------------------- world map

  showMap(c: CampaignState, selected: string | null): void {
    this.hideAll();
    for (const el of [this.labels, this.legend, this.mapTop, this.mapLeft, this.mapRight]) el.classList.remove('hidden');
    this.renderMap(c, selected);
  }

  renderMap(c: CampaignState, selected: string | null): void {
    const race = RACE_MAP.get(c.race)!;
    const lore = LORE[c.race];
    document.documentElement.style.setProperty('--race', race.color);
    this.mapTop.replaceChildren(
      h('div', { class: 'hud-crest wide' }, crest(race.color, 26), h('div', {}, h('b', {}, lore.kingdom), h('small', {}, `${lore.prince}・${race.name}`))),
      h(
        'div',
        { class: 'hud-center row' },
        h('span', { class: 'eyebrow' }, '收復進度'),
        progressSegments(c),
        h('span', { class: 'num big' }, String(c.conquered.length), h('em', {}, ` / ${TERRITORIES.length}`)),
        h('span', { class: 'muted small' }, c.capitalTaken ? `${lore.capital}已光復` : `目標：奪回${lore.capital}`),
      ),
      h(
        'div',
        { class: 'hud-actions' },
        ...this.ui.toggleButtons(),
        h('button', { class: 'icon-btn', 'aria-label': '回到標題', title: '回到標題', onclick: () => this.actions.backToTitle() }, icon('home', 18)),
      ),
    );

    const perks = campaignPerkDefs(campaignPerks(c));
    const unlocks = campaignUnlocks(c).map((id) => getBuilding(id));
    this.mapLeft.replaceChildren(
      h('div', { class: 'p-head' }, h('h2', {}, '王國的力量'), h('p', { class: 'muted small' }, '每收復一塊領地，往後的每場戰鬥都更有利。')),
      h('div', { class: 'sec-title' }, h('span', {}, '永久加成'), h('small', { class: 'num' }, String(perks.length))),
      h(
        'div',
        { class: 'perk-list' },
        perks.map((p) => h('div', { class: 'perk-row' }, h('span', { class: 'perk-ico' }, icon('up', 13, { strokeWidth: 2.2 })), h('span', {}, h('b', {}, p.name), h('small', {}, p.desc)))),
      ),
      h('div', { class: 'sec-title' }, h('span', {}, '特殊建築'), h('small', { class: 'num' }, String(unlocks.length))),
      unlocks.length
        ? h('div', { class: 'perk-list' }, unlocks.map((b) => h('div', { class: 'special-row' }, icon('sparkle', 16), h('span', {}, h('b', {}, b.name), h('small', {}, b.desc.replace(/（收復.*$/, ''))))))
        : h('p', { class: 'muted small' }, '收復特定領地可以解鎖每場戰鬥都能建造的特殊建築。'),
      h(
        'div',
        { class: 'tiles three push' },
        h('div', { class: 'tile' }, h('b', { class: 'num' }, String(c.battles)), h('small', {}, '出征')),
        h('div', { class: 'tile' }, h('b', { class: 'num' }, String(c.victories)), h('small', {}, '勝利')),
        h('div', { class: 'tile' }, h('b', { class: 'num' }, c.kills.toLocaleString('en-US')), h('small', {}, '擊殺')),
      ),
    );
    this.mapRight.replaceChildren(...this.territoryPanel(c, selected));
    for (const t of TERRITORIES) {
      const el = this.labelEls.get(t.id)!;
      const status = statusOf(c, t.id);
      el.className = `map-label ${status} ${t.id === selected ? 'selected' : ''} ${t.capital ? 'capital' : ''}`;
      el.style.setProperty('--fc', t.faction ? FACTIONS[t.faction].color : race.color);
      const mark =
        status === 'liberated'
          ? icon('flag', 11, { strokeWidth: 2.6 })
          : status === 'attackable'
            ? icon('swords', 12, { strokeWidth: 2.4 })
            : h('i', { class: 'dot' });
      el.replaceChildren(mark, t.name, ...(isReplayable(c, t.id) ? [rating(territoryStars(c, t.id), 0, 9)] : []));
      el.setAttribute('aria-label', `${t.name}（${status === 'liberated' ? '已收復' : status === 'attackable' ? '可出征' : '敵軍佔領'}）`);
    }
  }

  private territoryPanel(c: CampaignState, id: string | null): Node[] {
    if (!id) {
      return [
        h('div', { class: 'p-head' }, h('div', { class: 'eyebrow' }, '世界地圖'), h('h2', {}, '選擇出征的領地')),
        h('p', {}, `${DEMON_LORD}的軍隊佔領了整個王國。點選一塊領地查看情報；閃著金框的領地與我方相鄰，可以出征。`),
        h(
          'div',
          { class: 'guide' },
          h('div', {}, icon('swords', 18), h('span', {}, '只能進攻與已收復領地相鄰的格子')),
          h('div', {}, icon('up', 18), h('span', {}, '收復越多領地，往後的戰鬥越輕鬆')),
          h('div', {}, icon('castle', 18), h('span', {}, '也可以直取王城，但會更加艱難')),
        ),
      ];
    }
    const t = getTerritory(id);
    const terrain = TERRAINS[t.terrain];
    const tier = territoryTier(t);
    const status = statusOf(c, t.id);
    const nodes: Node[] = [];
    if (t.faction) {
      const f = FACTIONS[t.faction];
      nodes.push(h('div', { class: 'p-head row' }, h('span', { class: 'faction-chip', style: `--fc:${f.color}` }, h('i', {}), status === 'liberated' ? '已收復' : `${f.name}佔領`), stars(tier)));
    } else {
      nodes.push(h('div', { class: 'p-head row' }, h('span', { class: 'faction-chip', style: `--fc:${RACE_MAP.get(c.race)!.color}` }, h('i', {}), '王子的據點')));
    }
    nodes.push(h('div', {}, h('h2', { class: 'terr-name' }, t.name), h('p', { class: 'muted' }, t.desc)));
    if (t.faction) {
      const total = territoryWaveCount(t.id);
      const boss = getCampaignWave(t.id, total).boss;
      const bossUnit = boss ? getUnit(boss) : null;
      nodes.push(
        h(
          'div',
          { class: 'tiles two' },
          h('div', { class: 'tile left' }, h('small', {}, '波數'), h('b', { class: 'num' }, String(total))),
          h('div', { class: 'tile left' }, h('small', {}, '起始金幣'), h('b', { class: 'num' }, coinIcon(16), startingGold(c, t.id).toLocaleString('en-US'))),
          bossUnit
            ? h('div', { class: 'tile left boss span2' }, h('small', {}, '首領'), h('span', {}, h('b', {}, bossUnit.name), bossUnit.role.includes('首領') ? null : h('em', {}, `・${bossUnit.role}`)))
            : null,
        ),
      );
    }
    nodes.push(h('div', { class: 'sec-title' }, h('span', {}, `地形・${terrain.name}`)), h('p', { class: 'small' }, terrain.effect));
    if (t.trait && status !== 'liberated') {
      const trait = TRAITS[t.trait];
      nodes.push(h('div', { class: 'sec-title' }, h('span', {}, `敵軍特性・${trait.name}`)), h('p', { class: 'small' }, `${trait.desc}對策：${trait.answer}。`));
    }
    nodes.push(h('div', { class: 'sec-title' }, h('span', {}, '收復獎勵')), this.rewardCard(t));
    if (t.faction) {
      const best = territoryStars(c, t.id);
      nodes.push(h('div', { class: 'sec-title' }, h('span', {}, '戰功評價'), rating(best)), starRules(best));
    }
    if (t.faction && (status === 'attackable' || (isReplayable(c, t.id) && territoryStars(c, t.id) < 3))) nodes.push(...this.doctrinePicker(c, t));
    if (status === 'liberated') {
      nodes.push(h('div', { class: 'status-pill good' }, icon('check', 16, { strokeWidth: 2.6 }), t.start ? '王子的據點' : '已收復'));
      if (isReplayable(c, t.id) && territoryStars(c, t.id) < 3) {
        nodes.push(
          h(
            'button',
            { class: 'btn replay-btn', onclick: () => this.actions.attack(t.id) },
            icon('replay', 18, { strokeWidth: 2 }),
            h('span', {}, '再戰一次', h('small', {}, '爭取更高的戰功評價（不影響已收復的領地）')),
          ),
        );
      }
    } else if (status === 'attackable') {
      nodes.push(
        h(
          'button',
          { class: 'btn attack cta', onclick: () => this.actions.attack(t.id) },
          icon('swords', 22, { strokeWidth: 2.2 }),
          h('span', {}, `出征${t.name}`, h('small', {}, t.capital ? `最終決戰：${DEMON_LORD}` : `${territoryWaveCount(t.id)} 波・最後一波是首領`)),
        ),
      );
    } else {
      nodes.push(h('div', { class: 'status-pill' }, icon('lock', 16), '必須先收復相鄰的領地'));
    }
    return nodes;
  }

  /** The two war doctrines for the next battle; the one the enemy's trait calls for is marked. */
  private doctrinePicker(c: CampaignState, t: Territory): Node[] {
    const chosen = c.doctrine ?? 'front';
    const suggested: DoctrineId | null = t.trait ? (t.trait === 'shieldwall' ? 'front' : 'ranged') : null;
    const pick = (id: DoctrineId) => () => {
      c.doctrine = id;
      this.actions.selectTerritory(t.id);
    };
    return [
      h('div', { class: 'sec-title' }, h('span', {}, '出征流派')),
      h(
        'div',
        { class: 'doctrine-opts' },
        DOCTRINE_IDS.map((id) =>
          h(
            'button',
            { class: `doctrine-opt ${id === chosen ? 'active' : ''}`, 'aria-pressed': String(id === chosen), onclick: pick(id) },
            h('b', {}, doctrineInfo(c.race, id).name, id === suggested ? h('em', {}, '建議') : null),
            h('span', {}, doctrineDesc(c.race, id)),
          ),
        ),
      ),
    ];
  }

  private rewardCard(t: Territory): HTMLElement {
    const card = (ico: IconName, kind: string, name: string, desc: string, special = false) =>
      h('div', { class: `reward-card ${special ? 'special' : ''}` }, h('span', { class: 'rc-ico' }, icon(ico, 18, { strokeWidth: 2 })), h('span', {}, h('small', {}, kind), h('b', {}, name), h('span', {}, desc)));
    if (t.capital) return card('crown', '最終目標', '王國光復', '擊敗魔王、奪回王城，並解鎖無盡挑戰。');
    if (t.reward.perk) {
      const p = PERK_MAP.get(t.reward.perk)!;
      return card('shield', '永久加成', p.name, p.desc);
    }
    if (t.reward.unlock) {
      const b = getBuilding(t.reward.unlock);
      return card('sparkle', '特殊建築・每場限 1 座', b.name, b.desc.replace(/（收復.*$/, ''), true);
    }
    return card('flag', '', '—', '');
  }

  /** Repositions the territory labels over the 3D map. */
  updateRegionLabels(positions: { x: number; y: number }[]): void {
    positions.forEach((p, k) => {
      const el = this.regionEls[k];
      if (el) el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    });
  }

  updateLabels(positions: { id: string; x: number; y: number }[]): void {
    for (const p of positions) {
      const el = this.labelEls.get(p.id);
      if (el) el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    }
  }

  // ---------------------------------------------------------------- results

  showLiberated(c: CampaignState, id: string, rec: BattleRecord, kills: number, castleDamage: number, onContinue: () => void): void {
    const t = getTerritory(id);
    const improved = rec.stars > rec.prevStars;
    const modal = ornate(
      h(
        'div',
        { class: 'modal narrow center decree', role: 'dialog', style: `--c:${RACE_MAP.get(c.race)!.color}` },
        medallion(t.capital ? 'crown' : 'flag', 'race'),
        h('div', { class: 'eyebrow wide' }, rec.liberated ? '領地收復' : '再次凱旋'),
        h('h1', { class: 'big' }, t.name),
        h('div', { class: 'star-banner' }, rating(rec.stars, rec.stars, 34), improved && rec.prevStars > 0 ? h('span', { class: 'new-best' }, '新紀錄') : null),
        starRules(rec.stars),
        rec.liberated ? h('p', { class: 'subtitle' }, `${t.name}的人民重獲自由，紛紛投入${LORE[c.race].prince}的麾下。`) : null,
        rec.liberated ? this.rewardCard(t) : null,
        h(
          'div',
          { class: 'tiles three' },
          h('div', { class: 'tile' }, h('b', { class: 'num' }, String(kills)), h('small', {}, '本場擊殺')),
          h('div', { class: 'tile' }, h('b', { class: 'num' }, `${Math.round(castleDamage * 100)}%`), h('small', {}, '主堡累計受損')),
          h('div', { class: 'tile' }, h('b', { class: 'num' }, `${c.conquered.length} / ${TERRITORIES.length}`), h('small', {}, '已收復領地')),
        ),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary big', onclick: onContinue }, icon(t.capital ? 'crown' : 'map', 20), t.capital ? '見證王國光復' : '返回世界地圖')),
      ),
    );
    this.openMenu(modal);
  }

  showEnding(c: CampaignState, record: BattleRecord, onMap: () => void, onTitle: () => void): void {
    const lore = LORE[c.race];
    const left = TERRITORIES.length - c.conquered.length;
    const modal = ornate(
      h(
        'div',
        { class: 'modal narrow center decree', role: 'dialog', style: `--c:${RACE_MAP.get(c.race)!.color}` },
        medallion(record.allLiberated ? 'star' : 'crown', 'race'),
        h('div', { class: 'eyebrow wide' }, '終章'),
        h('h1', { class: 'big' }, record.allLiberated ? '天下一統' : '王國光復'),
        h('p', { class: 'subtitle' }, `${lore.prince}奪回了${lore.capital}，${lore.kingdom}迎來了新的紀元。`),
        h('div', { class: 'reward-card special' }, h('span', { class: 'rc-ico' }, icon('sparkle', 18)), h('span', {}, h('small', {}, '已解鎖'), h('b', {}, '無盡挑戰'), h('span', {}, '在標題畫面挑戰經典的 30 波守城與無盡模式。'))),
        record.allLiberated
          ? h('div', { class: 'reward-card' }, h('span', { class: 'rc-ico' }, icon('crown', 18)), h('span', {}, h('small', {}, '稱號'), h('b', {}, '統一大陸的王'), h('span', {}, '全部領地都已收復！')))
          : h('p', { class: 'muted small' }, `還有 ${left} 塊領地在敵人手中，全部收復可得到「統一大陸的王」稱號。`),
        h(
          'div',
          { class: 'tiles two' },
          h('div', { class: 'tile' }, h('b', { class: 'num' }, String(c.battles)), h('small', {}, '出征次數')),
          h('div', { class: 'tile' }, h('b', { class: 'num' }, c.kills.toLocaleString('en-US')), h('small', {}, '總擊殺')),
        ),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn primary', onclick: onMap }, icon('map', 18), record.allLiberated ? '返回世界地圖' : '繼續收復領地'),
          h('button', { class: 'btn', onclick: onTitle }, icon('home', 18), '回到標題'),
        ),
      ),
    );
    this.openMenu(modal);
  }

  showFullClear(c: CampaignState, onContinue: () => void): void {
    const lore = LORE[c.race];
    const modal = ornate(
      h(
        'div',
        { class: 'modal narrow center decree', role: 'dialog', style: `--c:${RACE_MAP.get(c.race)!.color}` },
        medallion('star', 'race'),
        h('div', { class: 'eyebrow wide' }, '全境光復'),
        h('h1', { class: 'big' }, '天下一統'),
        h('p', { class: 'subtitle' }, `全部 ${TERRITORIES.length} 塊領地都回到了${lore.kingdom}的懷抱。`),
        h('div', { class: 'reward-card' }, h('span', { class: 'rc-ico' }, icon('crown', 18)), h('span', {}, h('small', {}, '稱號'), h('b', {}, '統一大陸的王'), h('span', {}, `${lore.prince}的名字將被永遠傳頌。`))),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: onContinue }, icon('map', 18), '返回世界地圖')),
      ),
    );
    this.openMenu(modal);
  }
}
