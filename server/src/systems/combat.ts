import { MAX_LEVEL } from '../../../shared/src/data/classes';
import { SKILLS, skillAvailable, skillsFor } from '../../../shared/src/data/skills';
import {
  hitChance, KARMA_PER_PK, levelPenalty, magicDamage, mobXp, PARTY_BONUS, physDamage, PVP_FLAG_MS, xpToNext,
} from '../../../shared/src/formulas';
import { inTown } from '../../../shared/src/terrain';
import { Entity, Mob, Player, type Intent, type Party } from '../world/entities';
import { dist, face, type World } from '../world/World';
import { dropFromPlayer, dropLoot } from './inventory';

type Fighter = Player | Mob;

const PVP_OFF_COOLDOWN = 10000;

/** Turn PvP mode on/off. Can't hide from a fight: turning off needs 10 s out of combat and no flag. */
export function setPvpMode(w: World, p: Player, on: boolean) {
  if (p.pvpOn === on) return;
  if (!on) {
    if (p.karma > 0) return w.sys(p, 'You cannot disable PvP while you have karma.');
    if (p.pvpUntil > w.now || w.now - p.lastCombat < PVP_OFF_COOLDOWN)
      return w.sys(p, 'You cannot disable PvP while in combat or flagged. Wait a few seconds.');
  }
  p.pvpOn = on;
  w.sys(p, on ? 'PvP mode ON: you can attack and be attacked by other PvP players.' : 'PvP mode OFF: other players cannot attack you.');
}

export function canAttack(_w: World, p: Player, t: Entity, force: boolean, now: number): string | null {
  if (t.dead) return 'Your target is already dead.';
  if (t instanceof Mob) return null;
  if (!(t instanceof Player)) return 'Invalid target.';
  if (t === p) return 'You cannot attack yourself.';
  if (inTown(p.x, p.z) || inTown(t.x, t.z)) return 'You cannot attack in a peace zone.';
  if (p.party && p.party === t.party) return 'You cannot attack a party member.';
  if (!p.pvpOn) return 'Your PvP mode is off. Turn it on (PvP button or /pvp) to fight players.';
  // PKs (karma) are always fair game; otherwise both sides must have opted in
  if (!t.pvpOn && t.karma === 0) return `${t.name} has PvP mode off.`;
  if (t.karma > 0 || t.pvpUntil > now) return null;
  if (force) return null;
  return 'Hold Ctrl and click to force attack another player.';
}

function defStats(t: Fighter): { pDef: number; mDef: number; evasion: number } {
  return t.stats;
}

function sendMiss(src: Fighter, t: Fighter) {
  const msg = { t: 'dmg' as const, s: src.id, tg: t.id, v: 0, miss: true };
  if (src instanceof Player) src.send(msg);
  if (t instanceof Player) t.send(msg);
}

export function autoAttack(w: World, p: Player, t: Fighter, now: number) {
  w.sendNear(p.x, p.z, { t: 'atk', s: p.id, tg: t.id });
  const d = defStats(t);
  p.lastCombat = now;
  if (Math.random() > hitChance(p.stats.accuracy, d.evasion)) return sendMiss(p, t);
  const crit = Math.random() * 100 < p.stats.crit;
  applyDamage(w, p, t, physDamage(p.stats.pAtk, d.pDef, 1, crit), now, crit);
}

export function mobAttack(w: World, m: Mob, t: Player, now: number) {
  w.sendNear(m.x, m.z, { t: 'atk', s: m.id, tg: t.id });
  if (Math.random() > hitChance(m.stats.accuracy, t.stats.evasion)) return sendMiss(m, t);
  const crit = Math.random() * 100 < m.stats.crit;
  applyDamage(w, m, t, physDamage(m.stats.pAtk, t.stats.pDef, 1, crit), now, crit);
}

export function applyDamage(w: World, src: Fighter, t: Fighter, dmg: number, now: number, crit = false) {
  if (t.dead) return;
  const msg = { t: 'dmg' as const, s: src.id, tg: t.id, v: dmg, crit };
  if (src instanceof Player) {
    src.send(msg);
    src.lastCombat = now;
  }
  if (t instanceof Player && t !== src) t.send(msg);

  if (t instanceof Mob) {
    if (src instanceof Player) {
      t.hate.set(src.id, (t.hate.get(src.id) ?? 0) + dmg);
      if (t.target === null || t.returning) {
        t.returning = false;
        t.target = src.id;
      }
    }
    t.hp -= dmg;
    if (t.hp <= 0) killMob(w, t, now);
    return;
  }

  // Player target
  t.lastCombat = now;
  if (src instanceof Player) {
    if (t.karma === 0) src.pvpUntil = now + PVP_FLAG_MS;
    const absorbed = Math.min(t.cp, dmg);
    t.cp -= absorbed;
    t.hp -= dmg - absorbed;
  } else {
    t.hp -= dmg;
  }
  if (t.hp <= 0) killPlayer(w, t, src, now);
}

export function gainXp(w: World, p: Player, amount: number) {
  const amt = Math.round(amount);
  if (amt <= 0 || p.dead) return;
  if (p.karma > 0) {
    p.karma = Math.max(0, p.karma - Math.max(10, Math.round(amt / 3)));
    if (p.karma === 0) w.sys(p, 'Your karma has been cleansed.');
  }
  if (p.level >= MAX_LEVEL) return;
  p.xp += amt;
  w.sys(p, `You have earned ${amt} experience.`);
  let up = false;
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    up = true;
    for (const sk of skillsFor(p.cls, p.level, p.race, p.look.g)) if (sk.level === p.level) w.sys(p, `You have learned ${sk.name}.`);
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
  if (up) {
    p.recalc();
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    p.cp = p.stats.maxCp;
    p.av++;
    w.sendNear(p.x, p.z, { t: 'levelUp', id: p.id, lvl: p.level });
    w.sys(p, `Your level has increased to ${p.level}!`);
  }
}

export function killMob(w: World, m: Mob, now: number) {
  m.dead = true;
  m.hp = 0;
  m.target = null;
  m.moving = false;
  m.dest = null;
  m.hideAt = now + 6000;
  m.respawnAt = now + (m.tpl.respawn ?? 15000 + Math.random() * 15000);
  w.sendNear(m.x, m.z, { t: 'died', id: m.id, byPlayer: false });

  // Group damage dealers into units (solo players or parties)
  const units = new Map<string, { dmg: number; party: Party | null; player: Player }>();
  let total = 0;
  for (const [id, dmg] of m.hate) {
    const pl = w.players.get(id);
    if (!pl) continue;
    total += dmg;
    const key = pl.party ? `p${pl.party.id}` : `c${pl.id}`;
    const u = units.get(key) ?? { dmg: 0, party: pl.party, player: pl };
    u.dmg += dmg;
    units.set(key, u);
  }
  m.hate.clear();
  if (total <= 0) return;

  const baseXp = mobXp(m.tpl);
  let best: { dmg: number; party: Party | null; player: Player } | null = null;
  for (const u of units.values()) {
    if (!best || u.dmg > best.dmg) best = u;
    const xp = baseXp * (u.dmg / total);
    if (u.party) {
      const elig = u.party.members.filter((mm) => !mm.dead && dist(mm, m) <= 80);
      if (!elig.length) continue;
      const bonus = PARTY_BONUS[elig.length] ?? 1.8;
      const sumL = elig.reduce((a, mm) => a + mm.level, 0);
      for (const mm of elig) gainXp(w, mm, ((xp * bonus * mm.level) / sumL) * levelPenalty(mm.level, m.tpl.level));
    } else {
      gainXp(w, u.player, xp * levelPenalty(u.player.level, m.tpl.level));
    }
  }
  const owners = best!.party ? new Set(best!.party.members.map((mm) => mm.id)) : new Set([best!.player.id]);
  dropLoot(w, m, owners, now);
  if (m.tpl.boss) w.broadcast({ t: 'chat', ch: 'announce', from: '', text: `${best!.player.name} has slain the raid boss ${m.tpl.name}!` });
}

export function killPlayer(w: World, t: Player, killer: Fighter, now: number) {
  t.dead = true;
  t.hp = 0;
  t.intent = null;
  t.casting = null;
  t.moving = false;
  t.escapeAt = 0;
  t.buffs = [];
  t.recalc();
  const byPlayer = killer instanceof Player;
  w.sendNear(t.x, t.z, { t: 'died', id: t.id, byPlayer });

  if (killer instanceof Player) {
    w.sys(t, `You have been killed by ${killer.name}.`);
    if (t.karma > 0 || t.pvpUntil > now) {
      killer.pvp++;
      w.sys(killer, `You have defeated ${t.name}.`);
    } else {
      killer.karma += KARMA_PER_PK;
      killer.pk++;
      killer.pvpUntil = 0;
      w.sys(killer, `You murdered ${t.name}, who was not flagged. You gained ${KARMA_PER_PK} karma!`);
    }
    if (killer.intent?.type === 'attack' && killer.intent.id === t.id) killer.intent = null;
  } else {
    const loss = Math.round(xpToNext(t.level) * 0.04 * (t.karma > 0 ? 2 : 1));
    if (loss > 0 && t.xp > 0) {
      t.xp = Math.max(0, t.xp - loss);
      w.sys(t, `You have died and lost ${loss} experience.`);
    }
  }
  if (t.karma > 0 && Math.random() < 0.4) dropFromPlayer(w, t, now);
  t.pvpUntil = 0;
}

export function respawnPlayer(w: World, p: Player) {
  if (!p.dead) return;
  p.dead = false;
  p.hp = p.stats.maxHp * 0.7;
  p.mp = p.stats.maxMp * 0.7;
  p.cp = p.stats.maxCp * 0.7;
  const pt = w.townPoint();
  w.teleport(p, pt.x, pt.z);
}

export function requestSkill(w: World, p: Player, skillId: string, force: boolean, now: number) {
  const def = SKILLS[skillId];
  if (!def || !skillAvailable(def, p.cls, p.race, p.look.g) || def.level > p.level) return w.sys(p, 'You have not learned that skill.');
  if (p.dead) return;
  if (p.casting) return;
  if ((p.cooldowns.get(def.id) ?? 0) > now) return w.sys(p, `${def.name} is not ready yet.`);
  if (p.mp < def.mp) return w.sys(p, 'Not enough MP.');
  let targetId = p.id;
  const cur = p.target !== null ? w.ents.get(p.target) : undefined;
  if (def.target === 'friend') {
    if (cur instanceof Player && !cur.dead) targetId = cur.id;
  } else if (def.target === 'enemy') {
    if (!cur) return w.sys(p, 'Select a target first.');
    const err = canAttack(w, p, cur, force, now);
    if (err) return w.sys(p, err);
    targetId = cur.id;
  }
  p.intent = { type: 'skill', skill: def, targetId, force };
}

export function processSkillIntent(w: World, p: Player, it: Extract<Intent, { type: 'skill' }>, dt: number, now: number) {
  const def = it.skill;
  const t = w.ents.get(it.targetId);
  if (!t || t.dead || !(t instanceof Player || t instanceof Mob) || (def.target === 'enemy' && canAttack(w, p, t, it.force, now))) {
    p.intent = null;
    p.moving = false;
    return;
  }
  const range = def.range + t.radius;
  if (t !== p && dist(p, t) > range) {
    w.stepToward(p, t.x, t.z, p.stats.speed, dt, Math.max(0.5, range - 0.4));
    return;
  }
  p.moving = false;
  if (t !== p) face(p, t);
  if ((p.cooldowns.get(def.id) ?? 0) > now || p.mp < def.mp) {
    p.intent = null;
    return;
  }
  p.mp -= def.mp;
  p.cooldowns.set(def.id, now + def.cooldown);
  p.send({ t: 'cd', key: def.id, ms: def.cooldown });
  const dur = Math.round(def.cast * p.stats.castMul);
  p.casting = { skill: def, targetId: t.id, end: now + dur };
  w.sendNear(p.x, p.z, { t: 'cast', s: p.id, tg: t.id, skill: def.id, dur });
  p.intent = def.target === 'enemy' && p.cls === 'fighter' ? { type: 'attack', id: t.id, force: it.force } : null;
}

export function finishCast(w: World, p: Player, now: number) {
  const { skill: def, targetId } = p.casting!;
  p.casting = null;
  const t = w.ents.get(targetId);
  if (!t || t.dead || !(t instanceof Player || t instanceof Mob)) return;
  w.sendNear(p.x, p.z, { t: 'fx', s: p.id, tg: t.id, skill: def.id });

  switch (def.kind) {
    case 'phys':
    case 'magic':
    case 'drain': {
      const targets: Fighter[] = [t];
      if (def.aoe) {
        const c = def.aoeOnSelf ? p : t;
        for (const e of w.near(c.x, c.z, def.aoe)) if (e instanceof Mob && !e.dead && e !== t) targets.push(e);
      }
      for (const tg of targets) {
        const d = defStats(tg);
        let dmg: number;
        if (def.kind === 'phys') {
          if (Math.random() > hitChance(p.stats.accuracy + 10, d.evasion)) {
            sendMiss(p, tg);
            continue;
          }
          const crit = Math.random() * 100 < p.stats.crit;
          dmg = physDamage(p.stats.pAtk, d.pDef, def.power, crit);
          applyDamage(w, p, tg, dmg, now, crit);
        } else {
          const crit = Math.random() < 0.05;
          dmg = magicDamage(p.stats.mAtk, d.mDef, def.power, crit);
          applyDamage(w, p, tg, dmg, now, crit);
          if (def.kind === 'drain' && !p.dead) {
            const heal = Math.round(dmg * 0.5);
            p.hp = Math.min(p.stats.maxHp, p.hp + heal);
            p.send({ t: 'dmg', s: p.id, tg: p.id, v: heal, heal: true });
          }
        }
      }
      break;
    }
    case 'heal': {
      const amount = Math.round(def.power * (1 + p.stats.mAtk / 100));
      const before = t.hp;
      t.hp = Math.min(t.stats.maxHp, t.hp + amount);
      const msg = { t: 'dmg' as const, s: p.id, tg: t.id, v: Math.round(t.hp - before), heal: true };
      p.send(msg);
      if (t instanceof Player && t !== p) t.send(msg);
      break;
    }
    case 'buff': {
      if (!(t instanceof Player) || !def.buff) break;
      t.buffs = t.buffs.filter((b) => b.id !== def.id);
      t.buffs.push({ id: def.id, until: now + def.buff.dur, mods: def.buff.mods });
      t.recalc();
      w.sys(t, `${def.name} has been applied.`);
      break;
    }
  }
}
