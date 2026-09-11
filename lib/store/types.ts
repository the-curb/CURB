import type { AgentId } from '../agents/registry.ts';
import type { DeclaredFigure, PolicyBreach } from '../doctrine/policy.ts';
import type { Reading } from '../doctrine/reading.ts';

/**
 * How a run ended. Every one of these is written to the heartbeat, including the
 * ones that look like nothing happened — an agent that fails quietly must not
 * look identical to one that had nothing to say.
 */
export type RunOutcome =
  | 'PUBLISHED'
  | 'NOTHING_TO_SAY'
  | 'COVERAGE_BELOW_MINIMUM'
  | 'PROVENANCE_INCOMPLETE'
  | 'POLICY_BLOCKED'
  | 'PRODUCER_FAILED';

export interface HeartbeatRecord {
  readonly agentId: AgentId;
  /** When the run happened — not when it was read back. */
  readonly runAt: string;
  readonly outcome: RunOutcome;
  readonly sourcesReached: number;
  readonly sourcesExpected: number;
  /** The age of the oldest input that fed this run. Null when nothing was read. */
  readonly oldestInputAt: string | null;
  readonly publicationId: string | null;
  /** Why, in one line, for the outcomes that need one. */
  readonly detail: string | null;
}

export interface PublicationRecord {
  readonly id: string;
  readonly agentId: AgentId;
  readonly publishedAt: string;
  readonly headline: string;
  readonly body: string;
  readonly figures: readonly DeclaredFigure[];
  readonly sourcesReached: number;
}

/**
 * A blocked output is an event to look at, not a silence. It is kept in full —
 * text and breaches — so the block can be reviewed rather than guessed at.
 */
export interface BlockRecord {
  readonly id: string;
  readonly agentId: AgentId;
  readonly blockedAt: string;
  readonly headline: string;
  readonly body: string;
  readonly breaches: readonly PolicyBreach[];
}

/**
 * One sampled price, kept so a series can accumulate.
 *
 * These are our own observations at our own sampling rate — not daily closes
 * from an exchange, and never described as such.
 *
 * `value` is a convenience for arithmetic, and it is LOSSY. A token with
 * eighteen decimals needs more significant digits than a double carries: round
 * tripping one WETH supply through this field loses millions of wei. `raw` and
 * `decimals` are the record of record, so a durable store can persist the
 * integer the chain actually gave and scale it on read. A precision loss at
 * write time cannot be undone afterwards.
 */
export interface ObservationRecord {
  readonly key: string;
  readonly observedAt: string;
  readonly value: number;
  /** The integer exactly as the chain gave it, when it came from one. */
  readonly raw?: string;
  readonly decimals?: number;
  readonly source: string;
}

/**
 * The latest state of one thing, keyed, replaced on every write.
 *
 * Observations are a series: every sample is kept so structure can be measured
 * over them. A snapshot is the opposite shape — one row per key, overwritten —
 * for what a page needs to show right now without reading a series back: the
 * last price and update time of each feed, the last multiplier of each token.
 * The payload is whatever the writer measured; the key's prefix says which
 * writer, and the reader that knows the prefix knows the shape.
 */
export interface SnapshotRecord {
  readonly key: string;
  readonly observedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The result of a write.
 *
 * Writes report rather than throw, for the same reason reads return a Reading:
 * a heartbeat that failed to save is a fact about the system, and an exception
 * thrown up through a scheduler is a fact nobody records.
 */
export type WriteOutcome =
  | { readonly state: 'WRITTEN' }
  | { readonly state: 'FAILED'; readonly reason: string };

/**
 * The result of publishing.
 *
 * `atomic` is the store telling the truth about itself. A publication and its
 * heartbeat describe one event: a publication with no heartbeat went out without
 * being recorded as having run, and a heartbeat pointing at a publication that
 * was never written describes something that does not exist.
 *
 * A store that cannot offer a transaction reports `atomic: false` rather than
 * implying a guarantee it does not provide. On failure, `partial` says whether
 * one of the two landed anyway — which is the state an operator has to repair.
 */
export type PublishOutcome =
  | { readonly state: 'WRITTEN'; readonly atomic: boolean }
  | { readonly state: 'FAILED'; readonly reason: string; readonly partial: boolean };

/**
 * Reads return a Reading, so a store that cannot answer comes back UNREAD
 * rather than empty.
 *
 * This is the whole reason the interface changed. An outage that returns `[]`
 * reads exactly like a system where no agent has ever run, and nothing
 * downstream can tell the two apart — the specific confusion this project
 * exists to remove, sitting in its own interface.
 */
/**
 * The outcome of trying to take the run lock.
 *
 * Three states, because the third one matters: we hold it, somebody else holds
 * it, or we could not find out. A lock we could not check is not a lock we hold,
 * and it is not a lock that is free either.
 */
export type LockOutcome =
  | {
      readonly state: 'ACQUIRED';
      readonly holder: string;
      /**
       * Set when a renewal failed during the run. The run completed, but it may
       * have done so after losing the lock — which means it may have overlapped
       * another tick. Reported rather than swallowed, because "we held it the
       * whole time" is a claim this field exists to keep honest.
       */
      readonly renewalFault?: string;
    }
  | { readonly state: 'HELD_ELSEWHERE'; readonly holder: string | null; readonly expiresAt: string | null }
  | { readonly state: 'UNDETERMINED'; readonly reason: string };

export interface Store {
  /**
   * Try to take the run lock.
   *
   * The scheduler fires from outside this system and does not wait for the
   * previous run to finish. Without a lock, a tick that overruns its interval
   * meets the next one: both read the same last-run time, both decide the same
   * agents are due, and both publish. The duplicate is not a crash — it is a
   * second reading of the same moment, which is worse, because it looks real.
   *
   * The lock carries a TTL so a process that dies holding it does not stop the
   * system forever.
   */
  acquireRunLock(holder: string, ttlSeconds: number): Promise<LockOutcome>;
  /**
   * Extend a lock this holder still holds. Refused if it does not hold it —
   * a refresh must never resurrect a lock that expired and was taken by
   * someone else, which is what a blind update would do.
   *
   * With refresh, the TTL can be short: a run renews it while it works, so a
   * process that dies holding the lock blocks the system for one TTL, not for
   * the worst-case length of a run.
   */
  refreshRunLock(holder: string, ttlSeconds: number): Promise<WriteOutcome>;
  releaseRunLock(holder: string): Promise<WriteOutcome>;

  writeHeartbeat(record: HeartbeatRecord): Promise<WriteOutcome>;
  /** The most recent heartbeat per agent. Agents that never ran are absent. */
  latestHeartbeats(): Promise<Reading<readonly HeartbeatRecord[]>>;
  latestHeartbeat(agentId: AgentId): Promise<Reading<HeartbeatRecord | null>>;

  /**
   * Write a publication and its heartbeat together. The only supported way to
   * publish: the two records must not be able to disagree about whether the
   * run happened.
   */
  publishAtomically(
    publication: PublicationRecord,
    heartbeat: HeartbeatRecord,
  ): Promise<PublishOutcome>;

  recentPublications(limit: number): Promise<Reading<readonly PublicationRecord[]>>;

  writeObservations(records: readonly ObservationRecord[]): Promise<WriteOutcome>;
  /** Oldest first, so the series is ready to compute over. */
  observations(key: string, limit: number): Promise<Reading<readonly ObservationRecord[]>>;

  /**
   * Remove observations taken before the cutoff, and report how many went.
   *
   * The count is returned as a Reading rather than a number because a prune we
   * could not confirm is not a prune of zero. An operator who is told "0 removed"
   * when the delete never ran will not go looking, which is how a table grows
   * quietly until it is the problem.
   */
  pruneObservations(before: Date): Promise<Reading<number>>;

  /** Replace the snapshot for each key. One row per key, ever. */
  writeSnapshots(records: readonly SnapshotRecord[]): Promise<WriteOutcome>;
  /** Every snapshot whose key starts with the prefix, in key order. */
  snapshots(prefix: string): Promise<Reading<readonly SnapshotRecord[]>>;

  writeBlock(record: BlockRecord): Promise<WriteOutcome>;
  recentBlocks(limit: number): Promise<Reading<readonly BlockRecord[]>>;

  /**
   * Everything recorded on one UTC calendar day. The Gazette is composed from
   * exactly this and nothing else, so an edition is a derivation of the record
   * rather than a second record that could disagree with it.
   */
  dayRecord(day: string): Promise<Reading<DayRecord>>;
  /** Days with at least one publication, newest first — the paper's archive. */
  publicationDays(limit: number): Promise<Reading<readonly string[]>>;

  /** One agent's filings, newest first. */
  publicationsByAgent(agentId: AgentId, limit: number): Promise<Reading<readonly PublicationRecord[]>>;
  /** One agent's runs, newest first — every outcome, not only the published ones. */
  heartbeatsByAgent(agentId: AgentId, limit: number): Promise<Reading<readonly HeartbeatRecord[]>>;

  /** The narrated lede for a closed day, if one was ever attempted. */
  narration(day: string): Promise<Reading<NarrationRecord | null>>;
  /** Replaces any earlier narration for the day: one row per day, ever. */
  writeNarration(record: NarrationRecord): Promise<WriteOutcome>;
}

/**
 * How a narration attempt ended. Every attempt is recorded, including the ones
 * that produced no prose — a lede the model refused to write is a fact about the
 * day, and substituting the templated one silently would hide it.
 */
export type NarrationOutcome =
  | 'NARRATED'
  | 'POLICY_BLOCKED'
  | 'REFUSED'
  | 'MODEL_FAILED'
  | 'NOT_CONFIGURED';

export interface NarrationRecord {
  readonly day: string;
  /** Pins the composition the prose was written for. */
  readonly editionHash: string;
  readonly outcome: NarrationOutcome;
  /** Present only when outcome is NARRATED. */
  readonly standfirst: string | null;
  readonly model: string | null;
  readonly detail: string | null;
  readonly generatedAt: string;
}

/** One UTC day of the record, as the Gazette reads it. */
export interface DayRecord {
  /** YYYY-MM-DD, UTC. */
  readonly day: string;
  readonly publications: readonly PublicationRecord[];
  /** Every heartbeat that day, not just the latest — the ledger needs the failures. */
  readonly heartbeats: readonly HeartbeatRecord[];
  readonly blocks: readonly BlockRecord[];
}
