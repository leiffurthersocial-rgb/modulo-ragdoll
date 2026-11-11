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
