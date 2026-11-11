// Adapter: PhysicsWorld (Rapier) → engine-agnostic PhysicsAPI used by power definitions.
import { rotate, sub, type Vec2 } from '../core/math';
import { MATERIALS } from '../physics/materials';
import { objectSpec, spawn, type SpawnKind } from '../physics/objects';
import { dummyCenter, spawnDummy } from '../physics/ragdoll';
import type { BodyRec, PhysicsWorld } from '../physics/world';
import type { BodyInfo, DummyInfo, PhysicsAPI, ProjectileOptions } from '../powers/types';
import { conductivity } from '../status/interactions';
import type { History } from './history';
import type { StatusSystem } from './status-system';

export class GamePhysicsAPI implements PhysicsAPI {
  viewRect = { x: 0, y: 0, w: 20, h: 12 };

  constructor(
    private world: PhysicsWorld,
    private status: StatusSystem,
    private history: History,
  ) {}

  private b(id: number): BodyRec | undefined {
    return this.world.bodies.get(id);
  }

  gravity(): Vec2 {
    return this.world.gravity;
  }
  setGravity(g: Vec2): void {
    this.world.gravity = g;
  }

  bodiesIn(center: Vec2, radius: number): number[] {
    return this.world.queryCircle(center, radius).map((b) => b.id);
  }
  bodiesInBox(center: Vec2, hw: number, hh: number, angle: number): number[] {
    return this.world.queryBox(center, hw, hh, angle).map((b) => b.id);
  }
  bodiesOnSegment(a: Vec2, b: Vec2): { id: number; point: Vec2 }[] {
    return this.world.segmentHits(a, b).map((h) => ({ id: h.body.id, point: h.point }));
  }
  raycast(from: Vec2, dir: Vec2, maxDist: number, includeStatic = true) {
    const h = this.world.raycast(from, dir, maxDist, includeStatic);
    return h ? { id: h.body.id, point: h.point, normal: h.normal, isStatic: h.body.isStatic } : null;
  }

  info(id: number): BodyInfo | null {
    const b = this.b(id);
    if (!b) return null;
    const v = b.rb.linvel();
    const m = MATERIALS[b.material];
    return {
      id,
      pos: { x: b.cur.x, y: b.cur.y },
      vel: { x: v.x, y: v.y },
      angle: b.cur.a,
      mass: b.isStatic ? Infinity : b.rb.mass(),
      radius: this.world.radius(b),
      kind: b.kind,
      material: b.material,
      isStatic: b.isStatic,
      ...(b.dummy !== undefined ? { dummy: b.dummy } : {}),
      ...(b.part ? { part: b.part } : {}),
      hp: b.hp,
      maxHp: b.maxHp,
      conductivity: conductivity(m.conductivity, new Set(b.statuses.keys())),
      flammability: m.flammability,
      statuses: [...b.statuses.keys()],
    };
  }

  push(id: number, dv: Vec2): void {
    const b = this.b(id);
    if (b && !this.history.isRewinding(id)) this.world.push(b, dv.x, dv.y);
  }
  impulse(id: number, j: Vec2): void {
    const b = this.b(id);
    if (b && !b.isStatic && !b.statuses.has('stopped')) b.rb.applyImpulse(j, true);
  }
  setVelocity(id: number, v: Vec2): void {
    const b = this.b(id);
    if (b && !b.isStatic && !b.statuses.has('stopped')) b.rb.setLinvel(v, true);
  }
  spin(id: number, w: number): void {
    const b = this.b(id);
    if (b && !b.isStatic && !b.statuses.has('stopped')) b.rb.setAngvel(b.rb.angvel() + w, true);
  }
  damage(id: number, amount: number, cause: string, point?: Vec2): number {
    return this.world.damage(id, amount, cause, point);
  }
  breakJointsOf(id: number): number {
    return this.world.breakJointsOf(id);
  }

  cut(id: number, point: Vec2, dir: Vec2): boolean {
    const b = this.b(id);
    if (!b || b.isStatic) return false;
    if (b.kind === 'part' || b.kind === 'rope') return this.world.breakJointsOf(id) > 0;
    if (b.shape.type !== 'box' || this.world.dynamicCount() >= this.world.maxBodies) return false;
    const s = b.shape;
    // Split along the local long axis at the projected cut point.
    const local = rotate(sub(point, b.cur), -b.cur.a);
    const alongX = s.hw >= s.hh;
    const half = alongX ? s.hw : s.hh;
    const c = Math.max(-half * 0.7, Math.min(half * 0.7, alongX ? local.x : local.y));
    const sizes = [c + half, half - c];
    if (Math.min(...sizes) < 0.06) return false;
    const v = b.rb.linvel();
    const w = b.rb.angvel();
    const pieces: number[] = [];
    sizes.forEach((size, i) => {
      const offset = i === 0 ? -half + size / 2 : half - size / 2;
      const off = rotate(alongX ? { x: offset, y: 0 } : { x: 0, y: offset }, b.cur.a);
      const nb = this.world.createBody({
        kind: 'debris',
        shape: { type: 'box', hw: (alongX ? size / 2 : s.hw) * b.scale, hh: (alongX ? s.hh : size / 2) * b.scale, round: 0.01 },
        material: b.material,
        x: b.cur.x + off.x,
        y: b.cur.y + off.y,
        angle: b.cur.a,
        hp: Math.max(10, b.hp / 2),
        vx: v.x + dir.y * (i ? 1.2 : -1.2),
        vy: v.y - dir.x * (i ? 1.2 : -1.2),
        w,
        lifetime: 40,
      });
      for (const [k, st] of b.statuses) nb.statuses.set(k, { ...st });
      pieces.push(nb.id);
    });
    this.world.removeBody(id);
    return pieces.length > 0;
  }

  spawnObject(kind: string, pos: Vec2): number[] {
    if (this.world.dynamicCount() >= this.world.maxBodies) return [];
    return spawn(this.world, kind as SpawnKind, pos);
  }

  spawnProjectile(o: ProjectileOptions): number {
    if (this.world.dynamicCount() >= this.world.maxBodies + 40) return -1;
    const shape =
      o.shape === 'ball'
        ? ({ type: 'ball', r: o.size } as const)
        : o.shape === 'shard'
          ? ({ type: 'box', hw: o.size * 1.6, hh: o.size * 0.35, round: o.size * 0.2 } as const)
          : ({ type: 'box', hw: o.size, hh: o.size, round: o.size * 0.15 } as const);
    const b = this.world.createBody({
      kind: 'projectile',
      shape,
      material: o.material,
      x: o.pos.x,
      y: o.pos.y,
      angle: o.angle ?? Math.atan2(o.vel.y, o.vel.x),
      vx: o.vel.x,
      vy: o.vel.y,
      ccd: true,
      gravityScale: o.gravityScale ?? 1,
      lifetime: o.lifetime ?? 8,
      hp: o.hp ?? 60,
      ...(o.color !== undefined ? { color: o.color } : {}),
    });
    return b.id;
  }

  remove(id: number): void {
    this.world.removeBody(id);
  }

  private dummyParts(id: number): BodyRec[] {
    const b = this.b(id);
    if (!b) return [];
    if (b.dummy === undefined) return [b];
    const d = this.world.dummies.get(b.dummy);
    return d ? (Object.values(d.parts) as number[]).map((x) => this.b(x)).filter((x): x is BodyRec => !!x) : [b];
  }

  teleport(id: number, pos: Vec2): void {
    const parts = this.dummyParts(id);
    const ref = this.b(id);
    if (!ref) return;
    const dx = pos.x - ref.cur.x;
    const dy = pos.y - ref.cur.y;
    for (const p of parts) {
      const t = { x: p.cur.x + dx, y: p.cur.y + dy };
      p.rb.setTranslation(t, true);
      p.cur.x = p.prev.x = t.x;
      p.cur.y = p.prev.y = t.y;
    }
  }

  rescale(id: number, factor: number): void {
    const b = this.b(id);
    if (!b || b.isStatic) return;
    if (b.dummy === undefined) {
      this.world.rescale(id, factor);
      return;
    }
    const d = this.world.dummies.get(b.dummy);
    if (!d) return;
    const c = dummyCenter(this.world, d);
    if (!c) return;
    const scale = Math.max(0.35, Math.min(3, d.scale * factor));
    const color = d.color;
    const broken = [...d.broken];
    this.world.removeDummy(d.id);
    spawnDummy(this.world, c.x, c.y - 0.97 * scale, { scale, color, broken });
  }

  clone(id: number, offset: Vec2): number[] {
    const b = this.b(id);
    if (!b || b.isStatic || this.world.dynamicCount() >= this.world.maxBodies) return [];
    if (b.dummy !== undefined) {
      const d = this.world.dummies.get(b.dummy);
      const c = d && dummyCenter(this.world, d);
      if (!d || !c) return [];
      const nd = spawnDummy(this.world, c.x + offset.x, c.y + offset.y - 0.97 * d.scale, { scale: d.scale });
      return Object.values(nd.parts) as number[];
    }
    if (['crate', 'ball', 'plank', 'barrel', 'oilbarrel', 'tnt', 'boulder'].includes(b.kind)) {
      const nb = this.world.createBody({ ...objectSpec(b.kind as 'crate', { x: b.cur.x + offset.x, y: b.cur.y + offset.y }), scale: b.scale });
      return [nb.id];
    }
    return [];
  }

  heal(id: number): void {
    const b = this.b(id);
    if (!b) return;
    if (b.dummy === undefined) {
      this.status.clear(b);
      this.world.heal(id);
      return;
    }
    const d = this.world.dummies.get(b.dummy);
    if (!d) return;
    const c = dummyCenter(this.world, d) ?? { x: b.cur.x, y: b.cur.y };
    const { scale, color } = d;
    this.world.removeDummy(d.id);
    spawnDummy(this.world, c.x, c.y - 0.97 * scale + 0.3, { scale, color });
  }

  setGravityScale(id: number, scale: number): void {
    const b = this.b(id);
    if (!b) return;
    if (scale === 1) this.status.gravityChannel.delete(id);
    else this.status.gravityChannel.set(id, scale);
    this.status.updateGravity(b);
  }

  dummies(): DummyInfo[] {
    const out: DummyInfo[] = [];
    for (const d of this.world.dummies.values()) {
      const c = dummyCenter(this.world, d);
      if (c) out.push({ id: d.id, center: c, parts: Object.values(d.parts) as number[] });
    }
    return out;
  }

  allDynamic(): number[] {
    const out: number[] = [];
    for (const b of this.world.bodies.values()) if (!b.isStatic) out.push(b.id);
    return out;
  }

  rewind(center: Vec2, radius: number, seconds: number): number {
    return this.history.rewind(center, radius, seconds);
  }

  view() {
    return this.viewRect;
  }
}
