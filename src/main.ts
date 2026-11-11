import { loadFonts } from './assets/fonts';
import { Game } from './game/game';
import { quality } from './game/settings';
import { Hud } from './ui/hud';
import { loadIcons } from './ui/icons';
import { Menus } from './ui/menus';
import './styles.css';

declare global {
  interface Window {
    __modulo?: { ready: boolean; game?: Game; errors: string[]; bench?: unknown };
  }
}

async function boot(): Promise<void> {
  window.__modulo = { ready: false, errors: [] };
  const stage = document.getElementById('stage')!;
  const ui = document.getElementById('ui')!;
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.textContent = 'Loading…';
  ui.append(loading);

  await Promise.all([loadFonts(), loadIcons()]);
  const game = new Game();
  await game.init(stage);
  const hud = new Hud(game, ui);
  const menus = new Menus(game, hud, ui);
  loading.remove();
  window.__modulo.game = game;
  window.__modulo.ready = true;

  const params = new URLSearchParams(location.search);
  if (params.has('bench')) {
    const preset = params.get('preset');
    if (preset) game.setPreset(preset as Parameters<Game['setPreset']>[0]);
    const n = Number(params.get('dummies') ?? 20);
    const secs = Number(params.get('seconds') ?? 10);
    const result = await game.bench(n, secs);
    const q = quality(game.settings);
    window.__modulo.bench = { ...result, dummies: n, quality: q };
    console.info('[bench]', JSON.stringify(window.__modulo.bench));
    hud.toast(`Bench ${result.preset}: avg ${result.avg} ms, p95 ${result.p95} ms`);
    return;
  }
  if (!game.settings.seenIntro && !params.has('nomenu')) {
    menus.open('main');
    game.settings.seenIntro = true;
    game.persist();
  }
}

boot().catch((err: unknown) => {
  console.error(err);
  window.__modulo?.errors.push(String(err));
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<div class="loading">Could not start: ${String(err)}</div>`;
});
