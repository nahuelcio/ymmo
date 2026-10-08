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
    drops: [{ item: 'wolf_pelt', chance: 0.25 }, { item: 'leather_sandals', chance: 0.03 }, { item: 'lesser_healing_potion', chance: 0.08 }] },
  // Goblin Hills 5-10
  { id: 'goblin_scout', name: 'Explorador Goblin', level: 6, shape: 'goblin', color: 0x5f8f3a, scale: 0.75, aggressive: false, speed: 5, atkInterval: 1400, range: 1.8, adena: [25, 45],
    drops: [{ item: 'goblin_ear', chance: 0.3 }, { item: 'broadsword', chance: 0.015 }, { item: 'healing_potion', chance: 0.05 }] },
  { id: 'wolf', name: 'Lobo', level: 7, shape: 'beast', color: 0x6a6a70, scale: 1.0, aggressive: true, speed: 5.5, atkInterval: 1300, range: 2, adena: [30, 55],
    drops: [{ item: 'wolf_pelt', chance: 0.35, max: 2 }, { item: 'reinforced_boots', chance: 0.01 }] },
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
    drops: [{ item: 'wolf_pelt', chance: 0.5, max: 3 }, { item: 'sword_of_revolution', chance: 0.01 }, { item: 'brigandine_tunic', chance: 0.01 }] },
  { id: 'orc_captain', name: 'Capitán Orco', level: 15, shape: 'orc', color: 0x8a2a2a, scale: 1.35, aggressive: true, speed: 5, atkInterval: 1500, range: 2.6, hpMult: 2.5, atkMult: 1.2, respawn: 60000, special: { r: 4.5, windup: 1200, mult: 2.2, every: 8000, at: 'self', stun: 1500 }, adena: [250, 450],
    drops: [{ item: 'orc_tusk', chance: 1, min: 2, max: 4 }, { item: 'war_hammer', chance: 0.05 }, { item: 'brigandine_tunic', chance: 0.05 }] },
  // Cursed Wastes 15-20
  { id: 'skeleton', name: 'Soldado Esqueleto', level: 16, shape: 'undead', color: 0xd8d4c0, scale: 1.0, aggressive: true, speed: 5, atkInterval: 1400, range: 2.2, adena: [130, 210],
    drops: [{ item: 'cursed_bone', chance: 0.3 }, { item: 'full_plate_helmet', chance: 0.006 }] },
  { id: 'zombie', name: 'Zombi Podrido', level: 17, shape: 'undead', color: 0x6a8a5a, scale: 1.05, aggressive: false, speed: 3.5, atkInterval: 1800, range: 2.2, hpMult: 1.4, adena: [140, 230],
    drops: [{ item: 'cursed_bone', chance: 0.4, max: 2 }, { item: 'healing_potion', chance: 0.12 }] },
  { id: 'stone_golem', name: 'Gólem de Piedra', level: 18, shape: 'golem', color: 0x8a8580, scale: 1.4, aggressive: false, speed: 3.5, atkInterval: 2000, range: 2.6, hpMult: 1.6, defMult: 1.3, special: { r: 4.5, windup: 1400, mult: 2.4, every: 10000, at: 'self', stun: 1200 }, adena: [170, 260],
    drops: [{ item: 'stone_fragment', chance: 0.5, max: 2 }, { item: 'full_plate_armor', chance: 0.006 }] },
  { id: 'cave_spider', name: 'Araña de las Cavernas', level: 19, shape: 'spider', color: 0x3a2a4a, scale: 1.2, aggressive: true, speed: 6, atkInterval: 1200, range: 2.2, onHit: { id: 'poison', ms: 6000, chance: 0.3, dot: 0.18 }, adena: [180, 280],
    drops: [{ item: 'animal_skin', chance: 0.5, max: 3 }, { item: 'demons_tunic', chance: 0.006 }, { item: 'sages_staff', chance: 0.005 }] },
  { id: 'kaim_vanul', name: 'Kaim Vanul', level: 22, shape: 'undead', color: 0x6a2a8a, scale: 2.2, aggressive: true, speed: 4.5, atkInterval: 1600, range: 3.5, hpMult: 14, atkMult: 1.4, defMult: 1.2, respawn: 300000, boss: true, onHit: { id: 'slow', ms: 3000, chance: 0.25 }, special: { r: 6, windup: 1500, mult: 2.6, every: 7000, at: 'target' }, adena: [3000, 6000],
    drops: [{ item: 'samurai_longsword', chance: 0.25 }, { item: 'sages_staff', chance: 0.25 }, { item: 'full_plate_armor', chance: 0.2 }, { item: 'demons_tunic', chance: 0.2 }, { item: 'cursed_bone', chance: 1, min: 5, max: 10 }] },
  // Raid (instanced, see data/raids.ts): HP scales with the raid size when it spawns
  { id: 'kaim_ascended', name: 'Kaim Vanul, el Ascendido', level: 20, shape: 'undead', color: 0x8a2aaa, scale: 2.8, aggressive: true, speed: 4.5, atkInterval: 1800, range: 4, hpMult: 18, atkMult: 1.25, defMult: 1.1, respawn: 1e12, boss: true,
    onHit: { id: 'slow', ms: 3000, chance: 0.2 }, special: { r: 7, windup: 1800, mult: 2.4, every: 9000, at: 'target' },
    phases: [
      { at: 70, adds: { mob: 'bone_servant', count: 4 }, say: ['¡Levántense, huesos! ¡Sirvan a su amo!', 'Rise, bones! Serve your master!'] },
      { at: 40, haste: 1.3, special: { r: 9, windup: 1600, mult: 2.6, every: 7000, at: 'self', stun: 1500 }, say: ['¡El páramo entero va a temblar!', 'The whole wasteland will shake!'] },
      { at: 15, adds: { mob: 'bone_servant', count: 6 }, haste: 1.6, say: ['¡NO! ¡No me van a sellar otra vez!', 'NO! You will not seal me again!'] },
    ],
    adena: [8000, 14000],
    drops: [{ item: 'samurai_longsword', chance: 0.6 }, { item: 'sages_staff', chance: 0.6 }, { item: 'full_plate_armor', chance: 0.5 }, { item: 'demons_tunic', chance: 0.5 }, { item: 'cursed_bone', chance: 1, min: 10, max: 20 }] },
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
