import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { composeEdition, isValidDay, utcDay } from '../lib/gazette/edition.ts';
import type { DayRecord, HeartbeatRecord, PublicationRecord } from '../lib/store/types.ts';
import type { AgentId } from '../lib/agents/registry.ts';

const DAY = '2026-09-11';
const NOW = new Date('2026-09-11T15:00:00.000Z');

function pub(agentId: AgentId, at: string, headline = `${agentId} said`, sources: string[] = []): PublicationRecord {
  return {
    id: `${agentId}-${at}`,
    agentId,
    publishedAt: `${DAY}T${at}:00.000Z`,
    headline,
    body: 'body',
    figures: sources.map((source, i) => ({ token: String(i), source, retrievedAt: `${DAY}T${at}:00.000Z` })),
    sourcesReached: 1,
  };
}

function beat(agentId: AgentId, at: string, outcome: HeartbeatRecord['outcome'], detail: string | null = null): HeartbeatRecord {
  return {
    agentId,
    runAt: `${DAY}T${at}:00.000Z`,
    outcome,
    sourcesReached: 1,
    sourcesExpected: 2,
    oldestInputAt: null,
    publicationId: null,
    detail,
  };
}

const empty: DayRecord = { day: DAY, publications: [], heartbeats: [], blocks: [] };

describe('an empty day', () => {
  it('is an edition with nothing in it, not an error', () => {
    const e = composeEdition(empty, NOW);
    assert.equal(e.sections.length, 0);
    assert.equal(e.headline, `The record for ${DAY}`);
    assert.match(e.standfirst, /No agent filed/);
    assert.equal(e.sources.length, 0);
  });

  it('knows whether it is still being written', () => {
    assert.equal(composeEdition(empty, NOW).isToday, true);
    assert.equal(composeEdition(empty, new Date('2026-09-12T01:00:00Z')).isToday, false);
    assert.match(composeEdition(empty, NOW).standfirst, /still being recorded/);
  });
});

describe('the front page', () => {
  it('leads with the session when the Bell filed', () => {
    const e = composeEdition(
      { ...empty, publications: [pub('tally', '10:00', 'FLOW'), pub('bell', '11:00', 'OPEN · day')] },
      NOW,
    );
    assert.equal(e.headline, 'OPEN · day');
  });

  it('falls through the lead order when the Bell was quiet', () => {
    const e = composeEdition(
      { ...empty, publications: [pub('warden', '10:00', 'OPS'), pub('tally', '11:00', 'FLOW')] },
      NOW,
    );
    assert.equal(e.headline, 'FLOW');
  });

  it('counts itself honestly in the lede', () => {
    const e = composeEdition(
      {
        ...empty,
        publications: [pub('bell', '10:00'), pub('pillar', '10:15')],
        heartbeats: [
          beat('bell', '10:00', 'PUBLISHED'),
          beat('pillar', '10:15', 'PUBLISHED'),
          beat('bell', '10:05', 'NOTHING_TO_SAY'),
          beat('tally', '10:30', 'COVERAGE_BELOW_MINIMUM', 'chain head unreachable'),
        ],
      },
      NOW,
    );
    assert.match(e.standfirst, /2 agents filed, 2 reports/);
    assert.match(e.standfirst, /1 run ended with nothing to say/);
    assert.match(e.standfirst, /1 agent could not complete a reading/);
    assert.match(e.standfirst, /Nothing was stopped by policy/);
  });
});

describe('sections', () => {
  it('are grouped by district in the city’s order', () => {
    const e = composeEdition(
      {
        ...empty,
        publications: [pub('herald', '09:00'), pub('counsel', '09:10'), pub('bell', '09:20'), pub('registrar', '09:30')],
      },
      NOW,
    );
    assert.deepEqual(
      e.sections.map((s) => s.district),
      ['THE FLOOR', 'THE REGISTRY', 'CHAMBERS', 'THE CAGE'],
    );
  });

  it('shows the latest filing per agent and counts the rest', () => {
    // A quarter-hourly agent files nearly a hundred times a day. The paper
    // prints the last one and says how many there were; the lede still counts
    // every report, and the sources still cite every figure.
    const e = composeEdition(
      {
        ...empty,
        publications: [
          pub('pillar', '10:00', 'FEEDS · morning', ['chainlink · ETH']),
          pub('pillar', '14:00', 'FEEDS · afternoon', ['chainlink · BTC']),
          pub('pillar', '12:00', 'FEEDS · noon', ['chainlink · ETH']),
        ],
      },
      NOW,
    );
    assert.equal(e.sections.length, 1);
    assert.equal(e.sections[0]?.headline, 'FEEDS · afternoon');
    assert.equal(e.sections[0]?.filings, 3);
    assert.match(e.standfirst, /1 agent filed, 3 reports in all/);
    assert.deepEqual(
      e.sources.map((s) => [s.source, s.figures]),
      [['chainlink · ETH', 2], ['chainlink · BTC', 1]],
    );
  });

  it('carries each author’s declared refusal', () => {
    const e = composeEdition({ ...empty, publications: [pub('surveyor', '09:00')] }, NOW);
    assert.match(e.sections[0]?.agent.refusal ?? '', /no entry, no stop, no target/i);
  });

  it('marks the promoter as promotion', () => {
    const e = composeEdition({ ...empty, publications: [pub('herald', '09:00')] }, NOW);
    assert.equal(e.sections[0]?.agent.posture, 'PROMOTES');
  });
});

describe('what was not read', () => {
  it('names the agents that could not complete, latest run each', () => {
    const e = composeEdition(
      {
        ...empty,
        heartbeats: [
          beat('tally', '08:00', 'COVERAGE_BELOW_MINIMUM', 'early'),
          beat('tally', '14:00', 'COVERAGE_BELOW_MINIMUM', 'later'),
          beat('pillar', '09:00', 'PRODUCER_FAILED', 'boom'),
          beat('bell', '10:00', 'PUBLISHED'),
          beat('warden', '10:00', 'NOTHING_TO_SAY'),
        ],
      },
      NOW,
    );
    assert.deepEqual(
      e.notRead.map((n) => [n.agent.id, n.detail]),
      [['pillar', 'boom'], ['tally', 'later']],
    );
  });

  it('is empty, and stays a section, on a clean day', () => {
    const e = composeEdition({ ...empty, heartbeats: [beat('bell', '10:00', 'PUBLISHED')] }, NOW);
    assert.equal(e.notRead.length, 0);
  });
});

describe('sources of record', () => {
  it('deduplicates and counts, most-cited first', () => {
    const e = composeEdition(
      {
        ...empty,
        publications: [
          pub('pillar', '10:00', 'x', ['chainlink · ETH', 'chainlink · ETH', 'session calendar']),
          pub('bell', '11:00', 'y', ['session calendar']),
        ],
      },
      NOW,
    );
    assert.deepEqual(
      e.sources.map((s) => [s.source, s.figures]),
      [['chainlink · ETH', 2], ['session calendar', 2]],
    );
  });
});

describe('the ledger', () => {
  it('counts every run, including the ones that produced nothing', () => {
    const e = composeEdition(
      {
        ...empty,
        heartbeats: [
          beat('bell', '10:00', 'PUBLISHED'),
          beat('bell', '10:05', 'NOTHING_TO_SAY'),
          beat('bell', '10:10', 'NOTHING_TO_SAY'),
          beat('tally', '10:00', 'POLICY_BLOCKED'),
        ],
        blocks: [
          { id: 'b1', agentId: 'tally', blockedAt: `${DAY}T10:00:00.000Z`, headline: 'h', body: 'b', breaches: [] },
        ],
      },
      NOW,
    );
    assert.equal(e.ledger.PUBLISHED, 1);
    assert.equal(e.ledger.NOTHING_TO_SAY, 2);
    assert.equal(e.ledger.POLICY_BLOCKED, 1);
    assert.equal(e.ledger.PRODUCER_FAILED, 0);
    assert.equal(e.blockedOutputs, 1);
    assert.match(e.standfirst, /1 output was stopped by policy/);
  });
});

describe('days', () => {
  it('validates the calendar shape', () => {
    assert.equal(isValidDay('2026-09-11'), true);
    assert.equal(isValidDay('2026-13-40'), false);
    assert.equal(isValidDay('yesterday'), false);
    // A day the calendar does not have: JavaScript rolls these forward rather
    // than refusing them, and an edition was composed for both in production.
    assert.equal(isValidDay('2026-09-31'), false);
    assert.equal(isValidDay('2026-02-30'), false);
    assert.equal(isValidDay('2025-02-29'), false);
    assert.equal(isValidDay('2024-02-29'), true, 'a leap day is a day');
    // A future day stays valid: the page prints "has not happened yet", which
    // is a truer answer than refusing to talk about it.
    assert.equal(isValidDay('2099-01-01'), true);
  });

  it('uses the UTC calendar', () => {
    assert.equal(utcDay(new Date('2026-09-11T23:59:59Z')), '2026-09-11');
    assert.equal(utcDay(new Date('2026-09-12T00:00:00Z')), '2026-09-12');
  });
});
