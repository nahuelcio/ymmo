// Deterministic placement of world props (trees, rocks, town, zone props).
// Shared so the client renders exactly what the server collides against.
import { NPCS, TELEPORTS, ZONES } from './data/world';
import { heightAt, inTown, mulberry32, TOWN, WORLD_HALF } from './terrain';

/** Road segments from the village toward each hunting ground. */
export const ROADS: [number, number, number, number][] = TELEPORTS.map((t) => {
  const z = ZONES.find((zz) => zz.id === t.id)!;
  return [TOWN.x, TOWN.z, z.x, z.z];
});

function distToSegment(px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

export function roadDist(x: number, z: number): number {
  let d = Infinity;
  for (const r of ROADS) d = Math.min(d, distToSegment(x, z, r));
  return d;
}

export function zoneOf(x: number, z: number) {
  return ZONES.find((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r * 1.1);
}

export interface TreeL { x: number; z: number; h: number; rot: number; sc: number; dead: boolean; pine: boolean; hue: number; light: number }
export interface RockL { x: number; z: number; y: number; sc: number; e: [number, number, number]; s: [number, number, number]; light: number }
export interface HouseL { x: number; z: number; rot: number; w: number; d: number; wall: number; roof: number }
export interface StallL { x: number; z: number; rot: number; color: number }
export interface WallL { x: number; z: number; rot: number; tower: boolean }
export interface PillarL { x: number; z: number; rot: number }
export interface TownL { houses: HouseL[]; stalls: StallL[]; walls: WallL[]; gates: PillarL[] }
export interface ZonePropsL {
  tents: { x: number; z: number }[];
  totems: { x: number; z: number }[];
  ruins: { x: number; z: number; h: number; tilt: number }[];
  graves: { x: number; z: number; rot: number }[];
  huts: { x: number; z: number }[];
}

let trees: TreeL[] | null = null;
export function layoutTrees(): TreeL[] {
  if (trees) return trees;
  trees = [];
  const rng = mulberry32(7);
  const N = 2600;
  for (let i = 0; i < N * 3 && trees.length < N; i++) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.95, z = (rng() * 2 - 1) * WORLD_HALF * 0.95;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 14 || roadDist(x, z) < 6) continue;
    const h = heightAt(x, z);
    if (h > 42) continue;
    const zone = zoneOf(x, z);
    // keep hunting grounds a bit more open
    if (zone && rng() < 0.55) continue;
    const sc = 0.7 + rng() * 0.7;
    const rot = rng() * Math.PI * 2;
    const dead = zone?.id === 'wastes';
    let pine = false, hue = 0, light = 0;
    if (!dead) {
      pine = h > 10 || zone?.id === 'barracks' ? rng() < 0.8 : rng() < 0.35;
      hue = rng();
      light = rng();
    }
    trees.push({ x, z, h, rot, sc, dead, pine, hue, light });
  }
  return trees;
}

let rocks: RockL[] | null = null;
export function layoutRocks(): RockL[] {
  if (rocks) return rocks;
  rocks = [];
  const rng = mulberry32(99);
  while (rocks.length < 500) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.95, z = (rng() * 2 - 1) * WORLD_HALF * 0.95;
    if (inTown(x, z) || roadDist(x, z) < 4) continue;
    const sc = 0.3 + rng() * rng() * 2.5;
    const e: [number, number, number] = [rng() * 3, rng() * 3, rng() * 3];
    const s: [number, number, number] = [sc * (0.8 + rng() * 0.6), sc * (0.6 + rng() * 0.4), sc * (0.8 + rng() * 0.6)];
    rocks.push({ x, z, y: heightAt(x, z) + sc * 0.2, sc, e, s, light: rng() });
  }
  return rocks;
}

let town: TownL | null = null;
export function layoutTown(): TownL {
  if (town) return town;
  town = { houses: [], stalls: [], walls: [], gates: [] };
  const roadAngles = ROADS.map(([ax, az, bx, bz]) => Math.atan2(bz - az, bx - ax));
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const rng = mulberry32(3);
  // houses in a ring, leaving road gaps
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.1;
    if (roadAngles.some((ra) => angDiff(a, ra) < 0.32)) continue;
    const r = 32 + rng() * 8;
    const w = 5 + rng() * 3, d = 5 + rng() * 2;
    const wall = rng() < 0.5 ? 0xe0d4b8 : 0xd0c0a0, roof = rng() < 0.5 ? 0x8a3a2a : 0x4a5a7a;
    town.houses.push({ x: TOWN.x + Math.cos(a) * r, z: TOWN.z + Math.sin(a) * r, rot: -a - Math.PI / 2, w, d, wall, roof });
  }
  // merchant stalls behind NPCs
  for (const n of NPCS) {
    if (n.kind === 'talker') continue;
    const dirX = Math.sin(n.ry), dirZ = Math.cos(n.ry);
    town.stalls.push({ x: n.x - dirX * 1.6, z: n.z - dirZ * 1.6, rot: n.ry, color: n.color });
  }
  // palisade
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    if (roadAngles.some((ra) => angDiff(a, ra) < 0.12)) continue;
    const r = TOWN.r + 2;
    town.walls.push({ x: TOWN.x + Math.cos(a) * r, z: TOWN.z + Math.sin(a) * r, rot: -a + Math.PI / 2, tower: i % 6 === 0 });
  }
  // gate pillars at road exits
  for (const ra of roadAngles)
    for (const off of [-0.11, 0.11]) {
      const r = TOWN.r + 2;
      town.gates.push({ x: TOWN.x + Math.cos(ra + off) * r, z: TOWN.z + Math.sin(ra + off) * r, rot: -ra });
    }
  return town;
}

let zoneProps: ZonePropsL | null = null;
export function layoutZoneProps(): ZonePropsL {
  if (zoneProps) return zoneProps;
  const zp: ZonePropsL = { tents: [], totems: [], ruins: [], graves: [], huts: [] };
  const rng = mulberry32(11);
  const at = (zn: (typeof ZONES)[number], maxR: number, minR = 0) => {
    const a = rng() * Math.PI * 2, r = minR + rng() * maxR;
    return { x: zn.x + Math.cos(a) * r, z: zn.z + Math.sin(a) * r };
  };
  for (const zn of ZONES) {
    if (zn.id === 'barracks') {
      for (let i = 0; i < 10; i++) zp.tents.push(at(zn, zn.r * 0.7, 15));
      for (let i = 0; i < 8; i++) zp.totems.push(at(zn, zn.r * 0.8));
    }
    if (zn.id === 'wastes') {
      for (let i = 0; i < 30; i++) {
        const p = at(zn, zn.r * 0.9);
        zp.ruins.push({ ...p, h: 1 + rng() * 5, tilt: (rng() - 0.5) * 0.3 });
      }
      for (let i = 0; i < 40; i++) {
        const p = at(zn, zn.r * 0.9);
        zp.graves.push({ ...p, rot: rng() * 0.6 });
      }
    }
    if (zn.id === 'hills') for (let i = 0; i < 8; i++) zp.huts.push(at(zn, zn.r * 0.8));
  }
  return (zoneProps = zp);
}
