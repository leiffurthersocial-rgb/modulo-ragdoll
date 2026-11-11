// Scene serialisation: versioned JSON used for localStorage slots, export/import and undo.
import { ARENAS, spawnRope, type ArenaId } from '../physics/objects';
import { spawnDummy } from '../physics/ragdoll';
import type { BodyKind, PartName, PhysicsWorld, ShapeDesc } from '../physics/world';
import type { MaterialId } from '../physics/materials';
import type { StatusId } from '../status/types';

export const SCENE_VERSION = 1;

export interface SavedBody {
  kind: BodyKind;
  shape: ShapeDesc;
  material: MaterialId;
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  w: number;
  hp: number;
  maxHp: number;
  scale: number;
  explosive?: boolean;
  lifetime?: number;
  statuses?: [StatusId, number, number][];
}

export interface SavedPart {
  x: number;
  y: number;
  a: number;
  vx: number;
  vy: number;
  w: number;
  hp: number;
}

export interface SavedDummy {
  scale: number;
  color: number;
  broken: string[];
  parts: Partial<Record<PartName, SavedPart>>;
}

export interface SceneData {
  v: number;
  arena: ArenaId;
  gravity: { x: number; y: number };
  bodies: SavedBody[];
  dummies: SavedDummy[];
  ropes: { x: number; y: number; segments: number }[];
}

const SAVEABLE: BodyKind[] = ['crate', 'ball', 'plank', 'barrel', 'oilbarrel', 'tnt', 'boulder', 'wall', 'platform', 'ice', 'debris', 'projectile', 'spike'];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function serialize(world: PhysicsWorld, arena: ArenaId): SceneData {
  const bodies: SavedBody[] = [];
  for (const b of world.bodies.values()) {
    if (b.dummy !== undefined || b.rope !== undefined || !SAVEABLE.includes(b.kind) || b.tags.has('noSave')) continue;
    if (b.kind === 'projectile' && b.material !== 'ice' && b.material !== 'stone') continue;
    const v = b.isStatic ? { x: 0, y: 0 } : b.rb.linvel();
    bodies.push({
      kind: b.kind,
      shape: b.shape,
      material: b.material,
      x: r3(b.cur.x),
      y: r3(b.cur.y),
      a: r3(b.cur.a),
      vx: r3(v.x),
      vy: r3(v.y),
      w: r3(b.isStatic ? 0 : b.rb.angvel()),
      hp: Number.isFinite(b.hp) ? r3(b.hp) : -1,
      maxHp: Number.isFinite(b.maxHp) ? b.maxHp : -1,
      scale: b.scale,
      ...(b.explosive ? { explosive: true } : {}),
      ...(b.lifetime !== undefined ? { lifetime: r3(b.lifetime) } : {}),
      ...(b.statuses.size ? { statuses: [...b.statuses].map(([k, s]) => [k, r3(s.time), s.stacks] as [StatusId, number, number]) } : {}),
    });
  }
  const dummies: SavedDummy[] = [];
  for (const d of world.dummies.values()) {
    const parts: Partial<Record<PartName, SavedPart>> = {};
    for (const [name, id] of Object.entries(d.parts)) {
      const b = id !== undefined ? world.bodies.get(id) : undefined;
      if (!b) continue;
      const v = b.rb.linvel();
      parts[name as PartName] = { x: r3(b.cur.x), y: r3(b.cur.y), a: r3(b.cur.a), vx: r3(v.x), vy: r3(v.y), w: r3(b.rb.angvel()), hp: r3(b.hp) };
    }
    dummies.push({ scale: d.scale, color: d.color, broken: [...d.broken], parts });
  }
  const ropes = [...world.ropes.values()].map((r) => ({ x: r.anchor.x, y: r.anchor.y, segments: r.segments }));
  return { v: SCENE_VERSION, arena, gravity: world.gravity, bodies, dummies, ropes };
}

export function validateScene(data: unknown): data is SceneData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<SceneData>;
  if (d.v !== SCENE_VERSION) return false;
  if (typeof d.arena !== 'string' || !(d.arena in ARENAS)) return false;
  if (!d.gravity || typeof d.gravity.x !== 'number' || typeof d.gravity.y !== 'number') return false;
  if (!Array.isArray(d.bodies) || !Array.isArray(d.dummies) || !Array.isArray(d.ropes)) return false;
  for (const b of d.bodies) if (typeof b.x !== 'number' || typeof b.y !== 'number' || !b.shape || !b.material) return false;
  return true;
}

/** Rebuild a scene (arena geometry included). */
export function deserialize(world: PhysicsWorld, data: SceneData): void {
  world.clearAll();
  ARENAS[data.arena].build(world);
  world.gravity = data.gravity;
  for (const s of data.bodies) {
    const isStatic = s.kind === 'wall' || s.kind === 'platform';

    const b = world.createBody({
      kind: s.kind,
      shape: s.shape,
      material: s.material,
      x: s.x,
      y: s.y,
      angle: s.a,
      vx: s.vx,
      vy: s.vy,
      w: s.w,
      isStatic,
      scale: s.scale,
      ...(s.maxHp > 0 ? { hp: s.maxHp } : {}),
      ...(s.explosive ? { explosive: true } : {}),
      ...(s.lifetime !== undefined ? { lifetime: s.lifetime } : {}),
    });
    if (s.hp >= 0) {
      b.hp = s.hp;
      const f = b.hp / b.maxHp;
      b.damageStage = f < 0.25 ? 3 : f < 0.55 ? 2 : f < 0.85 ? 1 : 0;
    }
    for (const [k, time, stacks] of s.statuses ?? []) b.statuses.set(k, { time, stacks });
  }
  for (const d of data.dummies) {
    const ref = d.parts.pelvis ?? Object.values(d.parts)[0];
    if (!ref) continue;
    spawnDummy(world, ref.x, ref.y - 0.97 * d.scale, { scale: d.scale, color: d.color, broken: d.broken, parts: d.parts });
  }
  for (const r of data.ropes) spawnRope(world, { x: r.x, y: r.y }, r.segments);
}

/** Bounded undo stack of serialised snapshots. */
export class UndoStack {
  private stack: string[] = [];
  constructor(private max = 20) {}
  push(scene: SceneData): void {
    this.stack.push(JSON.stringify(scene));
    if (this.stack.length > this.max) this.stack.shift();
  }
  pop(): SceneData | null {
    const s = this.stack.pop();
    return s ? (JSON.parse(s) as SceneData) : null;
  }
  get size(): number {
    return this.stack.length;
  }
  clear(): void {
    this.stack = [];
  }
}

const SLOT_KEY = (n: number) => `modulo-ragdoll:slot:${n}`;

export function saveSlot(n: number, scene: SceneData): boolean {
  try {
    localStorage.setItem(SLOT_KEY(n), JSON.stringify({ savedAt: Date.now(), scene }));
    return true;
  } catch {
    return false;
  }
}

export function loadSlot(n: number): { savedAt: number; scene: SceneData } | null {
  try {
    const raw = localStorage.getItem(SLOT_KEY(n));
    if (!raw) return null;
    const v = JSON.parse(raw) as { savedAt: number; scene: unknown };
    return validateScene(v.scene) ? { savedAt: v.savedAt, scene: v.scene } : null;
  } catch {
    return null;
  }
}
