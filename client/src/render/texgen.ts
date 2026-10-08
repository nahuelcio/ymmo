// Pure texel generation for the procedural world textures (no three.js, so it can run in a worker).
// Every texel is RGBA8:
//   R = luminance modulation (0.5 = neutral; shaders use R * 2 as a brightness factor, so the tint
//       still comes from the existing vertex / material colours and every zone keeps its palette)
//   G = height (0..1) for ragged layer blending, B = tint jitter (0.5 = none), A = 255
// All noise is periodic over the tile, so every layer repeats without seams. Noise generators are
// built once per layer (lattice tables resolved up front), which keeps the per-texel cost low.

export const TERRAIN_LAYERS = ['grass', 'dirt', 'rock', 'sand', 'snow', 'cobble'] as const;
export const PROP_LAYERS = ['wood', 'stone', 'roof', 'plaster'] as const;
export type TerrainLayer = (typeof TERRAIN_LAYERS)[number];
export type PropLayer = (typeof PROP_LAYERS)[number];
export type LayerName = TerrainLayer | PropLayer;

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

type Noise2 = (u: number, v: number) => number;

// ---------------------------------------------------------------- periodic value noise

/** Value noise over a tile with `px` × `py` lattice cells. u, v in [0, 1). */
function makeNoise(px: number, py: number, seed: number): Noise2 {
  const t = new Float32Array(px * py);
  for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) t[y * px + x] = hash(x, y, seed);
  return (u, v) => {
    const x = u * px, y = v * py;
    const ix = x | 0, iy = y | 0;
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x1 = ix + 1 === px ? 0 : ix + 1, y1 = iy + 1 === py ? 0 : iy + 1;
    const r0 = iy * px, r1 = y1 * px;
    const a = t[r0 + ix], b = t[r0 + x1], c = t[r1 + ix], d = t[r1 + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

/** Tileable fbm; `p` = lattice cells across the tile at the first octave. */
function makeFbm(p: number, oct: number, seed: number, ridge = false): Noise2 {
  const octs: Noise2[] = [];
  let norm = 0;
  for (let i = 0, amp = 1; i < oct; i++, amp *= 0.5) {
    octs.push(makeNoise(p << i, p << i, seed + i * 101));
    norm += amp;
  }
  return (u, v) => {
    let sum = 0, amp = 1;
    for (let i = 0; i < octs.length; i++, amp *= 0.5) {
      const n = octs[i](u, v);
      sum += (ridge ? 1 - Math.abs(n * 2 - 1) : n) * amp;
    }
    return sum / norm;
  };
}

// ---------------------------------------------------------------- periodic worley noise

interface Cell { f1: number; f2: number; id: number }
type Worley = (u: number, v: number) => Cell;

/** Tileable Worley noise with `n` × `n` cells: F1, F2 and the nearest cell's id (0..1). */
function makeWorley(n: number, seed: number): Worley {
  const t = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 3;
      t[o] = hash(x, y, seed);
      t[o + 1] = hash(x, y, seed + 7);
      t[o + 2] = hash(x, y, seed + 13);
    }
  const cell: Cell = { f1: 0, f2: 0, id: 0 };
  return (u, v) => {
    const x = u * n, y = v * n;
    const cx = x | 0, cy = y | 0;
    let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const gy = cy + dy, wy = gy < 0 ? gy + n : gy >= n ? gy - n : gy;
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, wx = gx < 0 ? gx + n : gx >= n ? gx - n : gx;
        const o = (wy * n + wx) * 3;
        const ddx = gx + t[o] - x, ddy = gy + t[o + 1] - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < f1) {
          f2 = f1;
          f1 = d2;
          id = t[o + 2];
        } else if (d2 < f2) f2 = d2;
      }
    }
    cell.f1 = Math.sqrt(f1);
    cell.f2 = Math.sqrt(f2);
    cell.id = id;
    return cell;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const frac = (x: number) => x - Math.floor(x);

// ---------------------------------------------------------------- layer painters
// A painter factory builds its noise once and returns a per-texel function that writes
// [luminance factor (~0.5..1.5), height 0..1, tint jitter -1..1] into `out`.

type Out = [number, number, number];
type Painter = (u: number, v: number, out: Out) => void;

const PAINTERS: Record<LayerName, () => Painter> = {
  grass() {
    const clumps = makeFbm(6, 4, 11);
    // blades: fine noise stretched along one axis (separate periods per axis keep it tileable)
    const bladesA = makeNoise(160, 40, 12), bladesB = makeNoise(96, 24, 13), hue = makeNoise(3, 3, 14);
    return (u, v, o) => {
      const c = clumps(u, v);
      const b = bladesA(u, v) * 0.6 + bladesB(u, v) * 0.4;
      o[0] = 0.78 + c * 0.32 + (b - 0.5) * 0.3;
      o[1] = clamp01(c * 0.7 + b * 0.3);
      o[2] = (hue(u, v) - 0.5) * 2;
    };
  },
  dirt() {
    const base = makeFbm(8, 4, 21), pebbles = makeWorley(22, 22);
    return (u, v, o) => {
      const b = base(u, v), c = pebbles(u, v);
      const pebble = 1 - sstep(0.18, 0.32, c.f1);
      o[0] = 0.82 + (b - 0.5) * 0.35 + pebble * (0.18 + c.id * 0.15);
      o[1] = clamp01(b * 0.6 + pebble * 0.5);
      o[2] = (c.id - 0.5) * pebble;
    };
  },
  rock() {
    const warp = makeFbm(4, 3, 31), cracks = makeFbm(5, 3, 32, true);
    return (u, v, o) => {
      const w = warp(u, v);
      const strata = 0.5 + 0.5 * Math.sin((v + w * 0.25) * Math.PI * 2 * 7);
      const crease = sstep(0.78, 0.95, cracks(u, v));
      o[0] = 0.8 + (w - 0.5) * 0.4 + strata * 0.12 - crease * 0.38;
      o[1] = clamp01(0.6 + w * 0.4 - crease * 0.6);
      o[2] = (strata - 0.5) * 0.6;
    };
  },
  sand() {
    const soft = makeFbm(5, 3, 41), rippleWarp = makeFbm(4, 2, 42), grain = makeNoise(256, 256, 43);
    return (u, v, o) => {
      const s = soft(u, v);
      const ripple = 0.5 + 0.5 * Math.sin((u * 9 + rippleWarp(u, v) * 2.5) * Math.PI * 2);
      o[0] = 0.9 + (s - 0.5) * 0.18 + (ripple - 0.5) * 0.1 + (grain(u, v) - 0.5) * 0.08;
      o[1] = clamp01(s * 0.5 + ripple * 0.3);
      o[2] = (s - 0.5) * 0.4;
    };
  },
  snow() {
    const soft = makeFbm(4, 3, 51), glint = makeNoise(256, 256, 52);
    return (u, v, o) => {
      const s = soft(u, v);
      o[0] = 0.95 + (s - 0.5) * 0.12 + (glint(u, v) > 0.93 ? 0.08 : 0);
      o[1] = clamp01(s);
      o[2] = 0;
    };
  },
  cobble() {
    const stones = makeWorley(10, 61), grit = makeFbm(16, 2, 62);
    return (u, v, o) => {
      const c = stones(u, v);
      const edge = c.f2 - c.f1; // 0 on the borders between stones
      const mortar = 1 - sstep(0.05, 0.13, edge);
      const dome = sstep(0.02, 0.4, edge);
      o[0] = (0.75 + c.id * 0.3 + (grit(u, v) - 0.5) * 0.2 + dome * 0.12) * (1 - mortar * 0.55);
      o[1] = clamp01(dome * (1 - mortar));
      o[2] = (c.id - 0.5) * 1.2;
    };
  },
  wood() {
    // horizontal planks along u; grain follows the plank
    const rows = 6;
    const warp = makeFbm(3, 2, 72), fine = makeNoise(200, 24, 73);
    return (u, v, o) => {
      const row = Math.floor(v * rows), fv = v * rows - row;
      const plank = hash(row, 0, 71), us = frac(u + hash(row, 1, 71));
      const grain = 0.5 + 0.5 * Math.sin((fv * 3 + warp(us, v) * 4) * Math.PI * 2 * 3);
      const gap = 1 - sstep(0, 0.06, Math.min(fv, 1 - fv));
      const end = 1 - sstep(0, 0.008, Math.abs(us - 0.5)); // one butt joint per plank
      const seam = Math.max(gap, end);
      o[0] = (0.78 + plank * 0.25 + (grain - 0.5) * 0.2 + (fine(us, v) - 0.5) * 0.12) * (1 - seam * 0.6);
      o[1] = clamp01(1 - seam);
      o[2] = (plank - 0.5) * 1.2;
    };
  },
  stone() {
    // ashlar: running-bond blocks with mortar joints
    const rows = 4, cols = 2;
    const grit = makeFbm(12, 3, 82);
    return (u, v, o) => {
      const row = Math.floor(v * rows), fv = v * rows - row;
      const cu = (u * cols + (row % 2) * 0.5) % cols, col = Math.floor(cu), fu = cu - col;
      const id = hash(col, row, 81);
      const mortar = 1 - sstep(0.025, 0.06, Math.min(fv, 1 - fv, fu * 0.5, (1 - fu) * 0.5));
      const g = grit(u, v);
      o[0] = (0.78 + id * 0.25 + (g - 0.5) * 0.3) * (1 - mortar * 0.5);
      o[1] = clamp01((1 - mortar) * (0.6 + g * 0.4));
      o[2] = (id - 0.5) * 0.8;
    };
  },
  roof() {
    // overlapping tiles: scalloped bottom edges, darker under each overlap
    const rows = 8, cols = 8;
    const grit = makeFbm(16, 2, 92);
    return (u, v, o) => {
      const row = Math.floor(v * rows), fv = v * rows - row;
      const cu = (u * cols + (row % 2) * 0.5) % cols, col = Math.floor(cu), fu = cu - col;
      const id = hash(col, row, 91);
      const scallop = 0.15 * Math.sqrt(Math.max(0, 1 - (fu * 2 - 1) ** 2));
      const lip = fv < 0.12 + scallop ? 1 : 0;
      const side = 1 - sstep(0, 0.07, Math.min(fu, 1 - fu));
      o[0] = (0.7 + fv * 0.35 + id * 0.18 + (grit(u, v) - 0.5) * 0.15) * (1 - lip * 0.35) * (1 - side * 0.3);
      o[1] = clamp01(fv * (1 - side));
      o[2] = (id - 0.5) * 0.8;
    };
  },
  plaster() {
    const soft = makeFbm(6, 4, 101), blots = makeFbm(3, 2, 102), cracks = makeFbm(3, 3, 103, true);
    return (u, v, o) => {
      const s = soft(u, v);
      const blot = sstep(0.55, 0.75, blots(u, v));
      const crack = sstep(0.93, 0.985, cracks(u, v));
      o[0] = 0.92 + (s - 0.5) * 0.16 - blot * 0.08 - crack * 0.25;
      o[1] = clamp01(s - crack);
      o[2] = (s - 0.5) * 0.3;
    };
  },
};

/** Paint `layers` (each size × size) into one RGBA8 buffer, layer after layer. */
export function paintLayers(layers: readonly LayerName[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size * size * 4 * layers.length);
  const px: Out = [1, 0, 0];
  let o = 0;
  for (const name of layers) {
    const paint = PAINTERS[name]();
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        paint(x / size, v, px);
        out[o] = clamp01(px[0] * 0.5) * 255 + 0.5;
        out[o + 1] = clamp01(px[1]) * 255 + 0.5;
        out[o + 2] = clamp01(0.5 + px[2] * 0.5) * 255 + 0.5;
        out[o + 3] = 255;
        o += 4;
      }
    }
  }
  return out;
}
