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

/**
 * A HUD block the player can move, on desktop (touch screens keep their fixed layout): a grip shows in its corner
 * while the pointer is over it; dragging the grip moves the block, a double click on it puts it back. Only the grip
 * drags, so what is inside (chat, bar slots, the minimap) keeps working. The spot is kept (localStorage hud:<id>),
 * anchored to the nearer edge, top or bottom, so a block that grows (the extra bars, the chat unfolding) grows away
 * from that edge, and it is kept on screen.
 */
export function makeMovable(box: HTMLElement, id: string): void {
  if (isTouchDevice()) return;
  box.classList.add('hud-movable');
  const grip = el('div', 'move-grip', box);
  grip.title = tx('Arrastrá para mover · doble clic: vuelve a su lugar', 'Drag to move · double click: back to its place');
  const key = `hud:${id}`;
  let at: { x: number; y?: number; b?: number } | null = null;
  try {
    at = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    /* storage unavailable */
  }
  const save = () => {
    try {
      if (at) localStorage.setItem(key, JSON.stringify(at));
      else localStorage.removeItem(key);
    } catch {
      /* the layout lasts for this session */
    }
  };
  const apply = () => {
    const s = box.style;
    if (!at) return void (s.left = s.top = s.right = s.bottom = s.transform = '');
    const k = uiScale(), W = innerWidth / k, H = innerHeight / k, w = box.offsetWidth, h = box.offsetHeight;
    s.left = `${Math.max(0, Math.min(W - w, at.x))}px`;
    s.right = 'auto';
    s.transform = 'none';
    if (at.b !== undefined) (s.top = 'auto'), (s.bottom = `${Math.max(0, Math.min(H - h, at.b))}px`);
    else (s.bottom = 'auto'), (s.top = `${Math.max(0, Math.min(H - h, at.y ?? 0))}px`);
  };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const k = uiScale(), r = box.getBoundingClientRect();
    const from = { x: r.left / k, y: r.top / k }, h = r.height / k;
    const mv = (ev: PointerEvent) => {
      const x = from.x + (ev.clientX - e.clientX) / k, y = from.y + (ev.clientY - e.clientY) / k;
      // the lower half of the screen keeps its distance to the bottom, the upper half to the top
      at = y + h / 2 > innerHeight / k / 2 ? { x, b: innerHeight / k - y - h } : { x, y };
      apply();
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      save();
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    at = null;
    save();
    apply();
  });
  addEventListener('resize', apply);
  onLayoutReset(() => {
    at = null;
    save();
    apply();
  });
  apply();
}
