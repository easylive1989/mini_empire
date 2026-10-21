import * as THREE from 'three';
import type { CampaignState } from '../game/campaign/campaign';
import { endingScript, introScript, type StoryLine } from '../game/campaign/story';
import { getUnit, raceUnits } from '../game/data/index';
import type { RaceId, UnitDef, ModelSpec } from '../game/types';
import { packItem, type Assets, type PackName } from './assets';
import type { MapView } from './mapView';
import { createUnitModel } from './models';
import { buildingMaterial } from './recolor';
import { addLights, clamp01, ease, hexToWorld, skyTexture, SoftParticles } from './sceneKit';

type Kind = 'intro' | 'ending';

/** An animated character on the cutscene stage. */
class Actor {
  readonly root: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private current: THREE.AnimationAction | null = null;
  private currentName = '';

  constructor(
    private readonly assets: Assets,
    def: UnitDef,
  ) {
    const m = createUnitModel(assets, def);
    m.actions.idle.stop();
    this.root = m.root;
    this.mixer = m.mixer;
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.play('Idle');
    this.mixer.update(Math.random() * 2);
  }

  play(name: string, loop = true, speed = 1): void {
    if (name === this.currentName) return;
    const clip = this.assets.clips.get(name) ?? this.assets.clips.get('Idle')!;
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.timeScale = speed;
    a.play();
    if (this.current) this.current.crossFadeTo(a, 0.25, false);
    this.current = a;
    this.currentName = name;
  }

  at(x: number, z: number, y = 0): this {
    this.root.position.set(x, y, z);
    return this;
  }

  face(x: number, z: number): this {
    this.root.rotation.y = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    return this;
  }

  /** Walks towards a point; returns true once there. */
  walk(x: number, z: number, speed: number, dt: number, anim = 'Walking_A'): boolean {
    const p = this.root.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    this.face(x, z);
    this.play(anim);
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    return false;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}

/** Royal family looks per race: [king, prince]. */
const ROYALS: Record<RaceId, [ModelSpec, ModelSpec]> = {
  human: [
    { base: 'Knight', keep: ['1H_Sword', 'Round_Shield'], hide: ['Knight_Helmet'], palette: 'royal', extras: ['crown'], scale: 1.12 },
    { base: 'Knight', keep: ['1H_Sword'], hide: ['Knight_Helmet'], palette: 'royal' },
  ],
  elf: [
    { base: 'Mage', keep: ['2H_Staff'], palette: 'moon', extras: ['ears', 'crown'], scale: 1.12 },
    { base: 'Rogue', keep: ['Knife'], hide: ['Rogue_Cape'], palette: 'elf', extras: ['ears'] },
  ],
  dwarf: [
    { base: 'Barbarian', keep: ['1H_Axe', 'Barbarian_Round_Shield'], hide: ['Barbarian_Hat'], palette: 'dwarf', extras: ['beard', 'crown'], squash: [1.15, 0.82, 1.15], scale: 1.1 },
    { base: 'Barbarian', keep: ['1H_Axe'], hide: ['Barbarian_Hat'], palette: 'engineer', extras: ['beard'], squash: [1.15, 0.82, 1.15] },
  ],
  angel: [
    { base: 'Knight', keep: ['1H_Sword', 'Round_Shield'], hide: ['Knight_Helmet'], palette: 'seraph', extras: ['bigWings', 'halo', 'crown'], scale: 1.12 },
    { base: 'Knight', keep: ['1H_Sword'], hide: ['Knight_Helmet'], palette: 'angel', extras: ['wings'] },
  ],
};

interface Mood {
  sky: [string, string, string];
  hemi: [string, string, number];
  sun: [string, number];
}
const MOODS: Record<string, Mood> = {
  day: { sky: ['#5f9fd6', '#d9eef5', '#f6f1d8'], hemi: ['#f4fbff', '#6d8a4e', 1.55], sun: ['#fff1d6', 2.6] },
  blood: { sky: ['#1a0610', '#7a1e1e', '#d9542b'], hemi: ['#ffb0a0', '#3a1a1a', 0.9], sun: ['#ff7a4a', 1.8] },
  night: { sky: ['#060914', '#1c2440', '#5a2a2a'], hemi: ['#8aa0d8', '#1a1a28', 0.7], sun: ['#ffb08a', 1.0] },
  dawn: { sky: ['#3b4f8a', '#f0a868', '#ffd59a'], hemi: ['#ffe2c4', '#5a6a4a', 1.3], sun: ['#ffc48a', 2.4] },
  gold: { sky: ['#4a8fd0', '#ffe9b0', '#fff4d0'], hemi: ['#fffaf0', '#7a8a5e', 1.7], sun: ['#fff4dc', 2.8] },
};

interface Shot {
  duration: number;
  setup(): void;
  tick(t: number, dt: number): void;
}

export interface CutsceneFrame {
  line: StoryLine<string> | null;
  lineTime: number;
  index: number;
  count: number;
}

export class Cutscene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.3, 400);
  private readonly stage = new THREE.Group();
  private readonly fire = new SoftParticles(true);
  private readonly smoke = new SoftParticles(false, 0.32);
  private readonly lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight };
  private readonly glow = new THREE.PointLight('#ff6a2a', 0, 40, 1.5);
  private actors: Actor[] = [];
  private lines: StoryLine<string>[] = [];
  private shots: Shot[] = [];
  private index = 0;
  private t = 0;
  private race: RaceId = 'human';
  private campaign: CampaignState | null = null;
  private moodKey = '';
  /** True while the current shot shows the world map instead of the stage. */
  showingMap = false;
  finished = true;

  constructor(
    private readonly assets: Assets,
    private readonly map: MapView,
  ) {
    this.scene.add(this.stage, this.fire.points, this.smoke.points, this.glow);
    this.lights = addLights(this.scene, 40);
  }

  get target(): { scene: THREE.Scene; camera: THREE.Camera } {
    return this.showingMap ? { scene: this.map.scene, camera: this.map.camera } : { scene: this.scene, camera: this.camera };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fire.setViewport(h, this.camera.fov);
    this.smoke.setViewport(h, this.camera.fov);
  }

  start(kind: Kind, race: RaceId, campaign: CampaignState | null): void {
    this.race = race;
    this.campaign = campaign;
    this.lines = kind === 'intro' ? introScript(race) : endingScript(race);
    this.shots = this.lines.map((l) => this.makeShot(l.shot, l.duration));
    this.index = -1;
    this.finished = false;
    this.next();
  }

  /** Jumps to a shot (used by automated screenshots). */
  jump(index: number): void {
    this.index = index - 1;
    this.next();
  }

  skip(): void {
    this.finished = true;
    this.clearStage();
  }

  private next(): void {
    this.index++;
    this.t = 0;
    this.clearStage();
    if (this.index >= this.shots.length) {
      this.finished = true;
      return;
    }
    this.showingMap = false;
    this.shots[this.index].setup();
  }

  update(dt: number): CutsceneFrame {
    if (this.finished) return { line: null, lineTime: 0, index: this.index, count: this.shots.length };
    this.t += dt;
    const shot = this.shots[this.index];
    shot.tick(this.t, dt);
    for (const a of this.actors) a.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
    if (this.showingMap) this.map.update(dt);
    const frame = { line: this.lines[this.index], lineTime: this.t, index: this.index, count: this.shots.length };
    if (this.t >= shot.duration) this.next();
    return frame;
  }

  // ---------------------------------------------------------------- stage helpers

  private clearStage(): void {
    this.stage.clear();
    this.fire.clear();
    this.smoke.clear();
    this.actors = [];
    this.glow.intensity = 0;
  }

  private mood(a: string, b = a, k = 0): void {
    const key = `${a}|${b}|${Math.round(k * 30)}`;
    if (key === this.moodKey) return;
    this.moodKey = key;
    const A = MOODS[a];
    const B = MOODS[b];
    const mix = (x: string, y: string) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), k).getHexString();
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.background = skyTexture(mix(A.sky[0], B.sky[0]), mix(A.sky[1], B.sky[1]), mix(A.sky[2], B.sky[2]));
    this.lights.hemi.color.set(mix(A.hemi[0], B.hemi[0]));
    this.lights.hemi.groundColor.set(mix(A.hemi[1], B.hemi[1]));
    this.lights.hemi.intensity = THREE.MathUtils.lerp(A.hemi[2], B.hemi[2], k);
    this.lights.sun.color.set(mix(A.sun[0], B.sun[0]));
    this.lights.sun.intensity = THREE.MathUtils.lerp(A.sun[1], B.sun[1], k);
  }

  private model(pack: PackName, key: string, x: number, z: number, scale: number, rot = 0, race?: RaceId | 'shadow'): THREE.Object3D {
    const o = packItem(this.assets, pack, key).clone();
    if (pack === 'buildings' && race) {
      o.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (mesh.isMesh) mesh.material = buildingMaterial(mesh.material as THREE.Material, race);
      });
    }
    o.position.set(x, 0, z);
    o.scale.setScalar(scale);
    o.rotation.y = rot;
    this.stage.add(o);
    return o;
  }

  /** Hex-tiled island ground of the given radius. */
  private ground(radius: number, tint = '#ffffff'): void {
    const grass = packItem(this.assets, 'env', 'hex_grass');
    const water = packItem(this.assets, 'env', 'hex_water');
    const size = 2;
    let mat: THREE.MeshStandardMaterial | null = null;
    for (let q = -radius - 3; q <= radius + 3; q++) {
      for (let r = -radius - 3; r <= radius + 3; r++) {
        const d = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
        if (d > radius + 3) continue;
        const o = (d <= radius ? grass : water).clone();
        if (d <= radius) {
          o.traverse((m) => {
            const mesh = m as THREE.Mesh;
            if (!mesh.isMesh) return;
            if (!mat) {
              mat = (mesh.material as THREE.MeshStandardMaterial).clone();
              mat.color.set(tint);
            }
            mesh.material = mat;
          });
        }
        o.scale.set(size, 1, size);
        o.position.copy(hexToWorld(q, r, size));
        if (d > radius) o.position.y = -0.2;
        this.stage.add(o);
      }
    }
  }

  private actor(def: UnitDef, x: number, z: number): Actor {
    const a = new Actor(this.assets, def).at(x, z);
    this.stage.add(a.root);
    this.actors.push(a);
    return a;
  }

  private royal(which: 'king' | 'prince', opts: { scale?: number; crown?: boolean } = {}): UnitDef {
    const base = raceUnits(this.race)[0];
    const spec = { ...ROYALS[this.race][which === 'king' ? 0 : 1] };
    if (opts.crown && !spec.extras?.includes('crown')) spec.extras = [...(spec.extras ?? []), 'crown'];
    if (opts.scale) spec.scale = (spec.scale ?? 1) * opts.scale;
    return { ...base, model: spec };
  }

  /** The kingdom's capital: castle, walls, houses and trees. */
  private kingdom(ruined = false): { fires: THREE.Vector3[] } {
    const race = this.race;
    this.ground(8, ruined ? '#8a8a78' : '#a6d98a');
    this.model('buildings', 'castle', 0, -5, 2.2, 0, ruined ? 'shadow' : race);
    const fires: THREE.Vector3[] = [new THREE.Vector3(0, 6, -5)];
    const houses: [string, number, number, number][] = [
      ['home_A', -8, -4, 0.4],
      ['home_B', -11, -1, 1.2],
      ['tavern', 8, -3, -0.5],
      ['home_A', 11, -1, -1.2],
      ['market', -9, -9, 0.2],
      ['home_B', 8, -9, -0.3],
      ['church', -3, -12, 0],
      ['windmill', 14, -11, 0],
    ];
    for (const [key, x, z, rot] of houses) {
      if (ruined && (key === 'home_A' || key === 'tavern')) this.model('env', 'building_destroyed', x, z, 2, rot);
      else this.model('buildings', key, x, z, 1.6, rot, ruined ? 'shadow' : race);
      fires.push(new THREE.Vector3(x, 2.5, z));
    }
    for (let k = -3; k <= 3; k++) if (k !== 0) this.model('env', 'wall_straight', k * 2.3, 0.5, 1.15, 0);
    this.model('env', 'wall_straight_gate', 0, 0.5, 1.15, 0);
    const trees: [number, number][] = [[-14, -6], [13, -7], [-16, 4], [16, 3], [3, -15], [-15, -12], [11, -15], [-18, -3]];
    for (const [x, z] of trees) this.model(ruined ? 'halloween' : 'env', ruined ? 'tree_dead_medium' : 'trees_A_medium', x, z, ruined ? 1.1 : 2.4);
    for (const x of [-4.6, 4.6]) this.model('dungeon', ruined ? 'banner_patternA_red' : 'banner_patternA_blue', x, 0.9, 0.75);
    return { fires };
  }

  private burn(points: THREE.Vector3[], rate: number, dt: number): void {
    const n = Math.floor(rate * dt + Math.random());
    for (let k = 0; k < n; k++) {
      const p = points[Math.floor(Math.random() * points.length)].clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2));
      this.fire.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.6, 2 + Math.random() * 2, (Math.random() - 0.5) * 0.6), new THREE.Color(Math.random() < 0.5 ? '#ff7b1c' : '#ffcf4a'), 0.7 + Math.random() * 0.6, 1.1, -0.5);
      if (Math.random() < 0.4) this.smoke.emit(p.clone().setY(p.y + 1.5), new THREE.Vector3(0.6, 1.5 + Math.random(), 0.2), new THREE.Color('#2b2224'), 2 + Math.random() * 1.5, 3.5, -0.1);
    }
  }

  private camera3(pos: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }

  private dolly(t: number, d: number, from: [number, number, number, number, number, number], to: [number, number, number, number, number, number]): void {
    const k = ease(clamp01(t / d));
    const p = new THREE.Vector3(from[0], from[1], from[2]).lerp(new THREE.Vector3(to[0], to[1], to[2]), k);
    const l = new THREE.Vector3(from[3], from[4], from[5]).lerp(new THREE.Vector3(to[3], to[4], to[5]), k);
    this.camera3(p, l);
  }

  // ---------------------------------------------------------------- shots

  private makeShot(id: string, duration: number): Shot {
    const S = (setup: () => void, tick: (t: number, dt: number) => void): Shot => ({ duration, setup, tick });
    const units = () => raceUnits(this.race);
    switch (id) {
      case 'prosperity': {
        let walkers: { a: Actor; cx: number; cz: number; r: number; ph: number; sp: number }[] = [];
        return S(
          () => {
            this.kingdom();
            this.mood('day');
            const king = this.actor(this.royal('king'), 0, 2.4);
            king.face(0, 12);
            for (const x of [-1.6, 1.6]) this.actor(units()[0], x, 2.2).face(0, 12);
            walkers = [];
            const list = units();
            for (let k = 0; k < 8; k++) {
              const a = this.actor(list[k % list.length], 0, 0);
              const side = k % 2 ? 1 : -1;
              walkers.push({ a, cx: side * (7 + (k % 3) * 1.5), cz: 5 + Math.floor(k / 2) * 1.6, r: 1.6 + (k % 3) * 0.6, ph: k * 1.3, sp: (0.35 + (k % 3) * 0.1) * side });
            }
            for (let k = 0; k < 5; k++) {
              const a = this.actor(list[(k + 2) % list.length], -4 + k * 2, 6.5 + (k % 2) * 0.8);
              a.face(0, 2.4);
              a.play('Cheer');
            }
          },
          (t) => {
            for (const w of walkers) {
              const ang = w.ph + t * w.sp;
              const x = w.cx + Math.cos(ang) * w.r;
              const z = w.cz + Math.sin(ang) * w.r;
              const ahead = ang + 0.1 * Math.sign(w.sp);
              w.a.face(w.cx + Math.cos(ahead) * w.r, w.cz + Math.sin(ahead) * w.r).at(x, z);
              w.a.play('Walking_A');
            }
            const ang = 0.55 - t * 0.04;
            const d = 34 - t * 1.1;
            this.camera3(new THREE.Vector3(Math.sin(ang) * d, 15 - t * 0.6, Math.cos(ang) * d), new THREE.Vector3(0, 2.5, -1));
          },
        );
      }
      case 'invasion': {
        let horde: Actor[] = [];
        let fleeing: Actor[] = [];
        let fires: THREE.Vector3[] = [];
        return S(
          () => {
            fires = this.kingdom().fires;
            this.mood('day');
            horde = [];
            const ids = ['m_minion', 'g_goblin', 'o_grunt', 'r_soldier', 'm_warrior', 'g_bomber', 'o_berserker', 'r_archer', 'm_rogue', 'o_brute'];
            for (let k = 0; k < 22; k++) {
              const a = this.actor(getUnit(ids[k % ids.length]), 18 + (k % 5) * 2.1 + Math.random(), 3 + Math.floor(k / 5) * 2.1 + Math.random());
              horde.push(a);
            }
            fleeing = [];
            const list = units();
            for (let k = 0; k < 6; k++) fleeing.push(this.actor(list[k % list.length], -2 + k * 1.6, 7 + (k % 2) * 2));
          },
          (t, dt) => {
            this.mood('day', 'blood', clamp01(t / 3));
            const flash = (t > 1.6 && t < 1.75) || (t > 6.1 && t < 6.2);
            if (flash) this.lights.hemi.intensity = 3.5;
            for (const a of horde) {
              const p = a.root.position;
              a.walk(Math.max(7, p.x - 30), p.z, 2.4, dt, 'Running_A');
            }
            for (const a of fleeing) if (t > 2) a.walk(-30, a.root.position.z + 2, 4.5, dt, 'Running_A');
            if (t > 3.5) this.burn(fires, 60 * clamp01((t - 3.5) / 3), dt);
            this.glow.position.set(0, 6, -2);
            this.glow.intensity = 60 * clamp01((t - 3.5) / 3);
            this.dolly(t, 9, [34, 10, 30, 18, 1.5, 4], [18, 13, 30, 2, 2, -1]);
          },
        );
      }
      case 'lastStand': {
        let king: Actor;
        let knights: Actor[] = [];
        let lord: Actor;
        let minions: Actor[] = [];
        let fires: THREE.Vector3[] = [];
        let roared = false;
        return S(
          () => {
            fires = this.kingdom().fires;
            this.mood('blood');
            king = this.actor(this.royal('king'), 1, 4);
            king.face(10, 4);
            king.play('Idle_Combat');
            knights = [];
            const list = units();
            for (let k = 0; k < 4; k++) {
              const a = this.actor(list[k % 2], -1 + (k % 2) * 1.6, 2 + k * 1.4);
              a.face(10, 4);
              a.play('Idle_Combat');
              knights.push(a);
            }
            lord = this.actor(getUnit('b_demonlord'), 17, 4.5);
            minions = [];
            for (let k = 0; k < 6; k++) minions.push(this.actor(getUnit(['m_warrior', 'o_berserker', 'g_goblin'][k % 3]), 19 + (k % 3) * 2, 1 + k * 1.3));
            roared = false;
          },
          (t, dt) => {
            this.mood('blood');
            this.burn(fires, 40, dt);
            this.glow.position.set(4, 5, 2);
            this.glow.intensity = 45 + Math.sin(t * 9) * 10;
            if (!lord.walk(5.2, 4.3, 3, dt)) {
              // approaching
            } else if (t < 8) {
              lord.face(king.root.position.x, king.root.position.z);
              lord.play('2H_Melee_Attack_Chop', true, 0.8);
            } else if (!roared) {
              roared = true;
              lord.play('Cheer');
              this.fire.burst(new THREE.Vector3(5.2, 3, 4.3), '#ff3b2a', 120, 7, 0.9, 1.6, 1.5, 2);
            }
            minions.forEach((m, k) => {
              const tx = 6.5 + (k % 3) * 1.2;
              const tz = 1 + k * 1.3;
              if (m.walk(tx, tz, 3.2, dt, 'Running_A')) {
                m.face(0, tz);
                m.play(t > 7.5 ? 'Cheer' : '1H_Melee_Attack_Chop');
              }
            });
            knights.forEach((k, i) => {
              const dieAt = 4.2 + i * 0.7;
              if (t > dieAt) k.play(i % 2 ? 'Death_A' : 'Death_B', false);
              else if (t > 2.6) k.play('1H_Melee_Attack_Chop');
            });
            if (t > 7.3) king.play('Death_A', false);
            else if (t > 2.6) king.play(this.race === 'elf' ? 'Spellcast_Shoot' : '1H_Melee_Attack_Slice_Diagonal');
            if (t < 7) this.dolly(t, 7, [-9, 5, 15, 5, 2.5, 3], [-6, 3.5, 12.5, 4, 2.2, 3.5]);
            else this.dolly(t - 7, 4, [-6, 3.5, 12.5, 4, 2.2, 3.5], [-2.5, 2, 9, 1.5, 0.8, 4]);
          },
        );
      }
      case 'exile': {
        let prince: Actor;
        let guard: Actor;
        let fires: THREE.Vector3[] = [];
        return S(
          () => {
            fires = this.kingdom(true).fires;
            this.mood('night');
            prince = this.actor(this.royal('prince', { scale: 0.68 }), 6, 10);
            guard = this.actor(units()[0], 7.2, 11);
          },
          (t, dt) => {
            this.burn(fires, 70, dt);
            this.glow.position.set(0, 7, -4);
            this.glow.intensity = 80 + Math.sin(t * 7) * 15;
            prince.walk(-30, 12, 3.6, dt, 'Running_A');
            guard.walk(-29, 13, 3.6, dt, 'Running_A');
            const x = prince.root.position.x;
            this.camera3(new THREE.Vector3(x + 2, 3.2, 22), new THREE.Vector3(x - 1, 1.5, 6));
          },
        );
      }
      case 'oath': {
        let prince: Actor;
        let soldiers: Actor[] = [];
        let burst = false;
        return S(
          () => {
            this.ground(5, '#a6d98a');
            this.mood('dawn');
            this.model('buildings', 'tower_A', -4, -5, 1.6, 0, this.race);
            this.model('buildings', 'home_A', 4, -5, 1.5, -0.4, this.race);
            this.model('buildings', 'home_B', -8, -1, 1.5, 0.6, this.race);
            this.model('env', 'fence_wood_straight', 6, 0, 2.2, Math.PI / 2);
            this.model('dungeon', 'banner_patternA_blue', -2, -2.5, 0.8);
            this.model('dungeon', 'banner_patternA_blue', 2, -2.5, 0.8);
            for (const [x, z] of [[-10, -8], [9, -9], [11, 3], [-11, 5]]) this.model('env', 'trees_B_medium', x, z, 2.3);
            prince = this.actor(this.royal('prince'), 0, -1);
            prince.face(0, 10);
            soldiers = [];
            const list = units();
            for (let k = 0; k < 8; k++) {
              const side = k % 2 ? 1 : -1;
              const row = Math.floor(k / 2);
              const a = this.actor(list[k % list.length], side * (2.6 + (row % 2) * 0.6), 1.2 + row * 1.9);
              a.face(0, -1);
              soldiers.push(a);
            }
            burst = false;
          },
          (t) => {
            this.mood('dawn', 'gold', clamp01((t - 3) / 5));
            if (t > 3.8) prince.play('Cheer');
            if (t > 4.6) for (const s of soldiers) s.play('Cheer');
            if (t > 4 && !burst) {
              burst = true;
              this.fire.burst(new THREE.Vector3(0, 2.6, -1), '#ffe08a', 140, 5, 0.6, 1.8, 2, 2);
            }
            this.dolly(t, 9, [0, 2.6, 17, 0, 1.8, -1], [0, 2.1, 7, 0, 2, -1]);
          },
        );
      }
      case 'map':
        return S(
          () => {
            this.showingMap = true;
            this.map.setCampaign(this.campaign, this.race);
            this.map.mode = 'map';
            this.map.flyIn(5.5);
          },
          () => {},
        );
      case 'fall': {
        let lord: Actor;
        let watchers: Actor[] = [];
        return S(
          () => {
            this.kingdom(true);
            this.mood('blood');
            lord = this.actor(getUnit('b_demonlord'), 3, 6);
            lord.face(-6, 8);
            lord.play('Hit_A');
            watchers = [];
            watchers.push(this.actor(this.royal('prince'), -6, 8.5));
            const list = units();
            for (let k = 0; k < 5; k++) watchers.push(this.actor(list[k % list.length], -8 - (k % 2) * 1.5, 6 + k * 1.3));
            for (const w of watchers) w.face(3, 6);
          },
          (t) => {
            this.mood('blood', 'day', clamp01((t - 2.5) / 4));
            if (t > 0.8) lord.play('Death_B', false);
            if (t > 0.9 && t < 2.6) {
              const p = new THREE.Vector3(3, 2.5 + Math.random() * 3, 6);
              this.fire.burst(p, Math.random() < 0.5 ? '#a855f7' : '#ff3b2a', 10, 6, 0.8, 1.4, 1, 1);
            }
            if (t > 4.5) for (const w of watchers) w.play('Cheer');
            this.dolly(t, 8, [-12, 4, 18, 0, 2, 6], [-4, 3, 16, 0, 2, 6]);
          },
        );
      }
      case 'return': {
        let prince: Actor;
        let sword: THREE.Object3D;
        let planted = false;
        return S(
          () => {
            this.kingdom(true);
            this.mood('day');
            prince = this.actor(this.royal('prince'), 0, 16);
            sword = this.model('dungeon', 'sword_shield_gold', 1.4, 2.4, 1.8);
            sword.visible = false;
            planted = false;
          },
          (t, dt) => {
            if (prince.walk(0, 3, 2.2, dt)) {
              prince.face(0, -5);
              prince.play(t > 7 ? 'Cheer' : 'Use_Item', t > 7);
              if (!planted && t > 5.2) {
                planted = true;
                sword.visible = true;
                this.fire.burst(new THREE.Vector3(1.4, 1, 2.4), '#ffe08a', 120, 4, 0.6, 1.6, 1.5, 2);
              }
            }
            const z = prince.root.position.z;
            this.camera3(new THREE.Vector3(3, 3.4, z + 8), new THREE.Vector3(0, 2.5, z - 6));
          },
        );
      }
      case 'coronation': {
        let crowd: Actor[] = [];
        return S(
          () => {
            this.kingdom();
            this.mood('gold');
            const king = this.actor(this.royal('prince', { crown: true, scale: 1.12 }), 0, 1.8);
            king.face(0, 12);
            king.play('Cheer');
            crowd = [];
            const list = units();
            for (let k = 0; k < 16; k++) {
              const a = this.actor(list[k % list.length], -7 + (k % 8) * 2, 6 + Math.floor(k / 8) * 2.4 + (k % 2) * 0.5);
              a.face(0, 1.8);
              crowd.push(a);
            }
          },
          (t, dt) => {
            for (const [k, a] of crowd.entries()) if (t > 0.3 + (k % 5) * 0.15) a.play('Cheer');
            if (Math.random() < dt * 2.2) {
              const p = new THREE.Vector3((Math.random() - 0.5) * 20, 10 + Math.random() * 5, -6 + Math.random() * 6);
              const colors = ['#fde047', '#f472b6', '#60a5fa', '#4ade80', '#fb923c'];
              this.fire.burst(p, colors[Math.floor(Math.random() * colors.length)], 80, 6, 0.5, 1.6, 0.5, 3);
            }
            const ang = 0.35 - t * 0.04;
            this.camera3(new THREE.Vector3(Math.sin(ang) * 17, 6 - t * 0.2, Math.cos(ang) * 17 + 2), new THREE.Vector3(0, 2.6, 1));
          },
        );
      }
    }
    return S(() => {}, () => {});
  }
}


