import type { Game } from '../game';
import { el } from './dom';

/** Phones and tablets (coarse pointer / touch screen). Desktop never sees the touch UI. */
export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
}

/** Mobile controls: a virtual joystick on the left and big action buttons on the right. */
export class TouchControls {
  constructor(private g: Game, root: HTMLElement) {
    document.body.classList.add('touch');
    this.joystick(root);
    const pad = el('div', 'touch-actions', root);
    const btn = (cls: string, icon: string, label: string, fn: () => void) => {
      const b = el('button', `touch-btn ${cls}`, pad);
      el('span', 'tb-icon', b, icon);
      el('span', 'tb-label', b, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('pressed');
        fn();
      });
      const up = () => b.classList.remove('pressed');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    };
    btn('tb-attack', '⚔️', 'Atacar', () => g.attackTarget());
    btn('tb-dash', '💨', 'Rodar', () => g.dash());
    btn('tb-target', '🎯', 'Objetivo', () => g.nextTarget());
    btn('tb-loot', '✋', 'Juntar', () => g.pickupNearest());
  }

  private joystick(root: HTMLElement) {
    const base = el('div', 'joy-base', root);
    const knob = el('div', 'joy-knob', base);
    const R = 52;
    let id: number | null = null, cx = 0, cy = 0;
    const move = (x: number, y: number) => {
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.g.setJoystick(dx / R, dy / R);
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId;
      base.setPointerCapture(id);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      move(e.clientX, e.clientY);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.g.setJoystick(0, 0);
    };
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
  }
}
