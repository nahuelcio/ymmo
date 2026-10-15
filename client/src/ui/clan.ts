// The clan window (N), after Lineage 2's: the clan's level, reputation and leader, its members, the grades'
// privileges and the crest, its wars and its alliance. What a member may do comes from the clan's privilege masks (shared/src/data/clans.ts).
import { CLAN, CLAN_GRADE_LEVEL, CLAN_GRADES, CLAN_LEVELS, CLAN_PRIV, MAX_CLAN_LEVEL, type ClanPriv } from '../../../shared/src/data/clans';
import { className, itemName } from '../../../shared/src/i18n';
import type { ClanInfo, S2C } from '../../../shared/src/protocol';
import { crestImg, type Game } from '../game';
import { lang, t as tx } from '../lang';
import { el, esc, Win } from './dom';

const PRIV_LABEL: Record<ClanPriv, string> = {
  invite: tx('Invitar', 'Invite'),
  dismiss: tx('Expulsar', 'Dismiss'),
  title: tx('Títulos', 'Titles'),
  warehouse: tx('Retirar del depósito', 'Warehouse withdrawals'),
  crest: tx('Emblema', 'Crest'),
  war: tx('Guerras', 'Wars'),
  ranks: tx('Rangos', 'Ranks'),
};
export const gradeName = (g: number) =>
  g === 1 ? tx('Líder', 'Leader') : g === 2 ? tx('Oficial', 'Officer') : g === 5 ? tx('Miembro', 'Member') : tx(`Rango ${g}`, `Grade ${g}`);

export class ClanPanel {
  win: Win;
  clan: ClanInfo | null = null;
  private tab: 'info' | 'members' | 'privs' | 'wars' | 'ally' = 'info';

  constructor(private g: Game, root: HTMLElement) {
    this.win = new Win('clan', 'Clan', 300, 90, 460, root);
    this.win.onShow = () => this.g.net.send({ t: 'clanGet' });
  }

  toggle() { this.win.toggle(); }

  set(c: ClanInfo | null) {
    this.clan = c;
    if (this.win.visible) this.render();
    this.g.ui.npc.refresh(); // the clan master's dialog depends on it
  }

  /** My entry in the clan, and whether my grade holds a privilege (the leader holds them all). */
  me() { return this.clan?.members.find((m) => m.name === this.g.me.name); }
  can(p: ClanPriv): boolean {
    const m = this.me();
    if (!m || !this.clan) return false;
    return m.grade === 1 || ((this.clan.privs[m.grade] ?? 0) & CLAN_PRIV[p]) !== 0;
  }

  private render() {
    const b = this.win.body;
    b.innerHTML = '';
    const c = this.clan;
    if (!c) {
      el('div', 'tt-dim', b, tx('No pertenecés a ningún clan. Para fundar uno, hablá con el Maestro de Clanes (en la Aldea del Alba o en el Bastión del Ocaso).',
        'You are not in a clan. To found one, talk to the Clan Master (in the Village of Dawn or in Dusk Bastion).'));
      return;
    }
    this.win.titleEl.textContent = `Clan — ${c.name}`;
    const tabs = el('div', 'tabs', b);
    const tabList = [['info', tx('Información', 'Info')], ['members', tx('Miembros', 'Members')], ['privs', tx('Privilegios', 'Privileges')],
      ['wars', tx('Guerras', 'Wars')], ['ally', tx('Alianza', 'Alliance')]] as const;
    for (const [id, label] of tabList) {
      const t = el('button', `tab${this.tab === id ? ' on' : ''}`, tabs, label);
      t.onclick = () => { this.tab = id; this.render(); };
    }
    if (this.tab === 'info') this.renderInfo(c, b);
    else if (this.tab === 'members') this.renderMembers(c, b);
    else if (this.tab === 'privs') this.renderPrivs(c, b);
    else if (this.tab === 'wars') this.renderWars(c, b);
    else this.renderAlly(c, b);
  }

  private renderInfo(c: ClanInfo, b: HTMLElement) {
    const head = el('div', 'clan-head', b);
    if (c.cv) head.appendChild(crestImg(c.id, c.cv)).classList.add('crest-big');
    el('div', 'clan-name', head, c.name);
    const online = c.members.filter((m) => m.on).length;
    const grid = el('div', 'clan-grid', b);
    const row = (k: string, v: string) => { el('span', 'tt-dim', grid, k); el('span', '', grid, v); };
    row(tx('Nivel', 'Level'), String(c.level));
    row(tx('Líder', 'Leader'), c.leader);
    row(tx('Reputación', 'Reputation'), c.rep.toLocaleString(lang === 'en' ? 'en-US' : 'es-AR'));
    row(tx('Miembros', 'Members'), `${c.members.length} / ${c.cap} (${online} ${tx('conectados', 'online')})`);
    if (c.level < MAX_CLAN_LEVEL) el('div', 'tt-dim', b, tx(`Para subir de nivel: hablá con el Maestro de Clanes (líder).`, `To level up: talk to the Clan Master (leader).`));

    // crest: L1+, with the privilege; the image is shrunk to 16×12 here and sent as a PNG
    if (this.can('crest')) {
      const r = el('div', 'row', b);
      const up = el('button', 'btn', r, c.cv ? tx('Cambiar emblema', 'Change crest') : tx('Subir emblema', 'Upload crest'));
      up.disabled = c.level < CLAN.crestLevel;
      if (up.disabled) up.title = tx(`El clan necesita nivel ${CLAN.crestLevel}.`, `The clan needs level ${CLAN.crestLevel}.`);
      up.onclick = () => pickCrest(CLAN.crestW, CLAN.crestH, (png) => this.g.net.send({ t: 'clanCrest', png }));
    }
    const actions = el('div', 'row', b);
    if (this.me()?.grade !== 1) {
      const leave = el('button', 'btn', actions, tx('Dejar el clan', 'Leave the clan'));
      leave.onclick = () => this.g.ui.dialogs.confirm(tx('¿Dejar el clan? No vas a poder entrar a otro durante 24 horas.', 'Leave the clan? You will not be able to join another for 24 hours.'),
        () => this.g.net.send({ t: 'clanLeave' }));
    }
  }

  private renderMembers(c: ClanInfo, b: HTMLElement) {
    if (this.can('invite')) {
      const r = el('div', 'row', b);
      const inp = el('input', 'grow', r);
      inp.placeholder = tx('Nombre del jugador', 'Player name');
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      const go = el('button', 'btn', r, tx('Invitar', 'Invite'));
      const blocked = c.inviteUntil > Date.now();
      go.disabled = blocked || c.members.length >= c.cap;
      if (blocked) go.title = tx('Tu clan expulsó a alguien hace poco y no puede invitar todavía.', 'Your clan dismissed someone recently and cannot invite yet.');
      go.onclick = () => inp.value.trim() && this.g.net.send({ t: 'clanInvite', name: inp.value.trim() });
    }
    const me = this.me();
    const list = el('div', 'clan-members', b);
    const sorted = [...c.members].sort((a, z) => a.grade - z.grade || Number(z.on) - Number(a.on) || a.name.localeCompare(z.name));
    for (const m of sorted) {
      const row = el('div', `clan-member${m.on ? '' : ' off'}`, list);
      el('div', 'grow', row).innerHTML =
        `<b>${esc(m.name)}</b>${m.title ? ` <span class="np-ptitle">${esc(m.title)}</span>` : ''}<br><span class="tt-dim">${tx('Nv', 'Lv')} ${m.level} · ${esc(className(m.cls, lang))} · ${gradeName(m.grade)}${m.on ? '' : ` · ${tx('desconectado', 'offline')}`}</span>`;
      if (!me || m.name === me.name || m.grade === 1) continue;
      const acts = el('div', 'clan-acts', row);
      if (this.can('title')) {
        const t = el('button', 'btn small', acts, tx('Título', 'Title'));
        t.onclick = () => {
          const v = prompt(tx(`Título para ${m.name} (hasta ${CLAN.titleMax} letras, vacío para quitarlo):`, `Title for ${m.name} (up to ${CLAN.titleMax} letters, empty to clear):`), m.title);
          if (v !== null) this.g.net.send({ t: 'clanTitle', name: m.name, title: v });
        };
      }
      if (this.can('ranks')) {
        const sel = el('select', '', acts);
        for (let gr = 2; gr <= CLAN_GRADES; gr++) {
          if (c.level < (CLAN_GRADE_LEVEL[gr] ?? 0)) continue;
          const o = el('option', '', sel, gradeName(gr));
          o.value = String(gr);
          o.selected = gr === m.grade;
        }
        sel.onchange = () => this.g.net.send({ t: 'clanGrade', name: m.name, grade: +sel.value });
      }
      if (this.can('dismiss') && (me.grade === 1 || m.grade > me.grade)) {
        const k = el('button', 'btn small', acts, tx('Expulsar', 'Dismiss'));
        k.onclick = () => this.g.ui.dialogs.confirm(tx(`¿Expulsar a ${m.name}? El clan no podrá invitar durante 24 horas.`, `Dismiss ${m.name}? The clan will not be able to invite for 24 hours.`),
          () => this.g.net.send({ t: 'clanKick', name: m.name }));
      }
      if (me.grade === 1) {
        const lead = el('button', 'btn small', acts, tx('Líder', 'Leader'));
        lead.title = tx('Transferir el liderazgo', 'Hand over the leadership');
        lead.onclick = () => this.g.ui.dialogs.confirm(tx(`¿Hacer a ${m.name} líder del clan?`, `Make ${m.name} the clan leader?`), () => this.g.net.send({ t: 'clanTransfer', name: m.name }));
      }
    }
  }

  private renderWars(c: ClanInfo, b: HTMLElement) {
    el('div', 'tt-dim', b, tx('Cuando los dos clanes se declaran la guerra, es total: sus miembros se pueden atacar sin flag, matar no da karma y cada baja suma o resta reputación.',
      'Once both clans have declared war, it is a full war: their members may attack each other without flags, kills give no karma and each kill moves the clans\' reputation.'));
    const canWar = this.can('war') && c.level >= CLAN.warLevel;
    if (this.can('war')) {
      const r = el('div', 'row', b);
      const inp = el('input', 'grow', r);
      inp.placeholder = tx('Nombre del clan', 'Clan name');
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      const go = el('button', 'btn', r, tx('Declarar guerra', 'Declare war'));
      go.disabled = !canWar;
      if (!canWar) go.title = tx(`El clan necesita nivel ${CLAN.warLevel}.`, `The clan needs level ${CLAN.warLevel}.`);
      go.onclick = () => {
        const name = inp.value.trim();
        if (name) this.g.ui.dialogs.confirm(tx(`¿Declararle la guerra al clan ${name}?`, `Declare war on the clan ${name}?`), () => this.g.net.send({ t: 'clanWar', name }));
      };
    }
    if (!c.wars.length) { el('div', 'tt-dim', b, tx('Tu clan no está en guerra.', 'Your clan is not at war.')); return; }
    const list = el('div', 'clan-members', b);
    for (const w of [...c.wars].sort((a, z) => Number(z.ours && z.theirs) - Number(a.ours && a.theirs) || a.name.localeCompare(z.name))) {
      const row = el('div', 'clan-war', list);
      if (w.cv) row.appendChild(crestImg(w.id, w.cv));
      const mutual = w.ours && w.theirs;
      el('div', 'grow', row).innerHTML = `<b>${esc(w.name)}</b><br><span class="war-state${mutual ? ' mutual' : ' tt-dim'}">${
        mutual ? tx('Guerra total', 'Full war') : w.ours ? tx('Declarada por tu clan', 'Declared by your clan') : tx('Les declararon la guerra', 'Declared on your clan')}</span>`;
      if (!canWar) continue;
      if (!w.ours) {
        const back = el('button', 'btn small', row, tx('Declarar también', 'Declare back'));
        back.onclick = () => this.g.ui.dialogs.confirm(tx(`¿Declararle la guerra a ${w.name}? Será una guerra total.`, `Declare war on ${w.name}? It becomes a full war.`), () => this.g.net.send({ t: 'clanWar', name: w.name }));
      } else {
        const end = el('button', 'btn small', row, tx('Terminar', 'End'));
        end.onclick = () => this.g.ui.dialogs.confirm(tx(`¿Terminar la guerra con ${w.name}? No vas a poder declarársela de nuevo durante 24 horas.`, `End the war with ${w.name}? You will not be able to declare it again for 24 hours.`),
          () => this.g.net.send({ t: 'clanWarEnd', name: w.name }));
      }
    }
  }

  private renderAlly(c: ClanInfo, b: HTMLElement) {
    const leader = this.me()?.grade === 1;
    const a = c.ally;
    const now = Date.now();
    if (!a) {
      el('div', 'tt-dim', b, tx(`Tu clan no está en una alianza. El líder de un clan de nivel ${CLAN.allyLevel} puede fundar una en el Maestro de Clanes, e invitar hasta ${CLAN.allyMax - 1} clanes más.`,
        `Your clan is not in an alliance. The leader of a level ${CLAN.allyLevel} clan can found one at the Clan Master and invite up to ${CLAN.allyMax - 1} more clans.`));
      if (c.allyJoinUntil > now) el('div', 'tt-dim', b, tx(`Tu clan dejó una alianza hace poco: podrá entrar a otra en ${hours(c.allyJoinUntil - now)} h.`, `Your clan left an alliance recently: it may join another in ${hours(c.allyJoinUntil - now)} h.`));
      if (c.allyFoundUntil > now) el('div', 'tt-dim', b, tx(`Tu clan disolvió una alianza hace poco: podrá fundar otra en ${hours(c.allyFoundUntil - now)} h.`, `Your clan dissolved an alliance recently: it may found another in ${hours(c.allyFoundUntil - now)} h.`));
      return;
    }
    const runs = leader && a.leader === c.id;
    const head = el('div', 'clan-head', b);
    if (a.cv) head.appendChild(crestImg(a.id, a.cv, true)).classList.add('crest-ally-big');
    el('div', 'clan-name', head, a.name);
    el('div', 'tt-dim', b, tx(`${a.clans.length} de ${CLAN.allyMax} clanes. Chat de alianza: empezá el mensaje con $.`, `${a.clans.length} of ${CLAN.allyMax} clans. Alliance chat: start the line with $.`));
    if (runs) {
      const r = el('div', 'row', b);
      const inp = el('input', 'grow', r);
      inp.placeholder = tx('Líder del clan a invitar', 'Leader of the clan to invite');
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      const go = el('button', 'btn', r, tx('Invitar', 'Invite'));
      const blocked = a.inviteUntil > now;
      go.disabled = blocked || a.clans.length >= CLAN.allyMax;
      if (blocked) go.title = tx('Tu alianza expulsó a un clan hace poco y no puede invitar todavía.', 'Your alliance expelled a clan recently and cannot invite yet.');
      go.onclick = () => inp.value.trim() && this.g.net.send({ t: 'allyInvite', name: inp.value.trim() });
    }
    const list = el('div', 'clan-members', b);
    for (const ac of a.clans) {
      const row = el('div', 'clan-war', list);
      if (ac.cv) row.appendChild(crestImg(ac.id, ac.cv));
      el('div', 'grow', row).innerHTML = `<b>${esc(ac.name)}</b>${ac.id === a.leader ? ` <span class="np-ptitle">${tx('líder', 'leader')}</span>` : ''}<br><span class="tt-dim">${
        tx('Nv', 'Lv')} ${ac.level} · ${esc(ac.leader)} · ${ac.members} ${ac.members === 1 ? tx('miembro', 'member') : tx('miembros', 'members')}</span>`;
      if (runs && ac.id !== a.leader) {
        const k = el('button', 'btn small', row, tx('Expulsar', 'Expel'));
        k.onclick = () => this.g.ui.dialogs.confirm(tx(`¿Expulsar al clan ${ac.name} de la alianza? La alianza no podrá invitar durante 24 horas.`, `Expel the clan ${ac.name} from the alliance? The alliance will not be able to invite for 24 hours.`),
          () => this.g.net.send({ t: 'allyKick', name: ac.name }));
      }
    }
    const actions = el('div', 'row', b);
    if (runs) {
      const up = el('button', 'btn', actions, a.cv ? tx('Cambiar emblema', 'Change crest') : tx('Subir emblema', 'Upload crest'));
      up.title = tx(`Imagen de ${CLAN.allyCrestW}×${CLAN.allyCrestH}`, `${CLAN.allyCrestW}×${CLAN.allyCrestH} image`);
      up.onclick = () => pickCrest(CLAN.allyCrestW, CLAN.allyCrestH, (png) => this.g.net.send({ t: 'allyCrest', png }));
      const dis = el('button', 'btn', actions, tx('Disolver la alianza', 'Dissolve the alliance'));
      dis.onclick = () => this.g.ui.dialogs.confirm(tx(`¿Disolver ${a.name}? Tu clan no podrá fundar otra alianza durante 24 horas.`, `Dissolve ${a.name}? Your clan will not be able to found another alliance for 24 hours.`),
        () => this.g.net.send({ t: 'allyDissolve' }));
    } else if (leader) {
      const leave = el('button', 'btn', actions, tx('Dejar la alianza', 'Leave the alliance'));
      leave.onclick = () => this.g.ui.dialogs.confirm(tx(`¿Sacar a tu clan de ${a.name}? No va a poder entrar a otra alianza durante 24 horas.`, `Take your clan out of ${a.name}? It will not be able to join another alliance for 24 hours.`),
        () => this.g.net.send({ t: 'allyLeave' }));
    }
  }

  private renderPrivs(c: ClanInfo, b: HTMLElement) {
    const leader = this.me()?.grade === 1;
    el('div', 'tt-dim', b, leader ? tx('Elegí qué puede hacer cada rango.', 'Choose what each grade may do.') : tx('Solo el líder cambia los privilegios.', 'Only the leader changes privileges.'));
    const table = el('table', 'clan-privs', b);
    const head = el('tr', '', table);
    el('th', '', head);
    const grades = [2, 3, 4, 5].filter((gr) => c.level >= (CLAN_GRADE_LEVEL[gr] ?? 0));
    for (const gr of grades) el('th', '', head, gradeName(gr));
    for (const p of Object.keys(CLAN_PRIV) as ClanPriv[]) {
      const tr = el('tr', '', table);
      el('td', '', tr, PRIV_LABEL[p]);
      for (const gr of grades) {
        const td = el('td', '', tr);
        const box = el('input', '', td);
        box.type = 'checkbox';
        box.checked = ((c.privs[gr] ?? 0) & CLAN_PRIV[p]) !== 0;
        box.disabled = !leader;
        box.onchange = () => this.g.net.send({ t: 'clanPrivs', grade: gr, privs: box.checked ? (c.privs[gr] | CLAN_PRIV[p]) : (c.privs[gr] & ~CLAN_PRIV[p]) });
      }
    }
  }
}

/** The clan master's options in the NPC dialog: found a clan, raise it, dissolve it. */
export function renderClanNpc(g: Game, m: Extract<S2C, { t: 'npc' }>, b: HTMLElement) {
  const clan = g.ui.clan.clan;
  const meIn = g.ui.clan.me();
  if (!clan) {
    const cost = CLAN_LEVELS[0].adena;
    el('div', '', b).innerHTML = tx(`Fundar un clan cuesta <b>${cost.toLocaleString('es-AR')}</b> de adena y requiere nivel ${CLAN.foundLevel}.`,
      `Founding a clan costs <b>${cost.toLocaleString('en-US')}</b> adena and needs level ${CLAN.foundLevel}.`);
    const r = el('div', 'row', b);
    const inp = el('input', 'grow', r);
    inp.placeholder = tx('Nombre del clan', 'Clan name');
    inp.maxLength = CLAN.nameMax;
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    const go = el('button', 'btn primary', r, tx('Fundar', 'Found'));
    go.disabled = g.me.lvl < CLAN.foundLevel || g.adena < cost;
    go.onclick = () => inp.value.trim() && g.net.send({ t: 'clanCreate', npc: m.npc, name: inp.value.trim() });
    return;
  }
  el('div', '', b).innerHTML = `<b>${esc(clan.name)}</b> — ${tx('nivel', 'level')} ${clan.level}, ${clan.members.length}/${clan.cap} ${tx('miembros', 'members')}`;
  if (meIn?.grade !== 1) {
    el('div', 'tt-dim', b, tx('Solo el líder puede subir el nivel o disolver el clan.', 'Only the leader can raise or dissolve the clan.'));
    return;
  }
  const next = CLAN_LEVELS[clan.level + 1];
  if (next) {
    const needs = [`${next.adena.toLocaleString(lang === 'en' ? 'en-US' : 'es-AR')} adena`, ...next.mats.map(([id, n]) => `${n}× ${itemLabel(id)}`)];
    if (next.rep) needs.push(tx(`${next.rep} de reputación`, `${next.rep} reputation`));
    const row = el('div', 'shop-row', b);
    el('div', 'grow', row).innerHTML = `<b>${tx(`Subir a nivel ${clan.level + 1}`, `Raise to level ${clan.level + 1}`)}</b> — ${tx(`hasta ${next.members} miembros`, `up to ${next.members} members`)}<br><span class="tt-dim">${needs.map(esc).join(', ')}</span>`;
    const up = el('button', 'btn primary', row, tx('Subir', 'Raise'));
    up.onclick = () => g.net.send({ t: 'clanLevelUp', npc: m.npc });
  } else el('div', 'tt-dim', b, tx('Tu clan tiene el nivel máximo.', 'Your clan is at the highest level.'));
  if (!clan.ally && clan.level >= CLAN.allyLevel) {
    const ar = el('div', 'row', b);
    const inp = el('input', 'grow', ar);
    inp.placeholder = tx('Nombre de la alianza', 'Alliance name');
    inp.maxLength = CLAN.nameMax;
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    const go = el('button', 'btn', ar, tx('Fundar alianza', 'Found alliance'));
    go.disabled = Math.max(clan.allyJoinUntil, clan.allyFoundUntil) > Date.now();
    go.onclick = () => inp.value.trim() && g.net.send({ t: 'allyCreate', npc: m.npc, name: inp.value.trim() });
  }
  const r = el('div', 'row', b);
  const open = el('button', 'btn', r, tx('Ventana del clan', 'Clan window'));
  open.onclick = () => g.ui.clan.win.show();
  const dis = el('button', 'btn', r, tx('Disolver el clan', 'Dissolve the clan'));
  dis.onclick = () => g.ui.dialogs.confirm(tx(`¿Disolver ${clan.name}? No vas a poder fundar otro clan durante 10 días.`, `Dissolve ${clan.name}? You will not be able to found another clan for 10 days.`),
    () => g.net.send({ t: 'clanDissolve', npc: m.npc }));
}

const itemLabel = (id: string) => itemName(id, lang);
const hours = (ms: number) => Math.ceil(ms / 3600_000);

/** Pick an image file, shrink it to the crest's size (w×h) on a canvas and hand back the PNG as base64. */
function pickCrest(w: number, h: number, done: (png: string) => void) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      done(cv.toDataURL('image/png').split(',')[1]);
    };
    img.src = URL.createObjectURL(f);
  };
  inp.click();
}
