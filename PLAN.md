# Modulo: Ragdoll — Plan

2D neon physics sandbox: spawn crash-test dummies and test superpowers on them. No levels, no progression.
This document covers architecture, milestones, performance budgets, iPad limits and risks.
Running design decisions live in `DECISIONS.md`. Environment and asset pipeline steps are in `SETUP.md` (written in Phase 0).

---

## 1. Stack (versions checked 2026-11-11)

| Concern | Choice | Version |
|---|---|---|
| Language / build | TypeScript (strict) + Vite | TS 7.0, Vite 8.3 |
| Rendering | PixiJS v8, WebGL2 renderer (WebGPU off by default) | pixi.js 8.22 |
| Glow | Custom mip-chain bloom (own shaders). `pixi-filters` 6.1 used only for KawaseBlur/RGBSplit while prototyping | |
| Physics | `@dimforge/rapier2d-compat` (WASM inlined as base64, no MIME issue). SIMD build benchmarked later | 0.21 |
| Audio | Raw WebAudio with a small custom mixer (no Howler; see D-007) | |
| Tests | Vitest (unit), Playwright pinned to the preinstalled 1.63 (smoke, screenshots, benchmark) | Vitest 5.1 |
| Asset tooling | `tsx` scripts, `sharp` (WebP), `basisu`/`ktx2-encoder` (KTX2), `ffmpeg` (audio) | |
| Hosting | Vercel static, `vercel.json` with immutable cache on `/assets/*` and `application/wasm` for `*.wasm` | |

## 2. Architecture

```
src/
  main.ts                 boot: settings -> physics init (WASM) -> renderer -> scene -> UI
  core/
    loop.ts               fixed-timestep driver (accumulator, slow-mo, hit-stop, step-frame, FPS cap)
    events.ts             typed event bus (contact, break, statusApplied, powerFired...)
    rng.ts, math.ts, pool.ts
  physics/
    world.ts              Rapier world wrapper, collision groups, contact-force events
    bodies.ts             body registry: id -> {rapier handle, material, durability, statuses, render link}
    ragdoll.ts            dummy builder: parts, joints, limits, posture motors, break logic
    objects.ts            crates, balls, planks, barrels, walls/platforms, ropes (chained segments)
    materials.ts          density, friction, restitution, conductivity, flammability, brittleness
    physics-api.ts        implements PhysicsAPI (the only physics surface powers see)
  render/
    renderer.ts           Pixi app, layers (backdrop, world, additive FX, UI-in-world), interpolation
    bloom.ts              threshold -> 5-level downsample/upsample chain -> additive composite
    shapes.ts             neon vector drawing of bodies, damage decals (cracks/scuffs/dents)
    fx/                   particles (pooled ParticleContainer), trails, lightning mesh, beams, flashes
    camera.ts             pan/zoom, pinch, auto-zoom-to-action, screen shake
    fx-api.ts             implements FXAPI
  powers/                 *** no Pixi / Rapier imports allowed here (lint rule) ***
    types.ts              Power, SubAbility, InputMode, EffectOp, PhysicsAPI, FXAPI, AudioAPI interfaces
    effects.ts            reusable effect ops: impulse, radialForce, damage, applyStatus, spawnBody...
    defs/*.ts             one file per power (fire, lightning, ice, ...), pure data + small behaviours
    runtime.ts            input-mode state machines, cooldown/energy, Limiter Break multiplier
  status/
    status.ts             definitions, stacking, durations, per-tick effects
    interactions.ts       pair rules table: (water, shocked) -> amplified chain, (fire, ice) -> steam...
  sandbox/                tools: spawn, grab (spring joint), delete, undo, clear, arenas
  save/                   versioned scene schema, serialize/deserialize, localStorage + JSON import/export
  audio/                  mixer, voice limiting, procedural SFX synth, distance-delayed thunder
  settings/               quality presets, Battery Saver, watchdog, key bindings, persistence
  ui/                     DOM/CSS overlay: toolbar, power wheel, sliders, menus, debug panel, F3 overlay
  bench/                  /bench route: scripted spawn + power sequence, frame time stats
```

### 2.1 Simulation loop
- Physics at a fixed **60 Hz** (`dt = 1/60`), accumulator capped at 5 substeps per frame to prevent a death spiral. Rendering interpolates each body between its previous and current transforms with `alpha = acc / dt`.
- **Slow-motion** scales the real time fed into the accumulator (0.05x to 1x), so physics stays stable. **Hit-stop** freezes the accumulator for N ms. **Step frame** runs exactly one tick while paused.
- Units: metres, y-up in physics. The renderer flips y. 1 m = 40 px at zoom 1. A dummy is about 1.8 m tall.
- The physics world stays on the main thread (D-004). A worker is the fallback if profiling shows physics above budget.

### 2.2 The dummy
- 15 parts: head, torso, pelvis, 2 upper arms, 2 forearms, 2 hands, 2 thighs, 2 shins, 2 feet. Capsules and rounded boxes. Masses follow human proportions, clamped so neighbouring parts never differ by more than 4:1 (key for solver stability).
- Revolute joints with anatomical limits (e.g. knee 0 to 150°, neck ±40°). Weak PD motors hold a slight "standing slump" posture without being an active balancer. Neighbouring parts don't collide with each other (collision groups); the rest of the self-collision stays on.
- Anti-jitter: higher solver iterations for dummies, a small amount of joint softness, linear/angular damping, sleep thresholds, CCD on small fast parts (hands, feet, head).
- **Joint breaking:** Rapier's JS API doesn't expose joint reaction forces, so joint stress is estimated each tick from anchor separation (constraint error) and relative angular speed past the limit, combined with contact-force events on either part. Stress builds up over a few ticks and has to pass the joint's threshold, which avoids single-frame false breaks. On a break the joint is removed and sparks plus white stuffing particles burst out. No gore.
- **Part durability:** each part has HP and an `armor` factor. Contact-force events above a threshold, plus power damage, reduce HP. Damage decals are applied in stages: scuffs (≥15% damage), cracks (≥45%), dents (≥75%, the shape deforms slightly). At 0 HP the part's joints become easier to break.

### 2.3 Rendering and neon look
- Every body is drawn as clean vector shapes: dark fill, bright rim stroke, per-material hue. Each shape is drawn once and cached as a texture, then reused by sprites (few draw calls).
- Additive FX layer (particles, lightning, beams, flashes) with blend mode `add`.
- **Bloom pipeline:** bright-pass threshold, then a 5-level dual-filter downsample/upsample at half resolution (full resolution on Ultra), composited additively with per-frame intensity. Powers can trigger "bloom spikes". Optional chromatic aberration pulse, vignette and screen flash in the same final pass.
- **Lightning:** recursive midpoint displacement with branching (depth and branch count set by quality tier). Rendered as triangle-strip meshes with a soft glow texture in 3 additive layers (wide faint halo, mid glow, white-hot core). The path is regenerated every 2–3 frames for flicker. When a body is shocked, arcs run between its joints so the dummy's skeleton lights up. Thunder plays with a delay of `distance / 343 m/s`, compressed for gameplay.
- Particles: a pooled Pixi v8 `ParticleContainer` with a hard cap per tier. The oldest particles are recycled first.

### 2.4 Power system (dimension-agnostic)
- `Power { id, name, category, icon, palette, energy: {max, regen}, subAbilities[] }`
- `SubAbility { id, name, input: 'click'|'hold'|'drag-aim'|'charge-release'|'toggle'|'area-select', cooldown, cost, params: Record<string, ParamSpec>, pipeline: EffectOp[] | behaviour(ctx) }`
- `ParamSpec { default, min, max, step }` builds the debug panel tweak sliders automatically.
- Power code only touches `ctx: { physics: PhysicsAPI, fx: FXAPI, audio: AudioAPI, status: StatusAPI, rng, time, params }`. PhysicsAPI deals in plain `Vec2`, body ids and queries (`queryCircle`, `raycast`, `applyImpulse`, `setGravityScale`, `spawn`, `freeze`, ...). FXAPI deals in semantic calls (`lightning(a,b,style)`, `burst(kind,pos)`, `shake(amount)`, `hitStop(ms)`, `flash(color)`). A 3D port only has to re-implement these interfaces.
- Persistent entities (tesla orb, storm cloud, black hole, spirit dragon, clones) are `PowerEntity` objects with `update(ctx, dt)` and `dispose()`, owned by the runtime.
- Validation: a Vitest suite checks every definition (unique ids, params in range, palette valid, input mode supported, no forbidden imports).

### 2.5 Status effects and interactions
- Statuses: burning, frozen, shocked, soaked, oiled, poisoned, acid, floating, slowed, crushed, heavy, time-stopped. Each has a duration, stack count (with a cap) and tick behaviour. Statuses are applied per body part, so one arm can burn while the rest is soaked.
- Interaction rules are evaluated when a status is applied and on a 10 Hz tick (cheap). Examples: soaked + shocked = amplified chain with a larger jump radius; burning + frozen = both cleared plus a steam burst; wind + burning = fire spreads to bodies downwind; oiled + burning = explosion; frozen + high impact = shatter; acid + metal = fast durability loss; poisoned + burning = toxic flare. These rules are data (a table), unit-tested.
- Materials feed the rules (metal conducts, wood burns, stone resists).

### 2.6 UI
- DOM/CSS overlay above the canvas (D-005): crisp text, simple touch targets, accessible, cheap. Power wheel: radial on desktop (hold Tab or right mouse), bottom bar of large buttons on touch. Hotkeys 1–9 pick a power, Q/E cycle sub-abilities. Remappable later (Phase 3).

### 2.7 Save / load / undo
- Versioned schema `{ v, arena, gravity, bodies[], joints[], ragdolls[] }` with every body's transform, velocity, material, HP, statuses and damage stage. Hand-written validator, round-trip unit test.
- Undo: ring buffer of 20 scene snapshots, taken before destructive user actions (spawn group, delete, clear, power cast). Snapshots are serialized JSON, so the same code path serves undo and saves.

## 3. Milestones (commit after each, stop at the end of each phase)

**Phase 0: Environment and assets**
- 0.1 Scaffold: Vite + TS strict, ESLint (import boundary rule for `src/powers`), Vitest, Playwright, `vercel.json`, `.gitignore`.
- 0.2 `scripts/fetch-assets.ts`: source adapters (Poly Haven API, ambientCG API, Kenney curated packs, OpenGameArt curated pages with license parsing, Freesound API (CC0/CC-BY filter), Pixabay API, Google Fonts, game-icons.net). Rate limiter (1 request/s per host), descriptive User-Agent, `.asset-cache/`, license whitelist (CC0, CC-BY 3.0/4.0, OGA-BY). Writes `assets/LICENSES.json`.
- 0.3 `scripts/process-assets.ts`: WebP + KTX2 (UASTC/ETC1S), atlases, audio loudness normalization to -16 LUFS, OGG Opus + AAC (m4a), size report per tier.
- 0.4 Procedural placeholder generators so the game runs with no downloaded assets. `SETUP.md`.

**Phase 1: Physics core (greybox)**, about 6 milestones
- 1.1 Loop + renderer + interpolation + basic bloom + camera pan/zoom. Boxes falling on a floor.
- 1.2 Dummy ragdoll with limits, posture motors, stability tuning (stress scene: 20 dummies piled up, no jitter after 5 s).
- 1.3 Durability, damage decals, joint breaking with sparks and stuffing.
- 1.4 Objects (crates, balls, planks, barrels, walls/platforms, ropes) + grab/drag/throw + delete tool.
- 1.5 Arenas (flat, pit, tower, enclosed box, zero-g), toolbar, pause, slow-mo, step, gravity slider, reset, undo/clear, auto-zoom.
- 1.6 Save/load (localStorage + JSON export/import), F3 debug overlay, Vitest round trip, Playwright smoke + screenshots. **Stop for review.**

**Phase 2: Powers.** Large, so it has an extra review stop.
- 2.1 Power framework, status system + interaction table, power wheel, debug param panel, energy/cooldowns, hit-stop/shake/flash plumbing.
- 2.2 **Lightning** (all 6 sub-abilities) + water (needed for the soaked synergy). Frame-sequence screenshots. **Mid-phase review stop** to sign off the visual bar before the rest copies its approach.
- 2.3 Fire, Ice, Wind, Earth, Water (remaining).
- 2.4 Gravity, Telekinesis, Black hole & time (incl. rewind via a 3 s transform ring buffer), Force.
- 2.5 Anime archetypes (Spirit Beam, Rapid Fist Barrage, Shadow Clones, Blade Aura, Heavy Aura, Spirit Dragon, Dimensional Slash, Limiter Break). Blade/rift cuts split planks and crates into two convex pieces. Dummies are cut at the joints.
- 2.6 Misc (acid, poison cloud, explosives/stylized nuke, laser grid, saw blades, shrink/grow, clone, teleport, heal/reset).
- 2.7 Polish: chromatic aberration, kill-cam slow-mo, damage numbers / part health bars, chaos score, per-power sound design pass. **Stop for review.**

**Phase 3: Assets, UI, quality**
- 3.1 Integrate fetched assets (backdrops dimmed, blurred and tinted, SFX, music, fonts, icons). Credits screen built from `LICENSES.json`.
- 3.2 Main menu, settings, power browser with live preview, remappable keys, touch controls (suggested automatically on touch devices).
- 3.3 Quality presets + Custom, Battery Saver, watchdog, low-battery suggestion, hidden-tab/menu pause.
- 3.4 `/bench` route + per-preset report, iPad viewport screenshots, memory audit. **Stop for review.**

## 4. Performance budgets

Frame budget at 60 FPS = 16.7 ms. Targets measured on a mid-range laptop iGPU; iPad targets in §5.

| Slice | Budget (High) |
|---|---|
| Physics step (incl. substeps) | ≤ 4.0 ms |
| Power / status logic | ≤ 1.5 ms |
| Render CPU (scene graph, particles upload) | ≤ 4.0 ms |
| GPU (bloom + draw) | ≤ 6.0 ms |
| Draw calls | ≤ 80 typical, ≤ 150 worst case |
| GC | no per-frame allocations in hot paths (pools, reused Vec2s) |

| Preset | FPS cap | Pixel ratio cap | Bloom | Particles | Max dummies / bodies | Solver iters | Lightning depth/branches | Audio voices |
|---|---|---|---|---|---|---|---|---|
| Ultra | 60 (uncapped where the display allows) | 2.0 | full-res, 6 levels | 10 000 | 40 / 700 | 8 | 6 / 6 | 48 |
| High | 60 | 2.0 | half-res, 5 levels | 6 000 | 25 / 450 | 6 | 5 / 4 | 32 |
| Medium | 60 | 1.5 | half-res, 4 levels | 3 000 | 15 / 280 | 4 | 4 / 3 | 24 |
| Low | 60 | 1.0 | quarter-res, 3 levels | 1 500 | 8 / 160 | 4 | 3 / 2 | 16 |
| Battery Saver | 30 | 1.0 (0.75 option) | quarter-res or off | 800 | 6 / 100 | 3 | 3 / 1 | 12 |

Battery Saver also pauses the loop when the tab is hidden or a menu is open, sleeps idle bodies aggressively and turns off shake and chromatic aberration.

Download size: initial JS + WASM ≤ 2.5 MB gzipped (Rapier is about 1.4 MB of that). Asset packs per tier: High ≤ 25 MB, Low/Battery ≤ 8 MB, lazy-loaded after the first frame.

## 5. iPad constraints and memory budget

- **Memory budget: ≤ 300 MB total for the tab** (JS heap + WASM + GPU). Safari on 3–4 GB iPads can kill the WebContent process well before 1 GB. Split: GPU textures + render targets ≤ 96 MB on High and ≤ 48 MB on Low/Battery. WASM heap ≤ 64 MB. Decoded audio ≤ 32 MB. JS heap ≤ 80 MB.
- Decoded WebAudio buffers are float32 PCM (one minute of stereo is about 21 MB), so **music is streamed** through `<audio>` + `MediaElementSource` and only short SFX are decoded.
- Compressed GPU textures (KTX2/Basis, which transcodes to ASTC on iPad) for backdrops and atlases, WebP fallback. Textures are freed when you leave an arena. All sprites and particles are pooled.
- Safari quirks: Low Power Mode throttles rAF to 30 Hz (the fixed timestep absorbs it). ProMotion still delivers 60 Hz rAF by default. There's no Battery Status API, so the watchdog uses frame time instead. Audio needs a user gesture to unlock. Safari had no Ogg Vorbis for a long time, so every clip ships as AAC (m4a) too and the loader picks by `canPlayType`.
- Viewport: `width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no`, layout with `100dvh` and `env(safe-area-inset-*)`, `touch-action: none` on the canvas, `gesturestart` prevented, pointer events throughout. Pinch zoom handled by the game.
- Render-target sizes clamped so canvas width × height × pixel ratio stays below the iOS canvas area limit.

## 6. Asset sourcing status

The default sandbox blocked every asset host except Google Fonts' CSS/static hosts. A personal cloud environment, **`modulo-ragdoll`**, now allows exactly the hosts listed in SETUP.md, and all sources were fetched successfully in Phase 0 (288 licensed files from Poly Haven, ambientCG, OpenGameArt incl. Kenney's CC0 uploads, game-icons.net and Google Fonts).

Remaining gaps (no API keys for now, so these are skipped cleanly):
- **Freesound**: optional. Needs `FREESOUND_API_KEY`, and uses CC0/Attribution HQ previews only.
- **Pixabay**: optional. Needs `PIXABAY_API_KEY`, and its API serves images only. Pixabay audio would be a manual download.
- **kenney.nl direct**: signed links issued only through the web page, so manual (D-012).
- **itch.io**: no API, so manual entries only.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rapier JS doesn't expose joint reaction forces, so breaking is approximate | Stress estimate from constraint error + contact forces, with build-up; tuned with test scenes |
| Ragdoll jitter/explosions with 15 small parts | Mass-ratio clamp, joint softness, CCD on extremities, more solver iterations for dummies, stress-scene regression screenshots |
| Bloom fill-rate on iPad | Half/quarter-res chain, fewer levels per tier, off in Battery Saver |
| Scope (about 75 sub-abilities) | Shared effect ops + data-driven defs. Lightning sets the template first and later powers mostly compose ops |
| "Cut through objects" needs convex splitting | Limited to convex pieces (boxes/planks/barrels). Dummies are cut at the joints only |
| Rewind on a non-deterministic sim | Region rewind replays a 3 s ring buffer of recorded transforms (kinematic playback), then hands control back to dynamics |
| License contamination | License whitelist, per-asset record, skip on unknown license, CI test that every shipped asset file has a LICENSES.json entry |
| Safari audio format / unlock | AAC fallback, unlock on first gesture, voice limiting |
| Main-thread physics spikes | Body caps per tier, sleeping, worker fallback kept possible by the PhysicsAPI boundary |

## 8. Testing and QA
- Vitest: power definition validation, status interaction table, save/load round trip, loop timing math, license manifest checks.
- Playwright: smoke test (boot, spawn, cast, no console errors means pass), screenshots at 1440×900 desktop and iPad Pro 11 / iPad 10th gen viewports, effect frame sequences, `/bench` per preset reporting avg/p95 frame time.
- Screenshots are checked by me before I report anything as working.
