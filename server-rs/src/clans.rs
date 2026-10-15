//! Clans, after Lineage 2 (Interlude): rules and numbers in shared/src/data/clans.ts (d().clans).
//!
//! A clan outlives any one world (its members may be in the overworld and in raid instances at once), so the
//! clans live in one registry shared by every world thread, loaded from the database once and written through
//! on every change. Messages to a clan go straight to its members' sockets (ONLINE), whatever world they are in.
//! Worlds notice changes that show over characters' heads (clan, title, crest) through VERSION (refresh_clan_looks).
//!
//! Wars: a clan (level 3+) declares war on another; once both have declared, the war is mutual and their members
//! fight without flags or karma, for reputation (combat.rs asks relation()). Alliances: up to allyMax clans under
//! the leading clan's leader, with their own chat ('$') and a small crest shown before the clan's.
use crate::data::d;
use crate::db::Db;
use crate::ent::*;
use crate::i18n::Lang;
use crate::world::World;
use base64::Engine;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock};

pub const LEADER: u8 = 1;
pub const MEMBER: u8 = 5;
/** privilege bits (CLAN_PRIV in clans.ts) */
pub const P_INVITE: u32 = 1;
pub const P_DISMISS: u32 = 2;
pub const P_TITLE: u32 = 4;
pub const P_CREST: u32 = 16;
pub const P_WAR: u32 = 32;
pub const P_RANKS: u32 = 64;
const ALL_PRIVS: u32 = 0x7f;

pub struct ClanMember { pub char_id: i64, pub name: String, pub level: i64, pub cls: String, pub grade: u8, pub title: String }

pub struct Clan {
    pub id: u32,
    pub name: String,
    pub leader: i64,
    pub level: u8,
    pub rep: i64,
    pub crest: Option<Vec<u8>>,
    pub crest_ver: u32,
    pub ally: Option<u32>,
    /** after dismissing someone the clan may not invite until then (ms) */
    pub invite_until: f64,
    /** after leaving or being expelled from an alliance the clan may not join another until then; after dissolving
     * its alliance it may not found another until then (ms) */
    pub ally_join_until: f64,
    pub ally_found_until: f64,
    /** privileges by grade (index 1-5) */
    pub privs: [u32; 6],
    pub members: Vec<ClanMember>,
}

impl Clan {
    pub fn member(&self, char_id: i64) -> Option<&ClanMember> { self.members.iter().find(|m| m.char_id == char_id) }
    fn member_mut(&mut self, char_id: i64) -> Option<&mut ClanMember> { self.members.iter_mut().find(|m| m.char_id == char_id) }
    fn by_name(&self, name: &str) -> Option<&ClanMember> { let l = name.to_lowercase(); self.members.iter().find(|m| m.name.to_lowercase() == l) }
    /** Does this member hold the privilege? The leader holds them all. */
    pub fn can(&self, char_id: i64, privilege: u32) -> bool {
        if char_id == self.leader { return true; }
        self.member(char_id).map_or(false, |m| self.privs[m.grade as usize] & privilege != 0)
    }
    pub fn capacity(&self) -> usize { d().clans.levels[self.level as usize].members }
}

/** An alliance: its clans are those whose `ally` is this id; the leading clan's leader runs it. */
pub struct Ally {
    pub id: u32,
    pub name: String,
    pub leader: u32,
    pub crest: Option<Vec<u8>>,
    pub crest_ver: u32,
    /** after expelling a clan the alliance may not invite until then (ms) */
    pub invite_until: f64,
}

#[derive(Default)]
pub struct Clans {
    pub clans: HashMap<u32, Clan>,
    pub by_char: HashMap<i64, u32>,
    /** characters with a penalty running: (may join again at, may found again at), ms */
    pub penalty: HashMap<i64, (f64, f64)>,
    /** war declarations: (declaring clan, target clan); a war is mutual when both directions are here */
    pub wars: HashSet<(u32, u32)>,
    /** (clan, target): the clan stopped its war on the target and may not declare again until then (ms) */
    pub war_cd: HashMap<(u32, u32), f64>,
    pub allies: HashMap<u32, Ally>,
}

/** How two characters stand: nothing special, same clan or alliance, or enemies in a mutual war. */
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Rel { None, Friend, War }

impl Clans {
    pub fn of(&self, char_id: i64) -> Option<&Clan> { self.by_char.get(&char_id).and_then(|id| self.clans.get(id)) }
    pub fn mutual(&self, a: u32, b: u32) -> bool { self.wars.contains(&(a, b)) && self.wars.contains(&(b, a)) }
    /** Clans in the same alliance (or the same clan). */
    pub fn allied(&self, a: u32, b: u32) -> bool {
        a == b || matches!((self.clans.get(&a).and_then(|c| c.ally), self.clans.get(&b).and_then(|c| c.ally)), (Some(x), Some(y)) if x == y)
    }
    pub fn ally_clans(&self, ally: u32) -> Vec<u32> {
        let mut v: Vec<u32> = self.clans.values().filter(|c| c.ally == Some(ally)).map(|c| c.id).collect();
        v.sort();
        v
    }
    pub fn clan_named(&self, name: &str) -> Option<u32> { self.clans.values().find(|c| c.name.eq_ignore_ascii_case(name.trim())).map(|c| c.id) }
    /** A war this clan is fighting: one it declared, or a mutual one (a war merely declared on it does not count,
     * or anyone could keep a clan from dissolving). */
    pub fn fighting(&self, id: u32) -> bool { self.wars.iter().any(|&(a, _)| a == id) }
    pub fn relation(&self, a_char: i64, b_char: i64) -> Rel {
        match (self.by_char.get(&a_char), self.by_char.get(&b_char)) {
            (Some(&a), Some(&b)) if self.allied(a, b) => Rel::Friend,
            (Some(&a), Some(&b)) if self.mutual(a, b) => Rel::War,
            _ => Rel::None,
        }
    }
}

/** How two characters stand (combat.rs). */
pub fn relation(a_char: i64, b_char: i64) -> Rel { reg().read().unwrap().relation(a_char, b_char) }

static REG: OnceLock<RwLock<Clans>> = OnceLock::new();
static ONLINE: OnceLock<RwLock<HashMap<i64, (Outbox, Lang)>>> = OnceLock::new();
/** bumped whenever something shown over characters' heads changes (membership, titles, crests) */
static VERSION: AtomicU64 = AtomicU64::new(1);

pub fn reg() -> &'static RwLock<Clans> { REG.get_or_init(|| RwLock::new(load(&Db::open()))) }
fn online() -> &'static RwLock<HashMap<i64, (Outbox, Lang)>> { ONLINE.get_or_init(|| RwLock::new(HashMap::new())) }
pub fn version() -> u64 { VERSION.load(Ordering::Relaxed) }
fn changed() { VERSION.fetch_add(1, Ordering::Relaxed); }

fn load(db: &Db) -> Clans {
    let (rows, privs, members, pen) = db.load_clans();
    let mut c = Clans::default();
    for r in rows {
        let mut p = [0u32; 6];
        for (g, v) in d().clans.privs.iter().enumerate().take(6) { p[g] = *v; }
        p[LEADER as usize] = ALL_PRIVS;
        c.clans.insert(r.id as u32, Clan {
            id: r.id as u32, name: r.name, leader: r.leader, level: r.level as u8, rep: r.rep, crest: r.crest, crest_ver: r.crest_ver as u32,
            ally: r.ally.map(|a| a as u32), invite_until: r.invite_until, ally_join_until: r.ally_join_until, ally_found_until: r.ally_found_until,
            privs: p, members: vec![],
        });
    }
    for (clan, grade, v) in privs {
        if let Some(cl) = c.clans.get_mut(&(clan as u32)) { if (2..=5).contains(&grade) { cl.privs[grade as usize] = v as u32; } }
    }
    for m in members {
        if let Some(cl) = c.clans.get_mut(&(m.clan_id as u32)) {
            c.by_char.insert(m.char_id, cl.id);
            cl.members.push(ClanMember { char_id: m.char_id, name: m.name, level: m.level, cls: m.cls, grade: m.grade.clamp(1, 5) as u8, title: m.title });
        }
    }
    for (id, j, f) in pen { c.penalty.insert(id, (j, f)); }
    let (wars, cd) = db.load_wars();
    for (a, b) in wars { if c.clans.contains_key(&(a as u32)) && c.clans.contains_key(&(b as u32)) { c.wars.insert((a as u32, b as u32)); } }
    for (a, b, until) in cd { c.war_cd.insert((a as u32, b as u32), until); }
    for a in db.load_allies() {
        c.allies.insert(a.id as u32, Ally { id: a.id as u32, name: a.name, leader: a.leader as u32, crest: a.crest, crest_ver: a.crest_ver as u32, invite_until: a.invite_until });
    }
    for cl in c.clans.values_mut() { if cl.ally.map_or(false, |a| !c.allies.contains_key(&a)) { cl.ally = None; } }
    eprintln!("[clans] {} clans, {} members, {} wars, {} alliances", c.clans.len(), c.by_char.len(), c.wars.len(), c.allies.len());
    c
}

/** Each online member of the clan gets the message built for their language. */
fn cast(clan: &Clan, f: impl Fn(Lang) -> Value) {
    let on = online().read().unwrap();
    for m in &clan.members {
        if let Some((out, l)) = on.get(&m.char_id) { out.value(&f(*l)); }
    }
}
/** Like cast, but not to one member (the one the news is about). */
fn cast_except(clan: &Clan, skip: i64, f: impl Fn(Lang) -> Value) {
    let on = online().read().unwrap();
    for m in clan.members.iter().filter(|m| m.char_id != skip) {
        if let Some((out, l)) = on.get(&m.char_id) { out.value(&f(*l)); }
    }
}
fn cast_sys(clan: &Clan, es: &str, en: &str) {
    cast(clan, |l| json!({ "t": "chat", "ch": "sys", "from": "", "text": if l.en() { en } else { es } }));
}
fn to_char(char_id: i64, v: Value) { if let Some((out, _)) = online().read().unwrap().get(&char_id) { out.value(&v); } }

/** What the clan window shows (every member sees the same; each client works out what it may do). */
fn info(r: &Clans, clan: &Clan) -> Value {
    let on = online().read().unwrap();
    let leader = clan.member(clan.leader).map(|m| m.name.clone()).unwrap_or_default();
    let members: Vec<Value> = clan.members.iter().map(|m| json!({
        "name": m.name, "level": m.level, "cls": m.cls, "grade": m.grade, "title": m.title, "on": on.contains_key(&m.char_id),
    })).collect();
    // wars: every clan we declared on or that declared on us, and which way
    let mut foes: Vec<u32> = r.wars.iter().filter_map(|&(a, b)| if a == clan.id { Some(b) } else if b == clan.id { Some(a) } else { None }).collect();
    foes.sort();
    foes.dedup();
    let wars: Vec<Value> = foes.iter().filter_map(|f| r.clans.get(f)).map(|f| json!({
        "id": f.id, "name": f.name, "cv": f.crest_ver, "ours": r.wars.contains(&(clan.id, f.id)), "theirs": r.wars.contains(&(f.id, clan.id)),
    })).collect();
    let ally = clan.ally.and_then(|a| r.allies.get(&a)).map(|a| {
        let clans: Vec<Value> = r.ally_clans(a.id).iter().filter_map(|id| r.clans.get(id)).map(|c| json!({
            "id": c.id, "name": c.name, "level": c.level, "cv": c.crest_ver, "members": c.members.len(),
            "leader": c.member(c.leader).map(|m| m.name.clone()).unwrap_or_default(),
        })).collect();
        json!({ "id": a.id, "name": a.name, "leader": a.leader, "cv": a.crest_ver, "inviteUntil": a.invite_until, "clans": clans })
    });
    json!({ "id": clan.id, "name": clan.name, "level": clan.level, "rep": clan.rep, "leader": leader, "cv": clan.crest_ver,
        "cap": clan.capacity(), "privs": clan.privs, "inviteUntil": clan.invite_until, "members": members,
        "wars": wars, "ally": ally, "allyJoinUntil": clan.ally_join_until, "allyFoundUntil": clan.ally_found_until })
}
/** Fresh clan info to every online member. */
fn push(r: &Clans, clan: &Clan) { let v = json!({ "t": "clan", "clan": info(r, clan) }); cast(clan, |_| v.clone()); }
/** Fresh clan info to the clan with this id. */
fn push_id(r: &Clans, id: u32) { if let Some(c) = r.clans.get(&id) { push(r, c); } }
/** Fresh clan info to every clan of an alliance. */
fn push_ally(r: &Clans, ally: u32) { for id in r.ally_clans(ally) { push(r, &r.clans[&id]); } }
/** A system line to every online member of an alliance. */
fn cast_ally_sys(r: &Clans, ally: u32, es: &str, en: &str) { for id in r.ally_clans(ally) { cast_sys(&r.clans[&id], es, en); } }

/** The crest's PNG for the HTTP route: "<id>" a clan's, "a<id>" an alliance's (None: no such crest). */
pub fn crest_png(file: &str) -> Option<Vec<u8>> {
    let r = reg().read().unwrap();
    match file.strip_prefix('a') {
        Some(a) => r.allies.get(&a.parse().ok()?).and_then(|a| a.crest.clone()),
        None => r.clans.get(&file.parse().ok()?).and_then(|c| c.crest.clone()),
    }
}

/** A character is about to be deleted: leaders may not be (as in L2); anyone else leaves their clan. */
pub fn on_delete(char_id: i64) -> Result<(), ()> {
    let mut r = reg().write().unwrap();
    let Some(&cid) = r.by_char.get(&char_id) else { return Ok(()) };
    if r.clans[&cid].leader == char_id { return Err(()); }
    r.by_char.remove(&char_id);
    let clan = r.clans.get_mut(&cid).unwrap();
    clan.members.retain(|m| m.char_id != char_id);
    let clan = &r.clans[&cid];
    push(&r, clan);
    changed();
    Ok(())
}

/** A valid clan name: letters and digits only, of the configured length. */
fn valid_name(name: &str) -> bool {
    let c = &d().clans.cfg;
    let n = name.chars().count();
    n >= c.name_min && n <= c.name_max && name.chars().all(|ch| ch.is_alphanumeric())
}

/** A PNG of exactly the crest's size and at most crest_bytes long (signature and IHDR checked, nothing decoded). */
pub fn valid_crest(png: &[u8], w: u32, h: u32, max: usize) -> bool {
    const SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png.len() <= max && png.len() > 24 && png[..8] == SIG && &png[12..16] == b"IHDR"
        && u32::from_be_bytes([png[16], png[17], png[18], png[19]]) == w && u32::from_be_bytes([png[20], png[21], png[22], png[23]]) == h
}

impl World {
    // ------------------------------------------------------------------ presence

    /** A character entered this world: their clan can reach them, and their head shows their clan. */
    pub fn clan_online(&mut self, pid: u32, from_select: bool) {
        let (cid, out, lang, name) = { let p = self.pl(pid).unwrap(); (p.char_id, p.out.clone(), p.lang, p.name.clone()) };
        online().write().unwrap().insert(cid, (out, lang));
        self.refresh_clan_look(pid);
        let r = reg().read().unwrap();
        match r.of(cid) {
            Some(clan) => {
                self.send(pid, json!({ "t": "clan", "clan": info(&r, clan) }));
                if from_select {
                    let (es, en) = (format!("{name}, de tu clan, entró al juego."), format!("Clan member {name} has logged in."));
                    cast_except(clan, cid, |l| json!({ "t": "chat", "ch": "sys", "from": "", "text": if l.en() { &en } else { &es } }));
                    { let id = clan.id; push_id(&r, id); }
                }
            }
            None => self.send(pid, json!({ "t": "clan", "clan": null })),
        }
    }

    /** A character left this world (logout or world change): nothing reaches their old socket. */
    pub fn clan_offline(&mut self, char_id: i64, level: i64) {
        online().write().unwrap().remove(&char_id);
        let mut r = reg().write().unwrap();
        if let Some(&cid) = r.by_char.get(&char_id) {
            let clan = r.clans.get_mut(&cid).unwrap();
            if let Some(m) = clan.member_mut(char_id) { m.level = level; }
        }
    }

    /** What this player's head shows of their clan, refreshed from the registry; true when it changed. */
    fn refresh_clan_look(&mut self, pid: u32) -> bool {
        let cid = self.pl(pid).unwrap().char_id;
        let look = {
            let r = reg().read().unwrap();
            r.of(cid).map(|c| ClanLook {
                id: c.id, name: c.name.clone(), title: c.member(cid).map(|m| m.title.clone()).unwrap_or_default(), ver: c.crest_ver,
                ally: c.ally.and_then(|a| r.allies.get(&a)).map(|a| (a.id, a.crest_ver)),
            })
        };
        let p = self.pl_mut(pid).unwrap();
        if p.clan_look == look { return false; }
        p.clan_look = look;
        true
    }

    /** Called every tick: when any clan changed, re-read every player's clan look and resend the ones that changed. */
    pub fn refresh_clan_looks(&mut self) {
        let v = version();
        if v == self.clan_seen { return; }
        self.clan_seen = v;
        for pid in self.players.clone() {
            if self.refresh_clan_look(pid) { self.ents.get_mut(&pid).unwrap().c.av += 1; }
        }
    }

    fn my_clan(&self, pid: u32) -> Option<u32> { reg().read().unwrap().by_char.get(&self.pl(pid)?.char_id).copied() }

    // ------------------------------------------------------------------ founding and membership

    pub fn clan_create(&mut self, pid: u32, nid: u32, name: &str) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if n.kind != "clan" { return; }
        let name = name.trim();
        let cfg = &d().clans.cfg;
        let cost = d().clans.levels[0].adena;
        let (cid, level, adena) = { let p = self.pl(pid).unwrap(); (p.char_id, p.level, p.adena) };
        let now = crate::world::now_ms();
        {
            let r = reg().read().unwrap();
            if r.by_char.contains_key(&cid) { return self.sys(pid, "Ya pertenecés a un clan.", "You are already in a clan."); }
            if let Some(&(_, found)) = r.penalty.get(&cid) {
                if found > now { return self.sys(pid, &format!("Tenés que esperar {} para fundar otro clan.", wait(found - now, false)), &format!("You must wait {} before founding another clan.", wait(found - now, true))); }
            }
        }
        if level < cfg.found_level { return self.sys(pid, &format!("Necesitás nivel {} para fundar un clan.", cfg.found_level), &format!("You need level {} to found a clan.", cfg.found_level)); }
        if !valid_name(name) {
            return self.sys(pid, &format!("El nombre del clan debe tener entre {} y {} letras o números.", cfg.name_min, cfg.name_max), &format!("A clan name must be {} to {} letters or digits.", cfg.name_min, cfg.name_max));
        }
        if adena < cost { return self.sys(pid, &format!("Fundar un clan cuesta {cost} de adena."), &format!("Founding a clan costs {cost} adena.")); }
        let Ok(id) = self.db.clan_insert(name, cid) else { return self.sys(pid, "Ya existe un clan con ese nombre.", "A clan with that name already exists.") };
        let id = id as u32;
        self.db.char_clan(cid, Some(id as i64), LEADER as i64, "");
        let (pname, plevel, pcls) = { let p = self.pl(pid).unwrap(); (p.name.clone(), p.level, p.cls.clone()) };
        let mut privs = [0u32; 6];
        for (g, v) in d().clans.privs.iter().enumerate().take(6) { privs[g] = *v; }
        privs[LEADER as usize] = ALL_PRIVS;
        {
            let mut r = reg().write().unwrap();
            r.clans.insert(id, Clan {
                id, name: name.to_string(), leader: cid, level: 0, rep: 0, crest: None, crest_ver: 0, ally: None, invite_until: 0.0,
                ally_join_until: 0.0, ally_found_until: 0.0, privs,
                members: vec![ClanMember { char_id: cid, name: pname, level: plevel, cls: pcls, grade: LEADER, title: String::new() }],
            });
            r.by_char.insert(cid, id);
            push_id(&r, id);
        }
        self.pl_mut(pid).unwrap().adena -= cost;
        changed();
        self.sys(pid, &format!("Fundaste el clan {name}."), &format!("You founded the clan {name}."));
    }

    pub fn clan_invite(&mut self, pid: u32, name: &str) {
        let name = name.trim();
        let Some(tid) = self.find_player(name) else { return self.sys(pid, &format!("{name} no está conectado (o no está en este mundo)."), &format!("{name} is not online (or not in this world).")) };
        if tid == pid { return; }
        let (cid, from) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone()) };
        let (tcid, tname) = { let t = self.pl(tid).unwrap(); (t.char_id, t.name.clone()) };
        let now = crate::world::now_ms();
        let clan_name;
        let clan_id;
        {
            let r = reg().read().unwrap();
            let Some(clan) = r.of(cid) else { return self.sys(pid, "No pertenecés a ningún clan.", "You are not in a clan.") };
            if !clan.can(cid, P_INVITE) { return self.sys(pid, "No tenés permiso para invitar al clan.", "You may not invite to the clan."); }
            if clan.invite_until > now { return self.sys(pid, &format!("Tu clan expulsó a alguien hace poco: podrá invitar en {}.", wait(clan.invite_until - now, false)), &format!("Your clan dismissed someone recently: it may invite again in {}.", wait(clan.invite_until - now, true))); }
            if clan.members.len() >= clan.capacity() { return self.sys(pid, "Tu clan está completo: subí su nivel para sumar miembros.", "Your clan is full: raise its level for more members."); }
            if r.by_char.contains_key(&tcid) { return self.sys(pid, &format!("{tname} ya pertenece a un clan."), &format!("{tname} is already in a clan.")); }
            if let Some(&(join, _)) = r.penalty.get(&tcid) {
                if join > now { return self.sys(pid, &format!("{tname} dejó un clan hace poco y todavía no puede entrar a otro."), &format!("{tname} left a clan recently and cannot join another yet.")); }
            }
            clan_name = clan.name.clone();
            clan_id = clan.id;
        }
        let t = self.pl_mut(tid).unwrap();
        if t.pending_clan.map_or(false, |(_, until)| until > now) { return self.sys(pid, &format!("{tname} está respondiendo otra invitación."), &format!("{tname} is answering another invitation.")); }
        t.pending_clan = Some((clan_id, now + d().clans.cfg.invite_ms));
        t.send(json!({ "t": "clanInvite", "from": from, "clan": clan_name }));
        self.sys(pid, &format!("Invitaste a {tname} al clan."), &format!("You invited {tname} to the clan."));
    }

    pub fn clan_respond(&mut self, pid: u32, accept: bool) {
        let now = crate::world::now_ms();
        let Some((clan_id, until)) = self.pl_mut(pid).unwrap().pending_clan.take() else { return };
        if until < now || !accept { return; }
        let (cid, name, level, cls) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone(), p.level, p.cls.clone()) };
        {
            let mut r = reg().write().unwrap();
            if r.by_char.contains_key(&cid) { return; }
            let Some(clan) = r.clans.get_mut(&clan_id) else { return self.sys(pid, "Ese clan ya no existe.", "That clan no longer exists.") };
            if clan.members.len() >= clan.capacity() { return self.sys(pid, "El clan está completo.", "The clan is full."); }
            clan.members.push(ClanMember { char_id: cid, name: name.clone(), level, cls, grade: MEMBER, title: String::new() });
            let cname = clan.name.clone();
            r.by_char.insert(cid, clan_id);
            let clan = &r.clans[&clan_id];
            cast_sys(clan, &format!("{name} se unió al clan {cname}."), &format!("{name} has joined the clan {cname}."));
            { let id = clan.id; push_id(&r, id); }
        }
        self.db.char_clan(cid, Some(clan_id as i64), MEMBER as i64, "");
        changed();
    }

    pub fn clan_leave(&mut self, pid: u32) {
        let (cid, name) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone()) };
        let now = crate::world::now_ms();
        let until = now + d().clans.cfg.leave_ms;
        {
            let mut r = reg().write().unwrap();
            let Some(&clan_id) = r.by_char.get(&cid) else { return };
            if r.clans[&clan_id].leader == cid { return self.sys(pid, "El líder no puede irse: transferí el liderazgo o disolvé el clan.", "The leader cannot leave: hand over the leadership or dissolve the clan."); }
            r.by_char.remove(&cid);
            let found = r.penalty.get(&cid).map_or(0.0, |p| p.1);
            r.penalty.insert(cid, (until, found));
            let clan = r.clans.get_mut(&clan_id).unwrap();
            clan.members.retain(|m| m.char_id != cid);
            cast_sys(clan, &format!("{name} dejó el clan."), &format!("{name} has left the clan."));
            { let id = clan.id; push_id(&r, id); }
            self.db.char_clan_penalty(cid, until, found);
        }
        self.db.char_clan(cid, None, MEMBER as i64, "");
        self.send(pid, json!({ "t": "clan", "clan": null }));
        self.sys(pid, "Dejaste el clan. No podés entrar a otro durante 24 horas.", "You left the clan. You cannot join another for 24 hours.");
        changed();
    }

    pub fn clan_kick(&mut self, pid: u32, name: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let now = crate::world::now_ms();
        let cfg = &d().clans.cfg;
        let target;
        {
            let mut r = reg().write().unwrap();
            let Some(&clan_id) = r.by_char.get(&cid) else { return };
            let clan = &r.clans[&clan_id];
            if !clan.can(cid, P_DISMISS) { return self.sys(pid, "No tenés permiso para expulsar.", "You may not dismiss members."); }
            let Some(t) = clan.by_name(name) else { return self.sys(pid, &format!("{name} no es de tu clan."), &format!("{name} is not in your clan.")) };
            let my_grade = clan.member(cid).map_or(MEMBER, |m| m.grade);
            if t.char_id == clan.leader || t.char_id == cid || (cid != clan.leader && t.grade <= my_grade) {
                return self.sys(pid, "No podés expulsar a alguien de tu rango o superior.", "You cannot dismiss someone of your grade or higher.");
            }
            target = (t.char_id, t.name.clone());
            r.by_char.remove(&target.0);
            let found = r.penalty.get(&target.0).map_or(0.0, |p| p.1);
            r.penalty.insert(target.0, (now + cfg.leave_ms, found));
            self.db.char_clan_penalty(target.0, now + cfg.leave_ms, found);
            let clan = r.clans.get_mut(&clan_id).unwrap();
            clan.members.retain(|m| m.char_id != target.0);
            clan.invite_until = now + cfg.kick_ms;
            self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, clan.ally.map(|a| a as i64), clan.invite_until);
            cast_sys(clan, &format!("{} fue expulsado del clan.", target.1), &format!("{} has been dismissed from the clan.", target.1));
            { let id = clan.id; push_id(&r, id); }
        }
        self.db.char_clan(target.0, None, MEMBER as i64, "");
        to_char(target.0, json!({ "t": "clan", "clan": null }));
        to_char(target.0, json!({ "t": "chat", "ch": "sys", "from": "", "text": "Fuiste expulsado del clan. No podés entrar a otro durante 24 horas." }));
        changed();
    }

    /** The leader hands the clan over to another member (not during a war, as in L2). */
    pub fn clan_transfer(&mut self, pid: u32, name: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let mut r = reg().write().unwrap();
        let Some(&clan_id) = r.by_char.get(&cid) else { return };
        if r.fighting(clan_id) { return self.sys(pid, "No se puede transferir el liderazgo durante una guerra.", "The leadership cannot be handed over during a war."); }
        let clan = r.clans.get_mut(&clan_id).unwrap();
        if clan.leader != cid { return self.sys(pid, "Solo el líder puede transferir el clan.", "Only the leader can hand over the clan."); }
        let Some(t) = clan.by_name(name).map(|m| (m.char_id, m.name.clone())) else { return self.sys(pid, &format!("{name} no es de tu clan."), &format!("{name} is not in your clan.")) };
        if t.0 == cid { return; }
        clan.leader = t.0;
        for m in clan.members.iter_mut() {
            if m.char_id == t.0 { m.grade = LEADER; }
            if m.char_id == cid { m.grade = 2; }
        }
        self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, clan.ally.map(|a| a as i64), clan.invite_until);
        self.db.char_clan(t.0, Some(clan_id as i64), LEADER as i64, &clan.member(t.0).unwrap().title);
        self.db.char_clan(cid, Some(clan_id as i64), 2, &clan.member(cid).unwrap().title);
        cast_sys(clan, &format!("{} es el nuevo líder del clan.", t.1), &format!("{} is the clan's new leader.", t.1));
        { let id = clan.id; push_id(&r, id); }
    }

    pub fn clan_dissolve(&mut self, pid: u32, nid: u32) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if n.kind != "clan" { return; }
        let cid = self.pl(pid).unwrap().char_id;
        let now = crate::world::now_ms();
        let until = now + d().clans.cfg.dissolve_ms;
        {
            let mut r = reg().write().unwrap();
            let Some(&clan_id) = r.by_char.get(&cid) else { return };
            if r.clans[&clan_id].leader != cid { return self.sys(pid, "Solo el líder puede disolver el clan.", "Only the leader can dissolve the clan."); }
            if r.fighting(clan_id) { return self.sys(pid, "No podés disolver el clan durante una guerra: terminala primero.", "You cannot dissolve the clan during a war: end it first."); }
            if r.clans[&clan_id].ally.is_some() { return self.sys(pid, "Tu clan está en una alianza: dejala (o disolvela) primero.", "Your clan is in an alliance: leave (or dissolve) it first."); }
            let clan = r.clans.remove(&clan_id).unwrap();
            let foes: Vec<u32> = r.wars.iter().filter(|w| w.1 == clan_id).map(|w| w.0).collect();
            r.wars.retain(|w| w.0 != clan_id && w.1 != clan_id);
            r.war_cd.retain(|k, _| k.0 != clan_id && k.1 != clan_id);
            for f in foes { push_id(&r, f); }
            cast_sys(&clan, &format!("El clan {} fue disuelto.", clan.name), &format!("The clan {} has been dissolved.", clan.name));
            cast(&clan, |_| json!({ "t": "clan", "clan": null }));
            for m in &clan.members { r.by_char.remove(&m.char_id); }
            let join = r.penalty.get(&cid).map_or(0.0, |p| p.0);
            r.penalty.insert(cid, (join, until));
            self.db.char_clan_penalty(cid, join, until);
            self.db.clan_delete(clan_id as i64);
        }
        changed();
    }

    // ------------------------------------------------------------------ level, grades, titles, crest

    pub fn clan_level_up(&mut self, pid: u32, nid: u32) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if n.kind != "clan" { return; }
        let cid = self.pl(pid).unwrap().char_id;
        let mut r = reg().write().unwrap();
        let Some(&clan_id) = r.by_char.get(&cid) else { return };
        let clan = r.clans.get_mut(&clan_id).unwrap();
        if clan.leader != cid { return self.sys(pid, "Solo el líder puede subir el nivel del clan.", "Only the leader can raise the clan's level."); }
        let next = clan.level as usize + 1;
        let Some(cost) = d().clans.levels.get(next) else { return self.sys(pid, "Tu clan ya tiene el nivel máximo.", "Your clan is already at the highest level.") };
        let p = self.pl_mut(pid).unwrap();
        if p.adena < cost.adena { return self.sys(pid, &format!("Necesitás {} de adena.", cost.adena), &format!("You need {} adena.", cost.adena)); }
        if cost.mats.iter().any(|(m, c)| crate::inventory::count_item(p, m) < *c) { return self.sys(pid, "Te faltan materiales.", "You are missing materials."); }
        if clan.rep < cost.rep { return self.sys(pid, &format!("El clan necesita {} de reputación.", cost.rep), &format!("The clan needs {} reputation.", cost.rep)); }
        p.adena -= cost.adena;
        for (m, c) in &cost.mats { crate::inventory::take_items(p, m, *c); }
        p.inv_dirty = true;
        clan.rep -= cost.rep;
        clan.level = next as u8;
        self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, clan.ally.map(|a| a as i64), clan.invite_until);
        cast_sys(clan, &format!("¡El clan subió a nivel {next}!"), &format!("The clan has reached level {next}!"));
        { let id = clan.id; push_id(&r, id); }
    }

    /** Set a member's power grade (2-5; the lower ranks open with the clan's level). */
    pub fn clan_grade(&mut self, pid: u32, name: &str, grade: u8) {
        let cid = self.pl(pid).unwrap().char_id;
        let mut r = reg().write().unwrap();
        let Some(&clan_id) = r.by_char.get(&cid) else { return };
        let clan = r.clans.get_mut(&clan_id).unwrap();
        if !clan.can(cid, P_RANKS) { return self.sys(pid, "No tenés permiso para cambiar rangos.", "You may not change ranks."); }
        if !(2..=5).contains(&grade) { return; }
        if clan.level < d().clans.grade_level.get(grade as usize).copied().unwrap_or(0) {
            return self.sys(pid, "Tu clan todavía no tiene ese rango.", "Your clan does not have that rank yet.");
        }
        let leader = clan.leader;
        let Some(t) = clan.members.iter_mut().find(|m| m.name.eq_ignore_ascii_case(name)) else { return self.sys(pid, &format!("{name} no es de tu clan."), &format!("{name} is not in your clan.")) };
        if t.char_id == leader { return; }
        t.grade = grade;
        let (tc, title) = (t.char_id, t.title.clone());
        self.db.char_clan(tc, Some(clan_id as i64), grade as i64, &title);
        { let id = clan.id; push_id(&r, id); }
    }

    /** The leader sets what a grade may do. */
    pub fn clan_privs(&mut self, pid: u32, grade: u8, privs: u32) {
        let cid = self.pl(pid).unwrap().char_id;
        let mut r = reg().write().unwrap();
        let Some(&clan_id) = r.by_char.get(&cid) else { return };
        let clan = r.clans.get_mut(&clan_id).unwrap();
        if clan.leader != cid || !(2..=5).contains(&grade) { return; }
        clan.privs[grade as usize] = privs & ALL_PRIVS;
        self.db.clan_privs(clan_id as i64, grade as i64, (privs & ALL_PRIVS) as i64);
        { let id = clan.id; push_id(&r, id); }
    }

    pub fn clan_title(&mut self, pid: u32, name: &str, title: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let title: String = title.trim().chars().filter(|c| !c.is_control()).take(d().clans.cfg.title_max).collect();
        let mut r = reg().write().unwrap();
        let Some(&clan_id) = r.by_char.get(&cid) else { return };
        let clan = r.clans.get_mut(&clan_id).unwrap();
        if !clan.can(cid, P_TITLE) { return self.sys(pid, "No tenés permiso para poner títulos.", "You may not set titles."); }
        let Some(t) = clan.members.iter_mut().find(|m| m.name.eq_ignore_ascii_case(name)) else { return self.sys(pid, &format!("{name} no es de tu clan."), &format!("{name} is not in your clan.")) };
        t.title = title.clone();
        let (tc, grade) = (t.char_id, t.grade);
        self.db.char_clan(tc, Some(clan_id as i64), grade as i64, &title);
        { let id = clan.id; push_id(&r, id); }
        drop(r);
        changed();
    }

    /** A new crest: a PNG of the crest's exact size, small, base64 (the client scales the image down). */
    pub fn clan_crest(&mut self, pid: u32, b64: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let cfg = &d().clans.cfg;
        let Ok(png) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) else { return };
        if !valid_crest(&png, cfg.crest_w, cfg.crest_h, cfg.crest_bytes) {
            return self.sys(pid, &format!("El emblema debe ser una imagen PNG de {}×{}.", cfg.crest_w, cfg.crest_h), &format!("The crest must be a {}×{} PNG image.", cfg.crest_w, cfg.crest_h));
        }
        let mut r = reg().write().unwrap();
        let Some(&clan_id) = r.by_char.get(&cid) else { return };
        let clan = r.clans.get_mut(&clan_id).unwrap();
        if !clan.can(cid, P_CREST) { return self.sys(pid, "No tenés permiso para cambiar el emblema.", "You may not change the crest."); }
        if clan.level < cfg.crest_level { return self.sys(pid, &format!("El clan necesita nivel {} para tener emblema.", cfg.crest_level), &format!("The clan needs level {} for a crest.", cfg.crest_level)); }
        clan.crest_ver += 1;
        clan.crest = Some(png.clone());
        self.db.clan_crest(clan_id as i64, &png, clan.crest_ver as i64);
        cast_sys(clan, "El clan tiene un emblema nuevo.", "The clan has a new crest.");
        { let id = clan.id; push_id(&r, id); }
        drop(r);
        changed();
    }

    /** Reputation for what these players did together: each of their clans (once) gains `amount`. */
    pub fn clan_rep(&mut self, pids: &[u32], amount: i64, es: &str, en: &str) {
        let chars: Vec<i64> = pids.iter().filter_map(|id| self.pl(*id).map(|p| p.char_id)).collect();
        let mut r = reg().write().unwrap();
        let mut ids: Vec<u32> = chars.iter().filter_map(|c| r.by_char.get(c).copied()).collect();
        ids.sort();
        ids.dedup();
        for id in ids {
            let clan = r.clans.get_mut(&id).unwrap();
            clan.rep = (clan.rep + amount).max(0);
            self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, clan.ally.map(|a| a as i64), clan.invite_until);
            cast_sys(clan, &format!("Reputación del clan {amount:+} ({es})."), &format!("Clan reputation {amount:+} ({en})."));
            { let id = clan.id; push_id(&r, id); }
        }
    }

    /** Clan chat ('@'): every online member, in any world. */
    pub fn clan_chat(&mut self, pid: u32, msg: &str) {
        let (cid, name) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone()) };
        let r = reg().read().unwrap();
        let Some(clan) = r.of(cid) else { return self.sys(pid, "No pertenecés a ningún clan.", "You are not in a clan.") };
        let v = json!({ "t": "chat", "ch": "clan", "from": name, "text": msg });
        cast(clan, |_| v.clone());
    }

    /** The clan window asks for its data. */
    pub fn clan_send(&self, pid: u32) {
        let Some(id) = self.my_clan(pid) else { return self.send(pid, json!({ "t": "clan", "clan": null })) };
        let r = reg().read().unwrap();
        if let Some(c) = r.clans.get(&id) { self.send(pid, json!({ "t": "clan", "clan": info(&r, c) })); }
    }

    // ------------------------------------------------------------------ wars

    /** Declare war on a clan (L3+ both, the war privilege). Once both sides have declared, the war is mutual. */
    pub fn clan_war(&mut self, pid: u32, name: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let cfg = &d().clans.cfg;
        let now = crate::world::now_ms();
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return self.sys(pid, "No pertenecés a ningún clan.", "You are not in a clan.") };
        if !r.clans[&me].can(cid, P_WAR) { return self.sys(pid, "No tenés permiso para declarar guerras.", "You may not declare wars."); }
        if r.clans[&me].level < cfg.war_level { return self.sys(pid, &format!("Tu clan necesita nivel {} para declarar guerras.", cfg.war_level), &format!("Your clan needs level {} to declare wars.", cfg.war_level)); }
        let Some(foe) = r.clan_named(name) else { return self.sys(pid, &format!("No existe el clan {}.", name.trim()), &format!("There is no clan named {}.", name.trim())) };
        if foe == me { return; }
        let foe_name = r.clans[&foe].name.clone();
        if r.clans[&foe].level < cfg.war_level { return self.sys(pid, &format!("{foe_name} necesita nivel {} para entrar en guerra.", cfg.war_level), &format!("{foe_name} needs level {} to be at war.", cfg.war_level)); }
        if r.allied(me, foe) { return self.sys(pid, "No podés declararle la guerra a un clan de tu alianza.", "You cannot declare war on a clan of your alliance."); }
        if r.wars.contains(&(me, foe)) { return self.sys(pid, &format!("Ya le declaraste la guerra a {foe_name}."), &format!("You have already declared war on {foe_name}.")); }
        if let Some(&until) = r.war_cd.get(&(me, foe)) {
            if until > now { return self.sys(pid, &format!("Tu clan terminó una guerra con {foe_name} hace poco: podrá declararla de nuevo en {}.", wait(until - now, false)), &format!("Your clan ended a war with {foe_name} recently: it may declare again in {}.", wait(until - now, true))); }
        }
        if r.wars.iter().filter(|w| w.0 == me).count() >= cfg.max_wars { return self.sys(pid, "Tu clan ya declaró todas las guerras que puede.", "Your clan has declared as many wars as it may."); }
        r.wars.insert((me, foe));
        r.war_cd.remove(&(me, foe));
        self.db.war_add(me as i64, foe as i64);
        let my_name = r.clans[&me].name.clone();
        if r.mutual(me, foe) {
            for (a, b) in [(me, &foe_name), (foe, &my_name)] {
                cast_sys(&r.clans[&a], &format!("¡Guerra total con el clan {b}! Pueden atacarse sin flag y matar no da karma."), &format!("Full war with the clan {b}! You may attack each other without flags and kills give no karma."));
            }
        } else {
            cast_sys(&r.clans[&me], &format!("Tu clan le declaró la guerra a {foe_name}. Será total cuando ellos la declaren también."), &format!("Your clan declared war on {foe_name}. It becomes a full war once they declare too."));
            cast_sys(&r.clans[&foe], &format!("El clan {my_name} les declaró la guerra. Si su líder la declara también, será una guerra total."), &format!("The clan {my_name} has declared war on you. If your leader declares too, it becomes a full war."));
        }
        push_id(&r, me);
        push_id(&r, foe);
    }

    /** Withdraw our declaration of war; we may not declare on that clan again for a while. */
    pub fn clan_war_end(&mut self, pid: u32, name: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let now = crate::world::now_ms();
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return };
        if !r.clans[&me].can(cid, P_WAR) { return self.sys(pid, "No tenés permiso para terminar guerras.", "You may not end wars."); }
        let Some(foe) = r.clan_named(name) else { return };
        if !r.wars.remove(&(me, foe)) { return; }
        let until = now + d().clans.cfg.war_cooldown_ms;
        r.war_cd.insert((me, foe), until);
        self.db.war_del(me as i64, foe as i64, until);
        let (my_name, foe_name) = (r.clans[&me].name.clone(), r.clans[&foe].name.clone());
        cast_sys(&r.clans[&me], &format!("Tu clan terminó su guerra con {foe_name}."), &format!("Your clan ended its war with {foe_name}."));
        cast_sys(&r.clans[&foe], &format!("El clan {my_name} terminó su guerra con ustedes."), &format!("The clan {my_name} has ended its war with you."));
        push_id(&r, me);
        push_id(&r, foe);
    }

    /** A kill in a mutual war: the killer's clan gains reputation, the victim's loses some (combat.rs kill_player). */
    pub fn clan_war_kill(&mut self, killer: u32, victim: u32) {
        let (Some(k), Some(v)) = (self.pl(killer).map(|p| (p.char_id, p.name.clone())), self.pl(victim).map(|p| (p.char_id, p.name.clone()))) else { return };
        let rep = &d().clans.rep;
        let mut r = reg().write().unwrap();
        let (Some(&kc), Some(&vc)) = (r.by_char.get(&k.0), r.by_char.get(&v.0)) else { return };
        if !r.mutual(kc, vc) { return; }
        for (id, amount, es, en) in [
            (kc, rep.war_kill, format!("{} mató a {} en la guerra", k.1, v.1), format!("{} killed {} in the war", k.1, v.1)),
            (vc, rep.war_death, format!("{} cayó ante {} en la guerra", v.1, k.1), format!("{} fell to {} in the war", v.1, k.1)),
        ] {
            let clan = r.clans.get_mut(&id).unwrap();
            clan.rep = (clan.rep + amount).max(0);
            self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, clan.ally.map(|a| a as i64), clan.invite_until);
            cast_sys(clan, &format!("Reputación del clan {amount:+} ({es})."), &format!("Clan reputation {amount:+} ({en})."));
            push_id(&r, id);
        }
    }

    // ------------------------------------------------------------------ alliances

    /** A level 5 clan's leader founds an alliance at the clan master. */
    pub fn ally_create(&mut self, pid: u32, nid: u32, name: &str) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if n.kind != "clan" { return; }
        let cid = self.pl(pid).unwrap().char_id;
        let cfg = &d().clans.cfg;
        let name = name.trim();
        let now = crate::world::now_ms();
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return self.sys(pid, "No pertenecés a ningún clan.", "You are not in a clan.") };
        let clan = &r.clans[&me];
        if clan.leader != cid { return self.sys(pid, "Solo el líder del clan puede fundar una alianza.", "Only the clan leader can found an alliance."); }
        if clan.level < cfg.ally_level { return self.sys(pid, &format!("Tu clan necesita nivel {} para fundar una alianza.", cfg.ally_level), &format!("Your clan needs level {} to found an alliance.", cfg.ally_level)); }
        if clan.ally.is_some() { return self.sys(pid, "Tu clan ya está en una alianza.", "Your clan is already in an alliance."); }
        let until = clan.ally_found_until.max(clan.ally_join_until);
        if until > now { return self.sys(pid, &format!("Tu clan tiene que esperar {} para fundar una alianza.", wait(until - now, false)), &format!("Your clan must wait {} to found an alliance.", wait(until - now, true))); }
        if !valid_name(name) { return self.sys(pid, &format!("El nombre de la alianza debe tener entre {} y {} letras o números.", cfg.name_min, cfg.name_max), &format!("An alliance name must be {} to {} letters or digits.", cfg.name_min, cfg.name_max)); }
        let Ok(id) = self.db.ally_insert(name, me as i64) else { return self.sys(pid, "Ya existe una alianza con ese nombre.", "An alliance with that name already exists.") };
        let id = id as u32;
        r.allies.insert(id, Ally { id, name: name.to_string(), leader: me, crest: None, crest_ver: 0, invite_until: 0.0 });
        let clan = r.clans.get_mut(&me).unwrap();
        clan.ally = Some(id);
        self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, Some(id as i64), clan.invite_until);
        cast_sys(clan, &format!("Tu clan fundó la alianza {name}."), &format!("Your clan founded the alliance {name}."));
        push_id(&r, me);
        drop(r);
        changed();
    }

    /** The alliance's leader invites another clan's leader (who must be in this world, as with clan invitations). */
    pub fn ally_invite(&mut self, pid: u32, name: &str) {
        let name = name.trim();
        let Some(tid) = self.find_player(name) else { return self.sys(pid, &format!("{name} no está conectado (o no está en este mundo)."), &format!("{name} is not online (or not in this world).")) };
        let (cid, from) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone()) };
        let (tcid, tname) = { let t = self.pl(tid).unwrap(); (t.char_id, t.name.clone()) };
        let cfg = &d().clans.cfg;
        let now = crate::world::now_ms();
        let (ally_id, ally_name, my_clan);
        {
            let r = reg().read().unwrap();
            let Some(&me) = r.by_char.get(&cid) else { return };
            let Some(ally) = r.clans[&me].ally.and_then(|a| r.allies.get(&a)) else { return self.sys(pid, "Tu clan no está en una alianza.", "Your clan is not in an alliance.") };
            if ally.leader != me || r.clans[&me].leader != cid { return self.sys(pid, "Solo el líder de la alianza puede invitar.", "Only the alliance leader can invite."); }
            if ally.invite_until > now { return self.sys(pid, &format!("Tu alianza expulsó a un clan hace poco: podrá invitar en {}.", wait(ally.invite_until - now, false)), &format!("Your alliance expelled a clan recently: it may invite again in {}.", wait(ally.invite_until - now, true))); }
            let members = r.ally_clans(ally.id);
            if members.len() >= cfg.ally_max { return self.sys(pid, &format!("Tu alianza ya tiene {} clanes.", cfg.ally_max), &format!("Your alliance already has {} clans.", cfg.ally_max)); }
            let Some(&tc) = r.by_char.get(&tcid) else { return self.sys(pid, &format!("{tname} no pertenece a ningún clan."), &format!("{tname} is not in a clan.")) };
            let t = &r.clans[&tc];
            if t.leader != tcid { return self.sys(pid, &format!("{tname} no es el líder de su clan."), &format!("{tname} is not their clan's leader.")); }
            if t.ally.is_some() { return self.sys(pid, &format!("El clan {} ya está en una alianza.", t.name), &format!("The clan {} is already in an alliance.", t.name)); }
            if t.ally_join_until > now { return self.sys(pid, &format!("El clan {} dejó una alianza hace poco y todavía no puede entrar a otra.", t.name), &format!("The clan {} left an alliance recently and cannot join another yet.", t.name)); }
            if members.iter().any(|&m| r.wars.contains(&(m, tc)) || r.wars.contains(&(tc, m))) {
                return self.sys(pid, &format!("Hay una guerra entre el clan {} y tu alianza.", t.name), &format!("The clan {} is at war with your alliance.", t.name));
            }
            ally_id = ally.id;
            ally_name = ally.name.clone();
            my_clan = r.clans[&me].name.clone();
        }
        let t = self.pl_mut(tid).unwrap();
        if t.pending_ally.map_or(false, |(_, until)| until > now) { return self.sys(pid, &format!("{tname} está respondiendo otra invitación."), &format!("{tname} is answering another invitation.")); }
        t.pending_ally = Some((ally_id, now + cfg.invite_ms));
        t.send(json!({ "t": "allyInvite", "from": from, "clan": my_clan, "ally": ally_name }));
        self.sys(pid, &format!("Invitaste al clan de {tname} a la alianza."), &format!("You invited {tname}'s clan to the alliance."));
    }

    pub fn ally_respond(&mut self, pid: u32, accept: bool) {
        let now = crate::world::now_ms();
        let Some((ally_id, until)) = self.pl_mut(pid).unwrap().pending_ally.take() else { return };
        if until < now || !accept { return; }
        let cid = self.pl(pid).unwrap().char_id;
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return };
        if r.clans[&me].leader != cid || r.clans[&me].ally.is_some() { return; }
        let Some(ally_name) = r.allies.get(&ally_id).map(|a| a.name.clone()) else { return self.sys(pid, "Esa alianza ya no existe.", "That alliance no longer exists.") };
        if r.ally_clans(ally_id).len() >= d().clans.cfg.ally_max { return self.sys(pid, "La alianza está completa.", "The alliance is full."); }
        let clan = r.clans.get_mut(&me).unwrap();
        clan.ally = Some(ally_id);
        self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, Some(ally_id as i64), clan.invite_until);
        let cname = clan.name.clone();
        cast_ally_sys(&r, ally_id, &format!("El clan {cname} se unió a la alianza {ally_name}."), &format!("The clan {cname} has joined the alliance {ally_name}."));
        push_ally(&r, ally_id);
        drop(r);
        changed();
    }

    /** A clan's leader takes their clan out of the alliance (not the leading clan: it dissolves instead). */
    pub fn ally_leave(&mut self, pid: u32) {
        let cid = self.pl(pid).unwrap().char_id;
        let now = crate::world::now_ms();
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return };
        let Some(ally_id) = r.clans[&me].ally else { return };
        if r.clans[&me].leader != cid { return self.sys(pid, "Solo el líder del clan puede sacarlo de la alianza.", "Only the clan leader can take the clan out of the alliance."); }
        if r.allies[&ally_id].leader == me { return self.sys(pid, "Tu clan lidera la alianza: para salir, disolvela.", "Your clan leads the alliance: to leave, dissolve it."); }
        let ally_name = r.allies[&ally_id].name.clone();
        let clan = r.clans.get_mut(&me).unwrap();
        clan.ally = None;
        clan.ally_join_until = now + d().clans.cfg.ally_leave_ms;
        self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, None, clan.invite_until);
        self.db.clan_ally_pen(clan.id as i64, clan.ally_join_until, clan.ally_found_until);
        let cname = clan.name.clone();
        cast_sys(clan, &format!("Tu clan dejó la alianza {ally_name}. No puede entrar a otra durante 24 horas."), &format!("Your clan left the alliance {ally_name}. It cannot join another for 24 hours."));
        cast_ally_sys(&r, ally_id, &format!("El clan {cname} dejó la alianza."), &format!("The clan {cname} has left the alliance."));
        push_id(&r, me);
        push_ally(&r, ally_id);
        drop(r);
        changed();
    }

    /** The alliance's leader expels a clan: it may not join another alliance, nor the alliance invite, for a while. */
    pub fn ally_kick(&mut self, pid: u32, name: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let now = crate::world::now_ms();
        let wait_ms = d().clans.cfg.ally_leave_ms;
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return };
        let Some(ally_id) = r.clans[&me].ally else { return };
        if r.allies[&ally_id].leader != me || r.clans[&me].leader != cid { return self.sys(pid, "Solo el líder de la alianza puede expulsar clanes.", "Only the alliance leader can expel clans."); }
        let Some(t) = r.clan_named(name) else { return };
        if t == me || r.clans[&t].ally != Some(ally_id) { return; }
        let ally = r.allies.get_mut(&ally_id).unwrap();
        ally.invite_until = now + wait_ms;
        self.db.ally_save(ally_id as i64, ally.invite_until);
        let ally_name = ally.name.clone();
        let clan = r.clans.get_mut(&t).unwrap();
        clan.ally = None;
        clan.ally_join_until = now + wait_ms;
        self.db.clan_save(clan.id as i64, clan.leader, clan.level as i64, clan.rep, None, clan.invite_until);
        self.db.clan_ally_pen(clan.id as i64, clan.ally_join_until, clan.ally_found_until);
        let cname = clan.name.clone();
        cast_sys(clan, &format!("Tu clan fue expulsado de la alianza {ally_name}. No puede entrar a otra durante 24 horas."), &format!("Your clan was expelled from the alliance {ally_name}. It cannot join another for 24 hours."));
        cast_ally_sys(&r, ally_id, &format!("El clan {cname} fue expulsado de la alianza."), &format!("The clan {cname} has been expelled from the alliance."));
        push_id(&r, t);
        push_ally(&r, ally_id);
        drop(r);
        changed();
    }

    /** The alliance's leader dissolves it; the leading clan may not found another for a while. */
    pub fn ally_dissolve(&mut self, pid: u32) {
        let cid = self.pl(pid).unwrap().char_id;
        let now = crate::world::now_ms();
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return };
        let Some(ally_id) = r.clans[&me].ally else { return };
        if r.allies[&ally_id].leader != me || r.clans[&me].leader != cid { return self.sys(pid, "Solo el líder de la alianza puede disolverla.", "Only the alliance leader can dissolve it."); }
        let members = r.ally_clans(ally_id);
        let ally = r.allies.remove(&ally_id).unwrap();
        for id in &members {
            let clan = r.clans.get_mut(id).unwrap();
            clan.ally = None;
            if *id == me {
                clan.ally_found_until = now + d().clans.cfg.ally_dissolve_ms;
                self.db.clan_ally_pen(clan.id as i64, clan.ally_join_until, clan.ally_found_until);
            }
            cast_sys(clan, &format!("La alianza {} fue disuelta.", ally.name), &format!("The alliance {} has been dissolved.", ally.name));
        }
        self.db.ally_delete(ally_id as i64);
        for id in members { push_id(&r, id); }
        drop(r);
        changed();
    }

    /** The alliance's crest: an 8×12 PNG, set by the alliance's leader. */
    pub fn ally_crest(&mut self, pid: u32, b64: &str) {
        let cid = self.pl(pid).unwrap().char_id;
        let cfg = &d().clans.cfg;
        let Ok(png) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) else { return };
        if !valid_crest(&png, cfg.ally_crest_w, cfg.ally_crest_h, cfg.crest_bytes) {
            return self.sys(pid, &format!("El emblema de la alianza debe ser una imagen PNG de {}×{}.", cfg.ally_crest_w, cfg.ally_crest_h), &format!("The alliance crest must be a {}×{} PNG image.", cfg.ally_crest_w, cfg.ally_crest_h));
        }
        let mut r = reg().write().unwrap();
        let Some(&me) = r.by_char.get(&cid) else { return };
        let Some(ally_id) = r.clans[&me].ally else { return };
        if r.allies[&ally_id].leader != me || r.clans[&me].leader != cid { return self.sys(pid, "Solo el líder de la alianza cambia su emblema.", "Only the alliance leader changes its crest."); }
        let ally = r.allies.get_mut(&ally_id).unwrap();
        ally.crest_ver += 1;
        ally.crest = Some(png.clone());
        self.db.ally_crest(ally_id as i64, &png, ally.crest_ver as i64);
        cast_ally_sys(&r, ally_id, "La alianza tiene un emblema nuevo.", "The alliance has a new crest.");
        push_ally(&r, ally_id);
        drop(r);
        changed();
    }

    /** Alliance chat ('$'): every online member of every clan in the alliance, in any world. */
    pub fn ally_chat(&mut self, pid: u32, msg: &str) {
        let (cid, name) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone()) };
        let r = reg().read().unwrap();
        let Some(ally) = r.of(cid).and_then(|c| c.ally) else { return self.sys(pid, "Tu clan no está en una alianza.", "Your clan is not in an alliance.") };
        let v = json!({ "t": "chat", "ch": "ally", "from": name, "text": msg });
        for id in r.ally_clans(ally) { cast(&r.clans[&id], |_| v.clone()); }
    }
}

/** "3 h", "2 días"... for penalty messages. */
fn wait(ms: f64, en: bool) -> String {
    let h = (ms / 3600_000.0).ceil() as i64;
    if h >= 48 { let dd = (h + 23) / 24; if en { format!("{dd} days") } else { format!("{dd} días") } }
    else if en { format!("{h} h") } else { format!("{h} h") }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32, len: usize) -> Vec<u8> {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.resize(len, 0);
        v
    }

    #[test]
    fn crest_checks_size_and_signature() {
        assert!(valid_crest(&png(16, 12, 200), 16, 12, 2048));
        assert!(!valid_crest(&png(32, 24, 200), 16, 12, 2048));
        assert!(!valid_crest(&png(16, 12, 4000), 16, 12, 2048));
        let mut bad = png(16, 12, 200);
        bad[1] = b'X';
        assert!(!valid_crest(&bad, 16, 12, 2048));
    }

    #[test]
    fn names_are_letters_and_digits() {
        assert!(valid_name("Lobos"));
        assert!(valid_name("Clan42"));
        assert!(!valid_name("a"));
        assert!(!valid_name("Los Lobos"));
        assert!(!valid_name("<b>x</b>"));
    }

    #[test]
    fn leader_holds_every_privilege() {
        let clan = Clan {
            id: 1, name: "X".into(), leader: 10, level: 0, rep: 0, crest: None, crest_ver: 0, ally: None, invite_until: 0.0,
            ally_join_until: 0.0, ally_found_until: 0.0,
            privs: [0, 0x7f, P_INVITE, 0, 0, 0],
            members: vec![
                ClanMember { char_id: 10, name: "L".into(), level: 20, cls: "fighter".into(), grade: 1, title: String::new() },
                ClanMember { char_id: 11, name: "O".into(), level: 20, cls: "fighter".into(), grade: 2, title: String::new() },
                ClanMember { char_id: 12, name: "M".into(), level: 20, cls: "fighter".into(), grade: 5, title: String::new() },
            ],
        };
        assert!(clan.can(10, P_DISMISS));
        assert!(clan.can(11, P_INVITE) && !clan.can(11, P_DISMISS));
        assert!(!clan.can(12, P_INVITE));
        assert!(!clan.can(99, P_INVITE));
    }

    fn clan(id: u32, ally: Option<u32>, member: i64) -> Clan {
        Clan {
            id, name: format!("C{id}"), leader: member, level: 5, rep: 0, crest: None, crest_ver: 0, ally, invite_until: 0.0,
            ally_join_until: 0.0, ally_found_until: 0.0, privs: [0, 0x7f, 0, 0, 0, 0],
            members: vec![ClanMember { char_id: member, name: format!("P{member}"), level: 40, cls: "fighter".into(), grade: 1, title: String::new() }],
        }
    }

    #[test]
    fn only_a_mutual_war_makes_enemies_and_allies_are_friends() {
        let mut r = Clans::default();
        for c in [clan(1, None, 10), clan(2, None, 20), clan(3, Some(7), 30), clan(4, Some(7), 40)] {
            for m in &c.members { r.by_char.insert(m.char_id, c.id); }
            r.clans.insert(c.id, c);
        }
        r.wars.insert((1, 2));
        assert_eq!(r.relation(10, 20), Rel::None, "one-sided: still the usual PvP rules");
        assert!(r.fighting(1) && !r.fighting(2), "a war declared on a clan does not keep it from dissolving");
        r.wars.insert((2, 1));
        assert_eq!(r.relation(10, 20), Rel::War);
        assert_eq!(r.relation(20, 10), Rel::War);
        assert_eq!(r.relation(30, 40), Rel::Friend, "same alliance");
        assert_eq!(r.relation(10, 30), Rel::None);
        assert_eq!(r.relation(10, 99), Rel::None, "no clan");
        assert_eq!(r.ally_clans(7), vec![3, 4]);
    }
}
