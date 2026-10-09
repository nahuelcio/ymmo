// Quaternius Medieval Village pieces, snapped to a 2 m grid. Shared so the client
// draws the same footprints the server collides with. Pieces are named glTF files
// in client/public/v (scripts/v-assets.ts). Y is up; a wall is 2 m wide and 3 m tall.
import { TOWN } from './terrain';

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

export interface KitInst { piece: VPiece; x: number; y: number; z: number; rot: number }

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
  return out;
}

export function houseInstances(): KitInst[] {
  return ALBA_STAMPS.flatMap(expandStamp);
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

/** Stone paving for the whole village, out to the palisade. House interiors keep their own tiles. */
export function groundInstances(): KitInst[] {
  const out: KitInst[] = [];
  const limit = TOWN.r + CELL;
  const n = Math.ceil(limit / CELL);
  const covered = (x: number, z: number) => {
    for (const st of ALBA_STAMPS) {
      const c = Math.cos(st.rot), s = Math.sin(st.rot);
      const dx = x - (TOWN.x + st.x), dz = z - (TOWN.z + st.z);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < st.w / 2 - 0.05 && Math.abs(lz) < st.d / 2 - 0.05) return true;
    }
    return false;
  };
  for (let ix = -n; ix <= n; ix++) for (let iz = -n; iz <= n; iz++) {
    const x = TOWN.x + ix * CELL, z = TOWN.z + iz * CELL;
    if ((x - TOWN.x) ** 2 + (z - TOWN.z) ** 2 > limit * limit) continue;
    if (covered(x, z)) continue;
    out.push({ piece: 'Floor_UnevenBrick', x, y: 0, z, rot: (ix + iz) & 1 ? Math.PI / 2 : 0 });
  }
  return out;
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
  const draw: CurtainDraw[] = [];
  const walls: CurtainWall[] = [];
  const S = CURTAIN_SCALE;
  const R = TOWN.r + 2;
  const overlap = 0.35;
  const angles = ROAD_TO.map(([x, z]) => Math.atan2(z - TOWN.z, x - TOWN.x)).sort((a, b) => a - b);
  const at = (a: number) => ({ x: TOWN.x + Math.cos(a) * R, z: TOWN.z + Math.sin(a) * R });
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
      draw.push({ kind: 'wall', x: p.x, z: p.z, rot, sx: len / WALL_LEN, sy: S, sz: S });
      walls.push({ x: p.x, z: p.z, rot, tower: false, hw: len / 2, hd: WALL_HZ * S });
    }
  };

  for (const a of angles) {
    const rot = wallRot(a);
    const p = at(a);
    const c = Math.cos(rot), s = Math.sin(rot);
    draw.push({ kind: 'gate', x: p.x, z: p.z, rot, sx: S, sy: S, sz: S });
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
    const mid = (a0 + a1) / 2;
    const tp = at(mid);
    // Door (+Z) faces the city.
    const rotT = wallRot(mid) + Math.PI;
    draw.push({ kind: 'tower', x: tp.x, z: tp.z, rot: rotT, sx: S, sy: S, sz: S });
    walls.push({ x: tp.x, z: tp.z, rot: rotT, tower: true, hw: TOWER_HX * S, hd: TOWER_HZ * S });
    fill(a0 + halfAng(GATE_HX * S), mid - halfAng(TOWER_JOIN * S));
    fill(mid + halfAng(TOWER_JOIN * S), a1 - halfAng(GATE_HX * S));
  }

  return { draw, walls };
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
];

/** A point in front of a stamp's door, `lx` metres along the front, `out` metres past the wall. Faces the plaza. */
export function spot(id: string, lx = 0, out = 2): { x: number; z: number; ry: number } {
  const st = ALBA_STAMPS.find((s) => s.id === id);
  if (!st) throw new Error(`no stamp ${id}`);
  const c = Math.cos(st.rot), s = Math.sin(st.rot);
  const lz = st.d / 2 + out;
  return { x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c, ry: st.rot };
}

/** Same road targets as ROADS in layout.ts (meadows, hills, barracks, wastes, dusk). */
const ROAD_TO: [number, number][] = [[190, 30], [20, -220], [-230, -40], [-20, 260], [170, -170]];

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
      const r = Math.hypot(x - TOWN.x, z - TOWN.z);
      if (r < 16) issues.push(`${b.st.id} enters the plaza (${r.toFixed(1)})`);
      if (r > 36) issues.push(`${b.st.id} crosses the 36 m ring (${r.toFixed(1)})`);
    }
    const road = distToRoad(b.st.x - TOWN.x, b.st.z - TOWN.z);
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
