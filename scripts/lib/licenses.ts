// License whitelist and normalisation. Anything not matched here is rejected.
// Policy (see DECISIONS.md D-011): CC0 preferred, CC-BY accepted, OFL for fonts only,
// Pixabay Content License accepted (no attribution required). Rejected: NC, ND, SA, GPL, unknown.

export type LicenseId = 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-3.0' | 'OGA-BY-3.0' | 'OFL-1.1' | 'Pixabay';

export interface LicenseInfo {
  id: LicenseId;
  name: string;
  url: string;
  attributionRequired: boolean;
  /** Lower is preferred when an asset is offered under several licenses. */
  rank: number;
  fontsOnly?: boolean;
}

export const LICENSES: Record<LicenseId, LicenseInfo> = {
  'CC0-1.0': {
    id: 'CC0-1.0',
    name: 'CC0 1.0 Public Domain Dedication',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attributionRequired: false,
    rank: 0,
  },
  Pixabay: {
    id: 'Pixabay',
    name: 'Pixabay Content License',
    url: 'https://pixabay.com/service/license-summary/',
    attributionRequired: false,
    rank: 1,
  },
  'CC-BY-4.0': {
    id: 'CC-BY-4.0',
    name: 'Creative Commons Attribution 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    attributionRequired: true,
    rank: 2,
  },
  'CC-BY-3.0': {
    id: 'CC-BY-3.0',
    name: 'Creative Commons Attribution 3.0',
    url: 'https://creativecommons.org/licenses/by/3.0/',
    attributionRequired: true,
    rank: 3,
  },
  'OGA-BY-3.0': {
    id: 'OGA-BY-3.0',
    name: 'OpenGameArt Attribution 3.0',
    url: 'https://opengameart.org/content/oga-by-30-faq',
    attributionRequired: true,
    rank: 4,
  },
  'OFL-1.1': {
    id: 'OFL-1.1',
    name: 'SIL Open Font License 1.1',
    url: 'https://openfontlicense.org/',
    attributionRequired: true,
    rank: 5,
    fontsOnly: true,
  },
};

/** Map a free-form license label/URL to a whitelisted id, or null if not allowed. */
export function normalizeLicense(raw: string): LicenseId | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // Hard rejects first: anything non-commercial, no-derivatives, share-alike or copyleft.
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|\bsa\b|share-?alike|gpl|sampling\+/.test(s)) return null;
  if (/cc0|publicdomain\/zero|creative commons 0|public domain/.test(s)) return 'CC0-1.0';
  if (/oga-by/.test(s)) return 'OGA-BY-3.0';
  if (/(cc[- ]?by|licenses\/by\/|attribution)[^0-9]*4(\.0)?/.test(s)) return 'CC-BY-4.0';
  if (/(cc[- ]?by|licenses\/by\/|attribution)[^0-9]*3(\.0)?/.test(s)) return 'CC-BY-3.0';
  if (/^attribution$|^cc[- ]?by$/.test(s)) return 'CC-BY-4.0';
  if (/\bofl\b|open font license/.test(s)) return 'OFL-1.1';
  if (/pixabay/.test(s)) return 'Pixabay';
  return null;
}

/** Pick the most permissive whitelisted license from a list of offered licenses. */
export function bestLicense(offered: string[], opts: { font?: boolean } = {}): LicenseId | null {
  let best: LicenseInfo | null = null;
  for (const raw of offered) {
    const id = normalizeLicense(raw);
    if (!id) continue;
    const info = LICENSES[id];
    if (info.fontsOnly && !opts.font) continue;
    if (!best || info.rank < best.rank) best = info;
  }
  return best?.id ?? null;
}
