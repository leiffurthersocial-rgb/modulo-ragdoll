export type MaterialId = 'dummy' | 'wood' | 'metal' | 'rubber' | 'stone' | 'ice' | 'static' | 'energy' | 'explosive';

export interface Material {
  density: number;
  friction: number;
  restitution: number;
  /** 0..1, how well lightning travels through it. */
  conductivity: number;
  /** 0..1, chance/speed of catching fire. */
  flammability: number;
  /** Damage multiplier for incoming damage (lower = tougher). */
  fragility: number;
  /** Rim colour used by the renderer. */
  color: number;
  fill: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
  dummy: { density: 14, friction: 0.7, restitution: 0.05, conductivity: 0.55, flammability: 0.45, fragility: 1, color: 0xffc83d, fill: 0x2b2f38 },
  wood: { density: 6, friction: 0.8, restitution: 0.1, conductivity: 0.1, flammability: 1, fragility: 1.1, color: 0xff9a3c, fill: 0x2a1d14 },
  metal: { density: 16, friction: 0.5, restitution: 0.15, conductivity: 1, flammability: 0, fragility: 0.45, color: 0x8fd0ff, fill: 0x1b2430 },
  rubber: { density: 3, friction: 0.9, restitution: 0.75, conductivity: 0, flammability: 0.3, fragility: 0.6, color: 0xff5fa8, fill: 0x2a1622 },
  stone: { density: 18, friction: 0.9, restitution: 0.05, conductivity: 0.1, flammability: 0, fragility: 0.35, color: 0xb8b2a6, fill: 0x24221f },
  ice: { density: 9, friction: 0.05, restitution: 0.1, conductivity: 0.3, flammability: 0, fragility: 1.6, color: 0x9ff4ff, fill: 0x16303a },
  static: { density: 1, friction: 0.9, restitution: 0.05, conductivity: 0.2, flammability: 0, fragility: 0, color: 0x5fc8ff, fill: 0x10151f },
  energy: { density: 4, friction: 0.3, restitution: 0.2, conductivity: 0, flammability: 0, fragility: 0, color: 0xb388ff, fill: 0x140f24 },
  explosive: { density: 6, friction: 0.8, restitution: 0.1, conductivity: 0.2, flammability: 1, fragility: 1.3, color: 0xff4040, fill: 0x2e1010 },
};
