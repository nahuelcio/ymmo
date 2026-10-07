import { RACES, CLASSES } from '../../../shared/src/data/classes';
import { ITEMS } from '../../../shared/src/data/items';
import { SKILLS } from '../../../shared/src/data/skills';
import { F_DEAD } from '../../../shared/src/protocol';
import { conColor, F_PURPLE, F_RED, type Game } from '../game';
import { bar, itemIcon, itemTip, skillIcon, skillTip } from './common';
import { el, esc, setTip } from './dom';

const CONSUMABLES = ['lesser_healing_potion', 'healing_potion', 'mana_potion', 'scroll_of_escape'];
type Slot = { type: 'skill' | 'item'; id: string } | null;

export class Hud {
  private pvpBtn!: HTMLButtonElement;
  private name: HTMLDivElement;
  private cp; private hp; private mp; private xp;
  private buffs: HTMLDivElement;
  private target: HTMLDivElement;
  private tName: HTMLDivElement;
  private tHp; private tActions: HTMLDivElement;
  private slotEls: HTMLDivElement[] = [];
  private slots: Slot[] = [];
  private cast: HTMLDivElement;
  private castFill: HTMLDivElement;
  private castName: HTMLSpanElement;
  private bannerEl: HTMLDivElement;
  private bannerTimer = 0;
  private lastTargetKey = '';
  private slotsKey = '';

  constructor(private g: Game, root: HTMLElement) {
    // Status window (top-left)
    const st = el('div', 'panel status', root);
    this.name = el('div', 'status-name', st);
    this.cp = bar(st, 'bar-cp');
    this.hp = bar(st, 'bar-hp');
    this.mp = bar(st, 'bar-mp');
    this.xp = bar(st, 'bar-xp');
    this.buffs = el('div', 'buffs', root);

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
    for (let i = 0; i < 10; i++) {
      const s = el('div', 'slot', sc);
      el('span', 'slot-key', s, i === 9 ? '0' : String(i + 1));
      s.onclick = () => this.activateSlot(i);
      setTip(s, () => {
        const sl = this.slots[i];
        if (!sl) return '';
        return sl.type === 'skill' ? skillTip(sl.id) : itemTip(sl.id, this.itemCount(sl.id));
      });
      this.slotEls.push(s);
    }

    // Cast bar
    this.cast = el('div', 'castbar', root);
    this.castFill = el('div', 'castbar-fill', this.cast);
    this.castName = el('span', 'castbar-text', this.cast);

    // Menu (bottom-right)
    const menu = el('div', 'panel menu', root);
    const btn = (label: string, key: string, fn: () => void) => {
      const b = el('button', 'menu-btn', menu, label);
      b.title = `${label} (${key})`;
      b.onclick = fn;
    };
    btn('Character', 'C', () => g.ui.character.win.toggle());
    btn('Inventory', 'I', () => g.ui.inventory.win.toggle());
    btn('Map', 'M', () => g.ui.minimap.toggleMap());
    btn('Help', 'H', () => g.ui.help.toggle());
    btn('⚙ Settings', 'O', () => g.ui.settings.win.toggle());
    this.pvpBtn = el('button', 'menu-btn pvp-btn', menu, 'PvP: OFF');
    this.pvpBtn.title = 'Toggle PvP mode (/pvp). Off: players cannot attack you, and you cannot attack them (PKs excepted).';
    this.pvpBtn.onclick = () => g.net.send({ t: 'pvpMode', on: !g.me.pvpOn });

    this.bannerEl = el('div', 'banner', root);
  }

  private itemCount(id: string) {
    return this.g.inv.filter((i) => i.i === id).reduce((a, i) => a + i.c, 0);
  }

  onMe() {
    const m = this.g.me;
    this.pvpBtn.textContent = m.pvpOn ? '⚔ PvP: ON' : 'PvP: OFF';
    this.pvpBtn.classList.toggle('on', m.pvpOn);
    this.name.innerHTML = `<span class="lvl">${m.lvl}</span> ${esc(m.name)} <span class="tt-dim">${RACES[m.race].name} ${CLASSES[m.cls].name}</span>`;
    this.cp.set(m.cp, m.maxCp);
    this.hp.set(m.hp, m.maxHp);
    this.mp.set(m.mp, m.maxMp);
    if (m.xpNeed > 0) {
      this.xp.set(m.xp, m.xpNeed);
      this.xp.text.textContent = `XP ${((m.xp / m.xpNeed) * 100).toFixed(2)}%`;
    } else {
      this.xp.set(1, 1);
      this.xp.text.textContent = 'MAX LEVEL';
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
      w.title = m.karma > 0 ? `Karma: ${m.karma}` : 'PvP flagged';
    }
    this.refreshSlots();
  }

  refreshSlots() {
    const m = this.g.me;
    const slots: Slot[] = m.skills.map((id) => ({ type: 'skill' as const, id }));
    for (const id of CONSUMABLES) if (this.itemCount(id) > 0) slots.push({ type: 'item', id });
    while (slots.length < 10) slots.push(null);
    const key = JSON.stringify(slots) + slots.map((s) => (s?.type === 'item' ? this.itemCount(s.id) : '')).join();
    if (key === this.slotsKey) return;
    this.slotsKey = key;
    this.slots = slots.slice(0, 10);
    this.slotEls.forEach((s, i) => {
      s.querySelector('.icon')?.remove();
      s.querySelector('.cd')?.remove();
      const sl = this.slots[i];
      if (!sl) return;
      const ic = sl.type === 'skill' ? skillIcon(sl.id) : itemIcon(sl.id, undefined, this.itemCount(sl.id));
      s.prepend(ic);
      el('div', 'cd', s);
    });
  }

  activateSlot(i: number) {
    const sl = this.slots[i];
    if (!sl) return;
    this.slotEls[i].classList.add('pressed');
    setTimeout(() => this.slotEls[i].classList.remove('pressed'), 120);
    if (sl.type === 'skill') this.g.useSkill(sl.id);
    else this.g.useItemById(sl.id);
  }

  refreshTarget() {
    this.lastTargetKey = '';
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
      const noMp = sl.type === 'skill' && this.g.me.mp < (SKILLS[sl.id]?.mp ?? 0);
      s.classList.toggle('nomp', noMp);
    });
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
    if (r.k === 'm') nameHtml = `<span style="color:${conColor(r.l - this.g.me.lvl)}">${esc(r.n)}</span> <span class="tt-dim">Lv ${r.l}</span>`;
    else if (r.k === 'p') {
      const c = t.flags & F_RED ? '#ff4040' : t.flags & F_PURPLE ? '#d080ff' : '#fff';
      nameHtml = `<span style="color:${c}">${esc(r.n)}</span> <span class="tt-dim">Lv ${r.l} ${RACES[r.race].name} ${CLASSES[r.cls].name}</span>`;
    } else if (r.k === 'n') nameHtml = `${esc(r.n)} <span class="tt-dim">${esc(r.title)}</span>`;
    else nameHtml = esc(r.item === 'adena' ? 'Adena' : ITEMS[r.item]?.name ?? '');
    this.tName.innerHTML = nameHtml + (t.flags & F_DEAD ? ' <span class="tt-dim">(dead)</span>' : '');
    this.tHp.root.style.display = r.k === 'm' || r.k === 'p' ? '' : 'none';
    this.tHp.set(t.hp, 100);
    this.tHp.text.textContent = `${t.hp}%`;
    this.tActions.innerHTML = '';
    if (r.k === 'p' && r.id !== this.g.me.id) {
      const inv = el('button', 'btn small', this.tActions, 'Invite to party');
      inv.onclick = () => this.g.net.send({ t: 'partyInvite', name: r.n });
      const wh = el('button', 'btn small', this.tActions, 'Whisper');
      wh.onclick = () => this.g.ui.chat.prefill(`"${r.n} `);
    }
  }
}
