//! Mob AI: aggro, leash, chase, specials, threat, raid boss phases (port of server/src/systems/ai.ts).
use crate::data::d;
use crate::ent::*;
use crate::formulas::{phys_damage, rnd};
use crate::terrain::in_town;
use crate::world::World;
use serde_json::json;

const LEASH: f64 = 50.0;
const AGGRO_RANGE: f64 = 9.0;

impl World {
    fn valid_enemy(&self, pid: u32, hx: f64, hz: f64) -> bool {
        match self.ents.get(&pid) {
            Some(e) if e.player().is_some() => !e.c.dead && !in_town(e.c.x, e.c.z) && (e.c.x - hx).hypot(e.c.z - hz) <= LEASH,
            _ => false,
        }
    }

    pub fn update_mob(&mut self, mid: u32, dt: f64, now: f64) {
        let e = self.ents.get_mut(&mid).unwrap();
        let (dead, hidden) = (e.c.dead, e.c.hidden);
        if dead {
            let m = e.mob_mut().unwrap();
            if !hidden && now >= m.hide_at {
                e.c.hidden = true;
            }
            let (respawn_at, can) = { let m = self.ents[&mid].mob().unwrap(); (m.respawn_at, self.can_respawn(m, now)) };
            if now >= respawn_at && can { self.respawn_mob(mid); }
            return;
        }
        if e.c.has("stun", now) {
            e.c.moving = false;
            return;
        }
        let (hx, hz) = { let m = e.mob().unwrap(); (m.home_x, m.home_z) };
        let (mx, mz) = (e.c.x, e.c.z);
        if let Some(t) = e.mob().unwrap().target {
            let tvalid = self.valid_enemy(t, hx, hz) && (mx - hx).hypot(mz - hz) <= LEASH;
            if !tvalid {
                let cands: Vec<(u32, f64)> = { let m = self.ents[&mid].mob().unwrap(); m.threat.iter().copied().filter(|e| e.0 != t).collect() };
                let mut best = -1.0;
                let mut next = None;
                for (id, h) in cands {
                    if self.valid_enemy(id, hx, hz) && h > best { best = h; next = Some(id); }
                }
                let m = self.ents.get_mut(&mid).unwrap().mob_mut().unwrap();
                map_del(&mut m.hate, t);
                map_del(&mut m.threat, t);
                m.target = next;
                m.taunt_until = 0.0;
                if next.is_none() {
                    m.hate.clear();
                    m.threat.clear();
                    m.phase = 0;
                    m.haste = 1.0;
                    m.special = m.tpl.special.clone();
                    m.returning = true;
                    m.special_at = 0.0;
                    m.winding = None;
                }
            }
        }

        if self.ents[&mid].mob().unwrap().returning {
            let speed = self.ents[&mid].mob().unwrap().tpl.speed * 1.6;
            if self.step_toward(mid, hx, hz, speed, dt, 0.5) {
                let m = self.ents.get_mut(&mid).unwrap().mob_mut().unwrap();
                m.returning = false;
                m.hp = m.stats.max_hp;
            }
            return;
        }

        if self.ents[&mid].mob().unwrap().target.is_some() {
            self.retarget(mid, now);
            if self.ents[&mid].mob().unwrap().tpl.phases.is_some() { self.check_phases(mid, now); }
            let t = self.ents[&mid].mob().unwrap().target.unwrap();
            let (tx, tz, tr) = { let c = &self.ents[&t].c; (c.x, c.z, c.radius) };
            let e = self.ents.get_mut(&mid).unwrap();
            let (mx, mz) = (e.c.x, e.c.z);
            let m = e.mob_mut().unwrap();
            if let Some((_, _, end)) = m.winding {
                e.c.moving = false;
                if now >= end { self.resolve_special(mid, now); }
                return;
            }
            if let Some(sp) = m.special.clone() {
                if m.special_at == 0.0 { m.special_at = now + 3000.0; }
                else if now >= m.special_at && (mx - tx).hypot(mz - tz) <= sp.r + 3.0 {
                    let (cx, cz) = if sp.at == "self" { (mx, mz) } else { (tx, tz) };
                    m.winding = Some((cx, cz, now + sp.windup));
                    e.c.moving = false;
                    self.face(mid, t);
                    self.send_near(mx, mz, json!({ "t": "tele", "id": mid, "x": cx, "z": cz, "r": sp.r, "ms": sp.windup }));
                    return;
                }
            }
            let (range, speed, next_attack, interval) = { let m = self.ents[&mid].mob().unwrap(); (m.tpl.range + tr, m.tpl.speed * 1.25, m.next_attack, m.tpl.atk_interval / m.haste) };
            if (mx - tx).hypot(mz - tz) > range {
                self.step_toward(mid, tx, tz, speed, dt, range - 0.3);
            } else {
                self.ents.get_mut(&mid).unwrap().c.moving = false;
                self.face(mid, t);
                if now >= next_attack {
                    self.ents.get_mut(&mid).unwrap().mob_mut().unwrap().next_attack = now + interval;
                    self.mob_attack(mid, t, now);
                }
            }
            return;
        }

        {
            let m = self.ents.get_mut(&mid).unwrap().mob_mut().unwrap();
            if m.hp < m.stats.max_hp { m.hp = (m.hp + m.stats.max_hp * 0.03 * dt).min(m.stats.max_hp); }
        }

        let tpl = self.ents[&mid].mob().unwrap().tpl;
        if tpl.aggressive {
            for pid in self.near_players(mx, mz, AGGRO_RANGE) {
                let pe = &self.ents[&pid];
                if !pe.c.dead && !in_town(pe.c.x, pe.c.z) && pe.player().unwrap().level < tpl.level + 8 {
                    let m = self.ents.get_mut(&mid).unwrap().mob_mut().unwrap();
                    m.target = Some(pid);
                    map_set(&mut m.hate, pid, 1.0);
                    map_set(&mut m.threat, pid, 1.0);
                    m.dest = None;
                    return;
                }
            }
        }

        let dest = self.ents[&mid].mob().unwrap().dest;
        if let Some(dp) = dest {
            if self.step_toward(mid, dp.x, dp.z, tpl.speed * 0.45, dt, 0.2) { self.ents.get_mut(&mid).unwrap().mob_mut().unwrap().dest = None; }
        } else {
            let e = self.ents.get_mut(&mid).unwrap();
            e.c.moving = false;
            let m = e.mob_mut().unwrap();
            if now >= m.wander_at {
                m.wander_at = now + 4000.0 + rnd() * 9000.0;
                if rnd() < 0.6 && !tpl.boss.unwrap_or(false) {
                    let (a, r) = (rnd() * std::f64::consts::TAU, rnd() * 8.0);
                    m.dest = Some(crate::collision::P { x: m.home_x + a.cos() * r, z: m.home_z + a.sin() * r });
                }
            }
        }
    }

    /** The wind-up is over: judge each player on their own timeline (lag compensation). */
    fn resolve_special(&mut self, mid: u32, now: f64) {
        let m = self.ents.get_mut(&mid).unwrap().mob_mut().unwrap();
        let sp = m.special.clone().unwrap();
        let (ax, az, _) = m.winding.take().unwrap();
        m.special_at = now + sp.every;
        m.next_attack = now + m.tpl.atk_interval * 0.5;
        let p_atk = m.stats.p_atk;
        for pid in self.near_players(ax, az, sp.r + 12.0) {
            let at = now + self.pl(pid).unwrap().one_way() + 40.0;
            let sp = sp.clone();
            self.later(at, move |w, t| {
                if w.ents.get(&mid).map_or(true, |e| e.c.dead) { return; }
                let Some(pe) = w.ents.get(&pid) else { return };
                let Some(p) = pe.player() else { return };
                if pe.c.dead || p.dodge_until > t { return; }
                if (pe.c.x - ax).hypot(pe.c.z - az) > sp.r + 0.5 { return; }
                let dmg = phys_damage(p_atk, p.stats.p_def, sp.mult, false);
                w.apply_damage(mid, pid, dmg, t, false, false);
                if let Some(stun) = sp.stun {
                    w.apply_status(mid, pid, &crate::data::StatusApply { id: "stun".into(), ms: stun, chance: None, dot: None }, dmg, t);
                }
            });
        }
    }

    fn respawn_mob(&mut self, mid: u32) {
        let (hx, hz, boss, name, name_en) = {
            let e = self.ents.get_mut(&mid).unwrap();
            e.c.dead = false;
            e.c.hidden = false;
            e.c.av += 1;
            let m = e.mob_mut().unwrap();
            m.hp = m.stats.max_hp;
            m.target = None;
            m.returning = false;
            m.hate.clear();
            m.threat.clear();
            m.phase = 0;
            m.haste = 1.0;
            m.special = m.tpl.special.clone();
            m.dest = None;
            (m.home_x, m.home_z, m.tpl.boss.unwrap_or(false), m.tpl.name.clone(), m.tpl.name_en.clone())
        };
        self.set_pos(mid, hx, hz);
        if boss && self.raid.is_none() {
            self.announce(|l| if l.en() { format!("The raid boss {name_en} has awakened in the Cursed Wastes!") } else { format!("¡El jefe {name} despertó en los Páramos Malditos!") });
        }
    }

    /** Threat: switch to whoever clearly out-threatened the target (110%); a taunt locks it. */
    fn retarget(&mut self, mid: u32, now: f64) {
        let m = self.ents[&mid].mob().unwrap();
        if now < m.next_target_check || now < m.taunt_until { return; }
        let (hx, hz, cur_t) = (m.home_x, m.home_z, m.target.unwrap());
        let cur = map_get(&m.threat, cur_t).unwrap_or(0.0);
        let mut best = cur * 1.1;
        let mut best_id = None;
        for (id, v) in m.threat.clone() {
            if id == cur_t || v <= best { continue; }
            if !self.valid_enemy(id, hx, hz) { continue; }
            best = v;
            best_id = Some(id);
        }
        let m = self.ents.get_mut(&mid).unwrap().mob_mut().unwrap();
        m.next_target_check = now + 500.0;
        if let Some(b) = best_id { m.target = Some(b); }
    }

    /** Raid boss phases: crossing an HP threshold summons adds, hastes it and/or swaps its special. */
    fn check_phases(&mut self, mid: u32, now: f64) {
        loop {
            let e = &self.ents[&mid];
            let m = e.mob().unwrap();
            let phases = m.tpl.phases.as_ref().unwrap();
            let pct = m.hp / m.stats.max_hp * 100.0;
            if m.phase >= phases.len() || pct > phases[m.phase].at { return; }
            let ph = phases[m.phase].clone();
            let (mx, mz) = (e.c.x, e.c.z);
            let threat_ids: Vec<u32> = m.threat.iter().map(|t| t.0).collect();
            let (name, name_en) = (m.tpl.name.clone(), m.tpl.name_en.clone());
            {
                let m = self.ents.get_mut(&mid).unwrap().mob_mut().unwrap();
                m.phase += 1;
                if let Some(h) = ph.haste { m.haste = h; }
                if let Some(sp) = &ph.special {
                    m.special = Some(sp.clone());
                    m.special_at = now + 2500.0;
                }
            }
            for pid in self.near_players(mx, mz, 80.0) {
                let en = self.pl(pid).unwrap().lang.en();
                let text = if en { format!("{name_en}: {}", ph.say.1) } else { format!("{name}: {}", ph.say.0) };
                self.send(pid, json!({ "t": "chat", "ch": "announce", "from": "", "text": text }));
            }
            if let Some(adds) = &ph.adds {
                // they go for the healers and casters first: whoever is furthest from the boss
                let mut victims: Vec<u32> = threat_ids.iter().copied().filter(|id| self.ents.get(id).map_or(false, |e| e.player().is_some() && !e.c.dead)).collect();
                victims.sort_by(|a, b| {
                    let (ca, cb) = (&self.ents[a].c, &self.ents[b].c);
                    let da = (ca.x - mx).hypot(ca.z - mz);
                    let db = (cb.x - mx).hypot(cb.z - mz);
                    db.partial_cmp(&da).unwrap_or(std::cmp::Ordering::Equal)
                });
                for i in 0..adds.count {
                    let a = i as f64 / adds.count as f64 * std::f64::consts::TAU;
                    let add = self.spawn_mob(&adds.mob, mx + a.cos() * 9.0, mz + a.sin() * 9.0);
                    if !victims.is_empty() {
                        let v = victims[i as usize % victims.len()];
                        let am = self.ents.get_mut(&add).unwrap().mob_mut().unwrap();
                        am.target = Some(v);
                        map_set(&mut am.hate, v, 1.0);
                        map_set(&mut am.threat, v, 50.0);
                    }
                }
            }
            let _ = d();
        }
    }
}
