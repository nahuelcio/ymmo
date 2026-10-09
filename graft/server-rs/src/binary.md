# server-rs/src/binary.rs

- q_pos · function · L3-L3 — pub fn q_pos(v: f64) -> f64 { crate::formulas::jround(v * 50.0) / 50.0 }
- q_rot · function · L4-L4 — pub fn q_rot(v: f64) -> f64 { crate::formulas::jround(v.sin().atan2(v.cos()) * 10000.0) / 10000.0 }
- wire_time · function · L5-L5 — pub fn wire_time(ms: f64) -> u32 { (ms as u64 % 0x1_0000_0000) as u32 }
- encode_snap · function · L7-L23 — pub fn encode_snap(upd: &[[f64; 6]], gone: &[u32], time: f64) -> Vec<u8>
- encode_event · function · L30-L56 — pub fn encode_event(v: &serde_json::Value) -> Option<Vec<u8>>
