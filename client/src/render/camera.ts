import * as THREE from 'three';
import { heightAt } from '../../../shared/src/terrain';
import { settings } from '../settings';

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
    this.dist += (this.targetDist - this.dist) * Math.min(1, dt * 10);
    this.focus.lerp(p, Math.min(1, dt * 12));
    const f = this.focus;
    const cx = f.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist;
    const cz = f.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist;
    let cy = f.y + 1.6 + Math.sin(this.pitch) * this.dist;
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
