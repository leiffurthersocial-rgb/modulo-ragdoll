import { describe, expect, it } from 'vitest';
import { bestLicense, normalizeLicense } from '../../scripts/lib/licenses.ts';

describe('license whitelist', () => {
  it.each([
    ['CC0', 'CC0-1.0'],
    ['http://creativecommons.org/publicdomain/zero/1.0/', 'CC0-1.0'],
    ['Creative Commons 0', 'CC0-1.0'],
    ['CC-BY 4.0', 'CC-BY-4.0'],
    ['CC-BY 3.0', 'CC-BY-3.0'],
    ['http://creativecommons.org/licenses/by/3.0/', 'CC-BY-3.0'],
    ['Attribution', 'CC-BY-4.0'],
    ['OGA-BY 3.0', 'OGA-BY-3.0'],
    ['OFL', 'OFL-1.1'],
  ])('accepts %s', (raw, id) => expect(normalizeLicense(raw)).toBe(id));

  it.each([
    'CC-BY-SA 3.0',
    'CC-BY-NC 4.0',
    'Attribution NonCommercial',
    'http://creativecommons.org/licenses/by-nc/3.0/',
    'CC-BY-ND 4.0',
    'GPL 3.0',
    'LGPL 2.1',
    'Sampling+',
    'All rights reserved',
    '',
  ])('rejects %s', (raw) => expect(normalizeLicense(raw)).toBeNull());

  it('picks the most permissive of several offered licenses', () => {
    expect(bestLicense(['CC-BY-SA 3.0', 'GPL 3.0', 'CC-BY 3.0'])).toBe('CC-BY-3.0');
    expect(bestLicense(['CC-BY 4.0', 'CC0'])).toBe('CC0-1.0');
    expect(bestLicense(['GPL 2.0'])).toBeNull();
  });

  it('only allows OFL for fonts', () => {
    expect(bestLicense(['OFL'])).toBeNull();
    expect(bestLicense(['OFL'], { font: true })).toBe('OFL-1.1');
  });
});
