// FX renderer implementing FXAPI: pooled particles (ParticleContainer), procedural lightning,
// beams/rings/zones (Graphics, additive), damage numbers, screen flash/shake/aura.
import {
  BitmapText,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Rectangle,
  Sprite,
  Texture,
  type TextureSource,
} from 'pixi.js';
import { rng, type Vec2 } from '../core/math';
import { generateBolt, type BoltPath } from '../fx/bolt';
import type { BoltOptions, BurstOptions, FXAPI, ParticleKind } from '../powers/types';

export const PPM = 40; // pixels per metre in world-layer units

const P = (v: Vec2) => ({ x: v.x * PPM, y: -v.y * PPM });

// ------------------------------------------------------------------ procedural atlas
interface Frames {
  glow: Texture;
  puff: Texture;
  streak: Texture;
  shard: Texture;
  drop: Texture;
  square: Texture;
  ring: Texture;
  flame: Texture;
}

function buildAtlas(): Frames {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  // glow 0..64
  let grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // puff 64..128
  const r = rng(11);
  for (let i = 0; i < 10; i++) {
    const x = 64 + 18 + r() * 28;
    const y = 18 + r() * 28;
    const rr = 10 + r() * 10;
    grad = g.createRadialGradient(x, y, 0, x, y, rr);
    grad.addColorStop(0, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(64, 0, 64, 64);
  }
  // streak 128..192 (x 0..16 height)
  grad = g.createLinearGradient(128, 0, 192, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(160, 8, 32, 6, 0, 0, Math.PI * 2);
  g.fill();
  // shard 192..224
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.moveTo(208, 2);
  g.lineTo(220, 18);
  g.lineTo(206, 30);
  g.lineTo(196, 14);
  g.closePath();
  g.fill();
  // drop 224..256
  grad = g.createRadialGradient(240, 18, 0, 240, 16, 12);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(240, 18, 11, 0, Math.PI * 2);
  g.fill();
  // square 256..272
  g.fillStyle = '#fff';
  g.fillRect(258, 2, 12, 12);
  // ring 288..352
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(320, 32, 26, 0, Math.PI * 2);
  g.stroke();
  // flame 352..416 (teardrop)
  grad = g.createRadialGradient(384, 40, 0, 384, 36, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(384, 2);
  g.quadraticCurveTo(410, 36, 384, 62);
  g.quadraticCurveTo(358, 36, 384, 2);
  g.fill();

  const src = Texture.from(c).source as TextureSource;
  const f = (x: number, y: number, w: number, h: number) => new Texture({ source: src, frame: new Rectangle(x, y, w, h) });
  return {
    glow: f(0, 0, 64, 64),
    puff: f(64, 0, 64, 64),
    streak: f(128, 0, 64, 16),
    shard: f(192, 0, 32, 32),
    drop: f(224, 0, 32, 32),
    square: f(256, 0, 16, 16),
    ring: f(288, 0, 64, 64),
    flame: f(352, 0, 64, 64),
  };
}

// ------------------------------------------------------------------ particles
interface KindDef {
  tex: keyof Frames;
  add: boolean;
  life: [number, number];
  /** Size in metres. */
  size: [number, number];
  grow: number;
  gravity: number;
  drag: number;
  color: number;
  speed: number;
  align?: boolean;
  spin?: number;
}

const KINDS: Record<ParticleKind, KindDef> = {
  spark: { tex: 'streak', add: true, life: [0.25, 0.6], size: [0.25, 0.45], grow: -0.6, gravity: -9, drag: 1.5, color: 0xffd27a, speed: 9, align: true },
  ember: { tex: 'glow', add: true, life: [0.5, 1.2], size: [0.06, 0.14], grow: -0.3, gravity: 1.5, drag: 1.2, color: 0xff8a2a, speed: 3 },
  flame: { tex: 'flame', add: true, life: [0.3, 0.7], size: [0.35, 0.7], grow: 0.8, gravity: 3, drag: 2.5, color: 0xff6a1a, speed: 4, spin: 2 },
  smoke: { tex: 'puff', add: false, life: [1, 2.2], size: [0.5, 0.9], grow: 1.2, gravity: 1.2, drag: 1.6, color: 0x2a2d33, speed: 1.5, spin: 0.6 },
  steam: { tex: 'puff', add: false, life: [0.8, 1.6], size: [0.5, 0.9], grow: 1.5, gravity: 2, drag: 1.8, color: 0xdfe8f0, speed: 2.5, spin: 0.5 },
  stuffing: { tex: 'puff', add: false, life: [1.2, 2.4], size: [0.12, 0.22], grow: 0.1, gravity: -5, drag: 2.2, color: 0xf3efe6, speed: 3.5, spin: 2 },
  shard: { tex: 'shard', add: false, life: [0.7, 1.4], size: [0.08, 0.18], grow: 0, gravity: -9.8, drag: 0.4, color: 0xbff6ff, speed: 6, spin: 8 },
  drop: { tex: 'drop', add: false, life: [0.5, 1.1], size: [0.05, 0.1], grow: 0, gravity: -9.8, drag: 0.3, color: 0x4aa8ff, speed: 5 },
  dust: { tex: 'puff', add: false, life: [0.6, 1.4], size: [0.3, 0.6], grow: 1, gravity: 0.4, drag: 2.5, color: 0x8a7a66, speed: 3, spin: 0.4 },
  glow: { tex: 'glow', add: true, life: [0.2, 0.5], size: [0.4, 0.9], grow: -0.5, gravity: 0, drag: 2, color: 0xffffff, speed: 1 },
  bubble: { tex: 'ring', add: false, life: [0.8, 1.6], size: [0.08, 0.2], grow: 0.2, gravity: 1.2, drag: 1.5, color: 0x9fe0ff, speed: 1.5 },
  gas: { tex: 'puff', add: false, life: [1.5, 3], size: [0.6, 1.1], grow: 0.8, gravity: 0.2, drag: 1.2, color: 0x6fd94a, speed: 1, spin: 0.3 },
  snow: { tex: 'glow', add: true, life: [1, 2], size: [0.05, 0.1], grow: 0, gravity: -1.5, drag: 0.8, color: 0xe6fbff, speed: 2 },
  leaf: { tex: 'shard', add: false, life: [0.8, 1.5], size: [0.08, 0.14], grow: 0, gravity: -2, drag: 1, color: 0xc9d7e8, speed: 4, spin: 6 },
  pixel: { tex: 'square', add: true, life: [0.3, 0.8], size: [0.06, 0.12], grow: -0.5, gravity: 0, drag: 2, color: 0xb388ff, speed: 4, spin: 4 },
};

interface P {
  p: Particle;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
  spin: number;
  align: boolean;
  baseAlpha: number;
  add: boolean;
  alive: boolean;
}

interface Timed {
  life: number;
  max: number;
}
interface BoltFx extends Timed {
  a: Vec2;
  b: Vec2;
  color: number;
  width: number;
  paths: BoltPath[];
  flicker: number;
  nextFlicker: number;
  branches: number;
  jitter: number;
  seed: number;
}
interface BeamFx extends Timed {
  a: Vec2;
  b: Vec2;
  color: number;
  width: number;
  core: number;
}
interface LineFx extends Timed {
  a: Vec2;
  b: Vec2;
  color: number;
  width: number;
  alpha: number;
}
interface RingFx extends Timed {
  p: Vec2;
  color: number;
  radius: number;
  width: number;
  grow: boolean;
}
interface ZoneFx extends Timed {
  p: Vec2;
  r: number;
  color: number;
  alpha: number;
}
interface TextFx extends Timed {
  t: BitmapText;
  vy: number;
}

export interface FxSettings {
  particleCap: number;
  boltDetail: number;
  shake: boolean;
  chroma: boolean;
  damageNumbers: boolean;
}

export interface ScreenHooks {
  shake(amount: number): void;
  hitStop(ms: number): void;
  slowMo(scale: number, seconds: number): void;
  bloomSpike(amount: number): void;
  chroma(amount: number): void;
  flash(color: number, intensity: number): void;
  aura(color: number, seconds: number): void;
}

export class FxRenderer implements FXAPI {
  readonly layerBack = new Container();
  readonly layerFront = new Container();
  private normalPc: ParticleContainer;
  private addPc: ParticleContainer;
  private gfxAdd = new Graphics();
  private gfxNormal = new Graphics();
  private lights = new Container();
  private textLayer = new Container();
  private frames: Frames;
  private pool: P[] = [];
  private live: P[] = [];
  private bolts: BoltFx[] = [];
  private beams: BeamFx[] = [];
  private lines: LineFx[] = [];
  private rings: RingFx[] = [];
  private zones: ZoneFx[] = [];
  private lightFx: { s: Sprite; life: number; max: number; intensity: number }[] = [];
  private texts: TextFx[] = [];
  private textPool: BitmapText[] = [];
  private r = rng(1234);
  private boltBudget = 0;
  settings: FxSettings = { particleCap: 6000, boltDetail: 1, shake: true, chroma: true, damageNumbers: true };

  constructor(private screen: ScreenHooks) {
    this.frames = buildAtlas();
    const dyn = { position: true, rotation: true, color: true, vertex: true, uvs: false };
    this.normalPc = new ParticleContainer({ dynamicProperties: dyn });
    this.addPc = new ParticleContainer({ dynamicProperties: dyn });
    this.addPc.blendMode = 'add';
    this.gfxAdd.blendMode = 'add';
    this.lights.blendMode = 'add';
    this.layerBack.addChild(this.gfxNormal, this.normalPc);
    this.layerFront.addChild(this.lights, this.addPc, this.gfxAdd, this.textLayer);
  }

  get particleCount(): number {
    return this.live.length;
  }

  detail(): number {
    return this.settings.boltDetail;
  }

  // ---------------------------------------------------------------- particles
  burst(kind: ParticleKind, p: Vec2, o: BurstOptions = {}): void {
    const k = KINDS[kind];
    const count = Math.max(1, Math.round((o.count ?? 10) * Math.min(1, this.settings.particleCap / 4000 + 0.25)));
    const tex = this.frames[k.tex];
    const texSize = tex.frame.width;
    for (let i = 0; i < count; i++) {
      if (this.live.length >= this.settings.particleCap) {
        // Recycle the oldest particle.
        const old = this.live.shift();
        if (old) this.release(old);
      }
      const q = this.pool.pop() ?? this.make();
      const a = o.dir ? Math.atan2(o.dir.y, o.dir.x) + (this.r() - 0.5) * (o.spread ?? 0.6) : this.r() * Math.PI * 2;
      const sp = (o.speed ?? k.speed) * (0.35 + this.r() * 0.9);
      const size = (o.size ?? 1) * (k.size[0] + this.r() * (k.size[1] - k.size[0]));
      const life = (o.life ?? 1) * (k.life[0] + this.r() * (k.life[1] - k.life[0]));
      const pp = P(p);
      q.p.texture = tex;
      q.p.x = pp.x;
      q.p.y = pp.y;
      q.vx = Math.cos(a) * sp;
      q.vy = Math.sin(a) * sp;
      q.size = (size * PPM) / texSize;
      q.p.scaleX = q.p.scaleY = q.size;
      q.p.anchorX = kind === 'spark' ? 1 : 0.5;
      q.p.anchorY = 0.5;
      q.p.rotation = this.r() * Math.PI * 2;
      q.p.tint = o.color ?? k.color;
      q.baseAlpha = k.add ? 1 : 0.9;
      q.p.alpha = q.baseAlpha;
      q.life = life;
      q.max = life;
      q.grow = k.grow;
      q.gravity = o.gravity ?? k.gravity;
      q.drag = k.drag;
      q.spin = (k.spin ?? 0) * (this.r() - 0.5) * 2;
      q.align = !!k.align;
      q.add = k.add;
      q.alive = true;
      (k.add ? this.addPc : this.normalPc).particleChildren.push(q.p);
      this.live.push(q);
    }
  }

  private make(): P {
    return {
      p: new Particle({ texture: this.frames.glow }),
      vx: 0, vy: 0, life: 0, max: 1, size: 1, grow: 0, gravity: 0, drag: 0, spin: 0, align: false, baseAlpha: 1, add: false, alive: false,
    };
  }

  private release(q: P): void {
    q.alive = false;
    this.pool.push(q);
  }

  // ---------------------------------------------------------------- shapes
  bolt(a: Vec2, b: Vec2, o: BoltOptions = {}): void {
    // Cap simultaneous bolts so chains can't explode the frame time.
    if (this.bolts.length > 40 * this.settings.boltDetail + 8) return;
    const d = this.settings.boltDetail;
    const life = o.life ?? 0.18;
    const fx: BoltFx = {
      a, b, color: o.color ?? 0xbfe6ff, width: o.width ?? 1, life, max: life,
      flicker: o.flicker ?? 0.045, nextFlicker: 0, branches: Math.round((o.branches ?? 4) * d), jitter: o.jitter ?? 0.22,
      seed: (this.r() * 1e9) | 0, paths: [],
    };
    this.regen(fx);
    this.bolts.push(fx);
    this.light({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { color: fx.color, radius: Math.min(8, Math.hypot(b.x - a.x, b.y - a.y) * 0.8 + 1), life, intensity: 0.5 });
  }

  private regen(f: BoltFx): void {
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
    const d = this.settings.boltDetail;
    const depth = Math.max(3, Math.min(7, Math.round(Math.log2(Math.max(2, L * 6)) * (0.6 + 0.4 * d))));
    f.paths = generateBolt(P(f.a), P(f.b), { depth, jitter: f.jitter, branches: f.branches, maxLevel: d > 0.6 ? 2 : 1 }, rng(f.seed++));
  }

  beam(a: Vec2, b: Vec2, o: { color?: number; width?: number; life?: number; core?: number } = {}): void {
    const life = o.life ?? 0.05;
    this.beams.push({ a, b, color: o.color ?? 0x8fe8ff, width: o.width ?? 0.3, core: o.core ?? 0xffffff, life, max: life });
  }

  line(a: Vec2, b: Vec2, o: { color?: number; width?: number; life?: number; alpha?: number } = {}): void {
    const life = o.life ?? 0.05;
    this.lines.push({ a, b, color: o.color ?? 0xffffff, width: o.width ?? 0.04, alpha: o.alpha ?? 1, life, max: life });
  }

  ring(p: Vec2, o: { color?: number; radius?: number; life?: number; width?: number; grow?: boolean } = {}): void {
    const life = o.life ?? 0.4;
    this.rings.push({ p, color: o.color ?? 0xffffff, radius: o.radius ?? 2, width: o.width ?? 0.12, grow: o.grow ?? true, life, max: life });
  }

  zone(p: Vec2, r: number, o: { color?: number; life?: number; alpha?: number } = {}): void {
    const life = o.life ?? 0.05;
    this.zones.push({ p, r, color: o.color ?? 0xffffff, alpha: o.alpha ?? 0.15, life, max: life });
  }

  light(p: Vec2, o: { color?: number; radius?: number; life?: number; intensity?: number } = {}): void {
    if (this.lightFx.length > 60) return;
    const s = new Sprite(this.frames.glow);
    s.anchor.set(0.5);
    const pp = P(p);
    s.position.set(pp.x, pp.y);
    s.tint = o.color ?? 0xffffff;
    const r = Math.min(9, o.radius ?? 2) * PPM * 1.3;
    s.width = s.height = r;
    const life = o.life ?? 0.15;
    this.lights.addChild(s);
    this.lightFx.push({ s, life, max: life, intensity: (o.intensity ?? 0.6) * 0.32 });
  }

  text(p: Vec2, s: string, color = 0xffffff): void {
    if (!this.settings.damageNumbers || this.texts.length > 40) return;
    const t = this.textPool.pop() ?? new BitmapText({ text: '', style: { fontFamily: 'Inter, sans-serif', fontSize: 22, fill: 0xffffff, fontWeight: '700' } });
    t.text = s;
    t.tint = color;
    t.anchor.set(0.5);
    const pp = P(p);
    t.position.set(pp.x + (this.r() - 0.5) * 10, pp.y - 10);
    t.alpha = 1;
    t.scale.set(0.6);
    this.textLayer.addChild(t);
    this.texts.push({ t, life: 0.9, max: 0.9, vy: -40 });
  }

  // ---------------------------------------------------------------- screen hooks
  flash(color: number, intensity: number): void {
    this.screen.flash(color, intensity);
  }
  shake(amount: number): void {
    if (this.settings.shake) this.screen.shake(amount);
  }
  hitStop(ms: number): void {
    this.screen.hitStop(ms);
  }
  bloomSpike(amount: number): void {
    this.screen.bloomSpike(amount);
  }
  chroma(amount: number): void {
    if (this.settings.chroma) this.screen.chroma(amount);
  }
  aura(color: number, seconds: number): void {
    this.screen.aura(color, seconds);
  }
  slowMo(scale: number, seconds: number): void {
    this.screen.slowMo(scale, seconds);
  }

  clear(): void {
    for (const q of this.live) this.release(q);
    this.live = [];
    this.normalPc.particleChildren.length = 0;
    this.addPc.particleChildren.length = 0;
    this.bolts = [];
    this.beams = [];
    this.lines = [];
    this.rings = [];
    this.zones = [];
    for (const l of this.lightFx) l.s.destroy();
    this.lightFx = [];
  }

  // ---------------------------------------------------------------- update/draw
  update(dt: number): void {
    // Particles (simulated in px space; gravity given in m/s² so scale by PPM).
    const keepN: Particle[] = [];
    const keepA: Particle[] = [];
    const next: P[] = [];
    for (const q of this.live) {
      q.life -= dt;
      if (q.life <= 0) {
        this.release(q);
        continue;
      }
      const k = Math.max(0, 1 - q.drag * dt);
      q.vx *= k;
      q.vy = q.vy * k + q.gravity * dt;
      q.p.x += q.vx * PPM * dt;
      q.p.y -= q.vy * PPM * dt;
      const t = q.life / q.max;
      const s = Math.max(0.01, q.size * (1 + q.grow * (1 - t)));
      q.p.scaleX = q.align ? s * (1 + Math.hypot(q.vx, q.vy) * 0.06) : s;
      q.p.scaleY = s;
      q.p.rotation = q.align ? Math.atan2(-q.vy, q.vx) : q.p.rotation + q.spin * dt;
      q.p.alpha = q.baseAlpha * Math.min(1, t * 2.2);
      (q.add ? keepA : keepN).push(q.p);
      next.push(q);
    }
    this.live = next;
    this.normalPc.particleChildren.length = 0;
    this.normalPc.particleChildren.push(...keepN);
    this.addPc.particleChildren.length = 0;
    this.addPc.particleChildren.push(...keepA);
    this.normalPc.update();
    this.addPc.update();

    // Lights
    this.lightFx = this.lightFx.filter((l) => {
      l.life -= dt;
      if (l.life <= 0) {
        l.s.destroy();
        return false;
      }
      l.s.alpha = l.intensity * (l.life / l.max) * (0.75 + Math.random() * 0.25);
      return true;
    });

    // Texts
    this.texts = this.texts.filter((t) => {
      t.life -= dt;
      t.t.y += t.vy * dt;
      t.t.alpha = Math.min(1, t.life / t.max * 2);
      if (t.life <= 0) {
        t.t.removeFromParent();
        this.textPool.push(t.t);
        return false;
      }
      return true;
    });

    this.drawShapes(dt);
  }

  private drawShapes(dt: number): void {
    const ga = this.gfxAdd.clear();
    const gn = this.gfxNormal.clear();
    this.boltBudget = 0;

    for (const z of this.zones) {
      const pp = P(z.p);
      const a = z.alpha * Math.min(1, (z.life / z.max) * 3);
      gn.circle(pp.x, pp.y, z.r * PPM).fill({ color: z.color, alpha: a * 0.6 });
      ga.circle(pp.x, pp.y, z.r * PPM).stroke({ color: z.color, width: 2, alpha: a * 2.5 });
    }
    this.zones = this.zones.filter((z) => (z.life -= dt) > 0);

    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const pp = P(r.p);
      const rad = r.radius * PPM * (r.grow ? 0.15 + 0.85 * Math.sqrt(t) : 1);
      const w = r.width * PPM * (1 - t * 0.7);
      ga.circle(pp.x, pp.y, rad).stroke({ color: r.color, width: w * 2.5, alpha: 0.25 * (1 - t) });
      ga.circle(pp.x, pp.y, rad).stroke({ color: r.color, width: w, alpha: 0.9 * (1 - t) });
    }
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);

    for (const l of this.lines) {
      const a = P(l.a);
      const b = P(l.b);
      ga.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: l.color, width: l.width * PPM, alpha: l.alpha * Math.min(1, (l.life / l.max) * 2), cap: 'round' });
    }
    this.lines = this.lines.filter((l) => (l.life -= dt) > 0);

    for (const bm of this.beams) {
      const a = P(bm.a);
      const b = P(bm.b);
      const f = Math.min(1, (bm.life / bm.max) * 2);
      const w = bm.width * PPM;
      const wob = 0.85 + Math.random() * 0.3;
      ga.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: bm.color, width: w * 2 * wob, alpha: 0.12 * f, cap: 'round' });
      ga.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: bm.color, width: w * 1.1 * wob, alpha: 0.35 * f, cap: 'round' });
      ga.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: bm.color, width: w * 0.6, alpha: 0.6 * f, cap: 'round' });
      ga.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: bm.core, width: w * 0.28, alpha: 0.95 * f, cap: 'round' });
    }
    this.beams = this.beams.filter((b) => (b.life -= dt) > 0);

    // Lightning: 3 additive layers (halo, glow, white-hot core), path re-randomised for flicker.
    for (const bo of this.bolts) {
      bo.nextFlicker -= dt;
      if (bo.nextFlicker <= 0) {
        this.regen(bo);
        bo.nextFlicker = bo.flicker;
      }
      const f = bo.life / bo.max;
      const vis = f > 0.15 ? 1 : f / 0.15;
      const flick = 0.7 + Math.random() * 0.3;
      for (const path of bo.paths) {
        if (this.boltBudget > 1400) break;
        const lw = bo.width * (path.level === 0 ? 1 : path.level === 1 ? 0.5 : 0.3);
        const pts = path.points;
        this.boltBudget += pts.length;
        const stroke = (width: number, color: number, alpha: number) => {
          ga.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i < pts.length; i++) ga.lineTo(pts[i]!.x, pts[i]!.y);
          ga.stroke({ color, width, alpha, cap: 'round', join: 'round' });
        };
        if (path.level === 0 || this.settings.boltDetail > 0.5) stroke(14 * lw, bo.color, 0.12 * vis * flick);
        stroke(5 * lw, bo.color, 0.45 * vis * flick);
        stroke(1.8 * lw, 0xffffff, 0.95 * vis);
      }
    }
    this.bolts = this.bolts.filter((b) => (b.life -= dt) > 0);
  }
}
