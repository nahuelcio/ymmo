import * as THREE from 'three';
import { DEFAULT_LOOK, HAIR_COLORS, RACES, type ClassType, type Look, type Race } from '../../../shared/src/data/classes';
import { ITEMS, type ItemDef } from '../../../shared/src/data/items';
import { MOBS } from '../../../shared/src/data/mobs';
import { NPCS } from '../../../shared/src/data/world';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from './scene';

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  kind: 'humanoid' | 'beast' | 'spider';
  legs: THREE.Object3D[];
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  torso?: THREE.Object3D;
  height: number;
  radius: number;
}

export interface AnimState {
  moving: boolean;
  atkAge: number; // ms since last attack started (Infinity if none)
  casting: boolean;
  deadAge: number; // ms since death (-1 alive)
  t: number; // seconds
}

/**
 * Geometries are shared between every model that uses an identical shape, so spawning
 * an entity doesn't upload new buffers to the GPU. Keyed by type + vertex positions
 * (covers rotateX() & co). Shared geometries must never be disposed.
 */
const geoCache = new Map<string, THREE.BufferGeometry>();
function shared(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position').array;
  let h = 0;
  for (let i = 0; i < pos.length; i++) h = (Math.imul(h, 31) + Math.round(pos[i] * 1e4)) | 0;
  const key = `${geo.type}:${pos.length}:${h}`;
  const hit = geoCache.get(key);
  if (hit) {
    geo.dispose();
    return hit;
  }
  geoCache.set(key, geo);
  return geo;
}

function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(shared(geo), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function darker(c: number, k = 0.7): number {
  const col = new THREE.Color(c);
  col.multiplyScalar(k);
  return col.getHex();
}

type WeaponKind = 'sword' | 'staff' | 'blunt' | 'club' | 'bow' | null;

function weaponMesh(kind: WeaponKind, color: number): THREE.Group | null {
  if (!kind) return null;
  const g = new THREE.Group();
  if (kind === 'sword') {
    g.add(part(B(0.05, 0.03, 0.95), color, 0, 0, 0.55));
    g.add(part(B(0.26, 0.05, 0.06), 0x8a6a2a, 0, 0, 0.06));
    g.add(part(B(0.05, 0.05, 0.2), 0x4a2a15, 0, 0, -0.06));
  } else if (kind === 'staff') {
    g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 1.7, 5), 0x6a4a2a, 0, 0.25, 0));
    const gem = part(new THREE.OctahedronGeometry(0.11, 0), color, 0, 1.15, 0);
    (gem.material as THREE.MeshLambertMaterial) = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.6, flatShading: true });
    g.add(gem);
  } else if (kind === 'blunt' || kind === 'club') {
    g.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 5).rotateX(Math.PI / 2), 0x5a3a20, 0, 0, 0.3));
    g.add(part(kind === 'club' ? new THREE.DodecahedronGeometry(0.15, 0) : B(0.2, 0.2, 0.3), color, 0, 0, 0.7));
  } else if (kind === 'bow') {
    const bow = part(new THREE.TorusGeometry(0.55, 0.03, 4, 10, Math.PI), 0x6a4a2a, 0, 0, 0.05);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    g.add(bow);
  }
  return g;
}

/** Visible equipment worn by a humanoid. */
export interface Gear { chest?: ItemDef | null; head?: ItemDef | null; gloves?: ItemDef | null; legs?: ItemDef | null; feet?: ItemDef | null }

interface HumanoidOpts {
  skin: number; hair: number; top: number; bottom: number; height: number; bulk: number;
  weapon: WeaponKind; weaponColor?: number; weaponGrade?: string; robe?: boolean; ears?: 'elf' | 'goblin'; tusks?: boolean; beard?: boolean; bald?: boolean; skull?: boolean;
  hat?: number;
  /** 0 short, 1 long, 2 topknot */
  hairStyle?: number;
  female?: boolean;
  gear?: Gear;
}

/** Self-lit trim for C-grade gear so it reads as "rare" at a glance. */
const glowCache = new Map<number, THREE.MeshLambertMaterial>();
function glow(color: number): THREE.MeshLambertMaterial {
  let m = glowCache.get(color);
  if (!m) glowCache.set(color, (m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.55, flatShading: true })));
  return m;
}
function trim(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = part(geo, color, x, y, z);
  m.material = glow(color);
  return m;
}
const GOLD = 0xe8c060;
const LEATHER = 0x5a3a20;

function helmet(head: THREE.Group, def: ItemDef): boolean {
  const c = def.color;
  if (def.id === 'leather_cap') {
    head.add(part(new THREE.SphereGeometry(0.215, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), c, 0, 0.02, -0.01));
    head.add(part(new THREE.CylinderGeometry(0.225, 0.225, 0.05, 8), darker(c, 0.7), 0, 0.03, -0.01));
    return false; // long hair still shows below a cap
  }
  if (def.grade === 'C') {
    // closed great helm with visor slit and plume
    head.add(part(B(0.42, 0.44, 0.44), c, 0, 0.03, 0));
    head.add(part(B(0.3, 0.04, 0.02), 0x111111, 0, 0.04, 0.225));
    head.add(trim(B(0.44, 0.04, 0.46), GOLD, 0, 0.24, 0));
    head.add(trim(B(0.04, 0.4, 0.02), GOLD, 0, 0.0, 0.226));
    const plume = part(B(0.06, 0.18, 0.36), 0xb02020, 0, 0.36, -0.04);
    head.add(plume);
    return true;
  }
  // open helm with nose guard and cheek plates
  head.add(part(new THREE.SphereGeometry(0.225, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), c, 0, 0.02, 0));
  head.add(part(B(0.04, 0.16, 0.04), darker(c, 0.8), 0, -0.02, 0.21));
  for (const sx of [-1, 1]) head.add(part(B(0.05, 0.16, 0.14), c, sx * 0.19, -0.06, 0.06));
  return true;
}

function chestArmor(torso: THREE.Group, def: ItemDef, k: number, female: boolean) {
  const c = def.color, d = 0.3 * Math.sqrt(k);
  if (def.grade === 'C' && def.id !== 'demons_tunic') {
    // full plate: breastplate, gorget, big rounded pauldrons
    torso.add(part(B(0.54 * k, 0.4, d + 0.06), c, 0, 0.42, 0.01));
    torso.add(part(B(0.3 * k, 0.12, d + 0.04), darker(c, 0.85), 0, 0.66, 0));
    torso.add(trim(B(0.04, 0.38, 0.02), GOLD, 0, 0.42, d / 2 + 0.05));
    for (const sx of [-1, 1]) {
      torso.add(part(new THREE.SphereGeometry(0.17 * k, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), c, sx * 0.31 * k, 0.58, 0));
      torso.add(trim(B(0.04, 0.04, 0.3), GOLD, sx * 0.31 * k, 0.6, 0));
    }
    return;
  }
  if (def.grade === 'D' && !def.mp) {
    // brigandine: studded vest with leather pauldrons
    for (let r = 0; r < 3; r++)
      for (const sx of [-0.14, 0, 0.14]) torso.add(part(B(0.035, 0.035, 0.02), 0x2a2a2a, sx * k, 0.24 + r * 0.14, d / 2 + 0.005));
    for (const sx of [-1, 1]) torso.add(part(B(0.18 * k, 0.07, 0.26), darker(c, 0.8), sx * 0.29 * k, 0.62, 0));
    return;
  }
  if (def.mp) {
    // caster robes: collar, sash; demon's tunic gets glowing runes
    torso.add(part(B(0.36 * k, 0.08, d + 0.02), darker(c, 0.7), 0, 0.64, 0));
    torso.add(part(B(0.08, 0.6, 0.02), darker(c, 1.4), 0, 0.32, d / 2 + 0.01));
    if (def.grade === 'C') for (const y of [0.2, 0.36, 0.52]) torso.add(trim(B(0.12, 0.03, 0.02), 0xff3060, 0, y, d / 2 + 0.02));
    return;
  }
  // cloth tunic: a simple collar
  if (!female) torso.add(part(B(0.2, 0.04, d + 0.01), darker(c, 0.7), 0, 0.62, 0));
}

export function humanoid(o: HumanoidOpts): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = o.bulk;
  const g = o.gear ?? {};
  const legC = g.legs?.color ?? o.bottom;
  const bootC = g.feet?.color ?? (o.gear ? 0x4a3420 : darker(o.bottom, 0.5));
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.12 * k, 0.9, 0);
    leg.add(part(B(0.17 * k, 0.5, 0.2), legC, 0, -0.25, 0)); // thigh
    leg.add(part(B(0.15 * k, 0.42, 0.18), darker(legC, 0.92), 0, -0.64, 0)); // shin
    if (g.legs && g.legs.grade !== 'NG') leg.add(part(B(0.12 * k, 0.1, 0.06), g.legs.grade === 'C' ? 0xc0c8d0 : darker(legC, 0.7), 0, -0.47, 0.1)); // knee guard
    const sandals = g.feet?.id === 'leather_sandals';
    const tall = g.feet && g.feet.grade !== 'NG';
    if (tall) leg.add(part(B(0.18 * k, 0.26, 0.21), bootC, 0, -0.74, 0.01));
    leg.add(part(B(0.19 * k, sandals ? 0.05 : 0.12, 0.28), sandals ? LEATHER : bootC, 0, sandals ? -0.89 : -0.86, 0.04));
    body.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Group();
  torso.position.y = 0.9;
  const d = 0.28 * Math.sqrt(k);
  if (o.female) {
    torso.add(part(B(0.46 * k, 0.32, d), o.top, 0, 0.46, 0));
    torso.add(part(B(0.38 * k, 0.3, d * 0.92), o.top, 0, 0.16, 0));
  } else torso.add(part(B(0.5 * k, 0.64, d), o.top, 0, 0.32, 0));
  torso.add(part(B(0.52 * k, 0.08, d + 0.02), o.gear ? LEATHER : darker(o.top, 0.5), 0, 0.02, 0)); // belt
  if (o.gear) torso.add(part(B(0.07, 0.06, 0.02), GOLD, 0, 0.02, d / 2 + 0.012)); // buckle
  torso.add(part(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 6), o.skin, 0, 0.68, 0)); // neck
  if (g.chest) chestArmor(torso, g.chest, k, !!o.female);
  if (o.robe) torso.add(part(new THREE.CylinderGeometry(0.26 * k, 0.4 * k, 0.75, 6), o.top, 0, -0.38, 0));
  body.add(torso);

  const head = new THREE.Group();
  head.position.y = 1.72;
  head.add(part(new THREE.IcosahedronGeometry(0.19, 1), o.skin));
  const closedHelm = g.head?.grade === 'C';
  if (!closedHelm) {
    const eye = o.skull ? B(0.06, 0.04, 0.02) : B(0.04, 0.04, 0.02);
    for (const sx of [-1, 1]) head.add(part(eye, o.skull ? 0x111111 : 0x222222, sx * 0.07, 0.02, 0.17));
  }
  const hideHair = g.head ? helmet(head, g.head) : false;
  if (!o.bald && !hideHair) {
    if (!g.head) head.add(part(new THREE.SphereGeometry(0.205, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), o.hair, 0, 0.03, -0.02));
    if (o.hairStyle === 1) head.add(part(B(0.36, 0.42, 0.1), o.hair, 0, -0.14, -0.15));
    if (o.hairStyle === 2 && !g.head) head.add(part(new THREE.IcosahedronGeometry(0.1, 0), o.hair, 0, 0.25, -0.08));
  }
  if (o.ears && !closedHelm) {
    const len = o.ears === 'goblin' ? 0.3 : 0.2;
    for (const sx of [-1, 1]) {
      const ear = part(new THREE.ConeGeometry(0.045, len, 4), o.skin, sx * 0.2, 0.04, 0);
      ear.rotation.z = -sx * (Math.PI / 2 - 0.35);
      head.add(ear);
    }
  }
  if (o.tusks && !closedHelm) for (const sx of [-1, 1]) head.add(part(new THREE.ConeGeometry(0.025, 0.1, 4), 0xf0f0e0, sx * 0.07, -0.1, 0.16));
  if (o.beard && !closedHelm) head.add(part(B(0.26, 0.24, 0.12), o.hair, 0, -0.18, 0.12));
  if (o.hat !== undefined) {
    head.add(part(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 8), o.hat, 0, 0.12, 0));
    head.add(part(new THREE.ConeGeometry(0.17, 0.45, 8), o.hat, 0, 0.35, 0));
  }
  body.add(head);

  const arms: THREE.Group[] = [];
  const handC = g.gloves?.color ?? o.skin;
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * (0.3 * k * (o.female ? 0.92 : 1) + 0.02), 1.5, 0);
    arm.add(part(B(0.13 * k, 0.32, 0.14), o.top, 0, -0.15, 0)); // upper arm (sleeve)
    arm.add(part(B(0.12 * k, 0.3, 0.13), o.gear && !o.robe ? o.skin : o.top, 0, -0.45, 0)); // forearm
    if (g.gloves) arm.add(part(B(0.15 * k, g.gloves.grade === 'NG' ? 0.08 : 0.14, 0.16), handC, 0, -0.55, 0)); // cuff / gauntlet
    arm.add(part(new THREE.IcosahedronGeometry(0.075 * k, 0), handC, 0, -0.64, 0));
    body.add(arm);
    arms.push(arm);
  }
  const w = weaponMesh(o.weapon, o.weaponColor ?? 0xc8d0d8);
  if (w) {
    if (o.weaponGrade === 'C') w.traverse((m) => m instanceof THREE.Mesh && m.position.z > 0.3 && (m.material = glow(o.weaponColor ?? 0xffffff)));
    w.position.y = -0.64;
    arms[1].add(w);
  }
  root.scale.setScalar(o.height);
  return { root, body, kind: 'humanoid', legs, armL: arms[0], armR: arms[1], torso, height: 1.95 * o.height, radius: 0.4 * o.height * k };
}

function beast(color: number, scale: number, opts: { horns?: boolean } = {}): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(part(B(0.55, 0.5, 1.15), color, 0, 0.72, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.95, 0.65);
  head.add(part(B(0.38, 0.36, 0.42), color));
  head.add(part(B(0.22, 0.18, 0.28), darker(color, 0.8), 0, -0.06, 0.3));
  head.add(part(B(0.05, 0.05, 0.02), 0x111111, -0.11, 0.06, 0.22));
  head.add(part(B(0.05, 0.05, 0.02), 0x111111, 0.11, 0.06, 0.22));
  for (const sx of [-1, 1]) head.add(part(new THREE.ConeGeometry(0.07, 0.2, 4), darker(color, 0.7), sx * 0.13, 0.25, -0.08));
  if (opts.horns) for (const sx of [-1, 1]) head.add(part(new THREE.ConeGeometry(0.05, 0.3, 4), 0xeeeecc, sx * 0.15, 0.25, 0.05));
  body.add(head);
  const tail = part(B(0.1, 0.1, 0.5), color, 0, 0.85, -0.75);
  tail.rotation.x = 0.6;
  body.add(tail);
  const legs: THREE.Object3D[] = [];
  for (const [sx, sz] of [[-1, 1], [1, -1], [1, 1], [-1, -1]]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.2, 0.5, sz * 0.4);
    leg.add(part(B(0.15, 0.5, 0.15), darker(color, 0.85), 0, -0.25, 0));
    body.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, kind: 'beast', legs, torso: head, height: 1.25 * scale, radius: 0.6 * scale };
}

function spider(color: number, scale: number): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(part(new THREE.IcosahedronGeometry(0.55, 1), color, 0, 0.75, -0.45));
  body.add(part(new THREE.IcosahedronGeometry(0.32, 1), darker(color, 1.3), 0, 0.6, 0.25));
  for (const sx of [-1, 1]) body.add(part(B(0.06, 0.06, 0.02), 0xff2222, sx * 0.1, 0.7, 0.55));
  const legs: THREE.Object3D[] = [];
  for (let i = 0; i < 8; i++) {
    const sx = i < 4 ? -1 : 1;
    const leg = new THREE.Group();
    leg.position.set(sx * 0.2, 0.6, 0.35 - (i % 4) * 0.22);
    const seg = part(B(0.7, 0.06, 0.06), darker(color, 0.8), sx * 0.35, 0.15, 0);
    seg.rotation.z = sx * 0.5;
    const seg2 = part(B(0.06, 0.7, 0.06), darker(color, 0.8), sx * 0.68, -0.15, 0);
    leg.add(seg, seg2);
    leg.rotation.y = sx * ((i % 4) - 1.5) * 0.35;
    body.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, kind: 'spider', legs, height: 1.3 * scale, radius: 0.8 * scale };
}

function weaponKindOf(itemId: string | null, cls: ClassType): WeaponKind {
  if (!itemId) return null;
  const wt = ITEMS[itemId]?.weaponType;
  return wt ?? (cls === 'mystic' ? 'staff' : 'sword');
}

export function playerModel(race: Race, cls: ClassType, weapon: string | null, chest: string | null, look: Look = DEFAULT_LOOK, eq: (string | null)[] = []): Rig {
  const r = RACES[race];
  const female = look.g === 'f';
  const hair = HAIR_COLORS[look.hc] >= 0 ? HAIR_COLORS[look.hc] : r.hair;
  const it = (id: string | null | undefined) => (id ? ITEMS[id] ?? null : null);
  const chestDef = it(chest);
  const [head, gloves, legs, feet] = eq.map(it);
  const top = chestDef?.color ?? 0xb0a080;
  const robe = !!chestDef && (chestDef.id === 'karmian_tunic' || chestDef.id === 'demons_tunic' || (cls === 'mystic' && chestDef.grade === 'NG'));
  return bake(humanoid({
    skin: r.skin, hair, top, bottom: darker(top, 0.65), height: r.height * (female ? 0.96 : 1), bulk: r.bulk * (female ? 0.86 : 1),
    hairStyle: look.hs, female,
    weapon: weaponKindOf(weapon, cls), weaponColor: weapon ? ITEMS[weapon]?.color : undefined, weaponGrade: it(weapon)?.grade, robe,
    ears: race === 'elf' || race === 'darkelf' ? 'elf' : undefined, tusks: race === 'orc' && !female, beard: race === 'dwarf' && !female, bald: race === 'orc' && !female && look.hs === 0,
    gear: { chest: chestDef, head, gloves, legs, feet },
  }));
}

export function mobModel(tplId: string): Rig {
  const t = MOBS[tplId];
  const c = t.color;
  let rig: Rig;
  switch (t.shape) {
    case 'beast':
      rig = beast(c, t.scale, { horns: t.id === 'hill_lizard' });
      break;
    case 'spider':
      rig = spider(c, t.scale);
      break;
    case 'goblin':
      rig = humanoid({ skin: c, hair: 0x2a2a1a, top: 0x6a4a2a, bottom: 0x4a3a2a, height: t.scale, bulk: 1.1, weapon: 'club', weaponColor: 0x6a4a2a, ears: 'goblin', bald: true });
      break;
    case 'orc': {
      const archer = t.id === 'orc_archer', shaman = t.id === 'orc_shaman';
      rig = humanoid({ skin: c, hair: 0x1a1a1a, top: shaman ? 0x6a2a5a : 0x5a4030, bottom: 0x3a2a20, height: t.scale, bulk: 1.3,
        weapon: archer ? 'bow' : shaman ? 'staff' : 'blunt', weaponColor: shaman ? 0xff44aa : 0x777777, tusks: true, bald: true, robe: shaman });
      break;
    }
    case 'golem':
      rig = humanoid({ skin: c, hair: c, top: darker(c, 0.85), bottom: darker(c, 0.75), height: t.scale, bulk: 1.9, weapon: null, bald: true });
      break;
    case 'undead':
      rig = humanoid({ skin: c, hair: 0x222222, top: t.boss ? 0x4a1a6a : 0x3a3a3a, bottom: 0x2a2a2a, height: t.scale, bulk: 0.85,
        weapon: t.boss ? 'staff' : 'sword', weaponColor: t.boss ? 0xaa44ff : 0x888888, bald: true, skull: true, robe: !!t.boss, hat: t.boss ? 0x2a0a3a : undefined });
      break;
  }
  return bake(rig);
}

export function npcModel(npcId: string): Rig {
  const n = NPCS.find((x) => x.id === npcId)!;
  const rig = humanoid({ skin: n.look?.skin ?? 0xe8b996, hair: n.look?.beard ?? 0x3a2a1a, top: n.color, bottom: darker(n.color, 0.6),
    height: n.kind === 'talker' ? 0.93 : 1, bulk: 1, weapon: null, robe: true,
    hat: n.kind === 'gatekeeper' ? 0x4a1a4a : n.kind === 'quest' ? 0xc8a050 : undefined, bald: n.look?.bald, beard: n.look?.beard !== undefined });
  if (n.kind === 'talker' && rig.torso) rig.torso.rotation.x = 0.25; // old man's stoop
  return bake(rig);
}

export function itemModel(itemId: string): THREE.Group {
  const g = new THREE.Group();
  const def = ITEMS[itemId];
  if (itemId === 'adena') {
    for (let i = 0; i < 4; i++) g.add(part(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 8), 0xffcc33, (i % 2) * 0.1 - 0.05, 0.03 + i * 0.045, (i >> 1) * 0.08));
  } else if (def?.type === 'weapon') {
    const w = weaponMesh(def.weaponType ?? 'sword', def.color)!;
    w.rotation.set(Math.PI / 2, 0, 0);
    w.position.y = 0.05;
    g.add(w);
  } else {
    g.add(part(new THREE.IcosahedronGeometry(0.2, 0), def?.color ?? 0xffffff, 0, 0.2, 0));
  }
  return g;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** One material for every baked part: colours live in the vertices. */
const VCOLOR = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * Merge the plain-coloured parts of every group in a rig (legs, arms, torso,
 * head, weapon...) into one mesh per group, so a character costs a handful of
 * draw calls instead of ~40 while still animating per limb. Self-lit trims keep
 * their own material. Baked geometries are per-entity: dispose them on removal
 * (they carry userData.baked).
 */
export function bake(rig: Rig): Rig {
  const c = new THREE.Color();
  const visit = (g: THREE.Object3D) => {
    const plain = g.children.filter((o): o is THREE.Mesh => {
      if (!(o instanceof THREE.Mesh) || o.children.length) return false;
      const m = o.material as THREE.MeshLambertMaterial;
      return m instanceof THREE.MeshLambertMaterial && !m.transparent && m.emissive.getHex() === 0;
    });
    if (plain.length > 1) {
      const geos = plain.map((o) => {
        o.updateMatrix();
        const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
        for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
        c.copy((o.material as THREE.MeshLambertMaterial).color);
        const n = geo.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return geo;
      });
      const merged = mergeGeometries(geos);
      for (const geo of geos) geo.dispose();
      if (merged) {
        for (const o of plain) g.remove(o);
        const mesh = new THREE.Mesh(merged, VCOLOR);
        mesh.castShadow = true;
        mesh.userData.baked = true;
        g.add(mesh);
      }
    }
    for (const child of [...g.children]) if (!(child instanceof THREE.Mesh)) visit(child);
  };
  visit(rig.root);
  return rig;
}

export function animate(rig: Rig, s: AnimState) {
  const { body, legs, armL, armR, torso } = rig;
  if (s.deadAge >= 0) {
    const k = Math.min(1, s.deadAge / 450);
    body.rotation.x = rig.kind === 'humanoid' ? -k * Math.PI / 2 : 0;
    body.rotation.z = rig.kind === 'humanoid' ? 0 : k * Math.PI / 2;
    body.position.y = rig.kind === 'humanoid' ? k * 0.15 : k * 0.3;
    return;
  }
  body.rotation.set(0, 0, 0);
  body.position.y = 0;
  const walk = s.moving ? Math.sin(s.t * 11) : 0;
  if (rig.kind === 'humanoid') {
    legs[0].rotation.x = walk * 0.7;
    legs[1].rotation.x = -walk * 0.7;
    body.position.y = s.moving ? Math.abs(Math.cos(s.t * 11)) * 0.05 : 0;
    if (torso) torso.scale.y = 1 + (s.moving ? 0 : Math.sin(s.t * 2) * 0.015);
    let ar = -walk * 0.5, al = walk * 0.5, zr = 0, zl = 0;
    if (s.casting) {
      ar = al = -1.6 + Math.sin(s.t * 8) * 0.1;
      zr = -0.25; zl = 0.25;
    } else if (s.atkAge < 450) {
      const k = s.atkAge / 450;
      ar = k < 0.35 ? lerp(0, -2.6, k / 0.35) : lerp(-2.6, -0.3, (k - 0.35) / 0.65);
      body.rotation.y = Math.sin(k * Math.PI) * -0.3;
    }
    if (armR) { armR.rotation.x = ar; armR.rotation.z = zr; }
    if (armL) { armL.rotation.x = al; armL.rotation.z = zl; }
  } else if (rig.kind === 'beast') {
    legs[0].rotation.x = legs[1].rotation.x = walk * 0.6;
    legs[2].rotation.x = legs[3].rotation.x = -walk * 0.6;
    if (torso) {
      const k = s.atkAge < 400 ? Math.sin((s.atkAge / 400) * Math.PI) : 0;
      torso.rotation.x = k * 0.5;
      torso.position.z = 0.65 + k * 0.2;
    }
    body.position.y = s.moving ? Math.abs(Math.sin(s.t * 11)) * 0.06 : 0;
  } else {
    legs.forEach((l, i) => (l.rotation.x = s.moving ? Math.sin(s.t * 16 + i) * 0.35 : 0));
    const k = s.atkAge < 400 ? Math.sin((s.atkAge / 400) * Math.PI) : 0;
    body.rotation.x = -k * 0.3;
  }
}
