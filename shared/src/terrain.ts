// Deterministic terrain shared by server and client so both agree on ground height.

export const WORLD_HALF = 900;
/**
 * The first map (levels 1-50). Its mountain border is now a ridge inside a bigger world: the same slopes inside, falling
 * away past it, with passes (RING_ROADS) out to the ring of level 50-78 lands around it.
 */
export const INNER_HALF = 500;
export const TOWN = { x: 0, z: 0, r: 50, name: 'Aldea del Alba' };
/** Second town, down a road of its own between the Goblin Hills and the Sunken Ruins: the gear for levels 20-40 is sold here. */
export const DUSK = { x: 170, z: -170, r: 30, name: 'Bastión del Ocaso' };
/** Where the ring's three towns stand (levels 50-60 north, 60-70 east, 70-78 south). The map draws +z downwards: north is -z. */
export const RING_SITES = { north: { x: 0, z: -650 }, east: { x: 650, z: 60 }, south: { x: 0, z: 650 } };
/** The roads out of the first map to them, from the zones by the ridge (wastes, meadows, hills): they cut the passes. */
export const RING_ROADS: [number, number, number, number][] = [
  [-20, 260, RING_SITES.south.x, RING_SITES.south.z],
  [190, 30, RING_SITES.east.x, RING_SITES.east.z],
  [20, -220, RING_SITES.north.x, RING_SITES.north.z],
];
/** The ring's towns, walled like the Bastión (shared/src/village.ts FORTS): Fuerte de Escarcha for levels 50-60. */
export const FROST = { x: RING_SITES.north.x, z: RING_SITES.north.z, r: 34, name: 'Fuerte de Escarcha' };
/** Peace zones on flattened ground. TOWN is the starting village. */
export const TOWNS = [TOWN, DUSK, FROST];

/**
 * Each ring region's own ground (render/scene.ts colours and textures it, layout.ts picks its trees and grass):
 * a box with soft edges, BIOME_FADE metres wide.
 */
export type BiomeId = 'frost';
export const BIOMES: { id: BiomeId; x0: number; x1: number; z0: number; z1: number }[] = [
  // the north side of the ring, west of its town: the frost region (50-60)
  { id: 'frost', x0: -WORLD_HALF, x1: 330, z0: -WORLD_HALF, z1: -555 },
];
const BIOME_FADE = 70;
/** How much of a biome covers (x, z): 0 outside, 1 well inside. */
export function biomeWeight(id: BiomeId, x: number, z: number): number {
  let w = 0;
  const f = BIOME_FADE / 2;
  for (const b of BIOMES) {
    if (b.id !== id) continue;
    w = Math.max(w, smoothstep(-f, f, x - b.x0) * smoothstep(-f, f, b.x1 - x) * smoothstep(-f, f, z - b.z0) * smoothstep(-f, f, b.z1 - z));
  }
  return w;
}

/** The raid arenas' floors: a flat plateau in the open world, where the instance puts its boss (data/raids.ts). */
export const RAID_FLOORS = {
  // Trono de Escarcha: a mesa past the frost peaks
  frost: { x: -660, z: -680, r: 26, h: 16 },
};
/** On a raid floor (or within `pad` metres of it): kept clear of trees and rocks, the boss fights there. */
export const onRaidFloor = (x: number, z: number, pad = 0) => Object.values(RAID_FLOORS).some((f) => Math.hypot(x - f.x, z - f.z) < f.r + pad);
/** The frost peaks (Picos Helados): [x, z, radius, height]. */
const PEAKS: [number, number, number, number][] = [
  [-520, -705, 55, 62], [-405, -600, 44, 42], [-565, -600, 48, 52], [-430, -720, 40, 38],
];
const SEED = 1337;

function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(SEED, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export const TOWN_HEIGHT = 2;

function segDist(px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Mountains: the first map's old border (unchanged inside it, falling away 80 m past it, cut by the passes) and the world's edge. */
function ridges(x: number, z: number, passes = true): number {
  const m = Math.max(Math.abs(x), Math.abs(z));
  let r = 0;
  const e = m / INNER_HALF;
  if (e > 0.82) {
    r = m <= INNER_HALF ? Math.pow((e - 0.82) / 0.18, 2) * 70 : 70 * (1 - smoothstep(INNER_HALF, INNER_HALF + 80, m));
    if (passes) for (const road of RING_ROADS) r *= smoothstep(10, 36, segDist(x, z, road));
  }
  const eo = m / WORLD_HALF;
  if (eo > 0.82) r += Math.pow((eo - 0.82) / 0.18, 2) * 70;
  return r;
}

export function heightAt(x: number, z: number): number {
  return terrainHeight(x, z, true);
}

/**
 * The first map's ground as it was before the passes were cut: its scatter (layout.ts) still decides where things go
 * with it, so the trees and rocks drawn from one random sequence stay exactly where they always were.
 */
export function firstMapHeightAt(x: number, z: number): number {
  return terrainHeight(x, z, false);
}

function terrainHeight(x: number, z: number, passes: boolean): number {
  let h = (fbm(x / 140, z / 140, 4) - 0.5) * 32 + (valueNoise(x / 25 + 100, z / 25) - 0.5) * 3;
  h += ridges(x, z, passes);
  if (passes) h = floors(x, z, roadBed(x, z, h + relief(x, z)));
  let t = 1;
  for (const tw of TOWNS) t = Math.min(t, smoothstep(tw.r + 5, tw.r + 45, Math.hypot(x - tw.x, z - tw.z)));
  return TOWN_HEIGHT + (h - TOWN_HEIGHT) * t;
}

/** The ring's landmarks, added on top of its rolling ground (nothing inside the first map's range). */
function relief(x: number, z: number): number {
  if (Math.max(Math.abs(x), Math.abs(z)) < 540) return 0;
  let h = 0;
  for (const [px, pz, r, ph] of PEAKS) {
    const d = Math.hypot(x - px, z - pz);
    if (d < r) h += ph * Math.pow(1 - d / r, 1.25) * (0.6 + 0.8 * valueNoise(x / 12 + 7, z / 12 - 3));
  }
  return h;
}

/** The raid floors flatten the ground under them, falling back to it over 16 m (cliffs, on the high ones). */
function floors(x: number, z: number, h: number): number {
  for (const f of Object.values(RAID_FLOORS)) {
    const t = smoothstep(f.r, f.r + 16, Math.hypot(x - f.x, z - f.z));
    if (t < 1) h = f.h + (h - f.h) * t;
  }
  return h;
}

/** The new roads keep their feet dry: a raised bed where they cross a pond or a pass floor below the water. */
function roadBed(x: number, z: number, h: number): number {
  if (h >= ROAD_BED) return h;
  let d = Infinity;
  for (const road of RING_ROADS) d = Math.min(d, segDist(x, z, road));
  return h + (ROAD_BED - h) * (1 - smoothstep(5, 14, d));
}

export function inTown(x: number, z: number): boolean {
  return TOWNS.some((tw) => Math.hypot(x - tw.x, z - tw.z) < tw.r + 5);
}

/** Small deterministic PRNG for decoration placement and spawns. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PLAYABLE_HALF = WORLD_HALF * 0.86;
/** Ponds fill the terrain's hollows up to this height. Shallow edges are waded, deeper water is swum. */
export const WATER_LEVEL = -7;
/** How high the new roads' bed stands where the ground under them dips into the water (roadBed). */
const ROAD_BED = WATER_LEVEL + 1.5;
/** Where a swimmer's feet hang: the water reaches the chest and the head stays out. */
export const SWIM_Y = WATER_LEVEL - 1.35;
/** Swimming speed, as a share of walking speed (the server applies it; the client predicts with it). */
export const SWIM_SPEED = 0.55;
/** Deep enough to swim: the ground is below a swimmer's feet. */
export const isDeep = (x: number, z: number) => heightAt(x, z) < SWIM_Y;
/** The server only has deep water on a 2 m grid (export-data): sampling the same cells keeps prediction in step. */
export const WATER_CELL = 2;
export const isDeepCell = (x: number, z: number) =>
  isDeep((Math.floor((x + WORLD_HALF) / WATER_CELL) + 0.5) * WATER_CELL - WORLD_HALF, (Math.floor((z + WORLD_HALF) / WATER_CELL) + 0.5) * WATER_CELL - WORLD_HALF);
/** Height a character stands (or floats) at: the ground, or the swimming line over deep water. */
export const bodyY = (x: number, z: number) => Math.max(heightAt(x, z), SWIM_Y);
