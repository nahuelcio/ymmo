// Static world collision + pathfinding, shared by server (authoritative) and client (prediction).
import { layoutRocks, layoutTown, layoutTrees, layoutZoneProps } from './layout';
import { PLAYABLE_HALF, TOWN } from './terrain';

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
  o.push(circle(TOWN.x, TOWN.z, 4.4)); // fountain
  for (const h of town.houses) o.push(obb(h.x, h.z, h.w / 2 + 0.15, h.d / 2 + 0.15, h.rot));
  for (const s of town.stalls) o.push(obb(s.x, s.z, 1.6, 0.55, s.rot));
  for (const w of town.walls) {
    o.push(obb(w.x, w.z, 3.6, 0.4, w.rot));
    if (w.tower) o.push(circle(w.x, w.z, 1.35));
  }
  for (const g of town.gates) o.push(circle(g.x, g.z, 0.8));
  const zp = layoutZoneProps();
  for (const t of zp.tents) o.push(circle(t.x, t.z, 2.6));
  for (const t of zp.totems) o.push(circle(t.x, t.z, 0.5));
  for (const r of zp.ruins) o.push(circle(r.x, r.z, 0.65));
  for (const g of zp.graves) o.push(circle(g.x, g.z, 0.35));
  for (const h of zp.huts) o.push(circle(h.x, h.z, 2.2));
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

function navGrid(): Uint8Array {
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

/** True when a walker can go in a straight line from a to b. */
export function lineClear(ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / (RES * 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (blockedCell(toCell(ax + (bx - ax) * t), toCell(az + (bz - az) * t))) return false;
  }
  return true;
}

function nearestFree(cx: number, cz: number): [number, number] | null {
  if (!blockedCell(cx, cz)) return [cx, cz];
  for (let rad = 1; rad <= 12; rad++)
    for (let dx = -rad; dx <= rad; dx++)
      for (const dz of [-rad, rad]) {
        if (!blockedCell(cx + dx, cz + dz)) return [cx + dx, cz + dz];
        if (!blockedCell(cx + dz, cz + dx)) return [cx + dz, cz + dx];
      }
  return null;
}

const MAX_NODES = 40000;

/**
 * Waypoints from (sx,sz) to (tx,tz) around static obstacles (start excluded).
 * Straight line when clear; A* on the nav grid + string pulling otherwise.
 * If the target is inside an obstacle, walks to the closest free spot.
 */
export function findPath(sx: number, sz: number, tx: number, tz: number): { x: number; z: number }[] {
  if (lineClear(sx, sz, tx, tz)) return [{ x: tx, z: tz }];
  const s = nearestFree(toCell(sx), toCell(sz));
  const g = nearestFree(toCell(tx), toCell(tz));
  if (!s || !g) return [{ x: tx, z: tz }];
  const goalFree = g[0] === toCell(tx) && g[1] === toCell(tz);
  const end = goalFree ? { x: tx, z: tz } : { x: toWorld(g[0]), z: toWorld(g[1]) };
  if (lineClear(sx, sz, end.x, end.z)) return [end];

  const start = s[1] * N + s[0], goal = g[1] * N + g[0];
  const gScore = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  // binary heap of [f, node]
  const heap: [number, number][] = [];
  const push = (f: number, n: number) => {
    heap.push([f, n]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (n: number) => {
    const dx = Math.abs((n % N) - g[0]), dz = Math.abs(Math.floor(n / N) - g[1]);
    return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
  };
  push(h(start), start);
  let found = false, best = start, bestH = h(start);
  while (heap.length && closed.size < MAX_NODES) {
    const [, cur] = pop();
    if (closed.has(cur)) continue;
    if (cur === goal) { found = true; break; }
    closed.add(cur);
    const hc = h(cur);
    if (hc < bestH) { bestH = hc; best = cur; }
    const cx = cur % N, cz = Math.floor(cur / N);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (blockedCell(nx, nz)) continue;
        // no corner cutting
        if (dx && dz && (blockedCell(cx + dx, cz) || blockedCell(cx, cz + dz))) continue;
        const n = nz * N + nx;
        if (closed.has(n)) continue;
        const ng = gScore.get(cur)! + (dx && dz ? 1.4142 : 1);
        if (ng < (gScore.get(n) ?? Infinity)) {
          gScore.set(n, ng);
          came.set(n, cur);
          push(ng + h(n), n);
        }
      }
  }
  // unreachable: get as close as we can
  let n = found ? goal : best;
  const cells: { x: number; z: number }[] = [];
  while (n !== start) {
    cells.push({ x: toWorld(n % N), z: toWorld(Math.floor(n / N)) });
    const p = came.get(n);
    if (p === undefined) break;
    n = p;
  }
  cells.reverse();
  if (found) cells[cells.length - 1] = end;
  if (!cells.length) return [end];
  // string pulling: keep only the waypoints we can't see past
  const out: { x: number; z: number }[] = [];
  let ax = sx, az = sz, i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineClear(ax, az, cells[j].x, cells[j].z)) j--;
    out.push(cells[j]);
    ax = cells[j].x;
    az = cells[j].z;
    i = j + 1;
  }
  return out;
}
