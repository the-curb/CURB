import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import type { Store } from '../lib/store/types.ts';
import type { AgentId } from '../lib/agents/registry.ts';

/**
 * The contract every Store must satisfy, written once and run against each
 * implementation.
 *
 * This exists so a new backing store can be proved rather than hoped for. The
 * filesystem store runs it in the normal suite; a database store runs the same
 * assertions the moment credentials exist, with no second set of tests to keep
 * in step and no chance of the two drifting.
 *
 * It deliberately checks the doctrine, not just the plumbing: that a read of an
 * empty store is an empty answer rather than an absent one, that a publication
 * and its heartbeat arrive together, and that a lock nobody can take is not a
 * lock that is free.
 */

const AGENT: AgentId = 'bell';

function heartbeat(runAt: string, outcome: 'PUBLISHED' | 'NOTHING_TO_SAY' = 'PUBLISHED') {
  return {
    agentId: AGENT,
    runAt,
    outcome,
    sourcesReached: 2,
    sourcesExpected: 2,
    oldestInputAt: runAt,
    publicationId: null,
    detail: null,
  } as const;
}

function publication(id: string, publishedAt: string) {
  return {
    id,
    agentId: AGENT,
    publishedAt,
    headline: 'CLOSED',
    body: 'The exchange is shut.',
    figures: [{ token: '1', source: 'test', retrievedAt: publishedAt }],
    sourcesReached: 2,
  } as const;
}

export interface ConformanceTarget {
  readonly name: string;
  /** Must return a store with no records in it. */
  readonly fresh: () => Promise<Store>;
}

export function runStoreConformance(target: ConformanceTarget): void {
  describe(`store conformance · ${target.name}`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await target.fresh();
    });

    describe('an empty store answers, rather than failing', () => {
      it('reads no heartbeats as an empty list, not as unread', async () => {
        const read = await store.latestHeartbeats();
        assert.equal(read.state, 'VERIFIED', 'an empty store is readable');
        assert.deepEqual(read.state === 'VERIFIED' ? [...read.value] : null, []);
      });

      it('reads a missing agent as null rather than unread', async () => {
        const read = await store.latestHeartbeat(AGENT);
        assert.equal(read.state, 'VERIFIED');
        assert.equal(read.state === 'VERIFIED' ? read.value : 'x', null);
      });

      it('carries a source on every reading', async () => {
        const read = await store.recentPublications(5);
        assert.equal(read.state, 'VERIFIED');
        assert.ok(read.state === 'VERIFIED' && read.source.length > 0);
      });
    });

    describe('heartbeats', () => {
      it('keeps only the most recent per agent', async () => {
        await store.writeHeartbeat(heartbeat('2026-09-10T10:00:00.000Z', 'NOTHING_TO_SAY'));
        await store.writeHeartbeat(heartbeat('2026-09-10T11:00:00.000Z'));

        const read = await store.latestHeartbeats();
        assert.equal(read.state, 'VERIFIED');
        const rows = read.state === 'VERIFIED' ? read.value : [];
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.runAt, '2026-09-10T11:00:00.000Z');
      });

      it('returns the latest for one agent', async () => {
        await store.writeHeartbeat(heartbeat('2026-09-10T10:00:00.000Z'));
        const read = await store.latestHeartbeat(AGENT);
        assert.equal(read.state === 'VERIFIED' && read.value?.runAt, '2026-09-10T10:00:00.000Z');
      });
    });

    describe('publishing', () => {
      it('writes the publication and its heartbeat together', async () => {
        const pub = publication('11111111-1111-4111-8111-111111111111', '2026-09-10T12:00:00.000Z');
        const beat = { ...heartbeat('2026-09-10T12:00:00.000Z'), publicationId: pub.id };

        const outcome = await store.publishAtomically(pub, beat);
        assert.equal(outcome.state, 'WRITTEN');

        const pubs = await store.recentPublications(5);
        const beats = await store.latestHeartbeats();
        assert.equal(pubs.state === 'VERIFIED' && pubs.value.length, 1);
        assert.equal(beats.state === 'VERIFIED' && beats.value.length, 1);
        assert.equal(
          beats.state === 'VERIFIED' ? beats.value[0]?.publicationId : null,
          pub.id,
          'the heartbeat points at the publication',
        );
      });

      it('states whether it was atomic rather than implying it', async () => {
        const pub = publication('22222222-2222-4222-8222-222222222222', '2026-09-10T12:00:00.000Z');
        const outcome = await store.publishAtomically(pub, {
          ...heartbeat('2026-09-10T12:00:00.000Z'),
          publicationId: pub.id,
        });
        assert.ok(outcome.state === 'WRITTEN' && typeof outcome.atomic === 'boolean');
      });

      it('returns publications newest first', async () => {
        for (const [n, at] of [
          ['33333333-3333-4333-8333-333333333333', '2026-09-10T09:00:00.000Z'],
          ['44444444-4444-4444-8444-444444444444', '2026-09-10T13:00:00.000Z'],
        ] as const) {
          await store.publishAtomically(publication(n, at), { ...heartbeat(at), publicationId: n });
        }
        const read = await store.recentPublications(5);
        assert.equal(
          read.state === 'VERIFIED' ? read.value[0]?.publishedAt : null,
          '2026-09-10T13:00:00.000Z',
        );
      });

      it('round-trips the declared figures', async () => {
        const pub = publication('55555555-5555-4555-8555-555555555555', '2026-09-10T12:00:00.000Z');
        await store.publishAtomically(pub, { ...heartbeat('2026-09-10T12:00:00.000Z') });
        const read = await store.recentPublications(1);
        const stored = read.state === 'VERIFIED' ? read.value[0] : null;
        assert.equal(stored?.figures.length, 1);
        assert.equal(stored?.figures[0]?.source, 'test');
      });
    });

    describe('observations', () => {
      it('returns a series oldest first, so it is ready to compute over', async () => {
        await store.writeObservations([
          { key: 'eth-usd', observedAt: '2026-09-10T11:00:00.000Z', value: 2, source: 's' },
          { key: 'eth-usd', observedAt: '2026-09-10T10:00:00.000Z', value: 1, source: 's' },
        ]);
        const read = await store.observations('eth-usd', 10);
        const rows = read.state === 'VERIFIED' ? read.value : [];
        assert.deepEqual(
          rows.map((r) => r.value),
          [1, 2],
        );
      });

      it('keeps series apart by key', async () => {
        await store.writeObservations([
          { key: 'eth-usd', observedAt: '2026-09-10T10:00:00.000Z', value: 1, source: 's' },
          { key: 'btc-usd', observedAt: '2026-09-10T10:00:00.000Z', value: 9, source: 's' },
        ]);
        const read = await store.observations('btc-usd', 10);
        assert.equal(read.state === 'VERIFIED' ? read.value.length : -1, 1);
      });

      it('keeps the raw integer when one was given', async () => {
        // The lossy-double problem: a store that drops `raw` cannot be trusted
        // to reproduce an eighteen-decimal amount later.
        await store.writeObservations([
          {
            key: 'weth-supply',
            observedAt: '2026-09-10T10:00:00.000Z',
            value: 40684.49193697159,
            raw: '40684491936971592903380',
            decimals: 18,
            source: 's',
          },
        ]);
        const read = await store.observations('weth-supply', 1);
        const row = read.state === 'VERIFIED' ? read.value[0] : null;
        assert.equal(row?.raw, '40684491936971592903380');
        assert.equal(row?.decimals, 18);
      });

      it('accepts an empty write without complaint', async () => {
        const outcome = await store.writeObservations([]);
        assert.equal(outcome.state, 'WRITTEN');
      });
    });

    describe('retention', () => {
      const series = [
        { key: 'eth-usd', observedAt: '2026-01-01T00:00:00.000Z', value: 1, source: 's' },
        { key: 'eth-usd', observedAt: '2026-06-01T00:00:00.000Z', value: 2, source: 's' },
        { key: 'eth-usd', observedAt: '2026-09-01T00:00:00.000Z', value: 3, source: 's' },
      ];

      it('removes only what is older than the cutoff', async () => {
        await store.writeObservations(series);
        const pruned = await store.pruneObservations(new Date('2026-05-01T00:00:00.000Z'));
        assert.equal(pruned.state, 'VERIFIED');
        assert.equal(pruned.state === 'VERIFIED' ? pruned.value : -1, 1);

        const left = await store.observations('eth-usd', 10);
        assert.deepEqual(
          left.state === 'VERIFIED' ? left.value.map((r) => r.value) : null,
          [2, 3],
        );
      });

      it('reports a count, and reports zero as a real zero', async () => {
        await store.writeObservations(series);
        const pruned = await store.pruneObservations(new Date('2025-01-01T00:00:00.000Z'));
        assert.equal(pruned.state === 'VERIFIED' ? pruned.value : -1, 0);
        const left = await store.observations('eth-usd', 10);
        assert.equal(left.state === 'VERIFIED' ? left.value.length : -1, 3);
      });

      it('prunes across every key, not just one', async () => {
        await store.writeObservations([
          ...series,
          { key: 'btc-usd', observedAt: '2026-01-01T00:00:00.000Z', value: 9, source: 's' },
        ]);
        const pruned = await store.pruneObservations(new Date('2026-05-01T00:00:00.000Z'));
        assert.equal(pruned.state === 'VERIFIED' ? pruned.value : -1, 2);
      });

      it('leaves other records untouched', async () => {
        // Publications are the product and blocks are the evidence; neither has
        // a horizon, and a prune that took them would be deleting the record.
        const pub = publication('77777777-7777-4777-8777-777777777777', '2026-01-01T00:00:00.000Z');
        await store.publishAtomically(pub, heartbeat('2026-01-01T00:00:00.000Z'));
        await store.writeObservations(series);

        await store.pruneObservations(new Date('2026-05-01T00:00:00.000Z'));

        const pubs = await store.recentPublications(5);
        assert.equal(pubs.state === 'VERIFIED' ? pubs.value.length : -1, 1);
      });
    });

    describe('blocked outputs', () => {
      it('keeps the text and the breaches in full', async () => {
        await store.writeBlock({
          id: '66666666-6666-4666-8666-666666666666',
          agentId: AGENT,
          blockedAt: '2026-09-10T12:00:00.000Z',
          headline: 'CLOSED',
          body: 'You should buy before the open.',
          breaches: [
            { rule: 'ADVICE_SHAPE', matched: 'you should buy', explanation: 'never an instruction' },
          ],
        });
        const read = await store.recentBlocks(5);
        const row = read.state === 'VERIFIED' ? read.value[0] : null;
        assert.equal(row?.breaches.length, 1);
        assert.equal(row?.breaches[0]?.rule, 'ADVICE_SHAPE');
        assert.match(row?.body ?? '', /buy before the open/);
      });
    });

    describe('the run lock', () => {
      it('is granted when free', async () => {
        const outcome = await store.acquireRunLock('holder-a', 60);
        assert.equal(outcome.state, 'ACQUIRED');
      });

      it('is refused to a second holder', async () => {
        await store.acquireRunLock('holder-a', 60);
        const second = await store.acquireRunLock('holder-b', 60);
        assert.notEqual(second.state, 'ACQUIRED');
      });

      it('is available again after release', async () => {
        await store.acquireRunLock('holder-a', 60);
        const released = await store.releaseRunLock('holder-a');
        assert.equal(released.state, 'WRITTEN');
        const again = await store.acquireRunLock('holder-b', 60);
        assert.equal(again.state, 'ACQUIRED');
      });

      it('cannot be released by somebody who does not hold it', async () => {
        await store.acquireRunLock('holder-a', 60);
        const stolen = await store.releaseRunLock('holder-b');
        assert.equal(stolen.state, 'FAILED');
      });

      it('can be renewed by its holder', async () => {
        await store.acquireRunLock('holder-a', 60);
        const renewed = await store.refreshRunLock('holder-a', 60);
        assert.equal(renewed.state, 'WRITTEN');
        // Still held, still refused to anyone else.
        const other = await store.acquireRunLock('holder-b', 60);
        assert.notEqual(other.state, 'ACQUIRED');
      });

      it('refuses to renew a lock held by somebody else', async () => {
        // A lapsed lock that another holder took is theirs; renewing it from
        // the old holder would be theft, and would let two runs overlap.
        await store.acquireRunLock('holder-a', 60);
        const renewed = await store.refreshRunLock('holder-b', 60);
        assert.equal(renewed.state, 'FAILED');
      });

      it('lets a lapsed lock be taken, and then refuses the old holder', async () => {
        await store.acquireRunLock('holder-a', 1);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const taken = await store.acquireRunLock('holder-b', 60);
        assert.equal(taken.state, 'ACQUIRED');
        const stale = await store.refreshRunLock('holder-a', 60);
        assert.equal(stale.state, 'FAILED');
      });
    });
  });
}
