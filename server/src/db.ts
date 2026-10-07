import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { CLASSES, START_ADENA, type ClassType, type Race } from '../../shared/src/data/classes';
import { TOWN } from '../../shared/src/terrain';
import type { CharSummary, InvItem } from '../../shared/src/protocol';
import type { Slot } from '../../shared/src/data/items';
import { ITEMS } from '../../shared/src/data/items';

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
`);

function hashPass(pass: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pass, salt, 32).toString('hex')}`;
}

function checkPass(pass: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const got = scryptSync(pass, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, got);
}

const qAccount = db.prepare('SELECT id, hash FROM accounts WHERE user = ?');
const qInsAccount = db.prepare('INSERT INTO accounts (user, hash, created) VALUES (?, ?, ?)');

/** Returns account id, or an error string. */
export function login(user: string, pass: string, register: boolean): number | string {
  const row = qAccount.get(user) as { id: number; hash: string } | undefined;
  if (register) {
    if (row) return 'That account name is taken.';
    const r = qInsAccount.run(user, hashPass(pass), Date.now());
    return Number(r.lastInsertRowid);
  }
  if (!row || !checkPass(pass, row.hash)) return 'Wrong account name or password.';
  return row.id;
}

const qChars = db.prepare('SELECT id, name, race, cls, level FROM characters WHERE account_id = ? ORDER BY id');
export function listChars(accountId: number): CharSummary[] {
  return qChars.all(accountId) as unknown as CharSummary[];
}

const qCharByName = db.prepare('SELECT id FROM characters WHERE name = ?');
const qInsChar = db.prepare(`INSERT INTO characters (account_id, name, race, cls, level, xp, x, z, hp, mp, cp, adena, karma, pk, pvp, created)
  VALUES (?, ?, ?, ?, 1, 0, ?, ?, 99999, 99999, 99999, ?, 0, 0, 0, ?)`);
const qInsItem = db.prepare('INSERT INTO items (char_id, item_id, count, slot) VALUES (?, ?, ?, ?)');

export function createChar(accountId: number, name: string, race: Race, cls: ClassType): string | null {
  if (qCharByName.get(name)) return 'That name is already taken.';
  if (listChars(accountId).length >= 7) return 'You can have at most 7 characters.';
  const a = Math.random() * Math.PI * 2;
  const r = qInsChar.run(accountId, name, race, cls, TOWN.x + Math.cos(a) * 6, TOWN.z + Math.sin(a) * 6, START_ADENA, Date.now());
  const charId = Number(r.lastInsertRowid);
  for (const [itemId, count, equip] of CLASSES[cls].startItems) {
    qInsItem.run(charId, itemId, count, equip ? ITEMS[itemId].slot ?? null : null);
  }
  return null;
}

const qDelChar = db.prepare('DELETE FROM characters WHERE id = ? AND account_id = ?');
const qDelItems = db.prepare('DELETE FROM items WHERE char_id = ?');
export function deleteChar(accountId: number, id: number): void {
  const r = qDelChar.run(id, accountId);
  if (r.changes) qDelItems.run(id);
}

export interface CharRow {
  id: number; account_id: number; name: string; race: Race; cls: ClassType; level: number; xp: number;
  x: number; z: number; hp: number; mp: number; cp: number; adena: number; karma: number; pk: number; pvp: number;
}

const qChar = db.prepare('SELECT * FROM characters WHERE id = ? AND account_id = ?');
const qItems = db.prepare('SELECT item_id, count, slot FROM items WHERE char_id = ? ORDER BY id');
export function loadChar(accountId: number, id: number): { row: CharRow; items: Omit<InvItem, 'u'>[] } | null {
  const row = qChar.get(id, accountId) as unknown as CharRow | undefined;
  if (!row) return null;
  const items = (qItems.all(id) as { item_id: string; count: number; slot: string | null }[])
    .filter((r) => ITEMS[r.item_id])
    .map((r) => ({ i: r.item_id, c: r.count, s: r.slot as Slot | null }));
  return { row, items };
}

const qSaveChar = db.prepare(`UPDATE characters SET level=?, xp=?, x=?, z=?, hp=?, mp=?, cp=?, adena=?, karma=?, pk=?, pvp=? WHERE id=?`);
export function saveChar(c: Omit<CharRow, 'account_id' | 'name' | 'race' | 'cls'>, items: InvItem[]): void {
  db.exec('BEGIN');
  try {
    qSaveChar.run(c.level, c.xp, c.x, c.z, c.hp, c.mp, c.cp, c.adena, c.karma, c.pk, c.pvp, c.id);
    qDelItems.run(c.id);
    for (const it of items) qInsItem.run(c.id, it.i, it.c, it.s);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
