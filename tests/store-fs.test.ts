import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSystemStore } from '../lib/store/fs.ts';
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
