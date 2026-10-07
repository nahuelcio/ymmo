import type { ClassType, Race } from '../../../shared/src/data/classes';
import { ITEMS, type ItemDef } from '../../../shared/src/data/items';
import type { MobDef } from '../../../shared/src/data/mobs';
import type { BuffMods, SkillDef } from '../../../shared/src/data/skills';
import type { NpcDef } from '../../../shared/src/data/world';
import { computeStats, mobStats, type Stats } from '../../../shared/src/formulas';
import { F_CASTING, F_COMBAT, F_DEAD, F_MOVING, type InvItem, type S2C } from '../../../shared/src/protocol';

export const F_PURPLE = 16;
export const F_RED = 32;

export interface Session {
  accountId: number;
  player: Player | null;
  send(msg: S2C): void;
}

export type Intent =
  | { type: 'move'; x: number; z: number }
  | { type: 'attack'; id: number; force: boolean }
  | { type: 'skill'; skill: SkillDef; targetId: number; force: boolean }
  | { type: 'pickup'; id: number }
  | { type: 'talk'; id: number };

export interface Buff { id: string; until: number; mods: BuffMods }

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
  constructor(public id: number, public x: number, public z: number) {}
  abstract hpPct(): number;
  flags(_now: number): number {
    return (this.dead ? F_DEAD : 0) | (this.moving ? F_MOVING : 0);
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
  lastCombat = 0;
  escapeAt = 0;
  party: Party | null = null;
  pendingInvite: { from: number; until: number } | null = null;
  talkingTo: number | null = null;
  known = new Map<number, string>();
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

  equipped(): ItemDef[] {
    return this.inv.filter((i) => i.s).map((i) => ITEMS[i.i]);
  }

  equippedIn(slot: string): InvItem | undefined {
    return this.inv.find((i) => i.s === slot);
  }

  recalc(): void {
    this.stats = computeStats(this.race, this.cls, this.level, this.equipped(), this.buffs.map((b) => b.mods));
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
      | (nc === 1 ? F_PURPLE : nc === 2 ? F_RED : 0);
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
    public owners: Set<number> | null, public ownerUntil: number, public expireAt: number) {
    super(id, x, z);
    this.ry = Math.random() * Math.PI * 2;
  }
  hpPct(): number {
    return 100;
  }
}
