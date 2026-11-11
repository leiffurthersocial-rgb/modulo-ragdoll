// Physics powers: Gravity, Telekinesis, Black hole & time, Force.
import { add, fromAngle, norm, rotate, scale, sub, type Vec2 } from '../../core/math';
import { around, damageArea, nearestBody, radialPush, statusArea, timed } from '../effects';
import type { Power, PowerCtx } from '../types';

function pullTo(ctx: PowerCtx, p: Vec2, R: number, strength: number, dt: number, falloff = 1): void {
  for (const id of ctx.physics.bodiesIn(p, R)) {
    const b = ctx.physics.info(id);
    if (!b) continue;
    const d = sub(p, b.pos);
    const l = Math.max(0.35, Math.hypot(d.x, d.y));
    ctx.physics.push(id, scale(d, (strength * dt * ctx.mult) / l / Math.pow(Math.max(1, l * 0.5), falloff)));
  }
}

// ============================================================== GRAVITY
const GRAV_DIRS: Vec2[] = [
  { x: 0, y: -9.81 },
  { x: 0, y: 9.81 },
  { x: -9.81, y: 0 },
  { x: 9.81, y: 0 },
];

export const gravity: Power = {
  id: 'gravity',
  name: 'Gravity',
  category: 'Physics',
  icon: 'icon/heavy-fall',
  description: 'Bend gravity: wells, reversed zones, crushing weight and a flipped world.',
  palette: { primary: 0xb388ff, secondary: 0xe0d0ff, core: 0xffffff },
  subs: [
    {
      id: 'gravity.well', name: 'Gravity well', description: 'A point that drags everything toward it.', input: 'click', cooldown: 2, cost: 25,
      params: { radius: { default: 9, min: 2, max: 20 }, strength: { default: 30, min: 5, max: 100 }, duration: { default: 6, min: 1, max: 15 } },
      onCast(ctx, i) {
        ctx.audio.play('gravity', { pos: i.pos });
        let ang = 0;
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          ang += dt * 3;
          pullTo(c, i.pos, c.params.radius!, c.params.strength!, dt);
          for (let k = 0; k < 3; k++) c.fx.ring(i.pos, { color: 0xb388ff, radius: 0.4 + ((ang + k) % 3) * 0.8, life: dt * 1.5, grow: false, width: 0.03 });
          c.fx.light(i.pos, { color: 0xb388ff, radius: 2, life: dt * 1.5, intensity: 0.6 });
          const s = add(i.pos, fromAngle(Math.random() * 6.3, c.params.radius! * 0.7));
          c.fx.burst('pixel', s, { count: 1, dir: norm(sub(i.pos, s)), spread: 0.1, speed: 8, color: 0xb388ff });
          c.audio.loop('well', 'beam', { volume: 0.5 });
        }, (c) => c.audio.loop('well', null)));
      },
    },
    {
      id: 'gravity.reverse', name: 'Reverse gravity zone', description: 'Drag out an area where everything falls upward.', input: 'area-select', cooldown: 2, cost: 25,
      params: { duration: { default: 8, min: 1, max: 20 } },
      onCast(ctx, i) {
        const a = i.area!;
        const inside = new Set<number>();
        ctx.audio.play('gravity', { pos: a.center, pitch: 1.4 });
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          const now = new Set(c.physics.bodiesIn(a.center, a.radius));
          for (const id of now) if (!inside.has(id)) c.physics.setGravityScale(id, -1);
          for (const id of inside) if (!now.has(id)) c.physics.setGravityScale(id, 1);
          inside.clear();
          for (const id of now) inside.add(id);
          c.fx.zone(a.center, a.radius, { color: 0xb388ff, life: dt * 1.5, alpha: 0.07 });
          if (Math.random() < 0.5) c.fx.burst('pixel', around(a.center, a.radius), { count: 1, dir: { x: 0, y: 1 }, spread: 0.1, speed: 3, color: 0xd7b8ff });
        }, (c) => {
          for (const id of inside) c.physics.setGravityScale(id, 1);
        }));
      },
    },
    {
      id: 'gravity.heavy', name: 'Heavy mode', description: 'Make everything near the cursor four times heavier.', input: 'click', cooldown: 0.5, cost: 10,
      params: { radius: { default: 2, min: 0.5, max: 8 }, duration: { default: 6, min: 1, max: 20 } },
      onCast(ctx, i) {
        for (const id of statusArea(ctx, i.pos, ctx.params.radius!, 'heavy', ctx.params.duration!)) ctx.physics.push(id, { x: 0, y: -6 });
        ctx.fx.ring(i.pos, { color: 0xc78bff, radius: ctx.params.radius!, life: 0.35 });
        ctx.audio.play('gravity', { pos: i.pos, pitch: 0.7 });
      },
    },
    {
      id: 'gravity.flip', name: 'Flip direction', description: 'Rotate world gravity: down, up, left, right.', input: 'click', cooldown: 0.5, cost: 10,
      params: {},
      onCast(ctx) {
        const g = ctx.physics.gravity();
        const idx = GRAV_DIRS.findIndex((d) => Math.abs(d.x - g.x) < 0.1 && Math.abs(d.y - g.y) < 0.1);
        const next = GRAV_DIRS[(idx + 1) % GRAV_DIRS.length]!;
        const mag = Math.hypot(g.x, g.y) || 9.81;
        ctx.physics.setGravity(scale(norm(next), mag));
        ctx.fx.flash(0xb388ff, 0.2);
        ctx.fx.chroma(0.5);
        ctx.audio.play('warp');
      },
    },
  ],
};

// ============================================================== TELEKINESIS
let held: { ids: number[]; last: Vec2; vel: Vec2 } | null = null;

export const telekinesis: Power = {
  id: 'telekinesis',
  name: 'Telekinesis',
  category: 'Physics',
  icon: 'icon/telepathy',
  description: 'Move things with your mind: grab, squeeze, throw, lift and slam.',
  palette: { primary: 0x6fe3ff, secondary: 0xd9fbff, core: 0xffffff },
  subs: [
    {
      id: 'tk.grab', name: 'Grab & squeeze', description: 'Hold to lift what is under the cursor, drag it around and squeeze it. Release to throw.', input: 'hold', cooldown: 0, cost: 2, holdCost: 8,
      params: { squeeze: { default: 25, min: 0, max: 120, label: 'damage/s' } },
      onHold(ctx, i, dt) {
        if (!held) {
          const first = nearestBody(ctx, i.origin, 1.4);
          if (first === null) return;
          const info = ctx.physics.info(first)!;
          const ids = info.dummy !== undefined ? ctx.physics.dummies().find((d) => d.id === info.dummy)?.parts ?? [first] : [first];
          held = { ids, last: i.pos, vel: { x: 0, y: 0 } };
          ctx.audio.play('magic', { pos: i.pos });
        }
        held.vel = scale(sub(i.pos, held.last), 1 / Math.max(dt, 1e-3));
        held.last = i.pos;
        let cx = 0;
        let cy = 0;
        let n = 0;
        for (const id of held.ids) {
          const b = ctx.physics.info(id);
          if (!b) continue;
          cx += b.pos.x;
          cy += b.pos.y;
          n++;
        }
        if (!n) return;
        const center = { x: cx / n, y: cy / n };
        for (const id of held.ids) {
          const b = ctx.physics.info(id);
          if (!b) continue;
          const toCursor = sub(i.pos, center);
          const squeeze = scale(sub(center, b.pos), 3);
          ctx.physics.setVelocity(id, add(scale(toCursor, 8), squeeze));
          if (i.held > 0.6) ctx.physics.damage(id, (ctx.params.squeeze! * dt * ctx.mult) / Math.max(1, held.ids.length / 4), 'squeeze');
        }
        ctx.fx.ring(center, { color: 0x6fe3ff, radius: 1 + Math.sin(i.held * 12) * 0.1, life: dt * 1.6, grow: false, width: 0.05 });
        ctx.fx.light(center, { color: 0x6fe3ff, radius: 2, life: dt * 1.6, intensity: 0.4 });
        if (Math.random() < 0.3) ctx.fx.burst('pixel', around(center, 1), { count: 1, color: 0x6fe3ff });
      },
      onRelease(ctx) {
        if (held) {
          const v = held.vel;
          const sp = Math.min(30, Math.hypot(v.x, v.y));
          const dir = norm(v);
          for (const id of held.ids) ctx.physics.setVelocity(id, scale(dir, sp));
        }
        held = null;
      },
    },
    {
      id: 'tk.throw', name: 'Throw', description: 'Drag from a target to fling it. Longer drag, harder throw.', input: 'drag-aim', cooldown: 0.2, cost: 8,
      params: { power: { default: 5, min: 1, max: 12 } },
      onCast(ctx, i) {
        const ids = ctx.physics.bodiesIn(i.origin, 1.5);
        const sp = Math.min(40, 6 + i.dist * ctx.params.power!);
        for (const id of ids) {
          ctx.physics.setVelocity(id, scale(i.dir, sp * ctx.mult));
          ctx.physics.spin(id, (Math.random() - 0.5) * 10);
        }
        ctx.fx.burst('pixel', i.origin, { count: 14, dir: i.dir, spread: 0.6, speed: 10, color: 0x6fe3ff });
        ctx.audio.play('whoosh', { pos: i.origin });
      },
    },
    {
      id: 'tk.levitate', name: 'Levitate', description: 'Drag out an area: everything inside floats gently upward.', input: 'area-select', cooldown: 1, cost: 15,
      params: { duration: { default: 6, min: 1, max: 20 } },
      onCast(ctx, i) {
        const a = i.area!;
        for (const id of statusArea(ctx, a.center, a.radius, 'floating', ctx.params.duration!)) ctx.physics.push(id, { x: 0, y: 1.5 });
        ctx.fx.ring(a.center, { color: 0x6fe3ff, radius: a.radius, life: 0.5 });
        ctx.audio.play('magic', { pos: a.center, pitch: 1.3 });
      },
    },
    {
      id: 'tk.slam', name: 'Slam', description: 'Lift everything nearby, then slam it into the ground.', input: 'click', cooldown: 1, cost: 18,
      params: { radius: { default: 3, min: 1, max: 8 } },
      onCast(ctx, i) {
        const ids = ctx.physics.bodiesIn(i.pos, ctx.params.radius!);
        ctx.audio.play('magic', { pos: i.pos });
        let slammed = false;
        ctx.spawn(timed(0.8, (c, dt, t) => {
          if (t < 0.35) for (const id of ids) c.physics.setVelocity(id, { x: 0, y: 7 });
          else if (!slammed) {
            slammed = true;
            for (const id of ids) c.physics.setVelocity(id, { x: 0, y: -32 * c.mult });
            c.audio.play('whoosh', { pos: i.pos, pitch: 0.6 });
          }
          void dt;
        }));
      },
    },
    {
      id: 'tk.crush', name: 'Crush', description: 'Psychic pressure that crushes everything in a small area.', input: 'click', cooldown: 1, cost: 18,
      params: { radius: { default: 1.6, min: 0.5, max: 5 }, damage: { default: 45, min: 0, max: 200 } },
      onCast(ctx, i) {
        const R = ctx.params.radius!;
        for (const id of statusArea(ctx, i.pos, R, 'crushed', 1.5)) {
          const b = ctx.physics.info(id);
          if (!b) continue;
          ctx.physics.push(id, scale(sub(i.pos, b.pos), 4));
          ctx.physics.damage(id, ctx.params.damage! * ctx.mult, 'crush', b.pos);
          if (Math.random() < 0.35) ctx.physics.breakJointsOf(id);
          ctx.chaos(ctx.params.damage!);
        }
        ctx.fx.ring(i.pos, { color: 0x6fe3ff, radius: R * 1.5, life: 0.3, grow: false });
        ctx.fx.ring(i.pos, { color: 0xffffff, radius: R * 0.6, life: 0.2 });
        ctx.fx.hitStop(50);
        ctx.fx.shake(0.15);
        ctx.audio.play('punch', { pos: i.pos, pitch: 0.6 });
      },
    },
  ],
};

// ============================================================== BLACK HOLE & TIME
export const spacetime: Power = {
  id: 'spacetime',
  name: 'Black Hole & Time',
  category: 'Physics',
  icon: 'icon/black-hole-bolas',
  description: 'Singularities and time tricks: slow it, stop it, rewind it.',
  palette: { primary: 0x8b5cff, secondary: 0xfff1a8, core: 0xffffff },
  subs: [
    {
      id: 'time.blackhole', name: 'Black hole', description: 'A singularity that swallows whatever gets too close.', input: 'click', cooldown: 5, cost: 45,
      params: { duration: { default: 7, min: 2, max: 20 }, strength: { default: 60, min: 10, max: 200 } },
      onCast(ctx, i) {
        const p = i.pos;
        ctx.audio.play('warp', { pos: p, pitch: 0.5 });
        ctx.fx.flash(0x000000, 0.2);
        let spin = 0;
        ctx.spawn(timed(ctx.params.duration!, (c, dt, t) => {
          spin += dt;
          const grow = Math.min(1, t / 1.5);
          const R = 12 * grow;
          for (const id of c.physics.bodiesIn(p, R)) {
            const b = c.physics.info(id);
            if (!b) continue;
            const d = sub(p, b.pos);
            const l = Math.max(0.3, Math.hypot(d.x, d.y));
            // Inward pull plus a tangential swirl (accretion).
            const pull = (c.params.strength! * dt * c.mult) / Math.max(0.8, l * l * 0.35);
            c.physics.push(id, add(scale(d, pull / l), scale(rotate(d, Math.PI / 2), (pull * 0.35) / l)));
            if (l < 0.7 * grow + 0.2) {
              c.physics.damage(id, 180 * dt, 'singularity');
              if ((b.hp <= 0 || b.radius < 0.3) && Math.random() < dt * 4) {
                c.fx.burst('pixel', b.pos, { count: 10, color: 0x8b5cff });
                c.physics.remove(id);
                c.chaos(50);
              }
            }
          }
          c.fx.zone(p, 0.55 * grow, { color: 0x000000, life: dt * 1.5, alpha: 0.95 });
          for (let k = 0; k < 2; k++) c.fx.ring(p, { color: k ? 0xfff1a8 : 0x8b5cff, radius: 0.65 * grow + k * 0.15 + Math.sin(spin * 9 + k) * 0.05, life: dt * 1.5, grow: false, width: 0.07 });
          const s = add(p, fromAngle(spin * 4 + Math.random(), 1.5 + Math.random() * 3));
          c.fx.burst('pixel', s, { count: 1, dir: rotate(norm(sub(p, s)), 0.7), spread: 0.1, speed: 6, color: Math.random() < 0.5 ? 0x8b5cff : 0xfff1a8 });
          c.audio.loop('blackhole', 'beam', { volume: 0.8 });
        }, (c) => {
          c.audio.loop('blackhole', null);
          c.fx.ring(p, { color: 0x8b5cff, radius: 4, life: 0.4 });
          radialPush(c, p, 5, 10);
          c.fx.flash(0x8b5cff, 0.2);
        }));
      },
    },
    {
      id: 'time.slow', name: 'Time slow bubble', description: 'Drag out a bubble where time crawls.', input: 'area-select', cooldown: 2, cost: 20,
      params: { duration: { default: 8, min: 1, max: 20 } },
      onCast(ctx, i) {
        const a = i.area!;
        ctx.audio.play('timeStop', { pos: a.center, pitch: 1.4, volume: 0.5 });
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          for (const id of c.physics.bodiesIn(a.center, a.radius)) c.status.apply(id, 'slowed', 0.3);
          c.fx.zone(a.center, a.radius, { color: 0xfff1a8, life: dt * 1.5, alpha: 0.06 });
          c.fx.ring(a.center, { color: 0xfff1a8, radius: a.radius, life: dt * 1.5, grow: false, width: 0.03 });
        }));
      },
    },
    {
      id: 'time.stop', name: 'Time stop', description: 'Freeze every moving object for a few seconds.', input: 'click', cooldown: 6, cost: 40,
      params: { duration: { default: 3, min: 0.5, max: 10 } },
      onCast(ctx) {
        for (const id of ctx.physics.allDynamic()) ctx.status.apply(id, 'stopped', ctx.params.duration!);
        ctx.fx.flash(0xfff1a8, 0.4);
        ctx.fx.chroma(1);
        ctx.fx.aura(0xfff1a8, ctx.params.duration!);
        ctx.audio.play('timeStop');
      },
    },
    {
      id: 'time.rewind', name: 'Rewind region', description: 'Drag out an area: everything in it plays back the last few seconds in reverse.', input: 'area-select', cooldown: 3, cost: 25,
      params: { seconds: { default: 2.5, min: 0.5, max: 3 } },
      onCast(ctx, i) {
        const a = i.area!;
        const n = ctx.physics.rewind(a.center, a.radius, ctx.params.seconds!);
        ctx.fx.ring(a.center, { color: 0xfff1a8, radius: a.radius, life: 0.6, grow: false, width: 0.08 });
        ctx.fx.zone(a.center, a.radius, { color: 0xfff1a8, life: 0.8, alpha: 0.1 });
        if (n) ctx.audio.play('rewind', { pos: a.center });
      },
    },
  ],
};

// ============================================================== FORCE
export const force: Power = {
  id: 'force',
  name: 'Force',
  category: 'Physics',
  icon: 'icon/sonic-boom',
  description: 'Raw kinetic force: shockwaves, repulsor fields and magnetism.',
  palette: { primary: 0xe8f4ff, secondary: 0x8fd0ff, core: 0xffffff },
  subs: [
    {
      id: 'force.shockwave', name: 'Shockwave', description: 'A ring of force blasts everything outward.', input: 'click', cooldown: 0.6, cost: 14,
      params: { radius: { default: 7, min: 1, max: 20 }, strength: { default: 16, min: 2, max: 50 } },
      onCast(ctx, i) {
        radialPush(ctx, i.pos, ctx.params.radius!, ctx.params.strength!, { up: 0.25 });
        damageArea(ctx, i.pos, ctx.params.radius! * 0.6, 12, 'force');
        ctx.fx.ring(i.pos, { color: 0xe8f4ff, radius: ctx.params.radius!, life: 0.45, width: 0.25 });
        ctx.fx.ring(i.pos, { color: 0x8fd0ff, radius: ctx.params.radius! * 0.7, life: 0.35, width: 0.12 });
        ctx.fx.burst('dust', i.pos, { count: 10, speed: 8 });
        ctx.fx.shake(0.25);
        ctx.fx.chroma(0.5);
        ctx.fx.hitStop(35);
        ctx.audio.play('shockwave', { pos: i.pos });
      },
    },
    {
      id: 'force.repulsor', name: 'Repulsor', description: 'Hold to push everything away from the cursor.', input: 'hold', cooldown: 0, cost: 2, holdCost: 12,
      params: { radius: { default: 5, min: 1, max: 12 }, strength: { default: 30, min: 5, max: 80 } },
      onHold(ctx, i, dt) {
        for (const id of ctx.physics.bodiesIn(i.pos, ctx.params.radius!)) {
          const b = ctx.physics.info(id);
          if (!b) continue;
          const d = sub(b.pos, i.pos);
          const l = Math.max(0.3, Math.hypot(d.x, d.y));
          ctx.physics.push(id, scale(d, (ctx.params.strength! * dt * ctx.mult) / l / Math.max(1, l * 0.5)));
        }
        ctx.fx.ring(i.pos, { color: 0x8fd0ff, radius: ctx.params.radius! * 0.6, life: 0.25, width: 0.05 });
        ctx.audio.loop('repulsor', 'beam', { volume: 0.4 });
      },
      onRelease(ctx) {
        ctx.audio.loop('repulsor', null);
      },
    },
    {
      id: 'force.magnet', name: 'Magnet', description: 'Toggle: a strong magnet. Metal snaps to it, everything else drifts.', input: 'toggle', cooldown: 0.5, cost: 20,
      params: { radius: { default: 10, min: 2, max: 25 } },
      onCast(ctx, i) {
        const p = i.pos;
        let t = 0;
        ctx.audio.play('magic', { pos: p, pitch: 0.7 });
        ctx.spawn({
          tag: 'force.magnet',
          update(c, dt) {
            t += dt;
            for (const id of c.physics.bodiesIn(p, c.params.radius!)) {
              const b = c.physics.info(id);
              if (!b) continue;
              const d = sub(p, b.pos);
              const l = Math.max(0.4, Math.hypot(d.x, d.y));
              const k = b.material === 'metal' ? 40 : 5;
              c.physics.push(id, scale(d, (k * dt) / l / Math.max(1, l * 0.3)));
              if (b.material === 'metal' && Math.random() < dt * 3) c.fx.line(p, b.pos, { color: 0x8fd0ff, width: 0.02, life: 0.08, alpha: 0.6 });
            }
            c.fx.light(p, { color: 0x8fd0ff, radius: 1.5, life: dt * 1.5 });
            c.fx.ring(p, { color: 0xff5a5a, radius: 0.35, life: dt * 1.5, grow: false, width: 0.08 });
            c.fx.ring(p, { color: 0x8fd0ff, radius: 0.5, life: dt * 1.5, grow: false, width: 0.05 });
            return t < 15;
          },
        });
      },
    },
  ],
};

