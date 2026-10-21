import { campaignPerkDefs, campaignPerks, campaignUnlocks, isAttackable, isConquered, startingGold, type BattleRecord, type CampaignState } from '../game/campaign/campaign';
import { getCampaignWave, territoryWaveCount } from '../game/campaign/campaignWaves';
import { PERK_MAP } from '../game/campaign/perks';
import { DEMON_LORD, LORE } from '../game/campaign/story';
import { TERRAINS } from '../game/campaign/terrain';
import { getTerritory, TERRITORIES, territoryTier, type Territory } from '../game/campaign/territories';
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
  selectTerritory(id: string | null): void;
  attack(id: string): void;
  backToTitle(): void;
}

/** Characters revealed per second by the subtitle typewriter. */
const TYPE_SPEED = 16;

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

export class CampaignUi {
  private readonly menu = h('div', { class: 'overlay hidden' });
  private readonly cut = h('div', { class: 'cutscene-layer hidden' });
  private readonly subtitle = h('div', { class: 'subtitle-text' });
  private readonly dots = h('div', { class: 'shot-dots' });
  private readonly labels = h('div', { class: 'map-labels hidden' });
  private readonly legend = h(
    'div',
    { class: 'map-legend hidden' },
    h('span', {}, h('i', { class: 'lg-free' }), '已收復'),
    h('span', {}, h('i', { class: 'lg-attack' }), '可出征'),
    h('span', {}, h('i', { class: 'lg-enemy' }), '敵軍佔領'),
  );
  private readonly mapTop = h('div', { class: 'topbar hidden' });
  private readonly mapLeft = h('div', { class: 'panel left map-left hidden' });
  private readonly mapRight = h('div', { class: 'panel right map-right hidden' });
  private readonly labelEls = new Map<string, HTMLElement>();
  private lastLine = -1;

  constructor(
    root: HTMLElement,
    private readonly actions: CampaignActions,
    private readonly ui: Ui,
  ) {
    const skip = h('button', { class: 'skip-btn', onclick: () => this.actions.skipCutscene() }, '跳過', icon('skip', 16, { strokeWidth: 2 }));
    this.cut.append(h('div', { class: 'letterbox top' }), h('div', { class: 'letterbox bottom' }, this.subtitle, this.dots), skip);
    for (const t of TERRITORIES) {
      const el = h('button', { class: 'map-label', type: 'button' });
      el.addEventListener('click', () => this.actions.selectTerritory(t.id));
      this.labelEls.set(t.id, el);
      this.labels.append(el);
    }
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

  showTitleMenu(save: CampaignState | null, classicUnlocked: boolean): void {
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
          item('plain', 'exit', '離開', '', () => this.actions.exit()),
        ),
      ),
      h('div', { class: 'ts-foot' }, ...this.ui.audioButtons(), h('span', { class: 'muted small' }, '3D 素材：KayKit（CC0）')),
      save ? this.saveCard(save) : null,
    );
    this.openMenu(screen, 'title-overlay');
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
        h('div', { class: 'kv small' }, h('span', {}, `已收復 ${save.conquered.length} / ${TERRITORIES.length}`), h('span', {}, `出征 ${save.battles} 次・勝 ${save.victories}`)),
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
    this.subtitle.textContent = '';
    this.cut.classList.remove('hidden');
  }

  updateCutscene(frame: CutsceneFrame): void {
    if (!frame.line) return;
    if (frame.index !== this.lastLine) {
      this.lastLine = frame.index;
      this.dots.replaceChildren(...Array.from({ length: frame.count }, (_, k) => h('span', { class: k === frame.index ? 'on' : k < frame.index ? 'done' : '' })));
    }
    const shown = Math.floor(frame.lineTime * TYPE_SPEED);
    const text = frame.line.text.slice(0, shown);
    if (this.subtitle.textContent !== text) this.subtitle.textContent = text;
    // Fade the subtitle out at the end of each shot.
    const left = frame.line.duration - frame.lineTime;
    this.subtitle.style.opacity = String(Math.min(1, left / 0.6, frame.lineTime / 0.3));
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
        ...this.ui.audioButtons(),
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
      el.replaceChildren(mark, t.name);
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
    nodes.push(h('div', { class: 'sec-title' }, h('span', {}, '收復獎勵')), this.rewardCard(t));
    if (status === 'liberated') {
      nodes.push(h('div', { class: 'status-pill good' }, icon('check', 16, { strokeWidth: 2.6 }), t.start ? '王子的據點' : '已收復'));
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
  updateLabels(positions: { id: string; x: number; y: number }[]): void {
    for (const p of positions) {
      const el = this.labelEls.get(p.id);
      if (el) el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    }
  }

  // ---------------------------------------------------------------- results

  showLiberated(c: CampaignState, id: string, kills: number, castlePct: number, onContinue: () => void): void {
    const t = getTerritory(id);
    const modal = ornate(
      h(
        'div',
        { class: 'modal narrow center decree', role: 'dialog', style: `--c:${RACE_MAP.get(c.race)!.color}` },
        medallion(t.capital ? 'crown' : 'flag', 'race'),
        h('div', { class: 'eyebrow wide' }, '領地收復'),
        h('h1', { class: 'big' }, t.name),
        h('p', { class: 'subtitle' }, `${t.name}的人民重獲自由，紛紛投入${LORE[c.race].prince}的麾下。`),
        this.rewardCard(t),
        h(
          'div',
          { class: 'tiles three' },
          h('div', { class: 'tile' }, h('b', { class: 'num' }, String(kills)), h('small', {}, '本場擊殺')),
          h('div', { class: 'tile' }, h('b', { class: 'num' }, `${Math.round(castlePct * 100)}%`), h('small', {}, '主堡剩餘生命')),
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
