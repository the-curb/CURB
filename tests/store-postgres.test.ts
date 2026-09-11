import { promises as fs } from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { runStoreConformance } from './store-conformance.ts';

/**
 * The Postgres store against the same contract the filesystem store passes.
 *
 * Without a connection string this reports itself as unverified and stops. It
 * does not pass quietly: a store nobody could test is not a store that works,
 * and a green suite that silently skipped the only implementation meant for
 * production would be exactly the kind of reassuring, empty answer this project
 * exists to refuse.
 *
 *     node --env-file-if-exists=.env.local scripts/migrate.ts
 *     npm run verify:store
 *
 * SAFETY: these cases empty their tables between runs, so they are given a
 * schema of their own — created here, dropped at the end, and never `public`.
 * An earlier draft truncated whatever the connection string pointed at and
 * guarded it with a name check, which would have been one careless URL away
 * from deleting real data. A separate schema removes the question instead of
 * answering it carefully.
 */

const TEST_SCHEMA = 'curb_conformance';
const url = process.env.CURB_POSTGRES_URL;

if (!url) {
  describe('store conformance · PostgresStore', () => {
    it('is UNVERIFIED — no CURB_POSTGRES_URL configured', (t) => {
      t.skip(
        'The Postgres store has never been run against a database. It typechecks, ' +
          'and that is not evidence. Put a pooled connection string in .env.local, ' +
          'then: npm run db:migrate && npm run verify:store',
      );
    });
  });
} else {
  const { PostgresStore, buildSql } = await import('../lib/store/postgres.ts');

  const sql = buildSql(url, { schema: TEST_SCHEMA });
  const schemaSql = await fs.readFile(
    path.join(process.cwd(), 'lib', 'store', 'schema.sql'),
    'utf8',
  );

  // Build the tables inside our own schema. search_path is already set on the
  // connection, so the unqualified names in schema.sql land here and nowhere else.
  await sql.unsafe(`create schema if not exists ${TEST_SCHEMA}`);
  await sql.unsafe(schemaSql);

  after(async () => {
    await sql.unsafe(`drop schema if exists ${TEST_SCHEMA} cascade`);
    await sql.end({ timeout: 5 });
  });

  runStoreConformance({
    name: `PostgresStore (schema ${TEST_SCHEMA})`,
    fresh: async () => {
      await sql.unsafe(
        `truncate ${TEST_SCHEMA}.heartbeats, ${TEST_SCHEMA}.publications, ` +
          `${TEST_SCHEMA}.blocks, ${TEST_SCHEMA}.observations, ${TEST_SCHEMA}.run_lock ` +
          `restart identity`,
      );
      return new PostgresStore(sql);
    },
  });
}
