//! Admin panel backend: the in-game /admin window talks to it over the game socket ({ t: "admin" }).
//! Enabled by ADMIN_PASSWORD (environment or .env). Costs nothing while no admin has the window open:
//! it only reads what the hub already tracks.
use crate::data::{d, SkillDef};
use crate::ent::Outbox;
use crate::raid::WorldCmd;
use crate::world::{now_ms, TICK_MS};
use crate::App;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::Instant;

const LOG_CAP: usize = 500;
/** (last seq, ring of (seq, time ms, is error, line)) */
static LOGS: Mutex<(u64, VecDeque<(u64, f64, bool, String)>)> = Mutex::new((0, VecDeque::new()));
/** (password, server start) */
static CFG: OnceLock<(Option<String>, Instant)> = OnceLock::new();
static LAST_FAIL: AtomicU64 = AtomicU64::new(0);

/** Prints the line like println!/eprintln! did and keeps it for the panel. */
pub fn log(err: bool, line: String) {
    if err { eprintln!("{line}") } else { println!("{line}") }
    let mut l = LOGS.lock().unwrap();
    l.0 += 1;
    let seq = l.0;
    if l.1.len() == LOG_CAP { l.1.pop_front(); }
    l.1.push_back((seq, now_ms(), err, line));
}

macro_rules! log { ($($a:tt)*) => { $crate::admin::log(false, format!($($a)*)) } }
macro_rules! elog { ($($a:tt)*) => { $crate::admin::log(true, format!($($a)*)) } }

/** cast-time overrides from the panel, by skill id (ms). Read on every cast; saved in the db so they survive restarts. */
static CASTS: OnceLock<RwLock<HashMap<String, f64>>> = OnceLock::new();

fn casts() -> &'static RwLock<HashMap<String, f64>> { CASTS.get_or_init(|| RwLock::new(HashMap::new())) }

/** The panel's cast time for a skill, if an admin changed it. */
pub fn cast_ms(skill: &str) -> Option<f64> { casts().read().unwrap().get(skill).copied() }

/** balance overrides from the panel, by key (see `tunables`). Read on every use; saved in the db like the casts. */
static BALANCE: OnceLock<RwLock<HashMap<String, f64>>> = OnceLock::new();

fn balance() -> &'static RwLock<HashMap<String, f64>> { BALANCE.get_or_init(|| RwLock::new(HashMap::new())) }

/** The value the panel set for a balance key, or the game.json base when nobody changed it. */
pub fn bal(key: &str, base: f64) -> f64 { balance().read().unwrap().get(key).copied().unwrap_or(base) }

/** A skill with the panel's power/mp/cooldown/range/aoe applied. A clone: skills are few and only read when cast. */
pub fn tuned_skill(s: &SkillDef) -> SkillDef {
    let k = |f: &str| format!("skill.{}.{f}", s.id);
    SkillDef {
        power: bal(&k("power"), s.power), mp: bal(&k("mp"), s.mp), cooldown: bal(&k("cooldown"), s.cooldown),
        range: bal(&k("range"), s.range), aoe: s.aoe.map(|a| bal(&k("aoe"), a)), ..s.clone()
    }
}

/** One number the panel can change. The key is `kind.id.field`, field named as in game.json, so an export pastes back as-is. */
pub struct Tunable { pub key: String, pub label: String, pub base: f64, pub min: f64, pub max: f64 }

/** Every tunable number with its game.json base and the range the panel accepts. This list is the whitelist. */
pub fn tunables() -> Vec<Tunable> {
    let data = d();
    let mut v = Vec::new();
    let mut add = |key: String, label: String, base: f64, (min, max): (f64, f64)| v.push(Tunable { key, label, base, min, max });
    // 0 up to 3x the base plus 10: a value can be doubled or zeroed without a range per field
    let span = |b: f64| (0.0, b * 3.0 + 10.0);
    // cast time is not here: it has its own table (cast_ms), so there is one store per value
    for s in &data.skills {
        for (f, b) in [("power", Some(s.power)), ("mp", Some(s.mp)), ("cooldown", Some(s.cooldown)), ("range", Some(s.range)), ("aoe", s.aoe)] {
            if let Some(b) = b { add(format!("skill.{}.{f}", s.id), format!("{} {f}", s.name_en), b, span(b)); }
        }
    }
    for i in data.items.values() {
        for (f, b) in [("pAtk", i.p_atk), ("mAtk", i.m_atk), ("pDef", i.p_def), ("mDef", i.m_def), ("hp", i.hp), ("mp", i.mp)] {
            if let Some(b) = b { add(format!("item.{}.{f}", i.id), format!("{} {f}", i.name_en), b, span(b)); }
        }
        if let Some(c) = i.cdr { add(format!("item.{}.cdr", i.id), format!("{} cdr", i.name_en), c, (0.0, 0.5)); }
    }
    for m in data.mobs.values() {
        for (f, b) in [("hpMult", m.hp_mult), ("atkMult", m.atk_mult), ("defMult", m.def_mult)] {
            add(format!("mob.{}.{f}", m.id), format!("{} {f}", m.name_en), b.unwrap_or(1.0), (0.1, 5.0));
        }
    }
    for c in data.classes.values() {
        for (f, b) in [("baseHp", c.base_hp), ("hpLvl", c.hp_lvl), ("baseMp", c.base_mp), ("mpLvl", c.mp_lvl)] {
            add(format!("class.{}.{f}", c.id), format!("{} {f}", c.id), b, span(b));
        }
    }
    v.sort_by(|a, b| a.key.cmp(&b.key));
    v
}

/** True when the key is a tunable and the value is in its range (None = clear the override, always fine for a tunable). */
pub fn valid_balance(key: &str, value: Option<f64>) -> bool {
    tunables().iter().any(|t| t.key == key && value.map_or(true, |v| (t.min..=t.max).contains(&v)))
}

pub fn init() {
    let pass = std::env::var("ADMIN_PASSWORD").ok().filter(|p| !p.is_empty());
    if pass.as_ref().is_some_and(|p| p.len() < 8) { elog!("[admin] ADMIN_PASSWORD is shorter than 8 characters: panel disabled"); }
    let _ = CFG.set((pass.filter(|p| p.len() >= 8), Instant::now()));
    let db = crate::db::Db::open();
    *casts().write().unwrap() = db.cast_overrides().into_iter().collect();
    *balance().write().unwrap() = db.balance_overrides().into_iter().collect();
}

/** Sets or clears one balance value. Refuses keys outside the whitelist and values outside their range. */
fn set_balance(app: &App, key: &str, value: Option<f64>) -> bool {
    if !valid_balance(key, value) { return false; }
    app.db.lock().unwrap().set_balance(key, value);
    match value {
        Some(v) => balance().write().unwrap().insert(key.to_string(), v),
        None => balance().write().unwrap().remove(key),
    };
    log!("[admin] balance {key} -> {}", value.map_or("base".to_string(), |v| v.to_string()));
    true
}

/** Sets or clears one skill's cast time. Refuses unknown skills and values outside 100..=10000 ms. */
fn set_cast(app: &App, skill: &str, ms: Option<f64>) -> bool {
    let Some(def) = d().skill(skill) else { return false };
    if ms.is_some_and(|v| !(100.0..=10000.0).contains(&v)) { return false; }
    app.db.lock().unwrap().set_cast(&def.id, ms);
    match ms {
        Some(v) => casts().write().unwrap().insert(def.id.clone(), v),
        None => casts().write().unwrap().remove(&def.id),
    };
    log!("[admin] cast time {} -> {}", def.id, ms.map_or("base".to_string(), |v| format!("{v} ms")));
    true
}

/** Constant time: doesn't leak how many leading bytes matched. */
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/** Resident memory in bytes (Linux only). ponytail: assumes 4 KiB pages; use sysconf if we ever run elsewhere. */
fn rss() -> Option<u64> {
    let s = std::fs::read_to_string("/proc/self/statm").ok()?;
    Some(s.split(' ').nth(1)?.parse::<u64>().ok()? * 4096)
}

/** { t: "admin", pass?, since?, kick?, announce? } → the server state, or ok: false until the password was given. */
pub fn handle(app: &App, sid: u64, out: &Outbox, m: &Value) {
    let deny = || out.text(json!({ "t": "admin", "ok": false }).to_string());
    let Some((Some(pass), start)) = CFG.get() else { return deny() };
    let (worlds, sess, conns) = {
        let hub = &mut *app.hub.lock().unwrap();
        let Some(s) = hub.sessions.get_mut(&sid) else { return };
        if let Some(given) = m["pass"].as_str() {
            let now = now_ms() as u64;
            // ponytail: one guess per second for the whole server, so a flood of wrong guesses also locks the
            // real admin out while it lasts. Per-address limits if that ever happens.
            if now.saturating_sub(LAST_FAIL.load(Ordering::Relaxed)) < 1000 { return deny(); }
            if ct_eq(pass.as_bytes(), given.as_bytes()) {
                s.admin = true;
                log!("[admin] account {} opened the panel", s.account_id);
            } else {
                LAST_FAIL.store(now, Ordering::Relaxed);
                elog!("[admin] wrong password from account {}", s.account_id);
            }
        }
        if !s.admin { return deny(); }
        if let Some(k) = m["kick"].as_u64() {
            if let Some(o) = hub.sessions.get(&k) { o.kick.notify_one(); log!("[admin] kicked session {k}"); }
        }
        let text: String = m["announce"].as_str().unwrap_or("").trim().chars().filter(|c| !c.is_control()).take(200).collect();
        if !text.is_empty() {
            for tx in hub.worlds.values() { let _ = tx.send(WorldCmd::Announce(text.clone())); }
            log!("[admin] announce: {text}");
        }
        let worlds: Vec<Value> = hub.perf.iter().map(|(id, p)| json!({ "id": id, "tick": p.0, "players": p.1, "max": p.2, "ents": p.3 })).collect();
        let sess: Vec<(u64, i64, u32, usize)> = hub.sessions.iter().filter_map(|(sid, s)| Some((*sid, s.char_id, s.world?, s.out.pending.load(Ordering::Relaxed)))).collect();
        (worlds, sess, hub.sessions.len())
    };
    // past the admin check above, so only the panel reaches this
    if let Some(skill) = m["setCast"]["skill"].as_str() { set_cast(app, skill, m["setCast"]["ms"].as_f64()); }
    if let Some(key) = m["setBalance"]["key"].as_str() {
        match &m["setBalance"]["value"] {
            Value::Null => { set_balance(app, key, None); }
            v => if let Some(n) = v.as_f64() { set_balance(app, key, Some(n)); },
        }
    }
    let casts_json: Vec<Value> = d().skills.iter().map(|s| json!({ "id": s.id, "name": s.name, "base": s.cast, "cast": cast_ms(&s.id).unwrap_or(s.cast) })).collect();
    let balance_json: Vec<Value> = tunables().iter().map(|t| json!({ "key": t.key, "label": t.label, "base": t.base, "current": bal(&t.key, t.base), "min": t.min, "max": t.max })).collect();
    let players: Vec<Value> = {
        // ponytail: one lookup per online player per poll; cache the names in Sess if this ever shows up in a profile
        let db = app.db.lock().unwrap();
        sess.into_iter().map(|(sid, cid, world, queue)| {
            let (name, level) = db.c.query_row("SELECT name, level FROM characters WHERE id = ?", [cid], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).unwrap_or_default();
            json!({ "sid": sid, "name": name, "level": level, "world": world, "queue": queue })
        }).collect()
    };
    let since = m["since"].as_u64().unwrap_or(0);
    let (seq, logs): (u64, Vec<Value>) = {
        let l = LOGS.lock().unwrap();
        (l.0, l.1.iter().filter(|e| e.0 > since).map(|e| json!({ "t": e.1, "err": e.2, "line": e.3 })).collect())
    };
    out.text(json!({ "t": "admin", "ok": true, "uptime": start.elapsed().as_secs(), "rss": rss(), "conns": conns, "tickMs": TICK_MS, "worlds": worlds, "players": players, "seq": seq, "logs": logs, "casts": casts_json, "balance": balance_json }).to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_ring_and_password_compare() {
        for i in 0..LOG_CAP + 10 { log(false, format!("line {i}")); }
        let l = LOGS.lock().unwrap();
        assert_eq!(l.1.len(), LOG_CAP);
        assert_eq!(l.1.back().unwrap().0, l.0);
        assert_eq!(l.1.front().unwrap().0, l.0 - LOG_CAP as u64 + 1);
        assert!(ct_eq(b"secret-pass", b"secret-pass"));
        assert!(!ct_eq(b"secret-pass", b"secret-pasX"));
        assert!(!ct_eq(b"secret-pass", b"secret"));
    }

    #[test]
    fn balance_fallback_and_whitelist() {
        assert_eq!(bal("skill.power_strike.power", 1.8), 1.8, "no override: the base");
        assert!(valid_balance("skill.power_strike.power", Some(2.5)) && valid_balance("skill.power_strike.power", None));
        assert!(!valid_balance("skill.power_strike.power", Some(-1.0)), "below 0");
        assert!(!valid_balance("skill.power_strike.power", Some(f64::NAN)));
        assert!(!valid_balance("skill.nope.power", Some(1.0)), "unknown skill");
        assert!(!valid_balance("skill.power_strike.cast", Some(1000.0)), "cast has its own table");
        assert!(!valid_balance("mob.keltir.hpMult", Some(6.0)), "mob multipliers stop at 5");
    }
}
