import { AGENT_COUNTS, absenceLabel, AGENT_BY_ID } from '@/lib/agents/registry';
import { systemHealth } from '@/lib/agents/health';
import { PRODUCERS } from '@/lib/agents/producers';
import { RULE_COUNT } from '@/lib/doctrine/policy';
import { getStore } from '@/lib/store/fs';

/**
 * THE WARDEN, as an endpoint. Every figure here is read back from the heartbeat
 * log — nothing is asserted from the registry except what the registry declares.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const store = getStore();
  const [heartbeatsRead, blocksRead] = await Promise.all([
    store.latestHeartbeats(),
    store.recentBlocks(10),
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
