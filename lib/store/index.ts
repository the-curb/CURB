import { FileSystemStore } from './fs.ts';
import type { Store } from './types.ts';

/**
 * Which store this process uses.
 *
 * Postgres when a connection string is configured, the development filesystem
 * store otherwise. The choice is made once, at module load, and announced in
 * `describeStore()` so that a deployment running on the wrong one is visible
 * rather than assumed.
 *
 * The Postgres module is imported lazily. Loading a database driver in a process
 * that will never use one is waste, and — more to the point — a missing driver
 * should not break a development run that was never going to need it.
 */

let singleton: Store | null = null;

export type StoreKind = 'postgres' | 'filesystem';

export function selectedStoreKind(): StoreKind {
  return process.env.CURB_POSTGRES_URL ? 'postgres' : 'filesystem';
}

export async function getStoreAsync(): Promise<Store> {
  if (singleton) return singleton;
  if (selectedStoreKind() === 'postgres') {
    const { PostgresStore } = await import('./postgres.ts');
    singleton = new PostgresStore();
  } else {
    singleton = new FileSystemStore();
  }
  return singleton;
}

/**
 * Synchronous access for callers that cannot await a module load.
 *
 * When Postgres is configured but has not been loaded yet this throws rather
 * than silently handing back the filesystem store: a process that believes it is
 * writing to a database and is writing to a local file would be wrong in the
 * worst possible way, and quietly.
 */
export function getStore(): Store {
  if (singleton) return singleton;
  if (selectedStoreKind() === 'postgres') {
    throw new Error(
      'CURB_POSTGRES_URL is set but the Postgres store has not been initialised. ' +
        'Call getStoreAsync() before any synchronous getStore().',
    );
  }
  singleton = new FileSystemStore();
  return singleton;
}

/** For tests and for the verification script. */
export function setStore(store: Store | null): void {
  singleton = store;
}

export function describeStore(): string {
  const kind = selectedStoreKind();
  return kind === 'postgres'
    ? 'postgres (durable, transactional)'
    : 'filesystem JSONL — development only, not durable on serverless and not transactional';
}

export type { Store };
