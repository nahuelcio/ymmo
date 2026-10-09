//! Stats and combat math: the only copy, the client shows what the server sends.
use crate::admin::bal;
use crate::data::{d, BuffMods, ItemDef, MobDef, StatMods};
use rand::Rng;

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub max_hp: f64, pub max_mp: f64, pub max_cp: f64,
    pub p_atk: f64, pub m_atk: f64, pub p_def: f64, pub m_def: f64,
    pub accuracy: f64, pub evasion: f64, pub crit: f64,
    pub atk_interval: f64, pub cast_mul: f64, pub speed: f64,
    pub hp_regen: f64, pub mp_regen: f64, pub cp_regen: f64,
    /** skill cooldown reduction, a fraction (0.1 = 10% shorter) */
    pub cdr: f64,
}

pub const BASE_SPEED: f64 = 6.0;
pub const MELEE_RANGE: f64 = 2.2;
pub const PARTY_BONUS: [f64; 10] = [1.0, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8];
pub const MAX_PARTY: usize = 9;
pub const PVP_FLAG_MS: f64 = 30000.0;
pub const KARMA_PER_PK: i64 = 360;

/** JS Math.round (half up) */
pub fn jround(v: f64) -> f64 { (v + 0.5).floor() }

pub fn level_mod(level: i64) -> f64 { 1.0 + (level - 1) as f64 * 0.1 }

pub fn stat_mods(race: &str, g: &str) -> StatMods {
    let data = d();
    let r = &data.races[race].mods;
    let s = &data.genders[g].mods;
    StatMods {
        hp: r.hp * s.hp, mp: r.mp * s.mp, p_atk: r.p_atk * s.p_atk, m_atk: r.m_atk * s.m_atk, p_def: r.p_def * s.p_def, m_def: r.m_def * s.m_def,
        speed: r.speed * s.speed, atk_spd: r.atk_spd * s.atk_spd, cast_spd: r.cast_spd * s.cast_spd,
        evasion: r.evasion + s.evasion, accuracy: r.accuracy + s.accuracy, crit: r.crit + s.crit,
    }
}

/** Chance that enchanting a piece currently at +e succeeds. */
pub fn enchant_chance(e: i64) -> f64 {
    let c = &d().enchant;
    if e < c.safe { 1.0 } else { 1.0 - c.step * (e - c.safe + 1) as f64 }
}

/** equipped: each worn piece with its enchant level (+N) */
pub fn compute_stats(race: &str, cls: &str, level: i64, equipped: &[(&ItemDef, i64)], buffs: &[&BuffMods], gender: &str) -> Stats {
    let r = stat_mods(race, gender);
    let c = &d().classes[cls];
    let cb = |f: &str, v: f64| bal(&format!("class.{cls}.{f}"), v);
    let ench = &d().enchant;
    let lm = level_mod(level);
    let (mut w_p, mut w_m, mut arm_p, mut arm_m, mut hp_bonus, mut mp_bonus, mut cdr_sum) = (4.0, 4.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for &(it, e) in equipped {
        let ib = |f: &str, v: Option<f64>| bal(&format!("item.{}.{f}", it.id), v.unwrap_or(0.0));
        if it.kind == "weapon" {
            let k = 1.0 + ench.weapon * e as f64;
            w_p = ib("pAtk", it.p_atk) * k + 4.0;
            w_m = ib("mAtk", it.m_atk) * k + 4.0;
        } else {
            let k = 1.0 + ench.armor * e as f64;
            arm_p += ib("pDef", it.p_def) * k;
            arm_m += ib("mDef", it.m_def) * k;
        }
        hp_bonus += ib("hp", it.hp);
        mp_bonus += ib("mp", it.mp);
        cdr_sum += ib("cdr", it.cdr);
    }
    let (mut bp, mut bpd, mut bm, mut bmd, mut bs, mut ba) = (1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    for b in buffs {
        bp *= b.p_atk.unwrap_or(1.0);
        bpd *= b.p_def.unwrap_or(1.0);
        bm *= b.m_atk.unwrap_or(1.0);
        bmd *= b.m_def.unwrap_or(1.0);
        bs *= b.speed.unwrap_or(1.0);
        ba *= b.atk_spd.unwrap_or(1.0);
    }
    let lvl = (level - 1) as f64;
    let max_hp = jround((cb("baseHp", c.base_hp) + cb("hpLvl", c.hp_lvl) * lvl) * r.hp + hp_bonus);
    let max_mp = jround((cb("baseMp", c.base_mp) + cb("mpLvl", c.mp_lvl) * lvl) * r.mp + mp_bonus);
    let max_cp = jround(max_hp * c.cp_ratio);
    let mystic = cls == "mystic";
    Stats {
        max_hp, max_mp, max_cp,
        p_atk: jround(w_p * lm * r.p_atk * bp),
        m_atk: jround(w_m * lm * r.m_atk * bm * if mystic { 1.0 } else { 0.6 }),
        p_def: jround((20.0 + arm_p) * lm * r.p_def * bpd),
        m_def: jround((15.0 + arm_m) * lm * r.m_def * bmd),
        accuracy: 80.0 + level as f64 + r.accuracy,
        evasion: 30.0 + level as f64 + r.evasion,
        crit: (if cls == "fighter" { 8.0 } else { 4.0 }) + r.crit,
        atk_interval: jround(c.atk_interval / (r.atk_spd * ba)),
        cast_mul: 1.0 / r.cast_spd,
        speed: BASE_SPEED * r.speed * bs,
        hp_regen: max_hp * 0.008 + 0.5,
        mp_regen: max_mp * if mystic { 0.015 } else { 0.01 } + 0.3,
        cp_regen: max_cp * 0.03,
        cdr: cdr_sum.min(0.5), // ponytail: flat cap, half of every skill's recharge at most
    }
}

/** a mob's multiplier from game.json (1.0 when unset), or the panel's value for it */
fn mob_mult(m: &MobDef, f: &str, base: Option<f64>) -> f64 { bal(&format!("mob.{}.{f}", m.id), base.unwrap_or(1.0)) }

pub fn mob_stats(m: &MobDef) -> Stats {
    let l = m.level as f64;
    let def = jround((30.0 + 3.0 * l) * mob_mult(m, "defMult", m.def_mult));
    Stats {
        max_hp: jround((50.0 + 15.0 * l + 1.5 * l * l) * mob_mult(m, "hpMult", m.hp_mult)),
        p_atk: jround((4.0 + 3.0 * l) * mob_mult(m, "atkMult", m.atk_mult)),
        p_def: def,
        m_def: def,
        accuracy: 80.0 + l,
        evasion: 30.0 + l,
        crit: 3.0,
        ..Default::default()
    }
}

pub fn rnd() -> f64 { rand::thread_rng().gen::<f64>() }
fn rand_range(a: f64, b: f64) -> f64 { a + rnd() * (b - a) }

pub fn hit_chance(accuracy: f64, evasion: f64) -> f64 { (0.9 + (accuracy - evasion - 50.0) * 0.01).clamp(0.6, 0.98) }

pub fn phys_damage(p_atk: f64, p_def: f64, mult: f64, crit: bool) -> f64 {
    jround(((70.0 * p_atk) / p_def.max(1.0)) * mult * rand_range(0.9, 1.1) * if crit { 2.0 } else { 1.0 }).max(1.0)
}

pub fn magic_damage(m_atk: f64, m_def: f64, mult: f64, crit: bool) -> f64 {
    jround(((70.0 * m_atk) / m_def.max(1.0)) * mult * rand_range(0.92, 1.08) * if crit { 1.8 } else { 1.0 }).max(1.0)
}

pub fn xp_to_next(level: i64) -> i64 {
    if level >= d().c.max_level { return 0; }
    jround(80.0 * (level as f64).powf(2.2)) as i64
}

pub fn mob_xp(m: &MobDef) -> f64 { jround((25.0 * (m.level as f64).powf(1.9) + 5.0) * mob_mult(m, "hpMult", m.hp_mult).powf(0.85)) }

pub fn level_penalty(player_lvl: i64, mob_lvl: i64) -> f64 {
    let diff = player_lvl - mob_lvl;
    if diff <= 5 { 1.0 } else { (1.0 - (diff - 5) as f64 * 0.2).max(0.05) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pacing table for levels 1..max: `cargo test balance -- --nocapture` prints it.
    #[test]
    fn balance_table() {
        let mut mob = d().mobs.values().next().unwrap().clone();
        (mob.hp_mult, mob.def_mult) = (None, None);
        for l in 1..d().c.max_level {
            mob.level = l;
            let s = mob_stats(&mob);
            let kills = xp_to_next(l) as f64 / mob_xp(&mob);
            // weapon P.Atk a fighter needs to drop a same-level mob in 12 hits: the target for gear tiers
            let weapon = s.max_hp * s.p_def / (70.0 * level_mod(l) * 12.0) - 4.0;
            println!("lvl {l:2}  xp {:7}  kills/lvl {kills:4.1}  mob hp {:5}  weapon for 12 hits {weapon:5.0}", xp_to_next(l), s.max_hp);
            assert!((2.0..=12.0).contains(&kills), "level {l}: {kills:.1} same-level kills to level up");
            assert!(xp_to_next(l) > xp_to_next(l - 1), "xp curve must grow at level {l}");
        }
        assert_eq!(xp_to_next(d().c.max_level), 0);
    }

    /// Every id the data points at exists: a typo in a drop or a spawn would otherwise only show up in play.
    #[test]
    fn data_refs() {
        let data = d();
        let item = |id: &str, at: &str| assert!(data.items.contains_key(id), "unknown item {id} in {at}");
        let mob = |id: &str, at: &str| assert!(data.mobs.contains_key(id), "unknown mob {id} in {at}");
        for m in data.mobs.values() {
            for dr in &m.drops { item(&dr.item, &m.id); }
            for ph in m.phases.iter().flatten() { if let Some(a) = &ph.adds { mob(&a.mob, &m.id); } }
        }
        for z in &data.zones { for s in &z.spawns { mob(&s.mob, &z.name); } }
        for n in &data.npcs {
            for s in n.shop.iter().flatten() { item(s, &n.id); }
            for c in n.craft.iter().flatten() { assert!(data.item(c).map_or(false, |i| i.craft.is_some()), "{} crafts {c}, which has no recipe", n.id); }
        }
        for i in data.items.values() { for (m, _) in i.craft.iter().flat_map(|r| &r.mats) { item(m, &i.id); } }
        for q in &data.quests {
            assert!(data.npc(&q.npc).is_some(), "unknown npc {} in {}", q.npc, q.id);
            match &q.objective { crate::data::Objective::Kill { mob: m, .. } => mob(m, &q.id), crate::data::Objective::Collect { item: i, .. } => item(i, &q.id) }
        }
        for r in data.raids.values() {
            mob(&r.boss, &r.id);
            if let Some(q) = &r.quest { assert!(data.quest(q).is_some(), "unknown quest {q} in {}", r.id); }
        }
        for s in &data.skills { if let Some(sp) = &s.spec { assert!(data.spec(sp).is_some(), "unknown spec {sp} in {}", s.id); } }
    }

    #[test]
    fn enchant() {
        assert_eq!(enchant_chance(0), 1.0);
        assert_eq!(enchant_chance(2), 1.0);
        assert!((enchant_chance(3) - 0.9).abs() < 1e-9 && (enchant_chance(9) - 0.3).abs() < 1e-9);
        let sword = &d().items["broadsword"];
        let at = |e| compute_stats("human", "fighter", 10, &[(sword, e)], &[], "m").p_atk;
        assert!(at(0) < at(3) && at(3) < at(10));
    }

    #[test]
    fn cdr_sums_and_caps() {
        let ring = &d().items["ring_of_swiftness"];
        let amulet = &d().items["amulet_of_haste"];
        let cdr = |eq: &[(&ItemDef, i64)]| compute_stats("human", "mystic", 10, eq, &[], "m").cdr;
        assert!((cdr(&[(ring, 0), (amulet, 0)]) - 0.15).abs() < 1e-9);
        assert!((cdr(&[(ring, 0); 11]) - 0.5).abs() < 1e-9, "55% of raw cdr must cap at 50%");
    }
}
