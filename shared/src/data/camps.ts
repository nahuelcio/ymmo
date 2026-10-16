// Hostile camps: a cluster of mobs around tents and a campfire, led by an elite.
// Clearing every mob spawns a loot chest for each player who fought there; the
// camp repopulates all at once a few minutes later.

export interface CampLoot { item: string; chance: number; min?: number; max?: number }

export interface CampDef {
  id: string;
  name: string;
  zone: string;
  x: number; z: number;
  level: number;
  leader: string;
  mobs: { mob: string; count: number }[];
  banner: number;
  respawn: number; // ms after clearing
  chest: { adena: [number, number]; loot: CampLoot[] };
}

export const CAMPS: CampDef[] = [
  { id: 'gremlin_den', name: 'Guarida de Gremlins', zone: 'meadows', x: 420, z: 1320, level: 3, leader: 'gremlin_chief', banner: 0x7fae4a,
    mobs: [{ mob: 'gremlin', count: 6 }, { mob: 'elder_keltir', count: 2 }], respawn: 150000,
    chest: { adena: [150, 300], loot: [{ item: 'lesser_healing_potion', chance: 1, min: 3, max: 6 }, { item: 'leather_cap', chance: 0.3 },
      { item: 'short_gloves', chance: 0.3 }, { item: 'leather_sandals', chance: 0.25 }, { item: 'broadsword', chance: 0.08 }] } },
  { id: 'goblin_camp', name: 'Campamento Goblin', zone: 'hills', x: -303, z: 1281, level: 8, leader: 'goblin_chieftain', banner: 0xb03020,
    mobs: [{ mob: 'goblin_scout', count: 5 }, { mob: 'goblin_brute', count: 3 }], respawn: 180000,
    chest: { adena: [600, 1200], loot: [{ item: 'healing_potion', chance: 1, min: 2, max: 4 }, { item: 'iron_hammer', chance: 0.18 },
      { item: 'willow_staff', chance: 0.18 }, { item: 'brigandine_helm', chance: 0.15 }, { item: 'reinforced_boots', chance: 0.15 }, { item: 'goblin_ear', chance: 1, min: 2, max: 4 }] } },
  { id: 'orc_outpost', name: 'Puesto de Guerra Orco', zone: 'barracks', x: -179, z: 1111, level: 13, leader: 'orc_warlord', banner: 0x5a1a1a,
    mobs: [{ mob: 'orc_warrior', count: 4 }, { mob: 'orc_archer', count: 3 }, { mob: 'orc_shaman', count: 2 }], respawn: 210000,
    chest: { adena: [2500, 4500], loot: [{ item: 'healing_potion', chance: 1, min: 3, max: 6 }, { item: 'mana_potion', chance: 0.6, min: 2, max: 4 },
      { item: 'brigandine_tunic', chance: 0.15 }, { item: 'karmian_tunic', chance: 0.15 }, { item: 'sword_of_revolution', chance: 0.1 }, { item: 'staff_of_life', chance: 0.1 }] } },
  { id: 'crypt', name: 'Cripta Profanada', zone: 'wastes', x: -235, z: 783, level: 17, leader: 'crypt_knight', banner: 0x3a1a4a,
    mobs: [{ mob: 'skeleton', count: 5 }, { mob: 'zombie', count: 3 }], respawn: 240000,
    chest: { adena: [5000, 9000], loot: [{ item: 'healing_potion', chance: 1, min: 4, max: 8 }, { item: 'cursed_bone', chance: 1, min: 3, max: 6 },
      { item: 'full_plate_helmet', chance: 0.1 }, { item: 'demons_circlet', chance: 0.1 }, { item: 'full_plate_armor', chance: 0.06 }, { item: 'demons_tunic', chance: 0.06 }, { item: 'samurai_longsword', chance: 0.05 }] } },
  // the frost region (50-60)
  { id: 'tundra_camp', name: 'Campamento de los Saqueadores', zone: 'tundra', x: -270, z: -900, level: 54, leader: 'tundra_jarl', banner: 0x4a6a8a,
    mobs: [{ mob: 'tundra_raider', count: 5 }, { mob: 'frost_wolf', count: 3 }], respawn: 270000,
    chest: { adena: [30000, 50000], loot: [{ item: 'supreme_healing_potion', chance: 1, min: 3, max: 6 }, { item: 'frost_pelt', chance: 1, min: 3, max: 6 },
      { item: 'glacial_helm', chance: 0.12 }, { item: 'glacial_boots', chance: 0.12 }, { item: 'glacial_gauntlets', chance: 0.12 }, { item: 'glacial_blade', chance: 0.05 }, { item: 'scroll_enchant_armor', chance: 0.3 }] } },
  { id: 'yeti_den', name: 'Cubil de la Matriarca', zone: 'peaks', x: -840, z: -880, level: 59, leader: 'yeti_matriarch', banner: 0xd0e0f0,
    mobs: [{ mob: 'yeti', count: 4 }, { mob: 'frost_giant', count: 2 }], respawn: 300000,
    chest: { adena: [45000, 70000], loot: [{ item: 'supreme_healing_potion', chance: 1, min: 4, max: 8 }, { item: 'ice_crystal', chance: 1, min: 3, max: 6 },
      { item: 'glacial_plate', chance: 0.08 }, { item: 'glacial_robe', chance: 0.08 }, { item: 'glacial_ring', chance: 0.1 }, { item: 'glacial_staff', chance: 0.05 }, { item: 'scroll_enchant_weapon', chance: 0.25 }] } },
  // the swamp region (60-70)
  { id: 'witch_coven', name: 'Aquelarre del Pantano', zone: 'swamp', x: 905, z: -906, level: 64, leader: 'bog_hag', banner: 0x4a2a4a,
    mobs: [{ mob: 'bog_witch', count: 3 }, { mob: 'bog_drowned', count: 4 }], respawn: 300000,
    chest: { adena: [60000, 95000], loot: [{ item: 'supreme_healing_potion', chance: 1, min: 4, max: 8 }, { item: 'swamp_venom', chance: 1, min: 4, max: 8 },
      { item: 'emerald_helm', chance: 0.06 }, { item: 'emerald_boots', chance: 0.06 }, { item: 'emerald_gauntlets', chance: 0.06 }, { item: 'emerald_earring', chance: 0.05 }, { item: 'scroll_enchant_armor', chance: 0.35 }] } },
  { id: 'tribal_village', name: 'Aldea Tribal', zone: 'jungle', x: 595, z: -1136, level: 69, leader: 'tribal_chief', banner: 0x8a3a1a,
    mobs: [{ mob: 'tribal_hunter', count: 4 }, { mob: 'jungle_raptor', count: 3 }], respawn: 330000,
    chest: { adena: [80000, 125000], loot: [{ item: 'supreme_healing_potion', chance: 1, min: 5, max: 9 }, { item: 'ancient_bark', chance: 1, min: 4, max: 8 },
      { item: 'emerald_greaves', chance: 0.05 }, { item: 'emerald_ring', chance: 0.05 }, { item: 'emerald_necklace', chance: 0.04 }, { item: 'emerald_blade', chance: 0.02 }, { item: 'scroll_enchant_weapon', chance: 0.3 }] } },
  // the volcanic region (70-78)
  { id: 'cult_forge', name: 'Forja de los Cultistas', zone: 'volcanic', x: -365, z: -1525, level: 74, leader: 'high_pyromancer', banner: 0xc8401a,
    mobs: [{ mob: 'pyromancer', count: 3 }, { mob: 'hellhound', count: 4 }], respawn: 330000,
    chest: { adena: [100000, 160000], loot: [{ item: 'supreme_healing_potion', chance: 1, min: 5, max: 9 }, { item: 'magma_core', chance: 1, min: 4, max: 8 },
      { item: 'infernal_helm', chance: 0.04 }, { item: 'infernal_boots', chance: 0.04 }, { item: 'infernal_gauntlets', chance: 0.04 }, { item: 'infernal_earring', chance: 0.03 }, { item: 'scroll_enchant_armor', chance: 0.4 }] } },
  { id: 'abyss_bastion', name: 'Bastión Abisal', zone: 'abyss', x: 440, z: -1400, level: 78, leader: 'abyss_commander', banner: 0x4a1a5a,
    mobs: [{ mob: 'abyss_knight', count: 4 }, { mob: 'abyss_demon', count: 2 }], respawn: 360000,
    chest: { adena: [130000, 200000], loot: [{ item: 'supreme_healing_potion', chance: 1, min: 6, max: 10 }, { item: 'abyss_essence', chance: 1, min: 4, max: 8 },
      { item: 'infernal_greaves', chance: 0.04 }, { item: 'infernal_ring', chance: 0.04 }, { item: 'infernal_necklace', chance: 0.03 }, { item: 'infernal_blade', chance: 0.015 }, { item: 'scroll_enchant_weapon', chance: 0.35 }] } },
];

export const CAMP_BY_ID: Record<string, CampDef> = Object.fromEntries(CAMPS.map((c) => [c.id, c]));
