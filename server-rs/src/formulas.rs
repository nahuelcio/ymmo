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
    /** the chance a physical hit is caught on the shield and does half its damage */
    pub block: f64,
    /** a critical hit's damage on top of its x2 (1: plain), the share of the damage dealt that heals (vampire), and of
     * the melee damage taken that goes back to whoever dealt it (reflect): the songs' and dances' */
    pub crit_dmg: f64, pub vampire: f64, pub reflect: f64,
}

pub const BASE_SPEED: f64 = 6.0;
pub const MELEE_RANGE: f64 = 2.2;
/** how often an auto-attack hit with a pair of swords gathers a Force charge */
pub const DUAL_CHARGE_CHANCE: f64 = 0.25;
/** how far a bow shoots (auto-attack) */
pub const BOW_RANGE: f64 = 15.0;

/** Whether an attacker at (ax, az) is behind a target at (tx, tz) facing `ry` (World::face: atan2(dx, dz)). */
pub fn is_behind(ax: f64, az: f64, tx: f64, tz: f64, ry: f64) -> bool {
    let (dx, dz) = (ax - tx, az - tz);
    let d = dx.hypot(dz);
    d > 1e-6 && (ry.sin() * dx + ry.cos() * dz) / d < -0.25
}
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

/**
 * Chance that a stun or slow from a skill lands: its base, 3% more or less per level the attacker is above or below
 * the target, kept within 10-90%. Bosses resist twice as well (never below 5%).
 */
pub fn land_chance(base: f64, att_level: i64, def_level: i64, boss: bool) -> f64 {
    let c = (base + 0.03 * (att_level - def_level) as f64).clamp(0.1, 0.9);
    if boss { (c * 0.5).max(0.05) } else { c }
}

/** Chance that enchanting a piece currently at +e succeeds. */
/** Whether an enchant from +e succeeds, for a roll in [0, 1): a sacred scroll always does. */
pub fn enchant_roll(e: i64, sacred: bool, roll: f64) -> bool { sacred || roll < enchant_chance(e) }

pub fn enchant_chance(e: i64) -> f64 {
    let c = &d().enchant;
    if e < c.safe { 1.0 } else { c.chance }
}

/**
 * What one Masterwork piece gives a wearer of this race and class: (attack speed, cast speed, cooldown cut), fractions.
 * A speed the class does not use turns into the one it does; a human gets half in the class's speed and half in
 * cooldown cut. Mirrors masterworkBonus in shared/src/data/items.ts.
 */
pub fn masterwork_bonus(race: &str, cls: &str, is_weapon: bool) -> (f64, f64, f64) {
    let m = &d().masterwork;
    let v = if is_weapon { m.weapon } else { m.piece };
    let speed = |f: f64| if cls == "mystic" { (0.0, f, 0.0) } else { (f, 0.0, 0.0) };
    match d().races[race].mw.as_str() {
        "cdr" => (0.0, 0.0, v),
        "mix" => { let (a, c, _) = speed(v / 2.0); (a, c, v / 2.0) }
        _ => speed(v),
    }
}

/** What worn gear adds on top of its stats, as buffs that never run out: each piece's own (a boss jewel's power), and
 * every bonus tier a set reaches with the pieces of it worn (SET_BONUS in shared/src/data/items.ts). */
pub fn gear_mods<'a>(equipped: &[(&'a ItemDef, i64, bool)]) -> Vec<&'a BuffMods> {
    let mut out: Vec<&BuffMods> = equipped.iter().filter_map(|(it, _, _)| it.mods.as_ref()).collect();
    let mut sets: Vec<(&str, usize)> = vec![];
    for (it, _, _) in equipped {
        let Some(s) = it.set.as_deref() else { continue };
        match sets.iter_mut().find(|(n, _)| *n == s) { Some(e) => e.1 += 1, None => sets.push((s, 1)) }
    }
    for (s, n) in sets {
        if let Some(tiers) = d().set_bonus.get(s) { out.extend(tiers.iter().filter(|t| t.pieces <= n).map(|t| &t.mods)); }
    }
    out
}

/** equipped: each worn piece with its enchant level (+N) and whether it is a Masterwork */
pub fn compute_stats(race: &str, cls: &str, level: i64, equipped: &[(&ItemDef, i64, bool)], buffs: &[&BuffMods], gender: &str) -> Stats {
    let r = stat_mods(race, gender);
    let c = &d().classes[cls];
    let cb = |f: &str, v: f64| bal(&format!("class.{cls}.{f}"), v);
    let ench = &d().enchant;
    let lm = level_mod(level);
    let (mut w_p, mut w_m, mut arm_p, mut arm_m, mut hp_bonus, mut mp_bonus, mut cdr_sum) = (4.0, 4.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut block, mut run, mut eva, mut quick, mut spell) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut mw_atk, mut mw_cast) = (0.0, 0.0);
    for &(it, e, mw) in equipped {
        let ib = |f: &str, v: Option<f64>| bal(&format!("item.{}.{f}", it.id), v.unwrap_or(0.0));
        if it.kind == "weapon" {
            let k = 1.0 + ench.weapon * e as f64;
            w_p = ib("pAtk", it.p_atk) * k + 4.0;
            w_m = ib("mAtk", it.m_atk) * k + 4.0;
        } else {
            let k = 1.0 + ench.armor * e as f64;
            arm_p += ib("pDef", it.p_def) * k;
            arm_m += ib("mDef", it.m_def) * k;
            block += ib("block", it.block) * k; // enchanting a shield makes it block a little more often
        }
        hp_bonus += ib("hp", it.hp);
        mp_bonus += ib("mp", it.mp);
        cdr_sum += ib("cdr", it.cdr);
        run += ib("speed", it.speed); // a cape's quicker stride: enchanting adds to its defences, not to this
        eva += ib("evasion", it.evasion); // the light armour's, enchanting neither
        quick += ib("atkSpd", it.atk_spd);
        spell += ib("castSpd", it.cast_spd); // a magic sword's quicker casting, enchanting neither
        if mw {
            let (a, c, cd) = masterwork_bonus(race, cls, it.kind == "weapon");
            mw_atk += a;
            mw_cast += c;
            cdr_sum += cd;
        }
    }
    let (mut bp, mut bpd, mut bm, mut bmd, mut bs, mut ba, mut bc) = (1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    let (mut b_crit, mut b_eva, mut b_acc, mut b_cdr, mut b_vamp, mut b_refl) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut b_hp, mut b_hpr, mut b_mpr, mut b_cd) = (1.0, 1.0, 1.0, 1.0);
    for b in buffs {
        b_crit += b.crit.unwrap_or(0.0);
        b_eva += b.evasion.unwrap_or(0.0);
        b_acc += b.accuracy.unwrap_or(0.0);
        b_cdr += b.cdr.unwrap_or(0.0);
        b_vamp += b.vampire.unwrap_or(0.0);
        b_refl += b.reflect.unwrap_or(0.0);
        b_hp *= b.max_hp.unwrap_or(1.0);
        b_hpr *= b.hp_regen.unwrap_or(1.0);
        b_mpr *= b.mp_regen.unwrap_or(1.0);
        b_cd *= b.crit_dmg.unwrap_or(1.0);
        bp *= b.p_atk.unwrap_or(1.0);
        bpd *= b.p_def.unwrap_or(1.0);
        bm *= b.m_atk.unwrap_or(1.0);
        bmd *= b.m_def.unwrap_or(1.0);
        bs *= b.speed.unwrap_or(1.0);
        ba *= b.atk_spd.unwrap_or(1.0);
        bc *= b.cast_spd.unwrap_or(1.0);
    }
    let lvl = (level - 1) as f64;
    let max_hp = jround(((cb("baseHp", c.base_hp) + cb("hpLvl", c.hp_lvl) * lvl) * r.hp + hp_bonus) * b_hp);
    let max_mp = jround((cb("baseMp", c.base_mp) + cb("mpLvl", c.mp_lvl) * lvl) * r.mp + mp_bonus);
    let max_cp = jround(max_hp * c.cp_ratio);
    let mystic = cls == "mystic";
    Stats {
        max_hp, max_mp, max_cp,
        p_atk: jround(w_p * lm * r.p_atk * bp),
        m_atk: jround(w_m * lm * r.m_atk * bm * if mystic { 1.0 } else { 0.6 }),
        p_def: jround((20.0 + arm_p) * lm * r.p_def * bpd),
        m_def: jround((15.0 + arm_m) * lm * r.m_def * bmd),
        accuracy: 80.0 + level as f64 + r.accuracy + b_acc,
        evasion: 30.0 + level as f64 + r.evasion + b_eva + eva,
        crit: (if cls == "fighter" { 8.0 } else { 4.0 }) + r.crit + b_crit,
        atk_interval: jround(c.atk_interval / (r.atk_spd * ba * (1.0 + mw_atk) * (1.0 + quick.min(0.2)))),
        cast_mul: 1.0 / (r.cast_spd * bc * (1.0 + mw_cast) * (1.0 + spell.min(0.2))),
        speed: BASE_SPEED * r.speed * bs * (1.0 + run.min(0.1)),
        hp_regen: (max_hp * 0.008 + 0.5) * b_hpr,
        mp_regen: (max_mp * if mystic { 0.015 } else { 0.01 } + 0.3) * b_mpr,
        cp_regen: max_cp * 0.03,
        cdr: (cdr_sum + b_cdr).min(0.5), // ponytail: flat cap, half of every skill's recharge at most
        block,
        crit_dmg: b_cd, vampire: b_vamp.min(0.5), reflect: b_refl.min(0.5),
    }
}

/** a mob's multiplier from game.json (1.0 when unset), or the panel's value for it */
fn mob_mult(m: &MobDef, f: &str, base: Option<f64>) -> f64 { bal(&format!("mob.{}.{f}", m.id), base.unwrap_or(1.0)) }

pub fn mob_stats(m: &MobDef) -> Stats {
    let l = m.level as f64;
    let def = jround((30.0 + 3.0 * l) * mob_mult(m, "defMult", m.def_mult));
    Stats {
        max_hp: jround((50.0 + 15.0 * l + 1.5 * l * l) * mob_mult(m, "hpMult", m.hp_mult)),
        // a player's P.Def (armour times level_mod) and HP both grow with level, so a hit's share of HP falls with their
        // product: the cubic keeps a same-level mob's bite (plain_mobs_bite_at_every_level); the line is the newbie zones
        p_atk: jround((4.0 + 3.0 * l + l.powi(3) / 180.0) * mob_mult(m, "atkMult", m.atk_mult)),
        p_def: def,
        m_def: def,
        accuracy: 80.0 + l,
        evasion: 30.0 + l,
        crit: 3.0,
        crit_dmg: 1.0,
        ..Default::default()
    }
}

pub fn rnd() -> f64 { rand::thread_rng().gen::<f64>() }
fn rand_range(a: f64, b: f64) -> f64 { a + rnd() * (b - a) }

pub fn hit_chance(accuracy: f64, evasion: f64) -> f64 { (0.9 + (accuracy - evasion - 50.0) * 0.01).clamp(0.6, 0.98) }

pub fn phys_damage(p_atk: f64, p_def: f64, mult: f64, crit: bool) -> f64 {
    jround(((70.0 * p_atk) / p_def.max(1.0)) * mult * rand_range(0.9, 1.1) * if crit { 2.0 } else { 1.0 }).max(1.0)
}

/** A physical hit against a shield: caught on it when `roll` (0..1) falls under its block chance, and then it does half. */
pub fn block_hit(dmg: f64, block: f64, roll: f64) -> (f64, bool) {
    if block > 0.0 && roll < block { (jround(dmg * 0.5).max(1.0), true) } else { (dmg, false) }
}

/** A critical hit's damage multiplied by the dealer's critical damage (Danza del Fuego), a plain hit's as it is. */
pub fn with_crit_dmg(dmg: f64, crit: bool, crit_dmg: f64) -> f64 { if crit { jround(dmg * crit_dmg).max(1.0) } else { dmg } }
/** What a vampire dealer heals of a hit, and what a reflecting body sends back of a melee blow. */
pub fn lifesteal(dmg: f64, vampire: f64) -> f64 { jround(dmg * vampire) }
pub fn reflected(dmg: f64, reflect: f64) -> f64 { jround(dmg * reflect) }

pub fn magic_damage(m_atk: f64, m_def: f64, mult: f64, crit: bool) -> f64 {
    jround(((70.0 * m_atk) / m_def.max(1.0)) * mult * rand_range(0.92, 1.08) * if crit { 1.8 } else { 1.0 }).max(1.0)
}

/**
 * What a heal skill restores, before a wound halves it. M.Atk grows with about level² (the staff and level_mod both
 * grow), max HP with level, so the heal takes the square root of the old 1 + M.Atk/100: a share of the target's HP
 * at every grade rather than a multiple of it. Pinned by heals_stay_a_share_of_hp.
 */
pub fn heal_amount(power: f64, m_atk: f64) -> f64 { jround(power * (1.0 + m_atk / 100.0).sqrt()) }

pub fn xp_to_next(level: i64) -> i64 {
    if level >= d().c.max_level { return 0; }
    jround(80.0 * (level as f64).powf(2.2) * past_50(level)) as i64
}

/** Past level 50 each level asks progressively more, as in L2: x1 at 50 up to x3 at 77. */
fn past_50(level: i64) -> f64 { if level <= 50 { 1.0 } else { 1.0 + 2.0 * ((level - 50) as f64 / 27.0).powf(1.3) } }

/** Where a ring goes, given what each hand wears (ring, ring2): over the same jewel if it is on already (never one on
 * both hands), else the first free hand, else over the first hand's ring. */
pub fn ring_slot(ring: Option<&str>, ring2: Option<&str>, id: &str) -> &'static str {
    if ring == Some(id) { "ring" } else if ring2 == Some(id) { "ring2" } else if ring.is_none() { "ring" } else if ring2.is_none() { "ring2" } else { "ring" }
}

/** Argentina's time zone, where the server's days and weeks turn (UTC-3, no daylight saving). */
const ART_MS: f64 = 3.0 * 3_600_000.0;

/** The server day (ms since epoch): a new one at 00:00 in Argentina. The daily contracts and the Rift's paid run go by it. */
pub fn loot_day(now_ms: f64) -> i64 { ((now_ms - ART_MS) / 86_400_000.0).floor() as i64 }

/** When the next server day begins (ms since epoch), for the clients' countdown. */
pub fn next_day_at(now_ms: f64) -> f64 { (loot_day(now_ms) + 1) as f64 * 86_400_000.0 + ART_MS }

/** The week a boss jewel's roll belongs to (ms since epoch): a new one every Monday at 00:00 in Argentina (UTC-3). */
pub fn loot_week(now_ms: f64) -> i64 {
    // 1970-01-01 was a Thursday: three days on, the weeks start on Mondays
    (loot_day(now_ms) + 3).div_euclid(7)
}

/** This week's fort siege (shared/src/data/sieges.ts SIEGE): when it starts and ends (ms since epoch). The week is
 * loot_week's, the one that began on Monday, so it is Saturday 21:00 to 22:00 in Argentina. */
pub fn siege_window(now_ms: f64) -> (f64, f64) {
    let s = &d().siege;
    let monday = loot_week(now_ms) * 7 - 3;
    let start = (monday + s.weekday) as f64 * 86_400_000.0 + ART_MS + s.hour * 3_600_000.0;
    (start, start + s.minutes * 60_000.0)
}

/** When the next siege starts (this week's unless it is over), for the clients. */
pub fn next_siege_at(now_ms: f64) -> f64 {
    let (start, end) = siege_window(now_ms);
    if now_ms < end { start } else { siege_window(now_ms + 7.0 * 86_400_000.0).0 }
}

/** XP from Legend level `n` to the next, at the level cap: half of 77 to 78 for the first, 5% more each one after;
 * 0 once the Legend is full. */
pub fn legend_to_next(n: i64) -> i64 {
    if n >= d().legend.max { return 0; }
    jround(xp_to_next(d().c.max_level - 1) as f64 * (0.5 + 0.05 * n as f64)) as i64
}

/** The Legend's passives at these ranks, as one buff: every rank adds a multiplier's share (10 ranks of x1.01 are
 * x1.10) or its points once more. */
pub fn legend_mods(ranks: &std::collections::HashMap<String, i64>) -> BuffMods {
    let mut out = BuffMods::default();
    let mul = |acc: &mut Option<f64>, per: Option<f64>, r: f64| if let Some(v) = per { *acc = Some(acc.unwrap_or(1.0) + (v - 1.0) * r) };
    let add = |acc: &mut Option<f64>, per: Option<f64>, r: f64| if let Some(v) = per { *acc = Some(acc.unwrap_or(0.0) + v * r) };
    for p in &d().legend.passives {
        let r = ranks.get(&p.id).copied().unwrap_or(0).clamp(0, p.max) as f64;
        if r == 0.0 { continue; }
        let m = &p.mods;
        mul(&mut out.p_atk, m.p_atk, r); mul(&mut out.p_def, m.p_def, r); mul(&mut out.m_atk, m.m_atk, r); mul(&mut out.m_def, m.m_def, r);
        mul(&mut out.speed, m.speed, r); mul(&mut out.atk_spd, m.atk_spd, r); mul(&mut out.cast_spd, m.cast_spd, r);
        mul(&mut out.max_hp, m.max_hp, r); mul(&mut out.hp_regen, m.hp_regen, r); mul(&mut out.mp_regen, m.mp_regen, r); mul(&mut out.crit_dmg, m.crit_dmg, r);
        add(&mut out.crit, m.crit, r); add(&mut out.evasion, m.evasion, r); add(&mut out.cdr, m.cdr, r); add(&mut out.accuracy, m.accuracy, r);
        add(&mut out.vampire, m.vampire, r); add(&mut out.reflect, m.reflect, r);
    }
    out
}

pub fn mob_xp(m: &MobDef) -> f64 { jround((25.0 * (m.level as f64).powf(1.9) + 5.0) * mob_mult(m, "hpMult", m.hp_mult).powf(0.85)) }

pub fn level_penalty(player_lvl: i64, mob_lvl: i64) -> f64 {
    let diff = player_lvl - mob_lvl;
    if diff <= 5 { 1.0 } else { (1.0 - (diff - 5) as f64 * 0.2).max(0.05) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stuns_and_slows_land_by_level() {
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert!(near(land_chance(0.6, 40, 40, false), 0.6));
        assert!(near(land_chance(0.6, 45, 40, false), 0.75)); // 3% a level above
        assert!(near(land_chance(0.6, 35, 40, false), 0.45)); // and below
        assert!(near(land_chance(0.6, 80, 40, false), 0.9)); // never sure
        assert!(near(land_chance(0.6, 1, 40, false), 0.1)); // never hopeless
        assert!(near(land_chance(0.6, 40, 40, true), 0.3)); // bosses resist twice as well
        assert!(near(land_chance(0.6, 1, 40, true), 0.05));
    }

    #[test]
    fn shields_block_by_grade() {
        let data = d();
        let it = |id: &str| data.item(id).unwrap();
        let block = |id: &str, e: i64| compute_stats("human", "fighter", 20, &[(it(id), e, false)], &[], "m").block;
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert_eq!(compute_stats("human", "fighter", 20, &[], &[], "m").block, 0.0);
        assert!(near(block("wooden_buckler", 0), 0.12)); // a buckler is small
        assert!(near(block("brigandine_shield", 0), 0.15));
        assert!(near(block("full_plate_shield", 0), 0.18));
        for (p, b) in [("abyssal", 0.18), ("ashforged", 0.18), ("dragon", 0.21), ("glacial", 0.24), ("emerald", 0.27), ("infernal", 0.3)] {
            assert!(near(block(&format!("{p}_shield"), 0), b), "{p}");
        }
        assert!(near(block("infernal_shield", 4), 0.3 * 1.2)); // enchanting: 5% more of it a level
        // the knights block half again as often (Player::recalc), nobody else does
        assert_eq!(data.spec("knight").unwrap().block, Some(1.5));
        assert_eq!(data.spec("phoenix_knight").unwrap().block, Some(1.5));
        assert_eq!(data.spec("gladiator").unwrap().block, None);
        // what is held in both hands, and so takes no shield
        for w in ["willow_staff", "staff_of_life", "sages_staff", "infernal_staff", "spear", "partisan", "battle_axe", "war_hammer", "samurai_longsword"] {
            assert_eq!(it(w).two_handed, Some(true), "{w}");
        }
        for w in ["apprentice_wand", "short_sword", "infernal_blade", "dagger", "iron_hammer", "hand_axe"] { assert!(it(w).two_handed.is_none(), "{w}"); }
    }

    #[test]
    fn capes_guard_a_little_and_quicken_the_stride() {
        let data = d();
        let it = |id: &str| data.item(id).unwrap();
        let stats = |eq: &[(&ItemDef, i64, bool)]| compute_stats("human", "fighter", 20, eq, &[], "m");
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        let bare = stats(&[]);
        for (p, g, sp) in [("abyssal", "D", 0.025), ("ashforged", "D", 0.025), ("dragon", "C", 0.03), ("glacial", "B", 0.035), ("emerald", "A", 0.04), ("infernal", "S", 0.05)] {
            let cape = it(&format!("{p}_cape"));
            assert_eq!(cape.slot.as_deref(), Some("cape"), "{p}");
            assert_eq!(cape.grade.as_deref(), Some(g), "{p}");
            assert!(near(cape.speed.unwrap(), sp), "{p}");
            let worn = stats(&[(cape, 0, false)]);
            assert!(near(worn.speed, bare.speed * (1.0 + sp)), "{p}");
            assert!(worn.p_def > bare.p_def && worn.m_def > bare.m_def, "{p}");
            // enchanting adds to its defences, not to its speed
            let plus = stats(&[(cape, 6, false)]);
            assert!(near(plus.speed, worn.speed) && plus.p_def > worn.p_def, "{p}");
        }
        for (id, sp) in [("wool_cape", 0.015), ("hunter_cape", 0.02), ("knight_cape", 0.025)] {
            assert!(near(stats(&[(it(id), 0, false)]).speed, bare.speed * (1.0 + sp)), "{id}");
        }
    }

    #[test]
    fn cleric_buffs_last_and_divine_grace_quickens_casting() {
        let data = d();
        let buff = |id: &str| data.skill(id).and_then(|s| s.buff.clone()).unwrap();
        for id in ["holy_shield", "might", "haste", "sanctuary", "blessing_of_ages"] {
            assert_eq!(buff(id).dur, 1_200_000.0, "{id}");
        }
        let grace = buff("divine_grace");
        assert_eq!(grace.dur, 300_000.0);
        let cast = |buffs: &[&BuffMods]| compute_stats("human", "mystic", 76, &[], buffs, "m").cast_mul;
        assert!((cast(&[]) / cast(&[&grace.mods]) - 1.15).abs() < 1e-9);
    }

    /// The PvP zones' scrolls (NG from the Campo de Huesos, D from the Hondonada de los Aullidos, C from the Grieta de las
    /// Brasas, B from the Llanos de la Ventisca, A from the Corazón de la Ciénaga) only enchant their own grade, and a
    /// piece of it spends one before a plain scroll.
    #[test]
    fn graded_scrolls_enchant_their_grade() {
        use crate::inventory::pick_scroll;
        let it = |id: &str| d().item(id).unwrap();
        let (w, wc, a) = (it("scroll_enchant_weapon"), it("scroll_enchant_weapon_c"), it("scroll_enchant_armor"));
        let wd = it("scroll_enchant_weapon_d");
        assert_eq!((wc.grade.as_deref(), wd.grade.as_deref()), (Some("C"), Some("D")));
        assert_eq!(pick_scroll([wc, wd, w].into_iter(), "weapon", Some("D")).unwrap().id, wd.id, "a D piece takes the D scroll");
        assert_eq!(pick_scroll([wd].into_iter(), "weapon", Some("C")).err(), Some(Some("D")), "never a D scroll on C gear");
        let (wb, wa) = (it("scroll_enchant_weapon_b"), it("scroll_enchant_weapon_a"));
        assert_eq!((wb.grade.as_deref(), wa.grade.as_deref()), (Some("B"), Some("A")));
        assert_eq!(pick_scroll([wa, wb, wc, w].into_iter(), "weapon", Some("B")).unwrap().id, wb.id, "a B piece takes the B scroll");
        assert_eq!(pick_scroll([wa, wb, wc, w].into_iter(), "weapon", Some("A")).unwrap().id, wa.id, "an A piece takes the A scroll");
        assert_eq!(pick_scroll([wa].into_iter(), "weapon", Some("B")).err(), Some(Some("A")), "never an A scroll on B gear");
        let wng = it("scroll_enchant_weapon_ng");
        assert_eq!(it("short_sword").grade.as_deref(), Some("NG"), "the starter sword has no grade");
        assert_eq!(pick_scroll([w, wd, wng].into_iter(), "weapon", Some("NG")).unwrap().id, wng.id, "the starter sword takes the NG scroll");
        assert_eq!(pick_scroll([wng].into_iter(), "weapon", Some("D")).err(), Some(Some("NG")), "never an NG scroll on D gear");
        assert_eq!(pick_scroll([w, wc].into_iter(), "weapon", Some("C")).unwrap().id, wc.id, "its own grade's first");
        assert_eq!(pick_scroll([wc, w].into_iter(), "weapon", Some("C")).unwrap().id, wc.id, "whatever the bag's order");
        assert_eq!(pick_scroll([w, wc].into_iter(), "weapon", Some("D")).unwrap().id, w.id, "another grade takes the plain one");
        assert_eq!(pick_scroll([wc].into_iter(), "weapon", Some("D")).err(), Some(Some("C")), "never a C scroll on D gear");
        assert_eq!(pick_scroll([wc, a].into_iter(), "weapon", None).err(), Some(Some("C")), "nor on ungraded gear");
        assert_eq!(pick_scroll([a].into_iter(), "weapon", Some("C")).err(), Some(None), "nor an armour scroll on a weapon");
    }

    #[test]
    fn sacred_enchants_never_fail() {
        for e in 0..16 { assert!(enchant_roll(e, true, 0.999), "+{e}"); }
        assert!(!enchant_roll(5, false, 0.999));
        assert!(enchant_roll(2, false, 0.999)); // still safe below +3
        let sacred = d().items.values().filter(|i| i.enchant.as_deref() == Some("sacred")).count();
        assert_eq!(sacred, 1);
    }

    #[test]
    fn the_pvp_zones_are_full_pvp() {
        use crate::terrain::in_pvp_zone;
        assert!(in_pvp_zone(40.0, -800.0)); // the north crossroads
        for t in &d().towns { assert!(!in_pvp_zone(t.x, t.z), "{}", t.name); }
        // the Encrucijada Sangrienta (76+), the Corazón de la Ciénaga (61-70), the Llanos de la Ventisca (52-60), the
        // Grieta de las Brasas (40-48), the Hondonada de los Aullidos (22-30) and the Campo de Huesos (12-20)
        let pvp: Vec<_> = d().zones.iter().filter(|z| z.pvp == Some(true)).collect();
        assert_eq!(pvp.len(), 6);
        for zn in pvp {
            assert!(in_pvp_zone(zn.x, zn.z), "{}: its world raid stands in the middle", zn.name);
            let tp = d().teleports.iter().find(|t| t.name.starts_with(&zn.name)).unwrap();
            assert!(!in_pvp_zone(tp.x, tp.z), "{}: the gatekeeper must not drop anyone flagged", zn.name);
            let boss = zn.spawns.iter().map(|s| &d().mobs[&s.mob]).find(|m| m.boss == Some(true)).unwrap();
            assert!(boss.barrage.is_some() && boss.pulse.is_some() && boss.enrage.is_some(), "{}", boss.id);
        }
        let avatar = &d().mobs["war_avatar"];
        assert!(d().mobs.values().all(|m| m.id == "war_avatar" || m.level < avatar.level), "the strongest boss in the game");
    }

    #[test]
    fn behind_is_the_back_half() {
        // a target at the origin facing +z (ry 0): an attacker at -z is behind it, at +z in front, at the side neither
        assert!(is_behind(0.0, -2.0, 0.0, 0.0, 0.0));
        assert!(!is_behind(0.0, 2.0, 0.0, 0.0, 0.0));
        assert!(!is_behind(2.0, 0.0, 0.0, 0.0, 0.0));
        // facing +x (ry pi/2): behind is -x
        assert!(is_behind(-2.0, 0.1, 0.0, 0.0, std::f64::consts::FRAC_PI_2));
    }

    #[test]
    fn archers_and_assassins() {
        let data = d();
        for (spec, weapon) in [("archer", "bow"), ("sharpshooter", "bow"), ("assassin", "dagger"), ("shade", "dagger")] {
            let s = data.spec(spec).unwrap();
            assert_eq!(s.weapon.as_deref(), Some(weapon), "{spec}");
            let n = data.skills.iter().filter(|k| k.spec.as_deref() == Some(spec)).count();
            assert!(n >= 3, "{spec} has {n} skills");
            assert!(data.skills.iter().filter(|k| k.spec.as_deref() == Some(spec)).all(|k| k.weapon.as_deref() == Some(weapon)), "{spec}'s skills ask for a {weapon}");
        }
        assert_eq!(data.spec("sharpshooter").unwrap().parent.as_deref(), Some("archer"));
        assert_eq!(data.spec("shade").unwrap().parent.as_deref(), Some("assassin"));
        for set in ["abyssal", "ashforged", "dragon", "glacial", "emerald", "infernal"] {
            assert_eq!(data.item(&format!("{set}_bow")).unwrap().weapon_type.as_deref(), Some("bow"));
            assert_eq!(data.item(&format!("{set}_dagger")).unwrap().weapon_type.as_deref(), Some("dagger"));
        }
        // a buff's crit and evasion are points added
        let focus = data.skill("focus").unwrap().buff.clone().unwrap();
        let base = compute_stats("human", "fighter", 60, &[], &[], "m");
        let buffed = compute_stats("human", "fighter", 60, &[], &[&focus.mods], "m");
        assert!((buffed.crit - base.crit - 15.0).abs() < 1e-9);
    }

    #[test]
    fn light_armour_dodges_and_quickens() {
        let data = d();
        let set = ["infernal_hood", "infernal_jerkin", "infernal_bracers", "infernal_leggings", "infernal_treads"].map(|id| data.item(id).unwrap());
        let plate = ["infernal_helm", "infernal_plate", "infernal_gauntlets", "infernal_greaves", "infernal_boots"].map(|id| data.item(id).unwrap());
        let wear = |items: &[&crate::data::ItemDef]| compute_stats("human", "fighter", 78, &items.iter().map(|i| (*i, 0, false)).collect::<Vec<_>>(), &[], "m");
        let (light, heavy, bare) = (wear(&set), wear(&plate), wear(&[]));
        assert!(light.p_def < heavy.p_def, "less P.Def than the plate");
        assert!(light.evasion > bare.evasion + 15.0, "S-grade light armour: +18 evasion");
        assert!(light.atk_interval < bare.atk_interval, "and a quicker hand");
        assert!(set.iter().all(|i| i.slot.is_some()));
    }

    /// L2's Swordsinger and Bladedancer: songs and dances for the whole party around, the dances with a pair of swords.
    #[test]
    fn songs_and_dances_for_the_party() {
        let data = d();
        assert_eq!(data.spec("sword_muse").unwrap().parent.as_deref(), Some("swordsinger"));
        assert_eq!(data.spec("spectral_dancer").unwrap().parent.as_deref(), Some("bladedancer"));
        assert_eq!(data.spec("bladedancer").unwrap().weapon.as_deref(), Some("dual"));
        for (spec, n) in [("swordsinger", 13), ("sword_muse", 3), ("bladedancer", 13), ("spectral_dancer", 3)] {
            let skills: Vec<_> = data.skills.iter().filter(|k| k.spec.as_deref() == Some(spec)).collect();
            assert_eq!(skills.len(), n, "{spec}'s skills");
            let dancer = spec.contains("dancer");
            for k in &skills {
                if dancer { assert_eq!(k.weapon.as_deref(), Some("dual"), "{}: a dance asks for a pair", k.id); }
                if k.kind == "buff" {
                    assert_eq!(k.target, "self", "{}", k.id);
                    assert!(k.aoe.unwrap_or(0.0) >= 15.0, "{}: the whole party around", k.id);
                    assert_eq!(k.buff.as_ref().unwrap().dur, 300000.0, "{}: 5 minutes", k.id);
                }
            }
        }
        // the new buff stats
        let base = compute_stats("human", "fighter", 50, &[], &[], "m");
        let m = |f: fn(&mut BuffMods)| { let mut b = BuffMods::default(); f(&mut b); compute_stats("human", "fighter", 50, &[], &[&b], "m") };
        assert!((m(|b| b.max_hp = Some(1.15)).max_hp / base.max_hp - 1.15).abs() < 0.01, "Vitalidad");
        assert!((m(|b| b.hp_regen = Some(1.5)).hp_regen / base.hp_regen - 1.5).abs() < 1e-9, "Vida");
        assert!((m(|b| b.mp_regen = Some(1.5)).mp_regen / base.mp_regen - 1.5).abs() < 1e-9, "Meditación");
        assert_eq!(m(|b| b.accuracy = Some(6.0)).accuracy, base.accuracy + 6.0, "Inspiración");
        assert_eq!(m(|b| b.cdr = Some(0.15)).cdr, 0.15, "Renovación");
        assert_eq!(m(|b| b.cdr = Some(0.9)).cdr, 0.5, "cooldowns stay capped at half");
        assert_eq!(base.crit_dmg, 1.0);
        assert_eq!(with_crit_dmg(100.0, true, m(|b| b.crit_dmg = Some(1.35)).crit_dmg), 135.0, "Fuego: a crit hurts more");
        assert_eq!(with_crit_dmg(100.0, false, 1.35), 100.0, "a plain hit does not");
        assert_eq!(lifesteal(500.0, m(|b| b.vampire = Some(0.08)).vampire), 40.0, "Vampiro");
        assert_eq!(reflected(500.0, m(|b| b.reflect = Some(0.2)).reflect), 100.0, "Venganza");
    }

    /// The PvP zone's world raid has to take a full party: a tank, healers to keep it up through the wounds its blows
    /// leave, and damage to drop it before the enrage. Measured on a level 78 tank and mage in the full Infernal sets.
    #[test]
    fn war_avatar_needs_a_party() {
        let data = d();
        let gear = |ids: &[&str]| -> Vec<(&ItemDef, i64, bool)> { ids.iter().map(|k| (data.item(k).unwrap(), 0, false)).collect() };
        let set = |s: &str, ks: &[&str]| -> Vec<String> { ks.iter().map(|k| format!("{s}_{k}")).collect() };
        let plate = ["helm", "plate", "gauntlets", "greaves", "boots", "shield", "cape", "ring", "earring", "necklace", "blade"];
        let robe = ["circlet", "robe", "gloves", "greaves", "shoes", "cape", "ring", "earring", "necklace", "staff"];
        let build = |cls: &str, lvl: i64, ids: Vec<String>| { let r: Vec<&str> = ids.iter().map(|s| s.as_str()).collect(); compute_stats("human", cls, lvl, &gear(&r), &[], "m") };
        let tank = build("fighter", 78, set("infernal", &plate));
        let mage = build("mystic", 78, set("infernal", &robe));
        let tank71 = build("fighter", 71, set("emerald", &plate));
        let boss_def = data.mobs["war_avatar"].clone();
        let boss = mob_stats(&boss_def);
        let herald = mob_stats(&data.mobs["war_herald"]);
        // a hit's share of the target's HP, on average (phys_damage without its +-10%)
        let share = |p_atk: f64, t: &Stats, mult: f64| 70.0 * p_atk / t.p_def * mult / t.max_hp;
        let special = boss_def.special.as_ref().unwrap().mult;
        let barrage = boss_def.barrage.as_ref().unwrap().mult;
        let ph50 = boss_def.phases.iter().flatten().find(|p| p.at == 50.0).unwrap();
        let (special50, barrage50) = (ph50.special.as_ref().unwrap().mult, ph50.barrage.as_ref().unwrap().mult);
        let enrage = boss_def.enrage.as_ref().unwrap().atk;
        println!("tank 78: P.Def {} HP {} | mage 78: P.Def {} HP {} | tank 71: P.Def {} HP {} | boss P.Atk {}", tank.p_def, tank.max_hp, mage.p_def, mage.max_hp, tank71.p_def, tank71.max_hp, boss.p_atk);
        for (what, p_atk, mult) in [("auto", boss.p_atk, 1.0), ("special", boss.p_atk, special), ("special 50%", boss.p_atk, special50), ("barrage", boss.p_atk, barrage),
                                    ("barrage 50%", boss.p_atk, barrage50), ("enraged auto", boss.p_atk * enrage, 1.0), ("herald", herald.p_atk, 1.0)] {
            println!("{what:>13}: tank {:5.0} ({:3.0}%)  mage {:5.0} ({:3.0}%)  tank 71 {:3.0}%", 70.0 * p_atk / tank.p_def * mult, 100.0 * share(p_atk, &tank, mult),
                     70.0 * p_atk / mage.p_def * mult, 100.0 * share(p_atk, &mage, mult), 100.0 * share(p_atk, &tank71, mult));
        }
        let auto = share(boss.p_atk, &tank, 1.0);
        assert!((0.3..=0.45).contains(&auto), "its blows take a real bite of a tank: {auto:.2}");
        assert!((0.5..=0.75).contains(&share(boss.p_atk, &mage, 1.0)), "and a mage cannot take them");
        assert!(share(boss.p_atk, &tank71, 1.0) >= 0.3, "a level 71 tank feels them too");
        for m in [special, special50] { assert!(share(boss.p_atk, &tank, m) < 0.8, "its special hurts the tank, it does not kill it outright"); }
        for m in [barrage, barrage50] { assert!((0.7..=0.95).contains(&share(boss.p_atk, &mage, m)), "a circle on a mage nearly kills it"); }
        assert!((0.1..=0.2).contains(&share(herald.p_atk, &mage, 1.0)), "a pack of heralds kills a healer left alone");
        assert!(share(boss.p_atk * enrage, &tank, 1.0) >= 1.0, "enraged, it kills a tank in a blow");
        let oh = boss_def.on_hit.as_ref().unwrap();
        assert_eq!((oh.id.as_str(), oh.chance.unwrap_or(1.0)), ("wound", 1.0), "every blow wounds");
        assert_eq!(crate::ent::WOUND_HEAL, 0.5);
        // wounded, the cleric's quick heal undoes about one of its blows: one healer falls behind, two keep up
        let mended = heal_amount(data.skill("divine_heal").unwrap().power, mage.m_atk) * crate::ent::WOUND_HEAL / tank.max_hp;
        assert!((1.0..=1.3).contains(&(mended / auto)), "a divine heal on a wounded tank against one blow: {:.2}", mended / auto);
    }

    /// What a world raid check dresses its tank (`plate`) and its mage (`robe`) in: a graded set's pieces (set_kit), or the
    /// best pieces of the grade that has no set (NG, the Campo de Huesos').
    struct Kit { name: &'static str, plate: Vec<String>, robe: Vec<String> }

    fn set_kit(set: &'static str) -> Kit {
        let of = |ks: &[&str]| -> Vec<String> { ks.iter().map(|k| format!("{set}_{k}")).collect() };
        Kit { name: set, plate: of(&["helm", "plate", "gauntlets", "greaves", "boots", "shield", "cape", "ring", "earring", "necklace", "blade"]),
              robe: of(&["circlet", "robe", "gloves", "greaves", "shoes", "cape", "ring", "earring", "necklace", "staff"]) }
    }

    /// A PvP zone's world raid takes a full party of its levels, as the Avatar takes one of 78: a tank, two healers
    /// through the damage over time its blows leave (`status`), and damage to drop it before the enrage. Measured on a
    /// tank and a mage of `level` in `kit`, and a tank of `weak` in `weak_kit`; `add` is the add its phases call.
    /// `cargo test needs_a_party -- --nocapture` prints the tables.
    fn world_raid_needs_a_party(boss_id: &str, add: &str, status: &str, level: i64, kit: Kit, weak: i64, weak_kit: Kit) {
        let data = d();
        let gear = |ids: &[&str]| -> Vec<(&ItemDef, i64, bool)> { ids.iter().map(|k| (data.item(k).unwrap(), 0, false)).collect() };
        let build = |cls: &str, lvl: i64, ids: &[String]| { let r: Vec<&str> = ids.iter().map(|s| s.as_str()).collect(); compute_stats("human", cls, lvl, &gear(&r), &[], "m") };
        let tank = build("fighter", level, &kit.plate);
        let mage = build("mystic", level, &kit.robe);
        let tank40 = build("fighter", weak, &weak_kit.plate);
        let boss_def = data.mobs[boss_id].clone();
        let boss = mob_stats(&boss_def);
        let whelp = mob_stats(&data.mobs[add]);
        let share = |p_atk: f64, t: &Stats, mult: f64| 70.0 * p_atk / t.p_def * mult / t.max_hp;
        // every blow leaves its damage over time, a tick a second of dot times the blow: a blow and its DoT until the next
        let oh = boss_def.on_hit.as_ref().unwrap();
        assert_eq!((oh.id.as_str(), oh.chance.unwrap_or(1.0)), (status, 1.0), "{boss_id}: every blow leaves its {status}");
        let burnt = 1.0 + oh.dot.unwrap() * boss_def.atk_interval / 1000.0;
        let special = boss_def.special.as_ref().unwrap().mult;
        let barrage = boss_def.barrage.as_ref().unwrap().mult;
        let ph50 = boss_def.phases.iter().flatten().find(|p| p.at == 50.0).unwrap();
        let (special50, barrage50) = (ph50.special.as_ref().unwrap().mult, ph50.barrage.as_ref().unwrap().mult);
        let enrage = boss_def.enrage.as_ref().unwrap();
        println!("{boss_id} | tank {level}: P.Def {} HP {} | mage {level}: P.Def {} HP {} | tank {weak}: P.Def {} HP {} | boss P.Atk {} HP {}", tank.p_def, tank.max_hp, mage.p_def, mage.max_hp, tank40.p_def, tank40.max_hp, boss.p_atk, boss.max_hp);
        for (what, p_atk, mult) in [("auto + dot", boss.p_atk, burnt), ("special", boss.p_atk, special), ("special 50%", boss.p_atk, special50), ("barrage", boss.p_atk, barrage),
                                    ("barrage 50%", boss.p_atk, barrage50), ("enraged auto", boss.p_atk * enrage.atk, 1.0), ("add", whelp.p_atk, 1.0)] {
            println!("{what:>13}: tank {:3.0}%  mage {:3.0}%  weak tank {:3.0}%", 100.0 * share(p_atk, &tank, mult), 100.0 * share(p_atk, &mage, mult), 100.0 * share(p_atk, &tank40, mult));
        }
        let auto = share(boss.p_atk, &tank, burnt);
        assert!((0.3..=0.45).contains(&auto), "{boss_id}: a blow and its {status} take a real bite of a tank: {auto:.2}");
        assert!((0.5..=0.75).contains(&share(boss.p_atk, &mage, burnt)), "{boss_id}: and a mage cannot take them");
        assert!(share(boss.p_atk, &tank40, burnt) >= 0.3, "{boss_id}: a level {weak} tank in {} feels them too", weak_kit.name);
        for m in [special, special50] { assert!(share(boss.p_atk, &tank, m) < 0.8, "{boss_id}: its special hurts the tank, it does not kill it outright"); }
        for m in [barrage, barrage50] { assert!((0.7..=0.95).contains(&share(boss.p_atk, &mage, m)), "{boss_id}: a circle on a mage nearly kills it"); }
        assert!((0.1..=0.2).contains(&share(whelp.p_atk, &mage, 1.0)), "{boss_id}: a pack of its adds kills a healer left alone");
        assert!(share(boss.p_atk * enrage.atk, &tank, 1.0) >= 1.0, "{boss_id}: enraged, it kills a tank in a blow");
        // its blows land fast: a cleric healing the tank with its two strongest heals of that level on cooldown (not the
        // minute-long Miracle) falls behind, two keep up
        let mut cures: Vec<_> = data.skills.iter()
            .filter(|s| s.kind == "heal" && s.target == "friend" && s.aoe.is_none() && s.level <= level && s.cooldown <= 20000.0
                && (s.spec.as_deref() == Some("cleric") || (s.spec.is_none() && s.cls.as_deref() == Some("mystic"))))
            .collect();
        cures.sort_by(|a, b| b.power.partial_cmp(&a.power).unwrap());
        let heals: f64 = cures.iter().take(2).map(|s| heal_amount(s.power, mage.m_atk) / tank.max_hp / (s.cooldown / 1000.0)).sum();
        let taken = auto / (boss_def.atk_interval / 1000.0);
        println!("one cleric heals {:.0}% of the tank a second, the boss takes {:.0}%", 100.0 * heals, 100.0 * taken);
        assert!((0.6..=0.9).contains(&(heals / taken)), "{boss_id}: one cleric against its blows and their {status}: {:.2}", heals / taken);
        // and it takes a party to drop it before the enrage: a fighter's blows and skills, about twice its auto-attack's
        // damage, crits counted; the tank swings too, the healers do not
        let dps = |s: &Stats, skills: f64| 70.0 * s.p_atk / boss.p_def * (1.0 + s.crit / 100.0) * skills / (s.atk_interval / 1000.0);
        let dealer = build("fighter", level, &kit.plate.iter().filter(|id| !id.ends_with("shield")).cloned().collect::<Vec<_>>());
        let secs = |dealers: f64| boss.max_hp / (dealers * dps(&dealer, 2.0) + dps(&tank, 1.0));
        let (full, four) = (secs(6.0), secs(2.0));
        println!("a party of 9 (6 dealers): {full:.0} s | of 4 (2 dealers): {four:.0} s | enrage at {} s", enrage.after / 1000.0);
        assert!((300.0..=480.0).contains(&full), "{boss_id}: a full party drops it in 5 to 8 minutes: {full:.0} s");
        assert!(four > enrage.after / 1000.0, "{boss_id}: four players meet the enrage first: {four:.0} s");
    }

    /// The Grieta de las Brasas' (40-48, C grade): level 45 players in the dragon set, a level 40 tank in the Ashforged one.
    #[test]
    fn ignaroth_needs_a_party() { world_raid_needs_a_party("ignaroth", "ember_whelp", "burn", 45, set_kit("dragon"), 40, set_kit("ashforged")); }

    /// The Hondonada de los Aullidos' (22-30, D grade): level 27 players in the Ashforged set, a level 22 tank in the
    /// Abyssal one.
    #[test]
    fn lycan_king_needs_a_party() { world_raid_needs_a_party("lycan_king", "pack_lycan", "bleed", 27, set_kit("ashforged"), 22, set_kit("abyssal")); }

    /// The Llanos de la Ventisca's (52-60, B grade): level 56 players in the Glacial set, a level 52 tank in the dragon one.
    #[test]
    fn ymirak_needs_a_party() { world_raid_needs_a_party("ymirak", "blizzard_yeti", "frostbite", 56, set_kit("glacial"), 52, set_kit("dragon")); }

    /// The Corazón de la Ciénaga's (61-70, A grade): level 65 players in the Emerald set, a level 61 tank in the Glacial one.
    #[test]
    fn ancient_treant_needs_a_party() { world_raid_needs_a_party("ancient_treant", "treant_sapling", "poison", 65, set_kit("emerald"), 61, set_kit("glacial")); }

    /// The Campo de Huesos' (12-20, no grade): level 17 players in the best gear without a grade (what Morvak drops), a
    /// level 12 tank in the starter pieces.
    #[test]
    fn skeleton_king_needs_a_party() {
        let ids = |ks: &[&str]| -> Vec<String> { ks.iter().map(|k| k.to_string()).collect() };
        let jewels = ["ring_of_vigor", "earring_of_focus", "necklace_of_valor"];
        let best = Kit {
            name: "the best NG",
            plate: ids(&[&["brigandine_helm", "brigandine_tunic", "reinforced_gloves", "brigandine_gaiters", "reinforced_boots", "brigandine_shield", "hunter_cape", "sword_of_revolution"][..], &jewels].concat()),
            robe: ids(&[&["karmian_hat", "karmian_tunic", "reinforced_gloves", "karmian_stockings", "reinforced_boots", "hunter_cape", "staff_of_life"][..], &jewels].concat()),
        };
        let starter = Kit { name: "the starter pieces", plate: ids(&["leather_cap", "apprentice_tunic", "short_gloves", "apprentice_stockings", "leather_sandals", "wooden_buckler", "wool_cape", "short_sword"]), robe: vec![] };
        world_raid_needs_a_party("skeleton_king", "risen_skeleton", "bleed", 17, best, 12, starter);
    }

    /// Resting out of combat: sitting down (on the ground or a bench) recovers 2.5 times faster than standing, a tent 4
    /// times (1.6 times a seat); a fight slows it all. The travelers' tents are there to rest in.
    #[test]
    fn tents_rest_better_than_sitting() {
        use crate::data::NodeKind;
        use crate::player::regen_mul;
        let data = d();
        let of = |k: NodeKind| data.nodes.iter().filter(|(_, n)| n.kind == k).map(|(&id, _)| id).collect::<Vec<_>>();
        let (tents, seats) = (of(NodeKind::Tent), of(NodeKind::Seat));
        assert!(tents.len() >= 50, "tents to rest in by the roads: {}", tents.len());
        let (fight, stand, ground, bench, rest) =
            (regen_mul(true, Some(tents[0])), regen_mul(false, None), regen_mul(false, Some(0)), regen_mul(false, Some(seats[0])), regen_mul(false, Some(tents[0])));
        assert!(fight < stand && stand < ground && ground == bench && bench < rest, "{fight} {stand} {ground} {bench} {rest}");
        assert!((rest / bench - 1.6).abs() < 1e-9, "a tent is 1.6 seats: {}", rest / bench);
        assert_eq!(rest / stand, 4.0);
    }

    /// A hut by the roads (and in the hills) rests four at once twice as fast as a tent; every one has a door to go in by.
    #[test]
    fn huts_rest_twice_a_tent() {
        use crate::data::NodeKind;
        use crate::player::regen_mul;
        let data = d();
        let of = |k: NodeKind| data.nodes.iter().filter(|(_, n)| n.kind == k).map(|(&id, _)| id).collect::<Vec<_>>();
        let (huts, tents) = (of(NodeKind::Hut), of(NodeKind::Tent));
        assert!(huts.len() >= 25, "huts to rest in: {}", huts.len());
        let (stand, tent, hut) = (regen_mul(false, None), regen_mul(false, Some(tents[0])), regen_mul(false, Some(huts[0])));
        assert_eq!(hut / tent, 2.0);
        assert_eq!(hut / stand, 8.0);
        assert!(regen_mul(true, Some(huts[0])) < stand, "a fight slows it as anywhere");
        assert_eq!(data.c.hut_cap, 4);
    }

    /// Past the cap the Legend's bar starts at half of 77 to 78 and asks 5% more each level, up to a full Legend whose
    /// passives take every point (8 of 10 ranks).
    #[test]
    fn legend_bar_and_tree() {
        let data = d();
        assert_eq!(xp_to_next(data.c.max_level), 0, "the level cap stays the cap");
        let half = jround(xp_to_next(data.c.max_level - 1) as f64 * 0.5) as i64;
        assert_eq!(legend_to_next(0), half);
        for n in 0..data.legend.max - 1 { assert!(legend_to_next(n + 1) > legend_to_next(n), "{n}"); }
        assert_eq!(legend_to_next(data.legend.max), 0, "a full Legend asks for nothing");
        assert_eq!(data.legend.passives.iter().map(|p| p.max).sum::<i64>(), data.legend.max, "the tree takes every point");
    }

    /// Ranks add up: 10 of Might are x1.10 P.Atk, 4 of Edge +2 crit, 2 of Renewal x1.06 regen; unspent passives add nothing.
    #[test]
    fn legend_ranks_add_up() {
        let ranks: std::collections::HashMap<String, i64> = [("might", 10), ("edge", 4), ("renewal", 2)].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        let m = legend_mods(&ranks);
        assert!((m.p_atk.unwrap() - 1.10).abs() < 1e-9 && (m.crit.unwrap() - 2.0).abs() < 1e-9);
        assert!((m.hp_regen.unwrap() - 1.06).abs() < 1e-9 && (m.mp_regen.unwrap() - 1.06).abs() < 1e-9);
        assert!(m.m_atk.is_none() && m.max_hp.is_none(), "no ranks, no bonus");
        // more ranks than a passive has count as its max
        let over = legend_mods(&[("might".to_string(), 99)].into_iter().collect());
        assert!((over.p_atk.unwrap() - 1.10).abs() < 1e-9);
        let base = compute_stats("human", "fighter", 78, &[], &[], "m");
        let strong = compute_stats("human", "fighter", 78, &[], &[&m], "m");
        assert!((strong.p_atk / base.p_atk - 1.10).abs() < 0.02, "{} vs {}", strong.p_atk, base.p_atk);
        assert!(strong.crit - base.crit == 2.0);
    }

    /// Worn gear's own buffs: a boss jewel's mods, and each Infernal tier once 2, 4 and 5 of its armour pieces are on.
    #[test]
    fn jewels_and_set_bonus() {
        let data = d();
        let worn = |ids: &[&str]| ids.iter().map(|id| (data.item(id).unwrap_or_else(|| panic!("{id}")), 0, false)).collect::<Vec<_>>();
        assert_eq!(gear_mods(&worn(&["infernal_helm"])).len(), 0, "one piece is no set");
        assert_eq!(gear_mods(&worn(&["infernal_helm", "infernal_plate", "infernal_greaves"])).len(), 1);
        assert_eq!(gear_mods(&worn(&["infernal_helm", "infernal_plate", "infernal_greaves", "infernal_gauntlets"])).len(), 2);
        let full = worn(&["infernal_hood", "infernal_jerkin", "infernal_leggings", "infernal_bracers", "infernal_treads", "infernal_ring", "infernal_cape"]);
        assert_eq!(gear_mods(&full).len(), 3, "any of the set's lines, jewels and cape not counted");
        let jewels = worn(&["necklace_of_azgaroth", "ring_of_ssithra"]);
        assert_eq!(gear_mods(&jewels).len(), 2);
        let bm = gear_mods(&jewels);
        let with = compute_stats("human", "fighter", 78, &jewels, &bm, "m");
        let without = compute_stats("human", "fighter", 78, &jewels, &[], "m");
        assert!(with.p_atk > without.p_atk && with.vampire > 0.0 && with.cdr > without.cdr);
        // every boss with a jewel names one that exists, worn where a jewel goes
        for m in data.mobs.values().filter_map(|m| m.jewel.as_ref()) {
            let it = data.item(&m.item).unwrap_or_else(|| panic!("{}", m.item));
            assert!(matches!(it.slot.as_deref(), Some("ring" | "earring" | "amulet")) && it.mods.is_some(), "{}", m.item);
        }
    }

    /// Two rings: the first free hand, never the same jewel twice, the first hand's ring swapped when both are on.
    #[test]
    fn rings_go_on_either_hand() {
        assert_eq!(ring_slot(None, None, "a"), "ring");
        assert_eq!(ring_slot(Some("a"), None, "b"), "ring2");
        assert_eq!(ring_slot(Some("a"), None, "a"), "ring", "the same ring does not go on the other hand");
        assert_eq!(ring_slot(None, Some("a"), "a"), "ring2");
        assert_eq!(ring_slot(None, Some("a"), "b"), "ring");
        assert_eq!(ring_slot(Some("a"), Some("b"), "c"), "ring");
        assert_eq!(ring_slot(Some("a"), Some("b"), "b"), "ring2");
    }

    /// A server day turns at 00:00 in Argentina (03:00 UTC); the countdown points at that moment.
    #[test]
    fn days_turn_at_midnight_argentina() {
        let midnight = 1_704_078_000_000.0; // Monday 2024-01-01 00:00 UTC-3
        let day = loot_day(midnight);
        assert_eq!(loot_day(midnight - 1.0), day - 1);
        assert_eq!(loot_day(midnight + 86_400_000.0 - 1.0), day);
        assert_eq!(next_day_at(midnight - 1.0), midnight);
        assert_eq!(next_day_at(midnight + 3_600_000.0), midnight + 86_400_000.0);
    }

    /// The forts are sieged on Saturday from 21:00 to 22:00, Argentina time, the whole week long pointing at it.
    #[test]
    fn sieges_on_saturday_night() {
        let monday = 1_704_078_000_000.0; // Monday 2024-01-01 00:00 UTC-3
        let (sat, hour) = (monday + 5.0 * 86_400_000.0 + 21.0 * 3_600_000.0, 3_600_000.0);
        for t in [monday, sat - 1.0, sat + 1_800_000.0, monday + 7.0 * 86_400_000.0 - 1.0] { assert_eq!(siege_window(t), (sat, sat + hour)); }
        assert_eq!(siege_window(monday + 7.0 * 86_400_000.0).0, sat + 7.0 * 86_400_000.0, "a new week, a new siege");
        assert_eq!(next_siege_at(monday), sat);
        assert_eq!(next_siege_at(sat + 1_800_000.0), sat, "still on");
        assert_eq!(next_siege_at(sat + hour), sat + 7.0 * 86_400_000.0, "over: next Saturday's");
    }

    /// Each day offers three different contracts of the daily pool, the same for everyone, and they change over the days;
    /// the client's dailySet (shared/src/data/quests.ts, run by the export as dailyProbe) offers the very same ones.
    #[test]
    fn three_contracts_a_day() {
        let data = d();
        assert_eq!(data.daily_probe.len(), 7, "the export's probe of the client's picks");
        for (day, ids) in &data.daily_probe {
            assert_eq!(&data.daily_set(*day).iter().map(|q| q.id.clone()).collect::<Vec<_>>(), ids, "day {day}: the client offers other contracts");
        }
        let pool = data.quests.iter().filter(|q| q.daily).count();
        assert!(pool >= 6, "a pool to pick from: {pool}");
        let mut seen = std::collections::HashSet::new();
        for day in 20_000..20_030 {
            let set = data.daily_set(day);
            assert_eq!(set.len(), crate::data::DAILY_COUNT);
            assert_eq!(set.iter().map(|q| &q.id).collect::<std::collections::HashSet<_>>().len(), 3, "three different on day {day}");
            assert_eq!(set.iter().map(|q| &q.id).collect::<Vec<_>>(), data.daily_set(day).iter().map(|q| &q.id).collect::<Vec<_>>(), "the same for everyone");
            for q in set { seen.insert(q.id.clone()); }
        }
        assert_eq!(seen.len(), pool, "a month offers every contract");
    }

    /// A jewel's week turns on Monday at 00:00 in Argentina (03:00 UTC), and lasts until Sunday 23:59.
    #[test]
    fn loot_weeks_start_on_monday() {
        // Monday 2024-01-01 00:00 UTC-3
        let monday = 1_704_078_000_000.0;
        let w = loot_week(monday);
        assert_eq!(loot_week(monday - 1.0), w - 1, "Sunday night is the week before");
        assert_eq!(loot_week(monday + 7.0 * 86_400_000.0 - 1.0), w, "until Sunday 23:59");
        assert_eq!(loot_week(monday + 7.0 * 86_400_000.0), w + 1);
    }

    /// Ymirak's Congelación slows like a slow (and deals damage over time like a bleed, through tick_statuses).
    #[test]
    fn frostbite_slows() {
        use crate::ent::{ActiveStatus, Common, SLOW_MUL};
        let mut c = Common::new(1, 0.0, 0.0);
        assert_eq!(c.speed_mul(0.0), 1.0);
        c.statuses.insert("frostbite".into(), ActiveStatus { until: 6000.0, src: 2, dps: 10.0, next_tick: 1000.0 });
        assert_eq!(c.speed_mul(0.0), SLOW_MUL);
        assert_eq!(c.speed_mul(7000.0), 1.0, "and lets go when it wears off");
        assert_eq!(d().status_flag("frostbite"), 32768, "the last bit the u16 flags hold");
    }

    /// A same-level plain mob has to matter at every level, not only in the newbie zones: mob_stats' cubic P.Atk keeps up
    /// with a player's P.Def times HP. Measured on a human tank in its grade's plate and a mage in its robe, +0, at every
    /// level. `cargo test plain_mobs -- --nocapture` prints the table.
    #[test]
    fn plain_mobs_bite_at_every_level() {
        let data = d();
        let gear = |ids: &[String]| -> Vec<(&ItemDef, i64, bool)> { ids.iter().map(|k| (data.item(k).unwrap(), 0, false)).collect() };
        let own = |ks: &[&str]| -> Vec<String> { ks.iter().map(|k| k.to_string()).collect() };
        let set = |s: &str| -> (Vec<String>, Vec<String>) {
            let f = |ks: &[&str]| ks.iter().map(|k| format!("{s}_{k}")).collect();
            (f(&["helm", "plate", "gauntlets", "greaves", "boots", "shield", "cape", "ring", "earring", "necklace", "blade"]),
             f(&["circlet", "robe", "gloves", "greaves", "shoes", "cape", "ring", "earring", "necklace", "staff"]))
        };
        // no grade has no named set: its best heavy and light pieces
        let ng = (own(&["brigandine_helm", "brigandine_tunic", "brigandine_gaiters", "reinforced_gloves", "reinforced_boots", "brigandine_shield",
                        "hunter_cape", "ring_of_vigor", "earring_of_focus", "necklace_of_valor", "sword_of_revolution"]),
                  own(&["karmian_hat", "karmian_tunic", "karmian_stockings", "reinforced_gloves", "reinforced_boots", "hunter_cape",
                        "ring_of_vigor", "earring_of_focus", "necklace_of_valor", "staff_of_life"]));
        let mut mob = data.mobs["keltir"].clone();
        (mob.hp_mult, mob.def_mult, mob.atk_mult) = (None, None, None);
        for l in 1..=data.c.max_level {
            let (plate, robe) = match l {
                1..=19 => ng.clone(),
                20..=29 => set("abyssal"),
                30..=39 => set("ashforged"),
                40..=51 => set("dragon"),
                52..=60 => set("glacial"),
                61..=74 => set("emerald"),
                _ => set("infernal"),
            };
            let (plate, robe) = (gear(&plate), gear(&robe));
            assert!(plate.iter().chain(&robe).all(|g| data.wear_level(g.0) <= l), "level {l} can wear its set");
            let tank = compute_stats("human", "fighter", l, &plate, &[], "m");
            let mage = compute_stats("human", "mystic", l, &robe, &[], "m");
            mob.level = l;
            let p_atk = mob_stats(&mob).p_atk;
            // a hit's share of the target's HP, on average (phys_damage without its +-10%)
            let share = |t: &Stats| 70.0 * p_atk / t.p_def / t.max_hp;
            let (t, m) = (share(&tank), share(&mage));
            println!("lvl {l:2}  mob P.Atk {p_atk:5}  tank {:4.1}%  mage {:4.1}%", 100.0 * t, 100.0 * m);
            assert!((0.04..=0.09).contains(&t), "level {l}: a same-level mob takes {:.1}% of a tank a hit", 100.0 * t);
            assert!((0.06..=0.14).contains(&m) && m > t, "level {l}: and {:.1}% of a mage", 100.0 * m);
        }
    }

    /// A heal restores a share of a same-level tank's HP at every grade, not a multiple of it (heal_amount). Measured
    /// on a human tank and mystic in each grade's sets at both ends of its levels. `cargo test heals_stay -- --nocapture`
    /// prints the table.
    #[test]
    fn heals_stay_a_share_of_hp() {
        let data = d();
        let plate = ["helm", "plate", "gauntlets", "greaves", "boots", "shield", "cape", "ring", "earring", "necklace", "blade"];
        let robe = ["circlet", "robe", "gloves", "greaves", "shoes", "cape", "ring", "earring", "necklace", "staff"];
        let build = |cls: &str, lvl: i64, s: &str, ks: &[&str]| {
            let eq: Vec<(&ItemDef, i64, bool)> = ks.iter().map(|k| (data.item(&format!("{s}_{k}")).unwrap(), 0, false)).collect();
            compute_stats("human", cls, lvl, &eq, &[], "m")
        };
        // the share of the target's HP each heal restores
        let bands = [("heal", 0.25, 0.35), ("greater_heal", 0.5, 0.7), ("divine_heal", 0.7, 0.9), ("mass_heal", 0.35, 0.45),
                     ("restoration", 0.85, 1.15), ("miracle", 1.3, 1.7), ("divine_light", 1.8, 2.2), ("grand_miracle", 0.9, 1.1),
                     ("last_stand", 0.4, 0.6), ("rebirth", 0.9, 1.1), ("second_wind", 0.15, 0.3)];
        for k in data.skills.iter().filter(|k| k.kind == "heal") { assert!(bands.iter().any(|b| b.0 == k.id), "{}: give it a band here", k.id); }
        for (lvl, s) in [(20, "abyssal"), (30, "ashforged"), (39, "ashforged"), (40, "dragon"), (51, "dragon"), (52, "glacial"), (60, "glacial"),
                         (61, "emerald"), (74, "emerald"), (75, "infernal"), (78, "infernal")] {
            let (tank, mage) = (build("fighter", lvl, s, &plate), build("mystic", lvl, s, &robe));
            let mut line = format!("lvl {lvl} {s:>9}: tank HP {:4}, M.Atk {:4} |", tank.max_hp, mage.m_atk);
            for &(id, lo, hi) in &bands {
                let k = data.skill(id).unwrap();
                if k.level > lvl { continue; }
                // a self-heal (the knights' and the human's) is the fighter's own: their M.Atk, on their HP
                let caster = if k.target == "self" { &tank } else { &mage };
                let share = heal_amount(k.power, caster.m_atk) / tank.max_hp;
                line += &format!(" {id} {:.0}%", 100.0 * share);
                assert!((lo..=hi).contains(&share), "level {lvl}: {id} heals {:.0}% of a tank's HP", 100.0 * share);
            }
            println!("{line}");
        }
        // gear and buffs still count, at about half their M.Atk: a +6 staff, or the hierophant's own three buffs
        let staff = data.item("infernal_staff").unwrap();
        let buffs: Vec<&BuffMods> = ["blessing", "blessing_of_ages", "divine_grace"].iter().map(|b| &data.skill(b).unwrap().buff.as_ref().unwrap().mods).collect();
        let m_atk = |e: i64, b: &[&BuffMods]| compute_stats("human", "mystic", 78, &[(staff, e, false)], b, "m").m_atk;
        for (what, m) in [("a +6 staff", m_atk(6, &[])), ("the buffs", m_atk(0, &buffs))] {
            let gain = heal_amount(100.0, m) / heal_amount(100.0, m_atk(0, &[]));
            assert!((1.15..=1.3).contains(&gain), "{what}: {gain:.2}x the heal");
        }
    }

    #[test]
    fn a_mystic_can_hold_a_magic_sword_and_a_shield() {
        let data = d();
        let mut last = 0.0;
        for set in ["abyssal", "ashforged", "dragon", "glacial", "emerald", "infernal"] {
            let sword = data.item(&format!("{set}_spellblade")).unwrap();
            let staff = data.item(&format!("{set}_staff")).unwrap();
            assert!(!sword.two_handed.unwrap_or(false), "{set}: a shield goes with it");
            let (sm, tm) = (sword.m_atk.unwrap(), staff.m_atk.unwrap());
            assert!((sm - tm * 0.8).abs() <= 1.0, "{set}: a fifth less M.Atk than the staff ({sm} against {tm})");
            let cast = sword.cast_spd.unwrap();
            assert!(cast > last, "{set}: casts quicker than the sets before it");
            last = cast;
        }
        assert_eq!(last, 0.1, "the infernal one: 10%");
        let sword = data.item("infernal_spellblade").unwrap();
        let cast = |eq: &[(&ItemDef, i64, bool)]| compute_stats("human", "mystic", 76, eq, &[], "m").cast_mul;
        assert!((cast(&[]) / cast(&[(sword, 0, false)]) - 1.1).abs() < 1e-9, "it casts 10% quicker");
        assert_eq!(cast(&[(sword, 0, false)]), cast(&[(sword, 10, false)]), "enchanting it does not");
    }

    #[test]
    fn gladiators_fight_with_a_pair() {
        let data = d();
        for spec in ["gladiator", "duelist"] {
            let skills: Vec<_> = data.skills.iter().filter(|k| k.spec.as_deref() == Some(spec)).collect();
            assert!(skills.len() >= 3, "{spec}");
            assert!(skills.iter().all(|k| k.weapon.as_deref() == Some("dual")), "{spec}'s skills ask for a pair");
            assert!(skills.iter().all(|k| k.spend.unwrap_or(0) <= data.spec(spec).unwrap().charges.unwrap()), "{spec} can hold what its skills spend");
        }
        assert_eq!(data.spec("gladiator").unwrap().charges, Some(5));
        assert_eq!(data.spec("duelist").unwrap().charges, Some(8));
        assert!(data.skills.iter().any(|k| k.charge.is_some()), "something gathers charges");
        let pairs: Vec<_> = data.items.values().filter(|i| i.weapon_type.as_deref() == Some("dual")).collect();
        assert!(pairs.len() >= 10);
        for p in pairs {
            let sword = p.pair.as_deref().unwrap();
            assert_eq!(p.two_handed, Some(true), "{}", p.id);
            let rec = p.craft.as_ref().unwrap();
            assert_eq!(rec.mats, vec![(sword.to_string(), 2)], "{}: two of its sword", p.id);
            assert!(data.npcs.iter().any(|n| n.craft.iter().flatten().any(|c| c == &p.id)), "a blacksmith joins {}", p.id);
        }
    }

    #[test]
    fn a_blacksmith_never_melts_an_enchanted_sword() {
        use crate::ent::InvItem;
        use crate::inventory::{count_mat_in, take_gear_in};
        let row = |u, e, m| InvItem { u, i: "infernal_blade".into(), c: 1, s: None, e, l: false, m };
        let mut inv = vec![row(1, 10, false), row(2, 0, false), row(3, 0, true), row(4, 0, false)];
        assert_eq!(count_mat_in(&inv, "infernal_blade"), 2, "the +10 and the Masterwork do not count");
        assert!(take_gear_in(&mut inv, "infernal_blade", 2));
        assert_eq!(inv.iter().map(|i| i.u).collect::<Vec<_>>(), vec![1, 3], "the +10 and the Masterwork are still there");
    }

    #[test]
    fn a_block_halves_the_hit() {
        assert_eq!(block_hit(100.0, 0.3, 0.1), (50.0, true));
        assert_eq!(block_hit(100.0, 0.3, 0.5), (100.0, false));
        assert_eq!(block_hit(101.0, 0.3, 0.29), (51.0, true)); // rounded as the game rounds
        assert_eq!(block_hit(1.0, 0.3, 0.0), (1.0, true)); // never below 1
        assert_eq!(block_hit(100.0, 0.0, 0.0), (100.0, false)); // no shield, no block
        let blocked = (0..10000).filter(|_| block_hit(100.0, 0.3, rnd()).1).count();
        assert!((2700..3300).contains(&blocked), "{blocked}");
    }

    #[test]
    fn levels_go_to_78_slower_past_50() {
        assert_eq!(d().c.max_level, 78);
        assert_eq!(xp_to_next(78), 0);
        assert!(xp_to_next(77) > 0);
        // up to 50 the curve is the one it always was
        assert_eq!(xp_to_next(50), jround(80.0 * 50f64.powf(2.2)) as i64);
        assert!((past_50(77) - 3.0).abs() < 1e-9);
        for l in 1..77 { assert!(xp_to_next(l + 1) > xp_to_next(l), "{l}"); }
    }

    #[test]
    fn grades_ask_for_a_level() {
        let data = d();
        let lvl = |id: &str| data.wear_level(data.item(id).unwrap());
        assert_eq!(lvl("short_sword"), 0);
        assert_eq!(lvl("brigandine_tunic"), 0); // once D, now NG
        assert_eq!(lvl("samurai_longsword"), 20); // once C, now D
        assert_eq!(lvl("abyssal_blade"), 20); // once B
        assert_eq!(lvl("ashforged_blade"), 20); // once A
        assert_eq!(lvl("dragon_blade"), 40); // once S, now C
        for g in ["NG", "D", "C", "B", "A", "S"] { assert!(data.grade_level.contains_key(g), "{g}"); }
        assert_eq!(data.grade_level["S"], 75);
    }


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
            // up to 50, 2-12 same-level kills a level; past it the slower L2-style curve stretches that up to x3
            assert!((2.0..=12.0 * past_50(l)).contains(&kills), "level {l}: {kills:.1} same-level kills to level up");
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
        for z in data.zones.iter().chain(&data.herds) { for s in &z.spawns { mob(&s.mob, &z.name); } }
        for n in &data.npcs {
            for s in n.shop.iter().flatten() { item(s, &n.id); }
            // a shop in another currency prices everything it sells in it
            if let Some(c) = &n.currency {
                item(c, &n.id);
                for s in n.shop.iter().flatten() { assert!(n.prices.get(s).map_or(false, |&p| p > 0), "{} sells {s} with no price in {c}", n.id); }
            }
            for c in n.craft.iter().flatten() { assert!(data.item(c).map_or(false, |i| i.craft.is_some()), "{} crafts {c}, which has no recipe", n.id); }
        }
        for i in data.items.values() { for (m, _) in i.craft.iter().flat_map(|r| &r.mats) { item(m, &i.id); } }
        for q in &data.quests {
            assert!(data.npc(&q.npc).is_some(), "unknown npc {} in {}", q.npc, q.id);
            match &q.objective {
                crate::data::Objective::Kill { mob: m, .. } => mob(m, &q.id),
                crate::data::Objective::Collect { item: i, .. } => item(i, &q.id),
                crate::data::Objective::KillAny { mobs, .. } => for m in mobs { mob(m, &q.id) },
                crate::data::Objective::Camp { camp, .. } => assert!(data.camp(camp).is_some(), "unknown camp {camp} in {}", q.id),
                crate::data::Objective::Rift { floor, count } => assert!(*floor >= 1 && *count == 1 && data.raids.values().any(|r| r.rift), "{}", q.id),
            }
            for (i, _) in &q.rewards { item(i, &q.id); }
            // a daily contract's giver is the board; a board gives nothing else
            assert_eq!(q.daily, data.npc(&q.npc).map_or(false, |n| n.kind == "board"), "{}: daily contracts, and only they, come from the board", q.id);
        }
        for r in data.raids.values() {
            // a boss, or the Rift's waves
            match &r.boss { Some(b) => mob(b, &r.id), None => assert!(r.rift, "{} has no boss", r.id) }
            if let Some(q) = &r.quest { assert!(data.quest(q).is_some(), "unknown quest {q} in {}", r.id); }
        }
        for m in crate::rift::TRASH.iter().chain(crate::rift::ELITES.iter()) { mob(m, "the Rift"); }
        for s in &data.skills { if let Some(sp) = &s.spec { assert!(data.spec(sp).is_some(), "unknown spec {sp} in {}", s.id); } }
    }

    #[test]
    fn enchant() {
        // as in L2: safe up to +3, then a flat 66% for every step up to +16
        assert_eq!(d().enchant.max, 16);
        assert_eq!(enchant_chance(0), 1.0);
        assert_eq!(enchant_chance(2), 1.0);
        for e in 3..16 { assert!((enchant_chance(e) - 0.66).abs() < 1e-9, "+{e}"); }
        let sword = &d().items["broadsword"];
        let at = |e| compute_stats("human", "fighter", 10, &[(sword, e, false)], &[], "m").p_atk;
        assert!(at(0) < at(3) && at(3) < at(10));
    }

    #[test]
    fn cdr_sums_and_caps() {
        let ring = &d().items["ring_of_swiftness"];
        let amulet = &d().items["amulet_of_haste"];
        let cdr = |eq: &[(&ItemDef, i64, bool)]| compute_stats("human", "mystic", 10, eq, &[], "m").cdr;
        assert!((cdr(&[(ring, 0, false), (amulet, 0, false)]) - 0.15).abs() < 1e-9);
        assert!((cdr(&[(ring, 0, false); 11]) - 0.5).abs() < 1e-9, "55% of raw cdr must cap at 50%");
    }

    #[test]
    fn masterwork_by_race() {
        let is = |got: (f64, f64, f64), want: (f64, f64, f64)| {
            assert!((got.0 - want.0).abs() < 1e-9 && (got.1 - want.1).abs() < 1e-9 && (got.2 - want.2).abs() < 1e-9, "{got:?} != {want:?}");
        };
        is(masterwork_bonus("dwarf", "fighter", true), (0.06, 0.0, 0.0));
        is(masterwork_bonus("orc", "fighter", false), (0.01, 0.0, 0.0));
        is(masterwork_bonus("darkelf", "fighter", true), (0.0, 0.0, 0.06));
        // a speed the class does not use turns into the one it does
        is(masterwork_bonus("elf", "mystic", true), (0.0, 0.06, 0.0));
        is(masterwork_bonus("elf", "fighter", true), (0.06, 0.0, 0.0));
        is(masterwork_bonus("orc", "mystic", true), (0.0, 0.06, 0.0));
        // a human: half in the class's speed, half in cooldown cut
        is(masterwork_bonus("human", "fighter", true), (0.03, 0.0, 0.03));
        is(masterwork_bonus("human", "mystic", false), (0.0, 0.005, 0.005));
        // worn: a dwarf's Masterwork axe swings 6% faster, an elf's Masterwork staff casts 6% faster
        let axe = &d().items["hand_axe"];
        let swing = |mw| compute_stats("dwarf", "fighter", 10, &[(axe, 0, mw)], &[], "m").atk_interval;
        assert!((swing(false) / swing(true) - 1.06).abs() < 0.01, "{} / {}", swing(false), swing(true));
        let staff = &d().items["willow_staff"];
        let cast = |mw| compute_stats("elf", "mystic", 10, &[(staff, 0, mw)], &[], "m").cast_mul;
        assert!((cast(false) / cast(true) - 1.06).abs() < 1e-9);
        // the cooldown cut still caps at 50%
        let ring = &d().items["ring_of_swiftness"];
        assert!((compute_stats("darkelf", "mystic", 10, &[(ring, 0, true); 11], &[], "m").cdr - 0.5).abs() < 1e-9);
    }
}
