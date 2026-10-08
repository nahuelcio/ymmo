// Deterministic placement of world props (trees, rocks, town, zone props).
// Shared so the client renders exactly what the server collides against.
import { NPCS, TELEPORTS, ZONES } from './data/world';
import { CAMPS, type CampDef } from './data/camps';
import { heightAt, inTown, mulberry32, TOWN, WATER_LEVEL, WORLD_HALF } from './terrain';

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

/** Within r of a hostile camp's centre (keeps camps clear of trees and props). */
export function nearCamp(x: number, z: number, r: number): boolean {
  return CAMPS.some((c) => Math.hypot(x - c.x, z - c.z) < r);
}

export function zoneOf(x: number, z: number) {
  return ZONES.find((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r * 1.1);
}

export interface TreeL { x: number; z: number; h: number; rot: number; sc: number; dead: boolean; pine: boolean; hue: number; light: number }
export interface RockL { x: number; z: number; y: number; sc: number; e: [number, number, number]; s: [number, number, number]; light: number }
export interface HouseL { x: number; z: number; rot: number; w: number; d: number; wall: number; roof: number; kind?: 'hall' | 'tavern' | 'smithy' }
/** Houses of the ring (by index) that are a landmark instead: bigger footprint, own model on the client. */
const LANDMARKS: Record<number, Pick<HouseL, 'kind' | 'w' | 'd' | 'wall' | 'roof'> & { r: number }> = {
  1: { kind: 'hall', r: 39, w: 13, d: 10, wall: 0xb8b2a4, roof: 0x4a5a7a },
  2: { kind: 'tavern', r: 38.5, w: 12, d: 9, wall: 0xe0d4b8, roof: 0x8a3a2a },
  4: { kind: 'smithy', r: 38, w: 10, d: 8, wall: 0x8a8478, roof: 0x3a3a3a },
};
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
    if (h > 42 || h < WATER_LEVEL + 0.8 || nearCamp(x, z, 18)) continue; // no trees on peaks, in ponds or in camps
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
    const light = rng();
    if (!nearCamp(x, z, 17)) rocks.push({ x, z, y: heightAt(x, z) + sc * 0.2, sc, e, s, light });
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
    const lm = LANDMARKS[town.houses.length]; // the rng calls above stay the same, so the other houses don't move
    const hr = lm?.r ?? r;
    town.houses.push({ x: TOWN.x + Math.cos(a) * hr, z: TOWN.z + Math.sin(a) * hr, rot: -a - Math.PI / 2, w: lm?.w ?? w, d: lm?.d ?? d, wall: lm?.wall ?? wall, roof: lm?.roof ?? roof, kind: lm?.kind });
  }
  // merchant stalls behind NPCs
  for (const n of NPCS) {
    if (n.kind === 'talker' || n.kind === 'quest') continue;
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
  const clear = <T extends { x: number; z: number }>(l: T[]) => l.filter((p) => !nearCamp(p.x, p.z, 19));
  zp.tents = clear(zp.tents); zp.totems = clear(zp.totems); zp.ruins = clear(zp.ruins); zp.graves = clear(zp.graves); zp.huts = clear(zp.huts);
  return (zoneProps = zp);
}

export interface CampL {
  camp: CampDef;
  tents: { x: number; z: number; rot: number }[];
  walls: { x: number; z: number; rot: number }[];
  fire: { x: number; z: number };
  banner: { x: number; z: number };
}

let camps: CampL[] | null = null;
/** Hostile camp props: tents around a campfire, a broken palisade ring and the camp banner. */
export function layoutCamps(): CampL[] {
  if (camps) return camps;
  camps = CAMPS.map((camp) => {
    const rng = mulberry32(camp.x * 31 + camp.z);
    const tents = [0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + rng() * 0.5;
      return { x: camp.x + Math.cos(a) * 9, z: camp.z + Math.sin(a) * 9, rot: -a };
    });
    const walls: CampL['walls'] = [];
    for (let i = 0; i < 12; i++) {
      if (i % 4 === 0 || rng() < 0.25) continue; // gaps and broken stretches
      const a = (i / 12) * Math.PI * 2;
      walls.push({ x: camp.x + Math.cos(a) * 15, z: camp.z + Math.sin(a) * 15, rot: -a + Math.PI / 2 });
    }
    return { camp, tents, walls, fire: { x: camp.x, z: camp.z }, banner: { x: camp.x + 2.5, z: camp.z + 2.5 } };
  });
  return camps;
}
