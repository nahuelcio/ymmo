//! World threads: the overworld and one thread per raid instance, each with its own 20 Hz loop.
use crate::collision::P;
use crate::data::RaidDef;
use crate::db::Db;
use crate::i18n::Lang;
use crate::world::{now_ms, HubEvent, Member, World, TICK_MS};
use serde_json::Value;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;

/** Boss HP multiplier for a raid of n players (a solo try is still possible, just very long). */
pub fn hp_scale(n: usize) -> f64 { 0.35 + 0.65 * (n.max(1) as f64) }

pub enum WorldCmd {
    Join { member: Member, kind: &'static str, at: Option<P> },
    Msg { sid: u64, msg: Value },
    Quit { sid: u64 },
    Lang { sid: u64, lang: Lang },
    /** admin panel: server-wide announcement */
    Announce(String),
    Shutdown,
}

pub enum HubMsg {
    Event { world: u32, ev: HubEvent },
    /** the world's thread stopped (raid over, or crashed) */
    Ended { world: u32 },
    /** tick = smoothed cost in ms, max = worst single tick since the last report */
    Perf { world: u32, tick: f64, players: usize, max: f64, ents: usize },
}

/** Runs a world until it's told to stop (or, for a raid, until the last player leaves). */
pub fn run_world(id: u32, raid: Option<(&'static RaidDef, usize)>, rx: Receiver<WorldCmd>, hub: UnboundedSender<HubMsg>) {
    let hub2 = hub.clone();
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        let mut w = World::new(Db::open(), raid);
        let mut next = now_ms() + TICK_MS;
        let (mut ever_joined, started) = (false, now_ms());
        let mut last_save = now_ms();
        let mut last_perf = now_ms();
        let mut tick_max = 0.0f64;
        loop {
            let wait = (next - now_ms()).max(0.0);
            match rx.recv_timeout(Duration::from_micros((wait * 1000.0) as u64)) {
                Ok(cmd) => match cmd {
                    WorldCmd::Join { member, kind, at } => {
                        let sid = member.sid;
                        match w.join(member, kind, at) {
                            Some(pid) => {
                                ever_joined = true;
                                if w.raid.is_some() {
                                    w.join_group(pid);
                                    let r = w.raid.unwrap();
                                    w.sys(pid, &format!("Entraste a {}. Escribí /raid para salir.", r.name), &format!("You entered {}. Type /raid to leave.", r.name_en));
                                } else if kind == "enter" {
                                    let (g, name) = { let p = w.pl(pid).unwrap(); (p.look.g, p.name.clone()) };
                                    w.sys(pid, &format!("¡{} a Claudi MMO, {name}! Escribí /help para ver los comandos del chat.", if g == 'f' { "Bienvenida" } else { "Bienvenido" }), &format!("Welcome to Claudi MMO, {name}! Type /help for chat commands."));
                                    log!("[world] {name} entered ({} online)", w.players.len());
                                }
                            }
                            None => w.events.push(HubEvent::JoinFailed { sid }),
                        }
                    }
                    WorldCmd::Msg { sid, msg } => {
                        if let Some(&pid) = w.sessions.get(&sid) { w.handle(pid, &msg); }
                    }
                    WorldCmd::Quit { sid } => w.quit(sid),
                    WorldCmd::Lang { sid, lang } => {
                        if let Some(&pid) = w.sessions.get(&sid) { if let Some(p) = w.pl_mut(pid) { p.lang = lang; } }
                    }
                    WorldCmd::Announce(text) => w.announce(|_| text.clone()),
                    WorldCmd::Shutdown => {
                        for sid in w.sessions.keys().copied().collect::<Vec<_>>() { w.quit(sid); }
                        break;
                    }
                },
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let now = now_ms();
            if now >= next {
                let t0 = std::time::Instant::now();
                w.tick();
                let ms = t0.elapsed().as_secs_f64() * 1000.0;
                w.tick_cost = w.tick_cost * 0.95 + ms * 0.05;
                tick_max = tick_max.max(ms);
                next += TICK_MS;
                if next < now - TICK_MS * 5.0 { next = now + TICK_MS; } // badly behind: don't burst
            }
            if now - last_save >= 1000.0 {
                last_save = now;
                w.autosave(now);
            }
            if now - last_perf >= 5000.0 {
                last_perf = now;
                let _ = hub.send(HubMsg::Perf { world: id, tick: w.tick_cost, players: w.players.len(), max: tick_max, ents: w.ents.len() });
                tick_max = 0.0;
            }
            for ev in std::mem::take(&mut w.events) { let _ = hub.send(HubMsg::Event { world: id, ev }); }
            // a raid closes when its last player left (or nobody ever made it in)
            if w.raid.is_some() && w.players.is_empty() && (ever_joined || now - started > 20000.0) { break; }
        }
    }));
    if res.is_err() { elog!("[world {id}] crashed"); }
    let _ = hub2.send(HubMsg::Ended { world: id });
}
