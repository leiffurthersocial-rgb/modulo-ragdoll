# Setup

## Requirements
- Node.js 22+ (developed on 22.23) and npm.
- `ffmpeg` + `ffprobe` on PATH (audio processing). Without them, audio is skipped and the game falls back to procedural SFX.
- Optional: `basisu` ([Basis Universal](https://github.com/BinomialLLC/basis_universal) CLI) on PATH. With it, `process-assets` also writes KTX2 textures; otherwise only WebP.

```bash
npm install
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (also on your LAN, so you can open it on an iPad) |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Serve `dist/` on port 4173 |
| `npm test` | Vitest unit tests |
| `npm run e2e` | Playwright smoke tests (fail on console errors) on desktop, iPad Pro 11 landscape and iPad portrait. Screenshots go to `test-results/screens/` |
| `BENCH=1 npm run e2e -- --project=desktop bench` | Benchmark: 20 dummies + scripted power sequence per preset. avg/p95 frame times go to `test-results/bench.jsonl`. Also available in the browser at `/?bench&preset=high&dummies=20` |

Playwright is pinned to 1.63 to match the Chromium build preinstalled in the cloud sandbox. On your own machine, run `npx playwright install chromium` once.

## Asset pipeline

```bash
npm run assets:fetch     # download + license-check into .asset-cache/ (gitignored), write assets/LICENSES.json
npm run assets:process   # convert into public/media/<tier>/, write src/generated/asset-manifest.json + assets/SIZE-REPORT.md
```

- The processed outputs (`public/media/`, `src/generated/asset-manifest.json`, `assets/LICENSES.json`) **are committed**, so Vercel builds without network access to the asset sites. Re-run the two commands only when `scripts/asset-sources.ts` changes.
- Useful flags: `npm run assets:fetch -- --only=icons_powers,font_ui`, `-- --list` (print archive contents, used to write pick maps), `-- --refresh` (ignore the cache), `npm run assets:process -- --tier=low`.
- Requests use the User-Agent `ModuloRagdollAssetFetcher/0.1 (...)` and are limited to one per host every 1.1 s. `HTTPS_PROXY` is honoured.

### License policy (enforced in `scripts/lib/licenses.ts`)
- Accepted: CC0 (preferred), CC-BY 3.0/4.0, OGA-BY 3.0, the Pixabay Content License, and SIL OFL **for fonts only**.
- Rejected: anything NC, ND, SA, GPL/LGPL, Sampling+, or unknown. On OpenGameArt pages with several licenses, the most permissive accepted one is used.
- Every shipped file needs a record in `assets/LICENSES.json`. A unit test fails otherwise. The in-game Credits screen is generated from that file.

### Sources

| Source | How | Status |
|---|---|---|
| Poly Haven | Public API (`api.polyhaven.com`), CC0 | automatic |
| ambientCG | Public API, CC0. Downloads redirect to `acg-download.struffelproductions.com` | automatic |
| OpenGameArt | Curated page slugs, license parsed from each page | automatic |
| Kenney | Kenney's own CC0 uploads on OpenGameArt are automatic. kenney.nl itself hands out signed download links only through its web page, so packs taken directly from kenney.nl are manual (below) | partly manual |
| game-icons.net | Direct SVG URLs, CC BY 3.0 | automatic |
| Google Fonts | css2 API → woff2 (latin subset), designer + license from github.com/google/fonts METADATA.pb | automatic |
| Freesound | API, `FREESOUND_API_KEY`, filtered to CC0 + Attribution, HQ previews | optional, skipped without a key |
| Pixabay | API, `PIXABAY_API_KEY`. **The Pixabay API only serves images/videos**; Pixabay music/SFX have to be downloaded by hand (manual entry) | optional, skipped without a key |
| itch.io | No API; downloads go through a "name your price" page | manual |

### Optional API keys (on your own machine)

```bash
export FREESOUND_API_KEY=your_key_here
```

```bash
export PIXABAY_API_KEY=your_key_here
```

```bash
npm run assets:fetch -- --only=fs_thunder,fs_zap,fs_whoosh,px_nebula && npm run assets:process
```

Get the keys at https://freesound.org/apiv2/apply and https://pixabay.com/api/docs/.

### Manual downloads
Entries with `kind: 'manual'` in `scripts/asset-sources.ts` print where their file is expected. For example:
1. Open https://kenney.nl/assets/impact-sounds and download the zip.
2. Save it as `.asset-cache/manual/kenney_impact_manual/kenney_impact-sounds.zip`.
3. Run `npm run assets:fetch -- --only=kenney_impact_manual` then `npm run assets:process`.

The same pattern works for itch.io packs: add a `manual` entry with the page URL, author and license, and put the file in `.asset-cache/manual/<id>/`.

### Adding a new source
Add an entry to `scripts/asset-sources.ts`. For archives, run with `--list` first to see the file names, then write a `pick` map (`glob → logical id`, `*` = file stem). Logical ids look like `sfx/thunder_01`, `backdrop/bd_space` or `icon/vortex`, and the game looks assets up by them.

## Cloud sandbox (Claude Code on the web)
The default environment blocks the asset sites. The personal environment **`modulo-ragdoll`** allows exactly these hosts (package registries are allowed by default):

kenney.nl, www.kenney.nl, opengameart.org, itch.io, img.itch.zone, freesound.org, cdn.freesound.org, pixabay.com, cdn.pixabay.com, fonts.google.com, fonts.googleapis.com, fonts.gstatic.com, polyhaven.com, api.polyhaven.com, dl.polyhaven.org, ambientcg.com, acg-download.struffelproductions.com, game-icons.net, github.com, raw.githubusercontent.com, vercel.com

Note: Chromium in the sandbox uses software WebGL (around 16 FPS), so frame-time numbers measured there don't represent real hardware. Use `/bench` on a real machine (Phase 3).

## Deploying to Vercel

Everything Vercel needs is in the repo: `vercel.json` (Vite preset, `npm ci`, `npm run build` → `dist/`, cache and WASM headers), the Node version (`22.x` in `package.json`), and the processed assets under `public/media/`. No environment variables or API keys are needed.

**Option A: Git integration (recommended)**
1. On vercel.com, choose Add New → Project, then import `leiffurthersocial-rgb/modulo-ragdoll`. Approve the Vercel GitHub app for the repo if asked.
2. Leave every setting as detected (framework Vite; build, install and output settings come from `vercel.json`), then click Deploy.
3. Every push then gets a preview URL. The production URL follows the production branch, which you can set under Project → Settings → Git.

**Option B: CLI from your machine**
```bash
npm i -g vercel
```
```bash
vercel
```
```bash
vercel --prod
```

The build was checked with `vercel build` on a clean checkout: it type-checks, bundles, and the output boots without errors. Caching: `/assets/*` (hashed JS/CSS) and `/media/*` (content-hashed game assets) are immutable for a year, and `index.html` always revalidates, so new deploys show up immediately.
