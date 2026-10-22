import { STATUS_IDS, STATUSES } from '../../../shared/src/status';
import { RACES, CLASSES } from '../../../shared/src/data/classes';
import { ITEMS } from '../../../shared/src/data/items';
import { QUESTS, questSummary } from '../../../shared/src/data/quests';
import { SKILLS } from '../../../shared/src/data/skills';
import { F_DEAD } from '../../../shared/src/protocol';
import { inPvpZone, NPCS } from '../../../shared/src/data/world';
import { conColor, F_PURPLE, F_RED, type Game } from '../game';
import { bar, glyph, hydrate, itemIcon, itemTip, skillIcon, skillTip } from './common';
import { el, esc, hideTip, setTip } from './dom';
import { makeMovable, onLayoutReset, resetLayout, uiScale } from './movable';
import { hudFocus, isTouchDevice, setHudFocus } from './touch';
import { lang, t as tx, fmt } from '../lang';
import { keyLabel, settings, type Action } from '../settings';
import { campName, className, itemDesc, itemName, mobName, npcText, questField, questLineL, questSummaryL, raceName, skillDesc, skillName, statusDesc, statusName, teleportName, zoneName } from '../../../shared/src/i18n';

const CONSUMABLES = ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape'];
export type Slot = { type: 'skill' | 'item'; id: string } | null;
/** The main bar (ten slots, then the attack and roll buttons) and two extra ones above it, twelve slots each: as wide. */
const SIZE = [10, 12, 12];
const BARS = SIZE.length;
/**
 * The bars' layout, kept on the server per character (characters.hotbar, sent back on entering), so it is the same
 * in every browser. known: ids already placed once, so emptying a slot by hand sticks; shown / collapsed: bars 2-3.
 */
interface BarState { v: 2; bars: Slot[][]; known: string[]; shown: boolean[]; collapsed: boolean[] }
const emptyBar = (b: number) => Array<Slot>(SIZE[b]).fill(null);
/** the action whose key fires slot i of bar b (the main bar keeps its old action names) */
/** where the player put the status window and how wide they made it (per browser, like the windows' places) */
const STATUS_KEY = 'hud:status';
const STATUS_W = { min: 180, max: 640 };
const slotAction = (b: number, i: number) => (b === 0 ? `slot${i + 1}` : `bar${b + 1}slot${i + 1}`) as Action;

/**
 * A panel whose title folds it down to that title line (class 'folded'), kept per browser (localStorage fold:<id>);
 * `start` when nothing is kept yet. A tap on a button in the title (party: Leave) does not fold.
 */
export function foldable(box: HTMLElement, head: HTMLElement, id: string, start = false) {
  let on = start;
  try {
    const v = localStorage.getItem(`fold:${id}`);
    if (v !== null) on = v === '1';
  } catch {
    /* storage unavailable */
  }
  box.classList.toggle('folded', on);
  head.classList.add('fold-head');
  head.addEventListener('click', (e) => {
    if ((e.target as Element).closest('button')) return;
    on = !box.classList.contains('folded');
    box.classList.toggle('folded', on);
    try {
      localStorage.setItem(`fold:${id}`, on ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
}

export class Hud {
  private statusEl!: HTMLDivElement;
  /** the gladiator's Force charges, one orb each, under the MP bar */
  private chargesEl!: HTMLDivElement;
  private chargesKey = '';
  private atkEl!: HTMLDivElement;
  private atkCd!: HTMLDivElement;
  private dashEl!: HTMLDivElement;
  private dashCd!: HTMLDivElement;
  private pvpBtn!: HTMLButtonElement;
  private adenaEl!: HTMLSpanElement;
  private name: HTMLDivElement;
  private cp; private hp; private mp; private xp;
  private buffs: HTMLDivElement;
  private target: HTMLDivElement;
  private tName: HTMLDivElement;
  private tHp; private tActions: HTMLDivElement;
  private slotEls: HTMLDivElement[][] = [];
  private st: BarState | null = null;
  private barRows: HTMLDivElement[] = [];
  private barsPop!: HTMLDivElement;
  private saveTimer = 0;
  /** what is being dragged onto a bar: one of the bars' own slots, or a skill / consumable from a window */
  drag: { from?: { b: number; i: number }; slot?: Slot } | null = null;
  private cast: HTMLDivElement;
  /** the skill bars' block: the cast bar shows just over it once the player moved it */
  private shortcuts!: HTMLDivElement;
  private castFill: HTMLDivElement;
  private castName: HTMLSpanElement;
  private bannerEl: HTMLDivElement;
  private bannerTimer = 0;
  private questRoot: HTMLDivElement;
  private questList: HTMLDivElement;
  private lastTargetKey = '';
  private slotsKey = '';
  /** phones and tablets: a ☰ menu, the bars one page at a time, blocks moved by a long press */
  private touch = isTouchDevice();
  /** touch: the bar on show (0: the main one, 1-2: bars 2 and 3), turned by the pager or a swipe */
  private page = 0;
  private pager: HTMLButtonElement | null = null;

  constructor(private g: Game, root: HTMLElement) {
    // Status window (top-left)
    // as in L2's status window: name, then CP, HP, MP and XP one over the other, out of the way of the centre
    const st = el('div', 'panel status', root);
    this.name = el('div', 'status-name', st);
    this.cp = bar(st, 'bar-cp', 'CP');
    this.cp.root.title = tx('CP (Puntos de Combate): absorben el daño que te hacen otros jugadores antes de que baje la vida. No protegen de los monstruos.',
      'CP (Combat Points): soak the damage other players deal before your HP drops. No protection against monsters.');
    this.hp = bar(st, 'bar-hp', 'HP');
    this.mp = bar(st, 'bar-mp', 'MP');
    this.chargesEl = el('div', 'charges', st);
    this.chargesEl.title = tx('Cargas de fuerza: las juntan Concentración Sónica y los golpes con un par de espadas; las gastan las habilidades sónicas.',
      'Force charges: gathered by Sonic Focus and by hits with a pair of swords; spent by the sonic skills.');
    this.xp = bar(st, 'bar-xp');
    this.buffs = el('div', 'buffs', root);
    this.statusEl = el('div', 'status-row', root);
    this.makeStatusMovable(st);
    if (this.touch) {
      // touch: a tap folds it down to HP and MP (and back); a long press moves it
      const compact = (on: boolean) => {
        st.classList.toggle('compact', on);
        try {
          localStorage.setItem('statusCompact', on ? '1' : '0');
        } catch {
          /* ignore */
        }
      };
      try {
        compact(localStorage.getItem('statusCompact') === '1');
      } catch {
        /* storage unavailable */
      }
      st.addEventListener('click', () => compact(!st.classList.contains('compact')));
    }

    // Target window (top-center)
    this.target = el('div', 'panel target', root);
    const tTop = el('div', 'target-top', this.target);
    this.tName = el('div', 'target-name', tTop);
    const tClose = el('button', 'btn-x', tTop, '×');
    tClose.onclick = () => g.setTarget(null);
    this.tHp = bar(this.target, 'bar-hp thin');
    this.tActions = el('div', 'target-actions', this.target);
    makeMovable(this.target, 'target', { handle: (t) => !t.closest('button') });

    // Shortcut bar (bottom-center)
    const sc = el('div', 'panel shortcuts', root);
    // bars 2 and 3 stack over the main bar, edge to edge with it; each folds down to a thin strip with its arrow
    const extra = el('div', 'extra-bars', sc);
    this.slotEls.push(this.buildSlots(0, sc));
    for (let b = 1; b < BARS; b++) {
      const row = el('div', 'bar-row', extra);
      row.dataset.bar = String(b);
      const fold = el('button', 'bar-toggle', row);
      fold.title = tx(`Barra ${b + 1}: plegar / desplegar`, `Bar ${b + 1}: fold / unfold`);
      fold.onclick = () => {
        if (!this.st) return;
        this.st.collapsed[b - 1] = !this.st.collapsed[b - 1];
        this.saveBar();
      };
      el('span', 'bar-num', row, String(b + 1));
      // folded, the whole strip unfolds it
      row.dataset.label = tx(`Barra ${b + 1} — clic para desplegar`, `Bar ${b + 1} — click to unfold`);
      row.onclick = (e) => {
        if (!this.st?.collapsed[b - 1] || e.target === fold) return;
        this.st.collapsed[b - 1] = false;
        this.saveBar();
      };
      this.slotEls.push(this.buildSlots(b, row));
      this.barRows.push(row);
    }

    // auto-attack button (Space by default), next to the bar instead of on it, with the swing as its sweep
    this.atkEl = el('div', 'slot dash-btn', sc);
    const atkKey = el('span', 'slot-key', this.atkEl);
    const syncAtk = () => (atkKey.textContent = keyLabel(settings.s.keys.attack));
    syncAtk();
    settings.on((_, changed) => changed.includes('keys') && syncAtk());
    const atkIcon = el('div', 'icon skill', this.atkEl);
    glyph('ui', 'attack', '⚔', atkIcon);
    atkIcon.style.background = 'radial-gradient(circle at 35% 30%, #ffaa44, #14161f 85%)';
    this.atkCd = el('div', 'cd', this.atkEl);
    setTip(this.atkEl, () => `<div class="tt-title">${tx('Autoataque', 'Auto-attack')} <span class="tt-dim">${keyLabel(settings.s.keys.attack)}</span></div>${tx(`Ataca al objetivo seleccionado y sigue pegándole. ${settings.s.autoTarget ? 'Sin objetivo, elige el monstruo más cercano. ' : ''}Con Ctrl, fuerza el ataque a un jugador.`, `Attacks the selected target and keeps swinging. ${settings.s.autoTarget ? 'With no target, picks the nearest monster. ' : ''}Hold Ctrl to force an attack on a player.`)}`);
    this.atkEl.onclick = () => g.attackTarget();

    // Cast bar
    // dodge roll button (Shift) with cooldown sweep
    this.dashEl = el('div', 'slot dash-btn', sc);
    el('span', 'slot-key', this.dashEl, 'Shift');
    glyph('ui', 'dash', '', el('div', 'icon', this.dashEl));
    this.dashCd = el('div', 'cd', this.dashEl);
    this.dashEl.title = tx('Rodar (Shift): esquivás hacia el cursor y sos invulnerable un instante. Ideal para salir de los círculos rojos.', 'Roll (Shift): dodge toward the cursor, briefly invulnerable. Great for getting out of red circles.');
    this.dashEl.onclick = () => g.dash();
    this.shortcuts = sc;
    if (this.touch) {
      // touch: one bar at a time. The pager turns the page (a long press on it moves the bars), so does a swipe along them
      sc.dataset.page = '0';
      try {
        this.page = Math.max(0, Math.min(BARS - 1, Number(localStorage.getItem('barPage')) || 0));
      } catch {
        /* storage unavailable */
      }
      this.pager = el('button', 'bar-pager', sc);
      this.pager.onclick = () => (this.pages().length > 1 ? this.flip(1) : this.toggleBarsMenu());
      sc.addEventListener('pointerdown', (e) => {
        const sx = e.clientX, sy = e.clientY, id = e.pointerId;
        const up = (u: PointerEvent) => {
          if (u.pointerId !== id) return;
          removeEventListener('pointerup', up);
          const dx = u.clientX - sx, dy = u.clientY - sy;
          if (Math.abs(dx) > 40 && Math.abs(dy) < 30) this.flip(dx < 0 ? 1 : -1);
        };
        addEventListener('pointerup', up);
      });
      makeMovable(sc, 'shortcuts', { handle: (t) => !!t.closest('.bar-pager') });
    } else makeMovable(sc, 'shortcuts');

    this.cast = el('div', 'castbar', root);
    this.castFill = el('div', 'castbar-fill', this.cast);
    this.castName = el('span', 'castbar-text', this.cast);
    // a tap on the bar cancels the cast, as Esc does (phones have no Esc)
    this.cast.onclick = () => this.g.cancelCast();
    this.cast.title = tx('Clic o Esc: cancelar (gasta el MP y el tiempo de espera igual)', 'Click or Esc: cancel (the MP and cooldown are spent all the same)');

    // Menu (bottom-right)
    const menu = el('div', 'panel menu', root);
    this.adenaEl = el('span', 'adena hud-adena', menu);
    // icon + label: narrow and touch screens only show the icon
    const btn = (icon: Action, label: string, fn: () => void) => {
      const b = el('button', 'menu-btn', menu);
      glyph('ui', icon, '', el('span', 'mb-icon', b));
      el('span', 'mb-label', b, label);
      const k = el('span', 'mb-key', b);
      const sync = () => {
        k.textContent = keyLabel(settings.s.keys[icon]);
        b.title = k.textContent ? `${label} (${k.textContent})` : label;
        delete b.dataset.tip;
      };
      sync();
      settings.on((_, changed) => changed.includes('keys') && sync());
      b.onclick = fn;
    };
    btn('character', tx('Personaje', 'Character'), () => g.ui.character.win.toggle());
    btn('inventory', tx('Inventario', 'Inventory'), () => g.ui.inventory.win.toggle());
    btn('map', tx('Mapa', 'Map'), () => g.ui.minimap.toggleMap());
    btn('clan', 'Clan', () => g.ui.clan.toggle());
    btn('bars', tx('Barras', 'Bars'), () => this.toggleBarsMenu());
    btn('help', tx('Ayuda', 'Help'), () => g.ui.help.toggle());
    btn('settings', tx('Opciones', 'Settings'), () => g.ui.settings.win.toggle());
    this.pvpBtn = el('button', 'menu-btn pvp-btn', menu, tx('PvP: NO', 'PvP: OFF'));
    this.pvpBtn.title = tx('Activar o desactivar el PvP (/pvp). Desactivado: nadie te puede atacar y vos no podés atacar a otros jugadores (salvo a los PK).', 'Toggle PvP mode (/pvp). Off: players cannot attack you, and you cannot attack them (PKs excepted).');
    this.pvpBtn.onclick = () => g.net.send({ t: 'pvpMode', on: !g.me.pvpOn });
    if (this.touch) this.menuDrawer(root, menu);
    else makeMovable(menu, 'menu');

    // which extra bars are on screen: it opens over the menu, wherever the menu is (touch: a sheet from the bottom)
    this.barsPop = el('div', 'panel bars-pop', this.touch ? root : menu);
    this.barsPop.style.display = 'none';

    this.bannerEl = el('div', 'banner', root);

    this.questRoot = el('div', 'panel quest-tracker', root);
    const qHead = el('div', 'quest-head', this.questRoot, tx('Misiones', 'Quests'));
    this.questList = el('div', '', this.questRoot);
    // a tap on the title folds the list (phones start with it folded)
    foldable(this.questRoot, qHead, 'quests', this.touch && Math.min(innerWidth, innerHeight) <= 500);
    makeMovable(this.questRoot, 'quests');
    this.questRoot.style.display = 'none';
  }

  /**
   * Touch: the menu folds into one ☰ button that opens it as a grid of big labelled buttons, with combat mode and the
   * layout reset added; a choice closes it, and so does a tap anywhere else. The button moves by a long press.
   */
  private menuDrawer(root: HTMLElement, menu: HTMLDivElement) {
    const open = el('button', 'menu-toggle', root, '☰');
    open.setAttribute('aria-label', tx('Menú', 'Menu'));
    menu.classList.add('drawer');
    const extra = (icon: string, label: string, fn: () => void) => {
      const b = el('button', 'menu-btn', menu);
      el('span', 'mb-icon', b, icon);
      el('span', 'mb-label', b, label);
      b.onclick = fn;
      return b;
    };
    const focus = extra('◱', tx('Modo combate', 'Combat mode'), () => setHudFocus(!hudFocus()));
    extra('↺', tx('Restablecer interfaz', 'Reset layout'), () => resetLayout());
    const show = (on: boolean) => {
      menu.classList.toggle('open', on);
      if (!on) return;
      focus.classList.toggle('on', hudFocus());
      // next to the button, wherever the player put it
      const k = uiScale(), r = open.getBoundingClientRect(), s = menu.style;
      s.left = `${Math.max(6, Math.min(innerWidth - menu.offsetWidth * k - 6, r.left)) / k}px`;
      if (r.top < innerHeight / 2) (s.top = `${(r.bottom + 6) / k}px`), (s.bottom = 'auto');
      else (s.bottom = `${(innerHeight - r.top + 6) / k}px`), (s.top = 'auto');
    };
    open.onclick = () => show(!menu.classList.contains('open'));
    menu.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.menu-btn')) show(false);
    });
    addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (menu.classList.contains('open') && !menu.contains(t) && !open.contains(t)) show(false);
      if (this.barsPop.style.display !== 'none' && !this.barsPop.contains(t) && !menu.contains(t) && !this.pager?.contains(t)) this.barsPop.style.display = 'none';
    }, true);
    makeMovable(open, 'menu');
  }

  /** Touch: the bars the pager goes through (the main one, then those ticked in the Bars menu). */
  private pages(): number[] {
    return [0, ...[1, 2].filter((b) => this.st?.shown[b - 1])];
  }
  /** Touch: the next (d 1) or previous (d -1) bar. */
  private flip(d: number) {
    const p = this.pages(), i = p.indexOf(this.page);
    this.page = p[(Math.max(0, i) + d + p.length) % p.length];
    try {
      localStorage.setItem('barPage', String(this.page));
    } catch {
      /* ignore */
    }
    this.showPage();
  }
  private showPage() {
    if (!this.pager) return;
    const p = this.pages();
    if (!p.includes(this.page)) this.page = 0;
    this.shortcuts.dataset.page = String(this.page);
    this.pager.textContent = `${p.indexOf(this.page) + 1}/${p.length}`;
    this.pager.title = p.length > 1 ? tx('Cambiar de barra (o deslizá sobre la barra)', 'Switch bars (or swipe along the bar)') : tx('Activar más barras', 'Turn on more bars');
  }

  /**
   * The status window moves by dragging it and widens by its right edge; a double click on the name puts it back.
   * Buffs and status effects stay next to it. Desktop only: on touch screens the layout is fixed.
   */
  private makeStatusMovable(st: HTMLDivElement) {
    if (this.touch) {
      // touch: a long press moves it, buffs and status effects follow under it (no widening)
      return makeMovable(st, 'status', {
        placed: (moved) => {
          const b = this.buffs.style, e = this.statusEl.style;
          if (!moved) return void (b.left = b.top = b.bottom = e.left = e.top = e.bottom = '');
          const k = uiScale(), r = st.getBoundingClientRect();
          b.left = e.left = `${r.left / k}px`;
          b.bottom = e.bottom = 'auto';
          b.top = `${r.bottom / k + 4}px`;
          e.top = `${r.bottom / k + 32}px`;
        },
      });
    }
    st.classList.add('movable');
    st.title = tx('Arrastrá para moverla, estirá el borde derecho para ensancharla, doble clic en el nombre para volver al lugar original.',
      'Drag to move it, pull the right edge to widen it, double click the name to put it back.');
    const grip = el('div', 'status-grip', st);
    let saved: { x: number; y: number; w: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(STATUS_KEY) ?? 'null');
    } catch {
      /* unavailable */
    }
    const apply = () => {
      if (!saved) {
        st.style.left = st.style.top = st.style.width = '';
        this.buffs.style.left = this.buffs.style.top = this.statusEl.style.left = this.statusEl.style.top = '';
        return;
      }
      const w = Math.max(STATUS_W.min, Math.min(STATUS_W.max, saved.w, innerWidth - 20));
      st.style.width = `${w}px`;
      st.style.left = `${Math.max(0, Math.min(innerWidth - w, saved.x))}px`;
      st.style.top = `${Math.max(0, Math.min(innerHeight - st.offsetHeight, saved.y))}px`;
      const r = st.getBoundingClientRect();
      this.buffs.style.left = this.statusEl.style.left = `${r.right + 10}px`;
      this.buffs.style.top = `${r.top}px`;
      this.statusEl.style.top = `${r.top + 34}px`;
    };
    const save = () => {
      try {
        if (saved) localStorage.setItem(STATUS_KEY, JSON.stringify(saved));
        else localStorage.removeItem(STATUS_KEY);
      } catch {
        /* the layout lasts for this session */
      }
    };
    const drag = (e: PointerEvent, move: (dx: number, dy: number, from: { x: number; y: number; w: number }) => void) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const from = { x: st.offsetLeft, y: st.offsetTop, w: st.offsetWidth }, k = uiScale();
      const mv = (ev: PointerEvent) => {
        move((ev.clientX - e.clientX) / k, (ev.clientY - e.clientY) / k, from);
        apply();
      };
      const up = () => {
        removeEventListener('pointermove', mv);
        removeEventListener('pointerup', up);
        save();
      };
      addEventListener('pointermove', mv);
      addEventListener('pointerup', up);
    };
    st.addEventListener('pointerdown', (e) => drag(e, (dx, dy, f) => (saved = { x: f.x + dx, y: f.y + dy, w: f.w })));
    grip.addEventListener('pointerdown', (e) => drag(e, (dx, _dy, f) => (saved = { x: f.x, y: f.y, w: f.w + dx })));
    this.name.addEventListener('dblclick', () => {
      saved = null;
      save();
      apply();
    });
    onLayoutReset(() => {
      saved = null;
      save();
      apply();
    });
    addEventListener('resize', apply);
    apply();
  }

  /** Over the skill bars when the player moved them (the stylesheet places it otherwise, screen by screen). */
  private placeCast() {
    const c = this.cast.style;
    if (!this.shortcuts.classList.contains('hud-movable') || !this.shortcuts.style.left) return void (c.left = c.top = c.bottom = '');
    const k = uiScale(), r = this.shortcuts.getBoundingClientRect();
    c.left = `${(r.left + r.width / 2) / k}px`;
    c.top = `${r.top / k - 24}px`;
    c.bottom = 'auto';
  }

  setQuests(list: { id: string; progress: number }[]) {
    this.questList.innerHTML = '';
    let shown = 0;
    for (const row of list) {
      const q = QUESTS[row.id];
      if (!q) continue;
      shown++;
      const ready = row.progress >= q.objective.count;
      const off = this.g.untracked.has(row.id);
      const line = el('div', `qt-row${ready ? ' ready' : ''}${off ? ' untracked' : ''}`, this.questList);
      const name = el('div', 'qt-name', line, questField(q, 'name', lang));
      // the star switches this quest's hints (star over its monsters, hunting area on the maps) on and off
      const track = el('button', 'qt-track', name);
      glyph('ui', 'quest', '', track);
      track.title = off ? tx('Seguir esta misión: marca sus monstruos y su zona en el mapa', 'Track this quest: marks its monsters and its area on the map')
        : tx('Dejar de seguir esta misión', 'Stop tracking this quest');
      track.onclick = () => this.g.toggleTracked(row.id);
      const prog = el('div', 'tt-dim', line);
      prog.innerHTML = ready
        ? `<b class="qt-ready"><i data-gi="ui/check"></i> ${tx('Volvé con', 'Return to')} ${esc(NPCS.find((n) => n.id === q.npc)?.name ?? '')}</b>`
        : `${esc(questSummaryL(q, lang))} <b>${row.progress}/${q.objective.count}</b>`;
      hydrate(prog);
      // done: a button that walks you to whoever takes it back (they may be a region away)
      const giver = NPCS.find((n) => n.id === q.npc);
      if (ready && giver) {
        const go = el('button', 'btn small qt-go', line, tx(`Ir con ${giver.name} ➜`, `Go to ${giver.name} ➜`));
        go.onclick = () => {
          this.g.travel(giver.x + Math.sin(giver.ry) * 2, giver.z + Math.cos(giver.ry) * 2, false);
          this.g.sys(tx(`Caminando hacia ${giver.name}.`, `Walking to ${giver.name}.`));
        };
      }
      el('div', '', el('div', 'qt-bar', line)).style.width = `${Math.min(100, (row.progress / q.objective.count) * 100)}%`;
    }
    this.questRoot.style.display = shown ? '' : 'none';
  }

  private itemCount(id: string) {
    return this.g.inv.filter((i) => i.i === id).reduce((a, i) => a + i.c, 0);
  }

  onMe() {
    const m = this.g.me;
    this.pvpBtn.textContent = m.pvpOn ? tx(' PvP: SÍ', ' PvP: ON') : tx('PvP: NO', 'PvP: OFF');
    if (m.pvpOn) this.pvpBtn.prepend(glyph('ui', 'pvp'));
    this.pvpBtn.classList.toggle('on', m.pvpOn);
    this.name.innerHTML = `<span class="lvl">${m.lvl}</span> ${esc(m.name)} <span class="tt-dim">${raceName(m.race, lang)} ${className(m.cls, lang, m.spec)}</span>`;
    this.cp.set(m.cp, m.maxCp);
    this.hp.set(m.hp, m.maxHp);
    this.mp.set(m.mp, m.maxMp);
    // under 30% life the world drains of colour, down to full grey at zero; under 30% mana its bar trembles
    const life = m.maxHp > 0 ? m.hp / m.maxHp : 1;
    document.getElementById('game')!.style.filter = life < 0.3 ? `grayscale(${(1 - life / 0.3).toFixed(2)})` : '';
    this.mp.root.classList.toggle('low', m.maxMp > 0 && m.mp / m.maxMp < 0.3);
    const charges = m.charges ?? 0, maxCharges = m.maxCharges ?? 0, key = `${charges}/${maxCharges}`;
    if (key !== this.chargesKey) {
      this.chargesKey = key;
      this.chargesEl.innerHTML = '';
      this.chargesEl.style.display = maxCharges > 0 ? '' : 'none';
      for (let i = 0; i < maxCharges; i++) el('span', `charge${i < charges ? ' on' : ''}`, this.chargesEl);
    }
    if (m.xpNeed > 0) {
      this.xp.set(m.xp, m.xpNeed);
      this.xp.text.textContent = `XP ${((m.xp / m.xpNeed) * 100).toFixed(2)}%`;
    } else {
      this.xp.set(1, 1);
      this.xp.text.textContent = tx('NIVEL MÁXIMO', 'MAX LEVEL');
    }
    this.buffs.innerHTML = '';
    for (const b of m.buffs) {
      const w = el('div', 'buff', this.buffs);
      skillIcon(b.id, w);
      el('span', 'buff-time', w, b.rem >= 60 ? `${Math.ceil(b.rem / 60)}m` : `${b.rem}s`);
      setTip(w, () => skillTip(b.id));
    }
    if (m.flagged || m.karma > 0) {
      const w = el('div', `buff flag ${m.karma > 0 ? 'karma' : ''}`, this.buffs, m.karma > 0 ? 'PK' : 'PvP');
      w.title = m.karma > 0 ? `Karma: ${m.karma}` : tx('Con flag de PvP', 'PvP flagged');
    }
    const self = this.g.self;
    if (self && inPvpZone(self.pos.x, self.pos.z)) {
      el('div', 'buff flag pvp-zone', this.buffs, tx('⚔ Zona PvP', '⚔ PvP zone')).title = tx('Zona PvP: todos están flageados y cualquiera puede atacarte.', 'PvP zone: everyone is flagged and anyone can attack you.');
    }
    this.refreshSlots();
  }

  /** Ten slots of bar b: click or key uses it, drag rearranges (across bars too), right click empties. */
  private buildSlots(b: number, parent: HTMLElement): HTMLDivElement[] {
    const out: HTMLDivElement[] = [];
    for (let i = 0; i < SIZE[b]; i++) {
      // extra bars copy the main bar's layout: their slots 11 and 12 sit over the attack and roll buttons, with the same gap
      const s = el('div', b > 0 && i >= 10 ? 'slot slot-gap' : 'slot', parent);
      const keyEl = el('span', 'slot-key', s);
      const syncKey = () => (keyEl.textContent = keyLabel(settings.s.keys[slotAction(b, i)] ?? ''));
      syncKey();
      settings.on((_, changed) => changed.includes('keys') && syncKey());
      s.onclick = () => this.activateSlot(b, i);
      s.ondragstart = () => (hideTip(), (this.drag = { from: { b, i } }));
      s.ondragend = () => (this.drag = null);
      s.ondragover = (e) => e.preventDefault();
      s.ondrop = (e) => {
        e.preventDefault();
        if (this.drag) this.placeOnBar(b, i, this.drag);
      };
      s.oncontextmenu = (e) => {
        e.preventDefault();
        if (!this.st) return;
        this.st.bars[b][i] = null;
        this.saveBar();
      };
      setTip(s, () => {
        const sl = this.st?.bars[b][i];
        if (!sl) return '';
        return sl.type === 'skill' ? skillTip(sl.id) : itemTip(sl.id, this.itemCount(sl.id));
      });
      out.push(s);
    }
    return out;
  }

  /** Drop on slot i of bar b: another slot's content (the two swap), or a skill or item - already on a bar somewhere
   * else, that slot takes what was here. The desktop's drag and drop and the touch drag (ui/bardrag.ts) both land here. */
  placeOnBar(b: number, i: number, d: { from?: { b: number; i: number }; slot?: Slot }) {
    const bars = this.st?.bars;
    if (!bars) return;
    const here = bars[b][i];
    if (d.from) [bars[d.from.b][d.from.i], bars[b][i]] = [here, bars[d.from.b][d.from.i]];
    else if (d.slot) {
      for (const row of bars) {
        const at = row.findIndex((x) => x?.id === d.slot!.id);
        if (at >= 0) row[at] = here;
      }
      bars[b][i] = d.slot;
    }
    this.saveBar();
  }

  /** The bar slot on screen under a point (a phone shows one bar at a time: only its slots), for a touch drag ending there. */
  slotUnder(x: number, y: number): { b: number; i: number; el: HTMLDivElement } | null {
    const hit = document.elementFromPoint(x, y)?.closest('.slot');
    for (let b = 0; b < this.slotEls.length; b++) {
      const i = this.slotEls[b].indexOf(hit as HTMLDivElement);
      if (i >= 0) return { b, i, el: this.slotEls[b][i] };
    }
    return null;
  }

  /** The layout the server kept; failing that, the one this browser used to keep (moved to the server); or none yet. */
  private loadBars(): BarState {
    const fix = (v: Partial<BarState> | null): BarState | null => {
      if (!v || !Array.isArray(v.bars)) return null;
      // each bar padded or cut to its size (bars 2-3 were ten slots wide before)
      const bars = Array.from({ length: BARS }, (_, b) => Array.from({ length: SIZE[b] }, (_, i) => {
        const s = v.bars![b]?.[i];
        // auto-attack used to sit on the bar: free the slot an old layout still gives it; and a skill no longer in the
        // game (the gladiator's before its dual-sword kit)
        return s && (s.type === 'skill' || s.type === 'item') && typeof s.id === 'string' && (s.type === 'item' || SKILLS[s.id]) ? { type: s.type, id: s.id } : null;
      }));
      const flags = (a: unknown, n: number) => Array.from({ length: n }, (_, k) => Array.isArray(a) && !!a[k]);
      return { v: 2, bars, known: Array.isArray(v.known) ? v.known.filter((k) => typeof k === 'string') : [], shown: flags(v.shown, BARS - 1), collapsed: flags(v.collapsed, BARS - 1) };
    };
    try {
      const st = fix(JSON.parse(this.g.barData || 'null'));
      if (st) return st;
    } catch {
      /* not JSON: start over */
    }
    try {
      const old = JSON.parse(localStorage.getItem(`hotbar:${this.g.me.name}`) ?? 'null') as { slots?: Slot[]; known?: string[] } | null;
      const st = fix(old?.slots ? { bars: [old.slots], known: old.known } : null);
      if (st) {
        this.queueSave(st);
        return st;
      }
    } catch {
      /* unavailable or corrupt */
    }
    return { v: 2, bars: Array.from({ length: BARS }, (_, b) => emptyBar(b)), known: [], shown: [false, false], collapsed: [false, false] };
  }

  /** Send the layout to the server, once things settle (a drag can change it twice in a row). */
  private queueSave(st: BarState) {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.sendBar(st), 500);
  }

  /**
   * The layout to the server. With the socket down (reconnecting) it tries again shortly; game.ts also calls this
   * after every re-entry, since a message sent between the socket opening and the character entering is dropped.
   */
  sendBar(st = this.st) {
    if (!st) return;
    clearTimeout(this.saveTimer);
    this.g.barData = JSON.stringify(st);
    if (this.g.net.open) this.g.net.send({ t: 'hotbar', data: this.g.barData });
    else this.saveTimer = window.setTimeout(() => this.sendBar(st), 2000);
  }

  private saveBar() {
    if (this.st) this.queueSave(this.st);
    this.refreshSlots();
  }

  /** The menu's "Bars" button: tick which extra bars show. */
  toggleBarsMenu() {
    const p = this.barsPop;
    if (p.style.display !== 'none') return void (p.style.display = 'none');
    p.innerHTML = '';
    el('div', 'quest-head', p, tx('Barras de habilidades', 'Skill bars'));
    for (let b = 1; b < BARS; b++) {
      const r = el('label', 'bars-pop-row', p);
      const box = el('input', '', r);
      box.type = 'checkbox';
      box.checked = !!this.st?.shown[b - 1];
      box.onchange = () => {
        if (!this.st) return;
        this.st.shown[b - 1] = box.checked;
        this.st.collapsed[b - 1] = false;
        this.saveBar();
        this.showPage();
      };
      el('span', '', r, tx(`Barra ${b + 1}`, `Bar ${b + 1}`));
    }
    el('div', 'tt-dim bars-pop-hint', p, tx('Las teclas de sus casilleros se asignan en Opciones > Controles.', 'Their slots\' keys are set in Options > Controls.'));
    p.style.display = '';
  }

  refreshSlots() {
    const m = this.g.me;
    this.adenaEl.textContent = this.g.adena.toLocaleString();
    const st = (this.st ??= this.loadBars());
    let added = false;
    // anything new (a skill just learned, a first potion) lands on the main bar's first free slot, once
    const have: NonNullable<Slot>[] = m.skills.map((id) => ({ type: 'skill' as const, id }));
    for (const id of CONSUMABLES) if (this.itemCount(id) > 0) have.push({ type: 'item', id });
    for (const h of have) {
      if (st.known.includes(h.id)) continue;
      st.known.push(h.id);
      const free = st.bars[0].indexOf(null);
      if (free >= 0 && !st.bars.some((row) => row.some((x) => x?.id === h.id))) st.bars[0][free] = h;
      added = true;
    }
    if (added) return this.saveBar();
    const all = st.bars.flat();
    const key = JSON.stringify(st) + all.map((s) => (s?.type === 'item' ? this.itemCount(s.id) : '')).join();
    if (key === this.slotsKey) return;
    this.slotsKey = key;
    // extra bars: hidden, folded or open; the cast bar moves up over the ones on screen
    let up = 0;
    this.barRows.forEach((row, k) => {
      row.style.display = st.shown[k] ? '' : 'none';
      // touch shows them one at a time instead (showPage), never folded
      row.classList.toggle('collapsed', !this.touch && st.collapsed[k]);
      row.querySelector('.bar-toggle')!.textContent = st.collapsed[k] ? '▸' : '▾';
      if (st.shown[k] && !this.touch) up += st.collapsed[k] ? 19 : 47;
    });
    document.documentElement.style.setProperty('--xbars', `${up}px`);
    this.showPage();
    this.slotEls.forEach((els, b) => els.forEach((s, i) => {
      s.querySelector('.icon')?.remove();
      s.querySelector('.cd')?.remove();
      s.querySelector('.cd-num')?.remove();
      const sl = st.bars[b][i];
      s.draggable = !!sl;
      // a consumable that ran out keeps its place, greyed out
      s.classList.toggle('spent', sl?.type === 'item' && this.itemCount(sl.id) === 0);
      if (!sl) return;
      const ic = sl.type === 'skill' ? skillIcon(sl.id) : itemIcon(sl.id, undefined, this.itemCount(sl.id));
      s.prepend(ic);
      el('div', 'cd', s);
      el('span', 'cd-num', s);
    }));
  }

  activateSlot(b: number, i: number) {
    const sl = this.st?.bars[b]?.[i];
    if (!sl) return;
    // a bar out of sight does nothing (touch: only the page on show is)
    if (b > 0 && (this.touch ? b !== this.page : !this.st!.shown[b - 1] || this.st!.collapsed[b - 1])) return;
    // still cooling down for real (not a client guess): shake the slot instead of asking the server
    const cd = this.g.cooldowns.get(sl.type === 'skill' ? sl.id : `item:${sl.id}`);
    const cls = cd && !cd.predicted && cd.end > performance.now() ? 'denied' : 'pressed';
    this.slotEls[b][i].classList.add(cls);
    setTimeout(() => this.slotEls[b][i].classList.remove(cls), cls === 'denied' ? 250 : 120);
    if (cls === 'denied') return;
    if (sl.type === 'skill') this.g.useSkill(sl.id);
    else this.g.useItemById(sl.id);
  }

  refreshTarget() {
    this.lastTargetKey = '';
  }

  /** Your own status effects, next to the buffs. */
  setStatuses(flags: number) {
    this.statusEl.innerHTML = '';
    for (const id of STATUS_IDS.filter((i) => flags & STATUSES[i].flag)) {
      const b = el('div', 'buff status', this.statusEl);
      glyph('status', id, STATUSES[id].icon, b);
      b.title = `${statusName(id, lang)}: ${statusDesc(id, lang)}`;
    }
  }

  /** kind: an extra class for the banner's look ('mw': gold, for a Masterwork) */
  banner(text: string, big = false, kind = '') {
    this.bannerEl.textContent = text;
    this.bannerEl.className = `banner show${big ? ' big' : ''}${kind ? ` ${kind}` : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (this.bannerEl.className = 'banner'), 2600);
  }

  update(now: number) {
    // cooldown overlays
    const held = this.g.inv.find((it) => it.s === 'weapon'), wielded = held ? ITEMS[held.i]?.weaponType : undefined;
    this.slotEls.forEach((els, b) => els.forEach((s, i) => {
      const sl = this.st?.bars[b][i];
      if (!sl) return;
      const ov = s.querySelector('.cd') as HTMLDivElement | null;
      if (!ov) return;
      const cd = this.g.cooldowns.get(sl.type === 'skill' ? sl.id : `item:${sl.id}`);
      const rem = cd ? cd.end - now : 0, dur = cd?.dur ?? 1;
      ov.style.height = rem > 0 ? `${(rem / dur) * 100}%` : '0';
      const num = s.querySelector('.cd-num'), left = rem > 950 ? String(Math.ceil(rem / 1000)) : '';
      if (num && num.textContent !== left) num.textContent = left;
      const noMp = sl.type === 'skill' && this.g.me.mp < (SKILLS[sl.id]?.mp ?? 0);
      s.classList.toggle('nomp', noMp);
      // a skill that asks for a weapon not in hand (the archer's bow, the assassin's dagger)
      const need = sl.type === 'skill' ? SKILLS[sl.id]?.weapon : undefined;
      s.classList.toggle('noweapon', !!need && need !== wielded);
      // a sonic skill with fewer Force charges gathered than it spends
      s.classList.toggle('nocharge', sl.type === 'skill' && (this.g.me.charges ?? 0) < (SKILLS[sl.id]?.spend ?? 0));
      // the skill pressed during the cast, waiting to go when it ends
      s.classList.toggle('queued', sl.type === 'skill' && sl.id === this.g.queuedSkill && !!this.g.castBar?.skill);
    }));
    const self = this.g.self, swing = 60000 / Math.max(1, this.g.me.atkSpd);
    const arem = self && self.atkAt > 0 ? swing - (now - self.atkAt) : 0;
    this.atkCd.style.height = arem > 0 ? `${(arem / swing) * 100}%` : '0';
    const dcd = this.g.cooldowns.get('dash');
    const drem = dcd ? dcd.end - now : 0;
    this.dashCd.style.height = drem > 0 ? `${(drem / dcd!.dur) * 100}%` : '0';
    // cast bar
    const cb = this.g.castBar;
    if (cb && now < cb.end) {
      if (this.cast.style.display !== 'block') this.placeCast();
      this.cast.style.display = 'block';
      this.castFill.style.width = `${100 - ((cb.end - now) / cb.dur) * 100}%`;
      this.castName.textContent = cb.name;
    } else {
      this.cast.style.display = 'none';
      if (cb) this.g.castBar = null;
    }
    // target window
    const id = this.g.targetId;
    const t = id !== null ? this.g.ents.get(id) : undefined;
    if (!t) {
      this.target.style.display = 'none';
      return;
    }
    this.target.style.display = 'block';
    const key = `${t.id}|${t.hp}|${t.flags}|${this.g.me.lvl}`;
    if (key === this.lastTargetKey) return;
    this.lastTargetKey = key;
    const r = t.rec;
    let nameHtml = '';
    if (r.k === 'm') nameHtml = `<span style="color:${conColor(r.l - this.g.me.lvl)}">${esc(mobName(r.tpl, lang))}</span> <span class="tt-dim">${tx('Nv', 'Lv')} ${r.l}</span>`;
    else if (r.k === 'p') {
      const c = t.flags & F_RED ? '#ff4040' : t.flags & F_PURPLE ? '#d080ff' : '#fff';
      nameHtml = `<span style="color:${c}">${esc(r.n)}</span> <span class="tt-dim">${tx('Nv', 'Lv')} ${r.l} ${raceName(r.race, lang)} ${className(r.cls, lang, r.spec)}</span>`;
    } else if (r.k === 'n') nameHtml = `${esc(r.n)} <span class="tt-dim">${esc(npcText(r.npc, 'title', lang))}</span>`;
    else nameHtml = esc(r.item === 'adena' ? 'Adena' : itemName(r.item, lang));
    this.tName.innerHTML = nameHtml + (t.flags & F_DEAD ? ' <span class="tt-dim">(muerto)</span>' : '');
    this.tHp.root.style.display = r.k === 'm' || r.k === 'p' ? '' : 'none';
    this.tHp.set(t.hp, 100);
    this.tHp.text.textContent = `${t.hp}%`;
    this.tActions.innerHTML = '';
    if (r.k === 'p' && r.id !== this.g.me.id) {
      const inv = el('button', 'btn small', this.tActions, tx('Invitar a la party', 'Invite to party'));
      inv.onclick = () => this.g.net.send({ t: 'partyInvite', name: r.n });
      // a trade already open (hidden for another window on a phone) comes back instead of asking again
      const trade = el('button', 'btn small', this.tActions, tx('Comerciar', 'Trade'));
      trade.onclick = () => (this.g.ui.trade.active ? this.g.ui.trade.win.show() : this.g.net.send({ t: 'tradeRequest', id: r.id }));
      const wh = el('button', 'btn small', this.tActions, tx('Susurrar', 'Whisper'));
      wh.onclick = () => this.g.ui.chat.prefill(`"${r.n} `);
    }
  }
}
