import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, POWERS } from '../../src/powers/registry';
import type { InputMode } from '../../src/powers/types';

const MODES: InputMode[] = ['click', 'hold', 'drag-aim', 'charge-release', 'toggle', 'area-select'];
const root = join(import.meta.dirname, '..', '..');

describe('power definitions', () => {
  it('have unique power and sub-ability ids', () => {
    const ids = POWERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const subIds = POWERS.flatMap((p) => p.subs.map((s) => s.id));
    expect(new Set(subIds).size).toBe(subIds.length);
  });

  it('cover every category and the requested power set', () => {
    for (const c of CATEGORIES) expect(POWERS.some((p) => p.category === c)).toBe(true);
    for (const id of ['fire', 'lightning', 'ice', 'wind', 'earth', 'water', 'gravity', 'telekinesis', 'spacetime', 'force',
      'spiritBeam', 'fistBarrage', 'shadowClones', 'bladeAura', 'heavyAura', 'spiritDragon', 'dimensionalSlash', 'limiterBreak',
      'toxins', 'explosives', 'tech', 'manipulate']) expect(POWERS.find((p) => p.id === id), id).toBeTruthy();
    expect(POWERS.find((p) => p.id === 'lightning')!.subs).toHaveLength(6);
    expect(POWERS.find((p) => p.id === 'fire')!.subs).toHaveLength(6);
  });

  it.each(POWERS.map((p) => [p.id, p] as const))('%s is well-formed', (_id, p) => {
    expect(p.name.length).toBeGreaterThan(1);
    expect(p.description.length).toBeGreaterThan(10);
    expect(p.icon).toMatch(/^icon\//);
    for (const c of [p.palette.primary, p.palette.secondary, p.palette.core]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
    }
    expect(p.subs.length).toBeGreaterThan(0);
    for (const s of p.subs) {
      expect(MODES).toContain(s.input);
      expect(s.id.length).toBeGreaterThan(2);
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.cooldown).toBeGreaterThanOrEqual(0);
      expect(s.cost).toBeGreaterThanOrEqual(0);
      // Each input mode needs the matching handler.
      if (s.input === 'hold') expect(typeof s.onHold).toBe('function');
      else expect(typeof s.onCast).toBe('function');
      if (s.input === 'charge-release') expect(s.chargeTime).toBeGreaterThan(0);
      for (const [k, spec] of Object.entries(s.params)) {
        expect(spec.min, `${s.id}.${k}`).toBeLessThanOrEqual(spec.default);
        expect(spec.max, `${s.id}.${k}`).toBeGreaterThanOrEqual(spec.default);
      }
    }
  });

  it('every icon exists in the processed icon atlas', async () => {
    const manifest = (await import('../../src/generated/asset-manifest.json')).default as { tiers: { high: { atlases: Record<string, { frames: string[] }> } } };
    const frames = new Set(manifest.tiers.high.atlases.icons?.frames ?? []);
    for (const p of POWERS) expect(frames.has(p.icon), p.icon).toBe(true);
  });

  it('src/powers never imports PixiJS or Rapier (dimension-agnostic)', () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
    for (const f of walk(join(root, 'src', 'powers'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"](pixi\.js|pixi-filters|@dimforge\/[^'"]+)['"]/);
      expect(src, f).not.toMatch(/from ['"]\.\.\/(\.\.\/)?(render|physics|game|audio)\//);
    }
  });
});
