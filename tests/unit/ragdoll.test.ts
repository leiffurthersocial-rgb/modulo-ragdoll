import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnDummy } from '../../src/physics/ragdoll';
import { PhysicsWorld } from '../../src/physics/world';

beforeAll(async () => {
  await RAPIER.init();
});

function scene() {
  const w = new PhysicsWorld();
  w.setSolverIterations(6);
  w.createBody({ kind: 'static', shape: { type: 'box', hw: 60, hh: 1 }, material: 'static', x: 0, y: -1, isStatic: true });
  return w;
}

describe('dummy ragdoll', () => {
  it('stands for a moment, takes no damage at rest and never explodes', () => {
    const w = scene();
    const d = spawnDummy(w, 0, 0);
    let maxSpeed = 0;
    const log: string[] = [];
    for (let i = 0; i < 300; i++) {
      w.step(1 / 60);
      for (const id of Object.values(d.parts)) {
        const v = w.bodies.get(id!)!.rb.linvel();
        maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y));
      }
      if (i % 30 === 0) log.push(`${i}: pelvis y ${w.bodies.get(d.parts.pelvis!)!.cur.y.toFixed(2)}`);
    }
    if (process.env.RAGDOLL_DEBUG) console.log(log.join('\n'));
    expect(w.joints.size).toBe(14);
    for (const id of Object.values(d.parts)) expect(w.bodies.get(id!)!.hp).toBe(w.bodies.get(id!)!.maxHp);
    expect(maxSpeed).toBeLessThan(6);
  });

  it('settles: a pile of 12 dummies is still after 6 s (no jitter)', () => {
    const w = scene();
    const ds = Array.from({ length: 12 }, (_, i) => spawnDummy(w, (i % 4) * 0.5 - 0.75, Math.floor(i / 4) * 2));
    for (let i = 0; i < 360; i++) w.step(1 / 60);
    let ke = 0;
    for (const d of ds) for (const id of Object.values(d.parts)) {
      const b = w.bodies.get(id!);
      if (!b) continue;
      const v = b.rb.linvel();
      ke += v.x * v.x + v.y * v.y;
    }
    expect(Math.sqrt(ke / (ds.length * 15))).toBeLessThan(0.3);
  });

  it('breaks joints under violent force', () => {
    const w = scene();
    const d = spawnDummy(w, 0, 0);
    const head = w.bodies.get(d.parts.head!)!;
    for (let i = 0; i < 30; i++) {
      head.rb.applyImpulse({ x: 0, y: 25 }, true);
      w.step(1 / 60);
    }
    expect(d.broken.size).toBeGreaterThan(0);
  });
});
