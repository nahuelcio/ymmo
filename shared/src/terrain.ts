// Deterministic terrain shared by server and client so both agree on ground height.
//
// The world is one irregular continent in a sea, 4 km a side. Progression runs south (+z, levels 1-15) to north
// (-z, 70-78) through bands of land split by mountain ranges, crossed by the roads at their passes.

export const WORLD_HALF = 2000;
export const TOWN = { x: 0, z: 1360, r: 50, name: 'Aldea del Alba' };
/** Second town, past the first range: the gear for levels 20-40 is sold here. */
export const DUSK = { x: 180, z: 730, r: 30, name: 'Bastión del Ocaso' };
/** Fuerte de Escarcha, for levels 50-60 (north-west). Walled like the Bastión (shared/src/village.ts FORTS). */
export const FROST = { x: -520, z: -900, r: 34, name: 'Fuerte de Escarcha' };
/** ...Juncoverde for 60-70, by the swamp (north-east). */
export const REED = { x: 680, z: -880, r: 34, name: 'Juncoverde' };
/** ...and Brasaoscura for 70-78, the last wall before the Abyss (far north). */
export const EMBER = { x: 40, z: -1420, r: 34, name: 'Brasaoscura' };
/** Fuerte Escama, for levels 40-50, at the crossroads of the Dragon lands: the Dragon set (grade C) is sold here. */
export const SCALE = { x: 40, z: -450, r: 34, name: 'Fuerte Escama' };
/** Peace zones on flattened ground. TOWN is the starting village. */
export const TOWNS = [TOWN, DUSK, FROST, REED, EMBER, SCALE];

type Pt = [number, number];
type Seg = [number, number, number, number];

/**
 * The roads, as polylines. Town-to-town roads cross the ranges at their passes (the range is cut where a road runs);
 * the short ones branch to the hunting grounds. A town's gates face the first leg of each road that starts or ends
 * at its centre (roadLegs): the Bastión's two (south-west, north-east) are the ones its fixed plan was drawn for.
 */
export const ROAD_LINES: Pt[][] = [
  // Alba -> range A -> Bastión
  [[0, 1360], [60, 1150], [100, 1000], [135, 775], [180, 730]],
  // Bastión -> range B -> the Heart -> range C -> Fuerte Escama, in the Dragon lands -> range D -> the north crossroads
  // (two lines meeting at the fort, so each road out of it gets a gate)
  [[180, 730], [240, 670], [220, 450], [150, 200], [60, -200], [40, -450]],
  [[40, -450], [20, -700], [40, -800]],
  // crossroads -> Fuerte de Escarcha; crossroads -> range E -> Juncoverde
  [[40, -800], [-200, -860], [-520, -900]],
  [[40, -800], [180, -820], [400, -860], [680, -880]],
  // both northern forts -> range F -> Brasaoscura
  [[-520, -900], [-420, -1100], [-250, -1250], [-100, -1380], [40, -1420]],
  [[680, -880], [560, -1180], [400, -1250], [200, -1400], [40, -1420]],
  // branches to the hunting grounds
  [[0, 1360], [340, 1380]], [[0, 1360], [-380, 1340]], [[30, 1255], [-120, 1170]],
  [[121, 865], [-330, 720]], [[240, 670], [1100, 760]],
  [[150, 200], [320, 160], [850, 120]], [[150, 200], [-700, 140]],
  [[40, -450], [380, -450]], [[40, -450], [-420, -460]],
  [[-200, -860], [-180, -980]], [[-520, -900], [-900, -1000]], [[680, -880], [980, -850]],
  [[40, -1420], [-450, -1450]], [[40, -1420], [480, -1460]],
];
const segsOf = (l: Pt[]): Seg[] => l.slice(1).map((p, i) => [l[i][0], l[i][1], p[0], p[1]]);
export const ROAD_SEGS: Seg[] = ROAD_LINES.flatMap(segsOf);
/** Kept under its old name for the map (client/src/ui/minimap.ts): every road segment. */
export const RING_ROADS = ROAD_SEGS;
/** Where each road out of a town heads first: one gate faces each. */
export function roadLegs(t: { x: number; z: number }): Pt[] {
  const at = (p: Pt) => Math.hypot(p[0] - t.x, p[1] - t.z) < 1;
  const out: Pt[] = [];
  for (const l of ROAD_LINES) {
    if (at(l[0])) out.push(l[1]);
    if (at(l[l.length - 1])) out.push(l[l.length - 2]);
  }
  return out;
}

/** The regions' borders (no mountains along them: the regions blend into each other). A-F run west-east; E splits the north. */
const RANGE_A: Pt[] = [[-2100, 980], [-700, 1040], [-250, 990], [250, 1020], [700, 960], [2100, 1010]];
const RANGE_B: Pt[] = [[-2100, 470], [-600, 430], [0, 470], [600, 420], [2100, 460]];
const RANGE_C: Pt[] = [[-2100, -170], [-700, -230], [0, -190], [700, -240], [2100, -200]];
const RANGE_D: Pt[] = [[-2100, -680], [-600, -720], [0, -690], [180, -693], [600, -700], [2100, -680]];
const RANGE_F: Pt[] = [[-2100, -1240], [-600, -1270], [0, -1250], [220, -1258], [600, -1280], [2100, -1250]];
const RANGE_E: Pt[] = [[180, -693], [140, -1000], [220, -1258]];

/** Rivers to the sea (deep: swum across; the roads cross on a raised bed) and lakes. */
const RIVERS: Pt[][] = [
  // through the Heart and the Sunken Ruins' lake to the east coast
  [[-300, -120], [-150, 40], [60, 90], [250, 230], [430, 290], [700, 330], [1000, 380], [1600, 420]],
  // down the west of the first lands to the south-west coast
  [[-560, 1060], [-640, 1250], [-800, 1450], [-1100, 1600], [-1500, 1800]],
];
const RIVER_W = 12;
const VALLEY_W = 170;
const RIVER_SEGS = RIVERS.flatMap(segsOf).map(boxed(VALLEY_W));
const LAKES: [number, number, number][] = [[430, 290, 60], [250, 1180, 45], [-300, -780, 55], [600, -300, 55]];

/** Islands and a western peninsula off the coast: [ax, az, bx, bz, r] capsules of land (a disc when a = b). */
const ISLES: [number, number, number, number, number][] = [
  [1480, 1250, 1480, 1250, 90], [-1560, -420, -1560, -420, 110], [1460, -700, 1460, -700, 80], [-1250, 620, -1640, 560, 110],
];
/** A mesa in the Burning Steppes (cliffs all round) and a dry canyon cut across the Heart's west. */
const PLATEAU = { x: -880, z: -40, r: 130, h: 20 };
const CANYON: Seg = [-1000, 330, -480, 380];

/**
 * The named forests: close canopy inside (forestAt near 1, with clearings), thinning out over their last 40%.
 * layout.ts plants trees by forestAt; the open country between them gets a sparse scatter.
 */
/** giant: a wood of huge trees (layout.ts scales them 4-7x and spaces them out). */
export const FORESTS: { id: string; name: string; x: number; z: number; r: number; giant?: boolean }[] = [
  { id: 'alba_wood', name: 'Bosque del Alba', x: 200, z: 1170, r: 150 },
  { id: 'goblin_grove', name: 'Arboleda Goblin', x: -560, z: 1230, r: 150 },
  { id: 'gloomwood', name: 'Bosque Sombrío', x: -120, z: 860, r: 160 },
  { id: 'whisper_wood', name: 'Bosque de los Susurros', x: -300, z: 260, r: 180 },
  { id: 'eastwood', name: 'Fronda del Levante', x: 620, z: 0, r: 140 },
  { id: 'dragon_pines', name: 'Pinar del Dragón', x: 120, z: -480, r: 150 },
  { id: 'frost_pines', name: 'Pinar Helado', x: -480, z: -1110, r: 150 },
  { id: 'giants', name: 'Bosque de los Gigantes', x: 450, z: -170, r: 170, giant: true },
  { id: 'old_jungle', name: 'Selva Antigua', x: 560, z: -1060, r: 230 },
];
/** Forest cover at (x, z): 0 open country, 1 deep forest (clearings open inside). */
export function forestAt(x: number, z: number): number {
  let f = 0;
  for (const w of FORESTS) {
    const d = Math.hypot(x - w.x, z - w.z);
    if (d < w.r) f = Math.max(f, smoothstep(w.r, w.r * 0.6, d + (valueNoise(x / 45 + 3, z / 45) - 0.5) * 40));
  }
  // clearings
  return f && f * smoothstep(0.25, 0.4, valueNoise(x / 55 - 17, z / 55 + 29));
}

/**
 * The big named regions, south to north: polygons in world XZ along the ranges' crests (reaching past the coast;
 * landAt draws the shore). x/z: where a label goes. The map tints by them, the sky picks its palette by them.
 */
const rev = (l: Pt[]) => [...l].reverse();
const E = 2100;
export const REGIONS: { id: string; name: string; levels: string; x: number; z: number; poly: Pt[] }[] = [
  { id: 'dawn', name: 'Tierras del Alba', levels: '1-15', x: 0, z: 1350, poly: [...RANGE_A, [E, E], [-E, E]] },
  { id: 'dusk', name: 'Marcas del Ocaso', levels: '15-25', x: 200, z: 760, poly: [...RANGE_B, ...rev(RANGE_A)] },
  { id: 'heart', name: 'Corazón de la Tierra', levels: '25-40', x: 100, z: 120, poly: [...RANGE_C, ...rev(RANGE_B)] },
  { id: 'dragon', name: 'Dominio del Dragón', levels: '40-50', x: 0, z: -450, poly: [...RANGE_D, ...rev(RANGE_C)] },
  { id: 'frost', name: 'Tierras Heladas', levels: '50-60', x: -500, z: -980, poly: [...RANGE_D.slice(0, 4), RANGE_E[1], ...rev(RANGE_F.slice(0, 4))] },
  { id: 'swamp', name: 'Ciénagas Verdes', levels: '60-70', x: 650, z: -1000, poly: [...RANGE_D.slice(3), ...rev(RANGE_F.slice(3)), RANGE_E[1]] },
  { id: 'ash', name: 'Tierras de Ceniza', levels: '70-78', x: 0, z: -1500, poly: [...RANGE_F, [E, -E], [-E, -E]] },
];
const REGION_BOX = REGIONS.map((r) => ({
  r, x0: Math.min(...r.poly.map((p) => p[0])), x1: Math.max(...r.poly.map((p) => p[0])),
  z0: Math.min(...r.poly.map((p) => p[1])), z1: Math.max(...r.poly.map((p) => p[1])),
}));

function inPoly(poly: Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
/** Id of the region containing (x, z) (sea included: pair it with landAt), or null past them all. */
export function regionAt(x: number, z: number): string | null {
  for (const b of REGION_BOX) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inPoly(b.r.poly, x, z)) return b.r.id;
  return null;
}

/** The regions the renderer and the layout dress apart (autumn, snow, jungle, ash...): any REGIONS id. */
export type BiomeId = 'dawn' | 'dusk' | 'heart' | 'dragon' | 'frost' | 'swamp' | 'ash';
const BIOME_FADE = 100;
/** How much of a biome covers (x, z): 0 outside its region, 1 well inside, soft over BIOME_FADE metres at the border. */
export function biomeWeight(id: BiomeId, x: number, z: number): number {
  const f = BIOME_FADE / 2;
  const b = REGION_BOX.find((r) => r.r.id === id)!;
  if (x < b.x0 - f || x > b.x1 + f || z < b.z0 - f || z > b.z1 + f) return 0;
  const poly = b.r.poly;
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, z, [poly[j][0], poly[j][1], poly[i][0], poly[i][1]]));
  return smoothstep(-f, f, inPoly(poly, x, z) ? d : -d);
}

/** The raid arenas' floors: a flat plateau in the open world, where the instance puts its boss (data/raids.ts). */
export const RAID_FLOORS = {
  // Trono de Escarcha: a mesa past the frost peaks
  frost: { x: -700, z: -1120, r: 26, h: 16 },
  // Templo del Pantano: a dry clearing raised out of the jungle
  swamp: { x: 900, z: -1110, r: 26, h: 4 },
  // Corazón del Abismo: a basin sunk into the raised ash
  abyss: { x: 650, z: -1420, r: 26, h: -1 },
};
/** The volcano of the Volcanic Lands: its cone, and the crater of lava at its top (render/scene.ts; a wall keeps walkers out). */
export const VOLCANO = { x: -520, z: -1500, r: 80, h: 62, crater: 22 };
/** The Poison Swamp sinks into shallow channels (relief). */
const MARSH = { x: 980, z: -850, r: 120 };
/** On a raid floor (or within `pad` metres of it): kept clear of trees and rocks, the boss fights there. */
export const onRaidFloor = (x: number, z: number, pad = 0) => Object.values(RAID_FLOORS).some((f) => Math.hypot(x - f.x, z - f.z) < f.r + pad);
/** Inside the volcano's crater (or within `pad` metres of it): nothing grows or stands in the lava. */
export const inCrater = (x: number, z: number, pad = 0) => Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < VOLCANO.crater + pad;
/** The frost peaks (Picos Helados): [x, z, radius, height]. */
const PEAKS: [number, number, number, number][] = [
  [-980, -1060, 60, 62], [-860, -1110, 46, 44], [-1000, -930, 50, 52], [-800, -960, 40, 38],
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

function segDist(px: number, pz: number, [ax, az, bx, bz]: Seg): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
interface Boxed { s: Seg; x0: number; x1: number; z0: number; z1: number }
function boxed(pad: number) {
  return (s: Seg): Boxed => ({ s, x0: Math.min(s[0], s[2]) - pad, x1: Math.max(s[0], s[2]) + pad, z0: Math.min(s[1], s[3]) - pad, z1: Math.max(s[1], s[3]) + pad });
}
/** Distance to the nearest of the boxed segments, or Infinity when (x, z) is outside every box. */
function nearSeg(list: Boxed[], x: number, z: number): number {
  let d = Infinity;
  for (const b of list) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) d = Math.min(d, segDist(x, z, b.s));
  return d;
}
const ROAD_BOX = ROAD_SEGS.map(boxed(14));

/** The continent's shape: a fat ellipse with a wandering shore. */
const LAND_RX = 1450, LAND_RZ = 1720;
/** 0 = open sea, 1 = inland, smooth across the shore (about 150 m). */
export function landAt(x: number, z: number): number {
  const ax = Math.abs(x) / LAND_RX, az = Math.abs(z) / LAND_RZ;
  let isle = 0;
  // (all of them lie off the coast: skip the work inland)
  if (ax > 0.7 || az > 0.7) for (const [ax0, az0, bx, bz, r] of ISLES) isle = Math.max(isle, smoothstep(r, r * 0.55, segDist(x, z, [ax0, az0, bx, bz]) + (valueNoise(x / 60, z / 60 + 7) - 0.5) * 50));
  if (ax > 1.2 || az > 1.2) return isle;
  const e = Math.cbrt(ax * ax * ax + az * az * az) + (fbm(x / 600 + 40, z / 600 - 40, 3) - 0.5) * 0.5 + (valueNoise(x / 170 - 9, z / 170 + 5) - 0.5) * 0.1;
  // and the sea always opens before the edge walkers are clamped to
  return Math.max(isle, 1 - smoothstep(0.9, 1, e)) * (1 - smoothstep(WORLD_HALF * 0.85, WORLD_HALF * 0.93, Math.max(Math.abs(x), Math.abs(z))));
}
/** The sea floor, well under a swimmer's feet. */
const SEA_FLOOR = -30;

/**
 * Mountains: chains and lone peaks of their own sizes and bearings, set where the land would raise them, not along
 * the regions' borders. [ax, az, bx, bz, half-width, height]: a ridge from a to b (a lone peak when a = b).
 * Ridged noise on top, an irregular outline, foothills over the outer two thirds; roads find their own passes.
 */
const MASSIFS: [number, number, number, number, number, number][] = [
  [-1050, -1330, -680, -1580, 180, 125], // Montes de Ceniza, round the volcano (north-west)
  [-1150, -840, -880, -1260, 210, 135], // Macizo Blanco, behind the Picos Helados
  [-150, -1600, 250, -1590, 100, 85], // Crestas del Abismo, on the north coast
  [260, -1000, 260, -1000, 105, 105], // Pico Solitario, between frost and swamp
  [700, -440, 960, -660, 150, 95], // Alturas del Levante, over the Dragon's valley
  [-520, -60, -200, -320, 160, 75], // Tierras Altas, the Heart's highlands (across to the Dragon's lands)
  [1120, 320, 1260, -120, 130, 90], // Sierra Costera, on the east coast
  [-1220, 140, -1100, 520, 140, 95], // Sierra del Poniente, west of the Steppes
  [-720, 410, -470, 490, 110, 70], // Cerros Partidos, astride the Ocaso and the Heart
  [600, 590, 600, 590, 95, 110], // Monte Faro, a lone peak by the coast road
  [-980, 940, -660, 1110, 150, 65], // Colinas Viejas, west of the first lands
];
const MASSIF_BOX = MASSIFS.map(([ax, az, bx, bz, r]) => [Math.min(ax, bx) - r, Math.max(ax, bx) + r, Math.min(az, bz) - r, Math.max(az, bz) + r]);
const PASS_BOX = ROAD_SEGS.map(boxed(40));
/** Ridged multifractal: sharp crests where the noise folds, detail riding on the crests. */
function ridged(x: number, z: number): number {
  let sum = 0, amp = 0.5, freq = 1, w = 1;
  for (let i = 0; i < 4; i++) {
    let n = 1 - Math.abs(2 * valueNoise(x * freq + 17 * i, z * freq - 9 * i) - 1);
    n *= n * w;
    w = Math.min(1, n * 2);
    sum += n * amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}
function massifs(x: number, z: number): number {
  let h = 0;
  for (let i = 0; i < MASSIFS.length; i++) {
    const b = MASSIF_BOX[i];
    if (x < b[0] || x > b[1] || z < b[2] || z > b[3]) continue;
    const [ax, az, bx, bz, r, mh] = MASSIFS[i];
    // an irregular outline, not a capsule
    const d = segDist(x, z, [ax, az, bx, bz]) / r + (valueNoise(x / 120 + i * 5, z / 120) - 0.5) * 0.5;
    if (d < 1) h += mh * smoothstep(1, 0.3, d) * (0.3 + ridged(x / 150, z / 150) * 1.4);
  }
  // a road crossing finds a saddle
  return h && h * smoothstep(8, 40, nearSeg(PASS_BOX, x, z));
}

export function heightAt(x: number, z: number): number {
  const land = landAt(x, z);
  if (land <= 0) return SEA_FLOOR;
  // rolling ground a little above the water, its folds warped so nothing lines up; the hollows under it are ponds
  const wx = x + (valueNoise(x / 310 + 5, z / 310) - 0.5) * 180, wz = z + (valueNoise(x / 310, z / 310 - 5) - 0.5) * 180;
  let h = 5 + (fbm(wx / 170, wz / 170, 4) - 0.5) * 28 + (valueNoise(x / 25 + 100, z / 25) - 0.5) * 3;
  h += massifs(x, z) + relief(x, z);
  const dp = Math.hypot(x - PLATEAU.x, z - PLATEAU.z);
  if (dp < PLATEAU.r) h = Math.max(h, PLATEAU.h * smoothstep(PLATEAU.r, PLATEAU.r * 0.85, dp) + h * 0.15);
  const dc = segDist(x, z, CANYON);
  if (dc < 30) h = Math.min(h, -4 + dc * 0.6); // dry floor above the water, steep walls
  h = water(x, z, h);
  // the shore: low coastal plains, but cliffs where the coast noise says so
  if (land < 1) {
    const cliff = smoothstep(0.58, 0.72, valueNoise(x / 350 + 71, z / 350 - 13));
    const plain = 1.5 + (h - 1.5) * smoothstep(0.55, 1, land), crag = Math.max(h, 16 * smoothstep(0.25, 0.55, land));
    h = plain + (crag - plain) * cliff;
    h = SEA_FLOOR + (h - SEA_FLOOR) * smoothstep(0, 1 - 0.7 * cliff, land);
  }
  h = floors(x, z, roadBed(x, z, h));
  let t = 1;
  for (const tw of TOWNS) t = Math.min(t, smoothstep(tw.r + 5, tw.r + 45, Math.hypot(x - tw.x, z - tw.z)));
  return TOWN_HEIGHT + (h - TOWN_HEIGHT) * t;
}

/** Rivers and lakes dig their beds below the water line. */
const BED = -11;
function water(x: number, z: number, h: number): number {
  const dr = nearSeg(RIVER_SEGS, x, z);
  // the valley the river carved: a wide floor a few metres above the water, the land rising off it
  if (dr < VALLEY_W) h = Math.min(h, -2 + (h + 2) * smoothstep(RIVER_W * 2, VALLEY_W, dr) + dr * 0.02);
  if (dr < RIVER_W * 2.2) h = Math.min(h, BED + (h - BED) * smoothstep(RIVER_W * 0.5, RIVER_W * 2.2, dr));
  for (const [lx, lz, r] of LAKES) {
    const d = Math.hypot(x - lx, z - lz);
    if (d < r) h = Math.min(h, BED + (h - BED) * smoothstep(r * 0.45, r, d));
  }
  return h;
}

/** The north's landmarks on top of its rolling ground. */
function relief(x: number, z: number): number {
  if (z > -650) return 0;
  // the volcanic region stands higher: hardly a pond in it
  let h = 6 * biomeWeight('ash', x, z);
  for (const [px, pz, r, ph] of PEAKS) {
    const d = Math.hypot(x - px, z - pz);
    if (d < r) h += ph * Math.pow(1 - d / r, 1.25) * (0.6 + 0.8 * valueNoise(x / 12 + 7, z / 12 - 3));
  }
  const dm = Math.hypot(x - MARSH.x, z - MARSH.z);
  if (dm < MARSH.r) h -= 2.4 * (1 - smoothstep(MARSH.r * 0.6, MARSH.r, dm)) * (0.35 + 0.65 * valueNoise(x / 28 + 31, z / 28 - 17));
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (dv < VOLCANO.r) {
    const cone = VOLCANO.h * Math.pow(1 - dv / VOLCANO.r, 1.3) * (0.88 + 0.24 * valueNoise(x / 14 + 3, z / 14 + 9));
    // the crater: a flat floor 18 m under the rim, where the lava lies
    const floor = VOLCANO.h * Math.pow(1 - VOLCANO.crater / VOLCANO.r, 1.3) - 18;
    h += floor + (cone - floor) * smoothstep(VOLCANO.crater * 0.55, VOLCANO.crater, dv);
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

/** The roads keep their feet dry: a raised bed where they cross a river, a lake or a hollow below the water. */
function roadBed(x: number, z: number, h: number): number {
  if (h >= ROAD_BED) return h;
  const d = nearSeg(ROAD_BOX, x, z);
  return d >= 14 ? h : h + (ROAD_BED - h) * (1 - smoothstep(5, 14, d));
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

/** Walkers are clamped inside this; the continent's shore ends well before it (open sea between). */
export const PLAYABLE_HALF = WORLD_HALF * 0.95;
/** Ponds fill the terrain's hollows up to this height. Shallow edges are waded, deeper water is swum. */
export const WATER_LEVEL = -7;
/** How high the roads' bed stands where the ground under them dips into the water (roadBed). */
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
