import * as THREE from 'three';
import { DEFAULT_LOOK, HAIR_COLORS, HAIR_STYLES, RACES, type ClassType, type Look, type Race } from '../../../shared/src/data/classes';
import { GRADE_COLOR, ITEMS, type ItemDef } from '../../../shared/src/data/items';

/** C grade and up share the top-tier look (trim, glow) */
const topTier = (g?: string) => !!g && g !== 'NG' && g !== 'D';
import { MOBS } from '../../../shared/src/data/mobs';
import { NPCS } from '../../../shared/src/data/world';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from './scene';
import { animateQ, HEADGEAR, qPlayer, qReady, qWeapon, type QAnim, type QZone } from './quaternius';

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  kind: 'humanoid' | 'beast' | 'spider';
  legs: THREE.Object3D[];
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  torso?: THREE.Object3D;
  head?: THREE.Object3D;
  tail?: THREE.Object3D;
  /** special idle/walk posture */
  pose?: 'zombie' | 'hunch' | 'float';
  height: number;
  radius: number;
  /** skinned Quaternius character: clip-driven instead of per-limb */
  q?: QAnim;
  /** frees what is per-entity (shared geometries and materials stay) */
  dispose?: () => void;
}

export interface AnimState {
  moving: boolean;
  atkAge: number; // ms since last attack started (Infinity if none)
  casting: boolean;
  deadAge: number; // ms since death (-1 alive)
  t: number; // seconds
  /** /dance emote */
  dancing?: boolean;
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

export type WeaponKind = 'sword' | 'staff' | 'blunt' | 'club' | 'bow' | 'axe' | 'spear' | 'shovel' | 'pickaxe' | null;

const WOOD = 0x6a4a2a, IRON = 0x9aa2aa;

/** Weapons are built along +Z (the grip at the origin, held in the right hand). */
export function weaponMesh(kind: WeaponKind, color: number): THREE.Group | null {
  if (!kind) return null;
  const g = new THREE.Group();
  const shaft = (len: number, r = 0.035, c = WOOD) => part(new THREE.CylinderGeometry(r, r, len, 6).rotateX(Math.PI / 2), c, 0, 0, len / 2 - 0.15);
  if (kind === 'sword') {
    g.add(part(B(0.07, 0.025, 0.85), color, 0, 0, 0.55)); // blade
    g.add(part(new THREE.ConeGeometry(0.05, 0.16, 4).rotateX(Math.PI / 2), color, 0, 0, 1.05)); // tip
    g.add(part(B(0.015, 0.03, 0.7), darker(color, 0.75), 0, 0, 0.5)); // fuller
    g.add(part(B(0.3, 0.05, 0.06), 0x8a6a2a, 0, 0, 0.1)); // guard
    g.add(part(B(0.045, 0.045, 0.2), 0x4a2a15, 0, 0, -0.03)); // grip
    g.add(part(new THREE.IcosahedronGeometry(0.045, 0), 0x8a6a2a, 0, 0, -0.15)); // pommel
  } else if (kind === 'staff') {
    g.add(part(new THREE.CylinderGeometry(0.03, 0.04, 1.8, 6), WOOD, 0, 0.3, 0));
    const ring = part(new THREE.TorusGeometry(0.13, 0.025, 5, 10), 0x8a6a2a, 0, 1.2, 0);
    g.add(ring);
    const gem = part(new THREE.OctahedronGeometry(0.1, 0), color, 0, 1.2, 0);
    gem.material = glow(color);
    g.add(gem);
  } else if (kind === 'blunt') {
    g.add(shaft(0.85));
    g.add(part(B(0.2, 0.2, 0.3), color, 0, 0, 0.7));
    for (const sx of [-1, 1]) g.add(part(B(0.06, 0.24, 0.32), darker(color, 0.8), sx * 0.12, 0, 0.7));
  } else if (kind === 'club') {
    g.add(shaft(0.75, 0.04));
    g.add(part(new THREE.DodecahedronGeometry(0.15, 0), color, 0, 0, 0.62));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      g.add(part(new THREE.ConeGeometry(0.03, 0.12, 4), 0xc0c0b0, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.62));
    }
  } else if (kind === 'axe') {
    g.add(shaft(0.95));
    g.add(part(B(0.04, 0.32, 0.22), color, 0, 0.14, 0.72));
    g.add(part(B(0.02, 0.36, 0.08), 0xd0d4d8, 0, 0.16, 0.84)); // edge
  } else if (kind === 'spear') {
    g.add(shaft(1.9, 0.028));
    g.add(part(new THREE.ConeGeometry(0.06, 0.3, 4).rotateX(Math.PI / 2), color, 0, 0, 1.85));
  } else if (kind === 'shovel') {
    g.add(shaft(1.3, 0.03));
    g.add(part(B(0.22, 0.03, 0.28), IRON, 0, 0, 1.25));
  } else if (kind === 'pickaxe') {
    g.add(shaft(1.0, 0.035));
    const head = part(new THREE.ConeGeometry(0.04, 0.6, 4).rotateZ(Math.PI / 2), IRON, 0, 0, 0.82);
    g.add(head);
  } else if (kind === 'bow') {
    const bow = part(new THREE.TorusGeometry(0.55, 0.03, 4, 12, Math.PI), WOOD, 0, 0, 0.05);
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    g.add(bow);
    g.add(part(B(0.008, 1.1, 0.008), 0xe8e0c8, 0, 0, -0.02)); // string
  }
  return g;
}

/** Round shield for the off hand. */
function shieldMesh(color: number, boss = IRON): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10).rotateZ(Math.PI / 2), color, -0.06, -0.55, 0.05));
  g.add(part(new THREE.IcosahedronGeometry(0.07, 0), boss, -0.1, -0.55, 0.05));
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
  if (topTier(def.grade)) {
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
  if (topTier(def.grade) && def.id !== 'demons_tunic') {
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
    if (topTier(def.grade)) for (const y of [0.2, 0.36, 0.52]) torso.add(trim(B(0.12, 0.03, 0.02), 0xff3060, 0, y, d / 2 + 0.02));
    return;
  }
  // cloth tunic: a simple collar
  if (!female) torso.add(part(B(0.2, 0.04, d + 0.01), darker(c, 0.7), 0, 0.62, 0));
}

function raceFeatures(head: THREE.Object3D, skin: number, ears?: 'elf' | 'goblin', tusks?: boolean) {
  if (ears) {
    const len = ears === 'goblin' ? 0.3 : 0.2;
    for (const sx of [-1, 1]) {
      const ear = part(new THREE.ConeGeometry(0.045, len, 4), skin, sx * 0.2, 0.04, 0);
      ear.rotation.z = -sx * (Math.PI / 2 - 0.35);
      head.add(ear);
    }
  }
  if (tusks) for (const sx of [-1, 1]) head.add(part(new THREE.ConeGeometry(0.025, 0.1, 4), 0xf0f0e0, sx * 0.07, -0.1, 0.16));
}

/** The weapon as held: C-grade blades glow. */
function heldWeapon(kind: WeaponKind, color = 0xc8d0d8, grade?: string): THREE.Group | null {
  const w = weaponMesh(kind, color);
  if (w && topTier(grade)) w.traverse((m) => m instanceof THREE.Mesh && m.position.z > 0.3 && (m.material = glow(color)));
  return w;
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
    if (g.legs && g.legs.grade !== 'NG') leg.add(part(B(0.12 * k, 0.1, 0.06), topTier(g.legs.grade) ? 0xc0c8d0 : darker(legC, 0.7), 0, -0.47, 0.1)); // knee guard
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
  const closedHelm = g.head?.id === 'full_plate_helmet';
  if (!closedHelm) {
    const eye = o.skull ? B(0.06, 0.04, 0.02) : B(0.04, 0.04, 0.02);
    for (const sx of [-1, 1]) head.add(part(eye, o.skull ? 0x111111 : 0x222222, sx * 0.07, 0.02, 0.17));
  }
  const hideHair = g.head ? helmet(head, g.head) : false;
  if (!o.bald && !hideHair) {
    if (!g.head) head.add(part(new THREE.SphereGeometry(0.205, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), o.hair, 0, 0.03, -0.02));
    if (o.hairStyle === 1) {
      // long hair: a mane that follows the back of the head and narrows to the tips, with a lock on each side
      head.add(part(B(0.34, 0.2, 0.12), o.hair, 0, -0.05, -0.13));
      head.add(part(B(0.3, 0.2, 0.1), o.hair, 0, -0.24, -0.15));
      head.add(part(B(0.22, 0.16, 0.08), darker(o.hair, 0.9), 0, -0.41, -0.15));
      for (const sx of [-1, 1]) head.add(part(B(0.06, 0.26, 0.14), o.hair, sx * 0.185, -0.08, -0.04));
    }
    if (o.hairStyle === 2 && !g.head) head.add(part(new THREE.IcosahedronGeometry(0.1, 0), o.hair, 0, 0.25, -0.08));
  }
  if (!closedHelm) raceFeatures(head, o.skin, o.ears, o.tusks);
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
  const w = heldWeapon(o.weapon, o.weaponColor, o.weaponGrade);
  if (w) {
    w.position.y = -0.64;
    arms[1].add(w);
  }
  root.scale.setScalar(o.height);
  return { root, body, kind: 'humanoid', legs, armL: arms[0], armR: arms[1], torso, head, height: 1.95 * o.height, radius: 0.4 * o.height * k };
}

interface BeastOpts {
  ears?: 'fox' | 'wolf';
  tail: 'bushy' | 'fox' | 'lizard';
  mane?: boolean;
  spines?: boolean;
  horns?: boolean;
  fangs?: boolean;
  claws?: boolean;
  low?: boolean; // lizard: long, low-slung body
  belly?: number;
  eyes?: number; // glowing eye colour
}

/** Four-legged creature: chest + hips, neck, head with snout, tail and jointed legs. */
function beast(color: number, scale: number, o: BeastOpts): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const dark = darker(color, 0.75), belly = o.belly ?? darker(color, 1.35);
  const y = o.low ? 0.45 : 0.78, len = o.low ? 1.4 : 1;
  body.add(part(B(0.62, 0.56, 0.62 * len), color, 0, y, 0.25 * len)); // chest
  body.add(part(B(0.52, 0.48, 0.6 * len), color, 0, y - 0.03, -0.32 * len)); // hips
  body.add(part(B(0.42, 0.12, 1.0 * len), belly, 0, y - 0.28, 0)); // belly
  if (o.mane) for (let i = 0; i < 5; i++) body.add(part(B(0.7 - i * 0.04, 0.16, 0.16), dark, 0, y + 0.22 - i * 0.04, 0.5 - i * 0.12));
  if (o.spines) for (let i = 0; i < 7; i++) body.add(part(new THREE.ConeGeometry(0.06, 0.2 - Math.abs(i - 3) * 0.02, 4), 0xd8c890, 0, y + 0.34, 0.6 - i * 0.2));
  // neck + head
  const head = new THREE.Group();
  head.position.set(0, y + 0.22, 0.62 * len);
  head.userData.baseZ = head.position.z;
  head.add(part(B(0.26, 0.26, 0.3), color, 0, -0.06, -0.08)); // neck
  head.add(part(B(0.4, 0.36, 0.38), color, 0, 0.06, 0.15));
  const snout = o.low ? 0.42 : 0.3;
  head.add(part(B(0.24, 0.18, snout), darker(color, 0.85), 0, -0.02, 0.3 + snout / 2));
  head.add(part(B(0.22, 0.08, snout * 0.9), belly, 0, -0.12, 0.3 + snout / 2)); // jaw
  head.add(part(B(0.08, 0.07, 0.05), 0x151515, 0, 0.04, 0.32 + snout)); // nose
  for (const sx of [-1, 1]) {
    const eye = part(B(0.06, 0.05, 0.02), o.eyes ?? 0x111111, sx * 0.13, 0.12, 0.34);
    if (o.eyes) eye.material = glow(o.eyes);
    head.add(eye);
    if (o.ears) {
      const ear = part(new THREE.ConeGeometry(o.ears === 'fox' ? 0.09 : 0.07, o.ears === 'fox' ? 0.26 : 0.2, 4), dark, sx * 0.14, 0.32, 0.06);
      ear.rotation.z = -sx * 0.2;
      head.add(ear);
    }
    if (o.fangs) head.add(part(new THREE.ConeGeometry(0.025, 0.09, 4).rotateX(Math.PI), 0xf4f0e0, sx * 0.07, -0.16, 0.36 + snout * 0.6));
    if (o.horns) {
      const h = part(new THREE.ConeGeometry(0.05, 0.32, 5), 0xeeeecc, sx * 0.15, 0.3, 0.02);
      h.rotation.x = -0.6;
      head.add(h);
    }
  }
  body.add(head);
  // tail
  const tail = new THREE.Group();
  tail.position.set(0, y + 0.1, -0.62 * len);
  if (o.tail === 'lizard') {
    for (let i = 0; i < 4; i++) tail.add(part(B(0.26 - i * 0.05, 0.2 - i * 0.04, 0.4), color, 0, -0.08 - i * 0.04, -0.2 - i * 0.36));
  } else {
    const t1 = part(B(0.16, 0.16, 0.42), color, 0, 0.1, -0.18);
    t1.rotation.x = 0.7;
    const t2 = part(B(o.tail === 'fox' ? 0.24 : 0.2, o.tail === 'fox' ? 0.24 : 0.2, 0.36), color, 0, 0.32, -0.42);
    t2.rotation.x = 0.4;
    tail.add(t1, t2);
    if (o.tail === 'fox') tail.add(part(B(0.2, 0.2, 0.14), 0xf4efe6, 0, 0.42, -0.62)); // white tip
  }
  body.add(tail);
  // legs: upper, lower, paw
  const legs: THREE.Object3D[] = [];
  const legLen = o.low ? 0.3 : 0.5;
  for (const [sx, sz] of [[-1, 1], [1, -1], [1, 1], [-1, -1]]) {
    const leg = new THREE.Group();
    leg.position.set(sx * (o.low ? 0.34 : 0.22), y - 0.2, sz * 0.38 * len);
    leg.add(part(B(0.17, legLen * 0.55, 0.19), color, 0, -legLen * 0.25, 0));
    leg.add(part(B(0.13, legLen * 0.5, 0.14), dark, 0, -legLen * 0.7, 0.02));
    leg.add(part(B(0.17, 0.08, 0.22), darker(color, 0.55), 0, -legLen * 0.95 - 0.02, 0.05));
    if (o.claws) for (const cx of [-0.05, 0.05]) leg.add(part(new THREE.ConeGeometry(0.02, 0.08, 4).rotateX(Math.PI / 2), 0xf0ead8, cx, -legLen * 0.95 - 0.03, 0.2));
    if (o.low) leg.rotation.z = sx * 0.35;
    body.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, kind: 'beast', legs, torso: head, head, tail, height: (o.low ? 0.95 : 1.3) * scale, radius: 0.6 * scale };
}

/** Drake or dragon: a beast with a long neck, swept horns, a bladed tail and wings that beat. age: 0 whelp, 1 grown, 2 ancient. */
function dragon(color: number, scale: number, age: 0 | 1 | 2): Rig {
  const rig = beast(color, scale, { tail: 'lizard', spines: true, fangs: true, claws: true, belly: 0xd8c070, eyes: age ? 0xff5a1a : 0xffe040 });
  const { body } = rig, head = rig.head!, tail = rig.tail!;
  const dark = darker(color, 0.6), membrane = darker(color, 1.35), BONE = 0xe8e0c0;
  // long neck: the head sits higher and further out, on a slanted neck
  const neck = part(B(0.3, 0.62, 0.3), color, 0, 1.12, 0.62);
  neck.rotation.x = 0.55;
  body.add(neck, part(B(0.2, 0.5, 0.1), 0xd8c070, 0, 1.06, 0.76));
  head.position.y += 0.34;
  head.position.z += 0.16;
  head.userData.baseZ = head.position.z;
  for (const sx of [-1, 1]) {
    const horn = part(new THREE.ConeGeometry(0.06, 0.4 + age * 0.14, 5), BONE, sx * 0.16, 0.3, -0.1);
    horn.rotation.x = -1.05;
    horn.rotation.z = -sx * 0.25;
    head.add(horn);
    if (age) head.add(part(new THREE.ConeGeometry(0.035, 0.16, 4), BONE, sx * 0.2, 0.0, 0.2)); // cheek spikes
  }
  if (age === 2) for (let i = 0; i < 3; i++) head.add(part(new THREE.ConeGeometry(0.04, 0.2, 4), BONE, 0, 0.3, 0.2 - i * 0.14)); // crest
  // two more tail segments and a blade at the tip
  tail.add(part(B(0.08, 0.06, 0.4), color, 0, -0.24, -1.64));
  tail.add(part(new THREE.ConeGeometry(0.15, 0.42, 4).rotateX(-Math.PI / 2), BONE, 0, -0.24, -2.0));
  // wings: an arm bone, three membrane panels sweeping back and a claw at the wrist, hinged at the shoulder
  const span = 0.75 + age * 0.45;
  const wing = (sx: number) => {
    const w = new THREE.Group();
    w.position.set(sx * 0.3, 1.05, 0.22);
    w.add(part(B(span, 0.08, 0.1), dark, (sx * span) / 2, 0, 0.04));
    for (let i = 0; i < 3; i++) {
      const l = span * (1 - i * 0.2);
      w.add(part(B(l, 0.03, 0.36), i % 2 ? darker(membrane, 0.85) : membrane, (sx * l) / 2, -0.03, -0.16 - i * 0.33));
    }
    w.add(part(new THREE.ConeGeometry(0.04, 0.2, 4).rotateX(Math.PI / 2), BONE, sx * span, 0, 0.16));
    w.rotation.z = sx * 0.45;
    body.add(w);
    return w;
  };
  rig.armL = wing(-1);
  rig.armR = wing(1);
  rig.height = 1.95 * scale;
  return rig;
}

function spider(color: number, scale: number): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(part(new THREE.IcosahedronGeometry(0.58, 1), color, 0, 0.8, -0.5)); // abdomen
  for (let i = 0; i < 3; i++) body.add(part(B(0.5 - i * 0.12, 0.05, 0.1), 0xb03030, 0, 1.3 - i * 0.05, -0.45 - i * 0.22)); // markings
  body.add(part(new THREE.IcosahedronGeometry(0.34, 1), darker(color, 1.3), 0, 0.65, 0.22)); // cephalothorax
  for (const [ex, ey] of [[-0.12, 0.8], [0.12, 0.8], [-0.06, 0.86], [0.06, 0.86], [-0.17, 0.74], [0.17, 0.74]]) {
    const e = part(new THREE.IcosahedronGeometry(0.035, 0), 0xff2a2a, ex, ey, 0.5);
    e.material = glow(0xff2a2a);
    body.add(e);
  }
  for (const sx of [-1, 1]) {
    const f = part(new THREE.ConeGeometry(0.04, 0.2, 4).rotateX(Math.PI), 0x1a1010, sx * 0.07, 0.48, 0.5);
    body.add(f);
  }
  const legs: THREE.Object3D[] = [];
  const dark = darker(color, 0.8);
  for (let i = 0; i < 8; i++) {
    const sx = i < 4 ? -1 : 1;
    const leg = new THREE.Group();
    leg.position.set(sx * 0.22, 0.66, 0.38 - (i % 4) * 0.2);
    const up = part(B(0.6, 0.07, 0.07), dark, sx * 0.3, 0.2, 0);
    up.rotation.z = sx * 0.6;
    const knee = part(new THREE.IcosahedronGeometry(0.06, 0), color, sx * 0.58, 0.38, 0);
    const down = part(B(0.06, 0.8, 0.06), dark, sx * 0.72, -0.02, 0);
    down.rotation.z = -sx * 0.25;
    leg.add(up, knee, down);
    leg.rotation.y = sx * ((i % 4) - 1.5) * 0.35;
    body.add(leg);
    legs.push(leg);
  }
  root.scale.setScalar(scale);
  return { root, body, kind: 'spider', legs, height: 1.4 * scale, radius: 0.8 * scale };
}

/** Rocky golem: boulder torso, glowing crystal core, huge stone fists. */
function golem(color: number, scale: number): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const moss = 0x4a7a3a, d = darker(color, 0.8);
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.3, 0.8, 0);
    leg.add(part(new THREE.DodecahedronGeometry(0.26, 0), color, 0, -0.3, 0));
    leg.add(part(B(0.36, 0.26, 0.44), d, 0, -0.68, 0.05));
    body.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Group();
  torso.position.y = 0.85;
  torso.add(part(new THREE.DodecahedronGeometry(0.62, 0), color, 0, 0.55, 0));
  torso.add(part(new THREE.DodecahedronGeometry(0.4, 0), d, 0, 0.1, 0));
  torso.add(part(B(0.5, 0.12, 0.4), moss, 0.1, 1.05, -0.05));
  torso.add(part(B(0.3, 0.1, 0.3), moss, -0.3, 0.75, 0.2));
  const core = part(new THREE.OctahedronGeometry(0.16, 0), 0x6ae8ff, 0, 0.55, 0.52);
  core.material = glow(0x6ae8ff);
  torso.add(core);
  body.add(torso);
  const head = new THREE.Group();
  head.position.set(0, 2.0, 0.15);
  head.add(part(new THREE.DodecahedronGeometry(0.26, 0), d));
  for (const sx of [-1, 1]) {
    const e = part(B(0.08, 0.05, 0.02), 0x6ae8ff, sx * 0.1, 0.02, 0.24);
    e.material = glow(0x6ae8ff);
    head.add(e);
  }
  body.add(head);
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.72, 1.7, 0);
    arm.add(part(new THREE.DodecahedronGeometry(0.24, 0), d, 0, -0.1, 0));
    arm.add(part(B(0.3, 0.6, 0.3), color, 0, -0.5, 0));
    arm.add(part(new THREE.DodecahedronGeometry(0.3, 0), d, 0, -0.95, 0.05)); // fist
    body.add(arm);
    arms.push(arm);
  }
  root.scale.setScalar(scale);
  return { root, body, kind: 'humanoid', legs, armL: arms[0], armR: arms[1], torso, head, pose: 'hunch', height: 2.3 * scale, radius: 0.7 * scale };
}

/** Skeleton: bare bones, ribcage, jaw, glowing eyes; optional sword and shield. */
function skeleton(scale: number, opts: { lich?: boolean } = {}): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bone = 0xe2dccb, d = 0xb8b09a, eye = opts.lich ? 0xc060ff : 0x60e0ff;
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.12, 0.92, 0);
    leg.add(part(B(0.07, 0.46, 0.07), bone, 0, -0.24, 0));
    leg.add(part(new THREE.IcosahedronGeometry(0.06, 0), d, 0, -0.48, 0));
    leg.add(part(B(0.06, 0.42, 0.06), bone, 0, -0.7, 0));
    leg.add(part(B(0.12, 0.05, 0.2), d, 0, -0.9, 0.04));
    body.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Group();
  torso.position.y = 0.92;
  torso.add(part(B(0.3, 0.12, 0.14), d, 0, 0.02, 0)); // pelvis
  torso.add(part(B(0.06, 0.62, 0.06), bone, 0, 0.32, -0.06)); // spine
  for (let i = 0; i < 4; i++) torso.add(part(B(0.38 - i * 0.04, 0.04, 0.24), bone, 0, 0.62 - i * 0.09, 0)); // ribs
  torso.add(part(B(0.5, 0.06, 0.1), d, 0, 0.7, 0)); // collarbone
  body.add(torso);
  const head = new THREE.Group();
  head.position.y = 1.78;
  head.add(part(new THREE.IcosahedronGeometry(0.17, 1), bone, 0, 0.02, 0));
  head.add(part(B(0.2, 0.07, 0.16), d, 0, -0.14, 0.04)); // jaw
  for (const sx of [-1, 1]) {
    head.add(part(B(0.07, 0.06, 0.02), 0x111111, sx * 0.065, 0.03, 0.155));
    const e = part(B(0.03, 0.03, 0.02), eye, sx * 0.065, 0.03, 0.165);
    e.material = glow(eye);
    head.add(e);
  }
  body.add(head);
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.28, 1.58, 0);
    arm.add(part(B(0.06, 0.32, 0.06), bone, 0, -0.16, 0));
    arm.add(part(B(0.05, 0.3, 0.05), bone, 0, -0.46, 0));
    arm.add(part(new THREE.IcosahedronGeometry(0.05, 0), d, 0, -0.64, 0));
    body.add(arm);
    arms.push(arm);
  }
  if (!opts.lich) {
    const w = weaponMesh('sword', 0x8a7a60)!;
    w.position.y = -0.64;
    arms[1].add(w);
    arms[0].add(shieldMesh(0x5a4030));
  }
  root.scale.setScalar(scale);
  return { root, body, kind: 'humanoid', legs, armL: arms[0], armR: arms[1], torso, head, height: 1.95 * scale, radius: 0.35 * scale };
}

/** Small accessory helpers for mobs and NPCs built on the humanoid rig. */
function hood(head: THREE.Object3D, color: number) {
  head.add(part(new THREE.SphereGeometry(0.235, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), color, 0, 0.02, -0.03));
  head.add(part(new THREE.ConeGeometry(0.12, 0.22, 5), color, 0, 0.14, -0.2).rotateX(-0.9));
}
function cape(torso: THREE.Object3D, color: number, len = 1.1) {
  const c = part(B(0.5, len, 0.04), color, 0, 0.55 - len / 2, -0.19);
  c.rotation.x = 0.08;
  torso.add(c);
}
function apron(torso: THREE.Object3D, color: number) {
  torso.add(part(B(0.36, 0.7, 0.03), color, 0, 0.0, 0.16));
}

function weaponKindOf(itemId: string | null, cls: ClassType): WeaponKind {
  if (!itemId) return null;
  const wt = ITEMS[itemId]?.weaponType;
  return wt === 'dagger' ? 'sword' : wt ?? (cls === 'mystic' ? 'staff' : 'sword'); // no procedural dagger: a sword stands in
}

export function playerModel(race: Race, cls: ClassType, weapon: string | null, chest: string | null, look: Look = DEFAULT_LOOK, eq: (string | null)[] = []): Rig {
  const r = RACES[race];
  const female = look.g === 'f';
  const hair = HAIR_COLORS[look.hc] >= 0 ? HAIR_COLORS[look.hc] : r.hair;
  const it = (id: string | null | undefined) => (id ? ITEMS[id] ?? null : null);
  const chestDef = it(chest);
  const [head, gloves, legs, feet] = eq.map(it);
  const top = chestDef?.color ?? 0xb0a080;
  const elf = race === 'elf' || race === 'darkelf', tusks = race === 'orc' && !female, beard = race === 'dwarf' && !female, buzz = race === 'orc' && !female && look.hs === 0, bald = buzz || HAIR_STYLES[look.hs] === 'Pelado';
  if (qReady()) {
    const skin = race === 'orc' ? 0x5a7340 : r.skin; // the flat-shaded green reads as neon on a textured face
    const cap = head?.id === 'leather_cap'; // worn as a hood
    const gear = head && !cap ? HEADGEAR[head.id] ?? HEADGEAR.brigandine_helm : undefined;
    const hideHair = !!gear && !gear.hair;
    const zone = (d: ItemDef | null): QZone => ({ ranger: !!d && d.grade !== 'NG', dye: d?.color, glow: topTier(d?.grade) });
    return qPlayer({
      g: look.g, skin, hair, hairStyle: look.hs, bald: buzz, beard, hideHair,
      chest: zone(chestDef), legs: zone(legs), feet: zone(feet), gloves: gloves?.color, hood: cap ? head!.color : undefined,
      pauldron: !!chestDef && chestDef.grade !== 'NG' && !chestDef.mp,
      scale: r.height * 1.08, bulk: 1 + (r.bulk - 1) * 0.6, brawn: race === 'orc' ? 1.14 : race === 'dwarf' ? 1.06 : undefined, helm: gear?.model,
      head: race === 'dwarf' ? 1.12 : undefined, ...(!gear?.closed && { ears: elf ? 'elf_ears' as const : race === 'orc' ? 'orc_ears' as const : undefined, tusks: race === 'orc' }),
      inHand: qWeapon(weapon) ?? heldWeapon(weaponKindOf(weapon, cls), weapon ? ITEMS[weapon]?.color : undefined, it(weapon)?.grade),
    });
  }
  const robe = !!chestDef && (chestDef.id === 'karmian_tunic' || chestDef.id === 'demons_tunic' || (cls === 'mystic' && chestDef.grade === 'NG'));
  return bake(humanoid({
    skin: r.skin, hair, top, bottom: darker(top, 0.65), height: r.height * (female ? 0.96 : 1), bulk: r.bulk * (female ? 0.86 : 1),
    hairStyle: look.hs, female,
    weapon: weaponKindOf(weapon, cls), weaponColor: weapon ? ITEMS[weapon]?.color : undefined, weaponGrade: it(weapon)?.grade, robe,
    ears: elf ? 'elf' : undefined, tusks, beard, bald,
    gear: { chest: chestDef, head, gloves, legs, feet },
  }));
}

export function mobModel(tplId: string): Rig {
  const t = MOBS[tplId];
  const c = t.color;
  let rig: Rig;
  switch (t.id) {
    case 'keltir':
    case 'elder_keltir':
      rig = beast(c, t.scale, { ears: 'fox', tail: 'fox', belly: 0xf0e2c8 });
      if (t.id === 'elder_keltir') rig.head!.add(part(B(0.2, 0.06, 0.06), 0xd8d0c0, 0, 0.26, 0.2)); // grey brow
      break;
    case 'young_wolf':
    case 'wolf':
      rig = beast(c, t.scale, { ears: 'wolf', tail: 'bushy', mane: true, fangs: true, belly: darker(c, 1.25) });
      break;
    case 'werewolf':
      rig = beast(c, t.scale, { ears: 'wolf', tail: 'bushy', mane: true, fangs: true, claws: true, eyes: 0xffaa22 });
      break;
    case 'drake_whelp':
    case 'nest_hatchling':
      rig = dragon(c, t.scale, 0);
      break;
    case 'wyvern':
    case 'elder_drake':
      rig = dragon(c, t.scale, 1);
      break;
    case 'ancient_drake':
    case 'vharion':
      rig = dragon(c, t.scale, 2);
      break;
    case 'hill_lizard':
    case 'sea_serpent':
    case 'valley_basilisk':
      rig = beast(c, t.scale, { tail: 'lizard', spines: true, horns: true, low: true, belly: 0xc8c890, eyes: 0xffe040 });
      break;
    default:
      switch (t.shape) {
        case 'beast':
          rig = beast(c, t.scale, { ears: 'wolf', tail: 'bushy' });
          break;
        case 'spider':
          rig = spider(c, t.scale);
          break;
        case 'golem':
          rig = golem(c, t.scale);
          break;
        case 'goblin':
          rig = goblinRig(t.id, c, t.scale);
          break;
        case 'orc':
          rig = orcRig(t.id, c, t.scale);
          break;
        case 'undead':
          rig = undeadRig(t.id, c, t.scale, !!t.boss);
          break;
      }
  }
  return bake(rig!);
}

function goblinRig(id: string, skin: number, scale: number): Rig {
  const rig = humanoid({ skin, hair: 0x2a2a1a, top: 0x6a4a2a, bottom: 0x4a3a2a, height: scale, bulk: 1.1, weapon: id === 'gremlin' ? 'club' : 'sword',
    weaponColor: 0x8a8a80, ears: 'goblin', bald: true });
  const h = rig.head!, tor = rig.torso!;
  h.add(part(new THREE.ConeGeometry(0.05, 0.16, 4).rotateX(Math.PI / 2), darker(skin, 0.85), 0, -0.02, 0.24)); // hooked nose
  for (const sx of [-1, 1]) {
    const e = part(B(0.05, 0.04, 0.02), 0xffd030, sx * 0.07, 0.03, 0.175);
    e.material = glow(0xffd030);
    h.add(e);
  }
  tor.add(part(B(0.3, 0.32, 0.03), 0x5a3a20, 0, -0.18, 0.15)); // loincloth
  if (id === 'goblin_scout') {
    hood(h, 0x3a4a2a);
    cape(tor, 0x3a4a2a, 0.9);
  }
  if (id === 'gremlin_chief') {
    // bone crown and a ragged red cape
    for (let i = 0; i < 4; i++) h.add(part(new THREE.ConeGeometry(0.03, 0.14, 4), 0xe8e0c8, (i - 1.5) * 0.08, 0.22, 0.05));
    cape(tor, 0x8a2a20, 0.8);
  }
  return { ...rig, pose: 'hunch' };
}

function orcRig(id: string, skin: number, scale: number): Rig {
  const archer = id === 'orc_archer', shaman = id === 'orc_shaman', captain = id === 'orc_captain' || id === 'orc_warlord';
  const rig = humanoid({ skin, hair: 0x1a1a1a, top: shaman ? 0x6a2a5a : captain ? 0x4a2020 : 0x5a4030, bottom: 0x3a2a20, height: scale, bulk: 1.3,
    weapon: archer ? 'bow' : shaman ? 'staff' : 'axe', weaponColor: shaman ? 0xff44aa : captain ? 0xc0a050 : 0x8a8f95, tusks: true, bald: !archer, robe: shaman });
  const h = rig.head!, tor = rig.torso!;
  if (archer) {
    h.add(part(B(0.42, 0.06, 0.42), 0x8a2a20, 0, 0.1, 0)); // headband
    const quiver = part(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), 0x5a3a20, 0.12, 0.42, -0.2);
    quiver.rotation.z = 0.35;
    tor.add(quiver);
    for (let i = 0; i < 3; i++) tor.add(part(B(0.02, 0.18, 0.02), 0xe8e0c8, 0.2 + i * 0.03, 0.78, -0.2));
  } else if (shaman) {
    h.add(part(B(0.3, 0.26, 0.06), 0xe8e0cc, 0, 0.02, 0.18)); // bone mask
    for (const sx of [-1, 1]) h.add(part(B(0.06, 0.05, 0.02), 0x111111, sx * 0.07, 0.04, 0.215));
    for (let i = 0; i < 3; i++) h.add(part(B(0.04, 0.3, 0.02), [0xd04040, 0x40a0d0, 0xe0c040][i], (i - 1) * 0.08, 0.3, -0.1));
  } else {
    // warriors and the captain: horned helmet and a spiked pauldron
    const helmC = captain ? 0x5a5a60 : 0x6a6a6a;
    h.add(part(new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), helmC, 0, 0.03, 0));
    for (const sx of [-1, 1]) {
      const horn = part(new THREE.ConeGeometry(0.05, captain ? 0.4 : 0.26, 5), 0xe8e0c0, sx * 0.22, 0.16, 0);
      horn.rotation.z = -sx * 0.9;
      h.add(horn);
    }
    tor.add(part(B(0.24, 0.12, 0.3), helmC, -0.3, 0.62, 0));
    tor.add(part(new THREE.ConeGeometry(0.04, 0.16, 4), 0xd0d0c0, -0.3, 0.74, 0));
    if (captain) {
      cape(tor, 0x8a1a1a, 1.3);
      tor.add(trim(B(0.5, 0.05, 0.32), 0xe8c060, 0, 0.66, 0));
      rig.armL!.add(shieldMesh(0x6a2020, 0xe8c060));
    }
  }
  return rig;
}

function undeadRig(id: string, color: number, scale: number, boss: boolean): Rig {
  if (id === 'skeleton') return skeleton(scale);
  if (id === 'crypt_knight') {
    // armoured skeleton knight: great helm, cape, gauntlets
    const rig = skeleton(scale);
    const h = rig.head!, tor = rig.torso!;
    h.add(part(B(0.4, 0.3, 0.4), 0x6a6a72, 0, 0.1, 0));
    h.add(part(B(0.3, 0.04, 0.02), 0x111111, 0, 0.05, 0.205));
    h.add(part(B(0.04, 0.3, 0.32), 0x5a1a2a, 0, 0.32, -0.02));
    tor.add(part(B(0.46, 0.34, 0.26), 0x6a6a72, 0, 0.55, 0));
    cape(tor, 0x3a1a4a, 1.2);
    return rig;
  }
  if (boss) {
    // Kaim Vanul: floating lich in tattered robes, bone crown, glowing staff
    const rig = humanoid({ skin: 0xd8d0c0, hair: 0x222222, top: 0x3a1050, bottom: 0x2a0a3a, height: scale, bulk: 0.9, weapon: 'staff', weaponColor: 0xb050ff,
      bald: true, skull: true, robe: true });
    const h = rig.head!, tor = rig.torso!;
    for (const sx of [-1, 1]) {
      const e = part(B(0.05, 0.05, 0.02), 0xc060ff, sx * 0.07, 0.02, 0.18);
      e.material = glow(0xc060ff);
      h.add(e);
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      h.add(trim(new THREE.ConeGeometry(0.035, 0.18, 4), 0xe8c060, Math.sin(a) * 0.17, 0.2, Math.cos(a) * 0.17));
    }
    h.add(part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 8), 0x8a6a2a, 0, 0.13, 0));
    cape(tor, 0x1a0a28, 1.5);
    for (const sx of [-1, 1]) tor.add(part(new THREE.ConeGeometry(0.06, 0.24, 4), 0xd8d0c0, sx * 0.3, 0.74, 0));
    return { ...rig, pose: 'float' };
  }
  // zombie: green rotten skin, torn clothes, arms reaching forward
  const rig = humanoid({ skin: color, hair: 0x2a2a20, top: 0x4a4a3a, bottom: 0x3a3428, height: scale, bulk: 1.0, weapon: null, hairStyle: 1 });
  const h = rig.head!, tor = rig.torso!;
  tor.add(part(B(0.16, 0.2, 0.03), darker(color, 0.7), 0.1, 0.4, 0.15)); // rotten patch
  tor.add(part(B(0.2, 0.08, 0.03), 0x2a2a20, -0.1, 0.2, 0.15)); // torn shirt
  const e = part(B(0.05, 0.05, 0.02), 0xc8ff60, -0.07, 0.02, 0.18);
  e.material = glow(0xc8ff60);
  h.add(e);
  return { ...rig, pose: 'zombie' };
}

interface Outfit {
  head?: 'hood' | 'cap' | 'helm' | 'wizard' | 'veil' | 'band';
  headColor?: number;
  prop?: WeaponKind;
  propColor?: number;
  shield?: boolean;
  apron?: number;
  cape?: number;
  robe?: boolean;
  hair?: number;
  beard?: boolean;
  female?: boolean;
}

/** What each NPC wears and carries, so roles read at a glance. */
const OUTFITS: Record<string, Outfit> = {
  grocer: { head: 'cap', headColor: 0xe8e0d0, apron: 0xf0ead8, female: true, hair: 0x8a4a20 },
  weapons: { apron: 0x3a2a1a, prop: 'blunt', propColor: 0x8a8f95, beard: true, hair: 0x5a3a1a },
  armor: { head: 'helm', shield: true, prop: 'sword', propColor: 0xc8d0d8, female: true, hair: 0xd8b060 },
  gatekeeper: { head: 'wizard', headColor: 0x4a1a4a, prop: 'staff', propColor: 0xd060ff, robe: true, female: true, hair: 0x2a1a2a },
  mira: { head: 'helm', prop: 'spear', propColor: 0xc8d0d8, cape: 0x3a5a8a, female: true, hair: 0xa05a2a },
  bram: { head: 'hood', headColor: 0x5a4a2a, prop: 'bow', beard: true },
  sella: { head: 'hood', headColor: 0x2a4a3a, cape: 0x2a4a3a, prop: 'bow', female: true, hair: 0x1a1a1a },
  dorian: { head: 'band', headColor: 0x6a3a20, prop: 'spear', propColor: 0x9aa2aa },
  vessa: { head: 'cap', headColor: 0x6a4a2a, apron: 0x8a6a3a, female: true, hair: 0x3a2a1a },
  harun: { head: 'cap', headColor: 0x2a2a30, prop: 'shovel', robe: true, beard: true, hair: 0x5a5a5a },
  nira: { head: 'band', headColor: 0xa0a090, prop: 'pickaxe', apron: 0x5a5048, female: true, hair: 0x6a3a1a },
  kael: { head: 'hood', headColor: 0x2f5a30, cape: 0x2f5a30, prop: 'bow' },
  grit: { head: 'band', headColor: 0x8a3a20, prop: 'axe', propColor: 0x9aa2aa, beard: true },
  rusk: { head: 'helm', prop: 'sword', propColor: 0xd0d8e0, shield: true, cape: 0x8a2a1a },
  mael: { head: 'veil', headColor: 0xf0eee8, prop: 'staff', propColor: 0xfff0a0, robe: true, female: true },
};

export function npcModel(npcId: string): Rig {
  const n = NPCS.find((x) => x.id === npcId)!;
  const o = OUTFITS[n.id] ?? {};
  const talker = n.kind === 'talker';
  const fakeHelm = { id: 'npc_helm', grade: 'D', color: 0x9aa2aa } as unknown as ItemDef;
  const rig = humanoid({
    skin: n.look?.skin ?? 0xe8b996, hair: n.look?.beard ?? o.hair ?? 0x3a2a1a, top: n.color, bottom: darker(n.color, 0.6),
    height: talker ? 0.93 : 1, bulk: o.female ? 0.88 : 1, female: o.female, weapon: o.prop ?? null, weaponColor: o.propColor,
    robe: o.robe ?? talker, hairStyle: o.female ? 1 : 0,
    hat: o.head === 'wizard' ? o.headColor : undefined, bald: n.look?.bald, beard: n.look?.beard !== undefined || o.beard,
    gear: o.head === 'helm' ? { head: fakeHelm } : {},
  });
  const h = rig.head!, tor = rig.torso!;
  if (o.head === 'hood') hood(h, o.headColor ?? 0x4a3a2a);
  if (o.head === 'cap') h.add(part(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8), o.headColor ?? 0x6a4a2a, 0, 0.14, -0.01));
  if (o.head === 'band') h.add(part(B(0.42, 0.06, 0.42), o.headColor ?? 0x8a3a20, 0, 0.08, 0));
  if (o.head === 'veil') {
    hood(h, o.headColor ?? 0xf0eee8);
    h.add(part(B(0.42, 0.08, 0.3), 0x2a2a3a, 0, 0.1, -0.02));
  }
  if (o.apron) apron(tor, o.apron);
  if (o.cape) cape(tor, o.cape);
  if (o.shield) rig.armL!.add(shieldMesh(n.color, 0xe8c060));
  if (talker) {
    tor.rotation.x = 0.25; // old man's stoop
    const cane = weaponMesh('staff', 0x6a4a2a)!; // a plain walking stick
    cane.children.slice(1).forEach((c) => cane.remove(c));
    cane.position.y = -0.64;
    rig.armR!.add(cane);
  }
  return bake(rig);
}

/** Ground loot: small recognisable shapes, with a light beam for graded gear. */
export function itemModel(itemId: string): THREE.Group {
  const g = new THREE.Group();
  const def = ITEMS[itemId];
  const c = def?.color ?? 0xffffff;
  if (itemId === 'camp_chest') {
    g.add(part(B(0.9, 0.5, 0.6), 0x7a4a24, 0, 0.25, 0));
    g.add(part(B(0.92, 0.22, 0.62), 0x8a5a2a, 0, 0.6, 0).rotateX(-0.05));
    for (const sx of [-0.35, 0.35]) g.add(trim(B(0.06, 0.74, 0.64), 0xe8c060, sx, 0.37, 0));
    g.add(trim(B(0.14, 0.16, 0.04), 0xe8c060, 0, 0.45, 0.32));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 3, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 1.5;
    g.add(beam);
    return g;
  }
  if (itemId === 'adena') {
    for (let i = 0; i < 5; i++) g.add(part(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 10), 0xffcc33, (i % 2) * 0.12 - 0.06, 0.02 + i * 0.035, ((i >> 1) % 2) * 0.08));
    g.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.035, 10), 0xffdd55, 0.15, 0.02, -0.1));
  } else if (def?.type === 'weapon') {
    const w = weaponMesh(weaponKindOf(itemId, 'fighter'), def.color)!;
    // lying on the ground: staves are built upright (Y), everything else along Z
    if (def.weaponType === 'staff') w.rotation.set(0, 0.6, Math.PI / 2);
    else w.rotation.set(0, 0.6, 0);
    w.position.set(0, 0.06, def.weaponType === 'staff' ? 0 : -0.2);
    g.add(w);
  } else if (def?.type === 'consumable' && def.use?.escape) {
    const sc = part(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8).rotateZ(Math.PI / 2), 0xe8d8a0, 0, 0.08, 0);
    g.add(sc, part(B(0.04, 0.12, 0.12), 0xb03020, 0, 0.08, 0)); // scroll + seal ribbon
  } else if (def?.type === 'consumable') {
    g.add(part(new THREE.IcosahedronGeometry(0.11, 1), c, 0, 0.12, 0)); // bottle
    g.add(part(new THREE.CylinderGeometry(0.035, 0.04, 0.1, 6), 0xd8e8f0, 0, 0.27, 0)); // neck
    g.add(part(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 6), 0x8a5a30, 0, 0.33, 0)); // cork
  } else if (def?.type === 'armor') {
    const slotShape: Record<string, THREE.BufferGeometry> = {
      head: new THREE.SphereGeometry(0.16, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5),
      chest: B(0.36, 0.3, 0.14), legs: B(0.28, 0.34, 0.1), gloves: B(0.16, 0.12, 0.2), feet: B(0.16, 0.14, 0.26),
    };
    g.add(part(slotShape[def.slot ?? 'chest'], c, 0, 0.1, 0));
  } else {
    // materials
    const shape: Record<string, () => THREE.Mesh> = {
      animal_skin: () => part(B(0.36, 0.03, 0.28), c, 0, 0.02, 0),
      wolf_pelt: () => part(B(0.42, 0.04, 0.3), c, 0, 0.02, 0),
      animal_bone: () => part(B(0.32, 0.05, 0.05), c, 0, 0.04, 0),
      cursed_bone: () => trim(B(0.32, 0.05, 0.05), 0xb0ffb0, 0, 0.04, 0),
      goblin_ear: () => part(new THREE.ConeGeometry(0.06, 0.2, 4).rotateZ(Math.PI / 2), c, 0, 0.05, 0),
      orc_tusk: () => part(new THREE.ConeGeometry(0.05, 0.26, 5).rotateZ(1.2), c, 0, 0.06, 0),
      stone_fragment: () => part(new THREE.DodecahedronGeometry(0.13, 0), c, 0, 0.1, 0),
    };
    g.add((shape[itemId] ?? (() => part(new THREE.IcosahedronGeometry(0.15, 0), c, 0, 0.15, 0)))());
  }
  if (def?.grade && def.grade !== 'NG') {
    // loot beam so good drops stand out
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2.2, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: GRADE_COLOR[def.grade], transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 1.1;
    g.add(beam);
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
  if (rig.q) {
    animateQ(rig.q, s);
    return;
  }
  const dance = !!s.dancing && s.deadAge < 0;
  const { body, legs, armL, armR, torso } = rig;
  if (s.deadAge >= 0) {
    const k = Math.min(1, s.deadAge / 450);
    body.rotation.x = rig.kind === 'humanoid' ? -k * Math.PI / 2 : 0;
    body.rotation.z = rig.kind === 'humanoid' ? 0 : k * Math.PI / 2;
    body.position.y = rig.kind === 'humanoid' ? k * 0.15 : k * 0.3;
    return;
  }
  body.rotation.set(0, 0, 0);
  body.position.y = rig.pose === 'float' ? 0.35 + Math.sin(s.t * 1.6) * 0.12 : 0;
  const walk = s.moving ? Math.sin(s.t * 11) : 0;
  if (rig.tail) rig.tail.rotation.y = Math.sin(s.t * (s.moving ? 12 : 4)) * (s.moving ? 0.35 : 0.2);
  if (rig.kind === 'humanoid') {
    legs[0].rotation.x = walk * 0.7;
    legs[1].rotation.x = -walk * 0.7;
    if (rig.pose !== 'float') body.position.y = s.moving ? Math.abs(Math.cos(s.t * 11)) * 0.05 : 0;
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
    if (rig.pose === 'zombie' && !s.casting) {
      ar = -1.35 + walk * 0.1 + (s.atkAge < 450 ? Math.sin((s.atkAge / 450) * Math.PI) * -0.5 : 0);
      al = -1.4 - walk * 0.1;
    }
    if (dance) {
      // hands in the air, hips twisting, a hop on every beat
      ar = -2.7 + Math.sin(s.t * 8) * 0.5;
      al = -2.7 - Math.sin(s.t * 8) * 0.5;
      body.rotation.y = Math.sin(s.t * 4) * 0.7;
      body.position.y = Math.abs(Math.sin(s.t * 8)) * 0.14;
      legs[0].rotation.x = Math.sin(s.t * 8) * 0.35;
      legs[1].rotation.x = -Math.sin(s.t * 8) * 0.35;
    }
    if (rig.pose === 'hunch' && torso) torso.rotation.x = 0.22;
    if (rig.pose === 'float') legs.forEach((l) => (l.rotation.x = 0.15));
    if (armR) { armR.rotation.x = ar; armR.rotation.z = zr; }
    if (armL) { armL.rotation.x = al; armL.rotation.z = zl; }
  } else if (rig.kind === 'beast') {
    legs[0].rotation.x = legs[1].rotation.x = walk * 0.6;
    legs[2].rotation.x = legs[3].rotation.x = -walk * 0.6;
    if (torso) {
      const k = s.atkAge < 400 ? Math.sin((s.atkAge / 400) * Math.PI) : 0;
      torso.rotation.x = k * 0.5;
      torso.position.z = (torso.userData.baseZ ?? 0.65) + k * 0.2;
    }
    body.position.y = s.moving ? Math.abs(Math.sin(s.t * 11)) * 0.06 : 0;
    if (armL && armR) {
      // wings: a slow breath at rest, a full beat on the move or mid-attack
      const busy = s.moving || s.atkAge < 400;
      const f = Math.sin(s.t * (busy ? 9 : 2.2)) * (busy ? 0.45 : 0.12);
      armR.rotation.z = 0.45 + f;
      armL.rotation.z = -0.45 - f;
    }
  } else {
    legs.forEach((l, i) => (l.rotation.x = s.moving ? Math.sin(s.t * 16 + i) * 0.35 : 0));
    const k = s.atkAge < 400 ? Math.sin((s.atkAge / 400) * Math.PI) : 0;
    body.rotation.x = -k * 0.3;
  }
}
