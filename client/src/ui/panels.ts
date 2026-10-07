import { CLASSES, RACES } from '../../../shared/src/data/classes';
import { GRADE_COLOR, ITEMS, SLOTS, type Slot } from '../../../shared/src/data/items';
import { QUESTS, questLine, questSummary } from '../../../shared/src/data/quests';
import { allSkillsFor } from '../../../shared/src/data/skills';
import type { PartyMember, S2C } from '../../../shared/src/protocol';
import type { Game } from '../game';
import { bar, itemIcon, itemTip, skillIcon, skillTip } from './common';
import { el, esc, hideTip, setTip, Win } from './dom';

const SLOT_LABEL: Record<Slot, string> = { head: 'Head', weapon: 'Weapon', chest: 'Chest', gloves: 'Gloves', legs: 'Legs', feet: 'Feet' };

export class InventoryPanel {
  win: Win;
  private doll: HTMLDivElement;
  private grid: HTMLDivElement;
  private footer: HTMLDivElement;
  private menu: HTMLDivElement | null = null;

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('inventory', 'Inventory', -370, 90, 344, root);
    this.doll = el('div', 'doll', this.win.body);
    this.grid = el('div', 'inv-grid', this.win.body);
    this.footer = el('div', 'inv-footer', this.win.body);
    el('div', 'hint', this.win.body, 'Double-click to use/equip · Right-click for options');
    addEventListener('pointerdown', (e) => {
      if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
    });
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  refresh() {
    const g = this.g;
    this.doll.innerHTML = '';
    for (const s of SLOTS) {
      const cell = el('div', 'doll-slot', this.doll);
      const it = g.inv.find((i) => i.s === s);
      if (it) {
        itemIcon(it.i, cell);
        cell.ondblclick = () => g.net.send({ t: 'unequip', slot: s });
        setTip(cell, () => itemTip(it.i) + '<br><span class="tt-dim">Double-click to unequip</span>');
      } else el('span', 'doll-label', cell, SLOT_LABEL[s]);
    }
    this.grid.innerHTML = '';
    const bag = g.inv.filter((i) => !i.s);
    for (const it of bag) {
      const cell = el('div', 'inv-cell', this.grid);
      itemIcon(it.i, cell, it.c);
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
          const b = el('button', '', m, def.slot ? 'Equip' : 'Use');
          b.onclick = () => {
            g.net.send({ t: 'use', u: it.u });
            this.closeMenu();
          };
        }
        const d = el('button', 'danger', m, 'Destroy');
        d.onclick = () => {
          this.closeMenu();
          g.ui.dialogs.confirm(`Destroy ${def.name}${it.c > 1 ? ` (${it.c})` : ''}?`, () => g.net.send({ t: 'destroy', u: it.u }));
        };
        this.menu = m;
      };
      setTip(cell, () => itemTip(it.i, it.c));
    }
    for (let i = bag.length; i < 40; i++) el('div', 'inv-cell empty', this.grid);
    this.footer.innerHTML = `<span class="adena">🪙 ${g.adena.toLocaleString()} Adena</span><span class="tt-dim">${g.inv.length}/80</span>`;
  }
}

export class CharacterPanel {
  win: Win;
  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('character', 'Character Status', 16, 210, 300, root);
    this.win.onShow = () => this.refresh();
  }

  refresh() {
    if (!this.win.visible) return;
    const m = this.g.me;
    const b = this.win.body;
    b.innerHTML = '';
    el('div', 'char-head', b).innerHTML = `<b>${esc(m.name)}</b><br><span class="tt-dim">Lv ${m.lvl} ${RACES[m.race].name} ${CLASSES[m.cls].name}</span>`;
    const grid = el('div', 'stat-grid', b);
    const rows: [string, string | number][] = [
      ['HP', `${m.hp}/${m.maxHp}`], ['MP', `${m.mp}/${m.maxMp}`], ['CP', `${m.cp}/${m.maxCp}`],
      ['XP', m.xpNeed ? `${m.xp}/${m.xpNeed}` : 'MAX'],
      ['P.Atk', m.pAtk], ['M.Atk', m.mAtk], ['P.Def', m.pDef], ['M.Def', m.mDef],
      ['Accuracy', m.acc], ['Evasion', m.eva], ['Critical', `${m.crit}%`], ['Atk.Spd', m.atkSpd], ['Speed', m.speed],
      ['Karma', m.karma], ['PvP', m.pvp], ['PK', m.pk],
    ];
    for (const [k, v] of rows) {
      el('span', 'stat-k', grid, k);
      el('span', 'stat-v', grid, String(v));
    }
    el('div', 'section', b, 'Skills');
    const list = el('div', 'skill-list', b);
    for (const s of allSkillsFor(m.cls, m.race, m.look.g)) {
      const row = el('div', `skill-row${s.level > m.lvl ? ' locked' : ''}`, list);
      skillIcon(s.id, row);
      el('div', '', row).innerHTML = `<b>${esc(s.name)}</b> <span class="tt-dim">${s.level > m.lvl ? `learn at Lv ${s.level}` : `MP ${s.mp}`}</span><br><span class="tt-dim">${esc(s.desc)}</span>`;
      setTip(row, () => skillTip(s.id));
    }
  }
}

export class NpcPanel {
  win: Win;
  private msg: Extract<S2C, { t: 'npc' }> | null = null;
  private tab: 'buy' | 'sell' = 'buy';

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('npc', 'Merchant', 380, 110, 380, root);
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
      const more = el('button', 'btn', row, 'Keep listening...');
      more.onclick = () => g.net.send({ t: 'talk', id: m.npc });
      const bye = el('button', 'btn', row, 'Slowly back away');
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
        el('div', 'grow', row).innerHTML = `<b>${esc(d.name)}</b><br><span class="tt-dim">${d.cost ? `${d.cost} adena` : 'Free'}</span>`;
        const btn = el('button', 'btn', row, 'Teleport');
        btn.disabled = g.adena < d.cost;
        btn.onclick = () => g.net.send({ t: 'teleport', npc: m.npc, dest: d.id });
      }
      return;
    }
    const tabs = el('div', 'tabs', b);
    for (const t of ['buy', 'sell'] as const) {
      const tb = el('button', `tab${this.tab === t ? ' active' : ''}`, tabs, t === 'buy' ? 'Buy' : 'Sell');
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
        info.innerHTML = `<span style="color:${def.grade ? GRADE_COLOR[def.grade] : '#ddd'}">${esc(def.name)}</span><br><span class="tt-dim">${def.price} adena</span>`;
        setTip(row, () => itemTip(id));
        const qty = el('input', 'qty', row);
        qty.type = 'number';
        qty.min = '1';
        qty.value = '1';
        qty.addEventListener('keydown', (e) => e.stopPropagation());
        const btn = el('button', 'btn', row, 'Buy');
        btn.onclick = () => g.net.send({ t: 'buy', npc: m.npc, item: id, qty: Math.max(1, Math.floor(+qty.value || 1)) });
      }
    } else {
      const sellable = g.inv.filter((i) => !i.s);
      if (!sellable.length) el('div', 'tt-dim', list, 'You have nothing to sell.');
      for (const it of sellable) {
        const def = ITEMS[it.i];
        const row = el('div', 'shop-row', list);
        itemIcon(it.i, row, it.c);
        el('div', 'grow', row).innerHTML = `${esc(def.name)}${it.c > 1 ? ` ×${it.c}` : ''}<br><span class="tt-dim">${Math.floor(def.price / 2)} adena each</span>`;
        setTip(row, () => itemTip(it.i, it.c));
        const qty = el('input', 'qty', row);
        qty.type = 'number';
        qty.min = '1';
        qty.max = String(it.c);
        qty.value = String(it.c);
        qty.addEventListener('keydown', (e) => e.stopPropagation());
        const btn = el('button', 'btn', row, 'Sell');
        btn.onclick = () => g.net.send({ t: 'sell', npc: m.npc, u: it.u, qty: Math.min(it.c, Math.max(1, Math.floor(+qty.value || 1))) });
      }
    }
    el('div', 'inv-footer', b).innerHTML = `<span class="adena">🪙 ${g.adena.toLocaleString()} Adena</span>`;
  }

  private renderQuest(m: Extract<S2C, { t: 'npc' }>, b: HTMLElement) {
    const q = m.quest;
    const def = q ? QUESTS[q.id] : undefined;
    if (!q || !def) return;
    el('div', 'section', b, def.name);
    el('div', '', b, questSummary(def));
    el('div', 'npc-greet', b, `"${questLine(def, q.status)}"`);
    if (q.status === 'active' || q.status === 'ready') {
      const row = el('div', '', b);
      row.innerHTML = `Progress: <b class="${q.progress >= def.objective.count ? 'qt-ready' : ''}">${q.progress}/${def.objective.count}</b>`;
    }
    if (q.status !== 'done') {
      el('div', 'tt-dim', b, `Reward: ${def.xp.toLocaleString()} XP, ${def.adena.toLocaleString()} adena`);
    }
    if (q.status === 'available') {
      const btn = el('button', 'btn primary', b, 'Accept');
      btn.style.marginTop = '8px';
      btn.onclick = () => this.g.net.send({ t: 'questAccept', npc: m.npc });
    } else if (q.status === 'ready') {
      const btn = el('button', 'btn primary', b, 'Complete');
      btn.style.marginTop = '8px';
      btn.onclick = () => this.g.net.send({ t: 'questTurnIn', npc: m.npc });
    }
  }
}

export class PartyPanel {
  private root: HTMLDivElement;
  private list: HTMLDivElement;
  members: PartyMember[] | null = null;

  constructor(private g: Game, parent: HTMLElement) {
    this.root = el('div', 'panel party', parent);
    const head = el('div', 'party-head', this.root, 'Party');
    const leave = el('button', 'btn small', head, 'Leave');
    leave.onclick = () => g.net.send({ t: 'partyLeave' });
    this.list = el('div', '', this.root);
    this.root.style.display = 'none';
  }

  toggle() {
    if (!this.members) this.g.sys('You are not in a party. Target a player and click "Invite to party", or type /invite name.');
  }

  set(members: PartyMember[] | null) {
    this.members = members;
    this.root.style.display = members ? '' : 'none';
    this.list.innerHTML = '';
    for (const m of members ?? []) {
      if (m.id === this.g.me.id) continue;
      const row = el('div', 'party-member', this.list);
      el('div', 'pm-name', row).innerHTML = `${m.leader ? '👑 ' : ''}${esc(m.name)} <span class="tt-dim">Lv ${m.lvl} ${CLASSES[m.cls].name}</span>`;
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
    this.show('<b>You have died.</b><br><span class="tt-dim">Return to the Village of Dawn?</span>', [['To Village', () => this.g.net.send({ t: 'respawn' }), 'primary']]);
  }

  invite(from: string) {
    this.show(`<b>${esc(from)}</b> has invited you to join a party.`, [
      ['Accept', () => this.g.net.send({ t: 'partyRespond', accept: true }), 'primary'],
      ['Decline', () => this.g.net.send({ t: 'partyRespond', accept: false })],
    ]);
  }

  confirm(text: string, ok: () => void) {
    this.show(esc(text), [['OK', ok, 'primary'], ['Cancel', () => {}]]);
  }
}

export function createHelp(root: HTMLElement): Win {
  const w = new Win('help', 'How to play', 380, 80, 420, root);
  w.body.innerHTML = `
  <div class="help">
    <h4>Movement & camera</h4>
    <p><b>Left click</b> the ground to move (hold it to keep walking toward the cursor). <b>Right-drag</b> rotates the camera, <b>wheel</b> zooms. Q/E or arrows also rotate.</p>
    <h4>Combat</h4>
    <p>Click a monster to <b>attack</b> it right away (<b>Space</b> or an attack skill with no target picks the nearest one). <b>Tab</b> cycles nearby monsters.
    Skills and potions are on the shortcut bar: keys <b>1-0</b> or <b>F1-F10</b>. New skills are learned automatically as you level up.</p>
    <h4>Loot</h4>
    <p>Click items on the ground or press <b>Z</b> to pick up the nearest one. Sell materials to any merchant.</p>
    <h4>Village of Dawn</h4>
    <p>Talk to <b>Lia</b> (potions), <b>Gerald</b> (weapons), <b>Hilda</b> (armor) and <b>Roxxy</b> the Gatekeeper, who teleports you to the hunting grounds. Old <b>Luigi</b> by the fountain will happily tell you about the chat. At length.
    Quest givers in gold hats stand around the square (one every few levels) and one waits at each hunting ground.</p>
    <h4>Hunting grounds</h4>
    <p>Windy Meadows (1-5) · Goblin Hills (5-10) · Orc Barracks (10-15) · Cursed Wastes (15-20, raid boss Kaim Vanul).</p>
    <h4>Party & PvP</h4>
    <p>Target a player → <b>Invite to party</b>. Party members share XP with a bonus.
    PvP is <b>off</b> by default: toggle it with the <b>PvP</b> button or <code>/pvp</code>; both players need it on. <b>Ctrl+click</b> a PvP player to force attack (outside the village). Attacking flags you <span style="color:#d080ff">purple</span>;
    killing an unflagged player gives you karma and turns you <span style="color:#ff4040">red</span> — red players may drop items on death.</p>
    <h4>Windows</h4>
    <p><b>I</b> inventory · <b>C</b> character · <b>M</b> map · <b>H</b> help · <b>O</b> settings · <b>Enter</b> chat · <b>Esc</b> close/clear target</p>
  </div>`;
  return w;
}
