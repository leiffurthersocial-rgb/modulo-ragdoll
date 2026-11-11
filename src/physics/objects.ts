// Spawnable sandbox objects and arena geometry.
import type { Vec2 } from '../core/math';
import { spawnDummy } from './ragdoll';
import type { BodyRec, BodySpec, PhysicsWorld, RopeRec } from './world';

export type SpawnKind =
  | 'dummy'
  | 'dummyGroup'
  | 'dummyRain'
  | 'crate'
  | 'ball'
  | 'plank'
  | 'barrel'
  | 'oilbarrel'
  | 'tnt'
  | 'boulder'
  | 'wall'
  | 'platform'
  | 'rope';

export const SPAWN_LABELS: Record<SpawnKind, string> = {
  dummy: 'Dummy',
  dummyGroup: 'Dummy group',
  dummyRain: 'Dummy rain',
  crate: 'Crate',
  ball: 'Ball',
  plank: 'Plank',
  barrel: 'Metal barrel',
  oilbarrel: 'Oil barrel',
  tnt: 'TNT',
  boulder: 'Boulder',
  wall: 'Wall',
  platform: 'Platform',
  rope: 'Rope',
};

export function objectSpec(kind: Exclude<SpawnKind, 'dummy' | 'dummyGroup' | 'dummyRain' | 'rope'>, p: Vec2): BodySpec {
  switch (kind) {
    case 'crate':
      return { kind: 'crate', shape: { type: 'box', hw: 0.35, hh: 0.35, round: 0.03 }, material: 'wood', x: p.x, y: p.y, hp: 120 };
    case 'ball':
      return { kind: 'ball', shape: { type: 'ball', r: 0.3 }, material: 'rubber', x: p.x, y: p.y, hp: 200 };
    case 'plank':
      return { kind: 'plank', shape: { type: 'box', hw: 1.2, hh: 0.07, round: 0.02 }, material: 'wood', x: p.x, y: p.y, hp: 90 };
    case 'barrel':
      return { kind: 'barrel', shape: { type: 'box', hw: 0.28, hh: 0.4, round: 0.08 }, material: 'metal', x: p.x, y: p.y, hp: 260 };
    case 'oilbarrel':
      return { kind: 'oilbarrel', shape: { type: 'box', hw: 0.28, hh: 0.4, round: 0.08 }, material: 'metal', x: p.x, y: p.y, hp: 160, explosive: true };
    case 'tnt':
      return { kind: 'tnt', shape: { type: 'box', hw: 0.3, hh: 0.22, round: 0.02 }, material: 'explosive', x: p.x, y: p.y, hp: 40, explosive: true };
    case 'boulder':
      return { kind: 'boulder', shape: { type: 'ball', r: 0.55 }, material: 'stone', x: p.x, y: p.y, hp: 600 };
    case 'wall':
      return { kind: 'wall', shape: { type: 'box', hw: 0.2, hh: 1.8 }, material: 'static', x: p.x, y: p.y + 1.8, isStatic: true };
    case 'platform':
      return { kind: 'platform', shape: { type: 'box', hw: 2, hh: 0.15 }, material: 'static', x: p.x, y: p.y, isStatic: true };
  }
}

export function spawnRope(world: PhysicsWorld, anchor: Vec2, segments = 14, withCrate = true): RopeRec {
  const id = Math.floor(Math.random() * 1e9);
  const rope: RopeRec = { id, anchor, segments, bodies: [] };
  world.ropes.set(id, rope);
  const a = world.createBody({ kind: 'anchor', shape: { type: 'ball', r: 0.08 }, material: 'static', x: anchor.x, y: anchor.y, isStatic: true });
  a.rope = id;
  rope.bodies.push(a.id);
  const segLen = 0.22;
  let prev: BodyRec = a;
  for (let i = 0; i < segments; i++) {
    const y = anchor.y - segLen * (i + 0.5);
    const seg = world.createBody({ kind: 'rope', shape: { type: 'capsule', hh: segLen / 2 - 0.03, r: 0.035 }, material: 'wood', x: anchor.x, y, hp: 140, density: 4 });
    seg.rope = id;
    rope.bodies.push(seg.id);
    world.createRevolute(prev, seg, { x: anchor.x, y: y + segLen / 2 }, { breakStretch: 0.12, rope: id });
    prev = seg;
  }
  if (withCrate) {
    const endY = anchor.y - segLen * segments;
    const c = world.createBody({ ...objectSpec('crate', { x: anchor.x, y: endY - 0.36 }) });
    c.rope = id;
    rope.bodies.push(c.id);
    world.createRevolute(prev, c, { x: anchor.x, y: endY }, { breakStretch: 0.15, rope: id });
  }
  return rope;
}

/** Spawn by kind at a world point. Returns the created body ids (dummies: all part ids). */
export function spawn(world: PhysicsWorld, kind: SpawnKind, p: Vec2, viewTop = 12): number[] {
  switch (kind) {
    case 'dummy': {
      const d = spawnDummy(world, p.x, p.y - 0.9);
      return Object.values(d.parts) as number[];
    }
    case 'dummyGroup': {
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) ids.push(...(Object.values(spawnDummy(world, p.x + (i - 2) * 0.75, p.y - 0.9 + (i % 2) * 0.1).parts) as number[]));
      return ids;
    }
    case 'dummyRain': {
      const ids: number[] = [];
      for (let i = 0; i < 6; i++) {
        const d = spawnDummy(world, p.x + (Math.random() - 0.5) * 8, viewTop + i * 2.2, { vy: -2 });
        ids.push(...(Object.values(d.parts) as number[]));
      }
      return ids;
    }
    case 'rope':
      return spawnRope(world, p).bodies;
    default:
      return [world.createBody(objectSpec(kind, p)).id];
  }
}

// ------------------------------------------------------------------ arenas
export type ArenaId = 'flat' | 'pit' | 'tower' | 'box' | 'space';

export interface ArenaDef {
  id: ArenaId;
  name: string;
  gravity: number;
  backdrop: string;
  /** Camera framing: centre and visible height (m). */
  view: { x: number; y: number; h: number };
  build(world: PhysicsWorld): void;
}

const ground = (world: PhysicsWorld, x: number, y: number, hw: number, hh: number) =>
  world.createBody({ kind: 'static', shape: { type: 'box', hw, hh }, material: 'static', x, y, isStatic: true });

export const ARENAS: Record<ArenaId, ArenaDef> = {
  flat: {
    id: 'flat',
    name: 'Flat floor',
    gravity: -9.81,
    backdrop: 'backdrop/bd_night_field',
    view: { x: 0, y: 4, h: 12 },
    build(w) {
      ground(w, 0, -6, 60, 6);
    },
  },
  pit: {
    id: 'pit',
    name: 'Pit',
    gravity: -9.81,
    backdrop: 'backdrop/bd_industrial',
    view: { x: 0, y: 1.5, h: 15 },
    build(w) {
      ground(w, -22, -6, 18, 6);
      ground(w, 22, -6, 18, 6);
      ground(w, 0, -12, 4.2, 6);
      ground(w, -4.2, -4, 0.2, 3);
      ground(w, 4.2, -4, 0.2, 3);
    },
  },
  tower: {
    id: 'tower',
    name: 'Tall tower',
    gravity: -9.81,
    backdrop: 'backdrop/bd_night_city',
    view: { x: 0, y: 8, h: 20 },
    build(w) {
      ground(w, 0, -6, 60, 6);
      ground(w, -1.6, 7.5, 0.25, 7.5);
      ground(w, 1.6, 7.5, 0.25, 7.5);
      for (let i = 1; i <= 4; i++) {
        ground(w, -3.4, i * 3.4, 1.6, 0.12);
        ground(w, 3.4, i * 3.4 - 1.7, 1.6, 0.12);
      }
      ground(w, 0, 15.1, 2.2, 0.15);
    },
  },
  box: {
    id: 'box',
    name: 'Enclosed box',
    gravity: -9.81,
    backdrop: 'backdrop/bd_industrial',
    view: { x: 0, y: 4.5, h: 11 },
    build(w) {
      ground(w, 0, -6, 9, 6);
      ground(w, 0, 15, 9, 6);
      ground(w, -14, 4.5, 6, 12);
      ground(w, 14, 4.5, 6, 12);
    },
  },
  space: {
    id: 'space',
    name: 'Zero-g space',
    gravity: 0,
    backdrop: 'backdrop/bd_space',
    view: { x: 0, y: 5, h: 14 },
    build(w) {
      // Invisible-ish containment so things don't drift away forever.
      ground(w, 0, -3, 16, 0.3);
      ground(w, 0, 13, 16, 0.3);
      ground(w, -16, 5, 0.3, 8);
      ground(w, 16, 5, 0.3, 8);
    },
  },
};
