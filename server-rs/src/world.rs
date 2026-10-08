//! The authoritative world: entities, spatial grid, movement, snapshots and the 20 Hz tick
//! (port of server/src/world/World.ts). Systems live in their own files as more `impl World` blocks.
use crate::binary::{encode_snap, q_pos, q_rot, wire_time};
use crate::collision::{dash_end, find_path, line_clear, push_out, P};
use crate::data::{d, RaidDef};
use crate::db::Db;
use crate::ent::*;
use crate::formulas::{jround, rnd, xp_to_next};
use crate::i18n::{npc_lines, Lang};
use crate::terrain::{zone_at, Mulberry32};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const AOI: f64 = 90.0;
pub const TICK_MS: f64 = 50.0;
const DASH_CD: f64 = 5000.0;
const DODGE_MS: f64 = 450.0;
const GRID: f64 = 30.0;

pub fn now_ms() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

pub fn dist(a: &Common, b: &Common) -> f64 { (a.x - b.x).hypot(a.z - b.z) }

/** A character crossing between worlds (overworld <-> raid). */
pub struct Member { pub sid: u64, pub account_id: i64, pub char_id: i64, pub lang: Lang, pub out: Outbox }

pub enum HubEvent {
    /** /raid in the overworld: these members (already saved and removed) go into a new instance */
    EnterRaid { members: Vec<Member> },
    /** left a raid (saved at the village): load them back into the overworld */
    ToMain { member: Member },
    /** the session's character was saved after its socket closed */
    Closed,
    /** loading the character failed */
    JoinFailed { sid: u64 },
}

pub struct Party { pub id: u32, pub members: Vec<u32> }

pub struct CampState { pub def: &'static crate::data::CampDef, pub mobs: Vec<u32>, pub contributors: HashSet<u32>, pub cleared: bool, pub respawn_at: f64 }

type Deferred = Box<dyn FnOnce(&mut World, f64) + Send>;

pub struct World {
    pub ents: HashMap<u32, Ent>,
    /** player entity ids, in arrival order */
    pub players: Vec<u32>,
    pub mobs: Vec<u32>,
    pub parties: Vec<Party>,
    pub next_party: u32,
    pub camps: Vec<CampState>,
    grid: HashMap<(i64, i64), Vec<u32>>,
    pub now: f64,
    next_id: u32,
    pub tick_n: u64,
    deferred: Vec<(f64, Deferred)>,
    pub raid: Option<&'static RaidDef>,
    pub raid_boss: Option<u32>,
    pub raid_cleared_at: f64,
    /** socket session id -> player entity */
    pub sessions: HashMap<u64, u32>,
    pub events: Vec<HubEvent>,
    pub db: Db,
    pub tick_cost: f64,
}

impl World {
    pub fn new(db: Db, raid: Option<(&'static RaidDef, usize)>) -> World {
        let mut w = World {
            ents: HashMap::new(), players: vec![], mobs: vec![], parties: vec![], next_party: 1, camps: vec![], grid: HashMap::new(),
            now: now_ms(), next_id: 1, tick_n: 0, deferred: vec![], raid: raid.map(|r| r.0), raid_boss: None, raid_cleared_at: 0.0,
            sessions: HashMap::new(), events: vec![], db, tick_cost: 0.0,
        };
        if let Some((r, size)) = raid {
            let boss = w.spawn_mob(&r.boss, r.x, r.z);
            let m = w.ents.get_mut(&boss).unwrap();
            m.c.ry = std::f64::consts::PI;
            let mm = m.mob_mut().unwrap();
            mm.summoned = false;
            mm.stats.max_hp = jround(mm.stats.max_hp * crate::raid::hp_scale(size));
            mm.hp = mm.stats.max_hp;
            w.raid_boss = Some(boss);
            return w;
        }
        for def in &d().npcs {
            let id = w.new_id();
            let mut c = Common::new(id, def.x, def.z);
            c.ry = def.ry;
            w.add(Ent { c, k: Kind::Npc(Npc { def, next_chatter: 0.0 }) });
        }
        w.spawn_mobs();
        w
    }

    pub fn new_id(&mut self) -> u32 { let id = self.next_id; self.next_id += 1; id }

    fn key(x: f64, z: f64) -> (i64, i64) { ((x / GRID).floor() as i64, (z / GRID).floor() as i64) }

    pub fn add(&mut self, mut e: Ent) {
        let id = e.c.id;
        e.c.cell = Self::key(e.c.x, e.c.z);
        self.grid.entry(e.c.cell).or_default().push(id);
        if matches!(e.k, Kind::Player(_)) { self.players.push(id); }
        self.ents.insert(id, e);
    }

    pub fn remove(&mut self, id: u32) -> Option<Ent> {
        let e = self.ents.remove(&id)?;
        if let Some(c) = self.grid.get_mut(&e.c.cell) { c.retain(|&x| x != id); }
        if matches!(e.k, Kind::Player(_)) { self.players.retain(|&x| x != id); }
        Some(e)
    }

    pub fn set_pos(&mut self, id: u32, x: f64, z: f64) {
        let half = d().c.playable_half;
        let Some(e) = self.ents.get_mut(&id) else { return };
        e.c.x = x.clamp(-half, half);
        e.c.z = z.clamp(-half, half);
        let k = Self::key(e.c.x, e.c.z);
        if k != e.c.cell {
            let old = e.c.cell;
            e.c.cell = k;
            if let Some(c) = self.grid.get_mut(&old) { c.retain(|&x| x != id); }
            self.grid.entry(k).or_default().push(id);
        }
    }

    /** visible entities within r of (x,z) */
    pub fn near(&self, x: f64, z: f64, r: f64) -> Vec<u32> {
        let mut out = vec![];
        let (x0, x1) = (((x - r) / GRID).floor() as i64, ((x + r) / GRID).floor() as i64);
        let (z0, z1) = (((z - r) / GRID).floor() as i64, ((z + r) / GRID).floor() as i64);
        let r2 = r * r;
        for cx in x0..=x1 {
            for cz in z0..=z1 {
                let Some(c) = self.grid.get(&(cx, cz)) else { continue };
                for id in c {
                    let e = &self.ents[id];
                    let (dx, dz) = (e.c.x - x, e.c.z - z);
                    if !e.c.hidden && dx * dx + dz * dz <= r2 { out.push(*id); }
                }
            }
        }
        out
    }

    pub fn near_players(&self, x: f64, z: f64, r: f64) -> Vec<u32> {
        self.near(x, z, r).into_iter().filter(|id| matches!(self.ents[id].k, Kind::Player(_))).collect()
    }

    pub fn pl(&self, id: u32) -> Option<&Player> { self.ents.get(&id).and_then(|e| e.player()) }
    pub fn pl_mut(&mut self, id: u32) -> Option<&mut Player> { self.ents.get_mut(&id).and_then(|e| e.player_mut()) }
    pub fn c(&self, id: u32) -> Option<&Common> { self.ents.get(&id).map(|e| &e.c) }

    pub fn send(&self, pid: u32, v: Value) { if let Some(p) = self.pl(pid) { p.send(v) } }

    /** System chat line, in the player's language. */
    pub fn sys(&self, pid: u32, es: &str, en: &str) {
        if let Some(p) = self.pl(pid) {
            p.send(json!({ "t": "chat", "ch": "sys", "from": "", "text": if p.lang.en() { en } else { es } }));
        }
    }

    pub fn announce(&self, f: impl Fn(Lang) -> String) {
        let (es, en) = (json!({ "t": "chat", "ch": "announce", "from": "", "text": f(Lang::Es) }).to_string(), json!({ "t": "chat", "ch": "announce", "from": "", "text": f(Lang::En) }).to_string());
        for id in &self.players {
            if let Some(p) = self.pl(*id) { p.out.text(if p.lang.en() { en.clone() } else { es.clone() }); }
        }
    }

    pub fn send_near(&self, x: f64, z: f64, v: Value) { self.send_near_r(x, z, v, AOI) }
    pub fn send_near_r(&self, x: f64, z: f64, v: Value, r: f64) {
        let s = v.to_string();
        for id in self.near_players(x, z, r) { self.pl(id).unwrap().out.text(s.clone()); }
    }

    pub fn broadcast(&self, v: Value) {
        let s = v.to_string();
        for id in &self.players { if let Some(p) = self.pl(*id) { p.out.text(s.clone()) } }
    }

    pub fn find_player(&self, name: &str) -> Option<u32> {
        let l = name.to_lowercase();
        self.players.iter().copied().find(|id| self.pl(*id).map_or(false, |p| p.name.to_lowercase() == l))
    }

    pub fn town_point(&self) -> P {
        let t = &d().town;
        let (a, r) = (rnd() * std::f64::consts::TAU, 6.0 + rnd() * 6.0);
        push_out(t.x + a.cos() * r, t.z + a.sin() * r, d().c.walk_radius)
    }

    pub fn teleport(&mut self, pid: u32, x: f64, z: f64) {
        if let Some(e) = self.ents.get_mut(&pid) {
            e.c.moving = false;
            if let Some(p) = e.player_mut() {
                p.intent = None;
                p.casting = None;
                p.talking_to = None;
            }
        }
        self.set_pos(pid, x, z);
        self.send(pid, json!({ "t": "teleported" }));
    }

    pub fn later(&mut self, at: f64, f: impl FnOnce(&mut World, f64) + Send + 'static) { self.deferred.push((at, Box::new(f))); }

    /**
     * Move e toward (tx,tz) around static obstacles. Returns true when within stop.
     * Straight line when clear, otherwise follows a cached A* path.
     */
    pub fn step_toward(&mut self, id: u32, tx: f64, tz: f64, speed: f64, dt: f64, stop: f64) -> bool {
        let now = self.now;
        let e = self.ents.get_mut(&id).unwrap();
        let dd = (tx - e.c.x).hypot(tz - e.c.z);
        if dd <= stop + 0.001 {
            e.c.moving = false;
            e.c.nav = None;
            return true;
        }
        let (mut wx, mut wz, mut wstop) = (tx, tz, stop);
        if !line_clear(e.c.x, e.c.z, tx, tz) {
            let stale = match &e.c.nav { None => true, Some(n) => n.path.is_empty() || (n.gx - tx).hypot(n.gz - tz) > 1.5 || now - n.at > 1500.0 };
            if stale { e.c.nav = Some(Nav { gx: tx, gz: tz, at: now, path: find_path(e.c.x, e.c.z, tx, tz) }); }
            let (ex, ez) = (e.c.x, e.c.z);
            let path = &mut e.c.nav.as_mut().unwrap().path;
            while path.len() > 1 && (path[0].x - ex).hypot(path[0].z - ez) < 0.15 { path.remove(0); }
            // The path ends short of the target (it sits where the grid is blocked) and we are standing on
            // its last node: this is as close as it gets. Stop instead of walking in place forever.
            if path.len() == 1 && (path[0].x - ex).hypot(path[0].z - ez) < 0.15 && (path[0].x - tx).hypot(path[0].z - tz) > 0.01 {
                e.c.moving = false;
                return false;
            }
            if path.len() > 1 || (path[0].x - tx).hypot(path[0].z - tz) > 0.01 {
                wx = path[0].x;
                wz = path[0].z;
                wstop = 0.0;
            }
        } else {
            e.c.nav = None;
        }
        let (dx, dz) = (wx - e.c.x, wz - e.c.z);
        let wd = { let h = dx.hypot(dz); if h == 0.0 { 1e-4 } else { h } };
        let step = (speed * e.c.speed_mul(now) * dt).min((wd - wstop).max(0.0));
        e.c.ry = dx.atan2(dz);
        let np = push_out(e.c.x + (dx / wd) * step, e.c.z + (dz / wd) * step, e.c.radius);
        e.c.moving = true;
        self.set_pos(id, np.x, np.z);
        false
    }

    pub fn face(&mut self, a: u32, b: u32) {
        let Some(bc) = self.c(b).map(|c| (c.x, c.z)) else { return };
        if let Some(e) = self.ents.get_mut(&a) {
            if bc.0 != e.c.x || bc.1 != e.c.z { e.c.ry = (bc.0 - e.c.x).atan2(bc.1 - e.c.z); }
        }
    }

    // ------------------------------------------------------------------ spawning

    fn spawn_mobs(&mut self) {
        let data = d();
        let mut rng = Mulberry32::new(42);
        for zone in &data.zones {
            for sp in &zone.spawns {
                let tpl = &data.mobs[&sp.mob];
                for _ in 0..sp.count {
                    // zone wildlife keeps out of the hostile camps, which have their own garrison
                    let p = loop {
                        let a = rng.next() * std::f64::consts::TAU;
                        let r = if tpl.boss.unwrap_or(false) { 0.0 } else { rng.next().sqrt() * zone.r * 0.85 };
                        let p = push_out(zone.x + a.cos() * r, zone.z + a.sin() * r, 1.0);
                        if r == 0.0 || !data.camps.iter().any(|c| (c.x - p.x).hypot(c.z - p.z) < 19.0) { break p; }
                    };
                    let id = self.new_id();
                    let mut c = Common::new(id, p.x, p.z);
                    c.ry = rng.next() * std::f64::consts::TAU;
                    c.radius = 0.5 * tpl.scale + 0.3;
                    self.mobs.push(id);
                    self.add(Ent { c, k: Kind::Mob(Box::new(Mob::new(tpl, p.x, p.z))) });
                }
            }
        }
        for def in &data.camps {
            let mut st = CampState { def, mobs: vec![], contributors: HashSet::new(), cleared: false, respawn_at: 0.0 };
            let mut place = |w: &mut World, tpl_id: &str, min_r: f64, max_r: f64| {
                let (a, r) = (rng.next() * std::f64::consts::TAU, min_r + rng.next() * (max_r - min_r));
                let p = push_out(def.x + a.cos() * r, def.z + a.sin() * r, 1.0);
                let tpl = &data.mobs[tpl_id];
                let id = w.new_id();
                let mut c = Common::new(id, p.x, p.z);
                c.ry = rng.next() * std::f64::consts::TAU;
                c.radius = 0.5 * tpl.scale + 0.3;
                let mut m = Mob::new(tpl, p.x, p.z);
                m.camp_id = Some(def.id.clone());
                w.mobs.push(id);
                w.add(Ent { c, k: Kind::Mob(Box::new(m)) });
                id
            };
            st.mobs.push(place(self, &def.leader, 2.5, 4.0));
            for sp in &def.mobs { for _ in 0..sp.count { st.mobs.push(place(self, &sp.mob, 4.0, 13.0)); } }
            self.camps.push(st);
        }
    }

    /** Spawn a single mob now (boss adds, raid bosses). */
    pub fn spawn_mob(&mut self, tpl_id: &str, x: f64, z: f64) -> u32 {
        let tpl = &d().mobs[tpl_id];
        let p = push_out(x, z, 1.0);
        let id = self.new_id();
        let mut c = Common::new(id, p.x, p.z);
        c.radius = 0.5 * tpl.scale + 0.3;
        let mut m = Mob::new(tpl, p.x, p.z);
        m.summoned = true;
        self.mobs.push(id);
        self.add(Ent { c, k: Kind::Mob(Box::new(m)) });
        id
    }

    /** Camp mobs never respawn one by one: the whole camp comes back after it was cleared. */
    pub fn can_respawn(&self, mob: &Mob, now: f64) -> bool {
        match &mob.camp_id {
            None => true,
            Some(cid) => self.camps.iter().find(|c| &c.def.id == cid).map_or(true, |c| c.cleared && now >= c.respawn_at),
        }
    }

    fn update_camps(&mut self, now: f64) {
        for i in 0..self.camps.len() {
            let all_dead = self.camps[i].mobs.iter().all(|id| self.ents.get(id).map_or(true, |e| e.c.dead));
            let none_dead = self.camps[i].mobs.iter().all(|id| self.ents.get(id).map_or(false, |e| !e.c.dead));
            if !self.camps[i].cleared && all_dead {
                let def = self.camps[i].def;
                self.camps[i].cleared = true;
                self.camps[i].respawn_at = now + def.respawn;
                // one chest per player who fought here (and is still around), placed around the fire
                let winners: Vec<u32> = self.camps[i].contributors.iter().copied()
                    .filter(|id| self.pl(*id).is_some() && { let c = &self.ents[id].c; (c.x - def.x).hypot(c.z - def.z) < 120.0 })
                    .take(6).collect();
                let n = winners.len().max(1) as f64;
                for (k, pid) in winners.iter().enumerate() {
                    let a = k as f64 / n * std::f64::consts::TAU;
                    let pos = push_out(def.x + a.cos() * 3.0, def.z + a.sin() * 3.0, 0.6);
                    let id = self.new_id();
                    let mut c = Common::new(id, pos.x, pos.z);
                    c.ry = rnd() * std::f64::consts::TAU;
                    self.add(Ent { c, k: Kind::Item(GroundItem { item: "camp_chest".into(), count: 1, owners: Some([*pid].into_iter().collect()), owner_until: now + 180000.0, expire_at: now + 180000.0, camp_id: Some(def.id.clone()) }) });
                    self.sys(*pid, &format!("¡Despejaste {}! Te espera un cofre junto a la fogata.", def.name), &format!("You cleared {}! A chest awaits you by the campfire.", def.name_en));
                }
            } else if self.camps[i].cleared && now >= self.camps[i].respawn_at && none_dead {
                self.camps[i].cleared = false;
                self.camps[i].contributors.clear();
            }
        }
    }

    /** Hook from kill_mob. */
    pub fn mob_killed(&mut self, mid: u32, now: f64) {
        let summoned = self.ents.get(&mid).and_then(|e| e.mob()).map_or(false, |m| m.summoned);
        if summoned {
            // adds don't come back: drop them a bit after the death animation
            self.later(now + 6000.0, move |w, _| {
                w.remove(mid);
                w.mobs.retain(|&x| x != mid);
            });
        }
        if let (Some(raid), Some(boss)) = (self.raid, self.raid_boss) {
            if boss == mid {
                self.raid_cleared_at = now;
                let others: Vec<u32> = self.mobs.iter().copied().filter(|&id| id != mid).collect();
                for id in others {
                    let e = self.ents.get_mut(&id).unwrap();
                    if !e.c.dead {
                        e.c.dead = true;
                        let (x, z) = (e.c.x, e.c.z);
                        self.send_near(x, z, json!({ "t": "died", "id": id, "byPlayer": false }));
                    }
                }
                let secs = (raid.close_after_kill / 1000.0).round();
                let tpl = self.ents[&mid].mob().unwrap().tpl;
                self.announce(|l| if l.en() {
                    format!("{} has fallen! The raid is cleared. Type /raid to leave (the lair closes in {secs} s).", tpl.name_en)
                } else {
                    format!("¡{} cayó! Raid completada. Escribí /raid para salir (la guarida se cierra en {secs} s).", tpl.name)
                });
                self.later(now + raid.close_after_kill, |w, _| {
                    for pid in w.players.clone() { w.exit_to_town(pid); }
                });
            }
        }
    }

    // ------------------------------------------------------------------ dodge roll

    pub fn dash(&mut self, pid: u32, x: f64, z: f64, dx: f64, dz: f64, now: f64) {
        {
            let e = &self.ents[&pid];
            if e.c.dead { return; }
            if e.c.has("stun", now) { return self.sys(pid, "Estás aturdido.", "You are stunned."); }
            if e.player().unwrap().cooldowns.get("dash").copied().unwrap_or(0.0) > now { return; }
        }
        let (px, pz, radius) = { let c = &self.ents[&pid].c; (c.x, c.z, c.radius) };
        // the client predicts the roll from where it sees itself: accept that start if it's close to ours
        if x.is_finite() && z.is_finite() && (x - px).hypot(z - pz) < 4.0 {
            let s = push_out(x, z, radius);
            self.set_pos(pid, s.x, s.z);
        }
        let (mut dx, mut dz) = (dx, dz);
        let mut dl = dx.hypot(dz);
        if !dl.is_finite() || dl < 0.1 {
            let ry = self.ents[&pid].c.ry;
            dx = ry.sin();
            dz = ry.cos();
            dl = 1.0;
        }
        dx /= dl;
        dz /= dl;
        let (sx, sz) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        let end = dash_end(sx, sz, dx, dz, radius);
        self.set_pos(pid, end.x, end.z);
        let e = self.ents.get_mut(&pid).unwrap();
        e.c.ry = dx.atan2(dz);
        e.c.moving = false;
        let p = e.player_mut().unwrap();
        p.intent = None;
        p.casting = None;
        p.dodge_until = now + DODGE_MS;
        p.cooldowns.insert("dash".into(), now + DASH_CD);
        p.send(json!({ "t": "cd", "key": "dash", "ms": DASH_CD }));
        let (x, z) = (e.c.x, e.c.z);
        self.send_near(x, z, json!({ "t": "fx", "s": pid, "tg": pid, "skill": "dash" }));
    }

    // ------------------------------------------------------------------ snapshots

    pub fn ent_record(&self, id: u32, now: f64) -> Value {
        let e = &self.ents[&id];
        let (x, z, ry) = (round2(e.c.x), round2(e.c.z), round2(e.c.ry));
        let (hp, f) = (e.hp_pct(), e.flags(now));
        match &e.k {
            Kind::Player(p) => {
                let eqi = |s: &str| p.equipped_in(s).map(|i| Value::String(i.i.clone())).unwrap_or(Value::Null);
                json!({ "id": id, "x": x, "z": z, "ry": ry, "hp": hp, "f": f, "k": "p", "n": p.name, "l": p.level, "race": p.race, "cls": p.cls,
                    "lk": { "g": p.look.g.to_string(), "hs": p.look.hs, "hc": p.look.hc }, "w": eqi("weapon"), "a": eqi("chest"), "nc": p.name_color(now),
                    "eq": [eqi("head"), eqi("gloves"), eqi("legs"), eqi("feet")] })
            }
            Kind::Mob(m) => json!({ "id": id, "x": x, "z": z, "ry": ry, "hp": hp, "f": f, "k": "m", "n": m.tpl.name, "l": m.tpl.level, "tpl": m.tpl.id }),
            Kind::Npc(n) => json!({ "id": id, "x": x, "z": z, "ry": ry, "hp": hp, "f": f, "k": "n", "n": n.def.name, "title": n.def.title, "npc": n.def.id }),
            Kind::Item(g) => json!({ "id": id, "x": x, "z": z, "ry": ry, "hp": hp, "f": f, "k": "i", "item": g.item, "c": g.count }),
        }
    }

    fn send_snapshot(&mut self, pid: u32, now: f64) {
        let (px, pz, congested) = { let e = &self.ents[&pid]; (e.c.x, e.c.z, e.player().unwrap().out.congested()) };
        if congested { return; }
        let odd = self.tick_n & 1 == 1;
        let ids = self.near(px, pz, AOI);
        let mut add: Vec<Value> = vec![];
        let mut upd: Vec<[f64; 6]> = vec![];
        let mut seen: HashSet<u32> = HashSet::with_capacity(ids.len());
        let mut new_known: Vec<(u32, [f64; 6], Option<u32>)> = vec![];
        {
            let p = self.ents[&pid].player().unwrap();
            for &id in &ids {
                seen.insert(id);
                let e = &self.ents[&id];
                // interest management: far things (>50 m) only every other tick (10 Hz)
                if odd && id != pid && p.known.contains_key(&id) {
                    let (dx, dz) = (e.c.x - px, e.c.z - pz);
                    if dx * dx + dz * dz > 2500.0 { continue; }
                }
                let u = [id as f64, q_pos(e.c.x), q_pos(e.c.z), q_rot(e.c.ry), e.hp_pct(), e.flags(now) as f64];
                match p.known.get(&id) {
                    Some(prev) if p.known_av.get(&id) == Some(&e.c.av) => {
                        if prev[1] != u[1] || prev[2] != u[2] || prev[3] != u[3] || prev[4] != u[4] || prev[5] != u[5] {
                            upd.push(u);
                            new_known.push((id, u, None));
                        }
                    }
                    _ => {
                        add.push(self.ent_record(id, now));
                        new_known.push((id, u, Some(e.c.av)));
                    }
                }
            }
        }
        let p = self.ents.get_mut(&pid).unwrap().player_mut().unwrap();
        for (id, u, av) in new_known {
            p.known.insert(id, u);
            if let Some(av) = av { p.known_av.insert(id, av); }
        }
        let gone: Vec<u32> = p.known.keys().copied().filter(|id| !seen.contains(id)).collect();
        for id in &gone {
            p.known.remove(id);
            p.known_av.remove(id);
        }
        if !add.is_empty() { p.send(json!({ "t": "snap", "add": add, "upd": [], "gone": [], "st": wire_time(now) })); }
        if !upd.is_empty() || !gone.is_empty() { p.out.bin(encode_snap(&upd, &gone, now)); }
    }

    pub fn self_state(&self, pid: u32) -> Value {
        let e = &self.ents[&pid];
        let p = e.player().unwrap();
        let s = &p.stats;
        let skills: Vec<&str> = d().skills_for(&p.cls, p.level, &p.race, p.look.gender()).iter().map(|s| s.id.as_str()).collect();
        let buffs: Vec<Value> = p.buffs.iter().map(|b| json!({ "id": b.id, "rem": ((b.until - self.now) / 1000.0).round().max(0.0) })).collect();
        json!({
            "id": pid, "name": p.name, "race": p.race, "cls": p.cls, "look": { "g": p.look.g.to_string(), "hs": p.look.hs, "hc": p.look.hc },
            "lvl": p.level, "xp": p.xp, "xpNeed": xp_to_next(p.level),
            "hp": p.hp.ceil(), "maxHp": s.max_hp, "mp": p.mp.floor(), "maxMp": s.max_mp, "cp": p.cp.floor(), "maxCp": s.max_cp,
            "pAtk": s.p_atk, "mAtk": s.m_atk, "pDef": s.p_def, "mDef": s.m_def, "acc": s.accuracy, "eva": s.evasion, "crit": s.crit,
            "atkSpd": jround(60000.0 / s.atk_interval), "speed": jround(s.speed * 20.0),
            "adena": p.adena, "karma": p.karma, "pk": p.pk, "pvp": p.pvp, "flagged": p.pvp_until > self.now, "pvpOn": p.pvp_on,
            "skills": skills, "buffs": buffs,
            "zone": match self.raid { Some(r) => r.name.clone(), None => zone_at(e.c.x, e.c.z) },
        })
    }

    fn send_self(&mut self, pid: u32) {
        let s = self.self_state(pid);
        let js = s.to_string();
        let p = self.pl_mut(pid).unwrap();
        if js != p.last_me {
            p.last_me = js;
            p.send(json!({ "t": "me", "s": s }));
        }
    }

    // ------------------------------------------------------------------ tick

    pub fn tick(&mut self) {
        let now = now_ms();
        let dt = ((now - self.now) / 1000.0).min(0.2);
        self.now = now;
        self.tick_n += 1;
        for pid in self.players.clone() {
            if !self.ents.contains_key(&pid) { continue; }
            if !self.ents[&pid].c.statuses.is_empty() { self.tick_statuses(pid, now); }
            if self.ents.contains_key(&pid) { self.update_player(pid, dt, now); }
        }
        for mid in self.mobs.clone() {
            if !self.ents.contains_key(&mid) { continue; }
            if !self.ents[&mid].c.statuses.is_empty() { self.tick_statuses(mid, now); }
            self.update_mob(mid, dt, now);
        }
        let expired: Vec<u32> = self.ents.iter().filter_map(|(id, e)| match &e.k { Kind::Item(g) if now >= g.expire_at => Some(*id), _ => None }).collect();
        for id in expired { self.remove(id); }
        for pid in self.players.clone() { self.send_snapshot(pid, now); }
        if self.tick_n % 2 == 0 { for pid in self.players.clone() { self.send_self(pid); } }
        if self.tick_n % 10 == 0 { self.send_party_updates(); }
        if self.tick_n % 20 == 0 { self.npc_chatter(now); }
        if self.tick_n % 40 == 0 {
            for pid in &self.players { if let Some(p) = self.pl(*pid) { p.send(json!({ "t": "ping", "s": now.floor(), "rtt": p.rtt.round() })) } }
        }
        if !self.deferred.is_empty() {
            let (due, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut self.deferred).into_iter().partition(|(at, _)| *at <= now);
            self.deferred = rest;
            for (_, f) in due { f(self, now); }
        }
        if self.tick_n % 5 == 0 { self.update_camps(now); }
        for pid in self.players.clone() {
            let dirty = self.pl(pid).map_or(false, |p| p.inv_dirty);
            if dirty {
                let p = self.pl_mut(pid).unwrap();
                p.inv_dirty = false;
                p.send(json!({ "t": "inv", "items": p.inv, "adena": p.adena }));
                self.on_inventory_changed(pid);
            }
        }
    }

    /** Talker NPCs (Luigi) mumble out loud every 20-45 s when someone is around. */
    fn npc_chatter(&mut self, now: f64) {
        let talkers: Vec<u32> = self.ents.iter().filter_map(|(id, e)| match &e.k { Kind::Npc(n) if n.def.kind == "talker" && now >= n.next_chatter => Some(*id), _ => None }).collect();
        for id in talkers {
            if let Some(Kind::Npc(n)) = self.ents.get_mut(&id).map(|e| &mut e.k) { n.next_chatter = now + 20000.0 + rnd() * 25000.0; }
            let (x, z) = { let c = &self.ents[&id].c; (c.x, c.z) };
            if !self.near_players(x, z, 30.0).is_empty() { self.npc_say(id, rnd()); }
        }
    }

    /** Say a line out loud; r (0..1) picks the same line in every listener's language. */
    pub fn npc_say(&self, nid: u32, r: f64) {
        let e = &self.ents[&nid];
        let Kind::Npc(n) = &e.k else { return };
        for pid in self.near_players(e.c.x, e.c.z, 40.0) {
            let p = self.pl(pid).unwrap();
            let lines = npc_lines(&n.def.id, p.lang);
            if lines.is_empty() { continue; }
            let line = &lines[((r * lines.len() as f64) as usize).min(lines.len() - 1)];
            p.send(json!({ "t": "say", "id": nid, "name": n.def.name, "text": line }));
        }
    }

}

pub fn round2(v: f64) -> f64 { jround(v * 100.0) / 100.0 }
