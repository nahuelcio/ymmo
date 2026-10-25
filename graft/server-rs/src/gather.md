# server-rs/src/gather.rs

- NODE_REACH · constant · L12-L12 — const NODE_REACH: f64 = 0.9;
- STALL_SLACK · constant · L14-L14 — const STALL_SLACK: f64 = 1.5;
- request_interact · function · L18-L35 — pub fn request_interact(&mut self, pid: u32, node: u32, now: f64)
- tool_ok · function · L38-L46 — fn tool_ok(&self, pid: u32, kind: NodeKind) -> Result<(), (&'static str, &'static str)>
- process_interact · function · L49-L83 — pub fn process_interact(&mut self, pid: u32, node: u32, speed: f64, dt: f64, now: f64)
- start_gather · function · L85-L98 — fn start_gather(&mut self, pid: u32, node: u32, now: f64)
- tick_gather · function · L101-L135 — pub fn tick_gather(&mut self, pid: u32, now: f64) -> bool
- tick_nodes · function · L138-L145 — pub fn tick_nodes(&mut self, now: f64)
- send_nodes · function · L148-L152 — pub fn send_nodes(&self, pid: u32, now: f64)
- taken · function · L154-L156 — fn taken(&mut self, pid: u32, kind: NodeKind)
- sit · function · L159-L181 — pub fn sit(&mut self, pid: u32, seat: Option<u32>)
- stand_up · function · L183-L189 — pub fn stand_up(&mut self, pid: u32)
- toggle_sit · function · L192-L196 — pub fn toggle_sit(&mut self, pid: u32)
- idle_interrupt · function · L199-L202 — pub fn idle_interrupt(&mut self, pid: u32)
