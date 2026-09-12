import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { previewMint } from '../lib/positions/api.ts';
import { APPLE_S1 } from '../lib/positions/series.ts';
import { indicativeValuation, toUsd2 } from '../lib/positions/valuation.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * An indicative value is an estimate from dated sources and says so; a
 * missing input is a reason, never a zero; a lot is never totalled while a
 * component has no price. The conversion comes from the committed fork
 * evidence; the price from a feed sample the desk would hold.
 */
const feedSample = (observedAt: string, overrides: Record<string, unknown> = {}) => ({
  key: 'feed:rh-aapl-usd',
  observedAt,
  payload: {
    key: 'rh-aapl-usd',
    label: 'AAPL',
    name: 'Robinhood AAPL / USD',
    marketHours: 'equity',
    price: '332.52',
    raw: '33252000000',
    decimals: 8,
    updatedAt: Math.floor(new Date(observedAt).getTime() / 1000) - 3600,
    identity: 'MATCHES',
    pauseFlag: 'CLEAR',
    notPricedBecause: null,
    session: 'CLOSED',
    ...overrides,
  },
});

describe('the indicative value of a lot', () => {
  it('rounds money half up at two places from any scale', () => {
    assert.equal(toUsd2(123456n, 4), '12.35');
    assert.equal(toUsd2(123449n, 4), '12.34');
    assert.equal(toUsd2(5n, 2), '0.05');
    assert.equal(toUsd2(1234567890123456789012345678n, 26), '12.35');
    assert.equal(toUsd2(3n, 0), '3.00');
  });

  it('values A from the fork’s conversion and a fresh feed sample, leaves B unavailable, and never totals', async () => {
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-valuation-')));
    await store.writeSnapshots([feedSample(new Date(Date.now() - 5 * 60_000).toISOString())]);
    const v = await indicativeValuation(store, APPLE_S1, { A: 10n, B: 20n }, false);
    assert.equal(v.state, 'INCOMPLETE');
    assert.equal(v.perUnit.A.state, 'INDICATIVE');
    if (v.perUnit.A.state !== 'INDICATIVE') return;
    // 1 share → 1.0032690125398187 raw (the fork's quote for 10 shares, divided by ten) × 332.52
    assert.equal(v.perUnit.A.perUnitUsd, '333.61');
    assert.equal(v.perLotUsd.A, '3,336.07');
    assert.ok((v.perUnit.A.conversion?.atBlock ?? 0) > 25_000_000, 'the conversion is dated by the fork block');
    assert.equal(v.perUnit.A.price.price, '332.52');
    assert.ok(v.perUnit.A.price.feedUpdatedAt < v.perUnit.A.price.sampledAt, 'the feed’s own time and the sample time are both carried, in order');
    assert.equal(v.perUnit.B.state, 'NOT_AVAILABLE');
    assert.equal(v.perLotUsd.B, null);
    assert.equal(v.perLotTotalUsd, null, 'never totalled while a component has no price');

    const preview = previewMint(APPLE_S1, '3', v);
    assert.ok(!('error' in preview));
    if ('error' in preview) return;
    if (preview.indicativeValue.state === 'NOT_AVAILABLE') throw new Error('the preview lost the valuation');
    assert.equal(preview.indicativeValue.state, 'INCOMPLETE');
    assert.equal(preview.indicativeValue.forLotsUsd.A, '10,008.21', 'three lots of A at the same scale, rounded once');
    assert.equal(preview.indicativeValue.forLotsUsd.B, null);
    assert.equal(preview.indicativeValue.forLotsTotalUsd, null);
    await store.close();
  });

  it('values B from the issuer’s published shares-per-token figure once the page is archived, and then totals the lot', async () => {
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-valuation-')));
    await store.writeSnapshots([
      feedSample(new Date(Date.now() - 5 * 60_000).toISOString()),
      {
        key: 'evidence:ondo:AAPLon:page:latest',
        observedAt: '2026-09-12T04:00:00.000Z',
        payload: { sourceId: 'ondo:AAPLon:page', kind: 'ondo-asset-page', url: 'https://app.ondo.finance/assets/aaplon', readAt: '2026-09-12T04:00:00.000Z', status: 'OK', httpStatus: 200, hash: 'ab'.repeat(32), raw: null, parse: 'PARSED', parsed: { symbol: 'AAPLon', addresses: [] }, live: { sharesMultiplier: '1.003376073740221058' }, detail: null },
      },
    ]);
    const v = await indicativeValuation(store, APPLE_S1, { A: 10n, B: 20n }, false);
    assert.equal(v.state, 'INDICATIVE');
    assert.equal(v.perUnit.B.state, 'INDICATIVE');
    if (v.perUnit.B.state !== 'INDICATIVE') return;
    assert.equal(v.perUnit.B.perUnitUsd, '333.64', '1.003376… shares × 332.52');
    assert.equal(v.perUnit.B.conversion?.atBlock, null, 'dated by the archive’s read, not a block');
    assert.equal(v.perUnit.B.conversion?.atTime, '2026-09-12T04:00:00.000Z');
    assert.equal(v.perLotUsd.B, '6,672.85');
    assert.equal(v.perLotTotalUsd, '10,008.92', 'summed at one scale, rounded once');
    await store.close();
  });

  it('withholds the value when the sample is stale, the feed drifted, or nothing was sampled', async () => {
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-valuation-')));
    const none = await indicativeValuation(store, APPLE_S1, { A: 10n, B: 20n }, false);
    assert.equal(none.state, 'NOT_AVAILABLE');
    assert.equal(none.perUnit.A.state, 'NOT_AVAILABLE');
    if (none.perUnit.A.state === 'NOT_AVAILABLE') assert.match(none.perUnit.A.reason, /not sampled/);

    await store.writeSnapshots([feedSample(new Date(Date.now() - 5 * 3600_000).toISOString())]);
    const stale = await indicativeValuation(store, APPLE_S1, { A: 10n, B: 20n }, false);
    assert.equal(stale.perUnit.A.state, 'NOT_AVAILABLE');
    if (stale.perUnit.A.state === 'NOT_AVAILABLE') assert.match(stale.perUnit.A.reason, /minutes old/);

    await store.writeSnapshots([feedSample(new Date().toISOString(), { identity: 'DRIFT' })]);
    const drifted = await indicativeValuation(store, APPLE_S1, { A: 10n, B: 20n }, false);
    assert.equal(drifted.perUnit.A.state, 'NOT_AVAILABLE');
    if (drifted.perUnit.A.state === 'NOT_AVAILABLE') assert.match(drifted.perUnit.A.reason, /withheld/);

    const preview = previewMint(APPLE_S1, '3', null);
    assert.ok(!('error' in preview));
    if ('error' in preview) return;
    assert.equal(preview.indicativeValue.state, 'NOT_AVAILABLE');
    await store.close();
  });
});
