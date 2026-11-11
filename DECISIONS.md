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

**D-018 Bloom via pixi-filters AdvancedBloom (supersedes D-006).**
It runs on an untransformed `sceneLayer`, so `filterArea` is in screen space. Putting it on the camera-transformed container clipped the world. Quality per preset: resolution full/half/0.3 and blur passes 7/5/3, or off. Bloom spikes raise `bloomScale` briefly. Chromatic aberration is an RGBSplit filter attached to the stage only while a pulse is active, so it costs nothing otherwise.

**D-019 Joint breaking from estimated joint load.**
Rapier's JS API exposes neither joint impulses nor useful stretch (its joints are very stiff). Per step, the load on a joint is estimated as the distal part's momentum change, minus gravity, minus impulses we applied ourselves (powers, grab, statuses: all routed through `PhysicsWorld.applyImpulse/setVelocity/push`), minus contact impulse. Threshold: stopping the part from ~16 m/s in one step, scaled down as the parts get damaged. The load has to exceed the threshold for ~2 steps. Stretch is still a second trigger. Parts at 0 HP detach.

**D-020 Passive dummies: they slump, they don't stand.**
Force-based motors with heavy damping hold the mannequin shape while the body folds onto the ground in about a second, with no jitter or rebound. Stiffer motors made the dummy a rigid statue that toppled like a plank and took fall damage; softer ones made it "stand back up". Active balancing is out of scope for a crash-test dummy.

**D-021 Impact damage from real velocity change.**
Contact-force events only signal a collision. Damage uses the body's actual velocity change in that step, so standing or stacked bodies don't hurt themselves (the first version broke the dummies' feet while they stood still).

**D-022 Flat UI (your feedback, supersedes the neon UI look).**
Fonts changed from Orbitron/Rajdhani to Inter (UI) and JetBrains Mono (numbers). Icons are game-icons.net glyphs drawn as CSS masks in the text colour.

**D-023 Power entities instead of physics for spirits.**
Shadow clones, the spirit dragon, rifts and storm clouds are pure `PowerEntity` logic (positions + queries + impulses) drawn with FX. They need no extra Rapier bodies, so they're cheap and portable to 3D.

**D-024 Effects capture for QA.**
In the sandbox, headless Chromium renders in software at ~14 FPS and Playwright screenshots take several frames, so short-lived effects (bolts live 0.1–0.4 s) are often gone by the time a screenshot lands. Effect frames are captured in-page with `renderer.extract` right after a rendered frame (see the frames scripts referenced in SETUP.md).

**D-025 Camera frames the area above the dock.**
`bottomInset` is measured from the dock each HUD update, so the floor never sits behind the controls on any screen size.

**D-026 Kill-cam.**
On a neck break, or when a dummy drops below 12% health, the camera zooms partway in at 0.25× time for 1.1 s, then glides back to the previous view. 4 s cooldown. Toggle in Settings.
