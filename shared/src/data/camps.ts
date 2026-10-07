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
  { id: 'gremlin_den', name: 'Guarida de Gremlins', zone: 'meadows', x: 245, z: 75, level: 3, leader: 'gremlin_chief', banner: 0x7fae4a,
    mobs: [{ mob: 'gremlin', count: 6 }, { mob: 'elder_keltir', count: 2 }], respawn: 150000,
    chest: { adena: [150, 300], loot: [{ item: 'lesser_healing_potion', chance: 1, min: 3, max: 6 }, { item: 'leather_cap', chance: 0.3 },
      { item: 'short_gloves', chance: 0.3 }, { item: 'leather_sandals', chance: 0.25 }, { item: 'broadsword', chance: 0.08 }] } },
  { id: 'goblin_camp', name: 'Campamento Goblin', zone: 'hills', x: 65, z: -255, level: 8, leader: 'goblin_chieftain', banner: 0xb03020,
    mobs: [{ mob: 'goblin_scout', count: 5 }, { mob: 'goblin_brute', count: 3 }], respawn: 180000,
    chest: { adena: [600, 1200], loot: [{ item: 'healing_potion', chance: 1, min: 2, max: 4 }, { item: 'iron_hammer', chance: 0.18 },
      { item: 'willow_staff', chance: 0.18 }, { item: 'brigandine_helm', chance: 0.15 }, { item: 'reinforced_boots', chance: 0.15 }, { item: 'goblin_ear', chance: 1, min: 2, max: 4 }] } },
  { id: 'orc_outpost', name: 'Puesto de Guerra Orco', zone: 'barracks', x: -280, z: -90, level: 13, leader: 'orc_warlord', banner: 0x5a1a1a,
    mobs: [{ mob: 'orc_warrior', count: 4 }, { mob: 'orc_archer', count: 3 }, { mob: 'orc_shaman', count: 2 }], respawn: 210000,
    chest: { adena: [2500, 4500], loot: [{ item: 'healing_potion', chance: 1, min: 3, max: 6 }, { item: 'mana_potion', chance: 0.6, min: 2, max: 4 },
      { item: 'brigandine_tunic', chance: 0.15 }, { item: 'karmian_tunic', chance: 0.15 }, { item: 'sword_of_revolution', chance: 0.1 }, { item: 'staff_of_life', chance: 0.1 }] } },
  { id: 'crypt', name: 'Cripta Profanada', zone: 'wastes', x: 40, z: 300, level: 17, leader: 'crypt_knight', banner: 0x3a1a4a,
    mobs: [{ mob: 'skeleton', count: 5 }, { mob: 'zombie', count: 3 }], respawn: 240000,
    chest: { adena: [5000, 9000], loot: [{ item: 'healing_potion', chance: 1, min: 4, max: 8 }, { item: 'cursed_bone', chance: 1, min: 3, max: 6 },
      { item: 'full_plate_helmet', chance: 0.1 }, { item: 'full_plate_armor', chance: 0.06 }, { item: 'demons_tunic', chance: 0.06 }, { item: 'samurai_longsword', chance: 0.05 }] } },
];

export const CAMP_BY_ID: Record<string, CampDef> = Object.fromEntries(CAMPS.map((c) => [c.id, c]));
