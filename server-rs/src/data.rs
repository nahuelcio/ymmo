//! Game data exported from shared/src by scripts/export-data.ts (one source of truth with the client).
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Deserialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Constants {
    #[serde(rename = "PLAYABLE_HALF")]
    pub playable_half: f64,
    #[serde(rename = "STAND_UP_MS")]
    pub stand_up_ms: f64,
    /** out-of-combat regen, times standing: sitting down, and resting in a tent or a hut (shared/src/nodes.ts) */
    #[serde(rename = "SIT_REGEN")]
    pub sit_regen: f64,
    #[serde(rename = "TENT_REGEN")]
    pub tent_regen: f64,
    #[serde(rename = "HUT_REGEN")]
    pub hut_regen: f64,
    /** how many rest in one hut */
    #[serde(rename = "HUT_CAP")]
    pub hut_cap: usize,
    #[serde(rename = "SWIM_SPEED")]
    pub swim_speed: f64,
    #[serde(rename = "WALK_RADIUS")]
    pub walk_radius: f64,
    #[serde(rename = "START_ADENA")]
    pub start_adena: i64,
    #[serde(rename = "MAX_LEVEL")]
    pub max_level: i64,
    #[serde(rename = "SPEC_LEVEL")]
    pub spec_level: i64,
    /** from this level on PvP mode is always on (combat.rs set_pvp_mode) */
    #[serde(rename = "PVP_LEVEL")]
    pub pvp_level: i64,
    #[serde(rename = "HAIR_STYLES")]
    pub hair_styles: i64,
    #[serde(rename = "HAIR_COLORS")]
    pub hair_colors: i64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Town { pub x: f64, pub z: f64, pub r: f64, pub name: String, pub name_en: String }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Named { pub name: String, pub name_en: String }

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemUse { pub hp: Option<f64>, pub mp: Option<f64>, pub escape: Option<bool>, pub cd: f64 }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemDef {
    pub id: String,
    pub name: String,
    pub name_en: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub slot: Option<String>,
    pub grade: Option<String>,
    /** the grade it was before the level 78 cap re-graded it (and is still drawn as) */
    pub look: Option<String>,
    pub p_atk: Option<f64>,
    pub m_atk: Option<f64>,
    pub p_def: Option<f64>,
    pub m_def: Option<f64>,
    pub hp: Option<f64>,
    pub mp: Option<f64>,
    pub cdr: Option<f64>,
    /** a shield's chance to catch a physical hit (which then does half its damage) */
    pub block: Option<f64>,
    /** how much faster its wearer runs, a fraction (a cape's: 0.03 is 3%) */
    pub speed: Option<f64>,
    /** points of evasion, and how much faster its wearer attacks (a fraction): the light armour's */
    pub evasion: Option<f64>,
    pub atk_spd: Option<f64>,
    /** how much faster its wearer casts (a fraction): a magic sword's */
    pub cast_spd: Option<f64>,
    /** a weapon held in both hands: no shield with it */
    pub two_handed: Option<bool>,
    /** a pair of swords: the sword it is two of */
    pub pair: Option<String>,
    pub price: i64,
    pub stack: Option<bool>,
    #[serde(rename = "use")]
    pub use_: Option<ItemUse>,
    pub enchant: Option<String>,
    pub craft: Option<Recipe>,
    /** sword, axe, pickaxe...: decides which gathering tool a weapon is */
    pub weapon_type: Option<String>,
    /** what it adds while worn, as a buff that never runs out (a boss jewel's power) */
    pub mods: Option<BuffMods>,
    /** the set of an armour line's piece, for its SET_BONUS */
    pub set: Option<String>,
    /** a Protection Stone: a failed enchant made with one sends the piece back to +0 instead of breaking it */
    pub protects: Option<bool>,
}

/** A set's bonus tier: what its armour pieces add once this many of them are worn (SET_BONUS in shared/src/data/items.ts). */
#[derive(Deserialize, Clone, Debug)]
pub struct SetTier { pub pieces: usize, pub mods: BuffMods }

/** Legend past the level cap (LEGEND in shared/src/data/legend.ts): its passives, each rank adding `mods` once more. */
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LegendPassive { pub id: String, pub name: String, pub name_en: String, pub max: i64, pub mods: BuffMods }
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LegendCfg { pub max: i64, pub reset_cost: i64, pub passives: Vec<LegendPassive> }

/** A class passive (shared/src/data/passives.ts): a base class's or a specialization's, learned at its level, always on
 * while its weapon ("shield", "dual", "bow", "dagger") is equipped, if it names one. */
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PassiveDef {
    pub id: String,
    pub name: String,
    pub name_en: String,
    pub cls: Option<String>,
    pub spec: Option<String>,
    pub level: i64,
    pub weapon: Option<String>,
    pub mods: BuffMods,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Recipe { pub mats: Vec<(String, i64)>, pub adena: i64 }

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnchantCfg { pub weapon: f64, pub armor: f64, pub safe: i64, pub chance: f64, pub max: i64, pub fail_destroys: bool }

/** MASTERWORK in shared/src/data/items.ts: how often a crafted piece comes out a Masterwork, and what one gives */
#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MasterworkCfg { pub chance: f64, pub dwarf_chance: f64, pub weapon: f64, pub piece: f64 }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatusApply { pub id: String, pub ms: f64, pub chance: Option<f64>, pub dot: Option<f64> }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Special { pub r: f64, pub windup: f64, pub mult: f64, pub every: f64, pub at: String, pub stun: Option<f64> }

/** World raid: telegraphed circles under up to `count` players within `range` of the boss at once */
#[derive(Deserialize, Clone, Debug)]
pub struct Barrage { pub count: u32, pub r: f64, pub windup: f64, pub mult: f64, pub every: f64, pub range: f64 }

/** World raid: a circle of `r` round the boss that takes `pct` of the max HP of everyone still in it */
#[derive(Deserialize, Clone, Debug)]
pub struct Pulse { pub r: f64, pub windup: f64, pub pct: f64, pub every: f64 }

/** World raid: past `after` ms of one fight it attacks `haste` times faster and hits `atk` times harder */
#[derive(Deserialize, Clone, Debug)]
pub struct Enrage { pub after: f64, pub haste: f64, pub atk: f64 }

#[derive(Deserialize, Clone, Debug)]
pub struct MobCount { pub mob: String, pub count: u32 }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MobPhase {
    pub at: f64, pub adds: Option<MobCount>, pub haste: Option<f64>, pub special: Option<Special>, pub barrage: Option<Barrage>, pub pulse: Option<Pulse>,
    pub say: (String, String),
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drop { pub item: String, pub chance: f64, pub min: Option<i64>, pub max: Option<i64> }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MobDef {
    pub id: String,
    pub name: String,
    pub name_en: String,
    pub level: i64,
    pub scale: f64,
    pub aggressive: bool,
    pub speed: f64,
    pub atk_interval: f64,
    pub range: f64,
    pub hp_mult: Option<f64>,
    pub atk_mult: Option<f64>,
    pub def_mult: Option<f64>,
    pub respawn: Option<f64>,
    pub boss: Option<bool>,
    pub on_hit: Option<StatusApply>,
    pub special: Option<Special>,
    pub phases: Option<Vec<MobPhase>>,
    pub barrage: Option<Barrage>,
    pub pulse: Option<Pulse>,
    pub enrage: Option<Enrage>,
    pub adena: (f64, f64),
    pub drops: Vec<Drop>,
    /** a boss's own jewel: one roll at `chance` a week for each character who fought it (combat.rs jewel_rolls) */
    pub jewel: Option<Jewel>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Jewel { pub item: String, pub chance: f64 }

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BuffMods {
    pub p_atk: Option<f64>,
    pub p_def: Option<f64>,
    pub m_atk: Option<f64>,
    pub m_def: Option<f64>,
    pub speed: Option<f64>,
    pub atk_spd: Option<f64>,
    pub cast_spd: Option<f64>,
    /** points added, not multipliers */
    pub crit: Option<f64>,
    pub evasion: Option<f64>,
    /** multipliers: max HP, HP and MP regeneration, critical damage (the songs' and dances') */
    pub max_hp: Option<f64>,
    pub hp_regen: Option<f64>,
    pub mp_regen: Option<f64>,
    pub crit_dmg: Option<f64>,
    /** cooldown reduction added (a fraction) and accuracy points */
    pub cdr: Option<f64>,
    pub accuracy: Option<f64>,
    /** fraction of the damage dealt that heals the dealer, of the melee damage taken that goes back */
    pub vampire: Option<f64>,
    pub reflect: Option<f64>,
    /** multipliers: max MP, what the caster's heals and mana recharges give, how long its songs and dances last */
    pub max_mp: Option<f64>,
    pub heal: Option<f64>,
    pub tune: Option<f64>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct BuffDef { pub dur: f64, pub mods: BuffMods }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillDef {
    pub id: String,
    pub name: String,
    pub name_en: String,
    pub cls: Option<String>,
    pub spec: Option<String>,
    pub race: Option<String>,
    pub gender: Option<String>,
    pub level: i64,
    pub kind: String,
    pub target: String,
    pub power: f64,
    pub mp: f64,
    pub cooldown: f64,
    pub cast: f64,
    pub range: f64,
    pub aoe: Option<f64>,
    pub aoe_on_self: Option<bool>,
    pub buff: Option<BuffDef>,
    pub status: Option<StatusApply>,
    /** the weapon it needs in hand ("bow", "dagger") */
    pub weapon: Option<String>,
    /** damage multiplied by this when the caster is behind its target */
    pub behind: Option<f64>,
    /** the mobs fighting the caster lose its trail */
    pub vanish: Option<bool>,
    /** Force charges it gives (99: all) and that it needs and spends */
    pub charge: Option<u32>,
    pub spend: Option<u32>,
    /** a song ("song") or a dance ("dance"): its buff lasts the caster's tune_dur times longer */
    pub tune: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Objective {
    Kill { mob: String, count: i64 },
    Collect { item: String, count: i64 },
    /** any of these mobs (a daily contract's hunt) */
    KillAny { mobs: Vec<String>, count: i64 },
    /** clearing a hostile camp */
    Camp { camp: String, count: i64 },
    /** clearing the Rift's floor `floor`, or a deeper one (count is 1) */
    Rift { floor: i64, count: i64 },
}
impl Objective {
    pub fn count(&self) -> i64 {
        match self {
            Objective::Kill { count, .. } | Objective::Collect { count, .. } | Objective::KillAny { count, .. } | Objective::Camp { count, .. } | Objective::Rift { count, .. } => *count,
        }
    }
}

/** How many contracts a day offers (DAILY_COUNT in shared/src/data/quests.ts). */
pub const DAILY_COUNT: usize = 3;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuestDef {
    pub id: String, pub npc: String, pub name: String, pub name_en: String, pub min_level: i64, pub objective: Objective, pub xp: i64, pub adena: i64,
    /** turning it in evolves the character's specialization */
    #[serde(default)]
    pub evolve: bool,
    /** a daily contract (quests.rs daily_set): offered some days, done once a day */
    #[serde(default)]
    pub daily: bool,
    /** items it pays on top of XP and adena */
    #[serde(default)]
    pub rewards: Vec<(String, i64)>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NpcDef {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub ry: f64,
    pub shop: Option<Vec<String>>,
    pub craft: Option<Vec<String>>,
    pub title: String,
    pub title_en: String,
    pub greeting: String,
    pub greeting_en: String,
    pub lines: Vec<String>,
    pub lines_en: Vec<String>,
    /** travelers walk back and forth along this road segment [ax, az, bx, bz] */
    #[serde(default)]
    pub road: Option<Vec<f64>>,
    /** a shop that sells for this item instead of adena, at `prices` (each in that item) */
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub prices: HashMap<String, i64>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ZoneDef { pub name: String, pub name_en: String, pub x: f64, pub z: f64, pub r: f64, pub spawns: Vec<MobCount>, pub pvp: Option<bool> }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Teleport { pub id: String, pub name: String, pub name_en: String, pub x: f64, pub z: f64, pub cost: i64 }

#[derive(Deserialize, Clone, Debug)]
pub struct CampChest { pub adena: (f64, f64), pub loot: Vec<Drop> }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CampDef { pub id: String, pub name: String, pub name_en: String, pub x: f64, pub z: f64, pub leader: String, pub mobs: Vec<MobCount>, pub respawn: f64, pub chest: CampChest }

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatMods {
    pub hp: f64, pub mp: f64, pub p_atk: f64, pub m_atk: f64, pub p_def: f64, pub m_def: f64,
    pub speed: f64, pub atk_spd: f64, pub cast_spd: f64, pub evasion: f64, pub accuracy: f64, pub crit: f64,
}

#[derive(Deserialize, Clone, Debug)]
/** mw: what a Masterwork piece gives this race ("atk", "cast", "cdr" or "mix", formulas.rs masterwork_bonus) */
pub struct RaceDef { pub id: String, pub classes: Vec<String>, pub mods: StatMods, pub mw: String }

#[derive(Deserialize, Clone, Debug)]
pub struct GenderDef { pub id: String, pub mods: StatMods }

#[derive(Deserialize, Clone, Debug)]
pub struct StartItem { pub item: String, pub count: i64, pub equip: bool }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassDef { pub id: String, pub base_hp: f64, pub hp_lvl: f64, pub base_mp: f64, pub mp_lvl: f64, pub cp_ratio: f64, pub atk_interval: f64, pub start_items: Vec<StartItem> }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpecDef {
    pub id: String, pub base: String, pub name: String, pub name_en: String,
    /** an evolution (the third specialization) of this spec */
    pub parent: Option<String>,
    /** how much more often it blocks with a shield (1.5: half again) */
    pub block: Option<f64>,
    /** the weapon its skills ask for, and the extra critical chance (points) while holding it */
    pub weapon: Option<String>,
    pub crit: Option<f64>,
    /** how many Force charges it can hold (the gladiator's) */
    pub charges: Option<u32>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct StatusDef { pub id: String, pub flag: u16 }

#[derive(Deserialize, Clone, Debug)]
pub struct Pos { pub x: f64, pub z: f64 }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RaidDef {
    pub id: String, pub name: String, pub name_en: String,
    /** none in the Rift: its floors spawn waves instead (rift.rs) */
    pub boss: Option<String>,
    #[serde(default)]
    pub rift: bool,
    /** an Olympiad fight: the two the queue paired, never entered with /raid (olympiad.rs) */
    #[serde(default)]
    pub arena: bool,
    pub x: f64, pub z: f64, pub entry: Pos, pub max_players: usize, pub min_level: i64, pub quest: Option<String>, pub close_after_kill: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "k")]
pub enum ObstacleDef {
    #[serde(rename = "c")]
    Circle { x: f64, z: f64, r: f64 },
    #[serde(rename = "b")]
    Box { x: f64, z: f64, hw: f64, hd: f64, cos: f64, sin: f64 },
}

/** One possible yield of a gather (shared/src/nodes.ts Yield). */
#[derive(Deserialize, Clone, Debug)]
pub struct Yield { pub item: String, pub min: i64, pub max: i64, pub chance: f64, pub zones: Option<Vec<String>> }

/** How a kind of node is worked (shared/src/nodes.ts GatherDef). */
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GatherDef { pub tools: Option<Vec<String>>, pub swing_ms: f64, pub swings: f64, pub respawn_ms: f64, pub yields: Vec<Yield> }

#[derive(Deserialize, Clone, Debug)]
pub struct GatherDefs { pub tree: GatherDef, pub rock: GatherDef, pub bush: GatherDef }

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeKind { Tree, Rock, Bush, Seat, Tent, Hut }

impl NodeKind {
    /** A place to sit or rest (shared isRest) rather than something to work. */
    pub fn is_rest(self) -> bool { matches!(self, NodeKind::Seat | NodeKind::Tent | NodeKind::Hut) }
}

/** A world node: [id, x, z, r, ry, seatY, zone] in the export. The kind comes from the id (shared NODE_BASE). */
#[derive(Deserialize, Clone, Debug)]
pub struct NodeRaw(pub u32, pub f64, pub f64, pub f64, pub f64, pub f64, pub String);

#[derive(Clone, Debug)]
pub struct NodeDef { pub kind: NodeKind, pub x: f64, pub z: f64, pub r: f64, pub ry: f64, pub zone: String }

#[derive(Deserialize, Clone, Debug)]
pub struct WaterRaw { pub cell: f64, pub half: f64, pub runs: Vec<(usize, usize, usize)> }

/** Clans (shared/src/data/clans.ts). */
#[derive(Deserialize)]
pub struct ClanLevelDef { pub members: usize, pub adena: i64, pub mats: Vec<(String, i64)>, pub rep: i64 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClanCfg {
    pub found_level: i64, pub crest_level: u8, pub warehouse_level: u8, pub war_level: u8, pub ally_level: u8, pub skill_level: u8,
    pub name_min: usize, pub name_max: usize, pub title_max: usize,
    pub leave_ms: f64, pub kick_ms: f64, pub dissolve_ms: f64, pub invite_ms: f64,
    pub crest_w: u32, pub crest_h: u32, pub crest_bytes: usize,
    pub max_wars: usize, pub war_cooldown_ms: f64,
    pub ally_max: usize, pub ally_crest_w: u32, pub ally_crest_h: u32, pub ally_leave_ms: f64, pub ally_dissolve_ms: f64,
    pub wh_slots: usize, pub wh_log: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClanSkillDef { pub id: String, pub name: String, pub name_en: String, pub stat: String, pub bonus: Vec<f64>, pub rep: Vec<i64> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClanRepDef { pub raid_boss: i64, pub camp_clear: i64, pub war_kill: i64, pub war_death: i64, pub siege_win: i64, pub siege_hold: i64 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClansDef { pub levels: Vec<ClanLevelDef>, pub cfg: ClanCfg, pub privs: Vec<u32>, pub grade_level: Vec<u8>, pub rep: ClanRepDef, pub skills: Vec<ClanSkillDef> }

/** Fort sieges (shared/src/data/sieges.ts SIEGE): when, how wide, who may take a fort, the owner's tax. */
#[derive(Deserialize)]
pub struct SiegeDef {
    pub weekday: i64, pub hour: f64, pub minutes: f64, pub warn: Vec<f64>, pub zone: f64, pub level: u8, pub tax: f64,
    pub guardian: String, pub forts: Vec<SiegeFort>,
}
/** The Olympiad (shared/src/data/olympiad.ts OLYMPIAD): who fights, a fight's timing and arena, points, Heroes. */
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OlympiadDef {
    pub min_level: i64, pub prep_ms: f64, pub fight_ms: f64, pub end_ms: f64, pub radius: f64, pub gap: f64,
    pub match_every: f64, pub per_rival: i64, pub start_points: i64, pub take: f64, pub hero_fights: i64, pub hero_wins: i64,
}
/** A sieged fort: its town's centre and radius, and the camps on its roads where the attackers come back. */
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiegeFort { pub id: String, pub name: String, pub name_en: String, pub x: f64, pub z: f64, pub r: f64, pub camps: Vec<(f64, f64)> }

#[derive(Deserialize)]
struct Raw {
    constants: Constants,
    town: Town,
    towns: Vec<Town>,
    wild: Named,
    enchant: EnchantCfg,
    items: Vec<ItemDef>,
    #[serde(rename = "gradeLevel")]
    grade_level: HashMap<String, i64>,
    masterwork: MasterworkCfg,
    #[serde(rename = "setBonus")]
    set_bonus: HashMap<String, Vec<SetTier>>,
    mobs: Vec<MobDef>,
    skills: Vec<SkillDef>,
    quests: Vec<QuestDef>,
    npcs: Vec<NpcDef>,
    zones: Vec<ZoneDef>,
    #[serde(default)]
    herds: Vec<ZoneDef>,
    teleports: Vec<Teleport>,
    camps: Vec<CampDef>,
    races: Vec<RaceDef>,
    genders: Vec<GenderDef>,
    classes: Vec<ClassDef>,
    specs: Vec<SpecDef>,
    statuses: Vec<StatusDef>,
    raids: Vec<RaidDef>,
    obstacles: Vec<ObstacleDef>,
    nodes: Vec<NodeRaw>,
    gather: GatherDefs,
    clans: ClansDef,
    siege: SiegeDef,
    olympiad: OlympiadDef,
    legend: LegendCfg,
    passives: Vec<PassiveDef>,
    #[serde(rename = "dailyProbe", default)]
    daily_probe: Vec<(i64, Vec<String>)>,
    water: WaterRaw,
}

pub struct Data {
    pub c: Constants,
    /** the starting village */
    pub town: Town,
    /** every peace zone, the village included */
    pub towns: Vec<Town>,
    pub wild: Named,
    pub enchant: EnchantCfg,
    pub items: HashMap<String, ItemDef>,
    pub mobs: HashMap<String, MobDef>,
    /** in data order (skill lists keep it) */
    pub skills: Vec<SkillDef>,
    pub skill_by_id: HashMap<String, usize>,
    pub quests: Vec<QuestDef>,
    pub npcs: Vec<NpcDef>,
    pub zones: Vec<ZoneDef>,
    /** open-country wild game: spawned like zones, never named as one */
    pub herds: Vec<ZoneDef>,
    pub teleports: Vec<Teleport>,
    pub camps: Vec<CampDef>,
    pub races: HashMap<String, RaceDef>,
    pub genders: HashMap<String, GenderDef>,
    pub classes: HashMap<String, ClassDef>,
    pub specs: Vec<SpecDef>,
    pub statuses: Vec<StatusDef>,
    pub raids: HashMap<String, RaidDef>,
    pub obstacles: Vec<ObstacleDef>,
    pub nodes: HashMap<u32, NodeDef>,
    pub gather: GatherDefs,
    pub clans: ClansDef,
    pub siege: SiegeDef,
    pub olympiad: OlympiadDef,
    pub legend: LegendCfg,
    /** the class passives, in data order */
    pub passives: Vec<PassiveDef>,
    /** the client's dailySet on a week of days (day, contract ids): daily_set must pick the same (a test) */
    pub daily_probe: Vec<(i64, Vec<String>)>,
    /** the level a character needs to wear each grade (GRADE_LEVEL in shared/src/data/items.ts) */
    pub grade_level: HashMap<String, i64>,
    pub masterwork: MasterworkCfg,
    /** each set's bonus tiers, fewest pieces first */
    pub set_bonus: HashMap<String, Vec<SetTier>>,
    /** deep water on a grid (cell m, from -half): true where a character swims */
    water: Vec<bool>,
    water_cell: f64,
    water_half: f64,
    water_n: usize,
}

impl Data {
    pub fn item(&self, id: &str) -> Option<&ItemDef> { self.items.get(id) }
    /** The level a character needs to wear this piece (0 for anything without a grade). */
    pub fn wear_level(&self, item: &ItemDef) -> i64 { item.grade.as_ref().and_then(|g| self.grade_level.get(g)).copied().unwrap_or(0) }
    pub fn skill(&self, id: &str) -> Option<&SkillDef> { self.skill_by_id.get(id).map(|&i| &self.skills[i]) }
    pub fn quest(&self, id: &str) -> Option<&QuestDef> { self.quests.iter().find(|q| q.id == id) }
    /** The story quest a giver offers (the contracts' board offers daily_set's instead). */
    pub fn quest_by_npc(&self, npc: &str) -> Option<&QuestDef> { self.quests.iter().find(|q| q.npc == npc && !q.daily) }
    /** The day's contracts (day: formulas.rs loot_day): the same for everyone, a shuffle of the daily pool (in data order)
     * seeded by the day, as shared/src/data/quests.ts dailySet does it. */
    pub fn daily_set(&self, day: i64) -> Vec<&QuestDef> {
        let pool: Vec<&QuestDef> = self.quests.iter().filter(|q| q.daily).collect();
        let mut idx: Vec<usize> = (0..pool.len()).collect();
        let mut rng = crate::terrain::Mulberry32::new(day as u32);
        for i in (1..idx.len()).rev() {
            let j = (rng.next() * (i + 1) as f64).floor() as usize;
            idx.swap(i, j);
        }
        idx.into_iter().take(DAILY_COUNT).map(|i| pool[i]).collect()
    }
    pub fn camp(&self, id: &str) -> Option<&CampDef> { self.camps.iter().find(|c| c.id == id) }
    pub fn npc(&self, id: &str) -> Option<&NpcDef> { self.npcs.iter().find(|n| n.id == id) }
    pub fn status_flag(&self, id: &str) -> u16 { self.statuses.iter().find(|s| s.id == id).map(|s| s.flag).unwrap_or(0) }

    pub fn spec(&self, id: &str) -> Option<&SpecDef> { self.specs.iter().find(|s| s.id == id) }
    /** The evolution a specialization grows into (the quest with `evolve`), if it has one. */
    pub fn evolution_of(&self, spec: &str) -> Option<&SpecDef> { self.specs.iter().find(|s| s.parent.as_deref() == Some(spec)) }

    /** Deep water at (x, z): swimming there (shared/src/terrain.ts isDeep). */
    pub fn is_deep(&self, x: f64, z: f64) -> bool {
        let (c, r) = (((x + self.water_half) / self.water_cell).floor(), ((z + self.water_half) / self.water_cell).floor());
        if c < 0.0 || r < 0.0 || c as usize >= self.water_n || r as usize >= self.water_n { return false; }
        self.water[r as usize * self.water_n + c as usize]
    }

    pub fn gather_def(&self, kind: NodeKind) -> Option<&GatherDef> {
        match kind { NodeKind::Tree => Some(&self.gather.tree), NodeKind::Rock => Some(&self.gather.rock), NodeKind::Bush => Some(&self.gather.bush), NodeKind::Seat | NodeKind::Tent | NodeKind::Hut => None }
    }

    pub fn skill_available(&self, s: &SkillDef, cls: &str, spec: Option<&str>, race: &str, gender: &str) -> bool {
        // an evolution keeps its parent's skills
        let parent = spec.and_then(|sp| self.spec(sp)).and_then(|d| d.parent.as_deref());
        s.cls.as_deref().map_or(true, |c| c == cls) && s.spec.as_deref().map_or(true, |x| Some(x) == spec || Some(x) == parent)
            && s.race.as_deref().map_or(true, |r| r == race) && s.gender.as_deref().map_or(true, |g| g == gender)
    }

    /** The passives a character of this class and specialization (an evolution keeps its parent's) has learned by this
     * level, weapon or not (passivesFor() in shared/src/data/passives.ts, but only the learned ones). */
    pub fn passives_for(&self, cls: &str, spec: Option<&str>, level: i64) -> Vec<&PassiveDef> {
        let parent = spec.and_then(|sp| self.spec(sp)).and_then(|d| d.parent.as_deref());
        self.passives.iter().filter(|p| p.level <= level && match (&p.cls, &p.spec) {
            (Some(c), _) => c == cls,
            (None, Some(s)) => Some(s.as_str()) == spec || Some(s.as_str()) == parent,
            _ => false,
        }).collect()
    }

    /** skillsFor(): learned skills, sorted by level (stable, data order otherwise) */
    pub fn skills_for(&self, cls: &str, spec: Option<&str>, level: i64, race: &str, gender: &str) -> Vec<&SkillDef> {
        let mut v: Vec<&SkillDef> = self.skills.iter().filter(|s| self.skill_available(s, cls, spec, race, gender) && s.level <= level).collect();
        v.sort_by_key(|s| s.level);
        v
    }
}

static DATA: OnceLock<Data> = OnceLock::new();

pub fn d() -> &'static Data {
    DATA.get_or_init(|| {
        let raw: Raw = serde_json::from_str(include_str!("../data/game.json")).expect("server-rs/data/game.json: run `npm run export-data`");
        let skill_by_id = raw.skills.iter().enumerate().map(|(i, s)| (s.id.clone(), i)).collect();
        let water_n = (raw.water.half * 2.0 / raw.water.cell).round() as usize;
        let mut water = vec![false; water_n * water_n];
        for &(row, a, b) in &raw.water.runs { for c in a..=b { water[row * water_n + c] = true; } }
        Data {
            c: raw.constants,
            town: raw.town,
            towns: raw.towns,
            wild: raw.wild,
            enchant: raw.enchant,
            items: raw.items.into_iter().map(|i| (i.id.clone(), i)).collect(),
            grade_level: raw.grade_level,
            masterwork: raw.masterwork,
            set_bonus: raw.set_bonus,
            mobs: raw.mobs.into_iter().map(|m| (m.id.clone(), m)).collect(),
            skills: raw.skills,
            skill_by_id,
            quests: raw.quests,
            npcs: raw.npcs,
            zones: raw.zones,
            herds: raw.herds,
            teleports: raw.teleports,
            camps: raw.camps,
            races: raw.races.into_iter().map(|r| (r.id.clone(), r)).collect(),
            genders: raw.genders.into_iter().map(|g| (g.id.clone(), g)).collect(),
            classes: raw.classes.into_iter().map(|c| (c.id.clone(), c)).collect(),
            specs: raw.specs,
            statuses: raw.statuses,
            raids: raw.raids.into_iter().map(|r| (r.id.clone(), r)).collect(),
            obstacles: raw.obstacles,
            nodes: raw.nodes.into_iter().filter_map(|NodeRaw(id, x, z, r, ry, _seat_y, zone)| {
                let kind = match id / 100000 { 1 => NodeKind::Tree, 2 => NodeKind::Rock, 3 => NodeKind::Bush, 4 => NodeKind::Seat, 5 => NodeKind::Tent, 6 => NodeKind::Hut, _ => return None };
                Some((id, NodeDef { kind, x, z, r, ry, zone }))
            }).collect(),
            gather: raw.gather,
            clans: raw.clans,
            siege: raw.siege,
            olympiad: raw.olympiad,
            legend: raw.legend,
            passives: raw.passives,
            daily_probe: raw.daily_probe,
            water_n: water_n,
            water_cell: raw.water.cell,
            water_half: raw.water.half,
            water,
        }
    })
}
