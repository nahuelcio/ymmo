//! Combat: attacks, damage, statuses, xp, deaths, skills (port of server/src/systems/combat.ts).
use crate::data::{d, StatusApply};
use crate::ent::*;
use crate::formulas::*;
use crate::i18n::tr;
use crate::terrain::{in_pvp_zone, in_town};
use crate::world::{dist, World};
use serde_json::json;
use std::collections::HashSet;

const PVP_OFF_COOLDOWN: f64 = 10000.0;

fn is_fighter(w: &World, id: u32) -> bool { w.ents.get(&id).map_or(false, |e| e.is_fighter()) }

impl World {
    /** Turn PvP mode on/off. Can't hide from a fight: turning off needs 10 s out of combat and no flag. */
    pub fn set_pvp_mode(&mut self, pid: u32, on: bool) {
        let now = self.now;
        let p = self.pl(pid).unwrap();
        if p.pvp_on == on { return; }
        if !on {
            if p.karma > 0 { return self.sys(pid, "No podés desactivar el PvP mientras tengas karma.", "You cannot disable PvP while you have karma."); }
            if p.pvp_until > now || now - p.last_combat < PVP_OFF_COOLDOWN {
                return self.sys(pid, "No podés desactivar el PvP en combate o con flag. Esperá unos segundos.", "You cannot disable PvP while in combat or flagged. Wait a few seconds.");
            }
        }
        self.pl_mut(pid).unwrap().pvp_on = on;
        if on { self.sys(pid, "Modo PvP ACTIVADO: podés atacar y ser atacado por otros jugadores con PvP.", "PvP mode ON: you can attack and be attacked by other PvP players."); }
        else { self.sys(pid, "Modo PvP DESACTIVADO: los demás jugadores no te pueden atacar.", "PvP mode OFF: other players cannot attack you."); }
    }

    pub fn can_attack(&self, pid: u32, tid: u32, force: bool, now: f64) -> Option<String> {
        let p = self.pl(pid)?;
        let l = p.lang;
        let pc = &self.ents[&pid].c;
        let Some(te) = self.ents.get(&tid) else { return Some(tr(l, "Objetivo inválido.", "Invalid target.").into()) };
        if te.c.dead { return Some(tr(l, "Tu objetivo ya está muerto.", "Your target is already dead.").into()); }
        if te.mob().is_some() { return None; }
        let Some(t) = te.player() else { return Some(tr(l, "Objetivo inválido.", "Invalid target.").into()) };
        if tid == pid { return Some(tr(l, "No te podés atacar a vos mismo.", "You cannot attack yourself.").into()); }
        if in_town(pc.x, pc.z) || in_town(te.c.x, te.c.z) { return Some(tr(l, "No se puede atacar en una zona de paz.", "You cannot attack in a peace zone.").into()); }
        if p.party.is_some() && p.party == t.party { return Some(tr(l, "No podés atacar a alguien de tu party.", "You cannot attack a party member.").into()); }
        match crate::clans::relation(p.char_id, t.char_id) {
            crate::clans::Rel::Friend => return Some(tr(l, "No podés atacar a alguien de tu clan o de tu alianza.", "You cannot attack a member of your clan or alliance.").into()),
            // a mutual clan war (as in L2): enemies fight without PvP mode, flags or Ctrl
            crate::clans::Rel::War => return None,
            crate::clans::Rel::None => {}
        }
        // both in a full-PvP zone: everyone there is fair game, no PvP mode or Ctrl needed (and no karma: they are flagged)
        if in_pvp_zone(pc.x, pc.z) && in_pvp_zone(te.c.x, te.c.z) { return None; }
        if !p.pvp_on { return Some(tr(l, "Tenés el PvP desactivado. Activalo (botón PvP o /pvp) para pelear con jugadores.", "Your PvP mode is off. Turn it on (PvP button or /pvp) to fight players.").into()); }
        if !t.pvp_on && t.karma == 0 { return Some(if l.en() { format!("{} has PvP mode off.", t.name) } else { format!("{} tiene el PvP desactivado.", t.name) }); }
        if t.karma > 0 || t.pvp_until > now || force { return None; }
        Some(tr(l, "Mantené Ctrl y usá el autoataque para forzar el ataque a otro jugador.", "Hold Ctrl and use auto-attack to force an attack on another player.").into())
    }

    fn def_stats(&self, id: u32) -> (f64, f64, f64) {
        match &self.ents[&id].k {
            Kind::Player(p) => (p.stats.p_def, p.stats.m_def, p.stats.evasion),
            Kind::Mob(m) => (m.stats.p_def, m.stats.m_def, m.stats.evasion),
            _ => (1.0, 1.0, 0.0),
        }
    }

    fn send_miss(&self, src: u32, t: u32) {
        let msg = json!({ "t": "dmg", "s": src, "tg": t, "v": 0, "miss": true });
        self.send(src, msg.clone());
        self.send(t, msg);
    }

    pub fn auto_attack(&mut self, pid: u32, tid: u32, now: f64) {
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "atk", "s": pid, "tg": tid }));
        let (p_def, _, eva) = self.def_stats(tid);
        let p = self.pl_mut(pid).unwrap();
        p.last_combat = now;
        let (acc, crit_c, p_atk, crit_dmg, ranged) = (p.stats.accuracy, p.stats.crit, p.stats.p_atk, p.stats.crit_dmg, p.weapon_type() == Some("bow"));
        if rnd() > hit_chance(acc, eva) { return self.send_miss(pid, tid); }
        let crit = rnd() * 100.0 < crit_c;
        let (dmg, blk) = self.blocked(tid, with_crit_dmg(phys_damage(p_atk, p_def, 1.0, crit), crit, crit_dmg));
        self.apply_damage(pid, tid, dmg, now, crit, false, blk);
        if !ranged { self.reflect(tid, pid, dmg, now); }
        // a hit with a pair of swords now and then gathers a Force charge (L2's Sonic Mastery)
        if let Some(p) = self.pl_mut(pid) {
            if p.weapon_type() == Some("dual") && rnd() < DUAL_CHARGE_CHANCE && p.add_charges(1) {
                let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
                self.send_near(x, z, json!({ "t": "fx", "s": pid, "tg": pid, "skill": "charge" }));
            }
        }
    }

    /** A melee blow on a player under a reflect (Canción de la Venganza) sends part of it back to who dealt it. It goes back
     * as damage over time does (`dot`), so it is neither reflected again nor drunk by a vampire. */
    fn reflect(&mut self, tid: u32, src: u32, dmg: f64, now: f64) {
        let r = self.pl(tid).map_or(0.0, |p| p.stats.reflect);
        if r <= 0.0 || src == tid || self.ents.get(&src).map_or(true, |e| e.c.dead) || self.ents.get(&tid).map_or(true, |e| e.c.dead) { return; }
        let back = reflected(dmg, r);
        if back > 0.0 { self.apply_damage(tid, src, back, now, false, true, false); }
    }

    /** A physical hit on a player carrying a shield: one in `block` of them is caught on it and does half its damage. */
    pub fn blocked(&self, tid: u32, dmg: f64) -> (f64, bool) {
        self.pl(tid).map_or((dmg, false), |p| block_hit(dmg, p.stats.block, rnd()))
    }

    pub fn mob_attack(&mut self, mid: u32, tid: u32, now: f64) {
        let (x, z) = { let c = &self.ents[&mid].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "atk", "s": mid, "tg": tid }));
        let m = self.ents[&mid].mob().unwrap();
        let (acc, crit_c, p_atk, on_hit) = (m.stats.accuracy, m.stats.crit, m.stats.p_atk, m.tpl.on_hit.clone());
        let t = self.pl(tid).unwrap();
        if t.dodge_until > now || rnd() > hit_chance(acc, t.stats.evasion) { return self.send_miss(mid, tid); }
        let crit = rnd() * 100.0 < crit_c;
        let (dmg, blk) = self.blocked(tid, phys_damage(p_atk, t.stats.p_def, 1.0, crit));
        self.apply_damage(mid, tid, dmg, now, crit, false, blk);
        self.reflect(tid, mid, dmg, now);
        if let Some(oh) = on_hit.filter(|_| !blk) { // a blow caught on the shield leaves no poison or bleed
            if rnd() < oh.chance.unwrap_or(1.0) { self.apply_status(mid, tid, &oh, dmg, now); }
        }
    }

    /** Put a status on t (refreshes duration). Damage over time scales off the hit that caused it. */
    pub fn apply_status(&mut self, src: u32, tid: u32, sa: &StatusApply, hit: f64, now: f64) {
        let Some(e) = self.ents.get_mut(&tid) else { return };
        if e.c.dead { return; }
        let dps = sa.dot.map_or(0.0, |dot| jround(hit * dot).max(1.0));
        // a refresh keeps the damage over time's clock: struck again within a second, it still ticks every second
        let next_tick = e.c.statuses.get(&sa.id).filter(|s| s.until > now).map_or(now + 1000.0, |s| s.next_tick);
        e.c.statuses.insert(sa.id.clone(), ActiveStatus { until: now + sa.ms, src, dps, next_tick });
        if sa.id == "stun" {
            e.c.moving = false;
            let (x, z) = (e.c.x, e.c.z);
            let (player, winding) = match &mut e.k {
                Kind::Player(p) => {
                    p.intent = None;
                    (true, false)
                }
                Kind::Mob(m) => (false, m.winding.take().is_some()),
                _ => (false, false),
            };
            // a stun cuts a cast (no damage, no cost) and a mob's special attack, its warning circle and slam too
            if player { self.stop_cast(tid, false, now); }
            if winding { self.send_near(x, z, json!({ "t": "castx", "s": tid })); }
        }
    }

    /**
     * Stop a player's cast without it going off, and drop the skill queued after it. `charge`: a cancel they chose
     * (Esc, walking or rolling away, sitting down) costs its MP and cooldown like a finished cast; one forced on them (a
     * stun, death, a teleport) costs nothing. Everyone near sees the cast bar and the casting pose stop.
     */
    pub fn stop_cast(&mut self, pid: u32, charge: bool, now: f64) {
        let Some(p) = self.pl_mut(pid) else { return };
        p.queued = None;
        let Some((skill, _, _)) = p.casting.take() else { return };
        if let Some(def) = d().skill(&skill).filter(|_| charge) {
            let def = crate::admin::tuned_skill(def);
            p.mp = (p.mp - def.mp).max(0.0);
            let cd = (def.cooldown * (1.0 - p.stats.cdr)).round();
            p.cooldowns.insert(def.id.clone(), now + cd);
            p.send(json!({ "t": "cd", "key": def.id, "ms": cd }));
        }
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "castx", "s": pid }));
    }

    /** After a cast: the skill pressed during it goes now, if it is ready (request_skill checks it all and says why not). */
    pub fn fire_queued(&mut self, pid: u32, now: f64) {
        let Some((skill, force)) = self.pl_mut(pid).and_then(|p| p.queued.take()) else { return };
        self.request_skill(pid, &skill, force, now);
    }

    /** A skill's status on its target: a stun or a slow has to land (land_chance), a bleed or poison always does. */
    fn skill_status(&mut self, pid: u32, tg: u32, sa: &StatusApply, hit: f64, now: f64) {
        if matches!(sa.id.as_str(), "stun" | "slow") {
            let base = sa.chance.unwrap_or(if sa.id == "stun" { 0.6 } else { 0.8 });
            let att = self.pl(pid).map_or(1, |p| p.level);
            let (lvl, boss) = match self.ents.get(&tg).map(|e| &e.k) {
                Some(Kind::Player(p)) => (p.level, false),
                Some(Kind::Mob(m)) => (m.tpl.level, m.tpl.boss.unwrap_or(false)),
                _ => return,
            };
            if rnd() >= land_chance(base, att, lvl, boss) {
                let msg = json!({ "t": "dmg", "s": pid, "tg": tg, "v": 0, "res": true });
                self.send(pid, msg.clone());
                self.send(tg, msg);
                return;
            }
        }
        self.apply_status(pid, tg, sa, hit, now);
    }

    /** Expire statuses and tick bleed / poison once per second. */
    pub fn tick_statuses(&mut self, id: u32, now: f64) {
        let ids: Vec<String> = self.ents[&id].c.statuses.keys().cloned().collect();
        for sid in ids {
            let Some(e) = self.ents.get_mut(&id) else { return };
            let Some(st) = e.c.statuses.get_mut(&sid) else { continue };
            if e.c.dead || st.until <= now {
                e.c.statuses.remove(&sid);
                continue;
            }
            if st.dps > 0.0 && now >= st.next_tick {
                st.next_tick += 1000.0;
                let (src, dps) = (st.src, st.dps);
                let src = if is_fighter(self, src) { src } else { id };
                self.apply_damage(src, id, dps, now, false, true, false);
            }
        }
    }

    pub fn add_threat(&mut self, mid: u32, pid: u32, v: f64) {
        if let Some(m) = self.ents.get_mut(&mid).and_then(|e| e.mob_mut()) { map_add(&mut m.threat, pid, v); }
    }

    /** dot: a bleed or poison tick; blk: a physical hit the target caught on its shield (blocked, already halved) */
    pub fn apply_damage(&mut self, src: u32, tid: u32, dmg: f64, now: f64, crit: bool, dot: bool, blk: bool) {
        if self.ents.get(&tid).map_or(true, |e| e.c.dead) { return; }
        if self.pl(tid).is_some_and(|p| p.god) { return; }
        // a vampire dealer (Danza del Vampiro) drinks part of a blow it lands (not of damage over time); a wound halves it
        if !dot && src != tid {
            let mul = self.ents.get(&src).map_or(1.0, |e| e.c.heal_mul(now));
            if let Some(p) = self.pl_mut(src).filter(|p| p.stats.vampire > 0.0 && p.hp > 0.0) {
                p.hp = (p.hp + lifesteal(dmg, p.stats.vampire) * mul).min(p.stats.max_hp);
            }
        }
        let mut msg = json!({ "t": "dmg", "s": src, "tg": tid, "v": dmg, "crit": crit });
        if dot { msg["dot"] = json!(true); }
        if blk { msg["blk"] = json!(true); }
        let src_player = self.pl(src).map(|p| p.cls == "fighter");
        if let Some(_) = src_player {
            let p = self.pl_mut(src).unwrap();
            p.send(msg.clone());
            p.last_combat = now;
        }
        if tid != src { self.send(tid, msg); }

        if self.ents[&tid].mob().is_some() {
            if let Some(fighter) = src_player {
                let m = self.ents.get_mut(&tid).unwrap().mob_mut().unwrap();
                map_add(&mut m.hate, src, dmg);
                map_add(&mut m.threat, src, dmg * if fighter { 1.3 } else { 1.0 });
                if m.target.is_none() || m.returning {
                    m.returning = false;
                    m.target = Some(src);
                }
            }
            let m = self.ents.get_mut(&tid).unwrap().mob_mut().unwrap();
            m.hp -= dmg;
            if m.hp <= 0.0 { self.kill_mob(tid, now); }
            return;
        }

        // player target
        let src_is_player = src_player.is_some();
        let t = self.pl_mut(tid).unwrap();
        t.last_combat = now;
        t.gather = None; // a hit breaks off felling / mining / picking
        // and drives a resting player out of their tent
        let in_tent = t.sitting.and_then(|s| d().nodes.get(&s)).map_or(false, |n| n.kind == crate::data::NodeKind::Tent);
        let t_karma = t.karma;
        if src_is_player {
            let absorbed = t.cp.min(dmg);
            t.cp -= absorbed;
            t.hp -= dmg - absorbed;
        } else {
            t.hp -= dmg;
        }
        let dead = t.hp <= 0.0;
        if src_is_player && t_karma == 0 { if let Some(p) = self.pl_mut(src) { p.pvp_until = now + PVP_FLAG_MS; } }
        if in_tent && !dead { self.stand_up(tid); }
        if dead { self.kill_player(tid, src, now); }
    }

    pub fn gain_xp(&mut self, pid: u32, amount: f64) {
        let amt = jround(amount) as i64;
        let max = d().c.max_level;
        if amt <= 0 || self.ents.get(&pid).map_or(true, |e| e.c.dead) { return; }
        let Some(p) = self.pl_mut(pid) else { return };
        if p.karma > 0 {
            p.karma = (p.karma - (jround(amt as f64 / 3.0) as i64).max(10)).max(0);
            if p.karma == 0 { self.sys(pid, "Tu karma quedó limpio.", "Your karma has been cleansed."); }
        }
        let p = self.pl_mut(pid).unwrap();
        if p.level >= max { return; }
        p.xp += amt;
        self.sys(pid, &format!("Ganaste {amt} de experiencia."), &format!("You have earned {amt} experience."));
        let mut up = false;
        loop {
            let p = self.pl_mut(pid).unwrap();
            if !(p.level < max && p.xp >= xp_to_next(p.level)) { break; }
            p.xp -= xp_to_next(p.level);
            p.level += 1;
            up = true;
            let (cls, spec, lvl, race, g) = (p.cls.clone(), p.spec.clone(), p.level, p.race.clone(), p.look.gender());
            for sk in d().skills_for(&cls, spec.as_deref(), lvl, &race, g) {
                if sk.level == lvl { self.sys(pid, &format!("Aprendiste {}.", sk.name), &format!("You have learned {}.", sk.name_en)); }
            }
            if lvl == d().c.spec_level && spec.is_none() {
                self.sys(pid, "Ya podés elegir una especialización: abrí Estado del Personaje.", "You can now choose a specialization: open Character Status.");
            }
        }
        let p = self.pl_mut(pid).unwrap();
        if p.level >= max { p.xp = 0; }
        if up {
            p.recalc();
            p.hp = p.stats.max_hp;
            p.mp = p.stats.max_mp;
            p.cp = p.stats.max_cp;
            let lvl = p.level;
            let e = self.ents.get_mut(&pid).unwrap();
            e.c.av += 1;
            let (x, z) = (e.c.x, e.c.z);
            self.send_near(x, z, json!({ "t": "levelUp", "id": pid, "lvl": lvl }));
            self.sys(pid, &format!("¡Subiste a nivel {lvl}!"), &format!("Your level has increased to {lvl}!"));
        }
    }

    /// One-time pick at SPEC_LEVEL: the base class stays, the spec's skills are added from then on.
    pub fn choose_spec(&mut self, pid: u32, spec: &str) {
        let data = d();
        let p = self.pl(pid).unwrap();
        let Some(def) = data.spec(spec).filter(|s| s.parent.is_none() && s.base == p.cls && p.spec.is_none() && p.level >= data.c.spec_level) else {
            return self.sys(pid, "No podés elegir esa especialización.", "You cannot choose that specialization.");
        };
        if let Err(e) = self.db.set_spec(p.char_id, &def.id) {
            elog!("[world] set_spec failed: {e}");
            return self.sys(pid, "No se pudo guardar. Probá de nuevo.", "Could not save. Try again.");
        }
        let (lvl, race, g, cls) = (p.level, p.race.clone(), p.look.gender(), p.cls.clone());
        self.pl_mut(pid).unwrap().spec = Some(def.id.clone());
        self.ents.get_mut(&pid).unwrap().c.av += 1;
        self.sys(pid, &format!("Ahora sos {}.", def.name), &format!("You are now a {}.", def.name_en));
        for sk in data.skills_for(&cls, Some(&def.id), lvl, &race, g) {
            if sk.spec.is_some() { self.sys(pid, &format!("Aprendiste {}.", sk.name), &format!("You have learned {}.", sk.name_en)); }
        }
    }

    /** The mobs fighting `pid` round it lose its trail: they turn on whoever else they hate, or go home. */
    fn vanish(&mut self, pid: u32) {
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        for id in self.near(x, z, 25.0) {
            let Some(m) = self.ents.get_mut(&id).and_then(|e| e.mob_mut()) else { continue };
            if map_get(&m.threat, pid).is_none() && m.target != Some(pid) { continue; }
            map_del(&mut m.hate, pid);
            map_del(&mut m.threat, pid);
            if m.target == Some(pid) {
                m.target = m.threat.iter().copied().max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)).map(|t| t.0);
                m.taunt_until = 0.0;
                if m.target.is_none() {
                    m.hate.clear();
                    m.reset_fight();
                    m.returning = true;
                }
            }
        }
    }

    pub fn kill_mob(&mut self, mid: u32, now: f64) {
        let (x, z, tpl, hate, camp_id) = {
            let e = self.ents.get_mut(&mid).unwrap();
            e.c.dead = true;
            e.c.moving = false;
            let (ex, ez) = (e.c.x, e.c.z);
            let m = e.mob_mut().unwrap();
            m.hp = 0.0;
            m.target = None;
            m.dest = None;
            m.hide_at = now + 6000.0;
            m.respawn_at = now + m.tpl.respawn.unwrap_or(15000.0 + rnd() * 15000.0);
            m.threat.clear();
            (ex, ez, m.tpl, std::mem::take(&mut m.hate), m.camp_id.clone())
        };
        self.send_near(x, z, json!({ "t": "died", "id": mid, "byPlayer": false }));
        self.mob_killed(mid, now);

        if let Some(cid) = &camp_id {
            let mut add: Vec<u32> = vec![];
            for (id, _) in &hate {
                add.push(*id);
                if let Some(party) = self.pl(*id).and_then(|p| p.party) {
                    if let Some(pt) = self.parties.iter().find(|pt| pt.id == party) { add.extend(pt.members.iter().copied()); }
                }
            }
            if let Some(camp) = self.camps.iter_mut().find(|c| &c.def.id == cid) { camp.contributors.extend(add); }
        }

        // group damage dealers into units (solo players or parties)
        struct Unit { dmg: f64, party: Option<u32>, player: u32 }
        let mut units: Vec<(String, Unit)> = vec![];
        let mut damaged: Vec<u32> = vec![];
        let mut total = 0.0;
        for (id, dmg) in &hate {
            let Some(pl) = self.pl(*id) else { continue };
            damaged.push(*id);
            total += dmg;
            let key = match pl.party { Some(pt) => format!("p{pt}"), None => format!("c{id}") };
            match units.iter_mut().find(|u| u.0 == key) {
                Some(u) => u.1.dmg += dmg,
                None => units.push((key, Unit { dmg: *dmg, party: pl.party, player: *id })),
            }
        }
        if total <= 0.0 { return; }
        let base_xp = mob_xp(tpl);
        let mut best: Option<usize> = None;
        for (i, (_, u)) in units.iter().enumerate() {
            if best.map_or(true, |b| u.dmg > units[b].1.dmg) { best = Some(i); }
            let xp = base_xp * (u.dmg / total);
            if let Some(ptid) = u.party {
                let members: Vec<u32> = self.parties.iter().find(|p| p.id == ptid).map(|p| p.members.clone()).unwrap_or_default();
                let mc = Common::new(0, x, z);
                let elig: Vec<u32> = members.into_iter().filter(|id| self.ents.get(id).map_or(false, |e| !e.c.dead && dist(&e.c, &mc) <= 80.0)).collect();
                if elig.is_empty() { continue; }
                let bonus = PARTY_BONUS.get(elig.len()).copied().unwrap_or(1.8);
                let sum_l: i64 = elig.iter().map(|id| self.pl(*id).unwrap().level).sum();
                for id in elig {
                    let lvl = self.pl(id).unwrap().level;
                    self.gain_xp(id, ((xp * bonus * lvl as f64) / sum_l as f64) * level_penalty(lvl, tpl.level));
                }
            } else {
                let lvl = self.pl(u.player).map_or(1, |p| p.level);
                self.gain_xp(u.player, xp * level_penalty(lvl, tpl.level));
            }
        }
        let best = &units[best.unwrap()].1;
        let owners: HashSet<u32> = match best.party {
            Some(ptid) => self.parties.iter().find(|p| p.id == ptid).map(|p| p.members.iter().copied().collect()).unwrap_or_default(),
            None => [best.player].into_iter().collect(),
        };
        let best_name = self.pl(best.player).map(|p| p.name.clone()).unwrap_or_default();
        self.credit_kill(&tpl.id, &damaged);
        self.drop_loot(mid, &owners, now);
        if tpl.boss.unwrap_or(false) {
            self.announce(|l| if l.en() { format!("{best_name} has slain the raid boss {}!", tpl.name_en) } else { format!("¡{best_name} derrotó al jefe {}!", tpl.name) });
        }
    }

    pub fn kill_player(&mut self, tid: u32, killer: u32, now: f64) {
        let (x, z) = {
            let e = self.ents.get_mut(&tid).unwrap();
            e.c.dead = true;
            e.c.moving = false;
            let t = e.player_mut().unwrap();
            t.hp = 0.0;
            t.intent = None;
            t.escape_at = 0.0;
            t.buffs.clear();
            t.charges = 0;
            t.recalc();
            (e.c.x, e.c.z)
        };
        self.stop_cast(tid, false, now);
        // a trade in progress ends with nothing changing hands, before anything drops
        self.trade_cancel(tid, Some(("El comercio se canceló.".into(), "The trade has been cancelled.".into())));
        let by_player = self.pl(killer).is_some() && killer != tid;
        self.send_near(x, z, json!({ "t": "died", "id": tid, "byPlayer": by_player }));
        let (t_name, t_karma, t_flag, t_level, t_xp) = { let t = self.pl(tid).unwrap(); (t.name.clone(), t.karma, t.pvp_until > now, t.level, t.xp) };
        if by_player {
            let k_name = self.pl(killer).unwrap().name.clone();
            self.sys(tid, &format!("{k_name} te mató."), &format!("You have been killed by {k_name}."));
            // a war enemy is fair game: no karma, and the clans' reputation moves
            let war = crate::clans::relation(self.pl(killer).unwrap().char_id, self.pl(tid).unwrap().char_id) == crate::clans::Rel::War;
            if war { self.clan_war_kill(killer, tid); }
            if t_karma > 0 || t_flag || war {
                self.pl_mut(killer).unwrap().pvp += 1;
                self.sys(killer, &format!("Derrotaste a {t_name}."), &format!("You have defeated {t_name}."));
            } else {
                let k = self.pl_mut(killer).unwrap();
                k.karma += KARMA_PER_PK;
                k.pk += 1;
                k.pvp_until = 0.0;
                self.sys(killer, &format!("Mataste a {t_name}, que no tenía flag. ¡Sumaste {KARMA_PER_PK} de karma!"), &format!("You murdered {t_name}, who was not flagged. You gained {KARMA_PER_PK} karma!"));
            }
            let k = self.pl_mut(killer).unwrap();
            if matches!(k.intent, Some(Intent::Attack { id, .. }) if id == tid) { k.intent = None; }
        } else {
            let loss = jround(xp_to_next(t_level) as f64 * 0.04 * if t_karma > 0 { 2.0 } else { 1.0 }) as i64;
            if loss > 0 && t_xp > 0 {
                self.pl_mut(tid).unwrap().xp = (t_xp - loss).max(0);
                self.sys(tid, &format!("Moriste y perdiste {loss} de experiencia."), &format!("You have died and lost {loss} experience."));
            }
        }
        if t_karma > 0 && rnd() < 0.4 { self.drop_from_player(tid, now); }
        self.pl_mut(tid).unwrap().pvp_until = 0.0;
    }

    pub fn respawn_player(&mut self, pid: u32) {
        if !self.ents[&pid].c.dead { return; }
        self.ents.get_mut(&pid).unwrap().c.dead = false;
        let p = self.pl_mut(pid).unwrap();
        p.hp = p.stats.max_hp * 0.7;
        p.mp = p.stats.max_mp * 0.7;
        p.cp = p.stats.max_cp * 0.7;
        let pt = self.town_point(Some(pid));
        self.teleport(pid, pt.x, pt.z);
    }

    pub fn request_skill(&mut self, pid: u32, skill_id: &str, force: bool, now: f64) {
        let data = d();
        let p = self.pl(pid).unwrap();
        let Some(def) = data.skill(skill_id).filter(|s| data.skill_available(s, &p.cls, p.spec.as_deref(), &p.race, p.look.gender()) && s.level <= p.level) else {
            return self.sys(pid, "Todavía no aprendiste esa habilidad.", "You have not learned that skill.");
        };
        let c = &self.ents[&pid].c;
        if c.dead { return; }
        if c.has("stun", now) { return self.sys(pid, "Estás aturdido.", "You are stunned."); }
        if p.casting.is_some() {
            // casting already: this one goes next (fire_queued), in place of any other waiting
            self.pl_mut(pid).unwrap().queued = Some((def.id.clone(), force));
            return self.send(pid, json!({ "t": "queued", "skill": def.id }));
        }
        if p.cooldowns.get(&def.id).copied().unwrap_or(0.0) > now { return self.sys(pid, &format!("{} todavía no está lista.", def.name), &format!("{} is not ready yet.", def.name_en)); }
        if p.mp < def.mp { return self.sys(pid, "No te alcanza el MP.", "Not enough MP."); }
        if let Some(w) = def.weapon.as_deref().filter(|w| p.weapon_type() != Some(*w)) {
            return match w {
                "bow" => self.sys(pid, "Necesitás un arco equipado.", "You need a bow equipped."),
                "dual" => self.sys(pid, "Necesitás un par de espadas equipado.", "You need a pair of swords equipped."),
                _ => self.sys(pid, "Necesitás una daga equipada.", "You need a dagger equipped."),
            };
        }
        if let Some(n) = def.spend.filter(|&n| p.charges < n) {
            return self.sys(pid, &format!("Necesitás {n} cargas de fuerza."), &format!("You need {n} Force charges."));
        }
        let mut target = pid;
        let cur = p.target.filter(|t| self.ents.contains_key(t));
        if def.target == "friend" {
            if let Some(t) = cur { if self.pl(t).is_some() && !self.ents[&t].c.dead { target = t; } }
        } else if def.target == "enemy" {
            let Some(t) = cur else { return self.sys(pid, "Primero elegí un objetivo.", "Select a target first.") };
            if let Some(err) = self.can_attack(pid, t, force, now) { return self.sys(pid, &err, &err); }
            target = t;
        }
        self.pl_mut(pid).unwrap().intent = Some(Intent::Skill { skill: def.id.clone(), target, force });
    }

    pub fn process_skill_intent(&mut self, pid: u32, skill: &str, target: u32, force: bool, dt: f64, now: f64) {
        let def = &crate::admin::tuned_skill(d().skill(skill).unwrap());
        let bad = match self.ents.get(&target) {
            None => true,
            Some(t) => t.c.dead || !t.is_fighter() || (def.target == "enemy" && self.can_attack(pid, target, force, now).is_some()),
        };
        if bad {
            let e = self.ents.get_mut(&pid).unwrap();
            e.c.moving = false;
            e.player_mut().unwrap().intent = None;
            return;
        }
        let (tx, tz, tr_) = { let c = &self.ents[&target].c; (c.x, c.z, c.radius) };
        let range = def.range + tr_;
        let pc = &self.ents[&pid].c;
        if target != pid && (pc.x - tx).hypot(pc.z - tz) > range {
            let speed = self.pl(pid).unwrap().stats.speed;
            self.step_toward(pid, tx, tz, speed, dt, (range - 0.4).max(0.5));
            return;
        }
        self.ents.get_mut(&pid).unwrap().c.moving = false;
        if target != pid { self.face(pid, target); }
        let p = self.pl_mut(pid).unwrap();
        if p.cooldowns.get(&def.id).copied().unwrap_or(0.0) > now || p.mp < def.mp {
            p.intent = None;
            return;
        }
        let dur = jround(crate::admin::cast_ms(&def.id).unwrap_or(def.cast) * p.stats.cast_mul);
        p.casting = Some((def.id.clone(), target, now + dur));
        // A skill is one action. Leaving an attack intent here made fighters keep swinging after it.
        p.intent = None;
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "cast", "s": pid, "tg": target, "skill": def.id, "dur": dur }));
    }

    /**
     * The caster's party members (the caster too) standing within `aoe` of the target, the target itself left out:
     * who else a heal or buff with an area reaches. None without an area or a party.
     */
    fn party_around(&self, pid: u32, target: u32, aoe: Option<f64>) -> Vec<u32> {
        let (Some(r), Some(ptid)) = (aoe, self.pl(pid).and_then(|p| p.party)) else { return vec![] };
        let Some(pt) = self.parties.iter().find(|p| p.id == ptid) else { return vec![] };
        let (tx, tz) = { let c = &self.ents[&target].c; (c.x, c.z) };
        pt.members.iter().copied().filter(|&m| m != target && self.ents.get(&m).map_or(false, |e| !e.c.dead && (e.c.x - tx).hypot(e.c.z - tz) <= r)).collect()
    }

    pub fn finish_cast(&mut self, pid: u32, now: f64) {
        let Some((skill, target, _)) = self.pl_mut(pid).unwrap().casting.take() else { return };
        let def = &crate::admin::tuned_skill(d().skill(&skill).unwrap());
        {
            let p = self.pl_mut(pid).unwrap();
            if p.mp < def.mp || def.spend.is_some_and(|n| p.charges < n) { return; }
            p.mp -= def.mp;
            // the sonic skills spend Force charges, Sonic Focus and Sonic Rage gather them
            if let Some(n) = def.spend { p.charges -= n; }
            if let Some(n) = def.charge { p.add_charges(n); }
            let cd = (def.cooldown * (1.0 - p.stats.cdr)).round();
            p.cooldowns.insert(def.id.clone(), now + cd);
            p.send(json!({ "t": "cd", "key": def.id, "ms": cd }));
        }
        match self.ents.get(&target) { Some(t) if !t.c.dead && t.is_fighter() => {}, _ => return }
        let (px, pz) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near(px, pz, json!({ "t": "fx", "s": pid, "tg": target, "skill": def.id }));
        match def.kind.as_str() {
            "phys" | "magic" | "drain" => {
                let mut targets = vec![target];
                if let Some(aoe) = def.aoe {
                    let (cx, cz) = if def.aoe_on_self.unwrap_or(false) { (px, pz) } else { let c = &self.ents[&target].c; (c.x, c.z) };
                    for id in self.near(cx, cz, aoe) {
                        if id != target && self.ents[&id].mob().is_some() && !self.ents[&id].c.dead { targets.push(id); }
                    }
                }
                for tg in targets {
                    if !self.ents.contains_key(&tg) { continue; }
                    let (p_def, m_def, eva) = self.def_stats(tg);
                    let st = self.pl(pid).unwrap().stats.clone();
                    if def.kind == "phys" {
                        if rnd() > hit_chance(st.accuracy + 10.0, eva) { self.send_miss(pid, tg); continue; }
                        let crit = rnd() * 100.0 < st.crit;
                        // a stab in the back
                        let back = def.behind.filter(|_| { let t = &self.ents[&tg].c; is_behind(px, pz, t.x, t.z, t.ry) }).unwrap_or(1.0);
                        let (dmg, blk) = self.blocked(tg, with_crit_dmg(phys_damage(st.p_atk, p_def, def.power * back, crit), crit, st.crit_dmg));
                        self.apply_damage(pid, tg, dmg, now, crit, false, blk);
                        if let Some(sa) = &def.status { self.skill_status(pid, tg, sa, dmg, now); }
                    } else {
                        let crit = rnd() < 0.05;
                        let dmg = with_crit_dmg(magic_damage(st.m_atk, m_def, def.power, crit), crit, st.crit_dmg);
                        self.apply_damage(pid, tg, dmg, now, crit, false, false);
                        if let Some(sa) = &def.status { self.skill_status(pid, tg, sa, dmg, now); }
                        if def.kind == "drain" && !self.ents[&pid].c.dead {
                            let heal = jround(dmg * 0.5 * self.ents[&pid].c.heal_mul(now));
                            let p = self.pl_mut(pid).unwrap();
                            p.hp = (p.hp + heal).min(p.stats.max_hp);
                            p.send(json!({ "t": "dmg", "s": pid, "tg": pid, "v": heal, "heal": true }));
                        }
                    }
                }
            }
            "heal" => {
                let m_atk = self.pl(pid).unwrap().stats.m_atk;
                let amount = heal_amount(def.power, m_atk);
                // a wounded body (the War Avatar's blows) gets half of it
                for ally in self.party_around(pid, target, def.aoe) {
                    let mul = self.ents.get(&ally).map_or(1.0, |e| e.c.heal_mul(now));
                    let Some(a) = self.pl_mut(ally) else { continue };
                    let before = a.hp;
                    a.hp = (a.hp + amount * mul).min(a.stats.max_hp);
                    let msg = json!({ "t": "dmg", "s": pid, "tg": ally, "v": jround(a.hp - before), "heal": true });
                    self.send(pid, msg.clone());
                    self.send(ally, msg);
                }
                let tgt = self.ents.get_mut(&target).unwrap();
                let amount = amount * tgt.c.heal_mul(now);
                let (before, after, is_player) = match &mut tgt.k {
                    Kind::Player(t) => { let b = t.hp; t.hp = (t.hp + amount).min(t.stats.max_hp); (b, t.hp, true) }
                    Kind::Mob(m) => { let b = m.hp; m.hp = (m.hp + amount).min(m.stats.max_hp); (b, m.hp, false) }
                    _ => return,
                };
                let msg = json!({ "t": "dmg", "s": pid, "tg": target, "v": jround(after - before), "heal": true });
                self.send(pid, msg.clone());
                if target != pid { self.send(target, msg); }
                // healers draw aggro from everything fighting the one they healed
                if is_player {
                    let (tx, tz) = { let c = &self.ents[&target].c; (c.x, c.z) };
                    for id in self.near(tx, tz, 40.0) {
                        let fighting = self.ents[&id].mob().map_or(false, |m| !self.ents[&id].c.dead && map_get(&m.threat, target).is_some());
                        if fighting { self.add_threat(id, pid, (after - before) * 0.5); }
                    }
                }
            }
            "buff" => {
                if def.vanish.unwrap_or(false) { self.vanish(pid); }
                let Some(buff) = &def.buff else { return };
                for tg in std::iter::once(target).chain(self.party_around(pid, target, def.aoe)) {
                    let Some(t) = self.pl_mut(tg) else { continue };
                    t.buffs.retain(|b| b.id != def.id);
                    t.buffs.push(Buff { id: def.id.clone(), until: now + buff.dur, mods: buff.mods.clone() });
                    t.recalc();
                    self.sys(tg, &format!("Recibiste {}.", def.name), &format!("{} has been applied.", def.name_en));
                }
            }
            "taunt" => {
                // everything around the target turns on you, and keeps a grudge
                let (tx, tz) = { let c = &self.ents[&target].c; (c.x, c.z) };
                for id in self.near(tx, tz, def.aoe.unwrap_or(6.0)) {
                    let dead = self.ents[&id].c.dead;
                    let Some(m) = self.ents.get_mut(&id).and_then(|e| e.mob_mut()) else { continue };
                    if dead || m.returning { continue; }
                    let top = m.threat.iter().fold(0.0f64, |a, e| a.max(e.1));
                    map_set(&mut m.threat, pid, top * 1.2 + 100.0);
                    if map_get(&m.hate, pid).is_none() { m.hate.push((pid, 0.0)); }
                    m.target = Some(pid);
                    m.taunt_until = now + 4000.0;
                }
            }
            _ => {}
        }
    }
}
