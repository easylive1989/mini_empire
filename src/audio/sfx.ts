/** Tiny Web Audio synthesiser for game sound effects (no audio files needed). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<string, number>();
  muted = false;
  volume = 0.5;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, filterFreq: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Plays a named effect, rate-limited so big battles don't turn into noise. */
  play(name: string): void {
    if (this.muted) return;
    const now = performance.now();
    const gap: Record<string, number> = { hit: 45, hitMagic: 60, swing: 60, shoot: 70, cast: 90, bones: 70, death: 90, crit: 80, zap: 90, boom: 70 };
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < (gap[name] ?? 40)) return;
    this.lastPlayed.set(name, now);
    const r = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'click':
        this.tone(660, 0.06, 'triangle', 0.15);
        break;
      case 'error':
        this.tone(180, 0.18, 'square', 0.08, 120);
        break;
      case 'build':
        this.hiss(0.2, 0.25, 900);
        this.tone(220, 0.12, 'triangle', 0.25, 160);
        this.tone(330, 0.12, 'triangle', 0.2, 240, 0.1);
        break;
      case 'upgrade':
        [523, 659, 784, 1046].forEach((f, k) => this.tone(f, 0.18, 'triangle', 0.15, undefined, k * 0.07));
        break;
      case 'coin':
        this.tone(988, 0.08, 'square', 0.08);
        this.tone(1319, 0.2, 'square', 0.08, undefined, 0.07);
        break;
      case 'horn':
        this.tone(196, 0.9, 'sawtooth', 0.12, 220);
        this.tone(294, 0.9, 'sawtooth', 0.08, 330, 0.05);
        break;
      case 'boss':
        this.tone(70, 1.4, 'sawtooth', 0.2, 50);
        this.hiss(1.2, 0.2, 300);
        break;
      case 'swing':
        this.hiss(0.09, 0.12 * r, 2400, 'bandpass');
        break;
      case 'shoot':
        this.hiss(0.07, 0.1 * r, 3500, 'highpass');
        this.tone(900 * r, 0.06, 'triangle', 0.04, 500);
        break;
      case 'cast':
        this.tone(500 * r, 0.25, 'sine', 0.07, 1100);
        break;
      case 'hit':
        this.hiss(0.06, 0.13 * r, 1500);
        this.tone(140 * r, 0.06, 'square', 0.04, 90);
        break;
      case 'hitMagic':
        this.tone(700 * r, 0.12, 'sine', 0.06, 300);
        break;
      case 'crit':
        this.hiss(0.1, 0.2, 2000);
        this.tone(220, 0.12, 'square', 0.08, 110);
        break;
      case 'bones':
        this.hiss(0.15, 0.12, 4000, 'bandpass');
        this.tone(300 * r, 0.05, 'square', 0.05, 200, 0.03);
        break;
      case 'death':
        this.tone(330 * r, 0.25, 'triangle', 0.08, 140);
        break;
      case 'boom':
        this.hiss(0.45, 0.35, 500);
        this.tone(90, 0.35, 'sine', 0.25, 40);
        break;
      case 'zap':
        this.hiss(0.15, 0.15, 5000, 'highpass');
        this.tone(1400, 0.12, 'sawtooth', 0.05, 300);
        break;
      case 'aoe':
        this.tone(260, 0.3, 'sine', 0.1, 520);
        break;
      case 'root':
        this.hiss(0.3, 0.12, 700, 'bandpass');
        this.tone(160, 0.3, 'triangle', 0.08, 120);
        break;
      case 'shield':
        [880, 1175].forEach((f, k) => this.tone(f, 0.3, 'sine', 0.07, undefined, k * 0.06));
        break;
      case 'charm':
        [784, 988].forEach((f, k) => this.tone(f, 0.2, 'sine', 0.07, undefined, k * 0.08));
        break;
      case 'resurrect':
        [523, 659, 784, 1046, 1318].forEach((f, k) => this.tone(f, 0.25, 'sine', 0.07, undefined, k * 0.06));
        break;
      case 'collapse':
        this.hiss(0.8, 0.3, 400);
        this.tone(60, 0.6, 'sine', 0.2, 35);
        break;
      case 'victory':
        [523, 659, 784, 1046, 784, 1046].forEach((f, k) => this.tone(f, 0.28, 'triangle', 0.14, undefined, k * 0.13));
        break;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, k) => this.tone(f, 0.45, 'triangle', 0.13, undefined, k * 0.22));
        break;
      case 'boon':
        [659, 880, 1109, 1319].forEach((f, k) => this.tone(f, 0.35, 'sine', 0.09, undefined, k * 0.09));
        break;
    }
  }
}
