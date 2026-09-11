import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  BlockRecord,
  ObservationRecord,
  HeartbeatRecord,
  PublicationRecord,
  Store,
} from './types.ts';
import type { AgentId } from '../agents/registry.ts';

/**
 * An append-only JSONL store on the local filesystem.
 *
 * This is a development store and says so. It is durable enough to develop the
 * runtime against and to reason about — every write is one line, appended, never
 * rewritten — and it is deliberately not clever.
 *
 * NOT PRODUCTION-READY: a serverless deployment has no durable local disk, and
 * two concurrent instances would each keep their own file. Before deploying,
 * implement `Store` against a real database. The interface exists so that swap
 * touches nothing above it.
 */

const DATA_DIR = process.env.CURB_DATA_DIR ?? path.join(process.cwd(), '.data');

const FILES = {
  heartbeats: 'heartbeats.jsonl',
  publications: 'publications.jsonl',
  blocks: 'blocks.jsonl',
  observations: 'observations.jsonl',
} as const;

async function append(file: string, record: unknown): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(path.join(DATA_DIR, file), `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Read every record from a log. A malformed line is skipped rather than thrown:
 * one corrupt append must not make the whole history unreadable. Skips are
 * counted so the caller can tell "no records" from "records we could not parse".
 */
async function readAll<T>(file: string): Promise<{ records: T[]; skipped: number }> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], skipped: 0 };
    throw cause;
  }

  const records: T[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line) as T);
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
}

export class FileSystemStore implements Store {
  async writeHeartbeat(record: HeartbeatRecord): Promise<void> {
    await append(FILES.heartbeats, record);
  }

  async latestHeartbeats(): Promise<readonly HeartbeatRecord[]> {
    const { records } = await readAll<HeartbeatRecord>(FILES.heartbeats);
    const latest = new Map<AgentId, HeartbeatRecord>();
    for (const record of records) {
      const held = latest.get(record.agentId);
      if (!held || record.runAt > held.runAt) latest.set(record.agentId, record);
    }
    return [...latest.values()];
  }

  async latestHeartbeat(agentId: AgentId): Promise<HeartbeatRecord | null> {
    const all = await this.latestHeartbeats();
    return all.find((r) => r.agentId === agentId) ?? null;
  }

  async writePublication(record: PublicationRecord): Promise<void> {
    await append(FILES.publications, record);
  }

  async recentPublications(limit: number): Promise<readonly PublicationRecord[]> {
    const { records } = await readAll<PublicationRecord>(FILES.publications);
    return records.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  }

  async writeObservations(records: readonly ObservationRecord[]): Promise<void> {
    for (const record of records) await append(FILES.observations, record);
  }

  async observations(key: string, limit: number): Promise<readonly ObservationRecord[]> {
    const { records } = await readAll<ObservationRecord>(FILES.observations);
    return records
      .filter((r) => r.key === key)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .slice(-limit);
  }

  async writeBlock(record: BlockRecord): Promise<void> {
    await append(FILES.blocks, record);
  }

  async recentBlocks(limit: number): Promise<readonly BlockRecord[]> {
    const { records } = await readAll<BlockRecord>(FILES.blocks);
    return records.sort((a, b) => b.blockedAt.localeCompare(a.blockedAt)).slice(0, limit);
  }
}

let singleton: Store | null = null;

export function getStore(): Store {
  singleton ??= new FileSystemStore();
  return singleton;
}
