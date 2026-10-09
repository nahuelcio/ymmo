# server-rs/src/raid.rs

- hp_scale · function · L13-L13 — pub fn hp_scale(n: usize) -> f64 { 0.35 + 0.65 * (n.max(1) as f64) }
- WorldCmd · enum · L15-L23 — pub enum WorldCmd
- HubMsg · enum · L25-L31 — pub enum HubMsg
- run_world · function · L34-L107 — pub fn run_world(id: u32, raid: Option<(&'static RaidDef, usize)>, rx: Receiver<WorldCmd>, hub: UnboundedSender<HubMsg>)
