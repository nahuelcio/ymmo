# server-rs/src/db.rs

SQLite persistence layer that keeps accounts, characters, sessions, inventory, and quests in the same game.db — with the same schema and scrypt password hashes as the Node server — so the existing database keeps working when switching server implementations.

- Db · struct · L8-L8 — Handle struct owning the SQLite connection that all account, session, and character persistence goes through.
- CharRow · struct · L10-L13 — Full character record (identity, position, vitals, adena, karma/PvP counters, appearance, specialization) restored from the characters table when a player loads into the game.
- CharSummary · struct · L15-L15 — Compact per-character listing (name, race, class, level, appearance, specialization) used to populate an account's character-selection screen.
- TOKEN_TTL · constant · L17-L17 — Session lifetime rule: login tokens stay valid for 30 days before expiring.
- db_path · function · L19-L21 — Resolves where the SQLite file lives, defaulting to the same game.db the Node server uses so both share one database.
- look_of · function · L23-L26 — Converts raw gender/hair columns from a row into a validated Look via the shared sanitize rule, keeping DB-appearance data consistent with game rules.
- now_ms · function · L28-L28 — Single clock source for all DB timestamps, delegated to the world clock.
- sha · function · L29-L29 — SHA-256 of a session token, enforcing that only token hashes (never raw tokens) are stored in the sessions table.
- scrypt_hash · function · L32-L37 — Derives a password hash with Node's crypto.scrypt default parameters (N=16384, r=8, p=1), guaranteeing hash compatibility between the Rust and Node servers.
- hash_pass · function · L39-L42 — Creates a credential string for a new account by scrypt-hashing the password with a random salt, stored as 'salt:hash'.
- check_pass · function · L44-L50 — Verifies a login password against the stored salted scrypt hash using a constant-time comparison to prevent timing attacks.
- open · function · L53-L79 — Opens or creates game.db, brings the schema up to date (tables, indexes, and additive column migrations for older databases), and purges expired login sessions at startup.
- account · function · L81-L83 — Looks up an account's id and password hash by username, the first step of login verification.
- insert_account · function · L85-L88 — Registers a new account with its password hash, translating the UNIQUE-name violation into a user-facing 'account name in use' error.
- create_session · function · L90-L96 — Issues a login token: a random URL-safe value given to the client while only its SHA-256 hash is stored with a 30-day expiry.
- resume_session · function · L98-L109 — Validates a remembered-login token and implements sliding expiry: expired sessions are deleted and rejected, valid ones get their 30-day TTL renewed.
- delete_session · function · L111-L111 — Logs the client out by removing the stored hash of its session token.
- list_chars · function · L113-L117 — Enumerates every character belonging to one account as lightweight summaries (ordered by id) for the character-selection screen.
- create_char · function · L119-L137 — Enforces character-creation rules — unique name and a maximum of 7 characters per account — before inserting a level-1 character spawned in a ring around town with starting adena and class starting items.
- delete_char · function · L139-L146 — Permanently removes a character only if it belongs to the requesting account, cascading the delete to its items and quests.
- load_char · function · L149-L167 — Loads one account-owned character together with its inventory and quest state, silently dropping any item or quest ids that no longer exist in the current game data.
- cast_overrides · function · L171-L174 — pub fn cast_overrides(&self) -> Vec<(String, f64)>
- set_cast · function · L177-L182 — pub fn set_cast(&self, skill: &str, ms: Option<f64>)
- balance_overrides · function · L185-L188 — pub fn balance_overrides(&self) -> Vec<(String, f64)>
- set_balance · function · L191-L196 — pub fn set_balance(&self, key: &str, value: Option<f64>)
- set_spec · function · L198-L198 — Permanently records a character's once-only class specialization, written immediately so it never waits on (or gets overwritten by) the periodic save.
- save_char · function · L201-L211 — Atomically persists a character's full runtime state (level, xp, position, vitals, adena, karma/PvP, inventory, quests) in one transaction by rewriting the item and quest tables.
