import type { Battle, BattleEvent } from './battle';

/**
 * What the battle says out loud: banners for the big moments and short ticker lines for the rest,
 * each with its own cooldown on the battle clock, plus the tug-of-war share for the battle meter.
 * Pure logic over the battle's events; the UI only draws what comes out.
 */
export interface Callout {
  text: string;
  kind: 'good' | 'bad' | 'info';
  /** Big moments also get a banner. */
  banner?: { title: string; sub: string };
  /** The lead on the field just changed hands (the battle meter flashes). */
  turn?: 'good' | 'bad';
}

/** Battle-clock seconds between two lines of the same kind. */
export const CALLOUT_COOLDOWN = { castle: 20, steal: 15, destroyed: 3, turn: 10 };
/** How often the battle meter samples the field, in battle seconds. */
const METER_STEP = 0.25;
/** A lead must flip from above `TURN_HIGH` to below `1 - TURN_HIGH` within `TURN_WINDOW` seconds. */
const TURN_HIGH = 0.56;
const TURN_WINDOW = 4;

export class BattleCallouts {
  /** Our share of the fighting strength on the field (0–1); null while one side has nobody there. */
  share: number | null = null;
  /** Set for one meter sample when the lead just changed hands. */
  turned: 'good' | 'bad' | null = null;
  private last = new Map<string, number>();
  private history: { t: number; share: number }[] = [];
  private nextSample = 0;
  private lastFew = false;
  private destroyedBatch: { at: number; names: string[] } | null = null;

  private ready(key: string, now: number, cooldown: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && now - t < cooldown) return false;
    this.last.set(key, now);
    return true;
  }

  /** Reads one tick's events (call before the renderer drains them) and returns what to announce. */
  feed(b: Battle, events: BattleEvent[]): Callout[] {
    const out: Callout[] = [];
    const now = b.time;
    for (const ev of events) {
      switch (ev.type) {
        case 'spawn': {
          const e = b.getEntity(ev.id);
          if (e?.def.boss && e.baseTeam === 'enemy' && !e.summoned) {
            out.push({ text: `首領${e.def.name}出現了！`, kind: 'bad', banner: { title: '首領登場', sub: e.def.name } });
          }
          break;
        }
        case 'enrage': {
          const e = b.getEntity(ev.id);
          if (e) out.push({ text: `${e.def.name}狂暴了！傷害與攻速大增`, kind: 'bad' });
          break;
        }
        case 'death': {
          const e = b.getEntity(ev.id);
          if (e?.def.boss && e.baseTeam === 'enemy' && !e.summoned) {
            out.push({ text: `擊敗了${e.def.name}！`, kind: 'good', banner: { title: '首領倒下', sub: `${e.def.name}被擊敗了` } });
          }
          break;
        }
        case 'buildingHit':
          if (ev.uid === 0 && this.ready('castle', now, CALLOUT_COOLDOWN.castle)) out.push({ text: '主堡遭受攻擊！', kind: 'bad' });
          break;
        case 'buildingDestroyed': {
          const bb = b.getBuilding(ev.uid);
          if (!bb || bb.isCastle || !bb.def) break;
          if (this.destroyedBatch && now - this.destroyedBatch.at < CALLOUT_COOLDOWN.destroyed) this.destroyedBatch.names.push(bb.def.name);
          else this.destroyedBatch = { at: now, names: [bb.def.name] };
          break;
        }
        case 'steal':
          if (this.ready('steal', now, CALLOUT_COOLDOWN.steal)) out.push({ text: '哥布林小偷正在偷金幣！', kind: 'bad' });
          break;
        default:
          break;
      }
    }
    // Buildings lost close together are reported as one line once the burst is over.
    const batch = this.destroyedBatch;
    if (batch && now - batch.at >= 0.6) {
      out.push({ text: batch.names.length === 1 ? `${batch.names[0]}被摧毀了` : `${batch.names.length} 座建築被摧毀了`, kind: 'bad' });
      this.destroyedBatch = null;
    }
    if (now >= this.nextSample) {
      this.nextSample = now + METER_STEP;
      this.sampleMeter(b, out);
    }
    return out;
  }

  private sampleMeter(b: Battle, out: Callout[]): void {
    const now = b.time;
    const { ours, theirs } = b.strength();
    this.turned = null;
    if (ours <= 0 || theirs <= 0) {
      this.share = null;
      this.history = [];
    } else {
      const share = ours / (ours + theirs);
      this.share = share;
      this.history.push({ t: now, share });
      while (this.history.length && now - this.history[0].t > TURN_WINDOW) this.history.shift();
      const was = this.history[0].share;
      const flipped = (was >= TURN_HIGH && share <= 1 - TURN_HIGH) || (was <= 1 - TURN_HIGH && share >= TURN_HIGH);
      if (flipped && now > 3 && this.ready('turn', now, CALLOUT_COOLDOWN.turn)) {
        this.turned = share > was ? 'good' : 'bad';
        const turn = this.turned;
        out.push(turn === 'good' ? { text: '戰局逆轉！我軍佔了上風', kind: 'good', turn } : { text: '戰局逆轉！敵軍佔了上風', kind: 'bad', turn });
        this.history = [{ t: now, share }];
      }
    }
    // The last few enemies: worth a word once, so a slow finish doesn't feel stuck.
    if (!this.lastFew && b.pendingSpawns === 0 && !b.result) {
      const left = b.entities.filter((e) => e.alive && e.baseTeam === 'enemy').length;
      if (left > 0 && left <= 5) {
        this.lastFew = true;
        out.push({ text: `只剩 ${left} 名敵軍了！`, kind: 'info' });
      }
    }
  }
}
