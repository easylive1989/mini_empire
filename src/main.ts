import './ui/styles.css';
import { Sfx } from './audio/sfx';
import { Battle } from './game/battle';
import { DT, FINAL_WAVE } from './game/constants';
import { getBuilding, UNITS } from './game/data/index';
import {
  applyBattleOutcome,
  build,
  canBuild,
  canExpand,
  canUpgrade,
  canUpgradeCastle,
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
import { Effects } from './render/effects';
import { TownView } from './render/town';
import { World } from './render/world';
import { Ui, type Selection } from './ui/ui';

class App {
  private readonly world: World;
  private readonly ui: Ui;
  private readonly sfx = new Sfx();
  private assets!: Assets;
  private town!: TownView;
  private fx!: Effects;
  private battleView!: BattleView;
  private state: GameState | null = null;
  private battle: Battle | null = null;
  private selection: Selection | null = null;
  private speed = 1;
  private acc = 0;
  private last = performance.now();
  private uiTimer = 0;

  constructor(root: HTMLElement) {
    this.world = new World(root);
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
      backToTitle: () => this.backToTitle(),
      continueEndless: () => this.doContinueEndless(),
      toggleMute: () => {
        this.sfx.setMuted(!this.sfx.muted);
        return this.sfx.muted;
      },
      deselect: () => this.select(null),
    });
  }

  async init(): Promise<void> {
    this.ui.setLoading(0, 1);
    this.assets = await loadAssets((d, t) => this.ui.setLoading(d, t));
    this.world.buildEnvironment(this.assets);
    this.town = new TownView(this.world, this.assets);
    this.fx = new Effects(this.world, this.assets);
    this.town.onBuilt = (x, z) => this.fx.burst(x, 0.5, z, '#d6c7a1', 24, 3, 0.6, 0.8, 3, 1.4);
    this.battleView = new BattleView(this.world, this.assets, this.fx, this.town, { play: (n) => this.sfx.play(n) });
    this.bindInput();
    window.addEventListener('resize', () => this.onResize());
    this.ui.hideLoading();
    this.preview('human');
    this.ui.showTitle('human');
    this.onResize();
    requestAnimationFrame(() => this.loop());
  }

  private onResize(): void {
    this.world.setInsets(this.ui.insets);
    this.fx.resize();
  }

  /** Show a race's castle behind the title screen. */
  private preview(race: RaceId): void {
    const s = newGame(race, 1);
    this.town.sync(s, false);
  }

  private startGame(race: RaceId): void {
    this.sfx.play('click');
    this.state = newGame(race);
    this.selection = null;
    this.ui.closeOverlay();
    this.refresh(false);
    this.onResize();
    this.ui.banner('第 1 波即將來襲', '點選空地建造建築，準備好就開戰！');
  }

  private backToTitle(): void {
    this.battleView.end();
    this.battle = null;
    this.state = null;
    this.selection = null;
    this.town.setSelected(null);
    this.ui.closeOverlay();
    this.preview('human');
    this.ui.showTitle('human');
    this.onResize();
  }

  private refresh(animate = true): void {
    if (!this.state) return;
    this.town.sync(this.state, animate);
    this.town.setSelected(this.selection);
    this.ui.render(this.state, this.selection, this.battle);
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
    this.battleView.begin(this.battle);
    this.acc = 0;
    this.sfx.play('horn');
    const wave = this.battle.waveDef;
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
    this.refresh(false);
    if (s.phase === 'over') {
      this.sfx.play('defeat');
      this.ui.showGameOver(s);
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

  // ---------------------------------------------------------------- input & loop

  private bindInput(): void {
    const canvas = this.world.renderer.domElement;
    canvas.addEventListener('mousemove', (e) => {
      if (!this.state || this.battle || this.ui.overlayOpen) return this.town.setHover(null);
      this.town.setHover(this.town.pickTile(e.clientX, e.clientY));
    });
    canvas.addEventListener('mouseleave', () => this.town.setHover(null));
    canvas.addEventListener('click', (e) => {
      if (!this.state || this.battle || this.ui.overlayOpen || this.state.phase !== 'prep') return;
      const t = this.town.pickTile(e.clientX, e.clientY);
      if (t) this.sfx.play('click');
      this.select(t);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.state) return;
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
    });
  }

  private loop(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    if (this.battle) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= DT && steps < 16) {
        this.battle.step(DT);
        this.battleView.handleEvents(this.battle.drainEvents());
        this.acc -= DT;
        steps++;
      }
      if (steps >= 16) this.acc = 0;
      this.battleView.update(dt * this.speed, Math.min(1, this.acc / DT));
      this.uiTimer -= dt;
      if (this.uiTimer <= 0) {
        this.uiTimer = 0.25;
        this.ui.updateBattle(this.battle);
      }
      if (this.battle.finished) this.finishWave();
    }
    this.town.update(dt);
    this.fx.update(dt * (this.battle ? this.speed : 1));
    this.world.render();
    requestAnimationFrame(() => this.loop());
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
    while (a.state.wave < wave && a.state.phase !== 'over') {
      if (a.state.phase === 'boon') chooseBoon(a.state, a.state.boonChoices[0]);
      botPrepare(a.state, plan);
      a.state.phase = 'battle';
      applyBattleOutcome(a.state, simulateBattle(a.state).outcome());
    }
    if (a.state.phase === 'boon') chooseBoon(a.state, a.state.boonChoices[0]);
    botPrepare(a.state, plan);
    a.refresh(false);
  };
  Object.assign(window, { __app: app, __units: UNITS, __skipTo: devSkipTo });
}
app.init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;background:#1c1917;font-size:18px">載入失敗：${String(err)}</div>`);
});
