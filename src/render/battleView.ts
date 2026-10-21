import * as THREE from 'three';
import type { Battle, BattleEvent, Entity } from '../game/battle';
import { RACE_MAP } from '../game/data/index';
import type { StatusId } from '../game/types';
import type { Assets } from './assets';
import { HpBar } from './bars';
import type { Effects } from './effects';
import { createUnitModel, type UnitModel } from './models';
import type { TownView } from './town';
import { TILE_TOP, type World } from './world';

interface UnitView {
  entity: Entity;
  model: UnitModel;
  bar: HpBar;
  ring: THREE.Mesh;
  mark: THREE.Mesh;
  shadow: THREE.Mesh;
  state: 'idle' | 'move' | 'attack' | 'dead';
  attackLeft: number;
  yaw: number;
  sink: number;
}

const ringGeo = new THREE.RingGeometry(0.55, 0.72, 24);
ringGeo.rotateX(-Math.PI / 2);
const shadowGeo = new THREE.CircleGeometry(0.55, 16);
shadowGeo.rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });
const markGeo = new THREE.OctahedronGeometry(0.16, 0);

const STATUS_COLORS: Partial<Record<StatusId, string>> = {
  stun: '#facc15',
  root: '#22c55e',
  charm: '#f472b6',
  taunted: '#ef4444',
  rune: '#3b82f6',
  slow: '#7dd3fc',
};
const STATUS_ORDER: StatusId[] = ['stun', 'charm', 'root', 'taunted', 'rune', 'slow'];
const statusMats = new Map<string, THREE.MeshBasicMaterial>();
function statusMat(color: string): THREE.MeshBasicMaterial {
  let m = statusMats.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    statusMats.set(color, m);
  }
  return m;
}
const markMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });

export interface BattleSounds {
  play(name: string, x?: number): void;
}

export class BattleView {
  private views = new Map<number, UnitView>();
  private battle: Battle | null = null;
  private ownedExtent = 1;
  private time = 0;

  constructor(
    private readonly world: World,
    private readonly assets: Assets,
    private readonly fx: Effects,
    private readonly town: TownView,
    private readonly sounds: BattleSounds,
  ) {}

  begin(battle: Battle): void {
    this.end();
    this.battle = battle;
    let ext = 1;
    for (const t of battle.state.tiles) if (t.owned) ext = Math.max(ext, Math.abs(t.i), Math.abs(t.j));
    this.ownedExtent = ext;
    this.town.beginBattle();
  }

  end(): void {
    for (const v of this.views.values()) {
      this.world.units.remove(v.model.root);
      this.world.fx.remove(v.bar.group);
    }
    this.views.clear();
    this.fx.clearProjectiles();
    if (this.battle) this.town.endBattle();
    this.battle = null;
  }

  private groundY(x: number, z: number): number {
    const lim = (this.ownedExtent + 0.5) * 4;
    if (Math.abs(x) < lim && Math.abs(z) < lim && this.battle) {
      const i = Math.round(x / 4);
      const j = Math.round(z / 4);
      const t = this.battle.state.tiles.find((tt) => tt.i === i && tt.j === j);
      if (t?.owned) return TILE_TOP;
    }
    return 0;
  }

  private createView(e: Entity): UnitView {
    const model = createUnitModel(this.assets, e.def);
    const bar = new HpBar(e.baseTeam === 'player' ? 'player' : 'enemy', e.def.large ? 1.5 : 1.0, this.world.camera);
    bar.group.visible = false;
    // Bars live in world space so they keep facing the camera while the unit turns.
    this.world.fx.add(bar.group);
    const ring = new THREE.Mesh(ringGeo, statusMat('#ffffff'));
    ring.position.y = 0.05;
    ring.visible = false;
    const mark = new THREE.Mesh(markGeo, markMat);
    mark.position.y = model.height + 0.75;
    mark.visible = false;
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.03;
    const s = e.def.large ? 1.8 : (e.def.model.scale ?? 1);
    shadow.scale.setScalar(s);
    ring.scale.setScalar(s);
    model.root.add(ring, mark, shadow);
    model.root.position.set(e.x, this.groundY(e.x, e.z), e.z);
    model.root.rotation.y = e.facing;
    this.world.units.add(model.root);
    const v: UnitView = { entity: e, model, bar, ring, mark, shadow, state: 'idle', attackLeft: 0, yaw: e.facing, sink: 0 };
    this.views.set(e.id, v);
    return v;
  }

  private play(v: UnitView, state: UnitView['state']): void {
    if (v.state === state && state !== 'attack') return;
    const a = v.model.actions;
    const next = state === 'idle' ? a.idle : state === 'move' ? a.move : state === 'attack' ? a.attack : a.death;
    const prev = v.state === 'idle' ? a.idle : v.state === 'move' ? a.move : v.state === 'attack' ? a.attack : a.death;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev !== next) prev.crossFadeTo(next, state === 'attack' ? 0.08 : 0.2, false);
    v.state = state;
    if (state === 'attack') v.attackLeft = next.getClip().duration / next.timeScale;
  }

  handleEvents(events: BattleEvent[]): void {
    const b = this.battle;
    if (!b) return;
    for (const ev of events) {
      switch (ev.type) {
        case 'spawn': {
          const e = b.getEntity(ev.id);
          if (!e) break;
          this.createView(e);
          const color = e.baseTeam === 'player' ? RACE_MAP.get(b.state.race)!.color : e.summoned ? '#a855f7' : '#57534e';
          this.fx.burst(e.x, 0.4, e.z, color, 8, 1.5, 0.35, 0.5);
          if (e.def.boss) {
            this.fx.ring(e.x, e.z, 5, '#a855f7', 1.2);
            this.sounds.play('boss');
          }
          break;
        }
        case 'attack': {
          const v = this.views.get(ev.id);
          if (v && v.state !== 'dead') {
            this.play(v, 'attack');
            const e = v.entity;
            this.sounds.play(e.def.projectile ? (e.def.damageType === 'magic' ? 'cast' : 'shoot') : 'swing', e.x);
          }
          break;
        }
        case 'projectile': {
          const p = b.projectiles.find((pp) => pp.id === ev.pid);
          if (!p) break;
          const toY = ev.flying ? 2.2 : p.targetBuilding !== null ? 1.5 : 0.8;
          this.fx.addProjectile(p.id, p.kind, p.x, p.z, ev.fromY, toY, Math.hypot(p.tx - p.x, p.tz - p.z));
          break;
        }
        case 'hit': {
          const color = ev.crit ? '#fde047' : ev.dmgType === 'magic' ? '#c4b5fd' : '#fef3c7';
          this.fx.burst(ev.x, ev.y, ev.z, color, ev.crit ? 10 : 4, ev.crit ? 3 : 1.8, ev.crit ? 0.45 : 0.28, 0.3);
          if (ev.crit) this.sounds.play('crit', ev.x);
          else this.sounds.play(ev.dmgType === 'magic' ? 'hitMagic' : 'hit', ev.x);
          break;
        }
        case 'dodge': {
          const e = b.getEntity(ev.id);
          if (e) this.fx.burst(e.x, 1, e.z, '#e0f2fe', 5, 2, 0.25, 0.3);
          break;
        }
        case 'death': {
          const v = this.views.get(ev.id);
          if (v) {
            this.play(v, 'dead');
            v.bar.group.visible = false;
            v.ring.visible = false;
            v.mark.visible = false;
            const e = v.entity;
            this.fx.burst(e.x, 0.6, e.z, e.baseTeam === 'enemy' ? '#d6d3d1' : RACE_MAP.get(b.state.race)!.color, 10, 2, 0.4, 0.7, 2);
            this.sounds.play(e.baseTeam === 'enemy' ? 'bones' : 'death', e.x);
          }
          break;
        }
        case 'heal': {
          const e = b.getEntity(ev.id);
          if (e) this.fx.rise(e.x, 0.3, e.z, b.mods.overhealShieldCap > 0 ? '#fde68a' : '#4ade80', 5, 0.3);
          break;
        }
        case 'explode':
          this.fx.explosion(ev.x, ev.z, ev.radius, ev.kind);
          this.sounds.play('boom', ev.x);
          break;
        case 'aoe': {
          const colors = { root: '#22c55e', taunt: '#ef4444', shield: '#fde68a', frenzy: '#f97316', summon: '#a855f7', sacrifice: '#dc2626' };
          this.fx.ring(ev.x, ev.z, ev.radius, colors[ev.kind], 0.7);
          if (ev.kind === 'root') this.fx.burst(ev.x, 0.2, ev.z, '#4ade80', 20, ev.radius * 1.5, 0.35, 0.8, 0, 1.5);
          if (ev.kind === 'shield') this.fx.rise(ev.x, 0.3, ev.z, '#fef3c7', 16, 0.3, ev.radius);
          if (ev.kind === 'sacrifice') this.fx.burst(ev.x, 0.6, ev.z, '#b91c1c', 24, 4, 0.5, 0.7, 3);
          if (ev.kind === 'summon') this.fx.burst(ev.x, 0.2, ev.z, '#7e22ce', 16, 2, 0.5, 0.8);
          this.sounds.play(ev.kind === 'shield' ? 'shield' : ev.kind === 'root' ? 'root' : 'aoe', ev.x);
          break;
        }
        case 'status': {
          const e = b.getEntity(ev.id);
          if (e && ev.status === 'stun') this.fx.burst(e.x, 1.6, e.z, '#fde047', 8, 1.5, 0.3, 0.5);
          break;
        }
        case 'charm': {
          const e = b.getEntity(ev.id);
          if (e) this.fx.rise(e.x, 1, e.z, '#f9a8d4', 10, 0.35);
          this.sounds.play('charm', e?.x);
          break;
        }
        case 'resurrect': {
          const e = b.getEntity(ev.id);
          if (e) {
            this.fx.rise(e.x, 0, e.z, '#fef08a', 30, 0.45, 0.6);
            this.fx.ring(e.x, e.z, 1.6, '#fde047', 0.8);
          }
          this.sounds.play('resurrect', e?.x);
          break;
        }
        case 'repair': {
          const bb = b.getBuilding(ev.uid);
          if (bb) this.fx.burst(bb.x, 1.5, bb.z, '#fbbf24', 4, 2, 0.25, 0.4, 3);
          break;
        }
        case 'buildingHit': {
          const bb = b.getBuilding(ev.uid);
          if (bb && Math.random() < 0.4) this.fx.burst(bb.x + (Math.random() - 0.5) * 2, 1, bb.z + (Math.random() - 0.5) * 2, '#a8a29e', 3, 1.5, 0.3, 0.4, 2);
          this.town.shake(ev.uid);
          break;
        }
        case 'buildingDestroyed': {
          const bb = b.getBuilding(ev.uid);
          if (bb) {
            this.fx.burst(bb.x, 1.2, bb.z, '#78716c', 40, 4, 0.8, 1.2, 1);
            this.fx.ring(bb.x, bb.z, 3, '#a8a29e', 0.6);
          }
          this.sounds.play('collapse', bb?.x);
          break;
        }
        case 'gold':
          if (Math.random() < 0.6) this.fx.rise(ev.x, 0.8, ev.z, '#facc15', 3, 0.3, 0.3);
          break;
        case 'chain':
          this.fx.chain(ev.points, 3.4);
          this.sounds.play('zap', ev.points[0].x);
          break;
        case 'towerAttack':
          break;
      }
    }
  }

  /** Sync visuals with the simulation. `alpha` interpolates between sim ticks. */
  update(dt: number, alpha: number): void {
    const b = this.battle;
    if (!b) return;
    this.time += dt;
    this.town.updateBattle(b);

    for (const p of b.projectiles) {
      if (p.done) {
        if (this.fx.hasProjectile(p.id)) this.fx.removeProjectile(p.id);
      } else {
        this.fx.moveProjectile(p.id, p.x, p.z, Math.hypot(p.tx - p.x, p.tz - p.z));
      }
    }

    for (const [id, v] of this.views) {
      const e = v.entity;
      if (e.removed) {
        this.world.units.remove(v.model.root);
        this.world.fx.remove(v.bar.group);
        this.views.delete(id);
        continue;
      }
      const x = e.px + (e.x - e.px) * alpha;
      const z = e.pz + (e.z - e.pz) * alpha;
      let y = this.groundY(x, z);
      if (e.flying) y += 1.6 + Math.sin(this.time * 2 + id) * 0.15;
      if (!e.alive) {
        const since = b.time - e.deadAt;
        if (since > 1.6) v.sink = Math.min(1.5, (since - 1.6) * 1.2);
        y -= v.sink;
        if (e.flying) y = Math.max(0, y - Math.min(1, since) * 1.6);
      }
      v.model.root.position.set(x, y, z);
      v.bar.group.position.set(x, y + v.model.height + 0.4, z);
      // Smooth turning.
      let d = e.facing - v.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      v.yaw += d * Math.min(1, dt * 10);
      v.model.root.rotation.y = v.yaw;

      if (e.alive) {
        if (v.state === 'attack') {
          v.attackLeft -= dt;
          if (v.attackLeft <= 0) this.play(v, e.moving ? 'move' : 'idle');
        } else this.play(v, e.moving ? 'move' : 'idle');
        const showBar = e.hp < e.maxHp - 0.5 || e.shield > 1;
        v.bar.group.visible = showBar;
        if (showBar) v.bar.set(e.hp / e.maxHp, e.shield / e.maxHp);
        let ringColor: string | undefined;
        for (const s of STATUS_ORDER) {
          if ((e.statuses[s]?.t ?? 0) > 0) {
            ringColor = STATUS_COLORS[s];
            break;
          }
        }
        if (!ringColor && e.team !== e.baseTeam) ringColor = STATUS_COLORS.charm;
        v.ring.visible = !!ringColor;
        if (ringColor) v.ring.material = statusMat(ringColor);
        v.mark.visible = (e.statuses.mark?.t ?? 0) > 0;
        if (v.mark.visible) v.mark.rotation.y += dt * 4;
        if ((e.statuses.burn?.t ?? 0) > 0 && Math.random() < dt * 8) this.fx.burst(x, 0.8, z, '#f97316', 1, 1, 0.3, 0.4);
        if (((e.statuses.frenzy?.t ?? 0) > 0 || (e.statuses.blessed?.t ?? 0) > 0) && Math.random() < dt * 4) {
          this.fx.rise(x, 0.2, z, e.statuses.frenzy ? '#ef4444' : '#fde047', 1, 0.25, 0.3);
        }
      }
      v.model.mixer.update(dt);
    }
  }
}
