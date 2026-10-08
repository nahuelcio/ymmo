# server/src/systems/quests.ts

- SavedQuest · interface · L11-L11 — interface SavedQuest
- near · function · L13-L15 — function near(a: { x: number; z: number }, b: { x: number; z: number }): number
- npcName · function · L17-L19 — function npcName(id: string): string
- questProgress · function · L21-L26 — function questProgress(p: Player, q: QuestDef): number
- savedQuests · function · L28-L32 — function savedQuests(p: Player): SavedQuest[]
- primeQuestNotices · function · L34-L39 — function primeQuestNotices(p: Player)
- sendQuests · function · L41-L51 — function sendQuests(p: Player)
- statusOf · function · L53-L59 — function statusOf(p: Player, q: QuestDef): QuestStatus
- questNpc · function · L61-L68 — function questNpc(w: World, p: Player, npcId: number): Npc | null
- openQuest · function · L70-L78 — function openQuest(w: World, p: Player, n: Npc)
- acceptQuest · function · L80-L93 — function acceptQuest(w: World, p: Player, npcId: number)
- turnInQuest · function · L95-L121 — function turnInQuest(w: World, p: Player, npcId: number): number
- creditKill · function · L123-L143 — function creditKill(w: World, mobId: string, playerIds: Iterable<number>)
- onInventoryChanged · function · L145-L159 — function onInventoryChanged(w: World, p: Player)
