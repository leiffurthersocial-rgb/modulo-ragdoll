// Procedurally generated placeholder textures. Used when an asset is missing from the
// manifest, and as the primary source for most power visuals (glow, sparks, bolts).
import { Texture } from 'pixi.js';

const cache = new Map<string, Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = Texture.from(c);
  cache.set(key, tex);
  return tex;
}

/** Soft radial glow, white (tint at use). Falloff tuned for additive blending. */
export function glowTexture(size = 64): Texture {
  return canvasTexture(`glow${size}`, size, size, (g) => {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}

/** Thin horizontal streak with bright core, for sparks and motion trails. */
export function streakTexture(w = 64, h = 8): Texture {
  return canvasTexture(`streak${w}x${h}`, w, h, (g) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    g.fill();
  });
}

/** Lumpy smoke/stuffing puff from overlapping soft circles (deterministic). */
export function puffTexture(size = 64): Texture {
  return canvasTexture(`puff${size}`, size, size, (g) => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9; i++) {
      const x = size * (0.3 + rnd() * 0.4);
      const y = size * (0.3 + rnd() * 0.4);
      const r = size * (0.15 + rnd() * 0.15);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
  });
}

/** Fallback arena backdrop: deep gradient, faint perspective grid and stars. */
export function backdropTexture(w = 1024, h = 512, hue = 230): Texture {
  return canvasTexture(`bd${w}x${h}h${hue}`, w, h, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `hsl(${hue} 45% 4%)`);
    grad.addColorStop(0.7, `hsl(${hue + 20} 40% 8%)`);
    grad.addColorStop(1, `hsl(${hue + 40} 50% 12%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 180; i++) {
      g.fillStyle = `rgba(200,220,255,${0.15 + rnd() * 0.5})`;
      g.fillRect(rnd() * w, rnd() * h * 0.65, 1 + rnd(), 1 + rnd());
    }
    g.strokeStyle = `hsla(${hue + 60} 90% 60% / 0.07)`;
    g.lineWidth = 1;
    const horizon = h * 0.72;
    for (let i = -20; i <= 20; i++) {
      g.beginPath();
      g.moveTo(w / 2 + i * 12, horizon);
      g.lineTo(w / 2 + i * 90, h);
      g.stroke();
    }
    for (let j = 1; j < 8; j++) {
      const y = horizon + (h - horizon) * (j / 8) ** 1.8;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  });
}
