/**
 * Apply the store schema.
 *
 *     CURB_POSTGRES_URL=postgres://... node scripts/migrate.ts
 *
 * The schema is one idempotent SQL file, applied whole. There is no migration
 * history table and no version numbering, because there is one version of the
 * schema and an operator should be able to read all of it before running it.
 * When that stops being true, this is the thing to replace — not to extend.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.CURB_POSTGRES_URL;
if (!url) {
  console.error('CURB_POSTGRES_URL is not set. Nothing was applied.');
  process.exit(1);
}

const schemaPath = path.join(process.cwd(), 'lib', 'store', 'schema.sql');
const schema = await fs.readFile(schemaPath, 'utf8');

// A migration is the one place a prepared-statement cache is irrelevant and a
// single connection is the right shape.
const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });

try {
  await sql.unsafe(schema);
  console.log(`applied ${schemaPath}`);

  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `;
  console.log('tables now present:', tables.map((t) => t.table_name).join(', ') || '(none)');
} catch (cause) {
  console.error('migration failed:', cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
