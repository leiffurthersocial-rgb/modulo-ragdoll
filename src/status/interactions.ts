// Pure status rules: stacking caps, default durations and pairwise interactions.
// No engine imports, fully unit-tested (tests/unit/status.test.ts).
import type { StatusId } from './types';

export interface StatusDef {
  id: StatusId;
  name: string;
  color: number;
  maxStacks: number;
  /** Default duration (s) when a power doesn't specify one. */
  duration: number;
}

export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  burning: { id: 'burning', name: 'Burning', color: 0xff7a1a, maxStacks: 3, duration: 5 },
  frozen: { id: 'frozen', name: 'Frozen', color: 0x9ff4ff, maxStacks: 1, duration: 6 },
  shocked: { id: 'shocked', name: 'Shocked', color: 0xbfe6ff, maxStacks: 3, duration: 1.6 },
  soaked: { id: 'soaked', name: 'Soaked', color: 0x3d8bff, maxStacks: 1, duration: 10 },
  oiled: { id: 'oiled', name: 'Oiled', color: 0x6b5a2a, maxStacks: 1, duration: 20 },
  poisoned: { id: 'poisoned', name: 'Poisoned', color: 0x7dff4f, maxStacks: 5, duration: 6 },
  acid: { id: 'acid', name: 'Acid', color: 0xc6ff1a, maxStacks: 3, duration: 4 },
  floating: { id: 'floating', name: 'Floating', color: 0xd7b8ff, maxStacks: 1, duration: 5 },
  slowed: { id: 'slowed', name: 'Slowed', color: 0x8899ff, maxStacks: 1, duration: 4 },
  crushed: { id: 'crushed', name: 'Crushed', color: 0xff3d6e, maxStacks: 1, duration: 2 },
  heavy: { id: 'heavy', name: 'Heavy', color: 0xc78bff, maxStacks: 1, duration: 5 },
  stopped: { id: 'stopped', name: 'Time-stopped', color: 0xfff1a8, maxStacks: 1, duration: 3 },
};

export type InteractionKind =
  | 'steam'
  | 'extinguish'
  | 'oilExplosion'
  | 'amplifiedChain'
  | 'flashFreeze'
  | 'brittleShock'
  | 'toxicFlare'
  | 'melt'
  | 'corrode'
  | 'neutralize';

export interface MaterialTraits {
  flammability: number;
  conductivity: number;
  metal: boolean;
}

export interface ApplyResult {
  /** Whether the incoming status ends up on the body. */
  apply: boolean;
  /** Extra stacks to add on top of the requested ones. */
  bonusStacks: number;
  /** Duration multiplier for the incoming status. */
  durationScale: number;
  remove: StatusId[];
  events: InteractionKind[];
}

/**
 * Decide what happens when `incoming` is applied to a body that currently has `existing`.
 * The order of checks matters: explosive / cancelling reactions first.
 */
export function resolveApply(existing: ReadonlySet<StatusId>, incoming: StatusId, mat: MaterialTraits): ApplyResult {
  const r: ApplyResult = { apply: true, bonusStacks: 0, durationScale: 1, remove: [], events: [] };
  const has = (s: StatusId) => existing.has(s);

  switch (incoming) {
    case 'burning':
      if (has('oiled')) {
        r.remove.push('oiled');
        r.events.push('oilExplosion');
        r.bonusStacks = 2;
        break;
      }
      if (has('frozen')) {
        r.apply = false;
        r.remove.push('frozen');
        r.events.push('steam');
        break;
      }
      if (has('soaked')) {
        r.apply = false;
        r.remove.push('soaked');
        r.events.push('steam');
        break;
      }
      if (has('poisoned')) {
        r.remove.push('poisoned');
        r.events.push('toxicFlare');
      }
      if (mat.flammability <= 0) r.apply = false;
      break;
    case 'frozen':
      if (has('burning')) {
        r.apply = false;
        r.remove.push('burning');
        r.events.push('steam');
        break;
      }
      if (has('soaked')) {
        r.remove.push('soaked');
        r.durationScale = 1.8;
        r.events.push('flashFreeze');
      }
      break;
    case 'soaked':
      if (has('burning')) {
        r.remove.push('burning');
        r.events.push('extinguish');
      }
      if (has('shocked')) r.events.push('amplifiedChain');
      if (has('acid')) r.remove.push('acid'); // diluted
      break;
    case 'oiled':
      if (has('burning')) {
        r.remove.push('burning');
        r.events.push('oilExplosion');
      }
      break;
    case 'shocked':
      if (has('soaked')) {
        r.bonusStacks = 2;
        r.durationScale = 1.5;
        r.events.push('amplifiedChain');
      }
      if (has('frozen')) r.events.push('brittleShock');
      if (mat.conductivity <= 0 && !has('soaked')) r.apply = false;
      break;
    case 'poisoned':
      if (has('burning')) {
        r.apply = false;
        r.events.push('toxicFlare');
      }
      break;
    case 'acid':
      if (has('frozen')) {
        r.remove.push('frozen');
        r.events.push('melt');
      }
      if (has('soaked')) r.durationScale = 0.5;
      if (mat.metal) r.events.push('corrode');
      break;
    case 'heavy':
      if (has('floating')) {
        r.apply = false;
        r.remove.push('floating');
        r.events.push('neutralize');
      }
      break;
    case 'floating':
      if (has('heavy')) {
        r.apply = false;
        r.remove.push('heavy');
        r.events.push('neutralize');
      }
      break;
    default:
      break;
  }
  return r;
}

/** Damage per second for damage-over-time statuses. */
export function dotDamage(id: StatusId, stacks: number, mat: MaterialTraits): number {
  switch (id) {
    case 'burning':
      return 9 * stacks * (0.4 + mat.flammability);
    case 'shocked':
      return 12 * stacks;
    case 'poisoned':
      return 4 * stacks;
    case 'acid':
      return 10 * stacks * (mat.metal ? 3 : 1);
    case 'crushed':
      return 30;
    default:
      return 0;
  }
}

/** Gravity multiplier from statuses (1 = normal). */
export function gravityFactor(statuses: Iterable<StatusId>): number {
  let g = 1;
  for (const s of statuses) {
    if (s === 'heavy') g *= 4;
    if (s === 'floating') g = -0.25;
    if (s === 'stopped') return 0;
  }
  return g;
}

/** Effective conductivity (soaked bodies conduct much better). */
export function conductivity(base: number, statuses: ReadonlySet<StatusId>): number {
  return statuses.has('soaked') ? Math.min(1, base + 0.6) : base;
}
