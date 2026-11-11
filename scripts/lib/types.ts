import type { LicenseId } from './licenses.ts';

export type Usage = 'backdrop' | 'texture' | 'particle' | 'ui' | 'icon' | 'sfx' | 'music' | 'ambience' | 'font';

export type SourceKind =
  | 'polyhaven'
  | 'ambientcg'
  | 'opengameart'
  | 'gameicons'
  | 'googlefonts'
  | 'freesound'
  | 'pixabay'
  | 'manual';

interface BaseEntry {
  /** Unique id of this source entry; also the cache folder name. */
  id: string;
  kind: SourceKind;
  usage: Usage;
  /** Short note on what the asset is for in the game. */
  purpose: string;
}

export interface PolyHavenEntry extends BaseEntry {
  kind: 'polyhaven';
  asset: string;
  /** 'tonemapped' for HDRI backdrops (LDR jpg), or a texture map name such as 'Diffuse'. */
  map: 'tonemapped' | 'Diffuse' | 'nor_gl' | 'Rough';
  resolution?: '1k' | '2k' | '4k';
}

export interface AmbientCgEntry extends BaseEntry {
  kind: 'ambientcg';
  asset: string;
  variant?: '1K-JPG' | '2K-JPG';
  /** Which maps from the zip to keep, e.g. ['Color', 'NormalGL']. */
  maps: string[];
}

/** Map from archive-internal glob to a logical file id. A trailing '*' in the id is replaced by the file stem. */
export type PickMap = Record<string, string>;

export interface OpenGameArtEntry extends BaseEntry {
  kind: 'opengameart';
  /** Slug after /content/. */
  slug: string;
  /** Only download attachments whose filename matches (default: all). */
  files?: string[];
  pick: PickMap;
}

export interface GameIconsEntry extends BaseEntry {
  kind: 'gameicons';
  /** "author/icon-name" pairs, as in game-icons.net URLs. */
  icons: string[];
}

export interface GoogleFontsEntry extends BaseEntry {
  kind: 'googlefonts';
  family: string;
  weights: number[];
  /** Folder under ofl/ in github.com/google/fonts, used to read designer + license. */
  metadataDir: string;
}

export interface FreesoundEntry extends BaseEntry {
  kind: 'freesound';
  query: string;
  /** Number of results to take. */
  take: number;
  maxDuration: number;
}

export interface PixabayEntry extends BaseEntry {
  kind: 'pixabay';
  query: string;
  take: number;
  imageType: 'photo' | 'illustration';
}

/** Assets the user downloads by hand (Kenney.nl signed links, itch.io). Files go in .asset-cache/manual/<id>/. */
export interface ManualEntry extends BaseEntry {
  kind: 'manual';
  site: 'kenney.nl' | 'itch.io' | 'pixabay.com' | 'other';
  pageUrl: string;
  title: string;
  author: string;
  license: LicenseId;
  /** Expected file name (zip or single file) placed by the user. */
  expectFile: string;
  pick: PickMap;
}

export type SourceEntry =
  | PolyHavenEntry
  | AmbientCgEntry
  | OpenGameArtEntry
  | GameIconsEntry
  | GoogleFontsEntry
  | FreesoundEntry
  | PixabayEntry
  | ManualEntry;

/** One logical asset file that made it through license checks. */
export interface FetchedFile {
  id: string;
  usage: Usage;
  /** Path relative to repo root, inside .asset-cache/. */
  path: string;
  bytes: number;
}

export interface LicenseRecord {
  id: string;
  title: string;
  usage: Usage;
  source: SourceKind;
  sourceUrl: string;
  author: string;
  license: LicenseId;
  licenseName: string;
  licenseUrl: string;
  attributionRequired: boolean;
  /** Attribution text supplied by the author, if any. */
  attributionNotice?: string;
  /** Source entry (pack) this file came from. */
  pack: string;
}

export interface Resolved {
  files: FetchedFile[];
  records: LicenseRecord[];
}
