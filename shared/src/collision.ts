// Static world collision + pathfinding, shared by server (authoritative) and client (prediction).
import { layoutCamps, layoutRocks, layoutTown, layoutTrees, layoutZoneProps } from './layout';
import { PLAYABLE_HALF, TOWN, VOLCANO } from './terrain';
import { BELL_TOWER, FORTS } from './village';

/** Circle (r) or oriented box (hw/hd half extents, rot = three.js rotation.y). */
export type Obstacle =
  | { k: 'c'; x: number; z: number; r: number }
  | { k: 'b'; x: number; z: number; hw: number; hd: number; rot: number; cos: number; sin: number };

/** Default radius used for walkers (players & most mobs). */
export const WALK_RADIUS = 0.45;

const circle = (x: number, z: number, r: number): Obstacle => ({ k: 'c', x, z, r });
const obb = (x: number, z: number, hw: number, hd: number, rot: number): Obstacle =>
  ({ k: 'b', x, z, hw, hd, rot, cos: Math.cos(rot), sin: Math.sin(rot) });

function buildObstacles(): Obstacle[] {
  const o: Obstacle[] = [];
  for (const t of layoutTrees()) o.push(circle(t.x, t.z, 0.35 * t.sc));
  // pebbles are walkable, boulders aren't
  for (const r of layoutRocks()) if (r.sc > 0.7) o.push(circle(r.x, r.z, Math.min(r.s[0], r.s[2]) * 0.85));
  const town = layoutTown();
  for (const f of FORTS) o.push(circle(f.town.x, f.town.z, 1.6)); // each fort's brazier
  o.push(circle(VOLCANO.x, VOLCANO.z, VOLCANO.crater * 0.8)); // nobody walks into the volcano's lava
  for (const h of town.houses) o.push(obb(h.x, h.z, h.w / 2 + 0.15, h.d / 2 + 0.15, h.rot));
  o.push(obb(TOWN.x + BELL_TOWER.x, TOWN.z + BELL_TOWER.z, BELL_TOWER.hw, BELL_TOWER.hd, BELL_TOWER.rot));
  for (const s of town.stalls) o.push(obb(s.x, s.z, 1.6, 0.55, s.rot));
  for (const w of town.walls) {
    o.push(obb(w.x, w.z, w.hw ?? 3.6, w.hd ?? 0.4, w.rot));
  }
  for (const g of town.gates) o.push(circle(g.x, g.z, 0.8));
  const zp = layoutZoneProps();
  for (const t of zp.tents) o.push(circle(t.x, t.z, 2.6));
  for (const t of zp.totems) o.push(circle(t.x, t.z, 0.5));
  for (const r of zp.ruins) o.push(circle(r.x, r.z, 0.65));
  for (const g of zp.graves) o.push(circle(g.x, g.z, 0.35));
  for (const h of zp.huts) o.push(circle(h.x, h.z, 2.2));
  for (const c of layoutCamps()) {
    for (const t of c.tents) o.push(circle(t.x, t.z, 2.3));
    for (const w of c.walls) o.push(obb(w.x, w.z, 3.6, 0.35, w.rot));
    o.push(circle(c.fire.x, c.fire.z, 0.9));
    o.push(circle(c.banner.x, c.banner.z, 0.3));
  }
  return o;
}

const bound = (ob: Obstacle) => (ob.k === 'c' ? ob.r : Math.hypot(ob.hw, ob.hd));

// ---------------------------------------------------------------- spatial hash
const CELL = 8;
let obstacles: Obstacle[] = [];
let hash: Map<number, Obstacle[]> | null = null;
const hkey = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000);

function ensure() {
  if (hash) return;
  obstacles = buildObstacles();
  hash = new Map();
  for (const ob of obstacles) {
    const b = bound(ob) + 1;
    for (let cx = Math.floor((ob.x - b) / CELL); cx <= Math.floor((ob.x + b) / CELL); cx++)
      for (let cz = Math.floor((ob.z - b) / CELL); cz <= Math.floor((ob.z + b) / CELL); cz++) {
        const k = hkey(cx, cz);
        let l = hash.get(k);
        if (!l) hash.set(k, (l = []));
        l.push(ob);
      }
  }
}

export function getObstacles(): Obstacle[] {
  ensure();
  return obstacles;
}

/** Push a circle (x,z,r) out of every overlapping obstacle. Walls slide naturally. */
export function pushOut(x: number, z: number, r = WALK_RADIUS): { x: number; z: number } {
  ensure();
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    const l = hash!.get(hkey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) break;
    for (const ob of l) {
      if (ob.k === 'c') {
        const dx = x - ob.x, dz = z - ob.z, R = ob.r + r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-4;
        x = ob.x + (dx / d) * R;
        z = ob.z + (dz / d) * R;
        moved = true;
      } else {
        // to box-local space
        const dx = x - ob.x, dz = z - ob.z;
        const lx = dx * ob.cos - dz * ob.sin, lz = dx * ob.sin + dz * ob.cos;
        const cx = Math.max(-ob.hw, Math.min(ob.hw, lx)), cz = Math.max(-ob.hd, Math.min(ob.hd, lz));
        let ox = lx - cx, oz = lz - cz;
        const d2 = ox * ox + oz * oz;
        let nx: number, nz: number;
        if (d2 > 1e-8) {
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          nx = cx + (ox / d) * r;
          nz = cz + (oz / d) * r;
        } else {
          // centre inside the box: leave through the closest face
          const px = ob.hw - Math.abs(lx), pz = ob.hd - Math.abs(lz);
          if (px < pz) { nx = Math.sign(lx || 1) * (ob.hw + r); nz = lz; }
          else { nx = lx; nz = Math.sign(lz || 1) * (ob.hd + r); }
        }
        ox = nx; oz = nz;
        // back to world space
        x = ob.x + ox * ob.cos + oz * ob.sin;
        z = ob.z - ox * ob.sin + oz * ob.cos;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x, z };
}

// ---------------------------------------------------------------- nav grid
const RES = 1; // world units per nav cell
const N = Math.ceil((PLAYABLE_HALF * 2) / RES) + 1;
let nav: Uint8Array | null = null;

const toCell = (v: number) => Math.max(0, Math.min(N - 1, Math.round((v + PLAYABLE_HALF) / RES)));
const toWorld = (c: number) => c * RES - PLAYABLE_HALF;

/** The walk grid, built on first use (~100 ms for the whole world): call early to build it ahead of time. */
export function navGrid(): Uint8Array {
  if (nav) return nav;
  ensure();
  nav = new Uint8Array(N * N);
  const r = WALK_RADIUS;
  for (const ob of obstacles) {
    const b = bound(ob) + r;
    const c0 = toCell(ob.x - b), c1 = toCell(ob.x + b), r0 = toCell(ob.z - b), r1 = toCell(ob.z + b);
    for (let cx = c0; cx <= c1; cx++)
      for (let cz = r0; cz <= r1; cz++) {
        const x = toWorld(cx), z = toWorld(cz);
        let hit: boolean;
        if (ob.k === 'c') hit = Math.hypot(x - ob.x, z - ob.z) < ob.r + r;
        else {
          const dx = x - ob.x, dz = z - ob.z;
          const lx = Math.abs(dx * ob.cos - dz * ob.sin), lz = Math.abs(dx * ob.sin + dz * ob.cos);
          hit = lx < ob.hw + r && lz < ob.hd + r;
        }
        if (hit) nav[cz * N + cx] = 1;
      }
  }
  return nav;
}

const blockedCell = (cx: number, cz: number) => cx < 0 || cz < 0 || cx >= N || cz >= N || navGrid()[cz * N + cx] === 1;
/** A walker can stand at (x, z) by the walk grid (paths and straight walks end only on such cells). */
export const walkable = (x: number, z: number) => !blockedCell(toCell(x), toCell(z));

/** How far a circle at (x, z) of radius r sinks into an obstacle (> 0: they overlap). */
function overlap(ob: Obstacle, x: number, z: number, r: number): number {
  if (ob.k === 'c') return ob.r + r - Math.hypot(x - ob.x, z - ob.z);
  const dx = x - ob.x, dz = z - ob.z;
  const lx = dx * ob.cos - dz * ob.sin, lz = dx * ob.sin + dz * ob.cos;
  const ox = Math.abs(lx) - ob.hw, oz = Math.abs(lz) - ob.hd;
  return r - (ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz));
}

/** A walker fits at (x, z): its circle overlaps no obstacle, by their real shapes (the walk grid's cells are a metre
 * apart, so a point beside an obstacle can sit in a blocked cell and still be free). */
export function pointFree(x: number, z: number, r = WALK_RADIUS): boolean {
  ensure();
  if (Math.abs(x) > PLAYABLE_HALF || Math.abs(z) > PLAYABLE_HALF) return false;
  const l = hash!.get(hkey(Math.floor(x / CELL), Math.floor(z / CELL)));
  return !l || l.every((ob) => overlap(ob, x, z, r) <= 0);
}

/** Distance from the point (px, pz) to the segment a-b. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / l2)) : 0;
  return Math.hypot(px - (ax + ex * t), pz - (az + ez * t));
}
/** Distance from the segment a-b to the rectangle |x| <= hw, |z| <= hd (0 when they touch). */
function segRectDist(ax: number, az: number, bx: number, bz: number, hw: number, hd: number): number {
  // Liang-Barsky: does the segment cross the rectangle at all?
  let t0 = 0, t1 = 1;
  const ex = bx - ax, ez = bz - az;
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  if (clip(-ex, ax + hw) && clip(ex, hw - ax) && clip(-ez, az + hd) && clip(ez, hd - az)) return 0;
  const toRect = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x) - hw, 0), Math.max(Math.abs(z) - hd, 0));
  let d = Math.min(toRect(ax, az), toRect(bx, bz));
  for (const [cx, cz] of [[hw, hd], [-hw, hd], [hw, -hd], [-hw, -hd]]) d = Math.min(d, segDist(cx, cz, ax, az, bx, bz));
  return d;
}

/** A hair under the walker: one pressed against an obstacle (the push-out leaves it exactly touching) still sees past. */
const SEG_R = WALK_RADIUS - 0.02;
const segObs = new Set<Obstacle>();
/**
 * True when a walker can go in a straight line from a to b: its circle swept along the segment touches no obstacle,
 * by their real shapes. (Sampling the walk grid along the line passed lines that grazed a trunk: the walker then bumped
 * into it and slid round, and two trunks closer than a body could look open.)
 */
export function lineClear(ax: number, az: number, bx: number, bz: number, r = SEG_R): boolean {
  ensure();
  if (Math.abs(bx) > PLAYABLE_HALF || Math.abs(bz) > PLAYABLE_HALF) return false;
  // the obstacles listed in the hash cells along the line: each is listed in every cell within its reach + 1 m, so a
  // sample every half metre finds any the swept circle can touch
  segObs.clear();
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
  let last = NaN;
  for (let i = 0; i <= steps; i++) {
    const k = hkey(Math.floor((ax + ((bx - ax) * i) / steps) / CELL), Math.floor((az + ((bz - az) * i) / steps) / CELL));
    if (k === last) continue;
    last = k;
    for (const ob of hash!.get(k) ?? []) segObs.add(ob);
  }
  for (const ob of segObs) {
    if (ob.k === 'c') {
      if (segDist(ob.x, ob.z, ax, az, bx, bz) < ob.r + r) return false;
      continue;
    }
    // the segment in the box's own space
    const tl = (x: number, z: number) => [(x - ob.x) * ob.cos - (z - ob.z) * ob.sin, (x - ob.x) * ob.sin + (z - ob.z) * ob.cos];
    const [lax, laz] = tl(ax, az), [lbx, lbz] = tl(bx, bz);
    if (segRectDist(lax, laz, lbx, lbz, ob.hw, ob.hd) < r) return false;
  }
  return true;
}

/**
 * The free walk-grid cell nearest the point (x, z) within 12 cells (ties: the one nearest (px, pz)), or null. The
 * first free cell found used to win, scanning from a corner: a click inside a house went to a corner of it, metres off.
 */
function nearestFree(x: number, z: number, px = x, pz = z): [number, number] | null {
  const cx = toCell(x), cz = toCell(z);
  if (!blockedCell(cx, cz)) return [cx, cz];
  let best: [number, number] | null = null, bd = Infinity;
  for (let rad = 1; rad <= 12; rad++) {
    for (let dx = -rad; dx <= rad; dx++)
      for (let dz = -rad; dz <= rad; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad || blockedCell(cx + dx, cz + dz)) continue;
        const wx = toWorld(cx + dx), wz = toWorld(cz + dz);
        const d = Math.hypot(wx - x, wz - z) + Math.hypot(wx - px, wz - pz) * 1e-3;
        if (d < bd) (bd = d), (best = [cx + dx, cz + dz]);
      }
    // nothing on a farther ring can be nearer than (rad + 0.5) cells
    if (best && bd <= (rad + 0.5) * RES) break;
  }
  return best;
}

/** From the free point a toward b: b itself when a walker fits there and goes straight to it from a, else as far
 * along as it can (the edge of what is in the way). */
function towardFree(ax: number, az: number, bx: number, bz: number): { x: number; z: number } {
  const ok = (x: number, z: number) => pointFree(x, z) && lineClear(ax, az, x, z);
  if (ok(bx, bz)) return { x: bx, z: bz };
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) {
    const m = (lo + hi) / 2;
    if (ok(ax + (bx - ax) * m, az + (bz - az) * m)) lo = m;
    else hi = m;
  }
  return { x: ax + (bx - ax) * lo, z: az + (bz - az) * lo };
}

const MAX_NODES = 40000;

/** Reused A* buffers (one search at a time: JS is single-threaded). */
let scr: { stamp: number; gScore: Float32Array; came: Int32Array; seen: Int32Array; closed: Int32Array; heapF: Float32Array; heapN: Int32Array } | null = null;
function scratch() {
  if (!scr) {
    const NN = N * N;
    scr = { stamp: 0, gScore: new Float32Array(NN), came: new Int32Array(NN), seen: new Int32Array(NN), closed: new Int32Array(NN), heapF: new Float32Array(4096), heapN: new Int32Array(4096) };
  }
  return scr;
}

/**
 * Waypoints from (sx,sz) to (tx,tz) around static obstacles (start excluded).
 * Straight line when clear; A* on the nav grid + string pulling otherwise.
 * It ends on the target itself wherever a walker fits there, else on the nearest spot it can reach beside it (the
 * edge of the house or rock in the way).
 */
export function findPath(sx: number, sz: number, tx: number, tz: number, maxNodes = MAX_NODES): { x: number; z: number }[] {
  if (lineClear(sx, sz, tx, tz)) return [{ x: tx, z: tz }];
  const s = nearestFree(sx, sz);
  const g = nearestFree(tx, tz, sx, sz);
  if (!s || !g) return [{ x: tx, z: tz }];
  const end = towardFree(toWorld(g[0]), toWorld(g[1]), tx, tz);
  if (lineClear(sx, sz, end.x, end.z)) return [end];

  const start = s[1] * N + s[0], goal = g[1] * N + g[0];
  const nav = navGrid();
  const sc = scratch();
  // a new stamp invalidates the previous search's g-scores / closed flags without clearing the arrays
  const stamp = ++sc.stamp;
  if (stamp === 0x7fffffff) {
    sc.seen.fill(0);
    sc.closed.fill(0);
    sc.stamp = 1;
  }
  const { gScore, came, seen, closed } = sc;
  let heapF = sc.heapF, heapN = sc.heapN, size = 0;
  const push = (f: number, n: number) => {
    if (size === heapF.length) {
      const nf = new Float32Array(size * 2), nn = new Int32Array(size * 2);
      nf.set(heapF);
      nn.set(heapN);
      heapF = sc.heapF = nf;
      heapN = sc.heapN = nn;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapF[i] = heapF[p];
      heapN[i] = heapN[p];
      i = p;
    }
    heapF[i] = f;
    heapN[i] = n;
  };
  const pop = (): number => {
    const top = heapN[0];
    const lf = heapF[--size], ln = heapN[size];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      if (l >= size) break;
      const c = r < size && heapF[r] < heapF[l] ? r : l;
      if (heapF[c] >= lf) break;
      heapF[i] = heapF[c];
      heapN[i] = heapN[c];
      i = c;
    }
    heapF[i] = lf;
    heapN[i] = ln;
    return top;
  };
  const gx = g[0], gz = g[1];
  const h = (n: number) => {
    const dx = Math.abs((n % N) - gx), dz = Math.abs(((n / N) | 0) - gz);
    return dx > dz ? dx + 0.4142 * dz : dz + 0.4142 * dx;
  };
  const free = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < N && cz < N && nav[cz * N + cx] === 0;
  seen[start] = stamp;
  gScore[start] = 0;
  push(h(start), start);
  let found = false, best = start, bestH = h(start), expanded = 0;
  while (size && expanded < maxNodes) {
    const cur = pop();
    if (closed[cur] === stamp) continue;
    if (cur === goal) { found = true; break; }
    closed[cur] = stamp;
    expanded++;
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    const cx = cur % N, cz = (cur / N) | 0, gc = gScore[cur];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (!free(nx, nz)) continue;
        // no corner cutting
        if (dx && dz && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue;
        const n = nz * N + nx;
        if (closed[n] === stamp) continue;
        const ng = gc + (dx && dz ? 1.4142 : 1);
        if (seen[n] !== stamp || ng < gScore[n]) {
          seen[n] = stamp;
          gScore[n] = ng;
          came[n] = cur;
          push(ng + h(n), n);
        }
      }
  }
  // unreachable: get as close as we can
  let n = found ? goal : best;
  const cells: { x: number; z: number }[] = [];
  while (n !== start) {
    cells.push({ x: toWorld(n % N), z: toWorld(Math.floor(n / N)) });
    if (sc.seen[n] !== stamp) break;
    n = came[n];
  }
  cells.reverse();
  // the goal cell, then on to the end beside it (the string pulling drops the cell when the end is in sight)
  if (found && cells.length && (cells[cells.length - 1].x !== end.x || cells[cells.length - 1].z !== end.z)) cells.push(end);
  if (!cells.length) return [end];
  // string pulling: keep only the waypoints we can't see past
  const out: { x: number; z: number }[] = [];
  let ax = sx, az = sz, i = 0;
  while (i < cells.length) {
    let j = i;
    while (j + 1 < cells.length && lineClear(ax, az, cells[j + 1].x, cells[j + 1].z)) j++;
    out.push(cells[j]);
    ax = cells[j].x;
    az = cells[j].z;
    i = j + 1;
  }
  // second pass: drop waypoints we can see past from the previous one
  for (let k = out.length - 2, guard = 0; k >= 0 && guard < 64; k--, guard++) {
    const px = k ? out[k - 1].x : sx, pz = k ? out[k - 1].z : sz;
    if (lineClear(px, pz, out[k + 1].x, out[k + 1].z)) out.splice(k, 1);
  }
  return out;
}

// ---------------------------------------------------------------- long trips
// The walk grid is 1 m and a search stops at MAX_NODES: since the world grew to ±2000, a trip of hundreds of metres (a
// click on the world map) came back partial, and a different part on the client and on the server, which then pulled
// each other round in circles. A long trip goes in legs instead, placed along a path on a coarse grid, so every search
// (the client's and the server's) is a short one.
const CRES = 4; // world units per coarse cell
const CN = Math.ceil((PLAYABLE_HALF * 2) / CRES) + 1;
const COARSE_NODES = 200000;
let coarse: Uint8Array | null = null;
/** 1 where a coarse cell's centre is blocked on the walk grid (thin walls slip through: the legs go round them). */
function coarseGrid(): Uint8Array {
  if (coarse) return coarse;
  coarse = new Uint8Array(CN * CN);
  for (let cz = 0; cz < CN; cz++)
    for (let cx = 0; cx < CN; cx++)
      if (blockedCell(toCell(cx * CRES - PLAYABLE_HALF), toCell(cz * CRES - PLAYABLE_HALF))) coarse[cz * CN + cx] = 1;
  return coarse;
}
const toCoarse = (v: number) => Math.max(0, Math.min(CN - 1, Math.round((v + PLAYABLE_HALF) / CRES)));

/** World points of a path on the coarse grid from s to t (A*, no corner cutting); null when there is none. */
function coarsePath(sx: number, sz: number, tx: number, tz: number): { x: number; z: number }[] | null {
  const grid = coarseGrid();
  const free = (cx: number, cz: number) => cx >= 0 && cz >= 0 && cx < CN && cz < CN && grid[cz * CN + cx] === 0;
  const near = (cx: number, cz: number): number | null => {
    for (let rad = 0; rad <= 4; rad++)
      for (let dx = -rad; dx <= rad; dx++)
        for (let dz = -rad; dz <= rad; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === rad && free(cx + dx, cz + dz)) return (cz + dz) * CN + cx + dx;
    return null;
  };
  const start = near(toCoarse(sx), toCoarse(sz)), goal = near(toCoarse(tx), toCoarse(tz));
  if (start === null || goal === null) return null;
  const gx = goal % CN, gz = (goal / CN) | 0;
  const h = (n: number) => {
    const dx = Math.abs((n % CN) - gx), dz = Math.abs(((n / CN) | 0) - gz);
    return dx > dz ? dx + 0.4142 * dz : dz + 0.4142 * dx;
  };
  const g = new Map<number, number>([[start, 0]]), came = new Map<number, number>(), closed = new Set<number>();
  // a binary heap of [f, node]
  const heap: number[][] = [[h(start), start]];
  const push = (f: number, n: number) => {
    heap.push([f, n]);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top[1];
  };
  let found = false;
  while (heap.length && closed.size < COARSE_NODES) {
    const cur = pop();
    if (closed.has(cur)) continue;
    if (cur === goal) { found = true; break; }
    closed.add(cur);
    const cx = cur % CN, cz = (cur / CN) | 0, gc = g.get(cur)!;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if ((!dx && !dz) || !free(cx + dx, cz + dz)) continue;
        if (dx && dz && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue;
        const n = (cz + dz) * CN + cx + dx;
        const ng = gc + (dx && dz ? 1.4142 : 1);
        if (closed.has(n) || ng >= (g.get(n) ?? Infinity)) continue;
        g.set(n, ng);
        came.set(n, cur);
        push(ng + h(n), n);
      }
  }
  if (!found) return null;
  const out: { x: number; z: number }[] = [];
  for (let n = goal; n !== start; n = came.get(n)!) out.push({ x: (n % CN) * CRES - PLAYABLE_HALF, z: ((n / CN) | 0) * CRES - PLAYABLE_HALF });
  return out.reverse();
}

/**
 * Stops about every `leg` metres along a coarse path from (sx,sz) to (tx,tz), neither end included, each on a free
 * cell of the walk grid: walked one after another, every search between them is short. A trip under 1.5 legs needs
 * none; with no coarse path the stops go along the straight line.
 */
export function tripLegs(sx: number, sz: number, tx: number, tz: number, leg = 50): { x: number; z: number }[] {
  if (Math.hypot(tx - sx, tz - sz) < leg * 1.5) return [];
  const pts = coarsePath(sx, sz, tx, tz) ?? [{ x: tx, z: tz }];
  const out: { x: number; z: number }[] = [];
  let px = sx, pz = sz, run = 0;
  for (const p of pts) {
    let seg = Math.hypot(p.x - px, p.z - pz);
    while (seg > 0 && run + seg >= leg) {
      const k = (leg - run) / seg;
      px += (p.x - px) * k;
      pz += (p.z - pz) * k;
      out.push({ x: px, z: pz });
      seg = Math.hypot(p.x - px, p.z - pz);
      run = 0;
    }
    run += seg;
    px = p.x;
    pz = p.z;
  }
  // none right before the end
  while (out.length && Math.hypot(tx - out[out.length - 1].x, tz - out[out.length - 1].z) < leg * 0.5) out.pop();
  const stops = out.map((p) => {
    const c = nearestFree(p.x, p.z);
    return c ? { x: toWorld(c[0]), z: toWorld(c[1]) } : p;
  });
  // A leg the walk grid can't do in one search crosses what the coarse grid missed (a thin wall: its centres fall either
  // side of it). Find the way round once, with a wider search, and put stops along it every half leg.
  const legs: { x: number; z: number }[] = [];
  let ax = sx, az = sz;
  for (const [i, st] of [...stops, { x: tx, z: tz }].entries()) {
    const p = findPath(ax, az, st.x, st.z), e = p[p.length - 1];
    if (Math.hypot(e.x - st.x, e.z - st.z) > 2) {
      const wide = findPath(ax, az, st.x, st.z, MAX_NODES * 8);
      let qx = ax, qz = az, run = 0;
      for (const w of wide.slice(0, -1)) {
        run += Math.hypot(w.x - qx, w.z - qz);
        if (run >= leg / 2) (legs.push(w), (run = 0));
        qx = w.x;
        qz = w.z;
      }
      // where the wide search got to, if it is not the stop itself (an unreachable destination)
      const we = wide[wide.length - 1];
      if (i < stops.length || Math.hypot(we.x - st.x, we.z - st.z) > 2) legs.push(we);
    }
    if (i < stops.length) legs.push(st);
    ax = st.x;
    az = st.z;
  }
  return legs;
}

export const DASH_DIST = 6;
/** End of a dodge roll from (x,z) along unit (dx,dz): 0.5 m steps, stops at walls. Shared so the client predicts it exactly. */
export function dashEnd(x: number, z: number, dx: number, dz: number, r = WALK_RADIUS): { x: number; z: number } {
  for (let s = 0; s < DASH_DIST * 2; s++) {
    const np = pushOut(x + dx * 0.5, z + dz * 0.5, r);
    if (Math.hypot(np.x - x, np.z - z) < 0.15) break; // ran into a wall
    x = np.x;
    z = np.z;
  }
  return { x, z };
}
