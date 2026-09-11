import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { statusOf, systemHealth } from '../lib/agents/health.ts';
import { AGENT_BY_ID, AGENTS } from '../lib/agents/registry.ts';
import type { HeartbeatRecord } from '../lib/store/types.ts';

/**
 * The Warden's three numbers are read back from heartbeats, and the first of
 * them is a ratio. Both halves of a ratio must count the same agents.
 */

const NOW = new Date('2026-09-11T15:00:00.000Z');

function beat(agentId: HeartbeatRecord['agentId'], minutesAgo: number, reached: number, expected: number, outcome: HeartbeatRecord['outcome'] = 'PUBLISHED'): HeartbeatRecord {
  return {
    agentId,
    runAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    outcome,
    sourcesReached: reached,
    sourcesExpected: expected,
    oldestInputAt: null,
    publicationId: outcome === 'PUBLISHED' ? 'p' : null,
    detail: null,
  };
}

describe('systemHealth', () => {
  it('counts reached and expected over the same agents, leaving the on-request one out of both', () => {
    const scheduled = AGENTS.filter((a) => a.intervalSeconds !== null);
    const full = scheduled.map((a) => beat(a.id, 1, a.sourcesExpected, a.sourcesExpected));
    const surveyor = beat('surveyor', 1, 2, 2);
    const withoutSurveyor = systemHealth(full, NOW);
    const withSurveyor = systemHealth([...full, surveyor], NOW);
    assert.equal(withoutSurveyor.sourcesReached, withoutSurveyor.sourcesExpected);
    assert.equal(withSurveyor.sourcesReached, withoutSurveyor.sourcesReached, 'an on-request run must not raise the numerator');
    assert.equal(withSurveyor.sourcesExpected, withoutSurveyor.sourcesExpected);
    // It still counts as an agent reporting: it did run.
    assert.equal(withSurveyor.reportingLastHour, withoutSurveyor.reportingLastHour + 1);
  });

  it('never has reached exceed expected when every agent reached what it declared', () => {
    const full = AGENTS.map((a) => beat(a.id, 1, a.sourcesExpected, a.sourcesExpected));
    const h = systemHealth(full, NOW);
    assert.ok(h.sourcesReached <= h.sourcesExpected, `${h.sourcesReached} > ${h.sourcesExpected}`);
  });

  it('keeps the on-request agent out of the fault lights whatever it did', () => {
    assert.equal(statusOf(AGENT_BY_ID.surveyor, null, NOW).health, 'ON_REQUEST');
    assert.equal(statusOf(AGENT_BY_ID.surveyor, beat('surveyor', 60 * 24 * 30, 0, 2, 'COVERAGE_BELOW_MINIMUM'), NOW).health, 'ON_REQUEST');
  });
});
