// Minimal shelf packer for texture atlases (sprites are small and similar in size,
// so shelf packing wastes little space and keeps the code trivial).

export interface PackInput {
  id: string;
  w: number;
  h: number;
}

export interface Placed extends PackInput {
  x: number;
  y: number;
  page: number;
}

export interface PackResult {
  placed: Placed[];
  pages: { w: number; h: number }[];
}

const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Pack rects into pages of at most `maxSize`² with `pad` px of spacing (avoids bleeding with linear filtering). */
export function packShelves(items: PackInput[], maxSize = 2048, pad = 2): PackResult {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const placed: Placed[] = [];
  const pages: { w: number; h: number }[] = [];
  let page = -1;
  let x = 0;
  let y = 0;
  let shelfH = 0;
  let usedW = 0;
  let usedH = 0;
  const closePage = () => {
    if (page >= 0) pages[page] = { w: nextPow2(usedW), h: nextPow2(usedH) };
  };
  const openPage = () => {
    closePage();
    page++;
    x = pad;
    y = pad;
    shelfH = 0;
    usedW = 0;
    usedH = 0;
  };
  openPage();
  for (const it of sorted) {
    if (it.w + 2 * pad > maxSize || it.h + 2 * pad > maxSize) throw new Error(`Sprite ${it.id} larger than atlas page`);
    if (x + it.w + pad > maxSize) {
      x = pad;
      y += shelfH + pad;
      shelfH = 0;
    }
    if (y + it.h + pad > maxSize) openPage();
    placed.push({ ...it, x, y, page });
    x += it.w + pad;
    shelfH = Math.max(shelfH, it.h);
    usedW = Math.max(usedW, x);
    usedH = Math.max(usedH, y + it.h + pad);
  }
  closePage();
  return { placed, pages };
}
