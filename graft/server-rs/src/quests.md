# server-rs/src/quests.rs

- NPC_RANGE · constant · L9-L9 — const NPC_RANGE: f64 = 8.0;
- npc_name · function · L11-L11 — fn npc_name(id: &str) -> String { d().npc(id).map(|n| n.name.clone()).unwrap_or_else(|| "quien te dio la misión".into()) }
- quest_progress · function · L13-L16 — pub fn quest_progress(p: &Player, q: &QuestDef) -> i64
- prime_quest_notices · function · L18-L23 — pub fn prime_quest_notices(p: &mut Player)
- send_quests · function · L25-L34 — pub fn send_quests(p: &Player)
- status_of · function · L36-L43 — fn status_of(p: &Player, q: &QuestDef) -> &'static str
- qname · function · L45-L45 — fn qname(q: &QuestDef, l: Lang) -> &str { if l.en() { &q.name_en } else { &q.name } }
- quest_npc · function · L48-L57 — fn quest_npc(&self, pid: u32, nid: u32) -> Option<&'static crate::data::NpcDef>
- open_quest · function · L59-L68 — pub fn open_quest(&mut self, pid: u32, nid: u32)
- accept_quest · function · L70-L85 — pub fn accept_quest(&mut self, pid: u32, nid: u32)
- turn_in_quest · function · L88-L116 — pub fn turn_in_quest(&mut self, pid: u32, nid: u32) -> i64
- credit_kill · function · L118-L143 — pub fn credit_kill(&mut self, mob: &str, players: &[u32])
- on_inventory_changed · function · L145-L165 — pub fn on_inventory_changed(&mut self, pid: u32)
