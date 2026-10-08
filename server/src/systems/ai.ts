import { pushOut } from '../../../shared/src/collision';
import { inTown } from '../../../shared/src/terrain';
import { Mob } from '../world/entities';
import { dist, face, type World } from '../world/World';
import { physDamage } from '../../../shared/src/formulas';
import { mobName, tr } from '../../../shared/src/i18n';
import { applyDamage, applyStatus, mobAttack } from './combat';

const LEASH = 50;
const AGGRO_RANGE = 9;

export function updateMob(w: World, m: Mob, dt: number, now: number) {
  if (m.dead) {
    if (!m.hidden && now >= m.hideAt) {
      m.hidden = true;
      w.grid.update(m);
    }
    if (now >= m.respawnAt && w.canRespawn(m, now)) respawn(w, m);
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
      m.threat.delete(m.target);
      m.target = null;
      m.tauntUntil = 0;
      // pick next valid enemy, highest threat first
      let best = -1;
      for (const [id, h] of m.threat) {
        const p = w.players.get(id);
        if (p && !p.dead && !inTown(p.x, p.z) && dist(home, p) <= LEASH && h > best) {
          best = h;
          m.target = id;
        }
      }
      if (m.target === null) {
        m.hate.clear();
        m.threat.clear();
        m.phase = 0;
        m.haste = 1;
        m.special = m.tpl.special;
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
    retarget(w, m, now);
    if (m.tpl.phases) checkPhases(w, m, now);
    const t = w.players.get(m.target)!;
    if (m.winding) {
      m.moving = false;
      if (now >= m.winding.end) resolveSpecial(w, m, now);
      return;
    }
    const sp = m.special;
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
        m.nextAttack = now + m.tpl.atkInterval / m.haste;
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
        m.threat.set(p.id, 1);
        m.dest = null;
        return;
      }
    }
  }

  if (m.dest) {
    // arrived, or it turned out there is no way to get any closer
    if (w.stepToward(m, m.dest.x, m.dest.z, m.tpl.speed * 0.45, dt, 0.2) || !m.moving) m.dest = null;
  } else {
    m.moving = false;
    if (now >= m.wanderAt) {
      m.wanderAt = now + 4000 + Math.random() * 9000;
      if (Math.random() < 0.6 && !m.tpl.boss) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 8;
        const p = { x: m.homeX + Math.cos(a) * r, z: m.homeZ + Math.sin(a) * r };
        // a spot inside a wall or a tent can never be reached: the mob would walk in place against it forever
        const free = pushOut(p.x, p.z, m.radius);
        if (Math.hypot(free.x - p.x, free.z - p.z) < 0.01) m.dest = p;
      }
    }
  }
}

/** The wind-up is over: hit everyone still inside the circle (rolling out or i-frames saves you). */
function resolveSpecial(w: World, m: Mob, now: number) {
  const sp = m.special!, at = m.winding!;
  m.winding = null;
  m.specialAt = now + sp.every;
  m.nextAttack = now + m.tpl.atkInterval * 0.5;
  // Lag compensation: each player saw the circle start (and fill) one-way-latency later than us,
  // so judge them at that moment on their own timeline: where they are and whether they rolled.
  for (const p of w.nearPlayers(at.x, at.z, sp.r + 12)) {
    w.later(now + p.oneWay + 40, (t) => {
      if (p.dead || m.dead || !w.players.has(p.id) || p.dodgeUntil > t) return;
      if (Math.hypot(p.x - at.x, p.z - at.z) > sp.r + 0.5) return;
      const dmg = physDamage(m.stats.pAtk, p.stats.pDef, sp.mult, false);
      applyDamage(w, m, p, dmg, t);
      if (sp.stun) applyStatus(w, m, p, { id: 'stun', ms: sp.stun }, dmg, t);
    });
  }
}

function respawn(w: World, m: Mob) {
  m.dead = false;
  m.hidden = false;
  m.hp = m.stats.maxHp;
  m.target = null;
  m.returning = false;
  m.hate.clear();
  m.threat.clear();
  m.phase = 0;
  m.haste = 1;
  m.special = m.tpl.special;
  m.dest = null;
  m.av++;
  w.setPos(m, m.homeX, m.homeZ);
  if (m.tpl.boss) w.announce((l) => tr(l, `¡El jefe ${m.tpl.name} despertó en los Páramos Malditos!`, `The raid boss ${mobName(m.tpl.id, 'en')} has awakened in the Cursed Wastes!`));
}

/**
 * Threat: twice a second, switch to whoever has clearly out-threatened the current target
 * (110%, so the boss doesn't ping-pong between two close dps). A taunt locks the target for a while.
 */
function retarget(w: World, m: Mob, now: number) {
  if (now < m.nextTargetCheck || now < m.tauntUntil) return;
  m.nextTargetCheck = now + 500;
  const home = { x: m.homeX, z: m.homeZ };
  const cur = m.threat.get(m.target!) ?? 0;
  let bestId = -1, best = cur * 1.1;
  for (const [id, v] of m.threat) {
    if (id === m.target || v <= best) continue;
    const p = w.players.get(id);
    if (!p || p.dead || inTown(p.x, p.z) || dist(home, p) > LEASH) continue;
    best = v;
    bestId = id;
  }
  if (bestId >= 0) m.target = bestId;
}

/** Raid boss phases: crossing an HP threshold summons adds, speeds it up and/or swaps its special. */
function checkPhases(w: World, m: Mob, now: number) {
  const phases = m.tpl.phases!;
  const pct = (m.hp / m.stats.maxHp) * 100;
  while (m.phase < phases.length && pct <= phases[m.phase].at) {
    const ph = phases[m.phase++];
    if (ph.haste) m.haste = ph.haste;
    if (ph.special) {
      m.special = ph.special;
      m.specialAt = now + 2500;
    }
    for (const p of w.nearPlayers(m.x, m.z, 80)) {
      p.send({ t: 'chat', ch: 'announce', from: '', text: `${mobName(m.tpl.id, p.lang)}: ${p.lang === 'en' ? ph.say[1] : ph.say[0]}` });
    }
    if (ph.adds) {
      for (let i = 0; i < ph.adds.count; i++) {
        const a = (i / ph.adds.count) * Math.PI * 2;
        const add = w.spawnMob(ph.adds.mob, m.x + Math.cos(a) * 9, m.z + Math.sin(a) * 9, now);
        // they go for the healers and casters first: whoever is furthest from the boss
        const victims = [...m.threat.keys()].map((id) => w.players.get(id)).filter((p): p is NonNullable<typeof p> => !!p && !p.dead);
        victims.sort((p1, p2) => dist(p2, m) - dist(p1, m));
        const v = victims[i % Math.max(1, victims.length)];
        if (v) {
          add.target = v.id;
          add.hate.set(v.id, 1);
          add.threat.set(v.id, 50);
        }
      }
    }
  }
}
