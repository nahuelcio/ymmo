import { ITEMS } from './items';
import { MOBS } from './mobs';

export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';

export interface QuestDef {
  id: string;
  npc: string;
  name: string;
  minLevel: number;
  story: string;
  offer: string;
  busy: string;
  ready: string;
  doneText: string;
  objective: { type: 'kill'; mob: string; count: number } | { type: 'collect'; item: string; count: number };
  xp: number;
  adena: number;
}

export function questSummary(q: QuestDef): string {
  const o = q.objective;
  if (o.type === 'kill') return `Matar ${o.count} × ${MOBS[o.mob].name}`;
  return `Traer ${o.count} × ${ITEMS[o.item].name}`;
}

/** How many levels ahead a not-yet-available quest shows a grey "!". */
export const QUEST_SOON_LEVELS = 3;

export type QuestMarker = 'available' | 'soon' | 'ready' | 'active' | null;

/** WoW-style marker over a quest giver: yellow !/? = actionable, grey = not yet. */
export function questMarker(q: QuestDef, level: number, active: { progress: number } | undefined, done: boolean): QuestMarker {
  if (done) return null;
  if (active) return active.progress >= q.objective.count ? 'ready' : 'active';
  if (level >= q.minLevel) return 'available';
  return level + QUEST_SOON_LEVELS >= q.minLevel ? 'soon' : null;
}

/** Mob templates that advance a quest: the kill target, or every mob that drops the item. */
export function questMobs(q: QuestDef): string[] {
  const o = q.objective;
  if (o.type === 'kill') return [o.mob];
  return Object.values(MOBS).filter((m) => m.drops.some((d) => d.item === o.item)).map((m) => m.id);
}

export function questLine(q: QuestDef, status: QuestStatus): string {
  if (status === 'locked') return `Volvé cuando llegues a nivel ${q.minLevel}.`;
  if (status === 'available') return q.offer;
  if (status === 'active') return q.busy;
  if (status === 'ready') return q.ready;
  return q.doneText;
}

const list: QuestDef[] = [
  { id: 'pest_control', npc: 'mira', name: 'Control de Plagas', minLevel: 1, xp: 120, adena: 200,
    objective: { type: 'kill', mob: 'keltir', count: 8 },
    story: 'Por el camino del sur de la Aldea del Alba pasaban el grano y los chismes. Ahora es de los keltirs, y las carretas pegan la vuelta en la empalizada.',
    offer: 'Bajá 8 keltirs en el camino del sur y te pago.',
    busy: 'La pradera sigue alborotada. Seguí cazando keltirs.',
    ready: 'Con eso el camino se calma. Acá tenés lo tuyo.',
    doneText: 'El camino del sur está tranquilo. Gracias.' },
  { id: 'wolf_pelts', npc: 'bram', name: 'Pieles de Lobo', minLevel: 4, xp: 800, adena: 800,
    objective: { type: 'collect', item: 'wolf_pelt', count: 5 },
    story: 'Pasando la empalizada el pasto se queda quieto, y ahí empiezan los lobos jóvenes. Sus pieles son lo único que separa a la aldea de un invierno de capas finitas.',
    offer: 'Pasando la empalizada está lleno de lobos jóvenes. Traeme 5 pieles de lobo.',
    busy: 'Todavía necesito esas pieles. Las tienen los lobos jóvenes.',
    ready: 'Buen cuero. Dámelas, yo me encargo.',
    doneText: 'Van a salir lindas capas. Si encontrás más laburo, volvé.' },
  { id: 'goblin_ears', npc: 'sella', name: 'Orejas de Goblin', minLevel: 7, xp: 2500, adena: 2500,
    objective: { type: 'collect', item: 'goblin_ear', count: 8 },
    story: 'Los exploradores goblin andan clavando estandartes robados por todas las colinas. La guardia los cuenta por las orejas que le traen.',
    offer: 'Exploradores y brutos de las colinas, todos tienen orejas. Traeme 8.',
    busy: 'Ocho orejas. Exploradores o brutos, me da igual.',
    ready: 'Eso es una cuenta como la gente. Pasámelas.',
    doneText: 'En las colinas se lo van a pensar dos veces. Bien cazado.' },
  { id: 'hill_lizards', npc: 'dorian', name: 'Lagartos de las Colinas', minLevel: 10, xp: 5500, adena: 6000,
    objective: { type: 'kill', mob: 'hill_lizard', count: 10 },
    story: 'Las cabras vuelven más flacas, o directamente no vuelven. Algo con escamas en las laderas aprendió que el ganado es más rico que la piedra.',
    offer: 'Los lagartos de las colinas se comen todo lo que se aleja. Matá 10.',
    busy: 'Los lagartos siguen en las laderas. Diez, ni uno menos.',
    ready: 'Las laderas están más tranquilas. Te lo ganaste.',
    doneText: 'Las cabras están a salvo. Por ahora.' },
  { id: 'orc_tusks', npc: 'vessa', name: 'Colmillos de Orco', minLevel: 13, xp: 9000, adena: 12000,
    objective: { type: 'collect', item: 'orc_tusk', count: 10 },
    story: 'El cuartel antes era un puesto de vigilancia. Ahora los guerreros, arqueros y chamanes orcos entrenan en el patio, y la intendencia quiere pruebas de cada uno que cae.',
    offer: 'Traeme 10 colmillos de orco del cuartel. Guerreros, arqueros, chamanes: cualquiera sirve.',
    busy: 'Necesito los 10 colmillos antes de pagarte.',
    ready: 'Una tira completa de colmillos. La intendencia está contenta.',
    doneText: 'El cuartel va a sentir esa pérdida.' },
  { id: 'cursed_bones', npc: 'harun', name: 'Huesos Malditos', minLevel: 16, xp: 14000, adena: 20000,
    objective: { type: 'collect', item: 'cursed_bone', count: 8 },
    story: 'Los Páramos Malditos no se quedan con sus muertos. Soldados esqueleto y zombis podridos caminan entre las tumbas viejas, y solo un entierro como corresponde los deja quietos.',
    offer: 'El páramo está plagado de soldados esqueleto y zombis podridos. Traeme 8 huesos malditos.',
    busy: 'Ocho huesos malditos. No los tengas en la mochila más de lo necesario.',
    ready: 'Los voy a enterrar como se debe. Tu plata está lista.',
    doneText: 'Los muertos están más tranquilos con los huesos sellados.' },
  { id: 'heart_of_stone', npc: 'nira', name: 'Corazón de Piedra', minLevel: 19, xp: 20000, adena: 35000,
    objective: { type: 'collect', item: 'stone_fragment', count: 6 },
    story: 'Los gólems de piedra van soltando pedazos de la cantera de la que los tallaron. Esos fragmentos todavía se acuerdan de la montaña, y la picapedrera los quiere de vuelta.',
    offer: 'Los gólems de piedra sueltan los fragmentos que necesito. Traeme 6.',
    busy: 'Seis fragmentos de piedra, de los gólems. Otra cosa no me sirve.',
    ready: 'Fríos, pesados, perfectos. Tomá tu paga.',
    doneText: 'El corazón de la cantera es mío. Te debo una.' },
  { id: 'elder_pack', npc: 'kael', name: 'La Manada Anciana', minLevel: 3, xp: 600, adena: 500,
    objective: { type: 'kill', mob: 'elder_keltir', count: 10 },
    story: 'Los keltirs ancianos no cazan solos. Cuando ellos se mueven, se mueve cada manada de las Praderas Ventosas.',
    offer: 'Los keltirs ancianos guían a la manada. Matá 10.',
    busy: 'Los ancianos siguen dando vueltas. Diez.',
    ready: 'Sin ellos la manada se desarma. Bien hecho.',
    doneText: 'Las praderas están más seguras. Igual andá con cuidado.' },
  { id: 'brute_force', npc: 'grit', name: 'Fuerza Bruta', minLevel: 8, xp: 4000, adena: 4000,
    objective: { type: 'kill', mob: 'goblin_brute', count: 8 },
    story: 'Los exploradores son puro ruido. Los brutos controlan el corazón de las Colinas Goblin, y por ahí no pasa nadie sin pagar.',
    offer: 'Los brutos tienen el centro de estas colinas. Matá 8.',
    busy: 'Ocho brutos. Pegan más fuerte que los exploradores.',
    ready: 'Con eso les rompiste la línea. Tomá.',
    doneText: 'Las colinas te deben una. No esperes que te lo agradezcan.' },
  { id: 'captains_head', npc: 'rusk', name: 'La Cabeza del Capitán', minLevel: 14, xp: 18000, adena: 15000,
    objective: { type: 'kill', mob: 'orc_captain', count: 3 },
    story: 'El capitán orco muere y el cuartel lo vuelve a levantar. El trato son tres caídas; después de eso, la voz que da las órdenes tiene que ser otra.',
    offer: 'Su capitán se levanta una y otra vez. Tiralo 3 veces.',
    busy: 'Tres veces. Va a volver: esperalo.',
    ready: 'Tres caídas. El cuartel va a tener que buscarse otra voz.',
    doneText: 'Si se levanta una cuarta vez, que se arregle otro.' },
  { id: 'seal_vanul', npc: 'mael', name: 'Sellar al Vanul', minLevel: 18, xp: 50000, adena: 40000,
    objective: { type: 'kill', mob: 'kaim_vanul', count: 1 },
    story: 'Kaim Vanul es la razón por la que el páramo sigue maldito. El sello de la hermana solo aguanta si él cae, y ella no lo va a pedir dos veces.',
    offer: 'Kaim Vanul tiene que caer. Con una muerte alcanza, si es la de él.',
    busy: 'El Vanul sigue en pie. No lo enfrentes solo si podés evitarlo.',
    ready: 'El sello aguanta. Tomá esto, y salí del páramo mientras puedas.',
    doneText: 'Va a volver arrastrándose. Hoy no.' },
  { id: 'drowned_crew', npc: 'tobias', name: 'La Tripulación Ahogada', minLevel: 20, xp: 30000, adena: 45000,
    objective: { type: 'kill', mob: 'drowned_sailor', count: 12 },
    story: 'El faro de la Costa Abandonada sigue prendido, pero los barcos que guiaba ya se hundieron. Sus marineros vuelven con cada marea.',
    offer: 'Los marineros ahogados no me dejan llegar al faro. Mandá 12 de vuelta al fondo.',
    busy: 'Siguen saliendo del agua. Doce marineros.',
    ready: 'Esta noche la luz va a alumbrar una playa vacía. Gracias.',
    doneText: 'La marea está tranquila. Va a durar poco.' },
  { id: 'sunken_relics', npc: 'ysolde', name: 'Reliquias Hundidas', minLevel: 25, xp: 50000, adena: 70000,
    objective: { type: 'collect', item: 'ruin_relic', count: 10 },
    story: 'Bajo las Ruinas Hundidas duerme una ciudad entera. Lo que la habita ahora guarda sus reliquias sin saber qué son.',
    offer: 'Todo lo que vive en las ruinas lleva reliquias encima. Traeme 10.',
    busy: 'Diez reliquias. Cuidado con lo que acecha bajo el agua.',
    ready: 'Intactas. Esto reescribe media historia de la frontera.',
    doneText: 'Tengo para años de estudio. Te debo una.' },
  { id: 'steppe_raiders', npc: 'korgan', name: 'Saqueadores de las Estepas', minLevel: 30, xp: 75000, adena: 100000,
    objective: { type: 'kill', mob: 'steppe_raider', count: 12 },
    story: 'Las Estepas Ardientes no dan nada, así que sus clanes viven de lo que le sacan al resto. Cada caravana que cruza paga con sangre.',
    offer: 'Los saqueadores cortan todos los caminos. Bajá 12.',
    busy: 'Doce saqueadores. Atacan en grupo, no te confíes.',
    ready: 'Los caminos respiran. Tomá tu parte.',
    doneText: 'Por un tiempo las caravanas van a pasar.' },
  { id: 'citadel_champions', npc: 'brenna', name: 'Campeones de la Ciudadela', minLevel: 35, xp: 110000, adena: 140000,
    objective: { type: 'kill', mob: 'citadel_champion', count: 4 },
    story: 'La Ciudadela Orca aguantó tres asedios. No por sus murallas: por los campeones que salen a romper cada línea que se le acerca.',
    offer: 'Mientras sus campeones sigan en pie no hay asedio que valga. Tirá 4.',
    busy: 'Cuatro campeones. Cada uno vale por diez guardias.',
    ready: 'Sin ellos la muralla es solo piedra. Bien peleado.',
    doneText: 'El asedio avanza. Te lo debemos.' },
  { id: 'drake_scales', npc: 'aldric', name: 'Escamas de Draco', minLevel: 40, xp: 150000, adena: 190000,
    objective: { type: 'collect', item: 'drake_scale', count: 12 },
    story: 'En el Valle del Dragón las crías aprenden a cazar antes que a volar. Sus escamas son lo único que frena el fuego de sus mayores.',
    offer: 'Necesito 12 escamas de draco para forjar algo que aguante el fuego.',
    busy: 'Doce escamas. Crías, guivernos, dracos ancianos: todas sirven.',
    ready: 'Calientes todavía. Con esto alcanza.',
    doneText: 'Lo que viene después de este valle es peor. Andá preparado.' },
  { id: 'ancient_drakes', npc: 'sibila', name: 'Dracos Ancestrales', minLevel: 45, xp: 200000, adena: 250000,
    objective: { type: 'kill', mob: 'ancient_drake', count: 8 },
    story: 'Los dracos ancestrales cuidan el Nido desde antes de que la frontera tuviera nombre. Mientras vivan, lo que duerme adentro no tiene apuro.',
    offer: 'Los dracos ancestrales son la última guardia del nido. Matá 8.',
    busy: 'Ocho ancestrales. No son crías: no vayas solo.',
    ready: 'El nido quedó sin guardia. Ahora sí te va a escuchar.',
    doneText: 'Lo que duerme ahí adentro ya sabe tu nombre.' },
];

export const QUEST_LIST: QuestDef[] = list;
export const QUESTS: Record<string, QuestDef> = Object.fromEntries(list.map((q) => [q.id, q]));
export const QUEST_BY_NPC: Record<string, QuestDef> = Object.fromEntries(list.map((q) => [q.npc, q]));
