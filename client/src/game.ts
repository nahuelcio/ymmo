import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ITEMS } from '../../shared/src/data/items';
import { SKILLS } from '../../shared/src/data/skills';
import { F_CASTING, F_DEAD, F_MOVING, F_PVP, type EntAdd, type EntUpd, type InvItem, type S2C, type SelfState } from '../../shared/src/protocol';
import { heightAt } from '../../shared/src/terrain';
import { findPath, pushOut } from '../../shared/src/collision';
import type { Net } from './net';
import { CameraController } from './render/camera';
import { FxManager } from './render/fx';
import { animate, itemModel, mobModel, npcModel, playerModel, type Rig } from './render/models';
import { createWorldScene, type WorldScene } from './render/scene';
import { UI } from './ui';

export const F_PURPLE = 16;
export const F_RED = 32;

interface Snap { t: number; x: number; z: number; ry: number }

export interface CEnt {
  id: number;
  rec: EntAdd;
  rig: Rig | null;
  root: THREE.Group;
  model: THREE.Object3D;
  hit: THREE.Mesh;
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  snaps: Snap[];
  pos: THREE.Vector3;
  ry: number;
  hp: number;
  flags: number;
  atkAt: number;
  deadAt: number;
  height: number;
  radius: number;
  /** hit reaction: time + direction away from the attacker */
  hitAt: number;
  hitDx: number;
  hitDz: number;
  hpFill: HTMLDivElement | null;
}

const INTERP_DELAY = 110;
/** How long to wait for the server to confirm arrival before trusting it again. */
const PREDICT_SETTLE_MS = 600;
/** Local prediction is discarded beyond this much disagreement with the server. */
const PREDICT_MAX_ERR = 4;

type Pick = { ent?: CEnt; point?: THREE.Vector3 };

// Shared ground decals marking NPCs (gold) and other players (blue).
const DECAL_GEO = new THREE.RingGeometry(0.78, 0.92, 32).rotateX(-Math.PI / 2);
const decalMat = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const NPC_DECAL = decalMat(0xffc94a, 0.75);
const PLAYER_DECAL = decalMat(0x5aa8ff, 0.45);

const svgCursor = (svg: string, x: number, y: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;
const CURSORS = {
  attack: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M2 2 L16 6 L24 20 L20 24 L6 16 Z" fill="#e33" stroke="#300" stroke-width="1.5"/><path d="M18 22 L26 26 M22 18 L26 26" stroke="#ffd36a" stroke-width="3"/></svg>',
    2, 2, 'crosshair'),
  talk: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 4 H25 V18 H12 L6 24 V18 H3 Z" fill="#ffd36a" stroke="#4a3200" stroke-width="1.5"/><circle cx="9" cy="11" r="1.6" fill="#4a3200"/><circle cx="14" cy="11" r="1.6" fill="#4a3200"/><circle cx="19" cy="11" r="1.6" fill="#4a3200"/></svg>',
    3, 4, 'pointer'),
  pickup: 'grab',
  select: 'pointer',
  move: 'default',
};

export function conColor(diff: number): string {
  if (diff <= -9) return '#9a9a9a';
  if (diff <= -6) return '#7fdc7f';
  if (diff <= -3) return '#8fc8ff';
  if (diff <= 2) return '#ffffff';
  if (diff <= 5) return '#ffe066';
  if (diff <= 8) return '#ff6a5a';
  return '#d070ff';
}

export class Game {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  camera: THREE.PerspectiveCamera;
  world: WorldScene;
  cam: CameraController;
  fx: FxManager;
  ui: UI;
  ents = new Map<number, CEnt>();
  hitboxes: THREE.Object3D[] = [];
  me: SelfState;
  inv: InvItem[];
  adena = 0;
  targetId: number | null = null;
  cooldowns = new Map<string, { end: number; dur: number }>();
  castBar: { end: number; dur: number; name: string } | null = null;
  ctrl = false;
  private raycaster = new THREE.Raycaster();
  private targetRing: THREE.Mesh;
  private clickMarker: THREE.Mesh;
  private clickAt = 0;
  private hoverRing: THREE.Mesh;
  private hoverId: number | null = null;
  /** Client-side predicted move destination for our own character. */
  private predict: { x: number; z: number; arrivedAt: number; path: { x: number; z: number }[] } | null = null;
  private holdMove = false;
  private lastHoldSend = 0;
  private teleportPending = true;
  private last = performance.now();
  private down: { x: number; y: number } | null = null;

  constructor(public net: Net, enter: Extract<S2C, { t: 'enter' }>) {
    this.me = enter.self;
    this.inv = enter.inv;
    this.adena = enter.self.adena;
    const host = document.getElementById('game')!;
    // Antialiasing is redundant on high-DPI screens; cap the pixel ratio to keep fill-rate sane.
    this.renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 1.5, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 700);
    this.world = createWorldScene();
    this.cam = new CameraController(this.camera, this.renderer.domElement);
    this.fx = new FxManager(this.world.scene);

    const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), glow(0xff4444));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.clickMarker = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 24), glow(0x66ff88));
    this.clickMarker.rotation.x = -Math.PI / 2;
    this.clickMarker.visible = false;
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), glow(0xffffff));
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    (this.hoverRing.material as THREE.MeshBasicMaterial).opacity = 0.5;
    this.world.scene.add(this.targetRing, this.clickMarker, this.hoverRing);

    this.ui = new UI(this);
    this.bindNet();
    this.bindInput();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.ui.onMe();
    this.ui.onInv();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get self(): CEnt | undefined {
    return this.ents.get(this.me.id);
  }

  private resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  sys(text: string) {
    this.ui.chat.add('sys', '', text);
  }

  // ---------------------------------------------------------------- network
  private bindNet() {
    const n = this.net;
    n.on('snap', (m) => this.onSnap(m.add, m.upd, m.gone));
    n.on('me', (m) => {
      const prevZone = this.me.zone;
      this.me = m.s;
      this.adena = m.s.adena;
      this.ui.onMe();
      if (prevZone !== m.s.zone) this.ui.hud.banner(m.s.zone);
    });
    n.on('inv', (m) => {
      this.inv = m.items;
      this.adena = m.adena;
      this.ui.onInv();
    });
    n.on('dmg', (m) => this.onDmg(m));
    n.on('atk', (m) => {
      const s = this.ents.get(m.s), t = this.ents.get(m.tg);
      if (!s) return;
      s.atkAt = performance.now();
      if (t && s.pos.distanceTo(t.pos) > 5) {
        this.fx.projectile(s.pos.clone().setY(s.pos.y + s.height * 0.6), () => t.pos.clone().setY(t.pos.y + t.height * 0.5), 0xd8b070, 260, 0.1);
      }
    });
    n.on('cast', (m) => {
      const s = this.ents.get(m.s);
      const def = SKILLS[m.skill];
      if (s && def) this.fx.sparkles(s.pos.clone(), def.color, Math.max(400, m.dur));
      if (m.s === this.me.id && def && m.dur > 0) this.castBar = { end: performance.now() + m.dur, dur: m.dur, name: def.name };
    });
    n.on('fx', (m) => this.onFx(m.s, m.tg, m.skill));
    n.on('cd', (m) => this.cooldowns.set(m.key, { end: performance.now() + m.ms, dur: m.ms }));
    n.on('died', (m) => {
      const e = this.ents.get(m.id);
      if (e) e.deadAt = performance.now();
      if (m.id === this.me.id) {
        this.castBar = null;
        this.ui.dialogs.death();
      }
    });
    n.on('levelUp', (m) => {
      const e = this.ents.get(m.id);
      if (e) {
        this.fx.pillar(e.pos.clone(), 0xffd966);
        this.fx.ring(e.pos.clone(), 0xffd966, 3, 900);
      }
      if (m.id === this.me.id) this.ui.hud.banner(`Level ${m.lvl}!`, true);
    });
    n.on('chat', (m) => this.ui.chat.add(m.ch, m.from, m.text));
    n.on('error', (m) => this.sys(m.msg));
    n.on('npc', (m) => this.ui.npc.open(m));
    n.on('partyInvite', (m) => this.ui.dialogs.invite(m.from));
    n.on('party', (m) => this.ui.party.set(m.members));
    n.on('teleported', () => {
      this.teleportPending = true;
      this.ui.dialogs.close();
      this.ui.npc.win.hide();
    });
  }

  private makeLabel(): { el: HTMLDivElement; obj: CSS2DObject } {
    const el = document.createElement('div');
    el.className = 'nameplate';
    const obj = new CSS2DObject(el);
    return { el, obj };
  }

  refreshLabel(c: CEnt) {
    const r = c.rec;
    const el = c.labelEl;
    c.hpFill = null;
    if (r.k === 'p') {
      const self = r.id === this.me.id;
      const color = c.flags & F_RED ? '#ff4040' : c.flags & F_PURPLE ? '#d080ff' : self ? '#ffffff' : '#7fc4ff';
      el.innerHTML = '';
      el.className = `nameplate np-player${self ? ' np-self' : ''}`;
      const n = document.createElement('div');
      n.textContent = self ? r.n : `${r.n} `;
      n.style.color = color;
      if (c.flags & F_PVP) {
        const sw = document.createElement('span');
        sw.className = 'np-pvp';
        sw.textContent = '⚔';
        sw.title = 'PvP mode on';
        n.prepend(sw);
      }
      if (!self) {
        const l = document.createElement('span');
        l.className = 'np-lvl';
        l.textContent = `Lv ${r.l}`;
        n.appendChild(l);
      }
      el.appendChild(n);
      if (!self) this.addHpBar(c);
    } else if (r.k === 'm') {
      el.innerHTML = '';
      el.className = 'nameplate np-mob';
      const n = document.createElement('div');
      n.textContent = `${r.n} `;
      n.style.color = conColor(r.l - this.me.lvl);
      const l = document.createElement('span');
      l.className = 'np-lvl';
      l.textContent = `Lv ${r.l}`;
      n.appendChild(l);
      el.appendChild(n);
      this.addHpBar(c);
    } else if (r.k === 'n') {
      el.innerHTML = '';
      el.className = 'nameplate np-npc';
      const t = document.createElement('div');
      t.className = 'np-title';
      t.textContent = `<${r.title}>`;
      const n = document.createElement('div');
      n.className = 'np-npc-name';
      n.textContent = `◆ ${r.n}`;
      el.append(t, n);
    } else {
      el.textContent = r.item === 'adena' ? `${r.c} Adena` : `${ITEMS[r.item]?.name ?? r.item}${r.c > 1 ? ` (${r.c})` : ''}`;
      el.classList.add('np-item');
    }
  }

  private addHpBar(c: CEnt) {
    const bar = document.createElement('div');
    bar.className = 'np-hp';
    c.hpFill = document.createElement('div');
    bar.appendChild(c.hpFill);
    c.labelEl.appendChild(bar);
    this.updateHpBar(c);
  }

  /** Nameplate HP bar: only shown once damaged (or when targeted). */
  private updateHpBar(c: CEnt) {
    if (!c.hpFill) return;
    c.hpFill.style.width = `${c.hp}%`;
    c.hpFill.className = this.isHostile(c) || c.rec.k === 'm' ? 'hp-foe' : 'hp-friend';
    const bar = c.hpFill.parentElement!;
    bar.style.display = (c.hp < 100 || c.id === this.targetId) && !(c.flags & F_DEAD) ? 'block' : 'none';
  }

  private buildEnt(r: EntAdd): CEnt {
    const root = new THREE.Group();
    let rig: Rig | null = null;
    let model: THREE.Object3D;
    let height = 1.2, radius = 0.5;
    if (r.k === 'p') rig = playerModel(r.race, r.cls, r.w, r.a, r.lk);
    else if (r.k === 'm') rig = mobModel(r.tpl);
    else if (r.k === 'n') rig = npcModel(r.npc);
    if (rig) {
      model = rig.root;
      height = rig.height;
      radius = Math.max(0.45, rig.radius);
    } else {
      model = itemModel((r as Extract<EntAdd, { k: 'i' }>).item);
      height = 0.4;
      radius = 0.45;
    }
    root.add(model);
    // generous hitbox: easier to click moving targets
    const hitR = radius * 1.25 + 0.2, hitH = height + 0.4;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(hitR, hitR, hitH, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = hitH / 2;
    if (r.k === 'n' || (r.k === 'p' && r.id !== this.me.id)) {
      const decal = new THREE.Mesh(DECAL_GEO, r.k === 'n' ? NPC_DECAL : PLAYER_DECAL);
      decal.scale.setScalar(Math.max(0.7, radius * 1.3));
      decal.position.y = 0.06;
      decal.renderOrder = 1;
      root.add(decal);
    }
    hit.userData.entId = r.id;
    root.add(hit);
    const { el, obj } = this.makeLabel();
    obj.position.y = height + 0.35;
    root.add(obj);
    const c: CEnt = {
      id: r.id, rec: r, rig, root, model, hit, label: obj, labelEl: el, snaps: [], pos: new THREE.Vector3(r.x, heightAt(r.x, r.z), r.z),
      ry: r.ry, hp: r.hp, flags: r.f, atkAt: 0, hitAt: 0, hitDx: 0, hitDz: 0, hpFill: null, deadAt: r.f & F_DEAD ? performance.now() - 5000 : -1, height, radius,
    };
    this.refreshLabel(c);
    return c;
  }

  private removeEnt(id: number) {
    const c = this.ents.get(id);
    if (!c) return;
    this.world.scene.remove(c.root);
    c.label.element.remove();
    // model geometries are shared (see models.ts); only the hitbox is per-entity
    c.hit.geometry.dispose();
    this.hitboxes = this.hitboxes.filter((h) => h !== c.hit);
    this.ents.delete(id);
  }

  private pushSnap(c: CEnt, x: number, z: number, ry: number) {
    const now = performance.now();
    const last = c.snaps[c.snaps.length - 1];
    const isSelf = c.id === this.me.id;
    if ((isSelf && this.teleportPending) || (last && Math.hypot(last.x - x, last.z - z) > 25)) {
      c.snaps = [];
      if (isSelf) {
        this.teleportPending = false;
        this.predict = null;
        c.pos.set(x, heightAt(x, z), z);
        this.cam.snap(c.pos);
      }
    } else if (last && now - last.t > 160) {
      // entity was idle: re-anchor previous position so interpolation starts now
      c.snaps.push({ t: now - 100, x: last.x, z: last.z, ry: last.ry });
    }
    c.snaps.push({ t: now, x, z, ry });
    if (c.snaps.length > 12) c.snaps.splice(0, c.snaps.length - 12);
  }

  private onSnap(add: EntAdd[], upd: EntUpd[], gone: number[]) {
    for (const r of add) {
      const old = this.ents.get(r.id);
      let snaps: Snap[] = [];
      let atkAt = 0;
      if (old) {
        snaps = old.snaps;
        atkAt = old.atkAt;
        this.removeEnt(r.id);
      }
      const c = this.buildEnt(r);
      c.snaps = snaps;
      c.atkAt = atkAt;
      if (old) c.pos.copy(old.pos);
      this.ents.set(r.id, c);
      this.world.scene.add(c.root);
      this.hitboxes.push(c.hit);
      this.pushSnap(c, r.x, r.z, r.ry);
      if (!old && r.id !== this.me.id && r.k !== 'i') c.pos.set(r.x, heightAt(r.x, r.z), r.z);
    }
    for (const [id, x, z, ry, hp, f] of upd) {
      const c = this.ents.get(id);
      if (!c) continue;
      const wasDead = (c.flags & F_DEAD) !== 0;
      const colorChanged = (c.flags & (F_RED | F_PURPLE | F_PVP)) !== (f & (F_RED | F_PURPLE | F_PVP));
      const hpChanged = c.hp !== hp;
      c.hp = hp;
      c.flags = f;
      c.rec.hp = hp;
      if (hpChanged || wasDead !== ((f & F_DEAD) !== 0)) this.updateHpBar(c);
      if (wasDead && !(f & F_DEAD)) c.deadAt = -1;
      if (!wasDead && f & F_DEAD && c.deadAt < 0) c.deadAt = performance.now();
      if (colorChanged) this.refreshLabel(c);
      this.pushSnap(c, x, z, ry);
    }
    for (const id of gone) {
      if (id === this.targetId) this.setTarget(null);
      this.removeEnt(id);
    }
    if (add.length) this.ui.onTargetChanged();
  }

  private floatText(c: CEnt, text: string, cls: string) {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set((Math.random() - 0.5) * 0.6, c.height + 0.2, 0);
    c.root.add(obj);
    setTimeout(() => {
      c.root.remove(obj);
      el.remove();
    }, 1100);
  }

  private onDmg(m: Extract<S2C, { t: 'dmg' }>) {
    const t = this.ents.get(m.tg);
    if (!t) return;
    if (m.miss) return this.floatText(t, 'Miss', 'f-miss');
    if (m.heal) return this.floatText(t, `+${m.v}`, 'f-heal');
    const mine = m.tg === this.me.id;
    const src = this.ents.get(m.s);
    if (src && src !== t) {
      const dx = t.pos.x - src.pos.x, dz = t.pos.z - src.pos.z, d = Math.hypot(dx, dz) || 1;
      t.hitAt = performance.now();
      t.hitDx = dx / d;
      t.hitDz = dz / d;
    }
    if (mine) this.cam.shake(m.crit ? 0.35 : 0.08);
    else if (m.crit && m.s === this.me.id) this.cam.shake(0.12);
    this.floatText(t, m.crit ? `${m.v}!` : String(m.v), `${mine ? 'f-hurt' : 'f-dmg'}${m.crit ? ' f-crit' : ''}`);
    if (m.crit && m.s === this.me.id) this.sys(`Critical hit! ${m.v} damage.`);
    if (!mine) this.fx.burst(t.pos.clone().setY(t.pos.y + t.height * 0.55), m.crit ? 0xffcc33 : 0xffffff, 0.35, 220);
  }

  private onFx(sId: number, tId: number, skill: string) {
    const s = this.ents.get(sId), t = this.ents.get(tId);
    if (!s) return;
    const chest = (e: CEnt) => e.pos.clone().setY(e.pos.y + e.height * 0.6);
    if (skill === 'potion') return this.fx.sparkles(s.pos.clone(), 0xff5555, 700);
    if (skill === 'escape') return this.fx.pillar(s.pos.clone(), 0x66aaff, 3000, 4);
    const def = SKILLS[skill];
    if (!def || !t) return;
    switch (def.kind) {
      case 'magic':
        this.fx.projectile(chest(s), () => chest(t), def.color, 280, 0.3);
        setTimeout(() => this.fx.burst(chest(t), def.color, def.aoe ? def.aoe * 0.6 : 0.9, 450), 280);
        break;
      case 'drain':
        this.fx.projectile(chest(t), () => chest(s), def.color, 400, 0.25);
        break;
      case 'phys':
        this.fx.burst(chest(t), def.color, 1.1, 350);
        if (def.aoe) this.fx.ring(s.pos.clone(), def.color, def.aoe, 500);
        break;
      case 'heal':
        this.fx.sparkles(t.pos.clone(), def.color, 900);
        this.fx.ring(t.pos.clone(), def.color, 1.5, 600);
        break;
      case 'buff':
        this.fx.ring(t.pos.clone(), def.color, 2, 800);
        this.fx.sparkles(t.pos.clone(), def.color, 1000);
        break;
    }
  }

  // ---------------------------------------------------------------- actions
  setTarget(id: number | null) {
    if (this.targetId === id) return;
    const prev = this.targetId !== null ? this.ents.get(this.targetId) : undefined;
    this.targetId = id;
    if (prev) this.updateHpBar(prev);
    const cur = id !== null ? this.ents.get(id) : undefined;
    if (cur) this.updateHpBar(cur);
    this.net.send({ t: 'target', id });
    this.ui.onTargetChanged();
  }

  interact(c: CEnt, ctrl: boolean) {
    const r = c.rec;
    if (r.k === 'i') return this.serverAction({ t: 'pickup', id: r.id });
    if (r.k === 'n') {
      this.setTarget(r.id);
      return this.serverAction({ t: 'talk', id: r.id });
    }
    if (r.id === this.me.id) return this.setTarget(r.id);
    this.setTarget(r.id);
    // one click attacks anything hostile (mobs, flagged/PK players); ctrl forces PvP
    if (this.isHostile(c) || (r.k === 'p' && ctrl)) this.serverAction({ t: 'attack', id: r.id, force: ctrl });
  }

  isHostile(c: CEnt): boolean {
    if (c.flags & F_DEAD) return false;
    if (c.rec.k === 'm') return true;
    if (c.rec.k !== 'p' || c.id === this.me.id) return false;
    if (c.flags & F_RED) return this.me.pvpOn;
    return this.me.pvpOn && (c.flags & F_PVP) !== 0 && (c.flags & F_PURPLE) !== 0;
  }

  /** Action whose movement the server drives: drop local prediction. */
  private serverAction(m: Parameters<Net['send']>[0]) {
    this.predict = null;
    this.holdMove = false;
    this.net.send(m);
  }

  moveTo(p: THREE.Vector3, marker: boolean) {
    const self = this.self;
    if (!self || self.flags & F_DEAD) return;
    this.net.send({ t: 'move', x: p.x, z: p.z });
    const path = findPath(self.pos.x, self.pos.z, p.x, p.z);
    const end = path[path.length - 1];
    this.predict = { x: end.x, z: end.z, arrivedAt: 0, path };
    if (marker) {
      this.clickMarker.position.set(p.x, p.y + 0.08, p.z);
      this.clickMarker.visible = true;
      this.clickAt = performance.now();
    }
  }

  /** Our current target if it's a living enemy, else auto-pick the nearest one. */
  private ensureEnemyTarget(): boolean {
    const cur = this.targetId !== null ? this.ents.get(this.targetId) : undefined;
    if (cur && this.isHostile(cur)) return true;
    if (cur && cur.rec.k === 'p' && this.ctrl) return true;
    const self = this.self;
    if (!self) return false;
    let best: CEnt | null = null, bd = 25;
    for (const c of this.ents.values()) {
      if (c.rec.k !== 'm' || c.flags & F_DEAD) continue;
      const d = c.pos.distanceTo(self.pos);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) this.setTarget(best.id);
    return !!best;
  }

  attackTarget() {
    const cur = this.targetId !== null ? this.ents.get(this.targetId) : undefined;
    if (!cur || cur.flags & F_DEAD || (cur.rec.k !== 'n' && cur.rec.k !== 'i' && !this.isHostile(cur) && !this.ctrl)) this.ensureEnemyTarget();
    if (this.targetId === null) return;
    const c = this.ents.get(this.targetId);
    if (!c || c.rec.k === 'i') return;
    if (c.rec.k === 'n') return this.serverAction({ t: 'talk', id: c.id });
    this.serverAction({ t: 'attack', id: c.id, force: this.ctrl });
  }

  useSkill(id: string) {
    if (SKILLS[id]?.target === 'enemy' && !this.ensureEnemyTarget()) return this.sys('No enemy nearby.');
    this.serverAction({ t: 'skill', skill: id, force: this.ctrl });
  }

  useItemById(itemId: string) {
    const it = this.inv.find((i) => i.i === itemId);
    if (it) this.net.send({ t: 'use', u: it.u });
  }

  nextTarget() {
    const self = this.self;
    if (!self) return;
    const mobs = [...this.ents.values()]
      .filter((c) => c.rec.k === 'm' && !(c.flags & F_DEAD) && c.pos.distanceTo(self.pos) < 35)
      .sort((a, b) => a.pos.distanceTo(self.pos) - b.pos.distanceTo(self.pos));
    if (!mobs.length) return;
    const idx = mobs.findIndex((c) => c.id === this.targetId);
    this.setTarget(mobs[(idx + 1) % Math.min(mobs.length, 5)].id);
  }

  pickupNearest() {
    const self = this.self;
    if (!self) return;
    let best: CEnt | null = null;
    for (const c of this.ents.values())
      if (c.rec.k === 'i' && c.pos.distanceTo(self.pos) < 20 && (!best || c.pos.distanceTo(self.pos) < best.pos.distanceTo(self.pos))) best = c;
    if (best) this.serverAction({ t: 'pickup', id: best.id });
  }

  // ---------------------------------------------------------------- input
  private bindInput() {
    const el = this.renderer.domElement;
    const pointer = new THREE.Vector2();
    const pick = (e: PointerEvent | MouseEvent, groundOnly = false): Pick => {
      pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(pointer, this.camera);
      if (!groundOnly) {
        const hits = this.raycaster.intersectObjects(this.hitboxes, false);
        for (const h of hits) {
          const c = this.ents.get(h.object.userData.entId as number);
          if (c && !(c.rec.k === 'm' && c.flags & F_DEAD && c.id !== this.targetId) && c.id !== this.me.id) return { ent: c };
        }
      }
      const t = this.raycaster.intersectObject(this.world.terrain, false)[0];
      return t ? { point: t.point } : {};
    };
    const cursorFor = (c: CEnt | undefined) => {
      if (!c) return CURSORS.move;
      if (c.rec.k === 'n') return CURSORS.talk;
      if (c.rec.k === 'i') return CURSORS.pickup;
      return this.isHostile(c) || (c.rec.k === 'p' && this.ctrl) ? CURSORS.attack : CURSORS.select;
    };
    // Left: act on press (no waiting for release); hold to keep walking toward the cursor.
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      (document.activeElement as HTMLElement | null)?.blur();
      const r = pick(e);
      if (r.ent) this.interact(r.ent, e.ctrlKey);
      else if (r.point) {
        this.moveTo(r.point, true);
        this.holdMove = true;
        this.lastHoldSend = performance.now();
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.holdMove = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (this.holdMove && e.buttons & 1) {
        const now = performance.now();
        if (now - this.lastHoldSend > 90) {
          const r = pick(e, true);
          if (r.point) {
            this.lastHoldSend = now;
            this.moveTo(r.point, false);
          }
        }
        return;
      }
      if (e.buttons) return;
      const ent = pick(e).ent;
      this.hoverId = ent?.id ?? null;
      el.style.cursor = cursorFor(ent);
    });

    const typing = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
    };
    addEventListener('keydown', (e) => {
      this.ctrl = e.ctrlKey;
      if (e.key === 'Enter' && !typing()) {
        e.preventDefault();
        this.ui.chat.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (typing()) (document.activeElement as HTMLElement).blur();
        else if (!this.ui.closeTop()) this.setTarget(null);
        return;
      }
      if (typing()) return;
      const fk = /^F(\d+)$/.exec(e.key);
      const num = '1234567890'.indexOf(e.key);
      if (fk && +fk[1] >= 1 && +fk[1] <= 10) {
        e.preventDefault();
        this.ui.hud.activateSlot(+fk[1] - 1);
        return;
      }
      if (num >= 0 && !e.ctrlKey && !e.altKey) {
        this.ui.hud.activateSlot(num);
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'i': this.ui.inventory.win.toggle(); break;
        case 'c': this.ui.character.win.toggle(); break;
        case 'm': this.ui.minimap.toggleMap(); break;
        case 'h': this.ui.help.toggle(); break;
        case 'p': this.ui.party.toggle(); break;
        case 'z': this.pickupNearest(); break;
        case ' ': e.preventDefault(); this.attackTarget(); break;
        case 'tab': e.preventDefault(); this.nextTarget(); break;
        case 'q': this.cam.keys.left = true; break;
        case 'e': this.cam.keys.right = true; break;
        case 'arrowleft': this.cam.keys.left = true; break;
        case 'arrowright': this.cam.keys.right = true; break;
        case 'arrowup': this.cam.keys.up = true; break;
        case 'arrowdown': this.cam.keys.down = true; break;
      }
    });
    addEventListener('keyup', (e) => {
      this.ctrl = e.ctrlKey;
      switch (e.key.toLowerCase()) {
        case 'q': case 'arrowleft': this.cam.keys.left = false; break;
        case 'e': case 'arrowright': this.cam.keys.right = false; break;
        case 'arrowup': this.cam.keys.up = false; break;
        case 'arrowdown': this.cam.keys.down = false; break;
      }
    });
    addEventListener('blur', () => {
      this.ctrl = false;
      Object.assign(this.cam.keys, { left: false, right: false, up: false, down: false });
    });
  }

  // ---------------------------------------------------------------- frame
  /** Red = hostile, gold = NPC, blue = friendly player, white = item. */
  private entColor(c: CEnt): number {
    if (this.isHostile(c)) return 0xff4444;
    if (c.rec.k === 'n') return 0xffc94a;
    if (c.rec.k === 'i') return 0xffffff;
    return 0x55aaff;
  }

  /**
   * Own character: walk toward the clicked point immediately (client-side prediction),
   * otherwise follow the newest server position with no interpolation delay.
   * Returns whether the character is moving (for animation).
   */
  private updateSelf(c: CEnt, now: number, dt: number): boolean {
    const s = c.snaps;
    const srv = s[s.length - 1];
    const pr = this.predict;
    if (pr && c.flags & F_DEAD) this.predict = null;
    if (this.predict && pr) {
      while (pr.path.length > 1 && Math.hypot(pr.path[0].x - c.pos.x, pr.path[0].z - c.pos.z) < 0.15) pr.path.shift();
      const wp = pr.path[0];
      const dx = wp.x - c.pos.x, dz = wp.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      const step = (this.me.speed / 20) * dt;
      let moving = false;
      if (d > 0.05) {
        const k = Math.min(1, step / d);
        const np = pushOut(c.pos.x + dx * k, c.pos.z + dz * k);
        c.pos.x = np.x;
        c.pos.z = np.z;
        let dr = Math.atan2(dx, dz) - c.ry;
        dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        c.ry += dr * Math.min(1, dt * 25);
        moving = true;
      } else if (!pr.arrivedAt) pr.arrivedAt = now;
      // hand back to the server once it caught up, or if we drifted too far from it
      const err = Math.hypot(srv.x - c.pos.x, srv.z - c.pos.z);
      const srvDone = Math.hypot(srv.x - pr.x, srv.z - pr.z) < 0.3;
      if (err > PREDICT_MAX_ERR || (pr.arrivedAt && (srvDone || now - pr.arrivedAt > PREDICT_SETTLE_MS))) this.predict = null;
      c.pos.y = heightAt(c.pos.x, c.pos.z);
      return moving;
    }
    // server-driven (chasing a target, picking up...): extrapolate the latest snapshot a little
    let tx = srv.x, tz = srv.z;
    const moving = (c.flags & F_MOVING) !== 0;
    if (moving && s.length > 1) {
      const a = s[s.length - 2];
      const span = Math.max(1, srv.t - a.t);
      const ahead = Math.min(120, now - srv.t);
      tx += ((srv.x - a.x) / span) * ahead;
      tz += ((srv.z - a.z) / span) * ahead;
    }
    const k = Math.min(1, dt * 18);
    c.pos.x += (tx - c.pos.x) * k;
    c.pos.z += (tz - c.pos.z) * k;
    c.pos.y = heightAt(c.pos.x, c.pos.z);
    let dr = srv.ry - c.ry;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    c.ry += dr * Math.min(1, dt * 14);
    return moving;
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const rt = now - INTERP_DELAY;
    const tSec = now / 1000;
    const self = this.self;

    for (const c of this.ents.values()) {
      const s = c.snaps;
      let moving = (c.flags & F_MOVING) !== 0;
      if (c === self && s.length) moving = this.updateSelf(c, now, dt);
      else if (s.length) {
        let x = s[s.length - 1].x, z = s[s.length - 1].z, ry = s[s.length - 1].ry;
        for (let i = s.length - 1; i > 0; i--) {
          if (s[i - 1].t <= rt) {
            const a = s[i - 1], b = s[i];
            const k = Math.min(1, Math.max(0, (rt - a.t) / Math.max(1, b.t - a.t)));
            x = a.x + (b.x - a.x) * k;
            z = a.z + (b.z - a.z) * k;
            let d = b.ry - a.ry;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            ry = a.ry + d * k;
            break;
          }
          if (i === 1) {
            x = s[0].x;
            z = s[0].z;
            ry = s[0].ry;
          }
        }
        c.pos.set(x, heightAt(x, z), z);
        let d = ry - c.ry;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        c.ry += d * Math.min(1, dt * 14);
      }
      c.root.position.copy(c.pos);
      c.model.rotation.y = c.ry;
      if (c.rig) {
        const hk = c.hitAt ? 1 - (now - c.hitAt) / 180 : 0;
        if (hk > 0) {
          c.model.position.set(c.hitDx * 0.18 * hk, 0, c.hitDz * 0.18 * hk);
          c.model.scale.set(1 + 0.08 * hk, 1 - 0.06 * hk, 1 + 0.08 * hk);
        } else if (c.hitAt) {
          c.hitAt = 0;
          c.model.position.set(0, 0, 0);
          c.model.scale.set(1, 1, 1);
        }
      }
      const dSelf = self ? c.pos.distanceTo(self.pos) : 0;
      // far rigs are tiny on screen: skip their (per-bone) animation
      if (c.rig && dSelf < 60) {
        animate(c.rig, {
          moving,
          atkAge: now - c.atkAt,
          casting: (c.flags & F_CASTING) !== 0,
          deadAge: c.flags & F_DEAD ? (c.deadAt < 0 ? 5000 : now - c.deadAt) : -1,
          t: tSec + c.id,
        });
      } else if (!c.rig) {
        c.model.rotation.y = tSec * 1.5;
        c.model.position.y = 0.1 + Math.sin(tSec * 3 + c.id) * 0.05;
      }
      if (self) {
        const d = dSelf;
        const show = c.id === this.targetId || (c.rec.k === 'i' ? d < 18 : c.rec.k === 'm' ? d < 30 && !(c.flags & F_DEAD) : d < 55);
        c.label.visible = show;
      }
    }

    if (self) {
      this.cam.update(dt, self.pos);
      this.world.follow(self.pos);
    }
    const t = this.targetId !== null ? this.ents.get(this.targetId) : undefined;
    if (t) {
      this.targetRing.visible = true;
      this.targetRing.position.copy(t.pos);
      this.targetRing.position.y += 0.12;
      const s = Math.max(0.7, t.radius * 1.4);
      this.targetRing.scale.setScalar(s + Math.sin(tSec * 5) * 0.05);
      (this.targetRing.material as THREE.MeshBasicMaterial).color.set(this.entColor(t));
    } else this.targetRing.visible = false;
    const h = this.hoverId !== null && this.hoverId !== this.targetId ? this.ents.get(this.hoverId) : undefined;
    if (h) {
      this.hoverRing.visible = true;
      this.hoverRing.position.copy(h.pos);
      this.hoverRing.position.y += 0.1;
      this.hoverRing.scale.setScalar(Math.max(0.7, h.radius * 1.4));
      (this.hoverRing.material as THREE.MeshBasicMaterial).color.set(this.entColor(h));
    } else this.hoverRing.visible = false;
    if (this.clickMarker.visible) {
      const k = (now - this.clickAt) / 400;
      this.clickMarker.visible = k < 1;
      this.clickMarker.scale.setScalar(1 + k);
      (this.clickMarker.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
    this.fx.update();
    this.ui.update(now);
    this.renderer.render(this.world.scene, this.camera);
    this.labels.render(this.world.scene, this.camera);
  }
}
