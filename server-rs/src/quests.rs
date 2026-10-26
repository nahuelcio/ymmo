//! Quests (port of server/src/systems/quests.ts), and the daily contracts: Brasaoscura's board offers daily_set's three
//! a day (data.rs), each done once a day (the daily_done table), paid in Contract Marks too.
use crate::data::{d, Objective, QuestDef};
use crate::ent::*;
use crate::formulas::{loot_day, next_day_at};
use crate::i18n::{fmt_int, npc_greeting, npc_title, Lang};
use crate::inventory::{count_item, take_items};
use crate::world::{now_ms, World};
use serde_json::{json, Value};

const NPC_RANGE: f64 = 8.0;

fn npc_name(id: &str) -> String { d().npc(id).map(|n| n.name.clone()).unwrap_or_else(|| "quien te dio la misión".into()) }

pub fn quest_progress(p: &Player, q: &QuestDef) -> i64 {
    let Some(st) = p.quest(&q.id) else { return 0 };
    match &q.objective { Objective::Collect { item, .. } => count_item(p, item), _ => st.1 }
}

pub fn prime_quest_notices(p: &mut Player) {
    for q in &d().quests {
        let ready = matches!(p.quest(&q.id), Some(st) if !st.2) && quest_progress(p, q) >= q.objective.count();
        if ready { p.quest_ready_told.insert(q.id.clone()); }
    }
}

/** A character coming in: yesterday's contracts in progress lapsed (only today's carry on), and today's done ones. */
pub fn load_dailies(p: &mut Player, done_today: Vec<String>) {
    let today: Vec<String> = d().daily_set(loot_day(now_ms())).iter().map(|q| q.id.clone()).collect();
    p.quests.retain(|st| !d().quest(&st.0).map_or(false, |q| q.daily) || today.contains(&st.0));
    p.daily_done = done_today.into_iter().collect();
}

pub fn send_quests(p: &Player) {
    let now = now_ms();
    let mut list: Vec<Value> = vec![];
    let mut done: Vec<String> = vec![];
    for q in &d().quests {
        let Some(st) = p.quest(&q.id) else { continue };
        if st.2 { done.push(q.id.clone()); continue; }
        list.push(json!({ "id": q.id, "progress": quest_progress(p, q) }));
    }
    let daily: Vec<&str> = d().daily_set(loot_day(now)).iter().map(|q| q.id.as_str()).collect();
    p.send(json!({ "t": "quests", "list": list, "done": done, "daily": daily, "dailyDone": p.daily_done, "resetAt": next_day_at(now) }));
}

fn status_of(p: &Player, q: &QuestDef) -> &'static str {
    match p.quest(&q.id) {
        Some(st) if st.2 => "done",
        _ if q.daily && p.daily_done.contains(&q.id) => "done",
        _ if p.level < q.min_level => "locked",
        None => "available",
        Some(_) => if quest_progress(p, q) >= q.objective.count() { "ready" } else { "active" },
    }
}

fn qname(q: &QuestDef, l: Lang) -> &str { if l.en() { &q.name_en } else { &q.name } }

impl World {
    fn quest_npc(&self, pid: u32, nid: u32) -> Option<&'static crate::data::NpcDef> {
        let pc = &self.ents[&pid].c;
        match self.ents.get(&nid) {
            Some(Ent { c, k: Kind::Npc(n) }) if (n.def.kind == "quest" || n.def.kind == "board") && (c.x - pc.x).hypot(c.z - pc.z) <= NPC_RANGE => Some(n.def),
            _ => {
                self.sys(pid, "Estás demasiado lejos.", "You are too far away.");
                None
            }
        }
    }

    /** What this giver offers: its story quest, or (the board) today's contract by its id. */
    fn quest_of(&self, n: &crate::data::NpcDef, qid: Option<&str>) -> Option<&'static QuestDef> {
        if n.kind != "board" { return d().quest_by_npc(&n.id); }
        let qid = qid?;
        d().daily_set(loot_day(self.now)).into_iter().find(|q| q.id == qid && q.npc == n.id)
    }

    pub fn open_quest(&mut self, pid: u32, nid: u32) {
        let Some(Kind::Npc(n)) = self.ents.get(&nid).map(|e| &e.k) else { return };
        let def = n.def;
        if def.kind == "board" { return self.open_board(pid, nid); }
        let Some(q) = d().quest_by_npc(&def.id) else { return };
        let p = self.pl_mut(pid).unwrap();
        p.talking_to = Some(nid);
        let l = p.lang;
        p.send(json!({ "t": "npc", "npc": nid, "kind": "quest", "name": def.name, "title": npc_title(&def.id, l), "greeting": npc_greeting(&def.id, l),
            "quest": { "id": q.id, "status": status_of(p, q), "progress": quest_progress(p, q) } }));
    }

    /** The contracts' board: today's three, each with where this player stands on it, and when they change. */
    fn open_board(&mut self, pid: u32, nid: u32) {
        let Some(Kind::Npc(n)) = self.ents.get(&nid).map(|e| &e.k) else { return };
        let def = n.def;
        let now = self.now;
        let today = d().daily_set(loot_day(now));
        let p = self.pl_mut(pid).unwrap();
        p.talking_to = Some(nid);
        let l = p.lang;
        let quests: Vec<Value> = today.iter().map(|q| json!({ "id": q.id, "status": status_of(p, q), "progress": quest_progress(p, q) })).collect();
        p.send(json!({ "t": "npc", "npc": nid, "kind": "board", "name": def.name, "title": npc_title(&def.id, l), "greeting": npc_greeting(&def.id, l),
            "quests": quests, "resetAt": next_day_at(now) }));
    }

    /** qid: the contract, at the board (a story giver has its one). */
    pub fn accept_quest(&mut self, pid: u32, nid: u32, qid: Option<&str>) {
        let Some(n) = self.quest_npc(pid, nid) else { return };
        if self.ents[&pid].c.dead { return; }
        let Some(q) = self.quest_of(n, qid) else { return self.sys(pid, "Ese contrato no está disponible hoy.", "That contract is not on offer today.") };
        let p = self.pl_mut(pid).unwrap();
        match p.quest(&q.id) {
            Some(st) if st.2 => return self.sys(pid, "Ya completaste esta misión.", "You have already completed this task."),
            Some(_) => return self.sys(pid, "Ya estás haciendo esta misión.", "You are already on this task."),
            None if q.daily && p.daily_done.contains(&q.id) => return self.sys(pid, "Ya cumpliste este contrato hoy. Mañana habrá otros.", "You have already fulfilled this contract today. There will be others tomorrow."),
            None => {}
        }
        if p.level < q.min_level { return self.sys(pid, &format!("Necesitás ser nivel {}.", q.min_level), &format!("You need to be level {}.", q.min_level)); }
        if q.evolve && p.spec.as_deref().and_then(|s| d().evolution_of(s)).is_none() {
            return self.sys(pid, "Primero necesitás una especialización que pueda despertar.", "You first need a specialization that can awaken.");
        }
        p.quests.push((q.id.clone(), 0, false));
        self.sys(pid, &format!("Aceptaste \"{}\".", q.name), &format!("You have accepted \"{}\".", q.name_en));
        send_quests(self.pl(pid).unwrap());
        self.open_quest(pid, nid);
    }

    /** Returns the xp reward (given by the caller). qid: the contract, at the board. */
    pub fn turn_in_quest(&mut self, pid: u32, nid: u32, qid: Option<&str>) -> i64 {
        let Some(n) = self.quest_npc(pid, nid) else { return 0 };
        if self.ents[&pid].c.dead { return 0; }
        let Some(q) = self.quest_of(n, qid) else { return 0 };
        let p = self.pl_mut(pid).unwrap();
        if !matches!(p.quest(&q.id), Some(st) if !st.2) {
            self.sys(pid, "No tenés nada para entregar.", "You have nothing to turn in.");
            return 0;
        }
        if quest_progress(p, q) < q.objective.count() {
            self.sys(pid, "Todavía no terminaste esta misión.", "You have not finished this task yet.");
            return 0;
        }
        if let Objective::Collect { item, count } = &q.objective {
            if !take_items(p, item, *count) {
                let def = d().item(item).unwrap();
                self.sys(pid, &format!("No tenés suficiente {}.", def.name), &format!("You do not have enough {}.", def.name_en));
                return 0;
            }
        }
        if q.daily {
            // once a day, written right away: tomorrow it can be taken again
            let (cid, day) = (p.char_id, loot_day(self.now));
            if !self.db.mark_daily_done(cid, &q.id, day) {
                self.sys(pid, "Ya cumpliste este contrato hoy.", "You have already fulfilled this contract today.");
                return 0;
            }
            let p = self.pl_mut(pid).unwrap();
            p.quests.retain(|st| st.0 != q.id);
            p.daily_done.insert(q.id.clone());
        } else {
            p.quest_mut(&q.id).unwrap().2 = true;
        }
        let p = self.pl_mut(pid).unwrap();
        p.quest_ready_told.remove(&q.id);
        p.adena += q.adena;
        p.inv_dirty = true;
        let now = self.now;
        let (mut extra_es, mut extra_en) = (String::new(), String::new());
        for (item, count) in &q.rewards {
            self.give_or_ground(pid, item, *count, now);
            if let Some(def) = d().item(item) {
                extra_es.push_str(&format!(" y {count} × {}", def.name));
                extra_en.push_str(&format!(" and {count} × {}", def.name_en));
            }
        }
        self.sys(pid, &format!("Completaste \"{}\" y recibiste {} de adena{extra_es}.", q.name, fmt_int(q.adena, Lang::Es)), &format!("You have completed \"{}\" and received {} adena{extra_en}.", q.name_en, fmt_int(q.adena, Lang::En)));
        send_quests(self.pl(pid).unwrap());
        if q.evolve { self.evolve(pid); }
        self.open_quest(pid, nid);
        q.xp
    }

    /** The third specialization: the character's spec becomes its evolution, which keeps every skill it had. */
    fn evolve(&mut self, pid: u32) {
        let data = d();
        let p = self.pl(pid).unwrap();
        let Some(evo) = p.spec.as_deref().and_then(|s| data.evolution_of(s)) else { return };
        if let Err(e) = self.db.set_spec(p.char_id, &evo.id) {
            elog!("[world] set_spec failed: {e}");
            return self.sys(pid, "No se pudo guardar. Probá de nuevo.", "Could not save. Try again.");
        }
        let (lvl, race, g, cls, name) = (p.level, p.race.clone(), p.look.gender(), p.cls.clone(), p.name.clone());
        self.pl_mut(pid).unwrap().spec = Some(evo.id.clone());
        self.ents.get_mut(&pid).unwrap().c.av += 1;
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "levelUp", "id": pid, "lvl": lvl, "spec": evo.id }));
        self.sys(pid, &format!("¡Despertaste! Ahora sos {}.", evo.name), &format!("You have awakened! You are now a {}.", evo.name_en));
        for sk in data.skills_for(&cls, Some(&evo.id), lvl, &race, g) {
            if sk.spec.as_deref() == Some(evo.id.as_str()) { self.sys(pid, &format!("Aprendiste {}.", sk.name), &format!("You have learned {}.", sk.name_en)); }
        }
        log!("[world] {name} awakened as {}", evo.id);
    }

    /** One step on every quest of these players' that `hits` says this deed counts for. */
    fn credit(&mut self, players: &[u32], hits: impl Fn(&Objective) -> bool) {
        for &pid in players {
            let Some(p) = self.pl_mut(pid) else { continue };
            let l = p.lang;
            let mut changed = false;
            let mut msgs: Vec<String> = vec![];
            for q in &d().quests {
                if !hits(&q.objective) { continue; }
                let count = q.objective.count();
                let Some(st) = p.quest_mut(&q.id) else { continue };
                if st.2 || st.1 >= count { continue; }
                st.1 += 1;
                let prog = st.1;
                changed = true;
                if prog >= count {
                    p.quest_ready_told.insert(q.id.clone());
                    let nn = npc_name(&q.npc);
                    msgs.push(if l.en() { format!("{} is complete. Return to {nn}.", q.name_en) } else { format!("{}: listo. Volvé con {nn}.", q.name) });
                } else {
                    msgs.push(format!("{}: {prog}/{count}.", qname(q, l)));
                }
            }
            for m in msgs { self.sys(pid, &m, &m); }
            if changed { send_quests(self.pl(pid).unwrap()); }
        }
    }

    pub fn credit_kill(&mut self, mob: &str, players: &[u32]) {
        self.credit(players, |o| match o {
            Objective::Kill { mob: m, .. } => m == mob,
            Objective::KillAny { mobs, .. } => mobs.iter().any(|m| m == mob),
            _ => false,
        });
    }

    /** A hostile camp cleared, for those it gave a chest (world.rs update_camps). */
    pub fn credit_camp(&mut self, camp: &str, players: &[u32]) {
        self.credit(players, |o| matches!(o, Objective::Camp { camp: c, .. } if c == camp));
    }

    /** A Rift floor cleared, for everyone on it (rift.rs). */
    pub fn credit_rift(&mut self, players: &[u32], floor: i64) {
        self.credit(players, |o| matches!(o, Objective::Rift { floor: f, .. } if floor >= *f));
    }

    /** A new server day (world.rs tick): the contracts in progress lapse, today's are new to everyone. */
    pub fn daily_reset(&mut self) {
        for pid in self.players.clone() {
            let Some(p) = self.pl_mut(pid) else { continue };
            let had = p.quests.len();
            p.quests.retain(|st| !d().quest(&st.0).map_or(false, |q| q.daily));
            p.quest_ready_told.retain(|id| !d().quest(id).map_or(false, |q| q.daily));
            p.daily_done.clear();
            let (lvl, lapsed) = (p.level, had != p.quests.len());
            send_quests(self.pl(pid).unwrap());
            if lvl >= d().quests.iter().filter(|q| q.daily).map(|q| q.min_level).min().unwrap_or(i64::MAX) {
                self.sys(pid, if lapsed { "Los contratos de ayer vencieron: el Intendente de Brasaoscura tiene los de hoy." } else { "El Intendente de Brasaoscura tiene los contratos de hoy." },
                    if lapsed { "Yesterday's contracts have lapsed: the Intendant in Emberdark has today's." } else { "The Intendant in Emberdark has today's contracts." });
            }
        }
    }

    pub fn on_inventory_changed(&mut self, pid: u32) {
        let p = self.pl_mut(pid).unwrap();
        let l = p.lang;
        let mut active = false;
        let mut msgs: Vec<String> = vec![];
        for q in &d().quests {
            let Objective::Collect { item, count } = &q.objective else { continue };
            if !matches!(p.quest(&q.id), Some(st) if !st.2) { continue; }
            active = true;
            let ready = count_item(p, item) >= *count;
            if ready && !p.quest_ready_told.contains(&q.id) {
                p.quest_ready_told.insert(q.id.clone());
                let nn = npc_name(&q.npc);
                msgs.push(if l.en() { format!("{} is complete. Return to {nn}.", q.name_en) } else { format!("{}: listo. Volvé con {nn}.", q.name) });
            } else if !ready {
                p.quest_ready_told.remove(&q.id);
            }
        }
        for m in msgs { self.sys(pid, &m, &m); }
        if active { send_quests(self.pl(pid).unwrap()); }
    }
}
