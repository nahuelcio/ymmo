// Deterministic placement of world props (trees, rocks, town, zone props).
// Shared so the client renders exactly what the server collides against.
import { NPCS, ZONES } from './data/world';
import { CAMPS, type CampDef } from './data/camps';
import { DUSK, heightAt, inTown, mulberry32, TOWN, TOWNS, WATER_LEVEL, WORLD_HALF } from './terrain';
import { ALBA_STAMPS, albaCurtain } from './village';

/**
 * Road segments from the village: one toward each hunting ground around it and one to the second town.
 * The 20-50 zones have no road (you get there by Gatekeeper): every road opens a gate in the village
 * palisade and takes the houses in its way, which would move the landmarks the NPCs stand by.
 */
export const ROADS: [number, number, number, number][] = [
  ...['meadows', 'hills', 'barracks', 'wastes'].map((id) => ZONES.find((z) => z.id === id)!),
  DUSK,
].map((to) => [TOWN.x, TOWN.z, to.x, to.z]);

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
/** out: part of the second town (the village's own dressing skips those) */
export interface HouseL { x: number; z: number; rot: number; w: number; d: number; wall: number; roof: number; kind?: 'hall' | 'tavern' | 'smithy'; out?: boolean }
export interface StallL { x: number; z: number; rot: number; color: number }
/** hw/hd: half-extents of a kit wall module. Omitted, a wall is the old 7.2 m log run. */
export interface WallL { x: number; z: number; rot: number; tower: boolean; out?: boolean; hw?: number; hd?: number }
export interface PillarL { x: number; z: number; rot: number; out?: boolean }
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
    if (TOWNS.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 14) || roadDist(x, z) < 6) continue;
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

/** Ground where grass and bushes grow: dry land off the roads, out of towns and camps, below the bare peaks. */
export function fertile(x: number, z: number, h: number): boolean {
  return h > WATER_LEVEL + 1.2 && h < 22 && !inTown(x, z) && roadDist(x, z) > 3.2 && !nearCamp(x, z, 16);
}

/** A stable pseudo-random value in [0, 1) for a spot (picks models and variants without an rng). */
export function spotHash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * u: spotHash of the spot (under 0.18 a flowering bush); sc: the size before the client fits the model;
 * fruit: carries berries that can be picked (shared/src/nodes.ts).
 */
export interface BushL { x: number; z: number; h: number; sc: number; rot: number; u: number; fruit: boolean }

let bushes: BushL[] | null = null;
export function layoutBushes(): BushL[] {
  if (bushes) return bushes;
  bushes = [];
  // the exact rng sequence the client drew these with before they were shared: change nothing here
  const rng = mulberry32(21);
  for (let i = 0, n = 0; i < 4000 && n < 1400; i++) {
    const x = (rng() * 2 - 1) * WORLD_HALF * 0.9, z = (rng() * 2 - 1) * WORLD_HALF * 0.9, h = heightAt(x, z);
    if (!fertile(x, z, h) || zoneOf(x, z)?.id === 'wastes') continue;
    const sc = 0.7 + rng() * 0.8;
    rng(); // the old blob's vertical squash; kept so later samples stay put
    const u = spotHash(x, z);
    const rot = rng() * 6.3;
    // a third of the plain (non-flowering) bushes bear fruit
    bushes.push({ x, z, h, sc, rot, u, fruit: u >= 0.18 && spotHash(x + 0.37, z - 0.71) < 0.35 });
    n++;
  }
  return bushes;
}

/** The village plaza's benches, on the ring around the bell tower, their backs to it. a: angle on the ring. */
export function plazaBenches(): { x: number; z: number; a: number }[] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    return { x: TOWN.x + Math.cos(a) * 9.5, z: TOWN.z + Math.sin(a) * 9.5, a };
  });
}

/** How far behind the feet the sitting clip lowers the hips (measured on the Sitting_Idle_Loop pelvis). */
export const SEAT_FRONT = 0.3;

/** A place to sit: where the body goes, which way it faces, and how high the seat is above the ground. */
export interface SeatL { x: number; z: number; ry: number; y: number }

let seats: SeatL[] | null = null;
export function layoutSeats(): SeatL[] {
  if (seats) return seats;
  seats = [];
  for (const b of plazaBenches()) {
    // facing away from the tower; two places along the bench. The sitting clip keeps the feet where the body stands
    // and lowers the hips SEAT_FRONT behind them, so the body stands that far in front of the seat's middle.
    const ry = Math.atan2(Math.cos(b.a), Math.sin(b.a));
    const along = { x: Math.cos(ry), z: -Math.sin(ry) }, front = { x: Math.sin(ry) * SEAT_FRONT, z: Math.cos(ry) * SEAT_FRONT };
    for (const s of [-0.5, 0.5]) seats.push({ x: b.x + along.x * s + front.x, z: b.z + along.z * s + front.z, ry, y: 0.5 });
  }
  return seats;
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
  // the village is a fixed grid of kit buildings (shared/src/village.ts), not the old ring
  for (const s of ALBA_STAMPS)
    town.houses.push({ x: TOWN.x + s.x, z: TOWN.z + s.z, rot: s.rot, w: s.w, d: s.d, wall: s.wall, roof: s.roof, kind: s.kind });
  // merchant stalls: beside an Alba shop (behind it would sit inside a wall); elsewhere, behind the NPC.
  // Step aside until the counter clears every resident, not only its owner.
  for (const n of NPCS) {
    if (n.kind === 'talker' || n.kind === 'quest') continue;
    const dirX = Math.sin(n.ry), dirZ = Math.cos(n.ry);
    const albaShop = n.kind === 'shop' && Math.hypot(n.x - TOWN.x, n.z - TOWN.z) < TOWN.r;
    const at = (lx: number, lz: number) => ({ x: n.x + lx * dirZ + lz * dirX, z: n.z - lx * dirX + lz * dirZ });
    const covers = (x: number, z: number) => NPCS.some((o) => {
      const dx = o.x - x, dz = o.z - z;
      const c = Math.cos(n.ry), s = Math.sin(n.ry);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const cx = Math.max(-1.6, Math.min(1.6, lx)), cz = Math.max(-0.55, Math.min(0.55, lz));
      const ox = lx - cx, oz = lz - cz, d2 = ox * ox + oz * oz;
      return d2 <= 1e-8 || d2 < 0.45 * 0.45;
    });
    const tries: [number, number][] = albaShop ? [[2.4, 0], [-2.4, 0], [3.6, 0], [-3.6, 0], [0, -2.4]] : [[0, -1.6], [2.6, 0], [-2.6, 0], [0, -2.6]];
    const spot = tries.map(([lx, lz]) => at(lx, lz)).find((p) => !covers(p.x, p.z)) ?? at(0, -2.6);
    town.stalls.push({ x: spot.x, z: spot.z, rot: n.ry, color: n.color });
  }
  // stone curtain: wall runs, an open gate on every road, a tower midway along each span
  for (const w of albaCurtain().walls) town.walls.push(w);
  // the second town: a smaller ring of dark stone houses inside its own palisade, with a gate where the road
  // from the village comes in and another on the far side, toward the ruins
  const back = Math.atan2(TOWN.z - DUSK.z, TOWN.x - DUSK.x), gateAngles = [back, back + Math.PI];
  const rng2 = mulberry32(17);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    if (gateAngles.some((ga) => angDiff(a, ga) < 0.42)) continue;
    const r = DUSK.r - 9 + rng2() * 3;
    town.houses.push({ x: DUSK.x + Math.cos(a) * r, z: DUSK.z + Math.sin(a) * r, rot: -a - Math.PI / 2, w: 5 + rng2() * 2, d: 4.5 + rng2() * 1.5, wall: rng2() < 0.5 ? 0x8a8478 : 0x9a8f80, roof: rng2() < 0.5 ? 0x3a3a44 : 0x5a2a2a, out: true });
  }
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, r = DUSK.r + 2;
    if (gateAngles.some((ga) => angDiff(a, ga) < 0.2)) continue;
    town.walls.push({ x: DUSK.x + Math.cos(a) * r, z: DUSK.z + Math.sin(a) * r, rot: -a + Math.PI / 2, tower: i % 7 === 0, out: true });
  }
  for (const ga of gateAngles)
    for (const off of [-0.18, 0.18]) town.gates.push({ x: DUSK.x + Math.cos(ga + off) * (DUSK.r + 2), z: DUSK.z + Math.sin(ga + off) * (DUSK.r + 2), rot: -ga, out: true });
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
