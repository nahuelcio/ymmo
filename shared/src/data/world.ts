import { DUSK, EMBER, FROST, REED, ROAD_SEGS, TOWN, TOWNS } from '../terrain';
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
  { id: 'meadows', name: 'Praderas Ventosas', x: 340, z: 1380, r: 170, levels: '1-5', tint: [0.45, 0.68, 0.3],
    spawns: [{ mob: 'keltir', count: 14 }, { mob: 'gremlin', count: 12 }, { mob: 'elder_keltir', count: 10 }, { mob: 'young_wolf', count: 8 }] },
  { id: 'hills', name: 'Colinas Goblin', x: -380, z: 1340, r: 170, levels: '5-10', tint: [0.5, 0.58, 0.28],
    spawns: [{ mob: 'goblin_scout', count: 14 }, { mob: 'wolf', count: 10 }, { mob: 'goblin_brute', count: 10 }, { mob: 'hill_lizard', count: 8 }] },
  { id: 'barracks', name: 'Cuartel Orco', x: -120, z: 1170, r: 130, levels: '10-15', tint: [0.38, 0.45, 0.25],
    spawns: [{ mob: 'orc_warrior', count: 14 }, { mob: 'orc_archer', count: 10 }, { mob: 'orc_shaman', count: 8 }, { mob: 'werewolf', count: 8 }, { mob: 'orc_captain', count: 2 }] },
  { id: 'wastes', name: 'Páramos Malditos', x: -330, z: 720, r: 190, levels: '15-20', tint: [0.42, 0.36, 0.34],
    spawns: [{ mob: 'skeleton', count: 14 }, { mob: 'zombie', count: 10 }, { mob: 'stone_golem', count: 8 }, { mob: 'cave_spider', count: 8 }, { mob: 'kaim_vanul', count: 1 }] },
  // 15-25 past the first range (the Bastión's lands), 25-40 the Heart, 40-50 the Dragon's lands: each band north of the last
  { id: 'coast', name: 'Costa Abandonada', x: 980, z: 760, r: 180, levels: '20-25', tint: [0.62, 0.58, 0.42],
    spawns: [{ mob: 'drowned_sailor', count: 12 }, { mob: 'tide_crab', count: 10 }, { mob: 'sea_serpent', count: 8 }, { mob: 'drowned_corsair', count: 8 }, { mob: 'reef_golem', count: 5 }, { mob: 'coast_queen', count: 1 }] },
  { id: 'ruins', name: 'Ruinas Hundidas', x: 320, z: 160, r: 190, levels: '25-30', tint: [0.36, 0.44, 0.46],
    spawns: [{ mob: 'ruin_wraith', count: 12 }, { mob: 'deep_lurker', count: 10 }, { mob: 'ruin_sentinel', count: 8 }, { mob: 'abyssal_cultist', count: 8 }, { mob: 'aberration', count: 5 }] },
  { id: 'steppes', name: 'Estepas Ardientes', x: -700, z: 140, r: 200, levels: '30-35', tint: [0.55, 0.34, 0.22],
    spawns: [{ mob: 'ash_hound', count: 12 }, { mob: 'steppe_raider', count: 10 }, { mob: 'ember_spider', count: 8 }, { mob: 'steppe_shaman', count: 8 }, { mob: 'magma_golem', count: 5 }, { mob: 'gruhash', count: 1 }] },
  { id: 'citadel', name: 'Ciudadela Orca', x: 850, z: 120, r: 180, levels: '35-40', tint: [0.34, 0.32, 0.26],
    spawns: [{ mob: 'citadel_guard', count: 12 }, { mob: 'citadel_archer', count: 10 }, { mob: 'war_wolf', count: 8 }, { mob: 'citadel_warlock', count: 8 }, { mob: 'citadel_champion', count: 2 }] },
  { id: 'valley', name: 'Valle del Dragón', x: 380, z: -450, r: 170, levels: '40-45', tint: [0.3, 0.4, 0.3],
    spawns: [{ mob: 'drake_whelp', count: 12 }, { mob: 'valley_basilisk', count: 10 }, { mob: 'obsidian_golem', count: 7 }, { mob: 'wyvern', count: 7 }, { mob: 'elder_drake', count: 5 }, { mob: 'kaim_reborn', count: 1 }] },
  { id: 'nest', name: 'Nido del Dragón', x: -420, z: -460, r: 170, levels: '45-50', tint: [0.28, 0.22, 0.3],
    spawns: [{ mob: 'nest_guardian', count: 10 }, { mob: 'dragon_cultist', count: 10 }, { mob: 'brood_spider', count: 8 }, { mob: 'dragonkin', count: 8 }, { mob: 'ancient_drake', count: 5 }] },
  // 50-78 in the north. The frost region (north-west), round the Fuerte de Escarcha
  { id: 'tundra', name: 'Tundra Helada', x: -180, z: -980, r: 170, levels: '50-55', tint: [0.86, 0.9, 0.95],
    spawns: [{ mob: 'frost_wolf', count: 14 }, { mob: 'tundra_raider', count: 10 }, { mob: 'frost_wraith', count: 8 }, { mob: 'ice_shaman', count: 8 }, { mob: 'ice_golem', count: 5 }] },
  { id: 'peaks', name: 'Picos Helados', x: -900, z: -1000, r: 170, levels: '55-60', tint: [0.8, 0.86, 0.93],
    spawns: [{ mob: 'yeti', count: 12 }, { mob: 'white_drake', count: 10 }, { mob: 'frost_giant', count: 8 }, { mob: 'frost_wyvern', count: 7 }, { mob: 'frost_knight', count: 6 }, { mob: 'primal_yeti', count: 1 }] },
  // the swamp region (north-east, past range E), round Juncoverde
  { id: 'swamp', name: 'Pantano Ponzoñoso', x: 980, z: -850, r: 160, levels: '60-65', tint: [0.3, 0.36, 0.2],
    spawns: [{ mob: 'swamp_cobra', count: 14 }, { mob: 'mud_crab', count: 10 }, { mob: 'bog_drowned', count: 8 }, { mob: 'bog_witch', count: 8 }, { mob: 'mire_lurker', count: 5 }] },
  { id: 'jungle', name: 'Selva Antigua', x: 520, z: -1080, r: 160, levels: '65-70', tint: [0.22, 0.42, 0.18],
    spawns: [{ mob: 'jungle_raptor', count: 12 }, { mob: 'giant_spider', count: 10 }, { mob: 'tribal_hunter', count: 8 }, { mob: 'corrupted_ent', count: 7 }, { mob: 'jungle_beast', count: 6 }, { mob: 'elder_ent', count: 1 }] },
  // the volcanic region (far north, past range F), either side of Brasaoscura
  { id: 'volcanic', name: 'Tierras Volcánicas', x: -450, z: -1450, r: 160, levels: '70-74', tint: [0.3, 0.17, 0.12],
    spawns: [{ mob: 'lava_salamander', count: 14 }, { mob: 'hellhound', count: 10 }, { mob: 'lava_golem', count: 7 }, { mob: 'pyromancer', count: 8 }, { mob: 'magma_drake', count: 5 }, { mob: 'flame_lord', count: 1 }] },
  { id: 'abyss', name: 'Abismo', x: 480, z: -1460, r: 160, levels: '74-78', tint: [0.15, 0.11, 0.19],
    spawns: [{ mob: 'abyss_knight', count: 12 }, { mob: 'lich', count: 10 }, { mob: 'abyss_weaver', count: 8 }, { mob: 'abyss_drake', count: 6 }, { mob: 'abyss_demon', count: 6 }] },
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
  /** travelers: walk back and forth along this road segment [ax, az, bx, bz] */
  road?: [number, number, number, number];
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

/** Where the Gatekeeper drops you in a zone (and its guide stands, dx/dz off it): 35% in from the centre toward the nearest town. */
function drop(id: string, dx = 0, dz = 0): { x: number; z: number } {
  const zn = ZONES.find((z) => z.id === id)!;
  const t = TOWNS.reduce((a, b) => (Math.hypot(b.x - zn.x, b.z - zn.z) < Math.hypot(a.x - zn.x, a.z - zn.z) ? b : a));
  const k = (0.35 * zn.r) / Math.hypot(t.x - zn.x, t.z - zn.z);
  return { x: Math.round(zn.x + (t.x - zn.x) * k) + dx, z: Math.round(zn.z + (t.z - zn.z) * k) + dz };
}

export const TELEPORTS = [
  { id: 'town', name: 'Aldea del Alba', x: TOWN.x + 8, z: TOWN.z + 8, cost: 0 },
  { id: 'dusk', name: 'Bastión del Ocaso', x: DUSK.x, z: DUSK.z + 6, cost: 3000 },
  { id: 'meadows', name: 'Praderas Ventosas (Nv 1-5)', ...drop('meadows'), cost: 0 },
  { id: 'hills', name: 'Colinas Goblin (Nv 5-10)', ...drop('hills'), cost: 300 },
  { id: 'barracks', name: 'Cuartel Orco (Nv 10-15)', ...drop('barracks'), cost: 1000 },
  { id: 'wastes', name: 'Páramos Malditos (Nv 15-20)', ...drop('wastes'), cost: 2500 },
  { id: 'coast', name: 'Costa Abandonada (Nv 20-25)', ...drop('coast'), cost: 5000 },
  { id: 'ruins', name: 'Ruinas Hundidas (Nv 25-30)', ...drop('ruins'), cost: 8000 },
  { id: 'steppes', name: 'Estepas Ardientes (Nv 30-35)', ...drop('steppes'), cost: 12000 },
  { id: 'citadel', name: 'Ciudadela Orca (Nv 35-40)', ...drop('citadel'), cost: 16000 },
  { id: 'valley', name: 'Valle del Dragón (Nv 40-45)', ...drop('valley'), cost: 22000 },
  { id: 'nest', name: 'Nido del Dragón (Nv 45-50)', ...drop('nest'), cost: 30000 },
  { id: 'frost', name: 'Fuerte de Escarcha', x: FROST.x, z: FROST.z + 6, cost: 40000 },
  { id: 'tundra', name: 'Tundra Helada (Nv 50-55)', ...drop('tundra'), cost: 45000 },
  { id: 'peaks', name: 'Picos Helados (Nv 55-60)', ...drop('peaks'), cost: 50000 },
  { id: 'reed', name: 'Juncoverde', x: REED.x, z: REED.z + 6, cost: 60000 },
  { id: 'swamp', name: 'Pantano Ponzoñoso (Nv 60-65)', ...drop('swamp'), cost: 65000 },
  { id: 'jungle', name: 'Selva Antigua (Nv 65-70)', ...drop('jungle'), cost: 70000 },
  { id: 'ember', name: 'Brasaoscura', x: EMBER.x - 6, z: EMBER.z, cost: 80000 },
  { id: 'volcanic', name: 'Tierras Volcánicas (Nv 70-74)', ...drop('volcanic'), cost: 85000 },
  { id: 'abyss', name: 'Abismo (Nv 74-78)', ...drop('abyss'), cost: 90000 },
];

/** Alba's residents stand at spots authored around the village centre. */
const folk = (id: string) => { const n = ALBA_FOLK.find((f) => f.id === id)!; return { ...n, x: TOWN.x + n.x, z: TOWN.z + n.z }; };
const fort = (id: string) => { const n = fortFolk(id); return { x: n.x, z: n.z, ry: n.ry }; };


/** Travelers: talkers who walk the roads near Alba back and forth, so the land between towns is not empty. */
const walker = (i: number) => { const r = ROAD_SEGS[i]; return { x: r[0], z: r[1], ry: 0, road: r }; };
const TRAVELERS: NpcDef[] = [
  { id: 'trav_merchant', name: 'Oswin', title: 'Mercader Ambulante', ...walker(0), kind: 'talker', color: 0x8a6a2a,
    greeting: 'Si el carro aguanta, llego a la próxima aldea antes del anochecer.',
    lines: ['Telas, especias, clavos... no, clavos no me quedan.', 'Ojo con los lobos más allá del puente.', 'Una moneda por el chisme del día. Bueno, gratis: hay goblins en las colinas.'] },
  { id: 'trav_pilgrim', name: 'Edda', title: 'Peregrina', ...walker(26), kind: 'talker', color: 0xd8d0b8,
    greeting: 'Cada piedra de este camino tiene una plegaria.',
    lines: ['Caminar despeja la cabeza. Y las ampollas, el alma.', 'Que la luz te encuentre antes que los keltirs.', 'Ya perdí la cuenta de las leguas.'] },
  { id: 'trav_hunter', name: 'Brok', title: 'Trampero', ...walker(24), kind: 'talker', color: 0x4a5a2a,
    greeting: 'Huellas frescas. Algo grande pasó por acá anoche.',
    lines: ['Las pieles se pagan bien en Alba.', 'Si ves un ciervo, no corras. Yo sí, pero vos no.', 'Este camino era más tranquilo antes.'] },
  { id: 'trav_bard', name: 'Lirio', title: 'Juglar', ...walker(25), kind: 'talker', color: 0x9a3a6a,
    greeting: '¿Una canción? Te la cobro después.',
    lines: ['♪ Por el camino viene el héroe, sin pociones y sin fe... ♪', 'Estoy componiendo una balada sobre vos. Todavía no sé si termina bien.', 'La rima con "goblin" me tiene loco.'] },
  { id: 'trav_guard', name: 'Teodor', title: 'Patrulla del Camino', ...walker(1), kind: 'talker', color: 0x5a6a8a,
    greeting: 'Camino seguro, ciudadano. Más o menos.',
    lines: ['Sin novedad en el frente. Bueno, un lobo.', 'Si ves bandidos, avisá. Si ves muchos, corré.', 'Doce horas de ronda y ni un pan.'] },
  { id: 'trav_farmer', name: 'Greta', title: 'Granjera', ...walker(2), kind: 'talker', color: 0x7a8a3a,
    greeting: 'Llevo nabos al mercado. ¿Querés uno? Es broma, son todos vendidos.',
    lines: ['La cosecha viene buena este año.', 'Mis gallinas le tienen más miedo a los goblins que yo.', 'Uf, estas cuestas me matan.'] },
];

export const NPCS: NpcDef[] = [
  { id: 'grocer', name: 'Lia', title: 'Almacenera', x: folk('grocer').x, z: folk('grocer').z, ry: folk('grocer').ry, kind: 'shop', color: 0x4a8a3a,
    shop: ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'], craft: ['healing_potion'], greeting: '¡Pociones y pergaminos! Todo lo que un aventurero necesita.' },
  { id: 'weapons', name: 'Gerald', title: 'Armero', x: folk('weapons').x, z: folk('weapons').z, ry: folk('weapons').ry, kind: 'shop', color: 0x8a3a3a,
    shop: ['woodcutter_axe', 'miner_pickaxe', 'short_sword', 'apprentice_wand', 'dagger', 'broadsword', 'willow_staff', 'hand_axe', 'spear', 'iron_hammer', 'sword_of_revolution', 'staff_of_life', 'assassin_dagger', 'partisan', 'battle_axe'],
    craft: ['willow_staff', 'hand_axe', 'iron_hammer', 'battle_axe', 'war_hammer'], greeting: 'Con una buena hoja, cualquiera se anima.' },
  { id: 'armor', name: 'Hilda', title: 'Armadurera', x: folk('armor').x, z: folk('armor').z, ry: folk('armor').ry, kind: 'shop', color: 0x3a5a8a,
    shop: ['leather_cap', 'wooden_buckler', 'wool_cape', 'apprentice_tunic', 'apprentice_stockings', 'short_gloves', 'leather_sandals', 'brigandine_helm', 'brigandine_shield', 'hunter_cape', 'karmian_hat', 'brigandine_tunic', 'brigandine_gaiters', 'reinforced_gloves', 'reinforced_boots', 'karmian_tunic', 'karmian_stockings', 'ring_of_vigor', 'earring_of_focus', 'necklace_of_valor'],
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
  { id: 'kael', name: 'Kael', title: 'Guardabosques', ...drop('meadows', -12, 15), ry: Math.atan2(12, -15), kind: 'quest', color: 0x2f6a38,
    greeting: 'Los keltirs ancianos mandan en cada manada de esta pradera.' },
  { id: 'grit', name: 'Grit', title: 'Baqueano', ...drop('hills', 15, 12), ry: Math.atan2(-15, -12), kind: 'quest', color: 0x5a7a32,
    greeting: 'Los brutos cuidan el corazón de estas colinas.' },
  { id: 'rusk', name: 'Rusk', title: 'Capitán', ...drop('barracks', 14, -14), ry: Math.atan2(-14, 14), kind: 'quest', color: 0x8a3a2a,
    greeting: 'Su capitán sigue dando órdenes desde el cuartel.' },
  { id: 'mael', name: 'Mael', title: 'Hermana', ...drop('wastes', -15, -15), ry: Math.atan2(15, 15), kind: 'quest', color: 0x5a3a6a,
    greeting: 'No podemos dejar que Kaim Vanul se levante.' },
  // Bastión del Ocaso (terrain.ts DUSK): the Abyssal set over the counter, Ashforged and Dragon made to order from what the 30-50 zones drop
  { id: 'dusk_weapons', name: 'Varek', title: 'Maestro Armero', x: DUSK.x + 8, z: DUSK.z + 8, ry: Math.atan2(-8, -8), kind: 'shop', color: 0x7a2a2a,
    shop: ['abyssal_blade', 'abyssal_staff'], craft: ['ashforged_blade', 'ashforged_staff', 'dragon_blade', 'dragon_staff'],
    greeting: 'El acero bueno no se compra hecho. Traeme con qué forjarlo.' },
  { id: 'dusk_armor', name: 'Isolda', title: 'Maestra Armadurera', x: DUSK.x + -8, z: DUSK.z + -8, ry: Math.atan2(8, 8), kind: 'shop', color: 0x2a4a7a,
    shop: ['abyssal_helm', 'abyssal_circlet', 'abyssal_shield', 'abyssal_cape', 'abyssal_plate', 'abyssal_robe', 'abyssal_greaves', 'abyssal_gauntlets', 'abyssal_gloves', 'abyssal_boots', 'abyssal_shoes', 'abyssal_ring', 'abyssal_earring', 'abyssal_necklace'],
    craft: ['ashforged', 'dragon'].flatMap((p) => ['helm', 'circlet', 'shield', 'cape', 'plate', 'robe', 'greaves', 'gauntlets', 'gloves', 'boots', 'shoes', 'ring', 'earring', 'necklace'].map((k) => `${p}_${k}`)),
    greeting: 'Lo de la aldea es para cazar lobos. Acá vestimos a los que van al Nido.' },
  { id: 'dusk_grocer', name: 'Mirta', title: 'Alquimista', x: DUSK.x + 11, z: DUSK.z + -2, ry: Math.atan2(-11, 2), kind: 'shop', color: 0x3a7a5a,
    shop: ['healing_potion', 'greater_healing_potion', 'mana_potion', 'greater_mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'],
    greeting: 'Pociones de las fuertes. Las otras te las venden en la aldea.' },
  { id: 'dusk_gate', name: 'Tavish', title: 'Guardián del Portal', x: DUSK.x + -11, z: DUSK.z + 2, ry: Math.atan2(11, -2), kind: 'gatekeeper', color: 0x6a3a8a,
    greeting: 'Desde acá las zonas bravas quedan a un paso. Y a unas monedas.' },
  { id: 'dusk_clan', name: 'Morwen', title: 'Maestra de Clanes', x: DUSK.x + 13, z: DUSK.z + 6.5, ry: Math.atan2(-13, -6.5), kind: 'clan', color: 0x4a2a5a,
    greeting: 'Los clanes de verdad se forjan acá, lejos de la aldea.' },
  // one quest giver where the Gatekeeper drops you in each 20-50 zone
  { id: 'tobias', name: 'Tobías', title: 'Farero', ...drop('coast', -5, 5), ry: Math.atan2(-1, -1), kind: 'quest', color: 0x5a7a8a,
    greeting: 'La marea devuelve a los que se llevó.' },
  { id: 'ysolde', name: 'Ysolde', title: 'Arqueóloga', ...drop('ruins', -5, -5), ry: Math.atan2(-1, 1), kind: 'quest', color: 0x6a8a7a,
    greeting: 'Estas ruinas eran una ciudad antes de que subiera el agua.' },
  { id: 'korgan', name: 'Korgan', title: 'Explorador de las Estepas', ...drop('steppes', 5, -5), ry: Math.atan2(1, 1), kind: 'quest', color: 0x9a6a3a,
    greeting: 'Acá hasta el viento quema.' },
  { id: 'brenna', name: 'Brenna', title: 'Capitana del Asedio', ...drop('citadel', -5, 5), ry: Math.atan2(1, -1), kind: 'quest', color: 0x7a3a3a,
    greeting: 'La ciudadela no cae mientras sus campeones sigan en pie.' },
  { id: 'aldric', name: 'Aldric', title: 'Cazador de Dragones', ...drop('valley', -5, 5), ry: Math.atan2(-1, 0.4), kind: 'quest', color: 0x4a6a3a,
    greeting: 'Todo lo que camina en este valle tiene escamas.' },
  { id: 'sibila', name: 'Sibila', title: 'Vidente', ...drop('nest', 5, -5), ry: Math.atan2(1, -0.4), kind: 'quest', color: 0x6a3a7a,
    greeting: 'El nido está despierto. Lo siento en los huesos.' },
  // Fuerte de Escarcha (levels 50-60): the Glacial set over the counter (shared/src/village.ts lays out where they stand)
  { id: 'frost_weapons', name: 'Bjorn', title: 'Maestro Armero', ...fort('frost_weapons'), kind: 'shop', color: 0x5a6a8a,
    shop: ['glacial_blade', 'glacial_staff'], greeting: 'Acero templado en la nieve. No se quiebra con el frío.' },
  { id: 'frost_armor', name: 'Freya', title: 'Maestra Armadurera', ...fort('frost_armor'), kind: 'shop', color: 0x3a5a8a,
    shop: ['helm', 'circlet', 'shield', 'cape', 'plate', 'robe', 'greaves', 'gauntlets', 'gloves', 'boots', 'shoes', 'ring', 'earring', 'necklace'].map((k) => `glacial_${k}`),
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
  { id: 'rurik', name: 'Rurik', title: 'Explorador', ...drop('tundra', -6, 6), ry: Math.atan2(6, -6), kind: 'quest', color: 0x5a6a5a,
    greeting: 'La tundra se traga las huellas en minutos.' },
  { id: 'eira', name: 'Eira', title: 'Vidente', ...drop('peaks', -6, 6), ry: Math.atan2(6, -6), kind: 'quest', color: 0x6a5a9a,
    greeting: 'El Rey Gélido sueña, y su sueño congela el norte.' },
  // Juncoverde (levels 60-70): the Emerald set made to order from the swamp's venom and the jungle's bark
  { id: 'reed_weapons', name: 'Tarek', title: 'Maestro Armero', ...fort('reed_weapons'), kind: 'shop', color: 0x4a7a3a,
    shop: ['glacial_blade', 'glacial_staff'], craft: ['emerald_blade', 'emerald_staff'],
    greeting: 'Las armas Esmeralda no se venden: se forjan. Traeme veneno y corteza.' },
  { id: 'reed_armor', name: 'Lyra', title: 'Maestra Armadurera', ...fort('reed_armor'), kind: 'shop', color: 0x3a6a5a,
    craft: ['helm', 'circlet', 'shield', 'cape', 'plate', 'robe', 'greaves', 'gauntlets', 'gloves', 'boots', 'shoes', 'ring', 'earring', 'necklace'].map((k) => `emerald_${k}`),
    greeting: 'En la selva, el que no se cubre termina cubierto de hojas.' },
  { id: 'reed_grocer', name: 'Nadia', title: 'Alquimista', ...fort('reed_grocer'), kind: 'shop', color: 0x5a8a3a,
    shop: ['greater_healing_potion', 'supreme_healing_potion', 'greater_mana_potion', 'supreme_mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'],
    greeting: 'Antídotos no tengo, pero pociones fuertes sí.' },
  { id: 'reed_gate', name: 'Kamal', title: 'Guardián del Portal', ...fort('reed_gate'), kind: 'gatekeeper', color: 0x6a4a7a,
    greeting: 'El agua tarda, el portal no. ¿A dónde vamos?' },
  { id: 'reed_clan', name: 'Selene', title: 'Maestra de Clanes', ...fort('reed_clan'), kind: 'clan', color: 0x3a5a4a,
    greeting: 'Hasta el junco más fino aguanta si crece en manada.' },
  { id: 'thalia', name: 'Thalia', title: 'Guardabosques', ...fort('thalia'), kind: 'quest', color: 0x3a7a4a,
    greeting: 'El pantano avanza un poco cada día.' },
  { id: 'oren', name: 'Oren', title: 'Herbolario', ...fort('oren'), kind: 'quest', color: 0x6a8a3a,
    greeting: 'Todo veneno tiene su antídoto. Casi todo.' },
  { id: 'ilwen', name: 'Ilwen', title: 'Druida', ...fort('ilwen'), kind: 'quest', color: 0x5a6a2a,
    greeting: 'La selva está enferma. La escucho toser.' },
  // where the Gatekeeper drops you in each swamp zone
  { id: 'morla', name: 'Morla', title: 'Barquera', ...drop('swamp', 6, -6), ry: Math.atan2(-6, 6), kind: 'quest', color: 0x5a6a5a,
    greeting: 'El agua devuelve lo que se lleva. Siempre.' },
  { id: 'zahir', name: 'Zahir', title: 'Cazador de Serpientes', ...drop('jungle', 6, -6), ry: Math.atan2(-6, 6), kind: 'quest', color: 0x7a5a3a,
    greeting: 'Ssithra no es una leyenda. Le vi la cola.' },
  // Brasaoscura (levels 70-78): the Infernal set made to order from magma cores and abyss essence
  { id: 'ember_weapons', name: 'Draven', title: 'Maestro Armero', ...fort('ember_weapons'), kind: 'shop', color: 0x8a2a1a,
    shop: ['glacial_blade', 'glacial_staff'], craft: ['emerald_blade', 'emerald_staff', 'infernal_blade', 'infernal_staff'],
    greeting: 'Las armas Infernales nacen del magma y de la esencia del Abismo. Traeme las dos.' },
  { id: 'ember_armor', name: 'Ravena', title: 'Maestra Armadurera', ...fort('ember_armor'), kind: 'shop', color: 0x5a2a3a,
    craft: ['helm', 'circlet', 'shield', 'cape', 'plate', 'robe', 'greaves', 'gauntlets', 'gloves', 'boots', 'shoes', 'ring', 'earring', 'necklace'].map((k) => `infernal_${k}`),
    greeting: 'Acá abajo no hay segunda armadura. Que la primera sea buena.' },
  { id: 'ember_grocer', name: 'Cassius', title: 'Alquimista', ...fort('ember_grocer'), kind: 'shop', color: 0x8a4a2a,
    shop: ['greater_healing_potion', 'supreme_healing_potion', 'greater_mana_potion', 'supreme_mana_potion', 'scroll_of_escape', 'scroll_enchant_armor', 'scroll_enchant_weapon'],
    greeting: 'Pociones contra el calor no tengo. Contra la muerte, algunas.' },
  { id: 'ember_gate', name: 'Orrin', title: 'Guardián del Portal', ...fort('ember_gate'), kind: 'gatekeeper', color: 0x6a2a5a,
    greeting: 'Cualquier lugar es mejor que este. Por unas monedas te llevo.' },
  { id: 'ember_clan', name: 'Isaura', title: 'Maestra de Clanes', ...fort('ember_clan'), kind: 'clan', color: 0x4a1a2a,
    greeting: 'Al Abismo no se baja solo. Se baja en clan.' },
  { id: 'varga', name: 'Varga', title: 'Comandante', ...fort('varga'), kind: 'quest', color: 0x7a3a2a,
    greeting: 'Los portones aguantan. Por ahora.' },
  { id: 'brunhilda', name: 'Brunhilda', title: 'Forjadora', ...fort('brunhilda'), kind: 'quest', color: 0x9a4a1a,
    greeting: 'Mi forja tiene hambre. Y la tuya también, si querés armas de verdad.' },
  { id: 'nyx', name: 'Nyx', title: 'Exorcista', ...fort('nyx'), kind: 'quest', color: 0x5a3a7a,
    greeting: 'El Abismo susurra. Yo le contesto con sellos.' },
  { id: 'veyra', name: 'Veyra', title: 'Guardiana del Despertar', ...fort('veyra'), kind: 'quest', color: 0x9a7ad8,
    greeting: 'Hay un poder dormido en vos. Lo veo. ¿Querés despertarlo?' },
  // where the Gatekeeper drops you in each volcanic zone
  { id: 'ignis', name: 'Ignis', title: 'Monje de Ceniza', ...drop('volcanic', 6, -6), ry: Math.atan2(-6, 6), kind: 'quest', color: 0x6a5a50,
    greeting: 'Yo también adoré a las llamas. Me quemaron igual.' },
  { id: 'seraphel', name: 'Seraphel', title: 'Paladín Caído', ...drop('abyss', 6, -6), ry: Math.atan2(-6, 6), kind: 'quest', color: 0xc8b070,
    greeting: 'Mi orden cayó acá. Yo todavía no.' },
  ...TRAVELERS,
];
