// Quaternius Medieval Village pieces, snapped to a 2 m grid. Shared so the client
// draws the same footprints the server collides with. Pieces are named glTF files
// in client/public/v (scripts/v-assets.ts). Y is up; a wall is 2 m wide and 3 m tall.
import { DUSK, EMBER, FROST, REED, roadLegs, TOWN } from './terrain';

export const CELL = 2;
/** Wall top, where roofs and chimneys sit. */
export const WALL_TOP = 3;

export const V_PIECES = [
  'Floor_UnevenBrick',
  'Wall_Plaster_Straight',
  'Wall_Plaster_Door_Flat',
  'Wall_Plaster_Window_Wide_Flat',
  'Wall_UnevenBrick_Straight',
  'Wall_UnevenBrick_Door_Flat',
  'Wall_UnevenBrick_Window_Wide_Flat',
  'Door_1_Round',
  'DoorFrame_Flat_WoodDark',
  'Window_Wide_Flat1',
  'Corner_Exterior_Wood',
  'Corner_Exterior_Brick',
  'Roof_RoundTiles_4x4',
  'Roof_RoundTiles_6x4',
  'Roof_RoundTiles_6x8',
  'Roof_Front_Brick4',
  'Roof_Front_Brick6',
  'Roof_Tower_RoundTiles',
  'Prop_Chimney',
] as const;
export type VPiece = (typeof V_PIECES)[number];

export interface Stamp {
  id: string;
  x: number;
  z: number;
  /** Footprint in metres (multiples of CELL). Local +X is the front's width, local +Z faces out the door. */
  w: number;
  d: number;
  rot: number;
  brick?: boolean;
  kind?: 'hall' | 'tavern' | 'smithy';
  wall: number;
  roof: number;
  /** multiplies the kit textures (the Bastión's dark stone): walls and gables, roof tiles, wood */
  tint?: { wall: number; roof: number; wood: number };
}

/** Cardinal yaw whose +Z points back toward the plaza. */
const face = (x: number, z: number) => (Math.abs(x) > Math.abs(z) ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0);

/**
 * Axis-aligned buildings inside the palisade (r = 52), outside the plaza (r ≈ 16)
 * and off the five roads. Door faces the plaza.
 */
export const ALBA_STAMPS: Stamp[] = [
  { id: 'hall', x: 8, z: 24, w: 6, d: 8, rot: face(8, 24), kind: 'hall', wall: 0xb8b2a4, roof: 0x4a5a7a },
  { id: 'smithy', x: -22, z: -20, w: 6, d: 4, rot: face(-22, -20), brick: true, kind: 'smithy', wall: 0x8a8478, roof: 0x3a3a3a },
  { id: 'tavern', x: 22, z: 12, w: 6, d: 4, rot: face(22, 12), kind: 'tavern', wall: 0xe0d4b8, roof: 0x8a3a2a },
  { id: 'grocer', x: -6, z: -22, w: 4, d: 4, rot: face(-6, -22), wall: 0xe0d4b8, roof: 0x8a3a2a },
  { id: 'c-nw', x: -22, z: 16, w: 4, d: 4, rot: face(-22, 16), wall: 0xd0c0a0, roof: 0x4a5a7a },
  { id: 'c-n', x: -18, z: 26, w: 4, d: 4, rot: face(-18, 26), wall: 0xe0d4b8, roof: 0x8a3a2a },
  { id: 'c-ne', x: 26, z: 20, w: 4, d: 4, rot: face(26, 20), wall: 0xd0c0a0, roof: 0x4a5a7a },
  { id: 'c-e', x: 28, z: -10, w: 4, d: 4, rot: face(28, -10), wall: 0xe0d4b8, roof: 0x8a3a2a },
  { id: 'c-s', x: -16, z: -26, w: 4, d: 4, rot: face(-16, -26), wall: 0xd0c0a0, roof: 0x4a5a7a },
  { id: 'c-w', x: -28, z: 8, w: 4, d: 4, rot: face(-28, 8), wall: 0xe0d4b8, roof: 0x8a3a2a },
  { id: 'c-se', x: 16, z: -24, w: 4, d: 4, rot: face(16, -24), wall: 0xd0c0a0, roof: 0x4a5a7a },
  { id: 'c-nne', x: 16, z: 22, w: 4, d: 4, rot: face(16, 22), wall: 0xe0d4b8, roof: 0x8a3a2a },
];

export interface KitInst { piece: VPiece; x: number; y: number; z: number; rot: number; tint?: number }

/** Roof_RoundTiles_6x4's pivot sits on the back edge; shift it so the span centres on the footprint. */
const ROOF_Z: Partial<Record<VPiece, number>> = { Roof_RoundTiles_6x4: -2.355 };
/** Door_1_Round extends +X from its origin; this centres the leaf in the bay. */
const DOOR_X = -0.51;

function wallPiece(brick: boolean | undefined, part: 'Straight' | 'Door_Flat' | 'Window_Wide_Flat'): VPiece {
  if (brick) {
    if (part === 'Straight') return 'Wall_UnevenBrick_Straight';
    if (part === 'Door_Flat') return 'Wall_UnevenBrick_Door_Flat';
    return 'Wall_UnevenBrick_Window_Wide_Flat';
  }
  if (part === 'Straight') return 'Wall_Plaster_Straight';
  if (part === 'Door_Flat') return 'Wall_Plaster_Door_Flat';
  return 'Wall_Plaster_Window_Wide_Flat';
}

function roofPiece(w: number, d: number): VPiece {
  const name = `Roof_RoundTiles_${w}x${d}`;
  if (name === 'Roof_RoundTiles_4x4' || name === 'Roof_RoundTiles_6x4' || name === 'Roof_RoundTiles_6x8') return name;
  throw new Error(`no roof for ${w}x${d}`);
}

function place(st: Stamp, piece: VPiece, lx: number, y: number, lz: number, lrot: number): KitInst {
  const c = Math.cos(st.rot), s = Math.sin(st.rot);
  return { piece, x: st.x + lx * c + lz * s, y, z: st.z - lx * s + lz * c, rot: st.rot + lrot };
}

function pushBay(out: KitInst[], st: Stamp, part: 'Straight' | 'Door_Flat' | 'Window_Wide_Flat', lx: number, lz: number, lrot: number) {
  out.push(place(st, wallPiece(st.brick, part), lx, 0, lz, lrot));
  if (part === 'Window_Wide_Flat') out.push(place(st, 'Window_Wide_Flat1', lx, 0, lz, lrot));
  if (part === 'Door_Flat') {
    out.push(place(st, 'DoorFrame_Flat_WoodDark', lx, 0, lz, lrot));
    // Door_1_Round's leaf is offset along the wall; shift it in that wall's own axes.
    const c = Math.cos(lrot), s = Math.sin(lrot);
    out.push(place(st, 'Door_1_Round', lx + DOOR_X * c + 0.08 * s, 0, lz - DOOR_X * s + 0.08 * c, lrot));
  }
}

/** One building: closed bays, a glazed window in every opening, door, gables, floor, roof and chimney. */
export function expandStamp(st: Stamp): KitInst[] {
  const out: KitInst[] = [];
  const nx = st.w / CELL, nz = st.d / CELL;
  const doorAt = Math.floor(nx / 2);
  for (let i = 0; i < nx; i++) {
    const lx = -st.w / 2 + CELL / 2 + i * CELL;
    pushBay(out, st, i === doorAt ? 'Door_Flat' : 'Window_Wide_Flat', lx, st.d / 2, 0);
    pushBay(out, st, 'Window_Wide_Flat', lx, -st.d / 2, Math.PI);
  }
  for (let j = 0; j < nz; j++) {
    const lz = -st.d / 2 + CELL / 2 + j * CELL;
    pushBay(out, st, 'Window_Wide_Flat', -st.w / 2, lz, -Math.PI / 2);
    pushBay(out, st, 'Window_Wide_Flat', st.w / 2, lz, Math.PI / 2);
  }
  const corner: VPiece = st.brick ? 'Corner_Exterior_Brick' : 'Corner_Exterior_Wood';
  const cox = st.brick ? 0.085 : 0, coz = st.brick ? -0.09 : 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(place(st, corner, (sx * st.w) / 2 + cox, 0, (sz * st.d) / 2 + coz, 0));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    out.push(place(st, 'Floor_UnevenBrick', -st.w / 2 + CELL / 2 + i * CELL, 0.02, -st.d / 2 + CELL / 2 + j * CELL, 0));
  }
  const roof = roofPiece(st.w, st.d);
  out.push(place(st, roof, 0, WALL_TOP, ROOF_Z[roof] ?? 0, 0));
  // The ridge runs along local Z, so the open triangles are the front and the back.
  const gable: VPiece = st.w >= 6 ? 'Roof_Front_Brick6' : 'Roof_Front_Brick4';
  out.push(place(st, gable, 0, WALL_TOP, st.d / 2, 0));
  out.push(place(st, gable, 0, WALL_TOP, -st.d / 2, Math.PI));
  out.push(place(st, 'Prop_Chimney', st.w / 2 - 1.2, WALL_TOP, -st.d / 2 + 1.2, 0));
  if (st.tint) for (const it of out) it.tint = tintOf(it.piece, st.tint);
  return out;
}

/** Which of a stamp's tints a piece takes (floors keep their own colour). */
function tintOf(piece: VPiece, t: NonNullable<Stamp['tint']>): number | undefined {
  if (piece.startsWith('Roof_RoundTiles')) return t.roof;
  if (piece === 'Door_1_Round' || piece === 'DoorFrame_Flat_WoodDark' || piece === 'Corner_Exterior_Wood' || piece === 'Window_Wide_Flat1') return t.wood;
  if (piece.startsWith('Floor')) return undefined;
  return t.wall;
}

export function houseInstances(): KitInst[] {
  return [...albaWorld(), ...FORTS.flatMap((f) => f.stamps)].flatMap(expandStamp);
}

/**
 * Bell tower (CC0, Quaternius) where the fountain stood, at the town centre.
 * Twice the previous size. Door (+Z) faces south, the way you arrive.
 * Footprint of the glb at scale 1: x ±0.97, z −1.125…1.103, about 4.8 m tall.
 */
export const BELL_SCALE = 6;
export const BELL_TOWER = {
  x: 0,
  z: 0,
  rot: Math.PI,
  hw: 0.97 * BELL_SCALE,
  hd: 1.13 * BELL_SCALE,
  scale: BELL_SCALE,
};

/** Stone paving for a whole town, out to its wall. House interiors keep their own tiles. */
function paving(town: { x: number; z: number; r: number }, stamps: Stamp[], tint?: number): KitInst[] {
  const out: KitInst[] = [];
  const limit = town.r + CELL;
  const n = Math.ceil(limit / CELL);
  const covered = (x: number, z: number) => {
    for (const st of stamps) {
      const c = Math.cos(st.rot), s = Math.sin(st.rot);
      const dx = x - st.x, dz = z - st.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < st.w / 2 - 0.05 && Math.abs(lz) < st.d / 2 - 0.05) return true;
    }
    return false;
  };
  for (let ix = -n; ix <= n; ix++) for (let iz = -n; iz <= n; iz++) {
    const x = town.x + ix * CELL, z = town.z + iz * CELL;
    if ((x - town.x) ** 2 + (z - town.z) ** 2 > limit * limit) continue;
    if (covered(x, z)) continue;
    out.push({ piece: 'Floor_UnevenBrick', x, y: 0, z, rot: (ix + iz) & 1 ? Math.PI / 2 : 0, tint });
  }
  return out;
}

/** Alba's stamps are authored round its centre: these are them where the village stands. */
const albaWorld = () => ALBA_STAMPS.map((s) => ({ ...s, x: TOWN.x + s.x, z: TOWN.z + s.z }));

/** Paving for every town. */
export function groundInstances(): KitInst[] {
  return [...paving(TOWN, albaWorld()), ...FORTS.flatMap((f) => paving(f.town, f.stamps, f.stone))];
}

/**
 * Stone curtain around Alba (CC0 Quaternius, poly.pizza). Native metres are the baked glb bounds.
 * Wall length runs on local X; thickness and the gate doorway run on local Z.
 * The tower door and steps are on local +Z.
 */
export const CURTAIN_SCALE = 9;
const WALL_LEN = 1.56;
const WALL_HZ = 0.124;
const GATE_HX = 0.99;
const GATE_HZ = 0.17;
/** Solid jambs on either side of the doorway (local X). The opening between them is walkable. */
const GATE_SIDES = [
  { x: -0.565, hw: 0.415 },
  { x: 0.573, hw: 0.423 },
];
const TOWER_HX = 0.43;
const TOWER_HZ = 0.36;
/** Half-width of the stone shaft, inside the crates, so the wall runs into the tower. */
const TOWER_JOIN = 0.2;

export interface CurtainDraw {
  kind: 'wall' | 'gate' | 'tower';
  /** multiplies the stone (the Bastión's darker wall) */
  tint?: number;
  x: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface CurtainWall {
  x: number;
  z: number;
  rot: number;
  tower: boolean;
  hw: number;
  hd: number;
}

/** One gate on every road out of Alba, a watchtower at the middle of each span, and wall runs between them. */
export function albaCurtain(): { draw: CurtainDraw[]; walls: CurtainWall[] } {
  return curtain(TOWN, TOWN.r + 2, ROAD_TO.map(([x, z]) => Math.atan2(z, x)), { scale: CURTAIN_SCALE, towers: 1 });
}

/** A fort's wall: its own stone, lower than Alba's, a gate on each of its roads, two towers a span. */
export function fortCurtain(f: Fort): { draw: CurtainDraw[]; walls: CurtainWall[] } {
  return curtain(f.town, f.town.r + 2, f.gates, { scale: FORT_SCALE, towers: 2, tint: f.stone });
}
const FORT_SCALE = 7;

/**
 * A ring of stone wall of radius R around a town: an open gate at each angle (radians, x = cos, z = sin),
 * `towers` watchtowers spread along each span between gates, and wall runs filling the rest.
 */
function curtain(town: { x: number; z: number }, R: number, gateAngles: number[], o: { scale: number; towers: number; tint?: number }): { draw: CurtainDraw[]; walls: CurtainWall[] } {
  const draw: CurtainDraw[] = [];
  const walls: CurtainWall[] = [];
  const S = o.scale, tint = o.tint;
  const overlap = 0.35;
  const angles = [...gateAngles].sort((a, b) => a - b);
  const at = (a: number) => ({ x: town.x + Math.cos(a) * R, z: town.z + Math.sin(a) * R });
  /** Local +Z points radially out, so the wall's length lies on the tangent. */
  const wallRot = (a: number) => -a + Math.PI / 2;
  const halfAng = (halfLen: number) => Math.atan(Math.max(0, halfLen - overlap) / R);

  const fill = (from: number, to: number) => {
    const span = to - from;
    if (span < 0.015) return;
    const tangent = 2 * R * Math.tan(span / 2);
    const n = Math.max(1, Math.round(tangent / (WALL_LEN * S)));
    const step = span / n;
    for (let k = 0; k < n; k++) {
      const a = from + step * (k + 0.5);
      const len = 2 * R * Math.tan(step / 2);
      const rot = wallRot(a);
      const p = at(a);
      draw.push({ kind: 'wall', x: p.x, z: p.z, rot, sx: len / WALL_LEN, sy: S, sz: S, tint });
      walls.push({ x: p.x, z: p.z, rot, tower: false, hw: len / 2, hd: WALL_HZ * S });
    }
  };

  for (const a of angles) {
    const rot = wallRot(a);
    const p = at(a);
    const c = Math.cos(rot), s = Math.sin(rot);
    draw.push({ kind: 'gate', x: p.x, z: p.z, rot, sx: S, sy: S, sz: S, tint });
    for (const side of GATE_SIDES) {
      const lx = side.x * S;
      walls.push({
        x: p.x + lx * c, z: p.z - lx * s, rot, tower: false, hw: side.hw * S, hd: GATE_HZ * S,
      });
    }
  }

  for (let i = 0; i < angles.length; i++) {
    const a0 = angles[i];
    let a1 = angles[(i + 1) % angles.length];
    if (a1 <= a0) a1 += Math.PI * 2;
    // towers spread evenly along the span; wall runs go gate, tower, ..., tower, gate
    let from = a0 + halfAng(GATE_HX * S);
    for (let t = 1; t <= o.towers; t++) {
      const ta = a0 + ((a1 - a0) * t) / (o.towers + 1);
      const tp = at(ta);
      // Door (+Z) faces the town.
      const rotT = wallRot(ta) + Math.PI;
      draw.push({ kind: 'tower', x: tp.x, z: tp.z, rot: rotT, sx: S, sy: S, sz: S, tint });
      walls.push({ x: tp.x, z: tp.z, rot: rotT, tower: true, hw: TOWER_HX * S, hd: TOWER_HZ * S });
      fill(from, ta - halfAng(TOWER_JOIN * S));
      from = ta + halfAng(TOWER_JOIN * S);
    }
    fill(from, a1 - halfAng(GATE_HX * S));
  }

  return { draw, walls };
}

// ---------------------------------------------------------------- Bastión del Ocaso

/** Dark stone for the Bastión's paving and wall (multiplies the kit's albedo). */
export const DUSK_STONE = 0x8e8c96;
/** Dyes for a greyed copy of the kit textures (client/src/render/village.ts kitDye): dark stone, wine or slate roofs, dark wood. */
const DUSK_TINT = { wall: 0x9a96a0, roof: 0x6e2c32, wood: 0x7a6258 };
const DUSK_TINT_SLATE = { wall: 0x9a96a0, roof: 0x5a6478, wood: 0x7a6258 };
/** Its two roads (terrain.ts ROAD_LINES leaves it south-west and north-east, the way this plan was drawn). Angles from its centre (x = cos, z = sin). */
export const DUSK_GATES = roadLegs(DUSK).map(([x, z]) => Math.atan2(z - DUSK.z, x - DUSK.x));

/** A Bastión building at (lx, lz) from its centre, door toward the plaza. */
const dusk = (id: string, lx: number, lz: number, w: number, d: number, o: Partial<Stamp> = {}): Stamp => ({
  id, x: DUSK.x + lx, z: DUSK.z + lz, w, d, rot: face(lx, lz), brick: true, wall: 0x6e6a66, roof: 0x5a2a2a,
  tint: DUSK_TINT, ...o,
});

/**
 * A ring of dark stone buildings around the brazier: barracks, an armoury, houses.
 * Off the two roads (DUSK_GATES), clear of the four merchants and their stalls, inside the wall (R = 32).
 */
export const DUSK_STAMPS: Stamp[] = [
  dusk('barracks', 20, 6, 6, 8, { kind: 'hall', tint: DUSK_TINT_SLATE }),
  dusk('armoury', 14, 18, 6, 4, { kind: 'smithy' }),
  dusk('d-n', 0, 22, 4, 4, { tint: DUSK_TINT_SLATE }),
  dusk('d-nw', -8, 24, 4, 4, { brick: false }),
  dusk('d-w', -22, -4, 6, 4, { tint: DUSK_TINT_SLATE }),
  dusk('d-sw', -16, -18, 6, 4),
  dusk('d-s', -2, -22, 4, 4, { brick: false, tint: DUSK_TINT_SLATE }),
  dusk('d-se', 8, -24, 4, 4),
  dusk('d-e', 23, -8, 4, 4, { brick: false }),
];

/** The Bastión's merchants (shared/src/data/world.ts), whose spots and stalls the buildings must leave clear. */
const DUSK_FOLK: { id: string; x: number; z: number }[] = [
  { id: 'dusk_weapons', x: 8, z: 8 },
  { id: 'dusk_armor', x: -8, z: -8 },
  { id: 'dusk_grocer', x: 11, z: -2 },
  { id: 'dusk_gate', x: -11, z: 2 },
  { id: 'dusk_clan', x: 13, z: 6.5 },
].map((n) => ({ ...n, x: DUSK.x + n.x, z: DUSK.z + n.z }));

/** Empty when a fort's plan stays off its plaza, its roads, its wall and its folk, without overlaps. */
export function fortIssues(f: Fort): string[] {
  const issues: string[] = [];
  const T = f.town;
  const boxes = f.stamps.map((st) => {
    const pts = corners(st);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { st, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), pts };
  });
  for (const b of boxes) {
    for (const [x, z] of b.pts) {
      const r = Math.hypot(x - T.x, z - T.z);
      if (r < 14) issues.push(`${b.st.id} enters the plaza (${r.toFixed(1)})`);
      if (r > T.r - 2) issues.push(`${b.st.id} reaches the wall (${r.toFixed(1)})`);
    }
    for (const ga of f.gates) {
      // how far the building's centre is from the road, a ray from the centre out through the gate
      const dx = b.st.x - T.x, dz = b.st.z - T.z, ux = Math.cos(ga), uz = Math.sin(ga);
      const along = dx * ux + dz * uz, off = Math.abs(dx * uz - dz * ux);
      const need = Math.hypot(b.st.w, b.st.d) / 2 + 3;
      if (along > 0 && off < need) issues.push(`${b.st.id} is ${off.toFixed(1)} m from a road (need ${need.toFixed(1)})`);
    }
    const c = Math.cos(b.st.rot), s = Math.sin(b.st.rot);
    const hw = b.st.w / 2 + 2.5, hd = b.st.d / 2 + 2.5; // the merchant, and the stall behind them
    for (const n of f.folk) {
      const dx = n.x - b.st.x, dz = n.z - b.st.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) issues.push(`${b.st.id} crowds ${n.id}`);
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x0 < b.x1 + 1 && b.x0 < a.x1 + 1 && a.z0 < b.z1 + 1 && b.z0 < a.z1 + 1) issues.push(`${a.st.id} is too close to ${b.st.id}`);
  }
  // the folk keep out of the gate lanes and off each other's counters
  for (const n of f.folk) {
    for (const ga of f.gates) {
      const dx = n.x - T.x, dz = n.z - T.z, ux = Math.cos(ga), uz = Math.sin(ga);
      if (dx * ux + dz * uz > 0 && Math.abs(dx * uz - dz * ux) < 3) issues.push(`${n.id} stands in a gate lane`);
    }
    for (const o of f.folk) if (o !== n && Math.hypot(o.x - n.x, o.z - n.z) < 4) issues.push(`${n.id} is too close to ${o.id}`);
  }
  return issues;
}

/** Fantasy Props MegaKit pieces (client/public/v/props.glb, tools/scripts/props-assets.mjs). */
export type PropName = 'Banner_1_Cloth' | 'Banner_2_Cloth' | 'Lantern_Wall' | 'WeaponStand' | 'Anvil' | 'Cauldron' | 'Barrel' | 'Crate_Wooden';
/** y is above the town floor (TOWN_HEIGHT); the model's own front is +Z. */
export interface PropInst { name: PropName; x: number; y: number; z: number; rot: number; s: number }

/** Native heights of the curtain glbs (scale 1), for hanging banners just under their tops. */
const GATE_TOP = 0.73, TOWER_TOP = 1.19, TOWER_FRONT = 0.43, GATE_BACK = 0.18;
/** Lantern_Wall hangs off its wall by 1.25 m: where its flame is, in its own frame. */
export const LANTERN_FLAME = { y: 0.75, z: 1.1 };

/** Turns a point from a frame at (x, z) turned by rot into the world (the same turn as `place`). */
const at = (x: number, z: number, rot: number, lx: number, lz: number) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: x + lx * c + lz * s, z: z - lx * s + lz * c };
};

/**
 * A fort's props: banners on the town side of its gates and towers, a lantern by every door, and its own extras
 * (the Bastión's smith and alchemist; in the ring's forts, the same beside their smithy and alchemist).
 */
export function fortProps(f: Fort): PropInst[] {
  const out: PropInst[] = [];
  const { draw } = fortCurtain(f);
  const S = FORT_SCALE;
  for (const d of draw) {
    if (d.kind === 'gate') {
      // the gate's town side is its local -Z: the banners face that way
      for (const lx of [-0.57 * S, 0.57 * S]) {
        const p = at(d.x, d.z, d.rot, lx, -GATE_BACK * S - 0.06);
        out.push({ name: 'Banner_1_Cloth', x: p.x, y: GATE_TOP * S - 0.4, z: p.z, rot: d.rot + Math.PI, s: 1.7 });
      }
    } else if (d.kind === 'tower') {
      // a tower's door (+Z) faces the town
      for (const lx of [-0.26 * S, 0.26 * S]) {
        const p = at(d.x, d.z, d.rot, lx, TOWER_FRONT * S + 0.06);
        out.push({ name: 'Banner_2_Cloth', x: p.x, y: TOWER_TOP * S - 1.1, z: p.z, rot: d.rot, s: 1.6 });
      }
    }
  }
  for (const st of f.stamps) {
    // beside the door, on the front wall (the door bay is the middle one, rounded down)
    const doorX = -st.w / 2 + CELL / 2 + Math.floor(st.w / CELL / 2) * CELL;
    const p = at(st.x, st.z, st.rot, doorX - CELL / 2, st.d / 2 + 0.06);
    out.push({ name: 'Lantern_Wall', x: p.x, y: 1.4, z: p.z, rot: st.rot, s: 1 });
  }
  out.push(...f.extras());
  return out;
}

/** The Bastión's smith before the armoury, and its alchemist beside Mirta's counter. */
function duskExtras(): PropInst[] {
  const out: PropInst[] = [];
  const rel = (name: PropName, lx: number, lz: number, rot: number, s = 1.3) => out.push({ name, x: DUSK.x + lx, y: 0, z: DUSK.z + lz, rot, s });
  rel('Anvil', 12.4, 14, 0.4);
  rel('WeaponStand', 16, 14.2, Math.PI);
  rel('Cauldron', 16, -4, 0.6);
  rel('Barrel', 16.8, 1.4, 0.3);
  rel('Barrel', 17.7, 2.1, 1.1);
  rel('Crate_Wooden', 15.3, 2.2, 0.2);
  return out;
}

/** Where every fort's lanterns burn, for the lamp light pool. */
export function fortLanterns(): { x: number; y: number; z: number }[] {
  return FORTS.flatMap(fortProps).filter((p) => p.name === 'Lantern_Wall').map((p) => {
    const f = at(p.x, p.z, p.rot, 0, LANTERN_FLAME.z * p.s);
    return { x: f.x, y: p.y + LANTERN_FLAME.y * p.s, z: f.z };
  });
}

/** Alba residents, at the spots already authored in the town. Footprints stay clear of them. */
export const ALBA_FOLK: { id: string; x: number; z: number; ry: number }[] = [
  { id: 'grocer', x: 10, z: -14, ry: Math.PI },
  { id: 'weapons', x: -26.3, z: -18.4, ry: Math.atan2(26.3, 18.4) },
  { id: 'armor', x: -28.6, z: -14.6, ry: Math.atan2(28.6, 14.6) },
  { id: 'gatekeeper', x: 12, z: 12, ry: -Math.PI / 2 },
  { id: 'luigi', x: -3, z: -8.5, ry: 0 },
  { id: 'mira', x: 0, z: -24, ry: Math.atan2(0, 24) },
  { id: 'bram', x: 22, z: -16, ry: Math.atan2(-22, 16) },
  { id: 'sella', x: -22, z: -16, ry: Math.atan2(22, 16) },
  { id: 'dorian', x: 26, z: 8, ry: Math.atan2(-26, -8) },
  { id: 'vessa', x: 19.3, z: 23.9, ry: Math.atan2(-19.3, -23.9) },
  { id: 'harun', x: 14, z: 26, ry: Math.atan2(-14, -26) },
  { id: 'nira', x: -14, z: 26, ry: Math.atan2(14, -26) },
  { id: 'clan_master', x: 6, z: 18.5, ry: Math.atan2(-6, -18.5) },
];

/** A point in front of a stamp's door, `lx` metres along the front, `out` metres past the wall. Faces the plaza. */
export function spot(id: string, lx = 0, out = 2): { x: number; z: number; ry: number } {
  const st = ALBA_STAMPS.find((s) => s.id === id);
  if (!st) throw new Error(`no stamp ${id}`);
  const c = Math.cos(st.rot), s = Math.sin(st.rot);
  const lz = st.d / 2 + out;
  return { x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c, ry: st.rot };
}

/** Where Alba's roads head first (terrain.ts ROAD_LINES), from its centre. */
const ROAD_TO: [number, number][] = roadLegs(TOWN).map(([x, z]) => [x - TOWN.x, z - TOWN.z]);

function distToRoad(px: number, pz: number): number {
  let best = Infinity;
  for (const [bx, bz] of ROAD_TO) {
    const t = Math.max(0, Math.min(1, (px * bx + pz * bz) / (bx * bx + bz * bz)));
    best = Math.min(best, Math.hypot(px - bx * t, pz - bz * t));
  }
  return best;
}

function corners(st: Stamp): [number, number][] {
  const c = Math.cos(st.rot), s = Math.sin(st.rot);
  const pts: [number, number][] = [];
  for (const lx of [-st.w / 2, st.w / 2]) for (const lz of [-st.d / 2, st.d / 2])
    pts.push([st.x + lx * c + lz * s, st.z - lx * s + lz * c]);
  return pts;
}

/** Empty when the Alba plan stays off the plaza, the roads and the palisade, without overlapping itself. */
export function albaIssues(): string[] {
  const issues: string[] = [];
  const boxes = ALBA_STAMPS.map((st) => {
    const pts = corners(st);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    return { st, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), pts };
  });
  for (const b of boxes) {
    for (const [x, z] of b.pts) {
      const r = Math.hypot(x, z); // the plan is authored round the centre
      if (r < 16) issues.push(`${b.st.id} enters the plaza (${r.toFixed(1)})`);
      if (r > 36) issues.push(`${b.st.id} crosses the 36 m ring (${r.toFixed(1)})`);
    }
    const road = distToRoad(b.st.x, b.st.z);
    const need = Math.hypot(b.st.w, b.st.d) / 2 + 2.5;
    if (road < need) issues.push(`${b.st.id} is ${road.toFixed(1)} m from a road (need ${need.toFixed(1)})`);
    const c = Math.cos(b.st.rot), s = Math.sin(b.st.rot);
    const hw = b.st.w / 2 + 0.15, hd = b.st.d / 2 + 0.15;
    for (const n of ALBA_FOLK) {
      const dx = n.x - b.st.x, dz = n.z - b.st.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const cx = Math.max(-hw, Math.min(hw, lx)), cz = Math.max(-hd, Math.min(hd, lz));
      const ox = lx - cx, oz = lz - cz, d2 = ox * ox + oz * oz;
      if (d2 <= 1e-8 || d2 < 0.45 * 0.45) issues.push(`${b.st.id} covers ${n.id}`);
    }
  }
  {
    const c = Math.cos(BELL_TOWER.rot), s = Math.sin(BELL_TOWER.rot);
    for (const n of ALBA_FOLK) {
      const dx = n.x - BELL_TOWER.x, dz = n.z - BELL_TOWER.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const cx = Math.max(-BELL_TOWER.hw, Math.min(BELL_TOWER.hw, lx));
      const cz = Math.max(-BELL_TOWER.hd, Math.min(BELL_TOWER.hd, lz));
      const ox = lx - cx, oz = lz - cz, d2 = ox * ox + oz * oz;
      if (d2 <= 1e-8 || d2 < 0.45 * 0.45) issues.push(`bell tower covers ${n.id}`);
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1) issues.push(`${a.st.id} overlaps ${b.st.id}`);
  }
  return issues;
}

/** A walled town past the village: kit buildings round a brazier, a stone curtain with a gate on each of its roads. */
export interface Fort {
  id: string;
  town: { x: number; z: number; r: number; name: string };
  /** a gate on each road, as angles from the centre (x = cos, z = sin) */
  gates: number[];
  stamps: Stamp[];
  /** the curtain's and the paving's stone */
  stone: number;
  /** the residents' spots (shared/src/data/world.ts places them there): the plan leaves them clear */
  folk: { id: string; x: number; z: number; ry: number }[];
  extras: () => PropInst[];
}

const DUSK_FORT: Fort = {
  id: 'dusk', town: DUSK, gates: DUSK_GATES, stamps: DUSK_STAMPS, stone: DUSK_STONE,
  folk: DUSK_FOLK.map((n) => ({ ...n, ry: 0 })), extras: duskExtras,
};

/** A ring fort's plan: who lives there (merchants first) and what is built, the rest is laid out round the plaza. */
interface FortSpec {
  id: string;
  town: Fort['town'];
  /** where its roads come from: a gate faces each */
  roads: [number, number][];
  stone: number;
  wall: number;
  roof: number;
  tint: NonNullable<Stamp['tint']>;
  /** a second set of dyes, for every other building */
  tintAlt: NonNullable<Stamp['tint']>;
  buildings: { id: string; w: number; d: number; kind?: Stamp['kind']; brick?: boolean }[];
  folk: string[];
  /** whose counter the smith's anvil and the alchemist's cauldron stand by */
  smith: string;
  alchemist: string;
}

/** Folk round the brazier, buildings round them: both spread evenly over the arcs between the gate lanes. */
const FOLK_R = 11, BUILD_R = 21.5, FOLK_GATE = 0.4, BUILD_GATE = 0.42;

/** n angles spread evenly over the circle, leaving `clear` radians either side of each gate. */
function freeAngles(gates: number[], n: number, clear: number): number[] {
  const g = [...gates].map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  const arcs = g.map((a, i) => {
    const next = i + 1 < g.length ? g[i + 1] : g[0] + 2 * Math.PI;
    return [a + clear, next - clear] as [number, number];
  }).filter(([a, b]) => b > a);
  const total = arcs.reduce((s, [a, b]) => s + b - a, 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let t = ((i + 0.5) / n) * total;
    for (const [a, b] of arcs) {
      if (t <= b - a) { out.push(a + t); break; }
      t -= b - a;
    }
  }
  return out;
}

function ringFort(s: FortSpec): Fort {
  const T = s.town;
  const gates = s.roads.map(([x, z]) => Math.atan2(z - T.z, x - T.x));
  const folk = freeAngles(gates, s.folk.length, FOLK_GATE).map((a, i) => {
    const lx = Math.cos(a) * FOLK_R, lz = Math.sin(a) * FOLK_R;
    // facing the brazier
    return { id: s.folk[i], x: T.x + lx, z: T.z + lz, ry: Math.atan2(-lx, -lz) };
  });
  const stamps = freeAngles(gates, s.buildings.length, BUILD_GATE).map((a, i): Stamp => {
    const b = s.buildings[i];
    // on the 2 m grid, door toward the plaza
    const lx = Math.round((Math.cos(a) * BUILD_R) / 2) * 2, lz = Math.round((Math.sin(a) * BUILD_R) / 2) * 2;
    return { id: b.id, x: T.x + lx, z: T.z + lz, w: b.w, d: b.d, rot: face(lx, lz), brick: b.brick ?? true, kind: b.kind, wall: s.wall, roof: s.roof, tint: i % 2 ? s.tintAlt : s.tint };
  });
  const extras = (): PropInst[] => {
    const out: PropInst[] = [];
    const smith = stamps.find((st) => st.kind === 'smithy');
    if (smith) {
      // before the smithy's door
      const a = at(smith.x, smith.z, smith.rot, -1.6, smith.d / 2 + 2.2), b = at(smith.x, smith.z, smith.rot, 1.8, smith.d / 2 + 2.4);
      out.push({ name: 'Anvil', x: a.x, y: 0, z: a.z, rot: smith.rot + 0.4, s: 1.3 }, { name: 'WeaponStand', x: b.x, y: 0, z: b.z, rot: smith.rot + Math.PI, s: 1.3 });
    }
    const al = folk.find((n) => n.id === s.alchemist);
    if (al) {
      // beside the counter, off the stall behind them (local +x is to their left)
      const c = at(al.x, al.z, al.ry, 2.6, -0.4), b1 = at(al.x, al.z, al.ry, -2.6, -0.6), b2 = at(al.x, al.z, al.ry, -3.2, -1.3);
      out.push({ name: 'Cauldron', x: c.x, y: 0, z: c.z, rot: al.ry + 0.6, s: 1.3 }, { name: 'Barrel', x: b1.x, y: 0, z: b1.z, rot: 0.3, s: 1.3 }, { name: 'Crate_Wooden', x: b2.x, y: 0, z: b2.z, rot: 0.2, s: 1.3 });
    }
    return out;
  };
  return { id: s.id, town: T, gates, stamps, stone: s.stone, folk, extras };
}

/** Fuerte de Escarcha (levels 50-60): pale stone and slate under the snow, a gate toward the pass and one toward its lands. */
const FROST_FORT = ringFort({
  id: 'frost', town: FROST, roads: roadLegs(FROST),
  stone: 0xc4ccd6, wall: 0xb8bcc4, roof: 0x4a5a78,
  tint: { wall: 0xf0f2f6, roof: 0x7a90b4, wood: 0xa89888 }, tintAlt: { wall: 0xe4e8ee, roof: 0x8a98ac, wood: 0x9a8a7a },
  // whitewashed plaster, a few stone ones
  buildings: [
    { id: 'f-hall', w: 6, d: 8, kind: 'hall', brick: false }, { id: 'f-smithy', w: 6, d: 4, kind: 'smithy' }, { id: 'f-1', w: 4, d: 4, brick: false },
    { id: 'f-2', w: 6, d: 4, brick: false }, { id: 'f-3', w: 4, d: 4 }, { id: 'f-4', w: 4, d: 4, brick: false },
    { id: 'f-5', w: 6, d: 4, brick: false }, { id: 'f-6', w: 4, d: 4, brick: false },
  ],
  folk: ['frost_weapons', 'frost_armor', 'frost_grocer', 'frost_gate', 'frost_clan', 'ingrid', 'sven', 'astrid'],
  smith: 'frost_weapons', alchemist: 'frost_grocer',
});

/** Juncoverde (levels 60-70): mossy stone, plaster and green thatch by the swamp, a gate toward the pass and one toward its lands. */
const REED_FORT = ringFort({
  id: 'reed', town: REED, roads: roadLegs(REED),
  stone: 0x9aa88a, wall: 0xc8c0a0, roof: 0x4a7a4a,
  tint: { wall: 0xe0d8b8, roof: 0x5a8a4a, wood: 0x7a6a48 }, tintAlt: { wall: 0xd4ccaa, roof: 0x7a9a4a, wood: 0x6a5a3a },
  buildings: [
    { id: 'r-hall', w: 6, d: 8, kind: 'hall', brick: false }, { id: 'r-smithy', w: 6, d: 4, kind: 'smithy' }, { id: 'r-1', w: 4, d: 4, brick: false },
    { id: 'r-2', w: 6, d: 4, brick: false }, { id: 'r-3', w: 4, d: 4, brick: false }, { id: 'r-4', w: 4, d: 4 },
    { id: 'r-5', w: 6, d: 4, brick: false }, { id: 'r-6', w: 4, d: 4, brick: false },
  ],
  folk: ['reed_weapons', 'reed_armor', 'reed_grocer', 'reed_gate', 'reed_clan', 'thalia', 'oren', 'ilwen'],
  smith: 'reed_weapons', alchemist: 'reed_grocer',
});

/** Brasaoscura (levels 70-78): dark basalt and red tile, a gate toward the pass and one toward the volcano and the Abyss. */
const EMBER_FORT = ringFort({
  id: 'ember', town: EMBER, roads: roadLegs(EMBER),
  stone: 0x5e5250, wall: 0x6a5e5a, roof: 0x8a2a1a,
  tint: { wall: 0x7e726e, roof: 0x9a2c1c, wood: 0x4a3a30 }, tintAlt: { wall: 0x6e6460, roof: 0x7a2418, wood: 0x3e3028 },
  buildings: [
    { id: 'e-hall', w: 6, d: 8, kind: 'hall' }, { id: 'e-smithy', w: 6, d: 4, kind: 'smithy' }, { id: 'e-1', w: 4, d: 4 },
    { id: 'e-2', w: 6, d: 4 }, { id: 'e-3', w: 4, d: 4 }, { id: 'e-4', w: 4, d: 4, brick: false },
    { id: 'e-5', w: 6, d: 4 }, { id: 'e-6', w: 4, d: 4 },
  ],
  folk: ['ember_weapons', 'ember_armor', 'ember_grocer', 'ember_gate', 'ember_clan', 'varga', 'brunhilda', 'nyx', 'veyra'],
  smith: 'ember_weapons', alchemist: 'ember_grocer',
});

/** The Bastión and the ring's forts. */
export const FORTS: Fort[] = [DUSK_FORT, FROST_FORT, REED_FORT, EMBER_FORT];
export const fortById = (id: string) => FORTS.find((f) => f.id === id)!;
/** A fort resident's spot and facing (shared/src/data/world.ts). */
export function fortFolk(id: string): { x: number; z: number; ry: number } {
  for (const f of FORTS) for (const n of f.folk) if (n.id === id) return n;
  throw new Error(`no fort resident ${id}`);
}
