import { fontUrls } from './manifest';

/** Register the self-hosted fonts (ids look like "font/orbitron-700"). Falls back to system fonts. */
export async function loadFonts(): Promise<void> {
  if (typeof FontFace === 'undefined') return;
  const loads: Promise<unknown>[] = [];
  for (const [id, src] of Object.entries(fontUrls())) {
    const m = id.match(/^font\/(.+)-(\d+)$/);
    if (!m) continue;
    const family = m[1]!.replace(/(^|-)([a-z])/g, (_, s: string, c: string) => (s ? ' ' : '') + c.toUpperCase());
    const face = new FontFace(family, `url(${src}) format("woff2")`, { weight: m[2]!, display: 'swap' });
    document.fonts.add(face);
    loads.push(face.load().catch(() => undefined));
  }
  await Promise.all(loads);
}
