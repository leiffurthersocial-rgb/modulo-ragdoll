// Menus: main menu, arenas, power browser (with live preview), save/load, settings, help, credits.
import licenses from '../../assets/LICENSES.json';
import { rng } from '../core/math';
import { generateBolt } from '../fx/bolt';
import type { Game } from '../game/game';
import { loadSlot, saveSlot, serialize, validateScene } from '../game/save';
import { ACTION_LABEL, DEFAULT_KEYS, PRESET_LABEL, PRESET_ORDER, quality, type Action, type PresetId, type Quality } from '../game/settings';
import { ARENAS, type ArenaId } from '../physics/objects';
import { CATEGORIES } from '../powers/registry';
import type { Power } from '../powers/types';
import { groupCredits, type LicenseRecord } from './credits';
import { clear, h, hex, keyLabel } from './dom';
import type { Hud } from './hud';
import { iconEl } from './icons';

type Panel = 'main' | 'arenas' | 'powers' | 'saves' | 'settings' | 'help' | 'credits';

const ARENA_DESC: Record<ArenaId, string> = {
  flat: 'A wide open floor. Good for everything.',
  pit: 'A deep pit with walls. Knock them in.',
  tower: 'A tall tower of platforms. Gravity does the rest.',
  box: 'A closed room. Nothing escapes.',
  space: 'Zero gravity inside a containment field.',
};

export class Menus {
  private root: HTMLElement;
  private panel: Panel | null = null;
  private previewRaf = 0;
  private browsing: Power | null = null;

  constructor(private game: Game, private hud: Hud, parent: HTMLElement) {
    this.root = h('div', { class: 'menu-layer', hidden: true });
    parent.append(this.root);
    hud.onMenu = (p) => {
      if (p === 'close') this.close();
      else this.open((p as Panel) ?? 'main');
    };
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return this.panel !== null;
  }

  open(p: Panel): void {
    this.panel = p;
    this.game.menuOpen = true;
    this.game.cancelActions();
    this.game.updateRunning();
    this.game.audio.ui('open');
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    if (!this.panel) return;
    this.panel = null;
    cancelAnimationFrame(this.previewRaf);
    this.root.hidden = true;
    this.game.menuOpen = false;
    this.game.updateRunning();
    this.game.audio.ui('close');
  }

  private shell(title: string, body: HTMLElement, wide = false): HTMLElement {
    const back = this.panel !== 'main' ? h('button', { class: 'btn', onclick: () => this.open('main') }, '← Back') : null;
    return h('div', { class: `panel${wide ? ' wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('header', {}, back, h('h2', {}, title), h('button', { class: 'btn icon-btn', 'aria-label': 'Close', onclick: () => this.close() }, '✕')),
      h('div', { class: 'scroll' }, body),
    );
  }

  private render(): void {
    cancelAnimationFrame(this.previewRaf);
    clear(this.root);
    switch (this.panel) {
      case 'main': this.root.append(this.mainMenu()); break;
      case 'arenas': this.root.append(this.arenas()); break;
      case 'powers': this.root.append(this.powers()); break;
      case 'saves': this.root.append(this.saves()); break;
      case 'settings': this.root.append(this.settings()); break;
      case 'help': this.root.append(this.help()); break;
      case 'credits': this.root.append(this.credits()); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- main
  private mainMenu(): HTMLElement {
    const item = (label: string, sub: string, fn: () => void) => h('button', { class: 'menu-item', onclick: fn }, h('strong', {}, label), h('span', {}, sub));
    const body = h('div', { class: 'main-menu' },
      h('p', { class: 'muted' }, 'A physics sandbox. Spawn crash-test dummies and try powers on them. No goals, no levels.'),
      item('Play', 'Back to the sandbox', () => this.close()),
      item('Arenas', ARENAS[this.game.arena].name, () => this.open('arenas')),
      item('Power browser', `${this.game.runtime.powers.length} powers, ${this.game.runtime.powers.reduce((n, p) => n + p.subs.length, 0)} abilities`, () => this.open('powers')),
      item('Save & load', 'Slots, export and import', () => this.open('saves')),
      item('Settings', `Quality: ${PRESET_LABEL[this.game.settings.preset]}`, () => this.open('settings')),
      item('Controls', 'Keys, mouse and touch', () => this.open('help')),
      item('Credits', 'Assets and licenses', () => this.open('credits')),
    );
    return this.shell('Modulo: Ragdoll', body);
  }

  // ---------------------------------------------------------------- arenas
  private arenas(): HTMLElement {
    const list = h('div', { class: 'card-grid' });
    for (const a of Object.values(ARENAS)) {
      list.append(h('button', {
        class: `card${a.id === this.game.arena ? ' active' : ''}`,
        onclick: () => {
          this.game.pushUndo();
          this.game.loadArena(a.id, true);
          this.close();
        },
      }, h('strong', {}, a.name), h('span', { class: 'muted' }, ARENA_DESC[a.id])));
    }
    return this.shell('Arenas', list);
  }

  // ---------------------------------------------------------------- power browser
  private powers(): HTMLElement {
    const rt = this.game.runtime;
    this.browsing ??= rt.power;
    const list = h('div', { class: 'pb-list' });
    const detail = h('div', { class: 'pb-detail' });
    for (const cat of CATEGORIES) {
      list.append(h('div', { class: 'pb-cat' }, cat));
      for (const p of rt.powers.filter((x) => x.category === cat)) {
        const b = h('button', { class: `pb-item${p === this.browsing ? ' active' : ''}`, onclick: () => {
          this.browsing = p;
          this.render();
        } }, iconEl(p.icon, 20, p.name), h('span', {}, p.name));
        b.style.setProperty('--pc', hex(p.palette.primary));
        list.append(b);
      }
    }
    const p = this.browsing;
    const canvas = h('canvas', { class: 'preview', width: 480, height: 220, 'aria-label': `${p.name} preview` });
    const subs = h('ul', { class: 'pb-subs' });
    p.subs.forEach((s) => subs.append(h('li', {},
      h('div', {}, h('strong', {}, s.name), h('span', { class: 'tag' }, s.input.replace('-', ' ')), s.cooldown ? h('span', { class: 'muted small' }, ` · ${s.cooldown}s cooldown`) : null, s.cost ? h('span', { class: 'muted small' }, ` · ${s.cost} energy`) : null),
      h('p', { class: 'muted' }, s.description),
      h('button', { class: 'btn small', onclick: () => {
        rt.selectById(p.id, s.id);
        this.hud.category = p.category;
        this.hud.setTool('power');
        this.close();
      } }, 'Use'),
    )));
    detail.append(
      h('div', { class: 'pb-head' }, iconEl(p.icon, 40, p.name), h('div', {}, h('h3', {}, p.name), h('p', { class: 'muted' }, p.description))),
      canvas,
      h('div', { class: 'swatches' }, ...[p.palette.primary, p.palette.secondary, p.palette.core].map((c) => h('span', { class: 'swatch', style: `background:${hex(c)}` }))),
      subs,
    );
    this.preview(canvas, p);
    return this.shell('Power browser', h('div', { class: 'pb' }, list, detail), true);
  }

  /** Small 2D-canvas preview: lightning-style bolts for electric powers, swirling particles otherwise. */
  private preview(canvas: HTMLCanvasElement, p: Power): void {
    const g = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const parts: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    let t = 0;
    let seed = 1;
    const col = hex(p.palette.primary);
    const col2 = hex(p.palette.secondary);
    const tick = () => {
      t += 1 / 60;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(12,14,19,0.35)';
      g.fillRect(0, 0, W, H);
      // dummy silhouette
      g.strokeStyle = '#3a4150';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(W * 0.7, H * 0.32, 12, 0, Math.PI * 2);
      g.moveTo(W * 0.7, H * 0.38); g.lineTo(W * 0.7, H * 0.66);
      g.moveTo(W * 0.7, H * 0.66); g.lineTo(W * 0.66, H * 0.92);
      g.moveTo(W * 0.7, H * 0.66); g.lineTo(W * 0.74, H * 0.92);
      g.moveTo(W * 0.64, H * 0.48); g.lineTo(W * 0.76, H * 0.48);
      g.stroke();
      g.globalCompositeOperation = 'lighter';
      if (p.id === 'lightning' || p.id === 'spiritBeam') {
        if (Math.floor(t * 8) !== Math.floor((t - 1 / 60) * 8)) seed++;
        const paths = p.id === 'lightning'
          ? generateBolt({ x: W * 0.2, y: 10 }, { x: W * 0.7, y: H * 0.5 }, { depth: 6, jitter: 0.25, branches: 4, maxLevel: 2 }, rng(seed))
          : [{ points: [{ x: 30, y: H * 0.5 }, { x: W * 0.7, y: H * 0.5 }], level: 0 }];
        for (const path of paths) {
          for (const [w, c, a] of [[10, col, 0.15], [4, col, 0.5], [1.5, '#ffffff', 0.95]] as const) {
            g.strokeStyle = c;
            g.globalAlpha = a * (p.id === 'spiritBeam' ? 1 : 0.6 + Math.random() * 0.4);
            g.lineWidth = (p.id === 'spiritBeam' ? w * 2.2 : w) * (path.level ? 0.5 : 1);
            g.beginPath();
            path.points.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
            g.stroke();
          }
        }
        g.globalAlpha = 1;
      } else {
        for (let k = 0; k < 4; k++) {
          const a = Math.random() * Math.PI * 2;
          parts.push({ x: W * 0.3, y: H * 0.55, vx: Math.cos(a) * 1.5 + 3, vy: Math.sin(a) * 1.5 - 0.5, life: 1 });
        }
        for (const q of parts) {
          q.x += q.vx;
          q.y += q.vy;
          q.vx += (W * 0.7 - q.x) * 0.002;
          q.vy += Math.sin(t * 3 + q.x * 0.02) * 0.08;
          q.life -= 0.012;
          const grad = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, 10);
          grad.addColorStop(0, q.life > 0.5 ? col2 : col);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.globalAlpha = Math.max(0, q.life);
          g.fillStyle = grad;
          g.fillRect(q.x - 10, q.y - 10, 20, 20);
        }
        g.globalAlpha = 1;
        for (let i = parts.length - 1; i >= 0; i--) if (parts[i]!.life <= 0) parts.splice(i, 1);
      }
      this.previewRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  // ---------------------------------------------------------------- saves
  private saves(): HTMLElement {
    const g = this.game;
    const body = h('div', { class: 'saves' });
    for (let n = 1; n <= 3; n++) {
      const s = loadSlot(n);
      body.append(h('div', { class: 'slot' },
        h('div', {}, h('strong', {}, `Slot ${n}`), h('span', { class: 'muted' }, s ? ` · ${ARENAS[s.scene.arena].name} · ${new Date(s.savedAt).toLocaleString()} · ${s.scene.dummies.length} dummies, ${s.scene.bodies.length} objects` : ' · empty')),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => {
            g.hudToast(saveSlot(n, serialize(g.world, g.arena)) ? `Saved to slot ${n}` : 'Could not save (storage full or blocked)');
            this.render();
          } }, 'Save'),
          h('button', { class: 'btn', disabled: !s, onclick: () => {
            const v = loadSlot(n);
            if (v) {
              g.pushUndo();
              g.restore(v.scene);
              this.close();
            }
          } }, 'Load'),
        ),
      ));
    }
    const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text()) as unknown;
        if (!validateScene(data)) throw new Error('invalid');
        g.pushUndo();
        g.restore(data);
        g.hudToast('Scene imported');
        this.close();
      } catch {
        g.hudToast('That file is not a valid Modulo scene');
      }
    });
    body.append(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => {
        const blob = new Blob([JSON.stringify(serialize(g.world, g.arena), null, 1)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `modulo-scene-${Date.now()}.json` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } }, 'Export JSON'),
      h('button', { class: 'btn', onclick: () => file.click() }, 'Import JSON'),
      file,
    ));
    return this.shell('Save & load', body);
  }

  // ---------------------------------------------------------------- settings
  private settings(): HTMLElement {
    const g = this.game;
    const s = g.settings;
    const body = h('div', { class: 'settings' });
    const section = (title: string) => body.append(h('h3', {}, title));

    section('Quality');
    const seg = h('div', { class: 'segmented', role: 'radiogroup' });
    for (const p of [...PRESET_ORDER, 'custom'] as PresetId[]) {
      seg.append(h('button', { class: `seg${s.preset === p ? ' active' : ''}`, role: 'radio', 'aria-checked': s.preset === p ? 'true' : 'false', onclick: () => {
        if (p === 'custom' && s.preset !== 'custom') s.custom = { ...quality(s) };
        g.setPreset(p);
        this.render();
      } }, PRESET_LABEL[p]));
    }
    body.append(seg);
    if (s.preset === 'battery') body.append(h('p', { class: 'muted small' }, 'Battery Saver: 30 FPS cap, lower resolution, minimal bloom and particles, simpler lightning, fewer solver iterations. The game pauses while menus are open or the tab is hidden, and idle bodies are put to sleep quickly.'));
    const q = quality(s);
    const qrow = (label: string, control: HTMLElement) => body.append(h('label', { class: 'setting' }, h('span', {}, label), control));
    const setQ = <K extends keyof Quality>(k: K, v: Quality[K]) => {
      s.custom = { ...quality(s), [k]: v };
      s.preset = 'custom';
      g.persist();
      this.render();
    };
    const sel = <K extends keyof Quality>(k: K, opts: [string, Quality[K]][]) => {
      const el = h('select', { onchange: (e: Event) => setQ(k, opts[(e.target as HTMLSelectElement).selectedIndex]![1]) });
      for (const [label, v] of opts) el.append(h('option', { selected: q[k] === v }, label));
      return el;
    };
    qrow('Resolution (pixel ratio cap)', sel('pixelRatioCap', [['0.75', 0.75], ['0.85', 0.85], ['1.0', 1], ['1.5', 1.5], ['2.0', 2]]));
    qrow('Frame rate cap', sel('fpsCap', [['30 FPS', 30], ['60 FPS', 60], ['Uncapped', 0]]));
    qrow('Bloom', sel('bloom', [['Full resolution', 'full'], ['Half resolution', 'half'], ['Quarter resolution', 'quarter'], ['Off', 'off']]));
    qrow('Particle limit', sel('particles', [['800', 800], ['1,500', 1500], ['3,000', 3000], ['6,000', 6000], ['10,000', 10000]]));
    qrow('Max bodies', sel('maxBodies', [['100', 100], ['160', 160], ['280', 280], ['450', 450], ['700', 700]]));
    qrow('Max dummies', sel('maxDummies', [['6', 6], ['8', 8], ['15', 15], ['25', 25], ['40', 40]]));
    qrow('Physics solver iterations', sel('solverIterations', [['3', 3], ['4', 4], ['6', 6], ['8', 8]]));
    qrow('Lightning detail', sel('boltDetail', [['Minimal', 0.35], ['Low', 0.5], ['Medium', 0.7], ['High', 0.85], ['Full', 1]]));
    qrow('Backdrop', sel('backdrop', [['High', 'high'], ['Low', 'low'], ['Off', 'off']]));
    qrow('Audio voices', sel('voices', [['12', 12], ['16', 16], ['24', 24], ['32', 32], ['48', 48]]));
    const qcheck = (label: string, k: 'shake' | 'chroma' | 'pauseWhenIdle' | 'aggressiveSleep') =>
      qrow(label, h('input', { type: 'checkbox', checked: q[k], onchange: (e: Event) => setQ(k, (e.target as HTMLInputElement).checked) }));
    qcheck('Screen shake', 'shake');
    qcheck('Chromatic aberration pulses', 'chroma');
    qcheck('Pause rendering in menus / hidden tab', 'pauseWhenIdle');
    qcheck('Sleep idle bodies quickly', 'aggressiveSleep');
    const check = (label: string, k: 'damageNumbers' | 'healthBars' | 'killCam' | 'autoZoom' | 'watchdog' | 'infiniteEnergy') =>
      body.append(h('label', { class: 'setting' }, h('span', {}, label), h('input', { type: 'checkbox', checked: s[k], onchange: (e: Event) => {
        s[k] = (e.target as HTMLInputElement).checked;
        g.persist();
      } })));
    check('Performance watchdog (lowers quality if frame time stays bad)', 'watchdog');

    section('Gameplay');
    check('Floating damage numbers', 'damageNumbers');
    check('Dummy health bars', 'healthBars');
    check('Slow-motion kill-cam', 'killCam');
    check('Auto-zoom to the action', 'autoZoom');
    check('Infinite energy', 'infiniteEnergy');
    const touchSel = h('select', { onchange: (e: Event) => {
      s.touchControls = (['auto', 'on', 'off'] as const)[(e.target as HTMLSelectElement).selectedIndex]!;
      g.persist();
    } }, ...(['auto', 'on', 'off'] as const).map((v) => h('option', { selected: s.touchControls === v }, v === 'auto' ? 'Automatic (touch devices)' : v === 'on' ? 'Always on' : 'Off')));
    body.append(h('label', { class: 'setting' }, h('span', {}, 'On-screen touch controls'), touchSel));

    section('Audio');
    const vol = (label: string, k: 'master' | 'sfx' | 'music') => {
      const r = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[k] });
      r.addEventListener('input', () => {
        s[k] = Number(r.value);
        g.persist();
      });
      body.append(h('label', { class: 'setting' }, h('span', {}, label), r));
    };
    vol('Master volume', 'master');
    vol('Effects', 'sfx');
    vol('Music', 'music');

    section('Keys');
    const keys = h('div', { class: 'keys' });
    for (const a of Object.keys(ACTION_LABEL) as Action[]) {
      const btn = h('button', { class: 'btn key-btn' }, keyLabel(s.keys[a]));
      btn.addEventListener('click', () => {
        btn.textContent = 'Press a key…';
        document.body.dataset.rebinding = '1';
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', onKey, true);
          delete document.body.dataset.rebinding;
          if (e.code !== 'Escape' || a === 'menu') {
            for (const other of Object.keys(s.keys) as Action[]) if (s.keys[other] === e.code && other !== a) s.keys[other] = s.keys[a];
            s.keys[a] = e.code;
            g.persist();
          }
          this.render();
        };
        window.addEventListener('keydown', onKey, true);
      });
      keys.append(h('div', { class: 'key-row' }, h('span', {}, ACTION_LABEL[a]), btn));
    }
    body.append(keys, h('button', { class: 'btn', onclick: () => {
      s.keys = { ...DEFAULT_KEYS };
      g.persist();
      this.render();
    } }, 'Reset keys'));
    return this.shell('Settings', body);
  }

  // ---------------------------------------------------------------- help
  private help(): HTMLElement {
    const k = this.game.settings.keys;
    const row = (a: string, b: string) => h('tr', {}, h('td', {}, a), h('td', {}, b));
    return this.shell('Controls', h('div', {},
      h('table', { class: 'help' },
        row('Use power', 'Left click / tap. Hold, drag or charge depending on the ability (shown on each chip)'),
        row('Pick power', `1–9 within the category, ${keyLabel(k.nextCategory)} next category, hold ${keyLabel(k.wheel)} for the power wheel`),
        row('Sub-ability', `${keyLabel(k.prevSub)} / ${keyLabel(k.nextSub)}`),
        row('Grab and throw', `${keyLabel(k.toolGrab)}, then drag a body and let go while moving`),
        row('Spawn / delete', `${keyLabel(k.toolSpawn)} / ${keyLabel(k.toolDelete)}; ${keyLabel(k.spawnDummy)} drops a dummy at the cursor`),
        row('Camera', 'Scroll or pinch to zoom; right/middle-drag, drag empty space (Grab tool) or two fingers to pan'),
        row('Time', `${keyLabel(k.pause)} pause, ${keyLabel(k.step)} step frame, ${keyLabel(k.slowmo)} slow motion`),
        row('Scene', `${keyLabel(k.undo)} undo, ${keyLabel(k.clear)} clear, ${keyLabel(k.reset)} reset`),
        row('Debug', `${keyLabel(k.debug)} stats overlay, ${keyLabel(k.params)} power parameters`),
      ),
      h('p', { class: 'muted' }, 'Status effects interact: water + lightning chains further and harder, fire + ice makes steam, wind spreads fire, oil + fire explodes, frozen parts shatter on impact, acid eats metal, fire ignites poison.'),
    ));
  }

  // ---------------------------------------------------------------- credits
  private credits(): HTMLElement {
    const groups = groupCredits((licenses as { assets: LicenseRecord[] }).assets);
    const list = h('ul', { class: 'credit-list' });
    for (const g of groups) {
      list.append(h('li', {},
        h('span', { class: 'tag' }, g.usage),
        h('a', { href: g.sourceUrl, target: '_blank', rel: 'noopener' }, g.title),
        ` by ${g.author}${g.count > 1 ? ` (${g.count} files)` : ''}. `,
        h('a', { class: 'muted', href: g.licenseUrl, target: '_blank', rel: 'noopener' }, g.licenseName),
        g.notice ? h('div', { class: 'muted small' }, g.notice) : null,
      ));
    }
    return this.shell('Credits', h('div', {},
      h('p', { class: 'muted' }, 'Physics by Rapier, rendering by PixiJS. All power visuals and most sounds are generated in code. Third-party assets:'),
      list,
    ));
  }
}
