import { NPCS, ZONES, type ZoneDef } from '../../../shared/src/data/world';
import { CAMPS } from '../../../shared/src/data/camps';
import { RAIDS } from '../../../shared/src/data/raids';
import { F_DEAD } from '../../../shared/src/protocol';
import { heightAt, TOWN, TOWNS, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { layoutCamps, layoutTown, layoutTrees } from '../../../shared/src/layout';
import { F_RED, type Game } from '../game';
import { groundColor } from '../render/scene';
import { el, Win } from './dom';
import { lang, t as tx } from '../lang';
import { settings } from '../settings';
import { gameClock } from '../render/atmos';
import { campName, zoneName } from '../../../shared/src/i18n';

const RES = 512;
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

function worldImage(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = RES;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(RES, RES);
  const at = (i: number) => (i / RES) * 2 * WORLD_HALF - WORLD_HALF;
  const hs = new Float32Array(RES * RES);
  for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) hs[j * RES + i] = heightAt(at(i), at(j));
  const hAt = (i: number, j: number) => hs[Math.min(RES - 1, Math.max(0, j)) * RES + Math.min(RES - 1, Math.max(0, i))];
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const h = hs[j * RES + i];
      const [r, g, b] = h < WATER_LEVEL ? [0.25, 0.48, 0.7] : groundColor(at(i), at(j), h);
      // relief: slopes facing the north-west light are brighter, the far sides fall into shade
      const slope = hAt(i + 1, j) - hAt(i - 1, j) + hAt(i, j + 1) - hAt(i, j - 1);
      const shade = h < WATER_LEVEL ? 1 : (0.9 + Math.min(0.25, h / 140)) * Math.min(1.3, Math.max(0.62, 1 - slope * 0.11));
      const o = (j * RES + i) * 4;
      img.data[o] = Math.min(255, r * 255 * shade);
      img.data[o + 1] = Math.min(255, g * 255 * shade);
      img.data[o + 2] = Math.min(255, b * 255 * shade);
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

const toMap = (v: number) => ((v + WORLD_HALF) / (2 * WORLD_HALF)) * RES;

export class Minimap {
  private img = worldImage();
  private canvas: HTMLCanvasElement;
  private zoneEl: HTMLDivElement;
  private coordsEl: HTMLDivElement;
  private clockEl: HTMLDivElement;
  private viewR = 110;
  private mapWin: Win;
  private bigCanvas: HTMLCanvasElement;
  private lastDraw = 0;
  private routePts: { x: number; z: number }[] = [];
  private routeAt = 0;
  private raidBtn: HTMLButtonElement;

  constructor(private g: Game, root: HTMLElement) {
    const box = el('div', 'panel minimap', root);
    this.zoneEl = el('div', 'mm-zone', box);
    this.canvas = el('canvas', 'mm-canvas', box);
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

    this.mapWin = new Win('worldmap', tx('Mapa del Mundo — Frontera de Aden', 'World Map — Aden Frontier'), 200, 60, 540, root);
    this.bigCanvas = el('canvas', 'big-map', this.mapWin.body);
    this.bigCanvas.width = this.bigCanvas.height = 512;
    // click the map to walk there; Ctrl+click adds a stop (Shift is the roll key); right click clears the route
    this.bigCanvas.onclick = (e) => {
      const k = (2 * WORLD_HALF) / this.bigCanvas.clientWidth;
      g.travel(e.offsetX * k - WORLD_HALF, e.offsetY * k - WORLD_HALF, e.ctrlKey || e.metaKey);
      this.routeAt = 0;
    };
    this.bigCanvas.oncontextmenu = (e) => {
      e.preventDefault();
      g.stop();
      this.routeAt = 0;
    };
    el('div', 'hint', this.mapWin.body, tx('Click: caminar hasta ahí · Ctrl+click: agregar una parada · Click derecho: cancelar la ruta',
      'Click: walk there · Ctrl+click: add a stop · Right click: cancel the route'));
  }

  toggleMap() {
    this.mapWin.toggle();
    this.drawBig();
  }

  private drawBig() {
    if (!this.mapWin.visible) return;
    const ctx = this.bigCanvas.getContext('2d')!;
    const S = 512 / RES;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.img, 0, 0, 512, 512);
    ctx.font = 'bold 12px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    for (const z of ZONES) {
      ctx.strokeStyle = 'rgba(255,220,140,0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(toMap(z.x) * S, toMap(z.z) * S, (z.r / (2 * WORLD_HALF)) * 512, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      this.label(ctx, `${zoneName(z.name, lang)} (${z.levels})`, toMap(z.x) * S, toMap(z.z) * S);
    }
    ctx.fillStyle = '#ffd966';
    for (const t of TOWNS) {
      ctx.beginPath();
      ctx.arc(toMap(t.x) * S, toMap(t.z) * S, 6, 0, Math.PI * 2);
      ctx.fill();
      this.label(ctx, zoneName(t.name, lang), toMap(t.x) * S, toMap(t.z) * S - 12);
    }
    // hostile camps
    for (const c of CAMPS) {
      const x = toMap(c.x) * S, y = toMap(c.z) * S;
      this.campIcon(ctx, x, y, 9);
      this.label(ctx, `${campName(c.id, lang)} (${tx('Nv', 'Lv')} ${c.level})`, x, y - 12);
    }
    // quest hunting areas
    for (const { zone, quests } of questAreas(this.g.questTargets())) {
      const x = toMap(zone.x) * S, y = toMap(zone.z) * S, r = (zone.r * 0.85 / (2 * WORLD_HALF)) * 512;
      ctx.fillStyle = 'rgba(255, 210, 0, 0.18)';
      ctx.strokeStyle = 'rgba(255, 210, 0, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
      quests.forEach((q, i) => this.label(ctx, q, x, y + 18 + i * 14));
    }
    this.drawRoute(ctx, (x, z) => [toMap(x) * S, toMap(z) * S]);
    // other players, as far as the server tells us about them (those in view): the party in green, with names
    const partyIds = new Set(this.g.ui.partyIds());
    ctx.font = 'bold 11px Tahoma, sans-serif';
    ctx.strokeStyle = '#000';
    for (const c of this.g.ents.values()) {
      if (c.rec.k !== 'p' || c.id === this.g.me.id) continue;
      const x = toMap(c.pos.x) * S, y = toMap(c.pos.z) * S, mate = partyIds.has(c.id);
      ctx.fillStyle = mate ? '#66ff88' : c.flags & F_RED ? '#ff2222' : '#66aaff';
      ctx.beginPath();
      ctx.arc(x, y, mate ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (mate) this.label(ctx, c.rec.n, x, y - 8);
    }
    const self = this.g.self;
    if (self) this.arrow(ctx, toMap(self.pos.x) * S, toMap(self.pos.z) * S, self.ry, 7);
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
    stops.forEach((s, i) => {
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
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(t, x + 1, y + 1);
    ctx.fillStyle = '#fff4d0';
    ctx.fillText(t, x, y);
  }

  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, ry: number, s: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-ry + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, s);
    ctx.lineTo(0, s * 0.5);
    ctx.lineTo(-s * 0.7, s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  update(now: number) {
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
    ctx.fillStyle = '#10131a';
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
    const segs = [...town.walls, ...layoutCamps().flatMap((c) => c.walls)];
    ctx.strokeStyle = '#4a321c';
    ctx.lineWidth = Math.max(1.6, 0.9 * scale);
    ctx.beginPath();
    for (const w of segs) {
      const [x, y] = toC(w.x, w.z);
      if (!seen(x, y, 12)) continue;
      const dx = Math.cos(w.rot) * 3.6 * scale, dy = -Math.sin(w.rot) * 3.6 * scale;
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
    }
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
    for (const w of town.walls) if (w.tower) rect(w.x, w.z, 2.8, 2.8, w.rot, '#8a3a2a');
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
    disc(TOWN.x, TOWN.z, 4.4, '#bab4a6');
    disc(TOWN.x, TOWN.z, 3.4, '#4a90c8');
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
        // quest givers: ! / ? like over their heads
        ctx.font = 'bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        const ch = qm === 'ready' || qm === 'active' ? '?' : '!';
        ctx.strokeText(ch, x, y + 5);
        ctx.fillStyle = qm === 'ready' || qm === 'available' ? '#ffd200' : '#9a9a9a';
        ctx.fillText(ch, x, y + 5);
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
    this.arrow(ctx, W / 2, W / 2, self.ry, 7);
    const coords = `${Math.round(px)}, ${Math.round(pz)}`;
    if (this.coordsEl.textContent !== coords) this.coordsEl.textContent = coords;
    this.drawBig();
  }
}
