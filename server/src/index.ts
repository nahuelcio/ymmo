import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { RACES, sanitizeLook, type ClassType, type Race } from '../../shared/src/data/classes';
import { MAX_LEVEL } from '../../shared/src/data/classes';
import type { C2S, S2C } from '../../shared/src/protocol';
import * as db from './db';
import { isLang, tr, type Lang } from '../../shared/src/i18n';

/** db.ts answers in Spanish; English versions of its messages. */
const DB_EN: Record<string, string> = {
  'Ese nombre de cuenta ya está en uso.': 'That account name is taken.',
  'Cuenta o contraseña incorrecta.': 'Wrong account name or password.',
  'Ese nombre ya está en uso.': 'That name is already taken.',
  'Podés tener como máximo 7 personajes.': 'You can have at most 7 characters.',
};
const dbMsg = (s: { lang: Lang }, msg: string) => (s.lang === 'en' ? DB_EN[msg] ?? msg : msg);
import { Player, type Session as ISession } from './world/entities';
import { World } from './world/World';
import { autosave, loadPlayer, savePlayer } from './realm';
import { RAIDS } from '../../shared/src/data/raids';
import { instances, RaidInstance, type RaidClient } from './raid/manager';

const PORT = Number(process.env.GAME_PORT ?? 3001);
const DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

const world = new World();
world.start();

const sessions = new Set<Session>();

let nextSid = 1;

class Session implements ISession, RaidClient {
  readonly sid = nextSid++;
  /** raid instance this socket is playing in (its traffic goes to that worker) */
  instance: RaidInstance | null = null;
  instanceChar = 0;
  accountId = 0;
  lang: Lang = 'es';
  player: Player | null = null;
  msgCount = 0;
  loggingIn = false;
  constructor(public ws: WebSocket) {}
  send(msg: S2C) {
    this.sendRaw(JSON.stringify(msg));
  }
  sendRaw(json: string) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(json);
  }
  sendBinary(data: Uint8Array) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(data, { binary: true });
  }
  congested() {
    return this.ws.bufferedAmount > 256 * 1024;
  }
}

function leaveWorld(s: Session) {
  const p = s.player;
  if (!p) return;
  if (p.dead) {
    const pt = world.townPoint();
    p.x = pt.x;
    p.z = pt.z;
    p.hp = p.stats.maxHp * 0.7;
  }
  try {
    savePlayer(p);
  } catch (e) {
    console.error('save failed', e);
  }
  world.removePlayer(p);
  s.player = null;
}

function enterWorld(s: Session, charId: number, kind: 'enter' | 'world' = 'enter') {
  for (const o of sessions) {
    if (o === s) continue;
    if (o.player?.charId === charId) {
      leaveWorld(o);
      o.ws.close();
    } else if (o.instance && o.instanceChar === charId) {
      // still inside a raid on another connection: kick it, its save lands in a moment
      o.ws.close();
      return s.send({ t: 'error', msg: tr(s.lang, 'Tu personaje está saliendo de una raid, probá de nuevo en unos segundos.', 'Your character is leaving a raid, try again in a few seconds.') });
    }
  }
  const p = loadPlayer(world, s, charId, kind);
  if (!p) return s.send({ t: 'error', msg: tr(s.lang, 'No se encontró el personaje.', 'Character not found.') });
  if (kind === 'enter') {
    world.sys(p, `¡${p.look.g === 'f' ? 'Bienvenida' : 'Bienvenido'} a Claudi MMO, ${p.name}! Escribí /help para ver los comandos del chat.`, `Welcome to Claudi MMO, ${p.name}! Type /help for chat commands.`);
    console.log(`[world] ${p.name} entered (${world.players.size} online)`);
  }
}

/** /raid in the overworld: take the caller (and their whole party) into a fresh raid instance. */
function enterRaid(p: Player) {
  const raid = RAIDS.kaim;
  if (p.dead) return;
  const party = p.party;
  if (party && party.members[0] !== p) return world.sys(p, 'Solo el líder de la party puede entrar a la raid.', 'Only the party leader can start the raid.');
  const group = party ? [...party.members] : [p];
  if (group.length > raid.maxPlayers) return world.sys(p, `La raid admite hasta ${raid.maxPlayers} jugadores.`, `The raid allows up to ${raid.maxPlayers} players.`);
  const low = group.filter((m) => m.level < raid.minLevel);
  if (low.length) return world.sys(p, `Nivel mínimo ${raid.minLevel}: ${low.map((m) => m.name).join(', ')}.`, `Minimum level ${raid.minLevel}: ${low.map((m) => m.name).join(', ')}.`);
  const inst = new RaidInstance(raid, group.length, { back: (c, charId) => enterWorld(c as Session, charId, 'world') });
  if (party) {
    // the party moves as a whole: it is re-formed inside the instance
    world.parties.delete(party);
    for (const m of group) m.party = null;
  }
  for (const m of group) {
    const s = m.session as Session;
    if (m !== p) world.sys(m, `${p.name} los lleva a ${raid.name}...`, `${p.name} is taking the party to ${raid.nameEn}...`);
    leaveWorld(s);
    inst.join(s, m.charId);
  }
}
world.host = { raidCommand: enterRaid, exitToTown: () => {} };

const NAME_RE = /^[A-Za-z][A-Za-z0-9]{2,15}$/;

function handle(s: Session, m: C2S) {
  if (m.t === 'lang') {
    if (isLang(m.lang)) s.lang = m.lang;
    s.instance?.lang(s);
    return;
  }
  if (s.instance) return s.instance.msg(s, m);
  if (s.player) return world.handle(s.player, m);
  switch (m.t) {
    case 'login': {
      const user = String(m.user ?? '').trim(), pass = String(m.pass ?? '');
      if (!/^[A-Za-z0-9_]{3,16}$/.test(user)) return s.send({ t: 'error', msg: tr(s.lang, 'Cuenta: de 3 a 16 letras, números o _.', 'Account: 3-16 letters, numbers or _.') });
      if (pass.length < 4 || pass.length > 64) return s.send({ t: 'error', msg: tr(s.lang, 'Contraseña: de 4 a 64 caracteres.', 'Password: 4-64 characters.') });
      if (s.loggingIn) return;
      s.loggingIn = true;
      void db.login(user, pass, !!m.register).then((r) => {
        s.loggingIn = false;
        if (s.ws.readyState !== s.ws.OPEN) return;
        if (typeof r === 'string') return s.send({ t: 'error', msg: dbMsg(s, r) });
        s.accountId = r;
        s.send({ t: 'chars', list: db.listChars(r), token: m.remember ? db.createSession(r) : undefined });
      }, (e) => {
        s.loggingIn = false;
        console.error('login failed', e);
      });
      return;
    }
    case 'resume': {
      const id = db.resumeSession(m.token);
      if (!id) return s.send({ t: 'resumeFail' });
      s.accountId = id;
      return s.send({ t: 'chars', list: db.listChars(id) });
    }
    case 'logout':
      db.deleteSession(m.token);
      s.accountId = 0;
      return;
    case 'createChar': {
      if (!s.accountId) return;
      const name = String(m.name ?? '').trim();
      if (!NAME_RE.test(name)) return s.send({ t: 'error', msg: tr(s.lang, 'Nombre: de 3 a 16 letras o números, empezando con una letra.', 'Name: 3-16 letters/numbers, starting with a letter.') });
      const race = m.race as Race, cls = m.cls as ClassType;
      if (!RACES[race] || !RACES[race].classes.includes(cls)) return s.send({ t: 'error', msg: tr(s.lang, 'Esa combinación de raza y clase no existe.', 'Invalid race/class combination.') });
      const err = db.createChar(s.accountId, name, race, cls, sanitizeLook(m.look));
      if (err) return s.send({ t: 'error', msg: dbMsg(s, err) });
      return s.send({ t: 'chars', list: db.listChars(s.accountId) });
    }
    case 'deleteChar': {
      if (!s.accountId) return;
      db.deleteChar(s.accountId, Number(m.id));
      return s.send({ t: 'chars', list: db.listChars(s.accountId) });
    }
    case 'enter':
      if (!s.accountId) return;
      return enterWorld(s, Number(m.id));
  }
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(DIST, url));
  if (!file.startsWith(normalize(DIST))) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Client not built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

// Snapshots are repetitive JSON: deflate shrinks them ~4-6x for a little CPU (level 1, small window).
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 16 * 1024,
  perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 1, memLevel: 7 }, serverMaxWindowBits: 12, concurrencyLimit: 8 },
});
wss.on('connection', (ws) => {
  const s = new Session(ws);
  sessions.add(s);
  ws.on('message', (data) => {
    if (++s.msgCount > 80) return; // simple flood protection (per second)
    let m: C2S;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    try {
      handle(s, m);
    } catch (e) {
      console.error('handler error', m.t, e);
    }
  });
  ws.on('close', () => {
    s.instance?.quit(s);
    leaveWorld(s);
    sessions.delete(s);
  });
});

setInterval(() => {
  for (const s of sessions) s.msgCount = 0;
}, 1000);

// staggered autosave: a few players per second, each one about once a minute
setInterval(() => autosave(world, Date.now()), 1000);

// health line: smoothed tick time and event-loop lag (so a slow server shows up in journalctl)
const loopLag = monitorEventLoopDelay({ resolution: 10 });
loopLag.enable();
setInterval(() => {
  const p99 = loopLag.percentile(99) / 1e6;
  if (process.env.PERF_LOG || world.tickCost > 10 || p99 > 60)
    console.warn(`[perf] tick ${world.tickCost.toFixed(1)} ms · loop lag p99 ${p99.toFixed(0)} ms · ${sessions.size} conns · ${instances.size} raids${[...instances].map((i) => ` [${i.clients.size}p ${i.tickCost.toFixed(1)}ms]`).join('')}`);
  loopLag.reset();
}, process.env.PERF_LOG ? 5000 : 30000);

function shutdown() {
  for (const s of sessions) {
    s.instance?.quit(s);
    leaveWorld(s);
  }
  // give raid workers a moment to save their players
  setTimeout(() => process.exit(0), instances.size ? 800 : 0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`[server] Claudi MMO listening on http://localhost:${PORT} (ws: /ws)`));
