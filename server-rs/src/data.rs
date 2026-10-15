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
    pub p_atk: Option<f64>,
    pub m_atk: Option<f64>,
    pub p_def: Option<f64>,
    pub m_def: Option<f64>,
    pub hp: Option<f64>,
    pub mp: Option<f64>,
    pub cdr: Option<f64>,
    pub price: i64,
    pub stack: Option<bool>,
    #[serde(rename = "use")]
    pub use_: Option<ItemUse>,
    pub enchant: Option<String>,
    pub craft: Option<Recipe>,
    /** sword, axe, pickaxe...: decides which gathering tool a weapon is */
    pub weapon_type: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct Recipe { pub mats: Vec<(String, i64)>, pub adena: i64 }

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnchantCfg { pub weapon: f64, pub armor: f64, pub safe: i64, pub step: f64, pub max: i64, pub fail_destroys: bool }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatusApply { pub id: String, pub ms: f64, pub chance: Option<f64>, pub dot: Option<f64> }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Special { pub r: f64, pub windup: f64, pub mult: f64, pub every: f64, pub at: String, pub stun: Option<f64> }

#[derive(Deserialize, Clone, Debug)]
pub struct MobCount { pub mob: String, pub count: u32 }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MobPhase { pub at: f64, pub adds: Option<MobCount>, pub haste: Option<f64>, pub special: Option<Special>, pub say: (String, String) }

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
    pub adena: (f64, f64),
    pub drops: Vec<Drop>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct BuffMods {
    pub p_atk: Option<f64>,
    pub p_def: Option<f64>,
    pub m_atk: Option<f64>,
    pub m_def: Option<f64>,
    pub speed: Option<f64>,
    pub atk_spd: Option<f64>,
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
}

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Objective {
    Kill { mob: String, count: i64 },
    Collect { item: String, count: i64 },
}
impl Objective {
    pub fn count(&self) -> i64 { match self { Objective::Kill { count, .. } | Objective::Collect { count, .. } => *count } }
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuestDef { pub id: String, pub npc: String, pub name: String, pub name_en: String, pub min_level: i64, pub objective: Objective, pub xp: i64, pub adena: i64 }

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
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ZoneDef { pub name: String, pub name_en: String, pub x: f64, pub z: f64, pub r: f64, pub spawns: Vec<MobCount> }

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
pub struct RaceDef { pub id: String, pub classes: Vec<String>, pub mods: StatMods }

#[derive(Deserialize, Clone, Debug)]
pub struct GenderDef { pub id: String, pub mods: StatMods }

#[derive(Deserialize, Clone, Debug)]
pub struct StartItem { pub item: String, pub count: i64, pub equip: bool }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassDef { pub id: String, pub base_hp: f64, pub hp_lvl: f64, pub base_mp: f64, pub mp_lvl: f64, pub cp_ratio: f64, pub atk_interval: f64, pub start_items: Vec<StartItem> }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpecDef { pub id: String, pub base: String, pub name: String, pub name_en: String }

#[derive(Deserialize, Clone, Debug)]
pub struct StatusDef { pub id: String, pub flag: u16 }

#[derive(Deserialize, Clone, Debug)]
pub struct Pos { pub x: f64, pub z: f64 }

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RaidDef { pub id: String, pub name: String, pub name_en: String, pub boss: String, pub x: f64, pub z: f64, pub entry: Pos, pub max_players: usize, pub min_level: i64, pub quest: Option<String>, pub close_after_kill: f64 }

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
pub enum NodeKind { Tree, Rock, Bush, Seat }

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
pub struct ClanRepDef { pub raid_boss: i64, pub camp_clear: i64, pub war_kill: i64, pub war_death: i64 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClansDef { pub levels: Vec<ClanLevelDef>, pub cfg: ClanCfg, pub privs: Vec<u32>, pub grade_level: Vec<u8>, pub rep: ClanRepDef, pub skills: Vec<ClanSkillDef> }

#[derive(Deserialize)]
struct Raw {
    constants: Constants,
    town: Town,
    towns: Vec<Town>,
    wild: Named,
    enchant: EnchantCfg,
    items: Vec<ItemDef>,
    mobs: Vec<MobDef>,
    skills: Vec<SkillDef>,
    quests: Vec<QuestDef>,
    npcs: Vec<NpcDef>,
    zones: Vec<ZoneDef>,
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
    /** deep water on a grid (cell m, from -half): true where a character swims */
    water: Vec<bool>,
    water_cell: f64,
    water_half: f64,
    water_n: usize,
}

impl Data {
    pub fn item(&self, id: &str) -> Option<&ItemDef> { self.items.get(id) }
    pub fn skill(&self, id: &str) -> Option<&SkillDef> { self.skill_by_id.get(id).map(|&i| &self.skills[i]) }
    pub fn quest(&self, id: &str) -> Option<&QuestDef> { self.quests.iter().find(|q| q.id == id) }
    pub fn quest_by_npc(&self, npc: &str) -> Option<&QuestDef> { self.quests.iter().find(|q| q.npc == npc) }
    pub fn camp(&self, id: &str) -> Option<&CampDef> { self.camps.iter().find(|c| c.id == id) }
    pub fn npc(&self, id: &str) -> Option<&NpcDef> { self.npcs.iter().find(|n| n.id == id) }
    pub fn status_flag(&self, id: &str) -> u16 { self.statuses.iter().find(|s| s.id == id).map(|s| s.flag).unwrap_or(0) }

    pub fn spec(&self, id: &str) -> Option<&SpecDef> { self.specs.iter().find(|s| s.id == id) }

    /** Deep water at (x, z): swimming there (shared/src/terrain.ts isDeep). */
    pub fn is_deep(&self, x: f64, z: f64) -> bool {
        let (c, r) = (((x + self.water_half) / self.water_cell).floor(), ((z + self.water_half) / self.water_cell).floor());
        if c < 0.0 || r < 0.0 || c as usize >= self.water_n || r as usize >= self.water_n { return false; }
        self.water[r as usize * self.water_n + c as usize]
    }

    pub fn gather_def(&self, kind: NodeKind) -> Option<&GatherDef> {
        match kind { NodeKind::Tree => Some(&self.gather.tree), NodeKind::Rock => Some(&self.gather.rock), NodeKind::Bush => Some(&self.gather.bush), NodeKind::Seat => None }
    }

    pub fn skill_available(&self, s: &SkillDef, cls: &str, spec: Option<&str>, race: &str, gender: &str) -> bool {
        s.cls.as_deref().map_or(true, |c| c == cls) && s.spec.as_deref().map_or(true, |x| Some(x) == spec) && s.race.as_deref().map_or(true, |r| r == race) && s.gender.as_deref().map_or(true, |g| g == gender)
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
            mobs: raw.mobs.into_iter().map(|m| (m.id.clone(), m)).collect(),
            skills: raw.skills,
            skill_by_id,
            quests: raw.quests,
            npcs: raw.npcs,
            zones: raw.zones,
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
                let kind = match id / 100000 { 1 => NodeKind::Tree, 2 => NodeKind::Rock, 3 => NodeKind::Bush, 4 => NodeKind::Seat, _ => return None };
                Some((id, NodeDef { kind, x, z, r, ry, zone }))
            }).collect(),
            gather: raw.gather,
            clans: raw.clans,
            water_n: water_n,
            water_cell: raw.water.cell,
            water_half: raw.water.half,
            water,
        }
    })
}
