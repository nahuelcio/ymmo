import * as THREE from 'three';
import { RACES, type ClassType, type Race } from '../../../shared/src/data/classes';
import { ITEMS } from '../../../shared/src/data/items';
import { MOBS } from '../../../shared/src/data/mobs';
import { NPCS } from '../../../shared/src/data/world';
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

function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color));
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

interface HumanoidOpts {
  skin: number; hair: number; top: number; bottom: number; height: number; bulk: number;
  weapon: WeaponKind; weaponColor?: number; robe?: boolean; ears?: 'elf' | 'goblin'; tusks?: boolean; beard?: boolean; bald?: boolean; skull?: boolean;
  hat?: number;
}

export function humanoid(o: HumanoidOpts): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = o.bulk;
  const legs: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.12 * k, 0.9, 0);
    leg.add(part(B(0.17 * k, 0.9, 0.2), o.bottom, 0, -0.45, 0));
    leg.add(part(B(0.19 * k, 0.12, 0.28), darker(o.bottom, 0.5), 0, -0.86, 0.04));
    body.add(leg);
    legs.push(leg);
  }
  const torso = new THREE.Group();
  torso.position.y = 0.9;
  torso.add(part(B(0.5 * k, 0.64, 0.28 * Math.sqrt(k)), o.top, 0, 0.32, 0));
  torso.add(part(B(0.52 * k, 0.08, 0.3 * Math.sqrt(k)), darker(o.top, 0.5), 0, 0.02, 0));
  if (o.robe) {
    const skirt = part(new THREE.CylinderGeometry(0.26 * k, 0.4 * k, 0.75, 6), o.top, 0, -0.38, 0);
    torso.add(skirt);
  }
  body.add(torso);
  const head = new THREE.Group();
  head.position.y = 1.72;
  head.add(part(new THREE.IcosahedronGeometry(0.19, 1), o.skin));
  if (o.skull) {
    head.add(part(B(0.06, 0.04, 0.02), 0x111111, -0.07, 0.02, 0.17));
    head.add(part(B(0.06, 0.04, 0.02), 0x111111, 0.07, 0.02, 0.17));
  } else {
    head.add(part(B(0.04, 0.04, 0.02), 0x222222, -0.07, 0.02, 0.17));
    head.add(part(B(0.04, 0.04, 0.02), 0x222222, 0.07, 0.02, 0.17));
  }
  if (!o.bald) head.add(part(new THREE.SphereGeometry(0.205, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), o.hair, 0, 0.03, -0.02));
  if (o.ears) {
    const len = o.ears === 'goblin' ? 0.3 : 0.2;
    for (const sx of [-1, 1]) {
      const ear = part(new THREE.ConeGeometry(0.045, len, 4), o.skin, sx * 0.2, 0.04, 0);
      ear.rotation.z = -sx * (Math.PI / 2 - 0.35);
      head.add(ear);
    }
  }
  if (o.tusks) for (const sx of [-1, 1]) head.add(part(new THREE.ConeGeometry(0.025, 0.1, 4), 0xf0f0e0, sx * 0.07, -0.1, 0.16));
  if (o.beard) head.add(part(B(0.26, 0.24, 0.12), o.hair, 0, -0.18, 0.12));
  if (o.hat !== undefined) {
    head.add(part(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 8), o.hat, 0, 0.12, 0));
    head.add(part(new THREE.ConeGeometry(0.17, 0.45, 8), o.hat, 0, 0.35, 0));
  }
  body.add(head);
  const arms: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * (0.3 * k + 0.02), 1.5, 0);
    arm.add(part(B(0.13 * k, 0.62, 0.14), o.top, 0, -0.3, 0));
    arm.add(part(new THREE.IcosahedronGeometry(0.075 * k, 0), o.skin, 0, -0.64, 0));
    body.add(arm);
    arms.push(arm);
  }
  const w = weaponMesh(o.weapon, o.weaponColor ?? 0xc8d0d8);
  if (w) {
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

export function playerModel(race: Race, cls: ClassType, weapon: string | null, chest: string | null): Rig {
  const r = RACES[race];
  const chestDef = chest ? ITEMS[chest] : null;
  const top = chestDef?.color ?? 0xb0a080;
  const robe = !!chestDef && (chestDef.id === 'karmian_tunic' || chestDef.id === 'demons_tunic' || (cls === 'mystic' && chestDef.grade === 'NG'));
  return humanoid({
    skin: r.skin, hair: r.hair, top, bottom: darker(top, 0.65), height: r.height, bulk: r.bulk,
    weapon: weaponKindOf(weapon, cls), weaponColor: weapon ? ITEMS[weapon]?.color : undefined, robe,
    ears: race === 'elf' || race === 'darkelf' ? 'elf' : undefined, tusks: race === 'orc', beard: race === 'dwarf', bald: race === 'orc',
  });
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
  return rig;
}

export function npcModel(npcId: string): Rig {
  const n = NPCS.find((x) => x.id === npcId)!;
  return humanoid({ skin: 0xe8b996, hair: 0x3a2a1a, top: n.color, bottom: darker(n.color, 0.6), height: 1, bulk: 1, weapon: null, robe: true,
    hat: n.kind === 'gatekeeper' ? 0x4a1a4a : undefined });
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
