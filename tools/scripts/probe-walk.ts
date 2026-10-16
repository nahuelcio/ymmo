// Live probe: log a throwaway bot into the dev server, walk it to MagoPrueba's stuck position,
// then around it. Reports every server snapshot of the bot's position.
//   npx tsx tools/scripts/probe-walk.ts
import WebSocket from 'ws';
import { decodeSnap, decodeEvent } from '../../shared/src/binary';

const URL = 'ws://localhost:3001/ws';
const DEST = { x: 231.9160713925649, z: 666.1992752593223 }; // MagoPrueba's saved spot
const user = `probe${Math.random().toString(36).slice(2, 8)}`;

const ws = new WebSocket(URL);
let meId = 0;
let x = 0, z = 0;
const log: string[] = [];
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

ws.on('open', () => send({ t: 'login', user, pass: 'probetest', register: true }));
ws.on('error', (e) => console.log('ws error', (e as Error).message));

let phase: 'spawn' | 'toDest' | 'local' = 'spawn';
const localTargets = [
  { x: DEST.x + 10, z: DEST.z },
  { x: DEST.x + 10, z: DEST.z + 10 },
  { x: DEST.x, z: DEST.z + 10 },
  { x: DEST.x - 10, z: DEST.z + 5 },
];
let li = 0;

ws.on('message', (d, bin) => {
  if (bin) {
    const ab = d as Buffer;
    const buf = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength) as ArrayBuffer;
    const snap = decodeSnap(buf);
    if (!snap) { const ev = decodeEvent(buf); if (ev && ev.t !== 'atk' && ev.t !== 'dmg') log.push(`${at()} bin event ${JSON.stringify(ev).slice(0, 120)}`); return; }
    const me = snap.upd.find((u) => u[0] === meId);
    const addMe = snap.add.find((a) => a.id === meId);
    if (addMe && !meIdWasPlaced(addMe)) {
      x = addMe.x; z = addMe.z;
      console.log(`${at()} spawn add pos=(${x.toFixed(1)}, ${z.toFixed(1)})`);
      if (phase === 'spawn') {
        phase = 'toDest';
        setTimeout(() => { console.log(`${at()} >>> move to MagoPrueba spot (${DEST.x}, ${DEST.z})`); send({ t: 'move', x: DEST.x, z: DEST.z }); }, 500);
      }
    }
    if (me) {
      const moved = Math.hypot(me[1] - x, me[2] - z);
      x = me[1]; z = me[2];
      log.push(`${at()} upd pos=(${x.toFixed(1)}, ${z.toFixed(1)}) dLast=${moved.toFixed(2)}`);
    }
    return;
  }
  const m = JSON.parse(String(d));
  switch (m.t) {
    case 'chars':
      if (!m.list.length) send({ t: 'createChar', name: 'ProbeBot', race: 'human', cls: 'fighter', look: { g: 'm', hs: 0, hc: 0 } });
      else send({ t: 'enter', id: m.list[0].id });
      break;
    case 'createChar':
    case 'charCreated': send({ t: 'chars' }); break;
    case 'enter':
      meId = m.self.id;
      console.log(`${at()} entered id=${meId} (waiting first snap for position)`);
      break;
    case 'world':
      meId = m.self.id;
      break;
    case 'sys':
      log.push(`${at()} sys: ${String(m.text).slice(0, 100)}`);
      break;
    case 'ping':
      send({ t: 'pong', s: m.s });
      break;
  }
});

// every 2s: drive the phases
const driver = setInterval(() => {
  const d = Math.hypot(DEST.x - x, DEST.z - z);
  if (phase === 'toDest' && d < 2) {
    phase = 'local'; li = 0;
    console.log(`${at()} REACHED MagoPrueba area (d=${d.toFixed(2)}). Now local moves.`);
  } else if (phase === 'local' && li < localTargets.length) {
    const t = localTargets[li++];
    console.log(`${at()} >>> local move (${t.x}, ${t.z}) from (${x.toFixed(1)}, ${z.toFixed(1)})`);
    send({ t: 'move', x: t.x, z: t.z });
  }
}, 2000);

setTimeout(() => {
  clearInterval(driver);
  console.log(`\n=== timeline (last 25) ===`);
  for (const l of log.slice(-25)) console.log(l);
  console.log(`\nfinal pos (${x.toFixed(2)}, ${z.toFixed(2)}), dist to MagoPrueba spot: ${Math.hypot(DEST.x - x, DEST.z - z).toFixed(2)}m`);
  ws.close();
  process.exit(0);
}, 40000);
