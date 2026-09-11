import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { runAgent, tick, type Producer } from '../lib/agents/runtime.ts';
import { AGENTS, AGENT_BY_ID } from '../lib/agents/registry.ts';
import { readNow, unread, type Reading } from '../lib/doctrine/reading.ts';
import type {
  BlockRecord,
  HeartbeatRecord,
  ObservationRecord,
  PublicationRecord,
  PublishOutcome,
  Store,
  WriteOutcome,
} from '../lib/store/types.ts';
import type { AgentId } from '../lib/agents/registry.ts';

/**
 * An in-memory Store, so the runtime is tested without touching a disk.
 *
 * `readsFail` simulates a store that will not answer — the case the interface
 * was changed for. Nothing above the Store should turn that into an empty list.
 */
class MemoryStore implements Store {
  heartbeats: HeartbeatRecord[] = [];
  publications: PublicationRecord[] = [];
  blocks: BlockRecord[] = [];
  observed: ObservationRecord[] = [];
  readsFail = false;
  writesFail = false;
  /** Simulates a crash between the publication and the heartbeat. */
  heartbeatWritesFail = false;

  private read<T>(value: T): Reading<T> {
    return this.readsFail
      ? (unread('SOURCE_UNREACHABLE', { source: 'memory', detail: 'simulated outage' }) as Reading<T>)
      : readNow(value, 'memory store');
  }

  private write(): WriteOutcome {
    return this.writesFail ? { state: 'FAILED', reason: 'simulated write failure' } : { state: 'WRITTEN' };
  }

  async writeHeartbeat(record: HeartbeatRecord): Promise<WriteOutcome> {
    if (this.writesFail || this.heartbeatWritesFail) {
      return { state: 'FAILED', reason: 'simulated write failure' };
    }
    this.heartbeats.push(record);
    return { state: 'WRITTEN' };
  }
  async latestHeartbeats(): Promise<Reading<readonly HeartbeatRecord[]>> {
    return this.read<readonly HeartbeatRecord[]>(this.heartbeats);
  }
  async latestHeartbeat(agentId: AgentId): Promise<Reading<HeartbeatRecord | null>> {
    return this.read(this.heartbeats.filter((h) => h.agentId === agentId).at(-1) ?? null);
  }
  async publishAtomically(
    publication: PublicationRecord,
    heartbeat: HeartbeatRecord,
  ): Promise<PublishOutcome> {
    if (this.writesFail) {
      return { state: 'FAILED', reason: 'simulated write failure', partial: false };
    }
    this.publications.push(publication);
    if (this.heartbeatWritesFail) {
      return { state: 'FAILED', reason: 'simulated heartbeat failure', partial: true };
    }
    this.heartbeats.push(heartbeat);
    return { state: 'WRITTEN', atomic: true };
  }
  async recentPublications(limit: number): Promise<Reading<readonly PublicationRecord[]>> {
    return this.read<readonly PublicationRecord[]>(this.publications.slice(-limit).reverse());
  }
  async writeObservations(records: readonly ObservationRecord[]): Promise<WriteOutcome> {
    const outcome = this.write();
    if (outcome.state === 'WRITTEN') this.observed.push(...records);
    return outcome;
  }
  async observations(key: string, limit: number): Promise<Reading<readonly ObservationRecord[]>> {
    return this.read<readonly ObservationRecord[]>(
      this.observed.filter((o) => o.key === key).slice(-limit),
    );
  }
  async writeBlock(record: BlockRecord): Promise<WriteOutcome> {
    const outcome = this.write();
    if (outcome.state === 'WRITTEN') this.blocks.push(record);
    return outcome;
  }
  async recentBlocks(limit: number): Promise<Reading<readonly BlockRecord[]>> {
    return this.read<readonly BlockRecord[]>(this.blocks.slice(-limit).reverse());
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

describe('an unreadable store is not an empty one', () => {
  it('publishes the pair together, so neither can exist alone', async () => {
    await runAgent(BELL, clean, { store, now: NOW });
    assert.equal(store.publications.length, 1);
    assert.equal(store.heartbeats.length, 1);
    assert.equal(store.heartbeats[0]?.publicationId, store.publications[0]?.id);
  });

  it('reports whether the write was actually atomic', async () => {
    const run = await runAgent(BELL, clean, { store, now: NOW });
    assert.equal(run.storage?.state, 'WRITTEN');
    assert.equal(run.storage?.state === 'WRITTEN' && run.storage.atomic, true);
  });

  it('surfaces a publication that landed without its heartbeat', async () => {
    // The exact repair state an operator has to know about.
    store.heartbeatWritesFail = true;
    const run = await runAgent(BELL, clean, { store, now: NOW });
    assert.equal(run.storage?.state, 'FAILED');
    assert.equal(run.storage?.state === 'FAILED' && run.storage.partial, true);
    assert.equal(store.publications.length, 1);
    assert.equal(store.heartbeats.length, 0);
  });

  it('does not swallow a failed heartbeat write', async () => {
    store.writesFail = true;
    const quiet: Producer = async () => ({
      publication: null,
      sourcesReached: 2,
      oldestInputAt: NOW,
    });
    const run = await runAgent(BELL, quiet, { store, now: NOW });
    assert.equal(run.outcome, 'NOTHING_TO_SAY');
    assert.equal(run.storage?.state, 'FAILED');
  });

  it('records an observation write failure on the heartbeat', async () => {
    store.writesFail = true;
    const measuring: Producer = async () => ({
      publication: null,
      sourcesReached: 2,
      oldestInputAt: NOW,
      observations: [{ key: 'k', observedAt: NOW.toISOString(), value: 1, source: 's' }],
    });
    const run = await runAgent(BELL, measuring, { store, now: NOW });
    assert.match(run.heartbeat.detail ?? '', /observations not stored/);
  });

  it('runs nothing it cannot judge as due, and names it', async () => {
    // Due-ness is derived from the last run. An unreadable store means the
    // question has no answer, and neither default is safe: running blind can
    // publish twice, and assuming not-due can silence an agent forever.
    store.readsFail = true;
    const result = await tick({ bell: clean }, { store, now: NOW });
    assert.equal(result.ran.length, 0);
    assert.equal(result.notDue.length, 0);
    assert.equal(result.undetermined.length, AGENTS.length);
    assert.match(result.undetermined[0]?.reason ?? '', /SOURCE_UNREACHABLE/);
  });

  it('still runs normally once the store answers', async () => {
    const result = await tick({ bell: clean }, { store, now: NOW });
    assert.equal(result.undetermined.length, 0);
    assert.equal(result.ran.length, 1);
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
