//! Claudi MMO game server (Rust). Same protocol, data and database as the Node server in server/src.
//!
//! Threads: the async hub (sockets, login, character screen, routing) on tokio, the overworld on its
//! own thread, and one thread per raid instance. Worlds own their state; sockets talk to them by channel.
#[macro_use]
mod admin;
mod ai;
mod binary;
mod chat;
mod collision;
mod combat;
mod data;
mod db;
mod ent;
mod formulas;
mod i18n;
mod inventory;
mod msgs;
mod party;
mod player;
mod quests;
mod raid;
mod realm;
mod terrain;
mod world;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use data::d;
use db::Db;
use ent::{Look, Out, Outbox};
use futures_util::{SinkExt, StreamExt};
use i18n::{tr, Lang};
use raid::{run_world, HubMsg, WorldCmd};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, Notify};
use world::{HubEvent, Member};

const MAIN_WORLD: u32 = 0;

/** One connected socket. */
struct Sess {
    out: Outbox,
    lang: Lang,
    account_id: i64,
    /** world the character is in (None = login / character screen) and which character */
    world: Option<u32>,
    char_id: i64,
    /** close this socket (duplicate login) */
    kick: Arc<Notify>,
    /** gave the admin password on this socket (/admin) */
    admin: bool,
}

struct Hub {
    sessions: HashMap<u64, Sess>,
    worlds: HashMap<u32, Sender<WorldCmd>>,
    next_world: u32,
    /** per world: (smoothed tick ms, players, worst tick ms, entities) */
    perf: HashMap<u32, (f64, usize, f64, usize)>,
}

type Shared = Arc<Mutex<Hub>>;

#[derive(Clone)]
struct App {
    hub: Shared,
    db: Arc<Mutex<Db>>,
    hub_tx: mpsc::UnboundedSender<HubMsg>,
}

static NEXT_SID: AtomicU64 = AtomicU64::new(1);

fn member(sid: u64, s: &Sess, char_id: i64) -> Member {
    Member { sid, account_id: s.account_id, char_id, lang: s.lang, out: s.out.clone() }
}

fn send(out: &Outbox, v: Value) { out.text(v.to_string()); }

const DB_EN: [(&str, &str); 4] = [
    ("Ese nombre de cuenta ya está en uso.", "That account name is taken."),
    ("Cuenta o contraseña incorrecta.", "Wrong account name or password."),
    ("Ese nombre ya está en uso.", "That name is already taken."),
    ("Podés tener como máximo 7 personajes.", "You can have at most 7 characters."),
];
fn db_msg(l: Lang, m: &str) -> String {
    if l.en() { DB_EN.iter().find(|e| e.0 == m).map(|e| e.1.to_string()).unwrap_or_else(|| m.to_string()) } else { m.to_string() }
}

fn chars_json(db: &Db, account: i64) -> Vec<Value> {
    db.list_chars(account).into_iter().map(|c| json!({ "id": c.id, "name": c.name, "race": c.race, "cls": c.cls, "spec": c.spec, "level": c.level, "look": { "g": c.look.g.to_string(), "hs": c.look.hs, "hc": c.look.hc } })).collect()
}

fn spawn_world(app: &App, raid: Option<(&'static data::RaidDef, usize)>) -> u32 {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut hub = app.hub.lock().unwrap();
    let id = if raid.is_none() { MAIN_WORLD } else { hub.next_world += 1; hub.next_world };
    hub.worlds.insert(id, tx);
    drop(hub);
    let hub_tx = app.hub_tx.clone();
    std::thread::Builder::new().name(format!("world-{id}")).spawn(move || run_world(id, raid, rx, hub_tx)).expect("world thread");
    if let Some((r, n)) = raid { log!("[raid {id}] {} opened for {n}", r.id); }
    id
}

fn to_world(hub: &Hub, world: u32, cmd: WorldCmd) {
    if let Some(tx) = hub.worlds.get(&world) { let _ = tx.send(cmd); }
}

/** Hub events from the worlds: raid transfers, crashes, perf. */
async fn hub_loop(app: App, mut rx: mpsc::UnboundedReceiver<HubMsg>) {
    while let Some(msg) = rx.recv().await {
        match msg {
            HubMsg::Event { world, ev } => match ev {
                HubEvent::EnterRaid { raid, members } => {
                    let rid = spawn_world(&app, Some((raid, members.len())));
                    let hub = &mut *app.hub.lock().unwrap();
                    for m in members {
                        if let Some(s) = hub.sessions.get_mut(&m.sid) { s.world = Some(rid); }
                        to_world(hub, rid, WorldCmd::Join { member: m, kind: "world", at: None });
                    }
                }
                HubEvent::ToMain { member } => {
                    let hub = &mut *app.hub.lock().unwrap();
                    if let Some(s) = hub.sessions.get_mut(&member.sid) { s.world = Some(MAIN_WORLD); }
                    to_world(hub, MAIN_WORLD, WorldCmd::Join { member, kind: "world", at: None });
                }
                HubEvent::JoinFailed { sid } => {
                    let hub = &mut *app.hub.lock().unwrap();
                    let Some(s) = hub.sessions.get_mut(&sid) else { continue };
                    if world != MAIN_WORLD {
                        // couldn't get into the raid: back to the overworld
                        s.world = Some(MAIN_WORLD);
                        let m = member(sid, s, s.char_id);
                        to_world(hub, MAIN_WORLD, WorldCmd::Join { member: m, kind: "world", at: None });
                    } else {
                        s.world = None;
                        send(&s.out, json!({ "t": "error", "msg": tr(s.lang, "No se encontró el personaje.", "Character not found.") }));
                    }
                }
                HubEvent::Closed => {}
            },
            HubMsg::Ended { world } => {
                let hub = &mut *app.hub.lock().unwrap();
                hub.worlds.remove(&world);
                hub.perf.remove(&world);
                if world == MAIN_WORLD { continue; }
                log!("[raid {world}] closed");
                // anyone still inside (crash) goes back to their last save
                let stuck: Vec<u64> = hub.sessions.iter().filter(|(_, s)| s.world == Some(world)).map(|(k, _)| *k).collect();
                for sid in stuck {
                    let s = hub.sessions.get_mut(&sid).unwrap();
                    s.world = Some(MAIN_WORLD);
                    let m = member(sid, s, s.char_id);
                    to_world(hub, MAIN_WORLD, WorldCmd::Join { member: m, kind: "world", at: None });
                }
            }
            HubMsg::Perf { world, tick, players, max, ents } => {
                let mut hub = app.hub.lock().unwrap();
                hub.perf.insert(world, (tick, players, max, ents));
                if tick > 10.0 { elog!("[perf] world {world}: tick {tick:.1} ms with {players} players"); }
            }
        }
    }
}

async fn ws_handler(ws: WebSocketUpgrade, State(app): State<App>) -> impl IntoResponse {
    ws.max_message_size(16 * 1024).on_upgrade(move |socket| client(socket, app))
}

async fn client(socket: WebSocket, app: App) {
    let sid = NEXT_SID.fetch_add(1, Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
    let pending = Arc::new(AtomicUsize::new(0));
    let out = Outbox { tx, pending: pending.clone() };
    let kick = Arc::new(Notify::new());
    app.hub.lock().unwrap().sessions.insert(sid, Sess { out: out.clone(), lang: Lang::Es, account_id: 0, world: None, char_id: 0, kick: kick.clone(), admin: false });

    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            let r = match m { Out::Text(s) => sink.send(Message::Text(s)).await, Out::Bin(b) => sink.send(Message::Binary(b)).await };
            pending.fetch_sub(1, Ordering::Relaxed);
            if r.is_err() { break; }
        }
        let _ = sink.close().await;
    });

    let mut count = 0u32;
    let mut window = std::time::Instant::now();
    let mut logging_in = false;
    loop {
        let msg = tokio::select! {
            m = stream.next() => m,
            _ = kick.notified() => None,
        };
        let Some(Ok(msg)) = msg else { break };
        let text = match msg { Message::Text(t) => t, Message::Close(_) => break, _ => continue };
        if window.elapsed().as_secs() >= 1 { window = std::time::Instant::now(); count = 0; }
        count += 1;
        if count > 80 { continue; } // simple flood protection (per second)
        let Ok(m) = serde_json::from_str::<Value>(&text) else { continue };
        let Some(t) = m.get("t").and_then(|v| v.as_str()) else { continue };
        handle(&app, sid, t, &m, &mut logging_in).await;
    }

    // socket closed: save the character in whatever world it's in
    {
        let hub = &mut *app.hub.lock().unwrap();
        if let Some(s) = hub.sessions.remove(&sid) {
            if let Some(w) = s.world { to_world(hub, w, WorldCmd::Quit { sid }); }
        }
    }
    writer.abort();
}

async fn handle(app: &App, sid: u64, t: &str, m: &Value, logging_in: &mut bool) {
    let (out, lang, account, world) = {
        let hub = app.hub.lock().unwrap();
        let Some(s) = hub.sessions.get(&sid) else { return };
        (s.out.clone(), s.lang, s.account_id, s.world)
    };
    if t == "lang" {
        if let Some(l) = m.get("lang").and_then(|v| v.as_str()).and_then(Lang::parse) {
            let hub = &mut *app.hub.lock().unwrap();
            if let Some(s) = hub.sessions.get_mut(&sid) { s.lang = l; }
            if let Some(w) = world { to_world(hub, w, WorldCmd::Lang { sid, lang: l }); }
        }
        return;
    }
    if t == "admin" { return admin::handle(app, sid, &out, m); }
    if let Some(w) = world {
        let hub = app.hub.lock().unwrap();
        to_world(&hub, w, WorldCmd::Msg { sid, msg: m.clone() });
        return;
    }
    let s = |k: &str| m.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    match t {
        "login" => {
            let user = s("user").trim().to_string();
            let pass = s("pass");
            let user_ok = (3..=16).contains(&user.len()) && user.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            if !user_ok { return send(&out, json!({ "t": "error", "msg": tr(lang, "Cuenta: de 3 a 16 letras, números o _.", "Account: 3-16 letters, numbers or _.") })); }
            if pass.chars().count() < 4 || pass.chars().count() > 64 { return send(&out, json!({ "t": "error", "msg": tr(lang, "Contraseña: de 4 a 64 caracteres.", "Password: 4-64 characters.") })); }
            if *logging_in { return; }
            *logging_in = true;
            let register = m.get("register").and_then(|v| v.as_bool()).unwrap_or(false);
            let remember = m.get("remember").and_then(|v| v.as_bool()).unwrap_or(false);
            let db = app.db.clone();
            // scrypt is slow on purpose: off the async threads
            let res = tokio::task::spawn_blocking(move || -> Result<(i64, Vec<Value>, Option<String>), String> {
                let existing = db.lock().unwrap().account(&user);
                let id = if register {
                    if existing.is_some() { return Err("Ese nombre de cuenta ya está en uso.".into()); }
                    let hash = db::hash_pass(&pass);
                    db.lock().unwrap().insert_account(&user, &hash)?
                } else {
                    match existing {
                        Some((id, hash)) if db::check_pass(&pass, &hash) => id,
                        _ => return Err("Cuenta o contraseña incorrecta.".into()),
                    }
                };
                let db = db.lock().unwrap();
                Ok((id, chars_json(&db, id), if remember { Some(db.create_session(id)) } else { None }))
            }).await;
            *logging_in = false;
            match res {
                Ok(Ok((id, list, token))) => {
                    if let Some(s) = app.hub.lock().unwrap().sessions.get_mut(&sid) { s.account_id = id; }
                    let mut msg = json!({ "t": "chars", "list": list });
                    if let Some(tk) = token { msg["token"] = json!(tk); }
                    send(&out, msg);
                }
                Ok(Err(e)) => send(&out, json!({ "t": "error", "msg": db_msg(lang, &e) })),
                Err(e) => elog!("login failed: {e}"),
            }
        }
        "resume" => {
            let db = app.db.lock().unwrap();
            match db.resume_session(&s("token")) {
                Some(id) => {
                    if let Some(s) = app.hub.lock().unwrap().sessions.get_mut(&sid) { s.account_id = id; }
                    send(&out, json!({ "t": "chars", "list": chars_json(&db, id) }));
                }
                None => send(&out, json!({ "t": "resumeFail" })),
            }
        }
        "logout" => {
            app.db.lock().unwrap().delete_session(&s("token"));
            if let Some(s) = app.hub.lock().unwrap().sessions.get_mut(&sid) { s.account_id = 0; s.admin = false; }
        }
        "createChar" => {
            if account == 0 { return; }
            let name = s("name").trim().to_string();
            let name_ok = (3..=16).contains(&name.len()) && name.chars().next().map_or(false, |c| c.is_ascii_alphabetic()) && name.chars().all(|c| c.is_ascii_alphanumeric());
            if !name_ok { return send(&out, json!({ "t": "error", "msg": tr(lang, "Nombre: de 3 a 16 letras o números, empezando con una letra.", "Name: 3-16 letters/numbers, starting with a letter.") })); }
            let (race, cls) = (s("race"), s("cls"));
            let ok = d().races.get(&race).map_or(false, |r| r.classes.contains(&cls));
            if !ok { return send(&out, json!({ "t": "error", "msg": tr(lang, "Esa combinación de raza y clase no existe.", "Invalid race/class combination.") })); }
            let db = app.db.lock().unwrap();
            if let Some(err) = db.create_char(account, &name, &race, &cls, Look::sanitize(m.get("look"))) {
                return send(&out, json!({ "t": "error", "msg": db_msg(lang, &err) }));
            }
            send(&out, json!({ "t": "chars", "list": chars_json(&db, account) }));
        }
        "deleteChar" => {
            if account == 0 { return; }
            let id = m.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let db = app.db.lock().unwrap();
            db.delete_char(account, id);
            send(&out, json!({ "t": "chars", "list": chars_json(&db, account) }));
        }
        "enter" => {
            if account == 0 { return; }
            let char_id = m.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let hub = &mut *app.hub.lock().unwrap();
            // the same character online on another socket: kick it
            let other = hub.sessions.iter().find(|(k, s)| **k != sid && s.char_id == char_id && s.world.is_some()).map(|(k, s)| (*k, s.world.unwrap(), s.kick.clone()));
            if let Some((osid, ow, okick)) = other {
                okick.notify_one();
                if let Some(o) = hub.sessions.get_mut(&osid) { o.world = None; o.char_id = 0; }
                to_world(hub, ow, WorldCmd::Quit { sid: osid });
                if ow != MAIN_WORLD {
                    return send(&out, json!({ "t": "error", "msg": tr(lang, "Tu personaje está saliendo de una raid, probá de nuevo en unos segundos.", "Your character is leaving a raid, try again in a few seconds.") }));
                }
            }
            let s = hub.sessions.get_mut(&sid).unwrap();
            s.world = Some(MAIN_WORLD);
            s.char_id = char_id;
            let mb = member(sid, s, char_id);
            to_world(hub, MAIN_WORLD, WorldCmd::Join { member: mb, kind: "enter", at: None });
        }
        _ => {}
    }
}

#[tokio::main]
async fn main() {
    let t0 = std::time::Instant::now();
    // .env fills in whatever the environment doesn't set. ponytail: plain KEY=VALUE lines only (no escapes, no `export`).
    for l in std::fs::read_to_string(".env").unwrap_or_default().lines() {
        let Some((k, v)) = l.split_once('=') else { continue };
        let k = k.trim();
        if !k.is_empty() && !k.starts_with('#') && std::env::var_os(k).is_none() { std::env::set_var(k, v.trim().trim_matches('"')); }
    }
    admin::init();
    collision::warm();
    let port: u16 = std::env::var("GAME_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3001);
    let dist = std::env::var("CLIENT_DIST").unwrap_or_else(|_| "client/dist".into());
    let (hub_tx, hub_rx) = mpsc::unbounded_channel();
    let app = App {
        hub: Arc::new(Mutex::new(Hub { sessions: HashMap::new(), worlds: HashMap::new(), next_world: 0, perf: HashMap::new() })),
        db: Arc::new(Mutex::new(Db::open())),
        hub_tx,
    };
    spawn_world(&app, None);
    tokio::spawn(hub_loop(app.clone(), hub_rx));

    // perf line (like the Node server's [perf] log)
    let perf_app = app.clone();
    tokio::spawn(async move {
        let every = if std::env::var("PERF_LOG").is_ok() { 5 } else { 30 };
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(every)).await;
            let hub = perf_app.hub.lock().unwrap();
            let main = hub.perf.get(&MAIN_WORLD).copied().unwrap_or((0.0, 0, 0.0, 0));
            let raids: Vec<String> = hub.perf.iter().filter(|(k, _)| **k != MAIN_WORLD).map(|(_, (t, n, ..))| format!(" [{n}p {t:.2}ms]")).collect();
            if std::env::var("PERF_LOG").is_ok() || main.0 > 10.0 {
                log!("[perf] tick {:.2} ms · {} conns · {} raids{}", main.0, hub.sessions.len(), raids.len(), raids.join(""));
            }
        }
    });

    let static_files = tower_http::services::ServeDir::new(&dist).fallback(tower_http::services::ServeFile::new(format!("{dist}/index.html")));
    let router = Router::new().route("/ws", get(ws_handler)).fallback_service(static_files).with_state(app.clone());
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("bind");
    log!("[server] Claudi MMO (Rust) listening on http://localhost:{port} (ws: /ws) · ready in {:?}", t0.elapsed());

    let shutdown_app = app.clone();
    axum::serve(listener, router).with_graceful_shutdown(async move {
        #[cfg(unix)]
        let term = async { tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap().recv().await; };
        #[cfg(not(unix))]
        let term = std::future::pending::<()>();
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term => {} }
        // save everyone: worlds quit their players on Shutdown
        {
            let hub = shutdown_app.hub.lock().unwrap();
            for tx in hub.worlds.values() { let _ = tx.send(WorldCmd::Shutdown); }
        }
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        std::process::exit(0);
    }).await.unwrap();
}
