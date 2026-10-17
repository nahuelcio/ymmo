import { NPCS, ZONES, type ZoneDef } from '../../../shared/src/data/world';
import { makeMovable } from './movable';
import { isTouchDevice } from './touch';
import type { QuestMarker } from '../../../shared/src/data/quests';
import { CAMPS } from '../../../shared/src/data/camps';
import { RAIDS } from '../../../shared/src/data/raids';
import { F_DEAD } from '../../../shared/src/protocol';
import * as terrain from '../../../shared/src/terrain';
import { heightAt, TOWN, TOWNS, valueNoise, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { layoutCamps, layoutTown, layoutTrees } from '../../../shared/src/layout';
import { F_RED, type Game } from '../game';
import { el, Win } from './dom';
import { lang, t as tx } from '../lang';
import { settings } from '../settings';
import { gameClock } from '../render/atmos';
import { campName, zoneName } from '../../../shared/src/i18n';
import { BELL_TOWER } from '../../../shared/src/village';

// ponytail: capped so the 4 km continent overview stays ~2.5 M samples at startup (~2.5 m a pixel); the big map
// re-samples the visible window at full resolution anyway. Raise the cap if the corner minimap looks soft.
const RES = Math.min(1600, Math.round((512 * WORLD_HALF) / 500));

type Region = { id: string; name: string; levels: string; x: number; z: number; poly: [number, number][] };
// World v2 contract (terrain.ts): read optionally so the client builds before / without the new terrain.
const ext = terrain as unknown as { landAt?: (x: number, z: number) => number; REGIONS?: Region[]; RING_ROADS?: [number, number, number, number][] };
const landAt = ext.landAt ?? ((x: number, z: number) => (heightAt(x, z) < WATER_LEVEL ? 0 : 1));
const REGIONS = ext.REGIONS ?? [];
const ROADS = ext.RING_ROADS ?? [];

/** Parchment palette, shared by the world map and the corner minimap. */
const PAPER: [number, number, number] = [226, 206, 162];
const SEA: [number, number, number] = [238, 228, 202];
const INK = '#3a2614';
const INK_A = (a: number) => `rgba(58, 38, 20, ${a})`;
const REGION_TINT = ['#7a8a4a', '#a0703a', '#6a7a8a', '#8a5a6a', '#5a7a6a', '#9a8a3a', '#7a4a3a'];
/** minimap size in CSS px; its canvas is backed at device resolution so it stays sharp */
const MM = 170;

/** Hunting grounds where the active quests' mobs spawn. */
function questAreas(targets: { quest: string; mobs: Set<string> }[]): { zone: ZoneDef; quests: string[] }[] {
  const out: { zone: ZoneDef; quests: string[] }[] = [];
  for (const zone of ZONES) {
    const quests = targets.filter((t) => zone.spawns.some((s) => t.mobs.has(s.mob))).map((t) => t.quest);
    if (quests.length) out.push({ zone, quests });
  }
  return out;
}

/**
 * Shaded terrain for the square window [x0, x0+span]², res px a side: water, ground colour and north-west-light relief.
 * A generator so a big sample can be spread over frames (yields after every row); drain it to paint synchronously.
 */
function* paintTerrain(x0: number, z0: number, span: number, res: number): Generator<void, HTMLCanvasElement> {
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(res, res);
  const step = span / res;
  // heights one sample past each edge so the slope at the border is real, not clamped
  const W = res + 2;
  const hs = new Float32Array(W * W), ls = new Float32Array(W * W);
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step;
      hs[j * W + i] = heightAt(x, z);
      ls[j * W + i] = landAt(x, z);
    }
    yield;
  }
  // hatching period in pixels: a few metres at the overview, never finer than 3 px
  const hatch = Math.max(3, Math.round(6 / Math.max(0.5, step)));
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = (j + 1) * W + i + 1, h = hs[k];
      const x = x0 + i * step, z = z0 + j * step;
      const land = ls[k];
      // paper stains: two octaves of noise in world space, so they don't swim while panning
      const stain = 0.93 + 0.07 * valueNoise(x * 0.004, z * 0.004) + 0.03 * valueNoise(x * 0.03, z * 0.03);
      let r: number, g: number, b: number;
      if (land < 0.5) {
        // sea: pale paper with a darker wash hugging the coast (the shadow under the inked shore)
        const wash = Math.max(0, (land - 0.15) / 0.35);
        [r, g, b] = SEA.map((c, n) => c - wash * (n === 2 ? 30 : 45));
      } else if (h < WATER_LEVEL) {
        [r, g, b] = [150, 150, 128]; // lakes and rivers: ink-tinted water
      } else {
        // relief per metre, so every zoom level shades alike; light from the north-west
        const sx = (hs[k + 1] - hs[k - 1]) / (2 * step), sz = (hs[k + W] - hs[k - W]) / (2 * step);
        const light = Math.min(1.12, Math.max(0.6, 1 + (sx + sz) * 0.35));
        const steep = Math.min(1, Math.hypot(sx, sz) * 0.9);
        // ink hatching on slopes, diagonal strokes that thicken with steepness
        const ink = (i + j) % hatch < 1 + steep * 1.5 ? steep * 0.35 : 0;
        const hi = Math.min(1, Math.max(0, h / 90)) * 0.18; // uplands a shade browner
        const f = light * (1 - ink) * (1 - hi);
        [r, g, b] = [PAPER[0] * f, PAPER[1] * f * (1 - hi * 0.2), PAPER[2] * f * (1 - hi * 0.5)];
      }
      // the coastline itself: one inked pixel wherever a neighbour lies on the other side of the shore
      const side = land >= 0.5;
      const coast = (ls[k + 1] >= 0.5) !== side || (ls[k - 1] >= 0.5) !== side || (ls[k + W] >= 0.5) !== side || (ls[k - W] >= 0.5) !== side ? 0.85 : 0;
      const o = (j * res + i) * 4;
      img.data[o] = (r * (1 - coast) + 58 * coast) * stain;
      img.data[o + 1] = (g * (1 - coast) + 38 * coast) * stain;
      img.data[o + 2] = (b * (1 - coast) + 20 * coast) * stain;
      img.data[o + 3] = 255;
    }
    yield;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Run a paintTerrain generator to the end right now. */
function drain(gen: Generator<void, HTMLCanvasElement>): HTMLCanvasElement {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}

const worldImage = () => drain(paintTerrain(-WORLD_HALF, -WORLD_HALF, 2 * WORLD_HALF, RES));

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const toMap = (v: number) => ((v + WORLD_HALF) / (2 * WORLD_HALF)) * RES;

/** A quest giver's mark on a map, as over their head: ! to take a quest, ? to hand one in (grey: not yet). */
/** How much the world map's labels and icons shrink on a map S px wide: none from 640 px up, the square root below. */
const markScale = (S: number) => Math.min(1, Math.sqrt(S / 640));

/** The player's arrow on a map: a white dart with a black rim pointing up, turned and moved with a CSS transform. */
function faceArrow(parent: HTMLElement): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'map-face');
  s.setAttribute('viewBox', '-9 -9 18 18');
  s.setAttribute('width', '18');
  s.setAttribute('height', '18');
  s.innerHTML = '<path d="M0,-7 L4.9,7 L0,3.5 L-4.9,7 Z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>';
  parent.appendChild(s);
  return s;
}

function drawQuestMark(ctx: CanvasRenderingContext2D, x: number, y: number, qm: NonNullable<QuestMarker>, size: number) {
  ctx.font = `bold ${size}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(3, size / 4);
  ctx.strokeStyle = '#000';
  const ch = qm === 'ready' || qm === 'active' ? '?' : '!';
  ctx.strokeText(ch, x, y + size * 0.38);
  ctx.fillStyle = qm === 'ready' || qm === 'available' ? '#ffd200' : '#9a9a9a';
  ctx.fillText(ch, x, y + size * 0.38);
}

export class Minimap {
  private img = worldImage();
  private canvas: HTMLCanvasElement;
  private zoneEl: HTMLDivElement;
  private coordsEl: HTMLDivElement;
  private clockEl: HTMLDivElement;
  private viewR = 110;
  private mapWin: Win;
  private bigCanvas: HTMLCanvasElement;
  /** World-map zoom (1 = whole frontier). Wheel zooms; drag pans. */
  private mapZoom = 1;
  private mapCx = 0;
  private mapCz = 0;
  private mapDrag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  /** fingers on the world map; two of them pinch-zoom round their middle, keeping the world point first under it there */
  private mapPts = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; zoom: number; wx: number; wz: number } | null = null;
  private detail: HTMLCanvasElement | null = null;
  private detailKey = '';
  /** Key of the window `detail` was painted for. */
  private detailSpan = '';
  /** CSS pixels of the world map. Overlays are drawn in this space; the bitmap is device pixels. */
  private mapS = RES;
  private lastDraw = 0;
  /** Last wheel zoom: the sharp re-sample waits until the wheel settles (update() redraws every 150 ms). */
  private wheelAt = 0;
  private routePts: { x: number; z: number }[] = [];
  private routeAt = 0;
  private raidBtn: HTMLButtonElement;
  /** the player's arrows, pointing where the camera looks (face, every frame) and the last transform each was given */
  private mmFace!: SVGSVGElement;
  private bigFace!: SVGSVGElement;
  private mmFaceAt = '';
  private bigFaceAt = '';
  /** the world map's full side (the size it always had) and whether it is showing at that size or at half */
  private mapSide = RES;
  private mapBig = false;
  private sizeBtn!: HTMLButtonElement;

  constructor(private g: Game, root: HTMLElement) {
    const box = el('div', 'panel minimap', root);
    makeMovable(box, 'minimap');
    // touch: folds down to a small round map (a tap on it still opens the world map)
    const fold = el('button', 'btn small mm-fold', box);
    const setFold = (on: boolean) => {
      box.classList.toggle('folded', on);
      fold.textContent = on ? '+' : '−';
      fold.title = on ? tx('Agrandar el minimapa', 'Enlarge the minimap') : tx('Achicar el minimapa', 'Shrink the minimap');
    };
    try {
      setFold(localStorage.getItem('fold:minimap') === '1');
    } catch {
      setFold(false);
    }
    fold.onclick = () => {
      setFold(!box.classList.contains('folded'));
      try {
        localStorage.setItem('fold:minimap', box.classList.contains('folded') ? '1' : '0');
      } catch {
        /* ignore */
      }
    };
    this.zoneEl = el('div', 'mm-zone', box);
    this.canvas = el('canvas', 'mm-canvas', box);
    this.mmFace = faceArrow(box);
    this.canvas.width = this.canvas.height = Math.round(MM * Math.min(devicePixelRatio || 1, 3));
    el('span', 'mm-north', box, 'N');
    this.coordsEl = el('div', 'mm-coords', box);
    this.clockEl = el('div', 'mm-clock', box);
    this.clockEl.title = tx('Hora del juego. La noche pasa rápido.', 'Game time. Nights pass quickly.');
    el('div', 'mm-legend', box).innerHTML = `<i style="background:#ff5544"></i> ${tx('enemigos', 'enemies')} <i style="background:#ffd200"></i> ${tx('misión', 'quest')} <i style="background:#66aaff"></i> ${tx('jugadores', 'players')} <i style="background:#66ff88"></i> party`;
    const zoom = el('div', 'mm-zoom', box);
    const zin = el('button', 'btn small', zoom, '+');
    zin.onclick = () => (this.viewR = Math.max(40, this.viewR * 0.75));
    const zout = el('button', 'btn small', zoom, '−');
    zout.onclick = () => (this.viewR = Math.min(300, this.viewR / 0.75));
    this.canvas.onclick = () => this.toggleMap();
    // leaving a raid is the /raid chat command; a second click confirms, so a stray one mid-fight doesn't throw you out
    const leave = tx('Salir', 'Leave'), sure = tx('¿Seguro?', 'Sure?');
    this.raidBtn = el('button', 'btn small mm-raid', box, leave);
    this.raidBtn.title = tx('Salir de la raid y volver a la aldea', 'Leave the raid and return to the village');
    this.raidBtn.onclick = () => {
      if (this.raidBtn.textContent === sure) g.net.send({ t: 'chat', text: '/raid' });
      else setTimeout(() => (this.raidBtn.textContent = leave), 3000);
      this.raidBtn.textContent = this.raidBtn.textContent === sure ? leave : sure;
    };

    // The overview is already RES px (~2 m). Squashing it into 512 and smoothing made the whole map soft.
    // fits .win-body (max-height 100vh - 120, 8px padding) with the hint line: a scrollbar would toggle
    // the canvas width every frame, and every new width re-samples the whole terrain (the map ran at 1 FPS)
    const side = (this.mapSide = Math.min(RES, Math.max(320, innerHeight - 160)));
    this.mapWin = new Win('worldmap', tx('Mapa del Mundo — Frontera de Aden', 'World Map — Aden Frontier'), 160, 28, side + 18, root);
    // ⤢ / ⤡ by the ×: the full size it always had, or half
    const bar = this.mapWin.root.querySelector('.win-title')!;
    this.sizeBtn = el('button', 'win-size');
    bar.insertBefore(this.sizeBtn, bar.querySelector('.win-close'));
    this.sizeBtn.onclick = () => this.setMapSize(!this.mapBig);
    // it opens at half size; phones keep the size they had, half of it would be too small to read (Win.show's phones)
    this.mapWin.onShow = () => this.setMapSize(document.body.classList.contains('touch') && Math.min(innerWidth, innerHeight) <= 500);
    this.mapWin.body.style.position = 'relative'; // the arrow (bigFace) is placed over the canvas
    this.bigCanvas = el('canvas', 'big-map', this.mapWin.body);
    this.bigFace = faceArrow(this.mapWin.body);
    this.bigCanvas.width = this.bigCanvas.height = side;
    this.bigCanvas.style.width = this.bigCanvas.style.height = `${side}px`;
    // click walks there; a drag pans once zoomed in; Ctrl+click adds a stop; right click clears the route; two fingers pinch
    const mid = () => {
      const [a, b] = [...this.mapPts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    this.bigCanvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      try {
        this.bigCanvas.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser no longer tracks: the gesture still works without capture */
      }
      this.mapPts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.mapPts.size === 2) {
        // a second finger: no walk and no one-finger pan from here, a pinch instead
        const m = mid(), [wx, wz] = this.worldAt(m.x, m.y);
        this.pinch = { d: m.d, zoom: this.mapZoom, wx, wz };
        this.mapDrag = null;
        return;
      }
      if (this.mapPts.size > 2 || this.pinch) return;
      this.mapDrag = { x: e.offsetX, y: e.offsetY, cx: this.mapCx, cz: this.mapCz, moved: false };
    });
    const lift = (e: PointerEvent) => {
      this.mapPts.delete(e.pointerId);
      if (this.pinch && this.mapPts.size < 2) {
        this.pinch = null;
        this.drawBig();
      }
    };
    this.bigCanvas.addEventListener('pointercancel', lift);
    this.bigCanvas.addEventListener('pointermove', (e) => {
      if (this.mapPts.has(e.pointerId)) this.mapPts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pinch && this.mapPts.size >= 2) {
        const m = mid(), p = this.pinch;
        return this.zoomAt(m.x, m.y, Math.min(8, Math.max(1, (p.zoom * m.d) / p.d)), p.wx, p.wz);
      }
      const d = this.mapDrag;
      if (!d) return;
      const dx = e.offsetX - d.x, dy = e.offsetY - d.y;
      if (dx * dx + dy * dy > 16) d.moved = true;
      if (!d.moved || this.mapZoom <= 1) return;
      const span = this.mapSpan();
      const w = this.bigCanvas.clientWidth || 512;
      this.mapCx = this.clampMap(d.cx - (dx / w) * span);
      this.mapCz = this.clampMap(d.cz - (dy / w) * span);
      this.drawBig();
    });
    this.bigCanvas.addEventListener('pointerup', (e) => {
      lift(e);
      const d = this.mapDrag;
      this.mapDrag = null;
      if (d?.moved) this.drawBig();
      if (!d || d.moved || e.button !== 0) return;
      const [x, z] = this.worldAt(e.offsetX, e.offsetY);
      g.travel(x, z, e.ctrlKey || e.metaKey);
      this.routeAt = 0;
    });
    this.bigCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [wx, wz] = this.worldAt(e.offsetX, e.offsetY);
      this.zoomAt(e.offsetX, e.offsetY, Math.min(8, Math.max(1, this.mapZoom * (e.deltaY < 0 ? 1.28 : 1 / 1.28))), wx, wz);
    }, { passive: false });
    this.bigCanvas.oncontextmenu = (e) => {
      e.preventDefault();
      g.stop();
      this.routeAt = 0;
    };
    el('div', 'hint', this.mapWin.body, isTouchDevice()
      ? tx('Pellizcar: acercar · Arrastrar: mover · Tocar: caminar', 'Pinch: zoom · Drag: pan · Tap: walk')
      : tx('Rueda: acercar · Arrastrar: mover · Click: caminar · Ctrl+click: parada · Click derecho: cancelar',
        'Wheel: zoom · Drag: pan · Click: walk · Ctrl+click: add a stop · Right click: cancel'));
  }

  /** World-map zoom to `next`, with the world point (wx, wz) landing under (px, py) on the canvas (the wheel's cursor, a pinch's middle). */
  private zoomAt(px: number, py: number, next: number, wx: number, wz: number) {
    this.mapZoom = next;
    this.wheelAt = performance.now();
    const span = this.mapSpan();
    const w = this.bigCanvas.clientWidth || 512;
    const h = this.bigCanvas.clientHeight || 512;
    this.mapCx = next <= 1 ? 0 : this.clampMap(wx - (px / w - 0.5) * span);
    this.mapCz = next <= 1 ? 0 : this.clampMap(wz - (py / h - 0.5) * span);
    this.drawBig();
  }

  /** World units across the world-map window. */
  private mapSpan() {
    return (2 * WORLD_HALF) / this.mapZoom;
  }

  private clampMap(v: number) {
    const limit = WORLD_HALF - this.mapSpan() / 2;
    if (limit <= 0) return 0;
    return Math.min(limit, Math.max(-limit, v));
  }

  /** Canvas CSS pixel → world XZ for the current pan and zoom. */
  private worldAt(px: number, py: number): [number, number] {
    const span = this.mapSpan();
    const w = this.bigCanvas.clientWidth || 512;
    const h = this.bigCanvas.clientHeight || 512;
    return [this.mapCx - span / 2 + (px / w) * span, this.mapCz - span / 2 + (py / h) * span];
  }

  /** World XZ → big-canvas CSS pixel. */
  private toBig(x: number, z: number): [number, number] {
    const span = this.mapSpan();
    const S = this.mapS;
    return [((x - (this.mapCx - span / 2)) / span) * S, ((z - (this.mapCz - span / 2)) / span) * S];
  }

  /** Match the bitmap to the window and device pixels. Drawing stays in CSS pixels. Returns 0 before layout. */
  private syncBig(): number {
    const css = this.bigCanvas.clientWidth;
    if (css < 2) return 0;
    const px = Math.max(1, Math.round(css * Math.min(devicePixelRatio || 1, 2)));
    if (this.bigCanvas.width !== px) {
      this.bigCanvas.width = this.bigCanvas.height = px;
      this.detailKey = '';
    }
    const ctx = this.bigCanvas.getContext('2d')!;
    ctx.setTransform(px / css, 0, 0, px / css, 0, 0);
    this.mapS = css;
    return css;
  }

  /** Copy a terrain sample into the window. Skip filtering when it is already one pixel per device pixel. */
  private blitMap(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, S: number) {
    ctx.imageSmoothingEnabled = src.width !== this.bigCanvas.width;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, S, S);
  }

  /**
   * Re-sample the visible window at one pixel per device pixel, a few ms per frame so the game never stalls;
   * the window keeps showing the previous picture until the sharp one is done. A newer request cancels the old.
   */
  private renderWindow(key: string) {
    const span = this.mapSpan();
    const gen = paintTerrain(this.mapCx - span / 2, this.mapCz - span / 2, span, this.bigCanvas.width);
    const tick = () => {
      if (this.detailKey !== key) return;
      const end = performance.now() + 8;
      while (performance.now() < end) {
        const r = gen.next();
        if (r.done) {
          this.detail = r.value;
          this.detailSpan = key;
          this.drawBig();
          return;
        }
      }
      setTimeout(tick, 0);
    };
    tick();
  }

  toggleMap() {
    this.mapWin.toggle();
    this.drawBig();
  }

  /** The world map at its full size or at half (the button by the ×), kept on the screen. */
  private setMapSize(big: boolean) {
    this.mapBig = big;
    const r = this.mapWin.root, side = big ? this.mapSide : Math.max(240, Math.round(this.mapSide / 2));
    r.style.width = `${side + 18}px`;
    r.classList.toggle('map-half', !big);
    this.sizeBtn.textContent = big ? '⤡' : '⤢';
    this.sizeBtn.title = big ? tx('Achicar el mapa', 'Shrink the map') : tx('Agrandar el mapa', 'Enlarge the map');
    // grown past the edge of the screen: back inside
    const right = r.offsetLeft + r.offsetWidth - innerWidth, bottom = r.offsetTop + r.offsetHeight - innerHeight;
    if (right > 0) r.style.left = `${Math.max(0, r.offsetLeft - right)}px`;
    if (bottom > 0) r.style.top = `${Math.max(0, r.offsetTop - bottom)}px`;
    this.drawBig();
  }

  /**
   * The player's arrows on both maps, every frame: north stays up and the arrow points where the camera looks (it
   * looks along -sin yaw, -cos yaw), whichever way the body walks. A CSS transform, so the maps aren't redrawn for it.
   */
  private face() {
    const self = this.g.self;
    this.mmFace.style.display = self ? '' : 'none';
    if (!self) return void (this.bigFace.style.display = 'none');
    const turn = `rotate(${(-this.g.cam.yaw).toFixed(3)}rad)`;
    // the minimap is centred on the player
    const c = this.canvas, mm = `translate(${c.offsetLeft + c.clientLeft + c.clientWidth / 2 - 9}px, ${c.offsetTop + c.clientTop + c.clientHeight / 2 - 9}px) ${turn}`;
    if (mm !== this.mmFaceAt) this.mmFace.style.transform = this.mmFaceAt = mm;
    const S = this.bigCanvas.clientWidth;
    const [x, y] = this.mapWin.visible && S ? this.toBig(self.pos.x, self.pos.z) : [-1, -1];
    const inView = x >= 0 && y >= 0 && x <= S && y <= S; // zoomed in, the player may be off the window
    this.bigFace.style.display = inView ? '' : 'none';
    if (!inView) return;
    // at half size it shrinks with the map's other marks (drawBig)
    const b = this.bigCanvas, k = markScale(S);
    const big = `translate(${(b.offsetLeft + b.clientLeft + x - 9).toFixed(1)}px, ${(b.offsetTop + b.clientTop + y - 9).toFixed(1)}px) ${turn} scale(${k.toFixed(2)})`;
    if (big !== this.bigFaceAt) this.bigFace.style.transform = this.bigFaceAt = big;
  }

  private drawBig() {
    if (!this.mapWin.visible) return;
    const S0 = this.syncBig();
    if (!S0) return;
    const ctx = this.bigCanvas.getContext('2d')!;
    const dragging = !!this.mapDrag?.moved || performance.now() - this.wheelAt < 250;
    const key = `${this.bigCanvas.width}:${this.mapZoom.toFixed(3)}:${this.mapCx.toFixed(1)}:${this.mapCz.toFixed(1)}`;
    if (!dragging && this.detailKey !== key) {
      this.detailKey = key;
      this.renderWindow(key);
    }
    if (this.detail && this.detailSpan === key) {
      this.blitMap(ctx, this.detail, S0);
    } else {
      // until the sharp sample lands (and while panning), crop the overview
      const src = (this.mapSpan() / (2 * WORLD_HALF)) * RES;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.img, toMap(this.mapCx) - src / 2, toMap(this.mapCz) - src / 2, src, src, 0, 0, S0, S0);
    }
    // On a smaller map (half size, a phone) the labels, icons and compass roses shrink by less than it (the square
    // root): still readable, and inside it. They are drawn in a larger virtual space that the context scales down.
    const k = markScale(S0);
    ctx.save();
    ctx.scale(k, k);
    this.mapS = S0 / k;
    try {
      this.drawMarks(ctx, S0 / k);
    } finally {
      ctx.restore();
      this.mapS = S0;
    }
  }

  /** Everything over the terrain: regions, roads, places, quests, players and the compass roses, on an S-wide map. */
  private drawMarks(ctx: CanvasRenderingContext2D, S: number) {
    const pxPer = S / this.mapSpan(), zoom = this.mapZoom;
    // regions: a faint wash and a dashed ink border
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 4]);
    REGIONS.forEach((r, n) => {
      ctx.beginPath();
      for (const [x, z] of r.poly) ctx.lineTo(...this.toBig(x, z));
      ctx.closePath();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = REGION_TINT[n % REGION_TINT.length];
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = INK_A(0.55);
      ctx.stroke();
    });
    // roads as dotted ink
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = INK_A(0.7);
    ctx.beginPath();
    for (const [ax, az, bx, bz] of ROADS) {
      ctx.moveTo(...this.toBig(ax, az));
      ctx.lineTo(...this.toBig(bx, bz));
    }
    ctx.stroke();
    ctx.restore();
    this.drawStructures(ctx, pxPer, S);
    ctx.textAlign = 'center';
    // ponytail: greedy declutter, labels that would overlap one already drawn are skipped (regions win, then
    // towns, zones, camps); zooming in frees room so the rest appear. O(n^2) over ~50 labels.
    const taken: number[][] = [];
    const tag = (t: string, x: number, y: number, px = 12, font = 'bold', spacing = '0px') => {
      ctx.font = `${font} ${px}px Georgia, serif`;
      ctx.letterSpacing = spacing;
      const w = ctx.measureText(t).width / 2 + 3;
      if (!taken.some(([a, b, c, d]) => x - w < c && x + w > a && y - px < d && y + 3 > b)) {
        taken.push([x - w, y - px, x + w, y + 3]);
        this.label(ctx, t, x, y);
      }
      ctx.letterSpacing = '0px';
    };
    const inView = (x: number, y: number, m = 80) => x > -m && y > -20 && x < S + m && y < S + 20;
    // labels by zoom: regions far out, towns and zones mid, camps, raids and quests close
    if (zoom < 3) for (const r of REGIONS) {
      const [x, y] = this.toBig(r.x, r.z);
      tag(r.name.toUpperCase(), x, y, Math.round(Math.min(26, 14 + 6 * zoom)), 'italic 600', '5px');
      tag(r.levels, x, y + 16, 11, 'italic');
    }
    const mid = zoom >= 1.4 || !REGIONS.length;
    const towns = TOWNS.map((t) => [...this.toBig(t.x, t.z), t] as const);
    if (mid) for (const [x, y, t] of towns) tag(zoneName(t.name, lang), x, y - 13, 13);
    ctx.save();
    ctx.strokeStyle = INK_A(0.45);
    ctx.setLineDash([3, 4]);
    for (const z of ZONES) {
      const [x, y] = this.toBig(z.x, z.z);
      ctx.beginPath();
      ctx.arc(x, y, z.r * pxPer, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    if (mid) for (const z of ZONES) {
      const [x, y] = this.toBig(z.x, z.z);
      if (inView(x, y)) tag(`${zoneName(z.name, lang)} (${z.levels})`, x, y, 12, 'italic bold');
    }
    for (const [x, y] of towns) this.townIcon(ctx, x, y);
    // hostile camps and raid lairs: the icon always, the name only close in and where it fits
    const close = zoom >= 3;
    for (const r of Object.values(RAIDS)) {
      const [x, y] = this.toBig(r.x, r.z);
      this.raidIcon(ctx, x, y);
      if (close) tag(lang === 'en' ? r.nameEn : r.name, x, y - 12, 11, 'italic bold');
    }
    for (const c of CAMPS) {
      const [x, y] = this.toBig(c.x, c.z);
      this.campIcon(ctx, x, y, close ? 8 : 6);
      if (close) tag(`${campName(c.id, lang)} (${tx('Nv', 'Lv')} ${c.level})`, x, y - 12, 11);
    }
    // quest hunting areas: always outlined, named once zoomed in
    for (const { zone, quests } of questAreas(this.g.questTargets())) {
      const [x, y] = this.toBig(zone.x, zone.z), r = zone.r * 0.85 * pxPer;
      ctx.fillStyle = 'rgba(200, 120, 0, 0.16)';
      ctx.strokeStyle = 'rgba(150, 60, 10, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
      if (zoom >= 2) quests.forEach((q, i) => tag(q, x, y + 18 + i * 14));
    }
    // quest givers, as over their heads (! to take, ? to hand in); one waiting for a finished quest is larger and named
    for (const n of NPCS) {
      const qm = this.g.questMarkerFor(n.id);
      if (!qm) continue;
      const [x, y] = this.toBig(n.x, n.z), ready = qm === 'ready';
      if (!inView(x, y, 20)) continue;
      drawQuestMark(ctx, x, y, qm, ready ? 22 : 15);
      if (ready || zoom >= 2) tag(n.name, x, y - (ready ? 20 : 14), 11);
    }
    this.drawRoute(ctx, (x, z) => this.toBig(x, z));
    // other players, as far as the server tells us about them (those in view): the party in green, with names
    const partyIds = new Set(this.g.ui.partyIds());
    ctx.font = 'bold 11px Tahoma, sans-serif';
    ctx.strokeStyle = '#000';
    for (const c of this.g.ents.values()) {
      if (c.rec.k !== 'p' || c.id === this.g.me.id) continue;
      const [x, y] = this.toBig(c.pos.x, c.pos.z), mate = partyIds.has(c.id);
      ctx.strokeStyle = '#000';
      ctx.fillStyle = mate ? '#2a9a48' : c.flags & F_RED ? '#ff2222' : '#66aaff';
      ctx.beginPath();
      ctx.arc(x, y, mate ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (mate) this.label(ctx, c.rec.n, x, y - 8);
    }
    // aged edges: a brown vignette and two compass roses
    const v = ctx.createRadialGradient(S / 2, S / 2, S * 0.38, S / 2, S / 2, S * 0.75);
    v.addColorStop(0, 'rgba(90, 55, 20, 0)');
    v.addColorStop(1, 'rgba(90, 55, 20, 0.5)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, S, S);
    this.compass(ctx, S - 52, 52, 36);
    this.compass(ctx, 34, S - 34, 22);
  }

  /** Houses, walls and trees, drawn as shapes so they stay sharp once the map is zoomed in. */
  private drawStructures(ctx: CanvasRenderingContext2D, pxPer: number, S: number) {
    const seen = (x: number, y: number, m = 8) => x > -m && y > -m && x < S + m && y < S + m;
    if (this.mapZoom >= 2.2) {
      ctx.fillStyle = 'rgba(20, 58, 26, 0.85)';
      for (const t of layoutTrees()) {
        const [x, y] = this.toBig(t.x, t.z);
        if (!seen(x, y)) continue;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, 1.15 * t.sc * pxPer), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const town = layoutTown();
    ctx.strokeStyle = '#4a321c';
    ctx.lineWidth = Math.max(1.2, 0.85 * pxPer);
    ctx.beginPath();
    const strokeWall = (w: { x: number; z: number; rot: number; hw?: number }) => {
      const [x, y] = this.toBig(w.x, w.z);
      if (!seen(x, y, 16)) return;
      const hw = (w.hw ?? 3.6) * pxPer;
      const dx = Math.cos(w.rot) * hw, dy = -Math.sin(w.rot) * hw;
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
    };
    for (const w of town.walls) if (!w.tower) strokeWall(w);
    for (const c of layoutCamps()) for (const w of c.walls) strokeWall(w);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(20, 14, 10, 0.9)';
    const rect = (x: number, z: number, rw: number, rd: number, rot: number, fill: string) => {
      const [cx, cy] = this.toBig(x, z);
      if (!seen(cx, cy, 20)) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rot);
      ctx.fillStyle = fill;
      ctx.fillRect((-rw / 2) * pxPer, (-rd / 2) * pxPer, rw * pxPer, rd * pxPer);
      ctx.strokeRect((-rw / 2) * pxPer, (-rd / 2) * pxPer, rw * pxPer, rd * pxPer);
      ctx.restore();
    };
    for (const w of town.walls) if (w.tower) {
      const rw = w.hw != null ? w.hw * 2 : 2.8;
      const rd = w.hd != null ? w.hd * 2 : rw;
      rect(w.x, w.z, rw, rd, w.rot, w.out ? '#8a3a2a' : '#9a9488');
    }
    for (const h of town.houses) {
      rect(h.x, h.z, h.w + 1, h.d + 1.2, h.rot, css(h.roof));
      rect(h.x, h.z, h.w + 1, 0.01, h.rot, '#000');
    }
    for (const st of town.stalls) rect(st.x, st.z, 3.4, 1.8, st.rot, css(st.color));
    rect(TOWN.x + BELL_TOWER.x, TOWN.z + BELL_TOWER.z, BELL_TOWER.hw * 2, BELL_TOWER.hd * 2, BELL_TOWER.rot, '#5a5a62');
    for (const c of layoutCamps()) for (const t of c.tents) {
      const [cx, cy] = this.toBig(t.x, t.z);
      if (!seen(cx, cy, 12)) continue;
      ctx.fillStyle = '#7a6040';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.3 * pxPer, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** A little inked keep: a walled block with three merlons and a gate. */
  private townIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#e8d2a0';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(x - 7, y - 5, 14, 11);
    for (let i = 0; i < 3; i++) ctx.rect(x - 7 + i * 5.5, y - 8, 3, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillRect(x - 1.5, y + 1, 3, 5);
    ctx.lineWidth = 1;
  }

  /** A raid lair: a dark cave mouth in a crag. */
  private raidIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#6a3a22';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y + 6);
    ctx.lineTo(x - 3, y - 7);
    ctx.lineTo(x + 3, y - 7);
    ctx.lineTo(x + 8, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#120806';
    ctx.beginPath();
    ctx.arc(x, y + 6, 3.5, Math.PI, 0);
    ctx.fill();
    ctx.lineWidth = 1;
  }

  /** An eight-point compass rose in ink, N on top. */
  private compass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const len = i % 2 ? r * 0.55 : r, w = r * (i % 2 ? 0.1 : 0.16);
      ctx.save();
      ctx.rotate((i * Math.PI) / 4);
      for (const sd of [-1, 1]) {
        ctx.fillStyle = sd < 0 ? INK : '#e8d6aa';
        ctx.beginPath();
        ctx.moveTo(0, -len);
        ctx.lineTo(sd * w, -w);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.font = `bold ${Math.round(r * 0.4)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.fillText('N', 0, -r - 3);
    ctx.restore();
  }

  /** Crossed swords on a red disc. */
  private campIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.fillStyle = '#8a1a14';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#f0e0c0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y - r * 0.55); ctx.lineTo(x + r * 0.55, y + r * 0.55);
    ctx.moveTo(x + r * 0.55, y - r * 0.55); ctx.lineTo(x - r * 0.55, y + r * 0.55);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  /** The map route: a dashed line along the path that will be walked, with a numbered pin on each stop. */
  private drawRoute(ctx: CanvasRenderingContext2D, at: (x: number, z: number) => number[]) {
    const pts = this.routePts, stops = this.g.route;
    if (pts.length < 2 || !stops.length) return;
    ctx.save();
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.setLineDash([6, 5]);
    for (const [w, c] of [[4.5, 'rgba(0,0,0,0.65)'], [2, '#ffe07a']] as const) {
      ctx.lineWidth = w;
      ctx.strokeStyle = c;
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = at(p.x, p.z);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = 'bold 9px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    // the stops the player picked (a long trip's legs are only on the way)
    stops.filter((s) => !s.leg).forEach((s, i) => {
      const [x, y] = at(s.x, s.z);
      ctx.fillStyle = '#ffe07a';
      ctx.strokeStyle = '#1a1206';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1a1206';
      ctx.fillText(String(i + 1), x, y + 3);
    });
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, t: string, x: number, y: number) {
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(240, 226, 190, 0.85)';
    ctx.strokeText(t, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(t, x, y);
    ctx.lineWidth = 1;
  }

  update(now: number) {
    this.face();
    if (now - this.lastDraw < 150) return;
    this.lastDraw = now;
    const self = this.g.self;
    this.zoneEl.textContent = zoneName(this.g.me.zone, lang);
    this.raidBtn.style.display = Object.values(RAIDS).some((r) => r.name === this.g.me.zone) ? '' : 'none'; // inside one, the zone is the raid's name
    const clock = settings.s.dayNight ? gameClock() : '';
    if (this.clockEl.textContent !== clock) {
      this.clockEl.textContent = clock;
      this.clockEl.style.display = clock ? '' : 'none';
      this.clockEl.classList.toggle('night', clock < '06:00' || clock >= '18:00');
    }
    if (!self) return;
    const ctx = this.canvas.getContext('2d')!;
    const W = MM;
    ctx.setTransform(this.canvas.width / MM, 0, 0, this.canvas.width / MM, 0, 0);
    const R = this.viewR;
    const px = self.pos.x, pz = self.pos.z;
    const scale = W / (2 * R);
    ctx.fillStyle = `rgb(${SEA})`;
    ctx.fillRect(0, 0, W, W);
    const srcR = (R / (2 * WORLD_HALF)) * RES;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, toMap(px) - srcR, toMap(pz) - srcR, srcR * 2, srcR * 2, 0, 0, W, W);
    const toC = (x: number, z: number) => [(x - px) * scale + W / 2, (z - pz) * scale + W / 2];
    // everything built or planted is drawn as shapes on top, so it stays crisp at any zoom
    const seen = (x: number, y: number, m = 6) => x > -m && y > -m && x < W + m && y < W + m;
    ctx.fillStyle = 'rgba(24, 62, 30, 0.8)';
    for (const t of layoutTrees()) {
      const [x, y] = toC(t.x, t.z);
      if (!seen(x, y)) continue;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.9, 1.1 * t.sc * scale), 0, Math.PI * 2);
      ctx.fill();
    }
    const town = layoutTown();
    ctx.strokeStyle = '#4a321c';
    ctx.lineWidth = Math.max(1.6, 0.9 * scale);
    ctx.beginPath();
    const strokeWall = (w: { x: number; z: number; rot: number; hw?: number }) => {
      const [x, y] = toC(w.x, w.z);
      if (!seen(x, y, 12)) return;
      const hw = w.hw ?? 3.6;
      const dx = Math.cos(w.rot) * hw * scale, dy = -Math.sin(w.rot) * hw * scale;
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
    };
    for (const w of town.walls) if (!w.tower) strokeWall(w);
    for (const c of layoutCamps()) for (const w of c.walls) strokeWall(w);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(20, 14, 10, 0.9)';
    const rect = (x: number, z: number, rw: number, rd: number, rot: number, fill: string) => {
      const [cx, cy] = toC(x, z);
      if (!seen(cx, cy, 12)) return;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rot);
      ctx.fillStyle = fill;
      ctx.fillRect((-rw / 2) * scale, (-rd / 2) * scale, rw * scale, rd * scale);
      ctx.strokeRect((-rw / 2) * scale, (-rd / 2) * scale, rw * scale, rd * scale);
      ctx.restore();
    };
    for (const w of town.walls) if (w.tower) {
      const rw = w.hw != null ? w.hw * 2 : 2.8;
      const rd = w.hd != null ? w.hd * 2 : rw;
      rect(w.x, w.z, rw, rd, w.rot, w.out ? '#8a3a2a' : '#9a9488');
    }
    for (const h of town.houses) {
      rect(h.x, h.z, h.w + 1, h.d + 1.2, h.rot, css(h.roof));
      rect(h.x, h.z, h.w + 1, 0.01, h.rot, '#000'); // roof ridge
    }
    for (const st of town.stalls) rect(st.x, st.z, 3.4, 1.8, st.rot, css(st.color));
    const disc = (x: number, z: number, r: number, fill: string) => {
      const [cx, cy] = toC(x, z);
      if (!seen(cx, cy, 12)) return;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    rect(TOWN.x + BELL_TOWER.x, TOWN.z + BELL_TOWER.z, BELL_TOWER.hw * 2, BELL_TOWER.hd * 2, BELL_TOWER.rot, '#5a5a62');
    for (const c of layoutCamps()) for (const t of c.tents) disc(t.x, t.z, 2.3, '#7a6040');
    // the path is recomputed a couple of times a second, not on every redraw
    if (now - this.routeAt > 500) {
      this.routeAt = now;
      this.routePts = this.g.routePath();
    }
    this.drawRoute(ctx, toC);
    // NPCs (always known)
    for (const n of NPCS) {
      const [x, y] = toC(n.x, n.z);
      const qm = this.g.questMarkerFor(n.id);
      if (qm) {
        // quest givers: ! / ? like over their heads; one waiting for a finished quest stays on the rim when out of
        // range, on the side it lies
        const dx = x - W / 2, dy = y - W / 2, dist = Math.hypot(dx, dy), rim = W / 2 - 9;
        if (dist <= rim) drawQuestMark(ctx, x, y, qm, 13);
        else if (qm === 'ready') drawQuestMark(ctx, W / 2 + (dx / dist) * rim, W / 2 + (dy / dist) * rim, qm, 12);
        continue;
      }
      ctx.fillStyle = '#ffd966';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // quest hunting areas (soft yellow) and quest mobs (yellow dots)
    const targets = this.g.questTargets();
    for (const { zone } of questAreas(targets)) {
      const [x, y] = toC(zone.x, zone.z);
      ctx.fillStyle = 'rgba(255, 210, 0, 0.13)';
      ctx.strokeStyle = 'rgba(255, 210, 0, 0.7)';
      ctx.beginPath();
      ctx.arc(x, y, zone.r * 0.85 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const questMob = (tpl: string) => targets.some((t) => t.mobs.has(tpl));
    for (const c of CAMPS) {
      const [x, y] = toC(c.x, c.z);
      if (x > -10 && y > -10 && x < W + 10 && y < W + 10) this.campIcon(ctx, x, y, 6);
    }
    const partyIds = new Set(this.g.ui.partyIds());
    for (const c of this.g.ents.values()) {
      if (c.id === this.g.me.id || c.rec.k === 'n') continue;
      const [x, y] = toC(c.pos.x, c.pos.z);
      if (x < 0 || y < 0 || x > W || y > W) continue;
      if (c.rec.k === 'm' && !(c.flags & F_DEAD) && questMob(c.rec.tpl)) {
        ctx.fillStyle = '#ffd200';
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        continue;
      }
      if (c.rec.k === 'm') ctx.fillStyle = c.flags & F_DEAD ? '#555' : '#ff5544';
      else if (c.rec.k === 'p') ctx.fillStyle = partyIds.has(c.id) ? '#66ff88' : c.flags & F_RED ? '#ff2222' : '#66aaff';
      else ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, c.rec.k === 'i' ? 1.2 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // darken toward the rim so the round frame reads as a lens
    const rim = ctx.createRadialGradient(W / 2, W / 2, W * 0.32, W / 2, W / 2, W / 2);
    rim.addColorStop(0, 'rgba(0,0,0,0)');
    rim.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, W, W);
    const coords = `${Math.round(px)}, ${Math.round(pz)}`;
    if (this.coordsEl.textContent !== coords) this.coordsEl.textContent = coords;
    this.drawBig();
  }
}
