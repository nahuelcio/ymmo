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
  /** turning it in evolves the character's specialization (the third specialization, classes.ts EVOLVE_LEVEL) */
  evolve?: boolean;
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
  // Fuerte Escama (40-50), at the crossroads of the Dragon lands
  { id: 'scale_basilisks', npc: 'darian', name: 'Basiliscos en el Camino', minLevel: 41, xp: 160000, adena: 200000,
    objective: { type: 'kill', mob: 'valley_basilisk', count: 15 },
    story: 'Los basiliscos del Valle bajaron hasta el camino del este. Una caravana entera quedó hecha piedra a la vista de la muralla.',
    offer: 'Matá 15 basiliscos del Valle antes de que el camino se llene de estatuas.',
    busy: 'Quince basiliscos. No los mires a los ojos más de la cuenta.',
    ready: 'El camino del este vuelve a estar abierto. Bien hecho.',
    doneText: 'Las caravanas pasan de nuevo. Alguna hasta te va a deber el pellejo.' },
  { id: 'scale_cultists', npc: 'lysandra', name: 'El Culto del Nido', minLevel: 46, xp: 210000, adena: 260000,
    objective: { type: 'kill', mob: 'dragon_cultist', count: 12 },
    story: 'Los cultistas del Nido le cantan a lo que duerme ahí abajo, y cada noche cantan más fuerte. Si se despierta, este fuerte es lo primero que va a ver.',
    offer: 'Callá a 12 cultistas del Nido. Sin coro no hay despertar.',
    busy: 'Doce cultistas. Son más de los que parecen: siempre hay otro rezando atrás.',
    ready: 'El Nido quedó en silencio. Por ahora.',
    doneText: 'Algo allá abajo se dio vuelta en sueños. Que siga durmiendo.' },
  { id: 'scale_fangs', npc: 'gorm', name: 'Colmillos para la Forja', minLevel: 47, xp: 220000, adena: 270000,
    objective: { type: 'collect', item: 'dragon_fang', count: 10 },
    story: 'Para remachar escamas de dragón hacen falta clavos más duros que ellas. Los únicos que sirven son los colmillos de las bestias del Nido.',
    offer: 'Traeme 10 colmillos de dragón y la próxima armadura que salga de acá aguanta un mordisco.',
    busy: 'Diez colmillos. Los guardianes, las arañas y los dracos del Nido los tienen.',
    ready: 'Duros como pocas cosas. Estos sirven.',
    doneText: 'Con esto remacho escamas toda la temporada. Pasá cuando quieras.' },
  // the frost region (50-60): the Fuerte de Escarcha, the tundra and the peaks
  { id: 'frost_welcome', npc: 'ingrid', name: 'Lobos en la Nieve', minLevel: 50, xp: 220000, adena: 250000,
    objective: { type: 'kill', mob: 'frost_wolf', count: 15 },
    story: 'El Fuerte de Escarcha se levantó para cuidar el paso del norte, pero la tundra no pide permiso. Las manadas de lobos de escarcha bajan hasta la muralla cada noche, y la guardia ya no da abasto.',
    offer: 'Los lobos de escarcha rondan la muralla. Bajá 15 y hablamos de paga.',
    busy: 'Todavía se escuchan aullidos. Quince lobos, no me hagas contar dos veces.',
    ready: 'La guardia va a dormir tranquila por primera vez en semanas. Tomá.',
    doneText: 'La tundra es grande. Si seguís vivo, seguro te volvemos a necesitar.' },
  { id: 'frozen_pelts', npc: 'sven', name: 'Pieles Gélidas', minLevel: 52, xp: 280000, adena: 300000,
    objective: { type: 'collect', item: 'frost_pelt', count: 15 },
    story: 'En el norte el frío mata más que cualquier espada. Sven cose las capas de toda la guarnición, y las pieles gélidas de los lobos y los saqueadores de la tundra son las únicas que aguantan una tormenta.',
    offer: 'Traeme 15 pieles gélidas. Lobos, saqueadores, yetis: todos andan bien abrigados.',
    busy: 'Quince pieles. Con menos no llego a vestir ni a la mitad de la guardia.',
    ready: 'Gruesas y enteras. Esta guarnición pasa el invierno.',
    doneText: 'Si te agarra la tormenta, acordate de quién te abrigó.' },
  { id: 'wraith_hunt', npc: 'rurik', name: 'Espectros de la Tundra', minLevel: 53, xp: 320000, adena: 330000,
    objective: { type: 'kill', mob: 'frost_wraith', count: 12 },
    story: 'Bajo la nieve de la tundra quedaron enterradas caravanas enteras. Sus muertos no descansan: vagan como espectros gélidos y congelan todo lo que tocan.',
    offer: 'Los espectros gélidos no me dejan avanzar. Disipá 12.',
    busy: 'Doce espectros. Si te ralentizan, no te quedes quieto.',
    ready: 'Por fin puedo seguir el rastro de las caravanas. Te lo debo.',
    doneText: 'La tundra se calló un poco. Ojalá dure.' },
  { id: 'ice_crystals', npc: 'astrid', name: 'Corazón de Hielo', minLevel: 56, xp: 420000, adena: 420000,
    objective: { type: 'collect', item: 'ice_crystal', count: 14 },
    story: 'Astrid cree que el frío del norte no es natural: algo en los Picos Helados lo alimenta. Los cristales de hielo que llevan los espectros, los gólems y los dracos blancos guardan la respuesta.',
    offer: 'Necesito 14 cristales de hielo para mis estudios. Los gólems, los espectros y los dracos de los picos los llevan encima.',
    busy: 'Catorce cristales. Cuidado: no se derriten, pero queman las manos.',
    ready: 'Laten. Literalmente. Esto confirma todo lo que sospechaba.',
    doneText: 'Algo duerme en el Trono de Escarcha. Y no le gusta que lo despierten.' },
  { id: 'giant_slayer', npc: 'eira', name: 'Matagigantes', minLevel: 58, xp: 520000, adena: 500000,
    objective: { type: 'kill', mob: 'frost_giant', count: 8 },
    story: 'Los gigantes de escarcha son la guardia del Rey Gélido. Mientras sigan en pie, nadie llega vivo al Trono de Escarcha.',
    offer: 'Derribá 8 gigantes de escarcha y te muestro el camino al trono.',
    busy: 'Ocho gigantes. Cuando levanten el martillo, salí del círculo.',
    ready: 'El trono quedó sin guardia. Juntá a los tuyos y escribí /raid frost cuando estén listos.',
    doneText: 'Hrimgar te espera en su trono. Que el fuego te acompañe.' },
  // the swamp region (60-70): Juncoverde, the swamp and the jungle
  { id: 'swamp_welcome', npc: 'thalia', name: 'Colmillos en el Agua', minLevel: 60, xp: 600000, adena: 550000,
    objective: { type: 'kill', mob: 'swamp_cobra', count: 15 },
    story: 'Juncoverde vive del río y de los juncos, pero el pantano del norte se está comiendo el camino. Las cobras ya muerden a los pescadores en la orilla misma del pueblo.',
    offer: 'Las cobras del pantano no dejan pescar a nadie. Matá 15.',
    busy: 'Quince cobras. Si te muerden, tomá algo antes de seguir.',
    ready: 'Los pescadores ya volvieron a la orilla. Gracias de parte de todos.',
    doneText: 'El pantano siempre devuelve algo peor. Tené los ojos abiertos.' },
  { id: 'venom_cure', npc: 'oren', name: 'Veneno del Pantano', minLevel: 62, xp: 700000, adena: 600000,
    objective: { type: 'collect', item: 'swamp_venom', count: 15 },
    story: 'Oren prepara los antídotos de todo el pueblo, y para cortar un veneno necesita el veneno. Las criaturas del pantano lo cargan en colmillos, pinzas y aguijones.',
    offer: 'Traeme 15 dosis de veneno del pantano. Cobras, cangrejos, acechadores: todos lo llevan.',
    busy: 'Quince dosis. No lo toques con las manos, por favor.',
    ready: 'Con esto salvo a medio pueblo. Y a vos también, si algún día te pican.',
    doneText: 'Si te muerde algo raro, vení primero acá.' },
  { id: 'drowned_bog', npc: 'morla', name: 'Los Ahogados del Pantano', minLevel: 63, xp: 780000, adena: 650000,
    objective: { type: 'kill', mob: 'bog_drowned', count: 12 },
    story: 'Morla cruzaba viajeros por el pantano en su balsa hasta que el agua empezó a devolver a los que se tragó. Ahora los ahogados le cortan el paso.',
    offer: 'Los ahogados del pantano no me dejan cruzar. Hundí a 12 de vuelta.',
    busy: 'Doce ahogados. Se levantan del fango, mirá dónde pisás.',
    ready: 'El agua está quieta otra vez. Mi balsa es tuya cuando quieras.',
    doneText: 'Por ahora el pantano duerme. Por ahora.' },
  { id: 'sick_jungle', npc: 'ilwen', name: 'Corteza Ancestral', minLevel: 66, xp: 950000, adena: 750000,
    objective: { type: 'collect', item: 'ancient_bark', count: 14 },
    story: 'La Selva Antigua es más vieja que cualquier reino, y algo la está pudriendo desde adentro. Ilwen quiere estudiar la corteza de los árboles enfermos para encontrar la cura.',
    offer: 'Necesito 14 trozos de corteza ancestral. Los ents y las bestias de la selva la llevan pegada.',
    busy: 'Catorce trozos. Si la corteza se mueve, no es corteza: corré.',
    ready: 'Está podrida por dentro, como temía. Algo grande la está envenenando.',
    doneText: 'El corazón de la selva late raro. Y el templo, todavía más.' },
  { id: 'ent_purge', npc: 'zahir', name: 'La Purga de los Ents', minLevel: 68, xp: 1150000, adena: 900000,
    objective: { type: 'kill', mob: 'corrupted_ent', count: 8 },
    story: 'Los ents corrompidos custodian el camino al Templo del Pantano, donde duerme Ssithra, la Madre Serpiente. Mientras sigan de pie, nadie llega a su guarida.',
    offer: 'Talá 8 ents corrompidos y te abro el camino al templo.',
    busy: 'Ocho ents. Cuando golpeen el suelo, salí del círculo.',
    ready: 'El camino está libre. Juntá a los tuyos y escribí /raid swamp cuando estén listos.',
    doneText: 'Ssithra te espera en el templo. No mires sus ojos.' },
  // the volcanic region (70-78): Brasaoscura, the volcanic lands and the Abyss
  { id: 'ember_welcome', npc: 'varga', name: 'Sabuesos del Infierno', minLevel: 70, xp: 1000000, adena: 850000,
    objective: { type: 'kill', mob: 'hellhound', count: 15 },
    story: 'Brasaoscura es la última muralla antes del Abismo. Cada noche los sabuesos infernales salen de las grietas y prueban los portones, y la comandante Varga ya perdió la cuenta de los guardias que se llevaron.',
    offer: 'Los sabuesos infernales rondan la muralla. Bajá 15 y te pago como a un veterano.',
    busy: 'Quince sabuesos. Si te muerden, apagate antes de seguir.',
    ready: 'Esta noche los portones aguantan. Bien hecho, soldado.',
    doneText: 'Del otro lado de esas tierras está el Abismo. Ahí sí vas a necesitar suerte.' },
  { id: 'forge_cores', npc: 'brunhilda', name: 'Núcleos para la Forja', minLevel: 72, xp: 1150000, adena: 950000,
    objective: { type: 'collect', item: 'magma_core', count: 15 },
    story: 'Las armas Infernales solo se templan con fuego vivo. Brunhilda alimenta su forja con los núcleos de magma que laten dentro de los gólems y las salamandras de las Tierras Volcánicas.',
    offer: 'Traeme 15 núcleos de magma. Los gólems, las salamandras y los dracos de magma los llevan adentro.',
    busy: 'Quince núcleos. Agarralos con guantes, si los tenés.',
    ready: 'Todavía laten. Con esto mi forja arde una semana.',
    doneText: 'Cuando tengas con qué, volvé: te forjo algo que haga temblar al Abismo.' },
  { id: 'pyro_hunt', npc: 'ignis', name: 'La Secta del Fuego', minLevel: 73, xp: 1250000, adena: 1000000,
    objective: { type: 'kill', mob: 'pyromancer', count: 12 },
    story: 'Los piromantes adoran al Señor de las Llamas y le ofrecen todo lo que queman. Ignis fue uno de ellos, hasta que vio lo que su dios hacía con sus fieles.',
    offer: 'Los piromantes siguen reclutando. Callá a 12 antes de que sean más.',
    busy: 'Doce piromantes. Atacan de lejos: acercate rápido.',
    ready: 'Sus hogueras se apagan. Gracias por lo que no me animé a hacer.',
    doneText: 'El Señor de las Llamas va a notar que faltan. Ojalá venga por vos y no por mí.' },
  { id: 'abyss_rites', npc: 'nyx', name: 'Esencias del Abismo', minLevel: 75, xp: 1450000, adena: 1150000,
    objective: { type: 'collect', item: 'abyss_essence', count: 14 },
    story: 'Nyx sella las grietas por donde el Abismo se filtra al mundo. Para hacerlo necesita la misma esencia que sangran sus criaturas.',
    offer: 'Traeme 14 esencias del abismo. Caballeros, liches y tejedoras: todos las sangran.',
    busy: 'Catorce esencias. No las mires mucho: miran de vuelta.',
    ready: 'Con esto sello tres grietas. Quedan mil.',
    doneText: 'El corazón del Abismo late cada vez más fuerte. Lo escucho en sueños.' },
  { id: 'abyss_guard', npc: 'seraphel', name: 'La Guardia del Abismo', minLevel: 76, xp: 1700000, adena: 1300000,
    objective: { type: 'kill', mob: 'abyss_knight', count: 8 },
    story: 'Seraphel juró proteger el mundo de Azgaroth, el Devorador, y perdió a toda su orden en el intento. Sus caballeros caídos ahora custodian el corazón del Abismo para su nuevo amo.',
    offer: 'Liberá a 8 caballeros del abismo. Eran mis hermanos.',
    busy: 'Ocho caballeros. No les tengas piedad: ya no se acuerdan de nada.',
    ready: 'Descansan, por fin. Juntá a los tuyos y escribí /raid abyss: Azgaroth te espera.',
    doneText: 'Si caés allá abajo, no vuelvas como ellos.' },
  // the third specialization (level 76)
  { id: 'awakening', npc: 'veyra', name: 'El Despertar', minLevel: 76, xp: 2000000, adena: 1500000, evolve: true,
    objective: { type: 'collect', item: 'awakening_shard', count: 5 },
    story: 'En lo más hondo del Abismo duermen fragmentos de un poder antiguo, el mismo que despertó a los primeros héroes. Veyra sabe leerlos: con cinco, puede despertar en vos lo que tu especialización todavía no se anima a ser.',
    offer: 'Traeme 5 fragmentos del despertar. Los guardan los jefes de estas tierras: el comandante abisal, el sumo piromante, el Señor de las Llamas y Azgaroth.',
    busy: 'Cinco fragmentos. Los jefes no los sueltan fácil: llevá compañía.',
    ready: 'Laten al mismo ritmo que vos. Cerrá los ojos... y despertá.',
    doneText: 'Ya no sos el mismo que llegó a Brasaoscura. Andá a demostrarlo.' },
];

export const QUEST_LIST: QuestDef[] = list;
export const QUESTS: Record<string, QuestDef> = Object.fromEntries(list.map((q) => [q.id, q]));
export const QUEST_BY_NPC: Record<string, QuestDef> = Object.fromEntries(list.map((q) => [q.npc, q]));
