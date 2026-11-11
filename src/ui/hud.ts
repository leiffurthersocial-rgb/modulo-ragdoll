// In-game HUD: top bar (sim controls), tool rail, power dock (categories → powers → sub-abilities),
// energy + chaos score, toasts, params panel (F4), debug overlay (F3), power wheel (Tab), touch buttons.
import type { Game, Tool } from '../game/game';
import { ACTION_LABEL, DEFAULT_KEYS, type Action } from '../game/settings';
import { ARENAS, SPAWN_LABELS, type SpawnKind } from '../physics/objects';
import { CATEGORIES } from '../powers/registry';
import type { InputMode, PowerCategory } from '../powers/types';
import { clear, h, hex, keyLabel } from './dom';
import { iconEl } from './icons';

const MODE_LABEL: Record<InputMode, string> = {
  click: 'Click',
  hold: 'Hold + drag',
  'drag-aim': 'Drag to aim',
  'charge-release': 'Hold to charge',
  toggle: 'Toggle',
  'area-select': 'Drag area',
};

const TOOLS: { id: Tool; label: string; glyph: string; action: Action }[] = [
  { id: 'power', label: 'Powers', glyph: '✦', action: 'toolPower' },
  { id: 'grab', label: 'Grab', glyph: '✋', action: 'toolGrab' },
  { id: 'spawn', label: 'Spawn', glyph: '+', action: 'toolSpawn' },
  { id: 'delete', label: 'Delete', glyph: '✕', action: 'toolDelete' },
];

export class Hud {
  root: HTMLElement;
  category: PowerCategory = 'Elements';
  private els!: {
    pause: HTMLButtonElement;
    slow: HTMLInputElement;
    slowVal: HTMLElement;
    grav: HTMLInputElement;
    gravVal: HTMLElement;
    arena: HTMLButtonElement;
    energy: HTMLElement;
    energyFill: HTMLElement;
    chaos: HTMLElement;
    limiter: HTMLElement;
    tools: HTMLElement;
    spawnMenu: HTMLElement;
    cats: HTMLElement;
    powers: HTMLElement;
    subs: HTMLElement;
    hint: HTMLElement;
    toast: HTMLElement;
    debug: HTMLElement;
    params: HTMLElement;
    wheel: HTMLElement;
    touch: HTMLElement;
  };
  showDebug = false;
  showParams = false;
  private toastTimer = 0;
  private lastKey = '';
  onMenu: (panel?: string) => void = () => undefined;

  constructor(private game: Game, parent: HTMLElement) {
    this.root = h('div', { class: 'hud' });
    parent.append(this.root);
    this.build();
    this.bindKeys();
    game.onHud = () => this.update();
    game.onToast = (m) => this.toast(m);
    game.runtime.onChange = () => {
      this.renderDock();
      this.renderParams();
    };
  }

  // ---------------------------------------------------------------- build
  private build(): void {
    const g = this.game;
    const pause = h('button', { class: 'btn icon-btn', title: 'Pause (P)', 'aria-label': 'Pause', onclick: () => g.setPaused(!g.loop.paused) }, '❚❚');
    const step = h('button', { class: 'btn icon-btn', title: 'Step one frame (.)', 'aria-label': 'Step frame', onclick: () => g.stepFrame() }, '▸|');
    const slow = h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: 1, 'aria-label': 'Simulation speed' });
    const slowVal = h('span', { class: 'val' }, '1.00×');
    slow.addEventListener('input', () => {
      g.baseTimeScale = Number(slow.value);
      slowVal.textContent = `${Number(slow.value).toFixed(2)}×`;
    });
    const grav = h('input', { type: 'range', min: -20, max: 20, step: 0.5, value: 9.8, 'aria-label': 'Gravity' });
    const gravVal = h('span', { class: 'val' }, '9.8');
    grav.addEventListener('input', () => {
      g.setGravityY(-Number(grav.value));
      gravVal.textContent = Number(grav.value).toFixed(1);
    });
    const arena = h('button', { class: 'btn', title: 'Change arena', onclick: () => this.onMenu('arenas') }, '');
    const energyFill = h('div', { class: 'energy-fill' });
    const energy = h('div', { class: 'energy', title: 'Energy' }, energyFill);
    const chaos = h('div', { class: 'chaos', title: 'Chaos score (just for fun)' }, '0');
    const limiter = h('div', { class: 'limiter', hidden: true }, 'LIMITER BREAK');

    const top = h('div', { class: 'topbar' },
      h('div', { class: 'group' },
        h('button', { class: 'btn icon-btn', title: 'Menu (Esc)', 'aria-label': 'Menu', onclick: () => this.onMenu() }, '☰'),
        arena,
      ),
      h('div', { class: 'group sim' },
        pause, step,
        h('label', { class: 'slider' }, h('span', { class: 'lbl' }, 'Speed'), slow, slowVal),
        h('label', { class: 'slider' }, h('span', { class: 'lbl' }, 'Gravity'), grav, gravVal),
        h('button', { class: 'btn', title: 'Undo (Z)', onclick: () => g.undoLast() }, 'Undo'),
        h('button', { class: 'btn', title: 'Clear objects (C)', onclick: () => g.clearObjects() }, 'Clear'),
        h('button', { class: 'btn', title: 'Reset scene (R)', onclick: () => g.resetScene() }, 'Reset'),
      ),
      h('div', { class: 'group right' }, limiter, h('span', { class: 'lbl' }, 'Chaos'), chaos, energy),
    );

    const tools = h('div', { class: 'tools', role: 'toolbar', 'aria-label': 'Tools' });
    const spawnMenu = h('div', { class: 'spawn-menu', hidden: true });
    for (const [kind, label] of Object.entries(SPAWN_LABELS)) {
      spawnMenu.append(h('button', { class: 'btn', 'data-kind': kind, onclick: () => {
        g.spawnKind = kind as SpawnKind;
        this.update(true);
      } }, label));
    }

    const cats = h('div', { class: 'cats', role: 'tablist' });
    const powers = h('div', { class: 'powers' });
    const subs = h('div', { class: 'subs' });
    const hint = h('div', { class: 'hint' });
    const dock = h('div', { class: 'dock' }, cats, powers, subs, hint);
    const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    const debug = h('pre', { class: 'debug', hidden: true });
    const params = h('div', { class: 'params panel-side', hidden: true });
    const wheel = h('div', { class: 'wheel', hidden: true });
    const touch = h('div', { class: 'touch', hidden: true },
      h('button', { class: 'btn icon-btn', 'aria-label': 'Zoom in', onclick: () => g.zoomBy(0.8) }, '+'),
      h('button', { class: 'btn icon-btn', 'aria-label': 'Zoom out', onclick: () => g.zoomBy(1.25) }, '−'),
      h('button', { class: 'btn icon-btn', 'aria-label': 'Undo', onclick: () => g.undoLast() }, '↶'),
      h('button', { class: 'btn icon-btn', 'aria-label': 'Spawn dummy', onclick: () => g.spawnAt('dummy', { x: g.cam.x, y: g.cam.y + 2 }) }, '☺'),
    );
    this.root.append(top, tools, spawnMenu, dock, toast, debug, params, wheel, touch);
    this.els = { pause, slow, slowVal, grav, gravVal, arena, energy, energyFill, chaos, limiter, tools, spawnMenu, cats, powers, subs, hint, toast, debug, params, wheel, touch };
    this.renderTools();
    this.renderDock();
  }

  private renderTools(): void {
    const g = this.game;
    clear(this.els.tools);
    for (const t of TOOLS) {
      this.els.tools.append(h('button', {
        class: `btn tool${g.tool === t.id ? ' active' : ''}`,
        title: `${t.label} (${keyLabel(g.settings.keys[t.action])})`,
        'aria-pressed': g.tool === t.id ? 'true' : 'false',
        onclick: () => this.setTool(t.id),
      }, h('span', { class: 'glyph' }, t.glyph), h('span', { class: 'tlabel' }, t.label)));
    }
  }

  setTool(t: Tool): void {
    this.game.cancelActions();
    this.game.tool = t;
    this.game.audio.ui('click');
    this.renderTools();
    this.update(true);
  }

  renderDock(): void {
    const g = this.game;
    const rt = g.runtime;
    if (rt.power.category !== this.category && rt.powers.some((p) => p.category === this.category)) {
      // keep the tab the user is looking at
    }
    clear(this.els.cats);
    for (const c of CATEGORIES) {
      this.els.cats.append(h('button', { class: `tab${c === this.category ? ' active' : ''}`, role: 'tab', 'aria-selected': c === this.category ? 'true' : 'false', onclick: () => {
        this.category = c;
        this.renderDock();
      } }, c));
    }
    clear(this.els.powers);
    const list = rt.powers.map((p, i) => ({ p, i })).filter((x) => x.p.category === this.category);
    list.forEach(({ p, i }, k) => {
      const active = i === rt.powerIndex && g.tool === 'power';
      const btn = h('button', {
        class: `power${active ? ' active' : ''}`,
        title: `${p.name}${k < 9 ? ` (${k + 1})` : ''}`,
        onclick: () => {
          rt.select(i);
          if (g.tool !== 'power') this.setTool('power');
          g.audio.ui('select');
        },
      }, iconEl(p.icon, 26, p.name), h('span', { class: 'pname' }, p.name), k < 9 ? h('span', { class: 'key' }, String(k + 1)) : null);
      btn.style.setProperty('--pc', hex(p.palette.primary));
      this.els.powers.append(btn);
    });
    clear(this.els.subs);
    rt.power.subs.forEach((s, i) => {
      const chip = h('button', {
        class: `sub${i === rt.subIndex ? ' active' : ''}`,
        title: s.description,
        onclick: () => {
          rt.select(rt.powerIndex, i);
          if (g.tool !== 'power') this.setTool('power');
          g.audio.ui('click');
        },
      }, h('span', { class: 'sname' }, s.name), h('span', { class: 'mode' }, MODE_LABEL[s.input]), h('span', { class: 'cd' }));
      chip.dataset.sub = s.id;
      this.els.subs.append(chip);
    });
    this.els.hint.textContent = rt.sub.description;
  }

  private renderParams(): void {
    const el = this.els.params;
    el.hidden = !this.showParams;
    if (!this.showParams) return;
    const rt = this.game.runtime;
    const sub = rt.sub;
    const vals = rt.params(sub);
    clear(el);
    el.append(h('header', {}, h('strong', {}, `${rt.power.name}: ${sub.name}`), h('button', { class: 'btn icon-btn', 'aria-label': 'Close', onclick: () => this.toggleParams() }, '✕')));
    const entries = Object.entries(sub.params);
    if (!entries.length) el.append(h('p', { class: 'muted' }, 'This sub-ability has no tweakable parameters.'));
    for (const [k, spec] of entries) {
      const val = h('span', { class: 'val' }, String(vals[k]));
      const input = h('input', { type: 'range', min: spec.min, max: spec.max, step: spec.step ?? (spec.max - spec.min) / 100, value: vals[k] });
      input.addEventListener('input', () => {
        const o = { ...rt.overrides.get(sub.id), [k]: Number(input.value) };
        rt.overrides.set(sub.id, o);
        val.textContent = Number(input.value).toFixed(2).replace(/\.?0+$/, '');
      });
      el.append(h('label', { class: 'param' }, h('span', {}, spec.label ?? k), input, val));
    }
    el.append(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => {
        rt.overrides.delete(sub.id);
        this.renderParams();
      } }, 'Reset to defaults'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: rt.noCooldowns, onchange: (e: Event) => (rt.noCooldowns = (e.target as HTMLInputElement).checked) }), 'No cooldowns'),
    ));
  }

  toggleParams(): void {
    this.showParams = !this.showParams;
    this.renderParams();
  }

  toast(msg: string): void {
    if (msg === this.lastKey && this.toastTimer > performance.now()) return;
    this.lastKey = msg;
    this.els.toast.textContent = msg;
    this.els.toast.classList.add('show');
    this.toastTimer = performance.now() + 2200;
    setTimeout(() => {
      if (performance.now() >= this.toastTimer - 50) this.els.toast.classList.remove('show');
    }, 2300);
  }

  // ---------------------------------------------------------------- per-frame update
  private lastUpdate = 0;
  update(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    const g = this.game;
    const rt = g.runtime;
    const dock = this.els.cats.parentElement!;
    g.bottomInset = dock.offsetHeight + 14;
    this.els.pause.textContent = g.loop.paused ? '▶' : '❚❚';
    this.els.pause.setAttribute('aria-label', g.loop.paused ? 'Resume' : 'Pause');
    this.els.arena.textContent = ARENAS[g.arena].name;
    const gy = -g.world.gravity.y;
    if (document.activeElement !== this.els.grav) {
      this.els.grav.value = String(gy);
      this.els.gravVal.textContent = gy.toFixed(1);
    }
    this.els.energyFill.style.width = `${rt.infiniteEnergy ? 100 : (rt.energy / rt.maxEnergy) * 100}%`;
    this.els.energy.classList.toggle('infinite', rt.infiniteEnergy);
    this.els.chaos.textContent = Math.round(rt.chaosScore).toLocaleString();
    this.els.limiter.hidden = rt.limiterRemaining <= 0;
    if (rt.limiterRemaining > 0) this.els.limiter.textContent = `Limiter Break ${rt.limiterRemaining.toFixed(1)}s`;
    // Cooldown overlays
    for (const chip of this.els.subs.querySelectorAll<HTMLElement>('.sub')) {
      const cd = rt.cooldowns.get(chip.dataset.sub ?? '') ?? 0;
      const cdEl = chip.querySelector<HTMLElement>('.cd')!;
      cdEl.textContent = cd > 0 ? cd.toFixed(1) : '';
      chip.classList.toggle('cooling', cd > 0);
    }
    this.els.spawnMenu.hidden = g.tool !== 'spawn';
    for (const b of this.els.spawnMenu.querySelectorAll<HTMLElement>('button')) b.classList.toggle('active', b.dataset.kind === g.spawnKind);
    this.els.touch.hidden = !g.touch;
    this.root.classList.toggle('is-touch', g.touch);
    if (this.showDebug) {
      const s = g.stats;
      this.els.debug.textContent =
        `FPS        ${s.fps}\nframe ms   ${s.frameMs}\nphysics ms ${s.physicsMs}\nbodies     ${s.bodies}\ndummies    ${s.dummies}\nparticles  ${s.particles}\ndraw calls ${s.drawCalls}\nentities   ${s.entities}\npreset     ${g.settings.preset}`;
    }
  }

  // ---------------------------------------------------------------- keys
  private bindKeys(): void {
    const g = this.game;
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
      if (document.body.dataset.rebinding) return;
      const keys = g.settings.keys;
      const act = (Object.keys(keys) as Action[]).find((a) => keys[a] === e.code);
      if (/^Digit[1-9]$/.test(e.code) && !g.menuOpen) {
        const k = Number(e.code.slice(5)) - 1;
        const list = g.runtime.powers.map((p, i) => ({ p, i })).filter((x) => x.p.category === this.category);
        const item = list[k];
        if (item) {
          g.runtime.select(item.i);
          if (g.tool !== 'power') this.setTool('power');
        }
        return;
      }
      if (!act) return;
      if (g.menuOpen && act !== 'menu') return;
      e.preventDefault();
      if (e.repeat && act !== 'wheel') return;
      switch (act) {
        case 'pause': g.setPaused(!g.loop.paused); break;
        case 'step': g.stepFrame(); break;
        case 'slowmo': {
          const v = g.baseTimeScale < 1 ? 1 : 0.25;
          g.baseTimeScale = v;
          this.els.slow.value = String(v);
          this.els.slowVal.textContent = `${v.toFixed(2)}×`;
          break;
        }
        case 'undo': g.undoLast(); break;
        case 'clear': g.clearObjects(); break;
        case 'reset': g.resetScene(); break;
        case 'nextSub': g.runtime.cycleSub(1); break;
        case 'prevSub': g.runtime.cycleSub(-1); break;
        case 'nextCategory': {
          const i = CATEGORIES.indexOf(this.category);
          this.category = CATEGORIES[(i + 1) % CATEGORIES.length]!;
          this.renderDock();
          break;
        }
        case 'wheel': this.openWheel(); break;
        case 'toolGrab': this.setTool('grab'); break;
        case 'toolSpawn': this.setTool('spawn'); break;
        case 'toolDelete': this.setTool('delete'); break;
        case 'toolPower': this.setTool('power'); break;
        case 'debug':
          this.showDebug = !this.showDebug;
          this.els.debug.hidden = !this.showDebug;
          break;
        case 'params': this.toggleParams(); break;
        case 'menu': this.onMenu(g.menuOpen ? 'close' : undefined); break;
        case 'spawnDummy': g.spawnAt('dummy', g.pointerWorld); break;
      }
      this.update(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === g.settings.keys.wheel) this.closeWheel(true);
    });
  }

  // ---------------------------------------------------------------- power wheel
  private wheelPick: number | null = null;

  openWheel(): void {
    const w = this.els.wheel;
    if (!w.hidden) return;
    const rt = this.game.runtime;
    clear(w);
    const n = rt.powers.length;
    const R = Math.min(window.innerWidth, window.innerHeight) * 0.36;
    const label = h('div', { class: 'wheel-label' }, rt.power.name);
    w.append(label);
    rt.powers.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const b = h('button', { class: `wheel-item${i === rt.powerIndex ? ' active' : ''}`, title: p.name }, iconEl(p.icon, 28, p.name));
      b.style.left = `calc(50% + ${Math.cos(a) * R}px)`;
      b.style.top = `calc(50% + ${Math.sin(a) * R}px)`;
      b.style.setProperty('--pc', hex(p.palette.primary));
      b.addEventListener('pointerenter', () => {
        this.wheelPick = i;
        label.textContent = p.name;
        for (const x of w.querySelectorAll('.wheel-item')) x.classList.remove('active');
        b.classList.add('active');
      });
      b.addEventListener('click', () => {
        this.wheelPick = i;
        this.closeWheel(true);
      });
      w.append(b);
    });
    w.hidden = false;
  }

  closeWheel(apply: boolean): void {
    const w = this.els.wheel;
    if (w.hidden) return;
    w.hidden = true;
    if (apply && this.wheelPick !== null) {
      const p = this.game.runtime.powers[this.wheelPick]!;
      this.category = p.category;
      this.game.runtime.select(this.wheelPick);
      if (this.game.tool !== 'power') this.setTool('power');
    }
    this.wheelPick = null;
  }
}

export { ACTION_LABEL, DEFAULT_KEYS };
