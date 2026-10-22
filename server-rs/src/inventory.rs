//! Items: bag, equipment, consumables, shops, teleports, loot (port of server/src/systems/inventory.ts).
use crate::data::d;
use crate::ent::*;
use crate::formulas::{jround, rnd};
use crate::i18n::{item_name, npc_greeting, npc_lines, npc_title, teleport_name, trs};
use crate::world::World;
use serde_json::{json, Value};
use std::collections::HashSet;

pub(crate) const INV_MAX: usize = 80;
const NPC_RANGE: f64 = 8.0;
const AUTOLOOT_RANGE: f64 = 40.0;

fn qty_prefix(n: i64) -> String { if n > 1 { format!("{n} × ") } else { String::new() } }

pub fn add_item(p: &mut Player, item: &str, count: i64) -> bool {
    let Some(def) = d().item(item) else { return false };
    if count <= 0 { return false; }
    if item == "adena" {
        p.adena += count;
        p.inv_dirty = true;
        return true;
    }
    if def.stack.unwrap_or(false) {
        if let Some(ex) = p.inv.iter_mut().find(|i| i.i == item && i.s.is_none()) {
            ex.c += count;
        } else {
            if p.inv.len() >= INV_MAX { return false; }
            let u = p.next_uid;
            p.next_uid += 1;
            p.inv.push(InvItem { u, i: item.into(), c: count, s: None, e: 0, l: false, m: false });
        }
    } else {
        if p.inv.len() + count as usize > INV_MAX { return false; }
        for _ in 0..count {
            let u = p.next_uid;
            p.next_uid += 1;
            p.inv.push(InvItem { u, i: item.into(), c: 1, s: None, e: 0, l: false, m: false });
        }
    }
    p.inv_dirty = true;
    true
}

pub fn count_item(p: &Player, item: &str) -> i64 { p.inv.iter().filter(|i| i.i == item && i.s.is_none()).map(|i| i.c).sum() }

/** Which of the bag's scrolls of `kind` enchants a piece of `grade`: one made for that grade first, else a plain one; a
 * scroll made for another grade never (the Grieta de las Brasas' C-grade scrolls). Err(Some(g)): the bag only holds
 * scrolls of that kind for grade g. */
pub fn pick_scroll<'a>(scrolls: impl Iterator<Item = &'a crate::data::ItemDef>, kind: &str, grade: Option<&str>) -> Result<&'a crate::data::ItemDef, Option<&'a str>> {
    let (mut plain, mut other) = (None, None);
    for s in scrolls {
        if s.enchant.as_deref() != Some(kind) { continue; }
        match s.grade.as_deref() {
            None => plain = plain.or(Some(s)),
            g if g == grade => return Ok(s),
            g => other = other.or(g),
        }
    }
    plain.ok_or(other)
}

/** A recipe's materials in a bag: gear only as it came (+0, neither Masterwork nor a legacy piece: a blacksmith never
 * melts down an enchanted sword to join a pair), anything else whatever it is. */
pub fn count_mat_in(inv: &[InvItem], item: &str) -> i64 {
    let gear = d().item(item).is_some_and(|i| i.slot.is_some());
    inv.iter().filter(|i| i.i == item && i.s.is_none() && (!gear || (i.e == 0 && !i.l && !i.m))).map(|i| i.c).sum()
}
/** Takes `count` of a recipe's gear material out of a bag, only pieces as they came (count_mat_in). */
pub fn take_gear_in(inv: &mut Vec<InvItem>, item: &str, count: i64) -> bool {
    if count_mat_in(inv, item) < count { return false; }
    let mut left = count;
    let mut i = inv.len();
    while i > 0 && left > 0 {
        i -= 1;
        let it = &inv[i];
        if it.i != item || it.s.is_some() || it.e != 0 || it.l || it.m { continue; }
        inv.remove(i);
        left -= 1;
    }
    true
}
pub fn count_mat(p: &Player, item: &str) -> i64 { count_mat_in(&p.inv, item) }
pub fn take_mat(p: &mut Player, item: &str, count: i64) -> bool {
    if d().item(item).is_some_and(|i| i.slot.is_some()) { take_gear_in(&mut p.inv, item, count) } else { take_items(p, item, count) }
}

pub fn take_items(p: &mut Player, item: &str, count: i64) -> bool {
    if count_item(p, item) < count { return false; }
    let mut left = count;
    let mut i = p.inv.len();
    while i > 0 && left > 0 {
        i -= 1;
        if p.inv[i].i != item || p.inv[i].s.is_some() { continue; }
        let take = p.inv[i].c.min(left);
        p.inv[i].c -= take;
        left -= take;
        if p.inv[i].c <= 0 { p.inv.remove(i); }
    }
    p.inv_dirty = true;
    true
}

fn consume(p: &mut Player, uid: u32, count: i64) {
    let Some(idx) = p.inv.iter().position(|i| i.u == uid) else { return };
    p.inv[idx].c -= count;
    if p.inv[idx].c <= 0 { p.inv.remove(idx); }
    p.inv_dirty = true;
}

impl World {
    pub fn equip(&mut self, pid: u32, uid: u32) {
        if self.ents[&pid].c.dead { return; }
        let p = self.pl_mut(pid).unwrap();
        let Some(it) = p.inv.iter().find(|i| i.u == uid) else { return };
        let def = d().item(&it.i).unwrap();
        let Some(slot) = def.slot.clone() else { return };
        if it.s.is_some() { return; }
        let need = d().wear_level(def);
        if p.level < need && !it.l {
            let g = def.grade.clone().unwrap_or_default();
            return self.sys(pid, &format!("Necesitás nivel {need} para usar equipo de grado {g}."), &format!("You need level {need} to wear {g} grade gear."));
        }
        // a shield and a weapon held in both hands do not go together: the one put on takes the other off
        let two_handed = |id: &str| d().item(id).and_then(|w| w.two_handed).unwrap_or(false);
        let (other, clash) = match slot.as_str() {
            "shield" => ("weapon", p.equipped_in("weapon").is_some_and(|w| two_handed(&w.i))),
            "weapon" => ("shield", def.two_handed.unwrap_or(false) && p.equipped_in("shield").is_some()),
            _ => ("", false),
        };
        let off = if clash { p.equipped_in(other).and_then(|i| d().item(&i.i)) } else { None };
        for i in p.inv.iter_mut() {
            if i.s.as_deref() == Some(&slot) || (clash && i.s.as_deref() == Some(other)) { i.s = None; }
        }
        if let Some(i) = p.inv.iter_mut().find(|i| i.u == uid) { i.s = Some(slot); }
        p.recalc();
        p.inv_dirty = true;
        self.ents.get_mut(&pid).unwrap().c.av += 1;
        if let Some(o) = off {
            self.sys(pid, &format!("Te sacaste {}: un escudo no va con un arma a dos manos.", o.name),
                     &format!("You took off {}: a shield does not go with a two-handed weapon.", o.name_en));
        }
        self.sys(pid, &format!("Te equipaste {}.", def.name), &format!("You equipped {}.", def.name_en));
    }

    pub fn unequip(&mut self, pid: u32, slot: &str) {
        let p = self.pl_mut(pid).unwrap();
        let Some(it) = p.inv.iter_mut().find(|i| i.s.as_deref() == Some(slot)) else { return };
        it.s = None;
        let item = it.i.clone();
        p.recalc();
        p.inv_dirty = true;
        self.ents.get_mut(&pid).unwrap().c.av += 1;
        let def = d().item(&item).unwrap();
        self.sys(pid, &format!("Te sacaste {}.", def.name), &format!("You unequipped {}.", def.name_en));
    }

    pub fn use_item(&mut self, pid: u32, uid: u32, now: f64) {
        if self.ents[&pid].c.dead { return; }
        let p = self.pl(pid).unwrap();
        let Some(it) = p.inv.iter().find(|i| i.u == uid) else { return };
        let def = d().item(&it.i).unwrap();
        if def.slot.is_some() {
            return match it.s.clone() { Some(s) => self.unequip(pid, &s), None => self.equip(pid, uid) };
        }
        let Some(u) = &def.use_ else { return };
        let key = format!("item:{}", def.id);
        if p.cooldowns.get(&key).copied().unwrap_or(0.0) > now {
            return self.sys(pid, &format!("{} todavía no está lista.", def.name), &format!("{} is not ready yet.", def.name_en));
        }
        if u.escape.unwrap_or(false) {
            if p.escape_at > 0.0 { return; }
            self.pl_mut(pid).unwrap().escape_at = now + 3000.0;
            self.sys(pid, "En 3 segundos volvés a la aldea...", "You will be returned to the village in 3 seconds...");
        }
        let wound = self.ents[&pid].c.heal_mul(now);
        let p = self.pl_mut(pid).unwrap();
        if let Some(hp) = u.hp {
            let before = p.hp;
            p.hp = (p.hp + hp * wound).min(p.stats.max_hp);
            p.send(json!({ "t": "dmg", "s": pid, "tg": pid, "v": jround(p.hp - before), "heal": true }));
        }
        if let Some(mp) = u.mp {
            p.mp = (p.mp + mp).min(p.stats.max_mp);
            self.sys(pid, &format!("Recuperaste {mp} de MP."), &format!("{mp} MP has been restored."));
        }
        let p = self.pl_mut(pid).unwrap();
        p.cooldowns.insert(key.clone(), now + u.cd);
        p.send(json!({ "t": "cd", "key": key, "ms": u.cd }));
        consume(p, uid, 1);
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "fx", "s": pid, "tg": pid, "skill": if u.escape.unwrap_or(false) { "escape" } else { "potion" } }));
    }

    pub fn destroy_item(&mut self, pid: u32, uid: u32) {
        let p = self.pl_mut(pid).unwrap();
        let Some(it) = p.inv.iter().find(|i| i.u == uid).cloned() else { return };
        if it.s.is_some() { return; }
        consume(p, uid, it.c);
        let def = d().item(&it.i).unwrap();
        self.sys(pid, &format!("Destruiste {}.", def.name), &format!("{} has been destroyed.", def.name_en));
    }

    /// Spend a matching scroll from the bag on a piece of gear: +1, or the piece is lost (see ENCHANT in the data). A
    /// sacred scroll works on any piece and never fails; a graded one only on its own grade (pick_scroll).
    pub fn enchant(&mut self, pid: u32, uid: u32, sacred: bool) {
        if self.ents[&pid].c.dead { return; }
        let data = d();
        let cfg = &data.enchant;
        let p = self.pl_mut(pid).unwrap();
        let Some(it) = p.inv.iter().find(|i| i.u == uid) else { return };
        let (def, e) = (data.item(&it.i).unwrap(), it.e);
        if def.slot.is_none() { return; }
        let kind = if def.kind == "weapon" { "weapon" } else { "armor" };
        if e >= cfg.max { return self.sys(pid, "Ese objeto ya no se puede encantar más.", "That item cannot be enchanted any further."); }
        let wanted = if sacred { "sacred" } else { kind };
        let scroll = match pick_scroll(data.items.values().filter(|s| count_item(p, &s.id) > 0), wanted, def.grade.as_deref()) {
            Ok(s) => s,
            Err(_) if sacred => return self.sys(pid, "No tenés un pergamino sagrado.", "You have no sacred scroll."),
            Err(Some(g)) => return self.sys(pid, &format!("Tu pergamino solo encanta equipo de grado {g}."), &format!("Your scroll only enchants {g}-grade gear.")),
            Err(None) => return self.sys(pid, "No tenés un pergamino para encantar eso.", "You have no scroll to enchant that."),
        };
        take_items(p, &scroll.id, 1);
        let ok = crate::formulas::enchant_roll(e, sacred, rnd());
        // the scroll's row may be gone: look the piece up again
        let idx = p.inv.iter().position(|i| i.u == uid).unwrap();
        let worn = p.inv[idx].s.is_some();
        let weapon = p.inv[idx].s.as_deref() == Some("weapon");
        if ok { p.inv[idx].e += 1; } else if cfg.fail_destroys { p.inv.remove(idx); } else { p.inv[idx].e = 0; }
        p.recalc();
        p.inv_dirty = true;
        // a worn piece crumbling, or the held weapon's glow growing (enchant-fx.ts): everyone redraws the character
        if (worn && !ok && cfg.fail_destroys) || (weapon && ok) { self.ents.get_mut(&pid).unwrap().c.av += 1; }
        let n = e + 1;
        if ok && sacred {
            self.sys(pid, &format!("¡Éxito sagrado! {} ahora es +{n}.", def.name), &format!("Sacred success! {} is now +{n}.", def.name_en));
        } else if ok {
            self.sys(pid, &format!("¡Éxito! {} ahora es +{n}.", def.name), &format!("Success! {} is now +{n}.", def.name_en));
        } else if cfg.fail_destroys {
            self.sys(pid, &format!("El encantamiento falló: {} +{e} se hizo polvo.", def.name), &format!("The enchantment failed: {} +{e} crumbled to dust.", def.name_en));
        } else {
            self.sys(pid, &format!("El encantamiento falló: {} volvió a +0.", def.name), &format!("The enchantment failed: {} is back to +0.", def.name_en));
        }
    }

    pub(crate) fn npc_in_range(&self, pid: u32, nid: u32) -> Option<&'static crate::data::NpcDef> {
        let pc = &self.ents[&pid].c;
        match self.ents.get(&nid) {
            Some(Ent { c, k: Kind::Npc(n) }) if (c.x - pc.x).hypot(c.z - pc.z) <= NPC_RANGE => Some(n.def),
            _ => {
                self.sys(pid, "Estás muy lejos del vendedor.", "You are too far from the merchant.");
                None
            }
        }
    }

    pub fn open_npc(&mut self, pid: u32, nid: u32) {
        let Some(Kind::Npc(n)) = self.ents.get(&nid).map(|e| &e.k) else { return };
        let def = n.def;
        let p = self.pl_mut(pid).unwrap();
        p.talking_to = Some(nid);
        let l = p.lang;
        let greeting = if def.kind == "talker" {
            let lines = npc_lines(&def.id, l);
            if lines.is_empty() { String::new() } else { lines[((rnd() * lines.len() as f64) as usize).min(lines.len() - 1)].clone() }
        } else { npc_greeting(&def.id, l) };
        let mut msg = json!({ "t": "npc", "npc": nid, "kind": def.kind, "name": def.name, "title": npc_title(&def.id, l), "greeting": greeting });
        if let Some(shop) = &def.shop { msg["shop"] = json!(shop); }
        if let Some(craft) = &def.craft { msg["craft"] = json!(craft); }
        if def.kind == "gatekeeper" {
            let dests: Vec<Value> = d().teleports.iter().map(|t| json!({ "id": t.id, "name": teleport_name(&t.id, l), "cost": t.cost })).collect();
            msg["dests"] = json!(dests);
        }
        p.send(msg);
    }

    pub fn buy(&mut self, pid: u32, nid: u32, item: &str, qty: f64) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if n.kind != "shop" || !n.shop.as_ref().map_or(false, |s| s.iter().any(|x| x == item)) { return; }
        let Some(def) = d().item(item) else { return };
        let qty = qty.floor();
        if !(qty >= 1.0) || qty > if def.stack.unwrap_or(false) { 999.0 } else { 10.0 } { return; }
        let qty = qty as i64;
        let cost = def.price * qty;
        let p = self.pl_mut(pid).unwrap();
        if p.adena < cost { return self.sys(pid, "No te alcanza la adena.", "You do not have enough adena."); }
        if !add_item(p, item, qty) { return self.sys(pid, "Tenés el inventario lleno.", "Your inventory is full."); }
        p.adena -= cost;
        p.inv_dirty = true;
        self.sys(pid, &format!("Compraste {}{} por {cost} de adena.", qty_prefix(qty), def.name), &format!("You bought {}{} for {cost} adena.", qty_prefix(qty), def.name_en));
    }

    /// A merchant makes one of the items it lists in `craft`: the recipe's materials and adena for the piece.
    pub fn craft(&mut self, pid: u32, nid: u32, item: &str) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if !n.craft.as_ref().map_or(false, |c| c.iter().any(|x| x == item)) { return; }
        let Some((def, rec)) = d().item(item).and_then(|i| Some((i, i.craft.as_ref()?))) else { return };
        let p = self.pl_mut(pid).unwrap();
        if p.adena < rec.adena { return self.sys(pid, "No te alcanza la adena.", "You do not have enough adena."); }
        if rec.mats.iter().any(|(m, c)| count_mat(p, m) < *c) {
            return self.sys(pid, "Te faltan materiales (las armas tienen que estar en +0).", "You are missing materials (weapons must be +0).");
        }
        // the piece goes in first: a full bag must not eat the materials
        if !add_item(p, item, 1) { return self.sys(pid, "Tenés el inventario lleno.", "Your inventory is full."); }
        for (m, c) in &rec.mats { take_mat(p, m, *c); }
        p.adena -= rec.adena;
        p.inv_dirty = true;
        // gear sometimes comes out a Masterwork when a dwarf has it made (MASTERWORK: never for anyone else); gear never stacks, so it is the
        // row add_item just pushed
        let mw = &d().masterwork;
        if def.slot.is_some() && rnd() < if p.race == "dwarf" { mw.dwarf_chance } else { mw.chance } {
            p.inv.last_mut().unwrap().m = true;
            self.send(pid, json!({ "t": "masterwork", "item": item }));
            return self.sys(pid, &format!("¡Obra Maestra! Te fabricaron {} (Obra Maestra).", def.name), &format!("Masterwork! {} (Masterwork) was made for you.", def.name_en));
        }
        self.sys(pid, &format!("Te fabricaron {}.", def.name), &format!("{} was made for you.", def.name_en));
    }

    pub fn sell(&mut self, pid: u32, nid: u32, uid: u32, qty: f64) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if n.kind != "shop" { return; }
        let qty = qty.floor();
        let p = self.pl_mut(pid).unwrap();
        let Some(it) = p.inv.iter().find(|i| i.u == uid).cloned() else { return };
        if it.s.is_some() || !(qty >= 1.0) || qty as i64 > it.c { return; }
        let qty = qty as i64;
        let def = d().item(&it.i).unwrap();
        let gain = (def.price / 2) * qty;
        consume(p, uid, qty);
        p.adena += gain;
        self.sys(pid, &format!("Vendiste {}{} por {gain} de adena.", qty_prefix(qty), def.name), &format!("You sold {}{} for {gain} adena.", qty_prefix(qty), def.name_en));
    }

    pub fn gatekeeper(&mut self, pid: u32, nid: u32, dest: &str) {
        let Some(n) = self.npc_in_range(pid, nid) else { return };
        if n.kind != "gatekeeper" || self.ents[&pid].c.dead { return; }
        let Some(tp) = d().teleports.iter().find(|t| t.id == dest) else { return };
        let p = self.pl_mut(pid).unwrap();
        if p.adena < tp.cost { return self.sys(pid, "No te alcanza la adena.", "You do not have enough adena."); }
        p.adena -= tp.cost;
        p.inv_dirty = true;
        self.teleport(pid, tp.x + (rnd() - 0.5) * 6.0, tp.z + (rnd() - 0.5) * 6.0);
    }

    pub fn spawn_ground(&mut self, x: f64, z: f64, item: &str, count: i64, owners: Option<HashSet<u32>>, now: f64) -> u32 {
        let (a, r) = (rnd() * std::f64::consts::TAU, 0.5 + rnd() * 1.5);
        let id = self.new_id();
        let mut c = Common::new(id, x + a.cos() * r, z + a.sin() * r);
        c.ry = rnd() * std::f64::consts::TAU;
        self.add(Ent { c, k: Kind::Item(GroundItem { item: item.into(), count, enchant: 0, legacy: false, mw: false, owners, owner_until: now + 15000.0, expire_at: now + 60000.0, camp_id: None }) });
        id
    }

    /** A random nearby owner with auto-loot on, who receives the drop directly. */
    fn auto_looter(&self, mx: f64, mz: f64, owners: &HashSet<u32>) -> Option<u32> {
        let ps: Vec<u32> = owners.iter().copied().filter(|id| {
            self.ents.get(id).map_or(false, |e| e.player().map_or(false, |p| p.auto_loot) && !e.c.dead && (e.c.x - mx).hypot(e.c.z - mz) <= AUTOLOOT_RANGE)
        }).collect();
        if ps.is_empty() { None } else { Some(ps[((rnd() * ps.len() as f64) as usize).min(ps.len() - 1)]) }
    }

    /** Roll a camp chest's loot straight into the opener's bag (overflow drops at their feet). */
    fn open_chest(&mut self, pid: u32, gid: u32, now: f64) {
        let Some(Ent { k: Kind::Item(g), .. }) = self.remove(gid) else { return };
        let Some(camp) = g.camp_id.as_deref().and_then(|c| d().camp(c)) else { return };
        let l = self.pl(pid).unwrap().lang;
        let mut got: Vec<String> = vec![];
        let (amin, amax) = camp.chest.adena;
        let adena = jround(amin + rnd() * (amax - amin)) as i64;
        self.pl_mut(pid).unwrap().adena += adena;
        got.push(trs(l, format!("{adena} de adena"), format!("{adena} adena")));
        for lt in &camp.chest.loot {
            if rnd() >= lt.chance { continue; }
            let (min, max) = (lt.min.unwrap_or(1), lt.max.unwrap_or(1));
            let count = min + (rnd() * (max - min + 1) as f64).floor() as i64;
            if add_item(self.pl_mut(pid).unwrap(), &lt.item, count) {
                got.push(format!("{}{}", qty_prefix(count), item_name(&lt.item, l)));
            } else {
                let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
                self.spawn_ground(x, z, &lt.item, count, Some([pid].into_iter().collect()), now);
            }
        }
        self.pl_mut(pid).unwrap().inv_dirty = true;
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        self.send_near(x, z, json!({ "t": "fx", "s": pid, "tg": pid, "skill": "chest" }));
        let list = got.join(", ");
        self.sys(pid, &format!("Abriste el cofre de {}: {list}.", camp.name), &format!("You opened the {} chest: {list}.", camp.name_en));
    }

    pub fn drop_loot(&mut self, mid: u32, owners: &HashSet<u32>, now: f64) {
        let (mx, mz, tpl) = { let e = &self.ents[&mid]; (e.c.x, e.c.z, e.mob().unwrap().tpl) };
        // auto-loot goes through the normal pickup, so a full bag leaves the item on the ground
        let drop = |w: &mut World, item: &str, count: i64| {
            let gid = w.spawn_ground(mx, mz, item, count, Some(owners.clone()), now);
            if let Some(p) = w.auto_looter(mx, mz, owners) { w.pickup(p, gid, now); }
        };
        let (amin, amax) = tpl.adena;
        drop(self, "adena", jround(amin + rnd() * (amax - amin)) as i64);
        for dr in &tpl.drops {
            if rnd() >= dr.chance { continue; }
            let (min, max) = (dr.min.unwrap_or(1), dr.max.unwrap_or(1));
            drop(self, &dr.item, min + (rnd() * (max - min + 1) as f64).floor() as i64);
        }
    }

    pub fn drop_from_player(&mut self, pid: u32, now: f64) {
        let p = self.pl_mut(pid).unwrap();
        if p.inv.is_empty() { return; }
        let idx = ((rnd() * p.inv.len() as f64) as usize).min(p.inv.len() - 1);
        let it = p.inv.remove(idx);
        if it.s.is_some() { p.recalc(); }
        p.inv_dirty = true;
        if it.s.is_some() { self.ents.get_mut(&pid).unwrap().c.av += 1; }
        let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
        let gid = self.spawn_ground(x, z, &it.i, it.c, None, now);
        if let Some(Ent { k: Kind::Item(g), .. }) = self.ents.get_mut(&gid) { (g.enchant, g.legacy, g.mw) = (it.e, it.l, it.m); }
        let def = d().item(&it.i).unwrap();
        let (mw, mw_en) = if it.m { (" (Obra Maestra)", " (Masterwork)") } else { ("", "") };
        self.sys(pid, &format!("¡Al morir se te cayó {}{mw}!", def.name), &format!("You dropped {}{mw_en} upon death!", def.name_en));
    }

    pub fn pickup(&mut self, pid: u32, gid: u32, now: f64) {
        let Some(Ent { k: Kind::Item(g), .. }) = self.ents.get(&gid) else { return };
        if let Some(o) = &g.owners {
            if now < g.owner_until && !o.contains(&pid) { return self.sys(pid, "Ese objeto es de otra persona.", "That item belongs to someone else."); }
        }
        if g.item == "camp_chest" { return self.open_chest(pid, gid, now); }
        let (item, count, enchant, legacy, mw) = (g.item.clone(), g.count, g.enchant, g.legacy, g.mw);
        let p = self.pl_mut(pid).unwrap();
        if !add_item(p, &item, count) { return self.sys(pid, "Tenés el inventario lleno.", "Your inventory is full."); }
        // a marked piece is gear, which never stacks, so it is the row add_item just pushed
        if enchant > 0 || legacy || mw {
            let it = p.inv.last_mut().unwrap();
            (it.e, it.l, it.m) = (enchant, legacy, mw);
        }
        self.remove(gid);
        let def = d().item(&item).unwrap();
        if item == "adena" {
            self.sys(pid, &format!("Juntaste {count} de adena."), &format!("You picked up {count} adena."));
        } else {
            let (m, m_en) = if mw { (" (Obra Maestra)", " (Masterwork)") } else { ("", "") };
            self.sys(pid, &format!("Conseguiste {}{}{m}.", qty_prefix(count), def.name), &format!("You obtained {}{}{m_en}.", qty_prefix(count), def.name_en));
        }
    }
}
