//! Client messages inside a world (port of World.handle / handleMsg).
use crate::collision::P;
use crate::ent::*;
use crate::data::d;
use crate::world::{now_ms, World};
use serde_json::Value;

fn num(m: &Value, k: &str) -> f64 { m.get(k).and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(f64::NAN) }
fn id(m: &Value, k: &str) -> Option<u32> { let v = num(m, k); if v.is_finite() && v >= 0.0 { Some(v as u32) } else { None } }
fn truthy(m: &Value, k: &str) -> bool {
    match m.get(k) { Some(Value::Bool(b)) => *b, Some(Value::Number(n)) => n.as_f64().map_or(false, |v| v != 0.0), Some(Value::String(s)) => !s.is_empty(), Some(Value::Null) | None => false, _ => true }
}
fn s(m: &Value, k: &str) -> String {
    match m.get(k) { Some(Value::String(s)) => s.clone(), Some(Value::Null) | None => String::new(), Some(v) => v.to_string() }
}

impl World {
    pub fn handle(&mut self, pid: u32, m: &Value) {
        let now = now_ms();
        let t = m.get("t").and_then(|v| v.as_str()).unwrap_or("");
        self.handle_msg(pid, t, m, now);
        // act on interactions right away instead of waiting for the next tick
        if matches!(t, "attack" | "pickup" | "talk" | "skill") && self.pl(pid).map_or(false, |p| p.intent.is_some()) {
            self.update_player(pid, 0.0, now);
        }
    }

    fn handle_msg(&mut self, pid: u32, t: &str, m: &Value, now: f64) {
        if !self.ents.contains_key(&pid) { return; }
        let dead = self.ents[&pid].c.dead;
        // doing anything else gets a sitting player up and drops a gather in progress
        if matches!(t, "move" | "attack" | "skill" | "pickup" | "talk" | "dash" | "use" | "respawn") { self.idle_interrupt(pid); }
        let swimming = { let c = &self.ents[&pid].c; d().is_deep(c.x, c.z) };
        if swimming && matches!(t, "attack" | "skill") { return self.sys(pid, "No podés pelear nadando.", "You cannot fight while swimming."); }
        match t {
            "move" => {
                let (x, z) = (num(m, "x"), num(m, "z"));
                if dead || !x.is_finite() || !z.is_finite() { return; }
                // a cast goes on (update_player waits for it): the walk starts when it ends. Esc is what cancels a cast
                let p = self.pl_mut(pid).unwrap();
                p.talking_to = None;
                p.intent = Some(Intent::Move { x, z });
                // the route the client walks (it predicts along it): followed when sound, so both go the same way
                let pts: Vec<P> = m["path"].as_array().map_or(Vec::new(), |a| a.iter().take(64)
                    .filter_map(|w| Some(P { x: w.get(0)?.as_f64()?, z: w.get(1)?.as_f64()? }))
                    .filter(|w| w.x.is_finite() && w.z.is_finite()).collect());
                if pts.is_empty() { if let Some(e) = self.ents.get_mut(&pid) { e.c.nav = None; } } else { self.client_path(pid, x, z, pts); }
            }
            "pong" => {
                let rtt = now - num(m, "s");
                if (0.0..5000.0).contains(&rtt) { let p = self.pl_mut(pid).unwrap(); p.rtt = p.rtt * 0.7 + rtt * 0.3; }
            }
            // Esc: the cast stops, its MP and cooldown spent all the same
            "cancel" => self.stop_cast(pid, true, now),
            "stop" => {
                self.pl_mut(pid).unwrap().intent = None;
                self.ents.get_mut(&pid).unwrap().c.moving = false;
            }
            "target" => {
                let tid = id(m, "id");
                let ok = tid.map_or(false, |x| self.ents.contains_key(&x));
                let p = self.pl_mut(pid).unwrap();
                if m.get("id").map_or(true, |v| v.is_null()) { p.target = None; } else if ok { p.target = tid; }
            }
            "attack" => {
                let Some(tid) = id(m, "id").filter(|x| self.ents.contains_key(x)) else { return };
                if dead { return; }
                let force = truthy(m, "force");
                self.pl_mut(pid).unwrap().target = Some(tid);
                if let Some(err) = self.can_attack(pid, tid, force, now) { return self.sys(pid, &err, &err); }
                let p = self.pl_mut(pid).unwrap();
                if p.casting.is_some() { return; }
                p.intent = Some(Intent::Attack { id: tid, force });
            }
            "skill" => self.request_skill(pid, &s(m, "skill"), truthy(m, "force"), now),
            "pickup" => {
                let Some(gid) = id(m, "id") else { return };
                if !dead && matches!(self.ents.get(&gid).map(|e| &e.k), Some(Kind::Item(_))) { self.pl_mut(pid).unwrap().intent = Some(Intent::Pickup { id: gid }); }
            }
            "talk" => {
                let Some(nid) = id(m, "id") else { return };
                if !dead && matches!(self.ents.get(&nid).map(|e| &e.k), Some(Kind::Npc(_))) {
                    let p = self.pl_mut(pid).unwrap();
                    p.target = Some(nid);
                    p.intent = Some(Intent::Talk { id: nid });
                }
            }
            "equip" => if let Some(u) = id(m, "u") { self.equip(pid, u) },
            "unequip" => self.unequip(pid, &s(m, "slot")),
            "use" => if let Some(u) = id(m, "u") { self.use_item(pid, u, now) },
            "enchant" => if let Some(u) = id(m, "u") { self.enchant(pid, u, truthy(m, "sacred"), truthy(m, "protect")) },
            "destroy" => if let Some(u) = id(m, "u") { self.destroy_item(pid, u) },
            "buy" => if let Some(n) = id(m, "npc") { self.buy(pid, n, &s(m, "item"), num(m, "qty")) },
            "craft" => if let Some(n) = id(m, "npc") { self.craft(pid, n, &s(m, "item")) },
            "sell" => if let (Some(n), Some(u)) = (id(m, "npc"), id(m, "u")) { self.sell(pid, n, u, num(m, "qty")) },
            "teleport" => if let Some(n) = id(m, "npc") { self.gatekeeper(pid, n, &s(m, "dest")) },
            // `quest`: which contract, at the board (a story giver has its one)
            "questAccept" => if let Some(n) = id(m, "npc") { self.accept_quest(pid, n, m.get("quest").and_then(|v| v.as_str())) },
            "questTurnIn" => if let Some(n) = id(m, "npc") {
                let xp = self.turn_in_quest(pid, n, m.get("quest").and_then(|v| v.as_str()));
                if xp > 0 { self.gain_xp(pid, xp as f64); }
            },
            "chat" => self.handle_chat(pid, &s(m, "text")),
            "partyInvite" => self.party_invite(pid, &s(m, "name")),
            "partyRespond" => self.party_respond(pid, truthy(m, "accept")),
            "partyLeave" => self.party_leave(pid, false),
            "tradeRequest" => match id(m, "id") { Some(t) => self.trade_request(pid, t), None => self.trade_request_named(pid, &s(m, "name")) },
            "tradeRespond" => self.trade_respond(pid, truthy(m, "accept")),
            "tradeAdd" => if let Some(u) = id(m, "u") { self.trade_add(pid, u, num(m, "c")) },
            "tradeAdena" => self.trade_adena(pid, num(m, "amount")),
            "tradeConfirm" => self.trade_confirm(pid),
            // gone: the socket dropped (main.rs), the character lingers a while but the trade ends now
            "tradeCancel" => {
                let name = self.pl(pid).unwrap().name.clone();
                let why = truthy(m, "gone").then(|| (format!("{name} se desconectó: el comercio se canceló."), format!("{name} disconnected: the trade has been cancelled.")));
                // the socket dropped (main.rs sends this at once): nobody comes back into an instance, so an Olympiad
                // fight is lost now, not when the character is saved
                if why.is_some() { self.arena_leave(pid); }
                self.trade_cancel(pid, why)
            }
            "clanGet" => self.clan_send(pid),
            "clanCreate" => if let Some(n) = id(m, "npc") { self.clan_create(pid, n, &s(m, "name")) },
            "clanInvite" => self.clan_invite(pid, &s(m, "name")),
            "clanRespond" => self.clan_respond(pid, truthy(m, "accept")),
            "clanLeave" => self.clan_leave(pid),
            "clanKick" => self.clan_kick(pid, &s(m, "name")),
            "clanTransfer" => self.clan_transfer(pid, &s(m, "name")),
            "clanDissolve" => if let Some(n) = id(m, "npc") { self.clan_dissolve(pid, n) },
            "clanLevelUp" => if let Some(n) = id(m, "npc") { self.clan_level_up(pid, n) },
            "clanGrade" => self.clan_grade(pid, &s(m, "name"), num(m, "grade") as u8),
            "clanPrivs" => self.clan_privs(pid, num(m, "grade") as u8, num(m, "privs") as u32),
            "clanTitle" => self.clan_title(pid, &s(m, "name"), &s(m, "title")),
            "clanCrest" => self.clan_crest(pid, &s(m, "png")),
            "clanWar" => self.clan_war(pid, &s(m, "name")),
            "clanWarEnd" => self.clan_war_end(pid, &s(m, "name")),
            "allyCreate" => if let Some(n) = id(m, "npc") { self.ally_create(pid, n, &s(m, "name")) },
            "allyInvite" => self.ally_invite(pid, &s(m, "name")),
            "allyRespond" => self.ally_respond(pid, truthy(m, "accept")),
            "allyLeave" => self.ally_leave(pid),
            "allyKick" => self.ally_kick(pid, &s(m, "name")),
            "allyDissolve" => self.ally_dissolve(pid),
            "allyCrest" => self.ally_crest(pid, &s(m, "png")),
            "clanWhOpen" => if let Some(n) = id(m, "npc") { self.clan_wh_open(pid, n) },
            "clanWhDeposit" => if let (Some(n), Some(u)) = (id(m, "npc"), id(m, "uid")) { self.clan_wh_deposit(pid, n, u, num(m, "qty")) },
            "clanWhWithdraw" => if let Some(n) = id(m, "npc") { self.clan_wh_withdraw(pid, n, num(m, "id") as i64, num(m, "qty")) },
            "clanWhAdena" => if let Some(n) = id(m, "npc") { self.clan_wh_adena(pid, n, num(m, "amount")) },
            "clanSkill" => if let Some(n) = id(m, "npc") { self.clan_skill(pid, n, &s(m, "skill")) },
            "chooseSpec" => self.choose_spec(pid, &s(m, "spec")),
            "legendSpend" => self.legend_spend(pid, &s(m, "id")),
            "legendReset" => self.legend_reset(pid),
            "heroLook" => self.choose_hero_look(pid, &s(m, "look")),
            "respawn" => {
                // dying in a raid sends you back to the village
                if self.raid.is_some() { self.exit_to_town(pid) } else { self.respawn_player(pid) }
            }
            "pvpMode" => self.set_pvp_mode(pid, truthy(m, "on")),
            "hotbar" => {
                // the client's own layout: only kept, never read here; small, and JSON
                let data = s(m, "data");
                if data.len() > 4096 || serde_json::from_str::<Value>(&data).is_err() { return; }
                let p = self.pl_mut(pid).unwrap();
                if p.hotbar != data {
                    p.hotbar = data;
                    let (cid, json) = (p.char_id, p.hotbar.clone());
                    self.db.char_hotbar(cid, &json);
                }
            }
            "autoLoot" => self.pl_mut(pid).unwrap().auto_loot = truthy(m, "on"),
            "dash" => self.dash(pid, num(m, "x"), num(m, "z"), num(m, "dx"), num(m, "dz"), now),
            "interact" => if let Some(n) = id(m, "node") { self.request_interact(pid, n, now) },
            "sit" => if !dead { self.toggle_sit(pid) },
            _ => {}
        }
    }
}
