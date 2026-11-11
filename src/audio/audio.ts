// WebAudio mixer: fetched CC0/CC-BY samples layered with procedural synthesis, voice limiting,
// distance panning/attenuation, distance-delayed thunder and streamed music.
import { audioUrl, listAudio } from '../assets/manifest';
import type { Vec2 } from '../core/math';
import type { AudioAPI, SoundId } from '../powers/types';

type Synth = (a: AudioEngine, out: AudioNode, t: number, pitch: number) => number;

/** Sample groups (logical ids from the asset manifest). */
const GROUPS: Record<string, string[]> = {
  hitSoft: ['sfx/cc0a_hit_01', 'sfx/cc0a_hit_02', 'sfx/cc0a_hit_03', 'sfx/cc0a_hit_04', 'sfx/sfx100v2_hit_01', 'sfx/sfx100v2_hit_02', 'sfx/sfx100v2_hit_03'],
  hitWood: ['sfx/cc0a_wooden_01', 'sfx/cc0a_wooden_02', 'sfx/cc0a_wooden_03'],
  hitMetal: ['sfx/impactmetal_000', 'sfx/impactmetal_001', 'sfx/impactmetal_002', 'sfx/impactmetal_003', 'sfx/sfx100v2_metal_hit_01', 'sfx/sfx100v2_metal_hit_02'],
  crack: ['sfx/multiple_cracks_1', 'sfx/multiple_cracks_2'],
  glass: ['sfx/sfx100v2_glass_01', 'sfx/sfx100v2_glass_02', 'sfx/sfx100v2_glass_03', 'sfx/sfx100v2_glass_04', 'sfx/sfx100v2_glass_05'],
  explosion: ['sfx/explosioncrunch_000', 'sfx/explosioncrunch_001', 'sfx/explosioncrunch_002', 'sfx/explosioncrunch_003', 'sfx/explosioncrunch_004'],
  bigExplosion: ['sfx/lowfrequency_explosion_000', 'sfx/lowfrequency_explosion_001', 'sfx/cc0a_explosion'],
  laser: ['sfx/laserlarge_000', 'sfx/laserlarge_001', 'sfx/laserlarge_002'],
  laserSmall: ['sfx/lasersmall_000', 'sfx/lasersmall_001', 'sfx/lasersmall_002', 'sfx/laserretro_000', 'sfx/laserretro_001'],
  force: ['sfx/forcefield_000', 'sfx/forcefield_001', 'sfx/forcefield_002', 'sfx/forcefield_003'],
  thruster: ['sfx/thrusterfire_000', 'sfx/thrusterfire_001', 'sfx/thrusterfire_002'],
  teleport: ['sfx/scifi_teleport_01', 'sfx/scifi_teleport_02'],
  slime: ['sfx/slime_000', 'sfx/slime_001'],
  air: ['sfx/sfx100v2_air_01', 'sfx/sfx100v2_air_02', 'sfx/sfx100v2_air_03'],
  weird: ['sfx/scifi_weird_01', 'sfx/scifi_weird_02', 'sfx/scifi_weird_03', 'sfx/scifi_weird_04'],
  engine: ['sfx/spaceenginelow_000', 'sfx/spaceenginelow_001'],
  uiClick: ['sfx/ui_click_001', 'sfx/ui_click_002', 'sfx/ui_click_003'],
  uiOpen: ['sfx/ui_open_001', 'sfx/ui_open_002'],
  uiClose: ['sfx/ui_close_001', 'sfx/ui_close_002'],
  uiSelect: ['sfx/ui_select_001', 'sfx/ui_select_002', 'sfx/ui_select_003'],
  uiToggle: ['sfx/ui_toggle_001', 'sfx/ui_toggle_002', 'sfx/ui_toggle_003'],
  uiError: ['sfx/ui_error_001'],
};

/** Sound id → sample group (optional) + synth layer (optional). */
const SOUNDS: Record<SoundId, { group?: string; gain?: number; synth?: Synth; pitch?: [number, number] }> = {
  zap: { synth: (a, o, t, p) => a.synthZap(o, t, p), gain: 0.5 },
  thunder: { synth: (a, o, t, p) => a.synthThunder(o, t, p), gain: 0.9 },
  fire: { synth: (a, o, t, p) => a.synthNoise(o, t, 0.5, 900 * p, 'lowpass', 0.4), gain: 0.5 },
  fireball: { group: 'thruster', synth: (a, o, t, p) => a.synthNoise(o, t, 0.4, 1400 * p, 'bandpass', 0.5), gain: 0.6 },
  explosion: { group: 'explosion', synth: (a, o, t, p) => a.synthBoom(o, t, 0.8, 70 * p), gain: 0.9 },
  bigExplosion: { group: 'bigExplosion', synth: (a, o, t, p) => a.synthBoom(o, t, 2.2, 45 * p), gain: 1 },
  freeze: { synth: (a, o, t, p) => a.synthSweep(o, t, 0.5, 3000 * p, 900 * p, 'triangle', 0.18), gain: 0.5 },
  shatter: { group: 'glass', gain: 0.7 },
  wind: { synth: (a, o, t, p) => a.synthNoise(o, t, 1.2, 600 * p, 'bandpass', 0.6, true), gain: 0.5 },
  whoosh: { group: 'air', synth: (a, o, t, p) => a.synthNoise(o, t, 0.35, 1800 * p, 'bandpass', 0.5, true), gain: 0.6 },
  rock: { group: 'hitWood', synth: (a, o, t, p) => a.synthBoom(o, t, 0.35, 90 * p), gain: 0.8, pitch: [0.5, 0.7] },
  quake: { synth: (a, o, t, p) => a.synthBoom(o, t, 2.5, 32 * p, true), gain: 1 },
  water: { synth: (a, o, t, p) => a.synthNoise(o, t, 0.8, 1200 * p, 'bandpass', 0.5, true), gain: 0.45 },
  splash: { group: 'slime', synth: (a, o, t, p) => a.synthNoise(o, t, 0.4, 2400 * p, 'highpass', 0.4), gain: 0.6 },
  bubble: { synth: (a, o, t, p) => a.synthSweep(o, t, 0.15, 300 * p, 900 * p, 'sine', 0.3), gain: 0.4 },
  gravity: { group: 'engine', synth: (a, o, t, p) => a.synthSweep(o, t, 0.9, 220 * p, 55 * p, 'sawtooth', 0.12), gain: 0.6 },
  warp: { group: 'weird', synth: (a, o, t, p) => a.synthSweep(o, t, 0.7, 80 * p, 900 * p, 'sawtooth', 0.12), gain: 0.6 },
  charge: { synth: (a, o, t, p) => a.synthSweep(o, t, 1.1, 120 * p, 1100 * p, 'sawtooth', 0.1), gain: 0.5 },
  beam: { group: 'laser', synth: (a, o, t, p) => a.synthBoom(o, t, 1.2, 60 * p), gain: 0.9 },
  punch: { group: 'hitSoft', gain: 0.7, pitch: [0.85, 1.25] },
  slash: { group: 'air', synth: (a, o, t, p) => a.synthSweep(o, t, 0.18, 4000 * p, 600 * p, 'sawtooth', 0.12), gain: 0.6 },
  magic: { group: 'force', gain: 0.5 },
  acid: { group: 'slime', synth: (a, o, t, p) => a.synthNoise(o, t, 0.6, 3000 * p, 'highpass', 0.25), gain: 0.5 },
  gas: { synth: (a, o, t, p) => a.synthNoise(o, t, 1, 500 * p, 'lowpass', 0.4, true), gain: 0.5 },
  laser: { group: 'laserSmall', gain: 0.5 },
  saw: { synth: (a, o, t, p) => a.synthSweep(o, t, 0.6, 180 * p, 240 * p, 'sawtooth', 0.12), gain: 0.5 },
  heal: { synth: (a, o, t, p) => a.synthChime(o, t, p), gain: 0.5 },
  clone: { group: 'teleport', gain: 0.5, pitch: [1.2, 1.4] },
  teleport: { group: 'teleport', gain: 0.6 },
  shockwave: { group: 'force', synth: (a, o, t, p) => a.synthBoom(o, t, 0.6, 55 * p), gain: 0.8 },
  emp: { synth: (a, o, t, p) => a.synthSweep(o, t, 0.8, 1600 * p, 40 * p, 'square', 0.12), gain: 0.7 },
  timeStop: { synth: (a, o, t, p) => a.synthSweep(o, t, 0.9, 900 * p, 60 * p, 'sine', 0.35), gain: 0.7 },
  rewind: { synth: (a, o, t, p) => a.synthSweep(o, t, 0.8, 200 * p, 1400 * p, 'triangle', 0.2), gain: 0.6 },
  roar: { synth: (a, o, t, p) => a.synthSweep(o, t, 1.2, 140 * p, 70 * p, 'sawtooth', 0.22), gain: 0.7 },
  powerUp: { synth: (a, o, t, p) => a.synthChime(o, t, p * 0.75), gain: 0.7 },
};

export interface AudioSettings {
  master: number;
  sfx: number;
  music: number;
  voices: number;
}

export class AudioEngine implements AudioAPI {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private buffers = new Map<string, AudioBuffer | 'loading' | 'failed'>();
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private loops = new Map<string, { stop: () => void; gain: GainNode }>();
  private music: HTMLAudioElement | null = null;
  private musicGain: GainNode | null = null;
  settings: AudioSettings = { master: 0.8, sfx: 0.9, music: 0.35, voices: 32 };
  /** Listener position + visible width for panning / attenuation. */
  listener = { x: 0, y: 0, w: 20 };

  /** Must be called from a user gesture (iPad Safari unlock). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(comp);
      comp.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyVolumes();
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // Preload the most common groups.
      for (const g of ['hitSoft', 'hitWood', 'hitMetal', 'crack', 'explosion', 'glass']) for (const id of GROUPS[g] ?? []) void this.load(id);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.master;
    this.sfxBus.gain.value = this.settings.sfx;
    if (this.musicGain) this.musicGain.gain.value = this.settings.music;
  }

  suspend(on: boolean): void {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
    if (this.music) {
      if (on) this.music.pause();
      else void this.music.play().catch(() => undefined);
    }
  }

  private async load(id: string): Promise<AudioBuffer | null> {
    const have = this.buffers.get(id);
    if (have instanceof AudioBuffer) return have;
    if (have === 'loading' || have === 'failed' || !this.ctx) return null;
    const url = audioUrl(id);
    if (!url) {
      this.buffers.set(id, 'failed');
      return null;
    }
    this.buffers.set(id, 'loading');
    try {
      const res = await fetch(url);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.buffers.set(id, buf);
      return buf;
    } catch {
      this.buffers.set(id, 'failed');
      return null;
    }
  }

  /** Stereo pan + distance gain node chain for a world position. */
  private spatial(pos: Vec2 | undefined, volume: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let vol = volume;
    if (pos) {
      const dx = (pos.x - this.listener.x) / Math.max(4, this.listener.w / 2);
      const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y);
      vol *= 1 / (1 + Math.max(0, d - this.listener.w * 0.6) * 0.08);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-0.9, Math.min(0.9, dx * 0.7));
        g.connect(p);
        p.connect(this.sfxBus);
      } else g.connect(this.sfxBus);
    } else g.connect(this.sfxBus);
    g.gain.value = vol;
    return g;
  }

  play(id: SoundId, opts: { pos?: Vec2; volume?: number; pitch?: number; delay?: number } = {}): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (this.voices >= this.settings.voices) return;
    const def = SOUNDS[id];
    const pr = def.pitch ?? [0.92, 1.08];
    const pitch = (opts.pitch ?? 1) * (pr[0] + Math.random() * (pr[1] - pr[0]));
    let delay = opts.delay ?? 0;
    // Thunder: sound travels at 343 m/s, compressed 8x for gameplay.
    if (id === 'thunder' && opts.pos) delay += Math.hypot(opts.pos.x - this.listener.x, opts.pos.y - this.listener.y) / 343 * 8 * 0.25;
    const out = this.spatial(opts.pos, (opts.volume ?? 1) * (def.gain ?? 1));
    const t = this.ctx.currentTime + delay;
    let dur = 0.5;
    if (def.synth) dur = Math.max(dur, def.synth(this, out, t, pitch));
    if (def.group) dur = Math.max(dur, this.playGroup(def.group, out, t, pitch));
    this.voices++;
    setTimeout(() => {
      this.voices--;
      out.disconnect();
    }, (delay + dur + 0.2) * 1000);
  }

  /** Play one random sample of a group into `out`; returns duration estimate. */
  playGroup(group: string, out: AudioNode, t: number, pitch = 1): number {
    const ids = (GROUPS[group] ?? []).filter((id) => listAudio().includes(id));
    if (!ids.length) return 0;
    const id = ids[Math.floor(Math.random() * ids.length)]!;
    const buf = this.buffers.get(id);
    if (buf instanceof AudioBuffer) {
      const s = this.ctx!.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = pitch;
      s.connect(out);
      s.start(t);
      return buf.duration / pitch;
    }
    void this.load(id);
    return 0;
  }

  /** Short UI sound, not spatial, not voice-limited. */
  ui(kind: 'click' | 'open' | 'close' | 'select' | 'toggle' | 'error'): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const g = this.ctx.createGain();
    g.gain.value = 0.35;
    g.connect(this.sfxBus);
    const map = { click: 'uiClick', open: 'uiOpen', close: 'uiClose', select: 'uiSelect', toggle: 'uiToggle', error: 'uiError' } as const;
    this.playGroup(map[kind], g, this.ctx.currentTime);
    setTimeout(() => g.disconnect(), 1500);
  }

  impact(material: string, strength: number, pos: Vec2): void {
    if (!this.ctx || this.voices >= this.settings.voices * 0.6) return;
    const group = material === 'metal' ? 'hitMetal' : material === 'wood' || material === 'explosive' ? 'hitWood' : material === 'ice' ? 'glass' : 'hitSoft';
    const out = this.spatial(pos, Math.min(1, 0.15 + strength * 0.05));
    const pitch = material === 'stone' ? 0.6 : material === 'rubber' ? 1.3 : 0.9 + Math.random() * 0.25;
    const d = this.playGroup(group, out, this.ctx.currentTime, pitch);
    this.voices++;
    setTimeout(() => {
      this.voices--;
      out.disconnect();
    }, (d + 0.2) * 1000);
  }

  jointBreak(pos: Vec2): void {
    if (!this.ctx) return;
    const out = this.spatial(pos, 0.55);
    const d = this.playGroup('crack', out, this.ctx.currentTime, 1.3 + Math.random() * 0.4);
    this.synthNoise(out, this.ctx.currentTime, 0.08, 2500, 'highpass', 0.5);
    setTimeout(() => out.disconnect(), (d + 0.3) * 1000);
  }

  loop(key: string, id: SoundId | null, opts: { pos?: Vec2; volume?: number } = {}): void {
    const cur = this.loops.get(key);
    if (!id) {
      if (cur) {
        cur.stop();
        this.loops.delete(key);
      }
      return;
    }
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (cur) {
      cur.gain.gain.value = (opts.volume ?? 1) * 0.5;
      return;
    }
    const gain = this.spatial(undefined, (opts.volume ?? 1) * 0.5);
    let stop: () => void;
    if (id === 'thunder' || key === 'storm') {
      const audio = this.streamLoop('ambience/storm_loop', gain);
      stop = audio;
    } else {
      // Filtered noise bed for fire / wind / water / beams.
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      const cfg: Partial<Record<SoundId, [BiquadFilterType, number]>> = {
        fire: ['lowpass', 700], wind: ['bandpass', 500], water: ['bandpass', 1300], beam: ['lowpass', 260], saw: ['bandpass', 2200], gas: ['lowpass', 400], acid: ['highpass', 2500],
      };
      const [type, freq] = cfg[id] ?? ['lowpass', 800];
      f.type = type;
      f.frequency.value = freq;
      src.connect(f);
      f.connect(gain);
      src.start();
      stop = () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        gain.disconnect();
      };
    }
    this.loops.set(key, { stop, gain });
  }

  private streamLoop(id: string, out: GainNode): () => void {
    const url = audioUrl(id);
    if (!url || !this.ctx) return () => out.disconnect();
    const el = new Audio(url);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    const node = this.ctx.createMediaElementSource(el);
    node.connect(out);
    void el.play().catch(() => undefined);
    return () => {
      el.pause();
      node.disconnect();
      out.disconnect();
    };
  }

  /** Background music, streamed (never decoded fully: iPad memory budget). */
  startMusic(): void {
    if (!this.ctx || this.music) return;
    const url = audioUrl('music/ambient_soundscape');
    if (!url) return;
    this.music = new Audio(url);
    this.music.loop = true;
    this.music.crossOrigin = 'anonymous';
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.settings.music;
    this.ctx.createMediaElementSource(this.music).connect(this.musicGain);
    this.musicGain.connect(this.master);
    void this.music.play().catch(() => undefined);
  }

  // ---------------------------------------------------------------- synth layers
  synthNoise(out: AudioNode, t: number, dur: number, freq: number, type: BiquadFilterType, vol: number, swell = false): number {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(swell ? 0.0001 : vol, t);
    if (swell) g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    return dur;
  }

  synthSweep(out: AudioNode, t: number, dur: number, f0: number, f1: number, type: OscillatorType, vol: number): number {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return dur;
  }

  synthBoom(out: AudioNode, t: number, dur: number, f: number, rumble = false): number {
    this.synthSweep(out, t, dur * 0.6, f * 2.2, f * 0.5, 'sine', 0.8);
    this.synthNoise(out, t, dur, rumble ? 160 : 420, 'lowpass', rumble ? 0.9 : 0.7);
    return dur;
  }

  synthZap(out: AudioNode, t: number, pitch: number): number {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'square';
    const g = c.createGain();
    const dur = 0.12 + Math.random() * 0.12;
    // Random frequency jumps = electric crackle.
    for (let i = 0; i < 8; i++) o.frequency.setValueAtTime((200 + Math.random() * 1600) * pitch, t + (i * dur) / 8);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 500;
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.synthNoise(out, t, dur, 4000, 'highpass', 0.35);
    return dur;
  }

  synthThunder(out: AudioNode, t: number, pitch: number): number {
    // Sharp crack + long rolling rumble.
    this.synthNoise(out, t, 0.18, 3200 * pitch, 'highpass', 0.9);
    this.synthNoise(out, t + 0.03, 2.6, 180 * pitch, 'lowpass', 1);
    this.synthNoise(out, t + 0.4 + Math.random() * 0.3, 1.8, 120 * pitch, 'lowpass', 0.7, true);
    return 3;
  }

  synthChime(out: AudioNode, t: number, pitch: number): number {
    [523, 659, 784, 1046].forEach((f, i) => this.synthSweep(out, t + i * 0.07, 0.6, f * pitch, f * pitch * 1.01, 'sine', 0.2));
    return 0.9;
  }
}
