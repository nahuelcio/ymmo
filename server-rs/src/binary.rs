//! Compact snapshot frame (same layout as shared/src/binary.ts):
//!   u8 type=1, u16 n, u16 gone, u32 server time, n × (u32 id, i16 x·50, i16 z·50, i16 ry·10000, u8 hp, u16 flags), gone × u32
pub fn q_pos(v: f64) -> f64 { crate::formulas::jround(v * 50.0) / 50.0 }
pub fn q_rot(v: f64) -> f64 { crate::formulas::jround(v.sin().atan2(v.cos()) * 10000.0) / 10000.0 }
pub fn wire_time(ms: f64) -> u32 { (ms as u64 % 0x1_0000_0000) as u32 }

pub fn encode_snap(upd: &[[f64; 6]], gone: &[u32], time: f64) -> Vec<u8> {
    let mut b = Vec::with_capacity(9 + upd.len() * 13 + gone.len() * 4);
    b.push(1u8);
    b.extend_from_slice(&(upd.len() as u16).to_le_bytes());
    b.extend_from_slice(&(gone.len() as u16).to_le_bytes());
    b.extend_from_slice(&wire_time(time).to_le_bytes());
    for u in upd {
        b.extend_from_slice(&(u[0] as u32).to_le_bytes());
        b.extend_from_slice(&(crate::formulas::jround(u[1] * 50.0) as i16).to_le_bytes());
        b.extend_from_slice(&(crate::formulas::jround(u[2] * 50.0) as i16).to_le_bytes());
        b.extend_from_slice(&(crate::formulas::jround(u[3] * 10000.0) as i16).to_le_bytes());
        b.push(u[4].clamp(0.0, 255.0) as u8);
        b.extend_from_slice(&((u[5] as u32 & 0xffff) as u16).to_le_bytes());
    }
    for id in gone { b.extend_from_slice(&id.to_le_bytes()); }
    b
}
