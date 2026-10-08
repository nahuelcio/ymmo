# server/src/db.ts

- LookCols · type · L49-L49 — type LookCols = { gender: string; hair_style: number; hair_color: number };
- lookOf · function · L50-L50 — lookOf = (r: LookCols): Look
- hashPass · function · L52-L55 — async function hashPass(pass: string): Promise<string>
- checkPass · function · L57-L62 — async function checkPass(pass: string, stored: string): Promise<boolean>
- login · function · L68-L79 — async function login(user: string, pass: string, register: boolean): Promise<number | string>
- sha · function · L83-L83 — sha = (t: string)
- createSession · function · L90-L94 — function createSession(accountId: number): string
- resumeSession · function · L97-L108 — function resumeSession(token: string): number | null
- deleteSession · function · L110-L112 — function deleteSession(token: string): void
- listChars · function · L115-L118 — function listChars(accountId: number): CharSummary[]
- createChar · function · L125-L135 — function createChar(accountId: number, name: string, race: Race, cls: ClassType, look: Look): string | null
- deleteChar · function · L140-L146 — function deleteChar(accountId: number, id: number): void
- CharRow · interface · L148-L152 — interface CharRow
- SavedQuest · interface · L154-L154 — interface SavedQuest
- loadChar · function · L159-L170 — function loadChar(accountId: number, id: number): { row: CharRow; items: Omit<InvItem, 'u'>[]; quests: SavedQuest[] } | null
- saveChar · function · L174-L187 — function saveChar(c: Omit<CharRow, 'account_id' | 'name' | 'race' | 'cls' | 'look'>, items: InvItem[], quests: SavedQuest[]): void
