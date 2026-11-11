// Crash-test dummy: 15 parts in a front-view layout, revolute joints with anatomical limits
// and weak position motors that hold a slight slump. Sizes in metres (dummy is ~1.8 m tall).
import type { Vec2 } from '../core/math';
import RAPIER from '@dimforge/rapier2d-compat';
import type { BodyRec, DummyRec, PartName, PhysicsWorld, ShapeDesc } from './world';

interface PartDef {
  name: PartName;
  shape: ShapeDesc;
  /** Rest-pose centre relative to the feet origin. */
  at: Vec2;
  hp: number;
  ccd?: boolean;
}

interface JointDef {
  name: string;
  a: PartName;
  b: PartName;
  at: Vec2;
  limits: [number, number];
  stiffness: number;
  breakStretch: number;
}

export const PARTS: PartDef[] = [
  { name: 'pelvis', shape: { type: 'box', hw: 0.15, hh: 0.085, round: 0.04 }, at: { x: 0, y: 0.97 }, hp: 140 },
  { name: 'torso', shape: { type: 'box', hw: 0.17, hh: 0.25, round: 0.07 }, at: { x: 0, y: 1.3 }, hp: 180 },
  { name: 'head', shape: { type: 'ball', r: 0.125 }, at: { x: 0, y: 1.7 }, hp: 90, ccd: true },
  { name: 'upperArmL', shape: { type: 'capsule', hh: 0.1, r: 0.05 }, at: { x: -0.245, y: 1.36 }, hp: 90 },
  { name: 'upperArmR', shape: { type: 'capsule', hh: 0.1, r: 0.05 }, at: { x: 0.245, y: 1.36 }, hp: 90 },
  { name: 'forearmL', shape: { type: 'capsule', hh: 0.095, r: 0.045 }, at: { x: -0.245, y: 1.07 }, hp: 80 },
  { name: 'forearmR', shape: { type: 'capsule', hh: 0.095, r: 0.045 }, at: { x: 0.245, y: 1.07 }, hp: 80 },
  { name: 'handL', shape: { type: 'ball', r: 0.052 }, at: { x: -0.245, y: 0.87 }, hp: 60, ccd: true },
  { name: 'handR', shape: { type: 'ball', r: 0.052 }, at: { x: 0.245, y: 0.87 }, hp: 60, ccd: true },
  { name: 'thighL', shape: { type: 'capsule', hh: 0.15, r: 0.068 }, at: { x: -0.085, y: 0.69 }, hp: 120 },
  { name: 'thighR', shape: { type: 'capsule', hh: 0.15, r: 0.068 }, at: { x: 0.085, y: 0.69 }, hp: 120 },
  { name: 'shinL', shape: { type: 'capsule', hh: 0.15, r: 0.056 }, at: { x: -0.085, y: 0.29 }, hp: 110 },
  { name: 'shinR', shape: { type: 'capsule', hh: 0.15, r: 0.056 }, at: { x: 0.085, y: 0.29 }, hp: 110 },
  { name: 'footL', shape: { type: 'box', hw: 0.085, hh: 0.035, round: 0.02 }, at: { x: -0.11, y: 0.035 }, hp: 70, ccd: true },
  { name: 'footR', shape: { type: 'box', hw: 0.085, hh: 0.035, round: 0.02 }, at: { x: 0.11, y: 0.035 }, hp: 70, ccd: true },
];

export const JOINTS: JointDef[] = [
  { name: 'spine', a: 'pelvis', b: 'torso', at: { x: 0, y: 1.05 }, limits: [-0.45, 0.45], stiffness: 90, breakStretch: 0.14 },
  { name: 'neck', a: 'torso', b: 'head', at: { x: 0, y: 1.565 }, limits: [-0.6, 0.6], stiffness: 18, breakStretch: 0.1 },
  { name: 'shoulderL', a: 'torso', b: 'upperArmL', at: { x: -0.235, y: 1.48 }, limits: [-2.7, 2.7], stiffness: 5, breakStretch: 0.1 },
  { name: 'shoulderR', a: 'torso', b: 'upperArmR', at: { x: 0.235, y: 1.48 }, limits: [-2.7, 2.7], stiffness: 5, breakStretch: 0.1 },
  { name: 'elbowL', a: 'upperArmL', b: 'forearmL', at: { x: -0.245, y: 1.205 }, limits: [-2.4, 0.05], stiffness: 1.5, breakStretch: 0.09 },
  { name: 'elbowR', a: 'upperArmR', b: 'forearmR', at: { x: 0.245, y: 1.205 }, limits: [-0.05, 2.4], stiffness: 1.5, breakStretch: 0.09 },
  { name: 'wristL', a: 'forearmL', b: 'handL', at: { x: -0.245, y: 0.925 }, limits: [-0.8, 0.8], stiffness: 0.3, breakStretch: 0.07 },
  { name: 'wristR', a: 'forearmR', b: 'handR', at: { x: 0.245, y: 0.925 }, limits: [-0.8, 0.8], stiffness: 0.3, breakStretch: 0.07 },
  { name: 'hipL', a: 'pelvis', b: 'thighL', at: { x: -0.085, y: 0.875 }, limits: [-1.5, 1.0], stiffness: 110, breakStretch: 0.13 },
  { name: 'hipR', a: 'pelvis', b: 'thighR', at: { x: 0.085, y: 0.875 }, limits: [-1.0, 1.5], stiffness: 110, breakStretch: 0.13 },
  { name: 'kneeL', a: 'thighL', b: 'shinL', at: { x: -0.085, y: 0.49 }, limits: [-0.05, 2.4], stiffness: 90, breakStretch: 0.11 },
  { name: 'kneeR', a: 'thighR', b: 'shinR', at: { x: 0.085, y: 0.49 }, limits: [-2.4, 0.05], stiffness: 90, breakStretch: 0.11 },
  { name: 'ankleL', a: 'shinL', b: 'footL', at: { x: -0.085, y: 0.075 }, limits: [-0.55, 0.55], stiffness: 45, breakStretch: 0.08 },
  { name: 'ankleR', a: 'shinR', b: 'footR', at: { x: 0.085, y: 0.075 }, limits: [-0.55, 0.55], stiffness: 45, breakStretch: 0.08 },
];

export const DUMMY_COLORS = [0xffc83d, 0x6fe3ff, 0xff7a59, 0xa7ff6f, 0xd59bff, 0xff6fa8];
let colorIndex = 0;

export interface DummyOptions {
  scale?: number;
  color?: number;
  /** Initial velocity for every part. */
  vx?: number;
  vy?: number;
  /** Skip these joints (restoring a saved dummy). */
  broken?: string[];
  /** Per-part state to restore. */
  parts?: Partial<Record<PartName, { x: number; y: number; a: number; vx: number; vy: number; w: number; hp: number }>>;
}

/** Spawn a dummy standing with its feet at (x, y). Returns the dummy record. */
export function spawnDummy(world: PhysicsWorld, x: number, y: number, opts: DummyOptions = {}): DummyRec {
  const s = opts.scale ?? 1;
  const color = opts.color ?? DUMMY_COLORS[colorIndex++ % DUMMY_COLORS.length]!;
  const id = Math.floor(Math.random() * 1e9);
  const d: DummyRec = { id, parts: {}, joints: new Set(), broken: new Set(opts.broken ?? []), scale: s, color, lastHit: -10 };
  world.dummies.set(id, d);
  const recs: Partial<Record<PartName, BodyRec>> = {};
  for (const p of PARTS) {
    const saved = opts.parts?.[p.name];
    const b = world.createBody({
      kind: 'part',
      shape: p.shape,
      material: 'dummy',
      x: x + p.at.x * s,
      y: y + p.at.y * s,
      scale: s,
      hp: p.hp * Math.sqrt(s),
      ccd: !!p.ccd,
      color,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? 0,
    });
    b.dummy = id;
    b.part = p.name;
    b.rb.setAdditionalSolverIterations(2);
    recs[p.name] = b;
    d.parts[p.name] = b.id;
  }
  for (const j of JOINTS) {
    if (d.broken.has(j.name)) continue;
    const a = recs[j.a]!;
    const b = recs[j.b]!;
    const massScale = s * s;
    const rec = world.createRevolute(a, b, { x: x + j.at.x * s, y: y + j.at.y * s }, {
      limits: j.limits,
      breakStretch: j.breakStretch,
      dummy: id,
      name: j.name,
    });
    // Force-based motors (N·m/rad) hold a slight mannequin posture without active balancing.
    const uj = rec.joint as RAPIER.RevoluteImpulseJoint;
    uj.configureMotorModel(RAPIER.MotorModel.ForceBased);
    uj.configureMotorPosition(0, j.stiffness * massScale * massScale * 0.4, (4 + j.stiffness * 0.25) * massScale * massScale);
  }
  // Restore a saved pose after the joints are built (joint anchors use the rest pose).
  if (opts.parts) {
    for (const p of PARTS) {
      const st = opts.parts[p.name];
      const b = recs[p.name]!;
      if (!st) continue;
      b.rb.setTranslation({ x: st.x, y: st.y }, true);
      b.rb.setRotation(st.a, true);
      b.rb.setLinvel({ x: st.vx, y: st.vy }, true);
      b.rb.setAngvel(st.w, true);
      b.hp = st.hp;
      b.cur = { x: st.x, y: st.y, a: st.a };
      b.prev = { ...b.cur };
      const frac = b.hp / b.maxHp;
      b.damageStage = frac < 0.25 ? 3 : frac < 0.55 ? 2 : frac < 0.85 ? 1 : 0;
    }
  }
  return d;
}

/** Pelvis (or any remaining part) position of a dummy. */
export function dummyCenter(world: PhysicsWorld, d: DummyRec): Vec2 | null {
  const id = d.parts.pelvis ?? d.parts.torso ?? Object.values(d.parts)[0];
  const b = id !== undefined ? world.bodies.get(id) : undefined;
  return b ? { x: b.cur.x, y: b.cur.y } : null;
}

export function dummyHealth(world: PhysicsWorld, d: DummyRec): number {
  let hp = 0;
  let max = 0;
  for (const p of PARTS) {
    const id = d.parts[p.name];
    const b = id !== undefined ? world.bodies.get(id) : undefined;
    max += p.hp * Math.sqrt(d.scale);
    if (b) hp += Math.max(0, b.hp);
  }
  return max > 0 ? hp / max : 0;
}
