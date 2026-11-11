import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { unzipSync } from 'fflate';
import type { PickMap } from './types.ts';

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      // Character class such as [1-4] passes through unchanged.
      const end = glob.indexOf(']', i);
      if (end < 0) re += '\\[';
      else {
        re += glob.slice(i, end + 1);
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export function stemId(file: string): string {
  return basename(file, extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Resolve the logical id for a matched file: '*' in the target is replaced with the file stem. */
export function logicalId(target: string, file: string): string {
  return target.includes('*') ? target.replace('*', stemId(file)) : target;
}

export interface Extracted {
  id: string;
  path: string;
  bytes: number;
}

/** List entries of a zip (directories excluded). */
export function listZip(zipPath: string): string[] {
  const entries = unzipSync(readFileSync(zipPath), { filter: (f) => !f.name.endsWith('/') });
  return Object.keys(entries);
}

/**
 * Extract the files of `zipPath` matched by `pick` into `outDir`.
 * Only matched entries are inflated, so huge packs stay cheap.
 */
export function extractPicked(zipPath: string, pick: PickMap, outDir: string): Extracted[] {
  const rules = Object.entries(pick).map(([glob, target]) => ({ re: globToRegExp(glob), target }));
  const files = unzipSync(readFileSync(zipPath), {
    filter: (f) => !f.name.endsWith('/') && !f.name.includes('__MACOSX') && rules.some((r) => r.re.test(f.name)),
  });
  mkdirSync(outDir, { recursive: true });
  const out: Extracted[] = [];
  const seen = new Set<string>();
  for (const [name, data] of Object.entries(files)) {
    const rule = rules.find((r) => r.re.test(name));
    if (!rule) continue;
    const id = logicalId(rule.target, name);
    if (seen.has(id)) continue; // first match wins (e.g. duplicate files in sub-folders)
    seen.add(id);
    const path = join(outDir, `${id.replace(/\//g, '__')}${extname(name).toLowerCase()}`);
    writeFileSync(path, data);
    out.push({ id, path, bytes: data.byteLength });
  }
  return out;
}

/** Match a single (non-archive) file name against the pick map. */
export function pickSingle(fileName: string, pick: PickMap): string | null {
  for (const [glob, target] of Object.entries(pick)) {
    if (globToRegExp(glob).test(fileName)) return logicalId(target, fileName);
  }
  return null;
}
