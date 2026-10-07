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
  { id: 'meadows', name: 'Praderas Ventosas', x: 190, z: 30, r: 100, levels: '1-5', tint: [0.45, 0.68, 0.3],
    spawns: [{ mob: 'keltir', count: 14 }, { mob: 'gremlin', count: 12 }, { mob: 'elder_keltir', count: 10 }, { mob: 'young_wolf', count: 8 }] },
  { id: 'hills', name: 'Colinas Goblin', x: 20, z: -220, r: 100, levels: '5-10', tint: [0.5, 0.58, 0.28],
    spawns: [{ mob: 'goblin_scout', count: 14 }, { mob: 'wolf', count: 10 }, { mob: 'goblin_brute', count: 10 }, { mob: 'hill_lizard', count: 8 }] },
  { id: 'barracks', name: 'Cuartel Orco', x: -230, z: -40, r: 110, levels: '10-15', tint: [0.38, 0.45, 0.25],
    spawns: [{ mob: 'orc_warrior', count: 14 }, { mob: 'orc_archer', count: 10 }, { mob: 'orc_shaman', count: 8 }, { mob: 'werewolf', count: 8 }, { mob: 'orc_captain', count: 2 }] },
  { id: 'wastes', name: 'Páramos Malditos', x: -20, z: 260, r: 120, levels: '15-20', tint: [0.42, 0.36, 0.34],
    spawns: [{ mob: 'skeleton', count: 14 }, { mob: 'zombie', count: 10 }, { mob: 'stone_golem', count: 8 }, { mob: 'cave_spider', count: 8 }, { mob: 'kaim_vanul', count: 1 }] },
];

export function zoneAt(x: number, z: number): string {
  if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 10) return TOWN.name;
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
  { id: 'meadows', name: 'Praderas Ventosas (Nv 1-5)', x: 120, z: 25, cost: 0 },
  { id: 'hills', name: 'Colinas Goblin (Nv 5-10)', x: 15, z: -150, cost: 300 },
  { id: 'barracks', name: 'Cuartel Orco (Nv 10-15)', x: -150, z: -30, cost: 1000 },
  { id: 'wastes', name: 'Páramos Malditos (Nv 15-20)', x: -15, z: 175, cost: 2500 },
];

export const NPCS: NpcDef[] = [
  { id: 'grocer', name: 'Lia', title: 'Almacenera', x: 10, z: -14, ry: Math.PI, kind: 'shop', color: 0x4a8a3a,
    shop: ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape'], greeting: '¡Pociones y pergaminos! Todo lo que un aventurero necesita.' },
  { id: 'weapons', name: 'Gerald', title: 'Armero', x: -14, z: -10, ry: Math.PI / 2, kind: 'shop', color: 0x8a3a3a,
    shop: ['short_sword', 'apprentice_wand', 'broadsword', 'willow_staff', 'iron_hammer', 'sword_of_revolution', 'staff_of_life'], greeting: 'Con una buena hoja, cualquiera se anima.' },
  { id: 'armor', name: 'Hilda', title: 'Armadurera', x: -12, z: 12, ry: Math.PI / 2, kind: 'shop', color: 0x3a5a8a,
    shop: ['leather_cap', 'apprentice_tunic', 'apprentice_stockings', 'short_gloves', 'leather_sandals', 'brigandine_helm', 'brigandine_tunic', 'brigandine_gaiters', 'reinforced_gloves', 'reinforced_boots', 'karmian_tunic', 'karmian_stockings'],
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
  { id: 'vessa', name: 'Vessa', title: 'Intendenta', x: -26, z: 8, ry: Math.atan2(26, -8), kind: 'quest', color: 0x8a6a3a,
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
];
