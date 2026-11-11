# Decisions log

Newest last. Each entry: what, why, alternatives considered.

**D-001 (2026-11-11) Cloud environment with an asset-host allowlist.**
The default sandbox blocked all asset sources. I created a personal environment `modulo-ragdoll` (limited network + 20 exact hosts) instead of setting unrestricted access. Pixabay's key is a query param the proxy can't inject, so that source runs locally.

**D-002 Physics units: metres, y-up; renderer flips y; 40 px/m at zoom 1.**
This keeps Rapier in its tuned range (objects 0.1–10 m) and keeps power definitions free of pixel units.

**D-003 Fixed 60 Hz physics with render interpolation; slow-mo scales the accumulator input.**
Changing `dt` for slow-mo was rejected because it destabilises joints.

**D-004 Physics on the main thread for now.**
It makes interpolation, grabbing and power queries simpler. The PhysicsAPI boundary keeps a Web Worker move possible if profiling demands it.

**D-005 DOM/CSS overlay for UI instead of Pixi UI.**
Crisp text, native scrolling and inputs, accessible, and easy touch targets. The canvas is only for the world and FX.

**D-006 Custom bloom shaders over pixi-filters AdvancedBloom.**
I need per-tier resolution and level count plus "bloom spikes". pixi-filters stays available for blur/RGB-split prototypes.

**D-007 Raw WebAudio mixer instead of Howler.js.**
Needed: distance-delayed thunder, voice limiting per tier, procedural synth SFX and streamed music via MediaElementSource. Howler would just wrap these, so it isn't worth the extra dependency. Can revisit.

**D-008 Playwright pinned to 1.63 to match the preinstalled Chromium in the sandbox.**

**D-009 rapier2d-compat (WASM inlined) over the bundler build.**
No WASM MIME or fetch path issues on Vercel or Safari. `vercel.json` still sets `application/wasm` for any future `.wasm`.

**D-010 (Phase 0) Processed assets are committed; raw downloads are not.**
`public/media/` (about 19 MB on disk for both tiers, ≤ 6 MB downloaded per browser), `src/generated/asset-manifest.json` and `assets/LICENSES.json` live in git, so Vercel builds need no network access to the asset sites and builds are reproducible. `.asset-cache/` (raw, about 120 MB) stays local.

**D-011 License whitelist.**
Accepted: CC0, CC-BY 3.0/4.0, OGA-BY 3.0, Pixabay Content License, and OFL for fonts only. CC-BY-SA is rejected too (not only NC/ND), so share-alike terms can't attach to the game. A unit test blocks shipping any file without a license record.

**D-012 Kenney packs via OpenGameArt, never by scripting kenney.nl downloads.**
kenney.nl only issues signed download links through its page. Calling that endpoint from a script would mean faking a browser session, so I don't. Kenney mirrors many CC0 packs on OGA (Particle Pack, Interface Sounds, Sci-fi Sounds are used). Packs found only on kenney.nl (e.g. Impact Sounds) are manual entries, and the 100-CC0-SFX packs by rubberduck cover impacts until then.

**D-013 Two processed tiers, not five.**
"high" serves Ultra/High/Medium, "low" serves Low/Battery Saver. The other preset differences are runtime settings (resolution, bloom, particle caps), not different files.

**D-014 Content-hashed file names for /media.**
Allows `immutable` caching on Vercel for game assets as well as Vite's hashed bundles.

**D-015 Audio: Ogg Vorbis + AAC (.m4a).**
Ogg Vorbis rather than Opus, because Vorbis-in-Ogg has wider support in older Safari. AAC is the fallback, chosen at runtime with `canPlayType`. Loudness: SFX -18 LUFS mono, music/ambience -16 LUFS stereo.

**D-016 Particle sprites converted to white + alpha.**
Kenney particles are white-on-black. Processing turns luminance into alpha, so the sprites work tinted with both additive and normal blending.

**D-017 KTX2 is optional (needs the `basisu` CLI).**
Without it the pipeline emits WebP only. For now the memory budget allows that: one 2048×1024 backdrop at a time is 8 MB of GPU memory. To revisit in Phase 3 if the iPad memory audit asks for it.
