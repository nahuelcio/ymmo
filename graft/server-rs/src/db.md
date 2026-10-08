# server-rs/src/db.rs

SQLite persistence layer that intentionally mirrors the Node server's schema and password hashing so the existing game.db keeps working when swapping servers.

- Db · struct · L8-L8 — Handle struct owning the SQLite connection that all account, session, and character persistence goes through.
- CharRow · struct · L10-L13 — Full in-memory snapshot of a character's persisted state (stats, position, currency, karma, look) as read from or written to the characters table.
- CharSummary · struct · L15-L15 — Lightweight character descriptor (id, name, race, class, level, look) used for the account's character-select list without loading full state.
- TOKEN_TTL · constant · L17-L17 — Session lifetime rule: login tokens stay valid for 30 days before expiring.
- db_path · function · L19-L22 — Resolves where the SQLite file lives, defaulting to the same game.db the Node server uses so both share one database.
- look_of · function · L24-L27 — Converts raw gender/hair columns from a row into a validated Look via the shared sanitize rule, keeping DB-appearance data consistent with game rules.
- now_ms · function · L29-L29 — Single clock source for all DB timestamps, delegated to the world clock.
- sha · function · L30-L30 — SHA-256 of a session token, enforcing that only token hashes (never raw tokens) are stored in the sessions table.
- scrypt_hash · function · L33-L38 — Derives a password hash with Node's crypto.scrypt default parameters (N=16384, r=8, p=1), guaranteeing hash compatibility between the Rust and Node servers.
- hash_pass · function · L40-L43 — Creates a credential string for a new account by scrypt-hashing the password with a random salt, stored as 'salt:hash'.
- check_pass · function · L45-L51 — Verifies a login password against the stored salted scrypt hash using a constant-time comparison to prevent timing attacks.
- open · function · L54-L78 — Opens (creating if needed) the shared game.db, ensures the Node-compatible schema exists, backfills new appearance columns, and purges expired sessions.
- account · function · L80-L82 — Looks up an account's id and password hash by username, the first step of login verification.
- insert_account · function · L84-L87 — Registers a new account with its password hash, translating the UNIQUE-name violation into a user-facing 'account name in use' error.
- create_session · function · L89-L95 — Issues a login token: a random URL-safe value given to the client while only its SHA-256 hash is stored with a 30-day expiry.
- resume_session · function · L97-L108 — Validates a remembered-login token and implements sliding expiry: expired sessions are deleted and rejected, valid ones get their 30-day TTL renewed.
- delete_session · function · L110-L110 — Logs the client out by removing the stored hash of its session token.
- list_chars · function · L112-L116 — Lists all of an account's characters (id order) for the character-select screen, including their sanitized appearance.
- create_char · function · L118-L136 — Enforces character-creation rules — unique name and a maximum of 7 characters per account — before inserting a level-1 character spawned in a ring around town with starting adena and class starting items.
- delete_char · function · L138-L145 — Permanently removes a character only if it belongs to the requesting account, cascading the delete to its items and quests.
- load_char · function · L148-L166 — Loads a character's full play state (row plus inventory and quest progress), silently dropping items/quests that no longer exist in the static data registry.
- set_spec · function · L169-L169 — pub fn set_spec(&self, id: i64, spec: &str) -> rusqlite::Result<usize> { self.c.execute("UPDATE characters SET spec = ? WHERE id = ?", params![spec, id]) }
- save_char · function · L172-L182 — Persistently overwrites a character's full state in one transaction — stats and position updated in place, then items and quests deleted and reinserted so saves are all-or-nothing.
