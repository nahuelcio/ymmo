# server-rs/src/ai.rs

- LEASH · constant · L9-L9 — const LEASH: f64 = 50.0;
- AGGRO_RANGE · constant · L10-L10 — const AGGRO_RANGE: f64 = 9.0;
- valid_enemy · function · L13-L19 — fn valid_enemy(&self, pid: u32, hx: f64, hz: f64) -> bool
- update_mob · function · L21-L155 — pub fn update_mob(&mut self, mid: u32, dt: f64, now: f64)
- resolve_special · function · L158-L181 — fn resolve_special(&mut self, mid: u32, now: f64)
- respawn_mob · function · L183-L204 — fn respawn_mob(&mut self, mid: u32)
- retarget · function · L207-L223 — fn retarget(&mut self, mid: u32, now: f64)
- check_phases · function · L226-L282 — fn check_phases(&mut self, mid: u32, now: f64)
- world_raid · function · L285-L313 — fn world_raid(&mut self, mid: u32, now: f64)
- yell_near · function · L316-L321 — fn yell_near(&self, x: f64, z: f64, es: &str, en: &str)
- barrage · function · L324-L346 — fn barrage(&mut self, mid: u32, b: &Barrage, now: f64)
- pulse · function · L349-L365 — fn pulse(&mut self, mid: u32, p: &Pulse, now: f64, name: &str, name_en: &str)
