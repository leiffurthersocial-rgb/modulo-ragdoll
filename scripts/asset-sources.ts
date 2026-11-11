// Curated asset list. Every entry is license-checked by its adapter at fetch time;
// entries whose license isn't whitelisted are skipped and reported, never downloaded into the game.
import type { SourceEntry } from './lib/types.ts';

export const SOURCES: SourceEntry[] = [
  // ------------------------------------------------------------ Backdrops (Poly Haven HDRIs, tonemapped LDR)
  { id: 'bd_night_field', kind: 'polyhaven', asset: 'moonless_golf', map: 'tonemapped', usage: 'backdrop',
    purpose: 'Starry night sky, dimmed + blurred behind the flat-floor arena' },
  { id: 'bd_night_city', kind: 'polyhaven', asset: 'shanghai_bund', map: 'tonemapped', usage: 'backdrop',
    purpose: 'Night city lights, bokeh backdrop for the tower arena' },
  { id: 'bd_industrial', kind: 'polyhaven', asset: 'abandoned_parking', map: 'tonemapped', usage: 'backdrop',
    purpose: 'Concrete interior for the enclosed-box arena' },
  { id: 'bd_space', kind: 'polyhaven', asset: 'satara_night', map: 'tonemapped', usage: 'backdrop',
    purpose: 'Dark sky for the zero-g arena (stars added procedurally)' },

  // ------------------------------------------------------------ Surface textures (tinted, low-contrast)
  { id: 'tx_concrete', kind: 'polyhaven', asset: 'concrete_floor_02', map: 'Diffuse', resolution: '1k', usage: 'texture',
    purpose: 'Floor / platform detail, multiplied very dark under neon rim' },
  { id: 'tx_metal_plates', kind: 'ambientcg', asset: 'MetalPlates006', maps: ['Color'], usage: 'texture',
    purpose: 'Metal walls / pit sides' },
  { id: 'tx_diamond_plate', kind: 'ambientcg', asset: 'DiamondPlate001', maps: ['Color'], usage: 'texture',
    purpose: 'Tower platforms' },

  // ------------------------------------------------------------ Particles / UI sprites (Kenney via OpenGameArt, CC0)
  { id: 'kenney_particles', kind: 'opengameart', slug: 'particle-pack-80-sprites', usage: 'particle',
    purpose: 'Small sprite details: smoke, scorch, twirl, spark',
    pick: {
      'PNG/smoke_0[1-4].png': 'particle/*',
      'PNG/scorch_0[1-3].png': 'particle/*',
      'PNG/spark_0[1-7].png': 'particle/*',
      'PNG/twirl_0[1-3].png': 'particle/*',
      'PNG/flare_01.png': 'particle/*',
      'PNG/dirt_0[1-3].png': 'particle/*',
      'PNG/flame_0[1-4].png': 'particle/*',
      'PNG/magic_0[1-5].png': 'particle/*',
      'PNG/light_0[1-3].png': 'particle/*',
      'PNG/circle_0[1-5].png': 'particle/*',
      'PNG/slash_0[1-4].png': 'particle/*',
      'PNG/trace_0[1-3].png': 'particle/*',
      'PNG/star_0[1-4].png': 'particle/*',
    } },

  // ------------------------------------------------------------ Sound effects (CC0 / CC-BY packs on OpenGameArt)
  { id: 'kenney_interface', kind: 'opengameart', slug: 'interface-sounds', usage: 'sfx',
    purpose: 'UI clicks, toggles, menu open/close',
    pick: { '**/click_00[1-5].ogg': 'sfx/ui_*', '**/toggle_00[1-4].ogg': 'sfx/ui_*', '**/open_00[1-2].ogg': 'sfx/ui_*',
      '**/close_00[1-2].ogg': 'sfx/ui_*', '**/select_00[1-3].ogg': 'sfx/ui_*', '**/error_00[1-2].ogg': 'sfx/ui_*' } },
  { id: 'oga_100_sfx', kind: 'opengameart', slug: '100-cc0-sfx', usage: 'sfx',
    purpose: 'Body impacts, hits, breaks (Kenney Impact Sounds is not mirrored on OGA; see manual entry)',
    pick: { '**/*hit*.ogg': 'sfx/cc0a_*', '**/*impact*.ogg': 'sfx/cc0a_*', '**/*punch*.ogg': 'sfx/cc0a_*',
      '**/*break*.ogg': 'sfx/cc0a_*', '**/*crash*.ogg': 'sfx/cc0a_*', '**/*explo*.ogg': 'sfx/cc0a_*',
      '**/*swoosh*.ogg': 'sfx/cc0a_*', '**/*whoosh*.ogg': 'sfx/cc0a_*', '**/*wood*.ogg': 'sfx/cc0a_*',
      '**/*metal*.ogg': 'sfx/cc0a_*' } },
  { id: 'oga_scifi_50', kind: 'opengameart', slug: '50-cc0-sci-fi-sfx', usage: 'sfx',
    purpose: 'Energy, beams, charge-ups', pick: { '**/*.ogg': 'sfx/scifi_*', '**/*.wav': 'sfx/scifi_*' } },
  { id: 'kenney_scifi', kind: 'opengameart', slug: 'sci-fi-sounds', usage: 'sfx',
    purpose: 'Lasers, force fields, energy charge',
    pick: { '**/laserLarge_00[0-4].ogg': 'sfx/*', '**/laserSmall_00[0-4].ogg': 'sfx/*',
      '**/laserRetro_00[0-4].ogg': 'sfx/*', '**/forceField_00[0-4].ogg': 'sfx/*',
      '**/explosionCrunch_00[0-4].ogg': 'sfx/*', '**/lowFrequency_explosion_00[0-1].ogg': 'sfx/*',
      '**/thrusterFire_00[0-4].ogg': 'sfx/*', '**/impactMetal_00[0-4].ogg': 'sfx/*',
      '**/slime_00[0-4].ogg': 'sfx/*', '**/spaceEngineLow_00[0-2].ogg': 'sfx/*', '**/computerNoise_00[0-3].ogg': 'sfx/*' } },
  { id: 'oga_100_sfx_2', kind: 'opengameart', slug: '100-cc0-sfx-2', usage: 'sfx',
    purpose: 'General CC0 SFX: air, glass, hits, metal, water loops',
    pick: { '**/sfx100v2_air_*.ogg': 'sfx/*', '**/sfx100v2_glass_*.ogg': 'sfx/*', '**/sfx100v2_hit_*.ogg': 'sfx/*',
      '**/sfx100v2_metal*.ogg': 'sfx/*', '**/sfx100v2_misc_*.ogg': 'sfx/*', '**/sfx100v2_loop_water_01.ogg': 'ambience/*',
      '**/sfx100v2_loop_machine_01.ogg': 'ambience/*' } },
  { id: 'oga_rain_thunder', kind: 'opengameart', slug: 'rain-and-thunder-loop', usage: 'ambience',
    purpose: 'Storm cloud ambience', pick: { '*.wav': 'ambience/storm_loop' } },
  { id: 'oga_cracking', kind: 'opengameart', slug: 'cracking-sounds', usage: 'sfx',
    purpose: 'Ice shatter, cracks, joint breaks', pick: { '*.wav': 'sfx/*' } },

  // ------------------------------------------------------------ Music
  { id: 'oga_ambient_soundscape', kind: 'opengameart', slug: 'ambient-soundscape', usage: 'music',
    purpose: 'Calm menu / sandbox background music', files: ['ambient_soundscape.wav'],
    pick: { '*.wav': 'music/ambient_soundscape' } },

  // ------------------------------------------------------------ Icons (game-icons.net, CC BY 3.0)
  { id: 'icons_powers', kind: 'gameicons', usage: 'icon', purpose: 'Power wheel + power browser icons',
    icons: [
      'carl-olsen/flame', 'lorc/lightning-branches', 'lorc/ice-bolt', 'lorc/whirlwind', 'lorc/stone-sphere',
      'lorc/drop', 'lorc/wave-crest', 'lorc/vortex', 'lorc/magnet', 'lorc/hourglass', 'lorc/sonic-boom', 'lorc/beam-wake',
      'lorc/fist', 'lorc/two-shadows', 'lorc/sword-wound', 'lorc/dragon-spiral', 'lorc/portal', 'lorc/aura',
      'lorc/acid-blob', 'lorc/poison-gas', 'lorc/bright-explosion', 'lorc/laser-blast', 'lorc/saw-claw',
      'lorc/telepathy', 'lorc/black-hole-bolas', 'lorc/heavy-fall', 'delapouite/health-potion', 'lorc/fire-ring',
    ] },

  // ------------------------------------------------------------ Fonts (Google Fonts, OFL)
  { id: 'font_display', kind: 'googlefonts', family: 'Orbitron', weights: [500, 700, 900], metadataDir: 'orbitron',
    usage: 'font', purpose: 'Logo, headings, chaos score' },
  { id: 'font_ui', kind: 'googlefonts', family: 'Rajdhani', weights: [500, 600, 700], metadataDir: 'rajdhani',
    usage: 'font', purpose: 'UI text' },

  // ------------------------------------------------------------ Optional: need API keys (skipped without)
  { id: 'fs_thunder', kind: 'freesound', query: 'thunder clap close', take: 4, maxDuration: 8, usage: 'sfx',
    purpose: 'Thunder variations (better than the CC0 pack set)' },
  { id: 'fs_zap', kind: 'freesound', query: 'electric zap spark', take: 6, maxDuration: 3, usage: 'sfx',
    purpose: 'Electric arcs' },
  { id: 'fs_whoosh', kind: 'freesound', query: 'whoosh fast', take: 4, maxDuration: 3, usage: 'sfx', purpose: 'Wind' },
  { id: 'px_nebula', kind: 'pixabay', query: 'nebula dark', take: 2, imageType: 'photo', usage: 'backdrop',
    purpose: 'Zero-g arena alternate backdrop' },

  // ------------------------------------------------------------ Manual downloads (signed links / no API)
  { id: 'kenney_impact_manual', kind: 'manual', site: 'kenney.nl', pageUrl: 'https://kenney.nl/assets/impact-sounds',
    title: 'Impact Sounds', author: 'Kenney', license: 'CC0-1.0', expectFile: 'kenney_impact-sounds.zip', usage: 'sfx',
    purpose: 'Fallback if the OpenGameArt mirror of Impact Sounds is unavailable',
    pick: { '**/impactWood_heavy_00[0-4].ogg': 'sfx/*', '**/impactMetal_heavy_00[0-4].ogg': 'sfx/*',
      '**/impactPunch_heavy_00[0-4].ogg': 'sfx/*' } },
];
