// Load test: N bots log in, form parties and go into the raid (or wander the overworld),
// attacking the boss and dodging. Reports how fast the server answers while under load.
//
//   npm run loadtest -- --url ws://localhost:3001/ws --bots 20 --raid 9 --secs 60
//
// --raid n   group the bots in parties of n and send each party into its own raid instance
//            (0 = stay in the overworld and run around)
import WebSocket from 'ws';
import { decodeEvent, decodeSnap, encodeC2S } from '../../shared/src/binary';
import type { C2S } from '../../shared/src/protocol';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const URL = arg('url', 'ws://localhost:3001/ws');
const BOTS = +arg('bots', '20');
const RAID = +arg('raid', '9');
const SECS = +arg('secs', '60');
const tag = Math.random().toString(36).slice(2, 6);

const lat: number[] = [];
const stats = { entered: 0, inRaid: 0, deaths: 0, hits: 0, errors: 0 };

interface Bot {
  i: number;
  ws: WebSocket;
  name: string;
  meId: number;
  x: number;
  z: number;
  boss: number | null;
  inRaid: boolean;
  send(m: object): void;
}
const bots: Bot[] = [];

function startBot(i: number) {
  const ws = new WebSocket(URL);
  const user = `lt${tag}${i}`;
  const bot: Bot = { i, ws, name: `Lt${tag}${i}`, meId: 0, x: 0, z: 0, boss: null, inRaid: false, send: (m) => ws.readyState === ws.OPEN && ws.send(encodeC2S(m as C2S) ?? JSON.stringify(m)) };
  bots.push(bot);
  let pingAt = 0;
  const leader = RAID > 0 && i % RAID === 0;
  ws.on('open', () => bot.send({ t: 'login', user, pass: 'loadtest', register: true }));
  ws.on('error', () => stats.errors++);
  ws.on('message', (d, bin) => {
    if (bin) {
      const ab = d as Buffer;
      const buf = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength) as ArrayBuffer;
      const ev = decodeEvent(buf); // combat events (atk / dmg / fx) are binary too
      if (ev?.t === 'dmg' && ev.s === bot.meId) stats.hits++;
      if (ev) return;
      const snap = decodeSnap(buf);
      const me = snap?.upd.find((u) => u[0] === bot.meId);
      if (me) [bot.x, bot.z] = [me[1], me[2]];
      return;
    }
    const m = JSON.parse(String(d));
    switch (m.t) {
      case 'chars':
        if (!m.list.length) bot.send({ t: 'createChar', name: bot.name, race: 'human', cls: i % 3 === 2 ? 'mystic' : 'fighter', look: { g: 'm', hs: 0, hc: 0 } });
        else bot.send({ t: 'enter', id: m.list[0].id });
        break;
      case 'enter':
        bot.meId = m.self.id;
        stats.entered++;
        if (leader) setTimeout(() => {
          for (let j = i + 1; j < Math.min(BOTS, i + RAID); j++) bot.send({ t: 'partyInvite', name: `Lt${tag}${j}` });
        }, 4000 + Math.random() * 1000);
        if (leader) setTimeout(() => bot.send({ t: 'chat', text: '/raid' }), 9000);
        break;
      case 'world':
        bot.meId = m.self.id;
        bot.inRaid = !bot.inRaid;
        if (bot.inRaid) stats.inRaid++;
        bot.boss = null;
        break;
      case 'partyInvite':
        bot.send({ t: 'partyRespond', accept: true });
        break;
      case 'snap':
        for (const a of m.add) {
          if (a.id === bot.meId) [bot.x, bot.z] = [a.x, a.z];
          if (a.k === 'm' && a.tpl === 'kaim_ascended') bot.boss = a.id;
        }
        break;
      case 'dmg':
        if (m.s === bot.meId) stats.hits++;
        break;
      case 'died':
        if (m.id === bot.meId) {
          stats.deaths++;
          setTimeout(() => bot.send({ t: 'respawn' }), 1500);
        }
        break;
      case 'chat':
        if (pingAt && m.ch === 'sys' && /online|conectados/.test(m.text)) {
          lat.push(performance.now() - pingAt);
          pingAt = 0;
        }
        break;
      case 'ping':
        bot.send({ t: 'pong', s: m.s });
        break;
    }
  });
  // behaviour: fight the boss when in a raid, otherwise wander; dodge now and then; probe latency
  setInterval(() => {
    if (!bot.meId) return;
    if (bot.inRaid && bot.boss) {
      bot.send({ t: 'attack', id: bot.boss, force: false });
      if (Math.random() < 0.15) {
        const a = Math.random() * Math.PI * 2;
        bot.send({ t: 'dash', x: bot.x, z: bot.z, dx: Math.cos(a), dz: Math.sin(a) });
      }
      if (Math.random() < 0.2) bot.send({ t: 'skill', skill: i % 3 === 2 ? 'wind_strike' : 'power_strike', force: false });
    } else if (!bot.inRaid) {
      const a = Math.random() * Math.PI * 2;
      bot.send({ t: 'move', x: bot.x + Math.cos(a) * 25, z: bot.z + Math.sin(a) * 25 });
    }
  }, 1000 + Math.random() * 400);
  setInterval(() => {
    if (!bot.meId || pingAt) return;
    pingAt = performance.now();
    bot.send({ t: 'chat', text: '/who' });
  }, 2000);
}

for (let i = 0; i < BOTS; i++) setTimeout(() => startBot(i), i * 60);

const pct = (q: number) => {
  const s = [...lat].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(1) : '-';
};
const report = () =>
  console.log(`[loadtest] entered ${stats.entered}/${BOTS} · in raid ${stats.inRaid} · hits ${stats.hits} · deaths ${stats.deaths} · errors ${stats.errors} · reply p50 ${pct(0.5)} ms p95 ${pct(0.95)} ms p99 ${pct(0.99)} ms (${lat.length} samples)`);
const timer = setInterval(report, 10000);
setTimeout(() => {
  clearInterval(timer);
  report();
  for (const b of bots) b.ws.close();
  setTimeout(() => process.exit(0), 500);
}, SECS * 1000);
