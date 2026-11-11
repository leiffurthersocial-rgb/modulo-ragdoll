// Guards against license contamination: every shipped asset needs a LICENSES.json record,
// every shipped file must exist, and CC-BY records must name an author.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import licenses from '../../assets/LICENSES.json';
import manifest from '../../src/generated/asset-manifest.json';
import { groupCredits, type LicenseRecord } from '../../src/ui/credits.ts';

const records = (licenses as { assets: LicenseRecord[] }).assets;
const ids = new Set(records.map((r) => r.id));
const root = join(import.meta.dirname, '..', '..');

type Tier = { images: object; audio: object; fonts: object; atlases: Record<string, { pages: string[]; frames: string[] }> };
const tiers = Object.entries((manifest as { tiers: Record<string, Tier> }).tiers);

describe('asset licensing', () => {
  it('every record is complete', () => {
    for (const r of records) {
      expect(r.sourceUrl, r.id).toMatch(/^https:\/\//);
      expect(r.license, r.id).toBeTruthy();
      if (r.attributionRequired) expect(r.author, r.id).not.toMatch(/^(|unknown)$/);
    }
  });

  it.each(tiers)('every %s-tier asset has a license record and exists on disk', (_tier, t) => {
    const shipped = [
      ...Object.keys(t.images),
      ...Object.keys(t.audio),
      ...Object.keys(t.fonts),
      ...Object.values(t.atlases).flatMap((a) => a.frames),
    ];
    expect(shipped.length).toBeGreaterThan(0);
    for (const id of shipped) expect(ids.has(id), `no license record for ${id}`).toBe(true);
    const urls = JSON.stringify(t).match(/\/media\/[^"]+/g) ?? [];
    for (const u of urls) expect(existsSync(join(root, 'public', u)), u).toBe(true);
  });

  it('no orphan files in public/media', () => {
    const referenced = new Set((JSON.stringify(manifest).match(/\/media\/[^"]+/g) ?? []).map((u) => u));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
      );
    const mediaDir = join(root, 'public', 'media');
    if (!existsSync(mediaDir)) return;
    for (const f of walk(mediaDir)) {
      const url = `/media/${f.slice(mediaDir.length + 1).split('\\').join('/')}`;
      // Atlas images are referenced from their JSON, not from the manifest.
      if (url.includes('/atlas/') && url.endsWith('.webp')) continue;
      expect(referenced.has(url), `orphan ${url}`).toBe(true);
    }
  });

  it('credits list attribution-required packs first and groups icons by author', () => {
    const groups = groupCredits(records);
    const firstFree = groups.findIndex((g) => !g.attributionRequired);
    expect(groups.slice(firstFree).every((g) => !g.attributionRequired)).toBe(true);
    expect(groups.some((g) => g.title === 'Icons by Lorc')).toBe(true);
  });
});
