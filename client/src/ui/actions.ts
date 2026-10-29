// The character window's Actions tab (ui/panels.ts): the chat commands any player can type (server-rs/src/chat.rs; the
// GM's are left out) and the auto-attack, each with its icon, to drag onto the skill bars (ui/hud.ts) as a skill is.
// Used from a bar, a command is sent as the same chat line the player would type, so it does exactly what typing it does.
import { PVP_LEVEL } from '../../../shared/src/data/classes';
import { OLYMPIAD } from '../../../shared/src/data/olympiad';
import { QUESTS } from '../../../shared/src/data/quests';
import { RAIDS } from '../../../shared/src/data/raids';
import { questField } from '../../../shared/src/i18n';
import type { PetOrder } from '../../../shared/src/protocol';
import type { Game } from '../game';
import { lang, t as tx } from '../lang';
import { keyLabel, settings } from '../settings';
import { glyph, hex } from './common';
import { el, esc } from './dom';

export interface PlayerAction {
  id: string;
  /** what it is typed as in the chat (none: the auto-attack) */
  cmd?: string;
  /** its drawing in icons/ui/, and the colour behind it */
  icon: string;
  color: number;
  name: string;
  /** what it does (trusted markup) */
  desc: () => string;
  /** the tab's section it is listed under (ACTION_GROUPS) */
  group: number;
  /** what using it does; none: send `cmd` */
  run?: (g: Game) => void;
}

export const ACTION_GROUPS = [tx('Generales', 'General'), tx('Party y jugadores', 'Party and players'), tx('Raids e instancias', 'Raids and instances'), tx('Olimpiada y asedios', 'Olympiad and sieges')];

/** the player selected, if it is someone else */
function targetPlayer(g: Game) {
  const t = g.targetId !== null ? g.ents.get(g.targetId) : undefined;
  return t?.rec.k === 'p' && t.rec.id !== g.me.id ? t.rec : undefined;
}

const dim = (s: string) => `<br><span class="tt-dim">${s}</span>`;
const RAID_COLOR: Record<string, number> = { kaim: 0x9a3a2a, nest: 0xc8702a, frost: 0x4a90c8, swamp: 0x4a8a3a, abyss: 0x7a3ab0 };

/** the raids /raid enters (the Rift and the Olympiad's arena have their own commands), the lowest level first */
const raids = Object.values(RAIDS).filter((r) => !r.arena && !r.rift).sort((a, b) => a.minLevel - b.minLevel);

export const PLAYER_ACTIONS: PlayerAction[] = [
  {
    id: 'attack', icon: 'attack', color: 0xffaa44, group: 0, name: tx('Autoataque', 'Auto-attack'),
    desc: () => tx(`Ataca al objetivo seleccionado y sigue pegándole. ${settings.s.autoTarget ? 'Sin objetivo, elige el monstruo más cercano. ' : ''}Con Ctrl, fuerza el ataque a un jugador.`,
      `Attacks the selected target and keeps swinging. ${settings.s.autoTarget ? 'With no target, picks the nearest monster. ' : ''}Hold Ctrl to force an attack on a player.`),
    run: (g) => g.attackTarget(),
  },
  { id: 'sit', cmd: '/sit', icon: 'sit', color: 0x5a8a6a, group: 0, name: tx('Sentarse', 'Sit'),
    desc: () => tx('Te sentás en el suelo, o te levantás. Sentado recuperás vida y maná más rápido.', 'Sit on the ground, or get up. Sitting, you regain HP and MP faster.') },
  { id: 'dance', cmd: '/dance', icon: 'dance', color: 0xc85a9a, group: 0, name: tx('Bailar', 'Dance'),
    desc: () => tx('Tu personaje baila unos segundos, hasta que te movés o peleás.', 'Your character dances for a few seconds, until you move or fight.') },
  { id: 'pvp', cmd: '/pvp', icon: 'pvp', color: 0xb03a3a, group: 0, name: tx('Modo PvP', 'PvP mode'),
    desc: () => tx(`Activa o desactiva el modo PvP. Desde el nivel ${PVP_LEVEL} queda siempre activo.`, `Turns PvP mode on or off. From level ${PVP_LEVEL} it is always on.`) },
  { id: 'loc', cmd: '/loc', icon: 'loc', color: 0x4a7ab0, group: 0, name: tx('Ubicación', 'Location'),
    desc: () => tx('Escribe en el chat tus coordenadas y la zona donde estás.', 'Writes your coordinates and the zone you are in to the chat.') },
  { id: 'unstuck', cmd: '/unstuck', icon: 'unstuck', color: 0x8a7a4a, group: 0, name: tx('Destrabarse', 'Unstuck'),
    desc: () => tx('Si quedaste trabado: en 10 segundos volvés a la aldea. En la arena de la Olimpiada no sirve.', 'If you got stuck: in 10 seconds you are back in the village. Not in the Olympiad arena.') },
  { id: 'help', cmd: '/help', icon: 'help', color: 0x6a6a8a, group: 0, name: tx('Ayuda del chat', 'Chat help'),
    desc: () => tx('Escribe en el chat los canales y todos los comandos.', 'Writes the channels and every command to the chat.') },

  {
    id: 'invite', cmd: '/invite', icon: 'invite', color: 0x3a8ac8, group: 1, name: tx('Invitar a la party', 'Invite to party'),
    desc: () => tx('Invita a tu party al jugador seleccionado. Sin un jugador seleccionado, abre el chat con /invite para escribir el nombre.',
      'Invites the selected player to your party. With no player selected, opens the chat with /invite to type the name.'),
    run: (g) => {
      const p = targetPlayer(g);
      if (p) g.net.send({ t: 'chat', text: `/invite ${p.n}` });
      else g.ui.chat.prefill('/invite ');
    },
  },
  { id: 'leave', cmd: '/leave', icon: 'leave', color: 0x8a4a3a, group: 1, name: tx('Dejar la party', 'Leave party'),
    desc: () => tx('Te vas de tu party.', 'You leave your party.') },
  {
    id: 'trade', cmd: '/trade', icon: 'trade', color: 0xc8a03a, group: 1, name: tx('Comerciar', 'Trade'),
    desc: () => tx('Le pide un comercio al jugador seleccionado, o vuelve al que tenés abierto. Sin un jugador seleccionado, abre el chat con /trade para escribir el nombre.',
      'Asks the selected player to trade, or brings back the trade you have open. With no player selected, opens the chat with /trade to type the name.'),
    run: (g) => {
      // a trade already open (hidden for another window on a phone) comes back instead of asking again, as the target window's button does
      if (g.ui.trade.active) return g.ui.trade.win.show();
      const p = targetPlayer(g);
      if (p) g.net.send({ t: 'chat', text: `/trade ${p.n}` });
      else g.ui.chat.prefill('/trade ');
    },
  },
  {
    id: 'whisper', cmd: '/w', icon: 'whisper', color: 0x9a6ac8, group: 1, name: tx('Susurrar', 'Whisper'),
    desc: () => tx('Abre el chat para susurrarle al jugador seleccionado. Sin un jugador seleccionado, con /w para escribir el nombre y el mensaje.',
      'Opens the chat to whisper to the selected player. With no player selected, with /w to type the name and the message.'),
    run: (g) => {
      const p = targetPlayer(g);
      g.ui.chat.prefill(p ? `"${p.n} ` : '/w ');
    },
  },
  { id: 'who', cmd: '/who', icon: 'who', color: 0x4a9a8a, group: 1, name: tx('Jugadores conectados', 'Players online'),
    desc: () => tx('Escribe en el chat quiénes están conectados.', 'Writes who is online to the chat.') },

  ...raids.map((r): PlayerAction => {
    const q = r.quest ? QUESTS[r.quest] : undefined;
    const need = [r.minLevel > 1 ? tx(`Nivel ${r.minLevel}`, `Level ${r.minLevel}`) : '', q ? tx(`misión «${esc(questField(q, 'name', lang))}»`, `quest "${esc(questField(q, 'name', lang))}"`) : ''].filter(Boolean).join(' · ');
    const name = lang === 'en' ? r.nameEn : r.name;
    return {
      id: `raid_${r.id}`, cmd: r.id === 'kaim' ? '/raid' : `/raid ${r.id}`, icon: 'raid', color: RAID_COLOR[r.id] ?? 0x8a4a4a, group: 2, name,
      desc: () => tx(`Entrás a ${esc(name)} con tu party (la abre el líder). Dentro de una instancia, te saca de ella.`, `Takes you and your party into ${esc(name)} (the leader opens it). Inside an instance, takes you out of it.`) + (need ? dim(need) : ''),
    };
  }),
  { id: 'rift', cmd: tx('/grieta', '/rift'), icon: 'rift', color: 0x6a3ac8, group: 2, name: tx('La Grieta', 'The Rift'),
    desc: () => tx('Entrás con tu party a La Grieta: pisos sin fin, cada oleada más fuerte. Dentro de una instancia, te saca de ella.', 'Takes you and your party into the Rift: endless floors, every wave stronger. Inside an instance, takes you out of it.')
      + dim(tx(`Nivel ${RAIDS.rift.minLevel}`, `Level ${RAIDS.rift.minLevel}`)) },
  { id: 'rift_top', cmd: tx('/grieta top', '/rift top'), icon: 'ranking', color: 0x6a3ac8, group: 2, name: tx('Ranking de la Grieta', 'Rift ranking'),
    desc: () => tx('Escribe en el chat el ranking de la Grieta de esta semana.', 'Writes this week\'s Rift ranking to the chat.') },

  { id: 'olympiad', cmd: tx('/olimpiada', '/olympiad'), icon: 'olympiad', color: 0xc8a03a, group: 3, name: tx('Olimpiada', 'Olympiad'),
    desc: () => tx('Te anota en la cola de la Olimpiada, o te saca si ya estabas.', 'Joins the Olympiad queue, or leaves it if you were in it.')
      + dim(tx(`Nivel ${OLYMPIAD.minLevel}, después del Despertar`, `Level ${OLYMPIAD.minLevel}, after the Awakening`)) },
  { id: 'olympiad_top', cmd: tx('/olimpiada top', '/olympiad top'), icon: 'ranking', color: 0xc8a03a, group: 3, name: tx('Tabla de la Olimpiada', 'Olympiad table'),
    desc: () => tx('Escribe en el chat la tabla de la Olimpiada de este mes.', 'Writes this month\'s Olympiad table to the chat.') },
  { id: 'olympiad_heroes', cmd: tx('/olimpiada heroes', '/olympiad heroes'), icon: 'crown', color: 0xc8a03a, group: 3, name: tx('Héroes', 'Heroes'),
    desc: () => tx('Escribe en el chat los Héroes de la Olimpiada de este mes.', 'Writes this month\'s Olympiad Heroes to the chat.') },
  { id: 'siege', cmd: tx('/asedio', '/siege'), icon: 'siege', color: 0x8a6a4a, group: 3, name: tx('Asedios', 'Sieges'),
    desc: () => tx('Escribe en el chat quién tiene cada fuerte y cuándo es el próximo asedio.', 'Writes who holds each fort, and when the next siege is, to the chat.') },
];

/** A summoner's orders to their servitor (server-rs pet.rs pet_command): its panel lists them (ui/servitor.ts), and they
 * go on the bars as the player's actions do. */
const pet = (id: PetOrder, icon: string, color: number, name: string, desc: () => string): PlayerAction =>
  ({ id: `pet_${id}`, icon, color, group: -1, name, desc, run: (g) => g.petOrder(id) });
export const PET_ACTIONS: PlayerAction[] = [
  pet('attack', 'attack', 0xffaa44, tx('Atacar', 'Attack'), () => tx('Tu servitor elegido ataca a tu objetivo y sigue peleando con él. Con Ctrl, fuerza el ataque a un jugador.',
    'Your chosen servitor attacks your target and keeps fighting it. Hold Ctrl to force an attack on a player.')),
  pet('follow', 'pet_follow', 0x4a9a6a, tx('Seguir', 'Follow'), () => tx('Tu servitor elegido deja lo que hace y te sigue.', 'Your chosen servitor drops what it is doing and follows you.')),
  pet('stay', 'pet_stay', 0x4a7ab0, tx('Quedarse', 'Stay'), () => tx('Tu servitor elegido se queda donde está y no se defiende solo. Si le ordenás atacar, vuelve ahí después.',
    'Your chosen servitor stays where it is and does not fight back on its own. Told to attack, it comes back there afterwards.')),
  pet('stop', 'pet_stop', 0x8a6a4a, tx('Detener', 'Stop'), () => tx('Tu servitor elegido deja de pelear y de lanzar habilidades.', 'Your chosen servitor stops fighting and casting.')),
  pet('dismiss', 'pet_dismiss', 0x8a4a3a, tx('Retirar', 'Dismiss'), () => tx('Tu servitor elegido se va. Para volver a tenerlo, lo tenés que invocar de nuevo.', 'Your chosen servitor leaves. To have it again you must summon it again.')),
];

const BY_ID = new Map([...PLAYER_ACTIONS, ...PET_ACTIONS].map((a) => [a.id, a]));
export const isPlayerAction = (id: string) => BY_ID.has(id);

/** An action's icon, drawn as a skill's. */
export function actionIcon(id: string, parent?: HTMLElement): HTMLDivElement {
  const a = BY_ID.get(id);
  const d = el('div', 'icon skill', parent);
  glyph('ui', a?.icon ?? '', '?', d);
  d.style.background = `radial-gradient(circle at 35% 30%, ${hex(a?.color ?? 0x666666)}, #14161f 85%)`;
  return d;
}

/** Its name, what it is typed as (the auto-attack: its key), and what it does. */
export function actionTip(id: string): string {
  const a = BY_ID.get(id);
  if (!a) return '';
  const how = a.cmd ?? (a.id === 'attack' ? keyLabel(settings.s.keys.attack) : '');
  return `<div class="tt-title">${esc(a.name)}${how ? ` <span class="tt-dim">${esc(how)}</span>` : ''}</div>${a.desc()}`;
}

/** Use it: from a bar's slot (a click, a tap or the slot's key). */
export function runAction(g: Game, id: string) {
  const a = BY_ID.get(id);
  if (!a) return;
  if (a.run) a.run(g);
  else if (a.cmd) g.net.send({ t: 'chat', text: a.cmd });
}
