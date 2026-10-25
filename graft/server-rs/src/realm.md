# server-rs/src/realm.rs

- join · function · L15-L61 — pub fn join(&mut self, m: Member, kind: &str, at: Option<P>) -> Option<u32>
- char_save · function · L64-L72 — pub fn char_save(&self, pid: u32, at: Option<P>) -> CharSave
- save_player · function · L74-L77 — pub fn save_player(&mut self, pid: u32, at: Option<P>)
- take_out · function · L80-L101 — pub fn take_out(&mut self, pid: u32, at: Option<P>) -> Option<Member>
- exit_point · function · L104-L104 — fn exit_point(&self) -> Option<P> { if self.raid.is_some() { Some(self.town_point(None)) } else { None } }
- quit · function · L106-L110 — pub fn quit(&mut self, sid: u64)
- exit_to_town · function · L113-L117 — pub fn exit_to_town(&mut self, pid: u32)
- raid_command · function · L121-L162 — pub fn raid_command(&mut self, pid: u32, which: &str)
- autosave · function · L165-L176 — pub fn autosave(&mut self, now: f64)
