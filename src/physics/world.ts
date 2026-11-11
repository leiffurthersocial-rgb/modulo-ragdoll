// Rapier wrapper: body/joint registry, materials, impact damage, joint stress + breaking,
// queries and per-body bookkeeping used by rendering, statuses and powers.
import RAPIER from '@dimforge/rapier2d-compat';
import { clamp, dist, type Vec2 } from '../core/math';
import type { StatusMap } from '../status/types';
import { MATERIALS, type MaterialId } from './materials';

export type ShapeDesc =
  | { type: 'box'; hw: number; hh: number; round?: number }
  | { type: 'ball'; r: number }
  | { type: 'capsule'; hh: number; r: number };

export type BodyKind =
  | 'part'
  | 'crate'
  | 'ball'
  | 'plank'
  | 'barrel'
  | 'oilbarrel'
  | 'tnt'
  | 'wall'
  | 'platform'
  | 'rope'
  | 'anchor'
  | 'boulder'
  | 'ice'
  | 'shard'
  | 'spike'
  | 'debris'
  | 'clone'
  | 'static'
  | 'projectile';

export type PartName =
  | 'head'
  | 'torso'
  | 'pelvis'
  | 'upperArmL'
  | 'upperArmR'
  | 'forearmL'
  | 'forearmR'
  | 'handL'
  | 'handR'
  | 'thighL'
  | 'thighR'
  | 'shinL'
  | 'shinR'
  | 'footL'
  | 'footR';

export interface Transform {
  x: number;
  y: number;
  a: number;
}

export interface BodyRec {
  id: number;
  kind: BodyKind;
  rb: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  shape: ShapeDesc;
  material: MaterialId;
  hp: number;
  maxHp: number;
  isStatic: boolean;
  dummy?: number;
  part?: PartName;
  rope?: number;
  statuses: StatusMap;
  prev: Transform;
  cur: Transform;
  /** 0 none, 1 scuffs, 2 cracks, 3 dents. */
  damageStage: number;
  /** Visual needs a redraw (damage stage, scale, status look). */
  dirty: boolean;
  /** Seconds until auto-removal (debris, shards). */
  lifetime?: number;
  /** Explodes when ignited or destroyed. */
  explosive?: boolean;
  /** Seed for deterministic crack patterns. */
  seed: number;
  /** Sleep timer for Battery Saver. */
  idle: number;
  /** Saved velocity while time-stopped. */
  stoppedVel?: { vx: number; vy: number; w: number; type: number };
  color?: number;
  scale: number;
  /** Arbitrary tags (e.g. 'noSave'). */
  tags: Set<string>;
}

export interface JointRec {
  id: number;
  a: number;
  b: number;
  joint: RAPIER.ImpulseJoint;
  anchorA: Vec2;
  anchorB: Vec2;
  /** Stretch (m) at which the joint breaks when both parts are healthy. */
  breakStretch: number;
  stress: number;
  dummy?: number;
  name?: string;
  rope?: number;
  unbreakable?: boolean;
}

export interface DummyRec {
  id: number;
  parts: Partial<Record<PartName, number>>;
  joints: Set<number>;
  broken: Set<string>;
  scale: number;
  color: number;
  /** Last time (s) this dummy took notable damage (auto-zoom, kill-cam). */
  lastHit: number;
}

export interface RopeRec {
  id: number;
  anchor: Vec2;
  segments: number;
  bodies: number[];
}

export interface BodySpec {
  kind: BodyKind;
  shape: ShapeDesc;
  material: MaterialId;
  x: number;
  y: number;
  angle?: number;
  isStatic?: boolean;
  kinematic?: boolean;
  hp?: number;
  ccd?: boolean;
  explosive?: boolean;
  lifetime?: number;
  density?: number;
  restitution?: number;
  friction?: number;
  gravityScale?: number;
  color?: number;
  scale?: number;
  tags?: string[];
  vx?: number;
  vy?: number;
  w?: number;
  sensor?: boolean;
}

export type WorldEvent =
  | { type: 'impact'; id: number; other: number; dv: number; point: Vec2 }
  | { type: 'damage'; id: number; amount: number; point: Vec2; cause: string }
  | { type: 'jointBreak'; joint: JointRec; point: Vec2; dummy?: number; name?: string }
  | { type: 'destroyed'; id: number; point: Vec2; kind: BodyKind; material: MaterialId }
  | { type: 'removed'; id: number }
  | { type: 'explode'; id: number; point: Vec2 };

type Listener = (e: WorldEvent) => void;

const SOLVER_DEFAULT = 4;

export class PhysicsWorld {
  world: RAPIER.World;
  readonly bodies = new Map<number, BodyRec>();
  readonly joints = new Map<number, JointRec>();
  readonly dummies = new Map<number, DummyRec>();
  readonly ropes = new Map<number, RopeRec>();
  private colliderToBody = new Map<number, number>();
  private nextId = 1;
  private listeners: Listener[] = [];
  private eventQueue: RAPIER.EventQueue;
  private hooks: RAPIER.PhysicsHooks;
  time = 0;
  killY = -60;
  maxBodies = 450;
  /** Global damage multiplier (Limiter Break etc. are applied by callers). */
  impactDamageScale = 1;

  constructor(gravity: Vec2 = { x: 0, y: -9.81 }) {
    this.world = new RAPIER.World(gravity);
    this.world.integrationParameters.numSolverIterations = SOLVER_DEFAULT;
    this.eventQueue = new RAPIER.EventQueue(true);
    // Parts of the same dummy never collide with each other (stable, no jitter).
    this.hooks = {
      filterContactPair: (c1, c2) => {
        const a = this.bodies.get(this.colliderToBody.get(c1) ?? -1);
        const b = this.bodies.get(this.colliderToBody.get(c2) ?? -1);
        if (a?.dummy !== undefined && a.dummy === b?.dummy) return null;
        if (a?.rope !== undefined && a.rope === b?.rope) return null;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair: () => true,
    };
  }

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  emit(e: WorldEvent): void {
    for (const l of this.listeners) l(e);
  }

  get gravity(): Vec2 {
    return { x: this.world.gravity.x, y: this.world.gravity.y };
  }

  set gravity(g: Vec2) {
    this.world.gravity = { x: g.x, y: g.y };
    for (const b of this.bodies.values()) if (!b.isStatic) b.rb.wakeUp();
  }

  setSolverIterations(n: number): void {
    this.world.integrationParameters.numSolverIterations = n;
  }

  // ------------------------------------------------------------------ bodies
  dynamicCount(): number {
    let n = 0;
    for (const b of this.bodies.values()) if (!b.isStatic) n++;
    return n;
  }

  createBody(spec: BodySpec): BodyRec {
    const mat = MATERIALS[spec.material];
    const s = spec.scale ?? 1;
    const desc = spec.isStatic
      ? RAPIER.RigidBodyDesc.fixed()
      : spec.kinematic
        ? RAPIER.RigidBodyDesc.kinematicPositionBased()
        : RAPIER.RigidBodyDesc.dynamic();
    desc.setTranslation(spec.x, spec.y).setRotation(spec.angle ?? 0);
    if (!spec.isStatic) {
      desc.setLinearDamping(0.05).setAngularDamping(0.25);
      if (spec.ccd) desc.setCcdEnabled(true);
      if (spec.gravityScale !== undefined) desc.setGravityScale(spec.gravityScale);
      if (spec.vx || spec.vy) desc.setLinvel(spec.vx ?? 0, spec.vy ?? 0);
      if (spec.w) desc.setAngvel(spec.w);
    }
    const rb = this.world.createRigidBody(desc);
    const cdesc = this.colliderDesc(spec.shape, s)
      .setDensity(spec.density ?? mat.density)
      .setFriction(spec.friction ?? mat.friction)
      .setRestitution(spec.restitution ?? mat.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(5);
    if (spec.kind === 'part' || spec.kind === 'rope') cdesc.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    if (spec.sensor) cdesc.setSensor(true);
    const collider = this.world.createCollider(cdesc, rb);
    const id = this.nextId++;
    const maxHp = spec.hp ?? (spec.isStatic ? Infinity : 100);
    const t = { x: spec.x, y: spec.y, a: spec.angle ?? 0 };
    const rec: BodyRec = {
      id,
      kind: spec.kind,
      rb,
      collider,
      shape: spec.shape,
      material: spec.material,
      hp: maxHp,
      maxHp,
      isStatic: !!spec.isStatic,
      statuses: new Map(),
      prev: { ...t },
      cur: { ...t },
      damageStage: 0,
      dirty: true,
      seed: (Math.random() * 1e9) | 0,
      idle: 0,
      scale: s,
      tags: new Set(spec.tags ?? []),
      ...(spec.lifetime !== undefined ? { lifetime: spec.lifetime } : {}),
      ...(spec.explosive ? { explosive: true } : {}),
      ...(spec.color !== undefined ? { color: spec.color } : {}),
    };
    this.bodies.set(id, rec);
    this.colliderToBody.set(collider.handle, id);
    return rec;
  }

  private colliderDesc(shape: ShapeDesc, s: number): RAPIER.ColliderDesc {
    switch (shape.type) {
      case 'ball':
        return RAPIER.ColliderDesc.ball(shape.r * s);
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(shape.hh * s, shape.r * s);
      case 'box':
        return shape.round
          ? RAPIER.ColliderDesc.roundCuboid(
              Math.max(0.01, (shape.hw - shape.round) * s),
              Math.max(0.01, (shape.hh - shape.round) * s),
              shape.round * s,
            )
          : RAPIER.ColliderDesc.cuboid(shape.hw * s, shape.hh * s);
    }
  }

  /** Resize a single (non-dummy) body in place. */
  rescale(id: number, factor: number): void {
    const b = this.bodies.get(id);
    if (!b || b.isStatic) return;
    const mat = MATERIALS[b.material];
    const newScale = clamp(b.scale * factor, 0.25, 4);
    this.colliderToBody.delete(b.collider.handle);
    const density = b.collider.density();
    this.world.removeCollider(b.collider, false);
    const cdesc = this.colliderDesc(b.shape, newScale)
      .setDensity(density)
      .setFriction(mat.friction)
      .setRestitution(b.collider.restitution?.() ?? mat.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(5);
    if (b.kind === 'part' || b.kind === 'rope') cdesc.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    b.collider = this.world.createCollider(cdesc, b.rb);
    this.colliderToBody.set(b.collider.handle, b.id);
    b.scale = newScale;
    b.dirty = true;
    b.rb.wakeUp();
  }

  removeBody(id: number): void {
    const b = this.bodies.get(id);
    if (!b) return;
    for (const j of [...this.joints.values()]) if (j.a === id || j.b === id) this.removeJoint(j.id);
    this.colliderToBody.delete(b.collider.handle);
    this.world.removeRigidBody(b.rb);
    this.bodies.delete(id);
    if (b.dummy !== undefined) {
      const d = this.dummies.get(b.dummy);
      if (d) {
        for (const [k, v] of Object.entries(d.parts)) if (v === id) delete d.parts[k as PartName];
        if (Object.keys(d.parts).length === 0) this.dummies.delete(d.id);
      }
    }
    if (b.rope !== undefined) {
      const r = this.ropes.get(b.rope);
      if (r) {
        r.bodies = r.bodies.filter((x) => x !== id);
        if (!r.bodies.length) this.ropes.delete(r.id);
      }
    }
    this.emit({ type: 'removed', id });
  }

  removeDummy(dummyId: number): void {
    const d = this.dummies.get(dummyId);
    if (!d) return;
    for (const id of Object.values(d.parts)) if (id !== undefined) this.removeBody(id);
    this.dummies.delete(dummyId);
  }

  clearDynamic(): void {
    for (const b of [...this.bodies.values()]) if (!b.isStatic || b.kind === 'anchor') this.removeBody(b.id);
    this.dummies.clear();
    this.ropes.clear();
  }

  clearAll(): void {
    for (const b of [...this.bodies.values()]) this.removeBody(b.id);
    this.dummies.clear();
    this.ropes.clear();
  }

  bodyOfCollider(handle: number): BodyRec | undefined {
    return this.bodies.get(this.colliderToBody.get(handle) ?? -1);
  }

  // ------------------------------------------------------------------ joints
  createRevolute(
    a: BodyRec,
    b: BodyRec,
    worldPoint: Vec2,
    opts: {
      limits?: [number, number];
      motor?: { stiffness: number; damping: number };
      breakStretch?: number;
      dummy?: number;
      name?: string;
      rope?: number;
      unbreakable?: boolean;
    } = {},
  ): JointRec {
    const pa = a.rb.translation();
    const pb = b.rb.translation();
    const ra = a.rb.rotation();
    const rb = b.rb.rotation();
    const local = (p: { x: number; y: number }, r: number, w: Vec2): Vec2 => {
      const dx = w.x - p.x;
      const dy = w.y - p.y;
      const c = Math.cos(-r);
      const s = Math.sin(-r);
      return { x: dx * c - dy * s, y: dx * s + dy * c };
    };
    const anchorA = local(pa, ra, worldPoint);
    const anchorB = local(pb, rb, worldPoint);
    const data = RAPIER.JointData.revolute(anchorA, anchorB);
    if (opts.limits) {
      data.limitsEnabled = true;
      data.limits = [opts.limits[0], opts.limits[1]];
    }
    const joint = this.world.createImpulseJoint(data, a.rb, b.rb, true) as RAPIER.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);
    if (opts.motor) joint.configureMotorPosition(0, opts.motor.stiffness, opts.motor.damping);
    const rec: JointRec = {
      id: this.nextId++,
      a: a.id,
      b: b.id,
      joint,
      anchorA,
      anchorB,
      breakStretch: opts.breakStretch ?? 0.09,
      stress: 0,
      ...(opts.dummy !== undefined ? { dummy: opts.dummy } : {}),
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.rope !== undefined ? { rope: opts.rope } : {}),
      ...(opts.unbreakable ? { unbreakable: true } : {}),
    };
    this.joints.set(rec.id, rec);
    if (opts.dummy !== undefined) this.dummies.get(opts.dummy)?.joints.add(rec.id);
    return rec;
  }

  removeJoint(id: number): void {
    const j = this.joints.get(id);
    if (!j) return;
    if (this.world.getImpulseJoint(j.joint.handle)) this.world.removeImpulseJoint(j.joint, true);
    this.joints.delete(id);
    if (j.dummy !== undefined) this.dummies.get(j.dummy)?.joints.delete(id);
  }

  jointWorldPoint(j: JointRec): { pa: Vec2; pb: Vec2 } {
    const A = this.bodies.get(j.a)!;
    const B = this.bodies.get(j.b)!;
    const tf = (b: BodyRec, l: Vec2): Vec2 => {
      const p = b.rb.translation();
      const r = b.rb.rotation();
      const c = Math.cos(r);
      const s = Math.sin(r);
      return { x: p.x + l.x * c - l.y * s, y: p.y + l.x * s + l.y * c };
    };
    return { pa: tf(A, j.anchorA), pb: tf(B, j.anchorB) };
  }

  breakJoint(id: number, cause = 'stress'): void {
    const j = this.joints.get(id);
    if (!j || j.unbreakable) return;
    const { pa } = this.jointWorldPoint(j);
    this.removeJoint(id);
    if (j.dummy !== undefined) {
      const d = this.dummies.get(j.dummy);
      if (d && j.name) d.broken.add(j.name);
    }
    this.emit({ type: 'jointBreak', joint: j, point: pa, ...(j.dummy !== undefined ? { dummy: j.dummy } : {}), ...(j.name ? { name: j.name } : {}) });
    void cause;
  }

  /** Break every joint attached to a body (used by cuts, shatter, part destruction). */
  breakJointsOf(id: number, cause = 'cut'): number {
    let n = 0;
    for (const j of [...this.joints.values()]) {
      if ((j.a === id || j.b === id) && !j.unbreakable) {
        this.breakJoint(j.id, cause);
        n++;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ damage
  damage(id: number, amount: number, cause: string, point?: Vec2): number {
    const b = this.bodies.get(id);
    if (!b || b.isStatic || amount <= 0 || b.hp <= 0) return 0;
    const dealt = amount * MATERIALS[b.material].fragility;
    if (dealt <= 0) return 0;
    b.hp -= dealt;
    const frac = b.hp / b.maxHp;
    const stage = frac < 0.25 ? 3 : frac < 0.55 ? 2 : frac < 0.85 ? 1 : 0;
    if (stage !== b.damageStage) {
      b.damageStage = stage;
      b.dirty = true;
    }
    const p = point ?? { x: b.cur.x, y: b.cur.y };
    if (b.dummy !== undefined) {
      const d = this.dummies.get(b.dummy);
      if (d) d.lastHit = this.time;
    }
    this.emit({ type: 'damage', id, amount: dealt, point: p, cause });
    if (b.hp <= 0) {
      b.hp = 0;
      this.emit({ type: 'destroyed', id, point: p, kind: b.kind, material: b.material });
      if (b.explosive) this.emit({ type: 'explode', id, point: p });
      else if (b.kind === 'part') this.breakJointsOf(id, 'destroyed');
    }
    return dealt;
  }

  heal(id: number): void {
    const b = this.bodies.get(id);
    if (!b) return;
    b.hp = b.maxHp;
    b.damageStage = 0;
    b.dirty = true;
  }

  // ------------------------------------------------------------------ step
  private prevVel = new Map<number, { x: number; y: number }>();
  /** Impulses we applied this step (powers, grab, statuses), per body. */
  private extImpulse = new Map<number, { x: number; y: number }>();
  /** Contact impulse magnitude this step, per body. */
  private contactImpulse = new Map<number, number>();

  recordImpulse(b: BodyRec, jx: number, jy: number): void {
    const e = this.extImpulse.get(b.id);
    if (e) {
      e.x += jx;
      e.y += jy;
    } else this.extImpulse.set(b.id, { x: jx, y: jy });
  }

  /** Apply an impulse and remember it for joint-load estimation. */
  applyImpulse(b: BodyRec, jx: number, jy: number, point?: Vec2): void {
    if (b.isStatic) return;
    if (point) b.rb.applyImpulseAtPoint({ x: jx, y: jy }, point, true);
    else b.rb.applyImpulse({ x: jx, y: jy }, true);
    this.recordImpulse(b, jx, jy);
  }

  setVelocity(b: BodyRec, vx: number, vy: number): void {
    if (b.isStatic) return;
    const v = b.rb.linvel();
    const m = b.rb.mass();
    b.rb.setLinvel({ x: vx, y: vy }, true);
    this.recordImpulse(b, (vx - v.x) * m, (vy - v.y) * m);
  }

  step(dt: number): void {
    for (const b of this.bodies.values()) {
      b.prev.x = b.cur.x;
      b.prev.y = b.cur.y;
      b.prev.a = b.cur.a;
      if (!b.isStatic) {
        const v = b.rb.linvel();
        const pv = this.prevVel.get(b.id);
        if (pv) {
          pv.x = v.x;
          pv.y = v.y;
        } else this.prevVel.set(b.id, { x: v.x, y: v.y });
      }
    }
    this.world.timestep = dt;
    this.world.step(this.eventQueue, this.hooks);
    this.time += dt;

    // Impact damage: a contact-force event tells us a collision happened; the damage uses the
    // body's real velocity change this step (gravity removed), so resting/standing never hurts.
    const g = this.world.gravity;
    this.eventQueue.drainContactForceEvents((e) => {
      const A = this.bodyOfCollider(e.collider1());
      const B = this.bodyOfCollider(e.collider2());
      if (!A || !B) return;
      const F = e.totalForceMagnitude();
      this.contactImpulse.set(A.id, (this.contactImpulse.get(A.id) ?? 0) + F * dt);
      this.contactImpulse.set(B.id, (this.contactImpulse.get(B.id) ?? 0) + F * dt);
      for (const [self, other] of [
        [A, B],
        [B, A],
      ] as const) {
        if (self.isStatic) continue;
        const m = Math.max(0.05, self.rb.mass());
        const pv = this.prevVel.get(self.id);
        const v = self.rb.linvel();
        const gs = self.rb.gravityScale();
        const actual = pv ? Math.hypot(v.x - pv.x - g.x * gs * dt, v.y - pv.y - g.y * gs * dt) : 0;
        const dv = Math.min((F * dt) / m, actual);
        if (dv < 2.5) continue;
        const point = { x: (A.cur.x + B.cur.x) / 2, y: (A.cur.y + B.cur.y) / 2 };
        this.emit({ type: 'impact', id: self.id, other: other.id, dv, point });
        if (dv > 7) this.damage(self.id, (dv - 7) * 3.2 * this.impactDamageScale, 'impact', point);
        // Frozen bodies shatter on hard hits.
        if (dv > 6 && self.statuses.has('frozen')) this.damage(self.id, 40, 'shatter', point);
      }
    });

    // Update transforms + joint stress.
    for (const b of this.bodies.values()) {
      const p = b.rb.translation();
      b.cur.x = p.x;
      b.cur.y = p.y;
      b.cur.a = b.rb.rotation();
      if (b.lifetime !== undefined) b.lifetime -= dt;
    }
    // Joint load: the impulse the joint had to deliver to the distal part (B) this step =
    // its momentum change minus gravity, minus impulses we know about (powers, grab, contacts).
    // Rapier doesn't expose joint impulses, and its joints are too stiff for stretch alone.
    const joint = new Map<number, number>();
    const jointImpulse = (b: BodyRec): number => {
      const hit = joint.get(b.id);
      if (hit !== undefined) return hit;
      const pv = this.prevVel.get(b.id);
      if (!pv || b.isStatic) return 0;
      const v = b.rb.linvel();
      const m = b.rb.mass();
      const gs = b.rb.gravityScale();
      const ext = this.extImpulse.get(b.id);
      const jx = m * (v.x - pv.x - g.x * gs * dt) - (ext?.x ?? 0);
      const jy = m * (v.y - pv.y - g.y * gs * dt) - (ext?.y ?? 0);
      const val = Math.max(0, Math.hypot(jx, jy) - (this.contactImpulse.get(b.id) ?? 0));
      joint.set(b.id, val);
      return val;
    };
    for (const j of [...this.joints.values()]) {
      if (j.unbreakable) continue;
      const A = this.bodies.get(j.a);
      const B = this.bodies.get(j.b);
      if (!A || !B) {
        this.removeJoint(j.id);
        continue;
      }
      const health = Math.max(0, Math.min(A.hp / A.maxHp, B.hp / B.maxHp));
      // Threshold: stopping the distal part from ~16 m/s within one step (less when damaged).
      const limit = 16 * B.rb.mass() * (0.3 + 0.7 * health) * j.breakStretch * 10;
      const load = jointImpulse(B);
      const { pa, pb } = this.jointWorldPoint(j);
      const stretch = dist(pa, pb) / (j.breakStretch * Math.max(A.scale, B.scale));
      const ratio = Math.max(load / Math.max(1e-4, limit), stretch);
      if (ratio > 1) j.stress += ratio;
      else j.stress = Math.max(0, j.stress - 0.35);
      if (j.stress > 2.2) this.breakJoint(j.id);
    }
    this.extImpulse.clear();
    this.contactImpulse.clear();
    // Remove lost / expired bodies.
    for (const b of [...this.bodies.values()]) {
      if (b.isStatic) continue;
      if (b.cur.y < this.killY || Math.abs(b.cur.x) > 400 || Math.abs(b.cur.y) > 400 || (b.lifetime !== undefined && b.lifetime <= 0)) {
        this.removeBody(b.id);
        this.prevVel.delete(b.id);
      }
    }
  }

  // ------------------------------------------------------------------ queries
  queryCircle(p: Vec2, r: number, includeStatic = false): BodyRec[] {
    const out: BodyRec[] = [];
    const seen = new Set<number>();
    this.world.intersectionsWithShape(p, 0, new RAPIER.Ball(r), (c) => {
      const b = this.bodyOfCollider(c.handle);
      if (b && !seen.has(b.id) && (includeStatic || !b.isStatic)) {
        seen.add(b.id);
        out.push(b);
      }
      return true;
    });
    return out;
  }

  /** Bodies whose centre lies within a rotated rectangle. */
  queryBox(center: Vec2, hw: number, hh: number, angle: number, includeStatic = false): BodyRec[] {
    const out: BodyRec[] = [];
    const seen = new Set<number>();
    this.world.intersectionsWithShape(center, angle, new RAPIER.Cuboid(hw, hh), (c) => {
      const b = this.bodyOfCollider(c.handle);
      if (b && !seen.has(b.id) && (includeStatic || !b.isStatic)) {
        seen.add(b.id);
        out.push(b);
      }
      return true;
    });
    return out;
  }

  raycast(from: Vec2, dir: Vec2, maxDist: number, includeStatic = true): { body: BodyRec; point: Vec2; normal: Vec2; t: number } | null {
    const ray = new RAPIER.Ray(from, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, undefined, undefined, undefined, (c) => {
      const b = this.bodyOfCollider(c.handle);
      return !!b && (includeStatic || !b.isStatic) && !c.isSensor();
    });
    if (!hit) return null;
    const body = this.bodyOfCollider(hit.collider.handle);
    if (!body) return null;
    const t = hit.timeOfImpact;
    return { body, point: { x: from.x + dir.x * t, y: from.y + dir.y * t }, normal: { x: hit.normal.x, y: hit.normal.y }, t };
  }

  /** All bodies crossed by a segment, with hit points, sorted by distance. */
  segmentHits(a: Vec2, b: Vec2, includeStatic = false): { body: BodyRec; point: Vec2; t: number }[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) return [];
    const ray = new RAPIER.Ray(a, { x: dx / L, y: dy / L });
    const out = new Map<number, { body: BodyRec; point: Vec2; t: number }>();
    this.world.intersectionsWithRay(ray, L, true, (hit) => {
      const body = this.bodyOfCollider(hit.collider.handle);
      if (body && (includeStatic || !body.isStatic) && !out.has(body.id)) {
        const t = hit.timeOfImpact;
        out.set(body.id, { body, point: { x: a.x + (dx / L) * t, y: a.y + (dy / L) * t }, t });
      }
      return true;
    });
    return [...out.values()].sort((x, y) => x.t - y.t);
  }

  bodyAt(p: Vec2): BodyRec | undefined {
    let found: BodyRec | undefined;
    this.world.intersectionsWithPoint(p, (c) => {
      const b = this.bodyOfCollider(c.handle);
      if (b && !b.isStatic) {
        found = b;
        return false;
      }
      return true;
    });
    return found;
  }

  /** Approximate radius of a body (for FX sizing and area checks). */
  radius(b: BodyRec): number {
    const s = b.shape;
    const r = s.type === 'ball' ? s.r : s.type === 'capsule' ? s.hh + s.r : Math.hypot(s.hw, s.hh);
    return r * b.scale;
  }

  /** Apply a velocity change (mass-independent push). */
  push(b: BodyRec, dvx: number, dvy: number): void {
    if (b.isStatic || b.statuses.has('stopped')) return;
    const m = b.rb.mass();
    this.applyImpulse(b, dvx * m, dvy * m);
  }
}
