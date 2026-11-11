# Modulo: Ragdoll

A 2D physics sandbox: spawn crash-test dummies and try superpowers on them. No levels, no goals.
TypeScript + Vite, PixiJS 8 (WebGL), Rapier2D (WASM), WebAudio. Runs on desktop and iPad (keyboard, mouse, trackpad, touch).

```bash
npm install
```

```bash
npm run dev
```

- **22 powers, 74 sub-abilities** across Elements, Physics, Archetypes and Misc. Six input modes: click, hold, drag-aim, charge-release, toggle and area-select.
- **Status effects that interact**: water + lightning, fire + ice → steam, wind spreads fire, oil + fire → explosion, frozen parts shatter, acid eats metal, and more.
- **Breakable 15-part dummies** with per-part durability and visible damage (scuffs, cracks, dents). Joints break with sparks and stuffing.
- **Sandbox tools**: spawn, grab/throw, delete, undo, pause, step, slow motion, gravity slider, 5 arenas, save slots, JSON export/import.
- **Quality presets** (Ultra → Battery Saver, plus Custom), a performance watchdog, remappable keys and on-screen touch controls.

Docs: [PLAN.md](PLAN.md) (architecture, budgets, iPad limits), [DECISIONS.md](DECISIONS.md), [SETUP.md](SETUP.md) (asset pipeline, tests, deploy).
Third-party assets and licenses: [assets/LICENSES.json](assets/LICENSES.json) (also shown in the in-game Credits).
