# server-rs/src/msgs.rs

- num · function · L8-L8 — fn num(m: &Value, k: &str) -> f64 { m.get(k).and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(f64::NAN) }
- id · function · L9-L9 — fn id(m: &Value, k: &str) -> Option<u32> { let v = num(m, k); if v.is_finite() && v >= 0.0 { Some(v as u32) } else { None } }
- truthy · function · L10-L12 — fn truthy(m: &Value, k: &str) -> bool
- s · function · L13-L15 — fn s(m: &Value, k: &str) -> String
- handle · function · L18-L26 — pub fn handle(&mut self, pid: u32, m: &Value)
- handle_msg · function · L28-L167 — fn handle_msg(&mut self, pid: u32, t: &str, m: &Value, now: f64)
