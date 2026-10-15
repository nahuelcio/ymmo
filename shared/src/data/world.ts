import { FROST, TOWNS } from '../terrain';
import { ALBA_FOLK, fortFolk } from '../village';

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
  // 50-78: the ring past the inner range. The frost region (north pass), west of the Fuerte de Escarcha
  { id: 'tundra', name: 'Tundra Helada', x: -235, z: -650, r: 85, levels: '50-55', tint: [0.86, 0.9, 0.95],
    spawns: [{ mob: 'frost_wolf', count: 14 }, { mob: 'tundra_raider', count: 10 }, { mob: 'frost_wraith', count: 8 }, { mob: 'ice_shaman', count: 8 }, { mob: 'ice_golem', count: 5 }] },
  { id: 'peaks', name: 'Picos Helados', x: -470, z: -650, r: 85, levels: '55-60', tint: [0.8, 0.86, 0.93],
    spawns: [{ mob: 'yeti', count: 12 }, { mob: 'white_drake', count: 10 }, { mob: 'frost_giant', count: 8 }, { mob: 'frost_wyvern', count: 7 }, { mob: 'frost_knight', count: 6 }, { mob: 'primal_yeti', count: 1 }] },
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
  /** clan: the clan master (found, raise, dissolve; shared/src/data/clans.ts) */
  kind: 'shop' | 'gatekeeper' | 'talker' | 'quest' | 'clan';
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
  { id: 'frost', name: 'Fuerte de Escarcha', x: FROST.x, z: FROST.z + 6, cost: 40000 },
  { id: 'tundra', name: 'Tundra Helada (Nv 50-55)', x: -180, z: -640, cost: 45000 },
  { id: 'peaks', name: 'Picos Helados (Nv 55-60)', x: -400, z: -660, cost: 50000 },
];

const folk = (id: string) => ALBA_FOLK.find((n) => n.id === id)!;
const fort = (id: string) => { const n = fortFolk(id); return { x: n.x, z: n.z, ry: n.ry }; };

export const NPCS: NpcDef[] = [
  { id: 'grocer', name: 'Lia', title: 'Almacenera', x: folk('grocer').x, z: folk('grocer').z, ry: folk('grocer').ry, kind: 'shop', color: 0x4a8a3a,
    shop: ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'], craft: ['healing_potion'], greeting: '¡Pociones y pergaminos! Todo lo que un aventurero necesita.' },
  { id: 'weapons', name: 'Gerald', title: 'Armero', x: folk('weapons').x, z: folk('weapons').z, ry: folk('weapons').ry, kind: 'shop', color: 0x8a3a3a,
    shop: ['woodcutter_axe', 'miner_pickaxe', 'short_sword', 'apprentice_wand', 'dagger', 'broadsword', 'willow_staff', 'hand_axe', 'spear', 'iron_hammer', 'sword_of_revolution', 'staff_of_life', 'assassin_dagger', 'partisan', 'battle_axe'],
    craft: ['willow_staff', 'hand_axe', 'iron_hammer', 'battle_axe', 'war_hammer'], greeting: 'Con una buena hoja, cualquiera se anima.' },
  { id: 'armor', name: 'Hilda', title: 'Armadurera', x: folk('armor').x, z: folk('armor').z, ry: folk('armor').ry, kind: 'shop', color: 0x3a5a8a,
    shop: ['leather_cap', 'apprentice_tunic', 'apprentice_stockings', 'short_gloves', 'leather_sandals', 'brigandine_helm', 'karmian_hat', 'brigandine_tunic', 'brigandine_gaiters', 'reinforced_gloves', 'reinforced_boots', 'karmian_tunic', 'karmian_stockings', 'ring_of_vigor', 'earring_of_focus', 'necklace_of_valor'],
    greeting: 'Antes de salir a pelear, cubrite bien. Después no me vengas llorando.' },
  { id: 'gatekeeper', name: 'Roxxy', title: 'Guardiana del Portal', x: folk('gatekeeper').x, z: folk('gatekeeper').z, ry: folk('gatekeeper').ry, kind: 'gatekeeper', color: 0x8a3a8a,
    greeting: '¿A dónde te llevo? Por una módica suma, obvio.' },
  { id: 'clan_master', name: 'Aurelio', title: 'Maestro de Clanes', x: folk('clan_master').x, z: folk('clan_master').z, ry: folk('clan_master').ry, kind: 'clan', color: 0x3a4a8a,
    greeting: 'Un estandarte, un nombre y gente que no te deje solo. Eso es un clan.' },
  { id: 'luigi', name: 'Luigi', title: 'Anciano del Pueblo (supuestamente)', x: folk('luigi').x, z: folk('luigi').z, ry: folk('luigi').ry, kind: 'talker', color: 0x7a7468,
    greeting: '¿Eh? ¿Quién anda ahí? ¿Esto es el chat?', lines: LUIGI_LINES, look: { bald: true, beard: 0xe8e8e8, skin: 0xe0b090 } },
  { id: 'mira', name: 'Mira', title: 'Guardia de la Aldea', x: folk('mira').x, z: folk('mira').z, ry: folk('mira').ry, kind: 'quest', color: 0xc4a574,
    greeting: 'El camino del sur está lleno de keltirs.' },
  { id: 'bram', name: 'Bram', title: 'Cazador', x: folk('bram').x, z: folk('bram').z, ry: folk('bram').ry, kind: 'quest', color: 0x6a5030,
    greeting: 'Los lobos se vienen hasta la empalizada.' },
  { id: 'sella', name: 'Sella', title: 'Exploradora', x: folk('sella').x, z: folk('sella').z, ry: folk('sella').ry, kind: 'quest', color: 0x3a6a4a,
    greeting: 'Los goblins de las colinas están cada vez más agrandados.' },
  { id: 'dorian', name: 'Dorian', title: 'Rastreador', x: folk('dorian').x, z: folk('dorian').z, ry: folk('dorian').ry, kind: 'quest', color: 0x4a5a3a,
    greeting: 'Algo con escamas se está comiendo las cabras.' },
  { id: 'vessa', name: 'Vessa', title: 'Intendenta', x: folk('vessa').x, z: folk('vessa').z, ry: folk('vessa').ry, kind: 'quest', color: 0x8a6a3a,
    greeting: 'El cuartel no se va a vaciar solo.' },
  { id: 'harun', name: 'Harun', title: 'Sepulturero', x: folk('harun').x, z: folk('harun').z, ry: folk('harun').ry, kind: 'quest', color: 0x4a4a55,
    greeting: 'Los páramos le devuelven los huesos a los vivos.' },
  { id: 'nira', name: 'Nira', title: 'Picapedrera', x: folk('nira').x, z: folk('nira').z, ry: folk('nira').ry, kind: 'quest', color: 0x7a7a70,
    greeting: 'Los gólems van dejando piedra por todo el páramo.' },
  { id: 'kael', name: 'Kael', title: 'Guardabosques', x: 108, z: 40, ry: Math.atan2(12, -15), kind: 'quest', color: 0x2f6a38,
    greeting: 'Los keltirs ancianos mandan en cada manada de esta pradera.' },
  { id: 'grit', name: 'Grit', title: 'Baqueano', x: 30, z: -138, ry: Math.atan2(-15, -12), kind: 'quest', color: 0x5a7a32,
    greeting: 'Los brutos cuidan el corazón de estas colinas.' },
  { id: 'rusk', name: 'Rusk', title: 'Capitán', x: -136, z: -44, ry: Math.atan2(-14, 14), kind: 'quest', color: 0x8a3a2a,
    greeting: 'Su capitán sigue dando órdenes desde el cuartel.' },
  { id: 'mael', name: 'Mael', title: 'Hermana', x: -30, z: 160, ry: Math.atan2(15, 15), kind: 'quest', color: 0x5a3a6a,
    greeting: 'No podemos dejar que Kaim Vanul se levante.' },
  // Bastión del Ocaso (terrain.ts DUSK): the Abyssal set over the counter, Ashforged and Dragon made to order from what the 30-50 zones drop
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
  { id: 'dusk_clan', name: 'Morwen', title: 'Maestra de Clanes', x: 183, z: -163.5, ry: Math.atan2(-13, -6.5), kind: 'clan', color: 0x4a2a5a,
    greeting: 'Los clanes de verdad se forjan acá, lejos de la aldea.' },
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
  // Fuerte de Escarcha (levels 50-60): the Glacial set over the counter (shared/src/village.ts lays out where they stand)
  { id: 'frost_weapons', name: 'Bjorn', title: 'Maestro Armero', ...fort('frost_weapons'), kind: 'shop', color: 0x5a6a8a,
    shop: ['glacial_blade', 'glacial_staff'], greeting: 'Acero templado en la nieve. No se quiebra con el frío.' },
  { id: 'frost_armor', name: 'Freya', title: 'Maestra Armadurera', ...fort('frost_armor'), kind: 'shop', color: 0x3a5a8a,
    shop: ['helm', 'plate', 'robe', 'greaves', 'gauntlets', 'boots', 'ring', 'earring', 'necklace'].map((k) => `glacial_${k}`),
    greeting: 'Sin una buena coraza, en el norte durás lo que dura una tormenta.' },
  { id: 'frost_grocer', name: 'Helga', title: 'Alquimista', ...fort('frost_grocer'), kind: 'shop', color: 0x3a7a7a,
    shop: ['greater_healing_potion', 'supreme_healing_potion', 'greater_mana_potion', 'supreme_mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'],
    greeting: 'Pociones que no se congelan. Y vaya si las vas a necesitar.' },
  { id: 'frost_gate', name: 'Odvar', title: 'Guardián del Portal', ...fort('frost_gate'), kind: 'gatekeeper', color: 0x5a3a8a,
    greeting: 'El frío corta, pero el portal corta más rápido. Elegí destino.' },
  { id: 'frost_clan', name: 'Sigrun', title: 'Maestra de Clanes', ...fort('frost_clan'), kind: 'clan', color: 0x3a4a6a,
    greeting: 'En el norte nadie sobrevive solo. Por eso existen los clanes.' },
  { id: 'ingrid', name: 'Ingrid', title: 'Capitana de la Guardia', ...fort('ingrid'), kind: 'quest', color: 0x7a8aa0,
    greeting: 'La muralla aguanta. La guardia, no tanto.' },
  { id: 'sven', name: 'Sven', title: 'Peletero', ...fort('sven'), kind: 'quest', color: 0x8a6a4a,
    greeting: 'Acá el frío te muerde antes que los lobos.' },
  { id: 'astrid', name: 'Astrid', title: 'Estudiosa del Hielo', ...fort('astrid'), kind: 'quest', color: 0x4a8aaa,
    greeting: 'Este frío tiene voluntad propia. Lo puedo probar.' },
  // where the Gatekeeper drops you in each frost zone
  { id: 'rurik', name: 'Rurik', title: 'Explorador', x: -186, z: -634, ry: Math.atan2(6, -6), kind: 'quest', color: 0x5a6a5a,
    greeting: 'La tundra se traga las huellas en minutos.' },
  { id: 'eira', name: 'Eira', title: 'Vidente', x: -406, z: -652, ry: Math.atan2(6, -8), kind: 'quest', color: 0x6a5a9a,
    greeting: 'El Rey Gélido sueña, y su sueño congela el norte.' },
];
