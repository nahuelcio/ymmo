# server-rs/src/gather.rs

- NODE_REACH · constant · L12-L12 — const NODE_REACH: f64 = 0.9;
- STALL_SLACK · constant · L14-L14 — const STALL_SLACK: f64 = 1.5;
- request_interact · function · L18-L34 — pub fn request_interact(&mut self, pid: u32, node: u32, now: f64)
- tool_ok · function · L37-L45 — fn tool_ok(&self, pid: u32, kind: NodeKind) -> Result<(), (&'static str, &'static str)>
- process_interact · function · L48-L82 — pub fn process_interact(&mut self, pid: u32, node: u32, speed: f64, dt: f64, now: f64)
- start_gather · function · L84-L97 — fn start_gather(&mut self, pid: u32, node: u32, now: f64)
- tick_gather · function · L100-L134 — pub fn tick_gather(&mut self, pid: u32, now: f64) -> bool
- tick_nodes · function · L137-L144 — pub fn tick_nodes(&mut self, now: f64)
- send_nodes · function · L147-L151 — pub fn send_nodes(&self, pid: u32, now: f64)
- sit · function · L154-L171 — pub fn sit(&mut self, pid: u32, seat: Option<u32>)
- stand_up · function · L173-L179 — pub fn stand_up(&mut self, pid: u32)
- toggle_sit · function · L182-L186 — pub fn toggle_sit(&mut self, pid: u32)
- idle_interrupt · function · L189-L192 — pub fn idle_interrupt(&mut self, pid: u32)
