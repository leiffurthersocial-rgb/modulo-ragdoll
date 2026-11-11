// Ring buffer of body transforms for "Rewind small region". Recorded every 2nd step for ~3 s.
// Rewind plays the recorded path backwards kinematically, then hands bodies back to dynamics.
import type { Vec2 } from '../core/math';
import type { PhysicsWorld } from '../physics/world';

interface Frame {
  t: number;
  data: Map<number, [number, number, number]>;
}

export class History {
  private frames: Frame[] = [];
  private stepCount = 0;
  /** Active rewinds: body ids → remaining frames to replay. */
  private active = new Map<number, { frames: [number, number, number][]; i: number }>();
  maxSeconds = 3;

  constructor(private world: PhysicsWorld) {}

  record(): void {
    if (++this.stepCount % 2) return;
    const data = new Map<number, [number, number, number]>();
    for (const b of this.world.bodies.values()) if (!b.isStatic && !this.active.has(b.id)) data.set(b.id, [b.cur.x, b.cur.y, b.cur.a]);
    this.frames.push({ t: this.world.time, data });
    const cutoff = this.world.time - this.maxSeconds;
    while (this.frames.length && this.frames[0]!.t < cutoff) this.frames.shift();
  }

  clear(): void {
    this.frames = [];
    this.active.clear();
  }

  isRewinding(id: number): boolean {
    return this.active.has(id);
  }

  rewind(center: Vec2, radius: number, seconds: number): number {
    const ids = this.world.queryCircle(center, radius).map((b) => b.id);
    const cutoff = this.world.time - seconds;
    const frames = this.frames.filter((f) => f.t >= cutoff).reverse();
    let n = 0;
    for (const id of ids) {
      const path = frames.map((f) => f.data.get(id)).filter((x): x is [number, number, number] => !!x);
      if (path.length < 2) continue;
      // Play back at 3x speed (only every 3rd sample).
      this.active.set(id, { frames: path.filter((_, i) => i % 3 === 0), i: 0 });
      const b = this.world.bodies.get(id);
      b?.rb.setEnabled(false);
      n++;
    }
    return n;
  }

  /** Advance active rewinds (call once per physics step). Returns true while any is running. */
  stepRewinds(): boolean {
    for (const [id, r] of this.active) {
      const b = this.world.bodies.get(id);
      if (!b) {
        this.active.delete(id);
        continue;
      }
      const f = r.frames[r.i++];
      if (!f) {
        b.rb.setEnabled(true);
        b.rb.setLinvel({ x: 0, y: 0 }, true);
        b.rb.setAngvel(0, true);
        this.active.delete(id);
        continue;
      }
      b.rb.setTranslation({ x: f[0], y: f[1] }, false);
      b.rb.setRotation(f[2], false);
      b.cur = { x: f[0], y: f[1], a: f[2] };
    }
    return this.active.size > 0;
  }
}
