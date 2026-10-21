import { isAttackable, isConquered, startingGold, campaignPerkDefs, campaignPerks, campaignUnlocks, type BattleRecord, type CampaignState } from '../game/campaign/campaign';
import { getCampaignWave, territoryWaveCount } from '../game/campaign/campaignWaves';
import { PERK_MAP } from '../game/campaign/perks';
import { DEMON_LORD, LORE } from '../game/campaign/story';
import { TERRAINS } from '../game/campaign/terrain';
import { CAPITAL_TERRITORY, getTerritory, TERRITORIES, territoryTier, type Territory } from '../game/campaign/territories';
import { getBuilding, getUnit, RACE_MAP } from '../game/data/index';
import { FACTIONS } from '../game/data/factions';
import type { CutsceneFrame } from '../render/cutscene';
import type { ViewInsets } from '../render/world';
import { coin, h } from './dom';
import type { Ui } from './ui';

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

export class CampaignUi {
  private readonly menu = h('div', { class: 'overlay title-overlay hidden' });
  private readonly cut = h('div', { class: 'cutscene-layer hidden' });
  private readonly subtitle = h('div', { class: 'subtitle-text' });
  private readonly dots = h('div', { class: 'shot-dots' });
  private readonly labels = h('div', { class: 'map-labels hidden' });
  private readonly mapTop = h('div', { class: 'topbar hidden' });
  private readonly mapLeft = h('div', { class: 'panel left map-panel hidden' });
  private readonly mapRight = h('div', { class: 'panel right map-panel hidden' });
  private readonly labelEls = new Map<string, HTMLElement>();
  private lastLine = -1;

  constructor(
    root: HTMLElement,
    private readonly actions: CampaignActions,
    private readonly ui: Ui,
  ) {
    const skip = h('button', { class: 'skip-btn', onclick: () => this.actions.skipCutscene() }, '跳過 ⏭');
    this.cut.append(h('div', { class: 'letterbox top' }), h('div', { class: 'letterbox bottom' }, this.subtitle, this.dots), skip);
    for (const t of TERRITORIES) {
      const el = h('div', { class: 'map-label' });
      el.addEventListener('click', () => this.actions.selectTerritory(t.id));
      this.labelEls.set(t.id, el);
      this.labels.append(el);
    }
    root.append(this.labels, this.mapTop, this.mapLeft, this.mapRight, this.cut, this.menu);
  }

  /** Screen area left free for the world map. */
  get mapInsets(): ViewInsets {
    return { left: 300, right: 330, top: 64, bottom: 24 };
  }

  get menuOpen(): boolean {
    return !this.menu.classList.contains('hidden');
  }

  hideAll(): void {
    for (const el of [this.menu, this.cut, this.labels, this.mapTop, this.mapLeft, this.mapRight]) el.classList.add('hidden');
    this.menu.replaceChildren();
  }

  // ---------------------------------------------------------------- title

  showTitleMenu(save: CampaignState | null, classicUnlocked: boolean): void {
    this.hideAll();
    const progress = save ? `${RACE_MAP.get(save.race)!.name}・已收復 ${save.conquered.length} / ${TERRITORIES.length}${save.capitalTaken ? '・王城已光復' : ''}` : '';
    const menu = h(
      'div',
      { class: 'title-menu' },
      h('h1', { class: 'title-logo' }, '迷你帝國'),
      h('div', { class: 'title-tagline' }, '— 王子的復國之戰 —'),
      h(
        'div',
        { class: 'menu-buttons' },
        save ? h('button', { class: 'menu-btn primary', onclick: () => this.actions.continueCampaign() }, '▶ 繼續遊戲', h('small', {}, progress)) : null,
        h(
          'button',
          {
            class: `menu-btn ${save ? '' : 'primary'}`,
            onclick: () => (save ? this.confirm('開始新的戰役會覆蓋目前的進度，確定嗎？', () => this.actions.newCampaign()) : this.actions.newCampaign()),
          },
          '⚔ 開始遊戲',
          h('small', {}, save ? '從頭展開新的戰役' : '王國危在旦夕，王子必須奪回失土'),
        ),
        h(
          'button',
          { class: 'menu-btn', disabled: !classicUnlocked, onclick: () => this.actions.classic() },
          classicUnlocked ? '♾ 無盡挑戰' : '🔒 無盡挑戰',
          h('small', {}, classicUnlocked ? '經典 30 波守城模式' : '收復王城後解鎖'),
        ),
        h('button', { class: 'menu-btn', onclick: () => this.actions.exit() }, '🚪 離開'),
      ),
      h('div', { class: 'menu-footer' }, ...this.ui.audioButtons()),
    );
    this.menu.replaceChildren(menu);
    this.menu.classList.remove('hidden');
  }

  confirm(text: string, onYes: () => void): void {
    const prev = [...this.menu.childNodes];
    const box = h(
      'div',
      { class: 'modal', style: 'max-width:440px;text-align:center' },
      h('h1', { style: 'font-size:24px' }, '確認'),
      h('p', { class: 'subtitle' }, text),
      h('button', { class: 'btn danger', onclick: onYes }, '確定'),
      h('button', { class: 'btn', onclick: () => this.menu.replaceChildren(...prev) }, '取消'),
    );
    this.menu.replaceChildren(box);
    this.menu.classList.remove('hidden');
  }

  showFarewell(onBack: () => void): void {
    this.hideAll();
    this.menu.replaceChildren(
      h(
        'div',
        { class: 'modal', style: 'max-width:480px;text-align:center' },
        h('h1', {}, '感謝遊玩！'),
        h('p', { class: 'subtitle' }, '王國會等待王子歸來。現在可以關閉這個分頁了。'),
        h('button', { class: 'btn', onclick: onBack }, '回到標題'),
      ),
    );
    this.menu.classList.remove('hidden');
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
    for (const el of [this.labels, this.mapTop, this.mapLeft, this.mapRight]) el.classList.remove('hidden');
    this.renderMap(c, selected);
  }

  renderMap(c: CampaignState, selected: string | null): void {
    const race = RACE_MAP.get(c.race)!;
    const lore = LORE[c.race];
    document.documentElement.style.setProperty('--race', race.color);
    this.mapTop.replaceChildren(
      h('div', { class: 'race-badge' }, h('div', { class: 'race-dot' }), h('div', {}, lore.kingdom, h('small', {}, `${lore.prince}・${race.name}`))),
      h('div', { class: 'wave-label' }, `已收復 ${c.conquered.length} / ${TERRITORIES.length} 塊領地`, h('small', {}, c.capitalTaken ? `${lore.capital}已光復` : `目標：奪回${lore.capital}`)),
      ...this.ui.audioButtons(),
      h('button', { class: 'icon-btn', onclick: () => this.actions.backToTitle() }, '🏠 標題'),
    );

    const perks = campaignPerkDefs(campaignPerks(c));
    const unlocks = campaignUnlocks(c).map((id) => getBuilding(id));
    this.mapLeft.replaceChildren(
      h('h2', {}, '王國的力量'),
      h('p', { class: 'muted' }, '每收復一塊領地，往後的每場戰鬥都會更有利。'),
      h('h3', {}, `永久加成（${perks.length}）`),
      ...perks.map((p) => h('div', { class: 'synergy active' }, h('b', {}, p.name), h('br'), p.desc)),
      h('h3', {}, `特殊建築（${unlocks.length}）`),
      ...(unlocks.length
        ? unlocks.map((b) => h('div', { class: 'synergy active' }, h('b', {}, b.name), h('br'), b.desc))
        : [h('p', { class: 'muted' }, '收復特定領地可以解鎖每場戰鬥都能建造的特殊建築。')]),
      h('h3', {}, '戰績'),
      h(
        'div',
        { class: 'report-lines' },
        h('div', {}, h('span', {}, '出征次數'), h('b', {}, c.battles)),
        h('div', {}, h('span', {}, '勝利'), h('b', {}, c.victories)),
        h('div', {}, h('span', {}, '總擊殺'), h('b', {}, c.kills)),
      ),
    );
    this.mapRight.replaceChildren(...this.territoryPanel(c, selected));
    for (const t of TERRITORIES) {
      const el = this.labelEls.get(t.id)!;
      const status = isConquered(c, t.id) ? 'liberated' : isAttackable(c, t.id) ? 'attackable' : 'occupied';
      el.className = `map-label ${status} ${t.id === selected ? 'selected' : ''} ${t.capital ? 'capital' : ''}`;
      const icon = status === 'liberated' ? '⚑' : status === 'attackable' ? '⚔' : t.capital ? '☠' : '';
      el.replaceChildren(icon ? h('span', { class: 'icon' }, icon) : '', t.name);
      el.style.setProperty('--fc', t.faction ? FACTIONS[t.faction].color : race.color);
    }
  }

  private territoryPanel(c: CampaignState, id: string | null): Node[] {
    if (!id) {
      return [
        h('h2', {}, '世界地圖'),
        h('p', {}, `${DEMON_LORD}的軍隊佔領了整個王國。點選一塊領地查看情報，閃爍金框的領地與我方相鄰，可以出征。`),
        h('div', { class: 'hint' }, '收復越多領地，加成越多；', h('br'), '也可以直取王城，但會更加艱難。'),
      ];
    }
    const t = getTerritory(id);
    const terrain = TERRAINS[t.terrain];
    const tier = territoryTier(t);
    const nodes: Node[] = [h('h2', {}, t.name), h('p', { class: 'muted' }, t.desc)];
    if (t.faction) {
      const f = FACTIONS[t.faction];
      const total = territoryWaveCount(t.id);
      const boss = getCampaignWave(t.id, total).boss;
      nodes.push(
        h('div', { class: 'tier' }, '難度 ', h('span', { class: 'stars' }, '★'.repeat(tier) + '☆'.repeat(5 - tier))),
        h('dl', { class: 'stats' }, h('dt', {}, '敵軍'), h('dd', { style: `color:${f.color}` }, f.name), h('dt', {}, '波數'), h('dd', {}, `${total} 波`), h('dt', {}, '首領'), h('dd', {}, boss ? getUnit(boss).name : '—'), h('dt', {}, '起始金幣'), h('dd', {}, coin(), String(startingGold(c, t.id)))),
        h('p', { style: 'font-size:12px' }, f.desc),
      );
    }
    nodes.push(h('h3', {}, `地形・${terrain.name}`), h('p', { style: 'font-size:12px' }, terrain.effect));
    nodes.push(h('h3', {}, '收復獎勵'), this.rewardCard(t));
    if (isConquered(c, t.id)) {
      nodes.push(h('div', { class: 'status-pill good' }, t.start ? '王子的據點' : '✔ 已收復'));
    } else if (isAttackable(c, t.id)) {
      nodes.push(h('button', { class: 'start-btn attack-btn', onclick: () => this.actions.attack(t.id) }, `⚔ 出征${t.name}`, h('small', {}, t.capital ? `最終決戰：${DEMON_LORD}` : '收復這塊領地')));
    } else {
      nodes.push(h('div', { class: 'status-pill' }, '🔒 必須先收復相鄰的領地'));
    }
    return nodes;
  }

  private rewardCard(t: Territory): HTMLElement {
    if (t.capital) return h('div', { class: 'reward-card' }, h('b', {}, '王國光復'), h('br'), '擊敗魔王、奪回王城，並解鎖無盡挑戰。');
    if (t.reward.perk) {
      const p = PERK_MAP.get(t.reward.perk)!;
      return h('div', { class: 'reward-card' }, h('span', { class: 'tag' }, '永久加成'), h('b', {}, p.name), h('br'), p.desc);
    }
    if (t.reward.unlock) {
      const b = getBuilding(t.reward.unlock);
      return h('div', { class: 'reward-card special' }, h('span', { class: 'tag' }, '特殊建築'), h('b', {}, b.name), h('br'), b.desc);
    }
    return h('div', { class: 'reward-card' }, '—');
  }

  /** Repositions the territory labels over the 3D map. */
  updateLabels(positions: { id: string; x: number; y: number }[]): void {
    for (const p of positions) {
      const el = this.labelEls.get(p.id);
      if (el) el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    }
  }

  // ---------------------------------------------------------------- results

  showLiberated(c: CampaignState, id: string, kills: number, onContinue: () => void): void {
    const t = getTerritory(id);
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:520px;text-align:center' },
      h('h1', { style: 'color:#fde68a' }, `🎉 收復了${t.name}！`),
      h('p', { class: 'subtitle' }, `${t.name}的人民重獲自由，紛紛投入${LORE[c.race].prince}的麾下。`),
      h('div', { style: 'text-align:left;margin:12px 0' }, this.rewardCard(t)),
      h('div', { class: 'report-lines', style: 'text-align:left' }, h('div', {}, h('span', {}, '本場擊殺'), h('b', {}, kills)), h('div', {}, h('span', {}, '已收復領地'), h('b', {}, `${c.conquered.length} / ${TERRITORIES.length}`))),
      h('button', { class: 'btn primary', onclick: onContinue }, t.capital ? '見證王國光復' : '返回世界地圖'),
    );
    this.menu.replaceChildren(modal);
    this.menu.classList.remove('hidden');
  }

  showEnding(c: CampaignState, record: BattleRecord, onMap: () => void, onTitle: () => void): void {
    const lore = LORE[c.race];
    const left = TERRITORIES.length - c.conquered.length;
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:560px;text-align:center' },
      h('h1', { class: 'title-logo', style: 'font-size:40px !important' }, record.allLiberated ? '🌟 天下一統' : '👑 王國光復'),
      h('p', { class: 'subtitle' }, `${lore.prince}奪回了${lore.capital}，${lore.kingdom}迎來了新的紀元。`),
      h('div', { class: 'reward-card special', style: 'text-align:left' }, h('b', {}, '已解鎖：無盡挑戰'), h('br'), '在標題畫面挑戰經典的 30 波守城模式與無盡模式。'),
      record.allLiberated
        ? h('div', { class: 'reward-card', style: 'text-align:left;margin-top:8px' }, h('b', {}, '稱號：統一大陸的王'), h('br'), '全部領地都已收復！')
        : h('p', { class: 'muted' }, `還有 ${left} 塊領地在敵人手中，可以繼續收復，拿下「統一大陸的王」稱號。`),
      h('div', { class: 'report-lines', style: 'text-align:left' }, h('div', {}, h('span', {}, '出征次數'), h('b', {}, c.battles)), h('div', {}, h('span', {}, '總擊殺'), h('b', {}, c.kills))),
      h('button', { class: 'btn primary', onclick: onMap }, record.allLiberated ? '返回世界地圖' : '繼續收復領地'),
      h('button', { class: 'btn', onclick: onTitle }, '回到標題'),
    );
    this.menu.replaceChildren(modal);
    this.menu.classList.remove('hidden');
  }

  showFullClear(c: CampaignState, onContinue: () => void): void {
    const lore = LORE[c.race];
    const modal = h(
      'div',
      { class: 'modal', style: 'max-width:520px;text-align:center' },
      h('h1', { class: 'title-logo', style: 'font-size:40px !important' }, '🌟 天下一統'),
      h('p', { class: 'subtitle' }, `全部 ${TERRITORIES.length} 塊領地都回到了${lore.kingdom}的懷抱。`),
      h('div', { class: 'reward-card special', style: 'text-align:left' }, h('b', {}, '稱號：統一大陸的王'), h('br'), `${lore.prince}的名字將被永遠傳頌。`),
      h('button', { class: 'btn primary', onclick: onContinue }, '返回世界地圖'),
    );
    this.menu.replaceChildren(modal);
    this.menu.classList.remove('hidden');
  }

  get capitalId(): string {
    return CAPITAL_TERRITORY.id;
  }
}
