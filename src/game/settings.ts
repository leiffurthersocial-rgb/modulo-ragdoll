// Quality presets, Battery Saver, persisted settings and key bindings.

export type PresetId = 'ultra' | 'high' | 'medium' | 'low' | 'battery' | 'custom';

export interface Quality {
  pixelRatioCap: number;
  fpsCap: 30 | 60 | 0;
  bloom: 'full' | 'half' | 'quarter' | 'off';
  particles: number;
  maxBodies: number;
  maxDummies: number;
  solverIterations: number;
  shake: boolean;
  chroma: boolean;
  backdrop: 'high' | 'low' | 'off';
  voices: number;
  boltDetail: number;
  /** Pause rendering when the tab is hidden or a menu is open. */
  pauseWhenIdle: boolean;
  /** Put still bodies to sleep quickly. */
  aggressiveSleep: boolean;
}

export const PRESETS: Record<Exclude<PresetId, 'custom'>, Quality> = {
  ultra: { pixelRatioCap: 2, fpsCap: 0, bloom: 'full', particles: 10000, maxBodies: 700, maxDummies: 40, solverIterations: 8, shake: true, chroma: true, backdrop: 'high', voices: 48, boltDetail: 1, pauseWhenIdle: false, aggressiveSleep: false },
  high: { pixelRatioCap: 2, fpsCap: 60, bloom: 'half', particles: 6000, maxBodies: 450, maxDummies: 25, solverIterations: 6, shake: true, chroma: true, backdrop: 'high', voices: 32, boltDetail: 0.85, pauseWhenIdle: false, aggressiveSleep: false },
  medium: { pixelRatioCap: 1.5, fpsCap: 60, bloom: 'half', particles: 3000, maxBodies: 280, maxDummies: 15, solverIterations: 4, shake: true, chroma: true, backdrop: 'high', voices: 24, boltDetail: 0.7, pauseWhenIdle: false, aggressiveSleep: false },
  low: { pixelRatioCap: 1, fpsCap: 60, bloom: 'quarter', particles: 1500, maxBodies: 160, maxDummies: 8, solverIterations: 4, shake: true, chroma: false, backdrop: 'low', voices: 16, boltDetail: 0.5, pauseWhenIdle: true, aggressiveSleep: false },
  battery: { pixelRatioCap: 0.85, fpsCap: 30, bloom: 'quarter', particles: 800, maxBodies: 100, maxDummies: 6, solverIterations: 3, shake: false, chroma: false, backdrop: 'low', voices: 12, boltDetail: 0.35, pauseWhenIdle: true, aggressiveSleep: true },
};

export const PRESET_ORDER: Exclude<PresetId, 'custom'>[] = ['ultra', 'high', 'medium', 'low', 'battery'];
export const PRESET_LABEL: Record<PresetId, string> = { ultra: 'Ultra', high: 'High', medium: 'Medium', low: 'Low', battery: 'Battery Saver', custom: 'Custom' };

export type Action =
  | 'pause'
  | 'step'
  | 'slowmo'
  | 'undo'
  | 'clear'
  | 'reset'
  | 'nextSub'
  | 'prevSub'
  | 'nextCategory'
  | 'wheel'
  | 'toolGrab'
  | 'toolSpawn'
  | 'toolDelete'
  | 'toolPower'
  | 'debug'
  | 'params'
  | 'menu'
  | 'spawnDummy';

export const ACTION_LABEL: Record<Action, string> = {
  pause: 'Pause / resume',
  step: 'Step one frame',
  slowmo: 'Toggle slow motion',
  undo: 'Undo',
  clear: 'Clear objects',
  reset: 'Reset scene',
  nextSub: 'Next sub-ability',
  prevSub: 'Previous sub-ability',
  nextCategory: 'Next power category',
  wheel: 'Power wheel (hold)',
  toolGrab: 'Grab tool',
  toolSpawn: 'Spawn tool',
  toolDelete: 'Delete tool',
  toolPower: 'Power tool',
  debug: 'Debug overlay',
  params: 'Power parameters panel',
  menu: 'Menu',
  spawnDummy: 'Spawn dummy at cursor',
};

export const DEFAULT_KEYS: Record<Action, string> = {
  pause: 'KeyP',
  step: 'Period',
  slowmo: 'KeyT',
  undo: 'KeyZ',
  clear: 'KeyC',
  reset: 'KeyR',
  nextSub: 'KeyE',
  prevSub: 'KeyQ',
  nextCategory: 'KeyX',
  wheel: 'Tab',
  toolGrab: 'KeyG',
  toolSpawn: 'KeyB',
  toolDelete: 'KeyD',
  toolPower: 'KeyF',
  debug: 'F3',
  params: 'F4',
  menu: 'Escape',
  spawnDummy: 'KeyN',
};

export interface Settings {
  preset: PresetId;
  custom: Quality;
  master: number;
  sfx: number;
  music: number;
  damageNumbers: boolean;
  healthBars: boolean;
  killCam: boolean;
  autoZoom: boolean;
  touchControls: 'auto' | 'on' | 'off';
  watchdog: boolean;
  infiniteEnergy: boolean;
  keys: Record<Action, string>;
  arena: string;
  seenIntro: boolean;
}

const STORAGE_KEY = 'modulo-ragdoll:settings:v1';

export function defaultSettings(): Settings {
  return {
    preset: 'high',
    custom: { ...PRESETS.high },
    master: 0.8,
    sfx: 0.9,
    music: 0.3,
    damageNumbers: true,
    healthBars: false,
    killCam: true,
    autoZoom: false,
    touchControls: 'auto',
    watchdog: true,
    infiniteEnergy: false,
    keys: { ...DEFAULT_KEYS },
    arena: 'flat',
    seenIntro: false,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...s, custom: { ...d.custom, ...s.custom }, keys: { ...d.keys, ...s.keys } };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export function quality(s: Settings): Quality {
  return s.preset === 'custom' ? s.custom : PRESETS[s.preset];
}

/** Next lower preset (watchdog). */
export function lowerPreset(p: PresetId): PresetId | null {
  if (p === 'custom') return 'medium';
  const i = PRESET_ORDER.indexOf(p);
  return i >= 0 && i < PRESET_ORDER.length - 1 ? PRESET_ORDER[i + 1]! : null;
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
}

/**
 * Frame-time watchdog: if the average frame time stays above the budget for `window` seconds,
 * report once so the game can drop a preset. Pure, unit-tested.
 */
export class Watchdog {
  private bad = 0;
  private samples: number[] = [];
  constructor(
    public budgetMs = 1000 / 50,
    public windowSec = 5,
  ) {}
  /** Feed one frame; returns true when quality should drop. */
  sample(frameMs: number, dtSec: number): boolean {
    this.samples.push(frameMs);
    if (this.samples.length > 30) this.samples.shift();
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.bad = avg > this.budgetMs ? this.bad + dtSec : Math.max(0, this.bad - dtSec * 2);
    if (this.bad >= this.windowSec) {
      this.bad = 0;
      this.samples = [];
      return true;
    }
    return false;
  }
}
