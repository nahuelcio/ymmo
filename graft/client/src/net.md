# client/src/net.ts

- Handler · type · L5-L5 — type Handler = (m: S2C) => void;
- Net · class · L7-L57 — class Net
- connect · method · L14-L45 — connect(): Promise<void>
- send · method · L47-L49 — send(m: C2S)
- on · method · L51-L56 — on<T extends S2C['t']>(type: T | '*', h: (m: Extract<S2C, { t: T }>) => void): () => void
