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
