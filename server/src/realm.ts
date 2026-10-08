// Loading and saving characters into a World. Shared by the main thread (overworld) and the raid workers:
// moving between worlds is "save to the database, load in the other world", like any MMO zone transfer.
import { MAX_LEVEL } from '../../shared/src/data/classes';
import * as db from './db';
import { Player, type Session } from './world/entities';
import { primeQuestNotices, savedQuests, sendQuests } from './systems/quests';
import type { World } from './world/World';

export function savePlayer(p: Player, at?: { x: number; z: number }) {
  db.saveChar(
    { id: p.charId, level: p.level, xp: p.xp, x: at?.x ?? p.x, z: at?.z ?? p.z, hp: Math.max(1, p.hp), mp: p.mp, cp: p.cp,
      adena: p.adena, karma: p.karma, pk: p.pk, pvp: p.pvp },
    p.inv,
    savedQuests(p),
  );
}

/**
 * Load a character into world w for session s. 'enter' is the first entry after the character
 * screen; 'world' tells an in-game client to drop everything it knows and start over (world switch).
 */
export function loadPlayer(w: World, s: Session, charId: number, kind: 'enter' | 'world', at?: { x: number; z: number }): Player | null {
  const data = db.loadChar(s.accountId, charId);
  if (!data) return null;
  const r = data.row;
  const p = new Player(w.newId(), at?.x ?? r.x, at?.z ?? r.z, s, r.id, r.name, r.race, r.cls, Math.min(r.level, MAX_LEVEL), r.xp, r.hp, r.mp, r.cp, r.adena, r.karma, r.pk, r.pvp);
  p.look = r.look;
  p.inv = data.items.map((i) => ({ ...i, u: p.nextUid++ }));
  for (const q of data.quests) p.quests.set(q.id, { progress: q.progress, done: q.done });
  primeQuestNotices(p);
  p.recalc();
  s.player = p;
  w.addPlayer(p);
  s.send({ t: kind, self: w.selfState(p), inv: p.inv });
  sendQuests(p);
  return p;
}

/**
 * Staggered autosave: a few players per call instead of everyone at once every minute,
 * so a full server never stalls the game loop on one big write.
 */
export function autosave(w: World, now: number, every = 60000, perCall = 3, at?: (p: Player) => { x: number; z: number } | undefined) {
  let n = 0;
  for (const p of w.players.values()) {
    if (now - p.savedAt < every) continue;
    p.savedAt = now;
    try {
      savePlayer(p, at?.(p));
    } catch (e) {
      console.error('autosave failed', e);
    }
    if (++n >= perCall) break;
  }
}
