# server-rs/src/realm.rs

- join · function · L14-L45 — pub fn join(&mut self, m: Member, kind: &str, at: Option<P>) -> Option<u32>
- save_player · function · L47-L57 — pub fn save_player(&mut self, pid: u32, at: Option<P>)
- take_out · function · L60-L75 — pub fn take_out(&mut self, pid: u32, at: Option<P>) -> Option<Member>
- exit_point · function · L78-L78 — fn exit_point(&self) -> Option<P> { if self.raid.is_some() { Some(self.town_point(None)) } else { None } }
- quit · function · L80-L84 — pub fn quit(&mut self, sid: u64)
- exit_to_town · function · L87-L91 — pub fn exit_to_town(&mut self, pid: u32)
- raid_command · function · L95-L136 — pub fn raid_command(&mut self, pid: u32, which: &str)
- autosave · function · L139-L150 — pub fn autosave(&mut self, now: f64)
