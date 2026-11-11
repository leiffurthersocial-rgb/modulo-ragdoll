import { describe, expect, it } from 'vitest';
import { globToRegExp, logicalId } from '../../scripts/lib/archive.ts';
import { packShelves } from '../../scripts/lib/atlas.ts';

describe('archive picking', () => {
  it('matches globs with ** and character classes', () => {
    expect(globToRegExp('**/click_00[1-5].ogg').test('Audio/click_003.ogg')).toBe(true);
    expect(globToRegExp('**/click_00[1-5].ogg').test('Audio/click_006.ogg')).toBe(false);
    expect(globToRegExp('PNG/spark_0[1-7].png').test('PNG/Rotated/spark_05_rotated.png')).toBe(false);
    expect(globToRegExp('*.wav').test('rain_thunder_loop.wav')).toBe(true);
    expect(globToRegExp('*.wav').test('sub/rain.wav')).toBe(false);
  });

  it('derives logical ids from file stems', () => {
    expect(logicalId('sfx/ui_*', 'Audio/Click_001.ogg')).toBe('sfx/ui_click_001');
    expect(logicalId('music/theme', 'x/whatever.wav')).toBe('music/theme');
  });
});

describe('atlas packer', () => {
  it('places sprites without overlap inside the page', () => {
    const items = Array.from({ length: 70 }, (_, i) => ({ id: `s${i}`, w: 128, h: 128 }));
    const { placed, pages } = packShelves(items, 1024, 2);
    expect(placed).toHaveLength(70);
    expect(pages.length).toBeGreaterThan(1);
    for (const a of placed) {
      const pg = pages[a.page]!;
      expect(a.x + a.w).toBeLessThanOrEqual(pg.w);
      expect(a.y + a.h).toBeLessThanOrEqual(pg.h);
      for (const b of placed) {
        if (a === b || a.page !== b.page) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });
});
