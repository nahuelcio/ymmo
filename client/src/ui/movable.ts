import { t as tx } from '../lang';
import { el, Win } from './dom';
import { isTouchDevice } from './touch';

/** The interface's own scale (#ui zoom, Options > UI scale): pointer moves arrive in screen pixels, positions are in its own. */
export function uiScale(): number {
  const ui = document.getElementById('ui');
  return (ui && parseFloat(getComputedStyle(ui).zoom)) || 1;
}

const resets: (() => void)[] = [];
/** Something to put back when the player resets the layout (the status window has its own drag). */
export function onLayoutReset(fn: () => void) {
  resets.push(fn);
}
/** Puts every moved piece of the interface back where the layout has it, windows included (Options > Game & UI). */
export function resetLayout() {
  for (const r of resets) r();
  Win.resetAll();
}

/** Touch screens keep one layout held upright and one sideways: what fits one does not fit the other. */
const orientation = () => (innerHeight > innerWidth ? 'p' : 'l');
/** How long a finger rests on a block before it lifts, and how far it may wander meanwhile (more is a swipe or a camera turn). */
const HOLD_MS = 450, HOLD_SLOP = 10;

interface Spot { x: number; y?: number; b?: number }
interface MovableOpts {
  /** touch: where a long press may start (the hotbar only by its pager, never on a skill slot) */
  handle?: (target: Element) => boolean;
  /** after every placement: whatever follows the block (moved: false when it is back at its own spot) */
  placed?: (moved: boolean) => void;
}

/**
 * A HUD block the player can move. Desktop: a grip shows in its corner while the pointer is over it; dragging the
 * grip moves the block, a double click on it puts it back. Touch: a finger resting on the block (on its handle) for
 * HOLD_MS lifts it, with a buzz, and it follows the finger; a short tap stays a tap. Either way what is inside (chat,
 * bar slots, the minimap) keeps working. The spot is kept (localStorage hud:<id>, or hud:<id>:p / hud:<id>:l on touch
 * screens), anchored to the nearer edge, top or bottom, so a block that grows (the extra bars, the chat unfolding)
 * grows away from that edge, and what shows of it is kept on screen.
 */
export function makeMovable(box: HTMLElement, id: string, opts: MovableOpts = {}): void {
  const touch = isTouchDevice();
  box.classList.add('hud-movable');
  const keyOf = () => (touch ? `hud:${id}:${orientation()}` : `hud:${id}`);
  const load = (): Spot | null => {
    try {
      return JSON.parse(localStorage.getItem(keyOf()) ?? 'null');
    } catch {
      return null; // storage unavailable
    }
  };
  let key = keyOf();
  let at = load();
  const save = () => {
    try {
      if (at) localStorage.setItem(key, JSON.stringify(at));
      else localStorage.removeItem(key);
    } catch {
      /* the layout lasts for this session */
    }
  };
  const apply = () => {
    // the phone turned: the other orientation's spot
    if (keyOf() !== key) (key = keyOf()), (at = load());
    const s = box.style;
    if (!at) {
      s.left = s.top = s.right = s.bottom = s.transform = s.translate = '';
      return opts.placed?.(false);
    }
    const k = uiScale();
    s.right = 'auto';
    s.transform = s.translate = 'none';
    s.left = `${at.x}px`;
    if (at.b !== undefined) (s.top = 'auto'), (s.bottom = `${at.b}px`);
    else (s.bottom = 'auto'), (s.top = `${at.y ?? 0}px`);
    // what shows stays on screen (touch blocks are scaled from a corner): nudged back by whatever spills over
    const r = box.getBoundingClientRect();
    if (r.width && r.height) {
      const dx = r.left < 0 ? -r.left : r.right > innerWidth ? innerWidth - r.right : 0;
      const dy = r.top < 0 ? -r.top : r.bottom > innerHeight ? innerHeight - r.bottom : 0;
      if (dx) s.left = `${at.x + dx / k}px`;
      if (dy && at.b !== undefined) s.bottom = `${at.b - dy / k}px`;
      else if (dy) s.top = `${(at.y ?? 0) + dy / k}px`;
    }
    opts.placed?.(true);
  };
  const reset = () => {
    at = null;
    save();
    apply();
  };
  /** From here on the block follows pointer `e` (from where it started, sx/sy). swallow: the click it ends with is not a click. */
  const lift = (e: PointerEvent, sx: number, sy: number, swallow: boolean) => {
    const k = uiScale(), s = box.style;
    // its spot such that nothing jumps: where its own box lands for a spot of 0,0 (scales and centring shift what shows)
    const r0 = box.getBoundingClientRect();
    s.right = s.bottom = 'auto';
    s.transform = s.translate = 'none';
    s.left = s.top = '0px';
    const r1 = box.getBoundingClientRect();
    const from = { x: (r0.left - r1.left) / k, y: (r0.top - r1.top) / k }, h = box.offsetHeight;
    at = { x: from.x, y: from.y };
    apply();
    box.classList.add('hud-lifted');
    const mv = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const x = from.x + (ev.clientX - sx) / k, y = from.y + (ev.clientY - sy) / k;
      // the lower half of the screen keeps its distance to the bottom, the upper half to the top
      at = y + h / 2 > innerHeight / k / 2 ? { x, b: innerHeight / k - y - h } : { x, y };
      apply();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      box.classList.remove('hud-lifted');
      save();
      if (!swallow) return;
      const stop = (c: Event) => (c.stopPropagation(), c.preventDefault());
      addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', stop, { capture: true }), 400);
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };

  if (!touch) {
    const grip = el('div', 'move-grip', box);
    grip.title = tx('Arrastrá para mover · doble clic: vuelve a su lugar', 'Drag to move · double click: back to its place');
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      lift(e, e.clientX, e.clientY, false);
    });
    grip.addEventListener('dblclick', reset);
  } else {
    // a long press must not open the phone's own menu
    box.addEventListener('contextmenu', (e) => e.preventDefault());
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (opts.handle && !opts.handle(e.target as Element))) return;
      const sx = e.clientX, sy = e.clientY;
      const cancel = () => {
        clearTimeout(timer);
        removeEventListener('pointermove', wander);
        removeEventListener('pointerup', cancel);
        removeEventListener('pointercancel', cancel);
      };
      const wander = (ev: PointerEvent) => {
        if (ev.pointerId === e.pointerId && Math.hypot(ev.clientX - sx, ev.clientY - sy) > HOLD_SLOP) cancel();
      };
      const timer = setTimeout(() => {
        cancel();
        navigator.vibrate?.(15);
        lift(e, sx, sy, true);
      }, HOLD_MS);
      addEventListener('pointermove', wander);
      addEventListener('pointerup', cancel);
      addEventListener('pointercancel', cancel);
    });
  }
  addEventListener('resize', apply);
  onLayoutReset(() => {
    // both orientations go back
    for (const k of touch ? [`hud:${id}:p`, `hud:${id}:l`] : [`hud:${id}`]) {
      try {
        localStorage.removeItem(k);
      } catch {
        /* storage unavailable */
      }
    }
    at = null;
    apply();
  });
  apply();
}
