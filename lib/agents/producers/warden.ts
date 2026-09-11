/**
 * THE WARDEN — system health, published even when it looks bad.
 *
 * Three numbers it cannot fake, because it does not produce them: how many
 * sources the agents actually reached, how old the oldest input still in use is,
 * and how many agents reported in the last hour. All three are read back from
 * the heartbeat store, which every run writes to whatever its outcome.
 *
 * Two honest limits, stated in every report rather than assumed away:
 *
 *   1. It reports the state BEFORE its own run. Its heartbeat for this run is
 *      written after the gates, so it cannot include itself without lying about
 *      the order things happened in.
 *   2. A heartbeat records that a run happened and what it reached. It is not
 *      evidence that what was published was correct. Nothing here audits content.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import { describeAge } from '../../doctrine/reading.ts';
import { systemHealth, type AgentHealth } from '../health.ts';

const STORE_SOURCE = 'the heartbeat store — every agent, every run, including the failed ones';

/** Ordered worst-first, so a report opens with what is wrong. */
const REPORT_ORDER: readonly AgentHealth[] = [
  'ABSENT',
  'DEGRADED',
  'STALE',
  'NOT_OBSERVED',
  'ON_REQUEST',
  'LIVE',
];

const MEANINGS: Record<AgentHealth, string> = {
  ABSENT: 'expected, and never arrived',
  DEGRADED: 'ran, and produced nothing publishable',
  STALE: 'ran, but past its freshness threshold',
  NOT_OBSERVED: 'never observed — which is not the same as absent',
  ON_REQUEST: 'no interval, so never a fault for staying quiet',
  LIVE: 'ran within its interval',
};

export const wardenProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const heartbeats = await store.latestHeartbeats();
  const blocks = await store.recentBlocks(50);
  const health = systemHealth(heartbeats, now);

  if (heartbeats.length === 0) {
    // Nothing has ever run. That is a real state and it gets said plainly,
    // rather than reported as a system in perfect health with zero faults.
    return {
      publication: null,
      sourcesReached: 1,
      oldestInputAt: null,
      note: 'the heartbeat store is empty: no agent has run yet, so there is no health to report',
    };
  }

  const figures: DeclaredFigure[] = [];
  const declare = (token: string) =>
    figures.push({ token, source: STORE_SOURCE, retrievedAt: now.toISOString() });

  const reached = String(health.sourcesReached);
  const expected = String(health.sourcesExpected);
  const reporting = String(health.reportingLastHour);
  const total = String(health.agentsTotal);
  [reached, expected, reporting, total].forEach(declare);

  const numbers = [
    `— Sources reached: ${reached} of the ${expected} a healthy run of every scheduled agent would reach.`,
    `— Agents reporting in the last hour: ${reporting} of ${total}.`,
  ];

  if (health.oldestInputAt === null) {
    numbers.push(
      '— Oldest input: no agent recorded one, so it is reported as absent rather than as an age of zero.',
    );
  } else {
    const age = describeAge(
      Math.max(0, Math.round((now.getTime() - new Date(health.oldestInputAt).getTime()) / 1000)),
    );
    declare(age.replace(/[^\d.]/g, ''));
    numbers.push(`— Oldest input still behind a published figure: ${age} old.`);
  }

  const blockCount = String(blocks.length);
  declare(blockCount);
  numbers.push(
    blocks.length === 0
      ? `— Outputs blocked by policy and kept for review: ${blockCount}.`
      : `— Outputs blocked by policy and kept for review: ${blockCount}. Each one is stored in full, with the rule it broke, because a blocked output is an event to look at rather than a silence.`,
  );

  // The roster, worst state first.
  const roster: string[] = [];
  for (const state of REPORT_ORDER) {
    const inState = health.statuses.filter((s) => s.health === state);
    if (inState.length === 0) continue;
    const names = inState.map((s) => s.name).join(', ');
    const count = String(inState.length);
    declare(count);
    roster.push(`— ${state.replace(/_/g, ' ')} (${count}) — ${MEANINGS[state]}: ${names}.`);
  }

  const faults = health.statuses.filter(
    (s) => s.health === 'ABSENT' || s.health === 'DEGRADED' || s.health === 'STALE',
  );
  const verdict =
    faults.length === 0
      ? '— Nothing is absent, degraded or stale at this reading. That describes the last run of each agent, not the correctness of anything it said.'
      : `— ${faults.length === 1 ? 'One agent is' : `${faults.length} agents are`} not in a healthy state, and ${faults.length === 1 ? 'it is' : 'they are'} named above rather than averaged into a percentage.`;
  if (faults.length > 0) declare(String(faults.length));

  const body = [
    'THE NUMBERS',
    ...numbers,
    '',
    'THE ROSTER',
    ...roster,
    verdict,
    '',
    'WHAT THIS REPORT DOES NOT ESTABLISH',
    '— A heartbeat records that a run happened and what it reached. It is not evidence that what was published was correct: nothing here audits content.',
    '— This describes the state before this run. The heartbeat for this report is written after the gates, so the report cannot include itself without misstating the order things happened in.',
    '— An agent that has never been observed may have no producer wired at all. Never observed and never arrived are different facts, and this report does not merge them.',
  ].join('\n');

  return {
    publication: {
      headline: `OPERATIONS · ${reporting} of ${total} reporting · ${reached}/${expected} sources`,
      body,
      figures,
    },
    sourcesReached: 1,
    oldestInputAt: health.oldestInputAt ? new Date(health.oldestInputAt) : null,
  };
};
