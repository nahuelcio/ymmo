// One raid instance: its own World (arena + boss) on its own thread, so a 9-player boss fight
// never competes with the overworld's game loop. Players arrive from / leave to the main thread
// through the database (save there, load here) and their socket traffic is relayed by postMessage.
import { parentPort, workerData } from 'node:worker_threads';
import { RAIDS } from '../../../shared/src/data/raids';
import type { S2C } from '../../../shared/src/protocol';
import type { Lang } from '../../../shared/src/i18n';
import { World } from '../world/World';
import type { Player, Session } from '../world/entities';
import * as party from '../systems/party';
import { autosave, loadPlayer, savePlayer } from '../realm';
import type { FromWorker, RaidWorkerData, ToWorker } from './messages';

const port = parentPort!;
const { raidId, size } = workerData as RaidWorkerData;
const raid = RAIDS[raidId];
const post = (m: FromWorker) => port.postMessage(m);

class RelaySession implements Session {
  accountId = 0;
  player: Player | null = null;
  constructor(public sid: number, public lang: Lang) {}
  send(msg: S2C) {
    post({ k: 'out', sid: this.sid, j: JSON.stringify(msg) });
  }
  sendRaw(json: string) {
    post({ k: 'out', sid: this.sid, j: json });
  }
  sendBinary(data: Uint8Array) {
    post({ k: 'bin', sid: this.sid, b: data });
  }
  congested() {
    return false; // the main thread drops frames for slow sockets itself
  }
}

const world = new World({ raid, raidSize: size });
const sessions = new Map<number, RelaySession>();
let everJoined = false;

/** Where a character is saved when it leaves the instance: the village (never the arena's coordinates). */
const exitPoint = () => world.townPoint();

function drop(p: Player, reason: 'left' | 'closed') {
  const s = p.session as RelaySession;
  if (p.dead) {
    p.dead = false;
    p.hp = p.stats.maxHp * 0.7;
  }
  try {
    savePlayer(p, exitPoint());
  } catch (e) {
    console.error('[raid] save failed', e);
  }
  party.leave(world, p, true);
  world.removePlayer(p);
  sessions.delete(s.sid);
  s.player = null;
  post({ k: reason, sid: s.sid });
  if (!sessions.size) post({ k: 'empty' });
}

world.host = {
  raidCommand: (p) => drop(p, 'left'),
  exitToTown: (p) => drop(p, 'left'),
};

port.on('message', (m: ToWorker) => {
  switch (m.k) {
    case 'join': {
      const s = new RelaySession(m.sid, m.lang);
      s.accountId = m.accountId;
      const a = Math.random() * Math.PI * 2;
      const p = loadPlayer(world, s, m.charId, 'world', { x: raid.entry.x + Math.cos(a) * 3, z: raid.entry.z + Math.sin(a) * 3 });
      if (!p) {
        post({ k: 'joinFail', sid: m.sid });
        return;
      }
      everJoined = true;
      sessions.set(m.sid, s);
      p.ry = Math.atan2(raid.x - p.x, raid.z - p.z);
      party.joinGroup(world, p);
      world.sys(p, `Entraste a ${raid.name}. Escribí /raid para salir.`, `You entered ${raid.nameEn}. Type /raid to leave.`);
      return;
    }
    case 'msg': {
      const p = sessions.get(m.sid)?.player;
      if (!p) return;
      try {
        world.handle(p, m.m);
      } catch (e) {
        console.error('[raid] handler error', e);
      }
      return;
    }
    case 'quit': {
      const p = sessions.get(m.sid)?.player;
      if (p) drop(p, 'closed');
      return;
    }
    case 'lang': {
      const s = sessions.get(m.sid);
      if (s) s.lang = m.lang;
      return;
    }
  }
});

world.start();
// keep progress (loot, xp) safe while inside, saved at the village coordinates
setInterval(() => autosave(world, Date.now(), 60000, 3, () => exitPoint()), 1000);
setInterval(() => post({ k: 'perf', tick: world.tickCost, players: sessions.size }), 5000);
// nobody showed up (all disconnected while loading)
setTimeout(() => {
  if (!everJoined) post({ k: 'empty' });
}, 20000);
