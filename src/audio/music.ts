/** Small Web Audio sequencer that synthesises the background music for each scene. */

export type TrackName = 'title' | 'story' | 'map' | 'battle' | 'boss' | 'ending';

interface Track {
  bpm: number;
  /** One chord per bar, e.g. 'Am', 'F', 'C', 'G', 'E', 'Bdim'. */
  chords: string[];
  pad?: { vol: number; bright: number };
  /** Bass hits per 8th note ('x' = root, 'o' = fifth, '.' = rest), repeated every bar. */
  bass?: { pattern: string; vol: number; octave: number };
  /** Arpeggio over the chord: chord-tone indices per 16th ('.' = rest). */
  arp?: { pattern: string; vol: number; octave: number; wave: OscillatorType };
  /** Melody: one token per 8th note; note names, '_' holds, '.' rests. Loops over the chord cycle. */
  melody?: { notes: string; vol: number; wave: OscillatorType };
  /** 16-step drum lanes per bar. */
  drums?: { kick?: string; snare?: string; hat?: string; tom?: string; vol: number };
  bell?: { notes: string; vol: number };
}

const TRACKS: Record<TrackName, Track> = {
  title: {
    bpm: 76,
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'],
    pad: { vol: 0.07, bright: 1400 },
    bass: { pattern: 'x.......', vol: 0.16, octave: 2 },
    arp: { pattern: '0.1.2.1.0.1.2.1.', vol: 0.045, octave: 4, wave: 'triangle' },
    melody: {
      notes: 'E5 _ _ D5 C5 _ B4 _ ' + 'A4 _ _ _ C5 _ _ _ ' + 'G4 _ _ A4 B4 _ C5 _ ' + 'D5 _ _ _ _ _ . . ' + 'E5 _ _ D5 C5 _ E5 _ ' + 'F5 _ _ E5 D5 _ C5 _ ' + 'B4 _ _ C5 D5 _ _ _ ' + 'E5 _ _ _ _ _ . . ',
      vol: 0.06,
      wave: 'triangle',
    },
    drums: { tom: 'x...............', vol: 0.12 },
  },
  story: {
    bpm: 62,
    chords: ['Dm', 'Bb', 'F', 'A', 'Dm', 'Gm', 'A', 'Dm'],
    pad: { vol: 0.08, bright: 1000 },
    bass: { pattern: 'x...o...', vol: 0.12, octave: 2 },
    melody: {
      notes: 'A4 _ _ _ F4 _ D4 _ ' + 'D5 _ _ _ C5 _ Bb4 _ ' + 'A4 _ _ _ C5 _ F4 _ ' + 'E4 _ _ _ _ _ . . ' + 'F4 _ _ G4 A4 _ D5 _ ' + 'Bb4 _ _ A4 G4 _ _ _ ' + 'A4 _ C#5 _ E5 _ _ _ ' + 'D5 _ _ _ _ _ . . ',
      vol: 0.05,
      wave: 'sine',
    },
    bell: { notes: 'D6 . . . . . . . ' + '. . . . . . . . ', vol: 0.03 },
  },
  map: {
    bpm: 100,
    chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'],
    pad: { vol: 0.05, bright: 1800 },
    bass: { pattern: 'x.x.o.x.', vol: 0.12, octave: 2 },
    arp: { pattern: '0.2.1.2.0.2.1.2.', vol: 0.04, octave: 4, wave: 'triangle' },
    melody: {
      notes: 'E5 _ G5 _ E5 D5 C5 _ ' + 'D5 _ B4 _ G4 _ _ _ ' + 'C5 _ E5 _ A5 _ G5 _ ' + 'F5 _ E5 _ D5 _ _ _ ' + 'E5 _ G5 _ C6 _ B5 _ ' + 'A5 _ G5 _ D5 _ _ _ ' + 'F5 _ E5 _ D5 _ C5 _ ' + 'D5 _ _ _ _ _ . . ',
      vol: 0.045,
      wave: 'square',
    },
    drums: { kick: 'x.......x.......', snare: '........x.......', hat: '..x...x...x...x.', vol: 0.1 },
  },
  battle: {
    bpm: 136,
    chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'D', 'Em'],
    pad: { vol: 0.04, bright: 1500 },
    bass: { pattern: 'xxxxoxxx', vol: 0.13, octave: 2 },
    arp: { pattern: '0.0.2.1.0.0.2.1.', vol: 0.035, octave: 4, wave: 'sawtooth' },
    melody: {
      notes: 'B4 _ _ E5 _ _ G5 _ ' + 'G5 _ F#5 _ E5 _ _ _ ' + 'F#5 _ _ A5 _ _ D5 _ ' + 'D#5 _ _ _ B4 _ _ _ ' + 'B4 _ _ E5 _ _ G5 _ ' + 'C6 _ B5 _ A5 _ G5 _ ' + 'F#5 _ G5 _ A5 _ F#5 _ ' + 'E5 _ _ _ _ _ . . ',
      vol: 0.04,
      wave: 'square',
    },
    drums: { kick: 'x...x...x...x.x.', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx', vol: 0.13 },
  },
  boss: {
    bpm: 148,
    chords: ['Cm', 'Ab', 'Bb', 'G', 'Cm', 'Ab', 'Fm', 'G'],
    pad: { vol: 0.05, bright: 900 },
    bass: { pattern: 'xxxxxxxx', vol: 0.16, octave: 1 },
    arp: { pattern: '0.1.2.1.0.1.2.1.', vol: 0.035, octave: 4, wave: 'sawtooth' },
    melody: {
      notes: 'C5 _ _ _ Eb5 _ _ _ ' + 'G5 _ F5 _ Eb5 _ D5 _ ' + 'F5 _ _ _ D5 _ Bb4 _ ' + 'B4 _ _ _ D5 _ _ _ ' + 'C6 _ _ _ G5 _ Eb5 _ ' + 'Ab5 _ G5 _ F5 _ Eb5 _ ' + 'F5 _ Ab5 _ C6 _ _ _ ' + 'B5 _ _ _ G5 _ . . ',
      vol: 0.045,
      wave: 'sawtooth',
    },
    drums: { kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', tom: '..............xx', vol: 0.14 },
  },
  ending: {
    bpm: 84,
    chords: ['C', 'F', 'G', 'C', 'Am', 'F', 'G', 'C'],
    pad: { vol: 0.07, bright: 2200 },
    bass: { pattern: 'x...o...', vol: 0.13, octave: 2 },
    arp: { pattern: '0.1.2.3.2.1.0.1.', vol: 0.04, octave: 4, wave: 'triangle' },
    melody: {
      notes: 'G4 _ C5 _ E5 _ _ D5 ' + 'C5 _ A4 _ F5 _ _ _ ' + 'D5 _ E5 _ F5 _ G5 _ ' + 'E5 _ _ _ C5 _ _ _ ' + 'A5 _ G5 _ E5 _ C5 _ ' + 'F5 _ E5 _ D5 _ C5 _ ' + 'B4 _ C5 _ D5 _ G5 _ ' + 'C6 _ _ _ _ _ . . ',
      vol: 0.055,
      wave: 'triangle',
    },
    drums: { kick: 'x.......x.......', snare: '........x.......', hat: 'x...x...x...x...', vol: 0.08 },
    bell: { notes: 'C6 . . . G5 . . . ' + 'E6 . . . . . . . ', vol: 0.025 },
  },
};

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteFreq(name: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(name);
  if (!m) return 0;
  let n = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  n += (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (n - 69) / 12);
}

/** Chord tones as MIDI numbers relative to octave 0 (root, third, fifth, octave). */
function chordTones(chord: string): number[] {
  const m = /^([A-G])(#|b)?(m|dim)?/.exec(chord)!;
  const root = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const third = m[3] ? 3 : 4;
  const fifth = m[3] === 'dim' ? 6 : 7;
  return [root, root + third, root + fifth, root + 12];
}

const midiFreq = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

const STORE_KEY = 'mini-empire.audio.v1';

export function loadAudioPrefs(): { music: boolean; sfx: boolean } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { music?: boolean; sfx?: boolean };
      return { music: p.music !== false, sfx: p.sfx !== false };
    }
  } catch {
    // ignore
  }
  return { music: true, sfx: true };
}

export function saveAudioPrefs(p: { music: boolean; sfx: boolean }): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private bus: GainNode | null = null;
  private track: Track | null = null;
  private name: TrackName | null = null;
  private wanted: TrackName | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  muted = false;
  volume = 0.55;

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      // Browsers only start audio after a user gesture.
      const resume = () => {
        if (this.ctx?.state === 'suspended') void this.ctx.resume();
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.1);
    if (!m && this.wanted && !this.track) this.play(this.wanted);
  }

  /** Cross-fades to a track (no-op if it is already playing). */
  play(name: TrackName): void {
    this.wanted = name;
    if (this.name === name && this.track) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    if (this.bus) {
      const old = this.bus;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + 1.2);
      setTimeout(() => old.disconnect(), 1500);
    }
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, now);
    this.bus.gain.linearRampToValueAtTime(1, now + 1);
    this.bus.connect(this.master);
    this.track = TRACKS[name];
    this.name = name;
    this.step = 0;
    this.nextTime = now + 0.1;
    if (this.timer === null) this.timer = window.setInterval(() => this.schedule(), 40);
  }

  stop(): void {
    this.wanted = null;
    if (this.bus && this.ctx) {
      const old = this.bus;
      old.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      setTimeout(() => old.disconnect(), 1500);
    }
    this.bus = null;
    this.track = null;
    this.name = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const tr = this.track;
    if (!ctx || !tr || !this.bus) return;
    const stepDur = 60 / tr.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.2) {
      this.playStep(tr, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(tr: Track, step: number, t: number, stepDur: number): void {
    const barSteps = 16;
    const bar = Math.floor(step / barSteps) % tr.chords.length;
    const s = step % barSteps;
    const chord = chordTones(tr.chords[bar]);
    const bus = this.bus!;

    if (tr.pad && s === 0) {
      for (const n of chord.slice(0, 3)) this.padNote(bus, midiFreq(n + 48), barSteps * stepDur, tr.pad.vol, tr.pad.bright, t);
    }
    if (tr.bass && s % 2 === 0) {
      const c = tr.bass.pattern[(s / 2) % tr.bass.pattern.length];
      if (c === 'x' || c === 'o') {
        const n = (c === 'x' ? chord[0] : chord[2]) + (tr.bass.octave + 1) * 12;
        this.pluck(bus, midiFreq(n), stepDur * 1.8, tr.bass.vol, 'triangle', t, 600);
      }
    }
    if (tr.arp) {
      const c = tr.arp.pattern[s % tr.arp.pattern.length];
      if (c !== '.') {
        const n = chord[Number(c) % chord.length] + (tr.arp.octave + 1) * 12;
        this.pluck(bus, midiFreq(n), stepDur * 1.6, tr.arp.vol, tr.arp.wave, t, 2400);
      }
    }
    if (tr.melody && s % 2 === 0) {
      const tokens = tr.melody.notes.trim().split(/\s+/);
      const idx = Math.floor(step / 2) % tokens.length;
      const tok = tokens[idx];
      if (tok !== '_' && tok !== '.') {
        let len = 1;
        while (tokens[(idx + len) % tokens.length] === '_' && len < 16) len++;
        this.lead(bus, noteFreq(tok), len * 2 * stepDur, tr.melody.vol, tr.melody.wave, t);
      }
    }
    if (tr.bell && s % 2 === 0) {
      const tokens = tr.bell.notes.trim().split(/\s+/);
      const tok = tokens[Math.floor(step / 2) % tokens.length];
      if (tok !== '.' && tok !== '_') this.bellNote(bus, noteFreq(tok), tr.bell.vol, t);
    }
    if (tr.drums) {
      const d = tr.drums;
      if (d.kick?.[s] === 'x') this.kick(bus, d.vol, t);
      if (d.snare?.[s] === 'x') this.snare(bus, d.vol * 0.8, t);
      if (d.hat?.[s] === 'x') this.hat(bus, d.vol * 0.35, t);
      if (d.tom?.[s] === 'x') this.tom(bus, d.vol, t);
    }
  }

  // ---------------------------------------------------------------- instruments

  private env(g: GainNode, t: number, attack: number, peak: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private padNote(bus: GainNode, f: number, dur: number, vol: number, bright: number, t: number): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = bright;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(vol * 0.8, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    filter.connect(g).connect(bus);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(filter);
      o.start(t);
      o.stop(t + dur * 1.1);
    }
  }

  private pluck(bus: GainNode, f: number, dur: number, vol: number, wave: OscillatorType, t: number, cutoff: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = f;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, dur);
    o.connect(filter).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private lead(bus: GainNode, f: number, dur: number, vol: number, wave: OscillatorType, t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = f;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibGain = ctx.createGain();
    vibGain.gain.value = f * 0.006;
    vib.connect(vibGain).connect(o.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = wave === 'sine' || wave === 'triangle' ? 4000 : 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + Math.max(0.05, dur * 0.7));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98);
    o.connect(filter).connect(g).connect(bus);
    o.start(t);
    vib.start(t);
    o.stop(t + dur);
    vib.stop(t + dur);
  }

  private bellNote(bus: GainNode, f: number, vol: number, t: number): void {
    const ctx = this.ctx!;
    for (const [mult, v] of [
      [1, 1],
      [2.76, 0.4],
      [5.4, 0.2],
    ]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      this.env(g, t, 0.005, vol * v, 2.2);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 2.3);
    }
  }

  private noiseHit(bus: GainNode, vol: number, t: number, dur: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private kick(bus: GainNode, vol: number, t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    const g = ctx.createGain();
    this.env(g, t, 0.003, vol * 1.6, 0.25);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(bus: GainNode, vol: number, t: number): void {
    this.noiseHit(bus, vol, t, 0.16, 'bandpass', 1800);
    this.pluck(bus, 190, 0.1, vol * 0.6, 'triangle', t, 2000);
  }

  private hat(bus: GainNode, vol: number, t: number): void {
    this.noiseHit(bus, vol, t, 0.04, 'highpass', 7000);
  }

  private tom(bus: GainNode, vol: number, t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.45);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol * 1.4, 0.6);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.65);
  }
}
