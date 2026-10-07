import { CLASSES, RACES } from '../../../shared/src/data/classes';
import { GRADE_COLOR, ITEMS, SLOTS, type Slot } from '../../../shared/src/data/items';
import { QUESTS, questLine, questSummary } from '../../../shared/src/data/quests';
import { allSkillsFor } from '../../../shared/src/data/skills';
import type { PartyMember, S2C } from '../../../shared/src/protocol';
import type { Game } from '../game';
import { bar, itemIcon, itemTip, skillIcon, skillTip, SLOT_NAME } from './common';
import { el, esc, hideTip, setTip, Win } from './dom';

const SLOT_LABEL: Record<Slot, string> = SLOT_NAME;

export class InventoryPanel {
  win: Win;
  private doll: HTMLDivElement;
  private grid: HTMLDivElement;
  private footer: HTMLDivElement;
  private menu: HTMLDivElement | null = null;

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('inventory', 'Inventario', -370, 90, 344, root);
    this.doll = el('div', 'doll', this.win.body);
    this.grid = el('div', 'inv-grid', this.win.body);
    this.footer = el('div', 'inv-footer', this.win.body);
    el('div', 'hint', this.win.body, 'Doble click para usar o equipar · Click derecho para más opciones');
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
        setTip(cell, () => itemTip(it.i) + '<br><span class="tt-dim">Doble click para sacártelo</span>');
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
          const b = el('button', '', m, def.slot ? 'Equipar' : 'Usar');
          b.onclick = () => {
            g.net.send({ t: 'use', u: it.u });
            this.closeMenu();
          };
        }
        const d = el('button', 'danger', m, 'Destruir');
        d.onclick = () => {
          this.closeMenu();
          g.ui.dialogs.confirm(`¿Destruir ${def.name}${it.c > 1 ? ` (${it.c})` : ''}?`, () => g.net.send({ t: 'destroy', u: it.u }));
        };
        this.menu = m;
      };
      setTip(cell, () => itemTip(it.i, it.c));
    }
    for (let i = bag.length; i < 40; i++) el('div', 'inv-cell empty', this.grid);
    this.footer.innerHTML = `<span class="adena">🪙 ${g.adena.toLocaleString('es-AR')} Adena</span><span class="tt-dim">${g.inv.length}/80</span>`;
  }
}

export class CharacterPanel {
  win: Win;
  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('character', 'Estado del Personaje', 16, 210, 300, root);
    this.win.onShow = () => this.refresh();
  }

  refresh() {
    if (!this.win.visible) return;
    const m = this.g.me;
    const b = this.win.body;
    b.innerHTML = '';
    el('div', 'char-head', b).innerHTML = `<b>${esc(m.name)}</b><br><span class="tt-dim">Nv ${m.lvl} ${RACES[m.race].name} ${CLASSES[m.cls].name}</span>`;
    const grid = el('div', 'stat-grid', b);
    const rows: [string, string | number][] = [
      ['HP', `${m.hp}/${m.maxHp}`], ['MP', `${m.mp}/${m.maxMp}`], ['CP', `${m.cp}/${m.maxCp}`],
      ['XP', m.xpNeed ? `${m.xp}/${m.xpNeed}` : 'MAX'],
      ['Atq.F', m.pAtk], ['Atq.M', m.mAtk], ['Def.F', m.pDef], ['Def.M', m.mDef],
      ['Precisión', m.acc], ['Evasión', m.eva], ['Crítico', `${m.crit}%`], ['Vel.Atq', m.atkSpd], ['Velocidad', m.speed],
      ['Karma', m.karma], ['PvP', m.pvp], ['PK', m.pk],
    ];
    for (const [k, v] of rows) {
      el('span', 'stat-k', grid, k);
      el('span', 'stat-v', grid, String(v));
    }
    el('div', 'section', b, 'Habilidades');
    const list = el('div', 'skill-list', b);
    for (const s of allSkillsFor(m.cls, m.race, m.look.g)) {
      const row = el('div', `skill-row${s.level > m.lvl ? ' locked' : ''}`, list);
      skillIcon(s.id, row);
      el('div', '', row).innerHTML = `<b>${esc(s.name)}</b> <span class="tt-dim">${s.level > m.lvl ? `se aprende en Nv ${s.level}` : `MP ${s.mp}`}</span><br><span class="tt-dim">${esc(s.desc)}</span>`;
      setTip(row, () => skillTip(s.id));
    }
  }
}

export class NpcPanel {
  win: Win;
  private msg: Extract<S2C, { t: 'npc' }> | null = null;
  private tab: 'buy' | 'sell' = 'buy';

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('npc', 'Vendedor', 380, 110, 380, root);
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
      const more = el('button', 'btn', row, 'Seguir escuchando...');
      more.onclick = () => g.net.send({ t: 'talk', id: m.npc });
      const bye = el('button', 'btn', row, 'Irse despacito');
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
        el('div', 'grow', row).innerHTML = `<b>${esc(d.name)}</b><br><span class="tt-dim">${d.cost ? `${d.cost} de adena` : 'Gratis'}</span>`;
        const btn = el('button', 'btn', row, 'Viajar');
        btn.disabled = g.adena < d.cost;
        btn.onclick = () => g.net.send({ t: 'teleport', npc: m.npc, dest: d.id });
      }
      return;
    }
    const tabs = el('div', 'tabs', b);
    for (const t of ['buy', 'sell'] as const) {
      const tb = el('button', `tab${this.tab === t ? ' active' : ''}`, tabs, t === 'buy' ? 'Comprar' : 'Vender');
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
        const btn = el('button', 'btn', row, 'Comprar');
        btn.onclick = () => g.net.send({ t: 'buy', npc: m.npc, item: id, qty: Math.max(1, Math.floor(+qty.value || 1)) });
      }
    } else {
      const sellable = g.inv.filter((i) => !i.s);
      if (!sellable.length) el('div', 'tt-dim', list, 'No tenés nada para vender.');
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
        const btn = el('button', 'btn', row, 'Vender');
        btn.onclick = () => g.net.send({ t: 'sell', npc: m.npc, u: it.u, qty: Math.min(it.c, Math.max(1, Math.floor(+qty.value || 1))) });
      }
    }
    el('div', 'inv-footer', b).innerHTML = `<span class="adena">🪙 ${g.adena.toLocaleString('es-AR')} Adena</span>`;
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
      row.innerHTML = `Progreso: <b class="${q.progress >= def.objective.count ? 'qt-ready' : ''}">${q.progress}/${def.objective.count}</b>`;
    }
    if (q.status !== 'done') {
      el('div', 'tt-dim', b, `Recompensa: ${def.xp.toLocaleString('es-AR')} de XP y ${def.adena.toLocaleString('es-AR')} de adena`);
    }
    if (q.status === 'available') {
      el('div', 'npc-greet', b, def.story);
      const btn = el('button', 'btn primary', b, 'Aceptar');
      btn.style.marginTop = '8px';
      btn.onclick = () => this.g.net.send({ t: 'questAccept', npc: m.npc });
    } else if (q.status === 'ready') {
      const btn = el('button', 'btn primary', b, 'Entregar');
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
    const leave = el('button', 'btn small', head, 'Salir');
    leave.onclick = () => g.net.send({ t: 'partyLeave' });
    this.list = el('div', '', this.root);
    this.root.style.display = 'none';
  }

  toggle() {
    if (!this.members) this.g.sys('No estás en ninguna party. Seleccioná a un jugador y tocá "Invitar a la party", o escribí /invite nombre.');
  }

  set(members: PartyMember[] | null) {
    this.members = members;
    this.root.style.display = members ? '' : 'none';
    this.list.innerHTML = '';
    for (const m of members ?? []) {
      if (m.id === this.g.me.id) continue;
      const row = el('div', 'party-member', this.list);
      el('div', 'pm-name', row).innerHTML = `${m.leader ? '👑 ' : ''}${esc(m.name)} <span class="tt-dim">Nv ${m.lvl} ${CLASSES[m.cls].name}</span>`;
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
    this.show('<b>Moriste.</b><br><span class="tt-dim">¿Volver a la Aldea del Alba?</span>', [['Volver a la aldea', () => this.g.net.send({ t: 'respawn' }), 'primary']]);
  }

  invite(from: string) {
    this.show(`<b>${esc(from)}</b> te invitó a su party.`, [
      ['Aceptar', () => this.g.net.send({ t: 'partyRespond', accept: true }), 'primary'],
      ['Rechazar', () => this.g.net.send({ t: 'partyRespond', accept: false })],
    ]);
  }

  confirm(text: string, ok: () => void) {
    this.show(esc(text), [['Aceptar', ok, 'primary'], ['Cancelar', () => {}]]);
  }
}

export function createHelp(root: HTMLElement): Win {
  const w = new Win('help', 'Cómo jugar', 380, 80, 420, root);
  w.body.innerHTML = `
  <div class="help">
    <h4>Movimiento y cámara</h4>
    <p><b>Click izquierdo</b> en el piso para moverte (si lo mantenés apretado, seguís al cursor). <b>Click derecho y arrastrar</b> gira la cámara y la <b>rueda</b> hace zoom. Q/E o las flechas también giran.</p>
    <h4>Combate</h4>
    <p>Hacé click en un monstruo para <b>atacarlo</b> directamente (con <b>Espacio</b> o una habilidad de ataque sin objetivo se elige el más cercano). <b>Tab</b> va pasando por los monstruos cercanos.
    Las habilidades y pociones están en la barra de atajos: teclas <b>1-0</b> o <b>F1-F10</b>. Las habilidades nuevas se aprenden solas al subir de nivel.</p>
    <h4>Botín</h4>
    <p>Hacé click en los objetos del piso o apretá <b>Z</b> para juntar el más cercano. Los materiales se los podés vender a cualquier vendedor.</p>
    <h4>Aldea del Alba</h4>
    <p>Hablá con <b>Lia</b> (pociones), <b>Gerald</b> (armas), <b>Hilda</b> (armaduras) y <b>Roxxy</b>, la Guardiana del Portal, que te lleva a las zonas de caza. Los vecinos con misiones te pagan por darles una mano. Y el viejo <b>Luigi</b>, al lado de la fuente, te va a contar todo sobre el chat. Todo.</p>
    <h4>Zonas de caza</h4>
    <p>Praderas Ventosas (1-5) · Colinas Goblin (5-10) · Cuartel Orco (10-15) · Páramos Malditos (15-20, jefe Kaim Vanul).</p>
    <h4>Party y PvP</h4>
    <p>Seleccioná a un jugador → <b>Invitar a la party</b>. Los miembros de la party comparten la XP con un bonus.
    El PvP arranca <b>desactivado</b>: se cambia con el botón <b>PvP</b> o con <code>/pvp</code>, y los dos jugadores lo tienen que tener activado. <b>Ctrl+click</b> sobre un jugador con PvP fuerza el ataque (fuera de la aldea). Atacar te pone el flag <span style="color:#d080ff">violeta</span>;
    matar a un jugador sin flag te suma karma y te pone en <span style="color:#ff4040">rojo</span>, y a los rojos se les pueden caer objetos al morir.</p>
    <h4>Ventanas</h4>
    <p><b>I</b> inventario · <b>C</b> personaje · <b>M</b> mapa · <b>H</b> ayuda · <b>O</b> opciones · <b>Enter</b> chat · <b>Esc</b> cerrar / soltar objetivo</p>
  </div>`;
  return w;
}
