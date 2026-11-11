// Procedural lightning: recursive midpoint displacement with branching. Pure + deterministic
// given an rng, so it is unit-testable and reusable by a 3D renderer.
import type { Vec2 } from '../core/math';

export interface BoltPath {
  points: Vec2[];
  /** 0 = main channel, 1+ = branch generation (thinner, dimmer). */
  level: number;
}

export interface BoltParams {
  /** Subdivision depth of the main channel (2^depth segments). */
  depth: number;
  /** Max sideways displacement as a fraction of the segment length. */
  jitter: number;
  /** Max number of branches spawned off the main channel. */
  branches: number;
  /** Max branch generations. */
  maxLevel: number;
}

export const DEFAULT_BOLT: BoltParams = { depth: 5, jitter: 0.22, branches: 4, maxLevel: 2 };

function displace(a: Vec2, b: Vec2, depth: number, jitter: number, rnd: () => number, out: Vec2[]): void {
  // Iterative midpoint displacement: offset shrinks each level for a fractal look.
  let pts: Vec2[] = [a, b];
  let amp = Math.hypot(b.x - a.x, b.y - a.y) * jitter;
  for (let d = 0; d < depth; d++) {
    const next: Vec2[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      const off = (rnd() * 2 - 1) * amp;
      next.push({ x: (p.x + q.x) / 2 + (-dy / l) * off, y: (p.y + q.y) / 2 + (dx / l) * off }, q);
    }
    pts = next;
    amp *= 0.55;
  }
  for (const p of pts) out.push(p);
}

export function generateBolt(a: Vec2, b: Vec2, params: BoltParams, rnd: () => number): BoltPath[] {
  const paths: BoltPath[] = [];
  const main: Vec2[] = [];
  displace(a, b, params.depth, params.jitter, rnd, main);
  paths.push({ points: main, level: 0 });

  const grow = (from: BoltPath, count: number) => {
    if (from.level >= params.maxLevel) return;
    for (let i = 0; i < count; i++) {
      const idx = 1 + Math.floor(rnd() * Math.max(1, from.points.length - 2));
      const start = from.points[idx]!;
      const end = from.points[Math.min(from.points.length - 1, idx + 1)]!;
      const dirAng = Math.atan2(end.y - start.y, end.x - start.x) + (rnd() - 0.5) * 1.6;
      const remaining = from.points.length - idx;
      const total = Math.hypot(b.x - a.x, b.y - a.y);
      const len = total * (0.12 + rnd() * 0.25) * (remaining / from.points.length + 0.3) * (from.level === 0 ? 1 : 0.6);
      const tip = { x: start.x + Math.cos(dirAng) * len, y: start.y + Math.sin(dirAng) * len };
      const pts: Vec2[] = [];
      displace(start, tip, Math.max(2, params.depth - 2 - from.level), params.jitter * 1.2, rnd, pts);
      const branch = { points: pts, level: from.level + 1 };
      paths.push(branch);
      grow(branch, Math.floor(count / 2));
    }
  };
  grow(paths[0]!, params.branches);
  return paths;
}
