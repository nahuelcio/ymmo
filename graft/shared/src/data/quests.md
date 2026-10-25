# shared/src/data/quests.ts

- QuestStatus · type · L4-L4 — type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';
- QuestDef · interface · L6-L21 — interface QuestDef
- questSummary · function · L23-L27 — function questSummary(q: QuestDef): string
- QuestMarker · type · L32-L32 — type QuestMarker = 'available' | 'soon' | 'ready' | 'active' | null;
- questMarker · function · L35-L40 — function questMarker(q: QuestDef, level: number, active: { progress: number } | undefined, done: boolean): QuestMarker
- questMobs · function · L43-L47 — function questMobs(q: QuestDef): string[]
- questLine · function · L49-L55 — function questLine(q: QuestDef, status: QuestStatus): string
