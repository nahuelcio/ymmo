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

/** How far a circle at (x, z) of radius r sinks into an obstacle (> 0: they overlap). */
fn overlap(o: &ObstacleDef, x: f64, z: f64, r: f64) -> f64 {
    match *o {
        ObstacleDef::Circle { x: ox, z: oz, r: or } => or + r - (x - ox).hypot(z - oz),
        ObstacleDef::Box { x: ox, z: oz, hw, hd, cos, sin } => {
            let (dx, dz) = (x - ox, z - oz);
            let ex = (dx * cos - dz * sin).abs() - hw;
            let ez = (dx * sin + dz * cos).abs() - hd;
            r - if ex > 0.0 || ez > 0.0 { ex.max(0.0).hypot(ez.max(0.0)) } else { ex.max(ez) }
        }
    }
}

/** A walker fits at (x, z): its circle overlaps no obstacle, by their real shapes (same as the client's pointFree). */
pub fn point_free(x: f64, z: f64, r: f64) -> bool {
    let g = geo();
    if x.abs() > g.half || z.abs() > g.half { return false; }
    let obs = &d().obstacles;
    g.hash.get(&((x / CELL).floor() as i64, (z / CELL).floor() as i64)).map_or(true, |l| l.iter().all(|&i| overlap(&obs[i], x, z, r) <= 0.0))
}

fn seg_dist(px: f64, pz: f64, ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    let (ex, ez) = (bx - ax, bz - az);
    let l2 = ex * ex + ez * ez;
    let t = if l2 > 0.0 { (((px - ax) * ex + (pz - az) * ez) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (px - (ax + ex * t)).hypot(pz - (az + ez * t))
}
/** Distance from the segment a-b to the rectangle |x| <= hw, |z| <= hd (0 when they touch). */
fn seg_rect_dist(ax: f64, az: f64, bx: f64, bz: f64, hw: f64, hd: f64) -> f64 {
    let (ex, ez) = (bx - ax, bz - az);
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    let mut clip = |p: f64, q: f64| -> bool {
        if p == 0.0 { return q >= 0.0; }
        let t = q / p;
        if p < 0.0 { if t > t1 { return false; } if t > t0 { t0 = t; } } else { if t < t0 { return false; } if t < t1 { t1 = t; } }
        true
    };
    if clip(-ex, ax + hw) && clip(ex, hw - ax) && clip(-ez, az + hd) && clip(ez, hd - az) { return 0.0; }
    let to_rect = |x: f64, z: f64| (x.abs() - hw).max(0.0).hypot((z.abs() - hd).max(0.0));
    let mut dd = to_rect(ax, az).min(to_rect(bx, bz));
    for (cx, cz) in [(hw, hd), (-hw, hd), (hw, -hd), (-hw, -hd)] { dd = dd.min(seg_dist(cx, cz, ax, az, bx, bz)); }
    dd
}

/** The walk grid's cells along the line are all free: the quick test the mobs' every-tick steering uses (line_clear is
 * exact, and too dear to run for every mob on every tick). */
pub fn line_clear_grid(ax: f64, az: f64, bx: f64, bz: f64) -> bool {
    let dist = (bx - ax).hypot(bz - az);
    let steps = (dist / (RES * 0.5)).ceil() as i64;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        if blocked(to_cell(ax + (bx - ax) * t), to_cell(az + (bz - az) * t)) { return false; }
    }
    true
}

/**
 * True when a walker can go in a straight line from a to b: its circle swept along the segment touches no obstacle,
 * by their real shapes (same as the client's lineClear, a hair under the walk radius).
 */
pub fn line_clear(ax: f64, az: f64, bx: f64, bz: f64) -> bool {
    let g = geo();
    if bx.abs() > g.half || bz.abs() > g.half { return false; }
    let r = d().c.walk_radius - 0.02;
    let obs = &d().obstacles;
    let steps = (((bx - ax).hypot(bz - az)) / 0.5).ceil().max(1.0) as i64;
    let mut seen: Vec<usize> = Vec::new();
    let mut last: Option<(i64, i64)> = None;
    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let k = (((ax + (bx - ax) * t) / CELL).floor() as i64, ((az + (bz - az) * t) / CELL).floor() as i64);
        if last == Some(k) { continue; }
        last = Some(k);
        if let Some(l) = g.hash.get(&k) { seen.extend_from_slice(l); }
    }
    seen.sort_unstable();
    seen.dedup();
    for &i in &seen {
        let hit = match obs[i] {
            ObstacleDef::Circle { x, z, r: or } => seg_dist(x, z, ax, az, bx, bz) < or + r,
            ObstacleDef::Box { x, z, hw, hd, cos, sin } => {
                let tl = |px: f64, pz: f64| ((px - x) * cos - (pz - z) * sin, (px - x) * sin + (pz - z) * cos);
                let ((lax, laz), (lbx, lbz)) = (tl(ax, az), tl(bx, bz));
                seg_rect_dist(lax, laz, lbx, lbz, hw, hd) < r
            }
        };
        if hit { return false; }
    }
    true
}

/**
 * Where to stand to reach (tx,tz) from within `reach`: the free grid point within reach nearest to (fx,fz).
 * For targets inside an obstacle (a tree trunk, a rock), whose own cell a path can never end on.
 */
pub fn approach_point(tx: f64, tz: f64, reach: f64, fx: f64, fz: f64) -> Option<P> {
    let (cx, cz, r) = (to_cell(tx), to_cell(tz), reach.ceil() as i64 + 1);
    let mut best: Option<(f64, P)> = None;
    for dx in -r..=r {
        for dz in -r..=r {
            let (x, z) = (to_world(cx + dx), to_world(cz + dz));
            if blocked(cx + dx, cz + dz) || (x - tx).hypot(z - tz) > reach { continue; }
            let d = (x - fx).hypot(z - fz);
            if best.map_or(true, |(bd, _)| d < bd) { best = Some((d, P { x, z })); }
        }
    }
    best.map(|(_, p)| p)
}

/** The free grid cell nearest (x, z) within 12 cells (ties: nearest (px, pz)); same as the client's nearestFree. */
fn nearest_free(x: f64, z: f64, px: f64, pz: f64) -> Option<(i64, i64)> {
    let (cx, cz) = (to_cell(x), to_cell(z));
    if !blocked(cx, cz) { return Some((cx, cz)); }
    let mut best: Option<((i64, i64), f64)> = None;
    for rad in 1..=12i64 {
        for dx in -rad..=rad {
            for dz in -rad..=rad {
                if dx.abs().max(dz.abs()) != rad || blocked(cx + dx, cz + dz) { continue; }
                let (wx, wz) = (to_world(cx + dx), to_world(cz + dz));
                let dd = (wx - x).hypot(wz - z) + (wx - px).hypot(wz - pz) * 1e-3;
                if best.map_or(true, |(_, bd)| dd < bd) { best = Some(((cx + dx, cz + dz), dd)); }
            }
        }
        if let Some((_, bd)) = best { if bd <= (rad as f64 + 0.5) * RES { break; } }
    }
    best.map(|(c, _)| c)
}

/** From the free point a toward b: b when a walker fits there and goes straight to it, else as far as it can. */
fn toward_free(ax: f64, az: f64, bx: f64, bz: f64) -> P {
    let r = d().c.walk_radius;
    let ok = |x: f64, z: f64| point_free(x, z, r) && line_clear(ax, az, x, z);
    if ok(bx, bz) { return P { x: bx, z: bz }; }
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..10 {
        let m = (lo + hi) / 2.0;
        if ok(ax + (bx - ax) * m, az + (bz - az) * m) { lo = m; } else { hi = m; }
    }
    P { x: ax + (bx - ax) * lo, z: az + (bz - az) * lo }
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
    let (Some(s), Some(gc)) = (nearest_free(sx, sz, sx, sz), nearest_free(tx, tz, sx, sz)) else {
        return vec![P { x: tx, z: tz }];
    };
    // the target itself wherever a walker fits there, else the nearest reachable spot beside it
    let end = toward_free(to_world(gc.0), to_world(gc.1), tx, tz);
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
        // the goal cell, then on to the end beside it (the string pulling drops the cell when the end is in sight)
        if found { if let Some(last) = cells.last() { if last.x != end.x || last.z != end.z { cells.push(end); } } }
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

#[cfg(test)]
mod tests {
    use super::*;

    /** A lone tree: a circle obstacle with nothing else within 6 m of it. */
    fn lone_tree() -> (f64, f64, f64) {
        let obs = &d().obstacles;
        obs.iter().find_map(|o| match *o {
            ObstacleDef::Circle { x, z, r } if r < 0.6 && obs.iter().filter(|p| { let (px, pz) = pos(p); (px - x).hypot(pz - z) < 6.0 + bound(p) }).count() == 1 => Some((x, z, r)),
            _ => None,
        }).expect("a lone tree")
    }

    #[test]
    fn point_free_and_line_clear_follow_the_real_trunk() {
        let (x, z, r) = lone_tree();
        let w = d().c.walk_radius;
        assert!(point_free(x + r + w + 0.05, z, w), "just clear of the trunk");
        assert!(!point_free(x + r + w - 0.05, z, w), "touching the trunk");
        // a line passing the trunk a little closer than the body is blocked, a little farther is clear
        let near = r + w - 0.1;
        assert!(!line_clear(x - 3.0, z + near, x + 3.0, z + near));
        assert!(line_clear(x - 3.0, z + r + w + 0.05, x + 3.0, z + r + w + 0.05));
    }

    #[test]
    fn a_free_click_beside_a_trunk_is_the_path_end() {
        let (x, z, r) = lone_tree();
        let w = d().c.walk_radius;
        // free, but within a metre of the trunk (its grid cell may well be blocked): the path ends exactly on it
        let (tx, tz) = (x + r + w + 0.08, z + 0.1);
        let p = find_path(x - 4.0, z, tx, tz);
        let e = p.last().unwrap();
        assert!((e.x - tx).abs() < 1e-9 && (e.z - tz).abs() < 1e-9, "path ended at ({}, {}), not the click", e.x, e.z);
    }

    #[test]
    fn a_click_inside_a_house_ends_at_its_near_edge() {
        let obs = &d().obstacles;
        let (hx, hz, hw, hd, cos, sin) = obs.iter().find_map(|o| match *o {
            ObstacleDef::Box { x, z, hw, hd, cos, sin } if hw > 2.5 && hd > 2.5 => Some((x, z, hw, hd, cos, sin)),
            _ => None,
        }).expect("a house");
        // from a point well outside it, along the box's local +x
        let (fx, fz) = (hx + (hw + 8.0) * cos, hz + (hw + 8.0) * sin);
        let p = find_path(fx, fz, hx, hz);
        let e = p.last().unwrap();
        let w = d().c.walk_radius;
        assert!(point_free(e.x, e.z, w), "the end is somewhere a walker fits");
        // it stops at the house, not metres off at a corner: within a step of the nearest a walker gets to the click
        let ideal = hw.min(hd) + w;
        let got = (e.x - hx).hypot(e.z - hz);
        assert!(got < ideal + 1.6, "ended {got:.2} m from the click, the house edge is {ideal:.2} m away");
    }
}
