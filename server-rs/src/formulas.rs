//! Stats and combat math (port of shared/src/formulas.ts).
use crate::data::{d, BuffMods, ItemDef, MobDef, StatMods};
use rand::Rng;

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub max_hp: f64, pub max_mp: f64, pub max_cp: f64,
    pub p_atk: f64, pub m_atk: f64, pub p_def: f64, pub m_def: f64,
    pub accuracy: f64, pub evasion: f64, pub crit: f64,
    pub atk_interval: f64, pub cast_mul: f64, pub speed: f64,
    pub hp_regen: f64, pub mp_regen: f64, pub cp_regen: f64,
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

pub fn compute_stats(race: &str, cls: &str, level: i64, equipped: &[&ItemDef], buffs: &[&BuffMods], gender: &str) -> Stats {
    let r = stat_mods(race, gender);
    let c = &d().classes[cls];
    let lm = level_mod(level);
    let (mut w_p, mut w_m, mut arm_p, mut arm_m, mut mp_bonus) = (4.0, 4.0, 0.0, 0.0, 0.0);
    for it in equipped {
        if it.kind == "weapon" {
            w_p = it.p_atk.unwrap_or(0.0) + 4.0;
            w_m = it.m_atk.unwrap_or(0.0) + 4.0;
        } else {
            arm_p += it.p_def.unwrap_or(0.0);
            arm_m += it.m_def.unwrap_or(0.0);
        }
        mp_bonus += it.mp.unwrap_or(0.0);
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
    let max_hp = jround((c.base_hp + c.hp_lvl * lvl) * r.hp);
    let max_mp = jround((c.base_mp + c.mp_lvl * lvl) * r.mp + mp_bonus);
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
    }
}

pub fn mob_stats(m: &MobDef) -> Stats {
    let l = m.level as f64;
    let def = jround((30.0 + 3.0 * l) * m.def_mult.unwrap_or(1.0));
    Stats {
        max_hp: jround((50.0 + 15.0 * l + 1.5 * l * l) * m.hp_mult.unwrap_or(1.0)),
        p_atk: jround((4.0 + 3.0 * l) * m.atk_mult.unwrap_or(1.0)),
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

pub fn mob_xp(m: &MobDef) -> f64 { jround((25.0 * (m.level as f64).powf(1.9) + 5.0) * m.hp_mult.unwrap_or(1.0).powf(0.85)) }

pub fn level_penalty(player_lvl: i64, mob_lvl: i64) -> f64 {
    let diff = player_lvl - mob_lvl;
    if diff <= 5 { 1.0 } else { (1.0 - (diff - 5) as f64 * 0.2).max(0.05) }
}
