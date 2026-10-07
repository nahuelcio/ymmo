import { NPCS, ZONES, type ZoneDef } from '../../../shared/src/data/world';
import { CAMPS } from '../../../shared/src/data/camps';
import { F_DEAD } from '../../../shared/src/protocol';
import { heightAt, TOWN, WATER_LEVEL, WORLD_HALF } from '../../../shared/src/terrain';
import { F_RED, type Game } from '../game';
import { groundColor } from '../render/scene';
import { el, Win } from './dom';
import { lang, t as tx } from '../lang';
import { campName, zoneName } from '../../../shared/src/i18n';

const RES = 256;

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
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const x = (i / RES) * 2 * WORLD_HALF - WORLD_HALF, z = (j / RES) * 2 * WORLD_HALF - WORLD_HALF;
      const h = heightAt(x, z);
      const [r, g, b] = h < WATER_LEVEL ? [0.25, 0.48, 0.7] : groundColor(x, z, h);
      const shade = 0.85 + Math.min(0.3, h / 120);
      const o = (j * RES + i) * 4;
      img.data[o] = Math.min(255, r * 255 * shade);
      img.data[o + 1] = Math.min(255, g * 255 * shade);
      img.data[o + 2] = Math.min(255, b * 255 * shade);
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

const toMap = (v: number) => ((v + WORLD_HALF) / (2 * WORLD_HALF)) * RES;

export class Minimap {
  private img = worldImage();
  private canvas: HTMLCanvasElement;
  private zoneEl: HTMLDivElement;
  private viewR = 110;
  private mapWin: Win;
  private bigCanvas: HTMLCanvasElement;
  private lastDraw = 0;

  constructor(private g: Game, root: HTMLElement) {
    const box = el('div', 'panel minimap', root);
    this.zoneEl = el('div', 'mm-zone', box);
    this.canvas = el('canvas', 'mm-canvas', box);
    this.canvas.width = this.canvas.height = 170;
    const zoom = el('div', 'mm-zoom', box);
    const zin = el('button', 'btn small', zoom, '+');
    zin.onclick = () => (this.viewR = Math.max(40, this.viewR * 0.75));
    const zout = el('button', 'btn small', zoom, '−');
    zout.onclick = () => (this.viewR = Math.min(300, this.viewR / 0.75));
    this.canvas.onclick = () => this.toggleMap();

    this.mapWin = new Win('worldmap', tx('Mapa del Mundo — Frontera de Aden', 'World Map — Aden Frontier'), 200, 60, 540, root);
    this.bigCanvas = el('canvas', 'big-map', this.mapWin.body);
    this.bigCanvas.width = this.bigCanvas.height = 512;
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
    ctx.beginPath();
    ctx.arc(toMap(TOWN.x) * S, toMap(TOWN.z) * S, 6, 0, Math.PI * 2);
    ctx.fill();
    this.label(ctx, zoneName(TOWN.name, lang), toMap(TOWN.x) * S, toMap(TOWN.z) * S - 12);
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
      quests.forEach((q, i) => this.label(ctx, `★ ${q}`, x, y + 18 + i * 14));
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
    if (!self) return;
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const R = this.viewR;
    const px = self.pos.x, pz = self.pos.z;
    const scale = W / (2 * R);
    ctx.fillStyle = '#10131a';
    ctx.fillRect(0, 0, W, W);
    const srcR = (R / (2 * WORLD_HALF)) * RES;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.img, toMap(px) - srcR, toMap(pz) - srcR, srcR * 2, srcR * 2, 0, 0, W, W);
    const toC = (x: number, z: number) => [(x - px) * scale + W / 2, (z - pz) * scale + W / 2];
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
    this.arrow(ctx, W / 2, W / 2, self.ry, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, W - 14, W, 14);
    ctx.fillStyle = '#cfd6e6';
    ctx.font = '10px Tahoma, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(px)}, ${Math.round(pz)}`, W / 2, W - 3);
    this.drawBig();
  }
}
