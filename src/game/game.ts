// Game: owns the world, renderer, camera, loop, tools and all subsystems.
import RAPIER from '@dimforge/rapier2d-compat';
import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { AdvancedBloomFilter, RGBSplitFilter } from 'pixi-filters';
import { setAssetTier, imageUrl } from '../assets/manifest';
import { backdropTexture, glowTexture } from '../assets/procedural';
import { AudioEngine } from '../audio/audio';
import { advance, createLoopState, FIXED_DT } from '../core/loop';
import { clamp, lerp, type Vec2 } from '../core/math';
import { ARENAS, spawn as spawnKind, type ArenaId, type SpawnKind } from '../physics/objects';
import { dummyHealth } from '../physics/ragdoll';
import { PhysicsWorld, type BodyRec, type WorldEvent } from '../physics/world';
import { explode as explodeFx } from '../powers/effects';
import { POWERS } from '../powers/registry';
import { PowerRuntime } from '../powers/runtime';
import { BodyRenderer } from '../render/bodies';
import { FxRenderer, PPM } from '../render/fx';
import { History } from './history';
import { GamePhysicsAPI } from './physics-api';
import { deserialize, serialize, UndoStack, type SceneData } from './save';
import { isTouchDevice, loadSettings, lowerPreset, quality, saveSettings, Watchdog, type PresetId, type Settings } from './settings';
import { StatusSystem } from './status-system';

export type Tool = 'grab' | 'spawn' | 'delete' | 'power';

export interface Stats {
  fps: number;
  frameMs: number;
  physicsMs: number;
  bodies: number;
  dummies: number;
  particles: number;
  drawCalls: number;
  entities: number;
}

interface PointerInfo {
  id: number;
  x: number;
  y: number;
  type: string;
  button: number;
}

export class Game {
  app = new Application();
  world!: PhysicsWorld;
  fx!: FxRenderer;
  bodies!: BodyRenderer;
  audio = new AudioEngine();
  status!: StatusSystem;
  history!: History;
  physicsApi!: GamePhysicsAPI;
  runtime!: PowerRuntime;
  settings: Settings = loadSettings();
  loop = createLoopState();
  undo = new UndoStack(20);
  arena: ArenaId = 'flat';
  tool: Tool = 'power';
  spawnKind: SpawnKind = 'dummy';
  baseTimeScale = 1;
  stats: Stats = { fps: 0, frameMs: 0, physicsMs: 0, bodies: 0, dummies: 0, particles: 0, drawCalls: 0, entities: 0 };
  /** UI hook: refresh HUD (energy, cooldowns, chaos). */
  onHud: () => void = () => undefined;
  onToast: (msg: string) => void = () => undefined;
  menuOpen = false;

  // rendering
  private backdrop!: Sprite;
  private worldRoot = new Container();
  /** Untransformed parent of worldRoot: post filters (bloom) live here so filterArea is in screen space. */
  private sceneLayer = new Container();
  private overlay = new Graphics();
  private aura!: Sprite;
  private bloom!: AdvancedBloomFilter;
  private rgb!: RGBSplitFilter;
  private bloomBase = 1;
  private bloomSpikeAmt = 0;
  private chromaAmt = 0;
  private flashAmt = 0;
  private flashColor = 0xffffff;
  private auraTime = 0;
  private auraColor = 0xffd23a;
  private shakeAmt = 0;
  private slowMoTime = 0;
  private slowMoScale = 1;
  private drawCalls = 0;

  // camera (world units)
  cam = { x: 0, y: 4, h: 12 };
  /** Screen pixels covered by the bottom dock: the camera frames the area above it. */
  bottomInset = 0;
  private camTarget: { x: number; y: number; h: number } | null = null;
  private killCamCooldown = 0;

  // input
  private pointers = new Map<number, PointerInfo>();
  private grab: { id: number; local: Vec2; target: Vec2 } | null = null;
  private pan: { sx: number; sy: number; cx: number; cy: number } | null = null;
  private pinch: { d: number; h: number; mid: Vec2 } | null = null;
  pointerWorld: Vec2 = { x: 0, y: 0 };
  private powerPointer: number | null = null;

  private watchdog = new Watchdog();
  private frameTimes: number[] = [];
  private lastDamageText = new Map<number, { amount: number; t: number }>();
  private hidden = false;

  async init(stage: HTMLElement): Promise<void> {
    await RAPIER.init();
    const q = quality(this.settings);
    setAssetTier(q.backdrop === 'low' ? 'low' : 'high');
    await this.app.init({
      resizeTo: stage,
      background: '#05060b',
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, q.pixelRatioCap),
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    stage.appendChild(this.app.canvas);
    this.hookDrawCalls();

    this.world = new PhysicsWorld();
    this.fx = new FxRenderer({
      shake: (a) => (this.shakeAmt = Math.min(1.5, this.shakeAmt + a)),
      hitStop: (ms) => (this.loop.hitStopMs = Math.max(this.loop.hitStopMs, ms)),
      slowMo: (s, sec) => {
        this.slowMoScale = s;
        this.slowMoTime = sec;
      },
      bloomSpike: (a) => (this.bloomSpikeAmt = Math.min(3, this.bloomSpikeAmt + a)),
      chroma: (a) => (this.chromaAmt = Math.min(2, this.chromaAmt + a)),
      flash: (c, i) => {
        this.flashColor = c;
        this.flashAmt = Math.min(1, this.flashAmt + i);
      },
      aura: (c, s) => {
        this.auraColor = c;
        this.auraTime = s;
      },
    });
    this.bodies = new BodyRenderer(this.world, glowTexture(64));
    this.status = new StatusSystem(this.world, this.fx, this.audio);
    this.history = new History(this.world);
    this.physicsApi = new GamePhysicsAPI(this.world, this.status, this.history);
    this.runtime = new PowerRuntime({ physics: this.physicsApi, fx: this.fx, audio: this.audio, status: this.status }, POWERS);
    this.runtime.infiniteEnergy = this.settings.infiniteEnergy;
    this.runtime.onChange = () => this.onHud();
    this.runtime.onFail = (r) => {
      this.audio.ui('error');
      this.onToast(r === 'energy' ? 'Not enough energy' : 'Cooling down');
    };
    this.status.explode = (p, r, power) => explodeFx(this.runtime.ctx(this.runtime.power, this.runtime.sub), p, r, power);

    // Scene graph
    this.backdrop = new Sprite(Texture.EMPTY);
    this.worldRoot.addChild(this.fx.layerBack, this.bodies.layer, this.fx.layerFront);
    this.aura = new Sprite(this.vignetteTexture());
    this.aura.blendMode = 'add';
    this.aura.visible = false;
    this.overlay.blendMode = 'add';
    this.sceneLayer.addChild(this.worldRoot);
    this.app.stage.addChild(this.backdrop, this.sceneLayer, this.aura, this.overlay);
    this.bloom = new AdvancedBloomFilter({ threshold: 0.32, bloomScale: 1, brightness: 1, blur: 7, quality: 6 });
    this.rgb = new RGBSplitFilter({ red: { x: 0, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 0, y: 0 } });
    this.sceneLayer.filterArea = this.app.screen;
    this.applyQuality();

    this.world.on((e) => this.onWorldEvent(e));
    this.bindInput();
    this.loadArena((this.settings.arena as ArenaId) in ARENAS ? (this.settings.arena as ArenaId) : 'flat', true);
    this.app.ticker.add(() => this.frame());
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.updateRunning();
      this.audio.suspend(document.hidden);
    });
    void this.checkBattery();
  }

  // ---------------------------------------------------------------- settings
  applyQuality(): void {
    const q = quality(this.settings);
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);
    if (Math.abs(this.app.renderer.resolution - pr) > 0.01) this.app.renderer.resolution = pr;
    this.app.ticker.maxFPS = q.fpsCap;
    this.world.setSolverIterations(q.solverIterations);
    this.world.maxBodies = q.maxBodies;
    this.fx.settings = { particleCap: q.particles, boltDetail: q.boltDetail, shake: q.shake && true, chroma: q.chroma, damageNumbers: this.settings.damageNumbers };
    this.bodies.showHealthBars = this.settings.healthBars;
    this.audio.settings = { master: this.settings.master, sfx: this.settings.sfx, music: this.settings.music, voices: q.voices };
    this.audio.applyVolumes();
    this.runtime.infiniteEnergy = this.settings.infiniteEnergy;
    if (q.bloom === 'off') this.sceneLayer.filters = [];
    else {
      this.bloom.resolution = pr * (q.bloom === 'full' ? 1 : q.bloom === 'half' ? 0.5 : 0.3);
      this.bloom.quality = q.bloom === 'full' ? 7 : q.bloom === 'half' ? 5 : 3;
      this.sceneLayer.filters = [this.bloom];
    }
    const tier = q.backdrop === 'low' ? 'low' : 'high';
    setAssetTier(tier);
    this.backdrop.visible = q.backdrop !== 'off';
    this.updateRunning();
  }

  setPreset(p: PresetId): void {
    this.settings.preset = p;
    saveSettings(this.settings);
    this.applyQuality();
    void this.loadBackdrop();
  }

  persist(): void {
    saveSettings(this.settings);
    this.applyQuality();
  }

  /** Battery Saver/Low pause the render loop while a menu is open or the tab is hidden. */
  updateRunning(): void {
    const q = quality(this.settings);
    const stop = this.hidden || (q.pauseWhenIdle && this.menuOpen);
    if (stop && this.app.ticker.started) this.app.ticker.stop();
    else if (!stop && !this.app.ticker.started) this.app.ticker.start();
  }

  private async checkBattery(): Promise<void> {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (e: string, f: () => void) => void }> };
    if (!nav.getBattery) return;
    try {
      const bat = await nav.getBattery();
      const check = () => {
        if (bat.level < 0.2 && !bat.charging && this.settings.preset !== 'battery') this.onToast('Battery is low. Battery Saver is available in Settings.');
      };
      check();
      bat.addEventListener('levelchange', check);
    } catch {
      /* not supported */
    }
  }

  // ---------------------------------------------------------------- arena / scene
  loadArena(id: ArenaId, populate = false): void {
    this.arena = id;
    this.settings.arena = id;
    saveSettings(this.settings);
    const a = ARENAS[id];
    this.runtime.clearEntities();
    this.fx.clear();
    this.history.clear();
    this.world.clearAll();
    this.status.gravityChannel.clear();
    a.build(this.world);
    this.world.gravity = { x: 0, y: a.gravity };
    this.cam = { ...a.view };
    this.camTarget = null;
    if (populate) this.populate();
    void this.loadBackdrop();
    this.onHud();
  }

  populate(): void {
    const a = ARENAS[this.arena];
    const y = this.arena === 'tower' ? 15.3 : this.arena === 'pit' ? -6 : this.arena === 'space' ? 4 : 0.02;
    const cx = a.view.x;
    spawnKind(this.world, 'dummy', { x: cx - 1.5, y: y + 0.9 });
    spawnKind(this.world, 'dummy', { x: cx + 1.5, y: y + 0.9 });
    if (this.arena === 'flat' || this.arena === 'box') {
      spawnKind(this.world, 'crate', { x: cx + 4, y: 0.36 });
      spawnKind(this.world, 'crate', { x: cx + 4, y: 1.08 });
      spawnKind(this.world, 'barrel', { x: cx - 4.5, y: 0.41 });
      spawnKind(this.world, 'oilbarrel', { x: cx - 5.3, y: 0.41 });
    }
  }

  private async loadBackdrop(): Promise<void> {
    const url = imageUrl(ARENAS[this.arena].backdrop);
    let tex: Texture;
    try {
      tex = url ? await Assets.load<Texture>(url) : backdropTexture();
    } catch {
      tex = backdropTexture();
    }
    this.backdrop.texture = tex;
  }

  snapshot(): SceneData {
    return serialize(this.world, this.arena);
  }

  pushUndo(): void {
    this.undo.push(this.snapshot());
  }

  restore(data: SceneData): void {
    this.runtime.clearEntities();
    this.fx.clear();
    this.history.clear();
    this.status.gravityChannel.clear();
    if (data.arena !== this.arena) {
      this.arena = data.arena;
      this.cam = { ...ARENAS[data.arena].view };
      void this.loadBackdrop();
    }
    deserialize(this.world, data);
    this.onHud();
  }

  undoLast(): void {
    const s = this.undo.pop();
    if (s) {
      this.restore(s);
      this.onToast('Undone');
    } else this.onToast('Nothing to undo');
  }

  clearObjects(): void {
    this.pushUndo();
    this.runtime.clearEntities();
    this.world.clearDynamic();
    this.fx.clear();
    this.world.gravity = { x: 0, y: ARENAS[this.arena].gravity };
    this.onHud();
  }

  resetScene(): void {
    this.pushUndo();
    this.loadArena(this.arena, true);
  }

  spawnAt(kind: SpawnKind, p: Vec2): void {
    if (this.world.dynamicCount() >= this.world.maxBodies) {
      this.onToast('Body limit reached for this quality preset');
      return;
    }
    if ((kind === 'dummy' || kind === 'dummyGroup' || kind === 'dummyRain') && this.world.dummies.size >= quality(this.settings).maxDummies) {
      this.onToast('Dummy limit reached for this quality preset');
      return;
    }
    this.pushUndo();
    spawnKind(this.world, kind, p, this.cam.y + this.cam.h / 2 + 1);
    this.audio.ui('select');
  }

  deleteAt(p: Vec2): void {
    const b = this.world.bodyAt(p) ?? this.world.queryCircle(p, 0.3)[0];
    if (!b) return;
    this.pushUndo();
    if (b.dummy !== undefined) this.world.removeDummy(b.dummy);
    else if (b.rope !== undefined) {
      const r = this.world.ropes.get(b.rope);
      for (const id of r?.bodies ?? []) this.world.removeBody(id);
      this.world.ropes.delete(b.rope);
    } else this.world.removeBody(b.id);
    this.fx.burst('pixel', p, { count: 10, color: 0xff6a6a });
    this.audio.ui('close');
  }

  // ---------------------------------------------------------------- world events
  private onWorldEvent(e: WorldEvent): void {
    switch (e.type) {
      case 'impact': {
        const b = this.world.bodies.get(e.id);
        if (!b) break;
        if (e.dv > 5) this.audio.impact(b.material, e.dv, e.point);
        if (e.dv > 9) this.fx.burst('spark', e.point, { count: Math.min(12, Math.round(e.dv / 3)), color: b.material === 'metal' ? 0xbfe6ff : 0xffd27a });
        if (e.dv > 14) this.fx.shake(Math.min(0.2, e.dv * 0.005));
        break;
      }
      case 'damage': {
        this.runtime.chaosScore += e.amount * 0.5;
        if (this.settings.damageNumbers && e.amount >= 1) {
          const prev = this.lastDamageText.get(e.id);
          const now = this.world.time;
          if (prev && now - prev.t < 0.25) prev.amount += e.amount;
          else {
            if (prev && prev.amount >= 3) this.fx.text(e.point, String(Math.round(prev.amount)), prev.amount > 40 ? 0xff6a5a : 0xffe6a0);
            this.lastDamageText.set(e.id, { amount: e.amount, t: now });
          }
        }
        break;
      }
      case 'jointBreak':
        this.fx.burst('spark', e.point, { count: 16, color: 0xffd27a, speed: 8 });
        this.fx.burst('stuffing', e.point, { count: 10 });
        this.audio.jointBreak(e.point);
        this.runtime.chaosScore += 50;
        if (e.name === 'neck' && this.settings.killCam) this.killCam(e.point);
        break;
      case 'destroyed': {
        const b = this.world.bodies.get(e.id);
        if (!b) break;
        if (b.kind === 'part') {
          this.fx.burst('stuffing', e.point, { count: 14 });
          this.runtime.chaosScore += 30;
        } else if (b.kind === 'crate' || b.kind === 'plank' || b.kind === 'debris') {
          this.breakIntoDebris(b);
        } else if (b.material === 'ice') {
          this.fx.burst('shard', e.point, { count: 12 });
          this.audio.play('shatter', { pos: e.point, volume: 0.5 });
          this.world.removeBody(b.id);
        } else if (!b.explosive && b.kind !== 'boulder') {
          this.fx.burst('spark', e.point, { count: 10 });
        }
        break;
      }
      case 'explode': {
        const b = this.world.bodies.get(e.id);
        if (b) this.world.removeBody(b.id);
        this.status.explode(e.point, b?.kind === 'oilbarrel' ? 3.8 : 3, b?.kind === 'oilbarrel' ? 1.5 : 1.2);
        this.runtime.chaosScore += 120;
        break;
      }
      case 'removed':
        this.bodies.remove(e.id);
        if (this.grab?.id === e.id) this.grab = null;
        this.lastDamageText.delete(e.id);
        this.status.gravityChannel.delete(e.id);
        break;
    }
  }

  private breakIntoDebris(b: BodyRec): void {
    const p = { x: b.cur.x, y: b.cur.y };
    const r = this.world.radius(b);
    const v = b.rb.linvel();
    this.world.removeBody(b.id);
    if (r < 0.2 || this.world.dynamicCount() > this.world.maxBodies - 4) {
      this.fx.burst('dust', p, { count: 8, color: 0x8a6a4a });
      return;
    }
    for (let i = 0; i < 3; i++) {
      this.world.createBody({
        kind: 'debris',
        shape: { type: 'box', hw: r * 0.45, hh: r * 0.12, round: 0.01 },
        material: b.material,
        x: p.x + (Math.random() - 0.5) * r,
        y: p.y + (Math.random() - 0.5) * r,
        angle: Math.random() * 3,
        vx: v.x + (Math.random() - 0.5) * 4,
        vy: v.y + Math.random() * 4,
        hp: 15,
        lifetime: 20,
      });
    }
    this.fx.burst('dust', p, { count: 8, color: 0x8a6a4a });
    this.audio.impact('wood', 12, p);
  }

  private killCam(p: Vec2): void {
    if (this.killCamCooldown > 0) return;
    this.killCamCooldown = 4;
    this.slowMoScale = 0.25;
    this.slowMoTime = 1.1;
    // Zoom toward the action, then glide back to where the player was looking.
    const back = { ...this.cam };
    this.camTarget = { x: lerp(this.cam.x, p.x, 0.6), y: lerp(this.cam.y, p.y, 0.6), h: Math.max(5, this.cam.h * 0.65) };
    setTimeout(() => {
      if (!this.settings.autoZoom) {
        this.camTarget = back;
        setTimeout(() => {
          if (this.camTarget === back) this.camTarget = null;
        }, 1500);
      }
    }, 1100);
  }

  // ---------------------------------------------------------------- frame
  private frame(): void {
    const t0 = performance.now();
    const dtMs = this.app.ticker.deltaMS;
    const realDt = dtMs / 1000;
    // Effective time scale: user slow-mo × kill-cam/nuke slow-mo.
    if (this.slowMoTime > 0) this.slowMoTime -= realDt;
    this.loop.timeScale = this.baseTimeScale * (this.slowMoTime > 0 ? this.slowMoScale : 1);
    const { steps, alpha } = advance(this.loop, dtMs);
    const tp = performance.now();
    for (let i = 0; i < steps; i++) this.step(FIXED_DT);
    const physicsMs = performance.now() - tp;

    this.updateCamera(realDt);
    this.fx.update(steps > 0 || !this.loop.paused ? realDt * Math.min(1, this.loop.timeScale + 0.2) : 0);
    this.bodies.update(alpha, this.world.time);
    this.updateScreenFx(realDt);

    // Stats
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats = {
      fps: Math.round(1000 / Math.max(1, avg)),
      frameMs: Math.round((performance.now() - t0) * 10) / 10,
      physicsMs: Math.round(physicsMs * 10) / 10,
      bodies: this.world.bodies.size,
      dummies: this.world.dummies.size,
      particles: this.fx.particleCount,
      drawCalls: this.drawCalls,
      entities: this.runtime.entityCount,
    };
    this.drawCalls = 0;
    if (this.settings.watchdog && !this.menuOpen && this.watchdog.sample(dtMs, realDt)) {
      const next = lowerPreset(this.settings.preset);
      if (next) {
        this.setPreset(next);
        this.onToast(`Performance watchdog: switched to ${next === 'battery' ? 'Battery Saver' : next}`);
      }
    }
    this.onHud();
  }

  private step(dt: number): void {
    // Grab spring (applied at the grab point, so things swing naturally).
    if (this.grab) {
      const b = this.world.bodies.get(this.grab.id);
      if (b) {
        const c = Math.cos(b.cur.a);
        const s = Math.sin(b.cur.a);
        const wp = { x: b.cur.x + this.grab.local.x * c - this.grab.local.y * s, y: b.cur.y + this.grab.local.x * s + this.grab.local.y * c };
        const v = b.rb.linvel();
        const m = b.rb.mass();
        const k = 60;
        const damp = 9;
        const fx = (this.grab.target.x - wp.x) * k - v.x * damp;
        const fy = (this.grab.target.y - wp.y) * k - v.y * damp;
        const max = 400;
        const scaleF = Math.min(1, max / Math.max(1, Math.hypot(fx, fy)));
        b.rb.applyImpulseAtPoint({ x: fx * scaleF * m * dt, y: (fy * scaleF + (-this.world.gravity.y) * 0.9) * m * dt }, wp, true);
        b.rb.setAngvel(b.rb.angvel() * 0.96, true);
      }
    }
    this.runtime.step(dt);
    this.status.step(dt);
    this.history.stepRewinds();
    this.world.step(dt);
    this.history.record();
    if (this.killCamCooldown > 0) this.killCamCooldown -= dt;
    if (quality(this.settings).aggressiveSleep) {
      for (const b of this.world.bodies.values()) {
        if (b.isStatic || b.rb.isSleeping()) continue;
        const v = b.rb.linvel();
        if (Math.hypot(v.x, v.y) < 0.08 && Math.abs(b.rb.angvel()) < 0.1) {
          b.idle += dt;
          if (b.idle > 0.6 && b.dummy === undefined) b.rb.sleep();
        } else b.idle = 0;
      }
    }
    // Kill-cam on near-death dummies.
    if (this.settings.killCam && this.killCamCooldown <= 0) {
      for (const d of this.world.dummies.values()) {
        if (this.world.time - d.lastHit < 0.05 && dummyHealth(this.world, d) < 0.12 && !(d as { killed?: boolean }).killed) {
          (d as { killed?: boolean }).killed = true;
          const head = this.world.bodies.get(d.parts.torso ?? d.parts.pelvis ?? -1);
          if (head) this.killCam(head.cur);
        }
      }
    }
    this.physicsApi.viewRect = this.viewRect();
    this.audio.listener = { x: this.cam.x, y: this.cam.y, w: this.viewRect().w };
  }

  viewRect() {
    const w = (this.cam.h * this.app.screen.width) / Math.max(100, this.app.screen.height - this.bottomInset);
    return { x: this.cam.x, y: this.cam.y, w, h: this.cam.h };
  }

  private updateCamera(dt: number): void {
    if (this.settings.autoZoom && !this.pan && !this.pinch && this.slowMoTime <= 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
      for (const b of this.world.bodies.values()) {
        if (b.isStatic || (b.dummy === undefined && b.rb.isSleeping())) continue;
        if (b.kind === 'debris' || b.kind === 'projectile') continue;
        minX = Math.min(minX, b.cur.x); maxX = Math.max(maxX, b.cur.x);
        minY = Math.min(minY, b.cur.y); maxY = Math.max(maxY, b.cur.y);
        n++;
      }
      if (n) {
        const aspect = this.app.screen.width / Math.max(100, this.app.screen.height - this.bottomInset);
        const h = clamp(Math.max(maxY - minY + 4, (maxX - minX + 4) / aspect), 6, 40);
        this.camTarget = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 + 0.5, h };
      }
    }
    if (this.camTarget) {
      const k = 1 - Math.exp(-dt * 3);
      this.cam.x = lerp(this.cam.x, this.camTarget.x, k);
      this.cam.y = lerp(this.cam.y, this.camTarget.y, k);
      this.cam.h = lerp(this.cam.h, this.camTarget.h, k);
    }
    const W = this.app.screen.width;
    const H = Math.max(100, this.app.screen.height - this.bottomInset);
    const zoom = H / (this.cam.h * PPM);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const sh = this.fx.settings.shake ? this.shakeAmt * this.shakeAmt * 28 : 0;
    const sx = (Math.random() - 0.5) * sh;
    const sy = (Math.random() - 0.5) * sh;
    this.worldRoot.scale.set(zoom);
    this.worldRoot.position.set(W / 2 - this.cam.x * PPM * zoom + sx, H / 2 + this.cam.y * PPM * zoom + sy);
    // Backdrop: cover-fit with gentle parallax.
    const tex = this.backdrop.texture;
    if (tex.width > 1) {
      const cover = Math.max(W / tex.width, H / tex.height) * 1.15;
      this.backdrop.scale.set(cover);
      this.backdrop.position.set((W - tex.width * cover) / 2 - this.cam.x * 2, (H - tex.height * cover) / 2 + this.cam.y * 2);
    }
  }

  private updateScreenFx(dt: number): void {
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    // Flash
    this.flashAmt = Math.max(0, this.flashAmt - dt * 3.5);
    this.overlay.clear();
    if (this.flashAmt > 0.01) this.overlay.rect(0, 0, W, H).fill({ color: this.flashColor, alpha: this.flashAmt * 0.6 });
    // Aura (Limiter Break / time stop)
    this.auraTime = Math.max(0, this.auraTime - dt);
    this.aura.visible = this.auraTime > 0;
    if (this.aura.visible) {
      this.aura.width = W;
      this.aura.height = H;
      this.aura.tint = this.auraColor;
      this.aura.alpha = Math.min(1, this.auraTime) * (0.45 + Math.sin(performance.now() / 160) * 0.15);
    }
    // Bloom spikes
    this.bloomSpikeAmt = Math.max(0, this.bloomSpikeAmt - dt * 3);
    this.bloom.bloomScale = this.bloomBase + this.bloomSpikeAmt * 0.6;
    this.bloom.brightness = 1 + this.bloomSpikeAmt * 0.15;
    // Chromatic aberration pulse (filter only attached while active).
    this.chromaAmt = Math.max(0, this.chromaAmt - dt * 2.5);
    const ca = this.fx.settings.chroma ? this.chromaAmt * 6 : 0;
    if (ca > 0.2) {
      this.rgb.red = { x: -ca, y: 0 };
      this.rgb.blue = { x: ca, y: ca * 0.3 };
      if (!this.app.stage.filters || (this.app.stage.filters as unknown[]).length === 0) {
        this.app.stage.filterArea = this.app.screen;
        this.app.stage.filters = [this.rgb];
      }
    } else if (this.app.stage.filters && (this.app.stage.filters as unknown[]).length) this.app.stage.filters = [];
  }

  private vignetteTexture(): Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 60, 128, 128, 182);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return Texture.from(c);
  }

  private hookDrawCalls(): void {
    const r = this.app.renderer as unknown as { gl?: WebGL2RenderingContext };
    const gl = r.gl;
    if (!gl) return;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
      const orig = (gl as unknown as Record<string, (...a: unknown[]) => void>)[fn];
      if (!orig) continue;
      (gl as unknown as Record<string, (...a: unknown[]) => void>)[fn] = (...args: unknown[]) => {
        this.drawCalls++;
        return orig.apply(gl, args);
      };
    }
  }

  // ---------------------------------------------------------------- input
  screenToWorld(sx: number, sy: number): Vec2 {
    const zoom = Math.max(100, this.app.screen.height - this.bottomInset) / (this.cam.h * PPM);
    return { x: (sx - this.worldRoot.position.x) / (zoom * PPM), y: -(sy - this.worldRoot.position.y) / (zoom * PPM) };
  }

  private bindInput(): void {
    const el = this.app.canvas;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', (e) => this.pointerUp(e));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.screenToWorld(e.offsetX, e.offsetY);
      this.zoomBy(Math.exp(e.deltaY * 0.0012));
      this.updateCamera(0);
      const after = this.screenToWorld(e.offsetX, e.offsetY);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  zoomBy(f: number): void {
    this.cam.h = clamp(this.cam.h * f, 3, 60);
    this.camTarget = null;
  }

  private pointerDown(e: PointerEvent): void {
    this.audio.unlock();
    this.audio.startMusic();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    this.pointers.set(e.pointerId, { id: e.pointerId, x: sx, y: sy, type: e.pointerType, button: e.button });
    const p = this.screenToWorld(sx, sy);
    this.pointerWorld = p;

    // Two fingers: pinch/pan; cancel single-finger actions.
    if (this.pointers.size === 2) {
      this.cancelActions();
      const [a, b] = [...this.pointers.values()] as [PointerInfo, PointerInfo];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), h: this.cam.h, mid: this.screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2) };
      return;
    }
    if (this.pointers.size > 2) return;
    // Middle / right button always pans.
    if (e.button === 1 || e.button === 2) {
      this.pan = { sx, sy, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    if (this.tool === 'power') {
      if (this.loop.paused && this.runtime.sub.input !== 'click') this.onToast('Paused: casting is queued until you resume');
      this.pushUndo();
      this.powerPointer = e.pointerId;
      this.runtime.pointerDown(p);
      return;
    }
    if (this.tool === 'spawn') {
      this.spawnAt(this.spawnKind, p);
      return;
    }
    if (this.tool === 'delete') {
      this.deleteAt(p);
      return;
    }
    // Grab tool: grab body or pan.
    const b = this.world.bodyAt(p) ?? this.world.queryCircle(p, 0.25)[0];
    if (b && !b.isStatic) {
      const c = Math.cos(-b.cur.a);
      const s = Math.sin(-b.cur.a);
      const dx = p.x - b.cur.x;
      const dy = p.y - b.cur.y;
      this.grab = { id: b.id, local: { x: dx * c - dy * s, y: dx * s + dy * c }, target: p };
      b.rb.wakeUp();
    } else this.pan = { sx, sy, cx: this.cam.x, cy: this.cam.y };
  }

  private pointerMove(e: PointerEvent): void {
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const info = this.pointers.get(e.pointerId);
    if (info) {
      info.x = sx;
      info.y = sy;
    }
    const p = this.screenToWorld(sx, sy);
    this.pointerWorld = p;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()] as [PointerInfo, PointerInfo];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.cam.h = clamp((this.pinch.h * this.pinch.d) / Math.max(10, d), 3, 60);
      this.camTarget = null;
      this.updateCamera(0);
      const mid = this.screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.cam.x += this.pinch.mid.x - mid.x;
      this.cam.y += this.pinch.mid.y - mid.y;
      return;
    }
    if (this.pan) {
      const zoom = Math.max(100, this.app.screen.height - this.bottomInset) / (this.cam.h * PPM);
      this.cam.x = this.pan.cx - (sx - this.pan.sx) / (zoom * PPM);
      this.cam.y = this.pan.cy + (sy - this.pan.sy) / (zoom * PPM);
      this.camTarget = null;
      return;
    }
    if (this.grab) this.grab.target = p;
    if (this.powerPointer === e.pointerId || (this.powerPointer === null && e.pointerType === 'mouse')) this.runtime.pointerMove(p);
  }

  private pointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) {
      this.pinch = null;
      return;
    }
    const rect = this.app.canvas.getBoundingClientRect();
    const p = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    if (this.powerPointer === e.pointerId) {
      this.runtime.pointerUp(p);
      this.powerPointer = null;
    }
    if (this.pointers.size === 0) {
      this.grab = null;
      this.pan = null;
    }
  }

  cancelActions(): void {
    this.runtime.cancel();
    this.powerPointer = null;
    this.grab = null;
    this.pan = null;
  }

  // ---------------------------------------------------------------- misc controls
  hudToast(msg: string): void {
    this.onToast(msg);
  }
  setPaused(p: boolean): void {
    this.loop.paused = p;
    this.onHud();
  }
  stepFrame(): void {
    this.loop.pendingSteps += 1;
  }
  setGravityY(g: number): void {
    this.world.gravity = { x: 0, y: g };
  }
  get touch(): boolean {
    return this.settings.touchControls === 'on' || (this.settings.touchControls === 'auto' && isTouchDevice());
  }

  /** Scripted benchmark: spawns N dummies and fires a power sequence; resolves with frame stats. */
  async bench(dummies: number, seconds = 10): Promise<{ avg: number; p95: number; frames: number; preset: string }> {
    this.loadArena('flat');
    for (let i = 0; i < dummies; i++) spawnKind(this.world, 'dummy', { x: -8 + (i % 10) * 1.6, y: 1 + Math.floor(i / 10) * 2.2 });
    const seq: [string, string, Vec2, Vec2?][] = [
      ['lightning', 'lightning.chain', { x: -4, y: 1 }],
      ['lightning', 'lightning.strike', { x: 2, y: 1 }],
      ['fire', 'fire.fireball', { x: -8, y: 3 }, { x: 0, y: 1 }],
      ['force', 'force.shockwave', { x: 0, y: 0.5 }],
      ['lightning', 'lightning.emp', { x: 0, y: 1 }],
      ['spacetime', 'time.blackhole', { x: 0, y: 4 }],
      ['ice', 'ice.shards', { x: -6, y: 2 }, { x: 0, y: 1.5 }],
      ['explosives', 'boom.nuke', { x: 0, y: 0.5 }],
    ];
    const times: number[] = [];
    const start = performance.now();
    let last = start;
    let next = 0;
    this.runtime.infiniteEnergy = true;
    this.runtime.noCooldowns = true;
    return new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - start) / 1000;
        // Wall-clock frame time (Pixi's deltaMS is capped at 100 ms, which hides slow frames).
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (next < seq.length && t > 0.8 + next * (seconds - 2) / seq.length) {
          const [pw, sub, a, b] = seq[next++]!;
          this.runtime.selectById(pw, sub);
          this.runtime.pointerDown(a);
          if (b) this.runtime.pointerMove(b);
          this.runtime.pointerUp(b ?? a);
        }
        if (t > seconds) {
          this.app.ticker.remove(tick);
          this.runtime.infiniteEnergy = this.settings.infiniteEnergy;
          this.runtime.noCooldowns = false;
          const s = times.slice(5).sort((x, y) => x - y);
          const avg = s.reduce((x, y) => x + y, 0) / Math.max(1, s.length);
          resolve({ avg: Math.round(avg * 100) / 100, p95: Math.round((s[Math.floor(s.length * 0.95)] ?? 0) * 100) / 100, frames: s.length, preset: this.settings.preset });
        }
      };
      this.app.ticker.add(tick);
    });
  }
}
