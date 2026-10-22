// Touch screens: a long press on an item or a skill picks it up, and the finger drags it onto the skill bar. The
// browser's own drag and drop is unreliable on phones, and the windows there cover the bar (full-width sheets almost
// the screen's height): while dragging they fade out of the way and let touches through to the bar under them.
import type { Game } from '../game';
import { hideTip } from './dom';
import type { Slot } from './hud';
import { isTouchDevice } from './touch';

/** how long the finger has to rest before it picks the thing up, and how far it may move meanwhile (else: a scroll) */
const HOLD_MS = 300, SLOP = 10;

/** Make `el` draggable to the bar by touch: `slot()` is what it puts there (none: not draggable now), `icon()` the
 * picture that follows the finger. Desktops keep the native drag and drop. */
export function touchBarDrag(g: Game, el: HTMLElement, slot: () => Slot, icon: () => HTMLElement) {
  if (!isTouchDevice()) return;
  el.draggable = false; // the native drag would fight this one
  let timer = 0, sx = 0, sy = 0, swallow = false;
  let ghost: HTMLElement | null = null, over: { b: number; i: number; el: HTMLElement } | null = null;
  const hover = (x: number, y: number) => {
    ghost!.style.left = `${x}px`;
    ghost!.style.top = `${y}px`;
    const at = g.ui.hud.slotUnder(x, y);
    if (at?.el !== over?.el) {
      over?.el.classList.remove('drop-target');
      at?.el.classList.add('drop-target');
    }
    over = at;
  };
  const pickUp = () => {
    timer = 0;
    const s = slot();
    if (!s) return;
    hideTip();
    ghost = icon();
    ghost.classList.add('bar-ghost');
    document.body.append(ghost);
    document.body.classList.add('bar-dragging');
    navigator.vibrate?.(15);
    hover(sx, sy);
  };
  const end = (drop: boolean) => {
    clearTimeout(timer);
    timer = 0;
    if (!ghost) return;
    const s = slot();
    if (drop && over && s) g.ui.hud.placeOnBar(over.b, over.i, { slot: s });
    over?.el.classList.remove('drop-target');
    over = null;
    ghost.remove();
    ghost = null;
    document.body.classList.remove('bar-dragging');
  };
  el.addEventListener('touchstart', (e) => {
    swallow = false;
    if (e.touches.length !== 1 || !slot()) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    timer = window.setTimeout(pickUp, HOLD_MS);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!ghost) {
      // moving before the hold is up: it is a scroll of the list, not a drag
      if (timer && Math.hypot(t.clientX - sx, t.clientY - sy) > SLOP) (clearTimeout(timer), (timer = 0));
      return;
    }
    e.preventDefault(); // picked up: the list stays put under the finger
    hover(t.clientX, t.clientY);
  }, { passive: false });
  el.addEventListener('touchend', (e) => {
    if (ghost) {
      e.preventDefault();
      swallow = true; // the tap a long press ends in: not a tap on the item
    }
    end(true);
  });
  el.addEventListener('touchcancel', () => end(false));
  // a long press is a right click on Android, and its release a click: neither opens the item's menu after a drag
  el.addEventListener('contextmenu', (e) => {
    if (ghost || timer || swallow) (e.preventDefault(), e.stopImmediatePropagation());
  }, true);
  el.addEventListener('click', (e) => {
    if (swallow) (e.preventDefault(), e.stopImmediatePropagation(), (swallow = false));
  }, true);
}
