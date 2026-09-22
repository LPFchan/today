// A D1 stand-in over node:sqlite, with the migrations applied. Covers the
// subset of the D1 API the Worker uses: prepare/bind/first/all/run.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function testDatabase() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));

  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  });
  return { prepare: (sql) => statement(sql), raw: db };
}
