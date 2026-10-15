import type { ClassType, Look, Race, Spec } from './data/classes';
import type { Slot } from './data/items';
import type { QuestStatus } from './data/quests';

/** Name colour: 0 normal, 1 PvP flagged (purple), 2 karma (red). */
export type NameColor = 0 | 1 | 2;

export interface CharSummary { id: number; name: string; race: Race; cls: ClassType; spec?: Spec | null; level: number; look: Look }

export interface EntPlayer {
  id: number; k: 'p'; x: number; z: number; ry: number; n: string; l: number; hp: number;
  race: Race; cls: ClassType; spec?: Spec | null; lk: Look; w: string | null; a: string | null; nc: NameColor; f: number;
  /** other visible gear: [head, gloves, legs, feet] item ids */
  eq: (string | null)[];
  /** clan: id, name, crest version (its PNG is /crest/<id>.png?v=<cv>), and this character's title */
  cl?: number | null; cn?: string | null; cv?: number | null; ti?: string | null;
  /** alliance id and its crest's version (/crest/a<id>.png?v=<ac>) */
  ai?: number | null; ac?: number | null;
}

/** One member in the clan window. */
export interface ClanMemberInfo { name: string; level: number; cls: ClassType; grade: number; title: string; on: boolean }
/** The clan window's data (server-rs/src/clans.rs info). privs: by grade (index 1-5), CLAN_PRIV bits. */
/** A clan we are at war with: ours = we declared, theirs = they declared (both: a mutual war). */
export interface ClanWarInfo { id: number; name: string; cv: number; ours: boolean; theirs: boolean }
/** A clan of our alliance. */
export interface AllyClanInfo { id: number; name: string; level: number; cv: number; members: number; leader: string }
/** Our alliance: leader is the leading clan's id. */
export interface AllyInfo { id: number; name: string; leader: number; cv: number; inviteUntil: number; clans: AllyClanInfo[] }
export interface ClanInfo {
  id: number; name: string; level: number; rep: number; leader: string; cv: number; cap: number;
  privs: number[]; inviteUntil: number; members: ClanMemberInfo[];
  wars: ClanWarInfo[]; ally: AllyInfo | null; allyJoinUntil: number; allyFoundUntil: number;
  /** clan skill id -> level (CLAN_SKILLS) */
  skills: Record<string, number>;
}
/** A clan warehouse row (id: its row), and a logged movement (dep: a deposit). */
export interface ClanWhItem { id: number; i: string; c: number; e: number }
export interface ClanWhLog { at: number; who: string; dep: boolean; i: string; c: number; e: number }
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
/** sitting (on a seat or on the ground); 128-1024 are status effects (status.ts) */
export const F_SITTING = 2048;
/** felling, mining or picking (the node comes in the 'gather' event) */
export const F_GATHER = 4096;

/** e: enchant level (+N) of a piece of gear */
export interface InvItem { u: number; i: string; c: number; s: Slot | null; e?: number }

export interface SelfState {
  id: number; name: string; race: Race; cls: ClassType; spec?: Spec | null; look: Look;
  lvl: number; xp: number; xpNeed: number;
  hp: number; maxHp: number; mp: number; maxMp: number; cp: number; maxCp: number;
  pAtk: number; mAtk: number; pDef: number; mDef: number; acc: number; eva: number; crit: number;
  atkSpd: number; speed: number; cdr: number;
  adena: number; karma: number; pk: number; pvp: number; flagged: boolean; pvpOn: boolean;
  skills: string[];
  buffs: { id: string; rem: number }[];
  zone: string;
}

export interface PartyMember { id: number; name: string; lvl: number; cls: ClassType; spec?: Spec | null; hp: number; maxHp: number; mp: number; maxMp: number; cp: number; maxCp: number; leader: boolean }

// Messages are plain JSON objects with a `t` discriminator.
export type C2S =
  | { t: 'lang'; lang: 'es' | 'en' }
  | { t: 'login'; user: string; pass: string; register: boolean; remember?: boolean }
  | { t: 'resume'; token: string }
  /** admin window (/admin): asks for the server state; pass logs this socket in, kick/announce are the actions */
  | { t: 'admin'; pass?: string; since?: number; kick?: number; announce?: string; setCast?: { skill: string; ms: number | null }; setBalance?: { key: string; value: number | null } }
  | { t: 'logout'; token: string }
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
  /** spend a matching enchant scroll from the bag on this piece */
  | { t: 'enchant'; u: number }
  | { t: 'buy'; npc: number; item: string; qty: number }
  | { t: 'sell'; npc: number; u: number; qty: number }
  /** have a merchant make an item from its recipe (ItemDef.craft) */
  | { t: 'craft'; npc: number; item: string }
  | { t: 'teleport'; npc: number; dest: string }
  | { t: 'questAccept'; npc: number }
  | { t: 'questTurnIn'; npc: number }
  | { t: 'chat'; text: string }
  | { t: 'partyInvite'; name: string }
  | { t: 'partyRespond'; accept: boolean }
  | { t: 'partyLeave' }
  | { t: 'clanGet' }
  | { t: 'clanCreate'; npc: number; name: string }
  | { t: 'clanInvite'; name: string }
  | { t: 'clanRespond'; accept: boolean }
  | { t: 'clanLeave' }
  | { t: 'clanKick'; name: string }
  | { t: 'clanTransfer'; name: string }
  | { t: 'clanDissolve'; npc: number }
  | { t: 'clanLevelUp'; npc: number }
  | { t: 'clanGrade'; name: string; grade: number }
  | { t: 'clanPrivs'; grade: number; privs: number }
  | { t: 'clanTitle'; name: string; title: string }
  | { t: 'clanCrest'; png: string }
  | { t: 'clanWar'; name: string }
  | { t: 'clanWarEnd'; name: string }
  | { t: 'allyCreate'; npc: number; name: string }
  | { t: 'allyInvite'; name: string }
  | { t: 'allyRespond'; accept: boolean }
  | { t: 'allyLeave' }
  | { t: 'allyKick'; name: string }
  | { t: 'allyDissolve' }
  | { t: 'allyCrest'; png: string }
  | { t: 'clanWhOpen'; npc: number }
  | { t: 'clanWhDeposit'; npc: number; uid: number; qty: number }
  | { t: 'clanWhWithdraw'; npc: number; id: number; qty: number }
  | { t: 'clanWhAdena'; npc: number; amount: number }
  | { t: 'clanSkill'; npc: number; skill: string }
  /** the skill bars' layout (client JSON, at most 4 KB), kept per character */
  | { t: 'hotbar'; data: string }
  /** one-time pick at SPEC_LEVEL */
  | { t: 'chooseSpec'; spec: Spec }
  | { t: 'respawn' }
  | { t: 'pvpMode'; on: boolean }
  | { t: 'autoLoot'; on: boolean }
  /** dodge roll toward a point */
  | { t: 'dash'; x: number; z: number; dx: number; dz: number }
  | { t: 'stop' }
  /** use a world node (shared/src/nodes.ts): fell, mine, pick or sit; the server walks there first */
  | { t: 'interact'; node: number }
  /** sit down on the spot, or stand up (also /sit) */
  | { t: 'sit' }
  /** answer to the server's ping (it measures the round trip) */
  | { t: 'pong'; s: number };

export type S2C =
  | { t: 'error'; msg: string }
  | { t: 'chars'; list: CharSummary[]; token?: string }
  | { t: 'resumeFail' }
  /** this character was entered from another tab or device; the server closes this socket right after */
  | { t: 'kicked' }
  /** admin window: ok is false until this socket gave the admin password */
  | { t: 'admin'; ok: false }
  | { t: 'admin'; ok: true; uptime: number; rss: number | null; conns: number; tickMs: number; seq: number; worlds: { id: number; tick: number; max: number; players: number; ents: number }[]; players: { sid: number; name: string; level: number; world: number; queue: number }[]; logs: { t: number; err: boolean; line: string }[]; casts: { id: string; name: string; base: number; cast: number }[]; balance: { key: string; label: string; base: number; current: number; min: number; max: number }[] }
  | { t: 'enter'; self: SelfState; inv: InvItem[]; /** the skill bars' layout kept for this character (ui/hud.ts) */ bar?: string }
  /** moved to another world (raid instance or back): forget every entity and start over */
  | { t: 'world'; self: SelfState; inv: InvItem[] }
  /** st: server time of the tick (wire clock, see binary.ts) */
  | { t: 'snap'; add: EntAdd[]; upd: EntUpd[]; gone: number[]; st?: number }
  | { t: 'me'; s: SelfState }
  | { t: 'inv'; items: InvItem[]; adena: number }
  | { t: 'target'; id: number | null }
  | { t: 'dmg'; s: number; tg: number; v: number; crit?: boolean; miss?: boolean; heal?: boolean; dot?: boolean }
  | { t: 'atk'; s: number; tg: number }
  | { t: 'cast'; s: number; tg: number; skill: string; dur: number }
  | { t: 'fx'; s: number; tg: number; skill: string }
  | { t: 'cd'; key: string; ms: number }
  | { t: 'died'; id: number; byPlayer: boolean }
  | { t: 'levelUp'; id: number; lvl: number }
  | { t: 'chat'; ch: 'all' | 'shout' | 'party' | 'clan' | 'ally' | 'whisper' | 'sys' | 'announce'; from: string; text: string }
  | { t: 'npc'; npc: number; kind: 'shop' | 'gatekeeper' | 'talker' | 'quest' | 'clan'; name: string; title: string; greeting: string; shop?: string[]; craft?: string[]; dests?: { id: string; name: string; cost: number }[]; quest?: { id: string; status: QuestStatus; progress: number } }
  | { t: 'quests'; list: { id: string; progress: number }[]; done: string[] }
  | { t: 'partyInvite'; from: string }
  | { t: 'clan'; clan: ClanInfo | null }
  | { t: 'clanInvite'; from: string; clan: string }
  | { t: 'allyInvite'; from: string; clan: string; ally: string }
  /** the clan warehouse window: contents, adena, latest movements, whether this member may withdraw */
  | { t: 'clanWh'; items: ClanWhItem[]; adena: number; log: ClanWhLog[]; can: boolean; slots: number }
  | { t: 'party'; members: PartyMember[] | null }
  | { t: 'teleported' }
  /** an NPC says something out loud (speech bubble + local chat) */
  | { t: 'say'; id: number; name: string; text: string }
  /** telegraphed area attack: a red circle filling up for ms before it hits */
  | { t: 'tele'; id: number; x: number; z: number; r: number; ms: number }
  /** latency probe: echo s back as a pong; rtt is the server's current estimate */
  | { t: 'ping'; s: number; rtt: number }
  /** spent nodes on entering a world: [id, ms until it is back] */
  | { t: 'nodes'; gone: [number, number][] }
  /** a node was spent (ms until back) or is back (ms = 0) */
  | { t: 'node'; id: number; ms: number }
  /** s starts working node for ms (others play the felling / mining / picking) */
  | { t: 'gather'; s: number; node: number; ms: number };
