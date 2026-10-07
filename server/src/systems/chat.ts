import { zoneAt } from '../../../shared/src/data/world';
import type { Player } from '../world/entities';
import type { World } from '../world/World';
import * as party from './party';
import { zoneName } from '../../../shared/src/i18n';
import { setPvpMode } from './combat';

const LOCAL_RANGE = 100;

/**
 * L2-style prefixes:  !text = shout, #text = party, "name text = whisper.
 * Commands: /invite name, /leave, /w name text, /who, /loc, /unstuck, /help
 */
export function handleChat(w: World, p: Player, raw: string) {
  const text = raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
  if (!text) return;

  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    const arg = rest.join(' ').trim();
    switch (cmd.toLowerCase()) {
      case 'invite':
        return party.invite(w, p, arg);
      case 'leave':
        return party.leave(w, p, false);
      case 'w':
      case 'whisper': {
        const [to, ...msg] = arg.split(' ');
        return whisper(w, p, to ?? '', msg.join(' '));
      }
      case 'who':
        return w.sys(p, `Jugadores conectados (${w.players.size}): ${[...w.players.values()].map((x) => x.name).join(', ')}`, `Players online (${w.players.size}): ${[...w.players.values()].map((x) => x.name).join(', ')}`);
      case 'loc':
        return w.sys(p, `Ubicación: ${Math.round(p.x)}, ${Math.round(p.z)} — ${zoneAt(p.x, p.z)}`, `Location: ${Math.round(p.x)}, ${Math.round(p.z)} — ${zoneName(zoneAt(p.x, p.z), 'en')}`);
      case 'unstuck':
        if (p.dead) return;
        p.escapeAt = w.now + 10000;
        return w.sys(p, 'En 10 segundos volvés a la aldea...', 'You will be returned to the village in 10 seconds...');
      case 'pvp':
        return setPvpMode(w, p, arg ? arg.toLowerCase() === 'on' : !p.pvpOn);
      case 'help':
        return w.sys(p, 'Chat: !grito  #party  "nombre susurro. Comandos: /invite nombre, /leave, /w nombre mensaje, /who, /loc, /unstuck, /pvp [on|off]', 'Chat: !shout  #party  "name whisper. Commands: /invite name, /leave, /w name msg, /who, /loc, /unstuck, /pvp [on|off]');
      default:
        return w.sys(p, `No existe el comando /${cmd}. Escribí /help.`, `Unknown command /${cmd}. Type /help.`);
    }
  }
  if (text.startsWith('!')) {
    const msg = text.slice(1).trim();
    if (msg) w.broadcast({ t: 'chat', ch: 'shout', from: p.name, text: msg });
    return;
  }
  if (text.startsWith('#')) {
    const msg = text.slice(1).trim();
    if (!p.party) return w.sys(p, 'No estás en ninguna party.', 'You are not in a party.');
    if (msg) for (const m of p.party.members) m.send({ t: 'chat', ch: 'party', from: p.name, text: msg });
    return;
  }
  if (text.startsWith('"')) {
    const [to, ...msg] = text.slice(1).split(' ');
    return whisper(w, p, to, msg.join(' '));
  }
  w.sendNear(p.x, p.z, { t: 'chat', ch: 'all', from: p.name, text }, LOCAL_RANGE);
}

function whisper(w: World, p: Player, to: string, msg: string) {
  msg = msg.trim();
  if (!to || !msg) return w.sys(p, 'Uso: "nombre mensaje', 'Usage: "name message');
  const t = w.findPlayer(to);
  if (!t) return w.sys(p, `${to} no está conectado.`, `${to} is not online.`);
  t.send({ t: 'chat', ch: 'whisper', from: p.name, text: msg });
  p.send({ t: 'chat', ch: 'whisper', from: `->${t.name}`, text: msg });
}
