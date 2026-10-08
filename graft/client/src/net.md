# client/src/net.ts

- Handler · type · L5-L5 — type Handler = (m: S2C) => void;
- Net · class · L7-L47 — class Net
- connect · method · L12-L35 — connect(): Promise<void>
- send · method · L37-L39 — send(m: C2S)
- on · method · L41-L46 — on<T extends S2C['t']>(type: T | '*', h: (m: Extract<S2C, { t: T }>) => void): () => void
