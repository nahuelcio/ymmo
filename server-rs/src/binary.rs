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

/** Combat events, the other hot path (same layouts as shared/src/binary.ts):
 *    atk: u8 2, u32 s, u32 tg
 *    dmg: u8 3, u32 s, u32 tg, f64 v, u8 flags (1 crit, 2 miss, 4 heal, 8 dot)
 *    fx:  u8 4, u32 s, u32 tg, u8 len, skill (utf-8)
 *  Anything else (or an unexpected shape) stays JSON: returns None. */
pub fn encode_event(v: &serde_json::Value) -> Option<Vec<u8>> {
    let t = v.get("t")?.as_str()?;
    let id = |k: &str| v.get(k).and_then(|x| x.as_u64()).filter(|n| *n <= u32::MAX as u64).map(|n| n as u32);
    let flag = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    let obj = v.as_object()?;
    let kind = match t {
        "atk" if obj.len() == 3 => 2u8,
        "dmg" if obj.keys().all(|k| matches!(k.as_str(), "t" | "s" | "tg" | "v" | "crit" | "miss" | "heal" | "dot")) => 3,
        "fx" if obj.len() == 4 => 4,
        _ => return None,
    };
    let (s, tg) = (id("s")?, id("tg")?);
    let mut b = Vec::with_capacity(24);
    b.push(kind);
    b.extend_from_slice(&s.to_le_bytes());
    b.extend_from_slice(&tg.to_le_bytes());
    if kind == 3 {
        b.extend_from_slice(&v.get("v")?.as_f64()?.to_le_bytes());
        b.push(flag("crit") as u8 | (flag("miss") as u8) << 1 | (flag("heal") as u8) << 2 | (flag("dot") as u8) << 3);
    } else if kind == 4 {
        let sk = v.get("skill")?.as_str()?.as_bytes();
        if sk.len() > 255 { return None; }
        b.push(sk.len() as u8);
        b.extend_from_slice(sk);
    }
    Some(b)
}
