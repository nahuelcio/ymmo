import type { StatusApply } from '../status';

export type MobShape = 'beast' | 'goblin' | 'orc' | 'golem' | 'undead' | 'spider';

export interface Drop { item: string; chance: number; min?: number; max?: number }

export interface MobDef {
  id: string;
  name: string;
  level: number;
  shape: MobShape;
  color: number;
  scale: number;
  aggressive: boolean;
  speed: number;
  atkInterval: number;
  range: number;
  hpMult?: number;
  atkMult?: number;
  defMult?: number;
  respawn?: number; // ms
  boss?: boolean;
  /** camp leader: tougher, marked on its nameplate */
  elite?: boolean;
  /** status their basic hits can apply */
  onHit?: StatusApply;
  /** telegraphed area attack: wind-up shown on the ground, dodgeable */
  special?: { r: number; windup: number; mult: number; every: number; at: 'self' | 'target'; stun?: number };
  /** raid boss phases: crossing each HP threshold (in %) summons adds, hastes it and/or swaps its special */
  phases?: MobPhase[];
  adena: [number, number];
  drops: Drop[];
}

export interface MobPhase {
  at: number;
  adds?: { mob: string; count: number };
  /** attack speed multiplier from this phase on */
  haste?: number;
  special?: MobDef['special'];
  /** boss yell, [es, en] */
  say: [string, string];
}

const list: MobDef[] = [
  // Windy Meadows 1-5
  { id: 'keltir', name: 'Keltir', level: 1, shape: 'beast', color: 0xb08850, scale: 0.6, aggressive: false, speed: 4, atkInterval: 1600, range: 1.6, adena: [4, 12],
    drops: [{ item: 'animal_skin', chance: 0.35 }, { item: 'lesser_healing_potion', chance: 0.05 }] },
  { id: 'gremlin', name: 'Gremlin', level: 2, shape: 'goblin', color: 0x7fae4a, scale: 0.55, aggressive: false, speed: 4, atkInterval: 1500, range: 1.6, adena: [6, 16],
    drops: [{ item: 'animal_bone', chance: 0.35 }, { item: 'leather_cap', chance: 0.02 }] },
  { id: 'elder_keltir', name: 'Keltir Anciano', level: 3, shape: 'beast', color: 0x8a6030, scale: 0.75, aggressive: false, speed: 4.5, atkInterval: 1500, range: 1.8, adena: [10, 22],
    drops: [{ item: 'animal_skin', chance: 0.4, max: 2 }, { item: 'short_gloves', chance: 0.02 }] },
  { id: 'young_wolf', name: 'Lobo Joven', level: 4, shape: 'beast', color: 0x8c8c8c, scale: 0.8, aggressive: true, speed: 5, atkInterval: 1400, range: 1.8, adena: [14, 28],
    drops: [{ item: 'wolf_pelt', chance: 0.5 }, { item: 'leather_sandals', chance: 0.03 }, { item: 'lesser_healing_potion', chance: 0.08 }] },
  // Goblin Hills 5-10
  { id: 'goblin_scout', name: 'Explorador Goblin', level: 6, shape: 'goblin', color: 0x5f8f3a, scale: 0.75, aggressive: false, speed: 5, atkInterval: 1400, range: 1.8, adena: [25, 45],
    drops: [{ item: 'goblin_ear', chance: 0.3 }, { item: 'broadsword', chance: 0.015 }, { item: 'healing_potion', chance: 0.05 }] },
  { id: 'wolf', name: 'Lobo', level: 7, shape: 'beast', color: 0x6a6a70, scale: 1.0, aggressive: true, speed: 5.5, atkInterval: 1300, range: 2, adena: [30, 55],
    drops: [{ item: 'wolf_pelt', chance: 0.55, max: 2 }, { item: 'reinforced_boots', chance: 0.01 }] },
  { id: 'goblin_brute', name: 'Bruto Goblin', level: 8, shape: 'orc', color: 0x4f7f2a, scale: 0.95, aggressive: false, speed: 4.5, atkInterval: 1600, range: 2, hpMult: 1.2, special: { r: 3, windup: 1100, mult: 1.8, every: 9000, at: 'self' }, adena: [40, 70],
    drops: [{ item: 'goblin_ear', chance: 0.4, max: 2 }, { item: 'iron_hammer', chance: 0.015 }, { item: 'brigandine_helm', chance: 0.01 }] },
  { id: 'hill_lizard', name: 'Lagarto de las Colinas', level: 9, shape: 'beast', color: 0x4a8a6a, scale: 1.0, aggressive: true, speed: 5, atkInterval: 1400, range: 2, adena: [45, 80],
    drops: [{ item: 'animal_skin', chance: 0.5, max: 3 }, { item: 'reinforced_gloves', chance: 0.012 }, { item: 'mana_potion', chance: 0.05 }] },
  // Orc Barracks 10-15
  { id: 'orc_warrior', name: 'Guerrero Orco', level: 11, shape: 'orc', color: 0x6a8a3a, scale: 1.05, aggressive: false, speed: 5, atkInterval: 1500, range: 2.2, adena: [70, 120],
    drops: [{ item: 'orc_tusk', chance: 0.3 }, { item: 'brigandine_gaiters', chance: 0.012 }, { item: 'healing_potion', chance: 0.08 }] },
  { id: 'orc_archer', name: 'Arquero Orco', level: 12, shape: 'orc', color: 0x7a7a3a, scale: 0.95, aggressive: true, speed: 4.5, atkInterval: 2000, range: 14, atkMult: 0.85, adena: [80, 130],
    drops: [{ item: 'orc_tusk', chance: 0.3 }, { item: 'karmian_stockings', chance: 0.012 }] },
  { id: 'orc_shaman', name: 'Chamán Orco', level: 13, shape: 'orc', color: 0x8a5a7a, scale: 0.95, aggressive: false, speed: 4.5, atkInterval: 1800, range: 10, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [90, 150],
    drops: [{ item: 'orc_tusk', chance: 0.3 }, { item: 'staff_of_life', chance: 0.01 }, { item: 'karmian_tunic', chance: 0.01 }, { item: 'mana_potion', chance: 0.1 }] },
  { id: 'werewolf', name: 'Hombre Lobo', level: 14, shape: 'beast', color: 0x4a3a30, scale: 1.4, aggressive: true, speed: 6, atkInterval: 1200, range: 2.4, onHit: { id: 'bleed', ms: 5000, chance: 0.25, dot: 0.2 }, adena: [100, 170],
    drops: [{ item: 'wolf_pelt', chance: 0.7, max: 3 }, { item: 'sword_of_revolution', chance: 0.01 }, { item: 'brigandine_tunic', chance: 0.01 }] },
  { id: 'orc_captain', name: 'Capitán Orco', level: 15, shape: 'orc', color: 0x8a2a2a, scale: 1.35, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 2.5, atkMult: 1.2, respawn: 60000, special: { r: 4.5, windup: 1200, mult: 2.2, every: 8000, at: 'self', stun: 1500 }, adena: [250, 450],
    drops: [{ item: 'orc_tusk', chance: 1, min: 2, max: 4 }, { item: 'war_hammer', chance: 0.05 }, { item: 'brigandine_tunic', chance: 0.05 }] },
  // Cursed Wastes 15-20
  { id: 'skeleton', name: 'Soldado Esqueleto', level: 16, shape: 'undead', color: 0xd8d4c0, scale: 1.0, aggressive: true, speed: 5, atkInterval: 1400, range: 2.2, adena: [130, 210],
    drops: [{ item: 'cursed_bone', chance: 0.3 }, { item: 'full_plate_helmet', chance: 0.006 }, { item: 'ring_of_the_wastes', chance: 0.005 }] },
  { id: 'zombie', name: 'Zombi Podrido', level: 17, shape: 'undead', color: 0x6a8a5a, scale: 1.05, aggressive: false, speed: 3.5, atkInterval: 1800, range: 2.2, hpMult: 1.4, adena: [140, 230],
    drops: [{ item: 'cursed_bone', chance: 0.4, max: 2 }, { item: 'healing_potion', chance: 0.12 }, { item: 'earring_of_binding', chance: 0.005 }] },
  { id: 'stone_golem', name: 'Gólem de Piedra', level: 18, shape: 'golem', color: 0x8a8580, scale: 1.4, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.6, defMult: 1.3, special: { r: 4.5, windup: 1400, mult: 2.4, every: 10000, at: 'self', stun: 1200 }, adena: [170, 260],
    drops: [{ item: 'stone_fragment', chance: 0.5, max: 2 }, { item: 'scroll_enchant_armor', chance: 0.02 }, { item: 'full_plate_armor', chance: 0.006 }] },
  { id: 'cave_spider', name: 'Araña de las Cavernas', level: 19, shape: 'spider', color: 0x3a2a4a, scale: 1.2, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.18 }, adena: [180, 280],
    drops: [{ item: 'animal_skin', chance: 0.5, max: 3 }, { item: 'scroll_enchant_weapon', chance: 0.01 }, { item: 'demons_tunic', chance: 0.006 }, { item: 'demons_circlet', chance: 0.006 }, { item: 'sages_staff', chance: 0.005 }] },
  { id: 'kaim_vanul', name: 'Kaim Vanul', level: 22, shape: 'undead', color: 0x6a2a8a, scale: 2.2, aggressive: true, speed: 4.5, atkInterval: 1600, range: 3.5, hpMult: 14, atkMult: 1.4, defMult: 1.2, respawn: 300000, boss: true, onHit: { id: 'slow', ms: 3000, chance: 0.25 }, special: { r: 6, windup: 1500, mult: 2.6, every: 7000, at: 'target' }, adena: [3000, 6000],
    drops: [{ item: 'samurai_longsword', chance: 0.25 }, { item: 'sages_staff', chance: 0.25 }, { item: 'full_plate_armor', chance: 0.2 }, { item: 'demons_tunic', chance: 0.2 }, { item: 'necklace_of_the_ascended', chance: 0.15 }, { item: 'cursed_bone', chance: 1, min: 5, max: 10 }] },
  // Forsaken Coast 20-25
  { id: 'drowned_sailor', name: 'Marinero Ahogado', level: 21, shape: 'undead', color: 0x6a9a9a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1500, range: 2.2, adena: [220, 330],
    drops: [{ item: 'sea_pearl', chance: 0.3 }, { item: 'abyssal_boots', chance: 0.008 }, { item: 'healing_potion', chance: 0.1 }] },
  { id: 'tide_crab', name: 'Cangrejo de Marea', level: 22, shape: 'spider', color: 0xc85a3a, scale: 1.1, aggressive: false, speed: 4.5, atkInterval: 1500, range: 2.2, defMult: 1.2, adena: [240, 350],
    drops: [{ item: 'sea_pearl', chance: 0.35 }, { item: 'abyssal_gauntlets', chance: 0.008 }] },
  { id: 'sea_serpent', name: 'Serpiente Marina', level: 23, shape: 'beast', color: 0x3a8a8a, scale: 1.2, aggressive: true, speed: 5.5, atkInterval: 1300, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.25, dot: 0.18 }, adena: [260, 380],
    drops: [{ item: 'animal_skin', chance: 0.5, max: 3 }, { item: 'abyssal_helm', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.02 }] },
  { id: 'drowned_corsair', name: 'Corsario Ahogado', level: 24, shape: 'undead', color: 0x4a6a8a, scale: 1.1, aggressive: true, speed: 5, atkInterval: 1400, range: 2.4, hpMult: 1.2, onHit: { id: 'bleed', ms: 5000, chance: 0.25, dot: 0.2 }, adena: [280, 410],
    drops: [{ item: 'sea_pearl', chance: 0.4, max: 2 }, { item: 'abyssal_blade', chance: 0.006 }, { item: 'abyssal_ring', chance: 0.006 }] },
  { id: 'reef_golem', name: 'Gólem de Arrecife', level: 25, shape: 'golem', color: 0x5a8a7a, scale: 1.5, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.6, defMult: 1.3, special: { r: 4.5, windup: 1400, mult: 2.4, every: 10000, at: 'self', stun: 1200 }, adena: [320, 460],
    drops: [{ item: 'sea_pearl', chance: 0.6, max: 2 }, { item: 'abyssal_plate', chance: 0.006 }, { item: 'scroll_enchant_weapon', chance: 0.012 }] },
  // Sunken Ruins 25-30
  { id: 'ruin_wraith', name: 'Espectro de las Ruinas', level: 26, shape: 'undead', color: 0x9ab0d0, scale: 1.05, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [330, 480],
    drops: [{ item: 'ruin_relic', chance: 0.3 }, { item: 'abyssal_robe', chance: 0.006 }, { item: 'mana_potion', chance: 0.1 }] },
  { id: 'deep_lurker', name: 'Acechador Abisal', level: 27, shape: 'spider', color: 0x2a4a5a, scale: 1.3, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.18 }, adena: [350, 510],
    drops: [{ item: 'ruin_relic', chance: 0.3 }, { item: 'abyssal_greaves', chance: 0.007 }] },
  { id: 'ruin_sentinel', name: 'Centinela de las Ruinas', level: 28, shape: 'golem', color: 0x7a8a8a, scale: 1.5, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.6, defMult: 1.3, special: { r: 4.5, windup: 1400, mult: 2.4, every: 10000, at: 'self', stun: 1200 }, adena: [380, 550],
    drops: [{ item: 'ruin_relic', chance: 0.5, max: 2 }, { item: 'abyssal_plate', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'abyssal_cultist', name: 'Cultista Abisal', level: 29, shape: 'orc', color: 0x4a3a7a, scale: 0.95, aggressive: true, speed: 4.5, atkInterval: 1900, range: 12, atkMult: 0.9, adena: [400, 580],
    drops: [{ item: 'ruin_relic', chance: 0.35 }, { item: 'abyssal_staff', chance: 0.006 }, { item: 'abyssal_earring', chance: 0.006 }] },
  { id: 'aberration', name: 'Aberración', level: 30, shape: 'beast', color: 0x6a3a6a, scale: 1.6, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 1.5, special: { r: 5, windup: 1300, mult: 2.4, every: 9000, at: 'self' }, adena: [440, 640],
    drops: [{ item: 'ruin_relic', chance: 0.6, max: 2 }, { item: 'abyssal_necklace', chance: 0.008 }, { item: 'scroll_enchant_weapon', chance: 0.015 }] },
  // Burning Steppes 30-35
  { id: 'ash_hound', name: 'Sabueso de Ceniza', level: 31, shape: 'beast', color: 0x5a4a44, scale: 1.1, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, adena: [460, 660],
    drops: [{ item: 'ember_shard', chance: 0.3 }, { item: 'ashforged_boots', chance: 0.008 }, { item: 'greater_healing_potion', chance: 0.08 }] },
  { id: 'steppe_raider', name: 'Saqueador de las Estepas', level: 32, shape: 'orc', color: 0x9a5a2a, scale: 1.1, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, adena: [480, 700],
    drops: [{ item: 'ember_shard', chance: 0.3 }, { item: 'ashforged_gauntlets', chance: 0.008 }, { item: 'ashforged_blade', chance: 0.005 }] },
  { id: 'ember_spider', name: 'Araña de Brasas', level: 33, shape: 'spider', color: 0xc8501a, scale: 1.25, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [510, 740],
    drops: [{ item: 'ember_shard', chance: 0.35 }, { item: 'ashforged_helm', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'steppe_shaman', name: 'Chamán de las Estepas', level: 34, shape: 'orc', color: 0xa8402a, scale: 1.0, aggressive: false, speed: 4.5, atkInterval: 1800, range: 11, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [540, 780],
    drops: [{ item: 'ember_shard', chance: 0.35 }, { item: 'ashforged_staff', chance: 0.005 }, { item: 'ashforged_robe', chance: 0.006 }, { item: 'greater_mana_potion', chance: 0.08 }] },
  { id: 'magma_golem', name: 'Gólem de Magma', level: 35, shape: 'golem', color: 0xb8401a, scale: 1.6, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.7, defMult: 1.3, special: { r: 5, windup: 1400, mult: 2.5, every: 10000, at: 'self', stun: 1300 }, adena: [600, 860],
    drops: [{ item: 'ember_shard', chance: 0.6, max: 2 }, { item: 'ashforged_plate', chance: 0.007 }, { item: 'ashforged_ring', chance: 0.007 }, { item: 'scroll_enchant_weapon', chance: 0.015 }] },
  // Orc Citadel 35-40
  { id: 'citadel_guard', name: 'Guardia de la Ciudadela', level: 36, shape: 'orc', color: 0x4a5a3a, scale: 1.15, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, defMult: 1.15, adena: [620, 900],
    drops: [{ item: 'citadel_sigil', chance: 0.3 }, { item: 'ashforged_greaves', chance: 0.008 }, { item: 'greater_healing_potion', chance: 0.1 }] },
  { id: 'citadel_archer', name: 'Ballestero de la Ciudadela', level: 37, shape: 'orc', color: 0x6a6a3a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 2000, range: 14, atkMult: 0.85, adena: [650, 940],
    drops: [{ item: 'citadel_sigil', chance: 0.3 }, { item: 'ashforged_gauntlets', chance: 0.008 }] },
  { id: 'war_wolf', name: 'Lobo de Guerra', level: 38, shape: 'beast', color: 0x3a3a3a, scale: 1.45, aggressive: true, speed: 6.5, atkInterval: 1200, range: 2.4, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [680, 980],
    drops: [{ item: 'wolf_pelt', chance: 0.7, max: 3 }, { item: 'ashforged_boots', chance: 0.008 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'citadel_warlock', name: 'Brujo de la Ciudadela', level: 39, shape: 'orc', color: 0x6a2a6a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1800, range: 11, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [720, 1030],
    drops: [{ item: 'citadel_sigil', chance: 0.35 }, { item: 'ashforged_earring', chance: 0.007 }, { item: 'ashforged_robe', chance: 0.006 }, { item: 'greater_mana_potion', chance: 0.1 }] },
  { id: 'citadel_champion', name: 'Campeón de la Ciudadela', level: 40, shape: 'orc', color: 0x8a1a1a, scale: 1.45, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 2.5, atkMult: 1.2, respawn: 60000, special: { r: 5, windup: 1200, mult: 2.4, every: 8000, at: 'self', stun: 1500 }, adena: [1500, 2400],
    drops: [{ item: 'citadel_sigil', chance: 1, min: 2, max: 4 }, { item: 'ashforged_blade', chance: 0.05 }, { item: 'ashforged_plate', chance: 0.05 }, { item: 'ashforged_necklace', chance: 0.05 }, { item: 'scroll_enchant_weapon', chance: 0.1 }] },
  // Dragon Valley 40-45
  { id: 'drake_whelp', name: 'Cría de Draco', level: 41, shape: 'beast', color: 0x4a8a4a, scale: 1.1, aggressive: true, speed: 5.5, atkInterval: 1300, range: 2.2, adena: [760, 1090],
    drops: [{ item: 'drake_scale', chance: 0.3 }, { item: 'dragon_boots', chance: 0.008 }, { item: 'greater_healing_potion', chance: 0.1 }] },
  { id: 'valley_basilisk', name: 'Basilisco del Valle', level: 42, shape: 'beast', color: 0x6a7a3a, scale: 1.4, aggressive: true, speed: 5, atkInterval: 1500, range: 2.4, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [800, 1140],
    drops: [{ item: 'drake_scale', chance: 0.3 }, { item: 'dragon_gauntlets', chance: 0.008 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'obsidian_golem', name: 'Gólem de Obsidiana', level: 43, shape: 'golem', color: 0x2a2a34, scale: 1.6, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.7, defMult: 1.35, special: { r: 5, windup: 1400, mult: 2.5, every: 10000, at: 'self', stun: 1300 }, adena: [850, 1210],
    drops: [{ item: 'stone_fragment', chance: 0.6, max: 3 }, { item: 'dragon_helm', chance: 0.007 }, { item: 'dragon_plate', chance: 0.006 }] },
  { id: 'wyvern', name: 'Guiverno', level: 44, shape: 'beast', color: 0x8a6a3a, scale: 1.5, aggressive: true, speed: 6.5, atkInterval: 1200, range: 2.6, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [900, 1280],
    drops: [{ item: 'drake_scale', chance: 0.4, max: 2 }, { item: 'dragon_greaves', chance: 0.008 }, { item: 'dragon_ring', chance: 0.006 }] },
  { id: 'elder_drake', name: 'Draco Anciano', level: 45, shape: 'beast', color: 0x2a6a3a, scale: 1.9, aggressive: true, speed: 5, atkInterval: 1600, range: 3, hpMult: 1.8, atkMult: 1.1, special: { r: 6, windup: 1500, mult: 2.6, every: 8000, at: 'target' }, adena: [1000, 1420],
    drops: [{ item: 'drake_scale', chance: 0.7, max: 3 }, { item: 'dragon_blade', chance: 0.006 }, { item: 'dragon_staff', chance: 0.006 }, { item: 'scroll_enchant_weapon', chance: 0.02 }] },
  // Dragon's Nest 45-50
  { id: 'nest_guardian', name: 'Guardián del Nido', level: 46, shape: 'golem', color: 0x5a3a2a, scale: 1.7, aggressive: true, speed: 3.5, atkInterval: 2000, range: 2.8, hpMult: 1.7, defMult: 1.35, special: { r: 5.5, windup: 1400, mult: 2.6, every: 9000, at: 'self', stun: 1400 }, adena: [1050, 1500],
    drops: [{ item: 'dragon_fang', chance: 0.3 }, { item: 'dragon_plate', chance: 0.007 }, { item: 'greater_healing_potion', chance: 0.12 }] },
  { id: 'dragon_cultist', name: 'Cultista del Dragón', level: 47, shape: 'orc', color: 0x7a2a2a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1800, range: 12, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [1100, 1570],
    drops: [{ item: 'dragon_fang', chance: 0.3 }, { item: 'dragon_robe', chance: 0.007 }, { item: 'dragon_earring', chance: 0.007 }, { item: 'greater_mana_potion', chance: 0.12 }] },
  { id: 'brood_spider', name: 'Araña de la Nidada', level: 48, shape: 'spider', color: 0x4a1a2a, scale: 1.4, aggressive: true, speed: 6.5, atkInterval: 1100, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.35, dot: 0.2 }, adena: [1160, 1650],
    drops: [{ item: 'dragon_fang', chance: 0.3 }, { item: 'dragon_gauntlets', chance: 0.008 }, { item: 'scroll_enchant_armor', chance: 0.03 }] },
  { id: 'dragonkin', name: 'Dracónido', level: 49, shape: 'orc', color: 0x3a6a5a, scale: 1.35, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.6, hpMult: 1.4, atkMult: 1.1, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [1230, 1740],
    drops: [{ item: 'dragon_fang', chance: 0.4, max: 2 }, { item: 'dragon_blade', chance: 0.007 }, { item: 'dragon_helm', chance: 0.008 }] },
  { id: 'ancient_drake', name: 'Draco Ancestral', level: 50, shape: 'beast', color: 0x6a1a1a, scale: 2.1, aggressive: true, speed: 5, atkInterval: 1600, range: 3.2, hpMult: 2, atkMult: 1.15, special: { r: 6.5, windup: 1500, mult: 2.7, every: 8000, at: 'target' }, adena: [1400, 1950],
    drops: [{ item: 'dragon_fang', chance: 0.7, max: 3 }, { item: 'dragon_staff', chance: 0.007 }, { item: 'dragon_necklace', chance: 0.008 }, { item: 'scroll_enchant_weapon', chance: 0.025 }] },
  // World bosses 20-50, one per pair of zones, and the adds their phases call
  { id: 'coast_queen', name: 'Reina de la Costa', level: 25, shape: 'spider', color: 0xb03a5a, scale: 2.4, aggressive: true, speed: 4.5, atkInterval: 1600, range: 3.5, hpMult: 14, atkMult: 1.4, defMult: 1.2, respawn: 300000, boss: true,
    onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.2 }, special: { r: 6, windup: 1500, mult: 2.6, every: 7000, at: 'target' },
    phases: [
      { at: 60, adds: { mob: 'tide_spawn', count: 4 }, say: ['¡La marea me obedece!', 'The tide obeys me!'] },
      { at: 25, adds: { mob: 'tide_spawn', count: 5 }, haste: 1.3, say: ['¡Se van a ahogar todos!', 'You will all drown!'] },
    ],
    adena: [5000, 9000],
    drops: [{ item: 'abyssal_blade', chance: 0.3 }, { item: 'abyssal_staff', chance: 0.3 }, { item: 'abyssal_plate', chance: 0.25 }, { item: 'abyssal_robe', chance: 0.25 }, { item: 'abyssal_necklace', chance: 0.3 },
      { item: 'scroll_enchant_weapon', chance: 0.6 }, { item: 'scroll_enchant_armor', chance: 1, min: 1, max: 3 }, { item: 'sea_pearl', chance: 1, min: 5, max: 10 }] },
  { id: 'tide_spawn', name: 'Engendro de la Marea', level: 23, shape: 'spider', color: 0xc86a7a, scale: 0.8, aggressive: true, speed: 5.5, atkInterval: 1400, range: 1.8, respawn: 1e12, adena: [0, 0], drops: [] },
  { id: 'gruhash', name: 'Gruhash, Señor de la Guerra', level: 35, shape: 'orc', color: 0x7a1a1a, scale: 2.3, aggressive: true, speed: 5, atkInterval: 1600, range: 3.5, hpMult: 15, atkMult: 1.4, defMult: 1.2, respawn: 300000, boss: true,
    special: { r: 6, windup: 1400, mult: 2.6, every: 8000, at: 'self', stun: 1500 },
    phases: [
      { at: 70, adds: { mob: 'gruhash_guard', count: 4 }, say: ['¡A mí, guardia!', 'Guards, to me!'] },
      { at: 30, haste: 1.5, special: { r: 9, windup: 1500, mult: 2.8, every: 6000, at: 'self', stun: 1500 }, say: ['¡Las estepas arden con ustedes adentro!', 'The steppes burn with you in them!'] },
    ],
    adena: [9000, 15000],
    drops: [{ item: 'ashforged_blade', chance: 0.3 }, { item: 'ashforged_staff', chance: 0.3 }, { item: 'ashforged_plate', chance: 0.25 }, { item: 'ashforged_robe', chance: 0.25 }, { item: 'ashforged_ring', chance: 0.3 },
      { item: 'scroll_enchant_weapon', chance: 0.8 }, { item: 'scroll_enchant_armor', chance: 1, min: 2, max: 4 }, { item: 'ember_shard', chance: 1, min: 5, max: 10 }] },
  { id: 'gruhash_guard', name: 'Guardia de Gruhash', level: 33, shape: 'orc', color: 0x8a3a2a, scale: 1.1, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  { id: 'kaim_reborn', name: 'Kaim Vanul Renacido', level: 45, shape: 'undead', color: 0xaa2a6a, scale: 2.6, aggressive: true, speed: 4.5, atkInterval: 1600, range: 3.8, hpMult: 16, atkMult: 1.4, defMult: 1.25, respawn: 300000, boss: true,
    onHit: { id: 'slow', ms: 3000, chance: 0.25 }, special: { r: 6.5, windup: 1500, mult: 2.7, every: 7000, at: 'target' },
    phases: [
      { at: 75, adds: { mob: 'reborn_servant', count: 4 }, say: ['¿Creyeron que un sello me iba a detener?', 'Did you think a seal would hold me?'] },
      { at: 45, haste: 1.3, special: { r: 9, windup: 1600, mult: 2.8, every: 7000, at: 'self', stun: 1500 }, say: ['¡El valle también va a ser mío!', 'The valley will be mine as well!'] },
      { at: 15, adds: { mob: 'reborn_servant', count: 6 }, haste: 1.6, say: ['¡NO VUELVO A LA TUMBA!', 'I WILL NOT GO BACK TO THE GRAVE!'] },
    ],
    adena: [14000, 22000],
    drops: [{ item: 'dragon_blade', chance: 0.25 }, { item: 'dragon_staff', chance: 0.25 }, { item: 'dragon_plate', chance: 0.2 }, { item: 'dragon_robe', chance: 0.2 }, { item: 'dragon_earring', chance: 0.3 },
      { item: 'scroll_enchant_weapon', chance: 1 }, { item: 'scroll_enchant_armor', chance: 1, min: 2, max: 5 }, { item: 'drake_scale', chance: 1, min: 5, max: 10 }] },
  { id: 'reborn_servant', name: 'Siervo Renacido', level: 43, shape: 'undead', color: 0xc8a0b0, scale: 1.0, aggressive: true, speed: 5, atkInterval: 1500, range: 1.8, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Dragon's Nest raid (instanced, `/raid nest`)
  { id: 'vharion', name: 'Vharion, el Dragón Ancestral', level: 50, shape: 'beast', color: 0x8a1010, scale: 3.6, aggressive: true, speed: 4.5, atkInterval: 1800, range: 5, hpMult: 22, atkMult: 1.35, defMult: 1.2, respawn: 1e12, boss: true,
    onHit: { id: 'bleed', ms: 5000, chance: 0.25, dot: 0.2 }, special: { r: 8, windup: 1800, mult: 2.6, every: 9000, at: 'target' },
    phases: [
      { at: 80, adds: { mob: 'nest_hatchling', count: 4 }, say: ['Despierten, hijos míos. Hay carne.', 'Wake, my children. There is meat.'] },
      { at: 55, haste: 1.25, special: { r: 10, windup: 1700, mult: 2.8, every: 8000, at: 'self', stun: 1500 }, say: ['¡Este nido es una tumba!', 'This nest is a grave!'] },
      { at: 30, adds: { mob: 'nest_hatchling', count: 6 }, say: ['¡Devoren todo!', 'Devour everything!'] },
      { at: 12, haste: 1.6, special: { r: 12, windup: 1500, mult: 3, every: 6000, at: 'self', stun: 1500 }, say: ['¡ARDAN CONMIGO!', 'BURN WITH ME!'] },
    ],
    adena: [30000, 50000],
    drops: [{ item: 'dragon_blade', chance: 0.7 }, { item: 'dragon_staff', chance: 0.7 }, { item: 'dragon_plate', chance: 0.6 }, { item: 'dragon_robe', chance: 0.6 }, { item: 'dragon_helm', chance: 0.6 },
      { item: 'dragon_ring', chance: 0.6 }, { item: 'dragon_earring', chance: 0.6 }, { item: 'dragon_necklace', chance: 0.6 },
      { item: 'scroll_enchant_weapon', chance: 1, min: 2, max: 4 }, { item: 'scroll_enchant_armor', chance: 1, min: 4, max: 8 }, { item: 'dragon_fang', chance: 1, min: 10, max: 20 }] },
  { id: 'nest_hatchling', name: 'Cría del Nido', level: 48, shape: 'beast', color: 0xb03a1a, scale: 1.0, aggressive: true, speed: 6, atkInterval: 1300, range: 1.8, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Raid (instanced, see data/raids.ts): HP scales with the raid size when it spawns
  { id: 'kaim_ascended', name: 'Kaim Vanul, el Ascendido', level: 20, shape: 'undead', color: 0x8a2aaa, scale: 2.8, aggressive: true, speed: 4.5, atkInterval: 1800, range: 4, hpMult: 18, atkMult: 1.25, defMult: 1.1, respawn: 1e12, boss: true,
    onHit: { id: 'slow', ms: 3000, chance: 0.2 }, special: { r: 7, windup: 1800, mult: 2.4, every: 9000, at: 'target' },
    phases: [
      { at: 70, adds: { mob: 'bone_servant', count: 4 }, say: ['¡Levántense, huesos! ¡Sirvan a su amo!', 'Rise, bones! Serve your master!'] },
      { at: 40, haste: 1.3, special: { r: 9, windup: 1600, mult: 2.6, every: 7000, at: 'self', stun: 1500 }, say: ['¡El páramo entero va a temblar!', 'The whole wasteland will shake!'] },
      { at: 15, adds: { mob: 'bone_servant', count: 6 }, haste: 1.6, say: ['¡NO! ¡No me van a sellar otra vez!', 'NO! You will not seal me again!'] },
    ],
    adena: [8000, 14000],
    drops: [{ item: 'samurai_longsword', chance: 0.6 }, { item: 'sages_staff', chance: 0.6 }, { item: 'full_plate_armor', chance: 0.5 }, { item: 'demons_tunic', chance: 0.5 }, { item: 'necklace_of_the_ascended', chance: 0.4 }, { item: 'ring_of_the_wastes', chance: 0.4 }, { item: 'earring_of_binding', chance: 0.4 }, { item: 'cursed_bone', chance: 1, min: 10, max: 20 }] },
  { id: 'bone_servant', name: 'Siervo de Hueso', level: 17, shape: 'undead', color: 0xb8b0a0, scale: 0.95, aggressive: true, speed: 5, atkInterval: 1500, range: 1.8, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Camp leaders (elite)
  { id: 'gremlin_chief', name: 'Jefe Gremlin', level: 4, shape: 'goblin', color: 0x5f8e2a, scale: 0.85, aggressive: true, speed: 4.5, atkInterval: 1300, range: 1.8, hpMult: 3, atkMult: 1.3, elite: true,
    special: { r: 3, windup: 1100, mult: 1.6, every: 9000, at: 'self' }, adena: [60, 120], drops: [{ item: 'lesser_healing_potion', chance: 0.5 }] },
  { id: 'goblin_chieftain', name: 'Cacique Goblin', level: 9, shape: 'orc', color: 0x3f6f2a, scale: 1.15, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, hpMult: 3.5, atkMult: 1.3, elite: true,
    special: { r: 3.5, windup: 1200, mult: 1.9, every: 8500, at: 'self', stun: 1200 }, adena: [150, 260], drops: [{ item: 'goblin_ear', chance: 1, min: 2, max: 3 }] },
  { id: 'orc_warlord', name: 'Señor de la Guerra Orco', level: 14, shape: 'orc', color: 0x6a3a2a, scale: 1.45, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 4, atkMult: 1.3, elite: true,
    special: { r: 4.5, windup: 1200, mult: 2.2, every: 8000, at: 'self', stun: 1500 }, adena: [400, 700], drops: [{ item: 'orc_tusk', chance: 1, min: 2, max: 4 }] },
  { id: 'crypt_knight', name: 'Caballero de la Cripta', level: 18, shape: 'undead', color: 0xc8c4b0, scale: 1.3, aggressive: true, speed: 4.5, atkInterval: 1400, range: 2.6, hpMult: 4.5, atkMult: 1.35, elite: true,
    onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.2 }, special: { r: 4.5, windup: 1300, mult: 2.4, every: 8000, at: 'self' }, adena: [700, 1100], drops: [{ item: 'cursed_bone', chance: 1, min: 2, max: 3 }] },
];

export const MOBS: Record<string, MobDef> = Object.fromEntries(list.map((m) => [m.id, m]));
