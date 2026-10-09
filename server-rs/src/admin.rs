//! Admin panel backend: the in-game /admin window talks to it over the game socket ({ t: "admin" }).
//! Enabled by ADMIN_PASSWORD (environment or .env). Costs nothing while no admin has the window open:
//! it only reads what the hub already tracks.
use crate::ent::Outbox;
use crate::raid::WorldCmd;
use crate::world::{now_ms, TICK_MS};
use crate::App;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
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

pub fn init() {
    let pass = std::env::var("ADMIN_PASSWORD").ok().filter(|p| !p.is_empty());
    if pass.as_ref().is_some_and(|p| p.len() < 8) { elog!("[admin] ADMIN_PASSWORD is shorter than 8 characters: panel disabled"); }
    let _ = CFG.set((pass.filter(|p| p.len() >= 8), Instant::now()));
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
    out.text(json!({ "t": "admin", "ok": true, "uptime": start.elapsed().as_secs(), "rss": rss(), "conns": conns, "tickMs": TICK_MS, "worlds": worlds, "players": players, "seq": seq, "logs": logs }).to_string());
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
}
