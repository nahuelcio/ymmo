// Read-only peek at the dev game.db: char rows (position/flags) for the stuck-player report.
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/data/game.db', { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
console.log('tables:', tables.join(','));
for (const t of tables) {
  if (!/char|player|account/i.test(t)) continue;
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  console.log(`\n== ${t} (${cols.join(', ')})`);
  const rows = db.prepare(`SELECT * FROM ${t} LIMIT 5`).all();
  for (const r of rows) console.log(JSON.stringify(r).slice(0, 600));
}
