//! Quests (port of server/src/systems/quests.ts).
use crate::data::{d, Objective, QuestDef};
use crate::ent::*;
use crate::i18n::{fmt_int, npc_greeting, npc_title, Lang};
use crate::inventory::{count_item, take_items};
use crate::world::World;
use serde_json::{json, Value};

const NPC_RANGE: f64 = 8.0;

fn npc_name(id: &str) -> String { d().npc(id).map(|n| n.name.clone()).unwrap_or_else(|| "quien te dio la misión".into()) }

pub fn quest_progress(p: &Player, q: &QuestDef) -> i64 {
    let Some(st) = p.quest(&q.id) else { return 0 };
    match &q.objective { Objective::Kill { .. } => st.1, Objective::Collect { item, .. } => count_item(p, item) }
}

pub fn prime_quest_notices(p: &mut Player) {
    for q in &d().quests {
        let ready = matches!(p.quest(&q.id), Some(st) if !st.2) && quest_progress(p, q) >= q.objective.count();
        if ready { p.quest_ready_told.insert(q.id.clone()); }
    }
}

pub fn send_quests(p: &Player) {
    let mut list: Vec<Value> = vec![];
    let mut done: Vec<String> = vec![];
    for q in &d().quests {
        let Some(st) = p.quest(&q.id) else { continue };
        if st.2 { done.push(q.id.clone()); continue; }
        list.push(json!({ "id": q.id, "progress": quest_progress(p, q) }));
    }
    p.send(json!({ "t": "quests", "list": list, "done": done }));
}

fn status_of(p: &Player, q: &QuestDef) -> &'static str {
    match p.quest(&q.id) {
        Some(st) if st.2 => "done",
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
            Some(Ent { c, k: Kind::Npc(n) }) if n.def.kind == "quest" && (c.x - pc.x).hypot(c.z - pc.z) <= NPC_RANGE => Some(n.def),
            _ => {
                self.sys(pid, "Estás demasiado lejos.", "You are too far away.");
                None
            }
        }
    }

    pub fn open_quest(&mut self, pid: u32, nid: u32) {
        let Some(Kind::Npc(n)) = self.ents.get(&nid).map(|e| &e.k) else { return };
        let def = n.def;
        let Some(q) = d().quest_by_npc(&def.id) else { return };
        let p = self.pl_mut(pid).unwrap();
        p.talking_to = Some(nid);
        let l = p.lang;
        p.send(json!({ "t": "npc", "npc": nid, "kind": "quest", "name": def.name, "title": npc_title(&def.id, l), "greeting": npc_greeting(&def.id, l),
            "quest": { "id": q.id, "status": status_of(p, q), "progress": quest_progress(p, q) } }));
    }

    pub fn accept_quest(&mut self, pid: u32, nid: u32) {
        let Some(n) = self.quest_npc(pid, nid) else { return };
        if self.ents[&pid].c.dead { return; }
        let Some(q) = d().quest_by_npc(&n.id) else { return };
        let p = self.pl_mut(pid).unwrap();
        match p.quest(&q.id) {
            Some(st) if st.2 => return self.sys(pid, "Ya completaste esta misión.", "You have already completed this task."),
            Some(_) => return self.sys(pid, "Ya estás haciendo esta misión.", "You are already on this task."),
            None => {}
        }
        if p.level < q.min_level { return self.sys(pid, &format!("Necesitás ser nivel {}.", q.min_level), &format!("You need to be level {}.", q.min_level)); }
        p.quests.push((q.id.clone(), 0, false));
        self.sys(pid, &format!("Aceptaste \"{}\".", q.name), &format!("You have accepted \"{}\".", q.name_en));
        send_quests(self.pl(pid).unwrap());
        self.open_quest(pid, nid);
    }

    /** Returns the xp reward (given by the caller). */
    pub fn turn_in_quest(&mut self, pid: u32, nid: u32) -> i64 {
        let Some(n) = self.quest_npc(pid, nid) else { return 0 };
        if self.ents[&pid].c.dead { return 0; }
        let Some(q) = d().quest_by_npc(&n.id) else { return 0 };
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
        p.quest_mut(&q.id).unwrap().2 = true;
        p.quest_ready_told.remove(&q.id);
        p.adena += q.adena;
        p.inv_dirty = true;
        self.sys(pid, &format!("Completaste \"{}\" y recibiste {} de adena.", q.name, fmt_int(q.adena, Lang::Es)), &format!("You have completed \"{}\" and received {} adena.", q.name_en, fmt_int(q.adena, Lang::En)));
        send_quests(self.pl(pid).unwrap());
        self.open_quest(pid, nid);
        q.xp
    }

    pub fn credit_kill(&mut self, mob: &str, players: &[u32]) {
        for &pid in players {
            let Some(p) = self.pl_mut(pid) else { continue };
            let l = p.lang;
            let mut changed = false;
            let mut msgs: Vec<String> = vec![];
            for q in &d().quests {
                let Objective::Kill { mob: qm, count } = &q.objective else { continue };
                if qm != mob { continue; }
                let Some(st) = p.quest_mut(&q.id) else { continue };
                if st.2 || st.1 >= *count { continue; }
                st.1 += 1;
                let prog = st.1;
                changed = true;
                if prog >= *count {
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
