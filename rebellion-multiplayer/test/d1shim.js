// Tiny D1-compatible wrapper over Node's built-in SQLite, so the real SQL is tested.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeDb() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    raw: sql,
    prepare(q) {
      const st = sql.prepare(q);
      let args = [];
      const o = {
        bind(...a) { args = a; return o; },
        async first(col) { const r = st.get(...args); if (!r) return null; return col ? r[col] : { ...r }; },
        async all() { return { results: st.all(...args).map((r) => ({ ...r })) }; },
        async run() { const r = st.run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return o;
    },
  };
}
