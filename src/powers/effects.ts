// Reusable effect building blocks shared by power definitions (engine-agnostic).
import { add, dist, dot, fromAngle, norm, scale, sub, type Vec2 } from '../core/math';
import type { StatusId } from '../status/types';
import type { BodyId, PowerCtx, PowerEntity, ProjectileOptions } from './types';

/** Radial velocity push with linear falloff. */
export function radialPush(ctx: PowerCtx, p: Vec2, radius: number, strength: number, opts: { up?: number; exclude?: Set<BodyId> } = {}): BodyId[] {
  const ids = ctx.physics.bodiesIn(p, radius);
  for (const id of ids) {
    if (opts.exclude?.has(id)) continue;
    const b = ctx.physics.info(id);
    if (!b) continue;
    const d = sub(b.pos, p);
    const l = Math.max(0.2, Math.hypot(d.x, d.y));
    const f = strength * (1 - Math.min(1, l / radius) * 0.7) * ctx.mult;
    ctx.physics.push(id, { x: (d.x / l) * f, y: (d.y / l) * f + (opts.up ?? 0) * f });
    ctx.physics.spin(id, (Math.random() - 0.5) * f * 0.6);
  }
  return ids;
}

export function damageArea(ctx: PowerCtx, p: Vec2, radius: number, amount: number, cause: string): number {
  let total = 0;
  for (const id of ctx.physics.bodiesIn(p, radius)) {
    const b = ctx.physics.info(id);
    if (!b) continue;
    const f = 1 - Math.min(1, dist(b.pos, p) / radius) * 0.6;
    total += ctx.physics.damage(id, amount * f * ctx.mult, cause, b.pos);
  }
  ctx.chaos(total);
  return total;
}

export function statusArea(ctx: PowerCtx, p: Vec2, radius: number, s: StatusId, duration?: number, stacks = 1): BodyId[] {
  const ids = ctx.physics.bodiesIn(p, radius);
  for (const id of ids) ctx.status.apply(id, s, duration, stacks);
  return ids;
}

export function explode(ctx: PowerCtx, p: Vec2, radius: number, power = 1, opts: { color?: number; fire?: boolean; big?: boolean } = {}): void {
  const color = opts.color ?? 0xff8a2a;
  radialPush(ctx, p, radius, 14 * power, { up: 0.35 });
  damageArea(ctx, p, radius, 55 * power, 'explosion');
  if (opts.fire !== false) statusArea(ctx, p, radius * 0.7, 'burning', 4);
  ctx.fx.burst('flame', p, { count: Math.round(24 * power), color, speed: 7 * Math.sqrt(power), size: 1.4 });
  ctx.fx.burst('spark', p, { count: Math.round(30 * power), color: 0xffd27a, speed: 14 });
  ctx.fx.burst('smoke', p, { count: Math.round(10 * power), speed: 3 });
  ctx.fx.ring(p, { color, radius: radius * 1.3, life: 0.45, width: 0.2 });
  ctx.fx.light(p, { color, radius: radius * 2.2, life: 0.35, intensity: 1 });
  ctx.fx.shake(0.35 * power);
  ctx.fx.flash(color, 0.18 * power);
  ctx.fx.bloomSpike(0.8 * power);
  ctx.fx.chroma(0.6 * power);
  ctx.fx.hitStop(40 * Math.min(2, power));
  ctx.audio.play(opts.big ? 'bigExplosion' : 'explosion', { pos: p, volume: Math.min(1, 0.6 + power * 0.3) });
}

/** Bodies inside a cone (origin, direction, range, half-angle). */
export function cone(ctx: PowerCtx, origin: Vec2, dir: Vec2, range: number, halfAngle: number): BodyId[] {
  const out: BodyId[] = [];
  const cosA = Math.cos(halfAngle);
  for (const id of ctx.physics.bodiesIn(add(origin, scale(dir, range / 2)), range / 2 + 0.3)) {
    const b = ctx.physics.info(id);
    if (!b) continue;
    const d = sub(b.pos, origin);
    const l = Math.hypot(d.x, d.y);
    if (l > range + b.radius) continue;
    if (l < 0.3 || dot(d, dir) / l > cosA) out.push(id);
  }
  return out;
}

/** Bodies hit by a thick beam: three parallel segment casts. Stops at static geometry. */
export function beamHits(ctx: PowerCtx, a: Vec2, dir: Vec2, length: number, width: number): { ids: BodyId[]; end: Vec2 } {
  const wall = ctx.physics.raycast(a, dir, length, true);
  let end = add(a, scale(dir, length));
  if (wall?.isStatic) end = wall.point;
  const n = { x: -dir.y, y: dir.x };
  const ids = new Set<BodyId>();
  for (const o of [-width / 2, 0, width / 2]) {
    for (const h of ctx.physics.bodiesOnSegment(add(a, scale(n, o)), add(end, scale(n, o)))) ids.add(h.id);
  }
  return { ids: [...ids], end };
}

export function nearestBody(ctx: PowerCtx, p: Vec2, r: number, skip: Set<BodyId> = new Set(), filter?: (id: BodyId) => boolean): BodyId | null {
  let best: BodyId | null = null;
  let bd = Infinity;
  for (const id of ctx.physics.bodiesIn(p, r)) {
    if (skip.has(id) || (filter && !filter(id))) continue;
    const b = ctx.physics.info(id);
    if (!b) continue;
    const d = dist(b.pos, p);
    if (d < bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

/** One body per dummy (prefers the torso), plus loose bodies. Used for chain targets. */
export function chainLightning(ctx: PowerCtx, from: Vec2, first: BodyId | null, jumps: number, range: number, dmg: number, color: number): void {
  const hit = new Set<number>();
  const hitDummies = new Set<number>();
  let cur = from;
  let target = first ?? nearestBody(ctx, from, range);
  let n = 0;
  while (target !== null && n < jumps) {
    const info = ctx.physics.info(target);
    if (!info) break;
    hit.add(target);
    if (info.dummy !== undefined) hitDummies.add(info.dummy);
    ctx.fx.bolt(cur, info.pos, { color, width: 1.2, branches: 3, life: 0.22 });
    ctx.fx.burst('spark', info.pos, { count: 10, color, speed: 9 });
    const soaked = info.statuses.includes('soaked');
    ctx.physics.damage(target, dmg * (soaked ? 1.8 : 1) * ctx.mult, 'lightning', info.pos);
    ctx.status.apply(target, 'shocked', 1.6, soaked ? 3 : 2);
    ctx.physics.push(target, { x: (Math.random() - 0.5) * 3, y: 2 });
    ctx.chaos(dmg);
    cur = info.pos;
    // Soaked or conductive bodies let the arc jump further.
    const reach = range * (soaked ? 1.8 : 1) * (0.6 + info.conductivity * 0.6);
    target = nearestBody(ctx, cur, reach, hit, (id) => {
      const i = ctx.physics.info(id);
      return !!i && (i.dummy === undefined || !hitDummies.has(i.dummy)) && (i.conductivity > 0.15 || i.statuses.includes('soaked'));
    });
    n++;
  }
  ctx.audio.play('zap', { pos: from });
  ctx.fx.flash(color, 0.08);
  ctx.fx.bloomSpike(0.5);
}

export interface ProjectileHooks {
  /** Return true to destroy the projectile. */
  onHit(ctx: PowerCtx, at: Vec2, hit: BodyId | null): boolean;
  trail?(ctx: PowerCtx, p: Vec2, dt: number): void;
  lifetime?: number;
  /** Collision radius used for hit detection. */
  radius?: number;
}

/** Physical projectile with hit detection via proximity queries (engine-agnostic). */
export function projectile(ctx: PowerCtx, opts: ProjectileOptions, hooks: ProjectileHooks): void {
  const id = ctx.physics.spawnProjectile(opts);
  if (id < 0) return;
  let life = hooks.lifetime ?? 6;
  let armed = 0.06;
  const r = hooks.radius ?? opts.size + 0.12;
  const e: PowerEntity = {
    update(c, dt) {
      const b = c.physics.info(id);
      if (!b) return false;
      life -= dt;
      armed -= dt;
      hooks.trail?.(c, b.pos, dt);
      if (life <= 0) {
        hooks.onHit(c, b.pos, null);
        c.physics.remove(id);
        return false;
      }
      if (armed > 0) return true;
      const near = c.physics.bodiesIn(b.pos, r).filter((x) => x !== id);
      const wall = c.physics.raycast(b.pos, norm(b.vel.x || b.vel.y ? b.vel : { x: 0, y: -1 }), r + 0.05, true);
      if (near.length || wall) {
        if (hooks.onHit(c, b.pos, near[0] ?? wall?.id ?? null)) {
          c.physics.remove(id);
          return false;
        }
      }
      return true;
    },
  };
  ctx.spawn(e);
}

/** Random point on a circle. */
export const around = (p: Vec2, r: number): Vec2 => add(p, fromAngle(Math.random() * Math.PI * 2, Math.random() * r));

/** Simple timed entity helper. */
export function timed(seconds: number, tick: (ctx: PowerCtx, dt: number, t: number) => void, dispose?: (ctx: PowerCtx) => void, tag?: string): PowerEntity {
  let t = 0;
  return {
    ...(tag ? { tag } : {}),
    update(ctx, dt) {
      t += dt;
      tick(ctx, dt, t);
      return t < seconds;
    },
    ...(dispose ? { dispose } : {}),
  };
}
