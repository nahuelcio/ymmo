// The GM's character editor (the admin window's "Personajes" page; server-rs gm.rs). It finds any character by name,
// online or not, and changes its progress: level, XP, specialization, Legend, adena, karma, PK and PvP, inventory,
// quests. It also covers its week and day (jewel rolls, the Rift's paid run, today's contracts), its Olympiad month and
// its clan. Every change goes to the server and comes back as the character's fresh sheet; nothing is redrawn between
// sheets, so a half-typed value survives the panel's polling.
import { SPECS, type Spec } from '../../../shared/src/data/classes';
import { CLAN_LEVELS } from '../../../shared/src/data/clans';
import { ITEMS } from '../../../shared/src/data/items';
import { LEGEND } from '../../../shared/src/data/legend';
import { QUEST_LIST, QUESTS } from '../../../shared/src/data/quests';
import { className, itemName, mobName, questField, raceName, specName } from '../../../shared/src/i18n';
import type { C2S, CharEdit, CharSheet, S2C } from '../../../shared/src/protocol';
import { lang, t as tx } from '../lang';
import { itemIcon, itemTip } from './common';
import { el, esc, setTip } from './dom';

type AdminExtra = Omit<Extract<C2S, { t: 'admin' }>, 't' | 'since'>;
const fmt = (n: number) => n.toLocaleString(lang === 'en' ? 'en-US' : 'es-AR');

export class GmCharEditor {
  private sheet: CharSheet | null = null;
  private status: HTMLElement;
  private body: HTMLElement;
  private search: HTMLInputElement;

  constructor(root: HTMLElement, private send: (extra: AdminExtra) => void) {
    const f = el('form', 'adm-row', root);
    this.search = el('input', 'chat-input', f);
    this.search.placeholder = this.search.ariaLabel = tx('Nombre del personaje', 'Character name');
    el('button', 'btn', f, tx('Buscar', 'Search'));
    f.onsubmit = (e) => {
      e.preventDefault();
      if (this.search.value.trim()) this.open(this.search.value);
    };
    this.status = el('div', 'gm-status', root);
    this.status.setAttribute('role', 'status');
    this.body = el('div', 'gm-sheet', root);
  }

  /** A character's sheet, by name (the search, or the Status page's "Edit"). */
  open(name: string) {
    this.search.value = name.trim();
    this.send({ charGet: { name: name.trim() } });
  }

  /** The server's answer: what the change did (or why not), and the character as it is now. */
  set(m: Extract<S2C, { t: 'adminChar' }>) {
    this.status.textContent = m.err ?? m.msg ?? '';
    this.status.className = `gm-status${m.err ? ' adm-bad' : m.msg ? ' gm-ok' : ''}`;
    if (m.sheet) {
      this.sheet = m.sheet;
      this.render();
    } else if (m.err && !this.sheet) this.body.innerHTML = '';
  }

  private edit(edit: CharEdit) {
    if (this.sheet) this.send({ charEdit: { id: this.sheet.id, edit } });
  }

  /** A labelled number field with its ✓ (Enter does the same). */
  private num(parent: HTMLElement, label: string, value: number, apply: (v: number) => void, hint = '') {
    const row = el('div', 'gm-field', parent);
    el('span', 'gm-k', row, label);
    const inp = el('input', 'chat-input gm-in', row);
    inp.type = 'number';
    inp.value = String(value);
    inp.ariaLabel = label;
    const go = () => {
      const v = Number(inp.value);
      if (inp.value.trim() !== '' && Number.isFinite(v)) apply(Math.round(v));
    };
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    el('button', 'btn small', row, '✓').onclick = go;
    if (hint) el('span', 'tt-dim gm-hint', row, hint);
    return inp;
  }

  /** A button that asks once more before it acts (a second click within 3 s). */
  private sure(btn: HTMLButtonElement, act: () => void) {
    const label = btn.textContent;
    btn.onclick = () => {
      if (btn.dataset.sure) {
        delete btn.dataset.sure;
        btn.textContent = label;
        return act();
      }
      btn.dataset.sure = '1';
      btn.textContent = tx('¿Seguro?', 'Sure?');
      setTimeout(() => { delete btn.dataset.sure; btn.textContent = label; }, 3000);
    };
  }

  private render() {
    const c = this.sheet!;
    const b = this.body;
    b.innerHTML = '';
    const where = c.online ? (c.world === 0 ? tx('conectado, en el mundo', 'online, in the world') : tx(`conectado, en una instancia (#${c.world})`, `online, in an instance (#${c.world})`)) : tx('desconectado', 'offline');
    el('div', 'char-head', b).innerHTML = `<b>${esc(c.name)}</b>${c.hero ? ` <span class="np-hero">${tx('Héroe', 'Hero')}</span>` : ''}<br>`
      + `<span class="tt-dim">${tx('Nv', 'Lv')} ${c.level} ${raceName(c.race, lang)} ${className(c.cls, lang, c.spec as Spec | null)} · ${where}</span>`;

    // ---- progress
    el('div', 'section', b, tx('Progreso', 'Progress'));
    const grid = el('div', 'gm-grid', b);
    this.num(grid, tx('Nivel', 'Level'), c.level, (v) => this.edit({ k: 'level', v }));
    this.num(grid, 'XP', c.xp, (v) => this.edit({ k: 'xp', v }), c.xpNeed ? `/ ${fmt(c.xpNeed)}` : 'MAX');
    this.num(grid, 'Adena', c.adena, (v) => this.edit({ k: 'adena', v }));
    this.num(grid, 'Karma', c.karma, (v) => this.edit({ k: 'karma', v }));
    this.num(grid, 'PK', c.pk, (v) => this.edit({ k: 'pk', v }));
    this.num(grid, 'PvP', c.pvp, (v) => this.edit({ k: 'pvp', v }));
    const specRow = el('div', 'gm-field', b);
    el('span', 'gm-k', specRow, tx('Especialización', 'Specialization'));
    const spec = el('select', 'chat-input gm-in gm-wide', specRow);
    spec.ariaLabel = tx('Especialización', 'Specialization');
    el('option', '', spec, tx('— ninguna —', '— none —')).value = '';
    for (const sp of (Object.keys(SPECS) as Spec[]).filter((s) => SPECS[s].base === c.cls)) {
      const o = el('option', '', spec, `${specName(sp, lang)}${SPECS[sp].parent ? ` (${tx('despertar', 'awakened')})` : ''}`);
      o.value = sp;
    }
    spec.value = c.spec ?? '';
    spec.onchange = () => this.edit({ k: 'spec', v: spec.value || null });

    // ---- Legend
    el('div', 'section', b, tx('Leyenda', 'Legend'));
    const lg = el('div', 'gm-grid', b);
    this.num(lg, tx('Nivel', 'Level'), c.legendLvl, (v) => this.edit({ k: 'legendLvl', v }), `/ ${LEGEND.max}`);
    this.num(lg, 'XP', c.legendXp, (v) => this.edit({ k: 'legendXp', v }), c.legendNeed ? `/ ${fmt(c.legendNeed)}` : tx('completa', 'full'));
    const spent = Object.values(c.legend).reduce((a, n) => a + n, 0);
    el('div', 'tt-dim', b, tx(`Rangos repartidos: ${spent} de ${c.legendLvl}.`, `Ranks spent: ${spent} of ${c.legendLvl}.`));
    const ranks = el('div', 'gm-grid', b);
    for (const p of LEGEND.passives) this.num(ranks, lang === 'en' ? p.nameEn : p.name, c.legend[p.id] ?? 0, (v) => this.edit({ k: 'legendRank', id: p.id, v }), `/ ${p.max}`);

    // ---- inventory
    el('div', 'section', b, tx(`Inventario (${c.inv.length})`, `Inventory (${c.inv.length})`));
    const inv = el('table', 'adm-table gm-inv', b);
    inv.innerHTML = `<tr><th></th><th>${tx('Ítem', 'Item')}</th><th>${tx('Cant.', 'Qty')}</th><th>${tx('Enc.', 'Ench.')}</th><th>${tx('O. maestra', 'Masterwork')}</th><th></th></tr>`;
    for (const it of c.inv) {
      const def = ITEMS[it.i];
      const gear = !!def?.slot, stack = !!def?.stack;
      const tr = el('tr', '', inv);
      const ic = el('td', '', tr);
      itemIcon(it.i, ic, it.c, it.e ?? 0);
      setTip(ic, () => itemTip(it.i, it.c, it.e ?? 0, it.l, it.m));
      el('td', 'gm-name', tr, `${itemName(it.i, lang)}${it.s ? ` · ${tx('puesto', 'worn')}` : ''}`);
      const qty = el('input', 'chat-input gm-small', el('td', '', tr));
      qty.type = 'number';
      qty.value = String(it.c);
      qty.disabled = !stack;
      const ench = el('input', 'chat-input gm-small', el('td', '', tr));
      ench.type = 'number';
      ench.value = String(it.e ?? 0);
      ench.disabled = !gear;
      const mw = el('input', '', el('td', '', tr));
      mw.type = 'checkbox';
      mw.checked = !!it.m;
      mw.disabled = !gear;
      mw.onchange = () => this.edit({ k: 'itemSet', u: it.u, mw: mw.checked });
      const acts = el('td', 'gm-acts', tr);
      const save = () => {
        const edit: CharEdit = { k: 'itemSet', u: it.u };
        if (stack && Number(qty.value) !== it.c) edit.count = Math.round(Number(qty.value));
        if (gear && Number(ench.value) !== (it.e ?? 0)) edit.enchant = Math.round(Number(ench.value));
        if (edit.count !== undefined || edit.enchant !== undefined) this.edit(edit);
      };
      for (const inp of [qty, ench]) inp.addEventListener('keydown', (e) => e.key === 'Enter' && save());
      el('button', 'btn small', acts, '✓').onclick = save;
      this.sure(el('button', 'btn small danger', acts, tx('Quitar', 'Remove')), () => this.edit({ k: 'itemRemove', u: it.u }));
    }
    // give: any item of the game, by name
    const add = el('div', 'adm-row', b);
    const pick = el('input', 'chat-input', add);
    pick.placeholder = pick.ariaLabel = tx('Ítem para dar (nombre o id)', 'Item to give (name or id)');
    const list = el('datalist', '', add);
    list.id = 'gm-items';
    pick.setAttribute('list', list.id);
    for (const def of Object.values(ITEMS)) {
      if (def.id === 'adena') continue;
      const o = el('option', '', list, itemName(def.id, lang));
      o.value = def.id;
    }
    const cnt = el('input', 'chat-input gm-small', add);
    cnt.type = 'number';
    cnt.value = '1';
    cnt.ariaLabel = tx('Cantidad', 'Quantity');
    const enc = el('input', 'chat-input gm-small', add);
    enc.type = 'number';
    enc.value = '0';
    enc.ariaLabel = tx('Encantamiento', 'Enchantment');
    const mwl = el('label', 'gm-check', add);
    const mwAdd = el('input', '', mwl);
    mwAdd.type = 'checkbox';
    mwl.append(tx(' O. maestra', ' Masterwork'));
    el('button', 'btn small', add, tx('Dar', 'Give')).onclick = () => {
      const q = pick.value.trim().toLowerCase();
      const id = ITEMS[q] ? q : Object.values(ITEMS).find((d) => itemName(d.id, lang).toLowerCase() === q)?.id;
      if (!id) return this.set({ t: 'adminChar', sheet: null, err: tx('No encontré ese ítem.', 'No such item.') });
      this.edit({ k: 'itemAdd', item: id, count: Math.max(1, Math.round(+cnt.value || 1)), enchant: Math.round(+enc.value || 0), mw: mwAdd.checked });
    };

    // ---- quests
    el('div', 'section', b, tx('Misiones', 'Quests'));
    const qt = el('table', 'adm-table', b);
    if (!c.quests.length) el('div', 'tt-dim', b, tx('Sin misiones.', 'No quests.'));
    for (const q of c.quests) {
      const def = QUESTS[q.id];
      const tr = el('tr', '', qt);
      el('td', 'gm-name', tr, def ? questField(def, 'name', lang) : q.id);
      const prog = el('input', 'chat-input gm-small', el('td', '', tr));
      prog.type = 'number';
      prog.value = String(q.progress);
      prog.ariaLabel = tx('Progreso', 'Progress');
      // a "bring me" quest counts what is in the bag: give the items instead
      if (def?.objective.type === 'collect') {
        prog.disabled = true;
        prog.title = tx(`Cuenta los ${itemName(def.objective.item, lang)} de la bolsa`, `Counts the ${itemName(def.objective.item, lang)} in the bag`);
      }
      const dl = el('label', 'gm-check', el('td', '', tr));
      const done = el('input', '', dl);
      done.type = 'checkbox';
      done.checked = q.done;
      dl.append(tx(' hecha', ' done'));
      const acts = el('td', 'gm-acts', tr);
      el('button', 'btn small', acts, '✓').onclick = () => this.edit({ k: 'quest', id: q.id, progress: Math.max(0, Math.round(+prog.value || 0)), done: done.checked });
      this.sure(el('button', 'btn small danger', acts, tx('Quitar', 'Remove')), () => this.edit({ k: 'questRemove', id: q.id }));
    }
    const qa = el('div', 'adm-row', b);
    const qsel = el('select', 'chat-input', qa);
    qsel.ariaLabel = tx('Misión para dar', 'Quest to give');
    for (const q of QUEST_LIST) el('option', '', qsel, `${questField(q, 'name', lang)} (${tx('Nv', 'Lv')} ${q.minLevel})`).value = q.id;
    el('button', 'btn small', qa, tx('Dar', 'Give')).onclick = () => this.edit({ k: 'quest', id: qsel.value, progress: 0, done: false });
    el('button', 'btn small', qa, tx('Marcar hecha', 'Mark done')).onclick = () => this.edit({ k: 'quest', id: qsel.value, progress: 0, done: true });

    // ---- the week and the day
    el('div', 'section', b, tx('Semana y día', 'Week and day'));
    const wd = el('div', 'gm-list', b);
    for (const boss of c.jewels) this.sure(el('button', 'btn small', wd, tx(`Devolver tirada de joya: ${mobName(boss, lang)}`, `Give back the jewel roll: ${mobName(boss, lang)}`)), () => this.edit({ k: 'jewelRoll', boss }));
    if (c.riftPaid) this.sure(el('button', 'btn small', wd, tx('Devolver la corrida con premio de la Grieta', "Give back today's paid Rift run")), () => this.edit({ k: 'riftRun' }));
    for (const id of c.daily) this.sure(el('button', 'btn small', wd, tx(`Devolver contrato: ${QUESTS[id] ? questField(QUESTS[id], 'name', lang) : id}`, `Give back contract: ${QUESTS[id] ? questField(QUESTS[id], 'name', lang) : id}`)), () => this.edit({ k: 'daily', id }));
    if (!wd.children.length) el('div', 'tt-dim', wd, tx('No usó tiradas de joya esta semana, ni la Grieta ni contratos hoy.', 'No jewel rolls this week, nor the Rift or contracts today.'));

    // ---- the Olympiad month
    el('div', 'section', b, tx('Olimpiada (este mes)', 'Olympiad (this month)'));
    const o = c.oly ?? { points: 20, wins: 0, losses: 0, draws: 0 };
    if (!c.oly) el('div', 'tt-dim', b, tx('Sin combates este mes.', 'No fights this month.'));
    const og = el('div', 'gm-grid', b);
    const vals = { points: o.points, wins: o.wins, losses: o.losses, draws: o.draws };
    const ins = (Object.keys(vals) as (keyof typeof vals)[]).map((k) => {
      const label = { points: tx('Puntos', 'Points'), wins: tx('Victorias', 'Wins'), losses: tx('Derrotas', 'Losses'), draws: tx('Empates', 'Draws') }[k];
      const row = el('div', 'gm-field', og);
      el('span', 'gm-k', row, label);
      const inp = el('input', 'chat-input gm-in', row);
      inp.type = 'number';
      inp.value = String(vals[k]);
      inp.ariaLabel = label;
      return [k, inp] as const;
    });
    el('button', 'btn small', b, tx('Guardar Olimpiada', 'Save Olympiad')).onclick = () => {
      const v = Object.fromEntries(ins.map(([k, inp]) => [k, Math.max(0, Math.round(+inp.value || 0))])) as typeof vals;
      this.edit({ k: 'oly', ...v });
    };

    // ---- the clan
    el('div', 'section', b, tx('Clan', 'Clan'));
    if (c.clan) {
      el('div', '', b, c.clan.name);
      const cg = el('div', 'gm-grid', b);
      this.num(cg, tx('Nivel', 'Level'), c.clan.level, (v) => this.edit({ k: 'clanLevel', v }), `/ ${CLAN_LEVELS.length - 1}`);
      this.num(cg, tx('Reputación', 'Reputation'), c.clan.rep, (v) => this.edit({ k: 'clanRep', v }));
    } else el('div', 'tt-dim', b, tx('Sin clan.', 'No clan.'));

    // ---- the GM's history
    el('div', 'section', b, tx('Historial del GM', 'GM history'));
    if (!c.log.length) el('div', 'tt-dim', b, tx('Sin cambios todavía.', 'No changes yet.'));
    const lg2 = el('div', 'gm-log', b);
    for (const e of c.log) {
      const when = new Date(e.at).toLocaleString(lang === 'en' ? 'en-US' : 'es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      el('div', '', lg2).innerHTML = `<span class="tt-dim">${esc(when)} · ${esc(e.gm)}</span> ${esc(e.what)}`;
    }
  }
}
