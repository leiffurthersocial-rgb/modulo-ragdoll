// Phase 0 boot scene: proves the stack end to end (Rapier WASM, Pixi WebGL, processed assets,
// procedural fallbacks, fonts, credits). The real fixed-timestep loop and sandbox arrive in Phase 1.
import RAPIER from '@dimforge/rapier2d-compat';
import { Application, Assets, Container, Graphics, Sprite, Spritesheet, Text, Texture } from 'pixi.js';
import { loadFonts } from './assets/fonts';
import { atlasPages, imageUrl } from './assets/manifest';
import { backdropTexture, glowTexture } from './assets/procedural';
import { openCredits } from './ui/credits';
import './styles.css';

declare global {
  interface Window {
    __modulo?: { ready: boolean; bodies: number; errors: string[] };
  }
}

const PX_PER_M = 40;

async function boot(): Promise<void> {
  const stage = document.getElementById('stage')!;
  const ui = document.getElementById('ui')!;
  window.__modulo = { ready: false, bodies: 0, errors: [] };

  ui.innerHTML = `
    <div class="topbar">
      <div class="logo">MODULO<span>:</span> RAGDOLL</div>
      <button class="btn" id="btn-credits">Credits</button>
    </div>
    <div class="status" id="status">booting…</div>`;
  ui.querySelector('#btn-credits')!.addEventListener('click', () => openCredits(ui));
  const status = ui.querySelector<HTMLElement>('#status')!;

  await Promise.all([RAPIER.init(), loadFonts()]);

  const app = new Application();
  await app.init({
    resizeTo: stage,
    background: '#05060b',
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: 'webgl',
    powerPreference: 'high-performance',
  });
  stage.appendChild(app.canvas);

  // Backdrop: processed Poly Haven image if present, otherwise the procedural one.
  const bdUrl = imageUrl('backdrop/bd_night_field');
  const bdTex: Texture = bdUrl ? await Assets.load<Texture>(bdUrl) : backdropTexture();
  const backdrop = new Sprite(bdTex);
  backdrop.alpha = 0.9;
  app.stage.addChild(backdrop);

  // Particles atlas (Kenney via OGA) for impact sparks; glow falls back to procedural.
  let sparkTex: Texture = glowTexture();
  const pages = atlasPages('particles');
  if (pages[0]) {
    const sheet = await Assets.load<Spritesheet>(pages[0]);
    sparkTex = sheet.textures['particle/spark_01'] ?? sparkTex;
  }

  const world = new Container();
  const fx = new Container();
  app.stage.addChild(world, fx);

  // Physics: floor + a stack of neon balls/crates.
  const physics = new RAPIER.World({ x: 0, y: -9.81 });
  const floorY = 0;
  physics.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5).setTranslation(0, floorY - 0.5));
  const palette = [0x5ff3ff, 0xff4fd8, 0xffd84f, 0x7cff6b, 0xa98bff];
  const items: { body: InstanceType<typeof RAPIER.RigidBody>; view: Container }[] = [];

  const glow = glowTexture(128);
  for (let i = 0; i < 18; i++) {
    const round = i % 2 === 0;
    const size = 0.35 + (i % 3) * 0.12;
    const body = physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(-4 + (i % 6) * 1.6, 3 + Math.floor(i / 6) * 2.2)
        .setRotation(i * 0.4),
    );
    physics.createCollider(
      (round ? RAPIER.ColliderDesc.ball(size) : RAPIER.ColliderDesc.cuboid(size, size)).setRestitution(0.3),
      body,
    );
    const color = palette[i % palette.length]!;
    const view = new Container();
    const halo = new Sprite(glow);
    halo.anchor.set(0.5);
    halo.width = halo.height = size * PX_PER_M * 5;
    halo.tint = color;
    halo.alpha = 0.35;
    halo.blendMode = 'add';
    const g = new Graphics();
    const r = size * PX_PER_M;
    if (round) g.circle(0, 0, r);
    else g.roundRect(-r, -r, r * 2, r * 2, r * 0.2);
    g.fill({ color: 0x0b1020 }).stroke({ color, width: 3, alpha: 1 });
    view.addChild(halo, g);
    world.addChild(view);
    items.push({ body, view });
  }
  window.__modulo.bodies = items.length;

  const floor = new Graphics();
  world.addChild(floor);

  // Click / tap: radial impulse + spark burst (shows input → physics → FX).
  const sparks: { s: Sprite; vx: number; vy: number; life: number }[] = [];
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointerdown', (e) => {
    const wx = (e.global.x - app.screen.width / 2) / PX_PER_M;
    const wy = (camY() - e.global.y) / PX_PER_M;
    for (const it of items) {
      const p = it.body.translation();
      const dx = p.x - wx;
      const dy = p.y - wy;
      const d = Math.hypot(dx, dy);
      if (d < 4) it.body.applyImpulse({ x: (dx / (d + 0.1)) * 6, y: (dy / (d + 0.1)) * 6 + 3 }, true);
    }
    for (let i = 0; i < 24; i++) {
      const s = new Sprite(sparkTex);
      s.anchor.set(0.5);
      s.position.set(e.global.x, e.global.y);
      s.scale.set(0.25 + Math.random() * 0.25);
      s.tint = palette[i % palette.length]!;
      s.blendMode = 'add';
      const a = Math.random() * Math.PI * 2;
      const v = 3 + Math.random() * 7;
      fx.addChild(s);
      sparks.push({ s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 });
    }
  });

  const camY = () => app.screen.height * 0.8;

  app.ticker.add((t) => {
    physics.step();
    const w = app.screen.width;
    const h = app.screen.height;
    const cover = Math.max(w / bdTex.width, h / bdTex.height);
    backdrop.scale.set(cover);
    backdrop.position.set((w - bdTex.width * cover) / 2, (h - bdTex.height * cover) / 2);
    for (const it of items) {
      const p = it.body.translation();
      it.view.position.set(w / 2 + p.x * PX_PER_M, camY() - p.y * PX_PER_M);
      it.view.rotation = -it.body.rotation();
    }
    floor.clear().moveTo(0, camY()).lineTo(w, camY()).stroke({ color: 0x5ff3ff, width: 2, alpha: 0.9 });
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i]!;
      sp.life -= t.deltaMS / 600;
      sp.s.x += sp.vx;
      sp.s.y += sp.vy;
      sp.vy += 0.2;
      sp.s.alpha = Math.max(0, sp.life);
      if (sp.life <= 0) {
        sp.s.destroy();
        sparks.splice(i, 1);
      }
    }
  });

  const renderer = app.renderer.name ?? 'webgl';
  status.textContent = `Rapier ${RAPIER.version()} · Pixi ${renderer} · ${bdUrl ? 'fetched' : 'procedural'} backdrop · tap to push`;
  window.__modulo.ready = true;
}

boot().catch((err: unknown) => {
  console.error(err);
  window.__modulo?.errors.push(String(err));
  const s = document.getElementById('status');
  if (s) s.textContent = `Boot failed: ${String(err)}`;
});
