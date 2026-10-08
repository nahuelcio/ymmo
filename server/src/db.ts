import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// async scrypt runs on libuv's thread pool: a login no longer freezes the game loop (~60-170 ms each)
const scryptAsync = promisify(scrypt) as (pass: string, salt: Buffer, len: number) => Promise<Buffer>;
import { CLASSES, sanitizeLook, START_ADENA, type ClassType, type Look, type Race } from '../../shared/src/data/classes';
import { TOWN } from '../../shared/src/terrain';
import type { CharSummary, InvItem } from '../../shared/src/protocol';
import type { Slot } from '../../shared/src/data/items';
import { ITEMS } from '../../shared/src/data/items';
import { QUESTS } from '../../shared/src/data/quests';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(dataDir + 'game.db');

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, user TEXT UNIQUE COLLATE NOCASE NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, name TEXT UNIQUE COLLATE NOCASE NOT NULL,
  race TEXT NOT NULL, cls TEXT NOT NULL, level INTEGER NOT NULL, xp INTEGER NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL, hp REAL NOT NULL, mp REAL NOT NULL, cp REAL NOT NULL,
  adena INTEGER NOT NULL, karma INTEGER NOT NULL, pk INTEGER NOT NULL, pvp INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, char_id INTEGER NOT NULL, item_id TEXT NOT NULL, count INTEGER NOT NULL, slot TEXT);
CREATE INDEX IF NOT EXISTS items_char ON items(char_id);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quests (
  char_id INTEGER NOT NULL, quest_id TEXT NOT NULL, progress INTEGER NOT NULL, done INTEGER NOT NULL,
  PRIMARY KEY (char_id, quest_id));
`);

// migration: appearance columns (added after launch)
for (const col of ["gender TEXT NOT NULL DEFAULT 'm'", 'hair_style INTEGER NOT NULL DEFAULT 0', 'hair_color INTEGER NOT NULL DEFAULT 0']) {
  try {
    db.exec(`ALTER TABLE characters ADD COLUMN ${col}`);
  } catch {
    /* already there */
  }
}

type LookCols = { gender: string; hair_style: number; hair_color: number };
const lookOf = (r: LookCols): Look => sanitizeLook({ g: r.gender as Look['g'], hs: r.hair_style, hc: r.hair_color });

async function hashPass(pass: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(pass, salt, 32)).toString('hex')}`;
}

async function checkPass(pass: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const got = await scryptAsync(pass, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, got);
}

const qAccount = db.prepare('SELECT id, hash FROM accounts WHERE user = ?');
const qInsAccount = db.prepare('INSERT INTO accounts (user, hash, created) VALUES (?, ?, ?)');

/** Returns account id, or an error string. */
export async function login(user: string, pass: string, register: boolean): Promise<number | string> {
  if (register) {
    if (qAccount.get(user)) return 'Ese nombre de cuenta ya está en uso.';
    const hash = await hashPass(pass);
    if (qAccount.get(user)) return 'Ese nombre de cuenta ya está en uso.'; // raced another register
    const r = qInsAccount.run(user, hash, Date.now());
    return Number(r.lastInsertRowid);
  }
  const row = qAccount.get(user) as { id: number; hash: string } | undefined;
  if (!row || !(await checkPass(pass, row.hash))) return 'Cuenta o contraseña incorrecta.';
  return row.id;
}

// "Remember me": random tokens, only their SHA-256 is stored; 30 days, renewed on use.
const TOKEN_TTL = 30 * 24 * 3600 * 1000;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const qInsSession = db.prepare('INSERT INTO sessions (hash, account_id, expires) VALUES (?, ?, ?)');
const qSession = db.prepare('SELECT account_id, expires FROM sessions WHERE hash = ?');
const qTouchSession = db.prepare('UPDATE sessions SET expires = ? WHERE hash = ?');
const qDelSession = db.prepare('DELETE FROM sessions WHERE hash = ?');
db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());

export function createSession(accountId: number): string {
  const token = randomBytes(32).toString('base64url');
  qInsSession.run(sha(token), accountId, Date.now() + TOKEN_TTL);
  return token;
}

/** Account id for a valid token (and extends it), or null. */
export function resumeSession(token: string): number | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const h = sha(token);
  const row = qSession.get(h) as { account_id: number; expires: number } | undefined;
  if (!row) return null;
  if (row.expires < Date.now()) {
    qDelSession.run(h);
    return null;
  }
  qTouchSession.run(Date.now() + TOKEN_TTL, h);
  return row.account_id;
}

export function deleteSession(token: string): void {
  if (typeof token === 'string') qDelSession.run(sha(token));
}

const qChars = db.prepare('SELECT id, name, race, cls, level, gender, hair_style, hair_color FROM characters WHERE account_id = ? ORDER BY id');
export function listChars(accountId: number): CharSummary[] {
  return (qChars.all(accountId) as unknown as (Omit<CharSummary, 'look'> & LookCols)[])
    .map((r) => ({ id: r.id, name: r.name, race: r.race, cls: r.cls, level: r.level, look: lookOf(r) }));
}

const qCharByName = db.prepare('SELECT id FROM characters WHERE name = ?');
const qInsChar = db.prepare(`INSERT INTO characters (account_id, name, race, cls, level, xp, x, z, hp, mp, cp, adena, karma, pk, pvp, created, gender, hair_style, hair_color)
  VALUES (?, ?, ?, ?, 1, 0, ?, ?, 99999, 99999, 99999, ?, 0, 0, 0, ?, ?, ?, ?)`);
const qInsItem = db.prepare('INSERT INTO items (char_id, item_id, count, slot) VALUES (?, ?, ?, ?)');

export function createChar(accountId: number, name: string, race: Race, cls: ClassType, look: Look): string | null {
  if (qCharByName.get(name)) return 'Ese nombre ya está en uso.';
  if (listChars(accountId).length >= 7) return 'Podés tener como máximo 7 personajes.';
  const a = Math.random() * Math.PI * 2;
  const r = qInsChar.run(accountId, name, race, cls, TOWN.x + Math.cos(a) * 6, TOWN.z + Math.sin(a) * 6, START_ADENA, Date.now(), look.g, look.hs, look.hc);
  const charId = Number(r.lastInsertRowid);
  for (const [itemId, count, equip] of CLASSES[cls].startItems) {
    qInsItem.run(charId, itemId, count, equip ? ITEMS[itemId].slot ?? null : null);
  }
  return null;
}

const qDelChar = db.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?');
const qDelItems = db.prepare('DELETE FROM items WHERE char_id = ?');
const qDelQuests = db.prepare('DELETE FROM quests WHERE char_id = ?');
export function deleteChar(accountId: number, id: number): void {
  const r = qDelChar.run(id, accountId);
  if (r.changes) {
    qDelItems.run(id);
    qDelQuests.run(id);
  }
}

export interface CharRow {
  id: number; account_id: number; name: string; race: Race; cls: ClassType; level: number; xp: number;
  x: number; z: number; hp: number; mp: number; cp: number; adena: number; karma: number; pk: number; pvp: number;
  look: Look;
}

export interface SavedQuest { id: string; progress: number; done: boolean }

const qChar = db.prepare('SELECT * FROM characters WHERE id = ? AND account_id = ?');
const qItems = db.prepare('SELECT item_id, count, slot FROM items WHERE char_id = ? ORDER BY id');
const qQuests = db.prepare('SELECT quest_id, progress, done FROM quests WHERE char_id = ?');
export function loadChar(accountId: number, id: number): { row: CharRow; items: Omit<InvItem, 'u'>[]; quests: SavedQuest[] } | null {
  const raw = qChar.get(id, accountId) as unknown as (Omit<CharRow, 'look'> & LookCols) | undefined;
  if (!raw) return null;
  const row: CharRow = { ...raw, look: lookOf(raw) };
  const items = (qItems.all(id) as { item_id: string; count: number; slot: string | null }[])
    .filter((r) => ITEMS[r.item_id])
    .map((r) => ({ i: r.item_id, c: r.count, s: r.slot as Slot | null }));
  const quests = (qQuests.all(id) as { quest_id: string; progress: number; done: number }[])
    .filter((r) => QUESTS[r.quest_id])
    .map((r) => ({ id: r.quest_id, progress: r.progress, done: r.done !== 0 }));
  return { row, items, quests };
}

const qSaveChar = db.prepare(`UPDATE characters SET level=?, xp=?, x=?, z=?, hp=?, mp=?, cp=?, adena=?, karma=?, pk=?, pvp=? WHERE id=?`);
const qInsQuest = db.prepare('INSERT INTO quests (char_id, quest_id, progress, done) VALUES (?, ?, ?, ?)');
export function saveChar(c: Omit<CharRow, 'account_id' | 'name' | 'race' | 'cls' | 'look'>, items: InvItem[], quests: SavedQuest[]): void {
  db.exec('BEGIN');
  try {
    qSaveChar.run(c.level, c.xp, c.x, c.z, c.hp, c.mp, c.cp, c.adena, c.karma, c.pk, c.pvp, c.id);
    qDelItems.run(c.id);
    for (const it of items) qInsItem.run(c.id, it.i, it.c, it.s);
    qDelQuests.run(c.id);
    for (const q of quests) if (QUESTS[q.id]) qInsQuest.run(c.id, q.id, q.progress, q.done ? 1 : 0);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
