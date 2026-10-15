import { STATUS_IDS, STATUSES } from '../../../shared/src/status';
import { RACES, CLASSES } from '../../../shared/src/data/classes';
import { ITEMS } from '../../../shared/src/data/items';
import { QUESTS, questSummary } from '../../../shared/src/data/quests';
import { SKILLS } from '../../../shared/src/data/skills';
import { F_DEAD } from '../../../shared/src/protocol';
import { NPCS } from '../../../shared/src/data/world';
import { conColor, F_PURPLE, F_RED, type Game } from '../game';
import { bar, glyph, hydrate, itemIcon, itemTip, skillIcon, skillTip } from './common';
import { el, esc, hideTip, setTip } from './dom';
import { isTouchDevice } from './touch';
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

export class Hud {
  private statusEl!: HTMLDivElement;
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
  private castFill: HTMLDivElement;
  private castName: HTMLSpanElement;
  private bannerEl: HTMLDivElement;
  private bannerTimer = 0;
  private questRoot: HTMLDivElement;
  private questList: HTMLDivElement;
  private lastTargetKey = '';
  private slotsKey = '';

  constructor(private g: Game, root: HTMLElement) {
    // Status window (top-left)
    // as in L2's status window: name, then CP, HP and MP one over the other, out of the way of the centre
    const st = el('div', 'panel status', root);
    this.name = el('div', 'status-name', st);
    this.cp = bar(st, 'bar-cp', 'CP');
    this.cp.root.title = tx('CP (Puntos de Combate): absorben el daño que te hacen otros jugadores antes de que baje la vida. No protegen de los monstruos.',
      'CP (Combat Points): soak the damage other players deal before your HP drops. No protection against monsters.');
    this.hp = bar(st, 'bar-hp', 'HP');
    this.mp = bar(st, 'bar-mp', 'MP');
    this.buffs = el('div', 'buffs', root);
    this.statusEl = el('div', 'status-row', root);
    this.makeStatusMovable(st);

    // Target window (top-center)
    this.target = el('div', 'panel target', root);
    const tTop = el('div', 'target-top', this.target);
    this.tName = el('div', 'target-name', tTop);
    const tClose = el('button', 'btn-x', tTop, '×');
    tClose.onclick = () => g.setTarget(null);
    this.tHp = bar(this.target, 'bar-hp thin');
    this.tActions = el('div', 'target-actions', this.target);

    // Shortcut bar (bottom-center)
    const sc = el('div', 'panel shortcuts', root);
    this.xp = bar(sc, 'bar-xp');
    // bars 2 and 3 stack over the XP strip, edge to edge with the main bar; each folds down to a thin strip with its arrow
    const extra = el('div', 'extra-bars', sc);
    this.slotEls.push(this.buildSlots(0, sc));
    for (let b = 1; b < BARS; b++) {
      const row = el('div', 'bar-row', extra);
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
    setTip(this.atkEl, () => `<div class="tt-title">${tx('Autoataque', 'Auto-attack')} <span class="tt-dim">${keyLabel(settings.s.keys.attack)}</span></div>${tx('Ataca al objetivo seleccionado y sigue pegándole. Sin objetivo, elige el monstruo más cercano. Con Ctrl, fuerza el ataque a un jugador.', 'Attacks the selected target and keeps swinging. With no target, picks the nearest monster. Hold Ctrl to force an attack on a player.')}`);
    this.atkEl.onclick = () => g.attackTarget();

    // Cast bar
    // dodge roll button (Shift) with cooldown sweep
    this.dashEl = el('div', 'slot dash-btn', sc);
    el('span', 'slot-key', this.dashEl, 'Shift');
    glyph('ui', 'dash', '', el('div', 'icon', this.dashEl));
    this.dashCd = el('div', 'cd', this.dashEl);
    this.dashEl.title = tx('Rodar (Shift): esquivás hacia el cursor y sos invulnerable un instante. Ideal para salir de los círculos rojos.', 'Roll (Shift): dodge toward the cursor, briefly invulnerable. Great for getting out of red circles.');
    this.dashEl.onclick = () => g.dash();

    this.cast = el('div', 'castbar', root);
    this.castFill = el('div', 'castbar-fill', this.cast);
    this.castName = el('span', 'castbar-text', this.cast);

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

    // which extra bars are on screen
    this.barsPop = el('div', 'panel bars-pop', root);
    this.barsPop.style.display = 'none';

    this.bannerEl = el('div', 'banner', root);

    this.questRoot = el('div', 'panel quest-tracker', root);
    el('div', 'quest-head', this.questRoot, tx('Misiones', 'Quests'));
    this.questList = el('div', '', this.questRoot);
    this.questRoot.style.display = 'none';
  }

  /**
   * The status window moves by dragging it and widens by its right edge; a double click on the name puts it back.
   * Buffs and status effects stay next to it. Desktop only: on touch screens the layout is fixed.
   */
  private makeStatusMovable(st: HTMLDivElement) {
    if (isTouchDevice()) return;
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
      const from = { x: st.offsetLeft, y: st.offsetTop, w: st.offsetWidth };
      const mv = (ev: PointerEvent) => {
        move(ev.clientX - e.clientX, ev.clientY - e.clientY, from);
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
    addEventListener('resize', apply);
    apply();
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
    this.refreshSlots();
  }

  /** Ten slots of bar b: click or key uses it, drag rearranges (across bars too), right click empties. */
  private buildSlots(b: number, parent: HTMLElement): HTMLDivElement[] {
    const out: HTMLDivElement[] = [];
    for (let i = 0; i < SIZE[b]; i++) {
      const s = el('div', 'slot', parent);
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
        const d = this.drag, bars = this.st?.bars;
        if (!d || !bars) return;
        const here = bars[b][i];
        if (d.from) [bars[d.from.b][d.from.i], bars[b][i]] = [here, bars[d.from.b][d.from.i]];
        else if (d.slot) {
          // already on a bar somewhere else: that slot takes what was here
          for (const row of bars) {
            const at = row.findIndex((x) => x?.id === d.slot!.id);
            if (at >= 0) row[at] = here;
          }
          bars[b][i] = d.slot;
        }
        this.saveBar();
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

  /** The layout the server kept; failing that, the one this browser used to keep (moved to the server); or none yet. */
  private loadBars(): BarState {
    const fix = (v: Partial<BarState> | null): BarState | null => {
      if (!v || !Array.isArray(v.bars)) return null;
      // each bar padded or cut to its size (bars 2-3 were ten slots wide before)
      const bars = Array.from({ length: BARS }, (_, b) => Array.from({ length: SIZE[b] }, (_, i) => {
        const s = v.bars![b]?.[i];
        // auto-attack used to sit on the bar: free the slot an old layout still gives it
        return s && (s.type === 'skill' || s.type === 'item') && typeof s.id === 'string' ? { type: s.type, id: s.id } : null;
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
      row.classList.toggle('collapsed', st.collapsed[k]);
      row.querySelector('.bar-toggle')!.textContent = st.collapsed[k] ? '▸' : '▾';
      if (st.shown[k]) up += st.collapsed[k] ? 19 : 47;
    });
    document.documentElement.style.setProperty('--xbars', `${up}px`);
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
    if (b > 0 && (!this.st!.shown[b - 1] || this.st!.collapsed[b - 1])) return; // a bar out of sight does nothing
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

  banner(text: string, big = false) {
    this.bannerEl.textContent = text;
    this.bannerEl.className = `banner show${big ? ' big' : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (this.bannerEl.className = 'banner'), 2600);
  }

  update(now: number) {
    // cooldown overlays
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
      const wh = el('button', 'btn small', this.tActions, tx('Susurrar', 'Whisper'));
      wh.onclick = () => this.g.ui.chat.prefill(`"${r.n} `);
    }
  }
}
