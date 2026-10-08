import { TOWNS } from '../terrain';

export interface ZoneDef {
  id: string;
  name: string;
  x: number; z: number; r: number;
  levels: string;
  tint: [number, number, number];
  spawns: { mob: string; count: number }[];
}

export const ZONES: ZoneDef[] = [
  { id: 'meadows', name: 'Praderas Ventosas', x: 190, z: 30, r: 100, levels: '1-5', tint: [0.45, 0.68, 0.3],
    spawns: [{ mob: 'keltir', count: 14 }, { mob: 'gremlin', count: 12 }, { mob: 'elder_keltir', count: 10 }, { mob: 'young_wolf', count: 8 }] },
  { id: 'hills', name: 'Colinas Goblin', x: 20, z: -220, r: 100, levels: '5-10', tint: [0.5, 0.58, 0.28],
    spawns: [{ mob: 'goblin_scout', count: 14 }, { mob: 'wolf', count: 10 }, { mob: 'goblin_brute', count: 10 }, { mob: 'hill_lizard', count: 8 }] },
  { id: 'barracks', name: 'Cuartel Orco', x: -230, z: -40, r: 110, levels: '10-15', tint: [0.38, 0.45, 0.25],
    spawns: [{ mob: 'orc_warrior', count: 14 }, { mob: 'orc_archer', count: 10 }, { mob: 'orc_shaman', count: 8 }, { mob: 'werewolf', count: 8 }, { mob: 'orc_captain', count: 2 }] },
  { id: 'wastes', name: 'Páramos Malditos', x: -20, z: 260, r: 120, levels: '15-20', tint: [0.42, 0.36, 0.34],
    spawns: [{ mob: 'skeleton', count: 14 }, { mob: 'zombie', count: 10 }, { mob: 'stone_golem', count: 8 }, { mob: 'cave_spider', count: 8 }, { mob: 'kaim_vanul', count: 1 }] },
  // 20-50: the four corners of the map, then the two free stretches of its east and west edges (the world is not any bigger)
  { id: 'coast', name: 'Costa Abandonada', x: 320, z: 320, r: 85, levels: '20-25', tint: [0.62, 0.58, 0.42],
    spawns: [{ mob: 'drowned_sailor', count: 12 }, { mob: 'tide_crab', count: 10 }, { mob: 'sea_serpent', count: 8 }, { mob: 'drowned_corsair', count: 8 }, { mob: 'reef_golem', count: 5 }, { mob: 'coast_queen', count: 1 }] },
  { id: 'ruins', name: 'Ruinas Hundidas', x: 320, z: -320, r: 85, levels: '25-30', tint: [0.36, 0.44, 0.46],
    spawns: [{ mob: 'ruin_wraith', count: 12 }, { mob: 'deep_lurker', count: 10 }, { mob: 'ruin_sentinel', count: 8 }, { mob: 'abyssal_cultist', count: 8 }, { mob: 'aberration', count: 5 }] },
  { id: 'steppes', name: 'Estepas Ardientes', x: -320, z: -320, r: 85, levels: '30-35', tint: [0.55, 0.34, 0.22],
    spawns: [{ mob: 'ash_hound', count: 12 }, { mob: 'steppe_raider', count: 10 }, { mob: 'ember_spider', count: 8 }, { mob: 'steppe_shaman', count: 8 }, { mob: 'magma_golem', count: 5 }, { mob: 'gruhash', count: 1 }] },
  { id: 'citadel', name: 'Ciudadela Orca', x: -320, z: 320, r: 85, levels: '35-40', tint: [0.34, 0.32, 0.26],
    spawns: [{ mob: 'citadel_guard', count: 12 }, { mob: 'citadel_archer', count: 10 }, { mob: 'war_wolf', count: 8 }, { mob: 'citadel_warlock', count: 8 }, { mob: 'citadel_champion', count: 2 }] },
  { id: 'valley', name: 'Valle del Dragón', x: 340, z: -130, r: 80, levels: '40-45', tint: [0.3, 0.4, 0.3],
    spawns: [{ mob: 'drake_whelp', count: 12 }, { mob: 'valley_basilisk', count: 10 }, { mob: 'obsidian_golem', count: 7 }, { mob: 'wyvern', count: 7 }, { mob: 'elder_drake', count: 5 }, { mob: 'kaim_reborn', count: 1 }] },
  { id: 'nest', name: 'Nido del Dragón', x: -340, z: 130, r: 80, levels: '45-50', tint: [0.28, 0.22, 0.3],
    spawns: [{ mob: 'nest_guardian', count: 10 }, { mob: 'dragon_cultist', count: 10 }, { mob: 'brood_spider', count: 8 }, { mob: 'dragonkin', count: 8 }, { mob: 'ancient_drake', count: 5 }] },
];

export function zoneAt(x: number, z: number): string {
  for (const t of TOWNS) if (Math.hypot(x - t.x, z - t.z) < t.r + 10) return t.name;
  for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return zn.name;
  return 'Tierras Salvajes';
}

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  x: number; z: number; ry: number;
  kind: 'shop' | 'gatekeeper' | 'talker' | 'quest';
  shop?: string[];
  /** items this merchant makes to order (their recipe is ItemDef.craft) */
  craft?: string[];
  color: number;
  greeting: string;
  /** talkers: random lines said on click and, now and then, out loud */
  lines?: string[];
  look?: { bald?: boolean; beard?: number; skin?: number };
}

const LUIGI_LINES = [
  'En mi época el chat tenía un solo canal. Y era una paloma.',
  '¿No viste mi /who? Lo dejé acá nomás, al lado del grito.',
  'Antes de hablar poné el signo de admiración, nene, si no el chat no te escucha. ¿O era el numeral?',
  'Me dijeron "susurrá" y susurré. Nadie me contestó. Típico del chat.',
  '¡Se cayó el chat! ...no, pará, estaba mirando el minimapa.',
  'Cuando yo era aventurero chateábamos todo en MAYÚSCULAS y no nos quejábamos.',
  'Una vez lo invité a una party a un goblin. Me puso "jaja". Un divino.',
  'Enter para chatear, Escape para escapar. ¿Escapar de qué? Del chat, querido. Del chat no se escapa nadie.',
  'El /loc dice que estoy en la Aldea del Alba. Mentira. Estoy en el chat.',
  'En el 98 alguien gritó "busco healer" y yo todavía lo estoy esperando.',
  '¿Esta es la pestaña Sistema? Tiene olor a pestaña Sistema.',
  'El chat se sube solo cuando no lo mirás. Tengo pruebas. Bueno, tenía.',
  'Mi nieto escribe "ya vuelvo". Le dije que me trajera algo. Nunca volvió.',
  '¿Este chat tiene emojis? Puse 💥 y me salió una poción.',
  'Susurrame, te susurro, susurrame más fuerte... ¿por qué le dicen susurro si lo escribo?',
  'En las crónicas viejas el chat era un pergamino. Había que enrollarlo. ¡Con las manos!',
  '¡Shh! Estoy cargando. No, pará, ese no soy yo, es el chat.',
  'Doscientos caracteres por mensaje alcanzan y sobran. Nosotros teníamos tres: "ola".',
  '¿Conocés a Roxxy? Ella te teletransporta. Yo también, mirá, al chat: hola.',
  'Nunca escribas tu contraseña en el chat. Yo puse la mía. Era "chat". Ahora la sabe todo el mundo.',
];

export function randomLine(n: NpcDef): string {
  const l = n.lines ?? [n.greeting];
  return l[Math.floor(Math.random() * l.length)];
}

export const TELEPORTS = [
  { id: 'town', name: 'Aldea del Alba', x: 8, z: 8, cost: 0 },
  { id: 'dusk', name: 'Bastión del Ocaso', x: 170, z: -164, cost: 3000 },
  { id: 'meadows', name: 'Praderas Ventosas (Nv 1-5)', x: 120, z: 25, cost: 0 },
  { id: 'hills', name: 'Colinas Goblin (Nv 5-10)', x: 15, z: -150, cost: 300 },
  { id: 'barracks', name: 'Cuartel Orco (Nv 10-15)', x: -150, z: -30, cost: 1000 },
  { id: 'wastes', name: 'Páramos Malditos (Nv 15-20)', x: -15, z: 175, cost: 2500 },
  { id: 'coast', name: 'Costa Abandonada (Nv 20-25)', x: 263, z: 263, cost: 5000 },
  { id: 'ruins', name: 'Ruinas Hundidas (Nv 25-30)', x: 250, z: -257, cost: 8000 },
  { id: 'steppes', name: 'Estepas Ardientes (Nv 30-35)', x: -263, z: -263, cost: 12000 },
  { id: 'citadel', name: 'Ciudadela Orca (Nv 35-40)', x: -271, z: 298, cost: 16000 },
  { id: 'valley', name: 'Valle del Dragón (Nv 40-45)', x: 270, z: -103, cost: 22000 },
  { id: 'nest', name: 'Nido del Dragón (Nv 45-50)', x: -270, z: 103, cost: 30000 },
];

export const NPCS: NpcDef[] = [
  { id: 'grocer', name: 'Lia', title: 'Almacenera', x: 10, z: -14, ry: Math.PI, kind: 'shop', color: 0x4a8a3a,
    shop: ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'], greeting: '¡Pociones y pergaminos! Todo lo que un aventurero necesita.' },
  // Gerald and Hilda keep their counters at the mouth of the smithy (layout.ts, house 4)
  { id: 'weapons', name: 'Gerald', title: 'Armero', x: -26.3, z: -18.4, ry: Math.atan2(26.3, 18.4), kind: 'shop', color: 0x8a3a3a,
    shop: ['short_sword', 'apprentice_wand', 'dagger', 'broadsword', 'willow_staff', 'hand_axe', 'spear', 'iron_hammer', 'sword_of_revolution', 'staff_of_life', 'assassin_dagger', 'partisan', 'battle_axe'], greeting: 'Con una buena hoja, cualquiera se anima.' },
  { id: 'armor', name: 'Hilda', title: 'Armadurera', x: -28.6, z: -14.6, ry: Math.atan2(28.6, 14.6), kind: 'shop', color: 0x3a5a8a,
    shop: ['leather_cap', 'apprentice_tunic', 'apprentice_stockings', 'short_gloves', 'leather_sandals', 'brigandine_helm', 'karmian_hat', 'brigandine_tunic', 'brigandine_gaiters', 'reinforced_gloves', 'reinforced_boots', 'karmian_tunic', 'karmian_stockings', 'ring_of_vigor', 'earring_of_focus', 'necklace_of_valor'],
    greeting: 'Antes de salir a pelear, cubrite bien. Después no me vengas llorando.' },
  { id: 'gatekeeper', name: 'Roxxy', title: 'Guardiana del Portal', x: 12, z: 12, ry: -Math.PI / 2, kind: 'gatekeeper', color: 0x8a3a8a,
    greeting: '¿A dónde te llevo? Por una módica suma, obvio.' },
  { id: 'luigi', name: 'Luigi', title: 'Anciano del Pueblo (supuestamente)', x: -3, z: -8.5, ry: 0, kind: 'talker', color: 0x7a7468,
    greeting: '¿Eh? ¿Quién anda ahí? ¿Esto es el chat?', lines: LUIGI_LINES, look: { bald: true, beard: 0xe8e8e8, skin: 0xe0b090 } },
  { id: 'mira', name: 'Mira', title: 'Guardia de la Aldea', x: 0, z: -24, ry: Math.atan2(0, 24), kind: 'quest', color: 0xc4a574,
    greeting: 'El camino del sur está lleno de keltirs.' },
  { id: 'bram', name: 'Bram', title: 'Cazador', x: 22, z: -16, ry: Math.atan2(-22, 16), kind: 'quest', color: 0x6a5030,
    greeting: 'Los lobos se vienen hasta la empalizada.' },
  { id: 'sella', name: 'Sella', title: 'Exploradora', x: -22, z: -16, ry: Math.atan2(22, 16), kind: 'quest', color: 0x3a6a4a,
    greeting: 'Los goblins de las colinas están cada vez más agrandados.' },
  { id: 'dorian', name: 'Dorian', title: 'Rastreador', x: 26, z: 8, ry: Math.atan2(-26, -8), kind: 'quest', color: 0x4a5a3a,
    greeting: 'Algo con escamas se está comiendo las cabras.' },
  // the Intendenta stands by the town hall steps (house 1)
  { id: 'vessa', name: 'Vessa', title: 'Intendenta', x: 19.3, z: 23.9, ry: Math.atan2(-19.3, -23.9), kind: 'quest', color: 0x8a6a3a,
    greeting: 'El cuartel no se va a vaciar solo.' },
  { id: 'harun', name: 'Harun', title: 'Sepulturero', x: 14, z: 26, ry: Math.atan2(-14, -26), kind: 'quest', color: 0x4a4a55,
    greeting: 'Los páramos le devuelven los huesos a los vivos.' },
  { id: 'nira', name: 'Nira', title: 'Picapedrera', x: -14, z: 26, ry: Math.atan2(14, -26), kind: 'quest', color: 0x7a7a70,
    greeting: 'Los gólems van dejando piedra por todo el páramo.' },
  { id: 'kael', name: 'Kael', title: 'Guardabosques', x: 108, z: 40, ry: Math.atan2(12, -15), kind: 'quest', color: 0x2f6a38,
    greeting: 'Los keltirs ancianos mandan en cada manada de esta pradera.' },
  { id: 'grit', name: 'Grit', title: 'Baqueano', x: 30, z: -138, ry: Math.atan2(-15, -12), kind: 'quest', color: 0x5a7a32,
    greeting: 'Los brutos cuidan el corazón de estas colinas.' },
  { id: 'rusk', name: 'Rusk', title: 'Capitán', x: -136, z: -44, ry: Math.atan2(-14, 14), kind: 'quest', color: 0x8a3a2a,
    greeting: 'Su capitán sigue dando órdenes desde el cuartel.' },
  { id: 'mael', name: 'Mael', title: 'Hermana', x: -30, z: 160, ry: Math.atan2(15, 15), kind: 'quest', color: 0x5a3a6a,
    greeting: 'No podemos dejar que Kaim Vanul se levante.' },
  // Bastión del Ocaso (terrain.ts DUSK): B grade over the counter, A and S made to order from what the 30-50 zones drop
  { id: 'dusk_weapons', name: 'Varek', title: 'Maestro Armero', x: 178, z: -162, ry: Math.atan2(-8, -8), kind: 'shop', color: 0x7a2a2a,
    shop: ['abyssal_blade', 'abyssal_staff'], craft: ['ashforged_blade', 'ashforged_staff', 'dragon_blade', 'dragon_staff'],
    greeting: 'El acero bueno no se compra hecho. Traeme con qué forjarlo.' },
  { id: 'dusk_armor', name: 'Isolda', title: 'Maestra Armadurera', x: 162, z: -178, ry: Math.atan2(8, 8), kind: 'shop', color: 0x2a4a7a,
    shop: ['abyssal_helm', 'abyssal_plate', 'abyssal_robe', 'abyssal_greaves', 'abyssal_gauntlets', 'abyssal_boots', 'abyssal_ring', 'abyssal_earring', 'abyssal_necklace'],
    craft: ['ashforged', 'dragon'].flatMap((p) => ['helm', 'plate', 'robe', 'greaves', 'gauntlets', 'boots', 'ring', 'earring', 'necklace'].map((k) => `${p}_${k}`)),
    greeting: 'Lo de la aldea es para cazar lobos. Acá vestimos a los que van al Nido.' },
  { id: 'dusk_grocer', name: 'Mirta', title: 'Alquimista', x: 181, z: -172, ry: Math.atan2(-11, 2), kind: 'shop', color: 0x3a7a5a,
    shop: ['healing_potion', 'greater_healing_potion', 'mana_potion', 'greater_mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'],
    greeting: 'Pociones de las fuertes. Las otras te las venden en la aldea.' },
  { id: 'dusk_gate', name: 'Tavish', title: 'Guardián del Portal', x: 159, z: -168, ry: Math.atan2(11, -2), kind: 'gatekeeper', color: 0x6a3a8a,
    greeting: 'Desde acá las zonas bravas quedan a un paso. Y a unas monedas.' },
  // one quest giver where the Gatekeeper drops you in each 20-50 zone
  { id: 'tobias', name: 'Tobías', title: 'Farero', x: 258, z: 268, ry: Math.atan2(-1, -1), kind: 'quest', color: 0x5a7a8a,
    greeting: 'La marea devuelve a los que se llevó.' },
  { id: 'ysolde', name: 'Ysolde', title: 'Arqueóloga', x: 245, z: -262, ry: Math.atan2(-1, 1), kind: 'quest', color: 0x6a8a7a,
    greeting: 'Estas ruinas eran una ciudad antes de que subiera el agua.' },
  { id: 'korgan', name: 'Korgan', title: 'Explorador de las Estepas', x: -258, z: -268, ry: Math.atan2(1, 1), kind: 'quest', color: 0x9a6a3a,
    greeting: 'Acá hasta el viento quema.' },
  { id: 'brenna', name: 'Brenna', title: 'Capitana del Asedio', x: -276, z: 303, ry: Math.atan2(1, -1), kind: 'quest', color: 0x7a3a3a,
    greeting: 'La ciudadela no cae mientras sus campeones sigan en pie.' },
  { id: 'aldric', name: 'Aldric', title: 'Cazador de Dragones', x: 265, z: -98, ry: Math.atan2(-1, 0.4), kind: 'quest', color: 0x4a6a3a,
    greeting: 'Todo lo que camina en este valle tiene escamas.' },
  { id: 'sibila', name: 'Sibila', title: 'Vidente', x: -265, z: 98, ry: Math.atan2(1, -0.4), kind: 'quest', color: 0x6a3a7a,
    greeting: 'El nido está despierto. Lo siento en los huesos.' },
];
