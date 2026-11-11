#!/usr/bin/env tsx
// Converts fetched assets (.asset-cache/fetched.json) into game-ready files under public/media/<tier>/
// and writes src/generated/asset-manifest.json + assets/SIZE-REPORT.md.
//
//   npm run assets:process            # all tiers
//   npm run assets:process -- --tier=low
//
// Images: WebP (always) + KTX2/Basis (only if the `basisu` CLI is on PATH).
// Sprites (particles, icons): packed into atlases (Pixi spritesheet JSON).
// Audio: loudness-normalised, Ogg Vorbis + AAC (.m4a) for Safari.
// Fonts: woff2 copied as-is.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { packShelves } from './lib/atlas.ts';
import type { FetchedFile, LicenseRecord, Usage } from './lib/types.ts';

const root = resolve(import.meta.dirname, '..');
const cache = join(root, '.asset-cache');
const outRoot = join(root, 'public', 'media');
const manifestPath = join(root, 'src', 'generated', 'asset-manifest.json');

type Tier = 'high' | 'low';
const TIERS: Tier[] = ['high', 'low'];

/** Per-tier processing parameters. "high" serves Ultra/High/Medium, "low" serves Low/Battery Saver. */
const SPEC: Record<
  Tier,
  {
    backdropW: number;
    textureW: number;
    particlePx: number;
    iconPx: number;
    webpQ: number;
    atlasMax: number;
    sfxOggQ: number;
    sfxAac: string;
    musicOggQ: number;
    musicAac: string;
    sfxRate: number;
  }
> = {
  high: { backdropW: 2048, textureW: 512, particlePx: 128, iconPx: 128, webpQ: 74, atlasMax: 2048,
    sfxOggQ: 4, sfxAac: '96k', musicOggQ: 4, musicAac: '128k', sfxRate: 44100 },
  low: { backdropW: 1024, textureW: 256, particlePx: 64, iconPx: 96, webpQ: 68, atlasMax: 1024,
    sfxOggQ: 1, sfxAac: '48k', musicOggQ: 1, musicAac: '64k', sfxRate: 32000 },
};

export interface AudioEntry {
  ogg: string;
  m4a: string;
  duration: number;
}
export interface AtlasEntry {
  /** Spritesheet JSON URLs (one per atlas page). */
  pages: string[];
  frames: string[];
}
export interface TierManifest {
  images: Record<string, { webp: string; ktx2?: string; w: number; h: number }>;
  atlases: Record<string, AtlasEntry>;
  audio: Record<string, AudioEntry>;
  fonts: Record<string, string>;
  bytes: Record<string, number>;
}
export interface AssetManifest {
  generated: string;
  tiers: Record<Tier, TierManifest>;
}

const args = process.argv.slice(2);
const tierArg = args.find((a) => a.startsWith('--tier='))?.slice(7) as Tier | undefined;
const hasBasisu = spawnSync('basisu', ['-version']).status === 0;
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

function hashName(buf: Buffer | string, base: string, ext: string): string {
  const h = createHash('sha256').update(buf).digest('hex').slice(0, 10);
  return `${base}.${h}${ext}`;
}

const safe = (id: string) => id.replace(/[^a-z0-9_-]+/gi, '_');

/** Write a buffer into public/media/<tier>/<sub>/ with a content-hashed name; return its public URL. */
function emit(tier: Tier, sub: string, base: string, ext: string, data: Buffer | string): { url: string; bytes: number } {
  const name = hashName(data, safe(base), ext);
  const dir = join(outRoot, tier, sub);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), data);
  return { url: `/media/${tier}/${sub}/${name}`, bytes: Buffer.byteLength(data) };
}

function run(cmd: string, argv: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`${cmd} failed (${code}): ${err.slice(-400)}`))));
  });
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

// ------------------------------------------------------------------ images
async function processImage(tier: Tier, f: FetchedFile, m: TierManifest): Promise<void> {
  const s = SPEC[tier];
  const src = join(root, f.path);
  let img = sharp(src).rotate();
  let width: number;
  if (f.usage === 'backdrop') {
    // Stylise for the neon look: dark, desaturated, softened, slightly cool. Glow stays the star.
    width = s.backdropW;
    img = img
      .resize({ width, withoutEnlargement: true })
      .modulate({ brightness: 0.42, saturation: 0.55 })
      .blur(tier === 'high' ? 1.6 : 1)
      .tint({ r: 150, g: 165, b: 210 });
  } else {
    // Surface detail: greyscale, low contrast; the game tints it per material.
    width = s.textureW;
    img = img.resize({ width, height: width, fit: 'cover' }).greyscale().linear(0.6, 40);
  }
  const { data, info } = await img.webp({ quality: s.webpQ, effort: 5 }).toBuffer({ resolveWithObject: true });
  const base = f.id.split('/').pop()!;
  const webp = emit(tier, f.usage, base, '.webp', data);
  const entry: TierManifest['images'][string] = { webp: webp.url, w: info.width, h: info.height };
  m.bytes[f.usage] = (m.bytes[f.usage] ?? 0) + webp.bytes;
  if (hasBasisu) {
    const tmpPng = join(cache, 'tmp', `${tier}_${safe(f.id)}.png`);
    mkdirSync(dirname(tmpPng), { recursive: true });
    await sharp(data).png().toFile(tmpPng);
    const outKtx = tmpPng.replace(/\.png$/, '.ktx2');
    // high: UASTC (best quality, transcodes to ASTC on iPad); low: ETC1S (much smaller).
    await run('basisu', ['-ktx2', '-mipmap', ...(tier === 'high' ? ['-uastc'] : []), '-output_file', outKtx, tmpPng]);
    const ktx = emit(tier, f.usage, base, '.ktx2', readFileSync(outKtx));
    entry.ktx2 = ktx.url;
    m.bytes[`${f.usage}-ktx2`] = (m.bytes[`${f.usage}-ktx2`] ?? 0) + ktx.bytes;
  }
  m.images[f.id] = entry;
}

// ------------------------------------------------------------------ atlases
async function spriteBuffer(f: FetchedFile, px: number): Promise<Buffer> {
  const src = join(root, f.path);
  if (f.usage === 'icon') {
    return sharp(src, { density: 300 }).resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha().png().toBuffer();
  }
  // Kenney particles are white-on-black: convert luminance to alpha, keep RGB white.
  const lum = await sharp(src).resize(px, px, { fit: 'contain', background: '#000' }).flatten({ background: '#000' })
    .greyscale().raw().toBuffer();
  const rgba = Buffer.alloc(px * px * 4);
  for (let i = 0; i < px * px; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = lum[i]!;
  }
  return sharp(rgba, { raw: { width: px, height: px, channels: 4 } }).png().toBuffer();
}

async function buildAtlas(tier: Tier, name: string, files: FetchedFile[], px: number, m: TierManifest): Promise<void> {
  if (!files.length) return;
  const s = SPEC[tier];
  const sprites = await Promise.all(files.map(async (f) => ({ id: f.id, buf: await spriteBuffer(f, px) })));
  const { placed, pages } = packShelves(sprites.map((sp) => ({ id: sp.id, w: px, h: px })), s.atlasMax, 2);
  const atlas: AtlasEntry = { pages: [], frames: files.map((f) => f.id) };
  for (let p = 0; p < pages.length; p++) {
    const pg = pages[p]!;
    const onPage = placed.filter((pl) => pl.page === p);
    const composite = onPage.map((pl) => ({ input: sprites.find((sp) => sp.id === pl.id)!.buf, left: pl.x, top: pl.y }));
    const img = await sharp({ create: { width: pg.w, height: pg.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(composite).webp({ quality: 90, alphaQuality: 90, effort: 5 }).toBuffer();
    const imgOut = emit(tier, 'atlas', `${name}_${p}`, '.webp', img);
    const sheet = {
      frames: Object.fromEntries(onPage.map((pl) => [pl.id, {
        frame: { x: pl.x, y: pl.y, w: pl.w, h: pl.h }, rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: pl.w, h: pl.h }, sourceSize: { w: pl.w, h: pl.h },
      }])),
      meta: { app: 'modulo-ragdoll process-assets', image: imgOut.url.split('/').pop(), format: 'RGBA8888',
        size: { w: pg.w, h: pg.h }, scale: 1 },
    };
    const json = emit(tier, 'atlas', `${name}_${p}`, '.json', JSON.stringify(sheet));
    atlas.pages.push(json.url);
    m.bytes[name] = (m.bytes[name] ?? 0) + imgOut.bytes + json.bytes;
  }
  m.atlases[name] = atlas;
}

// ------------------------------------------------------------------ audio
function probeDuration(path: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return Number(r.stdout.toString().trim()) || 0;
}

async function processAudio(tier: Tier, f: FetchedFile, m: TierManifest): Promise<void> {
  const s = SPEC[tier];
  const src = join(root, f.path);
  const long = f.usage === 'music' || f.usage === 'ambience';
  const tmp = join(cache, 'tmp', tier);
  mkdirSync(tmp, { recursive: true });
  // Music/ambience: -16 LUFS stereo. SFX: -18 LUFS mono with a -1 dBTP ceiling, so the mixer has headroom.
  const filter = long ? 'loudnorm=I=-16:TP=-1.5:LRA=11' : 'loudnorm=I=-18:TP=-1:LRA=7';
  const channels = long ? '2' : '1';
  const rate = long ? '44100' : String(s.sfxRate);
  const base = f.id.split('/').pop()!;
  const oggTmp = join(tmp, `${safe(f.id)}.ogg`);
  const m4aTmp = join(tmp, `${safe(f.id)}.m4a`);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-af', filter, '-ac', channels, '-ar', rate, '-map_metadata', '-1',
    '-c:a', 'libvorbis', '-q:a', String(long ? s.musicOggQ : s.sfxOggQ), oggTmp]);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-af', filter, '-ac', channels, '-ar', rate, '-map_metadata', '-1',
    '-c:a', 'aac', '-b:a', long ? s.musicAac : s.sfxAac, '-movflags', '+faststart', m4aTmp]);
  const ogg = emit(tier, f.usage, base, '.ogg', readFileSync(oggTmp));
  const m4a = emit(tier, f.usage, base, '.m4a', readFileSync(m4aTmp));
  m.audio[f.id] = { ogg: ogg.url, m4a: m4a.url, duration: Math.round(probeDuration(oggTmp) * 1000) / 1000 };
  m.bytes[`${f.usage}-ogg`] = (m.bytes[`${f.usage}-ogg`] ?? 0) + ogg.bytes;
  m.bytes[`${f.usage}-m4a`] = (m.bytes[`${f.usage}-m4a`] ?? 0) + m4a.bytes;
}

// ------------------------------------------------------------------ main
async function processTier(tier: Tier, files: FetchedFile[]): Promise<TierManifest> {
  const m: TierManifest = { images: {}, atlases: {}, audio: {}, fonts: {}, bytes: {} };
  const by = (u: Usage[]) => files.filter((f) => u.includes(f.usage));
  console.log(`[${tier}] images`);
  await pool(by(['backdrop', 'texture']), 3, (f) => processImage(tier, f, m));
  console.log(`[${tier}] atlases`);
  await buildAtlas(tier, 'particles', by(['particle']), SPEC[tier].particlePx, m);
  await buildAtlas(tier, 'icons', by(['icon']), SPEC[tier].iconPx, m);
  if (hasFfmpeg) {
    console.log(`[${tier}] audio (${by(['sfx', 'ui', 'music', 'ambience']).length} clips)`);
    await pool(by(['sfx', 'ui', 'music', 'ambience']), Math.max(2, cpus().length), (f) => processAudio(tier, f, m));
  } else console.warn('ffmpeg not found: audio skipped (the game falls back to procedural SFX)');
  for (const f of by(['font'])) {
    const r = emit(tier, 'font', f.id.split('/').pop()!, extname(f.path), readFileSync(join(root, f.path)));
    m.fonts[f.id] = r.url;
    m.bytes.font = (m.bytes.font ?? 0) + r.bytes;
  }
  return m;
}

function fmt(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

async function main(): Promise<void> {
  const fetchedPath = join(cache, 'fetched.json');
  if (!existsSync(fetchedPath)) throw new Error('No .asset-cache/fetched.json: run `npm run assets:fetch` first.');
  const fetched: FetchedFile[] = JSON.parse(readFileSync(fetchedPath, 'utf8'));
  const licensed = new Set<string>(
    (JSON.parse(readFileSync(join(root, 'assets', 'LICENSES.json'), 'utf8')).assets as LicenseRecord[]).map((r) => r.id),
  );
  // Never ship a file without a license record.
  const files = fetched.filter((f) => {
    const ok = licensed.has(f.id) && existsSync(join(root, f.path));
    if (!ok) console.warn(`  ! skipping ${f.id} (missing file or license record)`);
    return ok;
  });
  console.log(`${files.length} files. KTX2: ${hasBasisu ? 'yes (basisu)' : 'no (basisu not on PATH, WebP only)'}`);

  const prev: AssetManifest | null = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const tiers = tierArg ? [tierArg] : TIERS;
  const manifest: AssetManifest = {
    generated: new Date().toISOString().slice(0, 10),
    tiers: { high: prev?.tiers.high ?? emptyTier(), low: prev?.tiers.low ?? emptyTier() },
  };
  for (const t of tiers) {
    // Build into a fresh folder and swap it in, so stale hashed files never linger.
    const dir = join(outRoot, t);
    const old = `${dir}.old`;
    if (existsSync(dir)) renameSync(dir, old);
    try {
      manifest.tiers[t] = await processTier(t, files);
      rmSync(old, { recursive: true, force: true });
    } catch (err) {
      rmSync(dir, { recursive: true, force: true });
      if (existsSync(old)) renameSync(old, dir);
      throw err;
    }
  }
  rmSync(join(cache, 'tmp'), { recursive: true, force: true });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);

  // Size report
  const lines = ['# Asset size report', '', `Generated ${manifest.generated} by \`npm run assets:process\`.`, '',
    '"high" is used by Ultra / High / Medium, "low" by Low / Battery Saver. Each audio clip ships as .ogg + .m4a;',
    'a browser downloads only one of them, so the "downloaded" column counts the larger of the two.', '',
    '| Category | high | low |', '|---|---|---|'];
  const cats = [...new Set(TIERS.flatMap((t) => Object.keys(manifest.tiers[t].bytes)))].sort();
  for (const c of cats) lines.push(`| ${c} | ${fmt(manifest.tiers.high.bytes[c] ?? 0)} | ${fmt(manifest.tiers.low.bytes[c] ?? 0)} |`);
  const total = (t: Tier) => Object.values(manifest.tiers[t].bytes).reduce((a, b) => a + b, 0);
  const downloaded = (t: Tier) => {
    const b = manifest.tiers[t].bytes;
    let sum = 0;
    for (const [k, v] of Object.entries(b)) {
      if (k.endsWith('-ogg')) sum += Math.max(v, b[k.replace(/-ogg$/, '-m4a')] ?? 0);
      else if (!k.endsWith('-m4a') && !k.endsWith('-ktx2')) sum += v;
    }
    return sum;
  };
  lines.push(`| **on disk (all formats)** | **${fmt(total('high'))}** | **${fmt(total('low'))}** |`);
  lines.push(`| **downloaded by one browser** | **${fmt(downloaded('high'))}** | **${fmt(downloaded('low'))}** |`);
  writeFileSync(join(root, 'assets', 'SIZE-REPORT.md'), `${lines.join('\n')}\n`);
  console.log(`\n${lines.slice(7).join('\n')}`);
}

function emptyTier(): TierManifest {
  return { images: {}, atlases: {}, audio: {}, fonts: {}, bytes: {} };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
