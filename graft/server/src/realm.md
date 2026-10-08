# server/src/realm.ts

- savePlayer · function · L9-L16 — function savePlayer(p: Player, at?: { x: number; z: number })
- loadPlayer · function · L22-L37 — function loadPlayer(w: World, s: Session, charId: number, kind: 'enter' | 'world', at?: { x: number; z: number }): Player | null
- autosave · function · L43-L55 — function autosave(w: World, now: number, every = 60000, perCall = 3, at?: (p: Player) => { x: number; z: number } | undefined)
