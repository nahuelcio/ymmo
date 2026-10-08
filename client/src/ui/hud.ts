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
import { lang, t as tx, fmt } from '../lang';
import { keyLabel, settings, type Action } from '../settings';
import { campName, className, itemDesc, itemName, mobName, npcText, questField, questLineL, questSummaryL, raceName, skillDesc, skillName, statusDesc, statusName, teleportName, zoneName } from '../../../shared/src/i18n';

const CONSUMABLES = ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape'];
export type Slot = { type: 'skill' | 'item'; id: string } | null;

export class Hud {
  private statusEl!: HTMLDivElement;
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
  private slotEls: HTMLDivElement[] = [];
  private slots: Slot[] = [];
  /** ids that were already placed on the bar once, so emptying a slot by hand sticks */
  private known: string[] = [];
  /** what is being dragged onto the bar: one of its own slots, or a skill / consumable from a window */
  drag: { from?: number; slot?: Slot } | null = null;
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
    const st = el('div', 'panel status', root);
    this.name = el('div', 'status-name', st);
    this.buffs = el('div', 'buffs', root);
    this.statusEl = el('div', 'status-row', root);

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
    // vitals sit right above the bar, where the eyes are in a fight: CP strip, then HP | MP, then XP
    const vit = el('div', 'vitals', sc);
    this.cp = bar(vit, 'bar-cp', 'CP');
    this.cp.root.title = tx('CP (Puntos de Combate): absorben el daño que te hacen otros jugadores antes de que baje la vida. No protegen de los monstruos.',
      'CP (Combat Points): soak the damage other players deal before your HP drops. No protection against monsters.');
    this.hp = bar(vit, 'bar-hp', 'HP');
    this.mp = bar(vit, 'bar-mp', 'MP');
    this.xp = bar(sc, 'bar-xp');
    for (let i = 0; i < 10; i++) {
      const s = el('div', 'slot', sc);
      const keyEl = el('span', 'slot-key', s);
      const syncKey = () => (keyEl.textContent = keyLabel(settings.s.keys[`slot${i + 1}` as Action]));
      syncKey();
      settings.on((_, changed) => changed.includes('keys') && syncKey());
      s.onclick = () => this.activateSlot(i);
      // rearrange: drag a slot onto another (they swap), drop a skill or potion from its window, right click empties
      s.ondragstart = () => (hideTip(), (this.drag = { from: i }));
      s.ondragend = () => (this.drag = null);
      s.ondragover = (e) => e.preventDefault();
      s.ondrop = (e) => {
        e.preventDefault();
        const d = this.drag;
        if (!d) return;
        const here = this.slots[i];
        if (d.from !== undefined) [this.slots[d.from], this.slots[i]] = [here, this.slots[d.from]];
        else if (d.slot) {
          // already on the bar somewhere else: that slot takes what was here
          const at = this.slots.findIndex((x) => x?.id === d.slot!.id);
          if (at >= 0) this.slots[at] = here;
          this.slots[i] = d.slot;
        }
        this.saveBar();
      };
      s.oncontextmenu = (e) => {
        e.preventDefault();
        this.slots[i] = null;
        this.saveBar();
      };
      setTip(s, () => {
        const sl = this.slots[i];
        if (!sl) return '';
        return sl.type === 'skill' ? skillTip(sl.id) : itemTip(sl.id, this.itemCount(sl.id));
      });
      this.slotEls.push(s);
    }

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
        b.title = `${label} (${k.textContent})`;
        delete b.dataset.tip;
      };
      sync();
      settings.on((_, changed) => changed.includes('keys') && sync());
      b.onclick = fn;
    };
    btn('character', tx('Personaje', 'Character'), () => g.ui.character.win.toggle());
    btn('inventory', tx('Inventario', 'Inventory'), () => g.ui.inventory.win.toggle());
    btn('map', tx('Mapa', 'Map'), () => g.ui.minimap.toggleMap());
    btn('help', tx('Ayuda', 'Help'), () => g.ui.help.toggle());
    btn('settings', tx('Opciones', 'Settings'), () => g.ui.settings.win.toggle());
    this.pvpBtn = el('button', 'menu-btn pvp-btn', menu, tx('PvP: NO', 'PvP: OFF'));
    this.pvpBtn.title = tx('Activar o desactivar el PvP (/pvp). Desactivado: nadie te puede atacar y vos no podés atacar a otros jugadores (salvo a los PK).', 'Toggle PvP mode (/pvp). Off: players cannot attack you, and you cannot attack them (PKs excepted).');
    this.pvpBtn.onclick = () => g.net.send({ t: 'pvpMode', on: !g.me.pvpOn });

    this.bannerEl = el('div', 'banner', root);

    this.questRoot = el('div', 'panel quest-tracker', root);
    el('div', 'quest-head', this.questRoot, tx('Misiones', 'Quests'));
    this.questList = el('div', '', this.questRoot);
    this.questRoot.style.display = 'none';
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

  /** The bar layout is the player's own, kept per character in this browser. */
  private get barKey() {
    return `hotbar:${this.g.me.name}`;
  }

  private saveBar() {
    try {
      localStorage.setItem(this.barKey, JSON.stringify({ slots: this.slots, known: this.known }));
    } catch {
      /* storage unavailable: the layout lasts for this session */
    }
    this.refreshSlots();
  }

  refreshSlots() {
    const m = this.g.me;
    this.adenaEl.textContent = this.g.adena.toLocaleString();
    if (!this.slots.length) {
      this.slots = Array<Slot>(10).fill(null);
      try {
        const saved = JSON.parse(localStorage.getItem(this.barKey) ?? 'null') as { slots: Slot[]; known: string[] } | null;
        if (saved?.slots?.length === 10) ({ slots: this.slots, known: this.known } = saved);
      } catch {
        /* corrupt or unavailable: start from the automatic layout */
      }
    }
    // anything new (a skill just learned, a first potion) lands on the first free slot, once
    const have: NonNullable<Slot>[] = m.skills.map((id) => ({ type: 'skill' as const, id }));
    for (const id of CONSUMABLES) if (this.itemCount(id) > 0) have.push({ type: 'item', id });
    let added = false;
    for (const h of have) {
      if (this.known.includes(h.id)) continue;
      this.known.push(h.id);
      const free = this.slots.indexOf(null);
      if (free >= 0 && !this.slots.some((x) => x?.id === h.id)) this.slots[free] = h;
      added = true;
    }
    if (added) return this.saveBar();
    const key = JSON.stringify(this.slots) + this.slots.map((s) => (s?.type === 'item' ? this.itemCount(s.id) : '')).join();
    if (key === this.slotsKey) return;
    this.slotsKey = key;
    this.slotEls.forEach((s, i) => {
      s.querySelector('.icon')?.remove();
      s.querySelector('.cd')?.remove();
      s.querySelector('.cd-num')?.remove();
      const sl = this.slots[i];
      s.draggable = !!sl;
      // a consumable that ran out keeps its place, greyed out
      s.classList.toggle('spent', sl?.type === 'item' && this.itemCount(sl.id) === 0);
      if (!sl) return;
      const ic = sl.type === 'skill' ? skillIcon(sl.id) : itemIcon(sl.id, undefined, this.itemCount(sl.id));
      s.prepend(ic);
      el('div', 'cd', s);
      el('span', 'cd-num', s);
    });
  }

  activateSlot(i: number) {
    const sl = this.slots[i];
    if (!sl) return;
    // still cooling down for real (not a client guess): shake the slot instead of asking the server
    const cd = this.g.cooldowns.get(sl.type === 'skill' ? sl.id : `item:${sl.id}`);
    const cls = cd && !cd.predicted && cd.end > performance.now() ? 'denied' : 'pressed';
    this.slotEls[i].classList.add(cls);
    setTimeout(() => this.slotEls[i].classList.remove(cls), cls === 'denied' ? 250 : 120);
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
    this.slotEls.forEach((s, i) => {
      const sl = this.slots[i];
      if (!sl) return;
      const cd = this.g.cooldowns.get(sl.type === 'skill' ? sl.id : `item:${sl.id}`);
      const ov = s.querySelector('.cd') as HTMLDivElement | null;
      if (!ov) return;
      const rem = cd ? cd.end - now : 0;
      ov.style.height = rem > 0 ? `${(rem / cd!.dur) * 100}%` : '0';
      const num = s.querySelector('.cd-num'), left = rem > 950 ? String(Math.ceil(rem / 1000)) : '';
      if (num && num.textContent !== left) num.textContent = left;
      const noMp = sl.type === 'skill' && this.g.me.mp < (SKILLS[sl.id]?.mp ?? 0);
      s.classList.toggle('nomp', noMp);
    });
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
