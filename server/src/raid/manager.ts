// Main-thread side of the raid instances: spawns one worker per group and relays socket traffic.
import { Worker } from 'node:worker_threads';
import type { RaidDef } from '../../../shared/src/data/raids';
import type { C2S } from '../../../shared/src/protocol';
import type { Lang } from '../../../shared/src/i18n';
import type { FromWorker, RaidWorkerData, ToWorker } from './messages';

/** What the manager needs from a connected socket. */
export interface RaidClient {
  sid: number;
  accountId: number;
  lang: Lang;
  instance: RaidInstance | null;
  /** character inside the instance */
  instanceChar: number;
  sendRaw(json: string): void;
  sendBinary(data: Uint8Array): void;
  congested(): boolean;
}

export interface RaidEvents {
  /** the player left the raid (or failed to load): put them back in the overworld */
  back(c: RaidClient, charId: number): void;
}

let nextInstance = 1;
export const instances = new Set<RaidInstance>();

export class RaidInstance {
  readonly id = nextInstance++;
  private worker: Worker;
  readonly clients = new Map<number, RaidClient>();
  tickCost = 0;
  private dead = false;

  constructor(readonly raid: RaidDef, size: number, private ev: RaidEvents) {
    const data: RaidWorkerData = { raidId: raid.id, size };
    // boot.mjs registers tsx in the worker thread (the server runs TypeScript through tsx)
    this.worker = new Worker(new URL('./boot.mjs', import.meta.url), { workerData: data });
    this.worker.on('message', (m: FromWorker) => this.onMessage(m));
    this.worker.on('error', (e) => console.error(`[raid ${this.id}] crashed`, e));
    this.worker.on('exit', () => this.onExit());
    instances.add(this);
    console.log(`[raid ${this.id}] ${raid.id} opened for ${size}`);
  }

  join(c: RaidClient, charId: number) {
    c.instance = this;
    c.instanceChar = charId;
    this.clients.set(c.sid, c);
    this.post({ k: 'join', sid: c.sid, accountId: c.accountId, charId, lang: c.lang });
  }

  msg(c: RaidClient, m: C2S) {
    this.post({ k: 'msg', sid: c.sid, m });
  }

  quit(c: RaidClient) {
    this.post({ k: 'quit', sid: c.sid });
  }

  lang(c: RaidClient) {
    this.post({ k: 'lang', sid: c.sid, lang: c.lang });
  }

  private post(m: ToWorker) {
    if (!this.dead) this.worker.postMessage(m);
  }

  private release(sid: number, back: boolean) {
    const c = this.clients.get(sid);
    if (!c) return;
    this.clients.delete(sid);
    const charId = c.instanceChar;
    c.instance = null;
    c.instanceChar = 0;
    if (back) this.ev.back(c, charId);
  }

  private onMessage(m: FromWorker) {
    switch (m.k) {
      case 'out':
        this.clients.get(m.sid)?.sendRaw(m.j);
        return;
      case 'bin': {
        const c = this.clients.get(m.sid);
        if (c && !c.congested()) c.sendBinary(m.b);
        return;
      }
      case 'left':
      case 'joinFail':
        return this.release(m.sid, true);
      case 'closed':
        return this.release(m.sid, false);
      case 'empty':
        if (!this.clients.size) void this.worker.terminate();
        return;
      case 'perf':
        this.tickCost = m.tick;
        if (m.tick > 15) console.warn(`[raid ${this.id}] tick ${m.tick.toFixed(1)} ms with ${m.players} players`);
        return;
    }
  }

  /** Worker gone (closed or crashed): anyone still inside goes back to their last save. */
  private onExit() {
    this.dead = true;
    instances.delete(this);
    for (const sid of [...this.clients.keys()]) this.release(sid, true);
    console.log(`[raid ${this.id}] closed`);
  }
}
