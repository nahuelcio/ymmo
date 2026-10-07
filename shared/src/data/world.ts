import { TOWN } from '../terrain';

export interface ZoneDef {
  id: string;
  name: string;
  x: number; z: number; r: number;
  levels: string;
  tint: [number, number, number];
  spawns: { mob: string; count: number }[];
}

export const ZONES: ZoneDef[] = [
  { id: 'meadows', name: 'Windy Meadows', x: 190, z: 30, r: 100, levels: '1-5', tint: [0.45, 0.68, 0.3],
    spawns: [{ mob: 'keltir', count: 14 }, { mob: 'gremlin', count: 12 }, { mob: 'elder_keltir', count: 10 }, { mob: 'young_wolf', count: 8 }] },
  { id: 'hills', name: 'Goblin Hills', x: 20, z: -220, r: 100, levels: '5-10', tint: [0.5, 0.58, 0.28],
    spawns: [{ mob: 'goblin_scout', count: 14 }, { mob: 'wolf', count: 10 }, { mob: 'goblin_brute', count: 10 }, { mob: 'hill_lizard', count: 8 }] },
  { id: 'barracks', name: 'Orc Barracks', x: -230, z: -40, r: 110, levels: '10-15', tint: [0.38, 0.45, 0.25],
    spawns: [{ mob: 'orc_warrior', count: 14 }, { mob: 'orc_archer', count: 10 }, { mob: 'orc_shaman', count: 8 }, { mob: 'werewolf', count: 8 }, { mob: 'orc_captain', count: 2 }] },
  { id: 'wastes', name: 'Cursed Wastes', x: -20, z: 260, r: 120, levels: '15-20', tint: [0.42, 0.36, 0.34],
    spawns: [{ mob: 'skeleton', count: 14 }, { mob: 'zombie', count: 10 }, { mob: 'stone_golem', count: 8 }, { mob: 'cave_spider', count: 8 }, { mob: 'kaim_vanul', count: 1 }] },
];

export function zoneAt(x: number, z: number): string {
  if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 10) return TOWN.name;
  for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn.name;
  return 'Wilderness';
}

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  x: number; z: number; ry: number;
  kind: 'shop' | 'gatekeeper';
  shop?: string[];
  color: number;
  greeting: string;
}

export const TELEPORTS = [
  { id: 'meadows', name: 'Windy Meadows (Lv 1-5)', x: 120, z: 25, cost: 0 },
  { id: 'hills', name: 'Goblin Hills (Lv 5-10)', x: 15, z: -150, cost: 300 },
  { id: 'barracks', name: 'Orc Barracks (Lv 10-15)', x: -150, z: -30, cost: 1000 },
  { id: 'wastes', name: 'Cursed Wastes (Lv 15-20)', x: -15, z: 175, cost: 2500 },
];

export const NPCS: NpcDef[] = [
  { id: 'grocer', name: 'Lia', title: 'Grocer', x: 10, z: -14, ry: Math.PI, kind: 'shop', color: 0x4a8a3a,
    shop: ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape'], greeting: 'Potions and scrolls! Everything an adventurer needs.' },
  { id: 'weapons', name: 'Gerald', title: 'Weapon Merchant', x: -14, z: -10, ry: Math.PI / 2, kind: 'shop', color: 0x8a3a3a,
    shop: ['short_sword', 'apprentice_wand', 'broadsword', 'willow_staff', 'iron_hammer', 'sword_of_revolution', 'staff_of_life'], greeting: 'A fine blade makes a fine warrior.' },
  { id: 'armor', name: 'Hilda', title: 'Armor Merchant', x: -12, z: 12, ry: Math.PI / 2, kind: 'shop', color: 0x3a5a8a,
    shop: ['leather_cap', 'apprentice_tunic', 'apprentice_stockings', 'short_gloves', 'leather_sandals', 'brigandine_helm', 'brigandine_tunic', 'brigandine_gaiters', 'reinforced_gloves', 'reinforced_boots', 'karmian_tunic', 'karmian_stockings'],
    greeting: 'Protect yourself before you wreck yourself.' },
  { id: 'gatekeeper', name: 'Roxxy', title: 'Gatekeeper', x: 12, z: 12, ry: -Math.PI / 2, kind: 'gatekeeper', color: 0x8a3a8a,
    greeting: 'Where would you like to go? For a small fee, of course.' },
];
