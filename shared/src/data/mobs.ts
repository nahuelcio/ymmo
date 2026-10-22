import type { StatusApply } from '../status';

export type MobShape = 'beast' | 'goblin' | 'orc' | 'golem' | 'undead' | 'spider';

export interface Drop { item: string; chance: number; min?: number; max?: number }

/** World raid: telegraphed circles under several players at once (spread out!) */
export interface Barrage { count: number; r: number; windup: number; mult: number; every: number; range: number }
/** World raid: a wide circle round the boss that takes a share of everyone's max HP (get out, or be healed through it) */
export interface Pulse { r: number; windup: number; pct: number; every: number }
/** World raid: past `after` ms of one fight it attacks faster and harder */
export interface Enrage { after: number; haste: number; atk: number }

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
  barrage?: Barrage;
  pulse?: Pulse;
  enrage?: Enrage;
  adena: [number, number];
  drops: Drop[];
}

export interface MobPhase {
  at: number;
  adds?: { mob: string; count: number };
  /** attack speed multiplier from this phase on */
  haste?: number;
  special?: MobDef['special'];
  barrage?: Barrage;
  pulse?: Pulse;
  /** boss yell, [es, en] */
  say: [string, string];
}

/** Every armour piece of a region set (items.ts tier: no weapons, no jewellery), each at `chance`. */
function setArmor(set: string, chance: number): Drop[] {
  return ['helm', 'circlet', 'hood', 'plate', 'robe', 'jerkin', 'shield', 'cape', 'greaves', 'leggings', 'gauntlets', 'gloves', 'bracers', 'boots', 'shoes', 'treads']
    .map((p) => ({ item: `${set}_${p}`, chance }));
}

const list: MobDef[] = [
  // Wild game of the open country (layoutHerds): passive, they fight back once hit
  { id: 'cow', name: 'Vaca', level: 2, shape: 'beast', color: 0xeeeeee, scale: 1, aggressive: false, speed: 3, atkInterval: 1800, range: 2.2, adena: [3, 8],
    drops: [{ item: 'animal_skin', chance: 0.5 }, { item: 'animal_bone', chance: 0.3 }] },
  { id: 'donkey', name: 'Burro', level: 3, shape: 'beast', color: 0x8a7a6a, scale: 1, aggressive: false, speed: 3.5, atkInterval: 1700, range: 2.0, adena: [4, 10],
    drops: [{ item: 'animal_skin', chance: 0.5 }, { item: 'animal_bone', chance: 0.3 }] },
  { id: 'stag', name: 'Ciervo', level: 7, shape: 'beast', color: 0x9a6a3a, scale: 1, aggressive: false, speed: 6, atkInterval: 1500, range: 2.2, adena: [20, 40],
    drops: [{ item: 'animal_skin', chance: 0.6, max: 2 }, { item: 'animal_bone', chance: 0.4 }] },
  { id: 'wild_horse', name: 'Caballo Salvaje', level: 20, shape: 'beast', color: 0xe8e4dc, scale: 1, aggressive: false, speed: 6.5, atkInterval: 1500, range: 2.4, adena: [90, 160],
    drops: [{ item: 'animal_skin', chance: 0.6, max: 2 }, { item: 'animal_bone', chance: 0.4, max: 2 }] },
  { id: 'bull', name: 'Toro Bravo', level: 44, shape: 'beast', color: 0x3a2a22, scale: 1.1, aggressive: false, speed: 5.5, atkInterval: 1600, range: 2.6, hpMult: 1.4, adena: [400, 700],
    drops: [{ item: 'animal_skin', chance: 0.7, max: 3 }, { item: 'animal_bone', chance: 0.5, max: 2 }] },
  { id: 'alpaca', name: 'Alpaca de las Nieves', level: 54, shape: 'beast', color: 0xf4f0e8, scale: 1, aggressive: false, speed: 5, atkInterval: 1600, range: 2.2, adena: [600, 1000],
    drops: [{ item: 'animal_skin', chance: 0.7, max: 3 }, { item: 'animal_bone', chance: 0.4, max: 2 }] },
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
    drops: [{ item: 'goblin_ear', chance: 0.4, max: 2 }, { item: 'iron_hammer', chance: 0.015 }, { item: 'brigandine_helm', chance: 0.01 }, { item: 'brigandine_shield', chance: 0.01 }, { item: 'hunter_cape', chance: 0.01 }] },
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
    drops: [{ item: 'cursed_bone', chance: 0.3 }, { item: 'full_plate_helmet', chance: 0.006 }, { item: 'full_plate_shield', chance: 0.006 }, { item: 'knight_cape', chance: 0.006 }, { item: 'ring_of_the_wastes', chance: 0.005 }] },
  { id: 'zombie', name: 'Zombi Podrido', level: 17, shape: 'undead', color: 0x6a8a5a, scale: 1.05, aggressive: false, speed: 3.5, atkInterval: 1800, range: 2.2, hpMult: 1.4, adena: [140, 230],
    drops: [{ item: 'cursed_bone', chance: 0.4, max: 2 }, { item: 'healing_potion', chance: 0.12 }, { item: 'earring_of_binding', chance: 0.005 }] },
  { id: 'stone_golem', name: 'Gólem de Piedra', level: 18, shape: 'golem', color: 0x8a8580, scale: 1.4, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.6, defMult: 1.3, special: { r: 4.5, windup: 1400, mult: 2.4, every: 10000, at: 'self', stun: 1200 }, adena: [170, 260],
    drops: [{ item: 'stone_fragment', chance: 0.5, max: 2 }, { item: 'scroll_enchant_armor', chance: 0.02 }, { item: 'full_plate_armor', chance: 0.006 }] },
  { id: 'cave_spider', name: 'Araña de las Cavernas', level: 19, shape: 'spider', color: 0x3a2a4a, scale: 1.2, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.18 }, adena: [180, 280],
    drops: [{ item: 'animal_skin', chance: 0.5, max: 3 }, { item: 'scroll_enchant_weapon', chance: 0.01 }, { item: 'demons_tunic', chance: 0.006 }, { item: 'demons_circlet', chance: 0.006 }, { item: 'sages_staff', chance: 0.005 }] },
  { id: 'kaim_vanul', name: 'Kaim Vanul', level: 22, shape: 'undead', color: 0x6a2a8a, scale: 2.2, aggressive: true, speed: 4.5, atkInterval: 1600, range: 3.5, hpMult: 14, atkMult: 1.4, defMult: 1.2, respawn: 300000, boss: true, onHit: { id: 'slow', ms: 3000, chance: 0.25 }, special: { r: 6, windup: 1500, mult: 2.6, every: 7000, at: 'target' }, adena: [3000, 6000],
    drops: [{ item: 'samurai_longsword', chance: 0.25 }, { item: 'composite_bow', chance: 0.25 }, { item: 'stiletto', chance: 0.25 }, { item: 'sages_staff', chance: 0.25 }, { item: 'full_plate_armor', chance: 0.2 }, { item: 'demons_tunic', chance: 0.2 }, { item: 'necklace_of_the_ascended', chance: 0.15 }, { item: 'cursed_bone', chance: 1, min: 5, max: 10 }] },
  // Forsaken Coast 20-25
  { id: 'drowned_sailor', name: 'Marinero Ahogado', level: 21, shape: 'undead', color: 0x6a9a9a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1500, range: 2.2, adena: [220, 330],
    drops: [{ item: 'sea_pearl', chance: 0.3 }, { item: 'abyssal_boots', chance: 0.008 }, { item: 'abyssal_treads', chance: 0.008 }, { item: 'abyssal_shoes', chance: 0.008 }, { item: 'healing_potion', chance: 0.1 }] },
  { id: 'tide_crab', name: 'Cangrejo de Marea', level: 22, shape: 'spider', color: 0xc85a3a, scale: 1.1, aggressive: false, speed: 4.5, atkInterval: 1500, range: 2.2, defMult: 1.2, adena: [240, 350],
    drops: [{ item: 'sea_pearl', chance: 0.35 }, { item: 'abyssal_gauntlets', chance: 0.008 }, { item: 'abyssal_bracers', chance: 0.008 }, { item: 'abyssal_gloves', chance: 0.008 }] },
  { id: 'sea_serpent', name: 'Serpiente Marina', level: 23, shape: 'beast', color: 0x3a8a8a, scale: 1.2, aggressive: true, speed: 5.5, atkInterval: 1300, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.25, dot: 0.18 }, adena: [260, 380],
    drops: [{ item: 'animal_skin', chance: 0.5, max: 3 }, { item: 'abyssal_helm', chance: 0.007 }, { item: 'abyssal_hood', chance: 0.007 }, { item: 'abyssal_circlet', chance: 0.007 }, { item: 'abyssal_shield', chance: 0.007 }, { item: 'abyssal_cape', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.02 }] },
  { id: 'drowned_corsair', name: 'Corsario Ahogado', level: 24, shape: 'undead', color: 0x4a6a8a, scale: 1.1, aggressive: true, speed: 5, atkInterval: 1400, range: 2.4, hpMult: 1.2, onHit: { id: 'bleed', ms: 5000, chance: 0.25, dot: 0.2 }, adena: [280, 410],
    drops: [{ item: 'sea_pearl', chance: 0.4, max: 2 }, { item: 'abyssal_blade', chance: 0.006 }, { item: 'abyssal_duals', chance: 0.003 }, { item: 'abyssal_bow', chance: 0.006 }, { item: 'abyssal_dagger', chance: 0.006 }, { item: 'abyssal_ring', chance: 0.006 }] },
  { id: 'reef_golem', name: 'Gólem de Arrecife', level: 25, shape: 'golem', color: 0x5a8a7a, scale: 1.5, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.6, defMult: 1.3, special: { r: 4.5, windup: 1400, mult: 2.4, every: 10000, at: 'self', stun: 1200 }, adena: [320, 460],
    drops: [{ item: 'sea_pearl', chance: 0.6, max: 2 }, { item: 'abyssal_plate', chance: 0.006 }, { item: 'abyssal_jerkin', chance: 0.006 }, { item: 'scroll_enchant_weapon', chance: 0.012 }] },
  // Sunken Ruins 25-30
  { id: 'ruin_wraith', name: 'Espectro de las Ruinas', level: 26, shape: 'undead', color: 0x9ab0d0, scale: 1.05, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [330, 480],
    drops: [{ item: 'ruin_relic', chance: 0.3 }, { item: 'abyssal_robe', chance: 0.006 }, { item: 'mana_potion', chance: 0.1 }] },
  { id: 'deep_lurker', name: 'Acechador Abisal', level: 27, shape: 'spider', color: 0x2a4a5a, scale: 1.3, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.18 }, adena: [350, 510],
    drops: [{ item: 'ruin_relic', chance: 0.3 }, { item: 'abyssal_greaves', chance: 0.007 }, { item: 'abyssal_leggings', chance: 0.007 }] },
  { id: 'ruin_sentinel', name: 'Centinela de las Ruinas', level: 28, shape: 'golem', color: 0x7a8a8a, scale: 1.5, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.6, defMult: 1.3, special: { r: 4.5, windup: 1400, mult: 2.4, every: 10000, at: 'self', stun: 1200 }, adena: [380, 550],
    drops: [{ item: 'ruin_relic', chance: 0.5, max: 2 }, { item: 'abyssal_plate', chance: 0.007 }, { item: 'abyssal_jerkin', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'abyssal_cultist', name: 'Cultista Abisal', level: 29, shape: 'orc', color: 0x4a3a7a, scale: 0.95, aggressive: true, speed: 4.5, atkInterval: 1900, range: 12, atkMult: 0.9, adena: [400, 580],
    drops: [{ item: 'ruin_relic', chance: 0.35 }, { item: 'abyssal_staff', chance: 0.006 }, { item: 'abyssal_spellblade', chance: 0.006 }, { item: 'abyssal_earring', chance: 0.006 }] },
  { id: 'aberration', name: 'Aberración', level: 30, shape: 'beast', color: 0x6a3a6a, scale: 1.6, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 1.5, special: { r: 5, windup: 1300, mult: 2.4, every: 9000, at: 'self' }, adena: [440, 640],
    drops: [{ item: 'ruin_relic', chance: 0.6, max: 2 }, { item: 'abyssal_necklace', chance: 0.008 }, { item: 'scroll_enchant_weapon', chance: 0.015 }] },
  // Burning Steppes 30-35
  { id: 'ash_hound', name: 'Sabueso de Ceniza', level: 31, shape: 'beast', color: 0x5a4a44, scale: 1.1, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, adena: [460, 660],
    drops: [{ item: 'ember_shard', chance: 0.3 }, { item: 'ashforged_boots', chance: 0.008 }, { item: 'ashforged_treads', chance: 0.008 }, { item: 'ashforged_shoes', chance: 0.008 }, { item: 'greater_healing_potion', chance: 0.08 }] },
  { id: 'steppe_raider', name: 'Saqueador de las Estepas', level: 32, shape: 'orc', color: 0x9a5a2a, scale: 1.1, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, adena: [480, 700],
    drops: [{ item: 'ember_shard', chance: 0.3 }, { item: 'ashforged_gauntlets', chance: 0.008 }, { item: 'ashforged_bracers', chance: 0.008 }, { item: 'ashforged_gloves', chance: 0.008 }, { item: 'ashforged_blade', chance: 0.005 }, { item: 'ashforged_duals', chance: 0.0025 }, { item: 'ashforged_bow', chance: 0.005 }, { item: 'ashforged_dagger', chance: 0.005 }] },
  { id: 'ember_spider', name: 'Araña de Brasas', level: 33, shape: 'spider', color: 0xc8501a, scale: 1.25, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [510, 740],
    drops: [{ item: 'ember_shard', chance: 0.35 }, { item: 'ashforged_helm', chance: 0.007 }, { item: 'ashforged_hood', chance: 0.007 }, { item: 'ashforged_circlet', chance: 0.007 }, { item: 'ashforged_shield', chance: 0.007 }, { item: 'ashforged_cape', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'steppe_shaman', name: 'Chamán de las Estepas', level: 34, shape: 'orc', color: 0xa8402a, scale: 1.0, aggressive: false, speed: 4.5, atkInterval: 1800, range: 11, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [540, 780],
    drops: [{ item: 'ember_shard', chance: 0.35 }, { item: 'ashforged_staff', chance: 0.005 }, { item: 'ashforged_spellblade', chance: 0.005 }, { item: 'ashforged_robe', chance: 0.006 }, { item: 'greater_mana_potion', chance: 0.08 }] },
  { id: 'magma_golem', name: 'Gólem de Magma', level: 35, shape: 'golem', color: 0xb8401a, scale: 1.6, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.7, defMult: 1.3, special: { r: 5, windup: 1400, mult: 2.5, every: 10000, at: 'self', stun: 1300 }, adena: [600, 860],
    drops: [{ item: 'ember_shard', chance: 0.6, max: 2 }, { item: 'ashforged_plate', chance: 0.007 }, { item: 'ashforged_jerkin', chance: 0.007 }, { item: 'ashforged_ring', chance: 0.007 }, { item: 'scroll_enchant_weapon', chance: 0.015 }] },
  // Orc Citadel 35-40
  { id: 'citadel_guard', name: 'Guardia de la Ciudadela', level: 36, shape: 'orc', color: 0x4a5a3a, scale: 1.15, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, defMult: 1.15, adena: [620, 900],
    drops: [{ item: 'citadel_sigil', chance: 0.3 }, { item: 'ashforged_greaves', chance: 0.008 }, { item: 'ashforged_leggings', chance: 0.008 }, { item: 'greater_healing_potion', chance: 0.1 }] },
  { id: 'citadel_archer', name: 'Ballestero de la Ciudadela', level: 37, shape: 'orc', color: 0x6a6a3a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 2000, range: 14, atkMult: 0.85, adena: [650, 940],
    drops: [{ item: 'citadel_sigil', chance: 0.3 }, { item: 'ashforged_gauntlets', chance: 0.008 }, { item: 'ashforged_bracers', chance: 0.008 }, { item: 'ashforged_gloves', chance: 0.008 }] },
  { id: 'war_wolf', name: 'Lobo de Guerra', level: 38, shape: 'beast', color: 0x3a3a3a, scale: 1.45, aggressive: true, speed: 6.5, atkInterval: 1200, range: 2.4, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [680, 980],
    drops: [{ item: 'wolf_pelt', chance: 0.7, max: 3 }, { item: 'ashforged_boots', chance: 0.008 }, { item: 'ashforged_treads', chance: 0.008 }, { item: 'ashforged_shoes', chance: 0.008 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'citadel_warlock', name: 'Brujo de la Ciudadela', level: 39, shape: 'orc', color: 0x6a2a6a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1800, range: 11, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [720, 1030],
    drops: [{ item: 'citadel_sigil', chance: 0.35 }, { item: 'ashforged_earring', chance: 0.007 }, { item: 'ashforged_robe', chance: 0.006 }, { item: 'greater_mana_potion', chance: 0.1 }] },
  { id: 'citadel_champion', name: 'Campeón de la Ciudadela', level: 40, shape: 'orc', color: 0x8a1a1a, scale: 1.45, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 2.5, atkMult: 1.2, respawn: 60000, special: { r: 5, windup: 1200, mult: 2.4, every: 8000, at: 'self', stun: 1500 }, adena: [1500, 2400],
    drops: [{ item: 'citadel_sigil', chance: 1, min: 2, max: 4 }, { item: 'ashforged_blade', chance: 0.05 }, { item: 'ashforged_duals', chance: 0.025 }, { item: 'ashforged_bow', chance: 0.05 }, { item: 'ashforged_dagger', chance: 0.05 }, { item: 'ashforged_plate', chance: 0.05 }, { item: 'ashforged_jerkin', chance: 0.05 }, { item: 'ashforged_necklace', chance: 0.05 }, { item: 'scroll_enchant_weapon', chance: 0.1 }] },
  // Dragon Valley 40-45
  { id: 'drake_whelp', name: 'Cría de Draco', level: 41, shape: 'beast', color: 0x4a8a4a, scale: 1.1, aggressive: true, speed: 5.5, atkInterval: 1300, range: 2.2, adena: [760, 1090],
    drops: [{ item: 'drake_scale', chance: 0.3 }, { item: 'dragon_boots', chance: 0.008 }, { item: 'dragon_treads', chance: 0.008 }, { item: 'dragon_shoes', chance: 0.008 }, { item: 'greater_healing_potion', chance: 0.1 }] },
  { id: 'valley_basilisk', name: 'Basilisco del Valle', level: 42, shape: 'beast', color: 0x6a7a3a, scale: 1.4, aggressive: true, speed: 5, atkInterval: 1500, range: 2.4, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [800, 1140],
    drops: [{ item: 'drake_scale', chance: 0.3 }, { item: 'dragon_gauntlets', chance: 0.008 }, { item: 'dragon_bracers', chance: 0.008 }, { item: 'dragon_gloves', chance: 0.008 }, { item: 'scroll_enchant_armor', chance: 0.025 }] },
  { id: 'obsidian_golem', name: 'Gólem de Obsidiana', level: 43, shape: 'golem', color: 0x2a2a34, scale: 1.6, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.7, defMult: 1.35, special: { r: 5, windup: 1400, mult: 2.5, every: 10000, at: 'self', stun: 1300 }, adena: [850, 1210],
    drops: [{ item: 'stone_fragment', chance: 0.6, max: 3 }, { item: 'dragon_helm', chance: 0.007 }, { item: 'dragon_hood', chance: 0.007 }, { item: 'dragon_circlet', chance: 0.007 }, { item: 'dragon_shield', chance: 0.007 }, { item: 'dragon_cape', chance: 0.007 }, { item: 'dragon_plate', chance: 0.006 }, { item: 'dragon_jerkin', chance: 0.006 }] },
  { id: 'wyvern', name: 'Guiverno', level: 44, shape: 'beast', color: 0x8a6a3a, scale: 1.5, aggressive: true, speed: 6.5, atkInterval: 1200, range: 2.6, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [900, 1280],
    drops: [{ item: 'drake_scale', chance: 0.4, max: 2 }, { item: 'dragon_greaves', chance: 0.008 }, { item: 'dragon_leggings', chance: 0.008 }, { item: 'dragon_ring', chance: 0.006 }] },
  { id: 'elder_drake', name: 'Draco Anciano', level: 45, shape: 'beast', color: 0x2a6a3a, scale: 1.9, aggressive: true, speed: 5, atkInterval: 1600, range: 3, hpMult: 1.8, atkMult: 1.1, special: { r: 6, windup: 1500, mult: 2.6, every: 8000, at: 'target' }, adena: [1000, 1420],
    drops: [{ item: 'drake_scale', chance: 0.7, max: 3 }, { item: 'dragon_blade', chance: 0.006 }, { item: 'dragon_duals', chance: 0.003 }, { item: 'dragon_bow', chance: 0.006 }, { item: 'dragon_dagger', chance: 0.006 }, { item: 'dragon_staff', chance: 0.006 }, { item: 'dragon_spellblade', chance: 0.006 }, { item: 'scroll_enchant_weapon', chance: 0.02 }] },
  // Dragon's Nest 45-50
  { id: 'nest_guardian', name: 'Guardián del Nido', level: 46, shape: 'golem', color: 0x5a3a2a, scale: 1.7, aggressive: true, speed: 3.5, atkInterval: 2000, range: 2.8, hpMult: 1.7, defMult: 1.35, special: { r: 5.5, windup: 1400, mult: 2.6, every: 9000, at: 'self', stun: 1400 }, adena: [1050, 1500],
    drops: [{ item: 'dragon_fang', chance: 0.3 }, { item: 'dragon_plate', chance: 0.007 }, { item: 'dragon_jerkin', chance: 0.007 }, { item: 'greater_healing_potion', chance: 0.12 }] },
  { id: 'dragon_cultist', name: 'Cultista del Dragón', level: 47, shape: 'orc', color: 0x7a2a2a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1800, range: 12, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [1100, 1570],
    drops: [{ item: 'dragon_fang', chance: 0.3 }, { item: 'dragon_robe', chance: 0.007 }, { item: 'dragon_earring', chance: 0.007 }, { item: 'greater_mana_potion', chance: 0.12 }] },
  { id: 'brood_spider', name: 'Araña de la Nidada', level: 48, shape: 'spider', color: 0x4a1a2a, scale: 1.4, aggressive: true, speed: 6.5, atkInterval: 1100, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.35, dot: 0.2 }, adena: [1160, 1650],
    drops: [{ item: 'dragon_fang', chance: 0.3 }, { item: 'dragon_gauntlets', chance: 0.008 }, { item: 'dragon_bracers', chance: 0.008 }, { item: 'dragon_gloves', chance: 0.008 }, { item: 'scroll_enchant_armor', chance: 0.03 }] },
  { id: 'dragonkin', name: 'Dracónido', level: 49, shape: 'orc', color: 0x3a6a5a, scale: 1.35, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.6, hpMult: 1.4, atkMult: 1.1, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [1230, 1740],
    drops: [{ item: 'dragon_fang', chance: 0.4, max: 2 }, { item: 'dragon_blade', chance: 0.007 }, { item: 'dragon_duals', chance: 0.0035 }, { item: 'dragon_bow', chance: 0.007 }, { item: 'dragon_dagger', chance: 0.007 }, { item: 'dragon_helm', chance: 0.008 }, { item: 'dragon_hood', chance: 0.008 }, { item: 'dragon_circlet', chance: 0.008 }, { item: 'dragon_shield', chance: 0.008 }, { item: 'dragon_cape', chance: 0.008 }] },
  { id: 'ancient_drake', name: 'Draco Ancestral', level: 50, shape: 'beast', color: 0x6a1a1a, scale: 2.1, aggressive: true, speed: 5, atkInterval: 1600, range: 3.2, hpMult: 2, atkMult: 1.15, special: { r: 6.5, windup: 1500, mult: 2.7, every: 8000, at: 'target' }, adena: [1400, 1950],
    drops: [{ item: 'dragon_fang', chance: 0.7, max: 3 }, { item: 'dragon_staff', chance: 0.007 }, { item: 'dragon_spellblade', chance: 0.007 }, { item: 'dragon_necklace', chance: 0.008 }, { item: 'scroll_enchant_weapon', chance: 0.025 }] },
  // World bosses 20-50, one per pair of zones, and the adds their phases call
  { id: 'coast_queen', name: 'Reina de la Costa', level: 25, shape: 'spider', color: 0xb03a5a, scale: 2.4, aggressive: true, speed: 4.5, atkInterval: 1600, range: 3.5, hpMult: 14, atkMult: 1.4, defMult: 1.2, respawn: 300000, boss: true,
    onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.2 }, special: { r: 6, windup: 1500, mult: 2.6, every: 7000, at: 'target' },
    phases: [
      { at: 60, adds: { mob: 'tide_spawn', count: 4 }, say: ['¡La marea me obedece!', 'The tide obeys me!'] },
      { at: 25, adds: { mob: 'tide_spawn', count: 5 }, haste: 1.3, say: ['¡Se van a ahogar todos!', 'You will all drown!'] },
    ],
    adena: [5000, 9000],
    drops: [{ item: 'abyssal_blade', chance: 0.3 }, { item: 'abyssal_duals', chance: 0.15 }, { item: 'abyssal_bow', chance: 0.3 }, { item: 'abyssal_dagger', chance: 0.3 }, { item: 'abyssal_staff', chance: 0.3 }, { item: 'abyssal_spellblade', chance: 0.3 }, { item: 'abyssal_plate', chance: 0.25 }, { item: 'abyssal_jerkin', chance: 0.25 }, { item: 'abyssal_robe', chance: 0.25 }, { item: 'abyssal_necklace', chance: 0.3 },
      { item: 'scroll_enchant_weapon', chance: 0.6 }, { item: 'scroll_enchant_armor', chance: 1, min: 1, max: 3 }, { item: 'sea_pearl', chance: 1, min: 5, max: 10 }] },
  { id: 'tide_spawn', name: 'Engendro de la Marea', level: 23, shape: 'spider', color: 0xc86a7a, scale: 0.8, aggressive: true, speed: 5.5, atkInterval: 1400, range: 1.8, respawn: 1e12, adena: [0, 0], drops: [] },
  { id: 'gruhash', name: 'Gruhash, Señor de la Guerra', level: 35, shape: 'orc', color: 0x7a1a1a, scale: 2.3, aggressive: true, speed: 5, atkInterval: 1600, range: 3.5, hpMult: 15, atkMult: 1.4, defMult: 1.2, respawn: 300000, boss: true,
    special: { r: 6, windup: 1400, mult: 2.6, every: 8000, at: 'self', stun: 1500 },
    phases: [
      { at: 70, adds: { mob: 'gruhash_guard', count: 4 }, say: ['¡A mí, guardia!', 'Guards, to me!'] },
      { at: 30, haste: 1.5, special: { r: 9, windup: 1500, mult: 2.8, every: 6000, at: 'self', stun: 1500 }, say: ['¡Las estepas arden con ustedes adentro!', 'The steppes burn with you in them!'] },
    ],
    adena: [9000, 15000],
    drops: [{ item: 'ashforged_blade', chance: 0.3 }, { item: 'ashforged_duals', chance: 0.15 }, { item: 'ashforged_bow', chance: 0.3 }, { item: 'ashforged_dagger', chance: 0.3 }, { item: 'ashforged_staff', chance: 0.3 }, { item: 'ashforged_spellblade', chance: 0.3 }, { item: 'ashforged_plate', chance: 0.25 }, { item: 'ashforged_jerkin', chance: 0.25 }, { item: 'ashforged_robe', chance: 0.25 }, { item: 'ashforged_ring', chance: 0.3 },
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
    drops: [{ item: 'dragon_blade', chance: 0.25 }, { item: 'dragon_duals', chance: 0.125 }, { item: 'dragon_bow', chance: 0.25 }, { item: 'dragon_dagger', chance: 0.25 }, { item: 'dragon_staff', chance: 0.25 }, { item: 'dragon_spellblade', chance: 0.25 }, { item: 'dragon_plate', chance: 0.2 }, { item: 'dragon_jerkin', chance: 0.2 }, { item: 'dragon_robe', chance: 0.2 }, { item: 'dragon_earring', chance: 0.3 },
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
    drops: [{ item: 'dragon_blade', chance: 0.7 }, { item: 'dragon_duals', chance: 0.35 }, { item: 'dragon_bow', chance: 0.7 }, { item: 'dragon_dagger', chance: 0.7 }, { item: 'dragon_staff', chance: 0.7 }, { item: 'dragon_spellblade', chance: 0.7 }, { item: 'dragon_plate', chance: 0.6 }, { item: 'dragon_jerkin', chance: 0.6 }, { item: 'dragon_robe', chance: 0.6 }, { item: 'dragon_helm', chance: 0.6 }, { item: 'dragon_hood', chance: 0.6 }, { item: 'dragon_circlet', chance: 0.6 }, { item: 'dragon_shield', chance: 0.6 }, { item: 'dragon_cape', chance: 0.6 },
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
    drops: [{ item: 'samurai_longsword', chance: 0.6 }, { item: 'composite_bow', chance: 0.6 }, { item: 'stiletto', chance: 0.6 }, { item: 'sages_staff', chance: 0.6 }, { item: 'full_plate_armor', chance: 0.5 }, { item: 'demons_tunic', chance: 0.5 }, { item: 'necklace_of_the_ascended', chance: 0.4 }, { item: 'ring_of_the_wastes', chance: 0.4 }, { item: 'earring_of_binding', chance: 0.4 }, { item: 'cursed_bone', chance: 1, min: 10, max: 20 }] },
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
  // Frozen Tundra 50-55 (the frost region, past the north pass)
  { id: 'frost_wolf', name: 'Lobo de Escarcha', level: 51, shape: 'beast', color: 0xd8e4ee, scale: 1.1, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'bleed', ms: 5000, chance: 0.25, dot: 0.22 }, adena: [1490, 2050],
    drops: [{ item: 'frost_pelt', chance: 0.35 }, { item: 'glacial_boots', chance: 0.008 }, { item: 'glacial_treads', chance: 0.008 }, { item: 'glacial_shoes', chance: 0.008 }, { item: 'supreme_healing_potion', chance: 0.08 }] },
  { id: 'tundra_raider', name: 'Saqueador de la Tundra', level: 52, shape: 'orc', color: 0x8a6a4a, scale: 1.1, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, adena: [1580, 2180],
    drops: [{ item: 'frost_pelt', chance: 0.35 }, { item: 'glacial_gauntlets', chance: 0.008 }, { item: 'glacial_bracers', chance: 0.008 }, { item: 'glacial_gloves', chance: 0.008 }, { item: 'glacial_blade', chance: 0.005 }, { item: 'glacial_duals', chance: 0.0025 }, { item: 'glacial_bow', chance: 0.005 }, { item: 'glacial_dagger', chance: 0.005 }] },
  { id: 'frost_wraith', name: 'Espectro Gélido', level: 53, shape: 'undead', color: 0xa8d0f0, scale: 1.05, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [1670, 2300],
    drops: [{ item: 'ice_crystal', chance: 0.3 }, { item: 'glacial_robe', chance: 0.006 }, { item: 'supreme_mana_potion', chance: 0.08 }] },
  { id: 'ice_shaman', name: 'Chamán de Hielo', level: 54, shape: 'orc', color: 0x4a7aaa, scale: 1.0, aggressive: false, speed: 4.5, atkInterval: 1800, range: 11, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [1760, 2430],
    drops: [{ item: 'ice_crystal', chance: 0.35 }, { item: 'glacial_staff', chance: 0.005 }, { item: 'glacial_spellblade', chance: 0.005 }, { item: 'glacial_earring', chance: 0.006 }] },
  { id: 'ice_golem', name: 'Gólem de Hielo', level: 55, shape: 'golem', color: 0xa8d8f0, scale: 1.6, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.7, defMult: 1.35, special: { r: 5.5, windup: 1400, mult: 2.6, every: 10000, at: 'self', stun: 1300 }, adena: [1850, 2550],
    drops: [{ item: 'ice_crystal', chance: 0.6, max: 2 }, { item: 'glacial_plate', chance: 0.007 }, { item: 'glacial_jerkin', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.03 }] },
  // Frozen Peaks 55-60
  { id: 'yeti', name: 'Yeti', level: 56, shape: 'beast', color: 0xe8eef2, scale: 1.6, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.6, hpMult: 1.4, atkMult: 1.1, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [1940, 2680],
    drops: [{ item: 'frost_pelt', chance: 0.6, max: 2 }, { item: 'glacial_helm', chance: 0.008 }, { item: 'glacial_hood', chance: 0.008 }, { item: 'glacial_circlet', chance: 0.008 }, { item: 'glacial_shield', chance: 0.008 }, { item: 'glacial_cape', chance: 0.008 }, { item: 'scroll_enchant_weapon', chance: 0.015 }] },
  { id: 'white_drake', name: 'Draco Blanco', level: 57, shape: 'beast', color: 0xe0f0ff, scale: 1.5, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.6, special: { r: 6, windup: 1500, mult: 2.6, every: 8000, at: 'target' }, adena: [2030, 2800],
    drops: [{ item: 'ice_crystal', chance: 0.4, max: 2 }, { item: 'glacial_greaves', chance: 0.008 }, { item: 'glacial_leggings', chance: 0.008 }, { item: 'glacial_ring', chance: 0.006 }] },
  { id: 'frost_giant', name: 'Gigante de Escarcha', level: 58, shape: 'orc', color: 0x8aa8c8, scale: 1.8, aggressive: true, speed: 4.5, atkInterval: 1800, range: 3, hpMult: 1.8, atkMult: 1.15, special: { r: 5.5, windup: 1400, mult: 2.6, every: 9000, at: 'self', stun: 1400 }, adena: [2120, 2930],
    drops: [{ item: 'frost_pelt', chance: 0.5, max: 2 }, { item: 'glacial_plate', chance: 0.008 }, { item: 'glacial_jerkin', chance: 0.008 }, { item: 'glacial_necklace', chance: 0.006 }] },
  { id: 'frost_wyvern', name: 'Guiverno Gélido', level: 59, shape: 'beast', color: 0xc8e0f0, scale: 1.6, aggressive: true, speed: 6.5, atkInterval: 1200, range: 2.6, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [2210, 3050],
    drops: [{ item: 'ice_crystal', chance: 0.4, max: 2 }, { item: 'glacial_blade', chance: 0.006 }, { item: 'glacial_duals', chance: 0.003 }, { item: 'glacial_bow', chance: 0.006 }, { item: 'glacial_dagger', chance: 0.006 }, { item: 'glacial_staff', chance: 0.006 }, { item: 'glacial_spellblade', chance: 0.006 }, { item: 'scroll_enchant_armor', chance: 0.03 }] },
  { id: 'frost_knight', name: 'Caballero Gélido', level: 60, shape: 'undead', color: 0x9ac0e0, scale: 1.25, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 1.4, defMult: 1.2, onHit: { id: 'slow', ms: 3000, chance: 0.25 }, adena: [2300, 3170],
    drops: [{ item: 'ice_crystal', chance: 0.5, max: 2 }, { item: 'glacial_gauntlets', chance: 0.008 }, { item: 'glacial_bracers', chance: 0.008 }, { item: 'glacial_gloves', chance: 0.008 }, { item: 'scroll_enchant_weapon', chance: 0.02 }] },
  // the frost region's camp leaders (elite), world boss and raid
  { id: 'tundra_jarl', name: 'Jarl de la Tundra', level: 54, shape: 'orc', color: 0x6a4a3a, scale: 1.45, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 4.5, atkMult: 1.35, elite: true,
    special: { r: 5, windup: 1200, mult: 2.4, every: 8000, at: 'self', stun: 1500 }, adena: [3000, 4500], drops: [{ item: 'frost_pelt', chance: 1, min: 2, max: 3 }] },
  { id: 'yeti_matriarch', name: 'Matriarca Yeti', level: 59, shape: 'beast', color: 0xf0f4f8, scale: 2.0, aggressive: true, speed: 5.5, atkInterval: 1400, range: 3, hpMult: 5, atkMult: 1.35, elite: true,
    onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, special: { r: 5.5, windup: 1300, mult: 2.5, every: 8000, at: 'self' }, adena: [3800, 5600], drops: [{ item: 'frost_pelt', chance: 1, min: 2, max: 4 }] },
  { id: 'primal_yeti', name: 'Yeti Primigenio', level: 57, shape: 'beast', color: 0xf4f8fc, scale: 3.0, aggressive: true, speed: 5, atkInterval: 1600, range: 4, hpMult: 16, atkMult: 1.4, defMult: 1.25, respawn: 300000, boss: true,
    onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, special: { r: 6.5, windup: 1500, mult: 2.7, every: 7000, at: 'target' },
    phases: [
      { at: 70, adds: { mob: 'yeti_cub', count: 4 }, say: ['¡La montaña ruge conmigo!', 'The mountain roars with me!'] },
      { at: 35, haste: 1.4, special: { r: 10, windup: 1600, mult: 2.8, every: 7000, at: 'self', stun: 1500 }, say: ['¡AVALANCHA!', 'AVALANCHE!'] },
    ],
    adena: [20000, 32000],
    drops: [{ item: 'glacial_blade', chance: 0.25 }, { item: 'glacial_duals', chance: 0.125 }, { item: 'glacial_bow', chance: 0.25 }, { item: 'glacial_dagger', chance: 0.25 }, { item: 'glacial_staff', chance: 0.25 }, { item: 'glacial_spellblade', chance: 0.25 }, { item: 'glacial_plate', chance: 0.2 }, { item: 'glacial_jerkin', chance: 0.2 }, { item: 'glacial_robe', chance: 0.2 }, { item: 'glacial_necklace', chance: 0.3 },
      { item: 'scroll_enchant_weapon', chance: 1 }, { item: 'scroll_enchant_armor', chance: 1, min: 2, max: 5 }, { item: 'frost_pelt', chance: 1, min: 5, max: 10 }] },
  { id: 'yeti_cub', name: 'Cría de Yeti', level: 54, shape: 'beast', color: 0xe8eef2, scale: 0.9, aggressive: true, speed: 6, atkInterval: 1300, range: 1.8, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Frost Throne raid (instanced, `/raid frost`)
  { id: 'hrimgar', name: 'Hrimgar, el Rey Gélido', level: 60, shape: 'orc', color: 0x7a9ac0, scale: 3.0, aggressive: true, speed: 4.5, atkInterval: 1800, range: 5, hpMult: 24, atkMult: 1.35, defMult: 1.25, respawn: 1e12, boss: true,
    onHit: { id: 'slow', ms: 3000, chance: 0.25 }, special: { r: 8, windup: 1800, mult: 2.6, every: 9000, at: 'target' },
    phases: [
      { at: 80, adds: { mob: 'frost_guard', count: 4 }, say: ['De rodillas ante el trono.', 'Kneel before the throne.'] },
      { at: 55, haste: 1.25, special: { r: 10, windup: 1700, mult: 2.8, every: 8000, at: 'self', stun: 1500 }, say: ['¡El invierno no termina nunca!', 'Winter never ends!'] },
      { at: 30, adds: { mob: 'frost_guard', count: 6 }, say: ['¡Guardia, a mí!', 'Guard, to me!'] },
      { at: 12, haste: 1.6, special: { r: 12, windup: 1500, mult: 3, every: 6000, at: 'self', stun: 1500 }, say: ['¡CONGÉLENSE CONMIGO!', 'FREEZE WITH ME!'] },
    ],
    adena: [45000, 70000],
    drops: [{ item: 'glacial_blade', chance: 0.7 }, { item: 'glacial_duals', chance: 0.35 }, { item: 'glacial_bow', chance: 0.7 }, { item: 'glacial_dagger', chance: 0.7 }, { item: 'glacial_staff', chance: 0.7 }, { item: 'glacial_spellblade', chance: 0.7 }, { item: 'glacial_plate', chance: 0.6 }, { item: 'glacial_jerkin', chance: 0.6 }, { item: 'glacial_robe', chance: 0.6 }, { item: 'glacial_helm', chance: 0.6 }, { item: 'glacial_hood', chance: 0.6 }, { item: 'glacial_circlet', chance: 0.6 }, { item: 'glacial_shield', chance: 0.6 }, { item: 'glacial_cape', chance: 0.6 },
      { item: 'glacial_ring', chance: 0.6 }, { item: 'glacial_earring', chance: 0.6 }, { item: 'glacial_necklace', chance: 0.6 },
      { item: 'scroll_enchant_weapon', chance: 1, min: 2, max: 4 }, { item: 'scroll_enchant_armor', chance: 1, min: 4, max: 8 }, { item: 'ice_crystal', chance: 1, min: 10, max: 20 }] },
  { id: 'frost_guard', name: 'Guardia Gélido', level: 58, shape: 'undead', color: 0xa8c8e8, scale: 1.15, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Poison Swamp 60-65 (the swamp region, past the east pass)
  { id: 'swamp_cobra', name: 'Cobra del Pantano', level: 61, shape: 'beast', color: 0x7aa04a, scale: 1.25, aggressive: true, speed: 5.5, atkInterval: 1300, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.2 }, adena: [2390, 3300],
    drops: [{ item: 'swamp_venom', chance: 0.35 }, { item: 'emerald_boots', chance: 0.007 }, { item: 'emerald_treads', chance: 0.007 }, { item: 'emerald_shoes', chance: 0.007 }, { item: 'supreme_healing_potion', chance: 0.1 }] },
  { id: 'mud_crab', name: 'Cangrejo del Lodo', level: 62, shape: 'spider', color: 0x8a7050, scale: 1.25, aggressive: false, speed: 4.5, atkInterval: 1500, range: 2.2, defMult: 1.25, adena: [2480, 3420],
    drops: [{ item: 'swamp_venom', chance: 0.35 }, { item: 'emerald_gauntlets', chance: 0.007 }, { item: 'emerald_bracers', chance: 0.007 }, { item: 'emerald_gloves', chance: 0.007 }] },
  { id: 'bog_drowned', name: 'Ahogado del Pantano', level: 63, shape: 'undead', color: 0x6a8a5a, scale: 1.1, aggressive: true, speed: 4, atkInterval: 1700, range: 2.2, hpMult: 1.4, onHit: { id: 'slow', ms: 3000, chance: 0.25 }, adena: [2570, 3550],
    drops: [{ item: 'swamp_venom', chance: 0.4, max: 2 }, { item: 'emerald_greaves', chance: 0.007 }, { item: 'emerald_leggings', chance: 0.007 }, { item: 'scroll_enchant_armor', chance: 0.03 }] },
  { id: 'bog_witch', name: 'Bruja del Pantano', level: 64, shape: 'orc', color: 0x4a6a3a, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1800, range: 11, onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.2 }, adena: [2660, 3670],
    drops: [{ item: 'swamp_venom', chance: 0.35 }, { item: 'emerald_staff', chance: 0.005 }, { item: 'emerald_spellblade', chance: 0.005 }, { item: 'emerald_earring', chance: 0.006 }, { item: 'supreme_mana_potion', chance: 0.1 }] },
  { id: 'mire_lurker', name: 'Acechador del Fango', level: 65, shape: 'spider', color: 0x5a7a4a, scale: 1.4, aggressive: true, speed: 6, atkInterval: 1200, range: 2.4, hpMult: 1.3, onHit: { id: 'poison', ms: 6000, chance: 0.35, dot: 0.22 }, adena: [2750, 3800],
    drops: [{ item: 'swamp_venom', chance: 0.6, max: 2 }, { item: 'emerald_plate', chance: 0.006 }, { item: 'emerald_jerkin', chance: 0.006 }, { item: 'scroll_enchant_weapon', chance: 0.02 }] },
  // Ancient Jungle 65-70
  { id: 'jungle_raptor', name: 'Raptor de la Selva', level: 66, shape: 'beast', color: 0x4a6a2a, scale: 1.3, aggressive: true, speed: 6.5, atkInterval: 1200, range: 2.4, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [2840, 3920],
    drops: [{ item: 'ancient_bark', chance: 0.3 }, { item: 'emerald_helm', chance: 0.007 }, { item: 'emerald_hood', chance: 0.007 }, { item: 'emerald_circlet', chance: 0.007 }, { item: 'emerald_shield', chance: 0.007 }, { item: 'emerald_cape', chance: 0.007 }, { item: 'supreme_healing_potion', chance: 0.1 }] },
  { id: 'giant_spider', name: 'Araña Gigante', level: 67, shape: 'spider', color: 0x2a3a1a, scale: 1.6, aggressive: true, speed: 6.5, atkInterval: 1100, range: 2.4, hpMult: 1.3, onHit: { id: 'poison', ms: 6000, chance: 0.35, dot: 0.22 }, adena: [2930, 4040],
    drops: [{ item: 'ancient_bark', chance: 0.35 }, { item: 'emerald_ring', chance: 0.006 }, { item: 'scroll_enchant_armor', chance: 0.03 }] },
  { id: 'tribal_hunter', name: 'Cazador Tribal', level: 68, shape: 'orc', color: 0x8a5a30, scale: 1.05, aggressive: true, speed: 5, atkInterval: 2000, range: 14, atkMult: 0.9, adena: [3020, 4170],
    drops: [{ item: 'ancient_bark', chance: 0.35 }, { item: 'emerald_blade', chance: 0.005 }, { item: 'emerald_duals', chance: 0.0025 }, { item: 'emerald_bow', chance: 0.005 }, { item: 'emerald_dagger', chance: 0.005 }, { item: 'emerald_necklace', chance: 0.006 }] },
  { id: 'corrupted_ent', name: 'Ent Corrompido', level: 69, shape: 'golem', color: 0x5a6a3a, scale: 1.7, aggressive: false, speed: 3.5, atkInterval: 2000, range: 3, hpMult: 1.8, defMult: 1.3, special: { r: 5.5, windup: 1400, mult: 2.6, every: 9000, at: 'self', stun: 1400 }, adena: [3110, 4290],
    drops: [{ item: 'ancient_bark', chance: 0.6, max: 2 }, { item: 'emerald_robe', chance: 0.007 }, { item: 'scroll_enchant_weapon', chance: 0.02 }] },
  { id: 'jungle_beast', name: 'Bestia de la Selva', level: 70, shape: 'beast', color: 0x4a5a30, scale: 1.5, aggressive: true, speed: 6, atkInterval: 1300, range: 2.6, hpMult: 1.4, atkMult: 1.1, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.22 }, adena: [3200, 4420],
    drops: [{ item: 'ancient_bark', chance: 0.5, max: 2 }, { item: 'emerald_plate', chance: 0.008 }, { item: 'emerald_jerkin', chance: 0.008 }, { item: 'emerald_staff', chance: 0.005 }, { item: 'emerald_spellblade', chance: 0.005 }, { item: 'scroll_enchant_armor', chance: 0.03 }] },
  // the swamp region's camp leaders (elite), world boss and raid
  { id: 'bog_hag', name: 'Gran Bruja', level: 64, shape: 'orc', color: 0x4a2a4a, scale: 1.2, aggressive: true, speed: 4.5, atkInterval: 1600, range: 11, hpMult: 4.5, atkMult: 1.35, elite: true,
    onHit: { id: 'poison', ms: 6000, chance: 0.35, dot: 0.22 }, special: { r: 5.5, windup: 1300, mult: 2.4, every: 8000, at: 'target' }, adena: [4500, 6800], drops: [{ item: 'swamp_venom', chance: 1, min: 2, max: 3 }] },
  { id: 'tribal_chief', name: 'Jefe Tribal', level: 69, shape: 'orc', color: 0x8a3a1a, scale: 1.45, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 5, atkMult: 1.35, elite: true,
    special: { r: 5.5, windup: 1200, mult: 2.5, every: 8000, at: 'self', stun: 1500 }, adena: [5600, 8400], drops: [{ item: 'ancient_bark', chance: 1, min: 2, max: 4 }] },
  { id: 'elder_ent', name: 'Ent Ancestral Corrompido', level: 67, shape: 'golem', color: 0x6a5a6a, scale: 3.2, aggressive: true, speed: 3.5, atkInterval: 1800, range: 4.5, hpMult: 18, atkMult: 1.4, defMult: 1.3, respawn: 300000, boss: true,
    onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.22 }, special: { r: 7, windup: 1600, mult: 2.7, every: 7000, at: 'target' },
    phases: [
      { at: 70, adds: { mob: 'ent_sapling', count: 4 }, say: ['La selva entera es mi cuerpo.', 'The whole jungle is my body.'] },
      { at: 35, haste: 1.4, special: { r: 10, windup: 1700, mult: 2.8, every: 7000, at: 'self', stun: 1500 }, say: ['¡RAÍCES, ATRÁPENLOS!', 'ROOTS, SEIZE THEM!'] },
    ],
    adena: [30000, 48000],
    drops: [{ item: 'emerald_blade', chance: 0.2 }, { item: 'emerald_duals', chance: 0.1 }, { item: 'emerald_bow', chance: 0.2 }, { item: 'emerald_dagger', chance: 0.2 }, { item: 'emerald_staff', chance: 0.2 }, { item: 'emerald_spellblade', chance: 0.2 }, { item: 'emerald_plate', chance: 0.18 }, { item: 'emerald_jerkin', chance: 0.18 }, { item: 'emerald_robe', chance: 0.18 }, { item: 'emerald_necklace', chance: 0.25 },
      { item: 'scroll_enchant_weapon', chance: 1, min: 1, max: 2 }, { item: 'scroll_enchant_armor', chance: 1, min: 2, max: 5 }, { item: 'ancient_bark', chance: 1, min: 6, max: 12 }] },
  { id: 'ent_sapling', name: 'Retoño Corrompido', level: 64, shape: 'golem', color: 0x7a9a5a, scale: 0.9, aggressive: true, speed: 5, atkInterval: 1500, range: 2.2, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Swamp Temple raid (instanced, `/raid swamp`)
  { id: 'ssithra', name: 'Ssithra, la Madre Serpiente', level: 70, shape: 'beast', color: 0x3a8a6a, scale: 3.4, aggressive: true, speed: 4.5, atkInterval: 1700, range: 5, hpMult: 26, atkMult: 1.35, defMult: 1.25, respawn: 1e12, boss: true,
    onHit: { id: 'poison', ms: 6000, chance: 0.35, dot: 0.25 }, special: { r: 8, windup: 1800, mult: 2.6, every: 9000, at: 'target' },
    phases: [
      { at: 80, adds: { mob: 'serpent_brood', count: 5 }, say: ['Mis hijos tienen hambre.', 'My children are hungry.'] },
      { at: 55, haste: 1.25, special: { r: 10, windup: 1700, mult: 2.8, every: 8000, at: 'self', stun: 1500 }, say: ['¡El veneno es mi sangre!', 'Venom is my blood!'] },
      { at: 30, adds: { mob: 'serpent_brood', count: 7 }, say: ['¡Sssalgan del agua!', 'Rissse from the water!'] },
      { at: 12, haste: 1.6, special: { r: 12, windup: 1500, mult: 3, every: 6000, at: 'self', stun: 1500 }, say: ['¡EL TEMPLO ES SSSOLO MÍO!', 'THE TEMPLE IS MINE ALONE!'] },
    ],
    adena: [70000, 110000],
    drops: [{ item: 'emerald_blade', chance: 0.6 }, { item: 'emerald_duals', chance: 0.3 }, { item: 'emerald_bow', chance: 0.6 }, { item: 'emerald_dagger', chance: 0.6 }, { item: 'emerald_staff', chance: 0.6 }, { item: 'emerald_spellblade', chance: 0.6 }, { item: 'emerald_plate', chance: 0.5 }, { item: 'emerald_jerkin', chance: 0.5 }, { item: 'emerald_robe', chance: 0.5 }, { item: 'emerald_helm', chance: 0.5 }, { item: 'emerald_hood', chance: 0.5 }, { item: 'emerald_circlet', chance: 0.5 }, { item: 'emerald_shield', chance: 0.5 }, { item: 'emerald_cape', chance: 0.5 },
      { item: 'emerald_ring', chance: 0.5 }, { item: 'emerald_earring', chance: 0.5 }, { item: 'emerald_necklace', chance: 0.5 },
      { item: 'scroll_enchant_weapon', chance: 1, min: 2, max: 4 }, { item: 'scroll_enchant_armor', chance: 1, min: 4, max: 8 }, { item: 'swamp_venom', chance: 1, min: 10, max: 20 }] },
  { id: 'serpent_brood', name: 'Cría de Serpiente', level: 67, shape: 'beast', color: 0x8ac060, scale: 0.9, aggressive: true, speed: 6, atkInterval: 1300, range: 1.8, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Volcanic Lands 70-74 (the volcanic region, past the south pass)
  { id: 'lava_salamander', name: 'Salamandra de Lava', level: 71, shape: 'beast', color: 0xc84a1a, scale: 1.3, aggressive: true, speed: 6, atkInterval: 1300, range: 2.4, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.24 }, adena: [3290, 4540],
    drops: [{ item: 'magma_core', chance: 0.35 }, { item: 'infernal_boots', chance: 0.006 }, { item: 'infernal_treads', chance: 0.006 }, { item: 'infernal_shoes', chance: 0.006 }, { item: 'supreme_healing_potion', chance: 0.12 }] },
  { id: 'hellhound', name: 'Sabueso Infernal', level: 72, shape: 'beast', color: 0x2a1a1a, scale: 1.2, aggressive: true, speed: 6.5, atkInterval: 1200, range: 2.2, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.24 }, adena: [3380, 4660],
    drops: [{ item: 'magma_core', chance: 0.3 }, { item: 'infernal_gauntlets', chance: 0.006 }, { item: 'infernal_bracers', chance: 0.006 }, { item: 'infernal_gloves', chance: 0.006 }] },
  { id: 'lava_golem', name: 'Gólem de Lava', level: 73, shape: 'golem', color: 0x8a3a1a, scale: 1.7, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.8, hpMult: 1.8, defMult: 1.35, special: { r: 5.5, windup: 1400, mult: 2.7, every: 9500, at: 'self', stun: 1400 }, adena: [3470, 4790],
    drops: [{ item: 'magma_core', chance: 0.6, max: 2 }, { item: 'infernal_plate', chance: 0.005 }, { item: 'infernal_jerkin', chance: 0.005 }, { item: 'scroll_enchant_armor', chance: 0.035 }] },
  { id: 'pyromancer', name: 'Piromante', level: 73, shape: 'orc', color: 0x8a2a10, scale: 1.0, aggressive: true, speed: 4.5, atkInterval: 1800, range: 12, atkMult: 0.95, adena: [3470, 4790],
    drops: [{ item: 'magma_core', chance: 0.35 }, { item: 'infernal_staff', chance: 0.004 }, { item: 'infernal_spellblade', chance: 0.004 }, { item: 'infernal_earring', chance: 0.005 }, { item: 'supreme_mana_potion', chance: 0.12 }] },
  { id: 'magma_drake', name: 'Draco de Magma', level: 74, shape: 'beast', color: 0xd85a2a, scale: 1.6, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.8, hpMult: 1.3, special: { r: 6, windup: 1500, mult: 2.7, every: 8000, at: 'target' }, adena: [3560, 4910],
    drops: [{ item: 'magma_core', chance: 0.5, max: 2 }, { item: 'infernal_helm', chance: 0.006 }, { item: 'infernal_hood', chance: 0.006 }, { item: 'infernal_circlet', chance: 0.006 }, { item: 'infernal_shield', chance: 0.006 }, { item: 'infernal_cape', chance: 0.006 }, { item: 'scroll_enchant_weapon', chance: 0.025 }] },
  // the Abyss 74-78
  { id: 'abyss_knight', name: 'Caballero del Abismo', level: 75, shape: 'undead', color: 0x4a3a5a, scale: 1.3, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 1.4, defMult: 1.25, onHit: { id: 'slow', ms: 3000, chance: 0.25 }, adena: [3650, 5040],
    drops: [{ item: 'abyss_essence', chance: 0.35 }, { item: 'infernal_greaves', chance: 0.006 }, { item: 'infernal_leggings', chance: 0.006 }, { item: 'scroll_enchant_armor', chance: 0.035 }] },
  { id: 'lich', name: 'Liche', level: 76, shape: 'undead', color: 0x6a7a5a, scale: 1.1, aggressive: true, speed: 4.5, atkInterval: 1800, range: 12, onHit: { id: 'slow', ms: 3000, chance: 0.3 }, adena: [3740, 5160],
    drops: [{ item: 'abyss_essence', chance: 0.35 }, { item: 'infernal_robe', chance: 0.005 }, { item: 'infernal_ring', chance: 0.005 }, { item: 'supreme_mana_potion', chance: 0.12 }] },
  { id: 'abyss_weaver', name: 'Tejedora del Abismo', level: 77, shape: 'spider', color: 0x3a1a4a, scale: 1.6, aggressive: true, speed: 6.5, atkInterval: 1100, range: 2.4, hpMult: 1.3, onHit: { id: 'poison', ms: 6000, chance: 0.35, dot: 0.24 }, adena: [3830, 5290],
    drops: [{ item: 'abyss_essence', chance: 0.4 }, { item: 'infernal_necklace', chance: 0.005 }, { item: 'scroll_enchant_weapon', chance: 0.025 }] },
  { id: 'abyss_drake', name: 'Draco Abisal', level: 77, shape: 'beast', color: 0x5a3a7a, scale: 1.7, aggressive: true, speed: 5.5, atkInterval: 1400, range: 3, hpMult: 1.5, atkMult: 1.1, special: { r: 6.5, windup: 1500, mult: 2.8, every: 8000, at: 'target' }, adena: [3830, 5290],
    drops: [{ item: 'abyss_essence', chance: 0.5, max: 2 }, { item: 'infernal_blade', chance: 0.004 }, { item: 'infernal_duals', chance: 0.002 }, { item: 'infernal_bow', chance: 0.004 }, { item: 'infernal_dagger', chance: 0.004 }, { item: 'infernal_plate', chance: 0.005 }, { item: 'infernal_jerkin', chance: 0.005 }] },
  { id: 'abyss_demon', name: 'Demonio del Abismo', level: 78, shape: 'orc', color: 0x8a2a24, scale: 1.45, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.8, hpMult: 1.6, atkMult: 1.15, onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.25 }, adena: [3920, 5410],
    drops: [{ item: 'abyss_essence', chance: 0.6, max: 2 }, { item: 'infernal_staff', chance: 0.004 }, { item: 'infernal_spellblade', chance: 0.004 }, { item: 'infernal_helm', chance: 0.006 }, { item: 'infernal_hood', chance: 0.006 }, { item: 'infernal_circlet', chance: 0.006 }, { item: 'infernal_shield', chance: 0.006 }, { item: 'infernal_cape', chance: 0.006 }, { item: 'scroll_enchant_armor', chance: 0.04 }] },
  // the volcanic region's camp leaders (elite), world boss and raid
  { id: 'high_pyromancer', name: 'Sumo Piromante', level: 74, shape: 'orc', color: 0xa8301a, scale: 1.2, aggressive: true, speed: 4.5, atkInterval: 1600, range: 12, hpMult: 4.5, atkMult: 1.35, elite: true,
    special: { r: 6, windup: 1300, mult: 2.5, every: 8000, at: 'target' }, adena: [6500, 9800], drops: [{ item: 'magma_core', chance: 1, min: 2, max: 3 }, { item: 'awakening_shard', chance: 0.35 }] },
  { id: 'abyss_commander', name: 'Comandante Abisal', level: 78, shape: 'orc', color: 0x6a1a20, scale: 1.55, aggressive: true, speed: 5, atkInterval: 1500, range: 2.8, hpMult: 5.5, atkMult: 1.4, elite: true,
    onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.25 }, special: { r: 6, windup: 1200, mult: 2.6, every: 8000, at: 'self', stun: 1500 }, adena: [8000, 12000], drops: [{ item: 'abyss_essence', chance: 1, min: 2, max: 4 }, { item: 'awakening_shard', chance: 0.5 }] },
  { id: 'flame_lord', name: 'Señor de las Llamas', level: 75, shape: 'golem', color: 0xc84a1a, scale: 3.4, aggressive: true, speed: 4, atkInterval: 1700, range: 4.5, hpMult: 20, atkMult: 1.45, defMult: 1.3, respawn: 300000, boss: true,
    special: { r: 7, windup: 1500, mult: 2.8, every: 7000, at: 'target' },
    phases: [
      { at: 70, adds: { mob: 'fire_elemental', count: 4 }, say: ['¡Ardan, gusanos!', 'Burn, worms!'] },
      { at: 35, haste: 1.4, special: { r: 11, windup: 1700, mult: 3, every: 7000, at: 'self', stun: 1500 }, say: ['¡EL VOLCÁN DESPIERTA!', 'THE VOLCANO AWAKENS!'] },
    ],
    adena: [45000, 70000],
    drops: [{ item: 'infernal_blade', chance: 0.12 }, { item: 'infernal_duals', chance: 0.06 }, { item: 'infernal_bow', chance: 0.12 }, { item: 'infernal_dagger', chance: 0.12 }, { item: 'infernal_staff', chance: 0.12 }, { item: 'infernal_spellblade', chance: 0.12 }, { item: 'infernal_plate', chance: 0.1 }, { item: 'infernal_jerkin', chance: 0.1 }, { item: 'infernal_robe', chance: 0.1 }, { item: 'infernal_necklace', chance: 0.15 },
      { item: 'scroll_enchant_weapon', chance: 1, min: 1, max: 3 }, { item: 'scroll_enchant_armor', chance: 1, min: 3, max: 6 }, { item: 'magma_core', chance: 1, min: 8, max: 15 }, { item: 'abyss_essence', chance: 1, min: 3, max: 6 }, { item: 'awakening_shard', chance: 1, min: 2, max: 3 }] },
  { id: 'fire_elemental', name: 'Elemental de Fuego', level: 72, shape: 'golem', color: 0xff7a3a, scale: 1.0, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.2, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Heart of the Abyss raid (instanced, `/raid abyss`)
  { id: 'azgaroth', name: 'Azgaroth, el Devorador', level: 78, shape: 'beast', color: 0x4a2a5a, scale: 3.8, aggressive: true, speed: 4.5, atkInterval: 1800, range: 5.5, hpMult: 30, atkMult: 1.4, defMult: 1.3, respawn: 1e12, boss: true,
    onHit: { id: 'bleed', ms: 5000, chance: 0.3, dot: 0.25 }, special: { r: 9, windup: 1800, mult: 2.7, every: 9000, at: 'target' },
    phases: [
      { at: 80, adds: { mob: 'abyss_spawn', count: 5 }, say: ['Otro bocado que baja solo.', 'Another morsel that walks down on its own.'] },
      { at: 55, haste: 1.25, special: { r: 11, windup: 1700, mult: 2.9, every: 8000, at: 'self', stun: 1500 }, say: ['¡El Abismo no tiene fondo, y yo tampoco!', 'The Abyss has no bottom, and neither do I!'] },
      { at: 30, adds: { mob: 'abyss_spawn', count: 7 }, say: ['¡Devoren!', 'Devour!'] },
      { at: 12, haste: 1.6, special: { r: 13, windup: 1500, mult: 3.2, every: 6000, at: 'self', stun: 1500 }, say: ['¡TODO TERMINA EN MÍ!', 'EVERYTHING ENDS IN ME!'] },
    ],
    adena: [100000, 160000],
    drops: [{ item: 'infernal_blade', chance: 0.45 }, { item: 'infernal_duals', chance: 0.225 }, { item: 'infernal_bow', chance: 0.45 }, { item: 'infernal_dagger', chance: 0.45 }, { item: 'infernal_staff', chance: 0.45 }, { item: 'infernal_spellblade', chance: 0.45 }, { item: 'infernal_plate', chance: 0.4 }, { item: 'infernal_jerkin', chance: 0.4 }, { item: 'infernal_robe', chance: 0.4 }, { item: 'infernal_helm', chance: 0.4 }, { item: 'infernal_hood', chance: 0.4 }, { item: 'infernal_circlet', chance: 0.4 }, { item: 'infernal_shield', chance: 0.4 }, { item: 'infernal_cape', chance: 0.4 },
      { item: 'infernal_ring', chance: 0.4 }, { item: 'infernal_earring', chance: 0.4 }, { item: 'infernal_necklace', chance: 0.4 },
      { item: 'scroll_enchant_weapon', chance: 1, min: 3, max: 5 }, { item: 'scroll_enchant_armor', chance: 1, min: 5, max: 10 }, { item: 'abyss_essence', chance: 1, min: 20, max: 35 }, { item: 'awakening_shard', chance: 1, min: 3, max: 5 }] },
  { id: 'abyss_spawn', name: 'Engendro del Abismo', level: 76, shape: 'spider', color: 0x6a4a8a, scale: 1.0, aggressive: true, speed: 6, atkInterval: 1300, range: 1.8, hpMult: 1.2, respawn: 1e12, adena: [0, 0], drops: [] },
  // Encrucijada Sangrienta (full PvP): passive creatures that drop every set's materials and enchants
  { id: 'battlefield_carrion', name: 'Carroñero del Campo', level: 76, shape: 'beast', color: 0x6a4a3a, scale: 1.3, aggressive: false, speed: 5, atkInterval: 1500, range: 2.2, hpMult: 2.2, atkMult: 1.1,
    adena: [3500, 5500], drops: [{ item: 'drake_scale', chance: 0.5, min: 1, max: 3 }, { item: 'dragon_fang', chance: 0.4, min: 1, max: 2 }, { item: 'ember_shard', chance: 0.5, min: 1, max: 3 },
      { item: 'scroll_enchant_armor', chance: 0.06 }, { item: 'scroll_enchant_weapon', chance: 0.02 }] },
  { id: 'fallen_legionnaire', name: 'Legionario Caído', level: 77, shape: 'undead', color: 0x7a2a2a, scale: 1.15, aggressive: false, speed: 4.5, atkInterval: 1500, range: 2.4, hpMult: 2.4, atkMult: 1.15,
    adena: [3800, 6000], drops: [{ item: 'citadel_sigil', chance: 0.5, min: 1, max: 3 }, { item: 'swamp_venom', chance: 0.45, min: 1, max: 2 }, { item: 'ancient_bark', chance: 0.4, min: 1, max: 2 },
      { item: 'scroll_enchant_armor', chance: 0.07 }, { item: 'scroll_enchant_weapon', chance: 0.025 }] },
  { id: 'relic_golem', name: 'Gólem de Reliquias', level: 78, shape: 'golem', color: 0x8a6a5a, scale: 1.5, aggressive: false, speed: 3.5, atkInterval: 1800, range: 2.6, hpMult: 3, atkMult: 1.2, defMult: 1.2,
    adena: [4200, 6500], drops: [{ item: 'magma_core', chance: 0.4, min: 1, max: 2 }, { item: 'abyss_essence', chance: 0.35, min: 1, max: 2 },
      { item: 'scroll_enchant_armor', chance: 0.08 }, { item: 'scroll_enchant_weapon', chance: 0.03 }] },
  // its world raid, the strongest in the game: a giant orc in the Infernal plate (render/mobs.ts MOB_KNIGHT) that takes a
  // full party (server-rs formulas.rs war_avatar_needs_a_party): each blow takes over a third of a level 78 tank's life
  // and wounds (healing halved), its circles nearly kill a mage, its heralds hunt the healers, and ten minutes in its
  // enrage kills anyone still standing
  { id: 'war_avatar', name: 'Avatar de la Guerra', level: 80, shape: 'orc', color: 0x8a1a12, scale: 3.6, aggressive: true, speed: 4.5, atkInterval: 1700, range: 6, hpMult: 400, atkMult: 6.32, defMult: 1.5,
    respawn: 43_200_000, boss: true, onHit: { id: 'wound', ms: 6000, chance: 1 },
    special: { r: 9, windup: 1700, mult: 1.8, every: 9000, at: 'target' },
    barrage: { count: 6, r: 5, windup: 2000, mult: 1.3, every: 12000, range: 40 },
    pulse: { r: 25, windup: 4000, pct: 0.45, every: 30000 },
    enrage: { after: 600000, haste: 2, atk: 3 },
    phases: [
      { at: 75, adds: { mob: 'war_herald', count: 6 }, say: ['¡Que suenen los tambores! ¡A mí, heraldos!', 'Sound the drums! To me, heralds!'] },
      { at: 50, haste: 1.3, special: { r: 12, windup: 1700, mult: 1.9, every: 8000, at: 'self', stun: 1500 }, barrage: { count: 10, r: 5, windup: 1800, mult: 1.4, every: 10000, range: 45 },
        say: ['¡Cada uno de ustedes es una batalla más!', 'Each of you is one more battle!'] },
      { at: 25, adds: { mob: 'war_herald', count: 8 }, pulse: { r: 25, windup: 3500, pct: 0.45, every: 20000 }, say: ['¡LA GUERRA NUNCA TERMINA!', 'WAR NEVER ENDS!'] },
      { at: 10, haste: 1.6, say: ['¡Caigan conmigo!', 'Fall with me!'] },
    ],
    adena: [300000, 500000],
    drops: [{ item: 'scroll_enchant_sacred', chance: 1, min: 2, max: 2 }, { item: 'scroll_enchant_weapon', chance: 1, min: 4, max: 8 }, { item: 'scroll_enchant_armor', chance: 1, min: 8, max: 15 },
      ...setArmor('abyssal', 0.08), ...setArmor('ashforged', 0.08), ...setArmor('dragon', 0.06), ...setArmor('glacial', 0.06), ...setArmor('emerald', 0.05), ...setArmor('infernal', 0.04)] },
  // they go for whoever the boss lets them: a pack of them kills a healer nobody covers
  { id: 'war_herald', name: 'Heraldo de la Guerra', level: 78, shape: 'orc', color: 0x9a2a1a, scale: 1.1, aggressive: true, speed: 5.5, atkInterval: 1400, range: 2.4, hpMult: 2, atkMult: 1.41, respawn: 1e12, adena: [0, 0], drops: [] },
  // Grieta de las Brasas (full PvP, levels 40-48): passive creatures that drop the dragon set's materials and the C-grade
  // scrolls (items.ts: they only enchant C-grade gear)
  { id: 'cinder_drakeling', name: 'Dragoncillo de Ceniza', level: 40, shape: 'beast', color: 0x8a3a1a, scale: 1.2, aggressive: false, speed: 5.5, atkInterval: 1400, range: 2.2, hpMult: 2.2, atkMult: 1.1,
    adena: [1200, 1800], drops: [{ item: 'drake_scale', chance: 0.5, min: 1, max: 2 }, { item: 'scroll_enchant_armor_c', chance: 0.06 }, { item: 'scroll_enchant_weapon_c', chance: 0.02 }] },
  { id: 'flame_zealot', name: 'Fanático de la Llama', level: 42, shape: 'orc', color: 0xa03a1a, scale: 1.0, aggressive: false, speed: 4.5, atkInterval: 1800, range: 12, hpMult: 2.4, atkMult: 1.15,
    adena: [1300, 1950], drops: [{ item: 'dragon_fang', chance: 0.45, min: 1, max: 2 }, { item: 'greater_mana_potion', chance: 0.12 }, { item: 'scroll_enchant_armor_c', chance: 0.07 }, { item: 'scroll_enchant_weapon_c', chance: 0.025 }] },
  { id: 'scorched_golem', name: 'Gólem Calcinado', level: 44, shape: 'golem', color: 0x3a2a24, scale: 1.5, aggressive: false, speed: 3.5, atkInterval: 1800, range: 2.6, hpMult: 3, atkMult: 1.2, defMult: 1.2,
    adena: [1450, 2150], drops: [{ item: 'drake_scale', chance: 0.4, min: 1, max: 2 }, { item: 'dragon_fang', chance: 0.4, min: 1, max: 2 }, { item: 'scroll_enchant_armor_c', chance: 0.08 }, { item: 'scroll_enchant_weapon_c', chance: 0.03 }] },
  // its world raid: a fire dragon (render/mobs.ts) that takes a full party of level 40-48 (server-rs formulas.rs
  // ignaroth_needs_a_party): every blow sets its victim burning, its breath and its rain of fire nearly kill a mage, its
  // whelps hunt the healers, and ten minutes in its enrage kills anyone still standing. Drops the C grade: weapons,
  // armour and the scrolls that only enchant it
  { id: 'ignaroth', name: 'Ignaroth, Señor de las Brasas', level: 48, shape: 'beast', color: 0xc83a10, scale: 3.6, aggressive: true, speed: 4.5, atkInterval: 1100, range: 6, hpMult: 310, atkMult: 5.92, defMult: 1.5,
    respawn: 21_600_000, boss: true, onHit: { id: 'burn', ms: 6000, chance: 1, dot: 0.15 },
    special: { r: 9, windup: 1700, mult: 1.8, every: 9000, at: 'target' },
    barrage: { count: 6, r: 5, windup: 2000, mult: 1.4, every: 12000, range: 40 },
    pulse: { r: 22, windup: 4000, pct: 0.4, every: 30000 },
    enrage: { after: 600000, haste: 2, atk: 3.2 },
    phases: [
      { at: 75, adds: { mob: 'ember_whelp', count: 6 }, say: ['¡Crías mías, salgan de la brasa! ¡Hay carne!', 'My whelps, out of the embers! There is meat!'] },
      { at: 50, haste: 1.3, special: { r: 12, windup: 1700, mult: 1.9, every: 8000, at: 'self', stun: 1500 }, barrage: { count: 10, r: 5, windup: 1800, mult: 1.5, every: 10000, range: 45 },
        say: ['¡Que llueva fuego sobre ustedes!', 'Let fire rain upon you!'] },
      { at: 25, adds: { mob: 'ember_whelp', count: 8 }, pulse: { r: 22, windup: 3500, pct: 0.4, every: 20000 }, say: ['¡ESTA GRIETA ES MI HOGUERA!', 'THIS RIFT IS MY PYRE!'] },
      { at: 10, haste: 1.6, say: ['¡Ardan conmigo!', 'Burn with me!'] },
    ],
    adena: [80000, 120000],
    drops: [{ item: 'dragon_blade', chance: 0.3 }, { item: 'dragon_duals', chance: 0.15 }, { item: 'dragon_bow', chance: 0.3 }, { item: 'dragon_dagger', chance: 0.3 }, { item: 'dragon_staff', chance: 0.3 }, { item: 'dragon_spellblade', chance: 0.3 },
      ...setArmor('dragon', 0.15), { item: 'scroll_enchant_weapon_c', chance: 1, min: 3, max: 6 }, { item: 'scroll_enchant_armor_c', chance: 1, min: 6, max: 12 }] },
  // they go for whoever the boss lets them: a pack of them burns down a healer nobody covers
  { id: 'ember_whelp', name: 'Cría de Brasa', level: 44, shape: 'beast', color: 0xd85a1a, scale: 1.0, aggressive: true, speed: 6, atkInterval: 1300, range: 1.8, hpMult: 2, atkMult: 1.6, respawn: 1e12, adena: [0, 0], drops: [] },
];

export const MOBS: Record<string, MobDef> = Object.fromEntries(list.map((m) => [m.id, m]));
