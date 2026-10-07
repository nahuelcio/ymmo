import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ITEMS } from '../../shared/src/data/items';
import { SKILLS } from '../../shared/src/data/skills';
import { MOBS } from '../../shared/src/data/mobs';
import { itemName, mobName, npcText, zoneName } from '../../shared/src/i18n';
import { lang, t as tx } from './lang';
import { QUEST_BY_NPC, QUESTS, questMarker, questMobs, type QuestMarker } from '../../shared/src/data/quests';
import { F_CASTING, F_DEAD, F_MOVING, F_PVP, type EntAdd, type EntUpd, type InvItem, type S2C, type SelfState } from '../../shared/src/protocol';
import { heightAt } from '../../shared/src/terrain';
import { dashEnd, findPath, pushOut } from '../../shared/src/collision';
import type { Net } from './net';
import { CameraController } from './render/camera';
import { FxManager } from './render/fx';
import { animate, itemModel, mobModel, npcModel, playerModel, type Rig } from './render/models';
import { createWorldScene, type WorldScene } from './render/scene';
import { UI } from './ui';
import { PostFX } from './render/post';
import { settings, type Settings } from './settings';
import { play, type Sfx } from './audio';
import { STATUS_MASK, STATUSES, statusIcons } from '../../shared/src/status';

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
  /** dodge roll animation: start time and (own character only) the predicted path */
  rollAt?: number;
  roll?: { fx: number; fz: number; tx: number; tz: number; ry: number; at: number };
  hpFill: HTMLDivElement | null;
  bubble?: HTMLDivElement | null;
  /** quest giver's floating ! / ? */
  marker?: { obj: CSS2DObject; el: HTMLDivElement };
}

const INTERP_DELAY = 110;
const FLASH_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
/** How long to wait for the server to confirm arrival before trusting it again. */
const PREDICT_SETTLE_MS = 600;
/** Local prediction is discarded beyond this much disagreement with the server. */
const PREDICT_MAX_ERR = 4;
/** Dodge roll animation length. */
const ROLL_MS = 280;

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
  quests: { id: string; progress: number }[] = [];
  questsDone = new Set<string>();
  targetId: number | null = null;
  cooldowns = new Map<string, { end: number; dur: number }>();
  castBar: { end: number; dur: number; name: string } | null = null;
  ctrl = false;
  private raycaster = new THREE.Raycaster();
  private targetRing: THREE.Mesh;
  private clickMarker: THREE.Mesh;
  private clickAt = 0;
  private hoverRing: THREE.Mesh;
  private post: PostFX;
  private fpsEl: HTMLDivElement;
  private lastRender = 0;
  private fpsFrames = 0;
  private fpsAt = 0;
  /** hit-stop: entity animation freezes until this time */
  private freezeUntil = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
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
    // MSAA, shadows, resolution etc. come from the settings (see applySettings / PostFX)
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    host.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 700);
    this.world = createWorldScene();
    this.cam = new CameraController(this.camera, this.renderer.domElement);
    this.fx = new FxManager(this.world.scene);
    this.post = new PostFX(this.renderer, this.world.scene, this.camera);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    host.appendChild(this.fpsEl);

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
    this.applySettings(settings.s, Object.keys(settings.s) as (keyof Settings)[]);
    settings.on((s, changed) => this.applySettings(s, changed));
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
    this.post.resize();
  }

  private applySettings(s: Settings, changed: (keyof Settings)[]) {
    const has = (...k: (keyof Settings)[]) => k.some((x) => changed.includes(x));
    if (has('renderScale')) {
      this.renderer.setPixelRatio(Math.max(0.4, Math.min(3, Math.min(devicePixelRatio, 1.5) * s.renderScale)));
      this.resize();
    }
    if (has('shadows')) {
      const sun = this.world.sun;
      const on = s.shadows !== 'off';
      if (this.renderer.shadowMap.enabled !== on) {
        this.renderer.shadowMap.enabled = on;
        // shadow on/off changes shader programs
        this.world.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
        });
      }
      this.renderer.shadowMap.type = s.shadows === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      const size = s.shadows === 'low' ? 1024 : s.shadows === 'medium' ? 2048 : 4096;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    if (has('viewDistance')) {
      const fog = this.world.scene.fog as THREE.Fog;
      fog.far = s.viewDistance;
      fog.near = s.viewDistance * 0.22;
      this.camera.far = s.viewDistance + 80;
      this.camera.updateProjectionMatrix();
    }
    if (has('toneMapping', 'exposure')) {
      const tm = s.toneMapping ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
      if (this.renderer.toneMapping !== tm) {
        this.renderer.toneMapping = tm;
        this.world.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
        });
      }
      this.renderer.toneMappingExposure = s.exposure;
    }
    if (PostFX.needsRebuild(changed)) this.post.rebuild(s);
    else this.post.tune(s);
    if (has('autoLoot')) this.net.send({ t: 'autoLoot', on: s.autoLoot });
    if (has('foliage')) this.world.detail.visible = s.foliage;
    if (has('showFps')) this.fpsEl.style.display = s.showFps ? 'block' : 'none';
    // HUD
    const root = document.documentElement.style;
    root.setProperty('--ui-scale', String(s.uiScale));
    root.setProperty('--chat-alpha', String(s.chatOpacity));
    document.body.classList.toggle('no-hpbars', !s.hpBars);
    document.body.classList.toggle('no-minimap', !s.minimap);
    this.labels.domElement.style.display = s.nameplates ? '' : 'none';
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
      const prevLvl = this.me.lvl;
      this.me = m.s;
      this.adena = m.s.adena;
      this.ui.onMe();
      if (prevZone !== m.s.zone) this.ui.hud.banner(zoneName(m.s.zone, lang));
      if (prevLvl !== m.s.lvl) this.refreshQuestMarkers();
    });
    n.on('inv', (m) => {
      const count = (l: InvItem[]) => l.reduce((a, i) => a + i.c, 0);
      if (m.adena > this.adena) play('coin', 0.7);
      else if (count(m.items) > count(this.inv)) play('pickup', 0.7);
      this.inv = m.items;
      this.adena = m.adena;
      this.ui.onInv();
    });
    n.on('dmg', (m) => this.onDmg(m));
    n.on('tele', (m) => {
      const c = this.ents.get(m.id);
      this.fx.telegraph(m.x, m.z, m.r, m.ms);
      play('warn', c ? this.near(c) : 0.6);
      setTimeout(() => {
        play('slam', c ? this.near(c) : 0.6);
        this.fx.ring(new THREE.Vector3(m.x, heightAt(m.x, m.z), m.z), 0xff6a3a, m.r, 450);
        const self = this.self;
        if (self && settings.s.screenShake && Math.hypot(self.pos.x - m.x, self.pos.z - m.z) < m.r + 8) this.cam.shake(0.25);
      }, m.ms);
    });
    n.on('say', (m) => {
      this.ui.chat.add('all', m.name, m.text);
      const c = this.ents.get(m.id);
      if (c) this.speech(c, m.text);
    });
    n.on('atk', (m) => {
      const s = this.ents.get(m.s), t = this.ents.get(m.tg);
      if (!s) return;
      s.atkAt = performance.now();
      const ranged = !!t && s.pos.distanceTo(t.pos) > 5;
      if (ranged) play('miss', this.near(s) * 0.5);
      if (t && ranged) {
        this.fx.projectile(s.pos.clone().setY(s.pos.y + s.height * 0.6), () => t.pos.clone().setY(t.pos.y + t.height * 0.5), 0xd8b070, 260, 0.1);
      }
    });
    n.on('cast', (m) => {
      const s = this.ents.get(m.s);
      const def = SKILLS[m.skill];
      if (s && def) this.fx.sparkles(s.pos.clone(), def.color, Math.max(400, m.dur));
      if (s && def && m.dur > 250) play('cast', this.near(s));
      if (m.s === this.me.id && def && m.dur > 0) this.castBar = { end: performance.now() + m.dur, dur: m.dur, name: def.name };
    });
    n.on('fx', (m) => this.onFx(m.s, m.tg, m.skill));
    n.on('cd', (m) => this.cooldowns.set(m.key, { end: performance.now() + m.ms, dur: m.ms }));
    n.on('died', (m) => {
      const e = this.ents.get(m.id);
      if (e) e.deadAt = performance.now();
      if (e) play('death', this.near(e) * (m.id === this.me.id ? 1.3 : 0.6));
      if (m.id === this.me.id) {
        this.castBar = null;
        this.ui.dialogs.death();
      }
    });
    n.on('levelUp', (m) => {
      const e = this.ents.get(m.id);
      if (e) play('levelUp', this.near(e));
      if (e) {
        this.fx.pillar(e.pos.clone(), 0xffd966);
        this.fx.ring(e.pos.clone(), 0xffd966, 3, 900);
      }
      if (m.id === this.me.id) this.ui.hud.banner(tx(`¡Nivel ${m.lvl}!`, `Level ${m.lvl}!`), true);
    });
    n.on('chat', (m) => this.ui.chat.add(m.ch, m.from, m.text));
    n.on('error', (m) => this.sys(m.msg));
    n.on('npc', (m) => this.ui.npc.open(m));
    n.on('quests', (m) => {
      this.quests = m.list;
      this.questsDone = new Set(m.done);
      this.refreshQuestMarkers();
      this.ui.hud.setQuests(m.list);
      this.ui.npc.syncQuest(m.list);
    });
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
        sw.title = tx('PvP activado', 'PvP on');
        n.prepend(sw);
      }
      if (!self) {
        const l = document.createElement('span');
        l.className = 'np-lvl';
        l.textContent = `${tx('Nv', 'Lv')} ${r.l}`;
        n.appendChild(l);
      }
      el.appendChild(n);
      if (!self) this.addHpBar(c);
      this.addStatusIcons(c);
    } else if (r.k === 'm') {
      el.innerHTML = '';
      el.className = 'nameplate np-mob';
      const n = document.createElement('div');
      const elite = MOBS[r.tpl]?.elite;
      n.textContent = `${this.questTargets().some((t) => t.mobs.has(r.tpl)) ? '★ ' : ''}${elite ? '👑 ' : ''}${mobName(r.tpl, lang)} `;
      if (elite) el.classList.add('np-elite');
      n.style.color = conColor(r.l - this.me.lvl);
      const l = document.createElement('span');
      l.className = 'np-lvl';
      l.textContent = `${tx('Nv', 'Lv')} ${r.l}`;
      n.appendChild(l);
      el.appendChild(n);
      this.addHpBar(c);
      this.addStatusIcons(c);
    } else if (r.k === 'n') {
      el.innerHTML = '';
      el.className = 'nameplate np-npc';
      const t = document.createElement('div');
      t.className = 'np-title';
      t.textContent = `<${npcText(r.npc, 'title', lang)}>`;
      const n = document.createElement('div');
      n.className = 'np-npc-name';
      n.textContent = `◆ ${r.n}`;
      el.append(t, n);
    } else {
      el.textContent = r.item === 'adena' ? `${r.c} Adena` : `${itemName(r.item, lang)}${r.c > 1 ? ` (${r.c})` : ''}`;
      el.classList.add('np-item');
    }
  }

  /** Active, unfinished quests → the mob templates that advance them (for map hints). */
  questTargets(): { quest: string; mobs: Set<string> }[] {
    const out: { quest: string; mobs: Set<string> }[] = [];
    for (const a of this.quests) {
      const q = QUESTS[a.id];
      if (q && a.progress < q.objective.count) out.push({ quest: q.name, mobs: new Set(questMobs(q)) });
    }
    return out;
  }

  /** Marker state for a quest giver (by NPC def id), also used by the minimap. */
  questMarkerFor(npcId: string): QuestMarker {
    const q = QUEST_BY_NPC[npcId];
    if (!q) return null;
    return questMarker(q, this.me.lvl, this.quests.find((x) => x.id === q.id), this.questsDone.has(q.id));
  }

  private refreshQuestMarker(c: CEnt) {
    if (c.rec.k !== 'n' || !QUEST_BY_NPC[c.rec.npc]) return;
    if (!c.marker) {
      // outer element is positioned by CSS2DRenderer (transform); the inner one bobs
      const wrap = document.createElement('div');
      const el = document.createElement('div');
      wrap.appendChild(el);
      const obj = new CSS2DObject(wrap);
      obj.position.y = c.height + 1.05;
      c.root.add(obj);
      c.marker = { obj, el };
    }
    const m = this.questMarkerFor(c.rec.npc);
    c.marker.el.className = m ? `quest-marker qm-${m}` : 'quest-marker';
    c.marker.el.textContent = m === 'ready' || m === 'active' ? '?' : m ? '!' : '';
    c.marker.obj.visible = !!m;
  }

  refreshQuestMarkers() {
    for (const c of this.ents.values()) {
      this.refreshQuestMarker(c);
      if (c.rec.k === 'm') this.refreshLabel(c);
    }
  }

  /** Status effect icons (stun, slow, bleed, poison) under the name. */
  private addStatusIcons(c: CEnt) {
    const st = statusIcons(c.flags);
    if (!st.length) return;
    const row = document.createElement('div');
    row.className = 'np-status';
    for (const s of st) {
      const i = document.createElement('span');
      i.textContent = s.icon;
      i.title = s.name;
      row.appendChild(i);
    }
    c.labelEl.appendChild(row);
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
    if (r.k === 'p') rig = playerModel(r.race, r.cls, r.w, r.a, r.lk, r.eq ?? []);
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
    this.refreshQuestMarker(c);
    return c;
  }

  private removeEnt(id: number) {
    const c = this.ents.get(id);
    if (!c) return;
    this.world.scene.remove(c.root);
    c.label.element.remove();
    // part geometries are shared (see models.ts); baked limb meshes and the hitbox are per-entity
    c.hit.geometry.dispose();
    c.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.baked) o.geometry.dispose();
    });
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
      const LABEL_BITS = F_RED | F_PURPLE | F_PVP | STATUS_MASK;
      const colorChanged = (c.flags & LABEL_BITS) !== (f & LABEL_BITS);
      const STUN = 128;
      if (f & STUN && !(c.flags & STUN)) play('stun', c.id === this.me.id ? 1 : this.near(c) * 0.6);
      if (c.id === this.me.id && (c.flags & STATUS_MASK) !== (f & STATUS_MASK)) this.ui.hud.setStatuses(f);
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

  /** Speech bubble above an entity's head for a few seconds. */
  speech(c: CEnt, text: string) {
    c.bubble?.remove();
    const el = document.createElement('div');
    el.className = 'speech';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(0, c.height + 1.35, 0);
    c.root.add(obj);
    c.bubble = el;
    setTimeout(() => {
      c.root.remove(obj);
      el.remove();
      if (c.bubble === el) c.bubble = null;
    }, 6000);
  }

  private floatText(c: CEnt, text: string, cls: string) {
    if (!settings.s.damageNumbers) return;
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

  /** 0..1 loudness for something happening at c (fades out by ~45 m). */
  near(c: CEnt): number {
    const self = this.self;
    if (!self || c === self) return 1;
    return Math.max(0, 1 - c.pos.distanceTo(self.pos) / 45);
  }

  /** Brief white flash on a model when it takes a hit. */
  private flash(c: CEnt) {
    const meshes: THREE.Mesh[] = [];
    c.model.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.flashing) meshes.push(o);
    });
    for (const m of meshes) {
      m.userData.flashing = m.material;
      m.material = FLASH_MAT;
    }
    setTimeout(() => {
      for (const m of meshes) {
        m.material = m.userData.flashing;
        delete m.userData.flashing;
      }
    }, 70);
  }

  private onDmg(m: Extract<S2C, { t: 'dmg' }>) {
    const t = this.ents.get(m.tg);
    if (!t) return;
    const mine = m.tg === this.me.id, byMe = m.s === this.me.id;
    const vol = mine || byMe ? 1 : this.near(t) * 0.45;
    if (m.miss) {
      play('miss', vol);
      return this.floatText(t, tx('Falló', 'Miss'), 'f-miss');
    }
    if (m.heal) {
      play('heal', vol * 0.8);
      return this.floatText(t, `+${m.v}`, 'f-heal');
    }
    if (m.dot) {
      play('dot', vol * 0.6);
      return this.floatText(t, String(m.v), 'f-dot');
    }
    let sfx: Sfx = mine ? 'hurt' : m.crit ? 'crit' : 'hit';
    if (!mine && this.ents.get(m.s)?.rec.k === 'p' && (this.ents.get(m.s)!.rec as { cls?: string }).cls === 'mystic') sfx = 'magic';
    play(sfx, vol);
    this.flash(t);
    // hit-stop: freeze the action for a beat on big hits that involve you
    if (m.crit && (mine || byMe)) this.freezeUntil = performance.now() + 75;
    const src = this.ents.get(m.s);
    if (src && src !== t) {
      const dx = t.pos.x - src.pos.x, dz = t.pos.z - src.pos.z, d = Math.hypot(dx, dz) || 1;
      t.hitAt = performance.now();
      t.hitDx = dx / d;
      t.hitDz = dz / d;
    }
    if (settings.s.screenShake) {
      if (mine) this.cam.shake(m.crit ? 0.35 : 0.08);
      else if (m.crit && m.s === this.me.id) this.cam.shake(0.12);
    }
    this.floatText(t, m.crit ? `${m.v}!` : String(m.v), `${mine ? 'f-hurt' : 'f-dmg'}${m.crit ? ' f-crit' : ''}`);
    if (m.crit && m.s === this.me.id) this.sys(tx(`¡Crítico! ${m.v} de daño.`, `Critical hit! ${m.v} damage.`));
    if (!mine) this.fx.burst(t.pos.clone().setY(t.pos.y + t.height * 0.55), m.crit ? 0xffcc33 : 0xffffff, 0.35, 220);
  }

  private onFx(sId: number, tId: number, skill: string) {
    const s = this.ents.get(sId), t = this.ents.get(tId);
    if (!s) return;
    const chest = (e: CEnt) => e.pos.clone().setY(e.pos.y + e.height * 0.6);
    if (skill === 'potion') return this.fx.sparkles(s.pos.clone(), 0xff5555, 700);
    if (skill === 'chest') {
      play('coin');
      this.fx.sparkles(s.pos.clone(), 0xffd24d, 1200);
      this.fx.pillar(s.pos.clone(), 0xffd24d, 1000, 3);
      return;
    }
    if (skill === 'dash') {
      if (s !== this.self || !s.rollAt || performance.now() - s.rollAt > ROLL_MS) {
        play('dash', this.near(s));
        s.rollAt = performance.now();
      }
      this.fx.ring(s.pos.clone(), 0xcfe6ff, 1.6, 350);
      return;
    }
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

  /** Dodge roll toward the mouse cursor (or forward). */
  dash() {
    const self = this.self;
    if (!self || self.flags & F_DEAD) return;
    // toward the cursor; facing direction if the cursor is on the character (or off the ground)
    let dx = Math.sin(self.ry), dz = Math.cos(self.ry);
    if (this.lastPointer && !this.joy) {
      const v = new THREE.Vector2((this.lastPointer.x / innerWidth) * 2 - 1, -(this.lastPointer.y / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(v, this.camera);
      const hit = this.raycaster.intersectObject(this.world.terrain, true)[0];
      const hx = hit ? hit.point.x - self.pos.x : 0, hz = hit ? hit.point.z - self.pos.z : 0;
      const d = Math.hypot(hx, hz);
      if (d > 1.2) {
        dx = hx / d;
        dz = hz / d;
      }
    } else if (this.joy) {
      const d = Math.hypot(this.joy.dx, this.joy.dy);
      if (d > 0.1) {
        // joystick is screen-space: rotate by the camera yaw
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        const fl = Math.hypot(fwd.x, fwd.z) || 1;
        const fx = fwd.x / fl, fz = fwd.z / fl;
        dx = (fx * -this.joy.dy + -fz * this.joy.dx) / d;
        dz = (fz * -this.joy.dy + fx * this.joy.dx) / d;
      }
    }
    const now = performance.now();
    const ready = (this.cooldowns.get('dash')?.end ?? 0) <= now && !(self.flags & STATUSES.stun.flag);
    if (ready) {
      // predict the roll locally so it starts on the key press, not a round-trip later
      const end = dashEnd(self.pos.x, self.pos.z, dx, dz);
      self.rollAt = now;
      self.roll = { fx: self.pos.x, fz: self.pos.z, tx: end.x, tz: end.z, ry: Math.atan2(dx, dz), at: now };
      play('dash');
    }
    // send our start point and direction so the server rolls along exactly the same path
    this.serverAction({ t: 'dash', x: self.roll?.fx ?? self.pos.x, z: self.roll?.fz ?? self.pos.z, dx, dz });
  }

  /** Virtual joystick (mobile): dx/dy in -1..1, screen space; null when released. */
  private joy: { dx: number; dy: number } | null = null;
  private lastJoySend = 0;

  setJoystick(dx: number, dy: number) {
    const was = this.joy;
    this.joy = Math.hypot(dx, dy) > 0.15 ? { dx, dy } : null;
    if (was && !this.joy) {
      this.predict = null;
      this.net.send({ t: 'stop' });
    }
  }

  /** Walk a few metres ahead in the joystick direction, relative to the camera. */
  private driveJoystick(now: number) {
    const self = this.self;
    if (!this.joy || !self || now - this.lastJoySend < 110) return;
    this.lastJoySend = now;
    const y = this.cam.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y); // forward (away from the camera)
    const rx = Math.cos(y), rz = -Math.sin(y); // screen right
    const k = Math.min(1, Math.hypot(this.joy.dx, this.joy.dy));
    const dx = (rx * this.joy.dx - fx * this.joy.dy), dz = (rz * this.joy.dx - fz * this.joy.dy);
    const d = Math.hypot(dx, dz) || 1;
    const x = self.pos.x + (dx / d) * 4 * k, z = self.pos.z + (dz / d) * 4 * k;
    this.moveTo(new THREE.Vector3(x, heightAt(x, z), z), false);
  }

  useSkill(id: string) {
    if (SKILLS[id]?.target === 'enemy' && !this.ensureEnemyTarget()) return this.sys(tx('No hay enemigos cerca.', 'No enemy nearby.'));
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
      const t = this.raycaster.intersectObject(this.world.terrain, true)[0];
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
      if (e.button !== 0 || e.pointerType === 'touch') return; // touch acts on tap (pointerup)
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
      // mobile: a tap (not a camera drag) selects / attacks / walks
      if (e.pointerType === 'touch' && !this.cam.touchDragged) {
        (document.activeElement as HTMLElement | null)?.blur();
        const r = pick(e);
        if (r.ent) this.interact(r.ent, false);
        else if (r.point) this.moveTo(r.point, true);
      }
    });
    el.addEventListener('pointermove', (e) => {
      this.lastPointer = { x: e.clientX, y: e.clientY };
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
        case 'o': this.ui.settings.win.toggle(); break;
        case 'p': this.ui.party.toggle(); break;
        case 'z': this.pickupNearest(); break;
        case ' ': e.preventDefault(); this.attackTarget(); break;
        case 'shift': this.dash(); break;
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
    if (c.roll) {
      const k = (now - c.roll.at) / ROLL_MS;
      if (k < 1) {
        const e = 1 - (1 - k) * (1 - k); // ease out
        c.pos.x = c.roll.fx + (c.roll.tx - c.roll.fx) * e;
        c.pos.z = c.roll.fz + (c.roll.tz - c.roll.fz) * e;
        c.pos.y = heightAt(c.pos.x, c.pos.z);
        c.ry = c.roll.ry;
        return false;
      }
      // hold at the end until a server snapshot shows the roll (stale ones would pull us back)
      const srv0 = c.snaps[c.snaps.length - 1];
      const synced = srv0 && Math.hypot(srv0.x - c.roll.tx, srv0.z - c.roll.tz) < 1.5;
      if (!synced && now - c.roll.at < ROLL_MS + 800) {
        c.pos.set(c.roll.tx, heightAt(c.roll.tx, c.roll.tz), c.roll.tz);
        return false;
      }
      c.roll = undefined;
    }
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
    const cap = settings.s.fpsCap;
    if (cap && now - this.lastRender < 1000 / cap - 1.5) return;
    this.lastRender = now;
    this.fpsFrames++;
    if (now - this.fpsAt >= 500) {
      if (settings.s.showFps) this.fpsEl.textContent = `${Math.round((this.fpsFrames * 1000) / (now - this.fpsAt))} FPS`;
      this.fpsFrames = 0;
      this.fpsAt = now;
    }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const rt = now - INTERP_DELAY;
    const tSec = now / 1000;
    const self = this.self;

    // entities outside the camera frustum: hidden, not animated, no nameplate
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.driveJoystick(now);
    const frozen = now < this.freezeUntil;
    for (const c of this.ents.values()) {
      if (frozen) break;
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
      if (c.rig && c.rollAt) {
        // forward tumble around the body's centre, tucked in
        const k = (now - c.rollAt) / ROLL_MS;
        const h = c.height * 0.5;
        if (k < 1) {
          const th = (1 - (1 - k) * (1 - k)) * Math.PI * 2;
          const tuck = Math.sin(k * Math.PI);
          c.model.rotation.order = 'YXZ';
          c.model.rotation.x = th;
          const fwd = -h * Math.sin(th);
          c.model.position.set(Math.sin(c.ry) * fwd, h - h * Math.cos(th) - tuck * h * 0.35, Math.cos(c.ry) * fwd);
          c.model.scale.set(1, 1 - tuck * 0.25, 1);
        } else {
          c.rollAt = 0;
          c.model.rotation.x = 0;
          c.model.position.set(0, 0, 0);
          c.model.scale.set(1, 1, 1);
        }
      }
      const dSelf = self ? c.pos.distanceTo(self.pos) : 0;
      this.sphere.center.set(c.pos.x, c.pos.y + c.height / 2, c.pos.z);
      this.sphere.radius = Math.max(c.height, c.radius) + 2; // margin so shadows don't pop
      const onScreen = c === self || this.frustum.intersectsSphere(this.sphere);
      c.root.visible = onScreen;
      // far rigs are tiny on screen: skip their (per-bone) animation
      if (c.rig && onScreen && dSelf < 60) {
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
        // player names always show (whenever they're on screen); items, mobs and NPCs fade by distance
        const show = c.id === this.targetId || c.rec.k === 'p' || (c.rec.k === 'i' ? d < 18 : c.rec.k === 'm' ? d < 30 && !(c.flags & F_DEAD) : d < 55);
        c.label.visible = show && onScreen;
        // like WoW: quest markers show from afar, but not across the whole map
        if (c.marker) c.marker.obj.visible = onScreen && d < 90 && c.marker.el.textContent !== '';
      }
    }

    if (self) {
      this.cam.update(dt, self.pos);
      this.world.follow(self.pos);
      this.world.updateSky(this.camera, this.camera.far, dt);
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
    this.post.render();
    this.labels.render(this.world.scene, this.camera);
  }
}
