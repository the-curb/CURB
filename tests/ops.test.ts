import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { composeMessage, deriveConditions, runAlerts, transition, ALERT_STATE_KEY, CONDITION_KINDS, DEFAULT_KINDS, KIND_CATALOGUE, kindOf, matchesFilter, tickerOf, type Condition } from '../lib/ops/alerts.ts';
import { parseFilter } from '../lib/credits/subscriptions.ts';
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

  it('raises when the chain head had stalled at the Pillar’s last sample, and not otherwise', () => {
    const base = { heartbeats: [beat('bell', 1)], feedSnapshots: [], lastRegistrar: null, now: NOW };
    const stalled = deriveConditions({ ...base, headSnapshot: { key: 'chain:head', observedAt: NOW.toISOString(), payload: { number: 1, timestamp: 1, ageSeconds: 900, stalled: true } } });
    assert.deepEqual(stalled.map((c) => c.id), ['chain:head:STALLED']);
    assert.match(stalled[0]!.text, /900s old at the sample/);
    const live = deriveConditions({ ...base, headSnapshot: { key: 'chain:head', observedAt: NOW.toISOString(), payload: { number: 1, timestamp: 1, ageSeconds: 1, stalled: false } } });
    assert.deepEqual(live, []);
    // A payload that does not say `stalled: true` is not a stall: absence is not the middle.
    const unknown = deriveConditions({ ...base, headSnapshot: { key: 'chain:head', observedAt: NOW.toISOString(), payload: { stalled: 'yes' } } });
    assert.deepEqual(unknown, []);
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

describe('what a holder subscribes to', () => {
  it('classifies every condition, and names the ticker of a token condition', () => {
    assert.equal(kindOf('feed:rh-aapl-usd:PAUSED'), 'token');
    assert.equal(kindOf('token:rh-aapl:MULTIPLIER_PENDING'), 'token');
    assert.equal(kindOf('beacon:implementation:CHANGED'), 'issuer');
    assert.equal(kindOf('evidence:page:A:products-apple-xstock:CHANGED'), 'issuer');
    assert.equal(kindOf('chain:head:STALLED'), 'chain');
    assert.equal(kindOf('credits:index:BEHIND'), 'desk');
    assert.equal(kindOf('anything:else'), 'desk');
    assert.equal(tickerOf('feed:rh-aapl-usd:STALE_IN_SESSION'), 'AAPL');
    assert.equal(tickerOf('token:rh-aapl:MULTIPLIER_PENDING'), 'AAPL');
    assert.equal(tickerOf('feed:no-such-feed:PAUSED'), null);
    assert.equal(tickerOf('beacon:code:DIFFERS'), null);
    for (const kind of CONDITION_KINDS) assert.ok(KIND_CATALOGUE[kind].what.length > 0 && KIND_CATALOGUE[kind].examples.length > 0);
    assert.deepEqual(DEFAULT_KINDS, ['token', 'issuer', 'chain'], "a holder's default is not the desk's plumbing");
  });

  it('delivers by the filter: kinds, and tickers for the token kind only', () => {
    const paused: Condition = { id: 'feed:rh-aapl-usd:PAUSED', severity: 'STALE', text: 'AAPL paused' };
    const tsla: Condition = { id: 'feed:rh-tsla-usd:PAUSED', severity: 'STALE', text: 'TSLA paused' };
    const beacon: Condition = { id: 'beacon:code:DIFFERS', severity: 'DARK', text: 'beacon' };
    const plumbing: Condition = { id: 'credits:index:BEHIND', severity: 'NOTE', text: 'index' };
    const holder = { kinds: DEFAULT_KINDS, tokens: [] };
    assert.ok(matchesFilter(holder, paused) && matchesFilter(holder, beacon) && !matchesFilter(holder, plumbing));
    const apple = { kinds: DEFAULT_KINDS, tokens: ['AAPL'] };
    assert.ok(matchesFilter(apple, paused), 'its token');
    assert.ok(!matchesFilter(apple, tsla), 'another token');
    assert.ok(matchesFilter(apple, beacon), 'an issuer event concerns every token, whatever the token list');
    const operator = { kinds: ['desk' as const], tokens: [] };
    assert.ok(matchesFilter(operator, plumbing) && !matchesFilter(operator, paused));
  });

  it('checks a requested filter against the catalogue and the capture', () => {
    const ok = parseFilter({ tokens: ['aapl', 'TSLA', 'AAPL'] });
    assert.ok(ok.ok && ok.filter.tokens.join() === 'AAPL,TSLA' && ok.filter.kinds === DEFAULT_KINDS);
    const unknown = parseFilter({ tokens: ['ZZZZ'] });
    assert.ok(!unknown.ok && /does not watch a token with ticker "ZZZZ"/.test(unknown.detail));
    const badKind = parseFilter({ kinds: ['weather'] });
    assert.ok(!badKind.ok && /unknown kind "weather"/.test(badKind.detail));
    const notList = parseFilter({ kinds: 'token' });
    assert.ok(!notList.ok);
    const empty = parseFilter({});
    assert.ok(empty.ok && empty.filter.tokens.length === 0 && empty.filter.kinds === DEFAULT_KINDS);
  });

  it('raises a staged multiplier as a condition, from the Archivist’s snapshot, until it takes effect', () => {
    const staged: SnapshotRecord = {
      key: 'token:rh-aapl',
      observedAt: NOW.toISOString(),
      payload: { key: 'rh-aapl', ticker: 'AAPL', multiplierRaw: '1000566080061092436', pendingRaw: '1001200000000000000', pendingEffectiveAt: '2026-09-25T00:30:00.000Z', retrievedAt: NOW.toISOString() },
    };
    const settled: SnapshotRecord = { key: 'token:rh-tsla', observedAt: NOW.toISOString(), payload: { key: 'rh-tsla', ticker: 'TSLA', multiplierRaw: '1000000000000000000', pendingRaw: null } };
    const out = deriveConditions({ heartbeats: [beat('bell', 1)], feedSnapshots: [], lastRegistrar: null, tokenSnapshots: [staged, settled], now: NOW });
    const c = out.find((x) => x.id === 'token:rh-aapl:MULTIPLIER_PENDING');
    assert.ok(c, out.map((x) => x.id).join());
    assert.equal(c.severity, 'NOTE');
    assert.match(c.text, /AAPL: the issuer has staged a multiplier change, 1\.000566 → 1\.001200, taking effect on 2026-09-25/);
    assert.ok(!out.some((x) => x.id === 'token:rh-tsla:MULTIPLIER_PENDING'));
    // Once the change took effect the snapshot has no pending value: the condition clears, and the clearing is the delivery that says it happened.
    const after = deriveConditions({ heartbeats: [beat('bell', 1)], feedSnapshots: [], lastRegistrar: null, tokenSnapshots: [{ ...staged, payload: { ...staged.payload, multiplierRaw: '1001200000000000000', pendingRaw: null } }], now: NOW });
    assert.deepEqual(transition(out.map((x) => x.id), after).cleared, ['token:rh-aapl:MULTIPLIER_PENDING']);
  });
});
