import postgres from 'postgres';
import type {
  BlockRecord,
  HeartbeatRecord,
  LockOutcome,
  ObservationRecord,
  PublicationRecord,
  PublishOutcome,
  RunOutcome,
  Store,
  WriteOutcome,
} from './types.ts';
import type { AgentId } from '../agents/registry.ts';
import { readNow, unread, type Reading } from '../doctrine/reading.ts';
import type { DeclaredFigure, PolicyBreach } from '../doctrine/policy.ts';

/**
 * A Postgres-backed Store.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOT YET VERIFIED AGAINST A LIVE DATABASE.
 *
 * This was written without credentials to run it against. It typechecks and the
 * SQL is reviewable, and neither of those is evidence that it works. Before
 * trusting it, run the shared contract against a real database:
 *
 *     CURB_POSTGRES_URL=... npm run verify:store
 *
 * That runs the same assertions the filesystem store already passes. Until it
 * reports green, this file is a plan rather than a component, and it is marked
 * so here rather than discovered later.
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

/** One client for the process. Never build one per request. */
export function getSql(url: string = requireUrl()): Sql {
  client ??= postgres(url, {
    // A transaction pooler hands back a different session each time, so a
    // prepared statement cached against the last one is not there any more.
    prepare: false,
    max: Number(process.env.CURB_POSTGRES_MAX ?? 3),
    idle_timeout: 20,
    connect_timeout: 10,
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

export class PostgresStore implements Store {
  private readonly sql: Sql;

  constructor(sql: Sql = getSql()) {
    this.sql = sql;
  }

  /**
   * Takes the lock by inserting the single row, or by overwriting it when the
   * existing one has expired. The `where` clause is what makes this safe: a live
   * lock updates no rows, so nothing is returned and nothing was taken.
   */
  async acquireRunLock(holder: string, ttlSeconds: number): Promise<LockOutcome> {
    try {
      const taken = await this.sql<{ holder: string }[]>`
        insert into run_lock (id, holder, expires_at)
        values (1, ${holder}, now() + make_interval(secs => ${ttlSeconds}))
        on conflict (id) do update
          set holder = excluded.holder, expires_at = excluded.expires_at
          where run_lock.expires_at < now()
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
    } catch (cause) {
      // A lock we could not check is not a lock we hold, and not one that is free.
      return { state: 'UNDETERMINED', reason: failureReason(cause) };
    }
  }

  async releaseRunLock(holder: string): Promise<WriteOutcome> {
    try {
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
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async writeHeartbeat(record: HeartbeatRecord): Promise<WriteOutcome> {
    try {
      await this.insertHeartbeat(this.sql, record);
      return { state: 'WRITTEN' };
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
      const rows = await this.sql<HeartbeatRow[]>`
        select distinct on (agent_id)
          agent_id, run_at, outcome, sources_reached, sources_expected,
          oldest_input_at, publication_id, detail
        from heartbeats
        order by agent_id, run_at desc
      `;
      return readNow(rows.map(toHeartbeat), `${SOURCE} · heartbeats`);
    } catch (cause) {
      return unreadable('heartbeats', cause);
    }
  }

  async latestHeartbeat(agentId: AgentId): Promise<Reading<HeartbeatRecord | null>> {
    try {
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
      await this.sql.begin(async (tx) => {
        await tx`
          insert into publications
            (id, agent_id, published_at, headline, body, figures, sources_reached)
          values
            (${publication.id}, ${publication.agentId}, ${publication.publishedAt},
             ${publication.headline}, ${publication.body},
             ${JSON.stringify(publication.figures)}::jsonb,
             ${publication.sourcesReached})
        `;
        await this.insertHeartbeat(tx, heartbeat);
      });
      return { state: 'WRITTEN', atomic: true };
    } catch (cause) {
      // The transaction rolled back, so neither row is there.
      return { state: 'FAILED', reason: failureReason(cause), partial: false };
    }
  }

  async recentPublications(limit: number): Promise<Reading<readonly PublicationRecord[]>> {
    try {
      const rows = await this.sql<PublicationRow[]>`
        select id, agent_id, published_at, headline, body, figures, sources_reached
        from publications
        order by published_at desc
        limit ${limit}
      `;
      return readNow(rows.map(toPublication), `${SOURCE} · publications`);
    } catch (cause) {
      return unreadable('publications', cause);
    }
  }

  async writeObservations(records: readonly ObservationRecord[]): Promise<WriteOutcome> {
    if (records.length === 0) return { state: 'WRITTEN' };
    try {
      // One transaction, one insert per record. A run produces a handful of
      // observations at most, so the bulk-insert helper buys nothing here and
      // costs a fight with its types — and losing that fight quietly is how a
      // series ends up with rows that do not mean what they say.
      await this.sql.begin(async (tx) => {
        for (const r of records) {
          await tx`
            insert into observations (key, observed_at, value, raw, decimals, source)
            values (${r.key}, ${r.observedAt}, ${String(r.value)}::numeric,
                    ${r.raw ?? null}, ${r.decimals ?? null}, ${r.source})
          `;
        }
      });
      return { state: 'WRITTEN' };
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async observations(key: string, limit: number): Promise<Reading<readonly ObservationRecord[]>> {
    try {
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
    } catch (cause) {
      return unreadable('observations', cause);
    }
  }

  async writeBlock(record: BlockRecord): Promise<WriteOutcome> {
    try {
      await this.sql`
        insert into blocks (id, agent_id, blocked_at, headline, body, breaches)
        values (${record.id}, ${record.agentId}, ${record.blockedAt}, ${record.headline},
                ${record.body}, ${JSON.stringify(record.breaches)}::jsonb)
      `;
      return { state: 'WRITTEN' };
    } catch (cause) {
      return { state: 'FAILED', reason: failureReason(cause) };
    }
  }

  async recentBlocks(limit: number): Promise<Reading<readonly BlockRecord[]>> {
    try {
      const rows = await this.sql<BlockRow[]>`
        select id, agent_id, blocked_at, headline, body, breaches
        from blocks
        order by blocked_at desc
        limit ${limit}
      `;
      return readNow(rows.map(toBlock), `${SOURCE} · blocks`);
    } catch (cause) {
      return unreadable('blocks', cause);
    }
  }
}
