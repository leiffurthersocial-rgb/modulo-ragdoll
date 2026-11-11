// Draws every physics body as a clean vector shape: dark fill + bright rim, crash-test
// markings on dummies, staged damage decals (scuffs, cracks, dents) and status tints.
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { lerp, mixColor, rng, shade } from '../core/math';
import { MATERIALS } from '../physics/materials';
import type { BodyRec, PhysicsWorld } from '../physics/world';
import { STATUS_DEFS } from '../status/interactions';
import type { StatusId } from '../status/types';
import { PPM } from './fx';

interface View {
  root: Container;
  glow: Sprite;
  g: Graphics;
  key: string;
}

const STATUS_GLOW: Partial<Record<StatusId, number>> = {
  burning: 0xff6a1a,
  shocked: 0xbfe6ff,
  frozen: 0x8fefff,
  poisoned: 0x7dff4f,
  acid: 0xc6ff1a,
  floating: 0xd7b8ff,
  heavy: 0xc78bff,
  stopped: 0xfff1a8,
};

export class BodyRenderer {
  readonly layer = new Container();
  private views = new Map<number, View>();
  private bars = new Graphics();
  showHealthBars = false;

  constructor(private world: PhysicsWorld, private glowTex: Texture) {
    this.layer.addChild(this.bars);
  }

  private viewFor(b: BodyRec): View {
    let v = this.views.get(b.id);
    if (!v) {
      const root = new Container();
      const glow = new Sprite(this.glowTex);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.visible = false;
      const g = new Graphics();
      root.addChild(glow, g);
      this.layer.addChildAt(root, Math.max(0, this.layer.children.length - 1));
      v = { root, glow, g, key: '' };
      this.views.set(b.id, v);
    }
    return v;
  }

  remove(id: number): void {
    const v = this.views.get(id);
    if (v) {
      v.root.destroy({ children: true });
      this.views.delete(id);
    }
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  update(alpha: number, time: number): void {
    for (const b of this.world.bodies.values()) {
      const v = this.viewFor(b);
      const x = lerp(b.prev.x, b.cur.x, alpha);
      const y = lerp(b.prev.y, b.cur.y, alpha);
      let da = b.cur.a - b.prev.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      v.root.position.set(x * PPM, -y * PPM);
      v.root.rotation = -(b.prev.a + da * alpha);
      const statusKey = [...b.statuses.keys()].sort().join(',');
      const key = `${b.damageStage}|${b.scale}|${statusKey}|${b.hp <= 0 ? 'x' : ''}`;
      if (b.dirty || key !== v.key) {
        this.draw(b, v.g);
        v.key = key;
        b.dirty = false;
      }
      // Status glow (no redraw needed): strongest status colour, flickering.
      let glowColor = -1;
      for (const s of b.statuses.keys()) {
        const c = STATUS_GLOW[s];
        if (c !== undefined) glowColor = c;
      }
      if (glowColor >= 0) {
        v.glow.visible = true;
        v.glow.tint = glowColor;
        const r = this.world.radius(b) * PPM * 3.2;
        v.glow.width = v.glow.height = r;
        const fl = b.statuses.has('shocked') ? 0.3 + Math.random() * 0.7 : b.statuses.has('burning') ? 0.6 + Math.sin(time * 23 + b.id) * 0.25 : 0.55;
        v.glow.alpha = fl;
      } else v.glow.visible = false;
    }
    for (const [id] of this.views) if (!this.world.bodies.has(id)) this.remove(id);
    this.drawBars();
  }

  private drawBars(): void {
    const g = this.bars.clear();
    if (!this.showHealthBars) return;
    for (const d of this.world.dummies.values()) {
      const headId = d.parts.head ?? d.parts.torso ?? d.parts.pelvis;
      const head = headId !== undefined ? this.world.bodies.get(headId) : undefined;
      if (!head) continue;
      let hp = 0;
      let max = 0;
      for (const id of Object.values(d.parts)) {
        const b = id !== undefined ? this.world.bodies.get(id) : undefined;
        if (b) {
          hp += Math.max(0, b.hp);
          max += b.maxHp;
        }
      }
      const f = max > 0 ? hp / max : 0;
      const w = 34;
      const x = head.cur.x * PPM - w / 2;
      const y = -head.cur.y * PPM - 18 * d.scale;
      g.rect(x, y, w, 4).fill({ color: 0x000000, alpha: 0.6 });
      g.rect(x, y, w * f, 4).fill({ color: f > 0.5 ? 0x6fe38a : f > 0.25 ? 0xffc83d : 0xff5a5a });
    }
  }

  private draw(b: BodyRec, g: Graphics): void {
    g.clear();
    const mat = MATERIALS[b.material];
    const s = b.scale * PPM;
    let rim = b.color ?? mat.color;
    let fill = mat.fill;
    if (b.kind === 'tnt') {
      rim = 0xff4a4a;
      fill = 0x3a1010;
    }
    if (b.kind === 'oilbarrel') {
      rim = 0xffa531;
      fill = 0x2c2010;
    }
    if (b.statuses.has('frozen')) {
      fill = mixColor(fill, 0x7fdcff, 0.55);
      rim = 0xdffaff;
    }
    if (b.statuses.has('oiled')) fill = mixColor(fill, 0x14100a, 0.6);
    if (b.statuses.has('soaked')) fill = mixColor(fill, 0x1d4b8a, 0.4);
    if (b.statuses.has('burning')) rim = mixColor(rim, 0xff7a1a, 0.6);
    if (b.statuses.has('acid')) rim = mixColor(rim, 0xc6ff1a, 0.5);
    if (b.statuses.has('poisoned')) fill = mixColor(fill, 0x2e5a16, 0.5);
    if (b.hp <= 0) rim = shade(rim, -0.45);
    const lw = Math.max(1.6, 0.045 * s);
    const sh = b.shape;

    // Main shape
    if (sh.type === 'ball') {
      const r = sh.r * s;
      g.circle(0, 0, r).fill(fill).stroke({ color: rim, width: lw });
      if (b.kind === 'ball') g.moveTo(-r, 0).lineTo(r, 0).stroke({ color: rim, width: lw * 0.6, alpha: 0.6 });
      if (b.kind === 'boulder') {
        const r2 = rng(b.seed);
        for (let i = 0; i < 4; i++) g.circle((r2() - 0.5) * r, (r2() - 0.5) * r, r * 0.12).fill({ color: shade(fill, 0.15) });
      }
    } else if (sh.type === 'capsule') {
      const r = sh.r * s;
      const hh = sh.hh * s;
      g.roundRect(-r, -hh - r, r * 2, (hh + r) * 2, r).fill(fill).stroke({ color: rim, width: lw });
    } else {
      const hw = sh.hw * s;
      const hh = sh.hh * s;
      const rr = (sh.round ?? 0.02) * s;
      g.roundRect(-hw, -hh, hw * 2, hh * 2, rr).fill(fill).stroke({ color: rim, width: lw });
      if (b.kind === 'crate') {
        const i = hw * 0.75;
        g.moveTo(-i, -i).lineTo(i, i).moveTo(i, -i).lineTo(-i, i).stroke({ color: rim, width: lw * 0.6, alpha: 0.5 });
        g.rect(-i, -i, i * 2, i * 2).stroke({ color: rim, width: lw * 0.5, alpha: 0.35 });
      } else if (b.kind === 'barrel' || b.kind === 'oilbarrel') {
        g.moveTo(-hw, -hh * 0.45).lineTo(hw, -hh * 0.45).moveTo(-hw, hh * 0.45).lineTo(hw, hh * 0.45).stroke({ color: rim, width: lw * 0.6, alpha: 0.6 });
        if (b.kind === 'oilbarrel') g.circle(0, 0, hw * 0.35).stroke({ color: rim, width: lw * 0.7 });
      } else if (b.kind === 'tnt') {
        for (let k = -1; k <= 1; k++) g.rect(k * hw * 0.6 - hw * 0.22, -hh, hw * 0.44, hh * 2).stroke({ color: rim, width: lw * 0.5, alpha: 0.7 });
      } else if (b.kind === 'plank' || b.kind === 'rope') {
        g.moveTo(-hw * 0.9, 0).lineTo(hw * 0.9, 0).stroke({ color: rim, width: lw * 0.4, alpha: 0.3 });
      }
    }

    // Crash-test dummy markings
    if (b.kind === 'part') {
      if (b.part === 'head' && sh.type === 'ball') {
        const r = sh.r * s * 0.55;
        g.moveTo(0, 0).arc(0, 0, r, -Math.PI / 2, 0).lineTo(0, 0).fill(rim);
        g.moveTo(0, 0).arc(0, 0, r, Math.PI / 2, Math.PI).lineTo(0, 0).fill(rim);
        g.circle(0, 0, r).stroke({ color: rim, width: lw * 0.6 });
      } else if (b.part === 'torso' && sh.type === 'box') {
        const r = sh.hw * s * 0.32;
        const cy = -sh.hh * s * 0.25;
        g.moveTo(0, cy).arc(0, cy, r, -Math.PI / 2, 0).lineTo(0, cy).fill(rim);
        g.moveTo(0, cy).arc(0, cy, r, Math.PI / 2, Math.PI).lineTo(0, cy).fill(rim);
        g.circle(0, cy, r).stroke({ color: rim, width: lw * 0.5 });
      } else if (b.part?.startsWith('thigh') || b.part?.startsWith('upperArm')) {
        g.circle(0, 0, Math.max(1.5, lw * 0.9)).fill(rim);
      }
    }

    // Damage decals (deterministic per body).
    if (b.damageStage > 0) {
      const r2 = rng(b.seed);
      const ext = this.world.radius(b) * PPM * 0.75;
      const crackColor = shade(rim, -0.2);
      // scuffs
      for (let i = 0; i < 2 + b.damageStage * 2; i++) {
        const x = (r2() - 0.5) * ext;
        const y = (r2() - 0.5) * ext;
        g.moveTo(x, y).lineTo(x + (r2() - 0.5) * ext * 0.4, y + (r2() - 0.5) * ext * 0.2).stroke({ color: 0xffffff, width: 1, alpha: 0.25 });
      }
      // cracks
      if (b.damageStage >= 2) {
        for (let c = 0; c < b.damageStage - 1; c++) {
          let x = (r2() - 0.5) * ext;
          let y = (r2() - 0.5) * ext;
          g.moveTo(x, y);
          for (let k = 0; k < 4; k++) {
            x += (r2() - 0.5) * ext * 0.5;
            y += (r2() - 0.5) * ext * 0.5;
            g.lineTo(x, y);
          }
          g.stroke({ color: crackColor, width: Math.max(1, lw * 0.5), alpha: 0.9 });
        }
      }
      // dents
      if (b.damageStage >= 3) {
        for (let k = 0; k < 2; k++) g.circle((r2() - 0.5) * ext, (r2() - 0.5) * ext, ext * 0.18).fill({ color: 0x000000, alpha: 0.35 });
      }
    }
    if (b.statuses.has('frozen')) {
      const ext = this.world.radius(b) * PPM * 0.6;
      g.moveTo(-ext * 0.5, -ext * 0.3).lineTo(-ext * 0.1, -ext * 0.6).stroke({ color: 0xffffff, width: 1.5, alpha: 0.7 });
    }
  }
}
