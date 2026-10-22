import './ui/styles.css';
import { loadAudioPrefs, Music, saveAudioPrefs } from './audio/music';
import { Sfx } from './audio/sfx';
import { defeatTip } from './game/advisor';
import { Battle } from './game/battle';
import { BattleCallouts, type Callout } from './game/callouts';
import {
  battleStars,
  createLevelState,
  isAttackable,
  isReplayable,
  isClassicUnlocked,
  loadCampaign,
  newCampaign,
  recordBattle,
  saveCampaign,
  unlockClassic,
  type BattleRecord,
  type CampaignState,
} from './game/campaign/campaign';
import { TERRAINS } from './game/campaign/terrain';
import { getTerritory } from './game/campaign/territories';
import { DT, FINAL_WAVE, GRID_RADIUS } from './game/constants';
import { getBuilding, UNITS } from './game/data/index';
import {
  applyBattleOutcome,
  build,
  canBuild,
  canExpand,
  canUpgrade,
  canUpgradeCastle,
  castleMaxHp,
  expansionCap,
  chooseBoon,
  continueEndless,
  demolish,
  expand,
  isCastleTile,
  newGame,
  repairCastle,
  tileAt,
  upgrade,
  upgradeCastle,
  type GameState,
} from './game/state';
import type { RaceId } from './game/types';
import { loadAssets, type Assets } from './render/assets';
import { BattleView } from './render/battleView';
import { Cutscene } from './render/cutscene';
import { Effects } from './render/effects';
import { MapView } from './render/mapView';
import { BuildingThumbs, renderRacePortraits } from './render/portraits';
import { detectQuality, FrameWatch, loadQuality, PRESETS, saveQuality, type Quality } from './render/quality';
import { TownView } from './render/town';
import { CLASSIC_SETTING, World, type FocusBox } from './render/world';
import { CampaignUi } from './ui/campaignUi';
import { Ui, type Selection } from './ui/ui';

/** Top-level screens of the game. */
type Mode = 'loading' | 'title' | 'raceSelect' | 'cutscene' | 'map' | 'level' | 'classic' | 'farewell';

class App {
  private readonly world: World;
  private readonly ui: Ui;
  private readonly cui: CampaignUi;
  private readonly sfx = new Sfx();
  private readonly music = new Music();
  private assets!: Assets;
  private town!: TownView;
  private fx!: Effects;
  private battleView!: BattleView;
  private map!: MapView;
  private cutscene!: Cutscene;
  private thumbs!: BuildingThumbs;
  private mode: Mode = 'loading';
  private raceSelectMode: 'campaign' | 'classic' = 'campaign';
  private campaign: CampaignState | null = null;
  private levelId: string | null = null;
  private mapSelected: string | null = null;
  private cutsceneKind: 'intro' | 'ending' = 'intro';
  /** Where the intro film leads: the world map (a new campaign) or back to the title (a replay). */
  private cutsceneReturn: 'map' | 'title' = 'map';
  /** Set once the press-start gate has been passed this session. */
  private titleSeen = false;
  private endingRecord: BattleRecord | null = null;
  private state: GameState | null = null;
  private battle: Battle | null = null;
  private callouts = new BattleCallouts();
  private selection: Selection | null = null;
  private speed = 1;
  private acc = 0;
  private last = performance.now();
  private uiTimer = 0;
  /** Set until the player picks a quality; while set, a slow machine is switched to 效能模式 automatically. */
  private frameWatch: FrameWatch | null = null;

  constructor(root: HTMLElement) {
    const saved = loadQuality();
    const quality = saved ?? detectQuality();
    if (!saved && quality === 'high') this.frameWatch = new FrameWatch();
    this.world = new World(root, quality);
    document.documentElement.classList.toggle('perf-low', quality === 'low');
    const prefs = loadAudioPrefs();
    this.sfx.setMuted(!prefs.sfx);
    this.music.setMuted(!prefs.music);
    this.ui = new Ui(root, {
      previewRace: (race) => this.preview(race),
      startGame: (race) => this.startGame(race),
      build: (id) => this.doBuild(id),
      upgrade: () => this.doUpgrade(),
      demolish: () => this.doDemolish(),
      expand: () => this.doExpand(),
      upgradeCastle: () => this.doUpgradeCastle(),
      repairCastle: () => this.doRepair(),
      startWave: () => this.startWave(),
      setSpeed: (s) => (this.speed = s),
      chooseBoon: (id) => this.doChooseBoon(id),
      backToTitle: () => this.goTitle(),
      continueEndless: () => this.doContinueEndless(),
      toggleMusic: () => this.toggleAudio('music'),
      toggleSfx: () => this.toggleAudio('sfx'),
      toggleQuality: () => this.toggleQuality(),
      deselect: () => this.select(null),
      retreat: () => this.goMap(),
      retry: () => this.levelId && this.startLevel(this.levelId),
      backToMap: () => this.goMap(),
    });
    this.ui.audio = prefs;
    this.ui.lowQuality = this.world.quality === 'low';
    this.cui = new CampaignUi(
      root,
      {
        continueCampaign: () => this.continueCampaign(),
        newCampaign: () => this.openRaceSelect('campaign'),
        classic: () => this.openRaceSelect('classic'),
        exit: () => this.exit(),
        skipCutscene: () => this.skipCutscene(),
        cue: (name) => this.cutsceneCue(name),
        replayIntro: () => this.replayIntro(),
        selectTerritory: (id) => this.selectTerritory(id),
        attack: (id) => this.startLevel(id),
        backToTitle: () => this.goTitle(),
      },
      this.ui,
    );
  }

  async init(): Promise<void> {
    this.ui.setLoading(0, 1);
    this.assets = await loadAssets((d, t) => this.ui.setLoading(d, t));
    this.world.buildEnvironment(this.assets);
    this.town = new TownView(this.world, this.assets);
    this.fx = new Effects(this.world, this.assets);
    this.town.onBuilt = (x, z) => this.fx.burst(x, 0.5, z, '#d6c7a1', 24, 3, 0.6, 0.8, 3, 1.4);
    this.battleView = new BattleView(this.world, this.assets, this.fx, this.town, { play: (n) => this.sfx.play(n) });
    this.map = new MapView(this.assets);
    this.map.setQuality(this.world.quality);
    this.cutscene = new Cutscene(this.assets, this.map);
    this.ui.portraits = renderRacePortraits(this.assets);
    this.thumbs = new BuildingThumbs(this.assets);
    this.ui.thumbs = this.thumbs;
    this.campaign = loadCampaign();
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
    this.ui.hideLoading();
    this.goTitle();
    requestAnimationFrame(() => this.loop());
  }

  private toggleAudio(kind: 'music' | 'sfx'): boolean {
    if (kind === 'music') this.music.setMuted(!this.music.muted);
    else this.sfx.setMuted(!this.sfx.muted);
    const prefs = { music: !this.music.muted, sfx: !this.sfx.muted };
    this.ui.audio = prefs;
    saveAudioPrefs(prefs);
    this.sfx.play('click');
    return kind === 'music' ? prefs.music : prefs.sfx;
  }

  private toggleQuality(): boolean {
    const q: Quality = this.world.quality === 'low' ? 'high' : 'low';
    saveQuality(q);
    this.setQuality(q);
    return q === 'low';
  }

  private setQuality(q: Quality): void {
    this.frameWatch = null;
    const canvas = this.world.setQuality(q);
    document.documentElement.classList.toggle('perf-low', q === 'low');
    if (canvas) this.bindCanvas(canvas);
    this.map.setQuality(q);
    this.ui.lowQuality = q === 'low';
    this.ui.paintQualityButtons();
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.world.setInsets(this.ui.insets);
    this.fx.resize();
    this.map.resize(w, h, this.mode === 'map' ? this.cui.mapInsets : { left: 0, right: 0, top: 0, bottom: 0 });
    this.cutscene.resize(w, h);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    document.body.style.cursor = '';
    this.onResize();
  }

  // ---------------------------------------------------------------- screens

  private goTitle(): void {
    this.endBattle();
    this.ui.hideHud();
    this.campaign = loadCampaign() ?? this.campaign;
    this.map.setCampaign(this.campaign, this.campaign?.race ?? 'human');
    this.map.setSelected(null);
    this.map.mode = 'orbit';
    this.setMode('title');
    this.cui.showTitleMenu(this.campaign, isClassicUnlocked(), { gate: !this.titleSeen, onStart: () => this.titleStart() });
    // Before the press-start gate the browser keeps audio locked: the music starts on the logo slam.
    if (this.titleSeen) this.music.play('title');
  }

  /** The press-start gate was passed: the logo slams in on a fanfare and the title music starts. */
  private titleStart(): void {
    this.titleSeen = true;
    this.sfx.play('slam');
    this.music.play('title');
  }

  private replayIntro(): void {
    if (!this.campaign) return;
    this.sfx.play('click');
    this.cutsceneReturn = 'title';
    this.startCutscene('intro');
  }

  private openRaceSelect(mode: 'campaign' | 'classic'): void {
    this.sfx.play('click');
    this.raceSelectMode = mode;
    this.cui.hideAll();
    this.setMode('raceSelect');
    this.preview('human');
    this.ui.showTitle('human', mode);
  }

  /** Shows a race behind the race picker: its castle (classic) or its colours on the map (campaign). */
  private preview(race: RaceId): void {
    if (this.raceSelectMode === 'classic') {
      this.world.buildEnvironment(this.assets, { ...CLASSIC_SETTING, race });
      this.town.sync(newGame(race, 1), false);
    } else {
      this.map.setCampaign(null, race);
    }
  }

  private startGame(race: RaceId): void {
    this.sfx.play('click');
    if (this.raceSelectMode === 'campaign') {
      this.campaign = newCampaign(race);
      saveCampaign(this.campaign);
      this.ui.closeOverlay();
      this.mapSelected = null;
      this.cutsceneReturn = 'map';
      this.startCutscene('intro');
      return;
    }
    this.thumbs.prepare(race);
    this.state = newGame(race);
    this.levelId = null;
    this.selection = null;
    this.world.buildEnvironment(this.assets, { ...CLASSIC_SETTING, race });
    this.ui.closeOverlay();
    this.setMode('classic');
    this.refresh(false);
    this.world.setFocus(this.focusFor(this.state), this.ui.insets, true);
    this.onResize();
    this.music.play('battle');
    this.ui.banner('第 1 波即將來襲', '點選空地建造建築，準備好就開戰！');
  }

  private continueCampaign(): void {
    this.sfx.play('click');
    if (!this.campaign) return;
    this.mapSelected = null;
    this.goMap();
  }

  private startCutscene(kind: 'intro' | 'ending'): void {
    if (!this.campaign) return;
    this.cutsceneKind = kind;
    this.ui.hideHud();
    this.cui.showCutscene();
    this.setMode('cutscene');
    this.cutscene.start(kind, this.campaign.race, this.campaign);
    this.music.play(kind === 'intro' ? 'story' : 'ending');
  }

  /** Skip: first to the finale's logo slam, then (pressed again) out of the cutscene. */
  private skipCutscene(): void {
    if (this.mode !== 'cutscene') return;
    if (this.cutscene.atFinale) this.endCutscene();
    else this.cutscene.skipToFinale();
  }

  private cutsceneCue(name: 'card' | 'slam'): void {
    this.sfx.play(name);
    // The intro's title lands on the world map: the adventure's theme takes over on the slam.
    if (name === 'slam' && this.cutsceneKind === 'intro') this.music.play('map');
  }

  private endCutscene(): void {
    if (this.mode !== 'cutscene') return;
    this.cutscene.skip();
    if (this.cutsceneKind === 'intro') {
      if (this.cutsceneReturn === 'title') this.goTitle();
      else this.goMap();
      return;
    }
    const c = this.campaign!;
    const rec = this.endingRecord ?? { liberated: true, capital: true, allLiberated: false, stars: 1, prevStars: 0 };
    this.goMap();
    this.music.play('ending');
    this.cui.showEnding(
      c,
      rec,
      () => {
        this.cui.showMap(c, this.mapSelected);
        this.music.play('map');
      },
      () => this.goTitle(),
    );
  }

  private goMap(conquered?: string): void {
    const c = this.campaign;
    if (!c) return this.goTitle();
    this.endBattle();
    this.ui.hideHud();
    this.map.setCampaign(c, c.race);
    this.map.mode = 'map';
    if (conquered) this.map.playConquest(conquered);
    if (!this.mapSelected || !(isAttackable(c, this.mapSelected) || isReplayable(c, this.mapSelected))) this.mapSelected = conquered ?? null;
    this.map.setSelected(this.mapSelected);
    this.cui.showMap(c, this.mapSelected);
    this.setMode('map');
    this.music.play('map');
  }

  private selectTerritory(id: string | null): void {
    if (this.mode !== 'map' || !this.campaign) return;
    if (id) this.sfx.play('click');
    this.mapSelected = id;
    this.map.setSelected(id);
    this.cui.renderMap(this.campaign, id);
  }

  private startLevel(id: string): void {
    const c = this.campaign;
    if (!c) return;
    this.sfx.play('horn');
    const t = getTerritory(id);
    this.endBattle();
    this.levelId = id;
    this.thumbs.prepare(c.race);
    this.state = createLevelState(c, id, Date.now() % 1_000_000);
    this.selection = null;
    this.world.buildEnvironment(this.assets, { terrain: t.terrain, faction: t.faction ?? 'undead', race: c.race });
    this.cui.hideAll();
    this.ui.closeOverlay();
    this.setMode('level');
    this.refresh(false);
    this.world.setFocus(this.focusFor(this.state), this.ui.insets, true);
    this.onResize();
    this.music.play('battle');
    this.ui.banner(t.name, TERRAINS[t.terrain].effect);
  }

  private exit(): void {
    this.sfx.play('click');
    window.close();
    // Browsers only let scripts close windows they opened themselves.
    setTimeout(() => {
      if (window.closed) return;
      this.setMode('farewell');
      this.music.stop();
      this.cui.showFarewell(() => this.goTitle());
    }, 150);
  }

  private endBattle(): void {
    if (this.battle) this.battleView.end();
    this.battle = null;
    this.state = null;
    this.selection = null;
    this.town?.setSelected(null);
  }

  // ---------------------------------------------------------------- level helpers

  /**
   * What the camera frames: while preparing, the plot (with the ring you can still expand into) and the
   * near field; in battle, your land and the field up to where the enemy marches in.
   */
  private focusFor(state: GameState): FocusBox {
    const owned = state.tiles.filter((t) => t.owned);
    const ext = {
      minI: Math.min(...owned.map((t) => t.i)),
      maxI: Math.max(...owned.map((t) => t.i)),
      minJ: Math.min(...owned.map((t) => t.j)),
      maxJ: Math.max(...owned.map((t) => t.j)),
    };
    if (this.battle) return World.battleFocus(ext);
    const radius = Math.max(-ext.minI, ext.maxI, -ext.minJ, ext.maxJ);
    return World.plotFocus(state.expansions < expansionCap(state) ? Math.min(GRID_RADIUS, radius + 1) : radius);
  }

  private refresh(animate = true): void {
    if (!this.state) return;
    this.town.sync(this.state, animate);
    this.town.setSelected(this.selection);
    this.ui.render(this.state, this.selection, this.battle);
    this.world.setFocus(this.focusFor(this.state), this.ui.insets);
  }

  private select(sel: Selection | null): void {
    this.selection = sel;
    this.town.setSelected(sel);
    if (this.state) this.ui.render(this.state, sel, this.battle);
  }

  // ---------------------------------------------------------------- actions

  private fail(reason: string | undefined): void {
    this.ui.toast(reason ?? '無法執行', 'bad');
    this.sfx.play('error');
  }

  private doBuild(id: string): void {
    const s = this.state;
    const sel = this.selection;
    if (!s || !sel) return;
    const check = canBuild(s, sel.i, sel.j, id);
    if (!check.ok) return this.fail(check.reason);
    build(s, sel.i, sel.j, id);
    this.sfx.play('build');
    this.refresh();
  }

  private doUpgrade(): void {
    const s = this.state;
    const sel = this.selection;
    if (!s || !sel) return;
    const check = canUpgrade(s, sel.i, sel.j);
    if (!check.ok) return this.fail(check.reason);
    upgrade(s, sel.i, sel.j);
    this.sfx.play('upgrade');
    this.refresh();
  }

  private doDemolish(): void {
    const s = this.state;
    const sel = this.selection;
    if (!s || !sel) return;
    const name = getBuilding(tileAt(s, sel.i, sel.j)!.building!.defId).name;
    const refund = demolish(s, sel.i, sel.j);
    this.ui.toast(`拆除了${name}，退還 ${refund} 金`);
    this.sfx.play('coin');
    this.refresh();
  }

  private doExpand(): void {
    const s = this.state;
    const sel = this.selection;
    if (!s || !sel) return;
    const check = canExpand(s, sel.i, sel.j);
    if (!check.ok) return this.fail(check.reason);
    expand(s, sel.i, sel.j);
    this.sfx.play('build');
    this.fx.burst(sel.i * 4, 0.3, sel.j * 4, '#a3e635', 30, 3, 0.5, 0.8, 2, 1.5);
    this.refresh();
  }

  private doUpgradeCastle(): void {
    const s = this.state;
    if (!s) return;
    const check = canUpgradeCastle(s);
    if (!check.ok) return this.fail(check.reason);
    upgradeCastle(s);
    this.sfx.play('upgrade');
    this.ui.toast(`主堡升級到 Lv.${s.castleLevel}！`, 'good');
    this.refresh();
  }

  private doRepair(): void {
    const s = this.state;
    if (!s) return;
    const hp = repairCastle(s);
    if (hp <= 0) return this.fail('無法修復');
    this.sfx.play('coin');
    this.ui.toast(`修復主堡 +${hp}`, 'good');
    this.refresh(false);
  }

  private doChooseBoon(id: string): void {
    const s = this.state;
    if (!s) return;
    chooseBoon(s, id);
    this.sfx.play('boon');
    this.ui.closeOverlay();
    if (s.phase === 'victory') {
      this.sfx.play('victory');
      this.ui.showVictory(s);
    }
    this.refresh(false);
  }

  private doContinueEndless(): void {
    if (!this.state) return;
    continueEndless(this.state);
    this.ui.closeOverlay();
    this.refresh(false);
  }

  private startWave(): void {
    const s = this.state;
    if (!s || s.phase !== 'prep' || this.battle) return;
    s.phase = 'battle';
    this.selection = null;
    this.town.setSelected(null);
    this.town.setHover(null);
    this.battle = new Battle(s);
    this.callouts = new BattleCallouts();
    this.battleView.begin(this.battle);
    this.acc = 0;
    this.sfx.play('horn');
    const wave = this.battle.waveDef;
    if (wave.boss) this.music.play('boss');
    this.ui.banner(`第 ${s.wave} 波`, wave.title ?? '敵軍來襲！');
    this.refresh(false);
  }

  private finishWave(): void {
    const s = this.state!;
    const b = this.battle!;
    const outcome = b.outcome();
    this.battle = null;
    this.battleView.end();
    const report = applyBattleOutcome(s, outcome);
    const tip = outcome.won ? undefined : defeatTip(s, b.waveDef, { bossSurvived: !!b.boss });
    this.refresh(false);
    this.music.play('battle');
    if (this.mode === 'level') return this.finishLevelWave(s, report.wave, report.total, tip);
    if (s.phase === 'over') {
      this.sfx.play('defeat');
      this.ui.showGameOver(s, tip);
      return;
    }
    this.sfx.play('coin');
    this.ui.banner(`第 ${report.wave} 波勝利！`, `+${report.total} 金`);
    if (s.phase === 'boon') this.ui.showBoons(s);
    else if (s.phase === 'victory' || (report.wave === FINAL_WAVE && !s.endless && s.phase !== 'prep')) {
      this.sfx.play('victory');
      this.ui.showVictory(s);
    }
  }

  private finishLevelWave(s: GameState, wave: number, gold: number, tip?: string): void {
    const c = this.campaign!;
    const id = this.levelId!;
    if (s.phase === 'over') {
      recordBattle(c, id, false, s.stats.kills);
      saveCampaign(c);
      this.sfx.play('defeat');
      this.music.play('story');
      this.ui.showGameOver(s, tip);
      return;
    }
    if (s.phase !== 'victory') {
      this.sfx.play('coin');
      this.ui.banner(`第 ${wave} 波勝利！`, `+${gold} 金`);
      return;
    }
    const rec = recordBattle(c, id, true, s.stats.kills, battleStars(s.stats.castleDamage, castleMaxHp(s)));
    saveCampaign(c);
    if (rec.capital) unlockClassic();
    this.sfx.play('victory');
    this.music.play('ending');
    this.ui.hideHud();
    this.cui.showLiberated(c, id, rec, s.stats.kills, s.stats.castleDamage / castleMaxHp(s), () => {
      if (rec.capital) {
        this.endingRecord = rec;
        this.mapSelected = null;
        this.endBattle();
        this.startCutscene('ending');
        return;
      }
      // A replay for stars changes nothing on the map: no conquest to play again.
      this.goMap(rec.liberated ? id : undefined);
      if (rec.liberated && rec.allLiberated) this.cui.showFullClear(c, () => this.cui.showMap(c, this.mapSelected));
    });
  }

  // ---------------------------------------------------------------- input & loop

  private get inLevel(): boolean {
    return this.mode === 'level' || this.mode === 'classic';
  }

  private bindInput(): void {
    this.bindCanvas(this.world.renderer.domElement);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Pointer input on the 3D view; re-attached when a quality change swaps the canvas. */
  private bindCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousemove', (e) => {
      if (this.mode === 'map') {
        const id = this.cui.menuOpen ? null : this.map.pick(e.clientX, e.clientY);
        this.map.setHover(id);
        document.body.style.cursor = id ? 'pointer' : '';
        return;
      }
      if (!this.inLevel || !this.state || this.battle || this.ui.overlayOpen) return this.town.setHover(null);
      this.town.setHover(this.town.pickTile(e.clientX, e.clientY));
    });
    canvas.addEventListener('mouseleave', () => {
      this.town.setHover(null);
      this.map?.setHover(null);
    });
    canvas.addEventListener('click', (e) => {
      if (this.mode === 'map') {
        if (this.cui.menuOpen) return;
        this.selectTerritory(this.map.pick(e.clientX, e.clientY));
        return;
      }
      if (!this.inLevel || !this.state || this.battle || this.ui.overlayOpen || this.state.phase !== 'prep') return;
      const t = this.town.pickTile(e.clientX, e.clientY);
      if (t) this.sfx.play('click');
      this.select(t);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.mode === 'cutscene') {
      if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.skipCutscene();
      }
      return;
    }
    if (this.mode === 'title' && e.key === 'Enter' && this.campaign) {
      this.continueCampaign();
      return;
    }
    if (!this.inLevel || !this.state) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!this.ui.overlayOpen) this.startWave();
    } else if (e.key === 'Escape') {
      if (this.ui.overlayOpen && this.state.phase === 'prep') this.ui.closeOverlay();
      this.select(null);
    } else if (['1', '2', '3'].includes(e.key) && this.battle) {
      this.speed = [1, 2, 4][Number(e.key) - 1];
      this.ui.setSpeedLabel(this.speed);
      this.ui.render(this.state, null, this.battle);
    } else if (e.key === 'u' && this.selection) {
      if (isCastleTile(this.selection.i, this.selection.j)) this.doUpgradeCastle();
      else this.doUpgrade();
    }
  }

  private loop(): void {
    const now = performance.now();
    const frameTime = (now - this.last) / 1000;
    const dt = Math.min(0.1, frameTime);
    this.last = now;
    if (this.frameWatch?.sample(frameTime)) {
      saveQuality('low');
      this.setQuality('low');
      this.ui.toast('畫面不夠流暢，已自動開啟效能模式（可在音樂、音效按鈕旁切換）', '', 6000);
    }
    const world = this.world;

    switch (this.mode) {
      case 'cutscene': {
        const frame = this.cutscene.update(dt);
        this.cui.updateCutscene(frame);
        if (this.cutscene.finished) this.endCutscene();
        const target = this.cutscene.target;
        world.draw(target.scene, target.camera);
        break;
      }
      case 'map':
        this.map.update(dt);
        this.cui.updateLabels(this.map.labelPositions());
        world.draw(this.map.scene, this.map.camera);
        break;
      case 'title':
      case 'farewell':
        this.map.update(dt);
        world.draw(this.map.scene, this.map.camera);
        break;
      case 'raceSelect':
        if (this.raceSelectMode === 'campaign') {
          this.map.update(dt);
          world.draw(this.map.scene, this.map.camera);
        } else {
          this.town.update(dt);
          this.fx.update(dt);
          this.world.render();
        }
        break;
      case 'level':
      case 'classic':
        this.stepBattle(dt);
        this.town.update(dt);
        this.fx.update(dt * (this.battle ? this.speed : 1));
        this.world.render();
        break;
      default:
        break;
    }
    requestAnimationFrame(() => this.loop());
  }

  /** Shows a battle callout: a banner for the big moments, a ticker line for the rest. */
  private announce(c: Callout): void {
    if (c.banner) this.ui.banner(c.banner.title, c.banner.sub);
    else this.ui.toast(c.text, c.kind, 2600);
    if (c.turn) this.ui.setMeter(this.callouts.share, c.turn);
    if (c.banner && c.kind === 'good') this.sfx.play('boon');
  }

  private stepBattle(dt: number): void {
    if (!this.battle) return;
    this.acc += dt * this.speed;
    let steps = 0;
    while (this.acc >= DT && steps < 16) {
      this.battle.step(DT);
      const events = this.battle.drainEvents();
      for (const c of this.callouts.feed(this.battle, events)) this.announce(c);
      this.battleView.handleEvents(events);
      this.acc -= DT;
      steps++;
    }
    if (steps >= 16) this.acc = 0;
    this.battleView.update(dt * this.speed, Math.min(1, this.acc / DT));
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.25;
      this.ui.updateBattle(this.battle);
      this.ui.setMeter(this.callouts.share, null);
    }
    if (this.battle.finished) this.finishWave();
  }
}

const app = new App(document.getElementById('app')!);
if (import.meta.env.DEV) {
  // Debug helpers for automated play-testing.
  const devSkipTo = async (wave: number) => {
    const { botPrepare } = await import('./game/bot');
    const { simulateBattle } = await import('./game/battle');
    const a = app as unknown as { state: GameState; refresh(animate?: boolean): void };
    const plan = { n: 0 };
    while (a.state.wave < wave && a.state.phase !== 'over' && a.state.phase !== 'victory') {
      if (a.state.phase === 'boon') chooseBoon(a.state, a.state.boonChoices[0]);
      botPrepare(a.state, plan);
      a.state.phase = 'battle';
      applyBattleOutcome(a.state, simulateBattle(a.state).outcome());
    }
    if (a.state.phase === 'boon') chooseBoon(a.state, a.state.boonChoices[0]);
    if (a.state.phase === 'prep') botPrepare(a.state, plan);
    a.refresh(false);
  };
  Object.assign(window, { __app: app, __units: UNITS, __skipTo: devSkipTo, __presets: PRESETS });
}
app.init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:#1c1917;font-size:18px">載入失敗：${String(err)}</div>`);
});
