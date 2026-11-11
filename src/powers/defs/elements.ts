// Classic elements: Fire, Lightning, Ice, Wind, Earth, Water.
import { add, dist, fromAngle, norm, perp, rotate, scale, sub, type Vec2 } from '../../core/math';
import { around, beamHits, chainLightning, cone, damageArea, explode, nearestBody, projectile, radialPush, statusArea, timed } from '../effects';
import type { Power, PowerCtx, PowerEntity } from '../types';

const groundBelow = (ctx: PowerCtx, p: Vec2): Vec2 => {
  const h = ctx.physics.raycast({ x: p.x, y: p.y + 0.5 }, { x: 0, y: -1 }, 60, true);
  return h ? h.point : { x: p.x, y: p.y - 2 };
};
const skyAbove = (ctx: PowerCtx, x: number): Vec2 => {
  const v = ctx.physics.view();
  return { x: x + (Math.random() - 0.5) * 2, y: v.y + v.h / 2 + 2 };
};

// ============================================================== FIRE
export const fire: Power = {
  id: 'fire',
  name: 'Fire',
  category: 'Elements',
  icon: 'icon/flame',
  description: 'Burn, blast and engulf. Burning spreads to anything flammable it touches.',
  palette: { primary: 0xff7a1a, secondary: 0xffd23a, core: 0xfff2c0 },
  subs: [
    {
      id: 'fire.flamethrower', name: 'Flamethrower', description: 'Press, then drag toward the target to aim a stream of fire.', input: 'hold', cooldown: 0, cost: 2, holdCost: 18,
      params: { range: { default: 5, min: 2, max: 10 }, damage: { default: 30, min: 0, max: 120, label: 'damage/s' } },
      onHold(ctx, i, dt) {
        const range = ctx.params.range!;
        const damage = ctx.params.damage!;
        ctx.fx.burst('flame', i.origin, { count: 4, dir: i.dir, spread: 0.35, speed: range * 2.2, size: 0.9, life: 0.7, gravity: 1 });
        if (Math.random() < 0.4) ctx.fx.burst('ember', i.origin, { count: 2, dir: i.dir, spread: 0.5, speed: range * 2 });
        ctx.fx.light(add(i.origin, scale(i.dir, range * 0.5)), { color: 0xff7a1a, radius: range * 0.6, life: dt * 2, intensity: 0.35 });
        for (const id of cone(ctx, i.origin, i.dir, range, 0.32)) {
          ctx.physics.damage(id, damage * dt * ctx.mult, 'fire');
          ctx.physics.push(id, scale(i.dir, 6 * dt));
          if (Math.random() < dt * 6) ctx.status.apply(id, 'burning', 4);
        }
        ctx.chaos(damage * dt);
        ctx.audio.loop('flamethrower', 'fire', { volume: 0.8 });
      },
      onRelease(ctx) {
        ctx.audio.loop('flamethrower', null);
      },
    },
    {
      id: 'fire.fireball', name: 'Fireball', description: 'Drag to aim and set power. Arcs and explodes on impact.', input: 'drag-aim', cooldown: 0.5, cost: 12,
      params: { radius: { default: 2.4, min: 1, max: 6 }, power: { default: 1, min: 0.3, max: 3 } },
      onCast(ctx, i) {
        const speed = 9 + Math.min(14, i.dist * 2.5);
        ctx.audio.play('fireball', { pos: i.origin });
        projectile(ctx, { shape: 'ball', size: 0.2, pos: i.origin, vel: scale(i.dir, speed), material: 'energy', gravityScale: 0.6, color: 0xff7a1a, lifetime: 5 }, {
          trail(c, p) {
            c.fx.burst('flame', p, { count: 2, size: 0.6, speed: 1 });
            c.fx.light(p, { color: 0xff8a2a, radius: 1.5, life: 0.05, intensity: 0.6 });
          },
          onHit(c, p) {
            explode(c, p, c.params.radius!, c.params.power!);
            return true;
          },
        });
      },
    },
    {
      id: 'fire.pillar', name: 'Fire pillar', description: 'A column of fire erupts from the ground.', input: 'click', cooldown: 1, cost: 18,
      params: { height: { default: 6, min: 2, max: 12 }, duration: { default: 2, min: 0.5, max: 6 } },
      onCast(ctx, i) {
        const g = groundBelow(ctx, i.pos);
        const h = ctx.params.height!;
        ctx.audio.play('fire', { pos: g, volume: 1 });
        ctx.audio.play('fireball', { pos: g, pitch: 0.6 });
        ctx.fx.shake(0.15);
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          for (let k = 0; k < 3; k++) c.fx.burst('flame', { x: g.x + (Math.random() - 0.5) * 0.8, y: g.y + Math.random() * h * 0.3 }, { count: 1, dir: { x: 0, y: 1 }, spread: 0.2, speed: h * 2, size: 1.3, life: 0.8, gravity: 2 });
          c.fx.light({ x: g.x, y: g.y + h / 2 }, { color: 0xff7a1a, radius: h * 0.6, life: dt * 2, intensity: 0.5 });
          for (const id of c.physics.bodiesInBox({ x: g.x, y: g.y + h / 2 }, 0.6, h / 2, 0)) {
            c.physics.push(id, { x: (Math.random() - 0.5) * 0.5, y: 22 * dt });
            c.physics.damage(id, 40 * dt * c.mult, 'fire');
            c.status.apply(id, 'burning', 5);
          }
        }));
      },
    },
    {
      id: 'fire.ignite', name: 'Ignite', description: 'Set whatever you touch on fire.', input: 'click', cooldown: 0.1, cost: 4,
      params: { radius: { default: 0.7, min: 0.2, max: 3 } },
      onCast(ctx, i) {
        ctx.fx.burst('flame', i.pos, { count: 8, size: 0.6 });
        ctx.fx.burst('ember', i.pos, { count: 6 });
        statusArea(ctx, i.pos, ctx.params.radius!, 'burning', 6, 2);
        ctx.audio.play('fire', { pos: i.pos, volume: 0.6 });
      },
    },
    {
      id: 'fire.meteors', name: 'Meteor shower', description: 'Drag out an area. Meteors rain down on it.', input: 'area-select', cooldown: 4, cost: 35,
      params: { count: { default: 12, min: 3, max: 40, step: 1 }, power: { default: 0.8, min: 0.2, max: 2 } },
      onCast(ctx, i) {
        const area = i.area!;
        let spawned = 0;
        const total = ctx.params.count!;
        ctx.spawn(timed(3, (c, _dt, t) => {
          while (spawned < total && spawned < (t / 2.5) * total) {
            spawned++;
            const target = around(area.center, area.radius);
            const from = { x: target.x - 6 + Math.random() * 3, y: c.physics.view().y + c.physics.view().h / 2 + 3 };
            const vel = scale(norm(sub(target, from)), 22);
            projectile(c, { shape: 'ball', size: 0.25, pos: from, vel, material: 'stone', gravityScale: 0.2, color: 0xff5a1a, lifetime: 4 }, {
              trail(cc, p) {
                cc.fx.burst('flame', p, { count: 2, size: 0.8, speed: 0.5 });
                cc.fx.burst('smoke', p, { count: 1, speed: 0.3, size: 0.6 });
              },
              onHit(cc, p) {
                explode(cc, p, 1.8, cc.params.power!);
                return true;
              },
            });
          }
        }));
      },
    },
    {
      id: 'fire.tornado', name: 'Fire tornado', description: 'A burning vortex that hunts the nearest dummy.', input: 'click', cooldown: 6, cost: 40,
      params: { duration: { default: 7, min: 2, max: 15 }, radius: { default: 2.2, min: 1, max: 5 } },
      onCast(ctx, i) {
        let pos = groundBelow(ctx, i.pos);
        let ang = 0;
        ctx.audio.play('wind', { pos, volume: 1, pitch: 0.7 });
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          const r = c.params.radius!;
          const target = c.physics.dummies().sort((a, b) => dist(a.center, pos) - dist(b.center, pos))[0];
          if (target) pos = { x: pos.x + Math.sign(target.center.x - pos.x) * 2.2 * dt, y: pos.y };
          ang += dt * 9;
          for (let k = 0; k < 4; k++) {
            const h = Math.random() * 6;
            const w = 0.4 + h * 0.3;
            c.fx.burst('flame', { x: pos.x + Math.cos(ang + k * 1.6 + h) * w, y: pos.y + h }, { count: 1, dir: { x: 0, y: 1 }, speed: 4, size: 0.9, life: 0.6 });
          }
          c.fx.light({ x: pos.x, y: pos.y + 3 }, { color: 0xff6a1a, radius: 4, life: dt * 2, intensity: 0.5 });
          for (const id of c.physics.bodiesInBox({ x: pos.x, y: pos.y + 3 }, r, 3.5, 0)) {
            const b = c.physics.info(id);
            if (!b) continue;
            const dx = pos.x - b.pos.x;
            c.physics.push(id, { x: dx * 8 * dt + Math.sign(dx || 1) * 4 * dt, y: 16 * dt });
            c.physics.spin(id, 10 * dt);
            c.physics.damage(id, 22 * dt * c.mult, 'fire');
            if (Math.random() < dt * 4) c.status.apply(id, 'burning', 4);
          }
          c.audio.loop('firetornado', 'wind', { volume: 0.8 });
        }, (c) => c.audio.loop('firetornado', null)));
      },
    },
  ],
};

// ============================================================== LIGHTNING
const BOLT = 0x9fd8ff;

function stormCloud(ctx: PowerCtx, x: number, tag: string): PowerEntity {
  let cx = x;
  let t = 0;
  let next = 0.6;
  return {
    tag,
    update(c, dt) {
      t += dt;
      const v = c.physics.view();
      const cy = v.y + v.h / 2 - 1.2;
      const target = c.physics.dummies().sort((a, b) => Math.abs(a.center.x - cx) - Math.abs(b.center.x - cx))[0];
      if (target) cx += Math.sign(target.center.x - cx) * Math.min(1, Math.abs(target.center.x - cx)) * 1.5 * dt;
      // Cloud body + rain (soaks everything below: sets up the water + lightning synergy).
      for (let k = 0; k < 2; k++) c.fx.burst('smoke', { x: cx + (Math.random() - 0.5) * 6, y: cy + Math.random() * 0.8 }, { count: 1, color: 0x272d3a, speed: 0.3, size: 1.6, life: 1.4, gravity: 0 });
      c.fx.burst('drop', { x: cx + (Math.random() - 0.5) * 6, y: cy - 0.3 }, { count: 3, dir: { x: 0.1, y: -1 }, spread: 0.1, speed: 14, size: 0.9, life: 0.9 });
      for (const id of c.physics.bodiesInBox({ x: cx, y: cy - 8 }, 3, 8, 0)) if (Math.random() < dt * 0.8) c.status.apply(id, 'soaked', 8);
      // Inner flicker
      if (Math.random() < dt * 3) c.fx.light({ x: cx + (Math.random() - 0.5) * 5, y: cy + 0.3 }, { color: 0xcfe8ff, radius: 3, life: 0.08, intensity: 0.8 });
      next -= dt;
      if (next <= 0) {
        next = 0.8 + Math.random() * 1.2;
        const tx = cx + (Math.random() - 0.5) * 5;
        const ground = groundBelow(c, { x: tx, y: cy - 0.5 });
        const hit = c.physics.raycast({ x: tx, y: cy - 0.5 }, { x: 0, y: -1 }, cy - ground.y + 1, true);
        const end = hit?.point ?? ground;
        c.fx.bolt({ x: tx, y: cy }, end, { color: BOLT, width: 1.8, branches: 5, life: 0.3 });
        c.fx.flash(0xcfe8ff, 0.18);
        c.fx.bloomSpike(0.7);
        c.audio.play('thunder', { pos: end, volume: 0.8 });
        if (hit && !hit.isStatic) chainLightning(c, end, hit.id, 4, 3.5, 30, BOLT);
        else c.fx.burst('spark', end, { count: 14, color: BOLT, speed: 8 });
      }
      c.audio.loop(tag, 'thunder', { volume: 0.7 });
      return t < 25;
    },
    dispose(c) {
      c.audio.loop(tag, null);
    },
  };
}

export const lightning: Power = {
  id: 'lightning',
  name: 'Lightning',
  category: 'Elements',
  icon: 'icon/lightning-branches',
  description: 'Branching arcs, sky strikes and storms. Wet targets conduct further and harder.',
  palette: { primary: BOLT, secondary: 0xffffff, core: 0xffffff },
  subs: [
    {
      id: 'lightning.chain', name: 'Chain lightning', description: 'Arcs jump from body to body. Soaked and metal targets extend the chain.', input: 'click', cooldown: 0.35, cost: 10,
      params: { jumps: { default: 7, min: 1, max: 20, step: 1 }, range: { default: 4, min: 1, max: 10 }, damage: { default: 22, min: 0, max: 100 } },
      onCast(ctx, i) {
        const first = nearestBody(ctx, i.pos, 2.5);
        chainLightning(ctx, i.pos, first, ctx.params.jumps!, ctx.params.range!, ctx.params.damage!, BOLT);
        ctx.fx.chroma(0.25);
      },
    },
    {
      id: 'lightning.strike', name: 'Bolt strike', description: 'A bolt from the sky. Thunder arrives later the further away it lands.', input: 'click', cooldown: 0.8, cost: 18,
      params: { damage: { default: 70, min: 0, max: 300 }, radius: { default: 2.2, min: 0.5, max: 6 } },
      onCast(ctx, i) {
        const top = skyAbove(ctx, i.pos.x);
        const hit = ctx.physics.raycast(top, { x: 0, y: -1 }, top.y - i.pos.y + 30, true);
        const end = hit?.point ?? groundBelow(ctx, i.pos);
        // Thin leader first, then the main return stroke.
        ctx.fx.bolt(top, end, { color: BOLT, width: 1, branches: 7, life: 0.08 });
        ctx.fx.bolt(top, end, { color: BOLT, width: 2.6, branches: 6, life: 0.4, flicker: 0.06 });
        ctx.fx.light(end, { color: 0xdff2ff, radius: 7, life: 0.4, intensity: 1 });
        ctx.fx.flash(0xe6f4ff, 0.45);
        ctx.fx.bloomSpike(1.4);
        ctx.fx.chroma(0.8);
        ctx.fx.shake(0.35);
        ctx.fx.hitStop(60);
        ctx.fx.ring(end, { color: BOLT, radius: ctx.params.radius! * 1.3, life: 0.35 });
        ctx.fx.burst('spark', end, { count: 40, color: 0xdff2ff, speed: 14 });
        ctx.fx.burst('smoke', end, { count: 6 });
        ctx.audio.play('zap', { pos: end, pitch: 0.6, volume: 1 });
        ctx.audio.play('thunder', { pos: end });
        radialPush(ctx, end, ctx.params.radius!, 10, { up: 0.5 });
        for (const id of ctx.physics.bodiesIn(end, ctx.params.radius!)) {
          const b = ctx.physics.info(id);
          ctx.physics.damage(id, ctx.params.damage! * ctx.mult * (b?.statuses.includes('soaked') ? 1.6 : 1), 'lightning', end);
          ctx.status.apply(id, 'shocked', 2, 3);
          if (Math.random() < 0.3) ctx.status.apply(id, 'burning', 3);
        }
        ctx.chaos(ctx.params.damage!);
        // Ground-current: soaked bodies nearby get arced too.
        for (const id of ctx.physics.bodiesIn(end, 7)) {
          const b = ctx.physics.info(id);
          if (b?.statuses.includes('soaked') && dist(b.pos, end) > ctx.params.radius!) {
            ctx.fx.bolt(end, b.pos, { color: BOLT, width: 0.8, branches: 1, life: 0.2 });
            ctx.status.apply(id, 'shocked', 1.5, 3);
            ctx.physics.damage(id, 25 * ctx.mult, 'lightning');
          }
        }
      },
    },
    {
      id: 'lightning.orb', name: 'Tesla orb', description: 'Toggle: a floating sphere that arcs to anything nearby. Tap again to dismiss.', input: 'toggle', cooldown: 0.5, cost: 25,
      params: { range: { default: 4.5, min: 1, max: 10 }, rate: { default: 7, min: 1, max: 20, label: 'arcs/s' } },
      onCast(ctx, i) {
        let pos = { ...i.pos };
        let t = 0;
        let acc = 0;
        ctx.audio.play('magic', { pos });
        ctx.spawn({
          tag: 'lightning.orb',
          update(c, dt) {
            t += dt;
            acc += dt;
            pos = add(pos, { x: Math.sin(t * 0.9) * 0.3 * dt, y: Math.cos(t * 1.3) * 0.3 * dt });
            c.fx.light(pos, { color: BOLT, radius: 1.6 + Math.sin(t * 20) * 0.2, life: dt * 1.5, intensity: 0.9 });
            c.fx.ring(pos, { color: 0xdff2ff, radius: 0.45, life: dt * 1.5, grow: false, width: 0.06 });
            // Surface crawl
            if (Math.random() < 0.6) c.fx.bolt(add(pos, fromAngle(Math.random() * 6.3, 0.4)), add(pos, fromAngle(Math.random() * 6.3, 0.4)), { color: BOLT, width: 0.3, branches: 0, life: 0.05 });
            const interval = 1 / c.params.rate!;
            while (acc > interval) {
              acc -= interval;
              const near = c.physics.bodiesIn(pos, c.params.range!);
              const id = near[Math.floor(Math.random() * near.length)];
              if (id !== undefined) {
                const b = c.physics.info(id);
                if (!b) continue;
                c.fx.bolt(pos, b.pos, { color: BOLT, width: 0.9, branches: 2, life: 0.12 });
                c.physics.damage(id, 7 * c.mult, 'lightning', b.pos);
                c.status.apply(id, 'shocked', 1, 1);
                c.physics.push(id, scale(norm(sub(b.pos, pos)), 1.5));
                c.chaos(7);
                if (Math.random() < 0.3) c.audio.play('zap', { pos, volume: 0.5 });
              } else if (Math.random() < 0.5) {
                const tip = add(pos, fromAngle(Math.random() * 6.3, c.params.range! * 0.6));
                c.fx.bolt(pos, tip, { color: BOLT, width: 0.5, branches: 1, life: 0.07 });
              }
            }
            c.audio.loop('tesla', 'saw', { volume: 0.25 });
            return t < 20;
          },
          dispose(c) {
            c.audio.loop('tesla', null);
            c.fx.burst('spark', pos, { count: 20, color: BOLT });
          },
        });
      },
    },
    {
      id: 'lightning.storm', name: 'Storm cloud', description: 'Toggle: a cloud that rains (soaking targets) and drops bolts while following the dummies.', input: 'toggle', cooldown: 1, cost: 40,
      params: {},
      onCast(ctx, i) {
        ctx.spawn(stormCloud(ctx, i.pos.x, 'lightning.storm'));
        ctx.audio.play('thunder', { volume: 0.5 });
      },
    },
    {
      id: 'lightning.whip', name: 'Lightning whip', description: 'Drag to lash a crackling whip along a line.', input: 'drag-aim', cooldown: 0.4, cost: 12,
      params: { length: { default: 7, min: 2, max: 14 }, damage: { default: 28, min: 0, max: 120 } },
      onCast(ctx, i) {
        const len = Math.min(ctx.params.length!, Math.max(3, i.dist * 1.4));
        const end = add(i.origin, scale(i.dir, len));
        const mid = add(add(i.origin, scale(i.dir, len * 0.5)), scale(perp(i.dir), len * 0.18));
        let t = 0;
        ctx.audio.play('slash', { pos: i.origin, pitch: 1.4 });
        ctx.audio.play('zap', { pos: end });
        const hit = new Set<number>();
        ctx.spawn(timed(0.22, (c, dt) => {
          t += dt;
          const k = Math.min(1, t / 0.12);
          const tip = add(mid, scale(sub(end, mid), k));
          c.fx.bolt(i.origin, mid, { color: BOLT, width: 1.1, branches: 1, life: 0.06, jitter: 0.12 });
          c.fx.bolt(mid, tip, { color: BOLT, width: 1.1, branches: 2, life: 0.06, jitter: 0.12 });
          for (const seg of [[i.origin, mid], [mid, tip]] as const) {
            for (const h of c.physics.bodiesOnSegment(seg[0], seg[1])) {
              if (hit.has(h.id)) continue;
              hit.add(h.id);
              c.physics.damage(h.id, c.params.damage! * c.mult, 'lightning', h.point);
              c.physics.push(h.id, add(scale(i.dir, 9), { x: 0, y: 4 }));
              c.status.apply(h.id, 'shocked', 1.4, 2);
              c.fx.burst('spark', h.point, { count: 10, color: BOLT });
              c.fx.hitStop(15);
              c.chaos(c.params.damage!);
            }
          }
        }));
        ctx.fx.chroma(0.3);
      },
    },
    {
      id: 'lightning.emp', name: 'EMP pulse', description: 'An expanding pulse that shocks everything conductive and repels metal.', input: 'click', cooldown: 3, cost: 30,
      params: { radius: { default: 7, min: 2, max: 15 } },
      onCast(ctx, i) {
        const R = ctx.params.radius!;
        const done = new Set<number>();
        ctx.audio.play('emp', { pos: i.pos });
        ctx.fx.flash(0xbfe6ff, 0.3);
        ctx.fx.chroma(1);
        ctx.fx.ring(i.pos, { color: BOLT, radius: R, life: 0.6, width: 0.3 });
        ctx.fx.ring(i.pos, { color: 0xffffff, radius: R * 0.8, life: 0.45, width: 0.12 });
        ctx.spawn(timed(0.6, (c, _dt, t) => {
          const r = R * Math.min(1, t / 0.5);
          for (const id of c.physics.bodiesIn(i.pos, r)) {
            if (done.has(id)) continue;
            done.add(id);
            const b = c.physics.info(id);
            if (!b) continue;
            if (b.conductivity > 0.3) {
              c.status.apply(id, 'shocked', 2, b.conductivity > 0.8 ? 3 : 1);
              c.physics.damage(id, 15 * b.conductivity * c.mult, 'emp');
              if (Math.random() < 0.5) c.fx.bolt(b.pos, add(b.pos, fromAngle(Math.random() * 6.3, 0.8)), { color: BOLT, width: 0.5, branches: 0, life: 0.1 });
            }
            if (b.material === 'metal') c.physics.push(id, scale(norm(sub(b.pos, i.pos)), 10));
          }
        }));
      },
    },
  ],
};

// ============================================================== ICE
export const ice: Power = {
  id: 'ice',
  name: 'Ice',
  category: 'Elements',
  icon: 'icon/ice-bolt',
  description: 'Freeze, impale and shatter. Frozen parts break on hard impacts.',
  palette: { primary: 0x9ff4ff, secondary: 0xe6fbff, core: 0xffffff },
  subs: [
    {
      id: 'ice.shards', name: 'Ice shards', description: 'Drag to fire a fan of ice shards.', input: 'drag-aim', cooldown: 0.35, cost: 8,
      params: { count: { default: 5, min: 1, max: 15, step: 1 }, speed: { default: 22, min: 5, max: 40 } },
      onCast(ctx, i) {
        const n = ctx.params.count!;
        ctx.audio.play('freeze', { pos: i.origin, pitch: 1.6 });
        for (let k = 0; k < n; k++) {
          const a = (k - (n - 1) / 2) * 0.08;
          const d = rotate(i.dir, a);
          projectile(ctx, { shape: 'shard', size: 0.1, pos: add(i.origin, scale(d, 0.3)), vel: scale(d, ctx.params.speed!), material: 'ice', gravityScale: 0.25, lifetime: 3, hp: 10 }, {
            radius: 0.22,
            trail(c, p) {
              if (Math.random() < 0.5) c.fx.burst('snow', p, { count: 1, speed: 0.3 });
            },
            onHit(c, p, hit) {
              c.fx.burst('shard', p, { count: 5 });
              if (hit !== null) {
                c.physics.damage(hit, 18 * c.mult, 'ice', p);
                c.physics.push(hit, scale(d, 4));
                if (Math.random() < 0.45) c.status.apply(hit, 'frozen', 3);
                c.audio.play('shatter', { pos: p, volume: 0.4, pitch: 1.5 });
                c.chaos(18);
              }
              return true;
            },
          });
        }
      },
    },
    {
      id: 'ice.ray', name: 'Freeze ray', description: 'Press and drag to aim a beam that freezes solid.', input: 'hold', cooldown: 0, cost: 2, holdCost: 16,
      params: { length: { default: 10, min: 2, max: 20 } },
      onHold(ctx, i, dt) {
        const { ids, end } = beamHits(ctx, i.origin, i.dir, ctx.params.length!, 0.3);
        ctx.fx.beam(i.origin, end, { color: 0x9ff4ff, width: 0.22, life: dt * 1.6 });
        ctx.fx.light(end, { color: 0x9ff4ff, radius: 1.5, life: dt * 2 });
        if (Math.random() < 0.6) ctx.fx.burst('snow', end, { count: 3, speed: 3 });
        for (const id of ids) {
          if (Math.random() < dt * 5) ctx.status.apply(id, 'frozen', 4);
          ctx.physics.damage(id, 6 * dt, 'ice');
        }
        ctx.audio.loop('freezeray', 'wind', { volume: 0.4 });
      },
      onRelease(ctx) {
        ctx.audio.loop('freezeray', null);
      },
    },
    {
      id: 'ice.wall', name: 'Ice wall', description: 'Drag a line to raise a wall of ice blocks (melts after a while).', input: 'drag-aim', cooldown: 1.5, cost: 20,
      params: { lifetime: { default: 14, min: 3, max: 40 } },
      onCast(ctx, i) {
        const g = groundBelow(ctx, i.origin);
        const width = Math.max(0.5, Math.min(6, Math.abs(i.pos.x - i.origin.x)));
        const height = Math.max(1, Math.min(5, i.pos.y - g.y));
        const cols = Math.max(1, Math.round(width / 0.5));
        const rows = Math.max(1, Math.round(height / 0.5));
        const x0 = Math.min(i.origin.x, i.pos.x);
        ctx.audio.play('freeze', { pos: g, pitch: 0.8 });
        for (let cIdx = 0; cIdx < cols; cIdx++)
          for (let r = 0; r < rows; r++) {
            const p = { x: x0 + cIdx * 0.5 + 0.25, y: g.y + r * 0.5 + 0.26 };
            ctx.physics.spawnProjectile({ shape: 'box', size: 0.24, pos: p, vel: { x: 0, y: 0 }, material: 'ice', lifetime: ctx.params.lifetime!, hp: 70, angle: 0 });
            ctx.fx.burst('snow', p, { count: 2 });
          }
      },
    },
    {
      id: 'ice.blizzard', name: 'Blizzard', description: 'Drag out an area: a howling blizzard slows and freezes everything inside.', input: 'area-select', cooldown: 4, cost: 35,
      params: { duration: { default: 6, min: 2, max: 15 } },
      onCast(ctx, i) {
        const a = i.area!;
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          c.fx.burst('snow', { x: a.center.x - a.radius, y: a.center.y + (Math.random() - 0.3) * a.radius }, { count: 6, dir: { x: 1, y: -0.3 }, spread: 0.3, speed: 12, life: 1.2 });
          c.fx.zone(a.center, a.radius, { color: 0x9ff4ff, life: dt * 1.5, alpha: 0.05 });
          for (const id of c.physics.bodiesIn(a.center, a.radius)) {
            c.physics.push(id, { x: 6 * dt, y: 0 });
            c.status.apply(id, 'slowed', 1);
            if (Math.random() < dt * 0.6) c.status.apply(id, 'frozen', 4);
            c.physics.damage(id, 3 * dt, 'ice');
          }
          c.audio.loop('blizzard', 'wind', { volume: 0.9 });
        }, (c) => c.audio.loop('blizzard', null)));
      },
    },
    {
      id: 'ice.shatter', name: 'Shatter', description: 'Shatter every frozen part nearby (huge damage, parts break off).', input: 'click', cooldown: 1, cost: 15,
      params: { radius: { default: 3, min: 0.5, max: 10 } },
      onCast(ctx, i) {
        let n = 0;
        for (const id of ctx.physics.bodiesIn(i.pos, ctx.params.radius!)) {
          if (!ctx.status.has(id, 'frozen')) continue;
          const b = ctx.physics.info(id)!;
          n++;
          ctx.physics.damage(id, 90 * ctx.mult, 'shatter', b.pos);
          ctx.physics.breakJointsOf(id);
          ctx.status.remove(id, 'frozen');
          ctx.physics.push(id, scale(norm(sub(b.pos, i.pos)), 6));
          ctx.fx.burst('shard', b.pos, { count: 16, speed: 7 });
          ctx.chaos(90);
        }
        ctx.fx.ring(i.pos, { color: 0xe6fbff, radius: ctx.params.radius!, life: 0.3 });
        if (n) {
          ctx.audio.play('shatter', { pos: i.pos });
          ctx.fx.hitStop(70);
          ctx.fx.shake(0.25);
          ctx.fx.flash(0xe6fbff, 0.2);
        } else ctx.audio.play('freeze', { pos: i.pos, pitch: 2, volume: 0.4 });
      },
    },
  ],
};

// ============================================================== WIND
function spreadFireDownwind(ctx: PowerCtx, ids: number[], dir: Vec2): void {
  const burning = ids.filter((id) => ctx.status.has(id, 'burning'));
  for (const src of burning) {
    const b = ctx.physics.info(src);
    if (!b) continue;
    ctx.fx.burst('flame', b.pos, { count: 4, dir, spread: 0.4, speed: 8 });
    for (const id of ctx.physics.bodiesIn(add(b.pos, scale(dir, 1.5)), 1.6)) if (id !== src) ctx.status.apply(id, 'burning', 4);
  }
}

export const wind: Power = {
  id: 'wind',
  name: 'Wind',
  category: 'Elements',
  icon: 'icon/whirlwind',
  description: 'Gusts, cyclones and cutting air. Wind fans flames onto everything downwind.',
  palette: { primary: 0xc9f0ff, secondary: 0xffffff, core: 0xffffff },
  subs: [
    {
      id: 'wind.gust', name: 'Gust', description: 'Drag to blast a cone of wind (spreads fire).', input: 'drag-aim', cooldown: 0.3, cost: 8,
      params: { strength: { default: 14, min: 2, max: 40 }, range: { default: 9, min: 2, max: 20 } },
      onCast(ctx, i) {
        const ids = cone(ctx, i.origin, i.dir, ctx.params.range!, 0.45);
        for (const id of ids) {
          const b = ctx.physics.info(id)!;
          const f = 1 - Math.min(1, dist(b.pos, i.origin) / ctx.params.range!) * 0.6;
          ctx.physics.push(id, add(scale(i.dir, ctx.params.strength! * f * ctx.mult), { x: 0, y: 2 * f }));
          ctx.physics.spin(id, (Math.random() - 0.5) * 6);
        }
        spreadFireDownwind(ctx, ids, i.dir);
        ctx.fx.burst('leaf', i.origin, { count: 18, dir: i.dir, spread: 0.6, speed: 16 });
        ctx.fx.burst('dust', i.origin, { count: 6, dir: i.dir, spread: 0.5, speed: 8, color: 0x8899aa });
        for (let k = 0; k < 6; k++) {
          const s = add(i.origin, scale(perp(i.dir), (Math.random() - 0.5) * 2));
          ctx.fx.line(s, add(s, scale(i.dir, 3 + Math.random() * 4)), { color: 0xdff4ff, width: 0.03, life: 0.18, alpha: 0.5 });
        }
        ctx.audio.play('whoosh', { pos: i.origin });
      },
    },
    {
      id: 'wind.cyclone', name: 'Cyclone', description: 'A spinning vortex that lifts and flings anything nearby.', input: 'click', cooldown: 4, cost: 30,
      params: { duration: { default: 6, min: 2, max: 15 }, radius: { default: 3, min: 1, max: 8 } },
      onCast(ctx, i) {
        let pos = groundBelow(ctx, i.pos);
        let ang = 0;
        ctx.spawn(timed(ctx.params.duration!, (c, dt, t) => {
          ang += dt * 10;
          pos = { x: pos.x + Math.sin(t * 0.7) * 1.2 * dt, y: pos.y };
          const r = c.params.radius!;
          for (let k = 0; k < 3; k++) {
            const h = Math.random() * 7;
            c.fx.burst('dust', { x: pos.x + Math.cos(ang + k * 2 + h) * (0.3 + h * 0.35), y: pos.y + h }, { count: 1, color: 0x9aa9b8, speed: 1, size: 0.6, life: 0.6 });
          }
          const ids = c.physics.bodiesInBox({ x: pos.x, y: pos.y + 3.5 }, r, 4, 0);
          for (const id of ids) {
            const b = c.physics.info(id);
            if (!b) continue;
            const dx = pos.x - b.pos.x;
            c.physics.push(id, { x: dx * 6 * dt + Math.cos(ang) * 6 * dt, y: 18 * dt });
            c.physics.spin(id, 8 * dt);
          }
          if (Math.random() < dt * 4) spreadFireDownwind(c, ids, { x: Math.cos(ang), y: 0.3 });
          c.audio.loop('cyclone', 'wind', { volume: 1 });
        }, (c) => c.audio.loop('cyclone', null)));
      },
    },
    {
      id: 'wind.vacuum', name: 'Vacuum pull', description: 'Hold to suck everything toward the point.', input: 'hold', cooldown: 0, cost: 2, holdCost: 14,
      params: { radius: { default: 8, min: 2, max: 15 }, strength: { default: 18, min: 2, max: 50 } },
      onHold(ctx, i, dt) {
        const R = ctx.params.radius!;
        for (const id of ctx.physics.bodiesIn(i.pos, R)) {
          const b = ctx.physics.info(id);
          if (!b) continue;
          const d = sub(i.pos, b.pos);
          const l = Math.max(0.4, Math.hypot(d.x, d.y));
          ctx.physics.push(id, scale(d, (ctx.params.strength! * dt * ctx.mult) / l / Math.max(1, l * 0.4)));
        }
        const s = add(i.pos, fromAngle(Math.random() * 6.3, R * 0.8));
        ctx.fx.burst('leaf', s, { count: 2, dir: norm(sub(i.pos, s)), spread: 0.1, speed: 14, life: 0.5 });
        ctx.fx.ring(i.pos, { color: 0xdff4ff, radius: R * 0.5, life: 0.25, grow: false, width: 0.04 });
        ctx.audio.loop('vacuum', 'wind', { volume: 0.7 });
      },
      onRelease(ctx) {
        ctx.audio.loop('vacuum', null);
      },
    },
    {
      id: 'wind.blade', name: 'Air blade', description: 'Drag to throw a crescent of air that cuts through objects.', input: 'drag-aim', cooldown: 0.5, cost: 12,
      params: { range: { default: 12, min: 3, max: 25 }, damage: { default: 30, min: 0, max: 150 } },
      onCast(ctx, i) {
        let p = { ...i.origin };
        const hit = new Set<number>();
        ctx.audio.play('slash', { pos: i.origin });
        ctx.spawn(timed(ctx.params.range! / 35, (c, dt) => {
          const next = add(p, scale(i.dir, 35 * dt));
          const n = perp(i.dir);
          const a = add(next, scale(n, 0.7));
          const b = add(next, scale(n, -0.7));
          c.fx.line(a, add(next, scale(i.dir, 0.25)), { color: 0xe6f8ff, width: 0.06, life: 0.12 });
          c.fx.line(add(next, scale(i.dir, 0.25)), b, { color: 0xe6f8ff, width: 0.06, life: 0.12 });
          for (const h of [...c.physics.bodiesOnSegment(a, b), ...c.physics.bodiesOnSegment(p, next)]) {
            if (hit.has(h.id)) continue;
            hit.add(h.id);
            c.physics.damage(h.id, c.params.damage! * c.mult, 'cut', h.point);
            c.physics.cut(h.id, h.point, i.dir);
            c.physics.push(h.id, scale(i.dir, 4));
            c.fx.burst('spark', h.point, { count: 8, color: 0xe6f8ff });
            c.chaos(c.params.damage!);
          }
          p = next;
        }));
      },
    },
  ],
};

// ============================================================== EARTH
export const earth: Power = {
  id: 'earth',
  name: 'Earth',
  category: 'Elements',
  icon: 'icon/stone-sphere',
  description: 'Spikes, boulders, quakes and rivers of gravel.',
  palette: { primary: 0xd9a86b, secondary: 0xffd9a0, core: 0xfff1d6 },
  subs: [
    {
      id: 'earth.spikes', name: 'Rock spikes', description: 'A row of stone spikes bursts from the ground.', input: 'click', cooldown: 0.8, cost: 14,
      params: { count: { default: 5, min: 1, max: 12, step: 1 }, height: { default: 1.8, min: 0.5, max: 4 } },
      onCast(ctx, i) {
        const n = ctx.params.count!;
        const h = ctx.params.height!;
        let k = 0;
        ctx.spawn(timed(n * 0.07 + 0.5, (c, _dt, t) => {
          while (k < n && t > k * 0.07) {
            const x = i.pos.x + (k - (n - 1) / 2) * 0.7;
            const g = groundBelow(c, { x, y: i.pos.y + 2 });
            const tip = { x: x + (Math.random() - 0.5) * 0.3, y: g.y + h };
            c.fx.line({ x: x - 0.25, y: g.y }, tip, { color: 0xd9a86b, width: 0.09, life: 0.6 });
            c.fx.line({ x: x + 0.25, y: g.y }, tip, { color: 0xd9a86b, width: 0.09, life: 0.6 });
            c.fx.burst('dust', g, { count: 5, dir: { x: 0, y: 1 }, spread: 1.2, speed: 4 });
            for (const id of c.physics.bodiesInBox({ x, y: g.y + h / 2 }, 0.35, h / 2, 0)) {
              c.physics.push(id, { x: (Math.random() - 0.5) * 2, y: 11 * c.mult });
              c.physics.damage(id, 28 * c.mult, 'spike', tip);
              c.chaos(28);
            }
            c.audio.play('rock', { pos: g, volume: 0.6 });
            k++;
          }
        }));
        ctx.fx.shake(0.12);
      },
    },
    {
      id: 'earth.boulder', name: 'Boulder drop', description: 'Drop a heavy boulder from above.', input: 'click', cooldown: 0.6, cost: 12,
      params: {},
      onCast(ctx, i) {
        const v = ctx.physics.view();
        const top = { x: i.pos.x, y: Math.max(i.pos.y + 3, v.y + v.h / 2 + 1) };
        const ids = ctx.physics.spawnObject('boulder', top);
        const id = ids[0];
        if (id === undefined) return;
        ctx.physics.setVelocity(id, { x: 0, y: -12 });
        let landed = false;
        ctx.spawn(timed(5, (c) => {
          const b = c.physics.info(id);
          if (!b || landed) return;
          if (b.vel.y > -1 && b.pos.y < top.y - 1) {
            landed = true;
            c.fx.burst('dust', b.pos, { count: 14, speed: 5 });
            c.fx.shake(0.3);
            c.audio.play('rock', { pos: b.pos });
          }
        }));
      },
    },
    {
      id: 'earth.quake', name: 'Quake', description: 'Hold to charge, release to shake the ground. Bigger charge, wider quake.', input: 'charge-release', cooldown: 3, cost: 25, chargeTime: 1.5,
      params: { radius: { default: 12, min: 3, max: 30 } },
      onCharge(ctx, i) {
        ctx.fx.shake(0.04 + i.charge * 0.08);
        if (Math.random() < 0.3) ctx.fx.burst('dust', around(i.origin, 2), { count: 1, speed: 1 });
      },
      onCast(ctx, i) {
        const R = ctx.params.radius! * (0.4 + i.charge * 0.6);
        ctx.audio.play('quake', { pos: i.origin, volume: 0.6 + i.charge * 0.4 });
        ctx.spawn(timed(1.2, (c, dt) => {
          c.fx.shake(0.25 + i.charge * 0.35);
          for (const id of c.physics.bodiesIn(i.origin, R)) {
            if (Math.random() < dt * 8) c.physics.push(id, { x: (Math.random() - 0.5) * 4, y: (2 + Math.random() * 5) * (0.5 + i.charge) });
          }
          c.fx.burst('dust', { x: i.origin.x + (Math.random() - 0.5) * R * 2, y: groundBelow(c, i.origin).y }, { count: 2, speed: 2 });
        }));
        damageArea(ctx, i.origin, R, 15 * (0.5 + i.charge), 'quake');
      },
    },
    {
      id: 'earth.gravel', name: 'Gravel flood', description: 'Press and drag to pour a stream of real gravel.', input: 'hold', cooldown: 0, cost: 2, holdCost: 10,
      params: { rate: { default: 25, min: 5, max: 60, label: 'stones/s' } },
      onHold(ctx, i, dt) {
        if (Math.random() < ctx.params.rate! * dt) {
          const v = scale(rotate(i.dir, (Math.random() - 0.5) * 0.3), 8 + Math.random() * 4);
          ctx.physics.spawnProjectile({ shape: 'ball', size: 0.07 + Math.random() * 0.06, pos: i.origin, vel: v, material: 'stone', lifetime: 12, hp: 999 });
        }
        if (Math.random() < 0.3) ctx.fx.burst('dust', i.origin, { count: 1, dir: i.dir, speed: 3, size: 0.6 });
        ctx.audio.loop('gravel', 'water', { volume: 0.5 });
      },
      onRelease(ctx) {
        ctx.audio.loop('gravel', null);
      },
    },
  ],
};

// ============================================================== WATER
export const water: Power = {
  id: 'water',
  name: 'Water',
  category: 'Elements',
  icon: 'icon/drop',
  description: 'Soak, sweep and trap. Soaked targets take far more lightning and freeze faster.',
  palette: { primary: 0x3d8bff, secondary: 0x9fe0ff, core: 0xe6f6ff },
  subs: [
    {
      id: 'water.wave', name: 'Wave', description: 'Drag left or right to send a wave across the ground.', input: 'drag-aim', cooldown: 1.5, cost: 22,
      params: { height: { default: 2.5, min: 1, max: 6 }, strength: { default: 9, min: 2, max: 25 } },
      onCast(ctx, i) {
        const dirX = Math.sign(i.dir.x) || 1;
        const g = groundBelow(ctx, i.origin);
        let x = i.origin.x;
        ctx.audio.play('water', { pos: i.origin, volume: 1 });
        ctx.spawn(timed(1.6, (c, dt) => {
          x += dirX * 10 * dt;
          const h = c.params.height!;
          for (let k = 0; k < 6; k++) c.fx.burst('drop', { x: x + (Math.random() - 0.5) * 0.8, y: g.y + Math.random() * h }, { count: 1, dir: { x: dirX, y: 0.6 }, spread: 0.6, speed: 6, size: 1.6 });
          c.fx.burst('bubble', { x, y: g.y + h * 0.9 }, { count: 1, speed: 2 });
          for (const id of c.physics.bodiesInBox({ x, y: g.y + h / 2 }, 0.9, h / 2, 0)) {
            c.physics.push(id, { x: dirX * c.params.strength! * dt * 4, y: 6 * dt });
            c.status.apply(id, 'soaked', 10);
          }
          c.audio.loop('wave', 'water', { volume: 0.8 });
        }, (c) => c.audio.loop('wave', null)));
      },
    },
    {
      id: 'water.geyser', name: 'Geyser', description: 'A high-pressure column launches everything above it.', input: 'click', cooldown: 1, cost: 16,
      params: { power: { default: 26, min: 5, max: 60 } },
      onCast(ctx, i) {
        const g = groundBelow(ctx, i.pos);
        ctx.audio.play('splash', { pos: g });
        ctx.spawn(timed(1.6, (c, dt) => {
          c.fx.burst('drop', g, { count: 6, dir: { x: 0, y: 1 }, spread: 0.25, speed: 18, size: 1.4, life: 1.2 });
          c.fx.burst('steam', g, { count: 1, speed: 1, color: 0xcfe8ff });
          for (const id of c.physics.bodiesInBox({ x: g.x, y: g.y + 4 }, 0.6, 4, 0)) {
            c.physics.push(id, { x: (Math.random() - 0.5) * dt * 4, y: c.params.power! * dt * c.mult });
            c.status.apply(id, 'soaked', 10);
          }
          c.audio.loop('geyser', 'water', { volume: 0.9 });
        }, (c) => c.audio.loop('geyser', null)));
      },
    },
    {
      id: 'water.bubble', name: 'Bubble prison', description: 'Trap a target in a floating bubble.', input: 'click', cooldown: 2, cost: 20,
      params: { duration: { default: 5, min: 1, max: 15 } },
      onCast(ctx, i) {
        const first = nearestBody(ctx, i.pos, 2.5);
        if (first === null) return;
        const info = ctx.physics.info(first)!;
        const targets = info.dummy !== undefined ? ctx.physics.dummies().find((d) => d.id === info.dummy)?.parts ?? [first] : [first];
        let center = { x: info.pos.x, y: info.pos.y + 1.2 };
        const R = info.dummy !== undefined ? 1.2 : info.radius + 0.4;
        ctx.audio.play('bubble', { pos: center });
        ctx.spawn(timed(ctx.params.duration!, (c, dt, t) => {
          center = { x: center.x + Math.sin(t * 1.3) * 0.4 * dt, y: center.y + 0.25 * dt };
          for (const id of targets) {
            const b = c.physics.info(id);
            if (!b) continue;
            const d = sub(center, b.pos);
            c.physics.setVelocity(id, add(scale(b.vel, 0.9), scale(d, 4 * dt * 10)));
            c.status.apply(id, 'soaked', 6);
          }
          c.fx.ring(center, { color: 0x9fe0ff, radius: R, life: dt * 1.6, grow: false, width: 0.05 });
          c.fx.zone(center, R, { color: 0x3d8bff, life: dt * 1.6, alpha: 0.08 });
          if (Math.random() < 0.3) c.fx.burst('bubble', around(center, R * 0.8), { count: 1 });
        }, (c) => {
          c.fx.burst('drop', center, { count: 30, speed: 6 });
          c.audio.play('splash', { pos: center });
        }));
      },
    },
    {
      id: 'water.jet', name: 'Pressure jet', description: 'Press and drag to aim a blasting jet of water.', input: 'hold', cooldown: 0, cost: 2, holdCost: 14,
      params: { length: { default: 9, min: 2, max: 18 }, force: { default: 30, min: 5, max: 80 } },
      onHold(ctx, i, dt) {
        const { ids, end } = beamHits(ctx, i.origin, i.dir, ctx.params.length!, 0.35);
        ctx.fx.beam(i.origin, end, { color: 0x3d8bff, width: 0.18, core: 0xbfe6ff, life: dt * 1.6 });
        ctx.fx.burst('drop', end, { count: 3, dir: scale(i.dir, -1), spread: 1.4, speed: 5 });
        for (const id of ids) {
          ctx.physics.push(id, scale(i.dir, ctx.params.force! * dt * ctx.mult));
          ctx.status.apply(id, 'soaked', 10);
          ctx.physics.damage(id, 4 * dt, 'water');
        }
        ctx.audio.loop('jet', 'water', { volume: 0.9 });
      },
      onRelease(ctx) {
        ctx.audio.loop('jet', null);
      },
    },
  ],
};

