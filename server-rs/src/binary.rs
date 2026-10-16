//! Compact snapshot frame (same layout as shared/src/binary.ts):
//!   u8 type=SNAP, u16 n, u16 gone, u32 server time, n × (u32 id, i32 x·50, i32 z·50, i16 ry·10000, u8 hp, u16 flags), gone × u32
//! A frame's first byte says what it is, so the codes never repeat: the snapshot SNAP, the combat events EV_ATK, EV_DMG,
//! EV_FX (encode_event). The snapshot once took 2, the attack's code, and the client read every attack as a broken snapshot.
pub const SNAP: u8 = 6;
pub const EV_ATK: u8 = 2;
pub const EV_DMG: u8 = 3;
pub const EV_FX: u8 = 4;
pub fn q_pos(v: f64) -> f64 { crate::formulas::jround(v * 50.0) / 50.0 }
pub fn q_rot(v: f64) -> f64 { crate::formulas::jround(v.sin().atan2(v.cos()) * 10000.0) / 10000.0 }
pub fn wire_time(ms: f64) -> u32 { (ms as u64 % 0x1_0000_0000) as u32 }

pub fn encode_snap(upd: &[[f64; 6]], gone: &[u32], time: f64) -> Vec<u8> {
    let mut b = Vec::with_capacity(9 + upd.len() * 17 + gone.len() * 4);
    b.push(SNAP);
    b.extend_from_slice(&(upd.len() as u16).to_le_bytes());
    b.extend_from_slice(&(gone.len() as u16).to_le_bytes());
    b.extend_from_slice(&wire_time(time).to_le_bytes());
    for u in upd {
        b.extend_from_slice(&(u[0] as u32).to_le_bytes());
        b.extend_from_slice(&(crate::formulas::jround(u[1] * 50.0) as i32).to_le_bytes());
        b.extend_from_slice(&(crate::formulas::jround(u[2] * 50.0) as i32).to_le_bytes());
        b.extend_from_slice(&(crate::formulas::jround(u[3] * 10000.0) as i16).to_le_bytes());
        b.push(u[4].clamp(0.0, 255.0) as u8);
        b.extend_from_slice(&((u[5] as u32 & 0xffff) as u16).to_le_bytes());
    }
    for id in gone { b.extend_from_slice(&id.to_le_bytes()); }
    b
}

/** Frequent client messages (same layouts as shared/src/binary.ts encodeC2S), turned back into the JSON they stand for:
 *    move: u8 16, f64 x, f64 z · attack: u8 17, u32 id, u8 force · dash: u8 18, f64 x, z, dx, dz · pong: u8 19, f64 s · stop: u8 20 */
pub fn decode_c2s(b: &[u8]) -> Option<serde_json::Value> {
    use serde_json::json;
    let f = |o: usize| Some(f64::from_le_bytes(b.get(o..o + 8)?.try_into().ok()?));
    match *b.first()? {
        16 => Some(json!({ "t": "move", "x": f(1)?, "z": f(9)? })),
        17 => Some(json!({ "t": "attack", "id": u32::from_le_bytes(b.get(1..5)?.try_into().ok()?), "force": *b.get(5)? != 0 })),
        18 => Some(json!({ "t": "dash", "x": f(1)?, "z": f(9)?, "dx": f(17)?, "dz": f(25)? })),
        19 => Some(json!({ "t": "pong", "s": f(1)? })),
        20 => Some(json!({ "t": "stop" })),
        _ => None,
    }
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
        "atk" if obj.len() == 3 => EV_ATK,
        "dmg" if obj.keys().all(|k| matches!(k.as_str(), "t" | "s" | "tg" | "v" | "crit" | "miss" | "heal" | "dot")) => EV_DMG,
        "fx" if obj.len() == 4 => EV_FX,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frame_kinds_never_collide() {
        // the client tells a frame by its first byte (client/src/net.ts): a snapshot must never look like an event
        let snap = encode_snap(&[[1.0, 2.0, 3.0, 0.5, 100.0, 0.0]], &[7], 1000.0);
        let events = [json!({ "t": "atk", "s": 1, "tg": 2 }), json!({ "t": "dmg", "s": 1, "tg": 2, "v": 10.0 }), json!({ "t": "fx", "s": 1, "tg": 2, "skill": "slash" })];
        let kinds: Vec<u8> = events.iter().map(|e| encode_event(e).unwrap()[0]).collect();
        assert_eq!(kinds, vec![EV_ATK, EV_DMG, EV_FX]);
        assert!(!kinds.contains(&snap[0]), "the snapshot's type byte {} is an event's", snap[0]);
    }
}
