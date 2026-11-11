import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { deserialize, serialize, UndoStack, validateScene } from '../../src/game/save';
import { ARENAS, spawn, spawnRope } from '../../src/physics/objects';
import { PhysicsWorld } from '../../src/physics/world';

beforeAll(async () => {
  await RAPIER.init();
});

function scene() {
  const w = new PhysicsWorld();
  ARENAS.flat.build(w);
  spawn(w, 'dummy', { x: 0, y: 1 });
  spawn(w, 'crate', { x: 2, y: 0.4 });
  spawn(w, 'tnt', { x: -2, y: 0.3 });
  spawn(w, 'platform', { x: 0, y: 4 });
  spawnRope(w, { x: 4, y: 6 }, 8);
  for (let i = 0; i < 30; i++) w.step(1 / 60);
  return w;
}

describe('save / load', () => {
  it('round-trips a scene through JSON', () => {
    const w = scene();
    const d = [...w.dummies.values()][0]!;
    const head = w.bodies.get(d.parts.head!)!;
    w.damage(head.id, 30, 'test');
    head.statuses.set('burning', { time: 3, stacks: 2 });
    w.breakJoint([...d.joints].map((id) => w.joints.get(id)!).find((j) => j.name === 'wristL')!.id);

    const data = serialize(w, 'flat');
    const json = JSON.parse(JSON.stringify(data));
    expect(validateScene(json)).toBe(true);

    const w2 = new PhysicsWorld();
    deserialize(w2, json);
    const again = serialize(w2, 'flat');
    expect(again.dummies).toHaveLength(1);
    expect(again.dummies[0]!.broken).toContain('wristL');
    expect(again.dummies[0]!.parts.head!.hp).toBeCloseTo(data.dummies[0]!.parts.head!.hp, 3);
    expect(again.bodies.map((b) => b.kind).sort()).toEqual(data.bodies.map((b) => b.kind).sort());
    expect(again.ropes).toHaveLength(1);
    const tnt = again.bodies.find((b) => b.kind === 'tnt')!;
    expect(tnt.explosive).toBe(true);
    for (const b of data.bodies) {
      const m = again.bodies.find((x) => x.kind === b.kind && Math.abs(x.x - b.x) < 1e-3 && Math.abs(x.y - b.y) < 1e-3);
      expect(m, `${b.kind} at ${b.x},${b.y}`).toBeTruthy();
    }
  });

  it('rejects invalid or future-version data', () => {
    expect(validateScene(null)).toBe(false);
    expect(validateScene({ v: 99 })).toBe(false);
    expect(validateScene({ v: 1, arena: 'moon', gravity: { x: 0, y: 0 }, bodies: [], dummies: [], ropes: [] })).toBe(false);
  });

  it('undo stack is bounded and LIFO', () => {
    const u = new UndoStack(3);
    const w = scene();
    for (let i = 0; i < 5; i++) {
      w.gravity = { x: 0, y: -i };
      u.push(serialize(w, 'flat'));
    }
    expect(u.size).toBe(3);
    expect(u.pop()!.gravity.y).toBe(-4);
    expect(u.pop()!.gravity.y).toBe(-3);
  });
});
