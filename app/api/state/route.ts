import { AGENT_COUNTS, absenceLabel, AGENT_BY_ID } from '@/lib/agents/registry';
import { systemHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { RULE_COUNT } from '@/lib/doctrine/policy';
import { getStoreAsync } from '@/lib/store';
import { deriveConditions } from '@/lib/ops/alerts';

/**
 * THE WARDEN, as an endpoint. Every figure here is read back from the heartbeat
 * log — nothing is asserted from the registry except what the registry declares.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const store = await getStoreAsync();
  const [heartbeatsRead, blocksRead, feedSnapshots, registrar, headSnapshots] = await Promise.all([
    store.latestHeartbeats(),
    store.recentBlocks(10),
    store.snapshots('feed:'),
    store.publicationsByAgent('registrar', 1),
    store.snapshots('chain:head'),
  ]);

  // A store that will not answer is its own response. Serving an empty roster
  // would say "no agent has ever run", which is a different claim entirely and
  // one this endpoint has no evidence for.
  if (heartbeatsRead.state === 'UNREAD') {
    return Response.json(
      {
        observedAt: now.toISOString(),
        state: 'STORE_UNREADABLE',
        reason: heartbeatsRead.reason,
        detail: heartbeatsRead.detail ?? null,
        source: heartbeatsRead.source,
        note: 'No agent state is reported. This is not a statement that nothing has run.',
        policyRules: RULE_COUNT,
        counts: AGENT_COUNTS,
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const health = systemHealth(heartbeatsRead.value, now);
  const blocks = blocksRead.state === 'UNREAD' ? null : blocksRead.value;
  const conditions = deriveConditions({
    heartbeats: heartbeatsRead.value,
    feedSnapshots: feedSnapshots.state === 'UNREAD' ? null : feedSnapshots.value,
    feedSnapshotsFault: feedSnapshots.state === 'UNREAD' ? `${feedSnapshots.reason}${feedSnapshots.detail ? ` — ${feedSnapshots.detail}` : ''}` : null,
    lastRegistrar: registrar.state === 'UNREAD' ? null : (registrar.value[0] ?? null),
    headSnapshot: headSnapshots.state === 'UNREAD' ? null : (headSnapshots.value.find((s) => s.key === 'chain:head') ?? null),
    now,
  });
  const head = headSnapshots.state === 'UNREAD' ? null : (headSnapshots.value.find((s) => s.key === 'chain:head') ?? null);

  return Response.json(
    {
      observedAt: health.observedAt,
      state: 'READ',
      /** The Warden's three unfakeable numbers, printed even when they look bad. */
      warden: {
        sourcesReached: health.sourcesReached,
        sourcesExpected: health.sourcesExpected,
        oldestInputAt: health.oldestInputAt,
        reportingLastHour: health.reportingLastHour,
      },
      policyRules: RULE_COUNT,
      counts: AGENT_COUNTS,
      /**
       * What a person should know right now, as the alerting derives it from
       * the same record. Empty is a real empty: every condition was checked.
       */
      conditions,
      /** The chain head as the Pillar last read it: the one liveness signal this chain offers. Null means never sampled. */
      chainHead: head === null ? null : { ...head.payload, sampledAt: head.observedAt },
      alerting: process.env.CURB_ALERT_WEBHOOK ? 'CONFIGURED' : 'NOT_CONFIGURED',
      agents: health.statuses.map((status) => ({
        ...status,
        /** Wired means a producer exists. Described in the registry is not running. */
        wired: PRODUCERS[status.id] !== undefined,
        cadence: absenceLabel(AGENT_BY_ID[status.id]),
        refusal: AGENT_BY_ID[status.id].refusal,
      })),
      /**
       * Blocked outputs are events to look at, not silences. Null means the
       * block log itself could not be read — which is not an empty log.
       */
      recentBlocks:
        blocks === null
          ? null
          : blocks.map((b) => ({
              id: b.id,
              agentId: b.agentId,
              blockedAt: b.blockedAt,
              headline: b.headline,
              breaches: b.breaches,
            })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
