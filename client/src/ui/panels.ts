import { CLASSES, RACES, SPEC_LEVEL, SPECS, type Spec } from '../../../shared/src/data/classes';
import { ENCHANT, enchantChance, enchanted, GRADE_COLOR, ITEMS, SLOTS, type Slot } from '../../../shared/src/data/items';
import { QUESTS } from '../../../shared/src/data/quests';
import { className, itemName, questField, questLineL, questSummaryL, raceName, skillDesc, skillName, specDesc, specName } from '../../../shared/src/i18n';
import { lang, t as tx } from '../lang';

const fmtLoc = lang === 'en' ? 'en-US' : 'es-AR';
import { allSkillsFor } from '../../../shared/src/data/skills';
import type { InvItem, PartyMember, S2C } from '../../../shared/src/protocol';
import type { Game } from '../game';
import { bar, glyph, hydrate, itemIcon, itemIconId, itemTip, skillIcon, skillTip, SLOT_NAME } from './common';
import { isTouchDevice } from './touch';
import { el, esc, hideTip, setTip, Win } from './dom';

const SLOT_LABEL: Record<Slot, string> = SLOT_NAME;
/** the item whose icon outlines each empty equipment slot */
const GHOST: Record<Slot, string> = { head: 'full_plate_helmet', weapon: 'broadsword', chest: 'full_plate_armor', gloves: 'reinforced_gloves', legs: 'karmian_stockings', feet: 'reinforced_boots', amulet: 'necklace_of_valor', earring: 'earring_of_focus', ring: 'ring_of_vigor' };

export class InventoryPanel {
  win: Win;
  private doll: HTMLDivElement;
  private grid: HTMLDivElement;
  private footer: HTMLDivElement;
  private menu: HTMLDivElement | null = null;
  private dollCells: Partial<Record<Slot, HTMLDivElement>> = {};
  private stats?: HTMLDivElement; // built with the doll on the first refresh
  private tabs!: HTMLDivElement;
  private filter: 'all' | 'gear' | 'use' | 'mat' = 'all';
  /** what is being dragged: a bag item (by its uid) or the item worn in a slot */
  private drag: { u?: InvItem['u']; slot?: Slot } | null = null;

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('inventory', tx('Inventario', 'Inventory'), -390, 90, 364, root);
    this.doll = el('div', 'doll', this.win.body);
    this.tabs = el('div', 'tabs inv-tabs', this.win.body);
    const FILTERS = [['all', tx('Todo', 'All')], ['gear', tx('Equipo', 'Gear')], ['use', tx('Consumibles', 'Consumables')], ['mat', tx('Materiales', 'Materials')]] as const;
    for (const [id, label] of FILTERS) {
      const b = el('button', 'tab', this.tabs, label);
      b.dataset.f = id;
      b.onclick = () => ((this.filter = id), this.refresh());
    }
    this.grid = el('div', 'inv-grid', this.win.body);
    this.footer = el('div', 'inv-footer', this.win.body);
    el('div', 'hint', this.win.body, tx('Doble click o arrastrar para equipar · Click derecho para más opciones · ▲ mejora lo que llevás puesto',
      'Double-click or drag to equip · Right-click for more options · ▲ is better than what you wear'));
    // drag a bag item onto the paper doll to wear it, or a worn item into the bag to take it off
    for (const zone of [this.doll, this.grid]) zone.ondragover = (e) => e.preventDefault();
    this.doll.ondrop = () => {
      if (this.drag?.u !== undefined) g.net.send({ t: 'use', u: this.drag.u });
    };
    this.grid.ondrop = () => {
      if (this.drag?.slot) g.net.send({ t: 'unequip', slot: this.drag.slot });
    };
    addEventListener('pointerdown', (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    });
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  /** The stat card in the middle of the paper doll (also refreshed when the server sends new stats). */
  refreshStats() {
    if (!this.stats) return;
    const m = this.g.me;
    const row = (k: string, v: number) => `<span class="stat-k">${k}</span><span class="stat-v">${v}</span>`;
    this.stats.innerHTML = `<div class="ds-name">${esc(m.name)}</div><div class="tt-dim">${tx('Nv', 'Lv')} ${m.lvl} ${className(m.cls, lang, m.spec)}</div>
      <div class="ds-grid">${row(tx('Atq.F', 'P.Atk'), m.pAtk)}${row(tx('Def.F', 'P.Def'), m.pDef)}${row(tx('Atq.M', 'M.Atk'), m.mAtk)}${row(tx('Def.M', 'M.Def'), m.mDef)}</div>`;
  }

  /** The stat a character cares about for this piece, to tell upgrades apart. */
  private score(it: InvItem) {
    const d = ITEMS[it.i];
    return d.type === 'weapon' ? enchanted(d, this.g.me.cls === 'mystic' ? 'mAtk' : 'pAtk', it.e) : enchanted(d, 'pDef', it.e) + enchanted(d, 'mDef', it.e);
  }

  /** Whether the bag holds a scroll that enchants this piece. */
  private hasScroll(id: string) {
    const kind = ITEMS[id].type === 'weapon' ? 'weapon' : 'armor';
    return this.g.inv.some((i) => !i.s && ITEMS[i.i].enchant === kind);
  }

  /** Enchant a piece, asking first once the attempt can fail. */
  private askEnchant(it: InvItem) {
    const e = it.e ?? 0, pct = Math.round(enchantChance(e) * 100), name = itemName(it.i, lang);
    const send = () => this.g.net.send({ t: 'enchant', u: it.u });
    if (pct >= 100) return send();
    const risk = ENCHANT.failDestroys ? tx('Si falla, se destruye.', 'If it fails, it is destroyed.') : tx('Si falla, vuelve a +0.', 'If it fails, it goes back to +0.');
    this.g.ui.dialogs.confirm(tx(`¿Encantar ${name} a +${e + 1}? ${pct}% de éxito. ${risk}`, `Enchant ${name} to +${e + 1}? ${pct}% chance. ${risk}`), send);
  }

  /** Tooltip block: this item's stats against what is worn in the same slot. */
  private compare(it: InvItem): string {
    const d = ITEMS[it.i];
    if (!d.slot) return '';
    const worn = this.g.inv.find((i) => i.s === d.slot);
    const c = worn ? ITEMS[worn.i] : undefined;
    const STATS = [['pAtk', tx('Atq.F', 'P.Atk')], ['mAtk', tx('Atq.M', 'M.Atk')], ['pDef', tx('Def.F', 'P.Def')], ['mDef', tx('Def.M', 'M.Def')], ['hp', 'HP'], ['mp', 'MP']] as const;
    const val = (def: typeof d | undefined, k: (typeof STATS)[number][0], e?: number) => (!def ? 0 : k === 'hp' || k === 'mp' ? def[k] ?? 0 : enchanted(def, k, e));
    const rows = STATS.map(([k, label]) => {
      const dv = val(d, k, it.e) - val(c, k, worn?.e);
      return dv ? `<span class="${dv > 0 ? 'tt-up' : 'tt-down'}">${label} ${dv > 0 ? '+' : ''}${dv}</span>` : '';
    }).filter(Boolean);
    const head = c ? `${tx('Contra lo equipado', 'Against equipped')}: ${esc(itemName(c.id, lang))}` : tx('No tenés nada equipado en ese lugar', 'Nothing equipped in that slot');
    return `<div class="tt-cmp"><span class="tt-dim">${head}</span><br>${rows.join(' &nbsp; ') || tx('Mismas estadísticas', 'Same stats')}</div>`;
  }

  refresh() {
    const g = this.g;
    this.doll.innerHTML = '';
    this.dollCells = {};
    // slots down both sides (head/chest/legs, weapon/gloves/feet) around a card with the stats gear changes
    this.stats = el('div', 'doll-stats', this.doll);
    this.refreshStats();
    SLOTS.forEach((s, k) => {
      const cell = (this.dollCells[s] = el('div', 'doll-slot', this.doll));
      // the ninth slot (ring) sits under the stat card
      cell.style.gridColumn = k === 8 ? '2' : k % 2 ? '3' : '1';
      cell.style.gridRow = String(k === 8 ? 4 : (k >> 1) + 1);
      const it = g.inv.find((i) => i.s === s);
      if (it) {
        itemIcon(it.i, cell, undefined, it.e);
        cell.draggable = true;
        cell.ondragstart = () => (hideTip(), (this.drag = { slot: s }));
        cell.ondragend = () => (this.drag = null);
        cell.ondblclick = () => g.net.send({ t: 'unequip', slot: s });
        // right click enchants what you wear, when the bag holds a scroll for it
        cell.oncontextmenu = (e) => (e.preventDefault(), this.hasScroll(it.i) && this.askEnchant(it));
        setTip(cell, () => itemTip(it.i, 1, it.e) + `<br><span class="tt-dim">${tx('Doble click para sacártelo', 'Double-click to take it off')}${this.hasScroll(it.i) ? tx(' · Click derecho para encantar', ' · Right-click to enchant') : ''}</span>`);
      } else {
        // empty: a faint outline of what goes there
        glyph('item', itemIconId(GHOST[s]), SLOT_LABEL[s], cell).classList.add('doll-ghost');
        cell.title = SLOT_LABEL[s];
      }
    });
    this.grid.innerHTML = '';
    for (const b of this.tabs.children) b.classList.toggle('active', (b as HTMLElement).dataset.f === this.filter);
    const kind = (id: string) => (ITEMS[id].slot ? 'gear' : ITEMS[id].use || ITEMS[id].enchant ? 'use' : 'mat');
    const bag = g.inv.filter((i) => !i.s && (this.filter === 'all' || kind(i.i) === this.filter));
    for (const it of bag) {
      const cell = el('div', 'inv-cell', this.grid);
      itemIcon(it.i, cell, it.c, it.e);
      if (ITEMS[it.i].use) {
        // potions and scrolls can be dragged onto the skill bar
        cell.draggable = true;
        cell.ondragstart = () => (hideTip(), (g.ui.hud.drag = { slot: { type: 'item', id: it.i } }));
        cell.ondragend = () => (g.ui.hud.drag = null);
      }
      const slot = ITEMS[it.i].slot;
      if (slot) {
        const worn = g.inv.find((i) => i.s === slot);
        if (this.score(it) > (worn ? this.score(worn) : 0)) el('span', 'inv-up', cell, '▲');
        cell.draggable = true;
        cell.ondragstart = () => (hideTip(), (this.drag = { u: it.u }), this.dollCells[slot]?.classList.add('match'));
        cell.ondragend = () => ((this.drag = null), this.dollCells[slot]?.classList.remove('match'));
        cell.onmouseenter = () => this.dollCells[slot]?.classList.add('match');
        cell.onmouseleave = () => this.dollCells[slot]?.classList.remove('match');
      }
      cell.ondblclick = () => {
        hideTip();
        g.net.send({ t: 'use', u: it.u });
      };
      cell.oncontextmenu = (e) => {
        e.preventDefault();
        this.closeMenu();
        const m = el('div', 'ctx-menu', document.body);
        m.style.left = `${e.clientX}px`;
        m.style.top = `${e.clientY}px`;
        const def = ITEMS[it.i];
        if (def.slot || def.use) {
          const b = el('button', '', m, def.slot ? tx('Equipar', 'Equip') : tx('Usar', 'Use'));
          b.onclick = () => {
            g.net.send({ t: 'use', u: it.u });
            this.closeMenu();
          };
        }
        if (def.slot && this.hasScroll(it.i)) {
          el('button', '', m, tx(`Encantar a +${(it.e ?? 0) + 1}`, `Enchant to +${(it.e ?? 0) + 1}`)).onclick = () => {
            this.closeMenu();
            this.askEnchant(it);
          };
        }
        const d = el('button', 'danger', m, tx('Destruir', 'Destroy'));
        d.onclick = () => {
          this.closeMenu();
          g.ui.dialogs.confirm(tx(`¿Destruir ${itemName(it.i, lang)}${it.c > 1 ? ` (${it.c})` : ''}?`, `Destroy ${itemName(it.i, lang)}${it.c > 1 ? ` (${it.c})` : ''}?`), () => g.net.send({ t: 'destroy', u: it.u }));
        };
        this.menu = m;
      };
      setTip(cell, () => itemTip(it.i, it.c, it.e) + this.compare(it));
    }
    for (let i = bag.length; i < 40; i++) el('div', 'inv-cell empty', this.grid);
    this.footer.innerHTML = `<span class="adena">${g.adena.toLocaleString(fmtLoc)} Adena</span><span class="tt-dim">${g.inv.length}/80</span>`;
  }
}

export class CharacterPanel {
  win: Win;
  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('character', tx('Estado del Personaje', 'Character Status'), 16, 210, 300, root);
    this.win.onShow = () => this.refresh();
  }

  refresh() {
    if (!this.win.visible) return;
    const m = this.g.me;
    const b = this.win.body;
    b.innerHTML = '';
    el('div', 'char-head', b).innerHTML = `<b>${esc(m.name)}</b><br><span class="tt-dim">${tx('Nv', 'Lv')} ${m.lvl} ${raceName(m.race, lang)} ${className(m.cls, lang, m.spec)}</span>`;
    const grid = el('div', 'stat-grid', b);
    const rows: [string, string | number][] = [
      ['HP', `${m.hp}/${m.maxHp}`], ['MP', `${m.mp}/${m.maxMp}`], ['CP', `${m.cp}/${m.maxCp}`],
      ['XP', m.xpNeed ? `${m.xp}/${m.xpNeed}` : 'MAX'],
      [tx('Atq.F', 'P.Atk'), m.pAtk], [tx('Atq.M', 'M.Atk'), m.mAtk], [tx('Def.F', 'P.Def'), m.pDef], [tx('Def.M', 'M.Def'), m.mDef],
      [tx('Precisión', 'Accuracy'), m.acc], [tx('Evasión', 'Evasion'), m.eva], [tx('Crítico', 'Critical'), `${m.crit}%`], [tx('Vel.Atq', 'Atk.Spd'), m.atkSpd], [tx('Velocidad', 'Speed'), m.speed],
      ['Karma', m.karma], ['PvP', m.pvp], ['PK', m.pk],
    ];
    for (const [k, v] of rows) {
      el('span', 'stat-k', grid, k);
      el('span', 'stat-v', grid, String(v));
    }
    if (m.lvl >= SPEC_LEVEL && !m.spec) {
      el('div', 'section', b, tx('Elegí tu especialización', 'Choose your specialization'));
      for (const sp of (Object.keys(SPECS) as Spec[]).filter((s) => SPECS[s].base === m.cls)) {
        const card = el('div', 'skill-row', b);
        const skills = allSkillsFor(m.cls, m.race, m.look.g, sp).filter((s) => s.spec).map((s) => skillName(s.id, lang)).join(' · ');
        el('div', '', card).innerHTML = `<b>${esc(specName(sp, lang))}</b><br><span class="tt-dim">${esc(specDesc(sp, lang))}<br>${esc(skills)}</span>`;
        el('button', 'btn primary', card, tx('Elegir', 'Choose')).onclick = () => {
          if (confirm(tx(`¿Ser ${specName(sp, lang)}? No se puede cambiar después.`, `Become a ${specName(sp, lang)}? This cannot be changed later.`))) this.g.net.send({ t: 'chooseSpec', spec: sp });
        };
      }
    }
    el('div', 'section', b, tx('Habilidades', 'Skills'));
    const list = el('div', 'skill-list', b);
    for (const s of allSkillsFor(m.cls, m.race, m.look.g, m.spec)) {
      const row = el('div', `skill-row${s.level > m.lvl ? ' locked' : ''}`, list);
      skillIcon(s.id, row);
      el('div', '', row).innerHTML = `<b>${esc(skillName(s.id, lang))}</b> <span class="tt-dim">${s.level > m.lvl ? tx(`se aprende en Nv ${s.level}`, `learned at Lv ${s.level}`) : `MP ${s.mp}`}</span><br><span class="tt-dim">${esc(skillDesc(s.id, lang))}</span>`;
      setTip(row, () => skillTip(s.id));
      if (m.skills.includes(s.id)) {
        row.draggable = true;
        row.ondragstart = () => (hideTip(), (this.g.ui.hud.drag = { slot: { type: 'skill', id: s.id } }));
        row.ondragend = () => (this.g.ui.hud.drag = null);
      }
    }
    el('div', 'hint', b, tx('Arrastrá una habilidad a la barra para ubicarla. En la barra: arrastrá un casillero sobre otro para intercambiarlos, click derecho para vaciarlo.',
      'Drag a skill onto the bar to place it. On the bar: drag a slot onto another to swap them, right click to empty it.'));
  }
}

export class NpcPanel {
  win: Win;
  private msg: Extract<S2C, { t: 'npc' }> | null = null;
  private tab: 'buy' | 'craft' | 'sell' = 'buy';

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('npc', tx('Vendedor', 'Merchant'), 380, 110, 380, root);
  }

  open(m: Extract<S2C, { t: 'npc' }>) {
    this.msg = m;
    this.tab = 'buy';
    this.win.titleEl.textContent = `${m.name} — ${m.title}`;
    this.render();
    this.win.show();
  }

  refresh() {
    if (this.win.visible && this.msg) this.render();
  }

  /** Keep an open quest dialog in step with the tracker. */
  syncQuest(list: { id: string; progress: number }[]) {
    const q = this.msg?.kind === 'quest' ? this.msg.quest : undefined;
    if (!q || !this.win.visible || (q.status !== 'active' && q.status !== 'ready')) return;
    const live = list.find((row) => row.id === q.id);
    const def = QUESTS[q.id];
    if (!live || !def) return;
    q.progress = live.progress;
    q.status = live.progress >= def.objective.count ? 'ready' : 'active';
    this.render();
  }

  private render() {
    const m = this.msg!;
    const g = this.g;
    const b = this.win.body;
    b.innerHTML = '';
    el('div', 'npc-greet', b, `"${m.greeting}"`);
    if (m.kind === 'talker') {
      const row = el('div', 'row', b);
      const more = el('button', 'btn', row, tx('Seguir escuchando...', 'Keep listening...'));
      more.onclick = () => g.net.send({ t: 'talk', id: m.npc });
      const bye = el('button', 'btn', row, tx('Irse despacito', 'Slowly back away'));
      bye.onclick = () => this.win.hide();
      const c = g.ents.get(m.npc);
      if (c) g.speech(c, m.greeting);
      return;
    }
    if (m.kind === 'quest') {
      this.renderQuest(m, b);
      return;
    }
    if (m.kind === 'gatekeeper') {
      for (const d of m.dests ?? []) {
        const row = el('div', 'shop-row', b);
        el('div', 'grow', row).innerHTML = `<b>${esc(d.name)}</b><br><span class="tt-dim">${d.cost ? tx(`${d.cost} de adena`, `${d.cost} adena`) : tx('Gratis', 'Free')}</span>`;
        const btn = el('button', 'btn', row, tx('Viajar', 'Travel'));
        btn.disabled = g.adena < d.cost;
        btn.onclick = () => g.net.send({ t: 'teleport', npc: m.npc, dest: d.id });
      }
      return;
    }
    const tabs = el('div', 'tabs', b);
    const TAB = { buy: tx('Comprar', 'Buy'), craft: tx('Fabricar', 'Craft'), sell: tx('Vender', 'Sell') };
    for (const t of m.craft ? (['buy', 'craft', 'sell'] as const) : (['buy', 'sell'] as const)) {
      const tb = el('button', `tab${this.tab === t ? ' active' : ''}`, tabs, TAB[t]);
      tb.onclick = () => {
        this.tab = t;
        this.render();
      };
    }
    const list = el('div', 'shop-list', b);
    if (this.tab === 'buy') {
      for (const id of m.shop ?? []) {
        const def = ITEMS[id];
        const row = el('div', 'shop-row', list);
        itemIcon(id, row);
        const info = el('div', 'grow', row);
        info.innerHTML = `<span style="color:${def.grade ? GRADE_COLOR[def.grade] : '#ddd'}">${esc(itemName(id, lang))}</span><br><span class="tt-dim">${def.price} adena</span>`;
        setTip(row, () => itemTip(id));
        const qty = el('input', 'qty', row);
        qty.type = 'number';
        qty.min = '1';
        qty.value = '1';
        qty.addEventListener('keydown', (e) => e.stopPropagation());
        const btn = el('button', 'btn', row, tx('Comprar', 'Buy'));
        btn.onclick = () => g.net.send({ t: 'buy', npc: m.npc, item: id, qty: Math.max(1, Math.floor(+qty.value || 1)) });
      }
    } else if (this.tab === 'craft') {
      // made to order: the recipe's materials (red when you are short) and a fee
      const have = (id: string) => g.inv.reduce((n, i) => n + (i.i === id && !i.s ? i.c : 0), 0);
      for (const id of m.craft ?? []) {
        const def = ITEMS[id], rec = def.craft;
        if (!rec) continue;
        const row = el('div', 'shop-row', list);
        itemIcon(id, row);
        const mats = rec.mats.map(([mid, n]) => `<span class="${have(mid) >= n ? 'tt-dim' : 'tt-down'}">${n} × ${esc(itemName(mid, lang))} (${have(mid)})</span>`).join(' · ');
        el('div', 'grow', row).innerHTML = `<span style="color:${def.grade ? GRADE_COLOR[def.grade] : '#ddd'}">${esc(itemName(id, lang))}</span><br>${mats} · <span class="${g.adena >= rec.adena ? 'tt-dim' : 'tt-down'}">${rec.adena} adena</span>`;
        setTip(row, () => itemTip(id));
        const btn = el('button', 'btn', row, tx('Fabricar', 'Craft'));
        btn.disabled = g.adena < rec.adena || rec.mats.some(([mid, n]) => have(mid) < n);
        btn.onclick = () => g.net.send({ t: 'craft', npc: m.npc, item: id });
      }
    } else {
      const sellable = g.inv.filter((i) => !i.s);
      if (!sellable.length) el('div', 'tt-dim', list, tx('No tenés nada para vender.', 'You have nothing to sell.'));
      for (const it of sellable) {
        const def = ITEMS[it.i];
        const row = el('div', 'shop-row', list);
        itemIcon(it.i, row, it.c);
        el('div', 'grow', row).innerHTML = `${esc(itemName(it.i, lang))}${it.c > 1 ? ` ×${it.c}` : ''}<br><span class="tt-dim">${Math.floor(def.price / 2)} ${tx('adena c/u', 'adena each')}</span>`;
        setTip(row, () => itemTip(it.i, it.c));
        const qty = el('input', 'qty', row);
        qty.type = 'number';
        qty.min = '1';
        qty.max = String(it.c);
        qty.value = String(it.c);
        qty.addEventListener('keydown', (e) => e.stopPropagation());
        const btn = el('button', 'btn', row, tx('Vender', 'Sell'));
        btn.onclick = () => g.net.send({ t: 'sell', npc: m.npc, u: it.u, qty: Math.min(it.c, Math.max(1, Math.floor(+qty.value || 1))) });
      }
    }
    el('div', 'inv-footer', b).innerHTML = `<span class="adena">${g.adena.toLocaleString(fmtLoc)} Adena</span>`;
  }

  private renderQuest(m: Extract<S2C, { t: 'npc' }>, b: HTMLElement) {
    const q = m.quest;
    const def = q ? QUESTS[q.id] : undefined;
    if (!q || !def) return;
    el('div', 'section', b, questField(def, 'name', lang));
    el('div', '', b, questSummaryL(def, lang));
    el('div', 'npc-greet', b, `"${questLineL(def, q.status, lang)}"`);
    if (q.status === 'active' || q.status === 'ready') {
      const row = el('div', '', b);
      row.innerHTML = `${tx('Progreso', 'Progress')}: <b class="${q.progress >= def.objective.count ? 'qt-ready' : ''}">${q.progress}/${def.objective.count}</b>`;
    }
    if (q.status !== 'done') {
      el('div', 'tt-dim', b, tx(`Recompensa: ${def.xp.toLocaleString(fmtLoc)} de XP y ${def.adena.toLocaleString(fmtLoc)} de adena`, `Reward: ${def.xp.toLocaleString(fmtLoc)} XP and ${def.adena.toLocaleString(fmtLoc)} adena`));
    }
    if (q.status === 'available') {
      el('div', 'npc-greet', b, def.story);
      const btn = el('button', 'btn primary', b, tx('Aceptar', 'Accept'));
      btn.style.marginTop = '8px';
      btn.onclick = () => this.g.net.send({ t: 'questAccept', npc: m.npc });
    } else if (q.status === 'ready') {
      const btn = el('button', 'btn primary', b, tx('Entregar', 'Turn in'));
      btn.style.marginTop = '8px';
      btn.onclick = () => this.g.net.send({ t: 'questTurnIn', npc: m.npc });
    }
  }
}

export class PartyPanel {
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  members: PartyMember[] | null = null;
  /** damage dealt by each member in the current fight (a fight ends after 10 s without a hit) */
  private meter: HTMLDivElement;
  private dmg = new Map<number, number>();
  private fightStart = 0;
  private fightLast = 0;

  constructor(private g: Game, parent: HTMLElement) {
    this.root = el('div', 'panel party', parent);
    const head = el('div', 'party-head', this.root, 'Party');
    const leave = el('button', 'btn small', head, tx('Salir', 'Leave'));
    leave.onclick = () => g.net.send({ t: 'partyLeave' });
    this.list = el('div', '', this.root);
    this.meter = el('div', 'dmg-meter', this.root);
    this.root.style.display = 'none';
  }

  /** A hit landed by `src`: only what this client sees (members out of view aren't counted). */
  hit(src: number, v: number) {
    const members = this.members;
    if (!members?.some((m) => m.id === src)) return;
    const now = performance.now();
    if (now - this.fightLast > 10000) {
      this.dmg.clear();
      this.fightStart = now;
    }
    this.fightLast = now;
    this.dmg.set(src, (this.dmg.get(src) ?? 0) + v);
    const rows = [...this.dmg].sort((a, b) => b[1] - a[1]), secs = Math.max(1, (now - this.fightStart) / 1000);
    this.meter.innerHTML = `<div class="dm-head">${tx('Daño', 'Damage')}</div>` + rows.map(([id, total]) =>
      `<div class="dm-row" style="--w:${Math.round((total / rows[0][1]) * 100)}%"><span>${esc(members.find((m) => m.id === id)?.name ?? '?')}</span><span>${total} · ${Math.round(total / secs)}/s</span></div>`).join('');
  }

  toggle() {
    if (!this.members) this.g.sys(tx('No estás en ninguna party. Seleccioná a un jugador y tocá "Invitar a la party", o escribí /invite nombre.', 'You are not in a party. Select a player and press "Invite to party", or type /invite name.'));
  }

  set(members: PartyMember[] | null) {
    this.members = members;
    this.root.style.display = members ? '' : 'none';
    this.list.innerHTML = '';
    for (const m of members ?? []) {
      if (m.id === this.g.me.id) continue;
      const row = el('div', 'party-member', this.list);
      const nm = el('div', 'pm-name', row);
      nm.innerHTML = `${m.leader ? '<i data-gi="ui/crown"></i> ' : ''}${esc(m.name)} <span class="tt-dim">${tx('Nv', 'Lv')} ${m.lvl} ${className(m.cls, lang, m.spec)}</span>`;
      hydrate(nm);
      bar(row, 'bar-cp thin').set(m.cp, m.maxCp);
      bar(row, 'bar-hp thin').set(m.hp, m.maxHp);
      bar(row, 'bar-mp thin').set(m.mp, m.maxMp);
      row.onclick = () => this.g.setTarget(m.id);
    }
  }
}

export class Dialogs {
  private root: HTMLDivElement;
  constructor(private g: Game, parent: HTMLElement) {
    this.root = el('div', 'dialog', parent);
    this.root.style.display = 'none';
  }

  get open() {
    return this.root.style.display !== 'none';
  }

  close() {
    this.root.style.display = 'none';
  }

  private show(html: string, buttons: [string, () => void, string?][], closable = true) {
    this.root.innerHTML = '';
    el('div', 'dialog-text', this.root).innerHTML = html;
    const row = el('div', 'dialog-btns', this.root);
    for (const [label, fn, cls] of buttons) {
      const b = el('button', `btn ${cls ?? ''}`, row, label);
      b.onclick = () => {
        if (closable) this.close();
        fn();
      };
    }
    this.root.style.display = '';
  }

  death() {
    this.show(tx('<b>Moriste.</b><br><span class="tt-dim">¿Volver a la Aldea del Alba?</span>', '<b>You died.</b><br><span class="tt-dim">Return to Dawn Village?</span>'), [[tx('Volver a la aldea', 'Return to village'), () => this.g.net.send({ t: 'respawn' }), 'primary']]);
  }

  invite(from: string) {
    this.show(tx(`<b>${esc(from)}</b> te invitó a su party.`, `<b>${esc(from)}</b> invited you to their party.`), [
      [tx('Aceptar', 'Accept'), () => this.g.net.send({ t: 'partyRespond', accept: true }), 'primary'],
      [tx('Rechazar', 'Decline'), () => this.g.net.send({ t: 'partyRespond', accept: false })],
    ]);
  }

  confirm(text: string, ok: () => void) {
    this.show(esc(text), [[tx('Aceptar', 'OK'), ok, 'primary'], [tx('Cancelar', 'Cancel'), () => {}]]);
  }
}

type AdminState = Extract<S2C, { t: 'admin'; ok: true }>;
const WARN_MS = 10; // same threshold as the server's [perf] warning

/** Server admin window (/admin in the chat): tick cost per world, players, logs. Polls only while it is open. */
export class AdminPanel {
  win: Win;
  private mode: 'none' | 'login' | 'panel' = 'none';
  private since = 0;
  private logs: AdminState['logs'] = [];
  private hist = new Map<number, number[]>();
  private timer = 0;
  private playersKey = '';
  private loginMsg!: HTMLElement;
  private stats!: HTMLElement;
  private worlds!: HTMLElement;
  private players!: HTMLElement;
  private logBox!: HTMLElement;
  private filter!: HTMLInputElement;
  private onlyErr!: HTMLInputElement;

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('admin', 'Admin', 340, 50, 620, root);
    this.win.onShow = () => {
      if (this.mode === 'none') this.win.body.textContent = tx('Esperando al servidor… Si esto no cambia, este servidor no tiene el panel de admin.', 'Waiting for the server… If this stays, this server has no admin panel.');
      this.poll();
      clearInterval(this.timer);
      this.timer = window.setInterval(() => (this.win.visible ? this.poll() : clearInterval(this.timer)), 2000);
    };
  }

  private poll(extra: { pass?: string; kick?: number; announce?: string } = {}) {
    this.g.net.send({ t: 'admin', since: this.since, ...extra });
  }

  set(m: Extract<S2C, { t: 'admin' }>) {
    if (!m.ok) return this.login();
    if (this.mode !== 'panel') this.build();
    this.render(m);
  }

  private login() {
    if (this.mode === 'login') return;
    this.mode = 'login';
    const b = this.win.body;
    b.innerHTML = '';
    const f = el('form', 'adm-row', b);
    const pass = el('input', 'chat-input', f);
    pass.type = 'password';
    pass.autocomplete = 'off';
    pass.required = true;
    pass.placeholder = pass.ariaLabel = tx('Contraseña de admin', 'Admin password');
    el('button', 'btn', f, tx('Entrar', 'Log in'));
    this.loginMsg = el('div', 'adm-bad', b);
    this.loginMsg.setAttribute('role', 'alert');
    f.onsubmit = (e) => {
      e.preventDefault();
      this.poll({ pass: pass.value });
      pass.value = '';
      // still on this form after the reply: it was refused
      setTimeout(() => this.mode === 'login' && (this.loginMsg.textContent = tx('Contraseña incorrecta (o el panel está desactivado).', 'Wrong password (or the panel is disabled).')), 1500);
    };
    pass.focus();
  }

  private build() {
    this.mode = 'panel';
    const b = this.win.body;
    b.innerHTML = '';
    this.stats = el('div', 'stat-grid', b);
    el('div', 'section', b, tx('Mundos', 'Worlds'));
    this.worlds = el('table', 'adm-table', b);
    el('div', 'section', b, tx('Jugadores', 'Players'));
    this.players = el('table', 'adm-table', b);
    el('div', 'section', b, tx('Anuncio a todos', 'Announce to everyone'));
    const ann = el('form', 'adm-row', b);
    const text = el('input', 'chat-input', ann);
    text.maxLength = 200;
    text.required = true;
    text.ariaLabel = tx('Texto del anuncio', 'Announcement text');
    el('button', 'btn', ann, tx('Enviar', 'Send'));
    ann.onsubmit = (e) => {
      e.preventDefault();
      this.poll({ announce: text.value });
      text.value = '';
    };
    el('div', 'section', b, 'Logs');
    const row = el('div', 'adm-row', b);
    this.filter = el('input', 'chat-input', row);
    this.filter.type = 'search';
    this.filter.placeholder = this.filter.ariaLabel = tx('Filtrar logs', 'Filter logs');
    const lbl = el('label', '', row);
    this.onlyErr = el('input', '', lbl);
    this.onlyErr.type = 'checkbox';
    lbl.append(tx(' Solo errores', ' Errors only'));
    this.filter.oninput = this.onlyErr.onchange = () => this.drawLogs();
    this.logBox = el('div', 'adm-log', b);
    this.logBox.tabIndex = 0;
  }

  private render(m: AdminState) {
    const cls = (v: number) => (v > m.tickMs ? 'adm-bad' : v > WARN_MS ? 'adm-warn' : '');
    const ms = (v: number) => `<td class="${cls(v)}">${v.toFixed(2)} ms</td>`;
    const world = (id: number) => (id === 0 ? tx('Mundo principal', 'Overworld') : `Raid #${id}`);
    const up = m.uptime >= 3600 ? `${Math.floor(m.uptime / 3600)} h ${Math.floor((m.uptime % 3600) / 60)} m` : `${Math.floor(m.uptime / 60)} m ${m.uptime % 60} s`;
    const worst = Math.max(0, ...m.worlds.map((w) => w.max));
    const stat = (k: string, v: string, c = '') => `<span class="stat-k">${k}</span><span class="stat-v ${c}">${v}</span>`;
    this.stats.innerHTML = stat('Uptime', up) + stat(tx('Conexiones', 'Connections'), `${m.conns} (${m.players.length} ${tx('jugando', 'in game')})`)
      + stat(tx('Peor tick', 'Worst tick'), `${worst.toFixed(1)} / ${m.tickMs} ms`, cls(worst)) + stat(tx('Memoria', 'Memory'), m.rss == null ? '—' : `${(m.rss / 1048576).toFixed(0)} MB`);

    for (const id of this.hist.keys()) if (!m.worlds.some((w) => w.id === id)) this.hist.delete(id);
    this.worlds.innerHTML = `<tr><th>${tx('Mundo', 'World')}</th><th>${tx('Jugadores', 'Players')}</th><th>${tx('Entidades', 'Entities')}</th><th>${tx('Tick medio', 'Avg tick')}</th><th>${tx('Peor tick', 'Worst tick')}</th><th>${tx('Carga', 'Load')}</th><th>${tx('Historial', 'History')}</th></tr>`
      + m.worlds.sort((a, b) => a.id - b.id).map((w) => {
        const h = this.hist.get(w.id) ?? [];
        this.hist.set(w.id, h);
        h.push(w.tick);
        if (h.length > 60) h.shift();
        const top = Math.max(WARN_MS, ...h);
        const pts = h.map((v, i) => `${i * 2},${(17 - (v / top) * 16).toFixed(1)}`).join(' ');
        return `<tr><td>${world(w.id)}</td><td>${w.players}</td><td>${w.ents}</td>${ms(w.tick)}${ms(w.max)}<td class="${cls(w.tick)}">${((w.tick / m.tickMs) * 100).toFixed(1)} %</td>`
          + `<td><svg class="adm-spark" width="120" height="18" role="img" aria-label="${tx('Tick medio reciente, máximo', 'Recent average tick, peak')} ${top.toFixed(1)} ms"><polyline points="${pts}"/></svg></td></tr>`;
      }).join('');

    // only rebuild the players table when it changed, so a focused Kick button survives the poll
    const key = JSON.stringify(m.players);
    if (key !== this.playersKey) {
      this.playersKey = key;
      this.players.innerHTML = `<tr><th>${tx('Nombre', 'Name')}</th><th>${tx('Nivel', 'Level')}</th><th>${tx('Mundo', 'World')}</th><th>${tx('Cola de salida', 'Send queue')}</th><th></th></tr>`;
      for (const p of m.players.sort((a, b) => a.name.localeCompare(b.name))) {
        const tr = el('tr', '', this.players);
        el('td', '', tr, p.name || '?');
        el('td', '', tr, String(p.level));
        el('td', '', tr, world(p.world));
        el('td', p.queue > 50 ? 'adm-warn' : '', tr, String(p.queue));
        const kick = el('button', 'btn small danger', el('td', '', tr), 'Kick');
        kick.ariaLabel = `Kick ${p.name}`;
        kick.onclick = () => this.poll({ kick: p.sid });
      }
    }

    this.since = m.seq;
    if (m.logs.length) {
      this.logs = this.logs.concat(m.logs).slice(-1000);
      this.drawLogs();
    }
  }

  private drawLogs() {
    const box = this.logBox, q = this.filter.value.toLowerCase();
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    box.innerHTML = this.logs.filter((l) => (!this.onlyErr.checked || l.err) && l.line.toLowerCase().includes(q))
      .map((l) => `<div${l.err ? ' class="adm-bad"' : ''}>${new Date(l.t).toLocaleTimeString(fmtLoc)}  ${esc(l.line)}</div>`).join('');
    if (atEnd) box.scrollTop = box.scrollHeight;
  }
}

export function createHelp(root: HTMLElement): Win {
  const w = new Win('help', tx('Cómo jugar', 'How to play'), 380, 80, 420, root);
  w.body.innerHTML = lang === 'en' ? HELP_EN : `
  <div class="help">
    <h4>Movimiento y cámara</h4>
    <p><b>Click izquierdo</b> en el piso para moverte (si lo mantenés apretado, seguís al cursor). <b>Click derecho y arrastrar</b> gira la cámara y la <b>rueda</b> hace zoom. Q/E o las flechas también giran.</p>
    <h4>Combate</h4>
    <p><b>Click izquierdo</b> en un monstruo o jugador para <b>seleccionarlo</b>. El <b>autoataque</b> de la barra (o <b>Espacio</b>) lo ataca y sigue pegándole; sin objetivo, elige el más cercano. <b>Tab</b> va pasando por los monstruos cercanos.
    Las habilidades y pociones están en la barra de atajos: teclas <b>1-0</b> o <b>F1-F10</b>. Las habilidades nuevas se aprenden solas al subir de nivel.</p>
    <p>Con <b>Shift</b> rodás hacia el cursor y sos invulnerable un instante (cada 5 s). Los jefes y algunos élites avisan sus golpes fuertes con un <b style="color:#ff5a3a">círculo rojo</b> en el piso: salí antes de que se llene. Algunas habilidades y monstruos dejan estados: <i data-gi="status/stun"></i> aturdido, <i data-gi="status/slow"></i> ralentizado, <i data-gi="status/bleed"></i> sangrado y <i data-gi="status/poison"></i> veneno. Aturdir a un jefe le corta el ataque especial.</p>
    <h4>Botín</h4>
    <p>Hacé click en los objetos del piso o apretá <b>Z</b> para juntar el más cercano. Los materiales se los podés vender a cualquier vendedor.</p>
    <h4>Aldea del Alba</h4>
    <p>Hablá con <b>Lia</b> (pociones), <b>Gerald</b> (armas), <b>Hilda</b> (armaduras) y <b>Roxxy</b>, la Guardiana del Portal, que te lleva a las zonas de caza. Los vecinos con misiones te pagan por darles una mano. Y el viejo <b>Luigi</b>, al lado de la fuente, te va a contar todo sobre el chat. Todo.</p>
    <h4>Campamentos hostiles</h4>
    <p>Cada zona tiene un campamento marcado con <i data-gi="ui/pvp"></i> en el mapa, defendido por un jefe <i data-gi="ui/crown"></i> <b>élite</b>. Si limpiás el campamento entero, aparece un <b>cofre</b> junto a la fogata para cada uno que peleó. El campamento se vuelve a llenar unos minutos después.</p>
    <h4>Zonas de caza</h4>
    <p>Praderas Ventosas (1-5) · Colinas Goblin (5-10) · Cuartel Orco (10-15) · Páramos Malditos (15-20, jefe Kaim Vanul) · Costa Abandonada (20-25) · Ruinas Hundidas (25-30) · Estepas Ardientes (30-35) · Ciudadela Orca (35-40) · Valle del Dragón (40-45) · Nido del Dragón (45-50).</p>
    <p>A nivel 20 elegís una <b>especialización</b> en Estado del Personaje. Con un <b>pergamino de encantar</b> en la mochila, click derecho sobre un arma o armadura la sube +1: hasta +3 es seguro, después puede fallar y destruirla.</p>
    <p>El <b>Bastión del Ocaso</b>, por el camino del noreste o con la Guardiana del Portal, vende el equipo de grado B, y sus maestros <b>fabrican</b> el de grado A y S con los materiales que sueltan las zonas de nivel 30 a 50.</p>
    <h4>Party y PvP</h4>
    <p>Seleccioná a un jugador → <b>Invitar a la party</b>. Los miembros de la party comparten la XP con un bonus.
    El PvP arranca <b>desactivado</b>: se cambia con el botón <b>PvP</b> o con <code>/pvp</code>, y los dos jugadores lo tienen que tener activado. <b>Ctrl</b> y el autoataque (o Ctrl+Espacio) fuerza el ataque a un jugador con PvP (fuera de la aldea). Atacar te pone el flag <span style="color:#d080ff">violeta</span>;
    matar a un jugador sin flag te suma karma y te pone en <span style="color:#ff4040">rojo</span>, y a los rojos se les pueden caer objetos al morir.</p>
    <h4>Ventanas</h4>
    <p><b>I</b> inventario · <b>C</b> personaje · <b>M</b> mapa · <b>H</b> ayuda · <b>O</b> opciones · <b>Enter</b> chat · <b>Esc</b> cerrar / soltar objetivo</p>
  </div>`;
  hydrate(w.body);
  if (isTouchDevice()) {
    // phones: how the touch controls work, before the keyboard/mouse guide
    const touch = document.createElement('div');
    touch.className = 'help';
    touch.innerHTML = tx(
      '<h4>En el celular</h4><p><b>Joystick</b> (abajo a la izquierda) para caminar. <b>Tocá</b> el piso para ir caminando hasta ahí, un monstruo o jugador para seleccionarlo, un NPC para hablar o un objeto para juntarlo. <b>Arrastrá con un dedo</b> para girar la cámara y <b>pellizcá</b> para el zoom.</p><p><b>Atacar</b> pega al objetivo (o elige el más cercano) y sigue pegándole, <b>Rodar</b> esquiva, <b>Objetivo</b> pasa al siguiente monstruo y <b>Juntar</b> levanta lo que esté cerca. Las habilidades y pociones están en la barra de abajo.</p>',
      '<h4>On your phone</h4><p>The <b>joystick</b> (bottom left) walks. <b>Tap</b> the ground to walk there, a monster or player to select them, an NPC to talk or an item to pick it up. <b>Drag one finger</b> to turn the camera and <b>pinch</b> to zoom.</p><p><b>Attack</b> hits your target (or picks the nearest) and keeps swinging, <b>Roll</b> dodges, <b>Target</b> cycles monsters and <b>Loot</b> picks up what is nearby. Skills and potions are on the bottom bar.</p>',
    );
    w.body.prepend(touch);
  }
  return w;
}

const HELP_EN = `
  <div class="help">
    <h4>Movement and camera</h4>
    <p><b>Left-click</b> the ground to move (hold it to follow the cursor). <b>Right-click and drag</b> rotates the camera and the <b>wheel</b> zooms. Q/E or the arrow keys also rotate.</p>
    <h4>Combat</h4>
    <p><b>Left-click</b> a monster or player to <b>select</b> them. The bar's <b>auto-attack</b> (or <b>Space</b>) attacks them and keeps swinging; with no target it picks the nearest one. <b>Tab</b> cycles through nearby monsters.
    Skills and potions live in the hotbar: keys <b>1-0</b> or <b>F1-F10</b>. New skills are learned automatically as you level up.</p>
    <p><b>Shift</b> rolls toward the cursor and makes you invulnerable for an instant (every 5 s). Bosses and some elites telegraph heavy hits with a <b style="color:#ff5a3a">red circle</b> on the ground: get out before it fills. Some skills and monsters apply statuses: <i data-gi="status/stun"></i> stunned, <i data-gi="status/slow"></i> slowed, <i data-gi="status/bleed"></i> bleeding and <i data-gi="status/poison"></i> poisoned. Stunning a boss interrupts its special attack.</p>
    <h4>Loot</h4>
    <p>Click items on the ground or press <b>Z</b> to pick up the nearest one. Materials can be sold to any merchant.</p>
    <h4>Dawn Village</h4>
    <p>Talk to <b>Lia</b> (potions), <b>Gerald</b> (weapons), <b>Hilda</b> (armor) and <b>Roxxy</b>, the Gatekeeper, who takes you to the hunting grounds. Villagers with quests pay you for a hand. And old <b>Luigi</b>, by the fountain, will tell you everything about the chat. Everything.</p>
    <h4>Hostile camps</h4>
    <p>Every zone has a camp marked with <i data-gi="ui/pvp"></i> on the map, guarded by an <i data-gi="ui/crown"></i> <b>elite</b> leader. Clear the whole camp and a <b>chest</b> appears by the campfire for everyone who fought. The camp refills a few minutes later.</p>
    <h4>Hunting grounds</h4>
    <p>Windy Meadows (1-5) · Goblin Hills (5-10) · Orc Barracks (10-15) · Cursed Wastes (15-20, boss Kaim Vanul) · Forsaken Coast (20-25) · Sunken Ruins (25-30) · Burning Steppes (30-35) · Orc Citadel (35-40) · Dragon Valley (40-45) · Dragon's Nest (45-50).</p>
    <p>At level 20 you pick a <b>specialization</b> in Character Status. With an <b>enchant scroll</b> in your bag, right-click a weapon or armor piece to raise it by +1: safe up to +3, after that it can fail and destroy the piece.</p>
    <p>The <b>Dusk Bastion</b>, down the north-east road or through the Gatekeeper, sells B grade gear, and its masters <b>craft</b> A and S grade from the materials dropped in the level 30 to 50 zones.</p>
    <h4>Party and PvP</h4>
    <p>Select a player → <b>Invite to party</b>. Party members share XP with a bonus.
    PvP starts <b>off</b>: toggle it with the <b>PvP</b> button or <code>/pvp</code>; both players need it on. Hold <b>Ctrl</b> and use auto-attack (or Ctrl+Space) to force an attack on a PvP player (outside the village). Attacking flags you <span style="color:#d080ff">purple</span>;
    killing an unflagged player gives karma and turns you <span style="color:#ff4040">red</span>, and red players can drop items on death.</p>
    <h4>Windows</h4>
    <p><b>I</b> inventory · <b>C</b> character · <b>M</b> map · <b>H</b> help · <b>O</b> options · <b>Enter</b> chat · <b>Esc</b> close / clear target</p>
  </div>`;
