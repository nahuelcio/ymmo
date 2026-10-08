# server/src/raid/manager.ts

- RaidClient · interface · L9-L19 — interface RaidClient
- RaidEvents · interface · L21-L24 — interface RaidEvents
- RaidInstance · class · L29-L112 — class RaidInstance
- constructor · method · L36-L45 — constructor(readonly raid: RaidDef, size: number, private ev: RaidEvents)
- join · method · L47-L52 — join(c: RaidClient, charId: number)
- msg · method · L54-L56 — msg(c: RaidClient, m: C2S)
- quit · method · L58-L60 — quit(c: RaidClient)
- lang · method · L62-L64 — lang(c: RaidClient)
- post · method · L66-L68 — private post(m: ToWorker)
- release · method · L70-L78 — private release(sid: number, back: boolean)
- onMessage · method · L80-L103 — private onMessage(m: FromWorker)
- onExit · method · L106-L111 — private onExit()
