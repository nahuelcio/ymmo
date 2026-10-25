# server-rs/src/terrain.rs

- in_town · function · L4-L6 — pub fn in_town(x: f64, z: f64) -> bool
- zone_at · function · L9-L16 — pub fn zone_at(x: f64, z: f64) -> String
- in_pvp_zone · function · L19-L21 — pub fn in_pvp_zone(x: f64, z: f64) -> bool
- Mulberry32 · struct · L24-L24 — pub struct Mulberry32(u32);
- new · function · L26-L26 — pub fn new(seed: u32) -> Self { Mulberry32(seed) }
- next · function · L27-L33 — pub fn next(&mut self) -> f64
