//! Client messages inside a world (port of World.handle / handleMsg).
use crate::ent::*;
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
        match t {
            "move" => {
                let (x, z) = (num(m, "x"), num(m, "z"));
                if dead || !x.is_finite() || !z.is_finite() { return; }
                let p = self.pl_mut(pid).unwrap();
                p.casting = None;
                p.talking_to = None;
                p.intent = Some(Intent::Move { x, z });
            }
            "pong" => {
                let rtt = now - num(m, "s");
                if (0.0..5000.0).contains(&rtt) { let p = self.pl_mut(pid).unwrap(); p.rtt = p.rtt * 0.7 + rtt * 0.3; }
            }
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
            "unequip" => {
                let slot = s(m, "slot");
                if ["weapon", "head", "chest", "legs", "gloves", "feet"].contains(&slot.as_str()) { self.unequip(pid, &slot); }
            }
            "use" => if let Some(u) = id(m, "u") { self.use_item(pid, u, now) },
            "destroy" => if let Some(u) = id(m, "u") { self.destroy_item(pid, u) },
            "buy" => if let Some(n) = id(m, "npc") { self.buy(pid, n, &s(m, "item"), num(m, "qty")) },
            "sell" => if let (Some(n), Some(u)) = (id(m, "npc"), id(m, "u")) { self.sell(pid, n, u, num(m, "qty")) },
            "teleport" => if let Some(n) = id(m, "npc") { self.gatekeeper(pid, n, &s(m, "dest")) },
            "questAccept" => if let Some(n) = id(m, "npc") { self.accept_quest(pid, n) },
            "questTurnIn" => if let Some(n) = id(m, "npc") {
                let xp = self.turn_in_quest(pid, n);
                if xp > 0 { self.gain_xp(pid, xp as f64); }
            },
            "chat" => self.handle_chat(pid, &s(m, "text")),
            "partyInvite" => self.party_invite(pid, &s(m, "name")),
            "partyRespond" => self.party_respond(pid, truthy(m, "accept")),
            "partyLeave" => self.party_leave(pid, false),
            "respawn" => {
                // dying in a raid sends you back to the village
                if self.raid.is_some() { self.exit_to_town(pid) } else { self.respawn_player(pid) }
            }
            "pvpMode" => self.set_pvp_mode(pid, truthy(m, "on")),
            "autoLoot" => self.pl_mut(pid).unwrap().auto_loot = truthy(m, "on"),
            "dash" => self.dash(pid, num(m, "x"), num(m, "z"), num(m, "dx"), num(m, "dz"), now),
            _ => {}
        }
    }
}
