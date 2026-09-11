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
  | { readonly state: 'ACQUIRED'; readonly holder: string }
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

  writeBlock(record: BlockRecord): Promise<WriteOutcome>;
  recentBlocks(limit: number): Promise<Reading<readonly BlockRecord[]>>;
}
