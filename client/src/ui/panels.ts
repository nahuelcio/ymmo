import { CLASSES, RACES } from '../../../shared/src/data/classes';
import { GRADE_COLOR, ITEMS, SLOTS, type Slot } from '../../../shared/src/data/items';
import { QUESTS } from '../../../shared/src/data/quests';
import { className, itemName, questField, questLineL, questSummaryL, raceName, skillDesc, skillName } from '../../../shared/src/i18n';
import { lang, t as tx } from '../lang';

const fmtLoc = lang === 'en' ? 'en-US' : 'es-AR';
import { allSkillsFor } from '../../../shared/src/data/skills';
import type { InvItem, PartyMember, S2C } from '../../../shared/src/protocol';
import type { Game } from '../game';
import { bar, glyph, hydrate, itemIcon, itemTip, skillIcon, skillTip, SLOT_NAME } from './common';
import { isTouchDevice } from './touch';
import { el, esc, hideTip, setTip, Win } from './dom';

const SLOT_LABEL: Record<Slot, string> = SLOT_NAME;
/** the item whose icon outlines each empty equipment slot */
const GHOST: Record<Slot, string> = { head: 'full_plate_helmet', weapon: 'broadsword', chest: 'full_plate_armor', gloves: 'reinforced_gloves', legs: 'karmian_stockings', feet: 'reinforced_boots' };

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
    this.stats.innerHTML = `<div class="ds-name">${esc(m.name)}</div><div class="tt-dim">${tx('Nv', 'Lv')} ${m.lvl} ${className(m.cls, lang)}</div>
      <div class="ds-grid">${row(tx('Atq.F', 'P.Atk'), m.pAtk)}${row(tx('Def.F', 'P.Def'), m.pDef)}${row(tx('Atq.M', 'M.Atk'), m.mAtk)}${row(tx('Def.M', 'M.Def'), m.mDef)}</div>`;
  }

  /** The stat a character cares about for this piece, to tell upgrades apart. */
  private score(id: string) {
    const d = ITEMS[id];
    return d.type === 'weapon' ? (this.g.me.cls === 'mystic' ? d.mAtk ?? 0 : d.pAtk ?? 0) : (d.pDef ?? 0) + (d.mDef ?? 0);
  }

  /** Tooltip block: this item's stats against what is worn in the same slot. */
  private compare(id: string): string {
    const d = ITEMS[id];
    if (!d.slot) return '';
    const worn = this.g.inv.find((i) => i.s === d.slot);
    const c = worn ? ITEMS[worn.i] : undefined;
    const STATS = [['pAtk', tx('Atq.F', 'P.Atk')], ['mAtk', tx('Atq.M', 'M.Atk')], ['pDef', tx('Def.F', 'P.Def')], ['mDef', tx('Def.M', 'M.Def')], ['mp', 'MP']] as const;
    const rows = STATS.map(([k, label]) => {
      const dv = (d[k] ?? 0) - (c?.[k] ?? 0);
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
      cell.style.gridColumn = k % 2 ? '3' : '1';
      cell.style.gridRow = String((k >> 1) + 1);
      const it = g.inv.find((i) => i.s === s);
      if (it) {
        itemIcon(it.i, cell);
        cell.draggable = true;
        cell.ondragstart = () => (hideTip(), (this.drag = { slot: s }));
        cell.ondragend = () => (this.drag = null);
        cell.ondblclick = () => g.net.send({ t: 'unequip', slot: s });
        setTip(cell, () => itemTip(it.i) + '<br><span class="tt-dim">Doble click para sacártelo</span>');
      } else {
        // empty: a faint outline of what goes there
        glyph('item', GHOST[s], SLOT_LABEL[s], cell).classList.add('doll-ghost');
        cell.title = SLOT_LABEL[s];
      }
    });
    this.grid.innerHTML = '';
    for (const b of this.tabs.children) b.classList.toggle('active', (b as HTMLElement).dataset.f === this.filter);
    const kind = (id: string) => (ITEMS[id].slot ? 'gear' : ITEMS[id].use ? 'use' : 'mat');
    const bag = g.inv.filter((i) => !i.s && (this.filter === 'all' || kind(i.i) === this.filter));
    for (const it of bag) {
      const cell = el('div', 'inv-cell', this.grid);
      itemIcon(it.i, cell, it.c);
      if (ITEMS[it.i].use) {
        // potions and scrolls can be dragged onto the skill bar
        cell.draggable = true;
        cell.ondragstart = () => (hideTip(), (g.ui.hud.drag = { slot: { type: 'item', id: it.i } }));
        cell.ondragend = () => (g.ui.hud.drag = null);
      }
      const slot = ITEMS[it.i].slot;
      if (slot) {
        const worn = g.inv.find((i) => i.s === slot);
        if (this.score(it.i) > (worn ? this.score(worn.i) : 0)) el('span', 'inv-up', cell, '▲');
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
        const d = el('button', 'danger', m, tx('Destruir', 'Destroy'));
        d.onclick = () => {
          this.closeMenu();
          g.ui.dialogs.confirm(tx(`¿Destruir ${itemName(it.i, lang)}${it.c > 1 ? ` (${it.c})` : ''}?`, `Destroy ${itemName(it.i, lang)}${it.c > 1 ? ` (${it.c})` : ''}?`), () => g.net.send({ t: 'destroy', u: it.u }));
        };
        this.menu = m;
      };
      setTip(cell, () => itemTip(it.i, it.c) + this.compare(it.i));
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
    el('div', 'char-head', b).innerHTML = `<b>${esc(m.name)}</b><br><span class="tt-dim">${tx('Nv', 'Lv')} ${m.lvl} ${raceName(m.race, lang)} ${className(m.cls, lang)}</span>`;
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
    el('div', 'section', b, tx('Habilidades', 'Skills'));
    const list = el('div', 'skill-list', b);
    for (const s of allSkillsFor(m.cls, m.race, m.look.g)) {
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
  private tab: 'buy' | 'sell' = 'buy';

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
    for (const t of ['buy', 'sell'] as const) {
      const tb = el('button', `tab${this.tab === t ? ' active' : ''}`, tabs, t === 'buy' ? tx('Comprar', 'Buy') : tx('Vender', 'Sell'));
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
      nm.innerHTML = `${m.leader ? '<i data-gi="ui/crown"></i> ' : ''}${esc(m.name)} <span class="tt-dim">${tx('Nv', 'Lv')} ${m.lvl} ${className(m.cls, lang)}</span>`;
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
    <p>Praderas Ventosas (1-5) · Colinas Goblin (5-10) · Cuartel Orco (10-15) · Páramos Malditos (15-20, jefe Kaim Vanul).</p>
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
    <p>Windy Meadows (1-5) · Goblin Hills (5-10) · Orc Barracks (10-15) · Cursed Wastes (15-20, boss Kaim Vanul).</p>
    <h4>Party and PvP</h4>
    <p>Select a player → <b>Invite to party</b>. Party members share XP with a bonus.
    PvP starts <b>off</b>: toggle it with the <b>PvP</b> button or <code>/pvp</code>; both players need it on. Hold <b>Ctrl</b> and use auto-attack (or Ctrl+Space) to force an attack on a PvP player (outside the village). Attacking flags you <span style="color:#d080ff">purple</span>;
    killing an unflagged player gives karma and turns you <span style="color:#ff4040">red</span>, and red players can drop items on death.</p>
    <h4>Windows</h4>
    <p><b>I</b> inventory · <b>C</b> character · <b>M</b> map · <b>H</b> help · <b>O</b> options · <b>Enter</b> chat · <b>Esc</b> close / clear target</p>
  </div>`;
