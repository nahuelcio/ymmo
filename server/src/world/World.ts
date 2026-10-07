import { MOBS } from '../../../shared/src/data/mobs';
import { NPCS, randomLine, ZONES, zoneAt } from '../../../shared/src/data/world';
import { skillsFor } from '../../../shared/src/data/skills';
import { xpToNext } from '../../../shared/src/formulas';
import type { C2S, EntAdd, EntUpd, S2C, SelfState } from '../../../shared/src/protocol';
import { mulberry32, PLAYABLE_HALF, TOWN } from '../../../shared/src/terrain';
import { findPath, lineClear, pushOut } from '../../../shared/src/collision';
import { encodeSnap, qPos, qRot } from '../../../shared/src/binary';
import { Entity, GroundItem, Mob, Npc, Player, type Party } from './entities';
import { updatePlayer } from '../systems/player';
import { updateMob } from '../systems/ai';
import { canAttack, gainXp, requestSkill, respawnPlayer, setPvpMode } from '../systems/combat';
import * as inv from '../systems/inventory';
import { acceptQuest, onInventoryChanged, turnInQuest } from '../systems/quests';
import * as party from '../systems/party';
import { handleChat } from '../systems/chat';

export const AOI = 90;
const TICK_MS = 50;

class Grid {
  cells = new Map<string, Set<Entity>>();
  constructor(private size: number) {}
  key(x: number, z: number) {
    return `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
  }
  insert(e: Entity) {
    e.cell = this.key(e.x, e.z);
    let c = this.cells.get(e.cell);
    if (!c) this.cells.set(e.cell, (c = new Set()));
    c.add(e);
  }
  remove(e: Entity) {
    this.cells.get(e.cell)?.delete(e);
  }
  update(e: Entity) {
    const k = this.key(e.x, e.z);
    if (k !== e.cell) {
      this.remove(e);
      this.insert(e);
    }
  }
  query(x: number, z: number, r: number, out: Entity[]) {
    const x0 = Math.floor((x - r) / this.size), x1 = Math.floor((x + r) / this.size);
    const z0 = Math.floor((z - r) / this.size), z1 = Math.floor((z + r) / this.size);
    const r2 = r * r;
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.cells.get(`${cx},${cz}`);
        if (!c) continue;
        for (const e of c) {
          const dx = e.x - x, dz = e.z - z;
          if (!e.hidden && dx * dx + dz * dz <= r2) out.push(e);
        }
      }
    return out;
  }
}

export function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function face(e: Entity, t: { x: number; z: number }) {
  if (t.x !== e.x || t.z !== e.z) e.ry = Math.atan2(t.x - e.x, t.z - e.z);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export class World {
  ents = new Map<number, Entity>();
  players = new Map<number, Player>();
  mobs: Mob[] = [];
  parties = new Set<Party>();
  grid = new Grid(30);
  now = Date.now();
  private nextId = 1;
  private tickN = 0;

  constructor() {
    for (const def of NPCS) this.add(new Npc(this.newId(), def));
    this.spawnMobs();
  }

  newId() {
    return this.nextId++;
  }

  add(e: Entity) {
    this.ents.set(e.id, e);
    this.grid.insert(e);
    if (e instanceof Player) this.players.set(e.id, e);
  }

  remove(e: Entity) {
    this.ents.delete(e.id);
    this.grid.remove(e);
    if (e instanceof Player) this.players.delete(e.id);
  }

  setPos(e: Entity, x: number, z: number) {
    e.x = Math.max(-PLAYABLE_HALF, Math.min(PLAYABLE_HALF, x));
    e.z = Math.max(-PLAYABLE_HALF, Math.min(PLAYABLE_HALF, z));
    this.grid.update(e);
  }

  /**
   * Move e toward (tx,tz) around static obstacles. Returns true when within stopDist.
   * Straight line when clear, otherwise follows a cached A* path (refreshed as the goal moves).
   */
  stepToward(e: Entity, tx: number, tz: number, speed: number, dt: number, stopDist: number): boolean {
    const d = Math.hypot(tx - e.x, tz - e.z);
    if (d <= stopDist + 0.001) {
      e.moving = false;
      e.nav = null;
      return true;
    }
    let wx = tx, wz = tz, wStop = stopDist;
    if (!lineClear(e.x, e.z, tx, tz)) {
      const n = e.nav;
      if (!n || !n.path.length || Math.hypot(n.gx - tx, n.gz - tz) > 1.5 || this.now - n.at > 1500)
        e.nav = { gx: tx, gz: tz, at: this.now, path: findPath(e.x, e.z, tx, tz) };
      const path = e.nav!.path;
      while (path.length > 1 && Math.hypot(path[0].x - e.x, path[0].z - e.z) < 0.15) path.shift();
      if (path.length > 1 || Math.hypot(path[0].x - tx, path[0].z - tz) > 0.01) {
        wx = path[0].x;
        wz = path[0].z;
        wStop = 0;
      }
    } else e.nav = null;
    const dx = wx - e.x, dz = wz - e.z;
    const wd = Math.hypot(dx, dz) || 1e-4;
    const step = Math.min(speed * dt, Math.max(0, wd - wStop));
    e.ry = Math.atan2(dx, dz);
    e.moving = true;
    const np = pushOut(e.x + (dx / wd) * step, e.z + (dz / wd) * step, e.radius);
    this.setPos(e, np.x, np.z);
    return false;
  }

  near(x: number, z: number, r: number): Entity[] {
    return this.grid.query(x, z, r, []);
  }

  nearPlayers(x: number, z: number, r: number): Player[] {
    return this.near(x, z, r).filter((e): e is Player => e instanceof Player);
  }

  sendNear(x: number, z: number, msg: S2C, r = AOI) {
    let json: string | undefined;
    for (const p of this.nearPlayers(x, z, r)) p.sendRaw((json ??= JSON.stringify(msg)));
  }

  broadcast(msg: S2C) {
    const json = JSON.stringify(msg);
    for (const p of this.players.values()) p.sendRaw(json);
  }

  sys(p: Player, text: string) {
    p.send({ t: 'chat', ch: 'sys', from: '', text });
  }

  findPlayer(name: string): Player | undefined {
    const n = name.toLowerCase();
    for (const p of this.players.values()) if (p.name.toLowerCase() === n) return p;
    return undefined;
  }

  private spawnMobs() {
    const rng = mulberry32(42);
    for (const zone of ZONES) {
      for (const sp of zone.spawns) {
        const tpl = MOBS[sp.mob];
        for (let i = 0; i < sp.count; i++) {
          const a = rng() * Math.PI * 2;
          const r = tpl.boss ? 0 : Math.sqrt(rng()) * zone.r * 0.85;
          const { x, z } = pushOut(zone.x + Math.cos(a) * r, zone.z + Math.sin(a) * r, 1);
          const m = new Mob(this.newId(), x, z, tpl, x, z, zone.r);
          m.ry = rng() * Math.PI * 2;
          this.mobs.push(m);
          this.add(m);
        }
      }
    }
  }

  townPoint() {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 6;
    return pushOut(TOWN.x + Math.cos(a) * r, TOWN.z + Math.sin(a) * r);
  }

  teleport(p: Player, x: number, z: number) {
    p.intent = null;
    p.casting = null;
    p.moving = false;
    p.talkingTo = null;
    this.setPos(p, x, z);
    p.send({ t: 'teleported' });
  }

  start() {
    setInterval(() => this.tick(), TICK_MS);
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.2, (now - this.now) / 1000);
    this.now = now;
    this.tickN++;
    for (const p of this.players.values()) updatePlayer(this, p, dt, now);
    for (const m of this.mobs) updateMob(this, m, dt, now);
    for (const e of this.ents.values()) if (e instanceof GroundItem && now >= e.expireAt) this.remove(e);
    if (this.tickN % 2 === 0) for (const p of this.players.values()) this.sendSnapshot(p, now);
    if (this.tickN % 4 === 0) for (const p of this.players.values()) this.sendSelf(p);
    if (this.tickN % 10 === 0) party.sendPartyUpdates(this);
    if (this.tickN % 20 === 0) this.npcChatter(now);
    for (const p of this.players.values()) {
      if (p.invDirty) {
        p.invDirty = false;
        p.send({ t: 'inv', items: p.inv, adena: p.adena });
        onInventoryChanged(this, p);
      }
    }
  }

  /** Talker NPCs (Luigi) mumble out loud every 20-45 s when someone is around. */
  private npcChatter(now: number) {
    for (const e of this.ents.values()) {
      if (!(e instanceof Npc) || e.def.kind !== 'talker' || now < e.nextChatter) continue;
      e.nextChatter = now + 20000 + Math.random() * 25000;
      if (this.nearPlayers(e.x, e.z, 30).length) this.npcSay(e, randomLine(e.def));
    }
  }

  npcSay(n: Npc, text: string) {
    this.sendNear(n.x, n.z, { t: 'say', id: n.id, name: n.def.name, text }, 40);
  }

  entRecord(e: Entity, now: number): EntAdd {
    const base = { id: e.id, x: round2(e.x), z: round2(e.z), ry: round2(e.ry), hp: e.hpPct(), f: e.flags(now) };
    if (e instanceof Player)
      return { ...base, k: 'p', n: e.name, l: e.level, race: e.race, cls: e.cls, lk: e.look,
        w: e.equippedIn('weapon')?.i ?? null, a: e.equippedIn('chest')?.i ?? null, nc: e.nameColor(now),
        eq: (['head', 'gloves', 'legs', 'feet'] as const).map((s) => e.equippedIn(s)?.i ?? null) };
    if (e instanceof Mob) return { ...base, k: 'm', n: e.tpl.name, l: e.tpl.level, tpl: e.tpl.id };
    if (e instanceof Npc) return { ...base, k: 'n', n: e.def.name, title: e.def.title, npc: e.def.id };
    const gi = e as GroundItem;
    return { ...base, k: 'i', item: gi.itemId, c: gi.count };
  }

  private sendSnapshot(p: Player, now: number) {
    // slow client: let the socket drain; the next snapshot diffs against what it last got
    if (p.session.congested()) return;
    const add: EntAdd[] = [];
    const upd: EntUpd[] = [];
    const seen = new Set<number>();
    for (const e of this.near(p.x, p.z, AOI)) {
      seen.add(e.id);
      const u: EntUpd = [e.id, qPos(e.x), qPos(e.z), qRot(e.ry), e.hpPct(), e.flags(now)];
      const prev = p.known.get(e.id);
      if (!prev || p.knownAv.get(e.id) !== e.av) {
        add.push(this.entRecord(e, now));
        p.knownAv.set(e.id, e.av);
        p.known.set(e.id, u);
      } else if (prev[1] !== u[1] || prev[2] !== u[2] || prev[3] !== u[3] || prev[4] !== u[4] || prev[5] !== u[5]) {
        upd.push(u);
        p.known.set(e.id, u);
      }
    }
    const gone: number[] = [];
    for (const id of p.known.keys()) {
      if (!seen.has(id)) {
        gone.push(id);
        p.known.delete(id);
        p.knownAv.delete(id);
      }
    }
    // new entities (rare, full records) as JSON first; the per-tick updates and
    // despawns go in a compact binary frame (see shared/binary.ts)
    if (add.length) p.send({ t: 'snap', add, upd: [], gone: [] });
    if (upd.length || gone.length) p.sendBinary(encodeSnap(upd, gone));
  }

  selfState(p: Player): SelfState {
    const s = p.stats;
    return {
      id: p.id, name: p.name, race: p.race, cls: p.cls, look: p.look,
      lvl: p.level, xp: p.xp, xpNeed: xpToNext(p.level),
      hp: Math.ceil(p.hp), maxHp: s.maxHp, mp: Math.floor(p.mp), maxMp: s.maxMp, cp: Math.floor(p.cp), maxCp: s.maxCp,
      pAtk: s.pAtk, mAtk: s.mAtk, pDef: s.pDef, mDef: s.mDef, acc: s.accuracy, eva: s.evasion, crit: s.crit,
      atkSpd: Math.round(60000 / s.atkInterval), speed: Math.round(s.speed * 20),
      adena: p.adena, karma: p.karma, pk: p.pk, pvp: p.pvp, flagged: p.pvpUntil > this.now, pvpOn: p.pvpOn,
      skills: skillsFor(p.cls, p.level, p.race, p.look.g).map((sk) => sk.id),
      buffs: p.buffs.map((b) => ({ id: b.id, rem: Math.max(0, Math.round((b.until - this.now) / 1000)) })),
      zone: zoneAt(p.x, p.z),
    };
  }

  private sendSelf(p: Player) {
    const s = this.selfState(p);
    const json = JSON.stringify(s);
    if (json !== p.lastMe) {
      p.lastMe = json;
      p.send({ t: 'me', s });
    }
  }

  addPlayer(p: Player) {
    this.add(p);
  }

  removePlayer(p: Player) {
    party.leave(this, p, true);
    this.remove(p);
  }

  handle(p: Player, m: C2S) {
    const now = this.now;
    switch (m.t) {
      case 'move': {
        if (p.dead || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
        p.casting = null;
        p.talkingTo = null;
        p.intent = { type: 'move', x: m.x, z: m.z };
        return;
      }
      case 'stop':
        p.intent = null;
        p.moving = false;
        return;
      case 'target': {
        if (m.id === null) p.target = null;
        else if (this.ents.has(m.id)) p.target = m.id;
        return;
      }
      case 'attack': {
        const t = this.ents.get(m.id);
        if (!t || p.dead) return;
        p.target = t.id;
        const err = canAttack(this, p, t, !!m.force, now);
        if (err) return this.sys(p, err);
        if (p.casting) return;
        p.intent = { type: 'attack', id: t.id, force: !!m.force };
        return;
      }
      case 'skill':
        return requestSkill(this, p, String(m.skill), !!m.force, now);
      case 'pickup': {
        const t = this.ents.get(m.id);
        if (t instanceof GroundItem && !p.dead) p.intent = { type: 'pickup', id: t.id };
        return;
      }
      case 'talk': {
        const t = this.ents.get(m.id);
        if (t instanceof Npc && !p.dead) {
          p.target = t.id;
          p.intent = { type: 'talk', id: t.id };
        }
        return;
      }
      case 'equip':
        return inv.equip(this, p, m.u);
      case 'unequip':
        return inv.unequip(this, p, m.slot);
      case 'use':
        return inv.useItem(this, p, m.u, now);
      case 'destroy':
        return inv.destroyItem(this, p, m.u);
      case 'buy':
        return inv.buy(this, p, m.npc, String(m.item), Math.floor(Number(m.qty)));
      case 'sell':
        return inv.sell(this, p, m.npc, m.u, Math.floor(Number(m.qty)));
      case 'teleport':
        return inv.gatekeeper(this, p, m.npc, String(m.dest));
      case 'questAccept':
        return acceptQuest(this, p, m.npc);
      case 'questTurnIn': {
        const xp = turnInQuest(this, p, m.npc);
        if (xp > 0) gainXp(this, p, xp);
        return;
      }
      case 'chat':
        return handleChat(this, p, String(m.text ?? ''));
      case 'partyInvite':
        return party.invite(this, p, String(m.name ?? ''));
      case 'partyRespond':
        return party.respond(this, p, !!m.accept);
      case 'partyLeave':
        return party.leave(this, p, false);
      case 'respawn':
        return respawnPlayer(this, p);
      case 'pvpMode':
        return setPvpMode(this, p, !!m.on);
      case 'autoLoot':
        p.autoLoot = !!m.on;
        return;
    }
  }
}
