//! Entities (port of server/src/world/entities.ts).
use crate::collision::P;
use crate::data::{d, BuffMods, MobDef, Special};
use crate::formulas::{compute_stats, jround, mob_stats, Stats};
use crate::i18n::Lang;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub const F_DEAD: u16 = 1;
pub const F_MOVING: u16 = 2;
pub const F_CASTING: u16 = 4;
pub const F_COMBAT: u16 = 8;
pub const F_PURPLE: u16 = 16;
pub const F_RED: u16 = 32;
pub const F_PVP: u16 = 64;
pub const SLOW_MUL: f64 = 0.6;

pub enum Out { Text(String), Bin(Vec<u8>) }

/** Where a client's messages go: the socket task drains it. */
#[derive(Clone)]
pub struct Outbox {
    pub tx: tokio::sync::mpsc::UnboundedSender<Out>,
    pub pending: Arc<AtomicUsize>,
}
impl Outbox {
    pub fn text(&self, s: String) {
        self.pending.fetch_add(1, Ordering::Relaxed);
        let _ = self.tx.send(Out::Text(s));
    }
    pub fn bin(&self, b: Vec<u8>) {
        self.pending.fetch_add(1, Ordering::Relaxed);
        let _ = self.tx.send(Out::Bin(b));
    }
    /** A message: the hot combat events go binary (binary::encode_event), the rest JSON. */
    pub fn value(&self, v: &Value) {
        match crate::binary::encode_event(v) { Some(b) => self.bin(b), None => self.text(v.to_string()) }
    }
    /** a slow client: skip snapshots until its socket drains */
    pub fn congested(&self) -> bool { self.pending.load(Ordering::Relaxed) > 48 }
}

#[derive(Clone, Debug)]
pub struct ActiveStatus { pub until: f64, pub src: u32, pub dps: f64, pub next_tick: f64 }

#[derive(Clone, Debug)]
pub struct Nav { pub gx: f64, pub gz: f64, pub at: f64, pub path: Vec<P> }

pub struct Common {
    pub id: u32,
    pub x: f64,
    pub z: f64,
    pub ry: f64,
    pub dead: bool,
    pub hidden: bool,
    pub moving: bool,
    pub radius: f64,
    /** appearance version: bump to make clients re-read the full record */
    pub av: u32,
    pub cell: (i64, i64),
    pub nav: Option<Nav>,
    pub statuses: HashMap<String, ActiveStatus>,
}
impl Common {
    pub fn new(id: u32, x: f64, z: f64) -> Self {
        Common { id, x, z, ry: 0.0, dead: false, hidden: false, moving: false, radius: 0.5, av: 0, cell: (i64::MIN, i64::MIN), nav: None, statuses: HashMap::new() }
    }
    pub fn has(&self, s: &str, now: f64) -> bool { self.statuses.get(s).map_or(false, |st| st.until > now) }
    pub fn speed_mul(&self, now: f64) -> f64 { if self.has("slow", now) { SLOW_MUL } else { 1.0 } }
    pub fn base_flags(&self, now: f64) -> u16 {
        let mut f = if self.dead { F_DEAD } else { 0 } | if self.moving { F_MOVING } else { 0 };
        for (id, st) in &self.statuses {
            if st.until > now { f |= d().status_flag(id); }
        }
        f
    }
}

/** e: enchant level (+N) */
#[derive(Clone, Debug, serde::Serialize)]
pub struct InvItem { pub u: u32, pub i: String, pub c: i64, pub s: Option<String>, pub e: i64 }

#[derive(Clone, Debug)]
pub enum Intent {
    Move { x: f64, z: f64 },
    Attack { id: u32, force: bool },
    Skill { skill: String, target: u32, force: bool },
    Pickup { id: u32 },
    Talk { id: u32 },
}

pub struct Buff { pub id: String, pub until: f64, pub mods: BuffMods }

#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct Look { pub g: char, pub hs: i64, pub hc: i64 }
impl Look {
    pub fn gender(&self) -> &'static str { if self.g == 'f' { "f" } else { "m" } }
    pub fn sanitize(v: Option<&Value>) -> Look {
        let c = &d().c;
        let n = |k: &str, max: i64| v.and_then(|o| o.get(k)).and_then(|x| x.as_i64()).filter(|&x| x >= 0 && x < max).unwrap_or(0);
        let g = if v.and_then(|o| o.get("g")).and_then(|x| x.as_str()) == Some("f") { 'f' } else { 'm' };
        Look { g, hs: n("hs", c.hair_styles), hc: n("hc", c.hair_colors) }
    }
}

pub struct Player {
    pub sid: u64,
    pub out: Outbox,
    pub lang: Lang,
    pub stats: Stats,
    pub buffs: Vec<Buff>,
    pub target: Option<u32>,
    pub intent: Option<Intent>,
    pub next_attack: f64,
    pub casting: Option<(String, u32, f64)>,
    pub cooldowns: HashMap<String, f64>,
    pub pvp_until: f64,
    pub pvp_on: bool,
    pub auto_loot: bool,
    pub dodge_until: f64,
    pub rtt: f64,
    pub saved_at: f64,
    pub look: Look,
    pub last_combat: f64,
    pub escape_at: f64,
    pub party: Option<u32>,
    pub pending_invite: Option<(u32, f64)>,
    pub talking_to: Option<u32>,
    pub quests: Vec<(String, i64, bool)>,
    pub quest_ready_told: HashSet<String>,
    pub known: HashMap<u32, [f64; 6]>,
    pub known_av: HashMap<u32, u32>,
    pub last_me: String,
    pub inv_dirty: bool,
    pub next_uid: u32,
    pub inv: Vec<InvItem>,
    pub account_id: i64,
    pub char_id: i64,
    pub name: String,
    pub race: String,
    pub cls: String,
    pub spec: Option<String>,
    pub level: i64,
    pub xp: i64,
    pub hp: f64,
    pub mp: f64,
    pub cp: f64,
    pub adena: i64,
    pub karma: i64,
    pub pk: i64,
    pub pvp: i64,
}

impl Player {
    pub fn one_way(&self) -> f64 { (self.rtt / 2.0).min(150.0) }
    pub fn send(&self, v: Value) { self.out.value(&v); }
    pub fn equipped_in(&self, slot: &str) -> Option<&InvItem> { self.inv.iter().find(|i| i.s.as_deref() == Some(slot)) }
    pub fn recalc(&mut self) {
        let data = d();
        let eq: Vec<_> = self.inv.iter().filter(|i| i.s.is_some()).filter_map(|i| Some((data.item(&i.i)?, i.e))).collect();
        let bm: Vec<&BuffMods> = self.buffs.iter().map(|b| &b.mods).collect();
        self.stats = compute_stats(&self.race, &self.cls, self.level, &eq, &bm, self.look.gender());
        self.hp = self.hp.min(self.stats.max_hp);
        self.mp = self.mp.min(self.stats.max_mp);
        self.cp = self.cp.min(self.stats.max_cp);
    }
    pub fn hp_pct(&self) -> f64 { jround(self.hp / self.stats.max_hp * 100.0) }
    pub fn name_color(&self, now: f64) -> u8 { if self.karma > 0 { 2 } else if self.pvp_until > now { 1 } else { 0 } }
    pub fn quest(&self, id: &str) -> Option<&(String, i64, bool)> { self.quests.iter().find(|q| q.0 == id) }
    pub fn quest_mut(&mut self, id: &str) -> Option<&mut (String, i64, bool)> { self.quests.iter_mut().find(|q| q.0 == id) }
}

pub struct Mob {
    pub tpl: &'static MobDef,
    pub stats: Stats,
    pub hp: f64,
    pub target: Option<u32>,
    pub hate: Vec<(u32, f64)>,
    pub threat: Vec<(u32, f64)>,
    pub taunt_until: f64,
    pub next_target_check: f64,
    pub phase: usize,
    pub haste: f64,
    pub special: Option<Special>,
    pub summoned: bool,
    pub next_attack: f64,
    pub respawn_at: f64,
    pub hide_at: f64,
    pub wander_at: f64,
    pub dest: Option<P>,
    pub returning: bool,
    pub special_at: f64,
    pub camp_id: Option<String>,
    pub winding: Option<(f64, f64, f64)>,
    pub home_x: f64,
    pub home_z: f64,
}

/** ordered map helpers for hate/threat (insertion order, like a JS Map) */
pub fn map_get(m: &[(u32, f64)], id: u32) -> Option<f64> { m.iter().find(|e| e.0 == id).map(|e| e.1) }
pub fn map_add(m: &mut Vec<(u32, f64)>, id: u32, v: f64) {
    if let Some(e) = m.iter_mut().find(|e| e.0 == id) { e.1 += v } else { m.push((id, v)) }
}
pub fn map_set(m: &mut Vec<(u32, f64)>, id: u32, v: f64) {
    if let Some(e) = m.iter_mut().find(|e| e.0 == id) { e.1 = v } else { m.push((id, v)) }
}
pub fn map_del(m: &mut Vec<(u32, f64)>, id: u32) { m.retain(|e| e.0 != id); }

impl Mob {
    pub fn new(tpl: &'static MobDef, x: f64, z: f64) -> Mob {
        let stats = mob_stats(tpl);
        Mob {
            tpl, hp: stats.max_hp, stats, target: None, hate: vec![], threat: vec![], taunt_until: 0.0, next_target_check: 0.0,
            phase: 0, haste: 1.0, special: tpl.special.clone(), summoned: false, next_attack: 0.0, respawn_at: 0.0, hide_at: 0.0,
            wander_at: 0.0, dest: None, returning: false, special_at: 0.0, camp_id: None, winding: None, home_x: x, home_z: z,
        }
    }
    pub fn hp_pct(&self) -> f64 { jround(self.hp / self.stats.max_hp * 100.0) }
}

pub struct Npc { pub def: &'static crate::data::NpcDef, pub next_chatter: f64 }

pub struct GroundItem {
    pub item: String,
    pub count: i64,
    pub enchant: i64,
    pub owners: Option<HashSet<u32>>,
    pub owner_until: f64,
    pub expire_at: f64,
    pub camp_id: Option<String>,
}

pub enum Kind { Player(Box<Player>), Mob(Box<Mob>), Npc(Npc), Item(GroundItem) }

pub struct Ent { pub c: Common, pub k: Kind }

impl Ent {
    pub fn player(&self) -> Option<&Player> { if let Kind::Player(p) = &self.k { Some(p) } else { None } }
    pub fn player_mut(&mut self) -> Option<&mut Player> { if let Kind::Player(p) = &mut self.k { Some(p) } else { None } }
    pub fn mob(&self) -> Option<&Mob> { if let Kind::Mob(m) = &self.k { Some(m) } else { None } }
    pub fn mob_mut(&mut self) -> Option<&mut Mob> { if let Kind::Mob(m) = &mut self.k { Some(m) } else { None } }
    pub fn is_fighter(&self) -> bool { matches!(self.k, Kind::Player(_) | Kind::Mob(_)) }
    pub fn hp_pct(&self) -> f64 {
        match &self.k { Kind::Player(p) => p.hp_pct(), Kind::Mob(m) => m.hp_pct(), _ => 100.0 }
    }
    pub fn flags(&self, now: f64) -> u16 {
        let base = self.c.base_flags(now);
        match &self.k {
            Kind::Player(p) => {
                let nc = p.name_color(now);
                base | if p.casting.is_some() { F_CASTING } else { 0 } | if now - p.last_combat < 4000.0 { F_COMBAT } else { 0 }
                    | if nc == 1 { F_PURPLE } else if nc == 2 { F_RED } else { 0 } | if p.pvp_on { F_PVP } else { 0 }
            }
            Kind::Mob(m) => base | if m.target.is_some() { F_COMBAT } else { 0 },
            _ => base,
        }
    }
}
