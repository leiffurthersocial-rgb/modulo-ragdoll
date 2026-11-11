// Applies and ticks status effects on bodies, running the pure interaction rules from
// status/interactions.ts and turning their events into physics + FX + audio.
import type { AudioEngine } from '../audio/audio';
import { rand, type Vec2 } from '../core/math';
import { MATERIALS } from '../physics/materials';
import type { BodyRec, PhysicsWorld } from '../physics/world';
import type { FXAPI, StatusAPI } from '../powers/types';
import { dotDamage, gravityFactor, resolveApply, STATUS_DEFS, conductivity, type InteractionKind, type MaterialTraits } from '../status/interactions';
import type { StatusId } from '../status/types';

export class StatusSystem implements StatusAPI {
  private acc = 0;
  /** Extra gravity multiplier channel set by powers (e.g. Heavy Mode). */
  readonly gravityChannel = new Map<number, number>();
  onInteraction: ((kind: InteractionKind, b: BodyRec) => void) | null = null;
  /** Explosion callback (wired by Game so explosions share one implementation). */
  explode: (p: Vec2, radius: number, power: number) => void = () => undefined;

  constructor(private world: PhysicsWorld, private fx: FXAPI, private audio: AudioEngine) {}

  traits(b: BodyRec): MaterialTraits {
    const m = MATERIALS[b.material];
    return { flammability: m.flammability, conductivity: m.conductivity, metal: b.material === 'metal' };
  }

  has(id: number, s: StatusId): boolean {
    return !!this.world.bodies.get(id)?.statuses.has(s);
  }

  remove(id: number, s: StatusId): void {
    const b = this.world.bodies.get(id);
    if (!b || !b.statuses.has(s)) return;
    b.statuses.delete(s);
    this.onRemoved(b, s);
  }

  apply(id: number, s: StatusId, duration?: number, stacks = 1): void {
    const b = this.world.bodies.get(id);
    if (!b || b.isStatic || b.hp <= 0 && s !== 'stopped') return;
    const def = STATUS_DEFS[s];
    const res = resolveApply(new Set(b.statuses.keys()), s, this.traits(b));
    for (const r of res.remove) this.remove(id, r);
    for (const e of res.events) this.interaction(e, b);
    if (!res.apply) return;
    const cur = b.statuses.get(s);
    const dur = (duration ?? def.duration) * res.durationScale;
    const st = Math.min(def.maxStacks, (cur?.stacks ?? 0) + stacks + res.bonusStacks);
    b.statuses.set(s, { time: Math.max(cur?.time ?? 0, dur), stacks: st });
    if (!cur) this.onAdded(b, s);
  }

  private onAdded(b: BodyRec, s: StatusId): void {
    if (s === 'frozen') {
      b.rb.setLinearDamping(3);
      b.rb.setAngularDamping(6);
      b.collider.setFriction(0.05);
      this.fx.burst('snow', b.cur, { count: 6 });
    }
    if (s === 'stopped') {
      const v = b.rb.linvel();
      b.stoppedVel = { vx: v.x, vy: v.y, w: b.rb.angvel(), type: 0 };
      b.rb.setLinvel({ x: 0, y: 0 }, false);
      b.rb.setAngvel(0, false);
      b.rb.setEnabled(false);
    }
    this.updateGravity(b);
  }

  private onRemoved(b: BodyRec, s: StatusId): void {
    if (s === 'frozen') {
      b.rb.setLinearDamping(0.05);
      b.rb.setAngularDamping(0.25);
      b.collider.setFriction(MATERIALS[b.material].friction);
    }
    if (s === 'stopped') {
      b.rb.setEnabled(true);
      if (b.stoppedVel) {
        b.rb.setLinvel({ x: b.stoppedVel.vx, y: b.stoppedVel.vy }, true);
        b.rb.setAngvel(b.stoppedVel.w, true);
      }
      delete b.stoppedVel;
    }
    this.updateGravity(b);
  }

  updateGravity(b: BodyRec): void {
    if (b.isStatic) return;
    const g = gravityFactor(b.statuses.keys()) * (this.gravityChannel.get(b.id) ?? 1);
    b.rb.setGravityScale(g, true);
  }

  private interaction(kind: InteractionKind, b: BodyRec): void {
    const p = { x: b.cur.x, y: b.cur.y };
    switch (kind) {
      case 'steam':
        this.fx.burst('steam', p, { count: 14, speed: 3 });
        this.audio.play('acid', { pos: p, pitch: 0.7 });
        break;
      case 'extinguish':
        this.fx.burst('steam', p, { count: 8 });
        break;
      case 'oilExplosion':
        this.explode(p, 3.2, 1.3);
        break;
      case 'amplifiedChain':
        this.fx.burst('spark', p, { count: 16, color: 0xbfe6ff, speed: 10 });
        this.fx.flash(0xbfe6ff, 0.15);
        break;
      case 'flashFreeze':
        this.fx.burst('shard', p, { count: 10 });
        this.audio.play('freeze', { pos: p, pitch: 1.4 });
        break;
      case 'brittleShock':
        this.world.damage(b.id, 25, 'shatter', p);
        this.fx.burst('shard', p, { count: 12 });
        break;
      case 'toxicFlare':
        this.fx.burst('flame', p, { count: 12, color: 0x9dff3a });
        for (const o of this.world.queryCircle(p, 1.6)) this.world.damage(o.id, 18, 'toxic', p);
        break;
      case 'melt':
        this.fx.burst('drop', p, { count: 10, color: 0x9ff4ff });
        break;
      case 'corrode':
        this.fx.burst('gas', p, { count: 4, color: 0xc6ff1a });
        break;
      case 'neutralize':
        this.fx.ring(p, { color: 0xffffff, radius: 0.8, life: 0.3 });
        break;
    }
    this.onInteraction?.(kind, b);
  }

  clear(b: BodyRec): void {
    for (const s of [...b.statuses.keys()]) this.remove(b.id, s);
  }

  /** Run every physics step; heavy work happens at 10 Hz. */
  step(dt: number): void {
    this.acc += dt;
    // Per-step: velocity effects that need to be smooth.
    for (const b of this.world.bodies.values()) {
      if (!b.statuses.size) continue;
      if (b.statuses.has('slowed')) {
        const v = b.rb.linvel();
        b.rb.setLinvel({ x: v.x * 0.94, y: v.y * 0.94 }, true);
        b.rb.setAngvel(b.rb.angvel() * 0.94, true);
      }
      if (b.statuses.has('crushed')) this.world.push(b, 0, -0.6);
      if (b.statuses.has('floating')) {
        const v = b.rb.linvel();
        b.rb.setLinvel({ x: v.x * 0.99, y: v.y * 0.98 }, true);
      }
    }
    if (this.acc < 0.1) return;
    const tick = this.acc;
    this.acc = 0;
    for (const b of [...this.world.bodies.values()]) {
      if (!b.statuses.size) continue;
      const tr = this.traits(b);
      const p = { x: b.cur.x, y: b.cur.y };
      for (const [s, inst] of [...b.statuses]) {
        inst.time -= tick;
        const dmg = dotDamage(s, inst.stacks, tr) * tick;
        if (dmg > 0) this.world.damage(b.id, dmg, s, p);
        switch (s) {
          case 'burning':
            this.fx.burst('flame', p, { count: 2 + inst.stacks, size: 0.6 + this.world.radius(b) });
            if (Math.random() < 0.3) this.fx.burst('ember', p, { count: 2 });
            if (Math.random() < 0.15) this.fx.burst('smoke', p, { count: 1 });
            // Spread to touching flammable bodies.
            for (const o of this.world.queryCircle(p, this.world.radius(b) + 0.25)) {
              if (o.id !== b.id && !o.statuses.has('burning') && Math.random() < MATERIALS[o.material].flammability * 0.12) this.apply(o.id, 'burning', 4);
            }
            if (b.explosive && Math.random() < 0.25) this.world.damage(b.id, 30, 'fire', p);
            break;
          case 'shocked': {
            // Jitter + arcs between neighbouring dummy joints (the skeleton lights up).
            this.world.push(b, rand(-1.5, 1.5), rand(-1, 1.5));
            if (b.dummy !== undefined) {
              const d = this.world.dummies.get(b.dummy);
              const parts = d ? (Object.values(d.parts) as number[]) : [];
              const other = this.world.bodies.get(parts[Math.floor(Math.random() * parts.length)] ?? -1);
              if (other && other.id !== b.id) this.fx.bolt(p, other.cur, { color: 0xbfe6ff, width: 0.35, branches: 0, life: 0.08, jitter: 0.3 });
            }
            if (Math.random() < 0.35) this.fx.burst('spark', p, { count: 3, color: 0xdff2ff, speed: 6 });
            // Conduct to nearby conductive bodies (much further if soaked).
            const c = conductivity(tr.conductivity, new Set(b.statuses.keys()));
            if (inst.stacks > 1 && c > 0.4) {
              for (const o of this.world.queryCircle(p, 0.6 + c)) {
                if (o.id === b.id || o.dummy === b.dummy && b.dummy !== undefined || o.statuses.has('shocked')) continue;
                const oc = conductivity(MATERIALS[o.material].conductivity, new Set(o.statuses.keys()));
                if (oc > 0.35 && Math.random() < 0.35) {
                  this.fx.bolt(p, o.cur, { color: 0xbfe6ff, width: 0.5, branches: 1, life: 0.12 });
                  this.apply(o.id, 'shocked', 1.2, inst.stacks - 1);
                }
              }
            }
            if (Math.random() < 0.2) this.audio.play('zap', { pos: p, volume: 0.35 });
            break;
          }
          case 'soaked':
            if (Math.random() < 0.3) this.fx.burst('drop', p, { count: 1, speed: 0.5 });
            break;
          case 'poisoned':
            if (Math.random() < 0.4) this.fx.burst('bubble', p, { count: 1, color: 0x7dff4f });
            break;
          case 'acid':
            if (Math.random() < 0.5) this.fx.burst('gas', p, { count: 1, color: 0xc6ff1a, size: 0.4 });
            break;
          case 'frozen':
            if (Math.random() < 0.15) this.fx.burst('snow', p, { count: 1 });
            break;
          case 'floating':
            if (Math.random() < 0.2) this.fx.burst('pixel', p, { count: 1, color: 0xd7b8ff });
            break;
        }
        if (inst.time <= 0) {
          b.statuses.delete(s);
          this.onRemoved(b, s);
        }
      }
    }
  }
}
