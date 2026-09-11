import type { AgentId } from '../agents/registry.ts';
import type { DeclaredFigure, PolicyBreach } from '../doctrine/policy.ts';

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
 * from an exchange, and never described as such. A figure computed from them is
 * honest about how many samples it had and when the first one was taken.
 */
export interface ObservationRecord {
  readonly key: string;
  readonly observedAt: string;
  readonly value: number;
  readonly source: string;
}

export interface Store {
  writeHeartbeat(record: HeartbeatRecord): Promise<void>;
  /** The most recent heartbeat per agent. Agents that never ran are absent. */
  latestHeartbeats(): Promise<readonly HeartbeatRecord[]>;
  latestHeartbeat(agentId: AgentId): Promise<HeartbeatRecord | null>;

  writePublication(record: PublicationRecord): Promise<void>;
  recentPublications(limit: number): Promise<readonly PublicationRecord[]>;

  writeObservations(records: readonly ObservationRecord[]): Promise<void>;
  /** Oldest first, so the series is ready to compute over. */
  observations(key: string, limit: number): Promise<readonly ObservationRecord[]>;

  writeBlock(record: BlockRecord): Promise<void>;
  recentBlocks(limit: number): Promise<readonly BlockRecord[]>;
}
