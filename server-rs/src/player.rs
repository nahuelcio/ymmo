//! Per-tick player update: regen, buffs, escape, casting, intents (port of server/src/systems/player.ts).
use crate::ent::*;
use crate::formulas::{BOW_RANGE, MELEE_RANGE};
use crate::data::d;
use crate::world::World;

impl World {
    pub fn update_player(&mut self, pid: u32, dt: f64, now: f64) {
        let e = self.ents.get_mut(&pid).unwrap();
        if e.c.dead { return; }
        let stunned = e.c.has("stun", now);
        let wound = e.c.heal_mul(now);
        let (px, pz) = (e.c.x, e.c.z);
        let p = e.player_mut().unwrap();
        let s = p.stats.clone();
        // sitting down out of combat recovers much faster (as in L2)
        let regen = if now - p.last_combat < 5000.0 { 0.6 } else if p.sitting.is_some() { 1.5 * 2.5 } else { 1.5 };
        p.hp = (p.hp + s.hp_regen * dt * regen * wound).min(s.max_hp);
        p.mp = (p.mp + s.mp_regen * dt * regen).min(s.max_mp);
        p.cp = (p.cp + s.cp_regen * dt).min(s.max_cp);
        if p.god { (p.hp, p.mp, p.cp) = (s.max_hp, s.max_mp, s.max_cp); }

        if p.buffs.iter().any(|b| b.until <= now) {
            p.buffs.retain(|b| b.until > now);
            p.recalc();
        }

        if p.escape_at > 0.0 && now >= p.escape_at {
            p.escape_at = 0.0;
            let pt = self.town_point(Some(pid));
            self.teleport(pid, pt.x, pt.z);
            return;
        }

        // a full-PvP zone: flagged, and in PvP mode, all the while inside; leaving, the flag runs out as usual
        let crossed = {
            let p = self.pl_mut(pid).unwrap();
            let inside = crate::terrain::in_pvp_zone(px, pz);
            let was = std::mem::replace(&mut p.in_pvp, inside);
            if inside {
                p.pvp_until = now + crate::formulas::PVP_FLAG_MS;
                p.pvp_on = true;
            }
            (inside != was).then_some(inside)
        };
        match crossed {
            Some(true) => {
                let zone = crate::terrain::zone_at(px, pz);
                let en = crate::i18n::zone_name(&zone, crate::i18n::Lang::En);
                self.sys(pid, &format!("Entraste a {zone}: zona PvP. Estás flageado y cualquiera puede atacarte."), &format!("You entered {en}: a PvP zone. You are flagged and anyone can attack you."));
            }
            Some(false) => self.sys(pid, "Saliste de la zona PvP: tu flag se va en 30 segundos.", "You left the PvP zone: your flag wears off in 30 seconds."),
            None => {}
        }

        if stunned {
            self.ents.get_mut(&pid).unwrap().c.moving = false;
            return;
        }

        // The roll already moved the body. Resume the same intent once it ends.
        if self.pl(pid).unwrap().dodge_until > now {
            self.ents.get_mut(&pid).unwrap().c.moving = false;
            return;
        }

        let p = self.pl(pid).unwrap();
        if let Some((_, _, end)) = p.casting {
            if now >= end {
                self.finish_cast(pid, now);
                self.fire_queued(pid, now);
            }
            return;
        }
        if self.tick_gather(pid, now) { return; }
        // getting up: whatever was asked for (walk, attack, talk) starts once the get-up clip is over
        if now < self.pl(pid).unwrap().stand_until {
            self.ents.get_mut(&pid).unwrap().c.moving = false;
            return;
        }

        let Some(it) = self.pl(pid).unwrap().intent.clone() else {
            self.ents.get_mut(&pid).unwrap().c.moving = false;
            return;
        };
        let speed = s.speed;
        match it {
            Intent::Move { x, z } => {
                if self.step_toward(pid, x, z, speed, dt, 0.05) { self.pl_mut(pid).unwrap().intent = None; }
            }
            Intent::Attack { id, force } => {
                let ok = self.ents.get(&id).map_or(false, |t| t.is_fighter()) && self.can_attack(pid, id, force, now).is_none();
                if !ok {
                    let e = self.ents.get_mut(&pid).unwrap();
                    e.c.moving = false;
                    e.player_mut().unwrap().intent = None;
                    return;
                }
                let (tx, tz, tr) = { let c = &self.ents[&id].c; (c.x, c.z, c.radius) };
                // a bow shoots from afar
                let range = if self.pl(pid).unwrap().weapon_type() == Some("bow") { BOW_RANGE } else { MELEE_RANGE } + tr;
                let pc = &self.ents[&pid].c;
                if (pc.x - tx).hypot(pc.z - tz) > range {
                    self.step_toward(pid, tx, tz, speed, dt, range - 0.3);
                } else {
                    self.ents.get_mut(&pid).unwrap().c.moving = false;
                    self.face(pid, id);
                    // no fighting while swimming
                    let (px, pz) = { let c = &self.ents[&pid].c; (c.x, c.z) };
                    if d().is_deep(px, pz) { return; }
                    let p = self.pl_mut(pid).unwrap();
                    if now >= p.next_attack {
                        p.next_attack = now + s.atk_interval;
                        self.auto_attack(pid, id, now);
                    }
                }
            }
            Intent::Skill { skill, target, force } => self.process_skill_intent(pid, &skill, target, force, dt, now),
            Intent::Pickup { id } => {
                let ok = matches!(self.ents.get(&id).map(|e| &e.k), Some(Kind::Item(_)));
                if !ok {
                    let e = self.ents.get_mut(&pid).unwrap();
                    e.c.moving = false;
                    e.player_mut().unwrap().intent = None;
                    return;
                }
                let (tx, tz) = { let c = &self.ents[&id].c; (c.x, c.z) };
                if self.step_toward(pid, tx, tz, speed, dt, 1.2) {
                    self.pl_mut(pid).unwrap().intent = None;
                    self.pickup(pid, id, now);
                }
            }
            Intent::Interact { node } => self.process_interact(pid, node, speed, dt, now),
            Intent::Talk { id } => {
                let Some(kind) = self.ents.get(&id).and_then(|e| if let Kind::Npc(n) = &e.k { Some(n.def.kind.clone()) } else { None }) else {
                    self.pl_mut(pid).unwrap().intent = None;
                    return;
                };
                let (tx, tz) = { let c = &self.ents[&id].c; (c.x, c.z) };
                if self.step_toward(pid, tx, tz, speed, dt, 2.5) {
                    self.pl_mut(pid).unwrap().intent = None;
                    self.face(pid, id);
                    if kind == "quest" { self.open_quest(pid, id); } else { self.open_npc(pid, id); }
                }
            }
        }
    }
}
