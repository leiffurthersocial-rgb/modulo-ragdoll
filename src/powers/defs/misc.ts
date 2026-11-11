// Misc: Toxins (acid, poison), Explosives (TNT, nuke), Tech (laser grid, saw blades),
// Manipulate (shrink/grow, clone, teleport, heal/reset).
import { add, dist, fromAngle, scale, type Vec2 } from '../../core/math';
import { around, explode, nearestBody, statusArea, timed } from '../effects';
import type { Power, PowerCtx } from '../types';

const target = (ctx: PowerCtx, p: Vec2, r = 1.5): number | null => nearestBody(ctx, p, r);

export const toxins: Power = {
  id: 'toxins',
  name: 'Toxins',
  category: 'Misc',
  icon: 'icon/acid-blob',
  description: 'Acid that eats metal and poison that lingers. Fire turns poison into a toxic flare.',
  palette: { primary: 0xa6ff3a, secondary: 0x4fd94a, core: 0xf0ffd6 },
  subs: [
    {
      id: 'toxin.acid', name: 'Acid splash', description: 'Splash corrosive acid (triple damage to metal).', input: 'click', cooldown: 0.4, cost: 10,
      params: { radius: { default: 1.6, min: 0.5, max: 5 } },
      onCast(ctx, i) {
        statusArea(ctx, i.pos, ctx.params.radius!, 'acid', 4, 2);
        ctx.fx.burst('drop', i.pos, { count: 22, color: 0xa6ff3a, speed: 5 });
        ctx.fx.burst('gas', i.pos, { count: 3, color: 0xc6ff1a, size: 0.5 });
        ctx.audio.play('acid', { pos: i.pos });
      },
    },
    {
      id: 'toxin.rain', name: 'Acid rain', description: 'Drag out an area for corrosive rain.', input: 'area-select', cooldown: 3, cost: 25,
      params: { duration: { default: 5, min: 1, max: 15 } },
      onCast(ctx, i) {
        const a = i.area!;
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          c.fx.burst('drop', { x: a.center.x + (Math.random() - 0.5) * a.radius * 2, y: a.center.y + a.radius }, { count: 3, dir: { x: 0, y: -1 }, spread: 0.05, speed: 10, color: 0xa6ff3a });
          for (const id of c.physics.bodiesIn(a.center, a.radius)) if (Math.random() < dt * 1.5) c.status.apply(id, 'acid', 2);
          c.audio.loop('acidrain', 'acid', { volume: 0.4 });
        }, (c) => c.audio.loop('acidrain', null)));
      },
    },
    {
      id: 'toxin.cloud', name: 'Poison cloud', description: 'A lingering cloud of poison gas.', input: 'click', cooldown: 2, cost: 20,
      params: { radius: { default: 3, min: 1, max: 8 }, duration: { default: 8, min: 2, max: 20 } },
      onCast(ctx, i) {
        ctx.audio.play('gas', { pos: i.pos });
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          const R = c.params.radius!;
          if (Math.random() < 0.6) c.fx.burst('gas', around(i.pos, R * 0.7), { count: 1, color: 0x6fd94a, size: 1.4, speed: 0.6 });
          for (const id of c.physics.bodiesIn(i.pos, R)) if (Math.random() < dt * 2) c.status.apply(id, 'poisoned', 4);
        }));
      },
    },
  ],
};

export const explosives: Power = {
  id: 'explosives',
  name: 'Explosives',
  category: 'Misc',
  icon: 'icon/bright-explosion',
  description: 'TNT with a fuse, cluster charges, and a stylised nuke.',
  palette: { primary: 0xff4a3a, secondary: 0xffd23a, core: 0xffffff },
  subs: [
    {
      id: 'boom.tnt', name: 'TNT', description: 'Place a TNT crate with a 2 s fuse (or shoot it / set it on fire).', input: 'click', cooldown: 0.3, cost: 8,
      params: { fuse: { default: 2, min: 0.3, max: 8 } },
      onCast(ctx, i) {
        const ids = ctx.physics.spawnObject('tnt', i.pos);
        const id = ids[0];
        if (id === undefined) return;
        ctx.spawn(timed(ctx.params.fuse!, (c, dt, t) => {
          const b = c.physics.info(id);
          if (!b) return;
          if (Math.sin(t * (6 + t * 10)) > 0.7) c.fx.light(b.pos, { color: 0xff4a3a, radius: 1, life: dt * 2 });
          c.fx.burst('spark', add(b.pos, { x: 0, y: 0.25 }), { count: 1, dir: { x: 0, y: 1 }, speed: 3 });
        }, (c) => {
          const b = c.physics.info(id);
          if (b) {
            c.physics.remove(id);
            explode(c, b.pos, 3.2, 1.3);
          }
        }));
      },
    },
    {
      id: 'boom.cluster', name: 'Cluster charge', description: 'Drag to throw a charge that splits into five small blasts.', input: 'drag-aim', cooldown: 1.5, cost: 22,
      params: {},
      onCast(ctx, i) {
        const p0 = i.origin;
        ctx.spawn(timed(0.9, (c, dt, t) => {
          const p = add(p0, add(scale(i.dir, t * (8 + i.dist * 1.5)), { x: 0, y: -4.9 * t * t + 3 * t }));
          c.fx.burst('spark', p, { count: 1, speed: 1 });
          c.fx.light(p, { color: 0xff4a3a, radius: 0.8, life: dt * 2 });
        }, (c) => {
          const t = 0.9;
          const p = add(p0, add(scale(i.dir, t * (8 + i.dist * 1.5)), { x: 0, y: -4.9 * t * t + 3 * t }));
          for (let k = 0; k < 5; k++) {
            const q = add(p, fromAngle(Math.random() * 6.3, 1.5));
            c.spawn(timed(0.1 + k * 0.12, () => undefined, (cc) => explode(cc, q, 1.6, 0.6)));
          }
        }));
      },
    },
    {
      id: 'boom.nuke', name: 'Nuke (stylised)', description: 'A short countdown, then a blinding flash and a mushroom cloud.', input: 'click', cooldown: 12, cost: 80,
      params: { radius: { default: 10, min: 4, max: 25 } },
      onCast(ctx, i) {
        const p = i.pos;
        ctx.audio.play('charge', { pos: p, pitch: 0.5 });
        let boomed = false;
        ctx.spawn(timed(5, (c, dt, t) => {
          if (t < 1.2) {
            c.fx.ring(p, { color: 0xffffff, radius: 3 * (1.2 - t), life: dt * 1.6, grow: false, width: 0.05 });
            c.fx.light(p, { color: 0xffffaa, radius: 1 + t * 2, life: dt * 1.6, intensity: t });
            return;
          }
          if (!boomed) {
            boomed = true;
            c.fx.flash(0xffffff, 1);
            c.fx.chroma(1.5);
            c.fx.bloomSpike(2.5);
            c.fx.shake(1);
            c.fx.hitStop(120);
            c.fx.slowMo(0.35, 1.2);
            explode(c, p, c.params.radius!, 3, { big: true });
            c.fx.ring(p, { color: 0xffd23a, radius: c.params.radius! * 2, life: 1.2, width: 0.5 });
            c.fx.ring(p, { color: 0xffffff, radius: c.params.radius! * 2.6, life: 1.6, width: 0.2 });
          }
          // Mushroom cloud: rising stem + spreading cap.
          const k = t - 1.2;
          const capY = p.y + Math.min(9, k * 4);
          c.fx.burst('smoke', { x: p.x + (Math.random() - 0.5) * 1.2, y: p.y + Math.random() * (capY - p.y) }, { count: 2, color: 0x4a3a30, size: 2, speed: 0.6, gravity: 2 });
          c.fx.burst('smoke', { x: p.x + (Math.random() - 0.5) * (2 + k * 2), y: capY }, { count: 3, color: 0x5a4030, size: 3, speed: 1.5, gravity: 1 });
          c.fx.burst('flame', { x: p.x + (Math.random() - 0.5) * (1 + k), y: capY - 0.5 }, { count: 2, size: 2.5, speed: 1, color: 0xff8a2a });
          c.fx.light({ x: p.x, y: capY }, { color: 0xff8a2a, radius: 6, life: dt * 1.6, intensity: 0.5 });
        }));
      },
    },
  ],
};

export const tech: Power = {
  id: 'tech',
  name: 'Lasers & Saws',
  category: 'Misc',
  icon: 'icon/laser-blast',
  description: 'Sweeping laser grids and runaway saw blades.',
  palette: { primary: 0xff2d55, secondary: 0xc0c8d8, core: 0xffffff },
  subs: [
    {
      id: 'tech.grid', name: 'Laser grid', description: 'Drag out an area: a grid of lasers sweeps through it.', input: 'area-select', cooldown: 3, cost: 25,
      params: { lines: { default: 5, min: 2, max: 12, step: 1 }, duration: { default: 4, min: 1, max: 12 } },
      onCast(ctx, i) {
        const a = i.area!;
        ctx.audio.play('laser', { pos: a.center, pitch: 0.8 });
        ctx.spawn(timed(ctx.params.duration!, (c, dt, t) => {
          const n = c.params.lines!;
          for (let k = 0; k < n; k++) {
            const y = a.center.y - a.radius + ((k / n) * 2 * a.radius + t * 1.5) % (2 * a.radius);
            const p1 = { x: a.center.x - a.radius, y };
            const p2 = { x: a.center.x + a.radius, y };
            c.fx.beam(p1, p2, { color: 0xff2d55, width: 0.05, life: dt * 1.6 });
            for (const h of c.physics.bodiesOnSegment(p1, p2)) {
              c.physics.damage(h.id, 45 * dt * c.mult, 'laser', h.point);
              if (Math.random() < dt * 1.5) c.physics.cut(h.id, h.point, { x: 1, y: 0 });
              if (Math.random() < dt * 2) c.status.apply(h.id, 'burning', 2);
              if (Math.random() < 0.3) c.fx.burst('spark', h.point, { count: 1, color: 0xff2d55 });
            }
          }
          c.fx.ring(a.center, { color: 0xff2d55, radius: a.radius, life: dt * 1.6, grow: false, width: 0.02 });
          c.audio.loop('lasergrid', 'saw', { volume: 0.2 });
        }, (c) => c.audio.loop('lasergrid', null)));
      },
    },
    {
      id: 'tech.saw', name: 'Saw blade', description: 'Drag to launch a spinning saw blade that cuts through everything it rolls over.', input: 'drag-aim', cooldown: 0.8, cost: 15,
      params: { lifetime: { default: 6, min: 1, max: 20 } },
      onCast(ctx, i) {
        const id = ctx.physics.spawnProjectile({ shape: 'ball', size: 0.35, pos: i.origin, vel: scale(i.dir, 12 + i.dist), material: 'metal', lifetime: ctx.params.lifetime!, hp: 9999, gravityScale: 1 });
        if (id < 0) return;
        ctx.audio.play('saw', { pos: i.origin });
        ctx.spawn(timed(ctx.params.lifetime!, (c, dt) => {
          const b = c.physics.info(id);
          if (!b) return;
          c.physics.spin(id, -40 * dt);
          c.fx.ring(b.pos, { color: 0xc0c8d8, radius: 0.42, life: dt * 1.6, grow: false, width: 0.04 });
          for (const o of c.physics.bodiesIn(b.pos, 0.55)) {
            if (o === id) continue;
            c.physics.damage(o, 70 * dt * c.mult, 'saw', b.pos);
            if (Math.random() < dt * 3) c.physics.cut(o, b.pos, { x: 0, y: 1 });
            c.fx.burst('spark', b.pos, { count: 2, color: 0xffd27a, speed: 8 });
            c.chaos(70 * dt);
          }
          c.audio.loop(`saw${id}`, 'saw', { volume: 0.25 });
        }, (c) => {
          c.audio.loop(`saw${id}`, null);
          c.physics.remove(id);
        }));
      },
    },
  ],
};

export const manipulate: Power = {
  id: 'manipulate',
  name: 'Manipulate',
  category: 'Misc',
  icon: 'icon/health-potion',
  description: 'Sandbox utilities: shrink, grow, clone, teleport and heal/reset.',
  palette: { primary: 0x6fe38a, secondary: 0xd6ffe0, core: 0xffffff },
  subs: [
    {
      id: 'manip.shrink', name: 'Shrink', description: 'Click a body or dummy to shrink it.', input: 'click', cooldown: 0.2, cost: 4, params: {},
      onCast(ctx, i) {
        const id = target(ctx, i.pos);
        if (id === null) return;
        ctx.physics.rescale(id, 0.7);
        ctx.fx.ring(i.pos, { color: 0x6fe38a, radius: 1, life: 0.3, grow: false });
        ctx.audio.play('magic', { pos: i.pos, pitch: 1.5 });
      },
    },
    {
      id: 'manip.grow', name: 'Grow', description: 'Click a body or dummy to grow it.', input: 'click', cooldown: 0.2, cost: 4, params: {},
      onCast(ctx, i) {
        const id = target(ctx, i.pos);
        if (id === null) return;
        ctx.physics.rescale(id, 1.4);
        ctx.fx.ring(i.pos, { color: 0x6fe38a, radius: 1.5, life: 0.35 });
        ctx.audio.play('magic', { pos: i.pos, pitch: 0.7 });
      },
    },
    {
      id: 'manip.clone', name: 'Clone', description: 'Duplicate the body or dummy under the cursor.', input: 'click', cooldown: 0.3, cost: 6, params: {},
      onCast(ctx, i) {
        const id = target(ctx, i.pos);
        if (id === null) return;
        ctx.physics.clone(id, { x: 1.2, y: 0.5 });
        ctx.fx.burst('pixel', i.pos, { count: 12, color: 0x6fe38a });
        ctx.audio.play('clone', { pos: i.pos });
      },
    },
    {
      id: 'manip.teleport', name: 'Teleport', description: 'Drag from a body to where it should appear.', input: 'drag-aim', cooldown: 0.2, cost: 6, params: {},
      onCast(ctx, i) {
        const id = target(ctx, i.origin);
        if (id === null || dist(i.origin, i.pos) < 0.3) return;
        ctx.fx.burst('pixel', i.origin, { count: 14, color: 0x6fe38a });
        ctx.physics.teleport(id, i.pos);
        ctx.physics.setVelocity(id, { x: 0, y: 0 });
        ctx.fx.burst('pixel', i.pos, { count: 14, color: 0x6fe38a });
        ctx.fx.ring(i.pos, { color: 0x6fe38a, radius: 1, life: 0.3 });
        ctx.audio.play('teleport', { pos: i.pos });
      },
    },
    {
      id: 'manip.heal', name: 'Heal / reset', description: 'Fully repair a body; dummies are rebuilt in one piece.', input: 'click', cooldown: 0.3, cost: 5, params: {},
      onCast(ctx, i) {
        const id = target(ctx, i.pos, 2);
        if (id === null) return;
        ctx.physics.heal(id);
        ctx.fx.burst('glow', i.pos, { count: 10, color: 0x6fe38a });
        ctx.fx.ring(i.pos, { color: 0x6fe38a, radius: 1.5, life: 0.4 });
        ctx.audio.play('heal', { pos: i.pos });
      },
    },
  ],
};
