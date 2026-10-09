# shared/src/data/quests.ts

- QuestStatus · type · L4-L4 — type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done';
- QuestDef · interface · L6-L19 — interface QuestDef
- questSummary · function · L21-L25 — function questSummary(q: QuestDef): string
- QuestMarker · type · L30-L30 — type QuestMarker = 'available' | 'soon' | 'ready' | 'active' | null;
- questMarker · function · L33-L38 — function questMarker(q: QuestDef, level: number, active: { progress: number } | undefined, done: boolean): QuestMarker
- questMobs · function · L41-L45 — function questMobs(q: QuestDef): string[]
- questLine · function · L47-L53 — function questLine(q: QuestDef, status: QuestStatus): string
