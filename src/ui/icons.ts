// Power icons from the processed game-icons.net atlas, rendered as CSS masks so they take
// the current text colour (flat UI, no glow).
import { atlasPages } from '../assets/manifest';

interface Frame {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sw: number;
  sh: number;
}

const frames = new Map<string, Frame>();

export async function loadIcons(): Promise<void> {
  for (const page of atlasPages('icons')) {
    try {
      const json = (await (await fetch(page)).json()) as {
        frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
        meta: { image: string; size: { w: number; h: number } };
      };
      const url = new URL(json.meta.image, new URL(page, location.href)).href;
      for (const [id, f] of Object.entries(json.frames)) frames.set(id, { url, ...f.frame, sw: json.meta.size.w, sh: json.meta.size.h });
    } catch {
      /* icons are optional */
    }
  }
}

/** Returns an element showing the icon (or a lettered fallback). */
export function iconEl(id: string, size = 24, fallback = '?'): HTMLElement {
  const el = document.createElement('span');
  el.className = 'icon';
  el.style.width = el.style.height = `${size}px`;
  const f = frames.get(id);
  if (!f) {
    el.textContent = fallback.slice(0, 1);
    el.classList.add('icon-fallback');
    return el;
  }
  const s = size / f.w;
  const mask = `url("${f.url}")`;
  const pos = `${-f.x * s}px ${-f.y * s}px`;
  const sz = `${f.sw * s}px ${f.sh * s}px`;
  el.style.setProperty('mask-image', mask);
  el.style.setProperty('-webkit-mask-image', mask);
  el.style.setProperty('mask-position', pos);
  el.style.setProperty('-webkit-mask-position', pos);
  el.style.setProperty('mask-size', sz);
  el.style.setProperty('-webkit-mask-size', sz);
  el.style.setProperty('mask-repeat', 'no-repeat');
  el.style.setProperty('-webkit-mask-repeat', 'no-repeat');
  return el;
}
