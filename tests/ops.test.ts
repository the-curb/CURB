import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { composeMessage, deriveConditions, runAlerts, transition, ALERT_STATE_KEY, type Condition } from '../lib/ops/alerts.ts';
import { maintainRetention, PRUNE_STATE_KEY } from '../lib/ops/maintenance.ts';
import { FileSystemStore } from '../lib/store/fs.ts';
import type { HeartbeatRecord, SnapshotRecord } from '../lib/store/types.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Alerting is tested as arithmetic over the record: which conditions the
 * record implies, what changed since last time, and what is written down
 * afterwards. Delivery is exercised with a webhook that is not configured —
 * the reported state for that is part of the contract.
 */

const NOW = new Date('2026-09-11T15:00:00.000Z');

function beat(agentId: HeartbeatRecord['agentId'], minutesAgo: number, outcome: HeartbeatRecord['outcome'] = 'PUBLISHED', detail: string | null = null): HeartbeatRecord {
  return {
    agentId,
    runAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
    outcome,
    sourcesReached: 1,
    sourcesExpected: 1,
    oldestInputAt: null,
    publicationId: outcome === 'PUBLISHED' ? 'p' : null,
    detail,
  };
}

function feed(key: string, payload: Record<string, unknown>): SnapshotRecord {
  return { key: `feed:${key}`, observedAt: NOW.toISOString(), payload: { key, label: key.toUpperCase(), marketHours: 'equity', price: '1.00', updatedAt: 1, ...payload } };
}

describe('deriveConditions', () => {
  it('is empty for a healthy record, as a real empty', () => {
    const heartbeats: HeartbeatRecord[] = [beat('bell', 1), beat('pillar', 2), beat('archivist', 3), beat('registrar', 4), beat('counsel', 5), beat('tally', 6), beat('warden', 7), beat('herald', 8)];
    const out = deriveConditions({ heartbeats, feedSnapshots: [feed('rh-aapl-usd', { pauseFlag: 'CLEAR', identity: 'MATCHES', pastHeartbeat: false })], lastRegistrar: null, now: NOW });
    assert.deepEqual(out, []);
  });

  it('names an absent agent, a degraded one, and a stale one, with the detail', () => {
    const heartbeats: HeartbeatRecord[] = [beat('bell', 1), beat('pillar', 600), beat('tally', 10, 'COVERAGE_BELOW_MINIMUM', 'reached 0 of 1')];
    const out = deriveConditions({ heartbeats, feedSnapshots: [], lastRegistrar: null, now: NOW });
    const ids = out.map((c) => c.id);
    assert.ok(ids.includes('agent:pillar:ABSENT'), ids.join());
    assert.ok(ids.includes('agent:tally:DEGRADED'), ids.join());
    assert.match(out.find((c) => c.id === 'agent:tally:DEGRADED')!.text, /reached 0 of 1/);
    // Agents that never ran are NOT_OBSERVED, which is not an alert: nobody looked.
    assert.ok(!ids.some((id) => id.startsWith('agent:archivist')));
  });

  it('treats an unreadable store as its own condition, not as a clean bill', () => {
    const out = deriveConditions({ heartbeats: null, feedSnapshots: null, lastRegistrar: null, now: NOW });
    assert.deepEqual(out.map((c) => c.id), ['store:heartbeats:UNREAD', 'store:snapshots:UNREAD']);
  });

  it('raises on a paused feed, an identity drift, and staleness while the market was open', () => {
    const out = deriveConditions({
      heartbeats: [beat('bell', 1)],
      feedSnapshots: [
        feed('rh-aapl-usd', { pauseFlag: 'SET', identity: 'MATCHES', pastHeartbeat: false }),
        feed('rh-nvda-usd', { pauseFlag: 'CLEAR', identity: 'DRIFT', pastHeartbeat: false, price: null, notPricedBecause: 'drift' }),
        feed('rh-sgov-usd', { pauseFlag: 'CLEAR', identity: 'MATCHES', pastHeartbeat: true, session: 'REGULAR' }),
        feed('rh-spy-usd', { pauseFlag: 'CLEAR', identity: 'MATCHES', pastHeartbeat: true, session: 'CLOSED' }),
      ],
      lastRegistrar: null,
      now: NOW,
    });
    assert.deepEqual(out.map((c) => c.id), ['feed:rh-aapl-usd:PAUSED', 'feed:rh-nvda-usd:DRIFT', 'feed:rh-sgov-usd:STALE_IN_SESSION']);
  });

  it('raises when the last audit says the beacon changed', () => {
    const out = deriveConditions({
      heartbeats: [beat('bell', 1)],
      feedSnapshots: [],
      lastRegistrar: { id: 'r', agentId: 'registrar', publishedAt: NOW.toISOString(), headline: 'REGISTRY', body: '— The stock-token beacon at 0x1 has CHANGED its implementation: it now points at 0x2', figures: [], sourcesReached: 5 },
      now: NOW,
    });
    assert.deepEqual(out.map((c) => c.id), ['beacon:implementation:CHANGED']);
  });
});

describe('transition and message', () => {
  const a: Condition = { id: 'a', severity: 'DARK', text: 'a happened' };
  const b: Condition = { id: 'b', severity: 'NOTE', text: 'b happened' };

  it('reports what was raised and what cleared, and nothing for what persists', () => {
    const t = transition(['a', 'x'], [a, b]);
    assert.deepEqual(t.raised.map((c) => c.id), ['b']);
    assert.deepEqual(t.cleared, ['x']);
  });

  it('writes a message that names raised, cleared and still active', () => {
    const text = composeMessage(transition(['x'], [a]), NOW);
    assert.match(text, /RAISED\n {2}● a happened/);
    assert.match(text, /CLEARED\n {2}○ x/);
    assert.match(text, /still active: a$/);
  });
});

describe('runAlerts and maintainRetention against a real store', () => {
  const fresh = () => new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-ops-')));

  it('does not record a set it could not deliver, and records it once it can', async () => {
    const store = fresh();
    await store.writeHeartbeat(beat('tally', 10, 'COVERAGE_BELOW_MINIMUM', 'reached 0 of 1'));
    const first = await runAlerts(store, NOW, undefined);
    assert.equal(first.delivery.state, 'NOT_CONFIGURED');
    assert.deepEqual(first.raised, ['agent:tally:DEGRADED']);
    assert.equal(first.stateStored, false);
    // Still raised on the next tick: nobody has been told.
    const second = await runAlerts(store, NOW, undefined);
    assert.deepEqual(second.raised, ['agent:tally:DEGRADED']);
    // With nothing to say, the (empty) set is recorded so a later clear is real.
    const clean = fresh();
    const quiet = await runAlerts(clean, NOW, undefined);
    assert.equal(quiet.delivery.state, 'NOTHING_TO_SEND');
    assert.equal(quiet.stateStored, true);
    const state = await clean.snapshots(ALERT_STATE_KEY);
    assert.deepEqual(state.state === 'VERIFIED' ? state.value[0]?.payload : null, { active: [] });
  });

  it('prunes once a day and reports the second call as already done', async () => {
    const store = fresh();
    await store.writeObservations([
      { key: 'k', observedAt: '2026-01-01T00:00:00.000Z', value: 1, source: 's' },
      { key: 'k', observedAt: NOW.toISOString(), value: 2, source: 's' },
    ]);
    const first = await maintainRetention(store, NOW);
    assert.equal(first.state, 'PRUNED');
    if (first.state === 'PRUNED') {
      assert.equal(first.removed, 1);
      assert.equal(first.recorded, true);
    }
    const second = await maintainRetention(store, new Date(NOW.getTime() + 3600_000));
    assert.deepEqual(second, { state: 'ALREADY_DONE', day: '2026-09-11', lastRemoved: 1 });
    const nextDay = await maintainRetention(store, new Date('2026-09-12T00:10:00.000Z'));
    assert.equal(nextDay.state, 'PRUNED');
    const state = await store.snapshots(PRUNE_STATE_KEY);
    assert.equal(state.state === 'VERIFIED' ? state.value.length : -1, 1);
  });
});
