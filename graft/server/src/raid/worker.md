# server/src/raid/worker.ts

- post · function · L17-L17 — post = (m: FromWorker)
- RelaySession · class · L19-L35 — class RelaySession implements Session
- constructor · method · L22-L22 — constructor(public sid: number, public lang: Lang)
- send · method · L23-L25 — send(msg: S2C)
- sendRaw · method · L26-L28 — sendRaw(json: string)
- sendBinary · method · L29-L31 — sendBinary(data: Uint8Array)
- congested · method · L32-L34 — congested()
- exitPoint · function · L42-L42 — exitPoint = ()
- drop · function · L44-L61 — function drop(p: Player, reason: 'left' | 'closed')
