export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

let tipEl: HTMLDivElement | null = null;
function tipBox() {
  if (!tipEl) tipEl = el('div', 'tooltip', document.body);
  return tipEl;
}

/** Attach a hover tooltip. `html` is trusted markup built from static game data. */
export function setTip(target: HTMLElement, html: () => string) {
  const move = (e: MouseEvent) => {
    const t = tipBox();
    const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8);
    const y = Math.min(e.clientY + 14, innerHeight - t.offsetHeight - 8);
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  };
  target.addEventListener('mouseenter', (e) => {
    const h = html();
    if (!h) return;
    const t = tipBox();
    t.innerHTML = h;
    t.style.display = 'block';
    move(e);
  });
  target.addEventListener('mousemove', move);
  target.addEventListener('mouseleave', hideTip);
}

export function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

// Native `title` tooltips take about a second to show up. Any element that has one gets the same
// instant tooltip instead: the text moves to data-tip (and aria-label) the first time it is hovered.
let tipOwner: HTMLElement | null = null;
addEventListener('mouseover', (e) => {
  const titled = (e.target as Element).closest?.<HTMLElement>('[title]');
  if (titled?.title) {
    titled.dataset.tip = titled.title;
    titled.ariaLabel ??= titled.title;
    titled.removeAttribute('title');
  }
  const owner = (e.target as Element).closest?.<HTMLElement>('[data-tip]') ?? null;
  if (owner === tipOwner) return;
  if (tipOwner) hideTip();
  tipOwner = owner;
  if (!owner) return;
  const t = tipBox();
  t.textContent = owner.dataset.tip!;
  t.style.display = 'block';
});
addEventListener('mousemove', (e) => {
  if (!tipOwner || !tipEl) return;
  if (!tipOwner.isConnected) return void ((tipOwner = null), hideTip());
  tipEl.style.left = `${Math.max(4, Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8))}px`;
  tipEl.style.top = `${Math.max(4, Math.min(e.clientY + 14, innerHeight - tipEl.offsetHeight - 8))}px`;
});

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function loadPos(id: string): { x: number; y: number } | null {
  try {
    const v = localStorage.getItem(`win:${id}`);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function savePos(id: string, x: number, y: number) {
  try {
    localStorage.setItem(`win:${id}`, JSON.stringify({ x, y }));
  } catch {
    /* storage unavailable */
  }
}

/** Draggable L2-style window. */
export class Win {
  static stack: Win[] = [];
  root: HTMLDivElement;
  body: HTMLDivElement;
  titleEl: HTMLSpanElement;
  onShow: (() => void) | null = null;

  constructor(public id: string, title: string, x: number, y: number, width: number, parent: HTMLElement) {
    this.root = el('div', 'win', parent);
    this.root.style.width = `${width}px`;
    const bar = el('div', 'win-title', this.root);
    this.titleEl = el('span', '', bar, title);
    const close = el('button', 'win-close', bar, '×');
    close.onclick = () => this.hide();
    this.body = el('div', 'win-body', this.root);
    const pos = loadPos(id);
    this.place(pos?.x ?? x, pos?.y ?? y);
    this.root.style.display = 'none';
    this.root.addEventListener('pointerdown', () => this.front());

    bar.addEventListener('pointerdown', (e) => {
      if (e.target === close) return;
      const ox = e.clientX - this.root.offsetLeft, oy = e.clientY - this.root.offsetTop;
      const mv = (ev: PointerEvent) => this.place(ev.clientX - ox, ev.clientY - oy);
      const up = () => {
        removeEventListener('pointermove', mv);
        removeEventListener('pointerup', up);
        savePos(this.id, this.root.offsetLeft, this.root.offsetTop);
      };
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
    });
  }

  private place(x: number, y: number) {
    const resolvedX = x < 0 ? innerWidth + x : x;
    this.root.style.left = `${Math.max(0, Math.min(innerWidth - 60, resolvedX))}px`;
    this.root.style.top = `${Math.max(0, Math.min(innerHeight - 40, y))}px`;
  }

  get visible() {
    return this.root.style.display !== 'none';
  }

  front() {
    Win.stack = Win.stack.filter((w) => w !== this);
    Win.stack.push(this);
    Win.stack.forEach((w, i) => (w.root.style.zIndex = String(20 + i)));
  }

  show() {
    // phones: one window at a time, full width (see the portrait layout in style.css)
    if (document.body.classList.contains('touch') && innerWidth <= 760) for (const w of [...Win.stack]) if (w !== this) w.hide();
    this.root.style.display = '';
    this.front();
    this.onShow?.();
  }

  hide() {
    this.root.style.display = 'none';
    Win.stack = Win.stack.filter((w) => w !== this);
    hideTip();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }
}
