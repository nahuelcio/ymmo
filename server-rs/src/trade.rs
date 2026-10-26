//! Player trades, as in Lineage 2: one asks (/trade, or the Trade button on the target), the other says yes within
//! REQUEST_MS; both put in items and adena, and nothing put in comes back out (cancel instead). Once either side
//! confirms nothing more goes in, so nobody can swap something in at the last moment. When both have confirmed,
//! everything is checked again (still close, still holding what they offered, room in the bag) and the two sides
//! change hands at once, both saved in one transaction with a line in trade_log.
use crate::data::d;
use crate::db::{CharSave, TradeLog};
use crate::ent::InvItem;
use crate::inventory::{add_item, INV_MAX};
use crate::world::{dist, World};
use serde_json::{json, Value};

/** As far apart as two players may ask, accept and close a trade (the reach for talking to an NPC). */
pub const TRADE_RANGE: f64 = 8.0;
/** How long a trade request waits for its answer (as in L2). */
const REQUEST_MS: f64 = 15000.0;

/** One side of a trade: the bag rows put in (uid, count), the adena, and whether this side has confirmed. */
#[derive(Default)]
pub struct Offer { pub items: Vec<(u32, i64)>, pub adena: i64, pub ok: bool }
pub struct Trade { pub id: u32, pub sides: [u32; 2], pub offers: [Offer; 2] }

type Why = (String, String);
fn why(es: &str, en: &str) -> Option<Why> { Some((es.into(), en.into())) }

/** A stackable with no marks: it joins a stack of its kind instead of taking a row of its own. */
fn stacks(it: &InvItem) -> bool { d().item(&it.i).map_or(false, |def| def.stack.unwrap_or(false)) && it.e == 0 && !it.l && !it.m }

/**
 * How many bag rows `inv` ends with after giving away `gives` (uid, count) and getting `gets` (row, count): a row
 * given whole is gone, a stackable joins a stack that is still there (or the first one that comes in), anything
 * else takes a row each.
 */
pub fn rows_after(inv: &[InvItem], gives: &[(u32, i64)], gets: &[(&InvItem, i64)]) -> usize {
    let gone = |it: &InvItem| gives.iter().any(|&(u, c)| u == it.u && c >= it.c);
    let kept: Vec<&InvItem> = inv.iter().filter(|it| !gone(it)).collect();
    let mut new_stacks: Vec<&str> = vec![];
    let mut add = 0;
    for &(it, _) in gets {
        if !stacks(it) { add += 1; continue; }
        if kept.iter().any(|k| k.i == it.i && k.s.is_none() && stacks(k)) || new_stacks.contains(&it.i.as_str()) { continue; }
        new_stacks.push(&it.i);
        add += 1;
    }
    kept.len() + add
}

impl World {
    /** pid's trade: its index in self.trades and pid's side (0 or 1). */
    fn trade_of(&self, pid: u32) -> Option<(usize, usize)> {
        let id = self.pl(pid)?.trade?;
        let i = self.trades.iter().position(|t| t.id == id)?;
        Some((i, if self.trades[i].sides[0] == pid { 0 } else { 1 }))
    }

    /** /trade name, or /trade alone (the target). */
    pub fn trade_request_named(&mut self, pid: u32, name: &str) {
        let name = name.trim();
        let tid = if name.is_empty() { self.pl(pid).unwrap().target.filter(|t| self.pl(*t).is_some()) } else { self.find_player(name) };
        match tid {
            Some(t) => self.trade_request(pid, t),
            None if name.is_empty() => self.sys(pid, "Seleccioná a un jugador para comerciar (o /trade nombre).", "Target a player to trade with (or /trade name)."),
            None => self.sys(pid, &format!("{name} no está conectado."), &format!("{name} is not online.")),
        }
    }

    pub fn trade_request(&mut self, pid: u32, tid: u32) {
        if tid == pid { return self.sys(pid, "No podés comerciar con vos mismo.", "You cannot trade with yourself."); }
        if self.arena.is_some() { return self.sys(pid, "En la arena de la Olimpiada no se comercia.", "There is no trading in the Olympiad arena."); }
        let Some(t) = self.pl(tid) else { return self.sys(pid, "Seleccioná a otro jugador para comerciar.", "Target another player to trade with.") };
        let (t_name, t_busy) = (t.name.clone(), t.trade.is_some() || t.pending_trade.map_or(false, |(_, until)| until > self.now));
        if self.ents[&pid].c.dead { return self.sys(pid, "No podés comerciar estando muerto.", "You cannot trade while dead."); }
        if self.pl(pid).unwrap().trade.is_some() { return self.sys(pid, "Ya estás comerciando.", "You are already trading."); }
        if t_busy || self.ents[&tid].c.dead {
            return self.sys(pid, &format!("{t_name} está ocupado. Probá más tarde."), &format!("{t_name} is busy. Please try again later."));
        }
        if dist(&self.ents[&pid].c, &self.ents[&tid].c) > TRADE_RANGE { return self.sys(pid, "Tu objetivo está fuera de alcance.", "Your target is out of range."); }
        let now = self.now;
        let from = self.pl(pid).unwrap().name.clone();
        let t = self.pl_mut(tid).unwrap();
        t.pending_trade = Some((pid, now + REQUEST_MS));
        t.send(json!({ "t": "tradeRequest", "from": from }));
        self.sys(pid, &format!("Le pediste comerciar a {t_name}."), &format!("You have requested a trade with {t_name}."));
    }

    pub fn trade_respond(&mut self, pid: u32, accept: bool) {
        let now = self.now;
        let Some((from, until)) = self.pl_mut(pid).unwrap().pending_trade.take() else { return };
        if until < now || self.pl(from).is_none() { return self.sys(pid, "El pedido de comercio venció.", "The trade request has expired."); }
        let (name, from_name) = (self.pl(pid).unwrap().name.clone(), self.pl(from).unwrap().name.clone());
        if !accept { return self.sys(from, &format!("{name} rechazó tu pedido de comercio."), &format!("{name} has denied your request to trade.")); }
        // all again: either may have died, walked off or started another trade meanwhile
        let busy = self.pl(pid).unwrap().trade.is_some() || self.pl(from).unwrap().trade.is_some();
        if busy || self.ents[&pid].c.dead || self.ents[&from].c.dead {
            self.sys(from, "No se pudo empezar el comercio.", "The trade could not start.");
            return self.sys(pid, "No se pudo empezar el comercio.", "The trade could not start.");
        }
        if dist(&self.ents[&pid].c, &self.ents[&from].c) > TRADE_RANGE {
            self.sys(from, "Tu objetivo está fuera de alcance.", "Your target is out of range.");
            return self.sys(pid, "Tu objetivo está fuera de alcance.", "Your target is out of range.");
        }
        let id = self.next_trade;
        self.next_trade += 1;
        self.trades.push(Trade { id, sides: [from, pid], offers: [Offer::default(), Offer::default()] });
        self.pl_mut(from).unwrap().trade = Some(id);
        self.pl_mut(pid).unwrap().trade = Some(id);
        self.sys(from, &format!("Empezaste a comerciar con {name}."), &format!("You begin trading with {name}."));
        self.sys(pid, &format!("Empezaste a comerciar con {from_name}."), &format!("You begin trading with {from_name}."));
        self.send_trade(id);
    }

    /** Put (part of) a bag row in pid's offer. Nothing goes in once either side has confirmed. */
    pub fn trade_add(&mut self, pid: u32, uid: u32, count: f64) {
        let Some((ti, side)) = self.trade_of(pid) else { return };
        if self.trades[ti].offers.iter().any(|o| o.ok) {
            return self.sys(pid, "Una vez confirmado el comercio, no se pueden mover más objetos.", "Once the trade is confirmed, the item cannot be moved again.");
        }
        let Some(it) = self.pl(pid).unwrap().inv.iter().find(|i| i.u == uid) else { return };
        if it.s.is_some() { return self.sys(pid, "Sacate el objeto antes de ofrecerlo.", "Unequip the item before offering it."); }
        if d().item(&it.i).map_or(true, |def| matches!(def.kind.as_str(), "currency" | "chest")) { return; }
        let offered: i64 = self.trades[ti].offers[side].items.iter().filter(|(u, _)| *u == uid).map(|(_, c)| c).sum();
        let count = count.floor();
        if !(count >= 1.0) { return; }
        let count = (count as i64).min(it.c - offered);
        if count <= 0 { return; }
        let o = &mut self.trades[ti].offers[side];
        match o.items.iter_mut().find(|(u, _)| *u == uid) {
            Some(row) => row.1 += count,
            None => o.items.push((uid, count)),
        }
        let id = self.trades[ti].id;
        self.send_trade(id);
    }

    /** Add adena to pid's offer (it only goes up, like everything else in a trade). */
    pub fn trade_adena(&mut self, pid: u32, amount: f64) {
        let Some((ti, side)) = self.trade_of(pid) else { return };
        if self.trades[ti].offers.iter().any(|o| o.ok) {
            return self.sys(pid, "Una vez confirmado el comercio, no se pueden mover más objetos.", "Once the trade is confirmed, the item cannot be moved again.");
        }
        let amount = amount.floor();
        if !(amount >= 1.0) { return; }
        let have = self.pl(pid).unwrap().adena;
        let o = &mut self.trades[ti].offers[side];
        o.adena = (o.adena + amount as i64).min(have);
        let id = self.trades[ti].id;
        self.send_trade(id);
    }

    pub fn trade_confirm(&mut self, pid: u32) {
        let Some((ti, side)) = self.trade_of(pid) else { return };
        if self.trades[ti].offers[side].ok { return; }
        self.trades[ti].offers[side].ok = true;
        let name = self.pl(pid).unwrap().name.clone();
        for s in self.trades[ti].sides { self.sys(s, &format!("{name} confirmó el comercio."), &format!("{name} has confirmed the trade.")); }
        if self.trades[ti].offers.iter().all(|o| o.ok) { return self.trade_execute(ti); }
        let id = self.trades[ti].id;
        self.send_trade(id);
    }

    /**
     * Ends pid's trade with nothing changing hands (and drops a request waiting for pid's answer). why: what both are
     * told; none: "pid cancelled the trade".
     */
    pub fn trade_cancel(&mut self, pid: u32, why: Option<Why>) {
        if let Some(p) = self.pl_mut(pid) { p.pending_trade = None; }
        let Some((ti, _)) = self.trade_of(pid) else { return };
        let t = self.trades.remove(ti);
        let name = self.pl(pid).map(|p| p.name.clone()).unwrap_or_default();
        let (es, en) = why.unwrap_or_else(|| (format!("{name} canceló el comercio."), format!("{name} has cancelled the trade.")));
        for s in t.sides {
            let Some(p) = self.pl_mut(s) else { continue };
            p.trade = None;
            p.send(json!({ "t": "tradeEnd", "done": false }));
            self.sys(s, &es, &en);
        }
    }

    /** Both confirmed: check everything again, then swap the two sides at once and save both together. */
    fn trade_execute(&mut self, ti: usize) {
        let [a, b] = self.trades[ti].sides;
        if let Some(w) = self.trade_fails(ti) { return self.trade_cancel(a, Some(w)); }
        let t = self.trades.remove(ti);
        // out of both bags first, then into the other's
        let mut gone: [Vec<InvItem>; 2] = [vec![], vec![]];
        for s in 0..2 {
            let p = self.pl_mut(t.sides[s]).unwrap();
            for &(uid, c) in &t.offers[s].items {
                let idx = p.inv.iter().position(|i| i.u == uid).unwrap();
                gone[s].push(InvItem { c, ..p.inv[idx].clone() });
                p.inv[idx].c -= c;
                if p.inv[idx].c <= 0 { p.inv.remove(idx); }
            }
            p.adena -= t.offers[s].adena;
        }
        for s in 0..2 {
            let p = self.pl_mut(t.sides[1 - s]).unwrap();
            for row in &gone[s] {
                // a plain stackable joins the stack; a piece keeps its enchant, legacy and Masterwork marks
                if stacks(row) { add_item(p, &row.i, row.c); } else {
                    let u = p.next_uid;
                    p.next_uid += 1;
                    p.inv.push(InvItem { u, s: None, ..row.clone() });
                }
            }
            p.adena += t.offers[s].adena;
            p.trade = None;
            p.inv_dirty = true;
        }
        let gave = |rows: &[InvItem]| Value::from(rows.iter().map(|r| json!({ "i": r.i, "c": r.c, "e": r.e, "l": r.l, "m": r.m })).collect::<Vec<_>>()).to_string();
        let (pa, pb) = (self.pl(a).unwrap(), self.pl(b).unwrap());
        let log = TradeLog {
            a_id: pa.char_id, a_name: pa.name.clone(), a_gave: gave(&gone[0]), a_adena: t.offers[0].adena,
            b_id: pb.char_id, b_name: pb.name.clone(), b_gave: gave(&gone[1]), b_adena: t.offers[1].adena,
        };
        let (ca, cb): (CharSave, CharSave) = (self.char_save(a, None), self.char_save(b, None));
        if let Err(e) = self.db.save_trade(&ca, &cb, &log) { elog!("[trade] save failed: {e}"); }
        let now = crate::world::now_ms();
        for s in t.sides {
            let p = self.pl_mut(s).unwrap();
            p.saved_at = now;
            p.send(json!({ "t": "tradeEnd", "done": true }));
            self.sys(s, "El comercio se realizó con éxito.", "Your trade was successful.");
        }
    }

    /** Why a trade both sides confirmed cannot go through any more (none: it can). */
    fn trade_fails(&self, ti: usize) -> Option<Why> {
        let t = &self.trades[ti];
        let (Some(ea), Some(eb)) = (self.ents.get(&t.sides[0]), self.ents.get(&t.sides[1])) else { return why("El comercio se canceló.", "The trade has been cancelled.") };
        if ea.c.dead || eb.c.dead { return why("El comercio se canceló.", "The trade has been cancelled."); }
        if dist(&ea.c, &eb.c) > TRADE_RANGE { return why("Están demasiado lejos: el comercio se canceló.", "You are too far apart: the trade has been cancelled."); }
        let mut gets: [Vec<(&InvItem, i64)>; 2] = [vec![], vec![]];
        for s in 0..2 {
            let p = self.pl(t.sides[s]).unwrap();
            // since the items went in, they may have been used, sold, equipped or dropped
            for &(uid, c) in &t.offers[s].items {
                match p.inv.iter().find(|i| i.u == uid) {
                    Some(it) if it.s.is_none() && it.c >= c => gets[1 - s].push((it, c)),
                    _ => return why("Un objeto ofrecido ya no está: el comercio se canceló.", "An offered item is gone: the trade has been cancelled."),
                }
            }
            if p.adena < t.offers[s].adena { return why("La adena ofrecida ya no está: el comercio se canceló.", "The offered adena is gone: the trade has been cancelled."); }
        }
        for s in 0..2 {
            let p = self.pl(t.sides[s]).unwrap();
            if rows_after(&p.inv, &t.offers[s].items, &gets[s]) > INV_MAX {
                return Some((format!("{} no tiene lugar en el inventario: el comercio se canceló.", p.name), format!("{} has no room in their inventory: the trade has been cancelled.", p.name)));
            }
        }
        None
    }

    /** Each side sees its own offer and the other's (what each piece is, for the tooltips and the gold names). */
    fn send_trade(&self, id: u32) {
        let Some(t) = self.trades.iter().find(|t| t.id == id) else { return };
        let side = |s: usize| -> Value {
            let p = self.pl(t.sides[s]);
            let items: Vec<Value> = t.offers[s].items.iter().filter_map(|&(uid, c)| {
                let it = p?.inv.iter().find(|i| i.u == uid)?;
                Some(json!({ "u": uid, "i": it.i, "c": c, "e": it.e, "l": it.l, "m": it.m }))
            }).collect();
            json!({ "items": items, "adena": t.offers[s].adena, "ok": t.offers[s].ok })
        };
        for s in 0..2 {
            let with = self.pl(t.sides[1 - s]).map(|p| p.name.clone()).unwrap_or_default();
            self.send(t.sides[s], json!({ "t": "trade", "with": with, "mine": side(s), "theirs": side(1 - s) }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(u: u32, i: &str, c: i64) -> InvItem { InvItem { u, i: i.into(), c, s: None, e: 0, l: false, m: false } }

    #[test]
    fn room_after_a_trade() {
        let inv = vec![row(1, "healing_potion", 10), row(2, "hand_axe", 1), row(3, "iron_ore", 50)];
        let potion = row(9, "healing_potion", 5);
        let axe = row(10, "hand_axe", 1);
        let mw = InvItem { m: true, ..row(11, "healing_potion", 1) };
        // potions join the stack already there; an axe takes a row
        assert_eq!(rows_after(&inv, &[], &[(&potion, 5)]), 3);
        assert_eq!(rows_after(&inv, &[], &[(&axe, 1)]), 4);
        // giving the whole ore stack away frees its row, part of it does not
        assert_eq!(rows_after(&inv, &[(3, 50)], &[(&axe, 1)]), 3);
        assert_eq!(rows_after(&inv, &[(3, 20)], &[(&axe, 1)]), 4);
        // the whole potion stack given away: the potions that come in make a new stack
        assert_eq!(rows_after(&inv, &[(1, 10)], &[(&potion, 5)]), 3);
        // two incoming rows of one stackable make one stack; a marked one keeps a row of its own
        let potion2 = row(12, "healing_potion", 3);
        assert_eq!(rows_after(&[], &[], &[(&potion, 5), (&potion2, 3)]), 1);
        assert_eq!(rows_after(&inv, &[], &[(&mw, 1)]), 4);
        // a full bag
        let full: Vec<InvItem> = (0..INV_MAX as u32).map(|u| row(u, "hand_axe", 1)).collect();
        assert!(rows_after(&full, &[], &[(&axe, 1)]) > INV_MAX);
        assert_eq!(rows_after(&full, &[(0, 1)], &[(&axe, 1)]), INV_MAX);
    }
}
