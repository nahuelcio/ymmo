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

  constructor(public camera: THREE.PerspectiveCamera, el: HTMLElement) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
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
