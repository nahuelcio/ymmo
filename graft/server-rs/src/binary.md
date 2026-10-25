# server-rs/src/binary.rs

- SNAP · constant · L5-L5 — pub const SNAP: u8 = 6;
- EV_ATK · constant · L6-L6 — pub const EV_ATK: u8 = 2;
- EV_DMG · constant · L7-L7 — pub const EV_DMG: u8 = 3;
- EV_FX · constant · L8-L8 — pub const EV_FX: u8 = 4;
- q_pos · function · L9-L9 — pub fn q_pos(v: f64) -> f64 { crate::formulas::jround(v * 50.0) / 50.0 }
- q_rot · function · L10-L10 — pub fn q_rot(v: f64) -> f64 { crate::formulas::jround(v.sin().atan2(v.cos()) * 10000.0) / 10000.0 }
- wire_time · function · L11-L11 — pub fn wire_time(ms: f64) -> u32 { (ms as u64 % 0x1_0000_0000) as u32 }
- encode_snap · function · L13-L29 — pub fn encode_snap(upd: &[[f64; 6]], gone: &[u32], time: f64) -> Vec<u8>
- decode_c2s · function · L34-L51 — pub fn decode_c2s(b: &[u8]) -> Option<serde_json::Value>
- encode_event · function · L58-L84 — pub fn encode_event(v: &serde_json::Value) -> Option<Vec<u8>>
- tests · module · L87-L107 — mod tests
- frame_kinds_never_collide · function · L92-L99 — fn frame_kinds_never_collide()
- a_blocked_hit_stays_binary · function · L102-L106 — fn a_blocked_hit_stays_binary()
