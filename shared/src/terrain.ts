// Deterministic terrain shared by server and client so both agree on ground height.

export const WORLD_HALF = 500;
export const TOWN = { x: 0, z: 0, r: 50, name: 'Aldea del Alba' };
/** Second town, down a road of its own between the Goblin Hills and the Sunken Ruins: the gear for levels 20-40 is sold here. */
export const DUSK = { x: 170, z: -170, r: 30, name: 'Bastión del Ocaso' };
/** Peace zones on flattened ground. TOWN is the starting village. */
export const TOWNS = [TOWN, DUSK];
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

export function heightAt(x: number, z: number): number {
  let h = (fbm(x / 140, z / 140, 4) - 0.5) * 32 + (valueNoise(x / 25 + 100, z / 25) - 0.5) * 3;
  const e = Math.max(Math.abs(x), Math.abs(z)) / WORLD_HALF;
  if (e > 0.82) h += Math.pow((e - 0.82) / 0.18, 2) * 70;
  let t = 1;
  for (const tw of TOWNS) t = Math.min(t, smoothstep(tw.r + 5, tw.r + 45, Math.hypot(x - tw.x, z - tw.z)));
  return TOWN_HEIGHT + (h - TOWN_HEIGHT) * t;
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
/** Ponds fill the terrain's hollows up to this height (visual only: shallow, wadeable). */
export const WATER_LEVEL = -7;
