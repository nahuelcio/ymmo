//! Parties (port of server/src/systems/party.ts).
use crate::formulas::MAX_PARTY;
use crate::world::{Party, World};
use serde_json::{json, Value};

impl World {
    pub fn party_invite(&mut self, pid: u32, name: &str) {
        let name = name.trim();
        let Some(tid) = self.find_player(name) else { return self.sys(pid, &format!("{name} no está conectado."), &format!("{name} is not online.")) };
        if tid == pid { return self.sys(pid, "No te podés invitar a vos mismo.", "You cannot invite yourself."); }
        let (t_name, t_party, t_pending) = { let t = self.pl(tid).unwrap(); (t.name.clone(), t.party, t.pending_invite) };
        if t_party.is_some() { return self.sys(pid, &format!("{t_name} ya está en una party."), &format!("{t_name} is already in a party.")); }
        if let Some(ptid) = self.pl(pid).unwrap().party {
            let pt = self.parties.iter().find(|p| p.id == ptid).unwrap();
            if pt.members[0] != pid { return self.sys(pid, "Solo el líder de la party puede invitar.", "Only the party leader can invite."); }
            if pt.members.len() >= MAX_PARTY { return self.sys(pid, "Tu party está llena.", "Your party is full."); }
        }
        if t_pending.map_or(false, |(_, until)| until > self.now) {
            return self.sys(pid, &format!("{t_name} está respondiendo otra invitación."), &format!("{t_name} is busy answering another invitation."));
        }
        let now = self.now;
        let from = self.pl(pid).unwrap().name.clone();
        let t = self.pl_mut(tid).unwrap();
        t.pending_invite = Some((pid, now + 30000.0));
        t.send(json!({ "t": "partyInvite", "from": from }));
        self.sys(pid, &format!("Invitaste a {t_name} a tu party."), &format!("You invited {t_name} to your party."));
    }

    pub fn party_respond(&mut self, pid: u32, accept: bool) {
        let now = self.now;
        let p = self.pl_mut(pid).unwrap();
        let inv = p.pending_invite.take();
        let name = p.name.clone();
        let Some((from, until)) = inv else { return };
        if until < now || self.pl(from).is_none() { return; }
        if !accept { return self.sys(from, &format!("{name} rechazó tu invitación."), &format!("{name} declined your invitation.")); }
        if self.pl(pid).unwrap().party.is_some() { return; }
        let ptid = match self.pl(from).unwrap().party {
            Some(id) => id,
            None => {
                let id = self.next_party;
                self.next_party += 1;
                self.parties.push(Party { id, members: vec![from] });
                self.pl_mut(from).unwrap().party = Some(id);
                id
            }
        };
        let pt = self.parties.iter_mut().find(|p| p.id == ptid).unwrap();
        if pt.members.len() >= MAX_PARTY { return self.sys(pid, "La party está llena.", "The party is full."); }
        pt.members.push(pid);
        let members = pt.members.clone();
        self.pl_mut(pid).unwrap().party = Some(ptid);
        for m in members { self.sys(m, &format!("{name} se unió a la party."), &format!("{name} has joined the party.")); }
        self.send_party(ptid);
    }

    pub fn party_leave(&mut self, pid: u32, disconnect: bool) {
        let Some(ptid) = self.pl(pid).and_then(|p| p.party) else { return };
        let name = self.pl(pid).unwrap().name.clone();
        let pt = self.parties.iter_mut().find(|p| p.id == ptid).unwrap();
        pt.members.retain(|&m| m != pid);
        let rest = pt.members.clone();
        self.pl_mut(pid).unwrap().party = None;
        if !disconnect {
            self.send(pid, json!({ "t": "party", "members": null }));
            self.sys(pid, "Saliste de la party.", "You have left the party.");
        }
        for &m in &rest { self.sys(m, &format!("{name} dejó la party."), &format!("{name} has left the party.")); }
        if rest.len() < 2 {
            for &m in &rest {
                if let Some(p) = self.pl_mut(m) { p.party = None; }
                self.send(m, json!({ "t": "party", "members": null }));
                self.sys(m, "La party se disolvió.", "The party has been dissolved.");
            }
            self.parties.retain(|p| p.id != ptid);
        } else {
            self.send_party(ptid);
        }
    }

    pub fn send_party(&self, ptid: u32) {
        let Some(pt) = self.parties.iter().find(|p| p.id == ptid) else { return };
        let members: Vec<Value> = pt.members.iter().enumerate().filter_map(|(i, id)| {
            let m = self.pl(*id)?;
            Some(json!({ "id": id, "name": m.name, "lvl": m.level, "cls": m.cls, "leader": i == 0,
                "hp": m.hp.ceil(), "maxHp": m.stats.max_hp, "mp": m.mp.floor(), "maxMp": m.stats.max_mp, "cp": m.cp.floor(), "maxCp": m.stats.max_cp }))
        }).collect();
        let msg = json!({ "t": "party", "members": members }).to_string();
        for id in &pt.members { if let Some(p) = self.pl(*id) { p.out.text(msg.clone()); } }
    }

    pub fn send_party_updates(&self) {
        for pt in &self.parties { self.send_party(pt.id); }
    }

    /** Put p in the group's party (raid instances re-form the party of whoever came in together). */
    pub fn join_group(&mut self, pid: u32) {
        let ptid = match self.parties.first() {
            Some(p) => p.id,
            None => {
                let id = self.next_party;
                self.next_party += 1;
                self.parties.push(Party { id, members: vec![] });
                id
            }
        };
        let pt = self.parties.iter_mut().find(|p| p.id == ptid).unwrap();
        if pt.members.len() >= MAX_PARTY { return; }
        pt.members.push(pid);
        self.pl_mut(pid).unwrap().party = Some(ptid);
        self.send_party(ptid);
    }
}
