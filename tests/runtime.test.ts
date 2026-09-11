import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { runAgent, type Producer } from '../lib/agents/runtime.ts';
import { AGENT_BY_ID } from '../lib/agents/registry.ts';
import { unread } from '../lib/doctrine/reading.ts';
import type {
  BlockRecord,
  HeartbeatRecord,
  ObservationRecord,
  PublicationRecord,
  Store,
} from '../lib/store/types.ts';
import type { AgentId } from '../lib/agents/registry.ts';

/** An in-memory Store, so the runtime is tested without touching a disk. */
class MemoryStore implements Store {
  heartbeats: HeartbeatRecord[] = [];
  publications: PublicationRecord[] = [];
  blocks: BlockRecord[] = [];
  observed: ObservationRecord[] = [];

  async writeHeartbeat(record: HeartbeatRecord) {
    this.heartbeats.push(record);
  }
  async latestHeartbeats() {
    return this.heartbeats;
  }
  async latestHeartbeat(agentId: AgentId) {
    return this.heartbeats.filter((h) => h.agentId === agentId).at(-1) ?? null;
  }
  async writePublication(record: PublicationRecord) {
    this.publications.push(record);
  }
  async recentPublications(limit: number) {
    return this.publications.slice(-limit).reverse();
  }
  async writeObservations(records: readonly ObservationRecord[]) {
    this.observed.push(...records);
  }
  async observations(key: string, limit: number) {
    return this.observed.filter((o) => o.key === key).slice(-limit);
  }
  async writeBlock(record: BlockRecord) {
    this.blocks.push(record);
  }
  async recentBlocks(limit: number) {
    return this.blocks.slice(-limit).reverse();
  }
}

const BELL = AGENT_BY_ID.bell; // minimumSources 1, sourcesExpected 2
const NOW = new Date('2026-09-10T23:00:00.000Z');

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

const clean: Producer = async () => ({
  publication: {
    headline: 'CLOSED',
    body: 'The exchange is shut and the chain has not paused.',
    figures: [],
  },
  sourcesReached: 2,
  oldestInputAt: NOW,
});

describe('the happy path', () => {
  it('publishes and writes exactly one heartbeat', async () => {
    const run = await runAgent(BELL, clean, { store, now: NOW });
    assert.equal(run.outcome, 'PUBLISHED');
    assert.equal(store.publications.length, 1);
    assert.equal(store.heartbeats.length, 1);
    assert.equal(store.heartbeats[0]?.outcome, 'PUBLISHED');
  });

  it('links the heartbeat to the publication it produced', async () => {
    const run = await runAgent(BELL, clean, { store, now: NOW });
    assert.equal(store.heartbeats[0]?.publicationId, store.publications[0]?.id);
    assert.equal(run.publicationId, store.publications[0]?.id);
  });
});

describe('the heartbeat is written on every real run', () => {
  it('records a producer crash instead of losing it', async () => {
    const boom: Producer = async () => {
      throw new Error('source exploded');
    };
    const run = await runAgent(BELL, boom, { store, now: NOW });
    assert.equal(run.outcome, 'PRODUCER_FAILED');
    assert.equal(store.heartbeats.length, 1);
    assert.equal(store.heartbeats[0]?.detail, 'source exploded');
    assert.equal(store.publications.length, 0);
  });

  it('distinguishes nothing-to-say from a failure', async () => {
    const quiet: Producer = async () => ({
      publication: null,
      sourcesReached: 2,
      oldestInputAt: NOW,
    });
    const run = await runAgent(BELL, quiet, { store, now: NOW });
    assert.equal(run.outcome, 'NOTHING_TO_SAY');
    assert.equal(store.heartbeats.length, 1);
    assert.equal(store.publications.length, 0);
  });

  it('declares unknown rather than publishing below minimum coverage', async () => {
    const thin: Producer = async () => ({
      publication: {
        headline: 'CLOSED',
        body: 'The exchange is shut.',
        figures: [],
      },
      sourcesReached: 0, // below bell.minimumSources
      oldestInputAt: null,
    });
    const run = await runAgent(BELL, thin, { store, now: NOW });
    assert.equal(run.outcome, 'COVERAGE_BELOW_MINIMUM');
    assert.equal(store.publications.length, 0);
    assert.match(store.heartbeats[0]?.detail ?? '', /minimum/);
  });
});

describe('the gates', () => {
  it('refuses a figure that carries no source', async () => {
    const unsourced: Producer = async () => ({
      publication: {
        headline: 'CLOSED',
        body: 'Volatility ran 47.67% this month.',
        figures: [{ token: '47.67%', source: '   ', retrievedAt: NOW.toISOString() }],
      },
      sourcesReached: 2,
      oldestInputAt: NOW,
    });
    const run = await runAgent(BELL, unsourced, { store, now: NOW });
    assert.equal(run.outcome, 'PROVENANCE_INCOMPLETE');
    assert.equal(store.publications.length, 0);
  });

  it('blocks a policy breach and keeps the blocked text as an event', async () => {
    const advice: Producer = async () => ({
      publication: {
        headline: 'CLOSED',
        body: 'The exchange is shut. You should buy before the open.',
        figures: [],
      },
      sourcesReached: 2,
      oldestInputAt: NOW,
    });
    const run = await runAgent(BELL, advice, { store, now: NOW });

    assert.equal(run.outcome, 'POLICY_BLOCKED');
    assert.equal(store.publications.length, 0);
    // A blocked output is an event to look at, not a silence.
    assert.equal(store.blocks.length, 1);
    assert.equal(store.heartbeats.length, 1);
    assert.ok(run.breaches.some((b) => b.rule === 'ADVICE_SHAPE'));
  });

  it('blocks an absence that was printed as a number', async () => {
    const dressed: Producer = async () => ({
      publication: {
        headline: 'CLOSED',
        body: 'block height stood at 59,786,108.',
        figures: [
          { token: '59,786,108', source: 'rpc', retrievedAt: NOW.toISOString() },
        ],
        readings: { 'block height': unread('SOURCE_UNREACHABLE') },
      },
      sourcesReached: 2,
      oldestInputAt: NOW,
    });
    const run = await runAgent(BELL, dressed, { store, now: NOW });
    assert.equal(run.outcome, 'POLICY_BLOCKED');
    assert.ok(run.breaches.some((b) => b.rule === 'ABSENT_RENDERED_AS_VALUE'));
  });
});

describe('measurements outlive the prose', () => {
  const measured = (publicationBody: string): Producer => async () => ({
    publication: { headline: 'X', body: publicationBody, figures: [] },
    sourcesReached: 2,
    oldestInputAt: NOW,
    observations: [
      { key: 'eth-usd', observedAt: NOW.toISOString(), value: 2450.18, source: 'test feed' },
    ],
  });

  it('records an observation on a clean run', async () => {
    await runAgent(BELL, measured('The exchange is shut.'), { store, now: NOW });
    assert.equal(store.observed.length, 1);
    assert.equal(store.observed[0]?.value, 2450.18);
  });

  it('still records it when policy blocks the sentence', async () => {
    // The measurement happened. Policy governs what is published, not what was
    // measured — a blocked sentence must not punch a hole in the series.
    const run = await runAgent(BELL, measured('You should buy before the open.'), {
      store,
      now: NOW,
    });
    assert.equal(run.outcome, 'POLICY_BLOCKED');
    assert.equal(store.publications.length, 0);
    assert.equal(store.observed.length, 1);
  });

  it('records nothing at all on a rehearsal', async () => {
    await runAgent(BELL, measured('The exchange is shut.'), { store, now: NOW, dryRun: true });
    assert.equal(store.observed.length, 0);
  });
});

describe('a dry run moves nothing', () => {
  it('writes no heartbeat, no publication and no block', async () => {
    const run = await runAgent(BELL, clean, { store, now: NOW, dryRun: true });
    assert.equal(run.outcome, 'PUBLISHED');
    assert.equal(run.persisted, false);
    assert.equal(store.heartbeats.length, 0);
    assert.equal(store.publications.length, 0);
    assert.equal(store.blocks.length, 0);
  });

  it('does not persist a blocked rehearsal either', async () => {
    const advice: Producer = async () => ({
      publication: { headline: 'X', body: 'You should sell now.', figures: [] },
      sourcesReached: 2,
      oldestInputAt: NOW,
    });
    await runAgent(BELL, advice, { store, now: NOW, dryRun: true });
    assert.equal(store.blocks.length, 0);
    assert.equal(store.heartbeats.length, 0);
  });
});

describe('the promoter cannot lose its disclosure', () => {
  it('appends the disclosure by code, not by good manners', async () => {
    const promo: Producer = async () => ({
      publication: {
        headline: 'A WORD FROM THE HERALD',
        body: 'The Curb reads sessions and prints what it measured.',
        figures: [],
      },
      sourcesReached: 1,
      oldestInputAt: NOW,
    });
    await runAgent(AGENT_BY_ID.herald, promo, { store, now: NOW });
    assert.match(store.publications[0]?.body ?? '', /Disclosed: this is promotion/);
  });
});
