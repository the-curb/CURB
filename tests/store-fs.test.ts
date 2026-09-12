import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSystemStore } from '../lib/store/fs.ts';
import { selectedStoreKind } from '../lib/store/index.ts';
import { runStoreConformance } from './store-conformance.ts';

/**
 * The filesystem store against the shared contract.
 *
 * Every store implementation runs these same assertions. When a database store
 * exists, it runs them too — so the two cannot drift, and a new backing store is
 * proved rather than assumed.
 */
runStoreConformance({
  name: 'FileSystemStore',
  fresh: async () => {
    const dir = path.join(tmpdir(), `curb-store-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    return new FileSystemStore(dir);
  },
});

/**
 * A crash between creating the lock file and writing it leaves an empty file.
 * That is not a lock anyone holds; once it is older than a lock would live,
 * the next run takes it over instead of refusing forever.
 */
describe('the FileSystemStore run lock', () => {
  it('takes over an empty lock file left by a crash once it is older than the TTL, and not before', async () => {
    const dir = path.join(tmpdir(), `curb-store-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    const store = new FileSystemStore(dir);
    await fs.writeFile(path.join(dir, 'run.lock'), '', 'utf8');
    const fresh = await store.acquireRunLock('holder-a', 60);
    assert.equal(fresh.state, 'UNDETERMINED', 'an empty file younger than the TTL may still be a lock being written');
    const old = new Date(Date.now() - 120_000);
    await fs.utimes(path.join(dir, 'run.lock'), old, old);
    const taken = await store.acquireRunLock('holder-a', 60);
    assert.equal(taken.state, 'ACQUIRED');
    const refused = await store.acquireRunLock('holder-b', 60);
    assert.equal(refused.state, 'HELD_ELSEWHERE');
  });
});

/**
 * Copying `.env.local.example` must not switch the system onto a database.
 *
 * It did. The example carried a placeholder URL, the selector only checked that
 * the variable was non-empty, and a copied-but-unedited file sent every read to
 * a host that does not resolve. The behaviour was correct — UNREAD with the DNS
 * error attached — and the cause was invisible until somebody read the detail.
 */
describe('store selection', () => {
  const saved = process.env.CURB_POSTGRES_URL;
  const restore = () => {
    if (saved === undefined) delete process.env.CURB_POSTGRES_URL;
    else process.env.CURB_POSTGRES_URL = saved;
  };

  it('uses the filesystem when nothing is configured', () => {
    delete process.env.CURB_POSTGRES_URL;
    assert.equal(selectedStoreKind(), 'filesystem');
    restore();
  });

  it('treats an empty value as unconfigured', () => {
    process.env.CURB_POSTGRES_URL = '   ';
    assert.equal(selectedStoreKind(), 'filesystem');
    restore();
  });

  it('refuses an unedited template instead of quietly using it', () => {
    process.env.CURB_POSTGRES_URL =
      'postgres://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres';
    assert.throws(() => selectedStoreKind(), /placeholders/);
    restore();
  });

  it('accepts a real connection string', () => {
    process.env.CURB_POSTGRES_URL = 'postgres://user:s3cret@db.example.com:6543/postgres';
    assert.equal(selectedStoreKind(), 'postgres');
    restore();
  });
});
