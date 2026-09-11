/**
 * THE WARDEN's arithmetic, in one place so the dashboard and the API cannot
 * disagree about what a light means.
 *
 * The six states matter. A reading we could not take goes into fog, never into
 * darkness — "dark" already means expected and never arrived, and collapsing the
 * two is how a broken scheduler comes to look like a quiet afternoon.
 */

import { AGENTS, type AgentId, type AgentSpec } from './registry.ts';
import { absenceSeconds, freshnessSeconds } from '../doctrine/reading.ts';
import type { HeartbeatRecord, RunOutcome } from '../store/types.ts';

export type AgentHealth =
  /** Ran within its declared interval plus grace. */
  | 'LIVE'
  /** Ran, but the last run is past the freshness threshold. */
  | 'STALE'
  /** Past twice the interval plus grace: expected, and never arrived. */
  | 'ABSENT'
  /** Ran, but produced nothing publishable — the reason is on the heartbeat. */
  | 'DEGRADED'
  /** No interval. Answered on request, never a fault for staying quiet. */
  | 'ON_REQUEST'
  /** Never observed at all. Not the same as absent. */
  | 'NOT_OBSERVED';

/** Outcomes that mean the run happened but the output did not. */
const DEGRADED_OUTCOMES: ReadonlySet<RunOutcome> = new Set<RunOutcome>([
  'COVERAGE_BELOW_MINIMUM',
  'PROVENANCE_INCOMPLETE',
  'POLICY_BLOCKED',
  'PRODUCER_FAILED',
]);

export interface AgentStatus {
  readonly id: AgentId;
  readonly name: string;
  readonly district: string;
  readonly posture: AgentSpec['posture'];
  readonly health: AgentHealth;
  readonly lastRunAt: string | null;
  readonly lastOutcome: RunOutcome | null;
  readonly dataAgeSeconds: number | null;
  readonly sourcesReached: number | null;
  readonly sourcesExpected: number;
  readonly intervalSeconds: number | null;
  readonly freshnessSeconds: number | null;
  readonly absenceSeconds: number | null;
  readonly detail: string | null;
}

export function statusOf(
  spec: AgentSpec,
  heartbeat: HeartbeatRecord | null,
  now: Date = new Date(),
): AgentStatus {
  const base = {
    id: spec.id,
    name: spec.name,
    district: spec.district,
    posture: spec.posture,
    sourcesExpected: spec.sourcesExpected,
    intervalSeconds: spec.intervalSeconds,
    freshnessSeconds:
      spec.intervalSeconds === null ? null : freshnessSeconds(spec.intervalSeconds),
    absenceSeconds: spec.intervalSeconds === null ? null : absenceSeconds(spec.intervalSeconds),
  } as const;

  if (heartbeat === null) {
    return {
      ...base,
      health: spec.intervalSeconds === null ? 'ON_REQUEST' : 'NOT_OBSERVED',
      lastRunAt: null,
      lastOutcome: null,
      dataAgeSeconds: null,
      sourcesReached: null,
      detail: null,
    };
  }

  const ageSeconds = Math.max(
    0,
    Math.round((now.getTime() - new Date(heartbeat.runAt).getTime()) / 1000),
  );

  let health: AgentHealth;
  if (spec.intervalSeconds === null) {
    health = 'ON_REQUEST';
  } else if (ageSeconds > absenceSeconds(spec.intervalSeconds)) {
    health = 'ABSENT';
  } else if (DEGRADED_OUTCOMES.has(heartbeat.outcome)) {
    health = 'DEGRADED';
  } else if (ageSeconds > freshnessSeconds(spec.intervalSeconds)) {
    health = 'STALE';
  } else {
    health = 'LIVE';
  }

  return {
    ...base,
    health,
    lastRunAt: heartbeat.runAt,
    lastOutcome: heartbeat.outcome,
    dataAgeSeconds: ageSeconds,
    sourcesReached: heartbeat.sourcesReached,
    detail: heartbeat.detail,
  };
}

/**
 * The three numbers the Warden cannot fake, published even when they look bad.
 * `oldestInputAt` is null when nothing has been read — reported as absent, not
 * as an age of zero.
 */
export interface SystemHealth {
  readonly observedAt: string;
  readonly sourcesReached: number;
  readonly sourcesExpected: number;
  readonly oldestInputAt: string | null;
  readonly reportingLastHour: number;
  readonly agentsTotal: number;
  readonly statuses: readonly AgentStatus[];
}

export function systemHealth(
  heartbeats: readonly HeartbeatRecord[],
  now: Date = new Date(),
): SystemHealth {
  const byId = new Map(heartbeats.map((h) => [h.agentId, h]));
  const statuses = AGENTS.map((spec) => statusOf(spec, byId.get(spec.id) ?? null, now));

  const scheduled = AGENTS.filter((a) => a.intervalSeconds !== null);
  const hourAgo = now.getTime() - 3600 * 1000;

  let oldestInputAt: string | null = null;
  let sourcesReached = 0;
  for (const heartbeat of heartbeats) {
    sourcesReached += heartbeat.sourcesReached;
    if (heartbeat.oldestInputAt === null) continue;
    if (oldestInputAt === null || heartbeat.oldestInputAt < oldestInputAt) {
      oldestInputAt = heartbeat.oldestInputAt;
    }
  }

  return {
    observedAt: now.toISOString(),
    sourcesReached,
    sourcesExpected: scheduled.reduce((sum, a) => sum + a.sourcesExpected, 0),
    oldestInputAt,
    reportingLastHour: heartbeats.filter((h) => new Date(h.runAt).getTime() >= hourAgo).length,
    agentsTotal: AGENTS.length,
    statuses,
  };
}
