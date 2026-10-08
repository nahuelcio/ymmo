//! World geometry the server needs: town, zones, playable bounds.
use crate::data::d;

pub fn in_town(x: f64, z: f64) -> bool {
    d().towns.iter().any(|t| (x - t.x).hypot(z - t.z) < t.r + 5.0)
}

/** zoneAt(): Spanish zone name at (x,z) */
pub fn zone_at(x: f64, z: f64) -> String {
    let data = d();
    if let Some(t) = data.towns.iter().find(|t| (x - t.x).hypot(z - t.z) < t.r + 10.0) { return t.name.clone(); }
    for zn in &data.zones {
        if (x - zn.x).hypot(z - zn.z) < zn.r { return zn.name.clone(); }
    }
    data.wild.name.clone()
}

/** Small deterministic PRNG (same as shared/src/terrain.ts mulberry32). */
pub struct Mulberry32(u32);
impl Mulberry32 {
    pub fn new(seed: u32) -> Self { Mulberry32(seed) }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}
