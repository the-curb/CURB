import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { composeFlow, composeSeries, FLOW_SERIES } from '../lib/vault/flow.ts';
import { composeWatchTable } from '../lib/terms/table.ts';
import { TERMS_SOURCES } from '../lib/chain/terms.ts';
import type { ObservationRecord } from '../lib/store/types.ts';

const NOW = new Date('2026-09-11T18:00:00.000Z');

function sample(minutesAgo: number, value: number): ObservationRecord {
  return { key: 'usdg:transfers-per-minute', observedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), value, source: 's' };
}
const ok = (rows: ObservationRecord[]) => ({ state: 'VERIFIED' as const, value: rows });

describe('the Vault', () => {
  const usdg = FLOW_SERIES[0];

  it('summarises a series as latest, low, median and high, oldest first', () => {
    const s = composeSeries(usdg, ok([sample(180, 100), sample(120, 300), sample(60, 200)]), NOW);
    assert.equal(s.latest?.perMinute, 200);
    assert.equal(s.sampleAgeSeconds, 3600);
    assert.deepEqual([s.low, s.median, s.high], [100, 200, 300]);
    assert.deepEqual(s.points.map((p) => p.perMinute), [100, 300, 200]);
  });

  it('drops a row that cannot be a rate rather than drawing it', () => {
    const s = composeSeries(usdg, ok([sample(60, -5), sample(30, Number.NaN), sample(10, 42)]), NOW);
    assert.deepEqual(s.points.map((p) => p.perMinute), [42]);
  });

  it('carries an unreadable series as unreadable, not as quiet', () => {
    const s = composeSeries(usdg, { state: 'UNREAD', reason: 'SOURCE_UNREACHABLE', detail: 'pooler' }, NOW);
    assert.equal(s.latest, null);
    assert.match(s.unreadBecause ?? '', /SOURCE_UNREACHABLE — pooler/);
  });

  it('states the flow’s sample state from the newest sample against the Tally’s interval', () => {
    const fresh = composeSeries(usdg, ok([sample(30, 1)]), NOW);
    const old = composeSeries(usdg, ok([sample(60 * 30, 1)]), NOW); // 30 h
    const never = composeSeries(usdg, ok([]), NOW);
    assert.equal(composeFlow([fresh, old], 48).sampleState, 'VERIFIED');
    assert.equal(composeFlow([old], 48).sampleState, 'ABSENT');
    assert.equal(composeFlow([never], 48).sampleState, 'NONE');
  });
});

describe('the Chambers table', () => {
  it('lists every page in the register even before any is watched', () => {
    const t = composeWatchTable([], NOW);
    assert.equal(t.rows.length, TERMS_SOURCES.length);
    assert.equal(t.sampleState, 'NONE');
    assert.equal(t.counts.watched, 0);
    assert.match(t.rows[0]!.unreadBecause ?? '', /not yet watched/);
  });

  it('reads a watch back and counts a change', () => {
    const at = new Date(NOW.getTime() - 3600_000).toISOString();
    const t = composeWatchTable(
      [
        { key: 'terms:restricted', observedAt: at, payload: { hash: 'h', chars: 680, firstSeenAt: '2026-09-01T00:00:00.000Z', lastFetchedAt: at, lastChangedAt: '2026-09-10T00:00:00.000Z', changes: 1 } },
        { key: 'terms:oracles', observedAt: at, payload: { hash: 3 } }, // malformed
      ],
      NOW,
    );
    const restricted = t.rows.find((r) => r.source.key === 'restricted')!;
    assert.equal(restricted.watch?.changes, 1);
    assert.equal(restricted.sampleAgeSeconds, 3600);
    const oracles = t.rows.find((r) => r.source.key === 'oracles')!;
    assert.equal(oracles.watch, null);
    assert.match(oracles.unreadBecause ?? '', /could not be read as written/);
    assert.deepEqual(t.counts, { read: 1, linkOnly: 4, watched: 1, changed: 1 });
    assert.equal(t.sampleState, 'VERIFIED');
  });
});
