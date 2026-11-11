// One adapter per source. Each resolves an entry to downloaded files + license records,
// and throws (or returns nothing) if the license is not whitelisted.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { extractPicked, listZip, pickSingle } from './archive.ts';
import { download, getJson, getText } from './http.ts';
import { bestLicense, LICENSES, type LicenseId } from './licenses.ts';
import type {
  AmbientCgEntry,
  FetchedFile,
  FreesoundEntry,
  GameIconsEntry,
  GoogleFontsEntry,
  LicenseRecord,
  ManualEntry,
  OpenGameArtEntry,
  PixabayEntry,
  PolyHavenEntry,
  Resolved,
  SourceEntry,
} from './types.ts';

export interface Ctx {
  root: string;
  cache: string;
  refresh: boolean;
  /** Print archive contents instead of extracting (helps writing pick maps). */
  list: boolean;
  log: (msg: string) => void;
}

export class SkipError extends Error {}

const rel = (ctx: Ctx, p: string) => relative(ctx.root, p).split('\\').join('/');

function record(
  entry: SourceEntry,
  id: string,
  base: Omit<LicenseRecord, 'id' | 'usage' | 'source' | 'pack' | 'licenseName' | 'licenseUrl' | 'attributionRequired'> & {
    license: LicenseId;
  },
): LicenseRecord {
  const info = LICENSES[base.license];
  return {
    id,
    usage: entry.usage,
    source: entry.kind,
    pack: entry.id,
    licenseName: info.name,
    licenseUrl: info.url,
    attributionRequired: info.attributionRequired,
    ...base,
  };
}

function decode(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Return the HTML of the Drupal field block with the given class, up to the next field block. */
function fieldBlock(html: string, cls: string): string {
  const start = html.indexOf(cls);
  if (start < 0) return '';
  const next = html.indexOf('class="field field-name-', start + cls.length);
  return html.slice(start, next < 0 ? undefined : next);
}

// ---------------------------------------------------------------- Poly Haven (CC0, API)
async function polyhaven(ctx: Ctx, e: PolyHavenEntry): Promise<Resolved> {
  const info = await getJson<{ name: string; authors: Record<string, string> }>(
    `https://api.polyhaven.com/info/${e.asset}`,
  );
  const files = await getJson<Record<string, any>>(`https://api.polyhaven.com/files/${e.asset}`);
  let url: string | undefined;
  if (e.map === 'tonemapped') url = files.tonemapped?.url;
  else url = files[e.map]?.[e.resolution ?? '1k']?.jpg?.url;
  if (!url) throw new Error(`Poly Haven: no ${e.map} file for ${e.asset}`);
  const dest = join(ctx.cache, 'files', e.id, `${e.asset}_${e.map}${extname(new URL(url).pathname)}`);
  const dl = await download(url, dest, { refresh: ctx.refresh });
  const id = `${e.usage}/${e.id}`;
  return {
    files: [{ id, usage: e.usage, path: rel(ctx, dl.path), bytes: dl.bytes }],
    records: [
      record(e, id, {
        title: info.name,
        sourceUrl: `https://polyhaven.com/a/${e.asset}`,
        author: Object.keys(info.authors).join(', '),
        license: 'CC0-1.0',
      }),
    ],
  };
}

// ---------------------------------------------------------------- ambientCG (CC0, API)
async function ambientcg(ctx: Ctx, e: AmbientCgEntry): Promise<Resolved> {
  const variant = e.variant ?? '1K-JPG';
  const data = await getJson<any>(
    `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(e.asset)}&include=downloadData`,
  );
  const asset = data.foundAssets?.[0];
  if (!asset) throw new Error(`ambientCG: asset ${e.asset} not found`);
  const downloads: any[] = asset.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
  const dlInfo = downloads.find((d) => d.attribute === variant);
  if (!dlInfo) throw new Error(`ambientCG: no ${variant} zip for ${e.asset}`);
  const zip = join(ctx.cache, 'downloads', e.id, `${e.asset}_${variant}.zip`);
  await download(dlInfo.downloadLink, zip, { refresh: ctx.refresh });
  if (ctx.list) {
    ctx.log(listZip(zip).join('\n'));
    return { files: [], records: [] };
  }
  const pick = Object.fromEntries(e.maps.map((m) => [`*_${m}.jpg`, `${e.usage}/${e.id}_${m.toLowerCase()}`]));
  const out = extractPicked(zip, pick, join(ctx.cache, 'files', e.id));
  const files: FetchedFile[] = out.map((x) => ({ id: x.id, usage: e.usage, path: rel(ctx, x.path), bytes: x.bytes }));
  return {
    files,
    records: files.map((f) =>
      record(e, f.id, {
        title: `${e.asset} (${variant})`,
        sourceUrl: `https://ambientcg.com/view?id=${e.asset}`,
        author: 'ambientCG (Lennart Demes)',
        license: 'CC0-1.0',
      }),
    ),
  };
}

// ---------------------------------------------------------------- OpenGameArt (license parsed per page)
async function opengameart(ctx: Ctx, e: OpenGameArtEntry): Promise<Resolved> {
  const pageUrl = `https://opengameart.org/content/${e.slug}`;
  const html = await getText(pageUrl);
  const title = decode(html.match(/<title>([^<|]+)/)?.[1] ?? e.slug);
  const author =
    decode(fieldBlock(html, 'field-name-author-submitter').match(/href="\/users\/[^"]+"[^>]*>([^<]+)/)?.[1] ?? '') ||
    'unknown';
  const offered = [...fieldBlock(html, 'field-name-field-art-licenses').matchAll(/class='license-name'>([^<]+)</g)].map(
    (m) => m[1]!,
  );
  const license = bestLicense(offered);
  if (!license) throw new SkipError(`OGA ${e.slug}: licenses [${offered.join(', ')}] not whitelisted`);
  const notice = decode(fieldBlock(html, 'field-name-field-art-attribution').replace(/^[^>]*>/, ''))
    .replace(/^Copyright\/Attribution Notice:\s*/i, '')
    .trim();
  const attachments = [
    ...fieldBlock(html, 'field-name-field-art-files').matchAll(
      /href="(https:\/\/opengameart\.org\/sites\/default\/files\/[^"]+)"/g,
    ),
  ]
    .map((m) => m[1]!)
    .filter((u, i, a) => a.indexOf(u) === i)
    .filter((u) => !e.files || e.files.some((f) => decodeURIComponent(basename(u)).toLowerCase() === f.toLowerCase()));
  if (!attachments.length) throw new Error(`OGA ${e.slug}: no matching attachments`);

  const files: FetchedFile[] = [];
  for (const url of attachments) {
    const name = decodeURIComponent(basename(new URL(url).pathname));
    const dest = join(ctx.cache, 'downloads', e.id, name);
    await download(url, dest, { refresh: ctx.refresh });
    if (name.toLowerCase().endsWith('.zip')) {
      if (ctx.list) {
        ctx.log(`${name}:\n  ${listZip(dest).join('\n  ')}`);
        continue;
      }
      for (const x of extractPicked(dest, e.pick, join(ctx.cache, 'files', e.id))) {
        files.push({ id: x.id, usage: e.usage, path: rel(ctx, x.path), bytes: x.bytes });
      }
    } else {
      if (ctx.list) {
        ctx.log(`  ${name}`);
        continue;
      }
      const id = pickSingle(name, e.pick);
      if (!id) continue;
      const out = join(ctx.cache, 'files', e.id, `${id.replace(/\//g, '__')}${extname(name).toLowerCase()}`);
      mkdirSync(join(ctx.cache, 'files', e.id), { recursive: true });
      copyFileSync(dest, out);
      files.push({ id, usage: e.usage, path: rel(ctx, out), bytes: statSync(out).size });
    }
  }
  return {
    files,
    records: files.map((f) =>
      record(e, f.id, {
        title,
        sourceUrl: pageUrl,
        author,
        license,
        ...(notice ? { attributionNotice: notice.slice(0, 500) } : {}),
      }),
    ),
  };
}

// ---------------------------------------------------------------- game-icons.net (CC BY 3.0)
async function gameicons(ctx: Ctx, e: GameIconsEntry): Promise<Resolved> {
  const files: FetchedFile[] = [];
  const records: LicenseRecord[] = [];
  for (const spec of e.icons) {
    const [author, name] = spec.split('/') as [string, string];
    // White glyph on transparent background: we tint at runtime.
    const url = `https://game-icons.net/icons/ffffff/transparent/1x1/${author}/${name}.svg`;
    const dest = join(ctx.cache, 'files', e.id, `${name}.svg`);
    try {
      const dl = await download(url, dest, { refresh: ctx.refresh });
      const id = `icon/${name}`;
      files.push({ id, usage: 'icon', path: rel(ctx, dl.path), bytes: dl.bytes });
      records.push(
        record(e, id, {
          title: name.replace(/-/g, ' '),
          sourceUrl: `https://game-icons.net/1x1/${author}/${name}.html`,
          author: author
            .split('-')
            .map((w) => w[0]!.toUpperCase() + w.slice(1))
            .join(' '),
          license: 'CC-BY-3.0',
        }),
      );
    } catch (err) {
      ctx.log(`    ! icon ${spec}: ${(err as Error).message}`);
    }
  }
  return { files, records };
}

// ---------------------------------------------------------------- Google Fonts (OFL)
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function googlefonts(ctx: Ctx, e: GoogleFontsEntry): Promise<Resolved> {
  const meta = await getText(`https://raw.githubusercontent.com/google/fonts/main/ofl/${e.metadataDir}/METADATA.pb`);
  const designer = meta.match(/designer:\s*"([^"]+)"/)?.[1] ?? 'unknown';
  const lic = meta.match(/license:\s*"([^"]+)"/)?.[1] ?? '';
  const license = bestLicense([lic], { font: true });
  if (!license) throw new SkipError(`Font ${e.family}: license ${lic} not allowed`);
  // css2 returns woff2 only for modern browser UAs. This UA is used solely for the CSS request.
  const css = await getText(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(e.family)}:wght@${e.weights.join(';')}&display=swap`,
    { headers: { 'User-Agent': CHROME_UA } },
  );
  const files: FetchedFile[] = [];
  const blocks = css.split('/*').slice(1);
  for (const b of blocks) {
    if (!b.startsWith(' latin */')) continue; // latin subset only (keeps the download small)
    const weight = b.match(/font-weight:\s*(\d+)/)?.[1];
    const url = b.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!weight || !url) continue;
    const slug = e.family.toLowerCase().replace(/\s+/g, '-');
    const dest = join(ctx.cache, 'files', e.id, `${slug}-${weight}.woff2`);
    const dl = await download(url, dest, { refresh: ctx.refresh });
    files.push({ id: `font/${slug}-${weight}`, usage: 'font', path: rel(ctx, dl.path), bytes: dl.bytes });
  }
  if (!files.length) throw new Error(`Font ${e.family}: no latin woff2 found`);
  return {
    files,
    records: files.map((f) =>
      record(e, f.id, {
        title: `${e.family} ${f.id.split('-').pop()}`,
        sourceUrl: `https://fonts.google.com/specimen/${e.family.replace(/\s+/g, '+')}`,
        author: designer,
        license,
      }),
    ),
  };
}

// ---------------------------------------------------------------- Freesound (optional, API key)
async function freesound(ctx: Ctx, e: FreesoundEntry): Promise<Resolved> {
  const key = process.env.FREESOUND_API_KEY;
  if (!key) throw new SkipError('FREESOUND_API_KEY not set');
  const filter = `license:("Creative Commons 0" OR "Attribution") duration:[0 TO ${e.maxDuration}]`;
  const url =
    `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(e.query)}` +
    `&filter=${encodeURIComponent(filter)}&sort=rating_desc&page_size=${e.take}` +
    `&fields=id,name,username,license,previews,url`;
  const res = await getJson<{ results: any[] }>(url, { headers: { Authorization: `Token ${key}` } });
  const files: FetchedFile[] = [];
  const records: LicenseRecord[] = [];
  for (const s of res.results) {
    const license = bestLicense([s.license]);
    if (!license) continue;
    const prev = s.previews?.['preview-hq-ogg'] ?? s.previews?.['preview-hq-mp3'];
    if (!prev) continue;
    const dest = join(ctx.cache, 'files', e.id, `fs_${s.id}${extname(new URL(prev).pathname)}`);
    const dl = await download(prev, dest, { refresh: ctx.refresh });
    const id = `${e.usage}/${e.id}_${s.id}`;
    files.push({ id, usage: e.usage, path: rel(ctx, dl.path), bytes: dl.bytes });
    records.push(record(e, id, { title: s.name, sourceUrl: s.url, author: s.username, license }));
  }
  return { files, records };
}

// ---------------------------------------------------------------- Pixabay (optional, API key, images only)
async function pixabay(ctx: Ctx, e: PixabayEntry): Promise<Resolved> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) throw new SkipError('PIXABAY_API_KEY not set');
  const res = await getJson<{ hits: any[] }>(
    `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(e.query)}` +
      `&image_type=${e.imageType}&safesearch=true&per_page=${Math.max(3, e.take)}`,
  );
  const files: FetchedFile[] = [];
  const records: LicenseRecord[] = [];
  for (const h of res.hits.slice(0, e.take)) {
    const dest = join(ctx.cache, 'files', e.id, `px_${h.id}${extname(new URL(h.largeImageURL).pathname)}`);
    const dl = await download(h.largeImageURL, dest, { refresh: ctx.refresh });
    const id = `${e.usage}/${e.id}_${h.id}`;
    files.push({ id, usage: e.usage, path: rel(ctx, dl.path), bytes: dl.bytes });
    records.push(record(e, id, { title: h.tags, sourceUrl: h.pageURL, author: h.user, license: 'Pixabay' }));
  }
  return { files, records };
}

// ---------------------------------------------------------------- Manual (Kenney.nl, itch.io)
async function manual(ctx: Ctx, e: ManualEntry): Promise<Resolved> {
  const placed = join(ctx.cache, 'manual', e.id, e.expectFile);
  if (!existsSync(placed)) {
    throw new SkipError(`manual download needed: ${e.pageUrl} -> ${rel(ctx, placed)}`);
  }
  let out: { id: string; path: string; bytes: number }[];
  if (placed.toLowerCase().endsWith('.zip')) {
    if (ctx.list) {
      ctx.log(listZip(placed).join('\n'));
      return { files: [], records: [] };
    }
    out = extractPicked(placed, e.pick, join(ctx.cache, 'files', e.id));
  } else {
    const id = pickSingle(e.expectFile, e.pick);
    if (!id) return { files: [], records: [] };
    out = [{ id, path: placed, bytes: statSync(placed).size }];
  }
  const files = out.map((x) => ({ id: x.id, usage: e.usage, path: rel(ctx, x.path), bytes: x.bytes }));
  return {
    files,
    records: files.map((f) =>
      record(e, f.id, { title: e.title, sourceUrl: e.pageUrl, author: e.author, license: e.license }),
    ),
  };
}

export async function resolveEntry(ctx: Ctx, e: SourceEntry): Promise<Resolved> {
  switch (e.kind) {
    case 'polyhaven':
      return polyhaven(ctx, e);
    case 'ambientcg':
      return ambientcg(ctx, e);
    case 'opengameart':
      return opengameart(ctx, e);
    case 'gameicons':
      return gameicons(ctx, e);
    case 'googlefonts':
      return googlefonts(ctx, e);
    case 'freesound':
      return freesound(ctx, e);
    case 'pixabay':
      return pixabay(ctx, e);
    case 'manual':
      return manual(ctx, e);
  }
}
