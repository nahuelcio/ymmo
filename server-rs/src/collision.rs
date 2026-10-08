//! Static world collision + pathfinding (port of shared/src/collision.ts, same obstacles and grid).
use crate::data::{d, ObstacleDef};
use std::collections::HashMap;
use std::sync::OnceLock;

const CELL: f64 = 8.0;
const RES: f64 = 1.0;
const MAX_NODES: usize = 40000;
pub const DASH_DIST: f64 = 6.0;

#[derive(Clone, Copy, Debug)]
pub struct P { pub x: f64, pub z: f64 }

struct Geo {
    hash: HashMap<(i64, i64), Vec<usize>>,
    nav: Vec<u8>,
    n: i64,
    half: f64,
}

fn bound(o: &ObstacleDef) -> f64 {
    match *o { ObstacleDef::Circle { r, .. } => r, ObstacleDef::Box { hw, hd, .. } => hw.hypot(hd) }
}
fn pos(o: &ObstacleDef) -> (f64, f64) {
    match *o { ObstacleDef::Circle { x, z, .. } | ObstacleDef::Box { x, z, .. } => (x, z) }
}

static GEO: OnceLock<Geo> = OnceLock::new();

fn geo() -> &'static Geo {
    GEO.get_or_init(|| {
        let data = d();
        let obs = &data.obstacles;
        let mut hash: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, o) in obs.iter().enumerate() {
            let b = bound(o) + 1.0;
            let (x, z) = pos(o);
            for cx in ((x - b) / CELL).floor() as i64..=((x + b) / CELL).floor() as i64 {
                for cz in ((z - b) / CELL).floor() as i64..=((z + b) / CELL).floor() as i64 {
                    hash.entry((cx, cz)).or_default().push(i);
                }
            }
        }
        let half = data.c.playable_half;
        let n = ((half * 2.0) / RES).ceil() as i64 + 1;
        let mut nav = vec![0u8; (n * n) as usize];
        let r = data.c.walk_radius;
        let to_cell = |v: f64| (((v + half) / RES).round() as i64).clamp(0, n - 1);
        let to_world = |c: i64| c as f64 * RES - half;
        for o in obs {
            let b = bound(o) + r;
            let (ox, oz) = pos(o);
            for cx in to_cell(ox - b)..=to_cell(ox + b) {
                for cz in to_cell(oz - b)..=to_cell(oz + b) {
                    let (x, z) = (to_world(cx), to_world(cz));
                    let hit = match *o {
                        ObstacleDef::Circle { x: ox, z: oz, r: or } => (x - ox).hypot(z - oz) < or + r,
                        ObstacleDef::Box { x: ox, z: oz, hw, hd, cos, sin } => {
                            let (dx, dz) = (x - ox, z - oz);
                            let lx = (dx * cos - dz * sin).abs();
                            let lz = (dx * sin + dz * cos).abs();
                            lx < hw + r && lz < hd + r
                        }
                    };
                    if hit { nav[(cz * n + cx) as usize] = 1; }
                }
            }
        }
        Geo { hash, nav, n, half }
    })
}

/** Build the grid now (it takes a moment) instead of on the first move. */
pub fn warm() { let _ = geo(); }

pub fn push_out(mut x: f64, mut z: f64, r: f64) -> P {
    let g = geo();
    let obs = &d().obstacles;
    for _ in 0..3 {
        let mut moved = false;
        let Some(l) = g.hash.get(&((x / CELL).floor() as i64, (z / CELL).floor() as i64)) else { break };
        for &i in l {
            match obs[i] {
                ObstacleDef::Circle { x: ox, z: oz, r: or } => {
                    let (dx, dz, rr) = (x - ox, z - oz, or + r);
                    let d2 = dx * dx + dz * dz;
                    if d2 >= rr * rr { continue; }
                    let dd = { let s = d2.sqrt(); if s == 0.0 { 1e-4 } else { s } };
                    x = ox + (dx / dd) * rr;
                    z = oz + (dz / dd) * rr;
                    moved = true;
                }
                ObstacleDef::Box { x: ox, z: oz, hw, hd, cos, sin } => {
                    let (dx, dz) = (x - ox, z - oz);
                    let lx = dx * cos - dz * sin;
                    let lz = dx * sin + dz * cos;
                    let cx = lx.clamp(-hw, hw);
                    let cz = lz.clamp(-hd, hd);
                    let (ox2, oz2) = (lx - cx, lz - cz);
                    let d2 = ox2 * ox2 + oz2 * oz2;
                    let (nx, nz);
                    if d2 > 1e-8 {
                        if d2 >= r * r { continue; }
                        let dd = d2.sqrt();
                        nx = cx + (ox2 / dd) * r;
                        nz = cz + (oz2 / dd) * r;
                    } else {
                        let px = hw - lx.abs();
                        let pz = hd - lz.abs();
                        let sgn = |v: f64| if v == 0.0 { 1.0 } else { v.signum() };
                        if px < pz { nx = sgn(lx) * (hw + r); nz = lz; } else { nx = lx; nz = sgn(lz) * (hd + r); }
                    }
                    x = ox + nx * cos + nz * sin;
                    z = oz - nx * sin + nz * cos;
                    moved = true;
                }
            }
        }
        if !moved { break; }
    }
    P { x, z }
}

fn to_cell(v: f64) -> i64 {
    let g = geo();
    (((v + g.half) / RES).round() as i64).clamp(0, g.n - 1)
}
fn to_world(c: i64) -> f64 { c as f64 * RES - geo().half }

fn blocked(cx: i64, cz: i64) -> bool {
    let g = geo();
    cx < 0 || cz < 0 || cx >= g.n || cz >= g.n || g.nav[(cz * g.n + cx) as usize] == 1
}

pub fn line_clear(ax: f64, az: f64, bx: f64, bz: f64) -> bool {
    let dist = (bx - ax).hypot(bz - az);
    let steps = (dist / (RES * 0.5)).ceil() as i64;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        if blocked(to_cell(ax + (bx - ax) * t), to_cell(az + (bz - az) * t)) { return false; }
    }
    true
}

fn nearest_free(cx: i64, cz: i64) -> Option<(i64, i64)> {
    if !blocked(cx, cz) { return Some((cx, cz)); }
    for rad in 1..=12i64 {
        for dx in -rad..=rad {
            for dz in [-rad, rad] {
                if !blocked(cx + dx, cz + dz) { return Some((cx + dx, cz + dz)); }
                if !blocked(cx + dz, cz + dx) { return Some((cx + dz, cz + dx)); }
            }
        }
    }
    None
}

#[derive(PartialEq)]
struct Node(f32, u32);
impl Eq for Node {}
impl PartialOrd for Node { fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> { Some(self.cmp(o)) } }
impl Ord for Node {
    // min-heap on f
    fn cmp(&self, o: &Self) -> std::cmp::Ordering { o.0.partial_cmp(&self.0).unwrap_or(std::cmp::Ordering::Equal) }
}

struct Scratch { stamp: i32, g: Vec<f32>, came: Vec<u32>, seen: Vec<i32>, closed: Vec<i32> }

thread_local! {
    static SCRATCH: std::cell::RefCell<Option<Scratch>> = const { std::cell::RefCell::new(None) };
}

/** Waypoints from (sx,sz) to (tx,tz) around static obstacles (start excluded). */
pub fn find_path(sx: f64, sz: f64, tx: f64, tz: f64) -> Vec<P> {
    if line_clear(sx, sz, tx, tz) { return vec![P { x: tx, z: tz }]; }
    let (Some(s), Some(gc)) = (nearest_free(to_cell(sx), to_cell(sz)), nearest_free(to_cell(tx), to_cell(tz))) else {
        return vec![P { x: tx, z: tz }];
    };
    let goal_free = gc.0 == to_cell(tx) && gc.1 == to_cell(tz);
    let end = if goal_free { P { x: tx, z: tz } } else { P { x: to_world(gc.0), z: to_world(gc.1) } };
    if line_clear(sx, sz, end.x, end.z) { return vec![end]; }
    let n = geo().n;
    let start = (s.1 * n + s.0) as u32;
    let goal = (gc.1 * n + gc.0) as u32;
    let h = |c: u32| -> f32 {
        let dx = ((c as i64 % n) - gc.0).abs() as f32;
        let dz = ((c as i64 / n) - gc.1).abs() as f32;
        if dx > dz { dx + 0.4142 * dz } else { dz + 0.4142 * dx }
    };
    SCRATCH.with(|cell| {
        let mut opt = cell.borrow_mut();
        let sc = opt.get_or_insert_with(|| {
            let nn = (n * n) as usize;
            Scratch { stamp: 0, g: vec![0.0; nn], came: vec![0; nn], seen: vec![0; nn], closed: vec![0; nn] }
        });
        sc.stamp += 1;
        if sc.stamp == i32::MAX {
            sc.seen.fill(0);
            sc.closed.fill(0);
            sc.stamp = 1;
        }
        let stamp = sc.stamp;
        let mut heap = std::collections::BinaryHeap::new();
        sc.seen[start as usize] = stamp;
        sc.g[start as usize] = 0.0;
        heap.push(Node(h(start), start));
        let (mut found, mut best, mut best_h, mut expanded) = (false, start, h(start), 0usize);
        while let Some(Node(_, cur)) = heap.pop() {
            if expanded >= MAX_NODES { break; }
            if sc.closed[cur as usize] == stamp { continue; }
            if cur == goal { found = true; break; }
            sc.closed[cur as usize] = stamp;
            expanded += 1;
            let hc = h(cur);
            if hc < best_h { best_h = hc; best = cur; }
            let (cx, cz) = (cur as i64 % n, cur as i64 / n);
            let gcur = sc.g[cur as usize];
            for dx in -1..=1i64 {
                for dz in -1..=1i64 {
                    if dx == 0 && dz == 0 { continue; }
                    let (nx, nz) = (cx + dx, cz + dz);
                    if blocked(nx, nz) { continue; }
                    if dx != 0 && dz != 0 && (blocked(cx + dx, cz) || blocked(cx, cz + dz)) { continue; }
                    let nb = (nz * n + nx) as u32;
                    if sc.closed[nb as usize] == stamp { continue; }
                    let ng = gcur + if dx != 0 && dz != 0 { 1.4142 } else { 1.0 };
                    if sc.seen[nb as usize] != stamp || ng < sc.g[nb as usize] {
                        sc.seen[nb as usize] = stamp;
                        sc.g[nb as usize] = ng;
                        sc.came[nb as usize] = cur;
                        heap.push(Node(ng + h(nb), nb));
                    }
                }
            }
        }
        let mut c = if found { goal } else { best };
        let mut cells: Vec<P> = Vec::new();
        while c != start {
            cells.push(P { x: to_world(c as i64 % n), z: to_world(c as i64 / n) });
            if sc.seen[c as usize] != stamp { break; }
            c = sc.came[c as usize];
        }
        cells.reverse();
        if found { if let Some(last) = cells.last_mut() { *last = end; } }
        if cells.is_empty() { return vec![end]; }
        // string pulling
        let mut out: Vec<P> = Vec::new();
        let (mut ax, mut az, mut i) = (sx, sz, 0usize);
        while i < cells.len() {
            let mut j = i;
            while j + 1 < cells.len() && line_clear(ax, az, cells[j + 1].x, cells[j + 1].z) { j += 1; }
            out.push(cells[j]);
            ax = cells[j].x;
            az = cells[j].z;
            i = j + 1;
        }
        let mut k = out.len() as i64 - 2;
        let mut guard = 0;
        while k >= 0 && guard < 64 {
            let ku = k as usize;
            let (px, pz) = if ku > 0 { (out[ku - 1].x, out[ku - 1].z) } else { (sx, sz) };
            if line_clear(px, pz, out[ku + 1].x, out[ku + 1].z) { out.remove(ku); }
            k -= 1;
            guard += 1;
        }
        out
    })
}

/** End of a dodge roll: 0.5 m steps, stops at walls (same as the client's prediction). */
pub fn dash_end(mut x: f64, mut z: f64, dx: f64, dz: f64, r: f64) -> P {
    for _ in 0..(DASH_DIST * 2.0) as i32 {
        let np = push_out(x + dx * 0.5, z + dz * 0.5, r);
        if (np.x - x).hypot(np.z - z) < 0.15 { break; }
        x = np.x;
        z = np.z;
    }
    P { x, z }
}
