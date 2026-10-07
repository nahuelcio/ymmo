import { ITEMS, SLOTS, type Slot } from '../../../shared/src/data/items';
import { randomLine, TELEPORTS } from '../../../shared/src/data/world';
import { CAMP_BY_ID } from '../../../shared/src/data/camps';
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

export function countItem(p: Player, itemId: string): number {
  let n = 0;
  for (const it of p.inv) if (it.i === itemId && !it.s) n += it.c;
  return n;
}

export function takeItems(p: Player, itemId: string, count: number): boolean {
  if (countItem(p, itemId) < count) return false;
  let left = count;
  for (let i = p.inv.length - 1; i >= 0 && left > 0; i--) {
    const it = p.inv[i];
    if (it.i !== itemId || it.s) continue;
    const take = Math.min(it.c, left);
    it.c -= take;
    left -= take;
    if (it.c <= 0) p.inv.splice(i, 1);
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
  w.sys(p, `Te equipaste ${def.name}.`);
}

export function unequip(w: World, p: Player, slot: Slot) {
  if (!SLOTS.includes(slot)) return;
  const cur = p.equippedIn(slot);
  if (!cur) return;
  cur.s = null;
  p.recalc();
  p.av++;
  p.invDirty = true;
  w.sys(p, `Te sacaste ${ITEMS[cur.i].name}.`);
}

export function useItem(w: World, p: Player, uid: number, now: number) {
  const it = p.inv.find((i) => i.u === uid);
  if (!it || p.dead) return;
  const def = ITEMS[it.i];
  if (def.slot) return it.s ? unequip(w, p, it.s) : equip(w, p, uid);
  if (!def.use) return;
  const key = `item:${def.id}`;
  if ((p.cooldowns.get(key) ?? 0) > now) return w.sys(p, `${def.name} todavía no está lista.`);
  if (def.use.escape) {
    if (p.escapeAt) return;
    p.escapeAt = now + 3000;
    w.sys(p, 'En 3 segundos volvés a la aldea...');
  }
  if (def.use.hp) {
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + def.use.hp);
    p.send({ t: 'dmg', s: p.id, tg: p.id, v: Math.round(p.hp - before), heal: true });
  }
  if (def.use.mp) {
    p.mp = Math.min(p.stats.maxMp, p.mp + def.use.mp);
    w.sys(p, `Recuperaste ${def.use.mp} de MP.`);
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
  w.sys(p, `Destruiste ${ITEMS[it.i].name}.`);
}

function npcInRange(w: World, p: Player, npcId: number): Npc | null {
  const n = w.ents.get(npcId);
  if (!(n instanceof Npc) || dist(n, p) > NPC_RANGE) {
    w.sys(p, 'Estás muy lejos del vendedor.');
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
  if (p.adena < cost) return w.sys(p, 'No te alcanza la adena.');
  if (!addItem(p, itemId, qty)) return w.sys(p, 'Tenés el inventario lleno.');
  p.adena -= cost;
  p.invDirty = true;
  w.sys(p, `Compraste ${qty > 1 ? qty + ' × ' : ''}${def.name} por ${cost} de adena.`);
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
  w.sys(p, `Vendiste ${qty > 1 ? qty + ' × ' : ''}${def.name} por ${gain} de adena.`);
}

export function gatekeeper(w: World, p: Player, npcId: number, dest: string) {
  const n = npcInRange(w, p, npcId);
  if (!n || n.def.kind !== 'gatekeeper' || p.dead) return;
  const tp = TELEPORTS.find((t) => t.id === dest);
  if (!tp) return;
  if (p.adena < tp.cost) return w.sys(p, 'No te alcanza la adena.');
  p.adena -= tp.cost;
  p.invDirty = true;
  w.teleport(p, tp.x + (Math.random() - 0.5) * 6, tp.z + (Math.random() - 0.5) * 6);
}

function spawnGround(w: World, x: number, z: number, itemId: string, count: number, owners: Set<number> | null, now: number) {
  const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.5;
  const gi = new GroundItem(w.newId(), x + Math.cos(a) * r, z + Math.sin(a) * r, itemId, count, owners, now + 15000, now + 60000);
  w.add(gi);
  return gi;
}

const AUTOLOOT_RANGE = 40;

/** A random nearby owner with auto-loot on, who receives the drop directly. */
function autoLooter(w: World, m: Mob, owners: Set<number>): Player | null {
  const ps = [...owners]
    .map((id) => w.players.get(id))
    .filter((p): p is Player => !!p && !p.dead && p.autoLoot && Math.hypot(p.x - m.x, p.z - m.z) <= AUTOLOOT_RANGE);
  return ps.length ? ps[Math.floor(Math.random() * ps.length)] : null;
}

/** Roll a camp chest's loot straight into the opener's bag (overflow drops at their feet). */
function openChest(w: World, p: Player, gi: GroundItem, now: number) {
  const camp = gi.campId ? CAMP_BY_ID[gi.campId] : undefined;
  w.remove(gi);
  if (!camp) return;
  const got: string[] = [];
  const give = (item: string, count: number) => {
    if (addItem(p, item, count)) {
      p.invDirty = true;
      got.push(item === 'adena' ? `${count} de adena` : `${count > 1 ? count + ' × ' : ''}${ITEMS[item].name}`);
    } else spawnGround(w, p.x, p.z, item, count, new Set([p.id]), now);
  };
  const [amin, amax] = camp.chest.adena;
  const adena = Math.round(amin + Math.random() * (amax - amin));
  p.adena += adena;
  got.push(`${adena} de adena`);
  for (const l of camp.chest.loot) {
    if (Math.random() >= l.chance) continue;
    const min = l.min ?? 1, max = l.max ?? 1;
    give(l.item, min + Math.floor(Math.random() * (max - min + 1)));
  }
  p.invDirty = true;
  w.sendNear(p.x, p.z, { t: 'fx', s: p.id, tg: p.id, skill: 'chest' });
  w.sys(p, `Abriste el cofre de ${camp.name}: ${got.join(', ')}.`);
}

export function dropLoot(w: World, m: Mob, owners: Set<number>, now: number) {
  // auto-loot goes through the normal pickup, so a full bag leaves the item on the ground
  const drop = (item: string, count: number) => {
    const gi = spawnGround(w, m.x, m.z, item, count, owners, now);
    const p = autoLooter(w, m, owners);
    if (p) pickup(w, p, gi, now);
  };
  const [amin, amax] = m.tpl.adena;
  drop('adena', Math.round(amin + Math.random() * (amax - amin)));
  for (const d of m.tpl.drops) {
    if (Math.random() >= d.chance) continue;
    const min = d.min ?? 1, max = d.max ?? 1;
    drop(d.item, min + Math.floor(Math.random() * (max - min + 1)));
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
  w.sys(p, `¡Al morir se te cayó ${ITEMS[it.i].name}!`);
}

export function pickup(w: World, p: Player, gi: GroundItem, now: number) {
  if (!w.ents.has(gi.id)) return;
  if (gi.owners && now < gi.ownerUntil && !gi.owners.has(p.id)) return w.sys(p, 'Ese objeto es de otra persona.');
  if (gi.itemId === 'camp_chest') return openChest(w, p, gi, now);
  const def = ITEMS[gi.itemId];
  if (!addItem(p, gi.itemId, gi.count)) return w.sys(p, 'Tenés el inventario lleno.');
  w.remove(gi);
  w.sys(p, gi.itemId === 'adena' ? `Juntaste ${gi.count} de adena.` : `Conseguiste ${gi.count > 1 ? gi.count + ' × ' : ''}${def.name}.`);
}
