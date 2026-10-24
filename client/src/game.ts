import * as THREE from 'three';
import { applyLod, tickLod, type LodState } from './render/lod';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { ITEMS } from '../../shared/src/data/items';
import { SKILLS } from '../../shared/src/data/skills';
import { MOBS } from '../../shared/src/data/mobs';
import { itemName, mobName, npcText, specName, zoneName } from '../../shared/src/i18n';
import { lang, t as tx } from './lang';
import { QUEST_BY_NPC, QUESTS, questMarker, questMobs, type QuestMarker } from '../../shared/src/data/quests';
import { F_CASTING, F_DEAD, F_GATHER, F_MOVING, F_PVP, F_SITTING, type EntAdd, type EntUpd, type InvItem, type S2C, type SelfState } from '../../shared/src/protocol';
import { biomeWeight, heightAt, isDeep, isDeepCell, smoothstep, SWIM_SPEED, WATER_LEVEL } from '../../shared/src/terrain';
import { GATHER, isRest, nodeById, nodeIndex, nodesNear, reachOf, STAND_UP_MS, tentCentre, type NodeDef } from '../../shared/src/nodes';
import { layoutRocks, layoutTrees, layoutZoneProps } from '../../shared/src/layout';
import { NodeVisuals } from './render/nodes';
import { setSeeThrough } from './render/nature';
import { BOW_RANGE, MELEE_RANGE } from '../../shared/src/formulas';
import { dashEnd, findPath, navGrid, pushOut, tripLegs } from '../../shared/src/collision';
import type { Net } from './net';
import { CameraController } from './render/camera';
import { FxManager } from './render/fx';
import { GENERIC_VFX, SKILL_VFX } from './render/skill-fx';
import { animate, itemModel, mobModel, npcModel, playerModel, rimLit, skillAnimOf, skillImpactMs, skillStrikes, type Rig } from './render/models';
import { CHAIN_MS, swingOf, swingTiming, windup } from './render/swings';
import { elementOf } from './render/mobs';
import { tickEnchantFx } from './render/enchant-fx';
import { BRAZIER_FIRES, createWorldScene, footingAt, lightSources, tentDoorClosed, type WorldScene } from './render/scene';
import { UI } from './ui';
import { glyph, setTipLevel, setTipSelf } from './ui/common';
import { hideTip, showTipAt } from './ui/dom';
import { ATMOS, Critters, LocalLights, Motes, Rain, rainAt, stormStrikes, tickWind } from './render/atmos';
import { PostFX } from './render/post';
import { relief } from './render/textures';
import { settings, textureQuality, type Action, type Settings } from './settings';
import { ambience, indoors, play, setWeather, step, thunder, type Sfx } from './audio';
import { SLOW_MUL, STATUS_IDS, STATUS_MASK, STATUSES } from '../../shared/src/status';

export const F_PURPLE = 16;
export const F_RED = 32;

interface Snap { t: number; x: number; z: number; ry: number }

export interface CEnt {
  id: number;
  rec: EntAdd;
  rig: Rig | null;
  /** level of detail by distance (render/lod.ts) */
  lod?: LodState;
  /** where the model stood (root position, model offset, scale and heading) at its last matrix update */
  mwAt?: number[];
  root: THREE.Group;
  model: THREE.Object3D;
  /** the model's own size (mobs and races differ): squash effects multiply it instead of replacing it */
  size: number;
  hit: THREE.Mesh;
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  /** follows the entity in the label layer and carries its nameplate, quest mark, speech and damage numbers */
  tag: THREE.Object3D;
  snaps: Snap[];
  pos: THREE.Vector3;
  ry: number;
  hp: number;
  flags: number;
  atkAt: number;
  /** the swing under way is a dagger skill's stab, or a skill's own blow (render/quaternius.ts animateQ, SKILL_ANIM) */
  atkStab?: boolean;
  atkAnim?: string;
  /** vanished until then (the assassin's Vanish): our own body drawn faded meanwhile (others don't get it at all from
   * the server), and the faded materials in place of its own while it is (Game.ghost) */
  invisUntil?: number;
  ghost?: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  /** where it stood last frame and how fast it goes over the ground (smoothed), and since when a player walking is
   * held in place (pressed against a trunk): the run plays at that pace, or stops */
  groundX?: number;
  groundZ?: number;
  groundSpeed?: number;
  heldSince?: number;
  /** which blow of its weapon's chain the swing is, the time between its last two swings (render/swings.ts), and whom
   * it is at */
  atkStep?: number;
  atkInterval?: number;
  atkTarget?: number;
  /** the skill being cast and when it began: what the body does with its weapon meanwhile (castMove); and when the
   * casting flag last went off (its 'fx' may still be on the way) */
  castSkill?: string;
  castAt?: number;
  castEndAt?: number;
  deadAt: number;
  height: number;
  radius: number;
  /** hit reaction: time + direction away from the attacker */
  hitAt: number;
  /** hit-stop: until then this rig keeps its pose (its position still updates) */
  hitStop?: number;
  hitDx: number;
  hitDz: number;
  /** dodge roll animation: start time and (own character only) the predicted path */
  rollAt?: number;
  /** /dance emote running until this time */
  danceUntil?: number;
  /** got at least one animated pose (a rig never animated stays in its bind T-pose) */
  posed?: boolean;
  roll?: { fx: number; fz: number; tx: number; tz: number; ry: number; at: number };
  hpFill: HTMLDivElement | null;
  bubble?: HTMLDivElement | null;
  /** the bubble's label object: replacing a bubble must take this off, the label layer re-adds a lone element */
  bubbleObj?: CSS2DObject | null;
  /** quest giver's floating ! / ? */
  marker?: { obj: CSS2DObject; el: HTMLDivElement };
  /** when it sat down / got up (F_SITTING edges), for the sit-down and get-up clips */
  sitAt?: number;
  standAt?: number;
  /** sat on the ground (not a seat): the floor-sit clips, not the chair's (render/quaternius.ts) */
  groundSit?: boolean;
  /** resting inside a tent: the body hidden, the door let down, zzz over it, and the plate and hitbox on the tent */
  tent?: { door: THREE.Object3D; zzz: CSS2DObject; top: THREE.Vector3 };
  /** the node it is working (from the server's 'gather') and how many strokes were already shown */
  gather?: { node: NodeDef; at: number; swingMs: number; anim: 'chop' | 'mine' | 'pick'; strokes: number };
  /** last ripple while swimming */
  splashAt?: number;
  /** last flame (or frost) on it while it burns (or is frostbitten) */
  burnAt?: number;
}

/** Base interpolation delay (ms): one server tick plus margin; grows with measured network jitter. */
const INTERP_BASE = 70;
const INTERP_MAX = 200;
// ponytail: the server reports these only as chat text, so they are recognised by wording (es/en);
// a structured message would be sturdier but needs a protocol change.
const GAIN = /^(?:Juntaste|You picked up) (\d+) (?:de )?adena\.$|^(?:Ganaste|You have earned) (\d+) (?:de )?experienc/;
const NOT_READY = /todavía no está lista\.$|is not ready yet\.$|Ya estás lanzando una habilidad\.$|You are already casting\.$/;
/** the server's answer to /who, which the player list (hold Tab) asks for and shows instead of the chat */
const WHO = /^(?:Jugadores conectados|Players online) \((\d+)\): (.*)$/;
/**
 * The hit flash, one material per shader variant (skinned and/or with shape keys): a single shared one made the
 * renderer switch programs on every draw while a character flashed.
 */
/** A clan's crest (16×12, drawn pixel-sharp), or an alliance's (8×12); the version in the URL makes a new crest a new image. */
export function crestImg(clan: number, ver: number, ally = false): HTMLImageElement {
  const img = document.createElement('img');
  img.className = ally ? 'crest crest-ally' : 'crest';
  img.src = `/crest/${ally ? 'a' : ''}${clan}.png?v=${ver}`;
  img.alt = '';
  return img;
}

/** At most BUBBLE_CHARS characters of a chat line, cut at the last space when there is one near the end. */
const BUBBLE_CHARS = 30;
function oneLine(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= BUBBLE_CHARS) return t;
  const cut = t.slice(0, BUBBLE_CHARS);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > BUBBLE_CHARS * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** scratch for the per-frame "did this rig move" check (game.ts frame) */
const MW_TMP: number[] = [];
const FLASH_MATS = new Map<string, THREE.MeshBasicMaterial>();
const flashMat = (o: THREE.Mesh) => {
  const k = `|${!!o.geometry.morphAttributes.position}`;
  let m = FLASH_MATS.get(k);
  if (!m) FLASH_MATS.set(k, (m = new THREE.MeshBasicMaterial({ color: 0xffffff })));
  return m;
};
/** How long to wait for the server to confirm arrival before trusting it again. */
const PREDICT_SETTLE_MS = 600;
/** Local prediction is discarded beyond this much disagreement with the server. */
const PREDICT_MAX_ERR = 12;
/** Beyond this, the prediction is eased toward the server each frame instead of snapping. */
const PREDICT_SOFT_ERR = 1;
/** Under this over the ground (m/s; a walk is 6) a player trying to walk is held in place: it stops running. */
const HELD_SPEED = 1.5;
/** Dodge roll animation length. */
const ROLL_MS = 280;

type Pick = { ent?: CEnt; node?: NodeDef; point?: THREE.Vector3 };

/** Where a swimmer's root goes: the swim clips are authored around the surface (head out treading water, back awash swimming). */
const SWIM_BODY_Y = WATER_LEVEL - 0.05;
/** Got up since it last sat down (the server may not have said so yet, for our own character). */
const isStanding = (c: CEnt) => c.standAt !== undefined && c.standAt > (c.sitAt ?? -Infinity);
/** What the cast bar says while working a node. */
const GATHER_LABEL: Record<'chop' | 'mine' | 'pick', () => string> = {
  chop: () => tx('Talando…', 'Chopping…'),
  mine: () => tx('Picando…', 'Mining…'),
  pick: () => tx('Recolectando…', 'Picking…'),
};
/** How tall each kind of node stands, for picking it with the cursor. */
const nodeHeight = (n: NodeDef) => (n.kind === 'tree' ? 5 * layoutTrees()[nodeIndex(n)].sc : n.kind === 'rock' ? layoutRocks()[nodeIndex(n)].s[1] * 1.6 : n.kind === 'tent' ? 2.5 : 1.1);
/** Cursor and hover hint for each kind of node. */
const NODE_HINT: Record<NodeDef['kind'], { cursor: () => string; label: () => string }> = {
  tree: { cursor: () => CURSORS.chop, label: () => tx('Talar (requiere un hacha)', 'Fell (needs an axe)') },
  rock: { cursor: () => CURSORS.mine, label: () => tx('Picar (requiere un pico o un martillo)', 'Mine (needs a pickaxe or a hammer)') },
  bush: { cursor: () => 'grab', label: () => tx('Recolectar bayas', 'Pick berries') },
  seat: { cursor: () => 'pointer', label: () => tx('Sentarse', 'Sit down') },
  tent: { cursor: () => 'pointer', label: () => tx('Descansar (recuperás vida y maná más rápido)', 'Rest (health and mana come back faster)') },
};

// Shared ground decals marking NPCs (gold) and other players (blue).
const DECAL_GEO = new THREE.RingGeometry(0.78, 0.92, 32).rotateX(-Math.PI / 2);
const decalMat = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
const NPC_DECAL = decalMat(0xffc94a, 0.75);
const PLAYER_DECAL = decalMat(0x5aa8ff, 0.45);

/** hitboxes are never drawn: one material for all of them */
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });

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
  chop: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M6 26 L18 8" stroke="#7a4a22" stroke-width="3.5" stroke-linecap="round"/><path d="M14 4 C20 2 26 6 25 12 L19 11 L16 7 Z" fill="#c8d0d8" stroke="#2a2a2a" stroke-width="1.3"/></svg>',
    4, 24, 'pointer'),
  mine: svgCursor(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M8 26 L18 10" stroke="#7a4a22" stroke-width="3.5" stroke-linecap="round"/><path d="M5 9 C11 3 21 3 26 9 L23 10 C19 7 13 7 8 11 Z" fill="#9aa2aa" stroke="#2a2a2a" stroke-width="1.3"/></svg>',
    6, 24, 'pointer'),
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
  /** every entity root: the nameplate layer only walks this, not the whole world */
  private entLayer = new THREE.Group();
  /**
   * Nameplates and other floating HTML, one small anchor per entity. Kept out of the entities' own trees so
   * the label renderer walks a few nodes per entity instead of every bone, and doesn't redo their matrices.
   */
  private labelLayer = new THREE.Group();
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
  cooldowns = new Map<string, { end: number; dur: number; predicted?: boolean }>();
  /** round-trip time to the server (ms), measured by the server's pings */
  rtt = 0;
  /** time of a swing we started locally before the server confirmed it */
  private predictedSwing = 0;
  /** skill: set for a skill's cast (Esc cancels it), not for gathering */
  castBar: { end: number; dur: number; name: string; skill?: string } | null = null;
  /** the skill pressed during our cast (server 'queued'): it goes when the cast ends, if it is ready by then */
  queuedSkill: string | null = null;
  /** each caster's cast sparkles, and each mob's special-attack warning with its slam timer, to stop if cut short */
  private castFx = new Map<number, ReturnType<FxManager['sparkles']>>();
  /** wind-ups on the ground, by caster (a world raid's barrage and pulse add a key: several at once) */
  private teles = new Map<number | string, { fx: ReturnType<FxManager['telegraph']>; timer: number }>();
  ctrl = false;
  private raycaster = new THREE.Raycaster();
  private targetRing: THREE.Mesh;
  private clickMarker: THREE.Group;
  private clickMat!: THREE.MeshBasicMaterial;
  private clickAt = 0;
  private hoverRing: THREE.Mesh;
  private post: PostFX;
  private fpsEl: HTMLDivElement;
  /** shown while the server has been silent for a while (packet loss); the game keeps waiting for it */
  private netWarn: HTMLDivElement;
  private cpuMs = 0;
  private stepAt = 0;
  private lastRender = 0;
  /** the page has the keyboard focus (frames drop to 30 fps while it doesn't) */
  private focused = document.hasFocus();
  private fpsFrames = 0;
  private fpsAt = 0;
  private frameNo = 0;
  /** hit-stop: entity animation freezes until this time */
  private lastPointer: { x: number; y: number } | null = null;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  /** nameplates shown this frame, with their distance (-1: target, hovered or a player, never hidden) */
  private plates: { c: CEnt; d: number }[] = [];
  private plateV = new THREE.Vector3();
  private hoverId: number | null = null;
  /** Set while the benchmark runs: called every frame with its real duration (bench.ts). */
  benchHook: ((frameMs: number, tSec: number) => void) | null = null;
  private motes = new Motes();
  private critters = new Critters();
  private rain = new Rain();
  /** felled trees, mined rocks, picked bushes (render/nodes.ts) */
  nodes!: NodeVisuals;
  /** the world node under the cursor */
  private hoverNode: NodeDef | null = null;
  /** the node hint tooltip is up (ours to hide) */
  private nodeTip = false;
  private lights!: LocalLights;
  private sunScreen = new THREE.Vector3();
  /**
   * Destinations picked on the world map, walked in order; route[0] is where we are heading now. leg: a stop placed
   * along a long trip (shared/src/collision.ts tripLegs), not one the player picked.
   */
  route: { x: number; z: number; leg?: boolean }[] = [];
  private routeMovedAt = 0;
  /** the walk to route[0] was planned again once after stopping short (a second stop gives the route up) */
  private routeRetried = false;
  /** Client-side predicted move destination for our own character. */
  /** best / progressAt: the closest it has got to (x, z) and when (no headway for a while ends the prediction) */
  private predict: { x: number; z: number; arrivedAt: number; path: { x: number; z: number }[]; chase?: { id: number; range: number; repathAt: number }; best?: number; progressAt?: number } | null = null;
  /** where the camera looks through the crowns to (our chest) */
  private seeFocus = new THREE.Vector3();
  /** our own positions over the last moments (updateSelf): each server snapshot is set against where we were then */
  private selfHist: { t: number; x: number; z: number }[] = [];
  private teleportPending = true;
  private last = performance.now();
  private down: { x: number; y: number } | null = null;

  /** the skill bars' layout as the server keeps it (ui/hud.ts) */
  barData: string;

  constructor(public net: Net, enter: Extract<S2C, { t: 'enter' }>) {
    this.barData = enter.bar ?? '';
    this.me = enter.self;
    setTipLevel(() => this.me.lvl);
    setTipSelf(() => this.me);
    ambience(enter.self.zone);
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
    this.world = createWorldScene({
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
      // the sky is baked into the scene environment (IBL): PMREM needs the renderer
      renderer: this.renderer,
      // texture shaders compile in the background (KHR_parallel_shader_compile) before they are swapped in
      precompile: (o) => this.post.compileAsync(o),
    });
    this.cam = new CameraController(this.camera, this.renderer.domElement);
    this.fx = new FxManager(this.world.scene);
    this.post = new PostFX(this.renderer, this.world.scene, this.camera);
    this.post.sun = this.world.sun;
    // the path grid takes ~100 ms to build: do it while idle, not on the first click that needs it
    (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 500)))(() => navGrid());
    this.world.scene.add(this.motes.points, this.critters.group, this.rain.lines);
    try {
      this.untracked = new Set(JSON.parse(localStorage.getItem(`untracked:${this.me.name}`) ?? '[]') as string[]);
    } catch {
      /* ignore */
    }
    this.lights = new LocalLights(this.world.scene, lightSources());
    this.fx.onLight = (at, color, power, range, ms) => this.lights.flash(at, color, power, range, ms);
    for (const b of BRAZIER_FIRES) this.fx.hearth(new THREE.Vector3(b.x, b.y, b.z), 1.1);
    this.nodes = new NodeVisuals(this.world.scene);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    host.appendChild(this.fpsEl);
    this.netWarn = document.createElement('div');
    this.netWarn.className = 'netwarn';
    this.netWarn.textContent = tx('Conexión inestable…', 'Unstable connection…');
    host.appendChild(this.netWarn);
    this.renderer.info.autoReset = false; // count every pass of a frame (post-processing renders several times)

    const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), glow(0xff4444));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    // the walk-to marker: a thin gold ring closing in with four chevrons pointing at the spot (flat on the ground)
    this.clickMat = Object.assign(glow(0xffd36a), { blending: THREE.AdditiveBlending });
    this.clickMarker = new THREE.Group();
    this.clickMarker.add(new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 40).rotateX(-Math.PI / 2), this.clickMat));
    const chev = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.12, 0.16), new THREE.Vector2(0, 0), new THREE.Vector2(0.12, 0.16), new THREE.Vector2(0, 0.08)])).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(chev, this.clickMat);
      c.rotation.y = (i * Math.PI) / 2;
      this.clickMarker.add(c);
    }
    this.clickMarker.visible = false;
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), glow(0xffffff));
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    (this.hoverRing.material as THREE.MeshBasicMaterial).opacity = 0.5;
    this.world.scene.add(this.targetRing, this.clickMarker, this.hoverRing, this.entLayer);

    this.ui = new UI(this);
    this.bindNet();
    this.bindInput();
    addEventListener('resize', () => this.resize());
    addEventListener('focus', () => (this.focused = true));
    addEventListener('blur', () => (this.focused = false));
    // an armour set came in: players drawn without its pieces get them
    addEventListener('gear-loaded', () => this.ents.forEach((c) => this.remodel(c)));
    this.applySettings(settings.s, Object.keys(settings.s) as (keyof Settings)[]);
    settings.on((s, changed) => this.applySettings(s, changed));
    this.ui.onMe();
    this.ui.onInv();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get self(): CEnt | undefined {
    return this.ents.get(this.me.id);
  }

  /** the user's pixel ratio: device ratio (capped) times the renderScale setting */
  private basePixelRatio() {
    return Math.max(0.4, Math.min(3, Math.min(devicePixelRatio, 1.5) * settings.s.renderScale));
  }

  private setResScale(k: number) {
    this.resScale = k;
    this.renderer.setPixelRatio(this.basePixelRatio() * k);
    this.resize();
  }

  /**
   * Dynamic resolution: a window averaging over 20 ms a frame (under 50 fps) steps the pixel ratio down by 5%,
   * down to 70% of the user's setting. Two good windows in a row (under 15 ms) step it back up. Never above the setting.
   */
  private resScale = 1;
  private resSum = 0;
  private resN = 0;
  private resAt = 0;
  private resGood = 0;
  private adaptRes(now: number, ms: number) {
    if (!settings.s.dynamicRes || (settings.s.fpsCap && settings.s.fpsCap < 60)) {
      if (this.resScale !== 1) this.setResScale(1);
      return;
    }
    this.resSum += Math.min(100, ms);
    this.resN++;
    if (now - this.resAt < 2000) return;
    const avg = this.resSum / this.resN;
    this.resSum = 0;
    this.resN = 0;
    this.resAt = now;
    if (avg > 20 && this.resScale > 0.7) {
      this.resGood = 0;
      this.setResScale(Math.max(0.7, +(this.resScale - 0.05).toFixed(2)));
    } else if (avg < 15 && this.resScale < 1 && ++this.resGood >= 2) {
      this.resGood = 0;
      this.setResScale(Math.min(1, +(this.resScale + 0.05).toFixed(2)));
    } else if (avg >= 15) this.resGood = 0;
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
    if (has('preset')) this.world.setTextureQuality(textureQuality(s));
    if (has('textureAniso')) this.world.setAniso(s.textureAniso);
    if (has('renderScale', 'dynamicRes')) {
      if (!s.dynamicRes) this.resScale = 1;
      this.setResScale(this.resScale);
    }
    if (has('shadows', 'softShadows', 'shadowRange')) {
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
      // soft: plain PCF with a wide kernel (PCFSoft ignores the radius); otherwise as before
      this.renderer.shadowMap.type = s.softShadows || s.shadows !== 'high' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
      sun.shadow.radius = s.softShadows ? 3 : 1;
      const sc = sun.shadow.camera, r = s.shadowRange;
      sc.left = sc.bottom = -r;
      sc.right = sc.top = r;
      sc.far = 360;
      sc.updateProjectionMatrix();
      const size = s.shadows === 'low' ? 1024 : s.shadows === 'medium' ? 2048 : 4096;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      this.renderer.shadowMap.needsUpdate = true; // new map is blank until rendered
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
    if (has('relief')) relief.value = s.relief;
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
    n.on('snap', (m) => this.onSnap(m.add, m.upd, m.gone, m.st));
    n.on('me', (m) => {
      const prevZone = this.me.zone;
      const prevLvl = this.me.lvl;
      this.me = m.s;
      this.adena = m.s.adena;
      this.ui.onMe();
      if (prevZone !== m.s.zone) {
        this.ui.hud.banner(zoneName(m.s.zone, lang));
        ambience(m.s.zone);
      }
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
    // Other entities are drawn INTERP_DELAY in the past: play their combat events on that same
    // timeline so a swing, its damage number and the hit reaction line up. Our own are instant.
    const onSync = <T extends S2C['t']>(t: T, src: (m: Extract<S2C, { t: T }>) => number, h: (m: Extract<S2C, { t: T }>) => void) =>
      n.on(t, (m) => (src(m) === this.me.id ? h(m) : setTimeout(() => h(m), this.interpDelay)));
    onSync('dmg', (m) => m.s, (m) => this.onDmg(m));
    n.on('ping', (m) => {
      this.net.send({ t: 'pong', s: m.s });
      this.rtt = m.rtt;
    });
    n.on('tele', (m) => {
      const c = this.ents.get(m.id), key: number | string = m.k ? `${m.id}:${m.k}` : m.id;
      const fx = this.fx.telegraph(m.x, m.z, m.r, m.ms);
      play('warn', c ? this.near(c) : 0.6);
      // a stun before it lands calls it off (castx): no slam
      const element = c?.rec.k === 'm' ? elementOf(c.rec.tpl) : undefined;
      const timer = window.setTimeout(() => {
        this.teles.delete(key);
        play('slam', c ? this.near(c) : 0.6);
        this.fx.ring(new THREE.Vector3(m.x, heightAt(m.x, m.z), m.z), element === 'ice' ? 0x9ad8ff : 0xff6a3a, m.r, 450);
        // a fire or frost beast's circle bursts into flames or frost: one in the middle, more spread over a wide one
        if (element) for (let i = 0, n = Math.min(8, Math.ceil(m.r / 3)); i < n; i++) {
          const a = Math.random() * Math.PI * 2, d = i ? Math.sqrt(Math.random()) * m.r * 0.8 : 0;
          const at = new THREE.Vector3(m.x + Math.cos(a) * d, 0, m.z + Math.sin(a) * d);
          at.y = heightAt(at.x, at.z);
          if (element === 'fire') this.fx.flame(at, Math.min(2.2, m.r / 2), 1100);
          else this.fx.frost(at, Math.min(2.6, m.r / 2), 1500);
        }
        const self = this.self;
        if (self && settings.s.screenShake && Math.hypot(self.pos.x - m.x, self.pos.z - m.z) < m.r + 8) this.cam.shake(0.25);
      }, m.ms);
      this.teles.set(key, { fx, timer });
    });
    n.on('say', (m) => {
      this.ui.chat.add('npc', m.name, m.text);
      const c = this.ents.get(m.id);
      if (c) this.speech(c, m.text);
    });
    onSync('atk', (m) => m.s, (m) => {
      const s = this.ents.get(m.s), t = this.ents.get(m.tg);
      if (!s) return;
      // our first swing was already played on the click (prediction)
      if (m.s === this.me.id && performance.now() - this.predictedSwing < 350) this.predictedSwing = 0;
      else this.startSwing(s, performance.now(), m.tg);
      const ranged = !!t && s.pos.distanceTo(t.pos) > 5;
      if (ranged) play('miss', this.near(s) * 0.5);
      // an archer looses an arrow as the drawn string goes (quaternius.ts aimBow: a little over half the shot)
      if (t && this.holdsBow(s)) this.fx.arrow(this.bowHand(s), () => t.pos.clone().setY(t.pos.y + t.height * 0.55), { delay: 380 });
      else if (t && ranged) {
        this.fx.projectile(s.pos.clone().setY(s.pos.y + s.height * 0.6), () => t.pos.clone().setY(t.pos.y + t.height * 0.5), 0xd8b070, 260, 0.1);
      }
    });
    onSync('cast', (m) => m.s, (m) => {
      const s = this.ents.get(m.s);
      const def = SKILLS[m.skill];
      if (s) (s.castSkill = m.skill), (s.castAt = performance.now());
      if (s && def) this.castFx.set(m.s, this.fx.sparkles(s.pos.clone(), def.color, Math.max(400, m.dur)));
      if (s && def && m.dur > 250) play('cast', this.near(s));
      if (m.s === this.me.id && def && m.dur > 0) this.castBar = { end: performance.now() + m.dur, dur: m.dur, name: def.name, skill: m.skill };
      if (m.s === this.me.id && this.queuedSkill === m.skill) this.queuedSkill = null;
    });
    // a cast (or a mob's special attack) stopped before it went off: cancelled, stunned, dead
    n.on('castx', (m) => this.castStopped(m.s));
    n.on('queued', (m) => (this.queuedSkill = m.skill));
    onSync('fx', (m) => m.s, (m) => this.onFx(m.s, m.tg, m.skill));
    n.on('cd', (m) => this.cooldowns.set(m.key, { end: performance.now() + m.ms, dur: m.ms }));
    onSync('died', (m) => m.id, (m) => {
      const e = this.ents.get(m.id), now = performance.now();
      if (e) {
        // the fall and its cry as the killing blow lands (deadAge stays below 0 until then)
        e.deadAt = this.deathAt(e, now);
        const vol = this.near(e) * (m.id === this.me.id ? 1.3 : 0.6);
        setTimeout(() => play('death', vol), e.deadAt - now);
      }
      if (m.id === this.me.id) {
        this.castBar = null;
        this.ui.dialogs.death();
      }
    });
    n.on('levelUp', (m) => {
      const e = this.ents.get(m.id);
      if (e) play('levelUp', this.near(e));
      if (e) this.vfx('levelup', e);
      if (m.id === this.me.id) this.ui.hud.banner(m.spec ? tx(`¡Despertaste! ${specName(m.spec, lang)}`, `Awakened! ${specName(m.spec, lang)}`) : tx(`¡Nivel ${m.lvl}!`, `Level ${m.lvl}!`), true);
    });
    n.on('masterwork', (m) => {
      const e = this.ents.get(this.me.id);
      play('levelUp');
      if (e) this.vfx('chest', e);
      this.ui.hud.banner(tx(`¡Obra Maestra! ${itemName(m.item, lang)}`, `Masterwork! ${itemName(m.item, lang)}`), true, 'mw');
    });
    n.on('chat', (m) => {
      const who = this.whoPending && m.ch === 'sys' ? WHO.exec(m.text) : null;
      if (who) return this.fillWho(who[2].split(', '));
      // gains pop up over the character and, like "not ready", stay out of the main chat tab
      const gain = m.ch === 'sys' && settings.s.damageNumbers ? GAIN.exec(m.text) : null;
      if (gain && this.self) this.floatText(this.self, gain[1] ? `+${gain[1]} adena` : `+${gain[2]} XP`, gain[1] ? 'f-gold' : 'f-xp');
      this.ui.chat.add(gain || (m.ch === 'sys' && NOT_READY.test(m.text)) ? 'log' : m.ch, m.from, m.text);
      // what a player says nearby, shouts or tells the party also floats over their head, cut to one line.
      // Party and clan lines only reach their members (server-rs/src/chat.rs, clans.rs), so only they ever see those bubbles.
      if (m.ch === 'all' || m.ch === 'shout' || m.ch === 'party' || m.ch === 'clan' || m.ch === 'ally') {
        const c = [...this.ents.values()].find((e) => e.rec.k === 'p' && e.rec.n === m.from);
        if (c) this.speech(c, m.text, m.ch === 'all' ? 'line' : m.ch);
      }
    });
    n.on('error', (m) => this.sys(m.msg));
    n.on('npc', (m) => this.ui.npc.open(m));
    n.on('admin', (m) => this.ui.admin.set(m));
    n.on('quests', (m) => {
      this.quests = m.list;
      this.questsDone = new Set(m.done);
      this.refreshQuestMarkers();
      this.ui.hud.setQuests(m.list);
      this.ui.npc.syncQuest(m.list);
    });
    n.on('partyInvite', (m) => this.ui.dialogs.invite(m.from));
    n.on('tradeRequest', (m) => this.ui.dialogs.trade(m.from));
    n.on('trade', (m) => this.ui.trade.set(m));
    n.on('tradeEnd', () => this.ui.trade.end());
    n.on('clan', (m) => {
      this.ui.clan.set(m.clan);
      // wars and alliances change how other players' names look
      for (const c of this.ents.values()) if (c.rec.k === 'p') this.refreshLabel(c);
    });
    n.on('clanInvite', (m) => this.ui.dialogs.clanInvite(m.from, m.clan));
    n.on('allyInvite', (m) => this.ui.dialogs.allyInvite(m.from, m.clan, m.ally));
    n.on('clanWh', (m) => this.ui.clanWh.set(m));
    n.on('party', (m) => this.ui.party.set(m.members));
    // moved to another world (raid instance or back): every entity we knew is gone, our id changed
    n.on('world', (m) => this.resetWorld(m));
    // world nodes: spent ones on entering, then every change (render/nodes.ts)
    n.on('nodes', (m) => {
      for (const [id] of m.gone) this.nodes.setGone(id, true);
    });
    n.on('node', (m) => {
      const nd = nodeById(m.id), self = this.self;
      const near = !!nd && !!self && Math.hypot(nd.x - self.pos.x, nd.z - self.pos.z) < 80;
      this.nodes.setGone(m.id, m.ms > 0, near);
      if (nd && near && m.ms > 0) play(nd.kind === 'tree' ? 'treeFall' : nd.kind === 'rock' ? 'mine' : 'rustle', Math.max(0.2, 1 - Math.hypot(nd.x - self!.pos.x, nd.z - self!.pos.z) / 80));
    });
    n.on('gather', (m) => {
      const c = this.ents.get(m.s), nd = nodeById(m.node);
      if (!c || !nd || isRest(nd.kind)) return;
      const g = GATHER[nd.kind];
      c.gather = { node: nd, at: performance.now(), swingMs: g.swingMs, anim: g.anim, strokes: 0 };
      if (m.s === this.me.id) this.castBar = { end: performance.now() + m.ms, dur: m.ms, name: GATHER_LABEL[g.anim]() };
    });
    n.on('teleported', () => {
      this.teleportPending = true;
      this.ui.dialogs.close();
      this.ui.npc.win.hide();
    });
  }

  /**
   * Start over from a fresh state of ourselves: after moving to another world, or after reconnecting
   * (main.ts) without reloading the page. Every entity we knew is gone and our id may have changed.
   */
  resetWorld(m: { self: Extract<S2C, { t: 'enter' }>['self']; inv: Extract<S2C, { t: 'enter' }>['inv'] }) {
    for (const id of [...this.ents.keys()]) this.removeEnt(id);
    this.setTarget(null);
    this.predict = null;
    this.castBar = null;
    this.teleportPending = true;
    this.me = m.self;
    this.inv = m.inv;
    this.adena = m.self.adena;
    this.ui.dialogs.close();
    this.ui.npc.win.hide();
    this.ui.onMe();
    this.ui.onInv();
    this.ui.hud.sendBar(); // a change made while the connection was down
    this.ui.hud.banner(zoneName(m.self.zone, lang));
    ambience(m.self.zone);
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
      // a clan at war with ours (as in L2): crossed swords before the name, orange when the war is mutual
      const war = !self && r.cl ? this.ui.clan.clan?.wars.find((w) => w.id === r.cl) : undefined;
      const mutual = !!war && war.ours && war.theirs;
      const color = c.flags & F_RED ? '#ff4040' : c.flags & F_PURPLE ? '#d080ff' : mutual ? '#ff8a3a' : self ? '#ffffff' : '#7fc4ff';
      el.innerHTML = '';
      el.className = `nameplate np-player${self ? ' np-self' : ''}`;
      // as in L2: the title over the name, the clan's crest before it (and here its name under it)
      if (r.ti) {
        const t = document.createElement('div');
        t.className = 'np-ptitle';
        t.textContent = r.ti;
        el.appendChild(t);
      }
      const n = document.createElement('div');
      n.textContent = self ? r.n : `${r.n} `;
      n.style.color = color;
      if (r.cl && r.cv) n.prepend(crestImg(r.cl, r.cv));
      if (r.ai && r.ac) n.prepend(crestImg(r.ai, r.ac, true));
      if (war) {
        const sw = document.createElement('span');
        sw.className = 'np-war';
        glyph('ui', 'pvp', '', sw);
        if (!mutual) sw.style.opacity = '0.5';
        sw.title = mutual ? tx('Guerra de clanes', 'Clan war') : war.ours ? tx('Le declaramos la guerra', 'We declared war on them') : tx('Nos declararon la guerra', 'They declared war on us');
        n.prepend(sw);
      }
      if (c.flags & F_PVP) {
        const sw = document.createElement('span');
        sw.className = 'np-pvp';
        glyph('ui', 'pvp', '', sw);
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
      if (r.cn) {
        const cn = document.createElement('div');
        cn.className = 'np-clan';
        cn.textContent = r.cn;
        el.appendChild(cn);
      }
      if (!self) this.addHpBar(c);
      this.addStatusIcons(c);
    } else if (r.k === 'm') {
      el.innerHTML = '';
      el.className = 'nameplate np-mob';
      const n = document.createElement('div');
      const elite = MOBS[r.tpl]?.elite;
      n.textContent = `${mobName(r.tpl, lang)} `;
      if (elite) n.prepend(glyph('ui', 'crown'));
      if (this.questTargets().some((t) => t.mobs.has(r.tpl))) {
        const q = glyph('ui', 'quest');
        q.classList.add('np-quest');
        n.prepend(q);
      }
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
      n.textContent = r.n;
      n.prepend(glyph('ui', 'npc'));
      el.append(t, n);
    } else {
      el.textContent = r.item === 'adena' ? `${r.c} Adena` : `${itemName(r.item, lang)}${r.c > 1 ? ` (${r.c})` : ''}`;
      el.classList.add('np-item');
      // a Masterwork dropped by a player
      if (r.m) el.classList.add('mw');
    }
  }

  /** Quests whose hints (star on mobs, areas on the maps) the player switched off, kept per character. */
  untracked = new Set<string>();

  toggleTracked(id: string) {
    if (!this.untracked.delete(id)) this.untracked.add(id);
    try {
      localStorage.setItem(`untracked:${this.me.name}`, JSON.stringify([...this.untracked]));
    } catch {
      /* storage unavailable: lasts for this session */
    }
    this.refreshQuestMarkers();
    this.ui.hud.setQuests(this.quests);
  }

  /** Active, unfinished quests → the mob templates that advance them (for map hints). */
  questTargets(): { quest: string; mobs: Set<string> }[] {
    const out: { quest: string; mobs: Set<string> }[] = [];
    for (const a of this.quests) {
      const q = QUESTS[a.id];
      if (q && a.progress < q.objective.count && !this.untracked.has(a.id)) out.push({ quest: q.name, mobs: new Set(questMobs(q)) });
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
      c.tag.add(obj);
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
    const st = STATUS_IDS.filter((id) => c.flags & STATUSES[id].flag);
    if (!st.length) return;
    const row = document.createElement('div');
    row.className = 'np-status';
    for (const id of st) glyph('status', id, STATUSES[id].icon, row).title = STATUSES[id].name;
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

  /** A player's model again, in place (an armour set it wears came in: render/quaternius.ts loads them when first worn). */
  private remodel(c: CEnt) {
    const r = c.rec;
    if (r.k !== 'p' || !c.rig) return;
    const rig = playerModel(r.race, r.cls, r.w, r.a, r.lk, r.eq ?? [], r.we ?? 0);
    rimLit(rig.root);
    const skels = new Set<THREE.Skeleton>();
    rig.root.traverse((o) => o instanceof THREE.SkinnedMesh && skels.add(o.skeleton));
    for (const sk of skels) {
      const update = sk.update.bind(sk);
      sk.update = () => c.root.matrixWorldAutoUpdate && update();
    }
    c.root.remove(c.model);
    c.rig.dispose?.();
    c.root.add(rig.root);
    c.rig = rig;
    c.model = rig.root;
  }

  private buildEnt(r: EntAdd): CEnt {
    const root = new THREE.Group();
    let rig: Rig | null = null;
    let model: THREE.Object3D;
    let height = 1.2, radius = 0.5;
    if (r.k === 'p') rig = playerModel(r.race, r.cls, r.w, r.a, r.lk, r.eq ?? [], r.we ?? 0);
    else if (r.k === 'm') rig = mobModel(r.tpl);
    else if (r.k === 'n') rig = npcModel(r.npc);
    if (rig) {
      model = rig.root;
      rimLit(rig.root);
      // a skeleton whose bones kept last frame's matrices (frame(): still and not animated) keeps its bone texture too
      const skels = new Set<THREE.Skeleton>();
      rig.root.traverse((o) => o instanceof THREE.SkinnedMesh && skels.add(o.skeleton));
      for (const sk of skels) {
        const update = sk.update.bind(sk);
        sk.update = () => root.matrixWorldAutoUpdate && update();
      }
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
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(hitR, hitR, hitH, 8), HIT_MAT);
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
    const tag = new THREE.Object3D();
    tag.add(obj);
    const c: CEnt = {
      id: r.id, rec: r, rig, root, model, hit, label: obj, labelEl: el, tag, snaps: [], pos: new THREE.Vector3(r.x, heightAt(r.x, r.z), r.z),
      size: model.scale.x, ry: r.ry, hp: r.hp, flags: r.f, atkAt: 0, hitAt: 0, hitDx: 0, hitDz: 0, hpFill: null, deadAt: r.f & F_DEAD ? performance.now() - 5000 : -1, height, radius,
      // already seated when it comes into view: on a seat or on the floor, as it would have sat down
      groundSit: r.f & F_SITTING ? !nodesNear(r.x, r.z, 0.6).some((n) => n.kind === 'seat') : undefined,
    };
    if (r.f & F_SITTING) this.enterTent(c, r.x, r.z);
    this.refreshLabel(c);
    this.refreshQuestMarker(c);
    return c;
  }

  /** Sat down at a tent's door: in it, as everyone sees it (the server keeps the body at the door). */
  private enterTent(c: CEnt, x: number, z: number) {
    const n = nodesNear(x, z, 0.6).find((nd) => nd.kind === 'tent');
    if (!n || c.tent) return;
    const t = layoutZoneProps().tents[nodeIndex(n)], mid = tentCentre(n), y = heightAt(mid.x, mid.z);
    const door = tentDoorClosed(t);
    this.entLayer.add(door);
    const el = document.createElement('div');
    el.className = 'rest-zzz';
    for (const ch of 'zzZ') el.appendChild(document.createElement('span')).textContent = ch;
    const zzz = new CSS2DObject(el);
    zzz.position.set(mid.x, y + 3.9, mid.z);
    this.labelLayer.add(zzz);
    c.tent = { door, zzz, top: new THREE.Vector3(mid.x, y + 0.6, mid.z) }; // the plate rides its usual height above this
    c.model.visible = false;
    // the tent stands for the body: clicking it picks whoever rests inside
    c.hit.position.set(mid.x - n.x, c.hit.position.y, mid.z - n.z);
    c.hit.scale.set(3, 1.2, 3);
  }

  /** Out of the tent again (got up, or left view): the body back at the door, the door rolled up. */
  private leaveTent(c: CEnt) {
    if (!c.tent) return;
    this.entLayer.remove(c.tent.door);
    c.tent.door.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
    this.labelLayer.remove(c.tent.zzz);
    c.tent.zzz.element.remove();
    c.tent = undefined;
    c.model.visible = true;
    c.hit.position.set(0, c.hit.position.y, 0);
    c.hit.scale.set(1, 1, 1);
  }

  /** A body drawn faded (vanished) or as itself again: its own materials swapped for see-through copies, then back. */
  private ghost(c: CEnt, on: boolean) {
    if (!!c.ghost === on) return;
    if (on) {
      const own = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      // clone() leaves the shader patches behind (dye, rim, gear shine): they come along. A solid surface's map may
      // carry something else in its alpha (the gear's shine): that was never coverage, so the fade alone sets it
      const fade = (m: THREE.Material) => {
        const f = m.clone(), solid = !m.transparent, prev = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey();
        f.transparent = true;
        f.opacity = 0.28 * m.opacity;
        f.depthWrite = false;
        f.onBeforeCompile = (sh, r) => {
          prev(sh, r);
          if (solid) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.a = opacity;');
        };
        f.customProgramCacheKey = () => `${key}|ghost${+solid}`;
        return f;
      };
      c.model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        own.set(o, o.material);
        o.material = Array.isArray(o.material) ? o.material.map(fade) : fade(o.material);
      });
      c.ghost = own;
    } else {
      for (const [o, m] of c.ghost!) {
        for (const f of Array.isArray(o.material) ? o.material : [o.material]) f.dispose();
        o.material = m;
      }
      c.ghost = undefined;
    }
  }

  private removeEnt(id: number) {
    const c = this.ents.get(id);
    if (!c) return;
    this.ghost(c, false);
    this.leaveTent(c);
    this.entLayer.remove(c.root);
    this.labelLayer.remove(c.tag);
    c.label.element.remove();
    // the label layer never drops elements on its own: without this an NPC that leaves view left its quest mark stuck on screen
    c.marker?.el.remove();
    c.bubble?.remove();
    // part geometries are shared (see models.ts); baked limb meshes and the hitbox are per-entity
    c.hit.geometry.dispose();
    c.rig?.dispose?.();
    c.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.baked) o.geometry.dispose();
    });
    this.hitboxes = this.hitboxes.filter((h) => h !== c.hit);
    this.ents.delete(id);
  }

  /**
   * Server time -> local time. The offset tracks the fastest packet seen (least queueing); how much
   * later the others arrive is the jitter, which sets how far in the past we draw other entities.
   */
  private clockOff: number | null = null;
  private jitter = 0;
  interpDelay = INTERP_BASE + 10;
  private serverToLocal(st: number | undefined): number {
    const arrival = performance.now();
    if (st === undefined) return arrival;
    const d = arrival - st;
    if (this.clockOff === null || Math.abs(d - this.clockOff) > 5000) this.clockOff = d; // first packet, clock wrap, world switch
    else if (d < this.clockOff) this.clockOff = d;
    else this.clockOff += (d - this.clockOff) * 0.002; // follow slow clock drift
    this.jitter = this.jitter * 0.97 + (d - this.clockOff) * 0.03;
    const want = Math.min(INTERP_MAX, INTERP_BASE + this.jitter * 2); // bursty links get up to 200 ms of cushion
    this.interpDelay += (want - this.interpDelay) * 0.05;
    return st + this.clockOff;
  }

  private pushSnap(c: CEnt, x: number, z: number, ry: number, now: number) {
    const last = c.snaps[c.snaps.length - 1];
    const isSelf = c.id === this.me.id;
    if ((isSelf && this.teleportPending) || (last && Math.hypot(last.x - x, last.z - z) > 25)) {
      c.snaps = [];
      if (isSelf) {
        this.teleportPending = false;
        this.predict = null;
        this.selfHist.length = 0;
        c.pos.set(x, heightAt(x, z), z);
        this.cam.snap(c.pos);
      }
    } else if (last && now - last.t > 160) {
      // entity was idle (unchanged entities aren't sent): re-anchor its previous position one tick ago
      c.snaps.push({ t: now - 50, x: last.x, z: last.z, ry: last.ry });
    }
    if (c.snaps.length && now <= c.snaps[c.snaps.length - 1].t) return; // duplicate / reordered
    c.snaps.push({ t: now, x, z, ry });
    if (c.snaps.length > 12) c.snaps.splice(0, c.snaps.length - 12);
  }

  private onSnap(add: EntAdd[], upd: EntUpd[], gone: number[], st?: number) {
    const t = this.serverToLocal(st);
    for (const r of add) {
      const old = this.ents.get(r.id);
      let snaps: Snap[] = [];
      let atkAt = 0, atkStep: number | undefined, atkInterval: number | undefined, atkTarget: number | undefined, invisUntil: number | undefined;
      if (old) {
        snaps = old.snaps;
        ({ atkAt, atkStep, atkInterval, atkTarget, invisUntil } = old);
        this.removeEnt(r.id);
      }
      const c = this.buildEnt(r);
      c.snaps = snaps;
      Object.assign(c, { atkAt, atkStep, atkInterval, atkTarget, invisUntil });
      if (old) c.pos.copy(old.pos);
      this.ents.set(r.id, c);
      this.entLayer.add(c.root);
      this.labelLayer.add(c.tag);
      this.hitboxes.push(c.hit);
      this.pushSnap(c, r.x, r.z, r.ry, t);
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
      if (c.id === this.me.id && (c.flags & F_CASTING) && !(f & F_CASTING)) this.dropPredictedCooldowns();
      // sitting down / getting up: timestamps drive the sit and get-up clips
      if (f & F_SITTING && !(c.flags & F_SITTING)) {
        c.sitAt = performance.now();
        c.groundSit = !nodesNear(c.pos.x, c.pos.z, 0.6).some((n) => n.kind === 'seat');
        this.enterTent(c, x, z);
        // the walk to the seat is over: left in place it would read as a request to get up again
        if (c.id === this.me.id) this.predict = null;
      }
      // our own get-up already started on the click (updateSelf): don't restart it when the server agrees
      if (!(f & F_SITTING) && c.flags & F_SITTING && !isStanding(c)) c.standAt = performance.now();
      if (!(f & F_SITTING)) this.leaveTent(c);
      if (!(f & F_GATHER) && c.flags & F_GATHER) {
        c.gather = undefined;
        if (c.id === this.me.id && this.castBar && Object.values(GATHER_LABEL).some((l) => l() === this.castBar!.name)) this.castBar = null;
      }
      const hpChanged = c.hp !== hp;
      c.hp = hp;
      if (c.flags & F_CASTING && !(f & F_CASTING)) c.castEndAt = performance.now();
      c.flags = f;
      c.rec.hp = hp;
      if (hpChanged || wasDead !== ((f & F_DEAD) !== 0)) this.updateHpBar(c);
      if (wasDead && !(f & F_DEAD)) c.deadAt = -1;
      if (!wasDead && f & F_DEAD && c.deadAt < 0) c.deadAt = this.deathAt(c);
      if (colorChanged) this.refreshLabel(c);
      this.pushSnap(c, x, z, ry, t);
    }
    for (const id of gone) {
      if (id === this.targetId) this.setTarget(null);
      this.removeEnt(id);
    }
    if (add.length) this.ui.onTargetChanged();
  }

  /**
   * Speech bubble above an entity's head for a few seconds. NPCs say it all; a player's chat ('line', 'shout' or
   * 'party') keeps to one line: the start of it, cut at a word, the full message stays in the chat window.
   */
  speech(c: CEnt, text: string, style?: 'line' | 'shout' | 'party' | 'clan' | 'ally') {
    c.bubble?.remove();
    if (c.bubbleObj) c.tag.remove(c.bubbleObj);
    const el = document.createElement('div');
    el.className = style ? `speech one-line${style === 'line' ? '' : ` ${style}`}` : 'speech';
    // a one-line bubble clips its text in an inner span: clipping the bubble itself would cut off its tail
    if (style) el.appendChild(document.createElement('span')).textContent = oneLine(text);
    else el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(0, c.height + 1.35, 0);
    c.tag.add(obj);
    c.bubble = el;
    c.bubbleObj = obj;
    setTimeout(() => {
      c.tag.remove(obj);
      el.remove();
      if (c.bubble === el) (c.bubble = null), (c.bubbleObj = null);
    }, 6000);
  }

  private floatText(c: CEnt, text: string, cls: string) {
    if (!settings.s.damageNumbers) return;
    // the label layer positions `el` with its own transform, so the animation lives on a child
    const el = document.createElement('div'), num = el.appendChild(document.createElement('div'));
    num.className = `floater ${cls}`;
    num.textContent = text;
    // bigger numbers are bigger: 15px for one digit up to 24px for four or more
    num.style.setProperty('--fs', `${12 + 3 * Math.min(4, (/\d+/.exec(text)?.[0].length ?? 1))}px`);
    num.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 70)}px`);
    const obj = new CSS2DObject(el);
    obj.position.set((Math.random() - 0.5) * 0.6, c.height + 0.2, 0);
    c.tag.add(obj);
    setTimeout(() => {
      c.tag.remove(obj);
      el.remove();
    }, 1250);
  }

  /** 0..1 loudness for something happening at c (fades out by ~45 m). */
  near(c: CEnt): number {
    const self = this.self;
    if (!self || c === self) return 1;
    return Math.max(0, 1 - c.pos.distanceTo(self.pos) / 45);
  }

  /** What a player, mob or NPC is called (as its nameplate says). */
  private nameOf(c: CEnt): string {
    return c.rec.k === 'm' ? mobName(c.rec.tpl, lang) : c.rec.k === 'p' || c.rec.k === 'n' ? c.rec.n : '';
  }

  /** Esc (or a tap on the cast bar): our cast stops here at once and on the server, its MP and cooldown spent all the same. */
  cancelCast() {
    if (!this.castBar?.skill) return;
    this.net.send({ t: 'cancel' });
    this.castStopped(this.me.id);
  }

  /** A cast (or a mob's special attack) stopped before it went off: its bar, sparkles, casting pose, warning and slam go. */
  private castStopped(id: number) {
    this.fx.end(this.castFx.get(id));
    this.castFx.delete(id);
    const tele = this.teles.get(id);
    if (tele) {
      this.fx.end(tele.fx);
      clearTimeout(tele.timer);
      this.teles.delete(id);
    }
    const c = this.ents.get(id);
    if (c) (c.flags &= ~F_CASTING), (c.castSkill = undefined); // the next snapshot agrees: the server dropped the cast
    if (id === this.me.id) {
      if (this.castBar?.skill) this.castBar = null;
      this.queuedSkill = null;
    }
  }

  /** others' footsteps heard in the last 150 ms: a few at a time, or a crowd in town drowns everything */
  private stepsHeard = { at: 0, n: 0 };
  /**
   * The footsteps of `landed` feet that just met the ground in c's walk or run (render/footfalls.ts, through animate),
   * on the ground under it (render/scene.ts footingAt). Ours always; others' within 15 m, quieter.
   */
  private footfall(c: CEnt, isSelf: boolean, now: number, landed: number) {
    if (!landed || (c.rollAt && now - c.rollAt < ROLL_MS) || isDeep(c.pos.x, c.pos.z)) return;
    const size = c.height / 1.8, rate = Math.min(1.3, Math.max(0.6, 1 / Math.sqrt(size))); // big bodies land lower
    if (isSelf) return step(footingAt(c.pos.x, c.pos.z), 1, rate);
    const self = this.self, heard = this.stepsHeard;
    if (!self || c.pos.distanceTo(self.pos) > 15) return;
    if (now - heard.at > 150) (heard.at = now), (heard.n = 0);
    if (heard.n >= 4) return;
    heard.n++;
    step(footingAt(c.pos.x, c.pos.z), this.near(c) * 0.35 * Math.min(1.6, Math.max(0.7, size)), rate);
  }

  private stormSec = 0;
  /**
   * Lightning in a downpour (render/atmos.ts stormStrikes: the same strikes for everyone nearby): the sky flashes,
   * the bolt shows when it falls within sight, and the thunder follows by the time its sound takes to arrive.
   */
  private storms(p: THREE.Vector3) {
    const sec = Math.floor(Date.now() / 1000);
    if (sec === this.stormSec) return;
    this.stormSec = sec;
    if (indoors()) return;
    for (const s of stormStrikes(p.x, p.z, sec)) {
      const dist = Math.hypot(s.x - p.x, s.z - p.z), g = heightAt(s.x, s.z);
      this.world.flashSky(Math.max(0.15, 1 - dist / 700));
      if (dist < this.camera.far * 0.9) this.fx.bolt(new THREE.Vector3(s.x, g + 90, s.z), new THREE.Vector3(s.x, g, s.z), 0xcfe0ff, 260);
      thunder(dist);
    }
  }

  /** Brief white flash on a model when it takes a hit. */
  private flash(c: CEnt) {
    const meshes: THREE.Mesh[] = [];
    c.model.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.flashing) meshes.push(o);
    });
    for (const m of meshes) {
      m.userData.flashing = m.material;
      m.material = flashMat(m);
    }
    setTimeout(() => {
      for (const m of meshes) {
        m.material = m.userData.flashing;
        delete m.userData.flashing;
      }
    }, 70);
  }

  private onDmg(m: Extract<S2C, { t: 'dmg' }>) {
    // a player's melee blow (the basic attack's or a skill's) is shown as it lands, not as the swing starts: the server
    // sends the swing and its damage in the same tick
    const src = this.ents.get(m.s), ms = src && !m.dot && !m.heal ? this.impactMs(src) : undefined;
    const wait = ms !== undefined ? ms - (performance.now() - src!.atkAt) : 0;
    if (wait > 15 && wait < 1500) return void setTimeout(() => this.showDmg(m), wait);
    this.showDmg(m);
  }
  private showDmg(m: Extract<S2C, { t: 'dmg' }>) {
    const t = this.ents.get(m.tg);
    if (!t) return;
    const mine = m.tg === this.me.id, byMe = m.s === this.me.id;
    const vol = mine || byMe ? 1 : this.near(t) * 0.45;
    if (m.miss) {
      play('miss', vol);
      return this.floatText(t, tx('Falló', 'Miss'), 'f-miss');
    }
    if (m.res) {
      play('miss', vol);
      return this.floatText(t, tx('Resistió', 'Resisted'), 'f-miss');
    }
    if (m.heal) {
      play('heal', vol * 0.8);
      return this.floatText(t, `+${m.v}`, 'f-heal');
    }
    this.ui.party.hit(m.s, m.v);
    if (m.dot) {
      play('dot', vol * 0.6);
      return this.floatText(t, String(m.v), 'f-dot');
    }
    // what hits us, in the System tab (Options: off). Bleed and poison ticks returned above: they would flood it
    if (mine && settings.s.dmgLog) {
      const by = this.ents.get(m.s), who = by ? this.nameOf(by) : tx('Algo', 'Something'), crit = m.crit ? tx(' (crítico)', ' (critical)') : '';
      const blk = m.blk ? tx(' (bloqueado)', ' (blocked)') : '';
      this.ui.chat.add('log', '', tx(`${who} te pegó por ${m.v}${crit}${blk}`, `${who} hit you for ${m.v}${crit}${blk}`));
    }
    if (m.blk) this.floatText(t, tx('¡Bloqueó!', 'Blocked!'), 'f-block'); // caught on the shield: half the damage
    let sfx: Sfx = mine ? 'hurt' : m.crit ? 'crit' : 'hit';
    if (!mine && this.ents.get(m.s)?.rec.k === 'p' && (this.ents.get(m.s)!.rec as { cls?: string }).cls === 'mystic') sfx = 'magic';
    play(sfx, vol);
    this.flash(t);
    // hit-stop: freeze the action for a beat on big hits that involve you
    const src = this.ents.get(m.s);
    // hit-stop on the two rigs involved (not the world): a short pause in their pose sells a big hit
    if (m.crit && (mine || byMe)) {
      const until = performance.now() + 50;
      t.hitStop = until;
      if (src) src.hitStop = until;
    }
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
    if (m.crit && src && src !== t) this.vfx('crit', src, t);
    else if (!mine) this.vfx('hit', src ?? t, t);
  }

  /** One of the shared non-skill effects (skill-fx.ts GENERIC_VFX): hits, crits, level-up, chests, potions, dodges. */
  private vfx(id: string, s: CEnt, t: CEnt = s) {
    GENERIC_VFX[id]({ f: this.fx, s, t, color: 0xffffff, aoe: 6 });
  }

  /** A player's weapon kind when it fights hand to hand with it (a blade, an axe, a hammer, a spear, a dagger, a pair): none
   * for a bow, a staff or wand, or bare hands. */
  /** The animation a skill plays (render/quaternius.ts SKILL_ANIM): its own, or the bow's draw and loose for a bow's shot. */
  private skillAnim(skill: string | undefined) {
    const def = skill ? SKILLS[skill] : undefined;
    return def ? skillAnimOf(skill, def.weapon === 'bow' && def.kind === 'phys' ? 'bow' : undefined) : undefined;
  }
  private meleeWeapon(c: CEnt) {
    const wt = c.rec.k === 'p' && c.rec.w ? ITEMS[c.rec.w]?.weaponType : undefined;
    return wt && wt !== 'bow' && wt !== 'staff' ? wt : undefined;
  }
  /** The blow a player's body is swinging (render/swings.ts) and its timing; none for a bow, a mob or a plain rig. */
  private swingNow(c: CEnt) {
    const kind = c.rig?.q?.swing;
    if (!kind) return undefined;
    return swingTiming(swingOf(kind, c.atkStep ?? 0, c.atkStab), c.atkInterval);
  }
  /** How long after c.atkAt its blow lands (ms): a skill's own blow, or the basic attack's; none for a spell or a shot. */
  private impactMs(c: CEnt) {
    return c.atkAnim ? skillImpactMs(c.atkAnim) : this.swingNow(c)?.impactMs;
  }
  /** A basic attack's swing begins: the next blow of the chain if it follows the last closely, else the first; the
   * swish of the blade just before it lands. */
  private startSwing(c: CEnt, now = performance.now(), target?: number) {
    const gap = now - c.atkAt;
    c.atkTarget = target;
    c.atkStep = gap < CHAIN_MS ? (c.atkStep ?? -1) + 1 : 0;
    if (c === this.self) c.atkInterval = 60000 / Math.max(1, this.me.atkSpd);
    else if (gap > 250 && gap < 2500) c.atkInterval = gap;
    c.atkAt = now;
    c.atkStab = undefined;
    c.atkAnim = undefined;
    c.invisUntil = 0; // a blow ends a Vanish (the server's 'reveal' says so too)
    const t = this.swingNow(c), vol = this.near(c) * (c === this.self ? 0.22 : 0.16);
    if (t && vol > 0.01) setTimeout(() => play('miss', vol), Math.max(0, t.impactMs - 60));
  }
  /** When a body's death shows: now, or as the blow that killed it lands (a melee swing at it still on its way). */
  private deathAt(e: CEnt, now = performance.now()) {
    for (const c of this.ents.values()) {
      if (c.atkTarget !== e.id) continue;
      const ms = this.impactMs(c), land = ms !== undefined ? c.atkAt + ms : 0;
      if (land > now && land - now < 1500) return land;
    }
    return now;
  }
  /** What a body does with its weapon while it casts (render/quaternius.ts animateQ): a melee fighter readies it for a
   * physical skill's blow, and raises it for a fighter's buff or taunt; anything else (a spell) is cast with the free hand. */
  private castMove(c: CEnt): 'strike' | 'raise' | 'dance' | undefined {
    const def = c.castSkill ? SKILLS[c.castSkill] : undefined;
    if (def?.tune === 'dance') return 'dance'; // a bladedancer dances its dances
    if (!def || !this.meleeWeapon(c)) return undefined;
    if (def.kind === 'phys') return 'strike';
    return (def.kind === 'buff' || def.kind === 'taunt') && c.rec.k === 'p' && c.rec.cls === 'fighter' ? 'raise' : undefined;
  }

  /** Whether this body holds a bow (a player's bow item, or an archer mob). */
  private holdsBow(c: CEnt) {
    return c.rec.k === 'p' ? !!c.rec.w && ITEMS[c.rec.w]?.weaponType === 'bow' : false;
  }
  /** Where an arrow leaves: the bow hand, about shoulder height in front of the body. */
  private bowHand(c: CEnt) {
    return c.pos.clone().add(new THREE.Vector3(Math.sin(c.ry) * 0.6, c.height * 0.82, Math.cos(c.ry) * 0.6));
  }

  private onFx(sId: number, tId: number, skill: string) {
    const s = this.ents.get(sId), t = this.ents.get(tId);
    if (!s) return;
    const chest = (e: CEnt) => e.pos.clone().setY(e.pos.y + e.height * 0.6);
    // out of a Vanish (it attacked or cast): seen again (others get it back with the next snapshot)
    if (skill === 'reveal') return void (s.invisUntil = 0);
    if (skill === 'vanish') s.invisUntil = performance.now() + (SKILLS.vanish?.buff?.dur ?? 8000);
    if (skill === 'potion') return this.vfx('potion', s);
    if (skill === 'chest') {
      play('coin');
      return this.vfx('chest', s);
    }
    if (skill === 'dash') {
      if (s !== this.self || !s.rollAt || performance.now() - s.rollAt > ROLL_MS) {
        play('dash', this.near(s));
        s.rollAt = performance.now();
      }
      this.vfx('dash', s);
      if (settings.s.particles) this.fx.dust(s.pos.clone(), 600);
      return;
    }
    if (skill === 'escape') return this.vfx('escape', s);
    if (skill === 'charge') return this.vfx('charge', s); // a pair of swords' hit gathered a Force charge
    if (skill === 'dance') return void (s.danceUntil = performance.now() + 10000); // /dance: until they move, fight or it runs out
    const def = SKILLS[skill];
    if (def) s.castSkill = undefined;
    // a skill with its own animation plays its blow from where its cast held it (SKILL_ANIM: the dagger's, the shield's,
    // the bow's); any other melee skill lands with a blow, already wound up by the cast: a dagger stabs, the rest cut
    const anim = def ? this.skillAnim(skill) : undefined;
    if (anim && skillStrikes(anim)) (s.atkAnim = anim), (s.atkStab = undefined), (s.atkAt = performance.now());
    else if (def && def.kind === 'phys' && this.meleeWeapon(s)) {
      // the weapon's first blow, on from the wind-up the cast held it at (render/quaternius.ts), so it lands now
      s.atkStab = this.meleeWeapon(s) === 'dagger';
      s.atkAnim = undefined;
      s.atkStep = 0;
      s.atkTarget = t?.id;
      const kind = s.rig?.q?.swing, sw = kind ? swingOf(kind, 0, true) : undefined;
      s.atkAt = performance.now() - (sw ? (windup(sw) / swingTiming(sw, s.atkInterval).speed) * 1000 : 140);
    }
    if (!def || !t) return;
    // the archer's skills: arrows, loosed as the shot goes (the draw was held through the cast)
    if (def.weapon === 'bow' && def.kind === 'phys') {
      if (!anim) s.atkAt = performance.now() - 330; // the loose (aimBow), not the draw again
      const hit = () => t.pos.clone().setY(t.pos.y + t.height * 0.55);
      const fire = skill === 'fire_arrow', poison = def.status?.id === 'poison';
      const tint = fire ? 0xff7a1a : poison ? 0x7ac83a : def.color;
      this.fx.arrow(this.bowHand(s), hit, { delay: 60, fire, color: tint, onHit: () => {
        this.fx.burst(hit(), tint, def.aoe ? 1.2 : 0.8, 380);
        if (def.aoe) this.fx.ring(t.pos.clone(), tint, def.aoe, 550);
      } });
      // a volley: more arrows falling on the area round the target
      if (def.aoe) for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * def.aoe * 0.8;
        const spot = t.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        this.fx.arrow(spot.clone().setY(spot.y + 9), () => spot, { delay: 200 + i * 60, fire, color: tint, onHit: () => this.fx.burst(spot, tint, 0.5, 260) });
      }
      return;
    }
    const vfx = SKILL_VFX[skill];
    if (vfx) return vfx({ f: this.fx, s, t, color: def.color, aoe: def.aoe ?? 6 });
    // fallback for a skill without its own signature (skill-fx.ts): generic by kind
    switch (def.kind) {
      case 'magic':
        this.fx.projectile(chest(s), () => chest(t), def.color, 280, 0.3);
        setTimeout(() => {
          this.fx.burst(chest(t), def.color, def.aoe ? def.aoe * 0.6 : 0.9, 450);
          if (def.aoe) this.fx.ring(t.pos.clone(), def.color, def.aoe, 500);
        }, 280);
        break;
      case 'drain':
        this.fx.projectile(chest(t), () => chest(s), def.color, 400, 0.25);
        break;
      case 'taunt':
        this.fx.ring(t.pos.clone(), def.color, def.aoe ?? 6, 500);
        play('warn', this.near(s) * 0.6);
        break;
      case 'phys':
        this.fx.slash(chest(t), chest(s), def.color, 1.4);
        this.fx.burst(chest(t), def.color, 0.9, 350);
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

  interact(c: CEnt) {
    const r = c.rec;
    if (r.k === 'i') return this.serverAction({ t: 'pickup', id: r.id });
    if (r.k === 'n') {
      this.setTarget(r.id);
      return this.serverAction({ t: 'talk', id: r.id });
    }
    this.setTarget(r.id);
  }

  /**
   * The world node under the cursor: the nearest one (along the ray) whose upright axis passes close to it.
   * No raycast against the thousands of tree instances: candidates come from the spatial hash around the
   * ground point, which covers a canopy hiding the ground behind it.
   */
  private pickNode(ray: THREE.Ray, ground: THREE.Vector3): NodeDef | null {
    let best: NodeDef | null = null, bestT = Infinity;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), onRay = new THREE.Vector3();
    for (const n of nodesNear(ground.x, ground.z, 9)) {
      if (!isRest(n.kind) && this.nodes.isGone(n.id)) continue;
      // a tent is picked by its body, not its door
      const at = n.kind === 'tent' ? tentCentre(n) : n, y = heightAt(at.x, at.z);
      a.set(at.x, y, at.z);
      // a tree by its trunk: this low camera's rays cross the crowns on their way to the ground behind them, and a
      // click there means walking there, not felling the tree
      b.set(at.x, y + nodeHeight(n) * (n.kind === 'tree' ? 0.45 : 1), at.z);
      const r = n.kind === 'tree' ? Math.max(0.6, n.r + 0.35) : n.kind === 'rock' ? n.r + 0.25 : n.kind === 'tent' ? 2.2 : 0.65;
      if (ray.distanceSqToSegment(a, b, onRay) > r * r) continue;
      const t = onRay.distanceTo(ray.origin);
      if (t < bestT) (bestT = t), (best = n);
    }
    return best;
  }

  /** Fell, mine, pick or sit: the server walks there and does it; we walk there right away too. */
  useNode(n: NodeDef) {
    const self = this.self;
    if (!self || self.flags & F_DEAD) return;
    this.route.length = 0;
    this.dropPredictedCooldowns();
    this.net.send({ t: 'interact', node: n.id });
    const reach = reachOf(n), dx = self.pos.x - n.x, dz = self.pos.z - n.z, d = Math.hypot(dx, dz) || 1;
    if (d <= reach) return void (this.predict = null);
    // stop at the edge of reach on our side of it, like the server does
    const k = isRest(n.kind) ? 0 : reach * 0.9;
    const path = findPath(self.pos.x, self.pos.z, n.x + (dx / d) * k, n.z + (dz / d) * k);
    const end = path[path.length - 1];
    this.predict = { x: end.x, z: end.z, arrivedAt: 0, path };
  }

  isHostile(c: CEnt): boolean {
    if (c.flags & F_DEAD) return false;
    if (c.rec.k === 'm') return true;
    if (c.rec.k !== 'p' || c.id === this.me.id) return false;
    if (c.flags & F_RED) return this.me.pvpOn;
    return this.me.pvpOn && (c.flags & F_PVP) !== 0 && (c.flags & F_PURPLE) !== 0;
  }

  /** Start walking toward entity t locally until within range (the server does the same walk). */
  private predictChase(t: CEnt, range: number) {
    const self = this.self;
    if (!self || self.flags & (F_DEAD | F_CASTING) || self.roll) return;
    if (self.pos.distanceTo(t.pos) <= range) return;
    this.predict = { x: t.pos.x, z: t.pos.z, arrivedAt: 0, path: findPath(self.pos.x, self.pos.z, t.pos.x, t.pos.z), chase: { id: t.id, range, repathAt: performance.now() + 400 } };
  }

  /** Action whose movement the server drives: drop local prediction. */
  private serverAction(m: Parameters<Net['send']>[0]) {
    this.route.length = 0;
    this.predict = null;
    // walking up to whatever we interact with: predict it like a click-move (the server walks the same way)
    if (m.t === 'attack' || m.t === 'pickup' || m.t === 'talk') {
      const t = this.ents.get(m.id);
      if (t) this.predictChase(t, m.t === 'attack' ? this.reach() + t.radius - 0.3 : m.t === 'pickup' ? 1.2 : 2.5);
    } else if (m.t === 'skill') {
      const def = SKILLS[m.skill], t = this.targetId !== null ? this.ents.get(this.targetId) : undefined;
      if (def && t && def.target === 'enemy' && this.isHostile(t)) this.predictChase(t, Math.max(0.5, def.range + t.radius - 0.4));
    }
    this.net.send(m);
  }

  /** Walk to a point on the world map; `append` queues it after the stops already set. */
  travel(x: number, z: number, append: boolean) {
    if (!append) this.route.length = 0;
    const idle = !this.route.length;
    // a long trip goes in legs: every search (here and on the server) stays short
    const self = this.self, from = this.route[this.route.length - 1] ?? (self ? { x: self.pos.x, z: self.pos.z } : { x, z });
    for (const p of tripLegs(from.x, from.z, x, z)) this.route.push({ ...p, leg: true });
    this.route.push({ x, z });
    if (idle) {
      this.routeRetried = false;
      this.walkRoute();
    }
  }

  private walkRoute() {
    const wp = this.route[0];
    this.routeMovedAt = performance.now();
    this.moveTo(new THREE.Vector3(wp.x, heightAt(wp.x, wp.z), wp.z), false, true);
  }

  /** The walk ahead as points, from where we stand through every stop (drawn on the maps). */
  routePath(): { x: number; z: number }[] {
    const self = this.self;
    if (!self || !this.route.length) return [];
    const out = [{ x: self.pos.x, z: self.pos.z }];
    for (const wp of this.route) out.push(...findPath(out[out.length - 1].x, out[out.length - 1].z, wp.x, wp.z));
    return out;
  }

  moveTo(p: THREE.Vector3, marker: boolean, route = false) {
    const self = this.self;
    if (!self || self.flags & F_DEAD) return;
    if (!route) this.route.length = 0; // any other move replaces the map route
    // the route goes with the move: the server walks the same one (server-rs World::client_path), instead of planning
    // its own from a step or two behind and going round the other side of a tree
    const path = findPath(self.pos.x, self.pos.z, p.x, p.z);
    const send = () => this.net.send({ t: 'move', x: p.x, z: p.z, ...(path.length <= 64 && { path }) });
    // a cast goes on (the server walks there once it ends): no walking ahead of it here, nor dropping its bar
    if (this.castBar?.skill) return void send();
    this.dropPredictedCooldowns();
    send();
    const end = path[path.length - 1];
    this.predict = { x: end.x, z: end.z, arrivedAt: 0, path };
    if (marker) {
      // where the walk really ends: the click, or the spot beside what is in the way (a house, a rock) it stops at
      const at = end.x === p.x && end.z === p.z;
      this.clickMarker.position.set(end.x, (at ? p.y : heightAt(end.x, end.z)) + 0.08, end.z);
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

  /** How far our auto-attack reaches: a bow's range, or arm's length (server-rs player.rs). */
  private reach() {
    const w = this.inv.find((i) => i.s === 'weapon');
    return w && ITEMS[w.i]?.weaponType === 'bow' ? BOW_RANGE : MELEE_RANGE;
  }

  attackTarget() {
    const cur = this.targetId !== null ? this.ents.get(this.targetId) : undefined;
    if (!cur || cur.flags & F_DEAD || (cur.rec.k !== 'n' && cur.rec.k !== 'i' && !this.isHostile(cur) && !this.ctrl)) {
      if (!settings.s.autoTarget) return this.sys(tx('No tenés un enemigo seleccionado.', 'You have no enemy selected.'));
      this.ensureEnemyTarget();
    }
    if (this.targetId === null) return;
    const c = this.ents.get(this.targetId);
    if (!c || c.rec.k === 'i') return;
    if (c.rec.k === 'n') return this.serverAction({ t: 'talk', id: c.id });
    // prediction: already in reach and the swing timer is ready -> start the swing on the click
    const self = this.self, now = performance.now();
    const interval = 60000 / Math.max(1, this.me.atkSpd);
    if (self && !(self.flags & (F_DEAD | F_CASTING)) && now - self.atkAt > interval && self.pos.distanceTo(c.pos) <= this.reach() + c.radius - 0.2 && (this.isHostile(c) || this.ctrl)) {
      // the swing starts on the click; the hit (its sound and number) comes with the server's 'dmg', as the blow lands
      this.startSwing(self, now, c.id);
      this.predictedSwing = now;
      const dx = c.pos.x - self.pos.x, dz = c.pos.z - self.pos.z;
      self.ry = Math.atan2(dx, dz);
    }
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
    // Not ready (cooling down, stunned, already rolling): do nothing at all. Asking the server anyway
    // dropped our movement prediction, so a Shift press on cooldown made the character jump back.
    if ((this.cooldowns.get('dash')?.end ?? 0) > now || self.flags & STATUSES.stun.flag || self.roll) return;
    // predict the roll locally so it starts on the key press, not a round-trip later
    const end = dashEnd(self.pos.x, self.pos.z, dx, dz);
    self.rollAt = now;
    self.roll = { fx: self.pos.x, fz: self.pos.z, tx: end.x, tz: end.z, ry: Math.atan2(dx, dz), at: now };
    play('dash');
    if (settings.s.particles) this.fx.dust(self.pos.clone(), 600);
    this.dropPredictedCooldowns();
    // Keep the click-to-move. serverAction would drop it, and the walk would die on the roll.
    this.net.send({ t: 'dash', x: self.roll.fx, z: self.roll.fz, dx, dz });
  }

  /** Stand still: drop the current move and stop attacking (the target stays selected). */
  stop() {
    this.route.length = 0;
    this.predict = null;
    this.clickMarker.visible = false;
    this.net.send({ t: 'stop' });
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

  // ponytail: the list comes from the /who chat command, so it only has names (level and class are filled in
  // for players in view) and only this world's players; a real roster needs its own server message
  private whoEl: HTMLDivElement | null = null;
  private whoPending = false;

  private showWho(on: boolean) {
    if (!this.whoEl) {
      this.whoEl = document.createElement('div');
      this.whoEl.className = 'panel who';
      this.ui.root.appendChild(this.whoEl);
    }
    this.whoEl.style.display = on ? 'block' : 'none';
    if (!on) return;
    this.whoPending = true;
    this.net.send({ t: 'chat', text: '/who' });
  }

  private fillWho(names: string[]) {
    this.whoPending = false;
    const box = this.whoEl!, party = new Set(this.ui.party.members?.map((m) => m.name));
    const seen = new Map([...this.ents.values()].flatMap((c) => (c.rec.k === 'p' ? [[c.rec.n, c.rec] as const] : [])));
    box.textContent = '';
    const head = box.appendChild(document.createElement('div'));
    head.className = 'who-head';
    head.textContent = tx(`Jugadores conectados (${names.length})`, `Players online (${names.length})`);
    const list = box.appendChild(document.createElement('div'));
    list.className = 'who-list';
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const row = list.appendChild(document.createElement('div')), r = seen.get(name);
      row.className = name === this.me.name ? 'who-me' : party.has(name) ? 'who-mate' : '';
      row.textContent = r ? `${name} · ${tx('Nv', 'Lv')} ${r.l}` : name;
    }
  }

  /** A guess the server never confirmed. Drop it when another action replaces the skill. */
  private dropPredictedCooldowns(except?: string) {
    for (const [k, v] of this.cooldowns) if (v.predicted && k !== except) this.cooldowns.delete(k);
    if (!except) this.castBar = null;
  }

  useSkill(id: string) {
    // casting already: the server queues it for when the cast ends (no walking up to the target, no cooldown guess)
    if (this.castBar?.skill) return void this.net.send({ t: 'skill', skill: id, force: this.ctrl });
    // Do not hunt for a mob here. A skill uses the target already selected; otherwise the server asks for one.
    // prediction: start the cooldown sweep right away when the skill is obviously usable
    const def = SKILLS[id], now = performance.now();
    this.dropPredictedCooldowns(id);
    if (def && (this.cooldowns.get(id)?.end ?? 0) <= now && this.me.mp >= def.mp && !this.castBar && this.self && !(this.self.flags & F_DEAD)) {
      const cd = Math.round(def.cooldown * (1 - this.me.cdr / 100)); // same cut the server applies (formulas.rs cdr)
      this.cooldowns.set(id, { end: now + cd + (def.cast ?? 0), dur: cd + (def.cast ?? 0), predicted: true });
    }
    // the server didn't take it (out of range, no target...): drop the guess
    setTimeout(() => {
      if (this.cooldowns.get(id)?.predicted) this.cooldowns.delete(id);
    }, 400 + Math.min(this.rtt, 600) + (def?.range && def.range > 3 ? 1500 : 0));
    // heals cast without an ally selected go to the most hurt party member in range, not always to yourself:
    // the server heals whoever is targeted when the skill arrives, so target them just for that message
    const cur = this.targetId !== null ? this.ents.get(this.targetId) : undefined;
    const hurt = def?.target === 'friend' && this.self && !(cur?.rec.k === 'p' && !(cur.flags & F_DEAD))
      ? (this.ui.party.members ?? [])
        .filter((m) => m.hp > 0 && m.hp < m.maxHp && (this.ents.get(m.id)?.pos.distanceTo(this.self!.pos) ?? Infinity) <= def.range)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]
      : undefined;
    if (hurt) this.net.send({ t: 'target', id: hurt.id });
    this.serverAction({ t: 'skill', skill: id, force: this.ctrl });
    if (hurt) this.net.send({ t: 'target', id: this.targetId });
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
    /** solid: a click to walk, which stops where the eye does (the hover only needs what is under the cursor) */
    const pick = (e: PointerEvent | MouseEvent, solid = false): Pick => {
      pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.raycaster.setFromCamera(pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.hitboxes, false);
      for (const h of hits) {
        const c = this.ents.get(h.object.userData.entId as number);
        // off-screen entities keep a stale hitbox (their matrices freeze while hidden)
        if (c && c.root.visible && !(c.rec.k === 'm' && c.flags & F_DEAD && c.id !== this.targetId) && c.id !== this.me.id) return { ent: c };
      }
      const t = this.raycaster.intersectObject(this.world.terrain, true)[0];
      if (!t) return {};
      const node = this.pickNode(this.raycaster.ray, t.point);
      if (node) return { node, point: t.point };
      if (!solid) return { point: t.point };
      // The ray went on to the ground under what the eye stopped at: a lake's bed (3-4 times its depth farther off from
      // this low camera) or the ground behind a house. Walk to the water's surface, or the foot of the wall or roof.
      const ray = this.raycaster.ray;
      let point = t.point;
      if (point.y < WATER_LEVEL && ray.direction.y < 0) point = ray.at((WATER_LEVEL - ray.origin.y) / ray.direction.y, new THREE.Vector3());
      const s = this.raycaster.intersectObjects(this.world.solids, true)[0];
      if (s && s.distance < ray.origin.distanceTo(point)) point = s.point.clone().setY(heightAt(s.point.x, s.point.z));
      return { point };
    };
    const cursorFor = (c: CEnt | undefined) => {
      if (!c) return CURSORS.move;
      if (c.rec.k === 'n') return CURSORS.talk;
      if (c.rec.k === 'i') return CURSORS.pickup;
      return CURSORS.select;
    };
    // Left: act on press (no waiting for release). A click is one destination: walking on toward the cursor while the
    // button was held re-picked it under a cursor the camera had carried along, a step or two off the click.
    const dropNodeTip = () => {
      if (!this.nodeTip) return;
      hideTip();
      this.nodeTip = false;
    };
    // a second click (or tap) on the same monster or enemy player, quick as a double click: attack it
    let lastHit = { id: -1, at: 0 };
    const clickEnt = (c: CEnt) => {
      const now = performance.now(), again = c.id === lastHit.id && now - lastHit.at < 500;
      lastHit = { id: again ? -1 : c.id, at: now }; // a third click starts over
      this.interact(c);
      if (again && this.isHostile(c)) this.attackTarget();
    };
    el.addEventListener('pointerleave', dropNodeTip);
    el.addEventListener('pointerdown', (e) => {
      dropNodeTip();
      if (e.button !== 0 || e.pointerType === 'touch') return; // touch acts on tap (pointerup)
      (document.activeElement as HTMLElement | null)?.blur();
      const r = pick(e, true);
      if (r.ent) clickEnt(r.ent);
      else if (r.node) this.useNode(r.node);
      else if (r.point) this.moveTo(r.point, true);
    });
    el.addEventListener('pointerup', (e) => {
      // mobile: a tap (not a camera drag) selects / talks / walks
      if (e.pointerType === 'touch' && !this.cam.touchDragged) {
        (document.activeElement as HTMLElement | null)?.blur();
        const r = pick(e, true);
        if (r.ent) clickEnt(r.ent);
        else if (r.node) this.useNode(r.node);
        else if (r.point) this.moveTo(r.point, true);
      }
    });
    el.addEventListener('pointermove', (e) => {
      this.lastPointer = { x: e.clientX, y: e.clientY };
      if (e.buttons) return dropNodeTip(); // dragging the camera
      const r = pick(e), ent = r.ent;
      this.hoverId = ent?.id ?? null;
      this.hoverNode = ent ? null : r.node ?? null;
      el.style.cursor = this.hoverNode ? NODE_HINT[this.hoverNode.kind].cursor() : cursorFor(ent);
      // not a title attribute: on the full-screen canvas it would turn into a tooltip that never goes away (ui/dom.ts)
      if (this.hoverNode) {
        showTipAt(NODE_HINT[this.hoverNode.kind].label(), e.clientX, e.clientY);
        this.nodeTip = true;
      } else dropNodeTip();
    });

    const typing = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
    };
    /** the action bound to this key in Options > Controls, if any */
    const bound = (e: KeyboardEvent) => {
      const keys = settings.s.keys, k = e.key.toLowerCase();
      return (Object.keys(keys) as Action[]).find((a) => keys[a] === k);
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
        else if (this.castBar?.skill) this.cancelCast();
        else if (!this.ui.closeTop()) this.setTarget(null);
        return;
      }
      if (typing()) return;
      const fk = /^F(\d+)$/.exec(e.key);
      if (fk && +fk[1] >= 1 && +fk[1] <= 10) {
        e.preventDefault();
        this.ui.hud.activateSlot(0, +fk[1] - 1);
        return;
      }
      const action = bound(e);
      const slot = action && /^(?:bar(\d))?slot(\d+)$/.exec(action);
      if (slot && !e.ctrlKey && !e.altKey) {
        this.ui.hud.activateSlot(slot[1] ? +slot[1] - 1 : 0, +slot[2] - 1);
        return;
      }
      if (action && (e.key === ' ' || e.key === 'Tab')) e.preventDefault();
      switch (action ?? e.key.toLowerCase()) {
        case 'inventory': this.ui.inventory.win.toggle(); break;
        case 'character': this.ui.character.win.toggle(); break;
        case 'map': this.ui.minimap.toggleMap(); break;
        case 'help': this.ui.help.toggle(); break;
        case 'settings': this.ui.settings.win.toggle(); break;
        case 'party': this.ui.party.toggle(); break;
        case 'clan': this.ui.clan.toggle(); break;
        case 'bars': this.ui.hud.toggleBarsMenu(); break;
        case 'loot': this.pickupNearest(); break;
        case 'attack': this.attackTarget(); break;
        case 'stop': this.stop(); break;
        case 'dash': this.dash(); break;
        case 'nextTarget': this.nextTarget(); break;
        case 'players': if (!e.repeat) this.showWho(true); break;
        case 'camLeft': this.cam.keys.left = true; break;
        case 'camRight': this.cam.keys.right = true; break;
        case 'arrowleft': this.cam.keys.left = true; break;
        case 'arrowright': this.cam.keys.right = true; break;
        case 'arrowup': this.cam.keys.up = true; break;
        case 'arrowdown': this.cam.keys.down = true; break;
      }
    });
    // Alt+Tab away: the key-up never arrives
    addEventListener('blur', () => this.showWho(false));
    addEventListener('keyup', (e) => {
      this.ctrl = e.ctrlKey;
      switch (bound(e) ?? e.key.toLowerCase()) {
        case 'players': this.showWho(false); break;
        case 'camLeft': case 'arrowleft': this.cam.keys.left = false; break;
        case 'camRight': case 'arrowright': this.cam.keys.right = false; break;
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
  /** Where we were at time t (between the positions kept), or null when that is older than what is kept. */
  private histAt(t: number): { x: number; z: number } | null {
    const h = this.selfHist;
    if (!h.length || t < h[0].t) return null;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].t > t) continue;
      const a = h[i], b = h[i + 1];
      if (!b) return a;
      const k = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    return null;
  }

  private updateSelf(c: CEnt, now: number, dt: number): boolean {
    // asked to do something while sitting: the get-up plays first (the server waits as long before moving us)
    if (c.flags & F_SITTING && this.predict && !isStanding(c)) c.standAt = now;
    if (!c.roll && isStanding(c) && now - c.standAt! < STAND_UP_MS) return false; // a dodge roll goes at once
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
      // Hold at the end until a server snapshot comes from after the roll (stale ones would pull us back).
      // Such a snapshot is nearer to where the roll ends than to where it began. Requiring it to sit ON the
      // end froze the character for a second whenever a move was clicked mid-roll: the server had already
      // walked on from there.
      const srv0 = c.snaps[c.snaps.length - 1], r = c.roll;
      const synced = srv0 && (Math.hypot(r.tx - r.fx, r.tz - r.fz) < 1 || Math.hypot(srv0.x - r.tx, srv0.z - r.tz) < Math.hypot(srv0.x - r.fx, srv0.z - r.fz));
      if (!synced && now - c.roll.at < ROLL_MS + 800) {
        c.pos.set(c.roll.tx, heightAt(c.roll.tx, c.roll.tz), c.roll.tz);
        return false;
      }
      c.roll = undefined;
      const pr = this.predict;
      if (pr) {
        pr.arrivedAt = 0;
        const goal = pr.chase ? this.ents.get(pr.chase.id) : undefined;
        const gx = goal?.pos.x ?? pr.x, gz = goal?.pos.z ?? pr.z;
        pr.path = findPath(c.pos.x, c.pos.z, gx, gz);
      }
    }
    const s = c.snaps;
    const srv = s[s.length - 1];
    const pr = this.predict;
    if (pr && c.flags & F_DEAD) this.predict = null;
    if (pr?.chase) {
      const t = this.ents.get(pr.chase.id);
      if (!t || t.flags & F_DEAD) this.predict = null;
      else {
        const left = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
        if (left <= pr.chase.range) {
          // in reach: stop here and let the server's position take over
          pr.path = [{ x: c.pos.x, z: c.pos.z }];
          if (!pr.arrivedAt) pr.arrivedAt = now;
          pr.x = c.pos.x;
          pr.z = c.pos.z;
          let dr = Math.atan2(t.pos.x - c.pos.x, t.pos.z - c.pos.z) - c.ry;
          dr = Math.atan2(Math.sin(dr), Math.cos(dr));
          c.ry += dr * Math.min(1, dt * 20);
        } else if (now >= pr.chase.repathAt || Math.hypot(t.pos.x - pr.x, t.pos.z - pr.z) > 1.5) {
          // the target moved: follow it
          pr.chase.repathAt = now + 400;
          pr.x = t.pos.x;
          pr.z = t.pos.z;
          pr.arrivedAt = 0;
          pr.path = findPath(c.pos.x, c.pos.z, t.pos.x, t.pos.z);
        }
      }
    }
    if (this.predict && pr) {
      while (pr.path.length > 1 && Math.hypot(pr.path[0].x - c.pos.x, pr.path[0].z - c.pos.z) < 0.15) pr.path.shift();
      // swimming is slower: predict it with the server's own water cells, or it pulls us back every few metres
      // and so are slowed walkers, and stunned ones don't move: the server's step_toward/update_player do the same
      let step = c.flags & STATUSES.stun.flag ? 0
        : (this.me.speed / 20) * dt * (isDeepCell(c.pos.x, c.pos.z) ? SWIM_SPEED : 1) * (c.flags & (STATUSES.slow.flag | STATUSES.frostbite.flag) ? SLOW_MUL : 1);
      // carry the step across waypoints, like the server's step_toward
      while (pr.path.length > 1) {
        const h = Math.hypot(pr.path[0].x - c.pos.x, pr.path[0].z - c.pos.z);
        if (h > step) break;
        step -= h;
        c.pos.x = pr.path[0].x;
        c.pos.z = pr.path[0].z;
        pr.path.shift();
      }
      const wp = pr.path[0];
      const dx = wp.x - c.pos.x, dz = wp.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      let moving = false;
      const k = d > 0.05 && step ? Math.min(1, step / d) : 0;
      const np = k ? pushOut(c.pos.x + dx * k, c.pos.z + dz * k) : c.pos;
      // held where we are on the last stretch: the point lies closer to an obstacle than our radius, so this is as
      // close as it gets (the server's step_toward stops there too); walking on was walking in place until the next click
      const held = k > 0 && !pr.chase && pr.path.length === 1 && d < 1 && Math.hypot(np.x - c.pos.x, np.z - c.pos.z) < Math.min(step, d) * 0.1;
      if (k && !held) {
        // facing where we actually go (along a trunk we slide past, round a corner turning), not at the waypoint
        const mx = np.x - c.pos.x, mz = np.z - c.pos.z, md = Math.hypot(mx, mz);
        let dr = (md > step * 0.3 ? Math.atan2(mx, mz) : Math.atan2(dx, dz)) - c.ry;
        dr = Math.atan2(Math.sin(dr), Math.cos(dr));
        c.ry += dr * Math.min(1, dt * 12);
        c.pos.x = np.x;
        c.pos.z = np.z;
        moving = true;
      } else if (!pr.arrivedAt) pr.arrivedAt = now;
      // The server's latest position against where we were when it took it (half a round trip and half a tick ago):
      // set against where we are now, our own head start read as an error, and the pull toward it cut corners
      // through the trunks we were walking round.
      const hist = this.selfHist;
      hist.push({ t: now, x: c.pos.x, z: c.pos.z });
      while (hist.length > 2 && now - hist[0].t > 1500) hist.shift();
      const then = this.histAt(srv.t - this.rtt / 2 - 25) ?? c.pos;
      const ex = srv.x - then.x, ez = srv.z - then.z;
      const err = Math.hypot(ex, ez);
      const srvDone = Math.hypot(srv.x - pr.x, srv.z - pr.z) < 0.3;
      // no headway for a while (held back towards a server that stopped short or went another way): hand back to the
      // server rather than walk on the spot, turning, pulled both ways
      if (!pr.chase && moving) {
        // what is left of the path (a detour round an obstacle may lead away from its end for a while)
        let left = Math.hypot(pr.path[0].x - c.pos.x, pr.path[0].z - c.pos.z);
        for (let i = 1; i < pr.path.length; i++) left += Math.hypot(pr.path[i].x - pr.path[i - 1].x, pr.path[i].z - pr.path[i - 1].z);
        if (pr.best === undefined || left < pr.best - 0.3) (pr.best = left), (pr.progressAt = now);
        else if (now - (pr.progressAt ?? now) > 800) this.predict = null;
      }
      // a real disagreement is eased away: that much of it moves us (and our history, so the next snapshot doesn't count
      // it again), and never into an obstacle
      if (err > PREDICT_SOFT_ERR) {
        const k = Math.min(1, dt * 2), o = pushOut(c.pos.x + ex * k, c.pos.z + ez * k);
        const sx = o.x - c.pos.x, sz = o.z - c.pos.z;
        for (const h of hist) (h.x += sx), (h.z += sz);
        c.pos.x = o.x;
        c.pos.z = o.z;
      }
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
    this.selfHist.push({ t: now, x: c.pos.x, z: c.pos.z });
    while (this.selfHist.length > 2 && now - this.selfHist[0].t > 1500) this.selfHist.shift();
    let dr = srv.ry - c.ry;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    c.ry += dr * Math.min(1, dt * 14);
    return moving;
  }

  private frame() {
    const now = performance.now();
    // in the background (another window focused) 30 fps is plenty: the game keeps running, the fans don't
    const cap = this.focused ? settings.s.fpsCap : Math.min(settings.s.fpsCap || 30, 30);
    // Frames are paced against a running schedule, not the last frame: on a 144 Hz screen "at least 16.7 ms
    // since the last one" only ever passes every third tick (20.8 ms), so a 60 cap ran at 48.
    if (cap) {
      const step = 1000 / cap;
      if (now - this.lastRender < step - 1) return;
      this.lastRender = Math.max(this.lastRender + step, now - step);
    } else this.lastRender = now;
    tickEnchantFx(now / 1000, this.renderer.domElement.height);
    this.fpsFrames++;
    if (now - this.fpsAt >= 500) {
      if (settings.s.showFps) {
        const r = this.renderer.info.render;
        this.fpsEl.textContent = `${Math.round((this.fpsFrames * 1000) / (now - this.fpsAt))} FPS · CPU ${this.cpuMs.toFixed(1)} ms · ${r.calls} draws · ${Math.round(r.triangles / 1000)}k tris${this.rtt ? ` · ${this.rtt} ms` : ''}`;
      }
      this.netWarn.style.display = now - this.net.lastMsgAt > 2500 ? 'block' : 'none';
      this.fpsFrames = 0;
      this.fpsAt = now;
    }
    this.adaptRes(now, now - this.last);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.benchHook?.(now - this.last, now / 1000);
    this.last = now;
    const rtNear = now - this.interpDelay;
    // far entities only get 10 Hz updates (interest management): draw them one more tick back
    const rtFar = rtNear - 50;
    const tSec = now / 1000;
    const self = this.self;

    // entities outside the camera frustum: hidden, not animated, no nameplate
    this.camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projView.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.driveJoystick(now);
    this.plates.length = 0;
    for (const c of this.ents.values()) {
      const s = c.snaps;
      let moving = (c.flags & F_MOVING) !== 0;
      if (c === self && s.length) {
        moving = this.updateSelf(c, now, dt);
        // footsteps: a dust puff every third of a second while running on foot
        if (moving && !c.roll && settings.s.particles && now - this.stepAt > 330 && !isDeep(c.pos.x, c.pos.z)) {
          this.stepAt = now;
          this.fx.dust(c.pos.clone(), 420);
        }
      } else if (s.length) {
        const rt = self && (c.pos.x - self.pos.x) ** 2 + (c.pos.z - self.pos.z) ** 2 > 2300 ? rtFar : rtNear;
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
      // how fast it really goes over the ground (pressed against a trunk, barely): the run plays at that pace, and a
      // player held in place stops running on the spot
      const moved = Math.hypot(c.pos.x - (c.groundX ?? c.pos.x), c.pos.z - (c.groundZ ?? c.pos.z));
      c.groundX = c.pos.x;
      c.groundZ = c.pos.z;
      c.groundSpeed = (c.groundSpeed ?? 0) + ((dt > 0 ? Math.min(moved / dt, 40) : 0) - (c.groundSpeed ?? 0)) * Math.min(1, dt * 8);
      if (c.rec.k === 'p' && moving && c.groundSpeed < HELD_SPEED) {
        c.heldSince ??= now;
        if (now - c.heldSince > 150) moving = false;
      } else c.heldSince = undefined;
      // in deep water the body floats at the swimming line
      const swimming = c.rig !== null && isDeep(c.pos.x, c.pos.z);
      const sitting = (c.flags & F_SITTING) !== 0 && !isStanding(c);
      if (swimming) c.root.position.y = SWIM_BODY_Y + Math.sin(tSec * 2 + c.id) * 0.05;
      c.model.rotation.y = c.ry;
      if (c.invisUntil || c.ghost) this.ghost(c, (c.invisUntil ?? 0) > now);
      if (c.rig) {
        const hk = c.hitAt ? 1 - (now - c.hitAt) / 180 : 0;
        if (hk > 0) {
          c.model.position.set(c.hitDx * 0.18 * hk, 0, c.hitDz * 0.18 * hk);
          c.model.scale.set(1 + 0.08 * hk, 1 - 0.06 * hk, 1 + 0.08 * hk).multiplyScalar(c.size);
        } else if (c.hitAt) {
          c.hitAt = 0;
          c.model.position.set(0, 0, 0);
          c.model.scale.setScalar(c.size);
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
          c.model.scale.set(1, 1 - tuck * 0.25, 1).multiplyScalar(c.size);
        } else {
          c.rollAt = 0;
          c.model.rotation.x = 0;
          c.model.position.set(0, 0, 0);
          c.model.scale.setScalar(c.size);
        }
      }
      const dSelf = self ? c.pos.distanceTo(self.pos) : 0;
      this.sphere.center.set(c.pos.x, c.pos.y + c.height / 2, c.pos.z);
      this.sphere.radius = Math.max(c.height, c.radius) + 2; // margin so shadows don't pop
      const onScreen = c === self || this.frustum.intersectsSphere(this.sphere);
      c.root.visible = onScreen;
      // hidden entities skip the per-frame matrix update of their whole tree (bones included)
      c.root.matrixWorldAutoUpdate = onScreen; // narrowed below, once we know whether it animates this frame
      c.tag.position.copy(c.root.position); // the body's height: floating when swimming
      if (sitting) c.tag.position.y -= c.groundSit ? 0.75 : 0.55; // the plate drops with the seated body (lower on the floor)
      if (c.tent) c.tag.position.copy(c.tent.top); // in a tent: the plate over it
      c.tag.visible = onScreen;
      // burning: small flames licking up from it; frostbitten: frost settling on it
      if (onScreen && c.flags & (STATUSES.burn.flag | STATUSES.frostbite.flag) && now - (c.burnAt ?? 0) > 350) {
        c.burnAt = now;
        const at = c.root.position.clone().setY(c.root.position.y + c.height * 0.3);
        if (c.flags & STATUSES.burn.flag) this.fx.flame(at, 0.35, 650);
        else this.fx.frost(at, 0.45, 800);
      }
      // far away: simplified copies of its parts (same skeleton and animation, fewer triangles)
      if (onScreen && c !== self) applyLod(c.root, (c.lod ??= { level: 0, done: true }), dSelf);
      // far rigs are tiny on screen: skip their (per-bone) animation
      if (c.danceUntil && (moving || now - c.atkAt < 700 || now > c.danceUntil)) c.danceUntil = undefined;
      // farther rigs animate on fewer frames (every 2nd past 20 m, every 3rd past 40 m): small on screen, same motion
      const stride = c === self || dSelf < 20 ? 1 : dSelf < 40 ? 2 : 3;
      // past 60 m nothing animates, but every rig gets one pose first: one that spawned far away would stand in its bind T-pose
      const animNow = c.rig !== null && onScreen && (!c.posed || (dSelf < 60 && (this.frameNo + c.id) % stride === 0));
      if (onScreen && c.rig && c !== self) {
        // A rig neither animated nor moved this frame keeps last frame's matrices: recomputing every bone
        // of every idle mob in view was a fifth of the frame once mobs had skeletons.
        const r = c.root.position, m = c.model.position, at = (c.mwAt ??= []);
        const cur = MW_TMP;
        (cur[0] = r.x), (cur[1] = r.y), (cur[2] = r.z), (cur[3] = m.x), (cur[4] = m.y), (cur[5] = m.z), (cur[6] = c.model.scale.y), (cur[7] = c.ry);
        let still = at.length === 8;
        for (let i = 0; i < 8; i++) if (at[i] !== cur[i]) (still = false), (at[i] = cur[i]);
        c.root.matrixWorldAutoUpdate = animNow || !still;
      }
      if (animNow && c.rig) {
        c.posed = true;
        // another player's cast shows once its 'cast' says what it is (the flag comes a little ahead of it), and stays
        // over the moment between the flag going off and its 'fx' arriving, so the pose neither guesses nor drops and
        // pops back
        const casting = c.flags & F_CASTING ? c === self || c.rec.k !== 'p' || c.castSkill !== undefined
          : !!c.castSkill && now - (c.castEndAt ?? -Infinity) < this.interpDelay + 120;
        // the pose says when a foot lands: the footstep sounds then
        if (now >= (c.hitStop ?? 0)) this.footfall(c, c === self, now, animate(c.rig, {
          dancing: !!c.danceUntil,
          moving,
          atkAge: now - c.atkAt,
          casting,
          castMove: casting ? this.castMove(c) : undefined,
          castAnim: casting ? this.skillAnim(c.castSkill) : undefined,
          atkAnim: c.atkAnim,
          castAge: c.castAt ? now - c.castAt : Infinity,
          atkStab: c.atkStab,
          atkStep: c.atkStep,
          atkInterval: c.atkInterval,
          speed: c.groundSpeed,
          deadAge: c.flags & F_DEAD ? (c.deadAt < 0 ? 5000 : now - c.deadAt) : -1,
          t: tSec + c.id,
          swimming,
          floorSit: !!c.groundSit,
          sitAge: sitting ? now - (c.sitAt ?? now - 5000) : -1,
          standAge: c.standAt ? now - c.standAt : Infinity,
          gather: c.gather && c.flags & F_GATHER ? { anim: c.gather.anim, age: now - c.gather.at, swingMs: c.gather.swingMs } : null,
        }));
      } else if (!c.rig) {
        c.model.rotation.y = tSec * 1.5;
        c.model.position.y = 0.1 + Math.sin(tSec * 3 + c.id) * 0.05;
      }
      if (onScreen && dSelf < 50) {
        // every stroke on a tree or a rock: chips fly and it sounds, at the moment the blow lands
        const g = c.gather;
        if (g && c.flags & F_GATHER) {
          const hit = Math.floor((now - g.at - g.swingMs * 0.45) / g.swingMs) + 1;
          if (hit > g.strokes) {
            g.strokes = hit;
            const at = new THREE.Vector3(g.node.x, heightAt(g.node.x, g.node.z) + (g.node.kind === 'tree' ? 1 : 0.4), g.node.z);
            if (g.anim === 'pick') play('rustle', this.near(c) * 0.6);
            else {
              this.fx.shards(at, g.anim === 'chop' ? 0x8a5a2a : 0xb0b0b0, 7, 0.9, 500);
              play(g.anim === 'chop' ? 'chop' : 'mine', this.near(c) * 0.8);
            }
          }
        }
        // ripples behind a swimmer
        if (swimming && moving && now - (c.splashAt ?? 0) > 520) {
          c.splashAt = now;
          this.fx.ring(new THREE.Vector3(c.pos.x, WATER_LEVEL - 0.08, c.pos.z), 0xdfefff, 1.1, 700);
          if (c === self) play('splash', 0.25);
        }
      }
      if (self) {
        const d = dSelf;
        // player names always show (whenever they're on screen); items, mobs and NPCs fade by distance
        const hot = c.id === this.targetId || c.id === this.hoverId;
        const show = hot || c.rec.k === 'p' || (c.rec.k === 'i' ? d < 18 : c.rec.k === 'm' ? d < 30 && !(c.flags & F_DEAD) : d < 55);
        c.label.visible = show && onScreen;
        if (c.label.visible) this.plates.push({ c, d: hot || c.rec.k === 'p' ? -1 : d });
        // like WoW: quest markers show from afar, but not across the whole map
        if (c.marker) c.marker.obj.visible = onScreen && d < 90 && c.marker.el.textContent !== '';
      }
    }
    // declutter: nearest first, a nameplate that would land on top of one already placed is hidden
    this.plates.sort((a, b) => a.d - b.d);
    const taken: number[] = [];
    for (const { c, d } of this.plates) {
      const v = this.plateV.set(c.pos.x, c.pos.y + c.height, c.pos.z).project(this.camera);
      const x = (v.x * innerWidth) / 2, y = (v.y * innerHeight) / 2;
      let clash = false;
      if (d >= 0) for (let i = 0; i < taken.length && !clash; i += 2) clash = Math.abs(taken[i] - x) < 64 && Math.abs(taken[i + 1] - y) < 24;
      if (clash) c.label.visible = false;
      else taken.push(x, y);
    }

    if (self && this.route.length) {
      // reached a stop: on to the next one. Standing still for a while (blocked, dead, busy) drops the route.
      const wp = this.route[0];
      // a leg's stop is only on the way: no need to step onto it
      if (Math.hypot(wp.x - self.pos.x, wp.z - self.pos.z) < (wp.leg ? 4 : 1.5)) {
        this.route.shift();
        this.routeRetried = false;
        if (this.route.length) this.walkRoute();
      } else if (this.predict || self.flags & F_MOVING) this.routeMovedAt = now;
      else if (now - this.routeMovedAt > 1500) {
        // stopped short: plan this walk again from here once, then give up
        if (this.routeRetried) this.route.length = 0;
        else {
          this.routeRetried = true;
          this.walkRoute();
        }
      }
    }
    if (self) {
      this.cam.update(dt, self.root.position); // follows the body (it floats over deep water)
      // the crowns between the camera and us are seen through (render/nature.ts)
      setSeeThrough(this.camera.position, this.seeFocus.set(self.pos.x, self.root.position.y + self.height * 0.6, self.pos.z));
      this.world.updateSky(this.camera, this.camera.far, dt);
      this.world.follow(self.pos);
      tickWind(dt);
      this.motes.update(self.pos, dt, tSec);
      this.critters.update(self.pos, dt, tSec);
      this.rain.update(self.pos, dt);
      // the weather for the ears: rain, and wind (stronger up high, in the snow and the ash, and in a shower)
      const rain = rainAt(self.pos.x, self.pos.z), harsh = Math.max(biomeWeight('frost', self.pos.x, self.pos.z), biomeWeight('ash', self.pos.x, self.pos.z));
      setWeather(rain, Math.min(1, 0.12 + smoothstep(20, 50, self.pos.y) * 0.4 + harsh * 0.5 + rain * 0.3), harsh);
      this.storms(self.pos);
      this.lights.update(self.pos, tSec);
      // light shafts: where the sun sits on screen, fading out as it leaves the view or sets
      const sv = this.sunScreen.copy(this.camera.position).addScaledVector(ATMOS.sunDir, 500).project(this.camera);
      const off = Math.max(Math.abs(sv.x), Math.abs(sv.y));
      const shafts = sv.z < 1 ? (1 - Math.min(1, Math.max(0, (off - 1) / 1.4))) * Math.min(1, Math.max(0, ATMOS.sunDir.y * 6)) : 0;
      this.post.setSun(sv.x * 0.5 + 0.5, sv.y * 0.5 + 0.5, shafts * 0.9);
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
    } else if (this.hoverNode) {
      // a world node under the cursor gets the same ring, in gold
      const n = this.hoverNode;
      this.hoverRing.visible = true;
      this.hoverRing.position.set(n.x, heightAt(n.x, n.z) + 0.1, n.z);
      this.hoverRing.scale.setScalar(Math.max(0.7, (n.r + 0.3) * 1.4));
      (this.hoverRing.material as THREE.MeshBasicMaterial).color.set(0xffd966);
    } else this.hoverRing.visible = false;
    if (this.clickMarker.visible) {
      const k = (now - this.clickAt) / 550;
      this.clickMarker.visible = k < 1;
      const e = 1 - (1 - Math.min(1, k * 1.6)) ** 3; // ease out: snaps in, then holds while it fades
      const [ring, ...chevs] = this.clickMarker.children;
      ring.scale.setScalar(1.5 - 0.8 * e);
      chevs.forEach((c) => c.position.set(0, 0, 0).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion), 0.75 - 0.45 * e));
      this.clickMat.opacity = Math.min(1, k * 8) * (1 - k);
    }
    this.fx.p.setShade(0.25 + 0.75 * ATMOS.day);
    this.fx.update(this.self?.pos);
    this.nodes.update();
    tickLod();
    this.ui.update(now);
    this.renderer.info.reset();
    // ponytail: sun shadows re-render every other frame (half the shadow cost). Ceiling: moving characters' shadows lag one frame.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = (this.frameNo++ & 1) === 0;
    this.world.renderReflection(settings.s.reflections, this.renderer, this.camera);
    this.post.render();
    this.labels.render(this.labelLayer as unknown as THREE.Scene, this.camera); // only walks children, any Object3D works
    // JS time spent on this frame (the GPU works on it after this returns), smoothed
    this.cpuMs += (performance.now() - now - this.cpuMs) * 0.1;
  }
}
