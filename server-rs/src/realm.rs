//! Loading/saving characters into a world, staggered autosave, and moving between worlds
//! (port of server/src/realm.ts plus the raid enter/exit logic of index.ts and raid/worker.ts).
use crate::collision::P;
use crate::data::d;
use crate::ent::*;
use crate::formulas::{rnd, Stats};
use crate::quests::{prime_quest_notices, send_quests};
use crate::world::{HubEvent, Member, World};
use serde_json::json;
use std::collections::{HashMap, HashSet};

impl World {
    /** Load a character for a socket. kind: "enter" (from the character screen) or "world" (world switch). */
    pub fn join(&mut self, m: Member, kind: &str, at: Option<P>) -> Option<u32> {
        let (row, items, quests) = self.db.load_char(m.account_id, m.char_id)?;
        let id = self.new_id();
        let at = at.or_else(|| self.raid.map(|r| {
            let a = rnd() * std::f64::consts::TAU;
            P { x: r.entry.x + a.cos() * 3.0, z: r.entry.z + a.sin() * 3.0 }
        }));
        let (x, z) = at.map_or((row.x, row.z), |p| (p.x, p.z));
        let mut p = Player {
            sid: m.sid, out: m.out, lang: m.lang, stats: Stats::default(), buffs: vec![], target: None, intent: None, next_attack: 0.0, casting: None,
            cooldowns: HashMap::new(), pvp_until: 0.0, pvp_on: false, auto_loot: false, dodge_until: 0.0, rtt: 80.0,
            saved_at: crate::world::now_ms() - rnd() * 60000.0, look: row.look, last_combat: 0.0, escape_at: 0.0, party: None, pending_invite: None,
            talking_to: None, quests, quest_ready_told: HashSet::new(), known: HashMap::new(), known_av: HashMap::new(), last_me: String::new(),
            inv_dirty: true, next_uid: 1, inv: vec![], account_id: m.account_id, char_id: row.id, name: row.name, race: row.race, cls: row.cls, spec: row.spec,
            level: row.level.min(d().c.max_level), xp: row.xp, hp: row.hp, mp: row.mp, cp: row.cp, adena: row.adena, karma: row.karma, pk: row.pk, pvp: row.pvp,
        };
        for (i, c, s, e) in items {
            let u = p.next_uid;
            p.next_uid += 1;
            p.inv.push(InvItem { u, i, c, s, e });
        }
        prime_quest_notices(&mut p);
        p.recalc();
        let mut c = Common::new(id, x, z);
        if let Some(r) = self.raid { c.ry = (r.x - x).atan2(r.z - z); }
        self.add(Ent { c, k: Kind::Player(Box::new(p)) });
        self.sessions.insert(m.sid, id);
        let p = self.pl(id).unwrap();
        p.send(json!({ "t": kind, "self": self.self_state(id), "inv": p.inv }));
        send_quests(p);
        Some(id)
    }

    pub fn save_player(&mut self, pid: u32, at: Option<P>) {
        let (x, z) = { let c = &self.ents[&pid].c; at.map_or((c.x, c.z), |p| (p.x, p.z)) };
        let p = self.ents[&pid].player().unwrap();
        let r = {
            let (id, level, xp, hp, mp, cp, adena, karma, pk, pvp) = (p.char_id, p.level, p.xp, p.hp.max(1.0), p.mp, p.cp, p.adena, p.karma, p.pk, p.pvp);
            let inv = p.inv.clone();
            let quests = p.quests.clone();
            self.db.save_char(id, level, xp, x, z, hp, mp, cp, adena, karma, pk, pvp, &inv, &quests)
        };
        if let Err(e) = r { eprintln!("[world] save failed: {e}"); }
    }

    /** Socket gone (or moving worlds): save and drop the character. Returns who it was. */
    pub fn take_out(&mut self, pid: u32, at: Option<P>) -> Option<Member> {
        if !self.ents.contains_key(&pid) { return None; }
        if self.ents[&pid].c.dead {
            let pt = if self.raid.is_some() { at.unwrap_or_else(|| self.town_point(None)) } else { self.town_point(Some(pid)) };
            self.ents.get_mut(&pid).unwrap().c.dead = false;
            let p = self.pl_mut(pid).unwrap();
            p.hp = p.stats.max_hp * 0.7;
            self.save_player(pid, Some(pt));
        } else {
            self.save_player(pid, at);
        }
        self.party_leave(pid, true);
        let Ent { k: Kind::Player(p), .. } = self.remove(pid)? else { return None };
        self.sessions.remove(&p.sid);
        Some(Member { sid: p.sid, account_id: p.account_id, char_id: p.char_id, lang: p.lang, out: p.out })
    }

    /** Where a character leaving a raid is saved: the village, never the arena's coordinates. */
    fn exit_point(&self) -> Option<P> { if self.raid.is_some() { Some(self.town_point(None)) } else { None } }

    pub fn quit(&mut self, sid: u64) {
        let Some(&pid) = self.sessions.get(&sid) else { return };
        let at = self.exit_point();
        if self.take_out(pid, at).is_some() { self.events.push(HubEvent::Closed); }
    }

    /** Raid world: leave for the overworld village. */
    pub fn exit_to_town(&mut self, pid: u32) {
        if self.raid.is_none() { return; }
        let at = self.exit_point();
        if let Some(member) = self.take_out(pid, at) { self.events.push(HubEvent::ToMain { member }); }
    }

    /** /raid: in a raid it leaves; in the overworld it takes the caller (and the whole party) into a new instance. */
    /// `/raid` leaves the instance you are in, or enters one: Kaim's by default, `/raid <id>` for another.
    pub fn raid_command(&mut self, pid: u32, which: &str) {
        if self.raid.is_some() { return self.exit_to_town(pid); }
        let Some(raid) = d().raids.get(if which.is_empty() { "kaim" } else { which }) else {
            let ids = d().raids.keys().cloned().collect::<Vec<_>>().join(", ");
            return self.sys(pid, &format!("No existe esa raid. Raids: {ids}."), &format!("No such raid. Raids: {ids}."));
        };
        if self.ents[&pid].c.dead { return; }
        if let Some(q) = raid.quest.as_deref().and_then(|q| d().quest(q)) {
            if !self.pl(pid).unwrap().quest(&q.id).map_or(false, |st| st.2) {
                return self.sys(pid, &format!("Primero tenés que completar la misión «{}».", q.name), &format!("You must first complete the quest \"{}\".", q.name_en));
            }
        }
        let party = self.pl(pid).unwrap().party;
        let group: Vec<u32> = match party {
            Some(ptid) => {
                let pt = self.parties.iter().find(|p| p.id == ptid).unwrap();
                if pt.members[0] != pid { return self.sys(pid, "Solo el líder de la party puede entrar a la raid.", "Only the party leader can start the raid."); }
                pt.members.clone()
            }
            None => vec![pid],
        };
        if group.len() > raid.max_players {
            return self.sys(pid, &format!("La raid admite hasta {} jugadores.", raid.max_players), &format!("The raid allows up to {} players.", raid.max_players));
        }
        let low: Vec<String> = group.iter().filter_map(|id| self.pl(*id)).filter(|p| p.level < raid.min_level).map(|p| p.name.clone()).collect();
        if !low.is_empty() {
            let l = low.join(", ");
            return self.sys(pid, &format!("Nivel mínimo {}: {l}.", raid.min_level), &format!("Minimum level {}: {l}.", raid.min_level));
        }
        // the party moves as a whole: it is re-formed inside the instance
        if let Some(ptid) = party {
            self.parties.retain(|p| p.id != ptid);
            for id in &group { if let Some(p) = self.pl_mut(*id) { p.party = None; } }
        }
        let leader = self.pl(pid).unwrap().name.clone();
        let mut members = vec![];
        for id in group {
            if id != pid { self.sys(id, &format!("{leader} los lleva a {}...", raid.name), &format!("{leader} is taking the party to {}...", raid.name_en)); }
            if let Some(m) = self.take_out(id, None) { members.push(m); }
        }
        self.events.push(HubEvent::EnterRaid { raid, members });
    }

    /** Staggered autosave: a few players per call instead of everyone at once every minute. */
    pub fn autosave(&mut self, now: f64) {
        let mut n = 0;
        let at = self.exit_point();
        for pid in self.players.clone() {
            let due = self.pl(pid).map_or(false, |p| now - p.saved_at >= 60000.0);
            if !due { continue; }
            self.pl_mut(pid).unwrap().saved_at = now;
            self.save_player(pid, at);
            n += 1;
            if n >= 3 { break; }
        }
    }
}
