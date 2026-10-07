import { ITEMS, SLOTS, type Slot } from '../../../shared/src/data/items';
import { randomLine, TELEPORTS } from '../../../shared/src/data/world';
import { GroundItem, Mob, Npc, Player } from '../world/entities';
import { dist, type World } from '../world/World';

const INV_MAX = 80;
const NPC_RANGE = 8;

export function addItem(p: Player, itemId: string, count: number): boolean {
  const def = ITEMS[itemId];
  if (!def || count <= 0) return false;
  if (itemId === 'adena') {
    p.adena += count;
    p.invDirty = true;
    return true;
  }
  if (def.stack) {
    const ex = p.inv.find((i) => i.i === itemId && !i.s);
    if (ex) ex.c += count;
    else {
      if (p.inv.length >= INV_MAX) return false;
      p.inv.push({ u: p.nextUid++, i: itemId, c: count, s: null });
    }
  } else {
    if (p.inv.length + count > INV_MAX) return false;
    for (let n = 0; n < count; n++) p.inv.push({ u: p.nextUid++, i: itemId, c: 1, s: null });
  }
  p.invDirty = true;
  return true;
}

function consume(p: Player, uid: number, count: number) {
  const idx = p.inv.findIndex((i) => i.u === uid);
  if (idx < 0) return;
  p.inv[idx].c -= count;
  if (p.inv[idx].c <= 0) p.inv.splice(idx, 1);
  p.invDirty = true;
}

export function equip(w: World, p: Player, uid: number) {
  const it = p.inv.find((i) => i.u === uid);
  if (!it || p.dead) return;
  const def = ITEMS[it.i];
  if (!def.slot) return;
  if (it.s) return;
  const cur = p.equippedIn(def.slot);
  if (cur) cur.s = null;
  it.s = def.slot;
  p.recalc();
  p.av++;
  p.invDirty = true;
  w.sys(p, `You equipped ${def.name}.`);
}

export function unequip(w: World, p: Player, slot: Slot) {
  if (!SLOTS.includes(slot)) return;
  const cur = p.equippedIn(slot);
  if (!cur) return;
  cur.s = null;
  p.recalc();
  p.av++;
  p.invDirty = true;
  w.sys(p, `You unequipped ${ITEMS[cur.i].name}.`);
}

export function useItem(w: World, p: Player, uid: number, now: number) {
  const it = p.inv.find((i) => i.u === uid);
  if (!it || p.dead) return;
  const def = ITEMS[it.i];
  if (def.slot) return it.s ? unequip(w, p, it.s) : equip(w, p, uid);
  if (!def.use) return;
  const key = `item:${def.id}`;
  if ((p.cooldowns.get(key) ?? 0) > now) return w.sys(p, `${def.name} is not ready yet.`);
  if (def.use.escape) {
    if (p.escapeAt) return;
    p.escapeAt = now + 3000;
    w.sys(p, 'You will be returned to the village in 3 seconds...');
  }
  if (def.use.hp) {
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + def.use.hp);
    p.send({ t: 'dmg', s: p.id, tg: p.id, v: Math.round(p.hp - before), heal: true });
  }
  if (def.use.mp) {
    p.mp = Math.min(p.stats.maxMp, p.mp + def.use.mp);
    w.sys(p, `${def.use.mp} MP has been restored.`);
  }
  p.cooldowns.set(key, now + def.use.cd);
  p.send({ t: 'cd', key, ms: def.use.cd });
  w.sendNear(p.x, p.z, { t: 'fx', s: p.id, tg: p.id, skill: def.use.escape ? 'escape' : 'potion' });
  consume(p, uid, 1);
}

export function destroyItem(w: World, p: Player, uid: number) {
  const it = p.inv.find((i) => i.u === uid);
  if (!it || it.s) return;
  consume(p, uid, it.c);
  w.sys(p, `${ITEMS[it.i].name} has been destroyed.`);
}

function npcInRange(w: World, p: Player, npcId: number): Npc | null {
  const n = w.ents.get(npcId);
  if (!(n instanceof Npc) || dist(n, p) > NPC_RANGE) {
    w.sys(p, 'You are too far from the merchant.');
    return null;
  }
  return n;
}

export function openNpc(w: World, p: Player, n: Npc) {
  p.talkingTo = n.id;
  const d = n.def;
  p.send({
    t: 'npc', npc: n.id, kind: d.kind, name: d.name, title: d.title, greeting: d.kind === 'talker' ? randomLine(d) : d.greeting, shop: d.shop,
    dests: d.kind === 'gatekeeper' ? TELEPORTS.map((t) => ({ id: t.id, name: t.name, cost: t.cost })) : undefined,
  });
}

export function buy(w: World, p: Player, npcId: number, itemId: string, qty: number) {
  const n = npcInRange(w, p, npcId);
  if (!n || n.def.kind !== 'shop' || !n.def.shop?.includes(itemId)) return;
  const def = ITEMS[itemId];
  if (!def || !(qty >= 1) || qty > (def.stack ? 999 : 10)) return;
  const cost = def.price * qty;
  if (p.adena < cost) return w.sys(p, 'You do not have enough adena.');
  if (!addItem(p, itemId, qty)) return w.sys(p, 'Your inventory is full.');
  p.adena -= cost;
  p.invDirty = true;
  w.sys(p, `You bought ${qty > 1 ? qty + ' ' : ''}${def.name} for ${cost} adena.`);
}

export function sell(w: World, p: Player, npcId: number, uid: number, qty: number) {
  const n = npcInRange(w, p, npcId);
  if (!n || n.def.kind !== 'shop') return;
  const it = p.inv.find((i) => i.u === uid);
  if (!it || it.s || !(qty >= 1) || qty > it.c) return;
  const def = ITEMS[it.i];
  const gain = Math.floor(def.price / 2) * qty;
  consume(p, uid, qty);
  p.adena += gain;
  w.sys(p, `You sold ${qty > 1 ? qty + ' ' : ''}${def.name} for ${gain} adena.`);
}

export function gatekeeper(w: World, p: Player, npcId: number, dest: string) {
  const n = npcInRange(w, p, npcId);
  if (!n || n.def.kind !== 'gatekeeper' || p.dead) return;
  const tp = TELEPORTS.find((t) => t.id === dest);
  if (!tp) return;
  if (p.adena < tp.cost) return w.sys(p, 'You do not have enough adena.');
  p.adena -= tp.cost;
  p.invDirty = true;
  w.teleport(p, tp.x + (Math.random() - 0.5) * 6, tp.z + (Math.random() - 0.5) * 6);
}

function spawnGround(w: World, x: number, z: number, itemId: string, count: number, owners: Set<number> | null, now: number) {
  const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.5;
  const gi = new GroundItem(w.newId(), x + Math.cos(a) * r, z + Math.sin(a) * r, itemId, count, owners, now + 15000, now + 60000);
  w.add(gi);
}

export function dropLoot(w: World, m: Mob, owners: Set<number>, now: number) {
  const [amin, amax] = m.tpl.adena;
  spawnGround(w, m.x, m.z, 'adena', Math.round(amin + Math.random() * (amax - amin)), owners, now);
  for (const d of m.tpl.drops) {
    if (Math.random() >= d.chance) continue;
    const min = d.min ?? 1, max = d.max ?? 1;
    spawnGround(w, m.x, m.z, d.item, min + Math.floor(Math.random() * (max - min + 1)), owners, now);
  }
}

export function dropFromPlayer(w: World, p: Player, now: number) {
  if (!p.inv.length) return;
  const it = p.inv[Math.floor(Math.random() * p.inv.length)];
  p.inv = p.inv.filter((i) => i !== it);
  if (it.s) {
    p.recalc();
    p.av++;
  }
  p.invDirty = true;
  spawnGround(w, p.x, p.z, it.i, it.c, null, now);
  w.sys(p, `You dropped ${ITEMS[it.i].name} upon death!`);
}

export function pickup(w: World, p: Player, gi: GroundItem, now: number) {
  if (!w.ents.has(gi.id)) return;
  if (gi.owners && now < gi.ownerUntil && !gi.owners.has(p.id)) return w.sys(p, 'That item belongs to someone else.');
  const def = ITEMS[gi.itemId];
  if (!addItem(p, gi.itemId, gi.count)) return w.sys(p, 'Your inventory is full.');
  w.remove(gi);
  w.sys(p, gi.itemId === 'adena' ? `You picked up ${gi.count} adena.` : `You obtained ${gi.count > 1 ? gi.count + ' ' : ''}${def.name}.`);
}
