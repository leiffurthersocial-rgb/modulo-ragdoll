#!/usr/bin/env tsx
// Downloads permissively licensed assets into .asset-cache/ and writes assets/LICENSES.json.
//
//   npm run assets:fetch                       # everything (skips sources without API keys)
//   npm run assets:fetch -- --only=icons_powers,font_ui
//   npm run assets:fetch -- --only=kenney_scifi --list   # print archive contents (for writing pick maps)
//   npm run assets:fetch -- --refresh          # ignore the download cache
//
// Optional env: FREESOUND_API_KEY, PIXABAY_API_KEY (sources are skipped without them).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SOURCES } from './asset-sources.ts';
import { resolveEntry, SkipError, type Ctx } from './lib/adapters.ts';
import type { FetchedFile, LicenseRecord } from './lib/types.ts';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

const ctx: Ctx = {
  root,
  cache: join(root, '.asset-cache'),
  refresh: flag('refresh'),
  list: flag('list'),
  log: (m) => console.log(m),
};

const licensesPath = join(root, 'assets', 'LICENSES.json');
const fetchedPath = join(ctx.cache, 'fetched.json');

interface Report {
  ok: { id: string; files: number }[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; reason: string }[];
}

async function main(): Promise<void> {
  mkdirSync(ctx.cache, { recursive: true });
  const ids = new Set(SOURCES.map((s) => s.id));
  if (ids.size !== SOURCES.length) throw new Error('Duplicate source ids in asset-sources.ts');
  for (const o of only ?? []) if (!ids.has(o)) throw new Error(`Unknown source id: ${o}`);

  // Keep previous results for entries we don't touch in this run.
  const prevLicenses: LicenseRecord[] = existsSync(licensesPath)
    ? (JSON.parse(readFileSync(licensesPath, 'utf8')).assets ?? [])
    : [];
  const prevFetched: FetchedFile[] = existsSync(fetchedPath) ? JSON.parse(readFileSync(fetchedPath, 'utf8')) : [];
  const selected = SOURCES.filter((s) => !only || only.includes(s.id));
  const touched = new Set(selected.map((s) => s.id));
  const keepRecord = (r: LicenseRecord) => !touched.has(r.pack) && ids.has(r.pack);
  const licenses = prevLicenses.filter(keepRecord);
  const keptIds = new Set(licenses.map((r) => r.id));
  const fetched = prevFetched.filter((f) => keptIds.has(f.id));

  const report: Report = { ok: [], skipped: [], failed: [] };
  for (const entry of selected) {
    process.stdout.write(`- ${entry.id} (${entry.kind}) ... `);
    try {
      const res = await resolveEntry(ctx, entry);
      if (ctx.list) {
        console.log('listed');
        continue;
      }
      if (!res.files.length) throw new Error('no files matched the pick map');
      fetched.push(...res.files);
      licenses.push(...res.records);
      report.ok.push({ id: entry.id, files: res.files.length });
      console.log(`ok (${res.files.length} files)`);
    } catch (err) {
      const reason = (err as Error).message;
      if (err instanceof SkipError) {
        report.skipped.push({ id: entry.id, reason });
        console.log(`skipped: ${reason}`);
      } else {
        report.failed.push({ id: entry.id, reason });
        console.log(`FAILED: ${reason}`);
      }
    }
  }
  if (ctx.list) return;

  // A logical id can only come from one pack: first one wins, later duplicates are dropped.
  const seen = new Set<string>();
  const finalLicenses = licenses
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => a.id.localeCompare(b.id));
  const finalIds = new Set(finalLicenses.map((r) => r.id));
  const seenFiles = new Set<string>();
  const finalFetched = fetched.filter(
    (f) => finalIds.has(f.id) && (seenFiles.has(f.id) ? false : (seenFiles.add(f.id), true)),
  );

  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(
    licensesPath,
    `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), assets: finalLicenses }, null, 2)}\n`,
  );
  writeFileSync(fetchedPath, JSON.stringify(finalFetched, null, 2));
  writeFileSync(join(ctx.cache, 'fetch-report.json'), JSON.stringify(report, null, 2));

  const mb = (finalFetched.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1);
  console.log(`\n${finalLicenses.length} assets licensed, ${mb} MB raw in .asset-cache/`);
  console.log(`ok: ${report.ok.length}  skipped: ${report.skipped.length}  failed: ${report.failed.length}`);
  for (const s of report.skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
  for (const f of report.failed) console.log(`  FAILED  ${f.id}: ${f.reason}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
