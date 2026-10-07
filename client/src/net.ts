import type { C2S, S2C } from '../../shared/src/protocol';

type Handler = (m: S2C) => void;

export class Net {
  private ws!: WebSocket;
  private handlers = new Map<string, Handler[]>();
  onClose: (() => void) | null = null;

  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as S2C;
      for (const h of this.handlers.get(m.t) ?? []) h(m);
      for (const h of this.handlers.get('*') ?? []) h(m);
    };
    this.ws.onclose = () => this.onClose?.();
    return new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('Could not connect to the game server.'));
    });
  }

  send(m: C2S) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  on<T extends S2C['t']>(type: T | '*', h: (m: Extract<S2C, { t: T }>) => void): () => void {
    const list = this.handlers.get(type) ?? [];
    list.push(h as Handler);
    this.handlers.set(type, list);
    return () => this.handlers.set(type, (this.handlers.get(type) ?? []).filter((x) => x !== h));
  }
}
