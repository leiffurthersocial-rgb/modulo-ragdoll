// Credits data, generated from assets/LICENSES.json (written by scripts/fetch-assets.ts).

export interface LicenseRecord {
  id: string;
  title: string;
  usage: string;
  source: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseName: string;
  licenseUrl: string;
  attributionRequired: boolean;
  attributionNotice?: string;
  pack: string;
}

export interface CreditGroup {
  pack: string;
  title: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
  attributionRequired: boolean;
  notice?: string;
  count: number;
  usage: string;
}

/** Collapse per-file records into one line per pack (icons: per author, fonts: per family), attribution-required first. */
export function groupCredits(records: LicenseRecord[]): CreditGroup[] {
  const groups = new Map<string, CreditGroup>();
  for (const r of records) {
    const key = r.source === 'gameicons' ? `${r.pack}:${r.author}` : r.pack;
    const g = groups.get(key);
    if (g) {
      g.count++;
      continue;
    }
    groups.set(key, {
      pack: r.pack,
      title: r.source === 'gameicons' ? `Icons by ${r.author}` : r.source === 'googlefonts' ? r.title.replace(/\s+\d+$/, '') : r.title,
      author: r.author,
      licenseName: r.licenseName,
      licenseUrl: r.licenseUrl,
      sourceUrl: r.source === 'gameicons' ? 'https://game-icons.net' : r.sourceUrl,
      attributionRequired: r.attributionRequired,
      ...(r.attributionNotice ? { notice: r.attributionNotice } : {}),
      count: 1,
      usage: r.usage,
    });
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.attributionRequired) - Number(a.attributionRequired) || a.title.localeCompare(b.title),
  );
}
