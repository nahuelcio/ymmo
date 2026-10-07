import { MELEE_RANGE } from '../../../shared/src/formulas';
import { Mob, Npc, Player, GroundItem } from '../world/entities';
import { dist, face, type World } from '../world/World';
import { autoAttack, canAttack, finishCast, processSkillIntent } from './combat';
import { pickup, openNpc } from './inventory';
import { openQuest } from './quests';

export function updatePlayer(w: World, p: Player, dt: number, now: number) {
  if (p.dead) return;
  const s = p.stats;
  const regenMul = now - p.lastCombat < 5000 ? 0.6 : 1.5;
  p.hp = Math.min(s.maxHp, p.hp + s.hpRegen * dt * regenMul);
  p.mp = Math.min(s.maxMp, p.mp + s.mpRegen * dt * regenMul);
  p.cp = Math.min(s.maxCp, p.cp + s.cpRegen * dt);

  if (p.buffs.some((b) => b.until <= now)) {
    p.buffs = p.buffs.filter((b) => b.until > now);
    p.recalc();
  }

  if (p.escapeAt && now >= p.escapeAt) {
    p.escapeAt = 0;
    const pt = w.townPoint();
    w.teleport(p, pt.x, pt.z);
    return;
  }

  if (p.casting) {
    if (now >= p.casting.end) finishCast(w, p, now);
    return;
  }

  const it = p.intent;
  if (!it) {
    p.moving = false;
    return;
  }

  switch (it.type) {
    case 'move':
      if (w.stepToward(p, it.x, it.z, s.speed, dt, 0.05)) p.intent = null;
      break;
    case 'attack': {
      const t = w.ents.get(it.id);
      if (!t || canAttack(w, p, t, it.force, now) || !(t instanceof Mob || t instanceof Player)) {
        p.intent = null;
        p.moving = false;
        break;
      }
      const range = MELEE_RANGE + t.radius;
      if (dist(p, t) > range) {
        w.stepToward(p, t.x, t.z, s.speed, dt, range - 0.3);
      } else {
        p.moving = false;
        face(p, t);
        if (now >= p.nextAttack) {
          p.nextAttack = now + s.atkInterval;
          autoAttack(w, p, t, now);
        }
      }
      break;
    }
    case 'skill':
      processSkillIntent(w, p, it, dt, now);
      break;
    case 'pickup': {
      const t = w.ents.get(it.id);
      if (!(t instanceof GroundItem)) {
        p.intent = null;
        p.moving = false;
        break;
      }
      if (w.stepToward(p, t.x, t.z, s.speed, dt, 1.2)) {
        p.intent = null;
        pickup(w, p, t, now);
      }
      break;
    }
    case 'talk': {
      const t = w.ents.get(it.id);
      if (!(t instanceof Npc)) {
        p.intent = null;
        break;
      }
      if (w.stepToward(p, t.x, t.z, s.speed, dt, 2.5)) {
        p.intent = null;
        face(p, t);
        if (t.def.kind === 'quest') openQuest(w, p, t);
        else openNpc(w, p, t);
      }
      break;
    }
  }
}
