import { ITEMS } from './items';
import { MOBS } from './mobs';

export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';

export interface QuestDef {
  id: string;
  npc: string;
  name: string;
  minLevel: number;
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
  if (o.type === 'kill') return `Kill ${o.count} ${MOBS[o.mob].name}`;
  return `Bring ${o.count} ${ITEMS[o.item].name}`;
}

export function questLine(q: QuestDef, status: QuestStatus): string {
  if (status === 'locked') return `Come back when you reach level ${q.minLevel}.`;
  if (status === 'available') return q.offer;
  if (status === 'active') return q.busy;
  if (status === 'ready') return q.ready;
  return q.doneText;
}

const list: QuestDef[] = [
  { id: 'pest_control', npc: 'mira', name: 'Pest Control', minLevel: 1, xp: 120, adena: 200,
    objective: { type: 'kill', mob: 'keltir', count: 8 },
    offer: 'Cull 8 keltirs on the south road and I will pay you.',
    busy: 'The meadow is still noisy. Keep hunting keltirs.',
    ready: 'That should quiet the road. Here is your pay.',
    doneText: 'The south road has been calm. Thank you.' },
  { id: 'wolf_pelts', npc: 'bram', name: 'Wolf Pelts', minLevel: 4, xp: 800, adena: 800,
    objective: { type: 'collect', item: 'wolf_pelt', count: 5 },
    offer: 'Young wolves are thick past the palisade. Bring me 5 wolf pelts.',
    busy: 'I still need those pelts. The young wolves carry them.',
    ready: 'Good hides. I will take them off your hands.',
    doneText: 'These will make fine cloaks. Come back if you find more work.' },
  { id: 'goblin_ears', npc: 'sella', name: 'Goblin Ears', minLevel: 7, xp: 2500, adena: 2500,
    objective: { type: 'collect', item: 'goblin_ear', count: 8 },
    offer: 'Scouts and brutes in the hills both keep their ears. Bring me 8.',
    busy: 'Eight ears. Scouts and brutes, either will do.',
    ready: 'That is a proper tally. Hand them over.',
    doneText: 'The hills will think twice. Well hunted.' },
  { id: 'hill_lizards', npc: 'dorian', name: 'Hill Lizards', minLevel: 10, xp: 5500, adena: 6000,
    objective: { type: 'kill', mob: 'hill_lizard', count: 10 },
    offer: 'Hill lizards are eating anything that strays. Kill 10 of them.',
    busy: 'The lizards are still on the slopes. Ten, no less.',
    ready: 'The slopes are quieter. You have earned this.',
    doneText: 'The goats are safe, for now.' },
  { id: 'orc_tusks', npc: 'vessa', name: 'Orc Tusks', minLevel: 13, xp: 9000, adena: 12000,
    objective: { type: 'collect', item: 'orc_tusk', count: 10 },
    offer: 'Bring me 10 orc tusks from the barracks. Warriors, archers, shamans — any of them.',
    busy: 'I need 10 tusks before I can pay you.',
    ready: 'A full string of tusks. The quartermaster is pleased.',
    doneText: 'The barracks will feel that loss.' },
  { id: 'cursed_bones', npc: 'harun', name: 'Cursed Bones', minLevel: 16, xp: 14000, adena: 20000,
    objective: { type: 'collect', item: 'cursed_bone', count: 8 },
    offer: 'Skeleton soldiers and rotting zombies litter the wastes. Bring me 8 cursed bones.',
    busy: 'Eight cursed bones. Do not keep them in your pack longer than you must.',
    ready: 'I will bury these properly. Your coin is ready.',
    doneText: 'The dead stay quieter when their bones are sealed.' },
  { id: 'heart_of_stone', npc: 'nira', name: 'Heart of Stone', minLevel: 19, xp: 20000, adena: 35000,
    objective: { type: 'collect', item: 'stone_fragment', count: 6 },
    offer: 'Stone golems shed the fragments I need. Bring me 6.',
    busy: 'Six stone fragments, from the golems. Nothing else will do.',
    ready: 'Cold, heavy, perfect. Take your pay.',
    doneText: 'The quarry heart is mine. You have my thanks.' },
  { id: 'elder_pack', npc: 'kael', name: 'The Elder Pack', minLevel: 3, xp: 600, adena: 500,
    objective: { type: 'kill', mob: 'elder_keltir', count: 10 },
    offer: 'The elder keltirs lead the pack. Kill 10 of them.',
    busy: 'The elders are still out there. Ten.',
    ready: 'The pack will scatter without them. Well done.',
    doneText: 'The meadows are safer. Stay sharp anyway.' },
  { id: 'brute_force', npc: 'grit', name: 'Brute Force', minLevel: 8, xp: 4000, adena: 4000,
    objective: { type: 'kill', mob: 'goblin_brute', count: 8 },
    offer: 'The brutes hold the middle of these hills. Kill 8.',
    busy: 'Eight brutes. They hit harder than the scouts.',
    ready: 'That broke their line. Here.',
    doneText: 'The hills owe you. Do not expect them to say so.' },
  { id: 'captains_head', npc: 'rusk', name: "The Captain's Head", minLevel: 14, xp: 18000, adena: 15000,
    objective: { type: 'kill', mob: 'orc_captain', count: 3 },
    offer: 'Their captain keeps getting back up. Put him down 3 times.',
    busy: 'Three times. He will return — wait for him.',
    ready: 'Three falls. The barracks will be looking for a new voice.',
    doneText: 'If he rises a fourth time, he is someone else\'s problem.' },
  { id: 'seal_vanul', npc: 'mael', name: 'Seal the Vanul', minLevel: 18, xp: 50000, adena: 40000,
    objective: { type: 'kill', mob: 'kaim_vanul', count: 1 },
    offer: 'Kaim Vanul must fall. One death is enough, if it is his.',
    busy: 'The Vanul still stands. Do not face him alone unless you must.',
    ready: 'The seal holds. Take this, and leave the wastes while you can.',
    doneText: 'He will claw his way back. Not today.' },
];

export const QUEST_LIST: QuestDef[] = list;
export const QUESTS: Record<string, QuestDef> = Object.fromEntries(list.map((q) => [q.id, q]));
export const QUEST_BY_NPC: Record<string, QuestDef> = Object.fromEntries(list.map((q) => [q.npc, q]));
