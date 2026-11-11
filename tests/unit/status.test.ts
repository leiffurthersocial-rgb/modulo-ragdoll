import { describe, expect, it } from 'vitest';
import { conductivity, dotDamage, gravityFactor, resolveApply, STATUS_DEFS } from '../../src/status/interactions';
import type { StatusId } from '../../src/status/types';

const flesh = { flammability: 0.45, conductivity: 0.55, metal: false };
const metal = { flammability: 0, conductivity: 1, metal: true };
const set = (...s: StatusId[]) => new Set<StatusId>(s);

describe('status interactions', () => {
  it('fire + ice = steam, both cancel', () => {
    const r = resolveApply(set('frozen'), 'burning', flesh);
    expect(r.apply).toBe(false);
    expect(r.remove).toContain('frozen');
    expect(r.events).toContain('steam');
    const r2 = resolveApply(set('burning'), 'frozen', flesh);
    expect(r2.apply).toBe(false);
    expect(r2.events).toContain('steam');
  });

  it('oil + fire = explosion (either order)', () => {
    expect(resolveApply(set('oiled'), 'burning', flesh).events).toContain('oilExplosion');
    expect(resolveApply(set('burning'), 'oiled', flesh).events).toContain('oilExplosion');
  });

  it('water + lightning = amplified chain with bonus stacks', () => {
    const r = resolveApply(set('soaked'), 'shocked', flesh);
    expect(r.events).toContain('amplifiedChain');
    expect(r.bonusStacks).toBeGreaterThan(0);
    expect(resolveApply(set('shocked'), 'soaked', flesh).events).toContain('amplifiedChain');
  });

  it('water extinguishes fire and soaked bodies cannot ignite', () => {
    expect(resolveApply(set('burning'), 'soaked', flesh).remove).toContain('burning');
    expect(resolveApply(set('soaked'), 'burning', flesh).apply).toBe(false);
  });

  it('soaked + freeze = longer flash freeze', () => {
    const r = resolveApply(set('soaked'), 'frozen', flesh);
    expect(r.durationScale).toBeGreaterThan(1);
    expect(r.events).toContain('flashFreeze');
  });

  it('acid corrodes metal and melts ice', () => {
    expect(resolveApply(set(), 'acid', metal).events).toContain('corrode');
    expect(resolveApply(set('frozen'), 'acid', flesh).remove).toContain('frozen');
    expect(dotDamage('acid', 1, metal)).toBeGreaterThan(dotDamage('acid', 1, flesh));
  });

  it('fire + poison = toxic flare', () => {
    expect(resolveApply(set('poisoned'), 'burning', flesh).events).toContain('toxicFlare');
    expect(resolveApply(set('burning'), 'poisoned', flesh).events).toContain('toxicFlare');
  });

  it('heavy and floating cancel out', () => {
    expect(resolveApply(set('floating'), 'heavy', flesh).apply).toBe(false);
    expect(resolveApply(set('heavy'), 'floating', flesh).events).toContain('neutralize');
  });

  it('non-flammable / non-conductive materials resist', () => {
    expect(resolveApply(set(), 'burning', metal).apply).toBe(false);
    expect(resolveApply(set(), 'shocked', { flammability: 0.3, conductivity: 0, metal: false }).apply).toBe(false);
    expect(resolveApply(set('soaked'), 'shocked', { flammability: 0.3, conductivity: 0, metal: false }).apply).toBe(true);
  });

  it('gravity factor, conductivity and stack caps', () => {
    expect(gravityFactor(['heavy'])).toBe(4);
    expect(gravityFactor(['floating'])).toBeLessThan(0);
    expect(gravityFactor(['stopped', 'heavy'])).toBe(0);
    expect(conductivity(0.1, set('soaked'))).toBeGreaterThan(0.6);
    for (const d of Object.values(STATUS_DEFS)) expect(d.maxStacks).toBeGreaterThanOrEqual(1);
  });
});
