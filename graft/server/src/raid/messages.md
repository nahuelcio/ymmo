# server/src/raid/messages.ts

- ToWorker · type · L5-L10 — type ToWorker = | { k: 'join'; sid: number; accountId: number; charId: number; lang: Lang } | { k: 'msg'; sid: number; m: C2S } /** the socket closed: save and drop the player */ | { k: 'quit'; sid: number } | { k: 'lang'; sid: number; lang: Lang };
- FromWorker · type · L12-L23 — type FromWorker = /** a JSON message for the client, already serialized */ | { k: 'out'; sid: number; j: string } | { k: 'bin'; sid: number; b: Uint8Array } /** player saved and gone back to the overworld */ | { k: 'left'; sid: number } /** player saved after a quit */ | { k: 'closed'; sid: number } | { k: 'joinFail'; sid: number } /** nobody left inside: the instance can be terminated */ | { k: 'empty' } | { k: 'perf'; tick: number; players: number };
- RaidWorkerData · interface · L25-L28 — interface RaidWorkerData
