// Credits screen, generated from assets/LICENSES.json (written by scripts/fetch-assets.ts).
import licenses from '../../assets/LICENSES.json';

export interface LicenseRecord {
  id: string;
  title: string;
  usage: string;
  source: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseName: string;
  licenseUrl: string;
  attributionRequired: boolean;
  attributionNotice?: string;
  pack: string;
}

export interface CreditGroup {
  pack: string;
  title: string;
  author: string;
  licenseName: string;
  licenseUrl: string;
  sourceUrl: string;
  attributionRequired: boolean;
  notice?: string;
  count: number;
  usage: string;
}

/** Collapse per-file records into one line per pack (icons: per author), attribution-required first. */
export function groupCredits(records: LicenseRecord[]): CreditGroup[] {
  const groups = new Map<string, CreditGroup>();
  for (const r of records) {
    const key = r.source === 'gameicons' ? `${r.pack}:${r.author}` : r.pack;
    const g = groups.get(key);
    if (g) {
      g.count++;
      continue;
    }
    groups.set(key, {
      pack: r.pack,
      title: r.source === 'gameicons' ? `Icons by ${r.author}` : r.title,
      author: r.author,
      licenseName: r.licenseName,
      licenseUrl: r.licenseUrl,
      sourceUrl: r.source === 'gameicons' ? 'https://game-icons.net' : r.sourceUrl,
      attributionRequired: r.attributionRequired,
      ...(r.attributionNotice ? { notice: r.attributionNotice } : {}),
      count: 1,
      usage: r.usage,
    });
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.attributionRequired) - Number(a.attributionRequired) || a.title.localeCompare(b.title),
  );
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const USAGE_LABEL: Record<string, string> = {
  backdrop: 'Backdrop', texture: 'Texture', particle: 'Particles', icon: 'Icons', sfx: 'Sound effects',
  music: 'Music', ambience: 'Ambience', font: 'Font', ui: 'UI',
};

export function openCredits(parent: HTMLElement): () => void {
  const groups = groupCredits((licenses as { assets: LicenseRecord[] }).assets);
  const el = document.createElement('div');
  el.className = 'panel credits';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Credits');
  el.innerHTML = `
    <header><h2>Credits</h2><button class="btn close" aria-label="Close">✕</button></header>
    <div class="scroll">
      <p class="lead">Modulo: Ragdoll. Physics by <a href="https://rapier.rs" target="_blank" rel="noopener">Rapier</a>,
      rendering by <a href="https://pixijs.com" target="_blank" rel="noopener">PixiJS</a>.
      Power visuals are generated in code. Third-party assets:</p>
      <ul class="credit-list">
        ${groups
          .map(
            (g) => `<li>
          <span class="tag">${esc(USAGE_LABEL[g.usage] ?? g.usage)}</span>
          <a href="${esc(g.sourceUrl)}" target="_blank" rel="noopener">${esc(g.title)}</a>
          by ${esc(g.author)}${g.count > 1 ? ` <span class="dim">(${g.count} files)</span>` : ''}.
          <a class="lic" href="${esc(g.licenseUrl)}" target="_blank" rel="noopener">${esc(g.licenseName)}</a>
          ${g.notice ? `<div class="notice">${esc(g.notice)}</div>` : ''}
        </li>`,
          )
          .join('')}
      </ul>
    </div>`;
  const close = () => el.remove();
  el.querySelector('.close')!.addEventListener('click', close);
  parent.appendChild(el);
  return close;
}
