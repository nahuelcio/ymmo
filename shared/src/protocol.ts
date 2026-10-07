import type { ClassType, Look, Race } from './data/classes';
import type { Slot } from './data/items';
import type { QuestStatus } from './data/quests';

/** Name colour: 0 normal, 1 PvP flagged (purple), 2 karma (red). */
export type NameColor = 0 | 1 | 2;

export interface CharSummary { id: number; name: string; race: Race; cls: ClassType; level: number; look: Look }

export interface EntPlayer {
  id: number; k: 'p'; x: number; z: number; ry: number; n: string; l: number; hp: number;
  race: Race; cls: ClassType; lk: Look; w: string | null; a: string | null; nc: NameColor; f: number;
}
export interface EntMob { id: number; k: 'm'; x: number; z: number; ry: number; n: string; l: number; hp: number; tpl: string; f: number }
export interface EntNpc { id: number; k: 'n'; x: number; z: number; ry: number; n: string; title: string; npc: string; hp: number; f: number }
export interface EntItem { id: number; k: 'i'; x: number; z: number; ry: number; item: string; c: number; hp: number; f: number }
export type EntAdd = EntPlayer | EntMob | EntNpc | EntItem;

/** Compact update: [id, x, z, ry, hpPct, flags] */
export type EntUpd = [number, number, number, number, number, number];

export const F_DEAD = 1;
export const F_MOVING = 2;
export const F_CASTING = 4;
export const F_COMBAT = 8;
/** Player has PvP mode enabled (can attack / be attacked by other PvP players). */
export const F_PVP = 64;

export interface InvItem { u: number; i: string; c: number; s: Slot | null }

export interface SelfState {
  id: number; name: string; race: Race; cls: ClassType; look: Look;
  lvl: number; xp: number; xpNeed: number;
  hp: number; maxHp: number; mp: number; maxMp: number; cp: number; maxCp: number;
  pAtk: number; mAtk: number; pDef: number; mDef: number; acc: number; eva: number; crit: number;
  atkSpd: number; speed: number;
  adena: number; karma: number; pk: number; pvp: number; flagged: boolean; pvpOn: boolean;
  skills: string[];
  buffs: { id: string; rem: number }[];
  zone: string;
}

export interface PartyMember { id: number; name: string; lvl: number; cls: ClassType; hp: number; maxHp: number; mp: number; maxMp: number; cp: number; maxCp: number; leader: boolean }

// Messages are plain JSON objects with a `t` discriminator.
export type C2S =
  | { t: 'login'; user: string; pass: string; register: boolean }
  | { t: 'createChar'; name: string; race: Race; cls: ClassType; look: Look }
  | { t: 'deleteChar'; id: number }
  | { t: 'enter'; id: number }
  | { t: 'move'; x: number; z: number }
  | { t: 'target'; id: number | null }
  | { t: 'attack'; id: number; force: boolean }
  | { t: 'skill'; skill: string; force: boolean }
  | { t: 'pickup'; id: number }
  | { t: 'talk'; id: number }
  | { t: 'equip'; u: number }
  | { t: 'unequip'; slot: Slot }
  | { t: 'use'; u: number }
  | { t: 'destroy'; u: number }
  | { t: 'buy'; npc: number; item: string; qty: number }
  | { t: 'sell'; npc: number; u: number; qty: number }
  | { t: 'teleport'; npc: number; dest: string }
  | { t: 'questAccept'; npc: number }
  | { t: 'questTurnIn'; npc: number }
  | { t: 'chat'; text: string }
  | { t: 'partyInvite'; name: string }
  | { t: 'partyRespond'; accept: boolean }
  | { t: 'partyLeave' }
  | { t: 'respawn' }
  | { t: 'pvpMode'; on: boolean }
  | { t: 'stop' };

export type S2C =
  | { t: 'error'; msg: string }
  | { t: 'chars'; list: CharSummary[] }
  | { t: 'enter'; self: SelfState; inv: InvItem[] }
  | { t: 'snap'; add: EntAdd[]; upd: EntUpd[]; gone: number[] }
  | { t: 'me'; s: SelfState }
  | { t: 'inv'; items: InvItem[]; adena: number }
  | { t: 'target'; id: number | null }
  | { t: 'dmg'; s: number; tg: number; v: number; crit?: boolean; miss?: boolean; heal?: boolean }
  | { t: 'atk'; s: number; tg: number }
  | { t: 'cast'; s: number; tg: number; skill: string; dur: number }
  | { t: 'fx'; s: number; tg: number; skill: string }
  | { t: 'cd'; key: string; ms: number }
  | { t: 'died'; id: number; byPlayer: boolean }
  | { t: 'levelUp'; id: number; lvl: number }
  | { t: 'chat'; ch: 'all' | 'shout' | 'party' | 'whisper' | 'sys' | 'announce'; from: string; text: string }
  | { t: 'npc'; npc: number; kind: 'shop' | 'gatekeeper' | 'talker' | 'quest'; name: string; title: string; greeting: string; shop?: string[]; dests?: { id: string; name: string; cost: number }[]; quest?: { id: string; status: QuestStatus; progress: number } }
  | { t: 'quests'; list: { id: string; progress: number }[] }
  | { t: 'partyInvite'; from: string }
  | { t: 'party'; members: PartyMember[] | null }
  | { t: 'teleported' }
  /** an NPC says something out loud (speech bubble + local chat) */
  | { t: 'say'; id: number; name: string; text: string };
