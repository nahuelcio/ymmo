# server/src/index.ts

- dbMsg · function · L20-L20 — dbMsg = (s: { lang: Lang }, msg: string)
- Session · class · L41-L64 — class Session implements ISession, RaidClient
- constructor · method · L51-L51 — constructor(public ws: WebSocket)
- send · method · L52-L54 — send(msg: S2C)
- sendRaw · method · L55-L57 — sendRaw(json: string)
- sendBinary · method · L58-L60 — sendBinary(data: Uint8Array)
- congested · method · L61-L63 — congested()
- leaveWorld · function · L66-L82 — function leaveWorld(s: Session)
- enterWorld · function · L84-L102 — function enterWorld(s: Session, charId: number, kind: 'enter' | 'world' = 'enter')
- enterRaid · function · L105-L126 — function enterRaid(p: Player)
- handle · function · L131-L187 — function handle(s: Session, m: C2S)
- shutdown · function · L252-L259 — function shutdown()
