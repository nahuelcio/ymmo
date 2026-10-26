//! SQLite persistence: same schema and password hashes as the Node server (server/src/db.ts),
//! so the existing game.db keeps working when switching servers.
use crate::data::d;
use crate::ent::{InvItem, Look};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};

pub struct Db { pub c: Connection }

/** What a save writes of a character (realm.rs char_save). */
pub struct CharSave {
    pub id: i64, pub level: i64, pub xp: i64, pub legend_lvl: i64, pub legend_xp: i64, pub x: f64, pub z: f64, pub hp: f64, pub mp: f64, pub cp: f64,
    pub adena: i64, pub karma: i64, pub pk: i64, pub pvp: i64, pub inv: Vec<InvItem>, pub quests: Vec<(String, i64, bool)>,
}

/** A finished trade, for the trade_log table: who gave what (JSON lists of { i, c, e, l, m }) and how much adena. */
pub struct TradeLog { pub a_id: i64, pub a_name: String, pub a_gave: String, pub a_adena: i64, pub b_id: i64, pub b_name: String, pub b_gave: String, pub b_adena: i64 }

fn write_char(tx: &Transaction, c: &CharSave) -> rusqlite::Result<()> {
    tx.execute("UPDATE characters SET level=?, xp=?, legend_lvl=?, legend_xp=?, x=?, z=?, hp=?, mp=?, cp=?, adena=?, karma=?, pk=?, pvp=? WHERE id=?",
        params![c.level, c.xp, c.legend_lvl, c.legend_xp, c.x, c.z, c.hp, c.mp, c.cp, c.adena, c.karma, c.pk, c.pvp, c.id])?;
    tx.execute("DELETE FROM items WHERE char_id = ?", [c.id])?;
    for it in &c.inv { tx.execute("INSERT INTO items (char_id, item_id, count, slot, enchant, legacy, mw) VALUES (?, ?, ?, ?, ?, ?, ?)", params![c.id, it.i, it.c, it.s, it.e, it.l as i64, it.m as i64])?; }
    tx.execute("DELETE FROM quests WHERE char_id = ?", [c.id])?;
    for q in &c.quests {
        if d().quest(&q.0).is_some() { tx.execute("INSERT INTO quests (char_id, quest_id, progress, done) VALUES (?, ?, ?, ?)", params![c.id, q.0, q.1, q.2 as i64])?; }
    }
    Ok(())
}

pub struct CharRow {
    pub id: i64, pub name: String, pub race: String, pub cls: String, pub level: i64, pub xp: i64,
    pub x: f64, pub z: f64, pub hp: f64, pub mp: f64, pub cp: f64, pub adena: i64, pub karma: i64, pub pk: i64, pub pvp: i64, pub look: Look, pub spec: Option<String>,
    pub hotbar: String,
    /** past the level cap: Legend level, XP towards the next, and the points spent on each passive (JSON) */
    pub legend_lvl: i64, pub legend_xp: i64, pub legend: String,
}

pub struct CharSummary { pub id: i64, pub name: String, pub race: String, pub cls: String, pub spec: Option<String>, pub level: i64, pub look: Look }

const TOKEN_TTL: f64 = 30.0 * 24.0 * 3600.0 * 1000.0;

pub fn db_path() -> String {
    std::env::var("GAME_DB").unwrap_or_else(|_| "server-rs/data/game.db".into())
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
             CREATE TABLE IF NOT EXISTS quests (char_id INTEGER NOT NULL, quest_id TEXT NOT NULL, progress INTEGER NOT NULL, done INTEGER NOT NULL, PRIMARY KEY (char_id, quest_id));
             CREATE TABLE IF NOT EXISTS skill_cast (skill TEXT PRIMARY KEY, ms REAL NOT NULL);
             CREATE TABLE IF NOT EXISTS balance (key TEXT PRIMARY KEY, value REAL NOT NULL);
             CREATE TABLE IF NOT EXISTS clans (id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE NOT NULL, leader INTEGER NOT NULL,
               level INTEGER NOT NULL DEFAULT 0, rep INTEGER NOT NULL DEFAULT 0, crest BLOB, crest_ver INTEGER NOT NULL DEFAULT 0,
               ally INTEGER, invite_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS clan_privs (clan_id INTEGER NOT NULL, grade INTEGER NOT NULL, privs INTEGER NOT NULL, PRIMARY KEY (clan_id, grade));
             CREATE TABLE IF NOT EXISTS clan_wars (clan INTEGER NOT NULL, target INTEGER NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (clan, target));
             CREATE TABLE IF NOT EXISTS clan_war_cd (clan INTEGER NOT NULL, target INTEGER NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (clan, target));
             CREATE TABLE IF NOT EXISTS clan_items (id INTEGER PRIMARY KEY, clan_id INTEGER NOT NULL, item_id TEXT NOT NULL, count INTEGER NOT NULL, enchant INTEGER NOT NULL DEFAULT 0);
             CREATE INDEX IF NOT EXISTS clan_items_clan ON clan_items(clan_id);
             CREATE TABLE IF NOT EXISTS clan_log (id INTEGER PRIMARY KEY, clan_id INTEGER NOT NULL, at INTEGER NOT NULL, who TEXT NOT NULL, dep INTEGER NOT NULL, item_id TEXT NOT NULL, count INTEGER NOT NULL, enchant INTEGER NOT NULL DEFAULT 0);
             CREATE INDEX IF NOT EXISTS clan_log_clan ON clan_log(clan_id);
             CREATE TABLE IF NOT EXISTS clan_skills (clan_id INTEGER NOT NULL, skill TEXT NOT NULL, level INTEGER NOT NULL, PRIMARY KEY (clan_id, skill));
             CREATE TABLE IF NOT EXISTS alliances (id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE NOT NULL, leader_clan INTEGER NOT NULL,
               crest BLOB, crest_ver INTEGER NOT NULL DEFAULT 0, invite_until INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);",
        ).expect("schema");
        for col in ["gender TEXT NOT NULL DEFAULT 'm'", "hair_style INTEGER NOT NULL DEFAULT 0", "hair_color INTEGER NOT NULL DEFAULT 0", "spec TEXT",
            // clans (clans.rs): membership, power grade, title and the join / found penalties (ms since epoch)
            "clan_id INTEGER", "clan_grade INTEGER NOT NULL DEFAULT 5", "title TEXT NOT NULL DEFAULT ''",
            "clan_join_until INTEGER NOT NULL DEFAULT 0", "clan_found_until INTEGER NOT NULL DEFAULT 0",
            // the skill bars' layout, as the client keeps it (JSON, client/src/ui/hud.ts)
            "hotbar TEXT NOT NULL DEFAULT ''",
            // past the level cap (legend.rs): Legend level, XP towards the next, and the points spent (JSON: passive -> ranks)
            "legend_lvl INTEGER NOT NULL DEFAULT 0", "legend_xp INTEGER NOT NULL DEFAULT 0", "legend TEXT NOT NULL DEFAULT ''",
            // the aura an Olympiad Hero chose (olympiad.rs HERO_LOOKS)
            "hero_look TEXT NOT NULL DEFAULT 'halo'"] {
            let _ = c.execute(&format!("ALTER TABLE characters ADD COLUMN {col}"), []);
        }
        let _ = c.execute("ALTER TABLE items ADD COLUMN enchant INTEGER NOT NULL DEFAULT 0", []);
        // legacy: a piece worn at any level, whatever its grade asks (the old S set, below)
        let _ = c.execute("ALTER TABLE items ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0", []);
        let _ = c.execute("ALTER TABLE clan_items ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0", []);
        // mw: a Masterwork piece (shared/src/data/items.ts MASTERWORK)
        let _ = c.execute("ALTER TABLE items ADD COLUMN mw INTEGER NOT NULL DEFAULT 0", []);
        let _ = c.execute("ALTER TABLE clan_items ADD COLUMN mw INTEGER NOT NULL DEFAULT 0", []);
        let _ = c.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)", []);
        // every finished player trade (trade.rs): what each side gave, for sorting out a "I never got it"
        let _ = c.execute("CREATE TABLE IF NOT EXISTS trade_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, a_id INTEGER NOT NULL, a_name TEXT NOT NULL, a_gave TEXT NOT NULL, a_adena INTEGER NOT NULL, b_id INTEGER NOT NULL, b_name TEXT NOT NULL, b_gave TEXT NOT NULL, b_adena INTEGER NOT NULL)", []);
        // a boss jewel's roll, once a week a character (combat.rs jewel_rolls; week: formulas.rs loot_week)
        let _ = c.execute("CREATE TABLE IF NOT EXISTS boss_loot (char_id INTEGER NOT NULL, boss TEXT NOT NULL, week INTEGER NOT NULL, PRIMARY KEY (char_id, boss, week))", []);
        // when each overworld boss is back (ms since epoch), so a restart doesn't bring them all back at once
        let _ = c.execute("CREATE TABLE IF NOT EXISTS boss_respawn (mob TEXT PRIMARY KEY, at INTEGER NOT NULL)", []);
        // the Rift (rift.rs): a character's paid run of the day, and each week's best floor of each party
        let _ = c.execute("CREATE TABLE IF NOT EXISTS rift_runs (char_id INTEGER NOT NULL, day INTEGER NOT NULL, PRIMARY KEY (char_id, day))", []);
        let _ = c.execute("CREATE TABLE IF NOT EXISTS rift_best (week INTEGER NOT NULL, party_key TEXT NOT NULL, names TEXT NOT NULL, floor INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (week, party_key))", []);
        // the daily contracts each character handed in, by day (quests.rs)
        let _ = c.execute("CREATE TABLE IF NOT EXISTS daily_done (char_id INTEGER NOT NULL, quest_id TEXT NOT NULL, day INTEGER NOT NULL, PRIMARY KEY (char_id, quest_id, day))", []);
        // fort sieges (siege.rs): which clan holds each fort, and the sieges already decided (key: the week, or an admin
        // siege's start), so a restart mid-siege only brings back the forts still being fought over
        let _ = c.execute("CREATE TABLE IF NOT EXISTS fort_owner (fort TEXT PRIMARY KEY, clan_id INTEGER NOT NULL, since INTEGER NOT NULL)", []);
        let _ = c.execute("CREATE TABLE IF NOT EXISTS siege_done (key INTEGER NOT NULL, fort TEXT NOT NULL, PRIMARY KEY (key, fort))", []);
        // the Olympiad (olympiad.rs): each character's month (points, fights), the fights of each day (one rival only so
        // many times), and each month's Heroes: one a class line by the points, and any the GM panel names
        let _ = c.execute("CREATE TABLE IF NOT EXISTS oly_points (month INTEGER NOT NULL, char_id INTEGER NOT NULL, line TEXT NOT NULL, name TEXT NOT NULL, points INTEGER NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, char_id))", []);
        let _ = c.execute("CREATE TABLE IF NOT EXISTS oly_fights (id INTEGER PRIMARY KEY, day INTEGER NOT NULL, a INTEGER NOT NULL, b INTEGER NOT NULL)", []);
        let _ = c.execute("CREATE TABLE IF NOT EXISTS heroes (month INTEGER NOT NULL, line TEXT NOT NULL, char_id INTEGER NOT NULL, name TEXT NOT NULL, by_gm INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, char_id))", []);
        mark_legacy_s(&c);
        // alliance penalties (clans.rs): may not join another alliance / found one until then (ms since epoch)
        for col in ["ally_join_until INTEGER NOT NULL DEFAULT 0", "ally_found_until INTEGER NOT NULL DEFAULT 0", "adena INTEGER NOT NULL DEFAULT 0"] {
            let _ = c.execute(&format!("ALTER TABLE clans ADD COLUMN {col}"), []);
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
        let mut st = self.c.prepare_cached("SELECT id, name, race, cls, level, gender, hair_style, hair_color, spec FROM characters WHERE account_id = ? ORDER BY id").unwrap();
        st.query_map([account_id], |r| Ok(CharSummary { id: r.get(0)?, name: r.get(1)?, race: r.get(2)?, cls: r.get(3)?, level: r.get(4)?, look: look_of(r.get(5)?, r.get(6)?, r.get(7)?), spec: r.get(8)? }))
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
            params![account_id, name, race, cls, data.town.x + a.cos() * 11.0, data.town.z + a.sin() * 11.0, data.c.start_adena, now_ms() as i64, look.gender(), look.hs, look.hc],
        );
        if r.is_err() { return Some("Ese nombre ya está en uso.".into()); }
        let char_id = self.c.last_insert_rowid();
        for it in &data.classes[cls].start_items {
            let slot = if it.equip { data.item(&it.item).and_then(|i| i.slot.clone()) } else { None };
            let _ = self.c.execute("INSERT INTO items (char_id, item_id, count, slot) VALUES (?, ?, ?, ?)", params![char_id, it.item, it.count, slot]);
        }
        None
    }

    /** The skill bars' layout (written as soon as the player changes it). */
    pub fn char_hotbar(&self, id: i64, json: &str) {
        let _ = self.c.execute("UPDATE characters SET hotbar = ? WHERE id = ?", params![json, id]);
    }

    pub fn owns_char(&self, account_id: i64, id: i64) -> bool {
        self.c.query_row("SELECT 1 FROM characters WHERE id = ? AND account_id = ?", params![id, account_id], |_| Ok(())).optional().ok().flatten().is_some()
    }

    pub fn delete_char(&self, account_id: i64, id: i64) {
        if let Ok(n) = self.c.execute("DELETE FROM characters WHERE id = ? AND account_id = ?", params![id, account_id]) {
            if n > 0 {
                let _ = self.c.execute("DELETE FROM items WHERE char_id = ?", [id]);
                let _ = self.c.execute("DELETE FROM quests WHERE char_id = ?", [id]);
            }
        }
    }

    /** items come back as (item id, count, slot, enchant) */
    pub fn load_char(&self, account_id: i64, id: i64) -> Option<(CharRow, Vec<(String, i64, Option<String>, i64, bool, bool)>, Vec<(String, i64, bool)>)> {
        let row = self.c.query_row(
            "SELECT id, name, race, cls, level, xp, x, z, hp, mp, cp, adena, karma, pk, pvp, gender, hair_style, hair_color, spec, hotbar, legend_lvl, legend_xp, legend FROM characters WHERE id = ? AND account_id = ?",
            params![id, account_id],
            |r| Ok(CharRow {
                id: r.get(0)?, name: r.get(1)?, race: r.get(2)?, cls: r.get(3)?, level: r.get(4)?, xp: r.get(5)?, x: r.get(6)?, z: r.get(7)?,
                hp: r.get(8)?, mp: r.get(9)?, cp: r.get(10)?, adena: r.get(11)?, karma: r.get(12)?, pk: r.get(13)?, pvp: r.get(14)?,
                look: look_of(r.get(15)?, r.get(16)?, r.get(17)?), spec: r.get(18)?, hotbar: r.get(19)?,
                legend_lvl: r.get(20)?, legend_xp: r.get(21)?, legend: r.get(22)?,
            }),
        ).optional().ok().flatten()?;
        let data = d();
        let mut st = self.c.prepare_cached("SELECT item_id, count, slot, enchant, legacy, mw FROM items WHERE char_id = ? ORDER BY id").unwrap();
        let items = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)? != 0, r.get::<_, i64>(5)? != 0)))
            .map(|it| it.filter_map(Result::ok).filter(|r| data.item(&r.0).is_some()).collect()).unwrap_or_default();
        let mut st = self.c.prepare_cached("SELECT quest_id, progress, done FROM quests WHERE char_id = ?").unwrap();
        let quests = st.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)? != 0)))
            .map(|it| it.filter_map(Result::ok).filter(|q| data.quest(&q.0).is_some()).collect()).unwrap_or_default();
        Some((row, items, quests))
    }

    /** the specialization is picked once and for good: written right away, not with the periodic save */
    /** admin tuning: cast-time overrides in ms, by skill id */
    pub fn cast_overrides(&self) -> Vec<(String, f64)> {
        let mut st = self.c.prepare_cached("SELECT skill, ms FROM skill_cast").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    /** None clears the override, back to the skill's base cast time */
    pub fn set_cast(&self, skill: &str, ms: Option<f64>) {
        let _ = match ms {
            Some(ms) => self.c.execute("INSERT OR REPLACE INTO skill_cast (skill, ms) VALUES (?, ?)", params![skill, ms]),
            None => self.c.execute("DELETE FROM skill_cast WHERE skill = ?", [skill]),
        };
    }

    /** admin tuning: balance overrides by key (see admin::tunables) */
    pub fn balance_overrides(&self) -> Vec<(String, f64)> {
        let mut st = self.c.prepare_cached("SELECT key, value FROM balance").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    /** None clears the override, back to the game.json value */
    pub fn set_balance(&self, key: &str, value: Option<f64>) {
        let _ = match value {
            Some(v) => self.c.execute("INSERT OR REPLACE INTO balance (key, value) VALUES (?, ?)", params![key, v]),
            None => self.c.execute("DELETE FROM balance WHERE key = ?", [key]),
        };
    }

    pub fn set_spec(&self, id: i64, spec: &str) -> rusqlite::Result<usize> { self.c.execute("UPDATE characters SET spec = ? WHERE id = ?", params![spec, id]) }

    /** The Legend points spent (JSON: passive -> ranks): written right away, like the spec. */
    pub fn set_legend(&self, id: i64, json: &str) -> rusqlite::Result<usize> { self.c.execute("UPDATE characters SET legend = ? WHERE id = ?", params![json, id]) }

    /** This week's roll of this boss's jewel for this character: true if it was still to take (and it is taken now). */
    pub fn take_jewel_roll(&self, char_id: i64, boss: &str, week: i64) -> bool {
        self.c.execute("INSERT OR IGNORE INTO boss_loot (char_id, boss, week) VALUES (?, ?, ?)", params![char_id, boss, week]).map_or(false, |n| n > 0)
    }

    /** This character's paid Rift run of the day: true if it was still to take (and it is taken now). */
    pub fn take_rift_run(&self, char_id: i64, day: i64) -> bool {
        self.c.execute("INSERT OR IGNORE INTO rift_runs (char_id, day) VALUES (?, ?)", params![char_id, day]).map_or(false, |n| n > 0)
    }
    /** A party's floor this week, if it is its best (ties keep the earlier time). */
    pub fn set_rift_best(&self, week: i64, party_key: &str, names: &str, floor: i64, at: f64) {
        let _ = self.c.execute(
            "INSERT INTO rift_best (week, party_key, names, floor, at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(week, party_key) DO UPDATE SET floor = excluded.floor, at = excluded.at, names = excluded.names WHERE excluded.floor > rift_best.floor",
            params![week, party_key, names, floor, at as i64]);
    }
    /** The week's deepest parties: (names, floor), deepest first, the earlier first on a tie. */
    pub fn rift_top(&self, week: i64, n: i64) -> Vec<(String, i64)> {
        let Ok(mut st) = self.c.prepare("SELECT names, floor FROM rift_best WHERE week = ? ORDER BY floor DESC, at ASC LIMIT ?") else { return vec![] };
        st.query_map(params![week, n], |r| Ok((r.get(0)?, r.get(1)?))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    /** The daily contracts this character handed in on that day. */
    pub fn daily_done(&self, char_id: i64, day: i64) -> Vec<String> {
        let Ok(mut st) = self.c.prepare("SELECT quest_id FROM daily_done WHERE char_id = ? AND day = ?") else { return vec![] };
        st.query_map(params![char_id, day], |r| r.get(0)).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }
    /** A daily contract handed in today: true if it was not yet (written right away, like a jewel's roll). */
    pub fn mark_daily_done(&self, char_id: i64, quest_id: &str, day: i64) -> bool {
        self.c.execute("INSERT OR IGNORE INTO daily_done (char_id, quest_id, day) VALUES (?, ?, ?)", params![char_id, quest_id, day]).map_or(false, |n| n > 0)
    }

    /** When an overworld boss is back (ms since epoch), kept across restarts. */
    /** Every fort with an owner: (fort, clan id). */
    pub fn fort_owners(&self) -> Vec<(String, i64)> {
        let Ok(mut st) = self.c.prepare("SELECT fort, clan_id FROM fort_owner") else { return vec![] };
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }
    /** A fort's new owner (None: nobody holds it). */
    pub fn set_fort_owner(&self, fort: &str, clan: Option<i64>, at: f64) {
        let _ = match clan {
            Some(c) => self.c.execute("INSERT INTO fort_owner (fort, clan_id, since) VALUES (?, ?, ?) ON CONFLICT(fort) DO UPDATE SET clan_id = excluded.clan_id, since = excluded.since", params![fort, c, at as i64]),
            None => self.c.execute("DELETE FROM fort_owner WHERE fort = ?", [fort]),
        };
    }
    /** The forts whose siege under this key is over. */
    pub fn sieges_done(&self, key: i64) -> Vec<String> {
        let Ok(mut st) = self.c.prepare("SELECT fort FROM siege_done WHERE key = ?") else { return vec![] };
        st.query_map([key], |r| r.get(0)).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }
    pub fn siege_done(&self, key: i64, fort: &str) {
        let _ = self.c.execute("INSERT OR IGNORE INTO siege_done (key, fort) VALUES (?, ?)", params![key, fort]);
    }

    /** A character's Olympiad month: (points, wins, losses, draws), starting it with `start` points if it had none. */
    pub fn oly_row(&self, month: i64, char_id: i64, line: &str, name: &str, start: i64) -> (i64, i64, i64, i64) {
        let _ = self.c.execute("INSERT OR IGNORE INTO oly_points (month, char_id, line, name, points) VALUES (?, ?, ?, ?, ?)", params![month, char_id, line, name, start]);
        self.c.query_row("SELECT points, wins, losses, draws FROM oly_points WHERE month = ? AND char_id = ?", params![month, char_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap_or((start, 0, 0, 0))
    }
    /** A fight's outcome for one side: its points move by `points`, and one more win, loss or draw. */
    pub fn oly_score(&self, month: i64, char_id: i64, points: i64, win: i64, loss: i64, draw: i64) {
        let _ = self.c.execute("UPDATE oly_points SET points = MAX(0, points + ?), wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE month = ? AND char_id = ?",
            params![points, win, loss, draw, month, char_id]);
    }
    /** A fight between two characters that day, and how many they had had (either way round). */
    pub fn oly_fight(&self, day: i64, a: i64, b: i64) { let _ = self.c.execute("INSERT INTO oly_fights (day, a, b) VALUES (?, ?, ?)", params![day, a, b]); }
    pub fn oly_fights(&self, day: i64, a: i64, b: i64) -> i64 {
        self.c.query_row("SELECT COUNT(*) FROM oly_fights WHERE day = ?1 AND ((a = ?2 AND b = ?3) OR (a = ?3 AND b = ?2))", params![day, a, b], |r| r.get(0)).unwrap_or(0)
    }
    /** The month's table, best first: (name, line, points, wins, losses, draws). */
    pub fn oly_top(&self, month: i64, n: i64) -> Vec<(String, String, i64, i64, i64, i64)> {
        let Ok(mut st) = self.c.prepare("SELECT name, line, points, wins, losses, draws FROM oly_points WHERE month = ? ORDER BY points DESC, wins DESC, char_id ASC LIMIT ?") else { return vec![] };
        st.query_map(params![month, n], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }
    /** Who may be a line's Hero after this month (enough fights and wins), best first in each line: (line, char id,
     * name, points, wins, fights). */
    pub fn oly_contenders(&self, month: i64, fights: i64, wins: i64) -> Vec<(String, i64, String, i64, i64, i64)> {
        let Ok(mut st) = self.c.prepare("SELECT line, char_id, name, points, wins, wins + losses + draws AS f FROM oly_points WHERE month = ? AND wins >= ? AND wins + losses + draws >= ?
            ORDER BY line, points DESC, wins DESC, f ASC, char_id ASC") else { return vec![] };
        st.query_map(params![month, wins, fights], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }
    /** A month's Heroes: (line, char id, name). */
    pub fn heroes(&self, month: i64) -> Vec<(String, i64, String)> {
        let Ok(mut st) = self.c.prepare("SELECT line, char_id, name FROM heroes WHERE month = ? ORDER BY line") else { return vec![] };
        st.query_map([month], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }
    pub fn set_heroes(&self, month: i64, heroes: &[(String, i64, String)]) {
        // the ones the GM panel named stay
        let _ = self.c.execute("DELETE FROM heroes WHERE month = ? AND by_gm = 0", [month]);
        for (line, c, name) in heroes { let _ = self.c.execute("INSERT OR REPLACE INTO heroes (month, line, char_id, name) VALUES (?, ?, ?, ?)", params![month, line, c, name]); }
    }
    /** The GM panel names a Hero for the month (beside the line's own), or takes the title back. */
    pub fn add_hero(&self, month: i64, line: &str, char_id: i64, name: &str) {
        let _ = self.c.execute("INSERT OR REPLACE INTO heroes (month, line, char_id, name, by_gm) VALUES (?, ?, ?, ?, 1)", params![month, line, char_id, name]);
    }
    pub fn remove_hero(&self, month: i64, char_id: i64) {
        let _ = self.c.execute("DELETE FROM heroes WHERE month = ? AND char_id = ?", params![month, char_id]);
    }
    pub fn is_hero(&self, char_id: i64, month: i64) -> bool {
        self.c.query_row("SELECT 1 FROM heroes WHERE month = ? AND char_id = ?", params![month, char_id], |_| Ok(())).is_ok()
    }
    /** The aura a character wears when it is a Hero. */
    pub fn hero_look(&self, char_id: i64) -> String {
        self.c.query_row("SELECT hero_look FROM characters WHERE id = ?", [char_id], |r| r.get(0)).unwrap_or_else(|_| "halo".into())
    }
    pub fn set_hero_look(&self, char_id: i64, look: &str) {
        let _ = self.c.execute("UPDATE characters SET hero_look = ? WHERE id = ?", params![look, char_id]);
    }

    pub fn set_boss_respawn(&self, mob: &str, at: f64) {
        let _ = self.c.execute("INSERT INTO boss_respawn (mob, at) VALUES (?, ?) ON CONFLICT(mob) DO UPDATE SET at = excluded.at", params![mob, at as i64]);
    }
    pub fn boss_respawns(&self) -> Vec<(String, f64)> {
        let Ok(mut st) = self.c.prepare("SELECT mob, at FROM boss_respawn") else { return vec![] };
        st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as f64))).map(|it| it.filter_map(Result::ok).collect()).unwrap_or_default()
    }

    pub fn save_char(&mut self, c: &CharSave) -> rusqlite::Result<()> {
        let tx = self.c.transaction()?;
        write_char(&tx, c)?;
        tx.commit()
    }

    /** Both sides of a trade and its log line in one transaction: a crash keeps all of it or none (no item twice, none lost). */
    pub fn save_trade(&mut self, a: &CharSave, b: &CharSave, log: &TradeLog) -> rusqlite::Result<()> {
        let tx = self.c.transaction()?;
        write_char(&tx, a)?;
        write_char(&tx, b)?;
        tx.execute(
            "INSERT INTO trade_log (at, a_id, a_name, a_gave, a_adena, b_id, b_name, b_gave, b_adena) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![crate::world::now_ms() as i64, log.a_id, log.a_name, log.a_gave, log.a_adena, log.b_id, log.b_name, log.b_gave, log.b_adena],
        )?;
        tx.commit()
    }

    // ------------------------------------------------------------------ clans (clans.rs keeps them in memory)

    /** Every clan, the grades' privileges, every member, and the characters with a clan penalty still running. */
    pub fn load_clans(&self) -> (Vec<ClanRow>, Vec<(i64, i64, i64)>, Vec<ClanMemberRow>, Vec<(i64, f64, f64)>) {
        let mut clans = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT id, name, leader, level, rep, crest, crest_ver, ally, invite_until, ally_join_until, ally_found_until FROM clans") {
            if let Ok(rows) = q.query_map([], |r| Ok(ClanRow {
                id: r.get(0)?, name: r.get(1)?, leader: r.get(2)?, level: r.get(3)?, rep: r.get(4)?, crest: r.get(5)?, crest_ver: r.get(6)?, ally: r.get(7)?, invite_until: r.get::<_, i64>(8)? as f64,
                ally_join_until: r.get::<_, i64>(9)? as f64, ally_found_until: r.get::<_, i64>(10)? as f64,
            })) { clans.extend(rows.flatten()); }
        }
        let mut privs = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT clan_id, grade, privs FROM clan_privs") {
            if let Ok(rows) = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))) { privs.extend(rows.flatten()); }
        }
        let mut members = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT id, name, level, cls, clan_id, clan_grade, title FROM characters WHERE clan_id IS NOT NULL") {
            if let Ok(rows) = q.query_map([], |r| Ok(ClanMemberRow { char_id: r.get(0)?, name: r.get(1)?, level: r.get(2)?, cls: r.get(3)?, clan_id: r.get(4)?, grade: r.get(5)?, title: r.get(6)? })) {
                members.extend(rows.flatten());
            }
        }
        let mut pen = vec![];
        let now = now_ms() as i64;
        if let Ok(mut q) = self.c.prepare("SELECT id, clan_join_until, clan_found_until FROM characters WHERE clan_join_until > ? OR clan_found_until > ?") {
            if let Ok(rows) = q.query_map(params![now, now], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as f64, r.get::<_, i64>(2)? as f64))) { pen.extend(rows.flatten()); }
        }
        (clans, privs, members, pen)
    }

    /** A new clan; Err when the name is taken. */
    pub fn clan_insert(&self, name: &str, leader: i64) -> Result<i64, String> {
        self.c.execute("INSERT INTO clans (name, leader, created) VALUES (?, ?, ?)", params![name, leader, now_ms() as i64])
            .map(|_| self.c.last_insert_rowid())
            .map_err(|_| "taken".to_string())
    }

    pub fn clan_save(&self, id: i64, leader: i64, level: i64, rep: i64, ally: Option<i64>, invite_until: f64) {
        let _ = self.c.execute("UPDATE clans SET leader=?, level=?, rep=?, ally=?, invite_until=? WHERE id=?", params![leader, level, rep, ally, invite_until as i64, id]);
    }

    pub fn clan_crest(&self, id: i64, png: &[u8], ver: i64) {
        let _ = self.c.execute("UPDATE clans SET crest=?, crest_ver=? WHERE id=?", params![png, ver, id]);
    }

    pub fn clan_privs(&self, id: i64, grade: i64, privs: i64) {
        let _ = self.c.execute("INSERT OR REPLACE INTO clan_privs (clan_id, grade, privs) VALUES (?, ?, ?)", params![id, grade, privs]);
    }

    /** The clan's alliance penalties (ms). */
    pub fn clan_ally_pen(&self, id: i64, join_until: f64, found_until: f64) {
        let _ = self.c.execute("UPDATE clans SET ally_join_until=?, ally_found_until=? WHERE id=?", params![join_until as i64, found_until as i64, id]);
    }

    /** Wars declared (clan on target) and the cooldowns still running before a clan may declare on a target again. */
    pub fn load_wars(&self) -> (Vec<(i64, i64)>, Vec<(i64, i64, f64)>) {
        let mut wars = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT clan, target FROM clan_wars") {
            if let Ok(rows) = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?))) { wars.extend(rows.flatten()); }
        }
        let mut cd = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT clan, target, until FROM clan_war_cd WHERE until > ?") {
            if let Ok(rows) = q.query_map([now_ms() as i64], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? as f64))) { cd.extend(rows.flatten()); }
        }
        (wars, cd)
    }

    pub fn war_add(&self, clan: i64, target: i64) {
        let _ = self.c.execute("INSERT OR IGNORE INTO clan_wars (clan, target, since) VALUES (?, ?, ?)", params![clan, target, now_ms() as i64]);
    }

    /** A declaration withdrawn; cd: the clan may not declare on the target again until then (0: no wait). */
    pub fn war_del(&self, clan: i64, target: i64, cd: f64) {
        let _ = self.c.execute("DELETE FROM clan_wars WHERE clan = ? AND target = ?", params![clan, target]);
        if cd > 0.0 { let _ = self.c.execute("INSERT OR REPLACE INTO clan_war_cd (clan, target, until) VALUES (?, ?, ?)", params![clan, target, cd as i64]); }
    }

    pub fn load_allies(&self) -> Vec<AllyRow> {
        let mut v = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT id, name, leader_clan, crest, crest_ver, invite_until FROM alliances") {
            if let Ok(rows) = q.query_map([], |r| Ok(AllyRow { id: r.get(0)?, name: r.get(1)?, leader: r.get(2)?, crest: r.get(3)?, crest_ver: r.get(4)?, invite_until: r.get::<_, i64>(5)? as f64 })) {
                v.extend(rows.flatten());
            }
        }
        v
    }

    /** A new alliance led by this clan; Err when the name is taken. */
    pub fn ally_insert(&self, name: &str, leader_clan: i64) -> Result<i64, String> {
        self.c.execute("INSERT INTO alliances (name, leader_clan, created) VALUES (?, ?, ?)", params![name, leader_clan, now_ms() as i64])
            .map(|_| self.c.last_insert_rowid()).map_err(|e| e.to_string())
    }

    pub fn ally_save(&self, id: i64, invite_until: f64) {
        let _ = self.c.execute("UPDATE alliances SET invite_until=? WHERE id=?", params![invite_until as i64, id]);
    }

    pub fn ally_crest(&self, id: i64, png: &[u8], ver: i64) {
        let _ = self.c.execute("UPDATE alliances SET crest=?, crest_ver=? WHERE id=?", params![png, ver, id]);
    }

    /** The alliance goes; its clans are on their own again. */
    pub fn ally_delete(&self, id: i64) {
        let _ = self.c.execute("DELETE FROM alliances WHERE id = ?", [id]);
        let _ = self.c.execute("UPDATE clans SET ally = NULL WHERE ally = ?", [id]);
    }

    /** Every clan's warehouse: (row id, clan, item, count, enchant, legacy, Masterwork); its adena is in clans.adena. */
    pub fn load_clan_items(&self) -> Vec<(i64, i64, String, i64, i64, bool, bool)> {
        let mut v = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT id, clan_id, item_id, count, enchant, legacy, mw FROM clan_items") {
            if let Ok(rows) = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get::<_, i64>(5)? != 0, r.get::<_, i64>(6)? != 0))) { v.extend(rows.flatten()); }
        }
        v
    }

    /** A new warehouse row; its id. */
    pub fn clan_item_add(&self, clan: i64, item: &str, count: i64, enchant: i64, legacy: bool, mw: bool) -> i64 {
        let _ = self.c.execute("INSERT INTO clan_items (clan_id, item_id, count, enchant, legacy, mw) VALUES (?, ?, ?, ?, ?, ?)", params![clan, item, count, enchant, legacy as i64, mw as i64]);
        self.c.last_insert_rowid()
    }

    /** A warehouse row's new count (0: gone). */
    pub fn clan_item_set(&self, id: i64, count: i64) {
        if count <= 0 { let _ = self.c.execute("DELETE FROM clan_items WHERE id = ?", [id]); }
        else { let _ = self.c.execute("UPDATE clan_items SET count = ? WHERE id = ?", params![count, id]); }
    }

    pub fn clan_adena(&self, clan: i64, adena: i64) {
        let _ = self.c.execute("UPDATE clans SET adena = ? WHERE id = ?", params![adena, clan]);
    }

    /** Each clan's adena (the warehouse's). */
    pub fn load_clan_adena(&self) -> Vec<(i64, i64)> {
        let mut v = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT id, adena FROM clans") {
            if let Ok(rows) = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?))) { v.extend(rows.flatten()); }
        }
        v
    }

    /** A warehouse movement: dep true = deposit. */
    pub fn clan_log(&self, clan: i64, who: &str, dep: bool, item: &str, count: i64, enchant: i64) {
        let _ = self.c.execute("INSERT INTO clan_log (clan_id, at, who, dep, item_id, count, enchant) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![clan, now_ms() as i64, who, dep as i64, item, count, enchant]);
    }

    /** The latest warehouse movements of every clan, newest first: (clan, at, who, dep, item, count, enchant). */
    pub fn load_clan_log(&self, per_clan: usize) -> Vec<(i64, f64, String, bool, String, i64, i64)> {
        let mut v = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT clan_id, at, who, dep, item_id, count, enchant FROM clan_log c
            WHERE (SELECT COUNT(*) FROM clan_log n WHERE n.clan_id = c.clan_id AND n.id > c.id) < ? ORDER BY id DESC") {
            if let Ok(rows) = q.query_map([per_clan as i64], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as f64, r.get(2)?, r.get::<_, i64>(3)? != 0, r.get(4)?, r.get(5)?, r.get(6)?))) {
                v.extend(rows.flatten());
            }
        }
        v
    }

    pub fn load_clan_skills(&self) -> Vec<(i64, String, i64)> {
        let mut v = vec![];
        if let Ok(mut q) = self.c.prepare("SELECT clan_id, skill, level FROM clan_skills") {
            if let Ok(rows) = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))) { v.extend(rows.flatten()); }
        }
        v
    }

    pub fn clan_skill(&self, clan: i64, skill: &str, level: i64) {
        let _ = self.c.execute("INSERT OR REPLACE INTO clan_skills (clan_id, skill, level) VALUES (?, ?, ?)", params![clan, skill, level]);
    }

    /** The clan goes, and every member is free again. */
    pub fn clan_delete(&self, id: i64) {
        let _ = self.c.execute("DELETE FROM clans WHERE id = ?", [id]);
        let _ = self.c.execute("DELETE FROM clan_privs WHERE clan_id = ?", [id]);
        let _ = self.c.execute("DELETE FROM clan_wars WHERE clan = ?1 OR target = ?1", [id]);
        let _ = self.c.execute("DELETE FROM clan_items WHERE clan_id = ?", [id]);
        let _ = self.c.execute("DELETE FROM clan_log WHERE clan_id = ?", [id]);
        let _ = self.c.execute("DELETE FROM clan_skills WHERE clan_id = ?", [id]);
        let _ = self.c.execute("DELETE FROM clan_war_cd WHERE clan = ?1 OR target = ?1", [id]);
        let _ = self.c.execute("DELETE FROM fort_owner WHERE clan_id = ?", [id]);
        let _ = self.c.execute("UPDATE characters SET clan_id = NULL, clan_grade = 5, title = '' WHERE clan_id = ?", [id]);
    }

    /** A character's membership (None: no clan), grade and title. */
    pub fn char_clan(&self, char_id: i64, clan: Option<i64>, grade: i64, title: &str) {
        let _ = self.c.execute("UPDATE characters SET clan_id=?, clan_grade=?, title=? WHERE id=?", params![clan, grade, title, char_id]);
    }

    pub fn char_clan_penalty(&self, char_id: i64, join_until: f64, found_until: f64) {
        let _ = self.c.execute("UPDATE characters SET clan_join_until=?, clan_found_until=? WHERE id=?", params![join_until as i64, found_until as i64, char_id]);
    }

}

pub struct ClanRow {
    pub id: i64, pub name: String, pub leader: i64, pub level: i64, pub rep: i64, pub crest: Option<Vec<u8>>, pub crest_ver: i64, pub ally: Option<i64>, pub invite_until: f64,
    pub ally_join_until: f64, pub ally_found_until: f64,
}
pub struct AllyRow { pub id: i64, pub name: String, pub leader: i64, pub crest: Option<Vec<u8>>, pub crest_ver: i64, pub invite_until: f64 }
pub struct ClanMemberRow { pub char_id: i64, pub name: String, pub level: i64, pub cls: String, pub clan_id: i64, pub grade: i64, pub title: String }

/**
 * Once per database: every piece of the set that was S before the level 78 cap (look: 'S' in the data) that already
 * exists, in a bag or a clan warehouse, becomes legacy: whoever had it keeps wearing it at any level. Pieces made or
 * dropped later are not marked.
 */
fn mark_legacy_s(c: &Connection) {
    let done: Option<String> = c.query_row("SELECT value FROM meta WHERE key = 'legacy_s_v1'", [], |r| r.get(0)).optional().ok().flatten();
    if done.is_some() { return; }
    let ids: Vec<String> = d().items.values().filter(|i| i.look.as_deref() == Some("S")).map(|i| i.id.clone()).collect();
    let mut n = 0;
    for id in &ids {
        n += c.execute("UPDATE items SET legacy = 1 WHERE item_id = ?", [id]).unwrap_or(0);
        n += c.execute("UPDATE clan_items SET legacy = 1 WHERE item_id = ?", [id]).unwrap_or(0);
    }
    let _ = c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_s_v1', ?)", [crate::world::now_ms().to_string()]);
    eprintln!("[db] {n} pieces of the old S set marked legacy (wearable at any level)");
}
