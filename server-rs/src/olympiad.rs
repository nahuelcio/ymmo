//! The Olympiad (shared/src/data/olympiad.ts, d().olympiad): one-on-one fights between awakened characters, each with
//! their real gear, in an arena of their own.
//!
//! - **The queue:** `/olimpiada` puts a character in the overworld's queue. Every few seconds the two who waited
//!   longest and are ready (alive, out of combat) are paired, unless they already fought each other perRival times
//!   that day.
//! - **The arena:** each fight is an instance (RAIDS.olympiad, `arena`) the hub opens with the two on either side of
//!   its middle. They get a short pause to get ready (no blows), then the fight, kept inside a circle.
//! - **The outcome:** a knockout wins. When time runs out, the most damage dealt wins (a tie is a draw), and leaving
//!   or dropping loses. Nobody pays for it: no karma, no XP, no drop. Both go back to where they queued, healed.
//! - **Points and Heroes:** the winner takes a fifth of the loser's points (at least 1). At each new month (00:00 on
//!   the 1st, Argentina), the best of each class line with enough fights is its Hero for that month, with a title and
//!   an aura (the player record's `he`).
use crate::clans::announce_all;
use crate::collision::P;
use crate::data::d;
use crate::formulas::{loot_day, loot_month, month_start};
use crate::world::{HubEvent, World};
use serde_json::json;
use std::collections::HashMap;

/** The auras a Hero may wear (client/src/render/hero-fx.ts HERO_LOOKS: the same, in the same order). */
pub const HERO_LOOKS: [&str; 2] = ["halo", "spiral"];

/** The class line a specialization fights in: the one it awakened from (none before the awakening). */
pub fn line_of(spec: Option<&str>) -> Option<&'static str> {
    let s = d().specs.iter().find(|s| Some(s.id.as_str()) == spec)?;
    s.parent.as_deref().and_then(|p| d().specs.iter().find(|x| x.id == p)).map(|x| x.id.as_str())
}
/** What a fight moves: the winner takes this from the loser (olympiad.ts pointsWon: the same). */
pub fn points_won(loser: i64) -> i64 { ((loser as f64 * d().olympiad.take).round() as i64).max(1) }
/** A class line's name (its specialization's), in each language. */
fn line_name(line: &str) -> (String, String) {
    d().specs.iter().find(|s| s.id == line).map_or((line.into(), line.into()), |s| (s.name.clone(), s.name_en.clone()))
}

/** One side of a fight: who, its line, the damage it has dealt. */
pub struct Fighter { pub pid: u32, pub char_id: i64, pub name: String, pub line: String, pub dmg: f64 }

/** An Olympiad arena: where each came from (char id -> the overworld spot they queued at), the two fighters, when the
 * fight starts and ends, and whether it is over. */
#[derive(Default)]
pub struct ArenaState {
    pub back: HashMap<i64, P>,
    pub fighters: Vec<Fighter>,
    pub fight_at: f64,
    pub ends_at: f64,
    pub started: bool,
    pub over: bool,
}

impl World {
    /** `/olimpiada`: in or out of the queue; `top`, the month's table; `heroes`, this month's Heroes. */
    pub fn oly_command(&mut self, pid: u32, arg: &str) {
        match arg.trim().to_lowercase().as_str() {
            "top" => return self.oly_top(pid),
            "heroes" | "héroes" | "heroe" | "héroe" => return self.oly_heroes(pid),
            _ => {}
        }
        if self.raid.is_some() { return self.sys(pid, "La Olimpiada se anota desde el mundo, no desde una instancia.", "You queue for the Olympiad from the world, not from an instance."); }
        if let Some(i) = self.oly_queue.iter().position(|&q| q == pid) {
            self.oly_queue.remove(i);
            return self.sys(pid, "Saliste de la cola de la Olimpiada.", "You left the Olympiad queue.");
        }
        let o = &d().olympiad;
        let p = self.pl(pid).unwrap();
        if p.level < o.min_level || line_of(p.spec.as_deref()).is_none() {
            return self.sys(pid, &format!("La Olimpiada es para personajes de nivel {} o más que ya hicieron el Despertar.", o.min_level),
                &format!("The Olympiad is for characters of level {} or more who have gone through the Awakening.", o.min_level));
        }
        self.oly_queue.push(pid);
        let (pts, w, l, dr) = self.oly_standing(pid);
        let n = self.oly_queue.len();
        self.sys(pid, &format!("Te anotaste en la Olimpiada ({n} en cola). Tus puntos del mes: {pts} ({w} G, {l} P, {dr} E). Escribí /olimpiada otra vez para salir."),
            &format!("You joined the Olympiad queue ({n} waiting). Your points this month: {pts} ({w} W, {l} L, {dr} D). Type /olympiad again to leave."));
    }

    fn oly_standing(&self, pid: u32) -> (i64, i64, i64, i64) {
        let p = self.pl(pid).unwrap();
        let line = line_of(p.spec.as_deref()).unwrap_or("");
        self.db.oly_row(loot_month(self.now), p.char_id, line, &p.name, d().olympiad.start_points)
    }

    fn oly_top(&mut self, pid: u32) {
        let top = self.db.oly_top(loot_month(self.now), 10);
        if top.is_empty() { return self.sys(pid, "Nadie peleó en la Olimpiada este mes.", "Nobody has fought in the Olympiad this month."); }
        // the month's Heroes are chosen when it ends
        let left = month_start(loot_month(self.now) + 1) - self.now;
        let (days, hours) = ((left / 86_400_000.0).floor(), ((left % 86_400_000.0) / 3_600_000.0).floor());
        self.sys(pid, &format!("La Olimpiada, este mes (los Héroes se eligen en {days} d {hours} h):"), &format!("The Olympiad, this month (the Heroes are chosen in {days} d {hours} h):"));
        for (i, (name, line, pts, w, l, dr)) in top.iter().enumerate() {
            let (es, en) = line_name(line);
            self.sys(pid, &format!("{}. {name} ({es}) — {pts} puntos, {w} G {l} P {dr} E", i + 1), &format!("{}. {name} ({en}) — {pts} points, {w} W {l} L {dr} D", i + 1));
        }
    }

    fn oly_heroes(&mut self, pid: u32) {
        let heroes = self.db.heroes(loot_month(self.now));
        if heroes.is_empty() { return self.sys(pid, "Este mes no hay Héroes: se eligen el día 1 con los puntos del mes anterior.", "There are no Heroes this month: they are chosen on the 1st, by last month's points."); }
        self.sys(pid, "Los Héroes de este mes:", "This month's Heroes:");
        for (line, _, name) in heroes {
            let (es, en) = line_name(&line);
            self.sys(pid, &format!("{name} — {es}"), &format!("{name} — {en}"));
        }
    }

    /** Every few seconds, in the overworld: pair the two who waited longest and are ready (alive, out of combat), unless
     * they fought each other enough today, and send them off. */
    pub fn oly_match(&mut self, now: f64) {
        let here: Vec<u32> = self.oly_queue.iter().copied().filter(|id| self.pl(*id).is_some()).collect();
        self.oly_queue = here;
        if self.oly_queue.len() < 2 { return; }
        let ready = |w: &World, id: u32| !w.ents[&id].c.dead && w.pl(id).is_some_and(|p| now - p.last_combat >= crate::player::IN_COMBAT_MS && p.trade.is_none());
        let day = loot_day(now);
        let q = self.oly_queue.clone();
        let mut used = vec![false; q.len()];
        for i in 0..q.len() {
            if used[i] || !ready(self, q[i]) { continue; }
            for j in i + 1..q.len() {
                if used[j] || !ready(self, q[j]) { continue; }
                let (a, b) = (self.pl(q[i]).unwrap().char_id, self.pl(q[j]).unwrap().char_id);
                if self.db.oly_fights(day, a, b) >= d().olympiad.per_rival { continue; }
                (used[i], used[j]) = (true, true);
                self.oly_send(q[i], q[j], day);
                break;
            }
        }
        let gone: Vec<u32> = q.iter().zip(&used).filter(|(_, &u)| u).map(|(&id, _)| id).collect();
        self.oly_queue.retain(|id| !gone.contains(id));
    }

    /** A pair is made: both leave the overworld (saved where they stand, where they will come back) for a new arena. */
    fn oly_send(&mut self, a: u32, b: u32, day: i64) {
        let (an, bn, ac, bc) = { let (x, y) = (self.pl(a).unwrap(), self.pl(b).unwrap()); (x.name.clone(), y.name.clone(), x.char_id, y.char_id) };
        self.db.oly_fight(day, ac, bc);
        for (id, rival) in [(a, &bn), (b, &an)] {
            self.sys(id, &format!("Olimpiada: ¡rival encontrado, {rival}! Entrás a la arena."), &format!("Olympiad: rival found, {rival}! Into the arena."));
        }
        let raid = &d().raids["olympiad"];
        let members: Vec<_> = [a, b].into_iter().filter_map(|id| self.take_out(id, None)).collect();
        self.events.push(HubEvent::EnterArena { raid, members });
    }

    /** A fighter in the arena: whole again, on the record; the second one in starts the countdown. One who waits alone
     * too long goes back with nothing lost. */
    pub fn arena_join(&mut self, pid: u32) {
        let now = self.now;
        let (cid, name, spec) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone(), p.spec.clone()) };
        {
            let p = self.pl_mut(pid).unwrap();
            (p.hp, p.mp, p.cp) = (p.stats.max_hp, p.stats.max_mp, p.stats.max_cp);
        }
        let o = &d().olympiad;
        let Some(a) = self.arena.as_mut() else { return };
        a.fighters.push(Fighter { pid, char_id: cid, name, line: line_of(spec.as_deref()).unwrap_or("").into(), dmg: 0.0 });
        if a.fighters.len() == 1 {
            return self.later(now + 15_000.0, |w, _| {
                let Some(a) = w.arena.as_mut() else { return };
                if a.fighters.len() >= 2 || a.over { return; }
                a.over = true;
                for pid in w.players.clone() {
                    w.sys(pid, "Tu rival no llegó: el combate se cancela y no cuenta.", "Your rival did not make it: the fight is called off and does not count.");
                    w.arena_out(pid);
                }
            });
        }
        (a.fight_at, a.ends_at) = (now + o.prep_ms, now + o.prep_ms + o.fight_ms);

        let names: Vec<(u32, String)> = a.fighters.iter().map(|f| (f.pid, f.name.clone())).collect();
        for (i, (id, _)) in names.iter().enumerate() {
            let rival = &names[1 - i].1;
            self.send(*id, json!({ "t": "oly", "vs": rival, "fightIn": o.prep_ms, "endsIn": o.prep_ms + o.fight_ms }));
            let secs = (o.prep_ms / 1000.0).round();
            self.sys(*id, &format!("Olimpiada: contra {rival}. El combate empieza en {secs} s; podés prepararte (sin atacar)."),
                &format!("Olympiad: against {rival}. The fight starts in {secs} s; get ready (no attacking yet)."));
        }
    }

    /** Why a blow can't land in the arena yet, if it can't (the fight hasn't started, or is over). */
    pub fn arena_refuses(&self, l: crate::i18n::Lang) -> Option<String> {
        let a = self.arena.as_ref()?;
        if a.over { return Some(crate::i18n::tr(l, "El combate terminó.", "The fight is over.").into()); }
        if self.now < a.fight_at || a.fighters.len() < 2 {
            let s = ((a.fight_at - self.now) / 1000.0).ceil().max(1.0);
            return Some(if l.en() { format!("The fight starts in {s} s.") } else { format!("El combate empieza en {s} s.") });
        }
        None
    }

    /** A fighter's blow on the other: to its count, for a fight that runs out of time. */
    pub fn arena_hit(&mut self, src: u32, dmg: f64) {
        if let Some(f) = self.arena.as_mut().and_then(|a| a.fighters.iter_mut().find(|f| f.pid == src)) { f.dmg += dmg; }
    }

    /** Each tick in the arena: nobody leaves the circle; the fight starts, and runs out. */
    pub fn arena_tick(&mut self, now: f64) {
        let Some(r) = self.raid else { return };
        let o = &d().olympiad;
        for pid in self.players.clone() {
            let (x, z) = { let c = &self.ents[&pid].c; (c.x, c.z) };
            let dist = (x - r.x).hypot(z - r.z);
            if dist > o.radius {
                let k = (o.radius - 0.5) / dist;
                self.set_pos(pid, r.x + (x - r.x) * k, r.z + (z - r.z) * k);
            }
        }
        let Some(a) = self.arena.as_mut() else { return };
        if a.over || a.fighters.len() < 2 { return; }
        if !a.started && now >= a.fight_at {
            a.started = true;
            for pid in self.players.clone() { self.sys(pid, "¡A pelear!", "Fight!"); }
        } else if now >= a.ends_at {
            // time: the most damage dealt wins
            let (f0, f1) = (&a.fighters[0], &a.fighters[1]);
            let winner = if (f0.dmg - f1.dmg).abs() < 0.5 { None } else if f0.dmg > f1.dmg { Some(f0.pid) } else { Some(f1.pid) };
            self.arena_end(winner, "time", now);
        }
    }

    /** A fighter went down: the other wins. */
    pub fn arena_ko(&mut self, dead: u32, now: f64) {
        let Some(a) = self.arena.as_ref() else { return };
        if a.over { return; }
        let winner = a.fighters.iter().find(|f| f.pid != dead).map(|f| f.pid);
        self.arena_end(winner, "ko", now);
    }

    /** A fighter leaves (Salir, /raid, a dropped connection) before it is over: the other wins. */
    pub fn arena_leave(&mut self, pid: u32) {
        let now = self.now;
        let Some(a) = self.arena.as_ref() else { return };
        if a.over || a.fighters.len() < 2 || !a.fighters.iter().any(|f| f.pid == pid) { return; }
        let winner = a.fighters.iter().find(|f| f.pid != pid).map(|f| f.pid);
        self.arena_end(winner, "left", now);
    }

    /** The fight is decided: points move, both hear how it went, and soon go back. */
    fn arena_end(&mut self, winner: Option<u32>, why: &str, now: f64) {
        let Some(a) = self.arena.as_mut() else { return };
        a.over = true;
        let sides: Vec<(u32, i64, String, String)> = a.fighters.iter().map(|f| (f.pid, f.char_id, f.name.clone(), f.line.clone())).collect();
        let (month, o) = (loot_month(now), &d().olympiad);
        let rows: Vec<(i64, i64, i64, i64)> = sides.iter().map(|s| self.db.oly_row(month, s.1, &s.3, &s.2, o.start_points)).collect();
        // the winner takes a share of the loser's points
        let moved = winner.and_then(|w| sides.iter().position(|s| s.0 != w)).map_or(0, |li| points_won(rows[li].0).min(rows[li].0));
        for (i, (pid, cid, _, _)) in sides.iter().enumerate() {
            let rival = &sides[1 - i].2;
            let (result, delta) = match winner {
                None => ("draw", 0),
                Some(w) if w == *pid => ("win", moved),
                Some(_) => ("loss", -moved),
            };
            self.db.oly_score(month, *cid, delta, (result == "win") as i64, (result == "loss") as i64, (result == "draw") as i64);
            let points = rows[i].0 + delta;
            self.send(*pid, json!({ "t": "olyEnd", "result": result, "points": points, "delta": delta }));
            let how = match why { "time" => (" (por daño, se acabó el tiempo)", " (on damage: time ran out)"), "left" => (" (tu rival abandonó)", " (your rival left)"), _ => ("", "") };
            match result {
                "win" => self.sys(*pid, &format!("¡Le ganaste a {rival}{}! +{moved} puntos ({points}).", how.0), &format!("You beat {rival}{}! +{moved} points ({points}).", how.1)),
                "loss" => self.sys(*pid, &format!("Perdiste contra {rival}. -{moved} puntos ({points})."), &format!("You lost to {rival}. -{moved} points ({points}).")),
                _ => self.sys(*pid, &format!("Empate con {rival}: nadie gana ni pierde puntos."), &format!("A draw with {rival}: nobody wins or loses points.")),
            }
        }
        self.later(now + o.end_ms, |w, _| { for pid in w.players.clone() { w.arena_out(pid); } });
    }

    /** Back to where they queued, healed. */
    pub fn arena_out(&mut self, pid: u32) {
        let Some(e) = self.ents.get_mut(&pid) else { return };
        e.c.dead = false;
        if let Some(p) = e.player_mut() { (p.hp, p.mp, p.cp) = (p.stats.max_hp, p.stats.max_mp, p.stats.max_cp); }
        let at = self.exit_point(pid);
        if let Some(member) = self.take_out(pid, at) { self.events.push(HubEvent::ToMain { member }); }
    }

    /** At a new month (and when the overworld starts): its Heroes, from last month's points, unless they were chosen
     * already. `force` (the admin panel) chooses them again, from this month's points so far. */
    pub fn crown_heroes(&mut self, force: bool) {
        let month = loot_month(self.now);
        if !force && !self.db.heroes(month).is_empty() { return self.refresh_heroes(month); }
        let o = &d().olympiad;
        let mut heroes: Vec<(String, i64, String)> = vec![];
        for (line, cid, name, _, _, _) in self.db.oly_contenders(if force { month } else { month - 1 }, o.hero_fights, o.hero_wins) {
            if !heroes.iter().any(|h| h.0 == line) { heroes.push((line, cid, name)); }
        }
        if heroes.is_empty() && !force { return self.refresh_heroes(month); }
        self.db.set_heroes(month, &heroes);
        for (line, _, name) in &heroes {
            let (es, en) = line_name(line);
            announce_all(&format!("¡{name} es el Héroe de este mes de la línea {es}!"), &format!("{name} is this month's {en} Hero!"));
        }
        self.refresh_heroes(month);
    }

    /** A Hero chooses its aura (the character window): everyone around sees the new one. */
    pub fn choose_hero_look(&mut self, pid: u32, look: &str) {
        if !HERO_LOOKS.contains(&look) { return; }
        let cid = {
            let p = self.pl(pid).unwrap();
            if !p.hero { return self.sys(pid, "Solo los Héroes de la Olimpiada llevan aura.", "Only the Olympiad's Heroes wear an aura."); }
            if p.hero_look == look { return; }
            p.char_id
        };
        self.db.set_hero_look(cid, look);
        let e = self.ents.get_mut(&pid).unwrap();
        e.player_mut().unwrap().hero_look = look.into();
        e.c.av += 1;
        let (es, en) = if look == "spiral" { ("Espiral", "Spiral") } else { ("Halo", "Halo") };
        self.sys(pid, &format!("Tu aura de Héroe: {es}."), &format!("Your Hero aura: {en}."));
    }

    /** The overworld's players wear their Hero title as it stands (the others, when they come back). */
    fn refresh_heroes(&mut self, month: i64) {
        for pid in self.players.clone() {
            let cid = self.pl(pid).unwrap().char_id;
            let hero = self.db.is_hero(cid, month);
            let e = self.ents.get_mut(&pid).unwrap();
            let p = e.player_mut().unwrap();
            if p.hero != hero { p.hero = hero; e.c.av += 1; }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The arena is its own instance on a floor of its own; eight lines, one for each specialization awakened into;
    /// a win takes a fifth of the loser's points, never nothing.
    #[test]
    fn lines_points_and_arena() {
        let o = &d().olympiad;
        let r = &d().raids["olympiad"];
        assert!(r.arena && r.boss.is_none() && r.max_players == 2 && r.min_level == o.min_level);
        assert!(o.gap / 2.0 < o.radius, "both start inside the circle");
        let lines: std::collections::HashSet<_> = d().specs.iter().filter_map(|s| line_of(Some(&s.id))).collect();
        assert_eq!(lines.len(), 8, "a line for each specialization that awakens");
        assert_eq!(line_of(Some("knight")), None, "not awakened yet");
        assert_eq!(line_of(Some("phoenix_knight")), Some("knight"));
        assert_eq!((points_won(20), points_won(3), points_won(1)), (4, 1, 1));
        assert!(o.start_points > 0 && o.hero_fights >= o.hero_wins && o.per_rival >= 1);
    }
}
