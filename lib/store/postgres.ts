import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  BlockRecord,
  DayRecord,
  HeartbeatRecord,
  LockOutcome,
  NarrationOutcome,
  NarrationRecord,
  ObservationRecord,
  PublicationRecord,
  PublishOutcome,
  RecordCounts,
  RunOutcome,
  SnapshotRecord,
  Store,
  WriteOutcome,
  ConditionalWriteOutcome,
} from './types.ts';
import type { AgentId } from '../agents/registry.ts';
import { readNow, unread, type Reading } from '../doctrine/reading.ts';
import type { DeclaredFigure, PolicyBreach } from '../doctrine/policy.ts';

/**
 * A Postgres-backed Store.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VERIFIED against Supabase (shared transaction pooler, port 6543) on
 * 2026-09-11: the full store contract in tests/store-conformance.ts, 22 cases,
 * all passing in a schema of their own.
 *
 * That verification found one real defect the type checker could not: jsonb
 * columns written as `${JSON.stringify(x)}::jsonb` were stored double-encoded
 * and read back as strings. See `asJson`. The suite exists so the next change
 * to this file is proved the same way rather than assumed:
 *
 *     npm run verify:store
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Why the shape it has:
 *
 *   * One module-level client. Serverless invocations are short and numerous,
 *     and a pool created per request exhausts Postgres connection slots long
 *     before it exhausts anything else.
 *   * `prepare: false`, because a transaction-mode pooler does not keep the
 *     session a prepared statement belongs to.
 *   * Publishing is one transaction, so a publication and its heartbeat cannot
 *     disagree about whether a run happened — the guarantee the filesystem
 *     store has to decline.
 */

const SOURCE = 'postgres';

type Sql = ReturnType<typeof postgres>;

let client: Sql | null = null;

/**
 * Whether this process is a serverless invocation rather than a long-lived
 * server. Detected from the platform's own markers; nothing here guesses from
 * NODE_ENV, which says nothing about the process model.
 */
function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY ||
      process.env.CF_PAGES,
  );
}

export interface SqlOptions {
  /** Which schema the tables live in. The conformance suite uses its own. */
  readonly schema?: string;
}

/**
 * Build a client.
 *
 * SSL: when the connection string already says `sslmode`, the driver honours it
 * and nothing is overridden here. Otherwise this defaults to `require`, which
 * encrypts the connection but does NOT verify the server's certificate chain.
 *
 * That is a real, stated trade: `require` protects the password from a passive
 * listener but not from an active machine-in-the-middle. `verify-full` is the
 * correct setting and needs the provider's CA bundle; put `?sslmode=verify-full`
 * in the URL once that is in place, and this default stops applying.
 */
export function buildSql(url: string, options: SqlOptions = {}): Sql {
  const declaresSsl = /[?&]sslmode=/.test(url);
  return postgres(url, {
    // A transaction pooler hands back a different session each time, so a
    // prepared statement cached against the last one is not there any more.
    prepare: false,
    /**
     * Pool size depends on where this runs, and the two cases pull opposite ways.
     *
     * Serverless: one. The pool is per warm instance and the instance count is
     * not something this process controls, so every extra connection here is
     * multiplied by however many instances exist. That is the vendor's guidance
     * and it is not conservatism.
     *
     * A long-lived server: two. With a single connection there is nowhere to go
     * when that connection goes bad — and it did: after a run spent minutes in
     * upstream timeouts, the one pooled connection stopped answering, every
     * store read stalled past sixty seconds, and a fresh client answered the
     * same query in one. A second connection is the difference between a
     * degraded server and a stuck one.
     */
    max: poolSize(),
    idle_timeout: 20,
    connect_timeout: 15,
    /**
     * Recycle connections every thirty minutes regardless. A connection that
     * has gone quietly wrong cannot then outlive the incident that broke it.
     */
    max_lifetime: 30 * 60,
    ...(declaresSsl ? {} : { ssl: 'require' as const }),
    ...(options.schema ? { connection: { search_path: options.schema } } : {}),
  });
}

/** How many connections the pool holds, and so how many statements may be in flight. */
export function poolSize(): number {
  return Number(process.env.CURB_POSTGRES_MAX ?? (isServerless() ? 1 : 2));
}

/**
 * A counting semaphore the size of the pool. The driver queues statements
 * when every connection is busy, and a timer started before the queue would
 * count the wait as the statement's own time — which is how six parallel
 * reads on a pool of one produced a "did not return within 10000ms" for a
 * database that was answering every statement in under a second, and then
 * discarded the client and dropped the five behind it. The timer starts when
 * a slot is held, so it measures the statement and nothing else.
 */
export class Slots {
  private free: number;
  private readonly waiting: Array<() => void> = [];

  constructor(size: number) {
    this.free = Math.max(1, size);
  }

  async acquire(): Promise<void> {
    if (this.free > 0) {
      this.free -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.free += 1;
  }
}

/** One client for the process. Never build one per request. */
export function getSql(url: string = requireUrl()): Sql {
  client ??= buildSql(url, {
    ...(process.env.CURB_POSTGRES_SCHEMA ? { schema: process.env.CURB_POSTGRES_SCHEMA } : {}),
  });
  return client;
}

function requireUrl(): string {
  const url = process.env.CURB_POSTGRES_URL;
  if (!url) {
    throw new Error(
      'CURB_POSTGRES_URL is not set. Use a pooled connection string, not a direct one.',
    );
  }
  return url;
}

function failureReason(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown database failure';
}

/**
 * Produce a plain JSON value for the driver's `json()` helper.
 *
 * This is a serialisation round-trip, not a cast. Interface types carry no
 * index signature and the driver's JSONValue demands one, so the honest way
 * through is to hand it the actual JSON shape — which is exactly what will be
 * stored, with no interface or readonly-ness left on it.
 *
 * The alternative that was tried first, `${JSON.stringify(x)}::jsonb`, sends a
 * text parameter that Postgres then parses into a jsonb *string* scalar: JSON
 * inside JSON. It reads back as a 72-character string instead of an array, and
 * only the conformance suite noticed. This exists so that cannot recur.
 */
function asJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value));
}

/** Any failure to read is UNREAD with the database's own message attached. */
function unreadable<T>(what: string, cause: unknown): Reading<T> {
  return unread('SOURCE_UNREACHABLE', {
    source: `${SOURCE} · ${what}`,
    detail: failureReason(cause),
  });
}

interface HeartbeatRow {
  agent_id: string;
  run_at: Date;
  outcome: string;
  sources_reached: number;
  sources_expected: number;
  oldest_input_at: Date | null;
  publication_id: string | null;
  detail: string | null;
}

function toHeartbeat(row: HeartbeatRow): HeartbeatRecord {
  return {
    agentId: row.agent_id as AgentId,
    runAt: row.run_at.toISOString(),
    outcome: row.outcome as RunOutcome,
    sourcesReached: row.sources_reached,
    sourcesExpected: row.sources_expected,
    oldestInputAt: row.oldest_input_at ? row.oldest_input_at.toISOString() : null,
    publicationId: row.publication_id,
    detail: row.detail,
  };
}

interface PublicationRow {
  id: string;
  agent_id: string;
  published_at: Date;
  headline: string;
  body: string;
  figures: DeclaredFigure[];
  sources_reached: number;
}

function toPublication(row: PublicationRow): PublicationRecord {
  return {
    id: row.id,
    agentId: row.agent_id as AgentId,
    publishedAt: row.published_at.toISOString(),
    headline: row.headline,
    body: row.body,
    figures: row.figures,
    sourcesReached: row.sources_reached,
  };
}

interface BlockRow {
  id: string;
  agent_id: string;
  blocked_at: Date;
  headline: string;
  body: string;
  breaches: PolicyBreach[];
}

function toBlock(row: BlockRow): BlockRecord {
  return {
    id: row.id,
    agentId: row.agent_id as AgentId,
    blockedAt: row.blocked_at.toISOString(),
    headline: row.headline,
    body: row.body,
    breaches: row.breaches,
  };
}

interface NarrationRow {
  day: string;
  edition_hash: string;
  outcome: string;
  standfirst: string | null;
  model: string | null;
  detail: string | null;
  generated_at: Date;
}

function toNarration(row: NarrationRow): NarrationRecord {
  return {
    day: row.day,
    editionHash: row.edition_hash,
    outcome: row.outcome as NarrationOutcome,
    standfirst: row.standfirst,
    model: row.model,
    detail: row.detail,
    generatedAt: row.generated_at.toISOString(),
  };
}

interface SnapshotRow {
  key: string;
  observed_at: Date;
  payload: Record<string, unknown>;
  version: string | number;
}

function toSnapshot(row: SnapshotRow): SnapshotRecord {
  return { key: row.key, observedAt: row.observed_at.toISOString(), payload: row.payload, version: Number(row.version) };
}

interface ObservationRow {
  key: string;
  observed_at: Date;
  value: string;
  raw: string | null;
  decimals: number | null;
  source: string;
}

function toObservation(row: ObservationRow): ObservationRecord {
  const base = {
    key: row.key,
    observedAt: row.observed_at.toISOString(),
    // `numeric` arrives as a string so nothing is lost in transit; the lossy
    // step is this conversion, and `raw` is kept precisely because of it.
    value: Number(row.value),
    source: row.source,
  };
  if (row.raw === null || row.decimals === null) return base;
  return { ...base, raw: row.raw, decimals: row.decimals };
}

/**
 * How long one store query may take before it is treated as lost.
 *
 * The server's own statement_timeout only fires for a query the server
 * received. On an unreliable network the query bytes can vanish in transit, and
 * then nothing anywhere ever gives up: the driver waits for a reply that is not
 * coming, the pool's one connection is held by it, and every later query queues
 * behind it forever. That was observed — three concurrent reads stalling for
 * ten minutes on a network that, twenty minutes later, ran the same reads in a
 * second. A system that can freeze cannot report anything, including that it
 * has frozen.
 */
const QUERY_TIMEOUT_MS = Number(process.env.CURB_POSTGRES_QUERY_TIMEOUT_MS ?? 10_000);

/**
 * The driver's own codes for a connection that went away, plus the socket
 * errors underneath them. Anything else — a constraint, a syntax error, a
 * statement timeout the server chose — is the database answering, and is not
 * retried.
 */
const CONNECTION_FAULTS = new Set([
  'CONNECTION_DESTROYED',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);

function isConnectionFault(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const code = (cause as Error & { code?: unknown }).code;
  return typeof code === 'string' && CONNECTION_FAULTS.has(code);
}

class QueryTimeout extends Error {
  constructor(label: string) {
    super(`${label} did not return within ${QUERY_TIMEOUT_MS}ms — treated as lost`);
    this.name = 'QueryTimeout';
  }
}

export class PostgresStore implements Store {
  /** Set when a client was handed in (tests); it is never replaced. */
  private readonly provided: Sql | null;
  private current: Sql;
  private readonly slots: Slots;

  constructor(sql?: Sql) {
    this.provided = sql ?? null;
    this.current = sql ?? getSql();
    this.slots = new Slots(poolSize());
  }

  private get sql(): Sql {
    return this.current;
  }

  /**
   * Race a query against the timeout. On timeout the client is discarded: a
   * connection that stopped answering is not one to keep waiting on, and with a
   * pool of one it is the whole pool. The caller's existing catch turns the
   * rejection into UNREAD or FAILED, so nothing above this sees a hang.
   */
  private async guard<T>(label: string, run: () => Promise<T>): Promise<T> {
    // Hold a slot for the whole attempt, retry included: the timer inside
    // measures a statement that has a connection, not one waiting for it.
    await this.slots.acquire();
    try {
      try {
        return await this.timed(label, run);
      } catch (cause) {
        if (cause instanceof QueryTimeout) {
          this.discardClient();
          throw cause;
        }
        // A socket that was dropped between two statements is not an answer
        // from the database; it is the network. The driver reconnects on the
        // next statement, so that statement is sent once more — once. A second
        // failure is reported as it is, and a query the database rejected is
        // never resent at all.
        if (!isConnectionFault(cause)) throw cause;
        return await this.timed(label, run);
      }
    } finally {
      this.slots.release();
    }
  }

  private async timed<T>(label: string, run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new QueryTimeout(label)), QUERY_TIMEOUT_MS);
    });
    try {
      return await Promise.race([run(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Drop the wedged client and build a fresh one for the next call.
   *
   * Ending is fire-and-forget with a short limit: a wedged client may not end
   * cleanly, and waiting on it would be the same stall in a different place.
   * A client handed in by a test is left alone — there is nothing to rebuild it
   * from, and the test owns its lifecycle.
   */
  async recordCounts(): Promise<Reading<RecordCounts>> {
    try {
      return await this.guard('recordCounts', async () => {
        // Exact counts, one round trip. These tables are small enough that an
        // exact count is cheap, and an estimate would be a different claim.
        const rows = await this.sql<{ heartbeats: string; publications: string; blocks: string; observations: string; snapshots: string }[]>`
          select
            (select count(*) from heartbeats)   as heartbeats,
            (select count(*) from publications) as publications,
            (select count(*) from blocks)       as blocks,
            (select count(*) from observations) as observations,
            (select count(*) from snapshots)    as snapshots
        `;
        const row = rows[0]!;
        return readNow(
          {
            heartbeats: Number(row.heartbeats),
            publications: Number(row.publications),
            blocks: Number(row.blocks),
            observations: Number(row.observations),
            snapshots: Number(row.snapshots),
          },
          `${SOURCE} · counts`,
        );
      });
    } catch (cause) {
      return unreadable('recordCounts', cause);
    }
  }

  async close(): Promise<void> {
    // A client handed in by a test is the test's to end.
    if (this.provided !== null) return;
    const ending = this.current;
    client = null;
    try {
      await ending.end({ timeout: 5 });
    } catch {
      // Already gone, or refusing to go: either way there is nothing to hold.
    }
  }

  private discardClient(): void {
    const stale = this.current;
    void stale.end({ timeout: 2 }).catch(() => {});
    if (this.provided !== null) return;
    client = null;
    this.current = getSql();
  }

  /**
   * Takes the lock by inserting the single row, or by overwriting it when the
   * existing one has expired. The `where` clause is what makes this safe: a live
   * lock updates no rows, so nothing is returned and nothing was taken. A row
   * already under this holder is taken again: the holder is unique to one tick,
   * so that row is this tick's own insert whose answer was lost on the wire
   * and resent by guard() — reporting it HELD_ELSEWHERE would leave the lock
   * under this holder, unreleased, for the whole TTL.
   */
  async acquireRunLock(holder: string, ttlSeconds: number): Promise<LockOutcome> {
    try {
      return await this.guard('acquireRunLock', async () => {
        const taken = await this.sql<{ holder: string }[]>`
          insert into run_lock (id, holder, expires_at)
          values (1, ${holder}, now() + make_interval(secs => ${ttlSeconds}))
          on conflict (id) do update
            set holder = excluded.holder, expires_at = excluded.expires_at
            where run_lock.expires_at < now() or run_lock.holder = excluded.holder
          returning holder
        `;
        if (taken.length > 0) return { state: 'ACQUIRED', holder };

        const held = await this.sql<{ holder: string; expires_at: Date }[]>`
          select holder, expires_at from run_lock where id = 1
        `;
        return {
          state: 'HELD_ELSEWHERE',
          holder: held[0]?.holder ?? null,
          expiresAt: held[0]?.expires_at?.toISOString() ?? null,
        };
      });
    } catch (cause) {
      // A lock we could not check is not a lock we hold, and not one that is free.
      return { state: 'UNDETERMINED', reason: failureReason(cause) };
    }
  }

  /**
   * The `where holder =` clause is the whole safety: a lapsed lock that another
   * holder took updates no rows, and no rows updated is reported as a failure
   * rather than as a renewal that did not happen.
   */
  async refreshRunLock(holder: string, ttlSeconds: number): Promise<WriteOutcome> {
    try {
      return await this.guard('refreshRunLock', async () => {
        const renewed = await this.sql`
          update run_lock
            set expires_at = now() + make_interval(secs => ${ttlSeconds})
          where id = 1 and holder = ${holder}
          returning holder
        `;
        return renewed.length > 0
          ? { state: 'WRITTEN' as const }
          : { state: 'FAILED' as const, reason: `lock is no longer held by ${holder}` };
      });
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async releaseRunLock(holder: string): Promise<WriteOutcome> {
    try {
      return await this.guard('releaseRunLock', async () => {
        const removed = await this.sql`
          delete from run_lock where id = 1 and holder = ${holder} returning id
        `;
        // Already gone is fine; somebody else's lock is not ours to remove.
        if (removed.length === 0) {
          const held = await this.sql<{ holder: string }[]>`
            select holder from run_lock where id = 1
          `;
          if (held.length > 0) {
            return { state: 'FAILED', reason: `lock is held by ${held[0]?.holder}, not by ${holder}` };
          }
        }
        return { state: 'WRITTEN' };
      });
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async writeHeartbeat(record: HeartbeatRecord): Promise<WriteOutcome> {
    try {
      return await this.guard('writeHeartbeat', async () => {
        await this.insertHeartbeat(this.sql, record);
        return { state: 'WRITTEN' };
      });
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  private async insertHeartbeat(sql: Sql, record: HeartbeatRecord): Promise<void> {
    await sql`
      insert into heartbeats
        (agent_id, run_at, outcome, sources_reached, sources_expected,
         oldest_input_at, publication_id, detail)
      values
        (${record.agentId}, ${record.runAt}, ${record.outcome}, ${record.sourcesReached},
         ${record.sourcesExpected}, ${record.oldestInputAt}, ${record.publicationId},
         ${record.detail})
    `;
  }

  async latestHeartbeats(): Promise<Reading<readonly HeartbeatRecord[]>> {
    try {
      return await this.guard('latestHeartbeats', async () => {
        const rows = await this.sql<HeartbeatRow[]>`
          select distinct on (agent_id)
            agent_id, run_at, outcome, sources_reached, sources_expected,
            oldest_input_at, publication_id, detail
          from heartbeats
          order by agent_id, run_at desc
        `;
        return readNow(rows.map(toHeartbeat), `${SOURCE} · heartbeats`);
      });
    } catch (cause) {
      return unreadable('heartbeats', cause);
    }
  }

  async latestHeartbeat(agentId: AgentId): Promise<Reading<HeartbeatRecord | null>> {
    try {
      return await this.guard('latestHeartbeat', async () => {
        const rows = await this.sql<HeartbeatRow[]>`
          select agent_id, run_at, outcome, sources_reached, sources_expected,
                 oldest_input_at, publication_id, detail
          from heartbeats
          where agent_id = ${agentId}
          order by run_at desc
          limit 1
        `;
        const row = rows[0];
        return readNow(row ? toHeartbeat(row) : null, `${SOURCE} · heartbeats`);
      });
    } catch (cause) {
      return unreadable('heartbeats', cause);
    }
  }

  /**
   * One transaction. Either the run is recorded as having happened and its words
   * exist, or neither is true — there is no state in between for an operator to
   * discover later.
   */
  async publishAtomically(
    publication: PublicationRecord,
    heartbeat: HeartbeatRecord,
  ): Promise<PublishOutcome> {
    try {
      return await this.guard('publishAtomically', async () => {
        await this.sql.begin(async (tx) => {
          await tx`
            insert into publications
              (id, agent_id, published_at, headline, body, figures, sources_reached)
            values
              (${publication.id}, ${publication.agentId}, ${publication.publishedAt},
               ${publication.headline}, ${publication.body},
               ${this.sql.json(asJson(publication.figures))},
               ${publication.sourcesReached})
          `;
          await this.insertHeartbeat(tx, heartbeat);
        });
        return { state: 'WRITTEN', atomic: true };
      });
    } catch (cause) {
      // The transaction rolled back, so neither row is there.
      return { state: 'FAILED', reason: failureReason(cause), partial: false };
    }
  }

  async recentPublications(limit: number): Promise<Reading<readonly PublicationRecord[]>> {
    try {
      return await this.guard('recentPublications', async () => {
        const rows = await this.sql<PublicationRow[]>`
          select id, agent_id, published_at, headline, body, figures, sources_reached
          from publications
          order by published_at desc
          limit ${limit}
        `;
        return readNow(rows.map(toPublication), `${SOURCE} · publications`);
      });
    } catch (cause) {
      return unreadable('publications', cause);
    }
  }

  async writeObservations(records: readonly ObservationRecord[]): Promise<WriteOutcome> {
    if (records.length === 0) return { state: 'WRITTEN' };
    try {
      return await this.guard('writeObservations', async () => {
        // One statement for the whole batch. A Pillar run writes a row per feed
        // and an Archivist run one per token, and through a transaction pooler
        // every statement is a round trip; two hundred of them from a serverless
        // region a continent away is a run that outlives its lock. The arrays
        // are typed on the Postgres side so a value that does not parse fails
        // the statement rather than landing as something else.
        await this.sql`
          insert into observations (key, observed_at, value, raw, decimals, source)
          select key, observed_at, value::numeric, raw, decimals, source
          from unnest(
            ${records.map((r) => r.key)}::text[],
            ${records.map((r) => r.observedAt)}::timestamptz[],
            ${records.map((r) => String(r.value))}::text[],
            ${records.map((r) => r.raw ?? null)}::text[],
            ${records.map((r) => r.decimals ?? null)}::int[],
            ${records.map((r) => r.source)}::text[]
          ) as rows(key, observed_at, value, raw, decimals, source)
        `;
        return { state: 'WRITTEN' };
      });
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async observations(key: string, limit: number): Promise<Reading<readonly ObservationRecord[]>> {
    try {
      return await this.guard('observations', async () => {
        // Newest first for the limit, then reversed: the caller wants oldest first
        // so the series is ready to compute over, but the limit has to cut the
        // oldest records rather than the newest ones.
        const rows = await this.sql<ObservationRow[]>`
          select key, observed_at, value, raw, decimals, source
          from observations
          where key = ${key}
          order by observed_at desc
          limit ${limit}
        `;
        return readNow(rows.map(toObservation).reverse(), `${SOURCE} · observations`);
      });
    } catch (cause) {
      return unreadable('observations', cause);
    }
  }

  /**
   * Deletes expired observations and reports the count the database actually
   * removed, not the count we expected it to.
   */
  async pruneObservations(before: Date): Promise<Reading<number>> {
    try {
      return await this.guard('pruneObservations', async () => {
        const removed = await this.sql`
          delete from observations where observed_at < ${before.toISOString()} returning id
        `;
        return readNow(removed.length, `${SOURCE} · observations`);
      });
    } catch (cause) {
      // A prune we could not confirm is not a prune of zero.
      return unreadable('observations prune', cause);
    }
  }

  async writeBlock(record: BlockRecord): Promise<WriteOutcome> {
    try {
      return await this.guard('writeBlock', async () => {
        await this.sql`
          insert into blocks (id, agent_id, blocked_at, headline, body, breaches)
          values (${record.id}, ${record.agentId}, ${record.blockedAt}, ${record.headline},
                  ${record.body}, ${this.sql.json(asJson(record.breaches))})
        `;
        return { state: 'WRITTEN' };
      });
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async dayRecord(day: string): Promise<Reading<DayRecord>> {
    try {
      return await this.guard('dayRecord', async () => {
        // Half-open UTC day. The bounds are computed here, not in SQL, so the
        // same string means the same instant in every store.
        const from = `${day}T00:00:00.000Z`;
        const to = new Date(new Date(from).getTime() + 24 * 3600 * 1000).toISOString();
        const [pubs, beats, blocks] = await Promise.all([
          this.sql<PublicationRow[]>`
            select id, agent_id, published_at, headline, body, figures, sources_reached
            from publications
            where published_at >= ${from} and published_at < ${to}
            order by published_at asc
          `,
          this.sql<HeartbeatRow[]>`
            select agent_id, run_at, outcome, sources_reached, sources_expected,
                   oldest_input_at, publication_id, detail
            from heartbeats
            where run_at >= ${from} and run_at < ${to}
            order by run_at asc
          `,
          this.sql<BlockRow[]>`
            select id, agent_id, blocked_at, headline, body, breaches
            from blocks
            where blocked_at >= ${from} and blocked_at < ${to}
            order by blocked_at asc
          `,
        ]);
        return readNow<DayRecord>(
          {
            day,
            publications: pubs.map(toPublication),
            heartbeats: beats.map(toHeartbeat),
            blocks: blocks.map(toBlock),
          },
          `${SOURCE} · day ${day}`,
        );
      });
    } catch (cause) {
      return unreadable('day record', cause);
    }
  }

  async publicationDays(limit: number): Promise<Reading<readonly string[]>> {
    try {
      return await this.guard('publicationDays', async () => {
        const rows = await this.sql<{ day: string }[]>`
          select to_char(published_at at time zone 'UTC', 'YYYY-MM-DD') as day
          from publications
          group by 1
          order by 1 desc
          limit ${limit}
        `;
        return readNow(rows.map((r) => r.day), `${SOURCE} · publications`);
      });
    } catch (cause) {
      return unreadable('publication days', cause);
    }
  }

  async publicationsByAgent(agentId: AgentId, limit: number): Promise<Reading<readonly PublicationRecord[]>> {
    try {
      return await this.guard('publicationsByAgent', async () => {
        const rows = await this.sql<PublicationRow[]>`
          select id, agent_id, published_at, headline, body, figures, sources_reached
          from publications
          where agent_id = ${agentId}
          order by published_at desc
          limit ${limit}
        `;
        return readNow(rows.map(toPublication), `${SOURCE} · publications`);
      });
    } catch (cause) {
      return unreadable('publications by agent', cause);
    }
  }

  async heartbeatsByAgent(agentId: AgentId, limit: number): Promise<Reading<readonly HeartbeatRecord[]>> {
    try {
      return await this.guard('heartbeatsByAgent', async () => {
        const rows = await this.sql<HeartbeatRow[]>`
          select agent_id, run_at, outcome, sources_reached, sources_expected,
                 oldest_input_at, publication_id, detail
          from heartbeats
          where agent_id = ${agentId}
          order by run_at desc
          limit ${limit}
        `;
        return readNow(rows.map(toHeartbeat), `${SOURCE} · heartbeats`);
      });
    } catch (cause) {
      return unreadable('heartbeats by agent', cause);
    }
  }

  async narration(day: string): Promise<Reading<NarrationRecord | null>> {
    try {
      return await this.guard('narration', async () => {
        const rows = await this.sql<NarrationRow[]>`
          select day, edition_hash, outcome, standfirst, model, detail, generated_at
          from narrations
          where day = ${day}
        `;
        const row = rows[0];
        return readNow(row ? toNarration(row) : null, `${SOURCE} · narrations`);
      });
    } catch (cause) {
      return unreadable('narration', cause);
    }
  }

  /** Upsert: one row per day, and a later attempt replaces the earlier one. */
  async writeNarration(record: NarrationRecord): Promise<WriteOutcome> {
    try {
      return await this.guard('writeNarration', async () => {
        await this.sql`
          insert into narrations
            (day, edition_hash, outcome, standfirst, model, detail, generated_at)
          values
            (${record.day}, ${record.editionHash}, ${record.outcome}, ${record.standfirst},
             ${record.model}, ${record.detail}, ${record.generatedAt})
          on conflict (day) do update set
            edition_hash = excluded.edition_hash,
            outcome      = excluded.outcome,
            standfirst   = excluded.standfirst,
            model        = excluded.model,
            detail       = excluded.detail,
            generated_at = excluded.generated_at
        `;
        return { state: 'WRITTEN' as const };
      });
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  /** Upsert, one statement for the batch: one row per key, ever. */
  async writeSnapshots(records: readonly SnapshotRecord[]): Promise<WriteOutcome> {
    if (records.length === 0) return { state: 'WRITTEN' };
    try {
      return await this.guard('writeSnapshots', async () => {
        await this.sql`
          insert into snapshots (key, observed_at, payload)
          select key, observed_at, payload::jsonb
          from unnest(
            ${records.map((r) => r.key)}::text[],
            ${records.map((r) => r.observedAt)}::timestamptz[],
            ${records.map((r) => JSON.stringify(asJson(r.payload)))}::text[]
          ) as rows(key, observed_at, payload)
          on conflict (key) do update set
            observed_at = excluded.observed_at,
            payload     = excluded.payload,
            version     = snapshots.version + 1
        `;
        return { state: 'WRITTEN' };
      });
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  /** The columns this build writes that a migration adds: each named here is checked to exist. */
  static readonly REQUIRED_COLUMNS: readonly { table: string; column: string }[] = [
    { table: 'snapshots', column: 'version' },
    { table: 'snapshots', column: 'write_token' },
  ];

  async schemaStatus(): Promise<{ readonly state: 'CURRENT' | 'BEHIND' | 'UNREAD'; readonly detail: string | null }> {
    try {
      return await this.guard('schemaStatus', async () => {
        const rows = await this.sql<{ table_name: string; column_name: string }[]>`
          select table_name, column_name from information_schema.columns
          where table_schema = current_schema() and table_name in ('snapshots')
        `;
        const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
        const missing = PostgresStore.REQUIRED_COLUMNS.filter((c) => !present.has(`${c.table}.${c.column}`)).map((c) => `${c.table}.${c.column}`);
        return missing.length === 0 ? { state: 'CURRENT' as const, detail: null } : { state: 'BEHIND' as const, detail: `missing ${missing.join(', ')}; run npm run db:migrate` };
      });
    } catch (cause) {
      return { state: 'UNREAD', detail: failureReason(cause) };
    }
  }

  /** One statement either way: an insert that yields to an existing row, or an update that matches only the version read. Zero rows back is the conflict. */
  async writeSnapshotIf(record: SnapshotRecord, expectedVersion: number | null): Promise<ConditionalWriteOutcome> {
    // One token per call, outside the guarded closure: guard() resends the
    // closure once after a dropped socket, and the resend carries the same
    // token — so a write that landed before the reply was lost is found by
    // its token at the next version and reported WRITTEN, never as a
    // conflict that would make a charge twice for one answer.
    const token = randomUUID();
    try {
      return await this.guard('writeSnapshotIf', async () => {
        // The driver's json() helper, as everywhere else here: a stringified value cast to jsonb is stored double-encoded (see the note at the top).
        const payload = this.sql.json(asJson(record.payload));
        const rows =
          expectedVersion === null
            ? await this.sql<{ version: string }[]>`
                insert into snapshots (key, observed_at, payload, version, write_token)
                values (${record.key}, ${record.observedAt}, ${payload}, 0, ${token})
                on conflict (key) do nothing
                returning version
              `
            : await this.sql<{ version: string }[]>`
                update snapshots
                set observed_at = ${record.observedAt}, payload = ${payload}, version = version + 1, write_token = ${token}
                where key = ${record.key} and version = ${expectedVersion}
                returning version
              `;
        if (rows.length === 0) {
          // Zero rows is a conflict — unless the row carries this call's token: then the first send landed and only its reply was lost.
          const [current] = await this.sql<{ write_token: string | null }[]>`
            select write_token from snapshots where key = ${record.key}
          `;
          if (current?.write_token === token) return { state: 'WRITTEN' };
          return { state: 'CONFLICT', reason: expectedVersion === null ? `a row already exists at ${record.key}` : `the row at ${record.key} is no longer at version ${expectedVersion}` };
        }
        return { state: 'WRITTEN' };
      });
    } catch (cause) {
      // A timeout or a second fault: the statement may have landed all the
      // same. One read on a fresh client settles it — the row carries this
      // call's token, or it does not. Only when that read fails too is the
      // outcome unknown, and it is reported as such, not as "not written".
      try {
        const landed = await this.guard('writeSnapshotIf · settle', async () => {
          const [current] = await this.sql<{ write_token: string | null }[]>`
            select write_token from snapshots where key = ${record.key}
          `;
          return current?.write_token === token;
        });
        if (landed) return { state: 'WRITTEN' };
        return { state: 'FAILED', reason: `${failureReason(cause)} (the row does not carry this write)` };
      } catch (again) {
        return { state: 'FAILED', reason: `${failureReason(cause)}; whether the write landed could not be read either (${failureReason(again)})` };
      }
    }
  }

  async snapshots(prefix: string): Promise<Reading<readonly SnapshotRecord[]>> {
    try {
      return await this.guard('snapshots', async () => {
        const rows = await this.sql<SnapshotRow[]>`
          select key, observed_at, payload, version
          from snapshots
          where starts_with(key, ${prefix})
          order by key
        `;
        return readNow(rows.map(toSnapshot), `${SOURCE} · snapshots`);
      });
    } catch (cause) {
      return unreadable('snapshots', cause);
    }
  }

  async recentBlocks(limit: number): Promise<Reading<readonly BlockRecord[]>> {
    try {
      return await this.guard('recentBlocks', async () => {
        const rows = await this.sql<BlockRow[]>`
          select id, agent_id, blocked_at, headline, body, breaches
          from blocks
          order by blocked_at desc
          limit ${limit}
        `;
        return readNow(rows.map(toBlock), `${SOURCE} · blocks`);
      });
    } catch (cause) {
      return unreadable('blocks', cause);
    }
  }
}
