import { bladeAura, dimensionalSlash, fistBarrage, heavyAura, limiterBreak, shadowClones, spiritBeam, spiritDragon } from './defs/archetypes';
import { earth, fire, ice, lightning, water, wind } from './defs/elements';
import { explosives, manipulate, tech, toxins } from './defs/misc';
import { force, gravity, spacetime, telekinesis } from './defs/physics';
import type { Power, PowerCategory } from './types';

export const POWERS: Power[] = [
  lightning, fire, ice, wind, earth, water,
  gravity, telekinesis, spacetime, force,
  spiritBeam, fistBarrage, shadowClones, bladeAura, heavyAura, spiritDragon, dimensionalSlash, limiterBreak,
  toxins, explosives, tech, manipulate,
];

export const CATEGORIES: PowerCategory[] = ['Elements', 'Physics', 'Archetypes', 'Misc'];
