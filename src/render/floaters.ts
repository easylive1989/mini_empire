import * as THREE from 'three';
import type { World } from './world';

export type FloaterKind = 'gold' | 'steal' | 'damage';

interface Floater {
  el: HTMLElement;
  pos: THREE.Vector3;
  kind: FloaterKind;
  amount: number;
  born: number;
}

/** Seconds a number stays up; pops of one kind this close in time and space merge into one. */
const LIFE = 1.15;
const MERGE_TIME = 0.45;
const MERGE_DIST = 2.5;
const MAX = 28;

const LABEL: Record<FloaterKind, (n: number) => string> = {
  gold: (n) => `+${n}`,
  steal: (n) => `−${n} 金`,
  damage: (n) => `−${n}`,
};

/**
 * Numbers that pop over the battlefield: gold from kills, gold the goblins steal and damage to the
 * castle. DOM labels projected from world space each frame (crisp text at any resolution).
 */
export class Floaters {
  private readonly layer = document.createElement('div');
  private items: Floater[] = [];

  constructor(private readonly world: World) {
    this.layer.className = 'floaters';
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.append(this.layer);
  }

  pop(x: number, y: number, z: number, amount: number, kind: FloaterKind): void {
    const now = performance.now() / 1000;
    const near = this.items.find((f) => f.kind === kind && now - f.born < MERGE_TIME && Math.hypot(f.pos.x - x, f.pos.z - z) < MERGE_DIST);
    if (near) {
      // A fresh label restarts the rise, with a little pop for the bigger number.
      near.amount += amount;
      near.born = now;
      const span = document.createElement('span');
      span.className = 'bump';
      span.textContent = LABEL[kind](Math.round(near.amount));
      near.el.replaceChildren(span);
      return;
    }
    while (this.items.length >= MAX) this.items.shift()!.el.remove();
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    const span = document.createElement('span');
    span.textContent = LABEL[kind](Math.round(amount));
    el.append(span);
    this.layer.append(el);
    const f: Floater = { el, pos: new THREE.Vector3(x, y, z), kind, amount, born: now };
    this.items.push(f);
    this.place(f);
  }

  private place(f: Floater): void {
    const p = this.world.toScreen(f.pos);
    f.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }

  update(): void {
    const now = performance.now() / 1000;
    this.items = this.items.filter((f) => {
      if (now - f.born > LIFE) {
        f.el.remove();
        return false;
      }
      this.place(f);
      return true;
    });
  }

  clear(): void {
    for (const f of this.items) f.el.remove();
    this.items = [];
  }
}
