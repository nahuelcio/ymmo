//! The summoner's servitors (shared/src/data/servitors.ts): summoned by a skill (combat.rs finish_cast "summon"), as
//! many at once as its owner's level allows (Data::pet_slots), each a different one. Each follows its owner (or stays
//! where told), attacks what it is told to and fights back when hit idle, and casts its own skills when its owner
//! presses them (the client's servitor panel, or the bars); an order goes to one of them, while the summoner's heals
//! and buffs for them reach all. Their blows count as their owner's (combat.rs apply_damage: the kill, the flag); the
//! mobs fight them. They go along when their owner changes worlds (realm.rs take_out / join) and are gone when they die,
//! log out or dismiss them.
use crate::admin::tuned_skill;
use crate::data::{d, SkillDef};
use crate::ent::*;
use crate::formulas::*;
use crate::player::IN_COMBAT_MS;
use crate::world::World;
use serde_json::{json, Value};

/** Past this far from its owner it catches up with them at once. */
const LEASH: f64 = 40.0;
/** Where it walks behind its owner, and how far from them it may stand before it does. */
const BEHIND: f64 = 1.8;
const CLOSE: f64 = 2.6;

/** Where a servitor walks behind its owner: of `n` out, the `i`th, side by side across their back. */
fn follow_spot(ox: f64, oz: f64, ory: f64, i: usize, n: usize) -> (f64, f64) {
    let side = (i as f64 - (n as f64 - 1.0) / 2.0) * 1.5;
    (ox - ory.sin() * BEHIND + ory.cos() * side, oz - ory.cos() * BEHIND - ory.sin() * side)
}

/** A servitor going along with its owner to another world: which one, and its HP and MP as shares of its max. */
pub struct PetCarry { pub def: String, pub hp: f64, pub mp: f64 }

impl World {
    /** The player behind an entity: itself, or a servitor's owner. None for anything else. */
    pub fn owner_of(&self, id: u32) -> Option<u32> {
        match self.ents.get(&id).map(|e| &e.k) {
            Some(Kind::Player(_)) => Some(id),
            Some(Kind::Pet(p)) if self.pl(p.owner).is_some() => Some(p.owner),
            _ => None,
        }
    }

    /** A player's living servitors in this world, the one out longest first. */
    pub fn pets_of(&self, pid: u32) -> Vec<u32> {
        let Some(p) = self.pl(pid) else { return vec![] };
        p.pets.iter().copied().filter(|id| self.ents.get(id).is_some_and(|e| e.pet().is_some() && !e.c.dead)).collect()
    }

    /** The one of a player's servitors an order is for: the one they named (none, if it is no longer out: never another
     * in its place), or with none named the one out longest. */
    fn pet_for(&self, pid: u32, which: Option<u32>) -> Option<u32> {
        let pets = self.pets_of(pid);
        match which {
            Some(w) => pets.contains(&w).then_some(w),
            None => pets.first().copied(),
        }
    }

    /** An entity's level (a stun or slow lands by it: formulas.rs land_chance). */
    pub fn level_of(&self, id: u32) -> i64 {
        match self.ents.get(&id).map(|e| &e.k) {
            Some(Kind::Player(p)) => p.level,
            Some(Kind::Mob(m)) => m.tpl.level,
            Some(Kind::Pet(p)) => p.level,
            _ => 1,
        }
    }

    /** A fighter's stats as they are now. */
    pub fn stats_of(&self, id: u32) -> Option<Stats> {
        match &self.ents.get(&id)?.k {
            Kind::Player(p) => Some(p.stats.clone()),
            Kind::Mob(m) => Some(m.stats.clone()),
            Kind::Pet(p) => Some(p.stats.clone()),
            _ => None,
        }
    }

    /** What their owner's client shows of them (SelfState.pets): each one out, the one out longest first. */
    pub fn pet_state(&self, pid: u32) -> Value {
        Value::Array(self.pets_of(pid).into_iter().map(|id| {
            let p = self.ents[&id].pet().unwrap();
            let buffs: Vec<Value> = p.buffs.iter().map(|b| json!({ "id": b.id, "rem": ((b.until - self.now) / 1000.0).round().max(0.0) })).collect();
            json!({ "id": id, "def": p.def.id, "lvl": p.level, "hp": p.hp.ceil(), "maxHp": p.stats.max_hp, "mp": p.mp.floor(), "maxMp": p.stats.max_mp,
                "mode": if p.stay.is_some() { "stay" } else { "follow" }, "fighting": p.order.is_some(), "buffs": buffs })
        }).collect())
    }

    /** Whether this character may have this servitor out: its summon learned (the spec, the level). */
    pub fn can_summon(&self, pid: u32, sv: &str) -> bool {
        let (Some(p), Some(def), Some(s)) = (self.pl(pid), d().servitor(sv), d().summon_of(sv)) else { return false };
        d().skill_available(s, &p.cls, p.spec.as_deref(), &p.race, p.look.gender()) && def.level <= p.level
    }

    /** Call a servitor out beside its owner: the same one, if out, goes (this one takes its place), and so does the one
     * out longest past as many as its owner's level allows (Data::pet_slots); `carry`: coming along from another world,
     * with its HP and MP as they were (shares of its max). */
    pub fn summon_pet(&mut self, pid: u32, sv: &str, carry: Option<(f64, f64)>) {
        let Some(def) = d().servitor(sv) else { return };
        let live = self.pets_of(pid);
        self.pl_mut(pid).unwrap().pets = live.clone();
        if let Some(same) = live.iter().copied().find(|id| self.ents[id].pet().is_some_and(|p| p.def.id == sv)) { self.dismiss_pet(pid, same, false); }
        let slots = d().pet_slots(self.pl(pid).unwrap().level);
        while self.pets_of(pid).len() >= slots {
            let old = self.pets_of(pid)[0];
            if carry.is_none() {
                let od = self.ents[&old].pet().unwrap().def.clone();
                let (es, en) = if slots == 1 { ("un servitor".to_string(), "one servitor".to_string()) } else { (format!("{slots} servitores"), format!("{slots} servitors")) };
                self.sys(pid, &format!("{} se fue: a tu nivel podés tener {es} a la vez.", od.name), &format!("{} has left: at your level you can have {en} out at once.", od.name_en));
            }
            self.dismiss_pet(pid, old, false);
        }
        let (x, z, ry, name, level, power, n) = {
            let e = &self.ents[&pid];
            let p = e.player().unwrap();
            (e.c.x, e.c.z, e.c.ry, p.name.clone(), p.level, p.stats.pet_power, p.pets.len())
        };
        let (sx, sz) = follow_spot(x, z, ry, n, n + 1);
        let at = crate::collision::push_out(sx, sz, 0.6);
        let id = self.new_id();
        let mut c = Common::new(id, at.x, at.z);
        c.ry = ry;
        c.radius = 0.7;
        let mut pet = Pet::new(def, pid, name, level, power);
        if let Some((hp, mp)) = carry {
            pet.hp = (pet.stats.max_hp * hp).clamp(1.0, pet.stats.max_hp);
            pet.mp = (pet.stats.max_mp * mp).clamp(0.0, pet.stats.max_mp);
        }
        self.add(Ent { c, k: Kind::Pet(Box::new(pet)) });
        self.pl_mut(pid).unwrap().pets.push(id);
        if carry.is_none() { self.sys(pid, &format!("Invocaste a {}.", def.name), &format!("You summoned {}.", def.name_en)); }
    }

    /** Send one of a player's servitors away (they dismissed it, or another took its place). */
    pub fn dismiss_pet(&mut self, pid: u32, id: u32, say: bool) {
        let Some(p) = self.pl_mut(pid) else { return };
        let Some(i) = p.pets.iter().position(|x| *x == id) else { return };
        p.pets.remove(i);
        let Some(def) = self.ents.get(&id).and_then(|e| e.pet()).filter(|p| p.owner == pid).map(|p| p.def.clone()) else { return };
        let (x, z) = { let c = &self.ents[&id].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "castx", "s": id }));
        self.remove(id);
        if say { self.sys(pid, &format!("{} se fue.", def.name), &format!("{} has left.", def.name_en)); }
    }

    /** Send all of a player's servitors away (they died, or left the world). */
    pub fn dismiss_pets(&mut self, pid: u32, say: bool) {
        for id in self.pl(pid).map_or(vec![], |p| p.pets.clone()) { self.dismiss_pet(pid, id, say); }
    }

    /** What goes along with a player to another world: their servitors, as they are. */
    pub fn pet_carry(&self, pid: u32) -> Vec<PetCarry> {
        self.pets_of(pid).into_iter().filter_map(|id| self.ents[&id].pet())
            .map(|p| PetCarry { def: p.def.id.clone(), hp: p.hp / p.stats.max_hp, mp: p.mp / p.stats.max_mp.max(1.0) }).collect()
    }

    /** Their owner was carried off (a teleport, a respawn): they go with them and drop what they were doing. */
    pub fn pet_to_owner(&mut self, pid: u32) {
        for id in self.pets_of(pid) { self.bring_pet(pid, id); }
    }

    /** One servitor back at its spot behind its owner, dropping what it was doing. */
    fn bring_pet(&mut self, pid: u32, id: u32) {
        let (x, z, ry) = { let c = &self.ents[&pid].c; (c.x, c.z, c.ry) };
        let pets = &self.pl(pid).unwrap().pets;
        let (sx, sz) = follow_spot(x, z, ry, pets.iter().position(|x| *x == id).unwrap_or(0), pets.len());
        let at = crate::collision::push_out(sx, sz, 0.6);
        self.set_pos(id, at.x, at.z);
        let e = self.ents.get_mut(&id).unwrap();
        (e.c.moving, e.c.nav) = (false, None);
        let p = e.pet_mut().unwrap();
        let casting = p.casting.take().is_some();
        (p.order, p.skill, p.stay) = (None, None, None);
        if casting { self.send_near(at.x, at.z, json!({ "t": "castx", "s": id })); }
    }

    /** It fell: everyone sees it die, its owner hears of it, and its body goes a while later. */
    pub fn kill_pet(&mut self, id: u32, now: f64) {
        let (x, z, owner, def) = {
            let e = self.ents.get_mut(&id).unwrap();
            (e.c.dead, e.c.moving) = (true, false);
            let (x, z) = (e.c.x, e.c.z);
            let p = e.pet_mut().unwrap();
            p.hp = 0.0;
            (p.order, p.skill, p.casting) = (None, None, None);
            (x, z, p.owner, p.def.clone())
        };
        self.send_near(x, z, json!({ "t": "died", "id": id, "byPlayer": false }));
        if let Some(o) = self.pl_mut(owner) { o.pets.retain(|x| *x != id); }
        self.sys(owner, &format!("{} cayó.", def.name), &format!("{} has fallen.", def.name_en));
        self.later(now + 6000.0, move |w, _| { if w.ents.get(&id).is_some_and(|e| e.pet().is_some()) { w.remove(id); } });
    }

    /** A blow landed on a servitor (combat.rs apply_damage). Hurting someone's servitor flags you as hurting them would;
     * hit while it was told nothing, it fights back (unless it was told to stay: then it holds its ground). */
    pub fn pet_hurt(&mut self, src: u32, tid: u32, dmg: f64, now: f64) {
        let attacker = self.owner_of(src);
        let Some(p) = self.ents.get_mut(&tid).and_then(|e| e.pet_mut()) else { return };
        p.hp -= dmg;
        p.last_combat = now;
        let (owner, dead, idle) = (p.owner, p.hp <= 0.0, p.order.is_none() && p.skill.is_none() && p.casting.is_none() && p.stay.is_none());
        if let Some(a) = attacker.filter(|&a| a != owner) {
            if self.arena.is_some() { self.arena_hit(a, dmg); }
            else if self.pl(owner).map_or(0, |o| o.karma) == 0 { if let Some(ap) = self.pl_mut(a) { ap.pvp_until = now + PVP_FLAG_MS; } }
        }
        if dead { return self.kill_pet(tid, now); }
        let fights = src != tid && src != owner && self.ents.get(&src).is_some_and(|e| e.is_fighter() && !e.c.dead) && self.can_attack(owner, src, false, now).is_none();
        if idle && fights { if let Some(p) = self.ents.get_mut(&tid).and_then(|e| e.pet_mut()) { p.order = Some((src, false)); } }
    }

    pub fn update_pet(&mut self, id: u32, dt: f64, now: f64) {
        let (owner, dead) = { let e = &self.ents[&id]; (e.pet().unwrap().owner, e.c.dead) };
        if dead { return; }
        // its owner gone from this world (or with it sent away): it goes too
        let Some(oe) = self.ents.get(&owner).filter(|e| e.player().is_some_and(|p| p.pets.contains(&id))) else {
            self.remove(id);
            return;
        };
        let (ox, oz, ory) = (oe.c.x, oe.c.z, oe.c.ry);
        let op = oe.player().unwrap();
        let (olvl, opow, ospeed) = (op.level, op.stats.pet_power, op.stats.speed);
        let (slot, out) = (op.pets.iter().position(|x| *x == id).unwrap_or(0), op.pets.len());
        let oflags = oe.flags(now) & (F_PVP | F_PURPLE | F_RED);
        // its owner's level, always: a level up heals it as it does them, and shows on it too
        let was = self.ents.get(&id).and_then(|e| e.pet()).map_or(olvl, |p| p.level);
        if olvl > was { self.send_near(ox, oz, json!({ "t": "levelUp", "id": id, "lvl": olvl })); }
        let e = self.ents.get_mut(&id).unwrap();
        if was != olvl { e.c.av += 1; } // its record again, with the new level, for everyone around
        let (stunned, wound, (px, pz)) = (e.c.has("stun", now), e.c.heal_mul(now), (e.c.x, e.c.z));
        let p = e.pet_mut().unwrap();
        p.owner_flags = oflags;
        // its owner levelled up, or learned a passive: it grows with them
        if p.level != olvl || (p.power - opow).abs() > 1e-9 {
            (p.level, p.power) = (olvl, opow);
            p.recalc();
            if olvl > was { (p.hp, p.mp) = (p.stats.max_hp, p.stats.max_mp); }
        }
        if p.buffs.iter().any(|b| b.until <= now) {
            p.buffs.retain(|b| b.until > now);
            p.recalc();
        }
        let regen = if now - p.last_combat < IN_COMBAT_MS { 0.6 } else { 1.5 };
        p.hp = (p.hp + p.stats.hp_regen * dt * regen * wound).min(p.stats.max_hp);
        p.mp = (p.mp + p.stats.mp_regen * dt * regen).min(p.stats.max_mp);
        if stunned {
            e.c.moving = false;
            return;
        }
        // left far behind (its owner ran off): it catches up at once
        if (px - ox).hypot(pz - oz) > LEASH { return self.bring_pet(owner, id); }
        if let Some((_, _, end)) = p.casting {
            if now >= end { self.pet_finish_cast(id, now); }
            return;
        }
        if let Some((skill, target, force)) = p.skill.clone() { return self.pet_skill_step(id, &skill, target, force, dt, now); }
        let (stay, order, speed, range, interval) = (p.stay, p.order, p.stats.speed, p.def.range, p.stats.atk_interval);
        if let Some((t, force)) = order {
            let ok = self.ents.get(&t).is_some_and(|te| te.is_fighter() && !te.c.dead) && self.can_attack(owner, t, force, now).is_none();
            if ok {
                let (tx, tz, tr) = { let c = &self.ents[&t].c; (c.x, c.z, c.radius) };
                let reach = range + tr;
                if (px - tx).hypot(pz - tz) > reach {
                    self.step_toward(id, tx, tz, speed * 1.1, dt, reach - 0.3);
                } else {
                    self.ents.get_mut(&id).unwrap().c.moving = false;
                    self.face(id, t);
                    let p = self.ents.get_mut(&id).unwrap().pet_mut().unwrap();
                    if now >= p.next_attack {
                        p.next_attack = now + interval;
                        self.pet_attack(id, t, now);
                    }
                }
                return;
            }
            self.ents.get_mut(&id).unwrap().pet_mut().unwrap().order = None;
        }
        match stay {
            Some((sx, sz)) => { self.step_toward(id, sx, sz, speed, dt, 0.3); }
            None => {
                // a step behind its owner (side by side with the others), keeping up with them however fast they go
                let (fx, fz) = follow_spot(ox, oz, ory, slot, out);
                let moving = self.ents[&id].c.moving;
                if (px - fx).hypot(pz - fz) > 0.5 && ((px - ox).hypot(pz - oz) > CLOSE || moving) {
                    self.step_toward(id, fx, fz, speed.max(ospeed * 1.1), dt, 0.3);
                } else {
                    self.ents.get_mut(&id).unwrap().c.moving = false;
                }
            }
        }
    }

    /** Its own blow: a bite at arm's length (a melee servitor's), a bolt of magic from afar (the others'). */
    fn pet_attack(&mut self, id: u32, tid: u32, now: f64) {
        let (x, z) = { let c = &self.ents[&id].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "atk", "s": id, "tg": tid }));
        let (p_def, m_def, eva) = self.def_stats(tid);
        let p = self.ents[&id].pet().unwrap();
        let (st, melee) = (p.stats.clone(), p.def.role == "melee");
        if self.pl(tid).is_some_and(|t| t.dodge_until > now) || (melee && rnd() > hit_chance(st.accuracy, eva)) { return self.send_miss(id, tid); }
        let crit = rnd() * 100.0 < st.crit;
        let (dmg, blk) = if melee { self.blocked(tid, phys_damage(st.p_atk, p_def, 1.0, crit)) } else { (magic_damage(st.m_atk, m_def, 1.0, crit), false) };
        self.apply_damage(id, tid, dmg, now, crit, false, blk);
        if melee { self.reflect(tid, id, dmg, now); }
    }

    /** Its owner's order (msgs.rs "pet"), to the servitor they named (`which`; else the one out longest): attack their
     * target, follow, stay, stop, go away, or use one of its skills (the one that knows it: each is a different one). */
    pub fn pet_command(&mut self, pid: u32, what: &str, skill: &str, force: bool, which: Option<u32>) {
        let knows = |w: &World, id: &u32| w.ents[id].pet().is_some_and(|p| p.def.skills.iter().any(|k| k == skill));
        let by_skill = if what == "skill" { self.pets_of(pid).into_iter().find(|id| knows(self, id)) } else { None };
        let Some(id) = by_skill.or_else(|| self.pet_for(pid, which)) else {
            if which.is_some() && !self.pets_of(pid).is_empty() { return self.sys(pid, "Ese servitor ya no está.", "That servitor is gone."); }
            return self.sys(pid, "No tenés un servitor invocado.", "You have no servitor out.");
        };
        if what == "dismiss" { return self.dismiss_pet(pid, id, true); }
        let now = self.now;
        match what {
            "attack" => {
                let Some(t) = self.pl(pid).unwrap().target.filter(|t| *t != id && self.ents.contains_key(t)) else {
                    return self.sys(pid, "Primero elegí un objetivo.", "Select a target first.");
                };
                if let Some(err) = self.can_attack(pid, t, force, now) { return self.sys(pid, &err, &err); }
                let p = self.ents.get_mut(&id).unwrap().pet_mut().unwrap();
                (p.order, p.skill) = (Some((t, force)), None);
            }
            "follow" | "stay" | "stop" => {
                let e = self.ents.get_mut(&id).unwrap();
                let (x, z) = (e.c.x, e.c.z);
                e.c.moving = false;
                e.c.nav = None;
                let p = e.pet_mut().unwrap();
                (p.order, p.skill) = (None, None);
                match what {
                    "follow" => p.stay = None,
                    "stay" => p.stay = Some((x, z)),
                    _ => {}
                }
                if what == "stop" && p.casting.take().is_some() { self.send_near(x, z, json!({ "t": "castx", "s": id })); }
            }
            "skill" => self.pet_skill_request(pid, id, skill, force, now),
            _ => {}
        }
    }

    /** One of its skills, pressed by its owner: checked here (it knows it, it is ready, it has the MP, the target), cast
     * once it is in range (pet_skill_step). An enemy skill goes at its owner's target, else at what it is fighting. */
    fn pet_skill_request(&mut self, pid: u32, id: u32, skill: &str, force: bool, now: f64) {
        let p = self.ents[&id].pet().unwrap();
        let Some(def) = d().pet_skill(skill).filter(|s| p.def.skills.iter().any(|k| *k == s.id)) else {
            return self.sys(pid, "Tu servitor no conoce esa habilidad.", "Your servitor does not know that skill.");
        };
        if self.ents[&id].c.has("stun", now) { return self.sys(pid, "Tu servitor está aturdido.", "Your servitor is stunned."); }
        if p.casting.is_some() { return self.sys(pid, "Tu servitor está lanzando otra habilidad.", "Your servitor is casting another skill."); }
        if p.cooldowns.get(&def.id).copied().unwrap_or(0.0) > now { return self.sys(pid, &format!("{} todavía no está lista.", def.name), &format!("{} is not ready yet.", def.name_en)); }
        let def = tuned_skill(def);
        if p.mp < def.mp { return self.sys(pid, "A tu servitor no le alcanza el MP.", "Your servitor does not have enough MP."); }
        let target = match def.target.as_str() {
            "enemy" => {
                let mine = self.pl(pid).unwrap().target.filter(|t| *t != id && *t != pid && self.ents.contains_key(t));
                let Some(t) = mine.or(p.order.map(|o| o.0)) else { return self.sys(pid, "Primero elegí un objetivo.", "Select a target first.") };
                if let Some(err) = self.can_attack(pid, t, force, now) { return self.sys(pid, &err, &err); }
                t
            }
            "owner" => pid,
            _ => id,
        };
        self.ents.get_mut(&id).unwrap().pet_mut().unwrap().skill = Some((def.id.clone(), target, force));
    }

    /** Its skill on its way: walk into range, then start the cast. */
    fn pet_skill_step(&mut self, id: u32, skill: &str, target: u32, force: bool, dt: f64, now: f64) {
        let Some(def) = d().pet_skill(skill).map(tuned_skill) else { return };
        let owner = self.ents[&id].pet().unwrap().owner;
        let bad = match self.ents.get(&target) {
            None => true,
            Some(t) => t.c.dead || !t.is_fighter() || (def.target == "enemy" && self.can_attack(owner, target, force, now).is_some()),
        };
        if bad {
            let e = self.ents.get_mut(&id).unwrap();
            e.c.moving = false;
            e.pet_mut().unwrap().skill = None;
            return;
        }
        let (tx, tz, tr) = { let c = &self.ents[&target].c; (c.x, c.z, c.radius) };
        let range = def.range + tr;
        let pc = &self.ents[&id].c;
        if target != id && (pc.x - tx).hypot(pc.z - tz) > range {
            let speed = self.ents[&id].pet().unwrap().stats.speed;
            self.step_toward(id, tx, tz, speed * 1.1, dt, (range - 0.4).max(0.5));
            return;
        }
        self.ents.get_mut(&id).unwrap().c.moving = false;
        if target != id { self.face(id, target); }
        let p = self.ents.get_mut(&id).unwrap().pet_mut().unwrap();
        p.skill = None;
        if p.cooldowns.get(&def.id).copied().unwrap_or(0.0) > now || p.mp < def.mp { return; }
        let dur = jround(def.cast * p.stats.cast_mul);
        p.casting = Some((def.id.clone(), target, now + dur));
        // after a blow of its own it keeps fighting that one
        if def.target == "enemy" && p.order.is_none() { p.order = Some((target, force)); }
        let (x, z) = { let c = &self.ents[&id].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "cast", "s": id, "tg": target, "skill": def.id, "dur": dur }));
    }

    /** Its cast went off: the MP and the cooldown (its owner's bars show it, as `pet:<skill>`), then what it does. */
    fn pet_finish_cast(&mut self, id: u32, now: f64) {
        let p = self.ents.get_mut(&id).unwrap().pet_mut().unwrap();
        let Some((skill, target, _)) = p.casting.take() else { return };
        let Some(def) = d().pet_skill(&skill).map(tuned_skill) else { return };
        if p.mp < def.mp { return; }
        p.mp -= def.mp;
        p.cooldowns.insert(def.id.clone(), now + def.cooldown);
        let (owner, m_atk) = (p.owner, p.stats.m_atk);
        self.send(owner, json!({ "t": "cd", "key": format!("pet:{}", def.id), "ms": def.cooldown }));
        match self.ents.get(&target) { Some(t) if !t.c.dead && t.is_fighter() => {}, _ => return }
        if def.target == "enemy" && self.unseen(target) { return; }
        let (px, pz) = { let c = &self.ents[&id].c; (c.x, c.z) };
        self.send_near(px, pz, json!({ "t": "fx", "s": id, "tg": target, "skill": def.id }));
        match def.kind.as_str() {
            "phys" | "magic" | "drain" => self.skill_hits(id, &def, target, now),
            "heal" => {
                let mul = self.ents[&target].c.heal_mul(now);
                let Some(t) = self.pl_mut(target) else { return };
                let before = t.hp;
                t.hp = (t.hp + heal_amount(def.power, m_atk) * mul).min(t.stats.max_hp);
                let v = jround(t.hp - before);
                self.send(target, json!({ "t": "dmg", "s": id, "tg": target, "v": v, "heal": true }));
                self.heal_aggro(id, target, v);
            }
            "buff" => self.pet_buff(owner, target, &def, now),
            "taunt" => {
                let (x, z) = { let c = &self.ents[&target].c; (c.x, c.z) };
                self.taunt(id, x, z, def.aoe.unwrap_or(6.0), now);
            }
            _ => {}
        }
    }

    /** The summoner's heal, mana or buff for its servitors (Curar Servitor, Recargar, its shields): on every one of them
     * within its range of the caster, the one it was cast at always. A heal gives back a share of its own HP, which a
     * same-level mob's curves set (and mana, of its MP). */
    pub fn tend_pets(&mut self, pid: u32, def: &SkillDef, target: u32, now: f64) {
        let heal_power = self.pl(pid).unwrap().stats.heal_power;
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        let pets: Vec<u32> = self.pets_of(pid).into_iter().filter(|&id| id == target || { let c = &self.ents[&id].c; (c.x - x).hypot(c.z - z) <= def.range + 1.0 }).collect();
        for &id in &pets {
            if id != target { self.send_near(x, z, json!({ "t": "fx", "s": pid, "tg": id, "skill": def.id })); }
            let mul = self.ents[&id].c.heal_mul(now);
            let Some(pt) = self.ents.get_mut(&id).and_then(|e| e.pet_mut()) else { continue };
            match def.kind.as_str() {
                "heal" => {
                    let before = pt.hp;
                    pt.hp = (pt.hp + pt.stats.max_hp * def.power / 100.0 * heal_power * mul).min(pt.stats.max_hp);
                    let v = jround(pt.hp - before);
                    self.send(pid, json!({ "t": "dmg", "s": pid, "tg": id, "v": v, "heal": true }));
                    self.heal_aggro(pid, id, v);
                }
                "mana" => {
                    let before = pt.mp;
                    pt.mp = (pt.mp + pt.stats.max_mp * def.power / 100.0 * heal_power).min(pt.stats.max_mp);
                    let v = jround(pt.mp - before);
                    self.send(pid, json!({ "t": "dmg", "s": pid, "tg": id, "v": v, "mana": true }));
                }
                "buff" => {
                    let Some(buff) = &def.buff else { return };
                    pt.buffs.retain(|b| b.id != def.id);
                    pt.buffs.push(Buff { id: def.id.clone(), until: now + buff.dur, mods: buff.mods.clone() });
                    pt.recalc();
                }
                _ => {}
            }
        }
        if def.kind == "buff" {
            if pets.len() > 1 { self.sys(pid, &format!("Tus servitores recibieron {}.", def.name), &format!("{} has been applied to your servitors.", def.name_en)); }
            else { self.sys(pid, &format!("Tu servitor recibió {}.", def.name), &format!("{} has been applied to your servitor.", def.name_en)); }
        }
    }

    /** A servitor's blessing, on its owner (or on itself). */
    fn pet_buff(&mut self, owner: u32, target: u32, def: &SkillDef, now: f64) {
        let Some(buff) = &def.buff else { return };
        let b = Buff { id: def.id.clone(), until: now + buff.dur, mods: buff.mods.clone() };
        let on_owner = match &mut self.ents.get_mut(&target).unwrap().k {
            Kind::Player(p) => {
                p.buffs.retain(|x| x.id != def.id);
                p.buffs.push(b);
                p.recalc();
                true
            }
            Kind::Pet(p) => {
                p.buffs.retain(|x| x.id != def.id);
                p.buffs.push(b);
                p.recalc();
                false
            }
            _ => false,
        };
        if on_owner { self.sys(owner, &format!("Recibiste {}.", def.name), &format!("{} has been applied.", def.name_en)); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /** A same-level plain mob and a servitor, at every grade: a fighting summon outfights one of them (it is the
     * summoner's blade and shield), but not by so much that two or three are no threat; the support one is no fighter,
     * but lives long enough to see its summoner through. `cargo test servitors_hold -- --nocapture` prints the table. */
    #[test]
    fn servitors_hold_their_own() {
        let data = d();
        for sv in &data.servitors {
            for lvl in [sv.level, (sv.level + 78) / 2, 78] {
                let mob = data.mobs.values().filter(|m| m.boss != Some(true) && m.hp_mult.unwrap_or(1.0) == 1.0 && m.atk_mult.unwrap_or(1.0) == 1.0 && m.def_mult.unwrap_or(1.0) == 1.0)
                    .min_by_key(|m| ((m.level - lvl).abs(), m.id.clone())).unwrap();
                // (a servitor at the mob's own level: the nearest plain mob is not always at this one)
                let (ms, ps) = (mob_stats(mob), pet_stats(sv, mob.level, 1.0, &[]));
                // its own blow, an auto-attack (a bite, or a bolt), against the mob's defence
                let hit = 70.0 * if sv.role == "melee" { ps.p_atk / ms.p_def } else { ps.m_atk / ms.m_def };
                let to_kill = ms.max_hp / hit;
                // the mob's bite on it
                let bite = 70.0 * ms.p_atk / ps.p_def;
                let to_die = ps.max_hp / bite;
                // seconds each side needs, swinging at its own pace
                let (kill_s, die_s) = (to_kill * sv.atk_interval / 1000.0, to_die * mob.atk_interval / 1000.0);
                println!("{:>13} lvl {:2} vs {:>16} (lvl {:2}): kills it in {to_kill:4.1} blows, {kill_s:3.0} s; dies in {to_die:4.1} bites, {die_s:3.0} s", sv.id, lvl, mob.id, mob.level);
                if sv.role == "support" {
                    assert!(die_s > 12.0, "{} at {lvl}: dies in {die_s:.0} s to a {}", sv.id, mob.id);
                    continue;
                }
                assert!((4.0..40.0).contains(&to_kill), "{} at {lvl} needs {to_kill:.1} blows on {}", sv.id, mob.id);
                assert!(die_s > kill_s * 0.8, "{} at {lvl}: dies in {die_s:.0} s to a {} it kills in {kill_s:.0} s", sv.id, mob.id);
                assert!(die_s < kill_s * 6.0, "{} at {lvl}: {} needs {die_s:.0} s to kill it, it {kill_s:.0} s", sv.id, mob.id);
            }
        }
    }

    /** Every summon calls a servitor that exists, once, at its level (the awakening's from its evolution); every
     * servitor skill exists and none shares an id with a player's skill or a passive. */
    #[test]
    fn servitors_wired() {
        let data = d();
        for s in data.skills.iter().filter(|s| s.kind == "summon") {
            let sv = s.summon.as_deref().and_then(|id| data.servitor(id)).unwrap_or_else(|| panic!("{} summons nothing", s.id));
            assert_eq!(sv.level, s.level, "{} is learned at {}, its servitor at {}", s.id, s.level, sv.level);
        }
        for sv in &data.servitors {
            let summons: Vec<_> = data.skills.iter().filter(|s| s.summon.as_deref() == Some(sv.id.as_str())).collect();
            assert_eq!(summons.len(), 1, "{} is summoned by {} skills", sv.id, summons.len());
            let spec = summons[0].spec.as_deref().and_then(|sp| data.spec(sp)).expect("a summoner's skill");
            assert_eq!(spec.parent.is_some(), sv.level >= 76, "{}: the awakening's servitor is its evolution's", sv.id);
            for k in &sv.skills { assert!(data.pet_skill(k).is_some(), "{} has no skill {k}", sv.id); }
        }
        for s in &data.pet_skills {
            assert!(data.skill(&s.id).is_none() && !data.passives.iter().any(|p| p.id == s.id), "{} is a player's id too", s.id);
            assert!(["enemy", "owner", "self"].contains(&s.target.as_str()), "{} aims at {}", s.id, s.target);
            assert!(data.servitors.iter().any(|sv| sv.skills.contains(&s.id)), "{} belongs to no servitor", s.id);
        }
    }

    /** As many servitors out at once as the level allows: one, two from 40, three from 70, never more than there are. */
    #[test]
    fn servitor_slots_by_level() {
        let data = d();
        for (lvl, n) in [(1, 1), (39, 1), (40, 2), (69, 2), (70, 3), (78, 3)] { assert_eq!(data.pet_slots(lvl), n, "level {lvl}"); }
        assert!(data.pet_slots(data.c.max_level) <= data.servitors.len());
    }

    /** Transferir Dolor and the summoner's passives add up in the owner's stats. */
    #[test]
    fn transfer_and_pet_power_sum() {
        let (a, b) = (crate::data::BuffMods { transfer: Some(0.35), pet: Some(1.08), ..Default::default() }, crate::data::BuffMods { pet: Some(1.12), ..Default::default() });
        let s = compute_stats("human", "mystic", 60, &[], &[&a, &b], "m");
        assert!((s.transfer - 0.35).abs() < 1e-9);
        assert!((s.pet_power - 1.08 * 1.12).abs() < 1e-9);
        let plain = compute_stats("human", "mystic", 60, &[], &[], "m");
        assert_eq!((plain.transfer, plain.pet_power), (0.0, 1.0));
        // and a servitor of a stronger summoner is that much stronger
        let sv = d().servitor("war_wolf").unwrap();
        assert!(pet_stats(sv, 60, s.pet_power, &[]).max_hp > pet_stats(sv, 60, 1.0, &[]).max_hp * 1.2);
    }
}
