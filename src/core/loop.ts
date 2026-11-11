// Fixed-timestep driver. Physics always advances in steps of `dt`; the renderer gets an
// interpolation factor. Slow motion scales the real time fed in (never dt), hit-stop freezes it.

export interface LoopState {
  accumulator: number;
  timeScale: number;
  paused: boolean;
  hitStopMs: number;
  pendingSteps: number;
}

export interface LoopResult {
  steps: number;
  alpha: number;
}

export const FIXED_DT = 1 / 60;
export const MAX_STEPS = 5;

export function createLoopState(): LoopState {
  return { accumulator: 0, timeScale: 1, paused: false, hitStopMs: 0, pendingSteps: 0 };
}

/**
 * Advance the loop by `realDtMs` of wall-clock time. Returns how many fixed steps to run now
 * and the interpolation alpha for rendering. Pure: callers run the steps.
 */
export function advance(s: LoopState, realDtMs: number, dt = FIXED_DT): LoopResult {
  const realDt = Math.min(realDtMs, 250) / 1000; // ignore huge gaps (tab switch)
  if (s.pendingSteps > 0) {
    const n = Math.min(s.pendingSteps, MAX_STEPS);
    s.pendingSteps -= n;
    return { steps: n, alpha: 1 };
  }
  if (s.paused) return { steps: 0, alpha: 1 };
  if (s.hitStopMs > 0) {
    s.hitStopMs = Math.max(0, s.hitStopMs - realDtMs);
    return { steps: 0, alpha: s.accumulator / dt };
  }
  s.accumulator += realDt * s.timeScale;
  let steps = 0;
  while (s.accumulator >= dt && steps < MAX_STEPS) {
    s.accumulator -= dt;
    steps++;
  }
  if (steps === MAX_STEPS && s.accumulator > dt) s.accumulator = 0; // drop backlog instead of spiralling
  return { steps, alpha: s.accumulator / dt };
}
