//! La Grieta (the Rift, RAIDS.rift in shared/src/data/raids.ts): an instance of endless floors. Each floor is a wave of
//! the volcano's and the Abyss' own mobs, stronger floor by floor; clearing it opens the next. A character's first run
//! of the day pays Marks every 5 floors; every run keeps the week's ranking of the deepest parties.
use crate::ent::*;
use crate::formulas::{jround, loot_day, loot_week, rnd};
use crate::world::World;
use serde_json::json;
use std::collections::HashSet;

/** What a floor's wave draws from (levels 71-78), and the elites every 5th floor adds. */
pub const TRASH: [&str; 10] = ["lava_salamander", "hellhound", "lava_golem", "pyromancer", "magma_drake", "abyss_knight", "lich", "abyss_weaver", "abyss_drake", "abyss_demon"];
pub const ELITES: [&str; 2] = ["high_pyromancer", "abyss_commander"];
/** The Marks a floor pays (contract_mark in shared/src/data/items.ts), and the pause before the next one. */
pub const MARK: &str = "contract_mark";
const NEXT_FLOOR_MS: f64 = 6000.0;

/** Floor `n`'s wave: how many mobs, and what they have times their template (HP before the party's size, attack, XP). */
pub fn wave_size(n: i64) -> usize { (4 + n / 3).min(10) as usize }
pub fn hp_mult(n: i64) -> f64 { 1.0 + 0.15 * (n - 1) as f64 }
pub fn atk_mult(n: i64) -> f64 { 1.0 + 0.08 * (n - 1) as f64 }
pub fn xp_mult(n: i64) -> f64 { 1.0 + 0.05 * (n - 1) as f64 }
/** Marks a floor pays a paid run: floor/5 every 5th floor (1 at the 5th, 2 at the 10th...), nothing between. */
pub fn floor_marks(n: i64) -> i64 { if n > 0 && n % 5 == 0 { n / 5 } else { 0 } }

#[derive(Default)]
pub struct RiftState {
    /** the floor being fought (0 before the first), and its wave's mobs still standing; whether floor 1 is on its way */
    pub floor: i64,
    pub alive: Vec<u32>,
    pub started: bool,
    /** everyone who came on this run (char id, name), for the ranking; whom it pays (their first run of the day) */
    pub party: Vec<(i64, String)>,
    pub paid: HashSet<i64>,
}

impl World {
    /** A player in the Rift: on the run's ranking; paid if it is their first run of the day; the first one in opens floor 1. */
    pub fn rift_join(&mut self, pid: u32) {
        let (cid, name) = { let p = self.pl(pid).unwrap(); (p.char_id, p.name.clone()) };
        let paid = self.db.take_rift_run(cid, loot_day(self.now));
        let Some(rift) = self.rift.as_mut() else { return };
        if !rift.party.iter().any(|(c, _)| *c == cid) { rift.party.push((cid, name)); }
        if paid { rift.paid.insert(cid); }
        let first = !std::mem::replace(&mut rift.started, true);
        if paid || rift.paid.contains(&cid) {
            self.sys(pid, "Esta corrida paga premio: Marcas de Contrato cada 5 pisos.", "This run pays: Contract Marks every 5 floors.");
        } else {
            self.sys(pid, "Ya hiciste tu corrida con premio hoy: esta cuenta solo para el ranking.", "You have had today's paid run: this one counts for the ranking only.");
        }
        if first {
            self.sys(pid, "La Grieta: cada piso trae enemigos más fuertes. Escribí /raid para salir.", "The Rift: every floor brings stronger enemies. Type /raid to leave.");
            let now = self.now;
            self.later(now + NEXT_FLOOR_MS, |w, _| w.rift_floor());
        }
    }

    /** The next floor's wave, around the arena's middle, each mob on one of the party. */
    fn rift_floor(&mut self) {
        let Some(r) = self.raid else { return };
        let targets: Vec<u32> = self.players.iter().copied().filter(|id| !self.ents[id].c.dead).collect();
        if targets.is_empty() { return; }
        let n = { let rift = self.rift.as_mut().unwrap(); rift.floor += 1; rift.alive.clear(); rift.floor };
        let hp_k = hp_mult(n) * crate::raid::hp_scale(self.players.len());
        let mut wave: Vec<(&str, f64)> = (0..wave_size(n)).map(|_| (TRASH[(rnd() * TRASH.len() as f64) as usize % TRASH.len()], 1.0)).collect();
        if n % 5 == 0 { wave.push((ELITES[(rnd() * ELITES.len() as f64) as usize % ELITES.len()], 3.0)); }
        let count = wave.len();
        for (i, (tpl, extra)) in wave.into_iter().enumerate() {
            let a = i as f64 / count as f64 * std::f64::consts::TAU + rnd() * 0.4;
            let rad = 9.0 + rnd() * 5.0;
            let id = self.spawn_mob(tpl, r.x + a.cos() * rad, r.z + a.sin() * rad);
            let target = targets[i % targets.len()];
            let m = self.ents.get_mut(&id).unwrap().mob_mut().unwrap();
            m.stats.max_hp = jround(m.stats.max_hp * hp_k * extra);
            m.hp = m.stats.max_hp;
            (m.atk_scale, m.xp_scale, m.no_loot) = (atk_mult(n), xp_mult(n), true);
            m.stats.p_atk = jround(m.stats.p_atk * m.atk_scale);
            m.target = Some(target);
            map_set(&mut m.hate, target, 1.0);
            map_set(&mut m.threat, target, 50.0);
            self.rift.as_mut().unwrap().alive.push(id);
        }
        for pid in self.players.clone() {
            self.send(pid, json!({ "t": "rift", "floor": n }));
            self.sys(pid, &format!("Piso {n}: {count} enemigos."), &format!("Floor {n}: {count} enemies."));
        }
    }

    /** One of a floor's mobs is down: the last one clears the floor (Marks, the ranking, contracts), the next opens soon. */
    pub fn rift_mob_killed(&mut self, mid: u32, now: f64) {
        let Some(rift) = self.rift.as_mut() else { return };
        if !rift.alive.contains(&mid) { return; }
        rift.alive.retain(|&id| id != mid);
        if !rift.alive.is_empty() { return; }
        let n = rift.floor;
        let paid = rift.paid.clone();
        let mut party = rift.party.clone();
        party.sort();
        let key = party.iter().map(|(c, _)| c.to_string()).collect::<Vec<_>>().join("-");
        let names = party.iter().map(|(_, nm)| nm.as_str()).collect::<Vec<_>>().join(", ");
        self.db.set_rift_best(loot_week(now), &key, &names, n, now);
        let marks = floor_marks(n);
        let players = self.players.clone();
        for &pid in &players {
            self.sys(pid, &format!("¡Piso {n} superado! El piso {} se abre en {} s.", n + 1, (NEXT_FLOOR_MS / 1000.0) as i64),
                &format!("Floor {n} cleared! Floor {} opens in {} s.", n + 1, (NEXT_FLOOR_MS / 1000.0) as i64));
            let cid = self.pl(pid).unwrap().char_id;
            if marks > 0 && paid.contains(&cid) {
                self.give_or_ground(pid, MARK, marks, now);
                self.sys(pid, &format!("Ganaste {marks} Marcas de Contrato."), &format!("You earned {marks} Contract Marks."));
            }
        }
        self.credit_rift(&players, n);
        self.later(now + NEXT_FLOOR_MS, |w, _| w.rift_floor());
    }

    /** `/grieta top`: the week's ten deepest parties. */
    pub fn rift_top(&mut self, pid: u32) {
        let top = self.db.rift_top(loot_week(self.now), 10);
        if top.is_empty() { return self.sys(pid, "Nadie bajó a la Grieta esta semana.", "Nobody has gone down the Rift this week."); }
        self.sys(pid, "La Grieta, esta semana:", "The Rift, this week:");
        for (i, (names, floor)) in top.iter().enumerate() {
            self.sys(pid, &format!("{}. {names} — piso {floor}", i + 1), &format!("{}. {names} — floor {floor}", i + 1));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::d;

    /// Floors grow: more mobs up to 10, more HP and attack every floor; Marks only every 5th floor, more the deeper.
    #[test]
    fn floors_grow_and_pay_every_fifth() {
        assert_eq!((wave_size(1), wave_size(9), wave_size(60)), (4, 7, 10));
        assert_eq!(hp_mult(1), 1.0);
        assert!(hp_mult(11) > atk_mult(11) && atk_mult(11) > xp_mult(11) && xp_mult(11) > 1.0);
        assert_eq!((1..=15).map(floor_marks).collect::<Vec<_>>(), vec![0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3]);
        assert_eq!((1..=15).map(floor_marks).sum::<i64>(), 6, "fifteen floors pay 6");
        assert!(d().item(MARK).is_some(), "the Marks exist");
    }
}
