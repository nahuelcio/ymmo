import { inTown } from '../../../shared/src/terrain';
import { Mob } from '../world/entities';
import { dist, face, type World } from '../world/World';
import { physDamage } from '../../../shared/src/formulas';
import { applyDamage, applyStatus, mobAttack } from './combat';

const LEASH = 50;
const AGGRO_RANGE = 9;

export function updateMob(w: World, m: Mob, dt: number, now: number) {
  if (m.dead) {
    if (!m.hidden && now >= m.hideAt) {
      m.hidden = true;
      w.grid.update(m);
    }
    if (now >= m.respawnAt) respawn(w, m);
    return;
  }
  if (m.has('stun', now)) {
    m.moving = false;
    return;
  }

  const home = { x: m.homeX, z: m.homeZ };
  if (m.target !== null) {
    const t = w.players.get(m.target);
    if (!t || t.dead || inTown(t.x, t.z) || dist(home, t) > LEASH || dist(home, m) > LEASH) {
      m.hate.delete(m.target);
      m.target = null;
      // pick next valid hater
      let best = -1;
      for (const [id, h] of m.hate) {
        const p = w.players.get(id);
        if (p && !p.dead && !inTown(p.x, p.z) && dist(home, p) <= LEASH && h > best) {
          best = h;
          m.target = id;
        }
      }
      if (m.target === null) {
        m.hate.clear();
        m.returning = true;
        m.specialAt = 0;
        m.winding = null;
      }
    }
  }

  if (m.returning) {
    if (w.stepToward(m, m.homeX, m.homeZ, m.tpl.speed * 1.6, dt, 0.5)) {
      m.returning = false;
      m.hp = m.stats.maxHp;
    }
    return;
  }

  if (m.target !== null) {
    const t = w.players.get(m.target)!;
    if (m.winding) {
      m.moving = false;
      if (now >= m.winding.end) resolveSpecial(w, m, now);
      return;
    }
    const sp = m.tpl.special;
    if (sp) {
      if (!m.specialAt) m.specialAt = now + 3000; // grace period after engaging
      else if (now >= m.specialAt && dist(m, t) <= sp.r + 3) {
        const c = sp.at === 'self' ? m : t;
        m.winding = { x: c.x, z: c.z, end: now + sp.windup };
        m.moving = false;
        face(m, t);
        w.sendNear(m.x, m.z, { t: 'tele', id: m.id, x: c.x, z: c.z, r: sp.r, ms: sp.windup });
        return;
      }
    }
    const range = m.tpl.range + t.radius;
    if (dist(m, t) > range) {
      w.stepToward(m, t.x, t.z, m.tpl.speed * 1.25, dt, range - 0.3);
    } else {
      m.moving = false;
      face(m, t);
      if (now >= m.nextAttack) {
        m.nextAttack = now + m.tpl.atkInterval;
        mobAttack(w, m, t, now);
      }
    }
    return;
  }

  if (m.hp < m.stats.maxHp) m.hp = Math.min(m.stats.maxHp, m.hp + m.stats.maxHp * 0.03 * dt);

  if (m.tpl.aggressive) {
    for (const p of w.nearPlayers(m.x, m.z, AGGRO_RANGE)) {
      if (!p.dead && !inTown(p.x, p.z) && p.level < m.tpl.level + 8) {
        m.target = p.id;
        m.hate.set(p.id, 1);
        m.dest = null;
        return;
      }
    }
  }

  if (m.dest) {
    if (w.stepToward(m, m.dest.x, m.dest.z, m.tpl.speed * 0.45, dt, 0.2)) m.dest = null;
  } else {
    m.moving = false;
    if (now >= m.wanderAt) {
      m.wanderAt = now + 4000 + Math.random() * 9000;
      if (Math.random() < 0.6 && !m.tpl.boss) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 8;
        m.dest = { x: m.homeX + Math.cos(a) * r, z: m.homeZ + Math.sin(a) * r };
      }
    }
  }
}

/** The wind-up is over: hit everyone still inside the circle (rolling out or i-frames saves you). */
function resolveSpecial(w: World, m: Mob, now: number) {
  const sp = m.tpl.special!, at = m.winding!;
  m.winding = null;
  m.specialAt = now + sp.every;
  m.nextAttack = now + m.tpl.atkInterval * 0.5;
  for (const p of w.nearPlayers(at.x, at.z, sp.r + 0.5)) {
    if (p.dead || p.dodgeUntil > now) continue;
    const dmg = physDamage(m.stats.pAtk, p.stats.pDef, sp.mult, false);
    applyDamage(w, m, p, dmg, now);
    if (sp.stun) applyStatus(w, m, p, { id: 'stun', ms: sp.stun }, dmg, now);
  }
}

function respawn(w: World, m: Mob) {
  m.dead = false;
  m.hidden = false;
  m.hp = m.stats.maxHp;
  m.target = null;
  m.returning = false;
  m.hate.clear();
  m.dest = null;
  m.av++;
  w.setPos(m, m.homeX, m.homeZ);
  if (m.tpl.boss) w.broadcast({ t: 'chat', ch: 'announce', from: '', text: `¡El jefe ${m.tpl.name} despertó en los Páramos Malditos!` });
}
