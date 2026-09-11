import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  BlockRecord,
  HeartbeatRecord,
  ObservationRecord,
  PublicationRecord,
  LockOutcome,
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

async function append(
  dir: string,
  file: string,
  records: readonly unknown[],
): Promise<WriteOutcome> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const payload = records.map((record) => `${JSON.stringify(record)}\n`).join('');
    await fs.appendFile(path.join(/*turbopackIgnore: true*/ dir, file), payload, 'utf8');
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
async function readAll<T>(dir: string, file: string): Promise<Reading<T[]>> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(/*turbopackIgnore: true*/ dir, file), 'utf8');
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

const LOCK_FILE = 'run.lock';

interface LockFile {
  readonly holder: string;
  readonly expiresAt: string;
}

export class FileSystemStore implements Store {
  /**
   * Defaults to the configured directory; tests pass a private one.
   *
   * Written as a declared field and an assignment rather than a parameter
   * property, because Node runs this TypeScript by stripping types and never
   * transforming them — and a parameter property is a transformation. Anything
   * that is not pure erasure will not load here.
   */
  private readonly dir: string;

  constructor(dir: string = DATA_DIR) {
    this.dir = dir;
  }

  /**
   * A lockfile taken with an exclusive create, which is atomic on a single
   * filesystem. An expired lock is stolen, so a process that died holding it
   * does not stop the system forever.
   *
   * DECLARED LIMITATION: stealing an expired lock is read-then-write, so two
   * processes racing for the same expired lock could both take it. On one
   * machine, with one scheduler, that window is not reachable in practice — and
   * across machines this store is already the wrong answer for other reasons.
   * A database advisory lock does not have this gap.
   */
  async acquireRunLock(holder: string, ttlSeconds: number): Promise<LockOutcome> {
    const file = path.join(/*turbopackIgnore: true*/ this.dir, LOCK_FILE);
    const payload: LockFile = {
      holder,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };

    try {
      await fs.mkdir(this.dir, { recursive: true });
      const handle = await fs.open(file, 'wx');
      await handle.writeFile(JSON.stringify(payload), 'utf8');
      await handle.close();
      return { state: 'ACQUIRED', holder };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { state: 'UNDETERMINED', reason: failureReason(cause) };
      }
    }

    let held: LockFile;
    try {
      held = JSON.parse(await fs.readFile(file, 'utf8')) as LockFile;
    } catch (cause) {
      // A lockfile we cannot read is not a lock we may take.
      return { state: 'UNDETERMINED', reason: `lock unreadable: ${failureReason(cause)}` };
    }

    if (new Date(held.expiresAt).getTime() > Date.now()) {
      return { state: 'HELD_ELSEWHERE', holder: held.holder, expiresAt: held.expiresAt };
    }

    try {
      await fs.writeFile(file, JSON.stringify(payload), 'utf8');
      return { state: 'ACQUIRED', holder };
    } catch (cause) {
      return { state: 'UNDETERMINED', reason: `could not take expired lock: ${failureReason(cause)}` };
    }
  }

  /** Extends only a lock we still hold. A lock that lapsed and was taken by
   *  another holder is theirs now; refreshing it would be theft. */
  async refreshRunLock(holder: string, ttlSeconds: number): Promise<WriteOutcome> {
    const file = path.join(/*turbopackIgnore: true*/ this.dir, LOCK_FILE);
    try {
      const held = JSON.parse(await fs.readFile(file, 'utf8')) as LockFile;
      if (held.holder !== holder) {
        return { state: 'FAILED', reason: `lock is held by ${held.holder}, not by ${holder}` };
      }
      const renewed: LockFile = {
        holder,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      };
      await fs.writeFile(file, JSON.stringify(renewed), 'utf8');
      return { state: 'WRITTEN' };
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  /** Releases only a lock we still hold; never removes somebody else's. */
  async releaseRunLock(holder: string): Promise<WriteOutcome> {
    const file = path.join(/*turbopackIgnore: true*/ this.dir, LOCK_FILE);
    try {
      const held = JSON.parse(await fs.readFile(file, 'utf8')) as LockFile;
      if (held.holder !== holder) {
        return { state: 'FAILED', reason: `lock is held by ${held.holder}, not by ${holder}` };
      }
      await fs.rm(file, { force: true });
      return { state: 'WRITTEN' };
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'WRITTEN' };
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async writeHeartbeat(record: HeartbeatRecord): Promise<WriteOutcome> {
    return append(this.dir, FILES.heartbeats, [record]);
  }

  async latestHeartbeats(): Promise<Reading<readonly HeartbeatRecord[]>> {
    const all = await readAll<HeartbeatRecord>(this.dir, FILES.heartbeats);
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
    const published = await append(this.dir, FILES.publications, [publication]);
    if (published.state === 'FAILED') {
      return { state: 'FAILED', reason: published.reason, partial: false };
    }
    const beat = await append(this.dir, FILES.heartbeats, [heartbeat]);
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
    const all = await readAll<PublicationRecord>(this.dir, FILES.publications);
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
    return append(this.dir, FILES.observations, records);
  }

  async observations(key: string, limit: number): Promise<Reading<readonly ObservationRecord[]>> {
    const all = await readAll<ObservationRecord>(this.dir, FILES.observations);
    if (all.state === 'UNREAD') return all;
    return {
      ...all,
      value: all.value
        .filter((r) => r.key === key)
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
        .slice(-limit),
    };
  }

  /**
   * Rewrites the log without the expired rows.
   *
   * This is the one operation that breaks the append-only property, because
   * pruning inherently does. It writes a replacement alongside and renames over
   * the original, so a crash mid-write leaves the old log intact rather than a
   * half-written one — losing a prune is recoverable, losing the series is not.
   */
  async pruneObservations(before: Date): Promise<Reading<number>> {
    const all = await readAll<ObservationRecord>(this.dir, FILES.observations);
    if (all.state === 'UNREAD') return all;

    const cutoff = before.getTime();
    const kept = all.value.filter((r) => new Date(r.observedAt).getTime() >= cutoff);
    const removed = all.value.length - kept.length;
    if (removed === 0) return readNow(0, `${SOURCE} · ${FILES.observations}`);

    const target = path.join(/*turbopackIgnore: true*/ this.dir, FILES.observations);
    const staging = `${target}.pruning`;
    try {
      await fs.writeFile(staging, kept.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf8');
      await fs.rename(staging, target);
      return readNow(removed, `${SOURCE} · ${FILES.observations}`);
    } catch (cause) {
      await fs.rm(staging, { force: true }).catch(() => {});
      return unread('SOURCE_UNREACHABLE', {
        source: `${SOURCE} · ${FILES.observations}`,
        detail: `prune failed, the log is unchanged: ${failureReason(cause)}`,
      });
    }
  }

  async writeBlock(record: BlockRecord): Promise<WriteOutcome> {
    return append(this.dir, FILES.blocks, [record]);
  }

  async recentBlocks(limit: number): Promise<Reading<readonly BlockRecord[]>> {
    const all = await readAll<BlockRecord>(this.dir, FILES.blocks);
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
