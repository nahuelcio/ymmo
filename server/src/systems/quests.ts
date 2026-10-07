import { NPCS } from '../../../shared/src/data/world';
import { QUEST_BY_NPC, QUEST_LIST, type QuestDef, type QuestStatus } from '../../../shared/src/data/quests';
import { ITEMS } from '../../../shared/src/data/items';
import { Npc, Player } from '../world/entities';
import type { World } from '../world/World';
import { countItem, takeItems } from './inventory';

const NPC_RANGE = 8;

export interface SavedQuest { id: string; progress: number; done: boolean }

function near(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function npcName(id: string): string {
  return NPCS.find((n) => n.id === id)?.name ?? 'quien te dio la misión';
}

export function questProgress(p: Player, q: QuestDef): number {
  const st = p.quests.get(q.id);
  if (!st) return 0;
  if (q.objective.type === 'kill') return st.progress;
  return countItem(p, q.objective.item);
}

export function savedQuests(p: Player): SavedQuest[] {
  const out: SavedQuest[] = [];
  for (const [id, st] of p.quests) out.push({ id, progress: st.progress, done: st.done });
  return out;
}

export function primeQuestNotices(p: Player) {
  for (const q of QUEST_LIST) {
    const st = p.quests.get(q.id);
    if (st && !st.done && questProgress(p, q) >= q.objective.count) p.questReadyTold.add(q.id);
  }
}

export function sendQuests(p: Player) {
  const list: { id: string; progress: number }[] = [];
  const done: string[] = [];
  for (const q of QUEST_LIST) {
    const st = p.quests.get(q.id);
    if (st?.done) done.push(q.id);
    if (!st || st.done) continue;
    list.push({ id: q.id, progress: questProgress(p, q) });
  }
  p.send({ t: 'quests', list, done });
}

function statusOf(p: Player, q: QuestDef): QuestStatus {
  const st = p.quests.get(q.id);
  if (st?.done) return 'done';
  if (p.level < q.minLevel) return 'locked';
  if (!st) return 'available';
  return questProgress(p, q) >= q.objective.count ? 'ready' : 'active';
}

function questNpc(w: World, p: Player, npcId: number): Npc | null {
  const n = w.ents.get(npcId);
  if (!(n instanceof Npc) || n.def.kind !== 'quest' || near(n, p) > NPC_RANGE) {
    w.sys(p, 'Estás demasiado lejos.');
    return null;
  }
  return n;
}

export function openQuest(w: World, p: Player, n: Npc) {
  const q = QUEST_BY_NPC[n.def.id];
  if (!q) return;
  p.talkingTo = n.id;
  p.send({
    t: 'npc', npc: n.id, kind: 'quest', name: n.def.name, title: n.def.title, greeting: n.def.greeting,
    quest: { id: q.id, status: statusOf(p, q), progress: questProgress(p, q) },
  });
}

export function acceptQuest(w: World, p: Player, npcId: number) {
  const n = questNpc(w, p, npcId);
  if (!n || p.dead) return;
  const q = QUEST_BY_NPC[n.def.id];
  if (!q) return;
  const st = p.quests.get(q.id);
  if (st?.done) return w.sys(p, 'Ya completaste esta misión.');
  if (st) return w.sys(p, 'Ya estás haciendo esta misión.');
  if (p.level < q.minLevel) return w.sys(p, `Necesitás ser nivel ${q.minLevel}.`);
  p.quests.set(q.id, { progress: 0, done: false });
  w.sys(p, `Aceptaste "${q.name}".`);
  sendQuests(p);
  openQuest(w, p, n);
}

export function turnInQuest(w: World, p: Player, npcId: number): number {
  const n = questNpc(w, p, npcId);
  if (!n || p.dead) return 0;
  const q = QUEST_BY_NPC[n.def.id];
  if (!q) return 0;
  const st = p.quests.get(q.id);
  if (!st || st.done) {
    w.sys(p, 'No tenés nada para entregar.');
    return 0;
  }
  if (questProgress(p, q) < q.objective.count) {
    w.sys(p, 'Todavía no terminaste esta misión.');
    return 0;
  }
  if (q.objective.type === 'collect' && !takeItems(p, q.objective.item, q.objective.count)) {
    w.sys(p, `No tenés suficiente ${ITEMS[q.objective.item].name}.`);
    return 0;
  }
  st.done = true;
  p.questReadyTold.delete(q.id);
  p.adena += q.adena;
  p.invDirty = true;
  w.sys(p, `Completaste "${q.name}" y recibiste ${q.adena.toLocaleString('es-AR')} de adena.`);
  sendQuests(p);
  openQuest(w, p, n);
  return q.xp;
}

export function creditKill(w: World, mobId: string, playerIds: Iterable<number>) {
  for (const id of playerIds) {
    const p = w.players.get(id);
    if (!p) continue;
    let changed = false;
    for (const q of QUEST_LIST) {
      if (q.objective.type !== 'kill' || q.objective.mob !== mobId) continue;
      const st = p.quests.get(q.id);
      if (!st || st.done || st.progress >= q.objective.count) continue;
      st.progress++;
      changed = true;
      if (st.progress >= q.objective.count) {
        p.questReadyTold.add(q.id);
        w.sys(p, `${q.name}: listo. Volvé con ${npcName(q.npc)}.`);
      } else {
        w.sys(p, `${q.name}: ${st.progress}/${q.objective.count}.`);
      }
    }
    if (changed) sendQuests(p);
  }
}

export function onInventoryChanged(w: World, p: Player) {
  let active = false;
  for (const q of QUEST_LIST) {
    if (q.objective.type !== 'collect') continue;
    const st = p.quests.get(q.id);
    if (!st || st.done) continue;
    active = true;
    const ready = countItem(p, q.objective.item) >= q.objective.count;
    if (ready && !p.questReadyTold.has(q.id)) {
      p.questReadyTold.add(q.id);
      w.sys(p, `${q.name}: listo. Volvé con ${npcName(q.npc)}.`);
    } else if (!ready) p.questReadyTold.delete(q.id);
  }
  if (active) sendQuests(p);
}
