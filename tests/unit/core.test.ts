import { describe, expect, it } from 'vitest';
import { advance, createLoopState, FIXED_DT, MAX_STEPS } from '../../src/core/loop';
import { rng } from '../../src/core/math';
import { generateBolt } from '../../src/fx/bolt';
import { lowerPreset, PRESETS, Watchdog } from '../../src/game/settings';

describe('fixed-timestep loop', () => {
  it('runs one step per 1/60 s and interpolates the remainder', () => {
    const s = createLoopState();
    expect(advance(s, 1000 / 60 + 0.01).steps).toBe(1);
    const r = advance(s, 8);
    expect(r.steps).toBe(0);
    expect(r.alpha).toBeGreaterThan(0.4);
  });

  it('slow motion scales the input time, not dt', () => {
    const s = createLoopState();
    s.timeScale = 0.25;
    let steps = 0;
    for (let i = 0; i < 60; i++) steps += advance(s, 1000 / 60).steps;
    expect(steps).toBeGreaterThanOrEqual(14);
    expect(steps).toBeLessThanOrEqual(16);
  });

  it('caps steps per frame and drops the backlog (no death spiral)', () => {
    const s = createLoopState();
    expect(advance(s, 1000).steps).toBe(MAX_STEPS);
    expect(s.accumulator).toBeLessThan(FIXED_DT);
  });

  it('pause, hit-stop and frame stepping', () => {
    const s = createLoopState();
    s.paused = true;
    expect(advance(s, 100).steps).toBe(0);
    s.pendingSteps = 1;
    expect(advance(s, 16).steps).toBe(1);
    s.paused = false;
    s.hitStopMs = 50;
    expect(advance(s, 20).steps).toBe(0);
    expect(s.hitStopMs).toBe(30);
  });
});

describe('lightning generator', () => {
  it('is deterministic and connects the endpoints', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const p1 = generateBolt(a, b, { depth: 5, jitter: 0.2, branches: 4, maxLevel: 2 }, rng(7));
    const p2 = generateBolt(a, b, { depth: 5, jitter: 0.2, branches: 4, maxLevel: 2 }, rng(7));
    expect(p1).toEqual(p2);
    const main = p1[0]!;
    expect(main.points).toHaveLength(33);
    expect(main.points[0]).toEqual(a);
    expect(main.points.at(-1)).toEqual(b);
    expect(p1.length).toBeGreaterThan(1);
    expect(p1.every((p) => p.level <= 2)).toBe(true);
  });
});

describe('quality presets & watchdog', () => {
  it('Battery Saver is the cheapest preset', () => {
    const b = PRESETS.battery;
    expect(b.fpsCap).toBe(30);
    expect(b.pixelRatioCap).toBeLessThanOrEqual(1);
    for (const p of Object.values(PRESETS)) {
      expect(b.particles).toBeLessThanOrEqual(p.particles);
      expect(b.solverIterations).toBeLessThanOrEqual(p.solverIterations);
      expect(b.boltDetail).toBeLessThanOrEqual(p.boltDetail);
    }
    expect(b.pauseWhenIdle && b.aggressiveSleep).toBe(true);
  });

  it('watchdog trips only on sustained bad frame times', () => {
    const w = new Watchdog(20, 2);
    let tripped = false;
    for (let i = 0; i < 300; i++) tripped ||= w.sample(i % 30 === 0 ? 80 : 16, 1 / 60);
    expect(tripped).toBe(false);
    for (let i = 0; i < 200 && !tripped; i++) tripped = w.sample(40, 1 / 25);
    expect(tripped).toBe(true);
    expect(lowerPreset('high')).toBe('medium');
    expect(lowerPreset('battery')).toBeNull();
  });
});
