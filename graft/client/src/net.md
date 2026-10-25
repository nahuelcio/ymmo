# client/src/net.ts

- Handler · type · L5-L5 — type Handler = (m: S2C) => void;
- Net · class · L7-L60 — class Net
- connect · method · L14-L46 — connect(): Promise<void>
- open · method · L48-L48 — get open()
- send · method · L50-L52 — send(m: C2S)
- on · method · L54-L59 — on<T extends S2C['t']>(type: T | '*', h: (m: Extract<S2C, { t: T }>) => void): () => void
