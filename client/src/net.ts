import type { C2S, S2C } from '../../shared/src/protocol';
import { decodeSnap } from '../../shared/src/binary';
import { lang } from './lang';

type Handler = (m: S2C) => void;

export class Net {
  private ws!: WebSocket;
  private handlers = new Map<string, Handler[]>();
  onClose: (() => void) | null = null;

  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (ev) => {
      let m: S2C;
      if (typeof ev.data === 'string') m = JSON.parse(ev.data) as S2C;
      else {
        const snap = decodeSnap(ev.data as ArrayBuffer);
        if (!snap) return;
        m = { t: 'snap', add: [], upd: snap.upd, gone: snap.gone };
      }
      for (const h of this.handlers.get(m.t) ?? []) h(m);
      for (const h of this.handlers.get('*') ?? []) h(m);
    };
    this.ws.onclose = () => this.onClose?.();
    return new Promise((res, rej) => {
      this.ws.onopen = () => {
        this.send({ t: 'lang', lang });
        res();
      };
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
