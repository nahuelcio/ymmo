// Deterministic placement of world props (trees, rocks, town, zone props).
// Shared so the client renders exactly what the server collides against.
import { NPCS, ZONES } from './data/world';
import { CAMPS, type CampDef } from './data/camps';
import { biomeWeight, forestAt, FORESTS, heightAt, inTown, inCrater, landAt, onRaidFloor, mulberry32, PLAYABLE_HALF, regionAt, ROAD_SEGS, TOWN, TOWNS, WATER_LEVEL } from './terrain';
import { ALBA_STAMPS, albaCurtain, fortCurtain, FORTS } from './village';

/** Every road segment (terrain.ts ROAD_LINES): town to town through the passes, and out to the hunting grounds. */
export const ROADS: [number, number, number, number][] = ROAD_SEGS;

function distToSegment(px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** A random spot on the continent's land (null when the draw falls in the sea: the caller tries again). */
const landSpot = (rng: () => number): [number, number] | null => {
  const x = (rng() * 2 - 1) * PLAYABLE_HALF, z = (rng() * 2 - 1) * PLAYABLE_HALF;
  return landAt(x, z) > 0.5 ? [x, z] : null;
};

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
  /** ry: the way the door faces (forward is (sin ry, cos ry)) */
  tents: { x: number; z: number; ry: number }[];
  totems: { x: number; z: number }[];
  ruins: { x: number; z: number; h: number; tilt: number }[];
  graves: { x: number; z: number; rot: number }[];
  /** ry: the door, as for tents */
  huts: { x: number; z: number; ry: number }[];
}

/** A tree at (x, z), or null where none grows. */
function placeTree(rng: () => number, x: number, z: number, forest = false, giant = false): TreeL | null {
  if (TOWNS.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 14) || roadDist(x, z) < 6 || onRaidFloor(x, z, 6) || inCrater(x, z, 4)) return null;
  const h = heightAt(x, z);
  if (h > 42 || h < WATER_LEVEL + 0.8 || nearCamp(x, z, 18)) return null; // no trees on peaks, in ponds or in camps
  const zone = zoneOf(x, z);
  // keep hunting grounds a bit more open
  if (zone && !forest && rng() < 0.55) return null;
  // the Burning Steppes are open grassland: a lone tree here and there
  if (zone?.id === 'steppes' && rng() < 0.75) return null;
  // trees grow half again as big in the jungle; the giants' wood grows them 4-7x
  const sc = (0.7 + rng() * 0.7) * (1 + 0.5 * biomeWeight('swamp', x, z)) * (giant ? 4 + rng() * 3 : 1);
  const rot = rng() * Math.PI * 2;
  // dead trees in the cursed wastes and all over the ash of the volcanic region
  const dead = zone?.id === 'wastes' || biomeWeight('ash', x, z) > 0.5;
  let pine = false, hue = 0, light = 0;
  if (!dead) {
    // pines up high and in the orc barracks; only pines under the frost region's snow
    pine = h > 10 || zone?.id === 'barracks' ? rng() < 0.8 : rng() < 0.35;
    if (biomeWeight('frost', x, z) > 0.5) pine = true;
    // the swamp and jungle grow broad trees only
    if (biomeWeight('swamp', x, z) > 0.5 || giant) pine = false;
    hue = rng();
    light = rng();
  }
  return { x, z, h, rot, sc, dead, pine, hue, light };
}

let trees: TreeL[] | null = null;
export function layoutTrees(): TreeL[] {
  if (trees) return trees;
  trees = [];
  // open country: a sparse scatter over the continent (gathering nodes are numbered by this order)
  const rng = mulberry32(7), OPEN_N = 4500;
  for (let i = 0, n = 0; i < OPEN_N * 4 && n < OPEN_N; i++) {
    const p = landSpot(rng);
    const t = p && forestAt(p[0], p[1]) < 0.2 && placeTree(rng, p[0], p[1]);
    if (t) (trees.push(t), n++);
  }
  // the named forests (terrain.ts FORESTS): close canopy, one tree per FOREST_AREA m² of cover, clearings left open
  // ponytail: density is one constant for every forest; give FORESTS their own if one should read thinner
  const thick = mulberry32(9), FOREST_AREA = 70, GIANT_AREA = 500;
  for (const w of FORESTS) {
    // the giants' wood: one huge tree per GIANT_AREA m², never closer than 0.9x their own trunk-to-trunk span
    const area = w.giant ? GIANT_AREA : FOREST_AREA, mine: TreeL[] = [];
    const want = Math.round((Math.PI * w.r * w.r * 0.6) / area);
    for (let i = 0, n = 0; i < want * 3 && n < want; i++) {
      const a = thick() * Math.PI * 2, r = Math.sqrt(thick()) * w.r, x = w.x + Math.cos(a) * r, z = w.z + Math.sin(a) * r;
      if (thick() > forestAt(x, z)) continue;
      const t = placeTree(thick, x, z, true, w.giant);
      if (!t || (w.giant && mine.some((o) => Math.hypot(o.x - t.x, o.z - t.z) < 1.6 * (o.sc + t.sc)))) continue;
      trees.push(t), mine.push(t), n++;
    }
  }
  // groves: small clumps of 5-12 trees scattered over the open country, so the plains are not one even sprinkle.
  // Appended last on purpose: every tree above keeps its index, so the gathering nodes keep their ids.
  const grove = mulberry32(13), GROVES = 700;
  for (let g = 0; g < GROVES; g++) {
    const c = landSpot(grove);
    if (!c || forestAt(c[0], c[1]) > 0.2) continue;
    const n = 5 + Math.floor(grove() * 8), r = 6 + grove() * 9;
    for (let i = 0; i < n; i++) {
      const a = grove() * Math.PI * 2, d = Math.sqrt(grove()) * r;
      const t = placeTree(grove, c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d);
      if (t) trees.push(t);
    }
  }
  return trees;
}

/**
 * Grass cells: a grid over the continent's square, only the cells with land at a corner or the middle. Each brings the
 * seed for its own tufts (`draws`: random numbers one cell takes).
 */
export function detailCells(chunk: number, draws: number): { x0: number; z0: number; seed: number }[] {
  const out: { x0: number; z0: number; seed: number }[] = [];
  // mulberry32 only counts (a fixed step per draw): the seed a cell's stretch of one long sequence starts from is
  // known without drawing the cells before it, so a cell can be built alone, in any order, always the same
  const at = (seed: number, i: number) => (seed + Math.imul(i * draws, 0x6d2b79f5)) >>> 0;
  const n = Math.ceil((PLAYABLE_HALF * 2) / chunk), lo = -(n * chunk) / 2;
  const land = (x: number, z: number) => landAt(x, z) > 0;
  for (let cx = 0, i = 0; cx < n; cx++)
    for (let cz = 0; cz < n; cz++, i++) {
      const x0 = lo + cx * chunk, z0 = lo + cz * chunk, x1 = x0 + chunk, z1 = z0 + chunk;
      if (land(x0, z0) || land(x1, z0) || land(x0, z1) || land(x1, z1) || land(x0 + chunk / 2, z0 + chunk / 2)) out.push({ x0, z0, seed: at(77, i) });
    }
  return out;
}

/** Ground where grass and bushes grow: dry land off the roads, out of towns and camps, below the bare peaks. */
export function fertile(x: number, z: number, h: number): boolean {
  // nothing grows under the frost region's snow
  return h > WATER_LEVEL + 1.2 && h < 22 && !inTown(x, z) && roadDist(x, z) > 3.2 && !nearCamp(x, z, 16) && biomeWeight('frost', x, z) < 0.5 && biomeWeight('ash', x, z) < 0.5 && !onRaidFloor(x, z, 2);
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
  const rng = mulberry32(21), BUSH_N = 5000;
  for (let i = 0; i < BUSH_N * 5 && bushes.length < BUSH_N; i++) {
    const p = landSpot(rng);
    if (!p) continue;
    const [x, z] = p, h = heightAt(x, z);
    if (!fertile(x, z, h) || zoneOf(x, z)?.id === 'wastes') continue;
    const sc = 0.7 + rng() * 0.8;
    const u = spotHash(x, z);
    const rot = rng() * 6.3;
    // a third of the plain (non-flowering) bushes bear fruit
    bushes.push({ x, z, h, sc, rot, u, fruit: u >= 0.18 && spotHash(x + 0.37, z - 0.71) < 0.35 });
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
  const rng = mulberry32(99), ROCK_N = 2500;
  for (let i = 0; i < ROCK_N * 6 && rocks.length < ROCK_N; i++) {
    const p = landSpot(rng);
    if (!p) continue;
    const [x, z] = p;
    if (inTown(x, z) || roadDist(x, z) < 4 || onRaidFloor(x, z, 4) || inCrater(x, z, 4) || heightAt(x, z) < WATER_LEVEL) continue;
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
  // the village is a fixed grid of kit buildings (shared/src/village.ts), not the old ring
  for (const s of ALBA_STAMPS)
    town.houses.push({ x: TOWN.x + s.x, z: TOWN.z + s.z, rot: s.rot, w: s.w, d: s.d, wall: s.wall, roof: s.roof, kind: s.kind });
  // merchant stalls: beside an Alba shop (behind it would sit inside a wall); elsewhere, behind the NPC.
  // Step aside until the counter clears every resident, not only its owner.
  for (const n of NPCS) {
    if (n.kind === 'talker' || n.kind === 'quest' || n.kind === 'clan') continue;
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
  // the forts (the Bastión and the ring's towns): kit buildings inside a stone wall with a gate on each road (shared/src/village.ts)
  for (const f of FORTS) {
    for (const s of f.stamps)
      town.houses.push({ x: s.x, z: s.z, rot: s.rot, w: s.w, d: s.d, wall: s.wall, roof: s.roof, kind: s.kind, out: true });
    for (const w of fortCurtain(f).walls) town.walls.push({ ...w, out: true });
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
      // the doors face the middle of the barracks
      for (let i = 0; i < 10; i++) {
        const p = at(zn, zn.r * 0.7, 15);
        zp.tents.push({ ...p, ry: Math.atan2(zn.x - p.x, zn.z - p.z) });
      }
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
    // the doors face the middle of the hills
    if (zn.id === 'hills') for (let i = 0; i < 8; i++) {
      const p = at(zn, zn.r * 0.8);
      zp.huts.push({ ...p, ry: Math.atan2(zn.x - p.x, zn.z - p.z) });
    }
  }
  // waysides: every ~170 m of road, a little off to one side, a travelers' camp, a hut or a ring of old pillars
  // (own rng, so the zones' props above keep their places)
  const wr = mulberry32(12);
  ROADS.forEach(([ax, az, bx, bz], si) => {
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len;
    for (let d = 60; d < len - 40; d += 150 + wr() * 60) {
      const side = (si + d) % 2 < 1 ? 1 : -1, off = 13 + wr() * 6, t = d / len;
      const x = ax + (bx - ax) * t + nx * off * side, z = az + (bz - az) * t + nz * off * side;
      const kind = wr();
      if (inTown(x, z) || heightAt(x, z) < WATER_LEVEL + 1 || roadDist(x, z) < 9) continue;
      // the doors face the road
      const ry = Math.atan2(-nx * side, -nz * side);
      if (kind < 0.4) zp.tents.push({ x, z, ry }, { x: x + nx * 6 * side + (bx - ax) / len * 4, z: z + nz * 6 * side + (bz - az) / len * 4, ry });
      else if (kind < 0.7) zp.huts.push({ x, z, ry });
      else for (let k = 0; k < 7; k++) {
        if (wr() < 0.25) continue; // a fallen one here and there
        const a = (k / 7) * Math.PI * 2;
        zp.ruins.push({ x: x + Math.cos(a) * 6, z: z + Math.sin(a) * 6, h: 1.5 + wr() * 4, tilt: (wr() - 0.5) * 0.25 });
      }
    }
  });
  const clear = <T extends { x: number; z: number }>(l: T[]) => l.filter((p) => !nearCamp(p.x, p.z, 19));
  zp.tents = clear(zp.tents); zp.totems = clear(zp.totems); zp.ruins = clear(zp.ruins); zp.graves = clear(zp.graves); zp.huts = clear(zp.huts);
  return (zoneProps = zp);
}

export interface CampL {
  camp: CampDef;
  /** ry: the way the door faces, towards the fire (forward is (sin ry, cos ry)) */
  tents: { x: number; z: number; rot: number; ry: number }[];
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
      return { x: camp.x + Math.cos(a) * 9, z: camp.z + Math.sin(a) * 9, rot: -a, ry: Math.atan2(-Math.cos(a), -Math.sin(a)) };
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

/** Wild game per region (the farm animals graze around Alba and the Dusk bastion instead): herds placed in the open, off zones, towns and camps. */
const HERD_KINDS: { region: string | null; mob: string; herds: number; size: [number, number] }[] = [
  { region: 'dawn', mob: 'stag', herds: 22, size: [2, 4] },
  { region: 'dusk', mob: 'wild_horse', herds: 16, size: [3, 5] },
  { region: 'heart', mob: 'wild_horse', herds: 16, size: [3, 5] },
  { region: 'dragon', mob: 'bull', herds: 14, size: [2, 3] },
  { region: 'frost', mob: 'alpaca', herds: 14, size: [2, 4] },
];
const FARMS: { x: number; z: number; mob: string }[] = [
  { x: TOWN.x + 90, z: TOWN.z - 40, mob: 'cow' }, { x: TOWN.x - 85, z: TOWN.z - 60, mob: 'cow' }, { x: TOWN.x + 30, z: TOWN.z - 110, mob: 'donkey' },
];
export interface HerdL { mob: string; x: number; z: number; count: number }
let herds: HerdL[] | null = null;
export function layoutHerds(): HerdL[] {
  if (herds) return herds;
  herds = FARMS.map((f) => ({ ...f, count: 4 }));
  const rng = mulberry32(17);
  for (const k of HERD_KINDS) {
    for (let n = 0, tries = 0; n < k.herds && tries < 4000; tries++) {
      const p = landSpot(rng);
      if (!p) continue;
      const [x, z] = p, h = heightAt(x, z);
      if (regionAt(x, z) !== k.region || zoneOf(x, z) || TOWNS.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 40) || nearCamp(x, z, 40)) continue;
      if (h < WATER_LEVEL + 1 || h > 30 || roadDist(x, z) < 8) continue;
      herds.push({ mob: k.mob, x, z, count: k.size[0] + Math.floor(rng() * (k.size[1] - k.size[0] + 1)) });
      n++;
    }
  }
  return herds;
}
