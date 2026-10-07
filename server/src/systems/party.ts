import { MAX_PARTY } from '../../../shared/src/formulas';
import type { PartyMember } from '../../../shared/src/protocol';
import type { Party, Player } from '../world/entities';
import type { World } from '../world/World';

let nextPartyId = 1;

export function invite(w: World, p: Player, name: string) {
  const t = w.findPlayer(name.trim());
  if (!t) return w.sys(p, `${name} no está conectado.`);
  if (t === p) return w.sys(p, 'No te podés invitar a vos mismo.');
  if (t.party) return w.sys(p, `${t.name} ya está en una party.`);
  if (p.party && p.party.members[0] !== p) return w.sys(p, 'Solo el líder de la party puede invitar.');
  if (p.party && p.party.members.length >= MAX_PARTY) return w.sys(p, 'Tu party está llena.');
  if (t.pendingInvite && t.pendingInvite.until > w.now) return w.sys(p, `${t.name} está respondiendo otra invitación.`);
  t.pendingInvite = { from: p.id, until: w.now + 30000 };
  t.send({ t: 'partyInvite', from: p.name });
  w.sys(p, `Invitaste a ${t.name} a tu party.`);
}

export function respond(w: World, p: Player, accept: boolean) {
  const inv = p.pendingInvite;
  p.pendingInvite = null;
  if (!inv || inv.until < w.now) return;
  const from = w.players.get(inv.from);
  if (!from) return;
  if (!accept) return w.sys(from, `${p.name} rechazó tu invitación.`);
  if (p.party) return;
  let party = from.party;
  if (!party) {
    party = { id: nextPartyId++, members: [from] };
    from.party = party;
    w.parties.add(party);
  }
  if (party.members.length >= MAX_PARTY) return w.sys(p, 'La party está llena.');
  party.members.push(p);
  p.party = party;
  for (const m of party.members) w.sys(m, `${p.name} se unió a la party.`);
  sendParty(party);
}

export function leave(w: World, p: Player, disconnect: boolean) {
  const party = p.party;
  if (!party) return;
  party.members = party.members.filter((m) => m !== p);
  p.party = null;
  if (!disconnect) {
    p.send({ t: 'party', members: null });
    w.sys(p, 'Saliste de la party.');
  }
  for (const m of party.members) w.sys(m, `${p.name} dejó la party.`);
  if (party.members.length < 2) {
    for (const m of party.members) {
      m.party = null;
      m.send({ t: 'party', members: null });
      w.sys(m, 'La party se disolvió.');
    }
    w.parties.delete(party);
  } else sendParty(party);
}

function sendParty(party: Party) {
  const members: PartyMember[] = party.members.map((m, i) => ({
    id: m.id, name: m.name, lvl: m.level, cls: m.cls, leader: i === 0,
    hp: Math.ceil(m.hp), maxHp: m.stats.maxHp, mp: Math.floor(m.mp), maxMp: m.stats.maxMp, cp: Math.floor(m.cp), maxCp: m.stats.maxCp,
  }));
  for (const m of party.members) m.send({ t: 'party', members });
}

export function sendPartyUpdates(w: World) {
  for (const party of w.parties) sendParty(party);
}
