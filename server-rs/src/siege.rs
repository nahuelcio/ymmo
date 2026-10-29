//! Fort sieges (shared/src/data/sieges.ts, d().siege). Every Saturday at 21:00 (Argentina) the five forts past the
//! village are fought over for an hour, all at once.
//!
//! - **The Guardian:** one stands by each fort's brazier and fights anyone but the owning clan and its alliance.
//!   When it falls, the fort goes to the clan that dealt it the most damage, if that clan may hold it (SIEGE.level and
//!   no other fort); if it may not, the next one down the list. If the Guardian stands the hour, the owner keeps the
//!   fort, for reputation.
//! - **The zone:** while a fort is under siege, its zone (its radius plus SIEGE.zone) is a PvP zone instead of a
//!   peace zone (terrain.rs asks besieged_at), so everyone there is flagged and nobody gets karma. The owner's side
//!   comes back inside it, the others at the camp on the nearest road out. Gatekeepers take nobody into it, and
//!   nobody rests in its huts or tents.
//! - **The tax:** the owner earns SIEGE.tax on the adena spent at the fort's merchants (inventory.rs).
//!
//! The owners outlive any one world, like the clans: one registry (OWNERS) for every world thread, loaded once and
//! written through. The sieges themselves run in the overworld, the only world with the forts. Locks: when both are
//! needed, the clans' registry is taken before OWNERS, never the other way round.
use crate::clans::{announce_all, cast_all, reg};
use crate::collision::{push_out, P};
use crate::data::d;
use crate::db::Db;
use crate::formulas::{loot_week, next_siege_at, rnd, siege_window};
use crate::world::World;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{OnceLock, RwLock};

/** fort (its index in d().siege.forts) -> the clan holding it */
static OWNERS: OnceLock<RwLock<HashMap<usize, u32>>> = OnceLock::new();
/** the forts under siege now: bit i is d().siege.forts[i] */
static BESIEGED: AtomicU32 = AtomicU32::new(0);

fn owners() -> &'static RwLock<HashMap<usize, u32>> {
    OWNERS.get_or_init(|| {
        let forts = &d().siege.forts;
        let rows = Db::open().fort_owners();
        RwLock::new(rows.into_iter().filter_map(|(f, c)| Some((forts.iter().position(|x| x.id == f)?, c as u32))).collect())
    })
}
/** The clan holding this fort. */
pub fn owner(fort: usize) -> Option<u32> { owners().read().unwrap().get(&fort).copied() }
/** The fort this clan holds. */
pub fn fort_of(clan: u32) -> Option<usize> { owners().read().unwrap().iter().find(|(_, &c)| c == clan).map(|(&f, _)| f) }
fn set_owner(db: &Db, fort: usize, clan: Option<u32>, now: f64) {
    let mut o = owners().write().unwrap();
    match clan { Some(c) => { o.insert(fort, c); } None => { o.remove(&fort); } }
    db.set_fort_owner(&d().siege.forts[fort].id, clan.map(|c| c as i64), now);
}
/** A dissolved clan's fort is nobody's (its database row went with the clan, db.rs clan_delete). */
pub fn clan_gone(clan: u32) {
    let was = { let mut o = owners().write().unwrap(); let f = o.iter().find(|(_, &c)| c == clan).map(|(&f, _)| f); if let Some(f) = f { o.remove(&f); } f };
    if was.is_some() { cast_all(&sieges_msg(None)); }
}

/** The fort under siege whose zone holds (x, z). */
pub fn besieged_at(x: f64, z: f64) -> Option<usize> {
    let on = BESIEGED.load(Ordering::Relaxed);
    if on == 0 { return None; }
    let s = &d().siege;
    (0..s.forts.len()).find(|&i| on & (1 << i) != 0 && (x - s.forts[i].x).hypot(z - s.forts[i].z) < s.forts[i].r + s.zone)
}
fn besieged(fort: usize) -> bool { BESIEGED.load(Ordering::Relaxed) & (1 << fort) != 0 }

/** The fort whose town holds (x, z) (inside its peace zone): its merchants pay its owner's tax. */
pub fn fort_at(x: f64, z: f64) -> Option<usize> { d().siege.forts.iter().position(|f| (x - f.x).hypot(z - f.z) < f.r + 5.0) }

/** What the owner's tax adds to an adena price (shared/src/data/sieges.ts withTax: the same rounding). */
pub fn tax_on(price: i64) -> i64 { (price as f64 * d().siege.tax).round() as i64 }

/** Whether this character fights for the fort's owner: its clan, or a clan of its alliance. */
pub fn defends(char_id: i64, fort: usize) -> bool {
    let Some(o) = owner(fort) else { return false };
    let r = reg().read().unwrap();
    r.by_char.get(&char_id).is_some_and(|&c| r.allied(c, o))
}

/** What the clients know of the sieges: the forts under siege, who holds which, when the next one starts and, while
 * one runs, when it ends. */
pub fn sieges_msg(ends: Option<f64>) -> Value {
    let forts = &d().siege.forts;
    let on = BESIEGED.load(Ordering::Relaxed);
    let held: Vec<(usize, u32)> = owners().read().unwrap().iter().map(|(&f, &c)| (f, c)).collect();
    let r = reg().read().unwrap();
    let held: Map<String, Value> = held.into_iter().filter_map(|(f, c)| Some((forts[f].id.clone(), json!({ "id": c, "name": r.clans.get(&c)?.name })))).collect();
    let active: Vec<&str> = (0..forts.len()).filter(|i| on & (1 << i) != 0).map(|i| forts[i].id.as_str()).collect();
    json!({ "t": "sieges", "active": active, "owners": held, "next": next_siege_at(crate::world::now_ms()), "ends": ends })
}

/** A fort under siege: its Guardian, and the damage each clan has dealt it. */
pub struct FortSiege { pub fort: usize, pub guardian: u32, pub dmg: HashMap<u32, f64> }

/** The overworld's sieges: the one running (its start, end and key), an admin's instead of Saturday's, the warnings
 * already given, and each fort still being fought over. */
#[derive(Default)]
pub struct SiegeRun {
    pub on: Option<(f64, f64, i64)>,
    pub forced: Option<(f64, f64)>,
    pub warned: Vec<(i64, i64)>,
    pub forts: Vec<FortSiege>,
}

impl World {
    /** A Guardian spares the side it defends (it never picks them out, and they cannot hurt it), their servitors too. */
    pub fn spares(&self, mid: u32, pid: u32) -> bool {
        let Some(fort) = self.ents.get(&mid).and_then(|e| e.mob()).and_then(|m| m.guard) else { return false };
        self.owner_of(pid).and_then(|o| self.pl(o)).is_some_and(|p| defends(p.char_id, fort))
    }

    /** A player's blow on a Guardian, to its clan's count. */
    pub fn siege_hit(&mut self, fort: usize, pid: u32, dmg: f64) {
        let Some(cid) = self.pl(pid).map(|p| p.char_id) else { return };
        let Some(clan) = reg().read().unwrap().by_char.get(&cid).copied() else { return };
        if let Some(s) = self.siege.forts.iter_mut().find(|s| s.fort == fort) { *s.dmg.entry(clan).or_default() += dmg; }
    }

    /** Once a second, in the overworld: the warnings before a siege, its start and its end. */
    pub fn siege_tick(&mut self, now: f64) {
        let (start, end, key) = match self.siege.forced {
            Some((s, e)) => (s, e, s as i64),
            None => { let (s, e) = siege_window(now); (s, e, loot_week(s)) }
        };
        for &m in &d().siege.warn {
            let w = (key, m as i64);
            if now >= start - m * 60_000.0 && now < start && !self.siege.warned.contains(&w) {
                self.siege.warned.push(w);
                announce_all(&format!("El asedio de los fuertes empieza en {m} min. Los clanes de nivel {} o más pueden tomarlos.", d().siege.level),
                    &format!("The fort sieges begin in {m} min. Clans of level {} or more may take them.", d().siege.level));
            }
        }
        if now >= start && now < end {
            if self.siege.on.is_none() { self.siege_start(start, end, key, now); }
        } else if self.siege.on.is_some() {
            self.siege_end(now);
        }
        if self.siege.on.is_none() && self.siege.forced.is_some_and(|(_, e)| now >= e) { self.siege.forced = None; }
    }

    /** The admin panel: a siege now, for `minutes` (instead of waiting for Saturday), or the running one over now. */
    pub fn siege_admin(&mut self, start: bool, minutes: f64) {
        let now = self.now;
        if self.siege.on.is_some() { self.siege_end(now); }
        self.siege.forced = start.then(|| (now, now + minutes.clamp(1.0, 240.0) * 60_000.0));
        if start { self.siege_tick(now); }
    }

    /** The siege begins: a Guardian by each brazier whose fort is still to be decided, and their zones turn to PvP. */
    fn siege_start(&mut self, start: f64, end: f64, key: i64, now: f64) {
        self.siege.on = Some((start, end, key));
        let done = self.db.sieges_done(key);
        let s = &d().siege;
        let mut bits = 0u32;
        for (i, f) in s.forts.iter().enumerate() {
            if done.contains(&f.id) { continue; }
            let g = self.spawn_mob(&s.guardian, f.x + 4.0, f.z);
            let m = self.ents.get_mut(&g).unwrap().mob_mut().unwrap();
            // it keeps its post by the brazier: no strolling round the plaza between fights
            (m.no_loot, m.xp_scale, m.guard, m.wander_at) = (true, 0.0, Some(i), f64::INFINITY);
            self.siege.forts.push(FortSiege { fort: i, guardian: g, dmg: HashMap::new() });
            bits |= 1 << i;
        }
        BESIEGED.store(bits, Ordering::Relaxed);
        if bits == 0 { return; }
        // nobody sits the siege out in a hut of its zone
        for pid in self.players.clone() {
            let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
            if besieged_at(x, z).is_some() && self.sheltered(pid) {
                self.stand_up(pid);
                self.sys(pid, "Empezó el asedio: tuviste que salir de la cabaña.", "The siege has begun: you had to leave the hut.");
            }
        }
        let mins = ((end - now) / 60_000.0).round();
        announce_all(&format!("¡Empezó el asedio de los fuertes! Durante {mins} min, cada fuerte es zona PvP: el clan que más daño le haga a su Guardián se lo queda."),
            &format!("The fort sieges have begun! For {mins} min every fort is a PvP zone: the clan that deals its Guardian the most damage takes it."));
        cast_all(&sieges_msg(Some(end)));
    }

    /** A Guardian fell: its fort goes to the clan that dealt it the most damage (of those that may hold it), and is a
     * peace zone again. */
    pub fn fort_taken(&mut self, fort: usize, now: f64) {
        let Some(pos) = self.siege.forts.iter().position(|s| s.fort == fort) else { return };
        let fs = self.siege.forts.remove(pos);
        let key = self.siege.on.map_or(0, |o| o.2);
        let f = &d().siege.forts[fort];
        self.db.siege_done(key, &f.id);
        BESIEGED.fetch_and(!(1u32 << fort), Ordering::Relaxed);
        let old = owner(fort);
        let mut by: Vec<(u32, f64)> = fs.dmg.into_iter().collect();
        by.sort_by(|a, b| b.1.total_cmp(&a.1));
        let winner = {
            let r = reg().read().unwrap();
            by.iter().map(|x| x.0).find(|&c| r.clans.get(&c).is_some_and(|cl| cl.level >= d().siege.level) && fort_of(c).map_or(true, |o| o == fort))
        };
        set_owner(&self.db, fort, winner, now);
        match winner {
            Some(c) => {
                let name = reg().read().unwrap().clans.get(&c).map(|cl| cl.name.clone()).unwrap_or_default();
                announce_all(&format!("¡El clan {name} tomó {}!", f.name), &format!("The clan {name} has taken {}!", f.name_en));
                self.clan_rep_of(c, d().clans.rep.siege_win, "tomar un fuerte", "taking a fort");
            }
            None => announce_all(&format!("Cayó el Guardián de {}: el fuerte queda sin dueño.", f.name), &format!("The Guardian of {} has fallen: the fort is left without an owner.", f.name_en)),
        }
        for c in [old, winner].into_iter().flatten() { crate::clans::push_clan(c); }
        let ends = self.siege.on.map(|o| o.1);
        cast_all(&sieges_msg(ends.filter(|_| !self.siege.forts.is_empty())));
    }

    /** The hour is up: the Guardians still standing go, and their forts stay with whoever held them. */
    fn siege_end(&mut self, _now: f64) {
        let Some((_, _, key)) = self.siege.on.take() else { return };
        for fs in std::mem::take(&mut self.siege.forts) {
            let f = &d().siege.forts[fs.fort];
            self.db.siege_done(key, &f.id);
            if self.ents.contains_key(&fs.guardian) {
                self.remove(fs.guardian);
                self.mobs.retain(|&x| x != fs.guardian);
            }
            match owner(fs.fort) {
                Some(c) => {
                    let name = reg().read().unwrap().clans.get(&c).map(|cl| cl.name.clone()).unwrap_or_default();
                    announce_all(&format!("El clan {name} defendió {}.", f.name), &format!("The clan {name} has held {}.", f.name_en));
                    self.clan_rep_of(c, d().clans.rep.siege_hold, "defender un fuerte", "holding a fort");
                }
                None => announce_all(&format!("{} resistió el asedio: sigue sin dueño.", f.name), &format!("{} withstood the siege: it still has no owner.", f.name_en)),
            }
        }
        BESIEGED.store(0, Ordering::Relaxed);
        cast_all(&sieges_msg(None));
    }

    /** Where a player who died (or escapes) comes back while a siege runs: an attacker who fell in a siege zone at the
     * camp on the nearest road out of it; anyone else to the nearest town, never into a fort under siege that is not
     * theirs. None: the usual nearest town. */
    pub fn siege_point(&self, pid: u32, x: f64, z: f64) -> Option<P> {
        if BESIEGED.load(Ordering::Relaxed) == 0 { return None; }
        let cid = self.pl(pid)?.char_id;
        let s = &d().siege;
        if let Some(i) = besieged_at(x, z) {
            if defends(cid, i) { return None; }
            let dist = |c: &&(f64, f64)| (c.0 - x).hypot(c.1 - z);
            let &(cx, cz) = s.forts[i].camps.iter().min_by(|a, b| dist(a).total_cmp(&dist(b)))?;
            return Some(push_out(cx + (rnd() - 0.5) * 6.0, cz + (rnd() - 0.5) * 6.0, d().c.walk_radius));
        }
        Some(crate::world::town_near_where(Some((x, z)), |t| fort_at(t.x, t.z).map_or(true, |f| !besieged(f) || defends(cid, f))))
    }

    /** `/asedio`: who holds each fort, and when the next siege is (or how long the one running has left). */
    pub fn siege_info(&mut self, pid: u32) {
        let now = self.now;
        let forts = &d().siege.forts;
        let names: Vec<(String, String, Option<String>)> = {
            let held: Vec<Option<u32>> = (0..forts.len()).map(owner).collect();
            let r = reg().read().unwrap();
            forts.iter().zip(held).map(|(f, c)| (f.name.clone(), f.name_en.clone(), c.and_then(|c| r.clans.get(&c)).map(|cl| cl.name.clone()))).collect()
        };
        for (i, (es, en, clan)) in names.iter().enumerate() {
            let war = if besieged(i) { (" — bajo asedio", " — under siege") } else { ("", "") };
            match clan {
                Some(c) => self.sys(pid, &format!("{es}: clan {c}{}", war.0), &format!("{en}: clan {c}{}", war.1)),
                None => self.sys(pid, &format!("{es}: sin dueño{}", war.0), &format!("{en}: no owner{}", war.1)),
            }
        }
        if let Some((_, end, _)) = self.siege.on.filter(|_| !self.siege.forts.is_empty()) {
            let m = ((end - now) / 60_000.0).ceil();
            return self.sys(pid, &format!("El asedio termina en {m} min."), &format!("The siege ends in {m} min."));
        }
        let mins = ((next_siege_at(now) - now) / 60_000.0).ceil() as i64;
        let (h, m) = (mins / 60, mins % 60);
        self.sys(pid, &format!("Próximo asedio: el sábado a las 21:00 (en {h} h {m} min)."), &format!("Next siege: Saturday at 21:00 Argentina time (in {h} h {m} min)."));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::point_free;

    /// Every fort past the village is sieged; its camps stand on dry, open ground outside its zone (and nobody else's),
    /// and no raid floor lies in a siege zone (the zones are coordinates, shared by every world).
    #[test]
    fn forts_and_camps() {
        let s = &d().siege;
        assert_eq!(s.forts.len(), 5);
        assert!(s.forts.len() <= 32, "BESIEGED has a bit a fort");
        assert!(d().mobs.contains_key(&s.guardian), "the Guardian's mob");
        assert!(s.tax > 0.0 && s.tax < 0.5);
        for f in &s.forts {
            assert!(d().towns.iter().any(|t| t.x == f.x && t.z == f.z && t.r == f.r), "{}: a town", f.id);
            assert!((d().town.x - f.x).hypot(d().town.z - f.z) > 1.0, "the village is never sieged");
            assert!(f.camps.len() >= 2, "{}: a camp a road", f.id);
            for &(x, z) in &f.camps {
                assert!(!d().is_deep(x, z), "{}: a camp in the water", f.id);
                assert!(point_free(x, z, d().c.walk_radius), "{}: a camp in a wall", f.id);
                for g in &s.forts { assert!((x - g.x).hypot(z - g.z) >= g.r + s.zone, "{}: a camp inside {}'s zone", f.id, g.id); }
            }
        }
        for r in d().raids.values() {
            for f in &s.forts { assert!((r.x - f.x).hypot(r.z - f.z) > f.r + s.zone + 40.0, "{}: in {}'s siege zone", r.id, f.id); }
        }
        assert_eq!(tax_on(1000), 100);
        assert_eq!(tax_on(15), 2, "rounded as the client's withTax");
    }
}
