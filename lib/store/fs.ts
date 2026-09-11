import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  BlockRecord,
  HeartbeatRecord,
  ObservationRecord,
  PublicationRecord,
  PublishOutcome,
  Store,
  WriteOutcome,
} from './types.ts';
import type { AgentId } from '../agents/registry.ts';
import { readNow, unread, type Reading } from '../doctrine/reading.ts';

/**
 * An append-only JSONL store on the local filesystem.
 *
 * This is a development store, and it says so in its return values rather than
 * only in a comment. `publishAtomically` reports `atomic: false`, because a
 * filesystem cannot give us a transaction and claiming otherwise would be the
 * store lying about the one guarantee that matters.
 *
 * NOT PRODUCTION-READY, for reasons that are properties of the medium rather
 * than of this code:
 *   - A serverless deployment has no durable local disk.
 *   - Two instances would each keep their own file, and neither would be wrong.
 *   - There is no transaction, so a publication and its heartbeat can disagree.
 *   - Observations round-trip through a lossy double; see ObservationRecord.
 *
 * The interface exists so that replacing this touches nothing above it.
 */

const DATA_DIR = process.env.CURB_DATA_DIR ?? path.join(process.cwd(), '.data');

const FILES = {
  heartbeats: 'heartbeats.jsonl',
  publications: 'publications.jsonl',
  blocks: 'blocks.jsonl',
  observations: 'observations.jsonl',
} as const;

const SOURCE = 'filesystem JSONL store (development)';

function failureReason(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown store failure';
}

async function append(file: string, records: readonly unknown[]): Promise<WriteOutcome> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const payload = records.map((record) => `${JSON.stringify(record)}\n`).join('');
    await fs.appendFile(path.join(DATA_DIR, file), payload, 'utf8');
    return { state: 'WRITTEN' };
  } catch (cause) {
    return { state: 'FAILED', reason: `${file}: ${failureReason(cause)}` };
  }
}

/**
 * Read every record from a log.
 *
 * A missing file is an empty log — a real answer, not a failure. Any other error
 * is UNREAD: "we could not open the record" must never arrive looking like "the
 * record is empty".
 *
 * A malformed line is skipped rather than thrown, so one corrupt append does not
 * make the whole history unreadable, and the number skipped rides along in the
 * source so that "no records" stays distinguishable from "records we could not
 * parse".
 */
async function readAll<T>(file: string): Promise<Reading<T[]>> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return readNow<T[]>([], `${SOURCE} · ${file} (not yet created)`);
    }
    return unread('SOURCE_UNREACHABLE', {
      source: `${SOURCE} · ${file}`,
      detail: failureReason(cause),
    });
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

  const source =
    skipped === 0
      ? `${SOURCE} · ${file}`
      : `${SOURCE} · ${file} (${skipped} unparsable lines skipped)`;
  return readNow(records, source);
}

export class FileSystemStore implements Store {
  async writeHeartbeat(record: HeartbeatRecord): Promise<WriteOutcome> {
    return append(FILES.heartbeats, [record]);
  }

  async latestHeartbeats(): Promise<Reading<readonly HeartbeatRecord[]>> {
    const all = await readAll<HeartbeatRecord>(FILES.heartbeats);
    if (all.state === 'UNREAD') return all;

    const latest = new Map<AgentId, HeartbeatRecord>();
    for (const record of all.value) {
      const held = latest.get(record.agentId);
      if (!held || record.runAt > held.runAt) latest.set(record.agentId, record);
    }
    return { ...all, value: [...latest.values()] };
  }

  async latestHeartbeat(agentId: AgentId): Promise<Reading<HeartbeatRecord | null>> {
    const all = await this.latestHeartbeats();
    if (all.state === 'UNREAD') return all;
    return { ...all, value: all.value.find((r) => r.agentId === agentId) ?? null };
  }

  /**
   * Writes the publication, then the heartbeat, and reports honestly that the
   * pair was not atomic. If the heartbeat fails after the publication landed,
   * `partial: true` names the exact repair an operator has to make.
   */
  async publishAtomically(
    publication: PublicationRecord,
    heartbeat: HeartbeatRecord,
  ): Promise<PublishOutcome> {
    const published = await append(FILES.publications, [publication]);
    if (published.state === 'FAILED') {
      return { state: 'FAILED', reason: published.reason, partial: false };
    }
    const beat = await append(FILES.heartbeats, [heartbeat]);
    if (beat.state === 'FAILED') {
      return {
        state: 'FAILED',
        reason: `${beat.reason} — the publication was already written, so it now exists with no heartbeat`,
        partial: true,
      };
    }
    return { state: 'WRITTEN', atomic: false };
  }

  async recentPublications(limit: number): Promise<Reading<readonly PublicationRecord[]>> {
    const all = await readAll<PublicationRecord>(FILES.publications);
    if (all.state === 'UNREAD') return all;
    return {
      ...all,
      value: [...all.value]
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, limit),
    };
  }

  async writeObservations(records: readonly ObservationRecord[]): Promise<WriteOutcome> {
    if (records.length === 0) return { state: 'WRITTEN' };
    return append(FILES.observations, records);
  }

  async observations(key: string, limit: number): Promise<Reading<readonly ObservationRecord[]>> {
    const all = await readAll<ObservationRecord>(FILES.observations);
    if (all.state === 'UNREAD') return all;
    return {
      ...all,
      value: all.value
        .filter((r) => r.key === key)
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
        .slice(-limit),
    };
  }

  async writeBlock(record: BlockRecord): Promise<WriteOutcome> {
    return append(FILES.blocks, [record]);
  }

  async recentBlocks(limit: number): Promise<Reading<readonly BlockRecord[]>> {
    const all = await readAll<BlockRecord>(FILES.blocks);
    if (all.state === 'UNREAD') return all;
    return {
      ...all,
      value: [...all.value].sort((a, b) => b.blockedAt.localeCompare(a.blockedAt)).slice(0, limit),
    };
  }
}

let singleton: Store | null = null;

export function getStore(): Store {
  singleton ??= new FileSystemStore();
  return singleton;
}
