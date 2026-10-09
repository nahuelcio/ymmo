# server-rs/src/ai.rs

- LEASH · constant · L9-L9 — const LEASH: f64 = 50.0;
- AGGRO_RANGE · constant · L10-L10 — const AGGRO_RANGE: f64 = 9.0;
- valid_enemy · function · L13-L18 — fn valid_enemy(&self, pid: u32, hx: f64, hz: f64) -> bool
- update_mob · function · L20-L153 — pub fn update_mob(&mut self, mid: u32, dt: f64, now: f64)
- resolve_special · function · L156-L179 — fn resolve_special(&mut self, mid: u32, now: f64)
- respawn_mob · function · L181-L203 — fn respawn_mob(&mut self, mid: u32)
- retarget · function · L206-L222 — fn retarget(&mut self, mid: u32, now: f64)
- check_phases · function · L225-L273 — fn check_phases(&mut self, mid: u32, now: f64)
