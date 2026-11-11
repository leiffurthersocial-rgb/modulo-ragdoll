// Anime-style archetypes with original names and designs: Spirit Beam, Rapid Fist Barrage,
// Shadow Clones, Blade Aura, Heavy Aura, Spirit Dragon, Dimensional Slash, Limiter Break.
import { add, dist, fromAngle, lerpV, norm, perp, rotate, scale, segmentDistance, sub, type Vec2 } from '../../core/math';
import { around, beamHits, explode, nearestBody, radialPush, statusArea, timed } from '../effects';
import type { Power, PowerCtx, PowerEntity } from '../types';

// ============================================================== SPIRIT BEAM
let chargeSoundAt = -1;

export const spiritBeam: Power = {
  id: 'spiritBeam',
  name: 'Spirit Beam',
  category: 'Archetypes',
  icon: 'icon/beam-wake',
  description: 'Gather spirit energy into a growing aura, then unleash a colossal beam.',
  palette: { primary: 0x5fd8ff, secondary: 0xb8f4ff, core: 0xffffff },
  subs: [
    {
      id: 'beam.charge', name: 'Charged beam', description: 'Hold to charge (aura grows, screen rumbles), drag to aim, release to fire.', input: 'charge-release', cooldown: 1.5, cost: 30, chargeTime: 1.6,
      params: { damage: { default: 90, min: 10, max: 400, label: 'damage/s' }, length: { default: 30, min: 5, max: 60 } },
      onCharge(ctx, i) {
        if (i.held < 0.05 && ctx.time - chargeSoundAt > 0.3) {
          chargeSoundAt = ctx.time;
          ctx.audio.play('charge', { pos: i.origin });
        }
        const c = i.charge;
        const s = add(i.origin, fromAngle(Math.random() * 6.3, 1 + c * 2.5));
        ctx.fx.burst('glow', s, { count: 1, dir: norm(sub(i.origin, s)), spread: 0.05, speed: 6 + c * 6, color: 0x5fd8ff, size: 0.3 });
        ctx.fx.light(i.origin, { color: 0x5fd8ff, radius: 0.8 + c * 3, life: 0.03, intensity: 0.5 + c * 0.5 });
        ctx.fx.ring(i.origin, { color: 0xb8f4ff, radius: 0.3 + c * 1.2, life: 0.03, grow: false, width: 0.04 + c * 0.05 });
        ctx.fx.shake(c * 0.08);
        if (c >= 1 && Math.random() < 0.2) ctx.fx.bolt(i.origin, add(i.origin, fromAngle(Math.random() * 6.3, 1.5)), { color: 0x5fd8ff, width: 0.4, branches: 0, life: 0.05 });
      },
      onCast(ctx, i) {
        const c = Math.max(0.15, i.charge);
        const width = 0.22 + c * 0.6;
        const dur = 0.5 + c * 1.1;
        ctx.audio.play('beam', { pos: i.origin, volume: 0.6 + c * 0.4 });
        ctx.fx.flash(0xb8f4ff, 0.25 + c * 0.3);
        ctx.fx.chroma(0.4 + c * 0.6);
        ctx.spawn(timed(dur, (cc, dt, t) => {
          const { ids, end } = beamHits(cc, i.origin, i.dir, cc.params.length!, width);
          const fade = Math.min(1, (dur - t) * 4);
          cc.fx.beam(i.origin, end, { color: 0x5fd8ff, width: width * fade, life: dt * 1.6 });
          cc.fx.light(i.origin, { color: 0x5fd8ff, radius: 2 + c * 3, life: dt * 1.6, intensity: 0.9 });
          cc.fx.light(end, { color: 0xb8f4ff, radius: 2 + c * 2, life: dt * 1.6, intensity: 0.8 });
          cc.fx.burst('spark', end, { count: 3, color: 0xb8f4ff, speed: 12 });
          cc.fx.shake(0.12 + c * 0.2);
          cc.fx.bloomSpike(0.3 * c);
          for (const id of ids) {
            cc.physics.push(id, scale(i.dir, 40 * dt * (0.5 + c)));
            cc.physics.damage(id, cc.params.damage! * dt * (0.5 + c) * cc.mult, 'beam');
            cc.chaos(cc.params.damage! * dt);
          }
          cc.audio.loop('spiritbeam', 'beam', { volume: 1 });
        }, (cc) => cc.audio.loop('spiritbeam', null)));
      },
    },
    {
      id: 'beam.shots', name: 'Spirit shots', description: 'Rapid small energy bolts toward the cursor direction.', input: 'drag-aim', cooldown: 0.15, cost: 4,
      params: {},
      onCast(ctx, i) {
        const { ids, end } = beamHits(ctx, i.origin, i.dir, 18, 0.15);
        ctx.fx.beam(i.origin, end, { color: 0x5fd8ff, width: 0.12, life: 0.08 });
        ctx.fx.burst('glow', end, { count: 3, color: 0x5fd8ff });
        for (const id of ids.slice(0, 1)) {
          ctx.physics.push(id, scale(i.dir, 8));
          ctx.physics.damage(id, 15 * ctx.mult, 'beam');
        }
        ctx.audio.play('laser', { pos: i.origin, pitch: 1.3 });
      },
    },
  ],
};

// ============================================================== RAPID FIST BARRAGE
export const fistBarrage: Power = {
  id: 'fistBarrage',
  name: 'Rapid Fist Barrage',
  category: 'Archetypes',
  icon: 'icon/fist',
  description: 'Invisible punches faster than the eye: a storm of impact flashes and hit-stop.',
  palette: { primary: 0xffe066, secondary: 0xffffff, core: 0xffffff },
  subs: [
    {
      id: 'fist.barrage', name: 'Barrage', description: 'Hold over a target to rain punches on it.', input: 'hold', cooldown: 0, cost: 2, holdCost: 14,
      params: { rate: { default: 22, min: 5, max: 60, label: 'punches/s' }, damage: { default: 6, min: 1, max: 40 } },
      onHold(ctx, i, dt) {
        const n = Math.random() < ctx.params.rate! * dt ? 1 : 0;
        for (let k = 0; k < n; k++) {
          const p = around(i.pos, 0.9);
          const ids = ctx.physics.bodiesIn(p, 0.35);
          const dir = norm(add(i.dir, { x: (Math.random() - 0.5) * 0.8, y: (Math.random() - 0.2) * 0.8 }));
          ctx.fx.ring(p, { color: 0xffe066, radius: 0.35, life: 0.12, width: 0.06 });
          ctx.fx.light(p, { color: 0xffffff, radius: 0.8, life: 0.06, intensity: 1 });
          for (let s = 0; s < 3; s++) {
            const off = add(p, scale(perp(dir), (s - 1) * 0.15));
            ctx.fx.line(add(off, scale(dir, -0.7)), off, { color: 0xffffff, width: 0.025, life: 0.06, alpha: 0.7 });
          }
          if (ids.length) {
            for (const id of ids) {
              ctx.physics.push(id, scale(dir, 3.5));
              ctx.physics.damage(id, ctx.params.damage! * ctx.mult, 'punch', p);
              ctx.chaos(ctx.params.damage!);
            }
            ctx.fx.burst('spark', p, { count: 4, color: 0xffe066, speed: 6 });
            if (Math.random() < 0.35) ctx.fx.hitStop(14);
            ctx.fx.shake(0.04);
            ctx.audio.play('punch', { pos: p, volume: 0.6 });
          }
        }
      },
    },
    {
      id: 'fist.finisher', name: 'Finishing blow', description: 'One devastating punch with a long hit-stop.', input: 'drag-aim', cooldown: 1.2, cost: 18,
      params: { power: { default: 30, min: 5, max: 80 } },
      onCast(ctx, i) {
        const ids = ctx.physics.bodiesIn(i.origin, 1);
        ctx.fx.hitStop(140);
        ctx.fx.flash(0xffffff, 0.35);
        ctx.fx.chroma(0.8);
        ctx.fx.shake(0.4);
        ctx.fx.ring(i.origin, { color: 0xffe066, radius: 2.5, life: 0.4, width: 0.2 });
        ctx.fx.burst('spark', i.origin, { count: 30, dir: i.dir, spread: 0.8, speed: 16, color: 0xffe066 });
        ctx.audio.play('punch', { pos: i.origin, pitch: 0.5, volume: 1 });
        ctx.audio.play('shockwave', { pos: i.origin, volume: 0.6 });
        for (const id of ids) {
          ctx.physics.push(id, scale(i.dir, ctx.params.power! * ctx.mult));
          ctx.physics.damage(id, 50 * ctx.mult, 'punch');
          ctx.chaos(50);
        }
      },
    },
  ],
};

// ============================================================== SHADOW CLONES
function shadowClone(start: Vec2, life: number): PowerEntity {
  let pos = { ...start };
  let vel = { x: 0, y: 0 };
  let t = 0;
  let strikeCd = 0;
  let face = 1;
  return {
    update(c, dt) {
      t += dt;
      strikeCd -= dt;
      // Seek the nearest dummy part (prefers torsos via the dummy centre).
      const target = c.physics.dummies().sort((a, b) => dist(a.center, pos) - dist(b.center, pos))[0];
      const goal = target ? add(target.center, { x: Math.sin(t * 3 + start.x) * 0.9, y: 0.3 }) : add(start, { x: Math.sin(t) * 2, y: 0 });
      const d = sub(goal, pos);
      const l = Math.hypot(d.x, d.y);
      vel = add(scale(vel, 0.86), scale(d, (l > 1.5 ? 2.2 : 0.8) * 60 * dt));
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > 14) vel = scale(vel, 14 / sp);
      pos = add(pos, scale(vel, dt));
      if (Math.abs(vel.x) > 0.5) face = Math.sign(vel.x);
      if (target && l < 1.2 && strikeCd <= 0) {
        strikeCd = 0.25 + Math.random() * 0.2;
        const id = nearestBody(c, pos, 1.3);
        if (id !== null) {
          const b = c.physics.info(id)!;
          const dir = norm(sub(b.pos, pos));
          c.physics.push(id, add(scale(dir, 6), { x: 0, y: 2 }));
          c.physics.damage(id, 12 * c.mult, 'clone', b.pos);
          c.fx.ring(b.pos, { color: 0xb07cff, radius: 0.4, life: 0.12 });
          c.fx.burst('pixel', b.pos, { count: 5, color: 0xb07cff });
          c.audio.play('punch', { pos: b.pos, volume: 0.45, pitch: 1.2 });
          c.chaos(12);
        }
      }
      // Draw: dark silhouette stick figure with violet rim.
      const col = 0xb07cff;
      const head = add(pos, { x: 0, y: 0.75 });
      const hip = add(pos, { x: 0, y: -0.05 });
      const swing = Math.sin(t * 14) * 0.35;
      const L = (a: Vec2, b: Vec2, w = 0.07) => c.fx.line(a, b, { color: col, width: w, life: dt * 1.6, alpha: 0.5 });
      c.fx.zone(head, 0.16, { color: 0x1a0d33, life: dt * 1.6, alpha: 1 });
      c.fx.ring(head, { color: col, radius: 0.16, life: dt * 1.6, grow: false, width: 0.03 });
      L(add(head, { x: 0, y: -0.16 }), hip, 0.1);
      L(add(pos, { x: 0, y: 0.5 }), add(pos, { x: face * 0.45, y: 0.35 + swing }));
      L(add(pos, { x: 0, y: 0.5 }), add(pos, { x: -face * 0.35, y: 0.2 - swing }));
      L(hip, add(hip, { x: 0.25 + swing * 0.5, y: -0.6 }));
      L(hip, add(hip, { x: -0.25 - swing * 0.5, y: -0.6 }));
      if (Math.random() < 0.3) c.fx.burst('smoke', pos, { count: 1, color: 0x2a1650, size: 0.4, speed: 0.5 });
      return t < life;
    },
    dispose(c) {
      c.fx.burst('smoke', pos, { count: 6, color: 0x2a1650 });
    },
  };
}

export const shadowClones: Power = {
  id: 'shadowClones',
  name: 'Shadow Clones',
  category: 'Archetypes',
  icon: 'icon/two-shadows',
  description: 'Split into shadow copies that swarm the nearest dummies.',
  palette: { primary: 0xb07cff, secondary: 0x2a1650, core: 0xffffff },
  subs: [
    {
      id: 'clones.summon', name: 'Summon clones', description: 'Spawn shadow clones at the cursor.', input: 'click', cooldown: 3, cost: 30,
      params: { count: { default: 3, min: 1, max: 10, step: 1 }, duration: { default: 8, min: 2, max: 20 } },
      onCast(ctx, i) {
        for (let k = 0; k < ctx.params.count!; k++) ctx.spawn(shadowClone(around(i.pos, 1), ctx.params.duration!));
        ctx.fx.burst('smoke', i.pos, { count: 14, color: 0x2a1650, speed: 3 });
        ctx.audio.play('clone', { pos: i.pos });
      },
    },
    {
      id: 'clones.ambush', name: 'Ambush', description: 'Clones appear in a ring around the nearest dummy.', input: 'click', cooldown: 4, cost: 35,
      params: {},
      onCast(ctx, i) {
        const d = ctx.physics.dummies().sort((a, b) => dist(a.center, i.pos) - dist(b.center, i.pos))[0];
        const c = d?.center ?? i.pos;
        for (let k = 0; k < 5; k++) {
          const p = add(c, fromAngle((k / 5) * Math.PI * 2, 2));
          ctx.spawn(shadowClone(p, 6));
          ctx.fx.burst('smoke', p, { count: 5, color: 0x2a1650 });
        }
        ctx.audio.play('clone', { pos: c, pitch: 0.8 });
      },
    },
  ],
};

// ============================================================== BLADE AURA
function slashArc(ctx: PowerCtx, origin: Vec2, dir: Vec2, range: number, radius: number, color: number): void {
  let p = { ...origin };
  const hit = new Set<number>();
  ctx.audio.play('slash', { pos: origin });
  ctx.spawn(timed(range / 30, (c, dt) => {
    const next = add(p, scale(dir, 30 * dt));
    // Crescent: arc of points around `next`, opening backward.
    const pts: Vec2[] = [];
    for (let k = -4; k <= 4; k++) pts.push(add(next, scale(rotate(dir, k * 0.3), radius * Math.cos(k * 0.12))));
    for (let k = 0; k < pts.length - 1; k++) {
      const w = 0.04 + (1 - Math.abs(k - 3.5) / 4) * 0.08;
      c.fx.line(pts[k]!, pts[k + 1]!, { color, width: w, life: 0.15 });
      for (const h of c.physics.bodiesOnSegment(pts[k]!, pts[k + 1]!)) {
        if (hit.has(h.id)) continue;
        hit.add(h.id);
        c.physics.cut(h.id, h.point, dir);
        c.physics.damage(h.id, 35 * c.mult, 'blade', h.point);
        c.physics.push(h.id, scale(dir, 5));
        c.fx.burst('spark', h.point, { count: 8, color });
        c.fx.hitStop(18);
        c.chaos(35);
      }
    }
    c.fx.light(next, { color, radius: radius * 1.5, life: dt * 2, intensity: 0.4 });
    p = next;
  }));
}

export const bladeAura: Power = {
  id: 'bladeAura',
  name: 'Blade Aura',
  category: 'Archetypes',
  icon: 'icon/sword-wound',
  description: 'Slicing arcs of energy that cut objects in two and sever limbs at the joints.',
  palette: { primary: 0xff5f8f, secondary: 0xffd1df, core: 0xffffff },
  subs: [
    {
      id: 'blade.slash', name: 'Crescent slash', description: 'Drag to send a cutting crescent.', input: 'drag-aim', cooldown: 0.35, cost: 10,
      params: { range: { default: 12, min: 3, max: 30 } },
      onCast(ctx, i) {
        slashArc(ctx, i.origin, i.dir, ctx.params.range!, 0.9, 0xff5f8f);
      },
    },
    {
      id: 'blade.storm', name: 'Blade storm', description: 'Hold: blades orbit the cursor and cut anything they touch.', input: 'hold', cooldown: 0, cost: 2, holdCost: 16,
      params: { radius: { default: 1.6, min: 0.6, max: 4 } },
      onHold(ctx, i, dt) {
        const R = ctx.params.radius!;
        const a0 = i.held * 9;
        for (let k = 0; k < 3; k++) {
          const a = a0 + (k * Math.PI * 2) / 3;
          const p1 = add(i.pos, fromAngle(a, R));
          const p2 = add(i.pos, fromAngle(a + 0.5, R));
          ctx.fx.line(p1, p2, { color: 0xff5f8f, width: 0.07, life: 0.07 });
          for (const h of ctx.physics.bodiesOnSegment(p1, p2)) {
            if (Math.random() < dt * 6) ctx.physics.cut(h.id, h.point, norm(sub(p2, p1)));
            ctx.physics.damage(h.id, 40 * dt * ctx.mult, 'blade', h.point);
            ctx.physics.push(h.id, scale(norm(sub(h.point, i.pos)), 10 * dt));
            if (Math.random() < 0.2) ctx.fx.burst('spark', h.point, { count: 2, color: 0xff5f8f });
          }
        }
        ctx.audio.loop('bladestorm', 'saw', { volume: 0.4 });
      },
      onRelease(ctx) {
        ctx.audio.loop('bladestorm', null);
      },
    },
  ],
};

// ============================================================== HEAVY AURA
export const heavyAura: Power = {
  id: 'heavyAura',
  name: 'Heavy Aura',
  category: 'Archetypes',
  icon: 'icon/aura',
  description: 'A gravity fighter: stomps that multiply the weight of everything around.',
  palette: { primary: 0xc78bff, secondary: 0x6a2fd1, core: 0xffffff },
  subs: [
    {
      id: 'heavy.stomp', name: 'Gravity stomp', description: 'Stomp: everything in the radius becomes crushingly heavy.', input: 'click', cooldown: 1, cost: 18,
      params: { radius: { default: 4.5, min: 1, max: 12 }, duration: { default: 5, min: 1, max: 15 } },
      onCast(ctx, i) {
        const R = ctx.params.radius!;
        for (const id of statusArea(ctx, i.pos, R, 'heavy', ctx.params.duration!)) {
          ctx.physics.push(id, { x: 0, y: -9 * ctx.mult });
          ctx.physics.damage(id, 14 * ctx.mult, 'stomp');
        }
        ctx.fx.ring(i.pos, { color: 0xc78bff, radius: R, life: 0.5, width: 0.3 });
        ctx.fx.ring(i.pos, { color: 0x6a2fd1, radius: R * 0.6, life: 0.4, width: 0.15 });
        ctx.fx.burst('dust', i.pos, { count: 16, speed: 7 });
        ctx.fx.shake(0.4);
        ctx.fx.hitStop(60);
        ctx.audio.play('quake', { pos: i.pos, volume: 0.7 });
        ctx.audio.play('gravity', { pos: i.pos, pitch: 0.6 });
      },
    },
    {
      id: 'heavy.field', name: 'Crushing field', description: 'Toggle a field that follows the nearest dummy and pins it down.', input: 'toggle', cooldown: 1, cost: 25,
      params: {},
      onCast(ctx, i) {
        let pos = { ...i.pos };
        let t = 0;
        ctx.spawn({
          tag: 'heavy.field',
          update(c, dt) {
            t += dt;
            const d = c.physics.dummies().sort((a, b) => dist(a.center, pos) - dist(b.center, pos))[0];
            if (d) pos = lerpV(pos, d.center, Math.min(1, dt * 2));
            for (const id of c.physics.bodiesIn(pos, 2.2)) {
              c.physics.push(id, { x: 0, y: -14 * dt });
              c.physics.damage(id, 5 * dt, 'gravity');
            }
            c.fx.zone(pos, 2.2, { color: 0x6a2fd1, life: dt * 1.5, alpha: 0.08 });
            c.fx.ring(pos, { color: 0xc78bff, radius: 2.2 - (t % 1) * 2, life: dt * 1.5, grow: false, width: 0.04 });
            return t < 12;
          },
        });
        ctx.audio.play('gravity', { pos: i.pos, pitch: 0.5 });
      },
    },
  ],
};

// ============================================================== SPIRIT DRAGON
function dragonEntity(start: Vec2, life: number, color: number): PowerEntity {
  const N = 26;
  const segs: Vec2[] = Array.from({ length: N }, (_, k) => ({ x: start.x - k * 0.25, y: start.y }));
  let vel = { x: 6, y: 2 };
  let t = 0;
  let wrapT = 0;
  let wrapAng = 0;
  let targetId: number | null = null;
  return {
    update(c, dt) {
      t += dt;
      const head = segs[0]!;
      const dummies = c.physics.dummies();
      let target = dummies.find((d) => d.id === targetId);
      if (!target) {
        target = dummies.sort((a, b) => dist(a.center, head) - dist(b.center, head))[0];
        targetId = target?.id ?? null;
        wrapT = 0;
      }
      let goal: Vec2;
      if (target && dist(target.center, head) < 1.4) {
        // Wrap: orbit tightly around the target and constrict.
        wrapT += dt;
        wrapAng += dt * 7;
        goal = add(target.center, fromAngle(wrapAng, 0.7));
        for (const id of target.parts) {
          const b = c.physics.info(id);
          if (!b) continue;
          c.physics.push(id, scale(sub(target.center, b.pos), 6 * dt));
          c.physics.damage(id, 4 * dt * c.mult, 'dragon');
        }
        if (Math.random() < dt * 2) c.status.apply(target.parts[Math.floor(Math.random() * target.parts.length)]!, 'burning', 3);
        if (wrapT > 2.5) {
          explode(c, target.center, 2.2, 0.7, { color, fire: false });
          targetId = null;
          vel = scale(fromAngle(Math.random() * 6.3), 14);
        }
      } else goal = target ? target.center : add(start, fromAngle(t, 3));
      const d = sub(goal, head);
      const l = Math.max(0.01, Math.hypot(d.x, d.y));
      vel = add(scale(vel, 0.92), scale(d, (Math.min(l, 4) / l) * 60 * dt));
      vel = add(vel, scale(perp(norm(vel)), Math.sin(t * 6) * 8 * dt));
      const sp = Math.hypot(vel.x, vel.y);
      if (sp > 16) vel = scale(vel, 16 / sp);
      segs[0] = add(head, scale(vel, dt));
      for (let k = 1; k < N; k++) {
        const a = segs[k - 1]!;
        const b = segs[k]!;
        const dd = sub(b, a);
        const ll = Math.max(1e-4, Math.hypot(dd.x, dd.y));
        segs[k] = add(a, scale(dd, 0.22 / ll));
      }
      // Draw a tapered glowing ribbon.
      for (let k = 0; k < N - 1; k++) {
        const w = 0.32 * (1 - k / N) + 0.04;
        c.fx.line(segs[k]!, segs[k + 1]!, { color, width: w, life: dt * 1.6, alpha: 0.9 });
        if (k % 4 === 0) c.fx.line(segs[k]!, segs[k + 1]!, { color: 0xffffff, width: w * 0.35, life: dt * 1.6 });
      }
      const h = segs[0]!;
      const fwd = norm(vel);
      c.fx.light(h, { color, radius: 1.6, life: dt * 1.6, intensity: 0.8 });
      c.fx.line(h, add(h, add(scale(fwd, -0.4), scale(perp(fwd), 0.35))), { color, width: 0.05, life: dt * 1.6 });
      c.fx.line(h, add(h, add(scale(fwd, -0.4), scale(perp(fwd), -0.35))), { color, width: 0.05, life: dt * 1.6 });
      if (Math.random() < 0.5) c.fx.burst('ember', segs[Math.floor(Math.random() * N)]!, { count: 1, color });
      // Body contact pushes things aside.
      if (Math.random() < 0.3) for (const id of c.physics.bodiesIn(h, 0.5)) c.physics.push(id, scale(fwd, 3));
      return t < life;
    },
    dispose(c) {
      for (const s of segs) c.fx.burst('glow', s, { count: 1, color });
    },
  };
}

export const spiritDragon: Power = {
  id: 'spiritDragon',
  name: 'Spirit Dragon',
  category: 'Archetypes',
  icon: 'icon/dragon-spiral',
  description: 'A serpentine spirit that chases dummies, coils around them and bursts.',
  palette: { primary: 0x52ffb8, secondary: 0xc8ffe8, core: 0xffffff },
  subs: [
    {
      id: 'dragon.summon', name: 'Summon dragon', description: 'Release the spirit dragon at the cursor.', input: 'click', cooldown: 5, cost: 40,
      params: { duration: { default: 12, min: 3, max: 30 } },
      onCast(ctx, i) {
        ctx.spawn(dragonEntity(i.pos, ctx.params.duration!, 0x52ffb8));
        ctx.audio.play('roar', { pos: i.pos });
        ctx.fx.flash(0x52ffb8, 0.15);
      },
    },
    {
      id: 'dragon.roar', name: 'Dragon roar', description: 'A cone of spirit flame that blows targets away.', input: 'drag-aim', cooldown: 1.5, cost: 18,
      params: {},
      onCast(ctx, i) {
        ctx.fx.burst('flame', i.origin, { count: 40, dir: i.dir, spread: 0.6, speed: 14, color: 0x52ffb8, size: 1.2 });
        for (const id of ctx.physics.bodiesIn(add(i.origin, scale(i.dir, 3)), 3)) {
          ctx.physics.push(id, scale(i.dir, 14 * ctx.mult));
          ctx.physics.damage(id, 20 * ctx.mult, 'dragon');
          if (Math.random() < 0.5) ctx.status.apply(id, 'burning', 3);
        }
        ctx.fx.shake(0.2);
        ctx.audio.play('roar', { pos: i.origin, pitch: 1.2 });
      },
    },
  ],
};

// ============================================================== DIMENSIONAL SLASH
export const dimensionalSlash: Power = {
  id: 'dimensionalSlash',
  name: 'Dimensional Slash',
  category: 'Archetypes',
  icon: 'icon/portal',
  description: 'Cut a rift in space. It drags nearby objects in and spits them out of a second rift above.',
  palette: { primary: 0xd36bff, secondary: 0x14051f, core: 0xffffff },
  subs: [
    {
      id: 'rift.slash', name: 'Rift slash', description: 'Drag a line to cut a rift. Anything crossing it is sliced; nearby objects get pulled through.', input: 'drag-aim', cooldown: 2, cost: 30,
      params: { duration: { default: 4, min: 1, max: 12 }, pull: { default: 14, min: 0, max: 50 } },
      onCast(ctx, i) {
        const len = Math.max(3, Math.min(10, i.dist));
        const a = i.origin;
        const b = add(i.origin, scale(i.dir, len));
        const v = ctx.physics.view();
        const exitC = { x: (a.x + b.x) / 2, y: v.y + v.h / 2 - 1.5 };
        const exitA = add(exitC, { x: -1.5, y: 0 });
        const exitB = add(exitC, { x: 1.5, y: 0 });
        // Initial cut
        for (const h of ctx.physics.bodiesOnSegment(a, b)) {
          ctx.physics.cut(h.id, h.point, i.dir);
          ctx.physics.damage(h.id, 40 * ctx.mult, 'rift', h.point);
        }
        ctx.fx.flash(0xd36bff, 0.25);
        ctx.fx.chroma(1);
        ctx.audio.play('slash', { pos: a, pitch: 0.7 });
        ctx.audio.play('warp', { pos: a });
        const cooldownIds = new Map<number, number>();
        const drawRift = (c: PowerCtx, p: Vec2, q: Vec2, dt: number) => {
          const n = perp(norm(sub(q, p)));
          const mid = lerpV(p, q, 0.5);
          const open = 0.12 + Math.sin(c.time * 20) * 0.03;
          c.fx.line(p, add(mid, scale(n, open)), { color: 0xd36bff, width: 0.08, life: dt * 1.6 });
          c.fx.line(add(mid, scale(n, open)), q, { color: 0xd36bff, width: 0.08, life: dt * 1.6 });
          c.fx.line(p, add(mid, scale(n, -open)), { color: 0xd36bff, width: 0.08, life: dt * 1.6 });
          c.fx.line(add(mid, scale(n, -open)), q, { color: 0xd36bff, width: 0.08, life: dt * 1.6 });
          c.fx.light(mid, { color: 0xd36bff, radius: dist(p, q) * 0.6, life: dt * 1.6, intensity: 0.5 });
          if (Math.random() < 0.4) c.fx.burst('pixel', lerpV(p, q, Math.random()), { count: 1, color: 0xd36bff });
        };
        ctx.spawn(timed(ctx.params.duration!, (c, dt) => {
          drawRift(c, a, b, dt);
          drawRift(c, exitA, exitB, dt);
          for (const [id, t] of cooldownIds) if (t - dt <= 0) cooldownIds.delete(id);
          else cooldownIds.set(id, t - dt);
          for (const id of c.physics.bodiesIn(lerpV(a, b, 0.5), len / 2 + 3)) {
            if (cooldownIds.has(id)) continue;
            const info = c.physics.info(id);
            if (!info) continue;
            const { d, t } = segmentDistance(info.pos, a, b);
            const near = lerpV(a, b, t);
            if (d < 0.35) {
              const out = lerpV(exitA, exitB, t);
              c.physics.teleport(id, add(out, { x: 0, y: -0.4 }));
              c.physics.setVelocity(id, { x: (Math.random() - 0.5) * 3, y: -6 });
              cooldownIds.set(id, 1.5);
              if (info.dummy !== undefined) for (const d2 of c.physics.dummies().find((x) => x.id === info.dummy)?.parts ?? []) cooldownIds.set(d2, 1.5);
              c.fx.burst('pixel', out, { count: 8, color: 0xd36bff });
              c.audio.play('teleport', { pos: out, volume: 0.5 });
            } else c.physics.push(id, scale(norm(sub(near, info.pos)), (c.params.pull! * dt) / Math.max(1, d)));
          }
        }));
      },
    },
    {
      id: 'rift.cross', name: 'Cross cut', description: 'Two instant crossing cuts that sever everything at the cursor.', input: 'click', cooldown: 1, cost: 15,
      params: {},
      onCast(ctx, i) {
        for (const ang of [Math.PI / 4, -Math.PI / 4]) {
          const d = fromAngle(ang, 1.6);
          const a = sub(i.pos, d);
          const b = add(i.pos, d);
          ctx.fx.line(a, b, { color: 0xd36bff, width: 0.1, life: 0.35 });
          ctx.fx.line(a, b, { color: 0xffffff, width: 0.03, life: 0.35 });
          for (const h of ctx.physics.bodiesOnSegment(a, b)) {
            ctx.physics.cut(h.id, h.point, norm(d));
            ctx.physics.damage(h.id, 30 * ctx.mult, 'rift', h.point);
            ctx.chaos(30);
          }
        }
        ctx.fx.hitStop(80);
        ctx.fx.chroma(0.7);
        ctx.audio.play('slash', { pos: i.pos, pitch: 1.2 });
      },
    },
  ],
};

// ============================================================== LIMITER BREAK
export const limiterBreak: Power = {
  id: 'limiterBreak',
  name: 'Limiter Break',
  category: 'Archetypes',
  icon: 'icon/fire-ring',
  description: 'Break your limits: every other power hits harder, recharges faster and costs less for a short time.',
  palette: { primary: 0xffd23a, secondary: 0xff6a1a, core: 0xffffff },
  subs: [
    {
      id: 'limiter.break', name: 'Break limits', description: 'Boost all powers for 10 s (screen aura).', input: 'click', cooldown: 20, cost: 0,
      params: { duration: { default: 10, min: 2, max: 30 }, multiplier: { default: 1.7, min: 1.1, max: 3 } },
      onCast(ctx, i) {
        ctx.setLimiter(ctx.params.duration!, ctx.params.multiplier!);
        ctx.fx.aura(0xffd23a, ctx.params.duration!);
        ctx.fx.flash(0xffd23a, 0.4);
        ctx.fx.chroma(1);
        ctx.fx.shake(0.3);
        ctx.fx.ring(i.pos, { color: 0xffd23a, radius: 6, life: 0.6, width: 0.3 });
        ctx.fx.burst('ember', i.pos, { count: 40, speed: 10, color: 0xffd23a });
        ctx.audio.play('powerUp');
      },
    },
    {
      id: 'limiter.release', name: 'Release', description: 'Dump the stored power in one huge golden blast.', input: 'click', cooldown: 6, cost: 50,
      params: {},
      onCast(ctx, i) {
        explode(ctx, i.pos, 5, 1.6 * ctx.mult, { color: 0xffd23a, fire: false, big: true });
        radialPush(ctx, i.pos, 9, 12);
      },
    },
  ],
};
