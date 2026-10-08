//! Chat and slash commands (port of server/src/systems/chat.ts).
use crate::i18n::zone_name;
use crate::terrain::zone_at;
use crate::world::World;
use serde_json::json;

const LOCAL_RANGE: f64 = 100.0;

impl World {
    pub fn handle_chat(&mut self, pid: u32, raw: &str) {
        let text: String = raw.chars().filter(|c| (*c as u32) >= 0x20).collect::<String>().trim().chars().take(200).collect();
        if text.is_empty() { return; }
        let name = self.pl(pid).unwrap().name.clone();
        if let Some(cmdline) = text.strip_prefix('/') {
            let mut parts = cmdline.split(' ');
            let cmd = parts.next().unwrap_or("").to_lowercase();
            let arg = parts.collect::<Vec<_>>().join(" ").trim().to_string();
            match cmd.as_str() {
                "invite" => self.party_invite(pid, &arg),
                "leave" => self.party_leave(pid, false),
                "w" | "whisper" => {
                    let mut it = arg.splitn(2, ' ');
                    let to = it.next().unwrap_or("").to_string();
                    let msg = it.next().unwrap_or("").to_string();
                    self.whisper(pid, &to, &msg);
                }
                "who" => {
                    let names: Vec<String> = self.players.iter().filter_map(|id| self.pl(*id).map(|p| p.name.clone())).collect();
                    let n = names.len();
                    let list = names.join(", ");
                    self.sys(pid, &format!("Jugadores conectados ({n}): {list}"), &format!("Players online ({n}): {list}"));
                }
                "loc" => {
                    let c = &self.ents[&pid].c;
                    let (x, z) = (c.x.round(), c.z.round());
                    let zone = match self.raid { Some(r) => r.name.clone(), None => zone_at(c.x, c.z) };
                    self.sys(pid, &format!("Ubicación: {x}, {z} — {zone}"), &format!("Location: {x}, {z} — {}", zone_name(&zone, crate::i18n::Lang::En)));
                }
                "unstuck" => {
                    if self.ents[&pid].c.dead { return; }
                    let now = self.now;
                    self.pl_mut(pid).unwrap().escape_at = now + 10000.0;
                    self.sys(pid, "En 10 segundos volvés a la aldea...", "You will be returned to the village in 10 seconds...");
                }
                "raid" => self.raid_command(pid, &arg.to_lowercase()),
                "pvp" => {
                    let on = if arg.is_empty() { !self.pl(pid).unwrap().pvp_on } else { arg.to_lowercase() == "on" };
                    self.set_pvp_mode(pid, on);
                }
                "help" => self.sys(pid,
                    "Chat: !grito  #party  \"nombre susurro. Comandos: /invite nombre, /leave, /w nombre mensaje, /who, /loc, /unstuck, /pvp [on|off], /raid [nest] (entrar o salir de una raid con tu party: la de Kaim, o /raid nest para el Nido del Dragón)",
                    "Chat: !shout  #party  \"name whisper. Commands: /invite name, /leave, /w name msg, /who, /loc, /unstuck, /pvp [on|off], /raid [nest] (enter or leave a raid with your party: Kaim's, or /raid nest for the Dragon's Nest)"),
                _ => self.sys(pid, &format!("No existe el comando /{cmd}. Escribí /help."), &format!("Unknown command /{cmd}. Type /help.")),
            }
            return;
        }
        if let Some(msg) = text.strip_prefix('!') {
            let msg = msg.trim();
            if !msg.is_empty() { self.broadcast(json!({ "t": "chat", "ch": "shout", "from": name, "text": msg })); }
            return;
        }
        if let Some(msg) = text.strip_prefix('#') {
            let msg = msg.trim();
            let Some(ptid) = self.pl(pid).unwrap().party else { return self.sys(pid, "No estás en ninguna party.", "You are not in a party.") };
            if !msg.is_empty() {
                let members = self.parties.iter().find(|p| p.id == ptid).map(|p| p.members.clone()).unwrap_or_default();
                for m in members { self.send(m, json!({ "t": "chat", "ch": "party", "from": name, "text": msg })); }
            }
            return;
        }
        if let Some(rest) = text.strip_prefix('"') {
            let mut it = rest.splitn(2, ' ');
            let to = it.next().unwrap_or("").to_string();
            let msg = it.next().unwrap_or("").to_string();
            return self.whisper(pid, &to, &msg);
        }
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near_r(x, z, json!({ "t": "chat", "ch": "all", "from": name, "text": text }), LOCAL_RANGE);
    }

    fn whisper(&mut self, pid: u32, to: &str, msg: &str) {
        let msg = msg.trim();
        if to.is_empty() || msg.is_empty() { return self.sys(pid, "Uso: \"nombre mensaje", "Usage: \"name message"); }
        let Some(tid) = self.find_player(to) else { return self.sys(pid, &format!("{to} no está conectado."), &format!("{to} is not online.")) };
        let (from, tname) = (self.pl(pid).unwrap().name.clone(), self.pl(tid).unwrap().name.clone());
        self.send(tid, json!({ "t": "chat", "ch": "whisper", "from": from, "text": msg }));
        self.send(pid, json!({ "t": "chat", "ch": "whisper", "from": format!("->{tname}"), "text": msg }));
    }
}
