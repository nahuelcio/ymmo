//! The GM panel's character editor (admin.rs `charGet` / `charEdit`). It covers a character's whole progress (level,
//! XP, specialization, Legend, adena, karma, PK, PvP, inventory, quests), plus its week and day (jewel rolls, the
//! Rift's paid run, the daily contracts), its Olympiad month and its clan, for anyone, online or not.
//!
//! - **One set of rules:** `apply` changes a `Prog` (the progress, wherever it lives) and says what changed, or why
//!   not. Online, the `Prog` comes from the live Player and goes back to it: stats recalculated, inventory and quests
//!   resent, the looks refreshed for everyone around, saved at once. Offline, it comes from the database and goes back.
//! - **Where it runs:** the hub hands a character in a world to that world (WorldCmd::GmGet / GmEdit); one in no world
//!   goes to the main world, which works on the database (`offline_sheet` / `offline_edit`).
//! - **The answer:** the character's sheet, fresh, straight to the GM: `{ t: 'adminChar', sheet, msg | err }`.
//! - **History:** every change that went through is a row of gm_log; the sheet shows the latest.
use crate::data::d;
use crate::db::{CharSave, Db};
use crate::ent::{InvItem, Outbox, Player};
use crate::formulas::{legend_to_next, loot_day, loot_month, loot_week, xp_to_next};
use crate::world::{now_ms, World};
use serde_json::{json, Value};
use std::collections::HashMap;

/** One change the GM makes to a character (the panel's charEdit: `{ k, ... }`). */
#[derive(Clone, Debug, PartialEq)]
pub enum Edit {
    Level(i64),
    Xp(i64),
    Spec(Option<String>),
    LegendLvl(i64),
    LegendXp(i64),
    LegendRank(String, i64),
    Adena(i64),
    Karma(i64),
    Pk(i64),
    Pvp(i64),
    ItemAdd { item: String, count: i64, enchant: i64, mw: bool },
    ItemSet { u: u32, count: Option<i64>, enchant: Option<i64>, mw: Option<bool> },
    ItemRemove(u32),
    Quest { id: String, progress: i64, done: bool },
    QuestRemove(String),
    /** this week's roll of a boss's jewel, today's paid Rift run, a daily contract handed in today: back */
    JewelRoll(String),
    RiftRun,
    Daily(String),
    Oly { points: i64, wins: i64, losses: i64, draws: i64 },
    ClanLevel(i64),
    ClanRep(i64),
}

impl Edit {
    pub fn parse(v: &Value) -> Option<Edit> {
        let n = |k: &str| v[k].as_f64().map(|x| x.round() as i64);
        let s = |k: &str| v[k].as_str().map(String::from);
        Some(match v["k"].as_str()? {
            "level" => Edit::Level(n("v")?),
            "xp" => Edit::Xp(n("v")?),
            "spec" => Edit::Spec(s("v").filter(|x| !x.is_empty())),
            "legendLvl" => Edit::LegendLvl(n("v")?),
            "legendXp" => Edit::LegendXp(n("v")?),
            "legendRank" => Edit::LegendRank(s("id")?, n("v")?),
            "adena" => Edit::Adena(n("v")?),
            "karma" => Edit::Karma(n("v")?),
            "pk" => Edit::Pk(n("v")?),
            "pvp" => Edit::Pvp(n("v")?),
            "itemAdd" => Edit::ItemAdd { item: s("item")?, count: n("count").unwrap_or(1), enchant: n("enchant").unwrap_or(0), mw: v["mw"].as_bool().unwrap_or(false) },
            "itemSet" => Edit::ItemSet { u: n("u")? as u32, count: n("count"), enchant: n("enchant"), mw: v["mw"].as_bool() },
            "itemRemove" => Edit::ItemRemove(n("u")? as u32),
            "quest" => Edit::Quest { id: s("id")?, progress: n("progress").unwrap_or(0), done: v["done"].as_bool().unwrap_or(false) },
            "questRemove" => Edit::QuestRemove(s("id")?),
            "jewelRoll" => Edit::JewelRoll(s("boss")?),
            "riftRun" => Edit::RiftRun,
            "daily" => Edit::Daily(s("id")?),
            "oly" => Edit::Oly { points: n("points")?, wins: n("wins")?, losses: n("losses")?, draws: n("draws")? },
            "clanLevel" => Edit::ClanLevel(n("v")?),
            "clanRep" => Edit::ClanRep(n("v")?),
            _ => return None,
        })
    }

    /** A change to the progress a Prog holds (the others are the week's, the Olympiad's and the clan's). */
    fn progress(&self) -> bool { !matches!(self, Edit::JewelRoll(_) | Edit::RiftRun | Edit::Daily(_) | Edit::Oly { .. } | Edit::ClanLevel(_) | Edit::ClanRep(_)) }
}

/** A character's progress, wherever it lives (a live Player, or its database rows). */
#[derive(Clone, Debug)]
pub struct Prog {
    pub cls: String,
    pub level: i64,
    pub xp: i64,
    pub spec: Option<String>,
    pub legend_lvl: i64,
    pub legend_xp: i64,
    pub legend: HashMap<String, i64>,
    pub adena: i64,
    pub karma: i64,
    pub pk: i64,
    pub pvp: i64,
    pub inv: Vec<InvItem>,
    pub next_uid: u32,
    pub quests: Vec<(String, i64, bool)>,
}

impl Prog {
    fn of_player(p: &Player) -> Prog {
        Prog {
            cls: p.cls.clone(), level: p.level, xp: p.xp, spec: p.spec.clone(), legend_lvl: p.legend_lvl, legend_xp: p.legend_xp, legend: p.legend.clone(),
            adena: p.adena, karma: p.karma, pk: p.pk, pvp: p.pvp, inv: p.inv.clone(), next_uid: p.next_uid, quests: p.quests.clone(),
        }
    }
    fn into_player(self, p: &mut Player) {
        (p.level, p.xp, p.spec, p.legend_lvl, p.legend_xp, p.legend) = (self.level, self.xp, self.spec, self.legend_lvl, self.legend_xp, self.legend);
        (p.adena, p.karma, p.pk, p.pvp, p.inv, p.next_uid, p.quests) = (self.adena, self.karma, self.pk, self.pvp, self.inv, self.next_uid, self.quests);
    }
}

fn item_name(id: &str) -> String { d().item(id).map_or(id.into(), |i| i.name.clone()) }
fn quest_name(id: &str) -> String { d().quest(id).map_or(id.into(), |q| q.name.clone()) }
fn spec_name(id: Option<&str>) -> String { id.and_then(|s| d().spec(s)).map_or("ninguna".into(), |s| s.name.clone()) }
fn piece(i: &InvItem) -> String {
    format!("{}{}{}{}", if i.c > 1 { format!("{} × ", i.c) } else { String::new() }, item_name(&i.i), if i.e > 0 { format!(" +{}", i.e) } else { String::new() }, if i.m { " (obra maestra)" } else { "" })
}

/** One change to a character's progress: what changed (for the history), or why it can't. Nothing changes on an
 * error. */
pub fn apply(p: &mut Prog, e: &Edit) -> Result<String, String> {
    let max = d().c.max_level;
    let counter = |name: &str, old: i64, v: i64| -> Result<String, String> {
        if v < 0 { return Err(format!("{name}: no puede ser negativo.")); }
        Ok(format!("{name} {old} → {v}"))
    };
    match e {
        Edit::Level(n) => {
            if !(1..=max).contains(n) { return Err(format!("El nivel va de 1 a {max}.")); }
            let old = p.level;
            p.level = *n;
            // the XP fits the new level: none at the cap (it goes to the Legend), short of the next level below it
            p.xp = if *n >= max { 0 } else { p.xp.clamp(0, xp_to_next(*n) - 1) };
            Ok(format!("nivel {old} → {n}"))
        }
        Edit::Xp(x) => {
            if p.level >= max { return Err("En el nivel máximo la experiencia va a la Leyenda.".into()); }
            let need = xp_to_next(p.level);
            if !(0..need).contains(x) { return Err(format!("La XP de este nivel va de 0 a {}.", need - 1)); }
            let old = std::mem::replace(&mut p.xp, *x);
            Ok(format!("XP {old} → {x}"))
        }
        Edit::Spec(s) => {
            if let Some(id) = s {
                let Some(sp) = d().spec(id) else { return Err("No existe esa especialización.".into()) };
                if sp.base != p.cls { return Err(format!("{} no es de su clase.", sp.name)); }
            }
            let old = spec_name(p.spec.as_deref());
            p.spec = s.clone();
            Ok(format!("especialización {old} → {}", spec_name(s.as_deref())))
        }
        Edit::LegendLvl(n) => {
            let cap = d().legend.max;
            if !(0..=cap).contains(n) { return Err(format!("El nivel de Leyenda va de 0 a {cap}.")); }
            let spent: i64 = p.legend.values().sum();
            if spent > *n { return Err(format!("Tiene {spent} rangos repartidos: bajá las pasivas antes.")); }
            let old = std::mem::replace(&mut p.legend_lvl, *n);
            let next = legend_to_next(*n);
            p.legend_xp = if next == 0 { 0 } else { p.legend_xp.clamp(0, next - 1) };
            Ok(format!("Leyenda {old} → {n}"))
        }
        Edit::LegendXp(x) => {
            let need = legend_to_next(p.legend_lvl);
            if need == 0 { return Err("La Leyenda está completa.".into()); }
            if !(0..need).contains(x) { return Err(format!("La XP de Leyenda va de 0 a {}.", need - 1)); }
            let old = std::mem::replace(&mut p.legend_xp, *x);
            Ok(format!("XP de Leyenda {old} → {x}"))
        }
        Edit::LegendRank(id, r) => {
            let Some(def) = d().legend.passives.iter().find(|x| &x.id == id) else { return Err("No existe esa pasiva.".into()) };
            if !(0..=def.max).contains(r) { return Err(format!("{} va de 0 a {}.", def.name, def.max)); }
            let old = p.legend.get(id).copied().unwrap_or(0);
            let others: i64 = p.legend.iter().filter(|(k, _)| *k != id).map(|(_, v)| v).sum();
            if others + r > p.legend_lvl { return Err(format!("No alcanzan los niveles de Leyenda: tiene {} y harían falta {}.", p.legend_lvl, others + r)); }
            if *r == 0 { p.legend.remove(id); } else { p.legend.insert(id.clone(), *r); }
            Ok(format!("{} {old} → {r}", def.name))
        }
        Edit::Adena(v) => {
            if *v > 2_000_000_000 { return Err("Demasiada adena.".into()); }
            let r = counter("adena", p.adena, *v)?;
            p.adena = *v;
            Ok(r)
        }
        Edit::Karma(v) => { let r = counter("karma", p.karma, *v)?; p.karma = *v; Ok(r) }
        Edit::Pk(v) => { let r = counter("PK", p.pk, *v)?; p.pk = *v; Ok(r) }
        Edit::Pvp(v) => { let r = counter("PvP", p.pvp, *v)?; p.pvp = *v; Ok(r) }
        Edit::ItemAdd { item, count, enchant, mw } => {
            let Some(def) = d().item(item) else { return Err("No existe ese ítem.".into()) };
            if item == "adena" { return Err("La adena se cambia en su campo.".into()); }
            let stack = def.stack.unwrap_or(false);
            let gear = def.slot.is_some();
            if stack && !(1..=999).contains(count) { return Err("Se pueden dar de 1 a 999.".into()); }
            if !stack && !(1..=10).contains(count) { return Err("Se pueden dar de 1 a 10 piezas.".into()); }
            if (*enchant != 0 || *mw) && !gear { return Err("Solo el equipo se encanta o es obra maestra.".into()); }
            if !(0..=d().enchant.max).contains(enchant) { return Err(format!("El encantamiento va de 0 a {}.", d().enchant.max)); }
            let have = p.inv.iter().any(|i| stack && i.i == *item && i.s.is_none());
            let slots = if stack { if have { 0 } else { 1 } } else { *count as usize };
            if p.inv.len() + slots > crate::inventory::INV_MAX { return Err("Inventario lleno.".into()); }
            if stack && have {
                p.inv.iter_mut().find(|i| i.i == *item && i.s.is_none()).unwrap().c += count;
            } else {
                for _ in 0..(if stack { 1 } else { *count }) {
                    let u = p.next_uid;
                    p.next_uid += 1;
                    p.inv.push(InvItem { u, i: item.clone(), c: if stack { *count } else { 1 }, s: None, e: *enchant, l: false, m: *mw });
                }
            }
            let shown = InvItem { u: 0, i: item.clone(), c: *count, s: None, e: *enchant, l: false, m: *mw };
            Ok(format!("le dio {}", piece(&shown)))
        }
        Edit::ItemSet { u, count, enchant, mw } => {
            let Some(it) = p.inv.iter_mut().find(|i| i.u == *u) else { return Err("Ese ítem ya no está.".into()) };
            let def = d().item(&it.i).ok_or_else(|| "Ítem desconocido.".to_string())?;
            let (stack, gear) = (def.stack.unwrap_or(false), def.slot.is_some());
            if let Some(c) = count {
                if !stack && *c != 1 { return Err("El equipo va de a una pieza.".into()); }
                if !(1..=99_999).contains(c) { return Err("La cantidad va de 1 a 99.999.".into()); }
            }
            if (enchant.is_some_and(|x| x != 0) || mw == &Some(true)) && !gear { return Err("Solo el equipo se encanta o es obra maestra.".into()); }
            if enchant.is_some_and(|x| !(0..=d().enchant.max).contains(&x)) { return Err(format!("El encantamiento va de 0 a {}.", d().enchant.max)); }
            let before = piece(it);
            if let Some(c) = count { it.c = *c; }
            if let Some(x) = enchant { it.e = *x; }
            if let Some(m) = mw { it.m = *m; }
            Ok(format!("{before} → {}", piece(it)))
        }
        Edit::ItemRemove(u) => {
            let Some(i) = p.inv.iter().position(|i| i.u == *u) else { return Err("Ese ítem ya no está.".into()) };
            let it = p.inv.remove(i);
            Ok(format!("le quitó {}{}", piece(&it), if it.s.is_some() { " (puesto)" } else { "" }))
        }
        Edit::Quest { id, progress, done } => {
            let Some(q) = d().quest(id) else { return Err("No existe esa misión.".into()) };
            if *progress < 0 { return Err("El progreso no puede ser negativo.".into()); }
            // a "bring me" quest counts the bag (quests.rs quest_progress): its own progress stays 0
            let collect = matches!(q.objective, crate::data::Objective::Collect { .. });
            let progress = if collect { 0 } else { *progress };
            match p.quests.iter_mut().find(|q| &q.0 == id) {
                Some(q) => (q.1, q.2) = (progress, *done),
                None => p.quests.push((id.clone(), progress, *done)),
            }
            let state = if *done { "hecha" } else { "en curso" };
            Ok(if collect { format!("misión {}: {state}", quest_name(id)) } else { format!("misión {}: progreso {progress}, {state}", quest_name(id)) })
        }
        Edit::QuestRemove(id) => {
            let n = p.quests.len();
            p.quests.retain(|q| &q.0 != id);
            if p.quests.len() == n { return Err("No tiene esa misión.".into()); }
            Ok(format!("le quitó la misión {}", quest_name(id)))
        }
        _ => Err("Ese cambio no es de progreso.".into()),
    }
}

/** Who a sheet is about. */
pub struct Who { pub char_id: i64, pub name: String, pub race: String, pub cls: String, pub spec: Option<String> }

/** The week's, the Olympiad's and the clan's changes, in the database (and the clans' registry) wherever the character
 * is (a contract handed in today also leaves the live Player: World::gm_edit). */
fn side_edit(db: &Db, who: &Who, e: &Edit, now: f64) -> Result<String, String> {
    match e {
        Edit::JewelRoll(boss) => {
            let Some(m) = d().mobs.get(boss).filter(|m| m.jewel.is_some()) else { return Err("Ese jefe no tiene joya.".into()) };
            if !db.clear_jewel_roll(who.char_id, boss, loot_week(now)) { return Err("No había usado esa tirada esta semana.".into()); }
            Ok(format!("le devolvió la tirada de la joya de {}", m.name))
        }
        Edit::RiftRun => {
            if !db.clear_rift_run(who.char_id, loot_day(now)) { return Err("Hoy no hizo la corrida con premio.".into()); }
            Ok("le devolvió la corrida con premio de la Grieta de hoy".into())
        }
        Edit::Daily(id) => {
            if !db.clear_daily(who.char_id, id, loot_day(now)) { return Err("Hoy no entregó ese contrato.".into()); }
            Ok(format!("le devolvió el contrato {} de hoy", quest_name(id)))
        }
        Edit::Oly { points, wins, losses, draws } => {
            if [points, wins, losses, draws].iter().any(|v| **v < 0) { return Err("Los números de la Olimpiada no pueden ser negativos.".into()); }
            let line = crate::olympiad::own_line(who.spec.as_deref(), &who.cls);
            db.oly_set(loot_month(now), who.char_id, &line, &who.name, (*points, *wins, *losses, *draws));
            Ok(format!("Olimpiada: {points} puntos, {wins} G {losses} P {draws} E"))
        }
        Edit::ClanLevel(l) => crate::clans::gm_set_clan(db, who.char_id, Some(*l), None),
        Edit::ClanRep(r) => crate::clans::gm_set_clan(db, who.char_id, None, Some(*r)),
        _ => Err("Ese cambio es de progreso.".into()),
    }
}

/** A "bring me" quest's progress: what the bag holds of its item (quests.rs quest_progress); None for the others. */
fn quest_count(p: &Prog, id: &str) -> Option<i64> {
    match &d().quest(id)?.objective {
        crate::data::Objective::Collect { item, .. } => Some(p.inv.iter().filter(|i| i.i == *item && i.s.is_none()).map(|i| i.c).sum()),
        _ => None,
    }
}

/** A character's sheet for the GM: who, its progress, its week and day, its Olympiad month, clan, Hero, history. */
pub fn sheet(db: &Db, who: &Who, world: Option<u32>, p: &Prog, now: f64) -> Value {
    let max = d().c.max_level;
    let (day, month) = (loot_day(now), loot_month(now));
    json!({
        "id": who.char_id, "name": who.name, "online": world.is_some(), "world": world, "race": who.race, "cls": p.cls, "spec": p.spec,
        "level": p.level, "xp": p.xp, "xpNeed": if p.level >= max { 0 } else { xp_to_next(p.level) },
        "legendLvl": p.legend_lvl, "legendXp": p.legend_xp, "legendNeed": legend_to_next(p.legend_lvl), "legend": p.legend,
        "adena": p.adena, "karma": p.karma, "pk": p.pk, "pvp": p.pvp, "inv": p.inv,
        "quests": p.quests.iter().map(|q| json!({ "id": q.0, "progress": quest_count(p, &q.0).unwrap_or(q.1), "done": q.2 })).collect::<Vec<_>>(),
        "jewels": db.jewel_rolls(who.char_id, loot_week(now)), "riftPaid": db.rift_paid(who.char_id, day), "daily": db.daily_done(who.char_id, day),
        "oly": db.oly_get(month, who.char_id).map(|(points, wins, losses, draws)| json!({ "points": points, "wins": wins, "losses": losses, "draws": draws })),
        "clan": crate::clans::clan_of_char(who.char_id).map(|(id, name, level, rep)| json!({ "id": id, "name": name, "level": level, "rep": rep })),
        "hero": db.is_hero(who.char_id, month),
        "log": db.gm_log_recent(who.char_id, 20).into_iter().map(|(at, gm, what)| json!({ "at": at, "gm": gm, "what": what })).collect::<Vec<_>>(),
    })
}

/** The answer to the GM: the sheet (None: no such character), and what the change did or why it didn't. */
pub fn reply(out: &Outbox, sheet: Option<Value>, res: Option<Result<String, String>>) {
    let mut v = json!({ "t": "adminChar", "sheet": sheet });
    match res {
        Some(Ok(msg)) => v["msg"] = json!(msg),
        Some(Err(err)) => v["err"] = json!(err),
        None => {}
    }
    out.value(&v);
}

/** A change that went through: in the history, and in the log. */
fn record(db: &Db, gm: &(i64, String), who: &Who, what: &str) {
    db.gm_log(gm.0, &gm.1, who.char_id, &who.name, what);
    log!("[admin] {} → {}: {what}", gm.1, who.name);
}

/** An offline character as the database has it: who, and its progress. */
fn offline(db: &Db, char_id: i64) -> Option<(Who, Prog, crate::db::CharRow)> {
    let account = db.char_account(char_id)?;
    let (row, items, quests) = db.load_char(account, char_id)?;
    let inv: Vec<InvItem> = items.into_iter().enumerate().map(|(n, (i, c, s, e, l, m))| InvItem { u: n as u32 + 1, i, c, s, e, l, m }).collect();
    let prog = Prog {
        cls: row.cls.clone(), level: row.level, xp: row.xp, spec: row.spec.clone(), legend_lvl: row.legend_lvl, legend_xp: row.legend_xp,
        legend: serde_json::from_str(&row.legend).unwrap_or_default(), adena: row.adena, karma: row.karma, pk: row.pk, pvp: row.pvp,
        next_uid: inv.len() as u32 + 1, inv, quests,
    };
    let who = Who { char_id, name: row.name.clone(), race: row.race.clone(), cls: row.cls.clone(), spec: row.spec.clone() };
    Some((who, prog, row))
}

/** An offline character's sheet. */
pub fn offline_sheet(db: &Db, char_id: i64) -> Option<Value> {
    let (who, prog, _) = offline(db, char_id)?;
    Some(sheet(db, &who, None, &prog, now_ms()))
}

/** A change to an offline character, written to the database; the fresh sheet, and how it went. */
pub fn offline_edit(db: &mut Db, char_id: i64, e: &Edit, gm: &(i64, String)) -> (Option<Value>, Result<String, String>) {
    let now = now_ms();
    let Some((who, mut prog, row)) = offline(db, char_id) else { return (None, Err("No existe ese personaje.".into())) };
    let res = if e.progress() {
        let (spec0, legend0) = (prog.spec.clone(), prog.legend.clone());
        apply(&mut prog, e).and_then(|what| {
            let save = CharSave {
                id: char_id, level: prog.level, xp: prog.xp, legend_lvl: prog.legend_lvl, legend_xp: prog.legend_xp, x: row.x, z: row.z, hp: row.hp, mp: row.mp, cp: row.cp,
                adena: prog.adena, karma: prog.karma, pk: prog.pk, pvp: prog.pvp, inv: prog.inv.clone(), quests: prog.quests.clone(),
            };
            db.save_char(&save).map_err(|e| format!("No se pudo guardar: {e}"))?;
            if prog.spec != spec0 { let _ = db.set_spec_opt(char_id, prog.spec.as_deref()); }
            if prog.legend != legend0 { let _ = db.set_legend(char_id, &serde_json::to_string(&prog.legend).unwrap_or_default()); }
            Ok(what)
        })
    } else {
        side_edit(db, &who, e, now)
    };
    if let Ok(what) = &res { record(db, gm, &who, what); }
    let who = Who { spec: prog.spec.clone(), ..who };
    (Some(sheet(db, &who, None, &prog, now)), res)
}

impl World {
    fn gm_pid(&self, char_id: i64) -> Option<u32> { self.players.iter().copied().find(|&id| self.pl(id).is_some_and(|p| p.char_id == char_id)) }

    fn gm_who(&self, pid: u32) -> Who {
        let p = self.pl(pid).unwrap();
        Who { char_id: p.char_id, name: p.name.clone(), race: p.race.clone(), cls: p.cls.clone(), spec: p.spec.clone() }
    }

    /** The GM asks for a character in this world, or (offline) for one in none. */
    pub fn gm_get(&mut self, char_id: i64, wid: u32, offline: bool, out: &Outbox) {
        let Some(pid) = self.gm_pid(char_id) else {
            if !offline { return reply(out, None, Some(Err("Cambió de mundo: probá de nuevo.".into()))) }
            return match offline_sheet(&self.db, char_id) {
                Some(sheet) => reply(out, Some(sheet), None),
                None => reply(out, None, Some(Err("No existe ese personaje.".into()))),
            };
        };
        let prog = Prog::of_player(self.pl(pid).unwrap());
        reply(out, Some(sheet(&self.db, &self.gm_who(pid), Some(wid), &prog, self.now)), None);
    }

    /** The GM changes a character in this world: on the live Player (stats, inventory and quests sent again, the looks
     * refreshed for everyone around), saved at once. Offline (in no world), in the database. */
    pub fn gm_edit(&mut self, char_id: i64, wid: u32, e: Edit, gm: (i64, String), offline: bool, out: &Outbox) {
        let Some(pid) = self.gm_pid(char_id) else {
            if !offline { return reply(out, None, Some(Err("Cambió de mundo: probá de nuevo.".into()))) }
            let (sheet, res) = offline_edit(&mut self.db, char_id, &e, &gm);
            return reply(out, sheet, Some(res));
        };
        let now = self.now;
        let who = self.gm_who(pid);
        let res = if e.progress() {
            let mut prog = Prog::of_player(self.pl(pid).unwrap());
            let (spec0, legend0) = (prog.spec.clone(), prog.legend.clone());
            apply(&mut prog, &e).map(|what| {
                let (spec, legend) = (prog.spec.clone(), prog.legend.clone());
                let ent = self.ents.get_mut(&pid).unwrap();
                ent.c.av += 1;
                let p = ent.player_mut().unwrap();
                prog.into_player(p);
                p.recalc();
                (p.hp, p.mp, p.cp) = (p.hp.min(p.stats.max_hp), p.mp.min(p.stats.max_mp), p.cp.min(p.stats.max_cp));
                p.inv_dirty = true;
                crate::quests::send_quests(p);
                let at = self.exit_point(pid);
                self.save_player(pid, at);
                if spec != spec0 { let _ = self.db.set_spec_opt(char_id, spec.as_deref()); }
                if legend != legend0 { let _ = self.db.set_legend(char_id, &serde_json::to_string(&legend).unwrap_or_default()); }
                what
            })
        } else {
            let r = side_edit(&self.db, &who, &e, now);
            // a contract handed in today, to take again: out of what the live character remembers too
            if let (Ok(_), Edit::Daily(id)) = (&r, &e) {
                let p = self.pl_mut(pid).unwrap();
                p.daily_done.remove(id);
                crate::quests::send_quests(p);
            }
            r
        };
        if let Ok(what) = &res {
            record(&self.db, &gm, &who, what);
            self.sys(pid, "Un GM modificó tu personaje.", "A GM changed your character.");
        }
        let prog = Prog::of_player(self.pl(pid).unwrap());
        reply(out, Some(sheet(&self.db, &self.gm_who(pid), Some(wid), &prog, now)), Some(res));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn knight() -> Prog {
        Prog {
            cls: "fighter".into(), level: 40, xp: 10, spec: Some("knight".into()), legend_lvl: 0, legend_xp: 0, legend: HashMap::new(),
            adena: 100, karma: 0, pk: 0, pvp: 0, inv: vec![InvItem { u: 1, i: "healing_potion".into(), c: 5, s: None, e: 0, l: false, m: false }], next_uid: 2, quests: vec![],
        }
    }

    /// The level and XP stay in range, and the XP fits the level; the cap sends XP to the Legend.
    #[test]
    fn level_and_xp() {
        let mut p = knight();
        assert!(apply(&mut p, &Edit::Level(99)).is_err() && apply(&mut p, &Edit::Level(0)).is_err());
        p.xp = 1_000_000_000;
        apply(&mut p, &Edit::Level(50)).unwrap();
        assert!(p.xp < xp_to_next(50), "the XP fits the new level");
        apply(&mut p, &Edit::Level(d().c.max_level)).unwrap();
        assert_eq!(p.xp, 0);
        assert!(apply(&mut p, &Edit::Xp(5)).is_err(), "no XP at the cap");
        assert!(apply(&mut p, &Edit::Adena(-1)).is_err() && apply(&mut p, &Edit::Karma(-5)).is_err());
    }

    /// A specialization of its own class only; the Legend's ranks never more than its levels.
    #[test]
    fn spec_and_legend() {
        let mut p = knight();
        assert!(apply(&mut p, &Edit::Spec(Some("sorcerer".into()))).is_err(), "a mystic's");
        apply(&mut p, &Edit::Spec(Some("phoenix_knight".into()))).unwrap();
        apply(&mut p, &Edit::Spec(None)).unwrap();
        assert_eq!(p.spec, None);
        let id = d().legend.passives[0].id.clone();
        assert!(apply(&mut p, &Edit::LegendRank(id.clone(), 1)).is_err(), "no Legend level for it");
        apply(&mut p, &Edit::LegendLvl(2)).unwrap();
        apply(&mut p, &Edit::LegendRank(id.clone(), 2)).unwrap();
        assert!(apply(&mut p, &Edit::LegendRank(d().legend.passives[1].id.clone(), 1)).is_err(), "3 ranks on 2 levels");
        assert!(apply(&mut p, &Edit::LegendLvl(1)).is_err(), "below the ranks spent");
        assert!(apply(&mut p, &Edit::LegendRank(id, 99)).is_err());
    }

    /// Items: only existing ones; enchant and Masterwork on gear only; stacks join; a worn piece can go.
    #[test]
    fn items() {
        let mut p = knight();
        assert!(apply(&mut p, &Edit::ItemAdd { item: "nope".into(), count: 1, enchant: 0, mw: false }).is_err());
        assert!(apply(&mut p, &Edit::ItemAdd { item: "healing_potion".into(), count: 1, enchant: 3, mw: false }).is_err(), "a potion +3");
        apply(&mut p, &Edit::ItemAdd { item: "healing_potion".into(), count: 10, enchant: 0, mw: false }).unwrap();
        assert_eq!((p.inv.len(), p.inv[0].c), (1, 15), "the stack grew");
        assert!(apply(&mut p, &Edit::ItemAdd { item: "broadsword".into(), count: 1, enchant: 17, mw: false }).is_err());
        apply(&mut p, &Edit::ItemAdd { item: "broadsword".into(), count: 2, enchant: 12, mw: true }).unwrap();
        assert_eq!(p.inv.iter().filter(|i| i.i == "broadsword" && i.e == 12 && i.m).count(), 2);
        let u = p.inv.iter().find(|i| i.i == "broadsword").unwrap().u;
        assert!(apply(&mut p, &Edit::ItemSet { u, count: Some(3), enchant: None, mw: None }).is_err(), "gear is one piece");
        apply(&mut p, &Edit::ItemSet { u, count: None, enchant: Some(7), mw: Some(false) }).unwrap();
        p.inv.iter_mut().find(|i| i.u == u).unwrap().s = Some("weapon".into());
        assert!(apply(&mut p, &Edit::ItemRemove(u)).unwrap().contains("puesto"));
        assert!(apply(&mut p, &Edit::ItemRemove(u)).is_err(), "gone");
    }

    /// Quests: only existing ones, set or taken away.
    #[test]
    fn quests() {
        let mut p = knight();
        assert!(apply(&mut p, &Edit::Quest { id: "nope".into(), progress: 0, done: true }).is_err());
        let id = d().quests[0].id.clone();
        apply(&mut p, &Edit::Quest { id: id.clone(), progress: 3, done: true }).unwrap();
        assert_eq!(p.quests, vec![(id.clone(), 3, true)]);
        apply(&mut p, &Edit::QuestRemove(id.clone())).unwrap();
        assert!(apply(&mut p, &Edit::QuestRemove(id)).is_err());
        // a "bring me" quest counts the bag: its own progress stays 0
        apply(&mut p, &Edit::Quest { id: "wolf_pelts".into(), progress: 3, done: false }).unwrap();
        assert_eq!(p.quests, vec![("wolf_pelts".into(), 0, false)]);
        assert_eq!(Edit::parse(&json!({ "k": "itemAdd", "item": "broadsword", "enchant": 12, "mw": true })),
            Some(Edit::ItemAdd { item: "broadsword".into(), count: 1, enchant: 12, mw: true }));
        assert_eq!(Edit::parse(&json!({ "k": "spec", "v": null })), Some(Edit::Spec(None)));
    }
}
