// Dimension-agnostic power contracts. Nothing in src/powers may import PixiJS or Rapier
// (enforced by tests/unit/powers.test.ts). Powers only talk to these interfaces, so a 3D
// version can re-implement PhysicsAPI / FXAPI / AudioAPI and reuse every definition.
import type { Vec2 } from '../core/math';
import type { StatusId } from '../status/types';

export type BodyId = number;

export interface BodyInfo {
  id: BodyId;
  pos: Vec2;
  vel: Vec2;
  angle: number;
  mass: number;
  radius: number;
  kind: string;
  material: string;
  isStatic: boolean;
  dummy?: number;
  part?: string;
  hp: number;
  maxHp: number;
  conductivity: number;
  flammability: number;
  statuses: StatusId[];
}

export interface DummyInfo {
  id: number;
  center: Vec2;
  parts: BodyId[];
}

export interface PhysicsAPI {
  gravity(): Vec2;
  setGravity(g: Vec2): void;
  bodiesIn(center: Vec2, radius: number): BodyId[];
  bodiesInBox(center: Vec2, hw: number, hh: number, angle: number): BodyId[];
  bodiesOnSegment(a: Vec2, b: Vec2): { id: BodyId; point: Vec2 }[];
  raycast(from: Vec2, dir: Vec2, maxDist: number, includeStatic?: boolean): { id: BodyId; point: Vec2; normal: Vec2; isStatic: boolean } | null;
  info(id: BodyId): BodyInfo | null;
  /** Velocity change (mass independent). */
  push(id: BodyId, dv: Vec2): void;
  /** Raw impulse (mass dependent). */
  impulse(id: BodyId, j: Vec2): void;
  setVelocity(id: BodyId, v: Vec2): void;
  spin(id: BodyId, w: number): void;
  damage(id: BodyId, amount: number, cause: string, point?: Vec2): number;
  breakJointsOf(id: BodyId): number;
  /** Cut a body along a line: boxes/planks split, dummy parts detach. */
  cut(id: BodyId, point: Vec2, dir: Vec2): boolean;
  spawnObject(kind: string, pos: Vec2): BodyId[];
  spawnProjectile(opts: ProjectileOptions): BodyId;
  remove(id: BodyId): void;
  /** Moves the whole dummy when given a part. */
  teleport(id: BodyId, pos: Vec2): void;
  /** Dummy-aware resize. */
  rescale(id: BodyId, factor: number): void;
  clone(id: BodyId, offset: Vec2): BodyId[];
  /** Restore health; dummies are rebuilt whole. */
  heal(id: BodyId): void;
  /** Multiplier channel for power effects on gravity (1 = none). */
  setGravityScale(id: BodyId, scale: number): void;
  dummies(): DummyInfo[];
  allDynamic(): BodyId[];
  /** Replay the last `seconds` backwards for bodies in a circle. */
  rewind(center: Vec2, radius: number, seconds: number): number;
  /** World bounds of the current arena view. */
  view(): { x: number; y: number; w: number; h: number };
}

export interface ProjectileOptions {
  shape: 'ball' | 'box' | 'shard';
  size: number;
  pos: Vec2;
  vel: Vec2;
  material: 'stone' | 'ice' | 'energy' | 'metal' | 'wood';
  gravityScale?: number;
  lifetime?: number;
  hp?: number;
  color?: number;
  angle?: number;
}

export type ParticleKind =
  | 'spark'
  | 'ember'
  | 'flame'
  | 'smoke'
  | 'steam'
  | 'stuffing'
  | 'shard'
  | 'drop'
  | 'dust'
  | 'glow'
  | 'bubble'
  | 'gas'
  | 'snow'
  | 'leaf'
  | 'pixel';

export interface BurstOptions {
  count?: number;
  color?: number;
  speed?: number;
  dir?: Vec2;
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
}

export interface BoltOptions {
  color?: number;
  width?: number;
  branches?: number;
  life?: number;
  jitter?: number;
  /** Seconds between re-randomising the path (flicker). */
  flicker?: number;
}

export interface FXAPI {
  burst(kind: ParticleKind, p: Vec2, opts?: BurstOptions): void;
  bolt(a: Vec2, b: Vec2, opts?: BoltOptions): void;
  beam(a: Vec2, b: Vec2, opts?: { color?: number; width?: number; life?: number; core?: number }): void;
  line(a: Vec2, b: Vec2, opts?: { color?: number; width?: number; life?: number; alpha?: number }): void;
  ring(p: Vec2, opts?: { color?: number; radius?: number; life?: number; width?: number; grow?: boolean }): void;
  zone(p: Vec2, radius: number, opts?: { color?: number; life?: number; alpha?: number }): void;
  light(p: Vec2, opts?: { color?: number; radius?: number; life?: number; intensity?: number }): void;
  flash(color: number, intensity: number): void;
  shake(amount: number): void;
  hitStop(ms: number): void;
  bloomSpike(amount: number): void;
  chroma(amount: number): void;
  text(p: Vec2, s: string, color?: number): void;
  /** Screen-space aura (Limiter Break). */
  aura(color: number, seconds: number): void;
  slowMo(scale: number, seconds: number): void;
  /** Lightning detail scale from quality settings (0.3..1). */
  detail(): number;
}

export type SoundId =
  | 'zap'
  | 'thunder'
  | 'fire'
  | 'fireball'
  | 'explosion'
  | 'bigExplosion'
  | 'freeze'
  | 'shatter'
  | 'wind'
  | 'whoosh'
  | 'rock'
  | 'quake'
  | 'water'
  | 'splash'
  | 'bubble'
  | 'gravity'
  | 'warp'
  | 'charge'
  | 'beam'
  | 'punch'
  | 'slash'
  | 'magic'
  | 'acid'
  | 'gas'
  | 'laser'
  | 'saw'
  | 'heal'
  | 'clone'
  | 'teleport'
  | 'shockwave'
  | 'emp'
  | 'timeStop'
  | 'rewind'
  | 'roar'
  | 'powerUp';

export interface AudioAPI {
  play(id: SoundId, opts?: { pos?: Vec2; volume?: number; pitch?: number; delay?: number }): void;
  /** Start/stop a looping sound keyed by `key`. */
  loop(key: string, id: SoundId | null, opts?: { pos?: Vec2; volume?: number }): void;
}

export interface StatusAPI {
  apply(id: BodyId, s: StatusId, duration?: number, stacks?: number): void;
  has(id: BodyId, s: StatusId): boolean;
  remove(id: BodyId, s: StatusId): void;
}

export type InputMode = 'click' | 'hold' | 'drag-aim' | 'charge-release' | 'toggle' | 'area-select';

export interface ParamSpec {
  default: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
}

export interface CastInput {
  /** Where the press started. */
  origin: Vec2;
  /** Current / release pointer position. */
  pos: Vec2;
  /** Aim direction (origin → pos, or a sensible default). */
  dir: Vec2;
  /** Drag distance. */
  dist: number;
  /** 0..1 for charge-release. */
  charge: number;
  /** Seconds held so far. */
  held: number;
  /** Area for area-select: centre + radius. */
  area?: { center: Vec2; radius: number };
}

export interface PowerEntity {
  /** Toggle sub-abilities find their entities by tag. */
  tag?: string;
  /** Return false to be removed. */
  update(ctx: PowerCtx, dt: number): boolean;
  dispose?(ctx: PowerCtx): void;
}

export interface PowerCtx {
  physics: PhysicsAPI;
  fx: FXAPI;
  audio: AudioAPI;
  status: StatusAPI;
  time: number;
  /** Merged param values (defaults + debug panel overrides). */
  params: Record<string, number>;
  /** Global power multiplier (Limiter Break). */
  mult: number;
  palette: Palette;
  spawn(e: PowerEntity): void;
  entities(tag: string): PowerEntity[];
  /** Add to the chaos score (purely for fun). */
  chaos(points: number): void;
  setLimiter(seconds: number, mult: number): void;
}

export interface Palette {
  primary: number;
  secondary: number;
  core: number;
}

export interface SubAbility {
  id: string;
  name: string;
  description: string;
  input: InputMode;
  cooldown: number;
  cost: number;
  /** Energy per second for hold mode. */
  holdCost?: number;
  /** Seconds to full charge for charge-release. */
  chargeTime?: number;
  params: Record<string, ParamSpec>;
  onCast?(ctx: PowerCtx, input: CastInput): void;
  onHold?(ctx: PowerCtx, input: CastInput, dt: number): void;
  onCharge?(ctx: PowerCtx, input: CastInput, dt: number): void;
  onRelease?(ctx: PowerCtx, input: CastInput): void;
}

export type PowerCategory = 'Elements' | 'Physics' | 'Archetypes' | 'Misc';

export interface Power {
  id: string;
  name: string;
  category: PowerCategory;
  /** Logical icon id from the asset manifest, e.g. 'icon/vortex'. */
  icon: string;
  description: string;
  palette: Palette;
  subs: SubAbility[];
}
