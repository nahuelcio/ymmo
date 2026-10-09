import * as THREE from 'three';
import { heightAt } from '../../../shared/src/terrain';
import { settings } from '../settings';
import { getObstacles, type Obstacle } from '../../../shared/src/collision';

/** Solid walls the camera must not clip through: boxes (houses, walls) and big circles (rocks, huts, tents). Thin trunks are skipped. */
let walls: Obstacle[] | null = null;
// ponytail: obstacles are 2D, so their height is guessed from the shape (thick box = house with roof, thin box = wall or stall,
// circle = tent/hut/boulder about as tall as it is wide). Give Obstacle a real height if a prop reads wrong.
const topOf = (ob: Obstacle) => heightAt(ob.x, ob.z) + (ob.k === 'c' ? ob.r * 1.2 : ob.hd < 1 ? 4 : 6);
/**
 * Exact ground distance from (ax,az) towards the unit direction (dx,dz) to the first wall the camera arm really goes through,
 * or Infinity. The arm starts at height y0 and climbs `rise` per metre, so an obstacle it clears over the top doesn't count.
 */
function wallDist(ax: number, az: number, dx: number, dz: number, len: number, y0: number, rise: number, obs?: Obstacle[]): number {
  obs ??= walls ??= getObstacles().filter((o) => o.k === 'b' || o.r >= 1);
  let best = Infinity;
  for (const ob of obs) {
    const mx = ax - ob.x, mz = az - ob.z;
    let t0: number, t1: number;
    if (ob.k === 'c') {
      const b = mx * dx + mz * dz, s = Math.sqrt(b * b - (mx * mx + mz * mz - ob.r * ob.r));
      t0 = -b - s;
      t1 = -b + s;
    } else {
      // slab test in the box's local frame; a ray parallel to a side divides by zero, and the ±Infinity/NaN fall out below
      const ox = mx * ob.cos - mz * ob.sin, oz = mx * ob.sin + mz * ob.cos;
      const vx = dx * ob.cos - dz * ob.sin, vz = dx * ob.sin + dz * ob.cos;
      const x0 = (-ob.hw - ox) / vx, x1 = (ob.hw - ox) / vx, z0 = (-ob.hd - oz) / vz, z1 = (ob.hd - oz) / vz;
      t0 = Math.max(Math.min(x0, x1), Math.min(z0, z1));
      t1 = Math.min(Math.max(x0, x1), Math.max(z0, z1));
    }
    if (!(t0 <= t1 && t1 >= 0)) continue; // missed, behind the origin, or NaN
    const t = Math.max(0, t0);
    // the arm only climbs, so it is lowest where it enters
    if (t < best && y0 + rise * t < topOf(ob)) best = t;
  }
  return best < len ? best : Infinity;
}
if (import.meta.env.DEV) {
  const box: Obstacle[] = [{ k: 'b', x: 5, z: 0, hw: 1, hd: 0.1, rot: 0, cos: 1, sin: 0 }, { k: 'c', x: 0, z: 10, r: 2 }];
  console.assert(wallDist(0, 0, 1, 0, 20, -1e9, 0, box) === 4, 'wallDist: thin box');
  console.assert(wallDist(0, 0, 0, 1, 20, -1e9, 0, box) === 8, 'wallDist: circle');
  console.assert(wallDist(0, 0, 1, 0, 3, -1e9, 0, box) === Infinity && wallDist(0, 0, -1, 0, 20, -1e9, 0, box) === Infinity, 'wallDist: out of reach / behind');
  console.assert(wallDist(0, 0, 1, 0, 20, 1e9, 0, box) === Infinity, 'wallDist: over the top');
}

/** L2-style third person orbit camera: right-drag rotates, wheel zooms. */
export class CameraController {
  yaw = Math.PI;
  pitch = 0.45;
  dist = 14;
  private targetDist = 14;
  private focus = new THREE.Vector3();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  keys = { left: false, right: false, up: false, down: false };
  private shakeAmt = 0;
  /** distance the camera is allowed to sit from the focus; eases in fast when a wall blocks, out slowly */
  private capD = 14;

  /** Short camera shake (e.g. when taking a critical hit). */
  shake(amount: number) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  /** Touch gestures (mobile only): one finger drags the camera, two fingers pinch-zoom. */
  private touches = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  /** true once the current touch gesture moved enough to count as a drag (so it isn't a tap) */
  touchDragged = false;
  private touchStart = { x: 0, y: 0 };

  constructor(public camera: THREE.PerspectiveCamera, el: HTMLElement) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 1) {
        this.touchDragged = false;
        this.touchStart = { x: e.clientX, y: e.clientY };
      }
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.touchDragged = true;
      }
    });
    el.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      if (this.touches.size === 1) {
        if (Math.hypot(e.clientX - this.touchStart.x, e.clientY - this.touchStart.y) > 10) this.touchDragged = true;
        if (this.touchDragged) {
          const k = settings.s.camSensitivity, inv = settings.s.invertY ? -1 : 1;
          this.yaw -= (e.clientX - t.x) * 0.008 * k;
          this.pitch = Math.min(1.35, Math.max(0.05, this.pitch + (e.clientY - t.y) * 0.006 * k * inv));
        }
      }
      t.x = e.clientX;
      t.y = e.clientY;
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0) this.targetDist = Math.min(40, Math.max(4, this.targetDist * (this.pinch / d)));
        this.pinch = d;
      }
    });
    const end = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const k = settings.s.camSensitivity, inv = settings.s.invertY ? -1 : 1;
      this.yaw -= (e.clientX - this.lastX) * 0.006 * k;
      this.pitch = Math.min(1.35, Math.max(0.05, this.pitch + (e.clientY - this.lastY) * 0.005 * k * inv));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    el.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.dragging = false;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.targetDist = Math.min(40, Math.max(4, this.targetDist * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: false });
  }

  snap(p: THREE.Vector3) {
    this.focus.copy(p);
  }

  update(dt: number, p: THREE.Vector3) {
    if (this.keys.left) this.yaw += dt * 2;
    if (this.keys.right) this.yaw -= dt * 2;
    if (this.keys.up) this.pitch = Math.min(1.35, this.pitch + dt);
    if (this.keys.down) this.pitch = Math.max(0.05, this.pitch - dt);
    const prevDist = this.dist;
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 10);
    this.focus.lerp(p, Math.min(1, dt * 12));
    const f = this.focus;
    const sy = Math.sin(this.yaw), cyaw = Math.cos(this.yaw), cp = Math.cos(this.pitch);
    // walls are 2D: the hit is a ground distance, so it is converted to a distance along the pitched camera arm
    const hit = wallDist(f.x, f.z, sy, cyaw, cp * this.dist, f.y + 1.6, Math.tan(this.pitch));
    const want = Math.min(this.dist, Math.max(1.2, (hit - 0.5) / cp));
    // with nothing in the way the cap follows a manual zoom-out directly, instead of at the slow ease-out rate
    if (want === this.dist) this.capD += Math.max(0, this.dist - prevDist);
    this.capD += (want - this.capD) * Math.min(1, dt * (want < this.capD ? 18 : 4));
    const d = Math.min(this.dist, this.capD);
    const cx = f.x + sy * cp * d;
    const cz = f.z + cyaw * cp * d;
    let cy = f.y + 1.6 + Math.sin(this.pitch) * d;
    cy = Math.max(cy, heightAt(cx, cz) + 0.8);
    this.camera.position.set(cx, cy, cz);
    if (this.shakeAmt > 0.001) {
      const a = this.shakeAmt;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.shakeAmt *= Math.max(0, 1 - dt * 9);
    }
    this.camera.lookAt(f.x, f.y + 1.6, f.z);
  }
}
