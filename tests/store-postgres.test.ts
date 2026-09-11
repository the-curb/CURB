import { describe, it } from 'node:test';
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
 *     CURB_POSTGRES_URL=postgres://... node scripts/migrate.ts
 *     CURB_POSTGRES_URL=postgres://... npm run verify:store
 */

const url = process.env.CURB_POSTGRES_URL;

if (!url) {
  describe('store conformance · PostgresStore', () => {
    it('is UNVERIFIED — no CURB_POSTGRES_URL configured', (t) => {
      t.skip(
        'The Postgres store has never been run against a database. It typechecks, ' +
          'and that is not evidence. Set CURB_POSTGRES_URL, apply lib/store/schema.sql ' +
          'with scripts/migrate.ts, then run: npm run verify:store',
      );
    });
  });
} else {
  const { PostgresStore, getSql } = await import('../lib/store/postgres.ts');

  runStoreConformance({
    name: 'PostgresStore',
    fresh: async () => {
      const sql = getSql(url);
      // Each case starts from an empty store, exactly as the filesystem target
      // does. Truncating is destructive, so this refuses to run against anything
      // that does not announce itself as a test database.
      if (!/test|dev|local/i.test(url)) {
        throw new Error(
          'CURB_POSTGRES_URL does not look like a test database. The conformance ' +
            'suite truncates every table and will not do that to an unrecognised target. ' +
            'Point it at a database whose name contains "test", "dev" or "local".',
        );
      }
      await sql.unsafe(
        'truncate heartbeats, publications, blocks, observations, run_lock restart identity',
      );
      return new PostgresStore(sql);
    },
  });
}
