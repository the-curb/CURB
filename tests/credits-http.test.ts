import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { deskCodeSnapshot, expectedDeskImmutables, type DeskCodeVerification } from '../lib/credits/code.ts';
import { parseCreditsConfig, type CreditsConfig, type CreditsStatus } from '../lib/credits/config.ts';
import { admit } from '../lib/credits/guard.ts';
import { newKeyResponse } from '../lib/credits/key-api.ts';
import { isKey, keyHashOf, newKey, topUpsRow } from '../lib/credits/keys.ts';
import { RATE_KEY, type RateSnapshot } from '../lib/credits/maintenance.ts';
import { creditsResponse } from '../lib/launch/credits-api.ts';
import { LAUNCH_READ_MAX_AGE_MS } from '../lib/launch/evidence.ts';
import { unread } from '../lib/doctrine/reading.ts';
import { buildRecord, compareAgainst } from '../lib/positions/code.ts';
import type { SnapshotRecord, Store } from '../lib/store/types.ts';

// The exact Request -> Response implementation delegated to by /api/credits.
// All inputs are synthetic local-chain observations. This is not a Next server
// or a live RPC test; unexpected store operations fail rather than leave here.
const NOW = new Date('2026-09-13T12:00:00.000Z');
const AT = '2026-09-13T11:55:00.000Z';
const TOKEN = '0x1000000000000000000000000000000000000001';
const DESK = '0x2000000000000000000000000000000000000002';
const TREASURY = '0x3000000000000000000000000000000000000003';
const POOL = '0x4000000000000000000000000000000000000004';
const OTHER = '0x5000000000000000000000000000000000000005';
const STATUS = parseCreditsConfig(JSON.stringify({ network: 'hardhat-local', token: TOKEN, desk: DESK, treasury: TREASURY, fromBlock: 1, priceSource: { kind: 'uniswap-v2-pair', pair: POOL, quote: { kind: 'usd-stable' } } }));
assert.equal(STATUS.state, 'CONFIGURED');
if (STATUS.state !== 'CONFIGURED') throw new Error('invalid test configuration');
const CONFIG: CreditsConfig = STATUS.config;

function code(): DeskCodeVerification {
  return {
    chainId: 31337, address: DESK, state: 'MATCHES', detail: null,
    codeHash: '0x' + '11'.repeat(32), buildCommit: 'synthetic fixture', solc: '0.8.30', readAt: AT,
    immutables: Object.entries(expectedDeskImmutables(CONFIG)).map(([name, expected]) => ({ name, expected: `0x${expected}`, onChain: `0x${expected}`, matches: true })),
  };
}

function rate(): Extract<RateSnapshot, { state: 'READ' }> {
  return {
    state: 'READ', chainId: 31337, at: AT,
    rate: {
      block: 100, basis: 'STATE', readAt: AT,
      token: { address: TOKEN, decimals: 18, supply: '1000000000000000000000000', supplyAt: 'BLOCK' },
      pool: { kind: 'uniswap-v2-pair', address: POOL, quoteAddress: OTHER, quoteDecimals: 6, reserveCurb: '1000000000000000000000', reserveQuote: '2000000000' },
      quote: { kind: 'usd-stable' },
      guard: { windowBlocks: 40, samples: 1, lowestAtBlock: 90, atBlockUsdPerCurb18: '2000000000000000000', applied: false },
      usdPerCurb18: '2000000000000000000', marketCapUsd18: '2000000000000000000000000', source: 'synthetic local fixture; no RPC',
    },
  };
}

function storeFor(verification: DeskCodeVerification | null = code(), price: RateSnapshot | null = rate(), fault: string | null = null, additional: SnapshotRecord[] = []): Store {
  const rows: SnapshotRecord[] = [...additional];
  if (verification !== null) rows.push(deskCodeSnapshot(verification));
  if (price !== null) rows.push({ key: RATE_KEY, observedAt: price.at, payload: { ...price } });
  return new Proxy({}, {
    get: (_target, name) => {
      if (name === 'snapshots') return async (prefix: string) => prefix === fault
        ? unread('SOURCE_UNREACHABLE', { detail: 'isolated store read failed', now: NOW })
        : { state: 'VERIFIED', value: rows.filter((row) => row.key.startsWith(prefix)), source: 'isolated test store', retrievedAt: NOW.toISOString(), ageSeconds: 0 };
      return () => { throw new Error(`unexpected store operation: ${String(name)}`); };
    },
  }) as Store;
}

async function response(store = storeFor(), status: CreditsStatus = STATUS, query = '?usd=20', now = NOW) {
  const http = await creditsResponse(new Request(`http://127.0.0.1/api/credits${query}`), status, store, now);
  assert.equal(http.status, 200);
  assert.equal(http.headers.get('cache-control'), 'no-store');
  assert.match(http.headers.get('content-type') ?? '', /application\/json/);
  return http.json();
}

describe('the credit desk HTTP response', () => {
  it('quotes using ImmutableCheck values produced by the actual build comparator', async () => {
    const { build, fault } = await buildRecord('CreditDesk');
    assert.ok(build, fault ?? 'CreditDesk build unavailable');
    const expected = expectedDeskImmutables(CONFIG);
    let runtime = build.deployedBytecode.replace(/^0x/, '');
    for (const immutable of build.immutables) {
      for (const slot of immutable.slots) runtime = runtime.slice(0, slot.start * 2) + expected[immutable.name] + runtime.slice((slot.start + slot.length) * 2);
    }
    const comparison = compareAgainst(`0x${runtime}`, build, expected);
    assert.equal(comparison.state, 'MATCHES', comparison.detail ?? '');
    assert.ok(comparison.immutables.every(i => /^0x[0-9a-f]{64}$/.test(i.expected) && i.expected === i.onChain));
    const body = await response(storeFor({ ...code(), ...comparison }));
    assert.equal(body.quoteReadiness.codeCurrent, true);
    assert.equal(body.quote.state, 'QUOTED');
    assert.equal(body.topUp.desk, DESK);
  });
  it('quotes from current evidence, preserving prices, exact base units, and the existing 5% margin', async () => {
    const body = await response();
    assert.equal(body.state, 'CONFIGURED');
    assert.equal(body.observedAt, NOW.toISOString());
    assert.deepEqual(body.quoteReadiness, { codeCurrent: true, rateCurrent: true, maxReadAgeSeconds: 1800 });
    assert.equal(body.quote.state, 'QUOTED');
    assert.equal(body.quote.usdCents, '2000');
    assert.equal(body.quote.curb, '10000000000000000000');
    assert.equal(body.quote.curbWithMargin, '10500000000000000000');
    assert.equal(body.quote.marginPct, 5);
    assert.equal(body.quote.atBlock, 100);
    assert.equal(body.quote.readAt, AT);
    assert.equal(body.minimumOpenCents, 2000);
    assert.deepEqual(body.services.map((service: { cents: number }) => service.cents), [5, 5, 10]);
    assert.match(body.quote.note, /mined-block rate/);
    assert.match(body.quote.note, /not a slippage limit or minimum credit guarantee/);
  });

  it('expires quote eligibility at 30 minutes without rewriting the historical MATCHES and READ observations', async () => {
    const limit = new Date(Date.parse(AT) + LAUNCH_READ_MAX_AGE_MS);
    assert.equal((await response(storeFor(), STATUS, '?usd=20', limit)).quote.state, 'QUOTED');
    const body = await response(storeFor(), STATUS, '?usd=20', new Date(limit.getTime() + 1));
    assert.equal(body.state, 'CONFIGURED');
    assert.equal(body.code.state, 'MATCHES');
    assert.equal(body.code.readAt, AT);
    assert.equal(body.rate.state, 'READ');
    assert.equal(body.rate.at, AT);
    assert.equal(body.quote.state, 'HELD');
    assert.equal(body.quote.curb, null);
    assert.deepEqual(body.quoteReadiness, { codeCurrent: false, rateCurrent: false, maxReadAgeSeconds: 1800 });
  });

  it('holds fresh rate quotes when the configured treasury changes after desk verification', async () => {
    const body = await response(storeFor(), { state: 'CONFIGURED', config: { ...CONFIG, treasury: OTHER } });
    assert.equal(body.state, 'CONFIGURED');
    assert.equal(body.desk.treasury, OTHER);
    assert.equal(body.code.state, 'MATCHES', 'the old raw verification is still available to inspect');
    assert.equal(body.quoteReadiness.codeCurrent, false);
    assert.equal(body.quoteReadiness.rateCurrent, true);
    assert.equal(body.quote.state, 'HELD');
    assert.equal(body.quote.curb, null);
  });

  it('holds a stale, future-dated or invalid-time rate even while the code verification is current', async () => {
    for (const at of ['2026-09-13T11:29:59.999Z', '2026-09-13T12:00:00.001Z', 'not-a-date']) {
      const sample = rate();
      const body = await response(storeFor(code(), { ...sample, at, rate: { ...sample.rate, readAt: at } }));
      assert.equal(body.rate.state, 'READ');
      assert.equal(body.quoteReadiness.codeCurrent, true);
      assert.equal(body.quoteReadiness.rateCurrent, false, at);
      assert.equal(body.quote.state, 'HELD', at);
      assert.equal(body.quote.curb, null);
    }
  });

  it('quarantines legacy and other-chain rates even when token and pool addresses match', async () => {
    for (const chainId of [undefined, 4663]) {
      const body = await response(storeFor(code(), { ...rate(), chainId }));
      assert.equal(body.rate.state, 'UNREAD', 'the old observation is not relabeled as the configured chain');
      assert.equal(body.rate.reason, chainId === undefined ? 'RATE_ROW_UNSCOPED' : 'RATE_ROW_OTHER_CHAIN');
      assert.equal(body.rate.usdPerCurb18, undefined);
      assert.equal(body.quoteReadiness.codeCurrent, true);
      assert.equal(body.quoteReadiness.rateCurrent, false);
      assert.equal(body.quote.state, 'UNREAD');
      assert.equal(body.quote.curb, null);
    }
  });

  it('does not reuse a rate for a different token, pool kind or quote feed at the same recorded pool address', async () => {
    const sample = rate();
    const changedRates = [
      { ...sample.rate, token: { ...sample.rate.token, address: OTHER } },
      { ...sample.rate, pool: { ...sample.rate.pool, kind: 'uniswap-v3-pool' as const } },
      { ...sample.rate, quote: { kind: 'chainlink-feed' as const, feed: OTHER, answer: '100000000', decimals: 8, updatedAt: AT } },
    ];
    for (const changed of changedRates) {
      const body = await response(storeFor(code(), { ...sample, rate: changed }));
      assert.equal(body.rate.state, 'READ');
      assert.equal(body.quoteReadiness.rateCurrent, false);
      assert.equal(body.quote.state, 'HELD');
      assert.equal(body.quote.curb, null);
    }
  });

  it('distinguishes unavailable rate storage, unread rates, and no observation from a quoted amount', async () => {
    const failed = await response(storeFor(code(), rate(), RATE_KEY));
    assert.equal(failed.rate.state, 'STORE_UNREADABLE');
    assert.equal(failed.quote.state, 'STORE_UNREADABLE');
    assert.equal(failed.quote.curb, null);
    const absent = await response(storeFor(code(), null));
    assert.equal(absent.rate, null);
    assert.equal(absent.quote.state, 'NO_RATE');
    const unreadRate = await response(storeFor(code(), { state: 'UNREAD', at: AT, block: 100, reason: 'SOURCE_UNREACHABLE', detail: 'node refused' }));
    assert.equal(unreadRate.quote.state, 'UNREAD');
    assert.match(unreadRate.quote.detail, /node refused/);
    const noCode = await response(storeFor(code(), rate(), 'credits:code'));
    assert.equal(noCode.code.state, 'STORE_UNREADABLE');
    assert.equal(noCode.quoteReadiness.codeCurrent, false);
    assert.equal(noCode.quote.state, 'HELD');
  });

  it('keeps configuration and input errors explicit, and omits a quote unless requested', async () => {
    const unset = await response(storeFor(null, null), { state: 'NOT_CONFIGURED', detail: 'no desk configured' });
    assert.equal(unset.state, 'NOT_CONFIGURED');
    assert.equal(unset.quote.state, 'NOT_CONFIGURED');
    assert.equal(unset.desk, null);
    const invalid = await response(storeFor(null, null), { state: 'CONFIG_INVALID', detail: 'invalid address' });
    assert.equal(invalid.quote.state, 'CONFIG_INVALID');
    assert.equal((await response(storeFor(), STATUS, '?usd=20.001')).quote.error, 'USD_MALFORMED');
    assert.equal((await response(storeFor(), STATUS, '?usd=0')).quote.error, 'USD_ZERO');
    assert.equal((await response(storeFor(), STATUS, '')).quote, null);
  });
});

describe('every top-up invitation follows the quote evidence', () => {
  it('keeps POST key creation and unpaid API hints aligned with /api/credits across stale, changed and unread evidence', async () => {
    const prior = process.env.CURB_CREDITS;
    const key = newKey();
    const request = new Request('http://127.0.0.1/api/paid', { headers: { 'x-curb-key': key } });
    const stale = '2026-09-13T11:29:59Z';
    const sample = rate();
    const cases: [string, Store, CreditsStatus][] = [
      ['ready', storeFor(), STATUS],
      ['stale code', storeFor({ ...code(), readAt: stale }), STATUS],
      ['missing immutables', storeFor({ ...code(), immutables: [] }), STATUS],
      ['stale rate', storeFor(code(), { ...sample, at: stale, rate: { ...sample.rate, readAt: stale } }), STATUS],
      ['changed treasury', storeFor(), { state: 'CONFIGURED', config: { ...CONFIG, treasury: OTHER } }],
      ['changed token', storeFor(), { state: 'CONFIGURED', config: { ...CONFIG, token: OTHER } }],
      ['unread code store', storeFor(code(), rate(), 'credits:code'), STATUS],
      ['unread rate store', storeFor(code(), rate(), RATE_KEY), STATUS],
      ['no observation', storeFor(code(), null), STATUS],
    ];
    try {
      for (const [name, store, status] of cases) {
        assert.equal(status.state, 'CONFIGURED');
        if (status.state !== 'CONFIGURED') throw new Error('bad case');
        process.env.CURB_CREDITS = JSON.stringify({ ...status.config, network: status.config.network.id });
        const api = await response(store, status);
        const created = await newKeyResponse(status, store, NOW);
        assert.equal(created.status, 201, name); assert.equal(created.headers.get('cache-control'), 'no-store');
        const body = await created.json();
        assert.equal(isKey(body.key), true); assert.equal(body.keyHash, keyHashOf(body.key));
        assert.deepEqual(body.quoteReadiness, api.quoteReadiness, name); assert.deepEqual(body.topUp, api.topUp, name);
        const unpaid = await admit(request, store, 'journal-day', NOW);
        assert.equal(unpaid.ok, false);
        if (unpaid.ok) throw new Error('unfunded key admitted');
        assert.equal(unpaid.response.status, 402);
        const hint = await unpaid.response.json();
        assert.deepEqual(hint.quoteReadiness, api.quoteReadiness, name); assert.deepEqual(hint.topUp, api.topUp, name);
        if (name === 'ready') {
          assert.equal(api.quote.state, 'QUOTED'); assert.equal(body.topUp.desk, DESK);
          assert.equal(body.topUp.validUntil, '2026-09-13T12:25:00.000Z', 'expiry follows observation time, not the later HTTP request');
          assert.equal(hint.topUpHeld, null);
        } else {
          assert.notEqual(api.quote.state, 'QUOTED'); assert.equal(hint.topUp, null); assert.match(body.topUpHeld, /do not send/); assert.match(body.topUpHeld, /check \/api\/credits/);
        }
      }
    } finally { if (prior === undefined) delete process.env.CURB_CREDITS; else process.env.CURB_CREDITS = prior; }
  });

  it('does not withhold funded API admission when rate evidence or the pending index is unavailable', async () => {
    const prior = process.env.CURB_CREDITS;
    const key = newKey();
    const hash = keyHashOf(key);
    try {
      process.env.CURB_CREDITS = JSON.stringify({ ...CONFIG, network: CONFIG.network.id });
      const store = storeFor(null, null, 'credits:index', [{ key: topUpsRow(hash), observedAt: AT, payload: { hash, creditedCents: '2000', topUps: [] } }]);
      assert.equal((await response(store)).topUp, null);
      const admission = await admit(new Request('http://127.0.0.1/api/paid', { headers: { 'x-curb-key': key } }), store, 'journal-day', NOW);
      assert.equal(admission.ok, true);
      if (!admission.ok) throw new Error('funded key refused');
      assert.equal(admission.account.balanceCents, '2000'); assert.equal(admission.account.pendingState, 'NOT_REQUESTED');
    } finally { if (prior === undefined) delete process.env.CURB_CREDITS; else process.env.CURB_CREDITS = prior; }
  });

  it('can create a key with no configuration while withholding payment instructions', async () => {
    const body = await (await newKeyResponse({ state: 'NOT_CONFIGURED', detail: 'no desk configured' }, storeFor(null, null), NOW)).json();
    assert.equal(isKey(body.key), true); assert.equal(body.topUp, null); assert.equal(body.topUpHeld, 'no desk configured');
    assert.deepEqual(body.quoteReadiness, { codeCurrent: false, rateCurrent: false, maxReadAgeSeconds: 1800 });
  });
});
