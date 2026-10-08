//! SQLite persistence: same schema and password hashes as the Node server (server/src/db.ts),
//! so the existing game.db keeps working when switching servers.
use crate::data::d;
use crate::ent::{InvItem, Look};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub struct Db { pub c: Connection }

pub struct CharRow {
    pub id: i64, pub name: String, pub race: String, pub cls: String, pub level: i64, pub xp: i64,
    pub x: f64, pub z: f64, pub hp: f64, pub mp: f64, pub cp: f64, pub adena: i64, pub karma: i64, pub pk: i64, pub pvp: i64, pub look: Look,
}

pub struct CharSummary { pub id: i64, pub name: String, pub race: String, pub cls: String, pub level: i64, pub look: Look }

const TOKEN_TTL: f64 = 30.0 * 24.0 * 3600.0 * 1000.0;

pub fn db_path() -> String {
    // same file the Node server uses (run from the repo root)
    std::env::var("GAME_DB").unwrap_or_else(|_| "server/data/game.db".into())
}

fn look_of(g: String, hs: i64, hc: i64) -> Look {
    let v = serde_json::json!({ "g": g, "hs": hs, "hc": hc });
    Look::sanitize(Some(&v))
}

fn now_ms() -> f64 { crate::world::now_ms() }
fn sha(t: &str) -> String { hex::encode(Sha256::digest(t.as_bytes())) }

/** Node's crypto.scrypt defaults: N=16384, r=8, p=1 */
fn scrypt_hash(pass: &str, salt: &[u8], len: usize) -> Vec<u8> {
    let params = scrypt::Params::new(14, 8, 1, len).unwrap();
    let mut out = vec![0u8; len];
    scrypt::scrypt(pass.as_bytes(), salt, &params, &mut out).unwrap();
    out
}

pub fn hash_pass(pass: &str) -> String {
    let salt: [u8; 16] = rand::random();
    format!("{}:{}", hex::encode(salt), hex::encode(scrypt_hash(pass, &salt, 32)))
}

pub fn check_pass(pass: &str, stored: &str) -> bool {
    let Some((salt_hex, hash_hex)) = stored.split_once(':') else { return false };
    let (Ok(salt), Ok(expected)) = (hex::decode(salt_hex), hex::decode(hash_hex)) else { return false };
    let got = scrypt_hash(pass, &salt, expected.len());
    // constant-time compare
    got.len() == expected.len() && got.iter().zip(&expected).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0
}

impl Db {
    pub fn open() -> Db {
        let path = db_path();
        if let Some(dir) = std::path::Path::new(&path).parent() { let _ = std::fs::create_dir_all(dir); }
        let c = Connection::open(&path).expect("open game.db");
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 3000;
             CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, user TEXT UNIQUE COLLATE NOCASE NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS characters (
               id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, name TEXT UNIQUE COLLATE NOCASE NOT NULL,
               race TEXT NOT NULL, cls TEXT NOT NULL, level INTEGER NOT NULL, xp INTEGER NOT NULL,
               x REAL NOT NULL, z REAL NOT NULL, hp REAL NOT NULL, mp REAL NOT NULL, cp REAL NOT NULL,
               adena INTEGER NOT NULL, karma INTEGER NOT NULL, pk INTEGER NOT NULL, pvp INTEGER NOT NULL, created INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, char_id INTEGER NOT NULL, item_id TEXT NOT NULL, count INTEGER NOT NULL, slot TEXT);
             CREATE INDEX IF NOT EXISTS items_char ON items(char_id);
             CREATE TABLE IF NOT EXISTS quests (char_id INTEGER NOT NULL, quest_id TEXT NOT NULL, progress INTEGER NOT NULL, done INTEGER NOT NULL, PRIMARY KEY (char_id, quest_id));",
        ).expect("schema");
        for col in ["gender TEXT NOT NULL DEFAULT 'm'", "hair_style INTEGER NOT NULL DEFAULT 0", "hair_color INTEGER NOT NULL DEFAULT 0"] {
            let _ = c.execute(&format!("ALTER TABLE characters ADD COLUMN {col}"), []);
        }
        let _ = c.execute("DELETE FROM sessions WHERE expires < ?", [now_ms() as i64]);
        Db { c }
    }

    pub fn account(&self, user: &str) -> Option<(i64, String)> {
        self.c.query_row("SELECT id, hash FROM accounts WHERE user = ?", [user], |r| Ok((r.get(0)?, r.get(1)?))).optional().ok().flatten()
    }

    pub fn insert_account(&self, user: &str, hash: &str) -> Result<i64, String> {
        self.c.execute("INSERT INTO accounts (user, hash, created) VALUES (?, ?, ?)", params![user, hash, now_ms() as i64])
            .map(|_| self.c.last_insert_rowid()).map_err(|_| "Ese nombre de cuenta ya está en uso.".to_string())
    }

    pub fn create_session(&self, account_id: i64) -> String {
        use base64::Engine;
        let raw: [u8; 32] = rand::random();
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
        let _ = self.c.execute("INSERT INTO sessions (hash, account_id, expires) VALUES (?, ?, ?)", params![sha(&token), account_id, (now_ms() + TOKEN_TTL) as i64]);
        token
    }

    pub fn resume_session(&self, token: &str) -> Option<i64> {
        if token.len() < 20 || token.len() > 100 { return None; }
        let h = sha(token);
        let row: Option<(i64, i64)> = self.c.query_row("SELECT account_id, expires FROM sessions WHERE hash = ?", [&h], |r| Ok((r.get(0)?, r.get(1)?))).optional().ok().flatten();
        let (acc, exp) = row?;
        if (exp as f64) < now_ms() {
            let _ = self.c.execute("DELETE FROM sessions WHERE hash = ?", [&h]);
            return None;
        }
        let _ = self.c.execute("UPDATE sessions SET expires = ? WHERE hash = ?", params![(now_ms() + TOKEN_TTL) as i64, h]);
        Some(acc)
    }

    pub fn delete_session(&self, token: &str) { let _ = self.c.execute("DELETE FROM sessions WHERE hash = ?", [sha(token)]); }

    pub fn list_chars(&self, account_id: i64) -> Vec<CharSummary> {
        let mut st = self.c.prepare_cached("SELECT id, name, race, cls, level, gender, hair_style, hair_color FROM characters WHERE account_id = ? ORDER BY id").unwrap();
        st.query_map([account_id], |r| Ok(CharSummary { id: r.get(0)?, name: r.get(1)?, race: r.get(2)?, cls: r.get(3)?, level: r.get(4)?, look: look_of(r.get(5)?, r.get(6)?, r.get(7)?) }))
            .map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn create_char(&self, account_id: i64, name: &str, race: &str, cls: &str, look: Look) -> Option<String> {
        let exists: Option<i64> = self.c.query_row("SELECT id FROM characters WHERE name = ?", [name], |r| r.get(0)).optional().ok().flatten();
        if exists.is_some() { return Some("Ese nombre ya está en uso.".into()); }
        if self.list_chars(account_id).len() >= 7 { return Some("Podés tener como máximo 7 personajes.".into()); }
        let data = d();
        let a = rand::random::<f64>() * std::f64::consts::TAU;
        let r = self.c.execute(
            "INSERT INTO characters (account_id, name, race, cls, level, xp, x, z, hp, mp, cp, adena, karma, pk, pvp, created, gender, hair_style, hair_color)
             VALUES (?, ?, ?, ?, 1, 0, ?, ?, 99999, 99999, 99999, ?, 0, 0, 0, ?, ?, ?, ?)",
            params![account_id, name, race, cls, data.town.x + a.cos() * 6.0, data.town.z + a.sin() * 6.0, data.c.start_adena, now_ms() as i64, look.gender(), look.hs, look.hc],
        );
        if r.is_err() { return Some("Ese nombre ya está en uso.".into()); }
        let char_id = self.c.last_insert_rowid();
        for it in &data.classes[cls].start_items {
            let slot = if it.equip { data.item(&it.item).and_then(|i| i.slot.clone()) } else { None };
            let _ = self.c.execute("INSERT INTO items (char_id, item_id, count, slot) VALUES (?, ?, ?, ?)", params![char_id, it.item, it.count, slot]);
        }
        None
    }

    pub fn delete_char(&self, account_id: i64, id: i64) {
        if let Ok(n) = self.c.execute("DELETE FROM characters WHERE id = ? AND account_id = ?", params![id, account_id]) {
            if n > 0 {
                let _ = self.c.execute("DELETE FROM items WHERE char_id = ?", [id]);
                let _ = self.c.execute("DELETE FROM quests WHERE char_id = ?", [id]);
            }
        }
    }

    pub fn load_char(&self, account_id: i64, id: i64) -> Option<(CharRow, Vec<(String, i64, Option<String>)>, Vec<(String, i64, bool)>)> {
        let row = self.c.query_row(
            "SELECT id, name, race, cls, level, xp, x, z, hp, mp, cp, adena, karma, pk, pvp, gender, hair_style, hair_color FROM characters WHERE id = ? AND account_id = ?",
            params![id, account_id],
            |r| Ok(CharRow {
                id: r.get(0)?, name: r.get(1)?, race: r.get(2)?, cls: r.get(3)?, level: r.get(4)?, xp: r.get(5)?, x: r.get(6)?, z: r.get(7)?,
                hp: r.get(8)?, mp: r.get(9)?, cp: r.get(10)?, adena: r.get(11)?, karma: r.get(12)?, pk: r.get(13)?, pvp: r.get(14)?,
                look: look_of(r.get(15)?, r.get(16)?, r.get(17)?),
            }),
        ).optional().ok().flatten()?;
        let data = d();
        let mut st = self.c.prepare_cached("SELECT item_id, count, slot FROM items WHERE char_id = ? ORDER BY id").unwrap();
        let items = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?)))
            .map(|it| it.filter_map(Result::ok).filter(|r| data.item(&r.0).is_some()).collect()).unwrap_or_default();
        let mut st = self.c.prepare_cached("SELECT quest_id, progress, done FROM quests WHERE char_id = ?").unwrap();
        let quests = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)? != 0)))
            .map(|it| it.filter_map(Result::ok).filter(|q| data.quest(&q.0).is_some()).collect()).unwrap_or_default();
        Some((row, items, quests))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_char(&mut self, id: i64, level: i64, xp: i64, x: f64, z: f64, hp: f64, mp: f64, cp: f64, adena: i64, karma: i64, pk: i64, pvp: i64, inv: &[InvItem], quests: &[(String, i64, bool)]) -> rusqlite::Result<()> {
        let tx = self.c.transaction()?;
        tx.execute("UPDATE characters SET level=?, xp=?, x=?, z=?, hp=?, mp=?, cp=?, adena=?, karma=?, pk=?, pvp=? WHERE id=?", params![level, xp, x, z, hp, mp, cp, adena, karma, pk, pvp, id])?;
        tx.execute("DELETE FROM items WHERE char_id = ?", [id])?;
        for it in inv { tx.execute("INSERT INTO items (char_id, item_id, count, slot) VALUES (?, ?, ?, ?)", params![id, it.i, it.c, it.s])?; }
        tx.execute("DELETE FROM quests WHERE char_id = ?", [id])?;
        for q in quests {
            if d().quest(&q.0).is_some() { tx.execute("INSERT INTO quests (char_id, quest_id, progress, done) VALUES (?, ?, ?, ?)", params![id, q.0, q.1, q.2 as i64])?; }
        }
        tx.commit()
    }
}
