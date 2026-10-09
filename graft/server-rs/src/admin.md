# server-rs/src/admin.rs

- LOG_CAP · constant · L14-L14 — const LOG_CAP: usize = 500;
- LOGS · constant · L16-L16 — static LOGS: Mutex<(u64, VecDeque<(u64, f64, bool, String)>)> = Mutex::new((0, VecDeque::new()));
- CFG · constant · L18-L18 — static CFG: OnceLock<(Option<String>, Instant)> = OnceLock::new();
- LAST_FAIL · constant · L19-L19 — static LAST_FAIL: AtomicU64 = AtomicU64::new(0);
- log · function · L22-L29 — pub fn log(err: bool, line: String)
- log · function · L31-L31 — macro_rules! log { ($($a:tt)*) => { $crate::admin::log(false, format!($($a)*)) } }
- elog · function · L32-L32 — macro_rules! elog { ($($a:tt)*) => { $crate::admin::log(true, format!($($a)*)) } }
- init · function · L34-L38 — pub fn init()
- ct_eq · function · L41-L43 — fn ct_eq(a: &[u8], b: &[u8]) -> bool
- rss · function · L46-L49 — fn rss() -> Option<u64>
- handle · function · L52-L98 — pub fn handle(app: &App, sid: u64, out: &Outbox, m: &Value)
- tests · module · L101-L115 — mod tests
- log_ring_and_password_compare · function · L105-L114 — fn log_ring_and_password_compare()
