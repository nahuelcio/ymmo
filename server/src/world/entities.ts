import { DEFAULT_LOOK, type ClassType, type Look, type Race } from '../../../shared/src/data/classes';
import { ITEMS, type ItemDef } from '../../../shared/src/data/items';
import type { MobDef } from '../../../shared/src/data/mobs';
import type { BuffMods, SkillDef } from '../../../shared/src/data/skills';
import type { NpcDef } from '../../../shared/src/data/world';
import { SLOW_MUL, STATUSES, type StatusId } from '../../../shared/src/status';
import type { Lang } from '../../../shared/src/i18n';
import { computeStats, mobStats, type Stats } from '../../../shared/src/formulas';
import { F_CASTING, F_COMBAT, F_DEAD, F_MOVING, F_PVP, type InvItem, type S2C } from '../../../shared/src/protocol';

export const F_PURPLE = 16;
export const F_RED = 32;

export interface Session {
  accountId: number;
  /** UI language picked by the client */
  lang: Lang;
  player: Player | null;
  send(msg: S2C): void;
  /** Send an already-serialized message (lets broadcasts stringify once). */
  sendRaw(json: string): void;
  sendBinary(data: Uint8Array): void;
  /** True when the socket has a large unsent backlog (slow client). */
  congested(): boolean;
}

export type Intent =
  | { type: 'move'; x: number; z: number }
  | { type: 'attack'; id: number; force: boolean }
  | { type: 'skill'; skill: SkillDef; targetId: number; force: boolean }
  | { type: 'pickup'; id: number }
  | { type: 'talk'; id: number };

export interface Buff { id: string; until: number; mods: BuffMods }

export interface ActiveStatus { until: number; src: number; dps: number; nextTick: number }

export abstract class Entity {
  abstract readonly kind: 'player' | 'mob' | 'npc' | 'item';
  ry = 0;
  dead = false;
  hidden = false;
  moving = false;
  radius = 0.5;
  /** appearance version: bump to force clients to receive a full record again */
  av = 0;
  cell = '';
  /** cached path around obstacles (see World.stepToward) */
  nav: { gx: number; gz: number; at: number; path: { x: number; z: number }[] } | null = null;
  /** active status effects (see shared/status.ts and systems/combat.ts) */
  statuses = new Map<StatusId, ActiveStatus>();
  constructor(public id: number, public x: number, public z: number) {}
  abstract hpPct(): number;
  has(s: StatusId, now: number): boolean {
    return (this.statuses.get(s)?.until ?? 0) > now;
  }
  speedMul(now: number): number {
    return this.has('slow', now) ? SLOW_MUL : 1;
  }
  flags(now: number): number {
    let f = (this.dead ? F_DEAD : 0) | (this.moving ? F_MOVING : 0);
    for (const [id, st] of this.statuses) if (st.until > now) f |= STATUSES[id].flag;
    return f;
  }
}

export interface Party { id: number; members: Player[] }

export class Player extends Entity {
  readonly kind = 'player' as const;
  radius = 0.5;
  stats!: Stats;
  buffs: Buff[] = [];
  target: number | null = null;
  intent: Intent | null = null;
  nextAttack = 0;
  casting: { skill: SkillDef; targetId: number; end: number } | null = null;
  cooldowns = new Map<string, number>();
  pvpUntil = 0;
  /** PvP mode switch (off by default): off = can't attack or be attacked by players, unless PK. */
  pvpOn = false;
  /** drops go straight to the bag (client setting) */
  autoLoot = false;
  /** dodge-roll invulnerability window */
  dodgeUntil = 0;
  look: Look = DEFAULT_LOOK;
  lastCombat = 0;
  escapeAt = 0;
  party: Party | null = null;
  pendingInvite: { from: number; until: number } | null = null;
  talkingTo: number | null = null;
  /** Accepted and finished quests. Progress is the kill counter; collect quests read the inventory. */
  quests = new Map<string, { progress: number; done: boolean }>();
  /** Quest ids we already announced as ready, so login does not repeat the message. */
  questReadyTold = new Set<string>();
  /** last update sent per known entity: [id, x, z, ry, hp, flags] */
  known = new Map<number, number[]>();
  knownAv = new Map<number, number>();
  lastMe = '';
  invDirty = true;
  nextUid = 1;
  inv: InvItem[] = [];

  constructor(
    id: number, x: number, z: number,
    public session: Session,
    public charId: number,
    public name: string,
    public race: Race,
    public cls: ClassType,
    public level: number,
    public xp: number,
    public hp: number,
    public mp: number,
    public cp: number,
    public adena: number,
    public karma: number,
    public pk: number,
    public pvp: number,
  ) {
    super(id, x, z);
  }

  send(msg: S2C): void {
    this.session.send(msg);
  }

  get lang(): Lang {
    return this.session.lang;
  }

  sendRaw(json: string): void {
    this.session.sendRaw(json);
  }

  sendBinary(data: Uint8Array): void {
    this.session.sendBinary(data);
  }

  equipped(): ItemDef[] {
    return this.inv.filter((i) => i.s).map((i) => ITEMS[i.i]);
  }

  equippedIn(slot: string): InvItem | undefined {
    return this.inv.find((i) => i.s === slot);
  }

  recalc(): void {
    this.stats = computeStats(this.race, this.cls, this.level, this.equipped(), this.buffs.map((b) => b.mods), this.look.g);
    this.hp = Math.min(this.hp, this.stats.maxHp);
    this.mp = Math.min(this.mp, this.stats.maxMp);
    this.cp = Math.min(this.cp, this.stats.maxCp);
  }

  hpPct(): number {
    return Math.round((this.hp / this.stats.maxHp) * 100);
  }

  nameColor(now: number): 0 | 1 | 2 {
    return this.karma > 0 ? 2 : this.pvpUntil > now ? 1 : 0;
  }

  flags(now: number): number {
    const nc = this.nameColor(now);
    return super.flags(now) | (this.casting ? F_CASTING : 0) | (now - this.lastCombat < 4000 ? F_COMBAT : 0)
      | (nc === 1 ? F_PURPLE : nc === 2 ? F_RED : 0) | (this.pvpOn ? F_PVP : 0);
  }
}

export class Mob extends Entity {
  readonly kind = 'mob' as const;
  stats: ReturnType<typeof mobStats>;
  hp: number;
  target: number | null = null;
  hate = new Map<number, number>();
  nextAttack = 0;
  respawnAt = 0;
  hideAt = 0;
  wanderAt = 0;
  dest: { x: number; z: number } | null = null;
  returning = false;
  specialAt = 0;
  /** set for mobs that belong to a hostile camp */
  campId: string | null = null;
  winding: { x: number; z: number; end: number } | null = null;

  constructor(id: number, x: number, z: number, public tpl: MobDef, public homeX: number, public homeZ: number, public zoneR: number) {
    super(id, x, z);
    this.stats = mobStats(tpl);
    this.hp = this.stats.maxHp;
    this.radius = 0.5 * tpl.scale + 0.3;
  }

  hpPct(): number {
    return Math.round((this.hp / this.stats.maxHp) * 100);
  }

  flags(now: number): number {
    return super.flags(now) | (this.target !== null ? F_COMBAT : 0);
  }
}

export class Npc extends Entity {
  readonly kind = 'npc' as const;
  nextChatter = 0;
  constructor(id: number, public def: NpcDef) {
    super(id, def.x, def.z);
    this.ry = def.ry;
  }
  hpPct(): number {
    return 100;
  }
}

export class GroundItem extends Entity {
  readonly kind = 'item' as const;
  constructor(id: number, x: number, z: number, public itemId: string, public count: number,
    public owners: Set<number> | null, public ownerUntil: number, public expireAt: number, public campId: string | null = null) {
    super(id, x, z);
    this.ry = Math.random() * Math.PI * 2;
  }
  hpPct(): number {
    return 100;
  }
}
