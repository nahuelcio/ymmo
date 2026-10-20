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

/** equipped: each worn piece with its enchant level (+N) and whether it is a Masterwork */
pub fn compute_stats(race: &str, cls: &str, level: i64, equipped: &[(&ItemDef, i64, bool)], buffs: &[&BuffMods], gender: &str) -> Stats {
    let r = stat_mods(race, gender);
    let c = &d().classes[cls];
    let cb = |f: &str, v: f64| bal(&format!("class.{cls}.{f}"), v);
    let ench = &d().enchant;
    let lm = level_mod(level);
    let (mut w_p, mut w_m, mut arm_p, mut arm_m, mut hp_bonus, mut mp_bonus, mut cdr_sum) = (4.0, 4.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut block, mut run, mut eva, mut quick) = (0.0, 0.0, 0.0, 0.0);
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
        if mw {
            let (a, c, cd) = masterwork_bonus(race, cls, it.kind == "weapon");
            mw_atk += a;
            mw_cast += c;
            cdr_sum += cd;
        }
    }
    let (mut bp, mut bpd, mut bm, mut bmd, mut bs, mut ba, mut bc) = (1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    let (mut b_crit, mut b_eva) = (0.0, 0.0);
    for b in buffs {
        b_crit += b.crit.unwrap_or(0.0);
        b_eva += b.evasion.unwrap_or(0.0);
        bp *= b.p_atk.unwrap_or(1.0);
        bpd *= b.p_def.unwrap_or(1.0);
        bm *= b.m_atk.unwrap_or(1.0);
        bmd *= b.m_def.unwrap_or(1.0);
        bs *= b.speed.unwrap_or(1.0);
        ba *= b.atk_spd.unwrap_or(1.0);
        bc *= b.cast_spd.unwrap_or(1.0);
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
        evasion: 30.0 + level as f64 + r.evasion + b_eva + eva,
        crit: (if cls == "fighter" { 8.0 } else { 4.0 }) + r.crit + b_crit,
        atk_interval: jround(c.atk_interval / (r.atk_spd * ba * (1.0 + mw_atk) * (1.0 + quick.min(0.2)))),
        cast_mul: 1.0 / (r.cast_spd * bc * (1.0 + mw_cast)),
        speed: BASE_SPEED * r.speed * bs * (1.0 + run.min(0.1)),
        hp_regen: max_hp * 0.008 + 0.5,
        mp_regen: max_mp * if mystic { 0.015 } else { 0.01 } + 0.3,
        cp_regen: max_cp * 0.03,
        cdr: cdr_sum.min(0.5), // ponytail: flat cap, half of every skill's recharge at most
        block,
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

/** A physical hit against a shield: caught on it when `roll` (0..1) falls under its block chance, and then it does half. */
pub fn block_hit(dmg: f64, block: f64, roll: f64) -> (f64, bool) {
    if block > 0.0 && roll < block { (jround(dmg * 0.5).max(1.0), true) } else { (dmg, false) }
}

pub fn magic_damage(m_atk: f64, m_def: f64, mult: f64, crit: bool) -> f64 {
    jround(((70.0 * m_atk) / m_def.max(1.0)) * mult * rand_range(0.92, 1.08) * if crit { 1.8 } else { 1.0 }).max(1.0)
}

pub fn xp_to_next(level: i64) -> i64 {
    if level >= d().c.max_level { return 0; }
    jround(80.0 * (level as f64).powf(2.2) * past_50(level)) as i64
}

/** Past level 50 each level asks progressively more, as in L2: x1 at 50 up to x3 at 77. */
fn past_50(level: i64) -> f64 { if level <= 50 { 1.0 } else { 1.0 + 2.0 * ((level - 50) as f64 / 27.0).powf(1.3) } }

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

    #[test]
    fn sacred_enchants_never_fail() {
        for e in 0..16 { assert!(enchant_roll(e, true, 0.999), "+{e}"); }
        assert!(!enchant_roll(5, false, 0.999));
        assert!(enchant_roll(2, false, 0.999)); // still safe below +3
        let sacred = d().items.values().filter(|i| i.enchant.as_deref() == Some("sacred")).count();
        assert_eq!(sacred, 1);
    }

    #[test]
    fn the_crossroads_is_full_pvp() {
        use crate::terrain::in_pvp_zone;
        assert!(in_pvp_zone(40.0, -800.0)); // the north crossroads
        assert!(in_pvp_zone(100.0, -750.0)); // where its world raid stands
        for t in &d().towns { assert!(!in_pvp_zone(t.x, t.z), "{}", t.name); }
        let tp = d().teleports.iter().find(|t| t.id == "warfront").unwrap();
        assert!(!in_pvp_zone(tp.x, tp.z), "the gatekeeper must not drop anyone flagged");
        let boss = &d().mobs["war_avatar"];
        assert!(boss.barrage.is_some() && boss.pulse.is_some() && boss.enrage.is_some());
        assert!(d().mobs.values().all(|m| m.id == "war_avatar" || m.level < boss.level), "the strongest boss in the game");
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
