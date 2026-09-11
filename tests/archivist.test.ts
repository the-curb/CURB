import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { judgeToken, priorOf, tokenSnapshot, type TokenRead } from '../lib/agents/producers/archivist.ts';
import { AGENT_BY_ID } from '../lib/agents/registry.ts';
import { STOCK_TOKENS } from '../lib/chain/stock-tokens.ts';
import { TOKENS } from '../lib/chain/tokens.ts';
import { MULTIPLIER_SCALE } from '../lib/chain/oracle.ts';
import { readNow, unread, type Reading } from '../lib/doctrine/reading.ts';

const NOW = new Date('2026-09-11T18:00:00.000Z');
const AT = NOW.toISOString();
const ONE = MULTIPLIER_SCALE;
const AAPL = STOCK_TOKENS.find((t) => t.ticker === 'AAPL')!;

function ok<T>(value: T): Reading<T> {
  // Taken now: a fixed retrievedAt would age against the real clock and turn UNREAD.
  return readNow(value, 'test');
}
function readOf(over: Partial<TokenRead> = {}): TokenRead {
  return {
    token: AAPL,
    multiplier: ok(ONE),
    next: ok(ONE),
    effectiveAt: ok(0n),
    supply: ok(1000n * 10n ** 18n),
    decimals: ok(18),
    ...over,
  };
}

describe('the registry entry', () => {
  it('declares exactly what the producer asks', () => {
    assert.equal(AGENT_BY_ID.archivist.sourcesExpected, STOCK_TOKENS.length + TOKENS.length);
    assert.ok(AGENT_BY_ID.archivist.minimumSources >= STOCK_TOKENS.length / 2);
  });
});

describe('judgeToken', () => {
  it('reads a multiplier of one with nothing pending and nothing prior', () => {
    const v = judgeToken(readOf(), null, NOW);
    assert.equal(v.multiplier, ONE);
    assert.equal(v.shown, '1.000000');
    assert.equal(v.movedFrom, null);
    assert.equal(v.pending, null);
    assert.equal(v.unreadBecause, null);
  });

  it('reports a move against the prior snapshot, with the prior value', () => {
    const four = 4n * ONE;
    const v = judgeToken(readOf({ multiplier: ok(four) }), { multiplierRaw: ONE.toString(), supplyRaw: null }, NOW);
    assert.equal(v.movedFrom, ONE);
    assert.equal(v.shown, '4.000000');
  });

  it('does not call an unchanged multiplier a move', () => {
    const v = judgeToken(readOf(), { multiplierRaw: ONE.toString(), supplyRaw: null }, NOW);
    assert.equal(v.movedFrom, null);
  });

  it('calls a staged change pending only while its effective time is ahead', () => {
    const next = ONE + 10n ** 15n;
    const ahead = BigInt(Math.floor(NOW.getTime() / 1000) + 3600);
    const behind = BigInt(Math.floor(NOW.getTime() / 1000) - 3600);
    const pending = judgeToken(readOf({ next: ok(next), effectiveAt: ok(ahead) }), null, NOW);
    assert.deepEqual(pending.pending, { next, effectiveAt: new Date(Number(ahead) * 1000) });
    // The contract keeps both fields equal after a change applies; a differing
    // value with a past effective time is history, not a pending action.
    const past = judgeToken(readOf({ next: ok(next), effectiveAt: ok(behind) }), null, NOW);
    assert.equal(past.pending, null);
    // No effective time at all is still pending: the value is staged.
    const untimed = judgeToken(readOf({ next: ok(next), effectiveAt: ok(0n) }), null, NOW);
    assert.deepEqual(untimed.pending, { next, effectiveAt: null });
  });

  it('reports supply movement direction against the prior snapshot', () => {
    const prior = { multiplierRaw: ONE.toString(), supplyRaw: (900n * 10n ** 18n).toString() };
    assert.equal(judgeToken(readOf(), prior, NOW).supplyMoved, 'ISSUED');
    const less = readOf({ supply: ok(800n * 10n ** 18n) });
    assert.equal(judgeToken(less, prior, NOW).supplyMoved, 'REDEEMED');
    assert.equal(judgeToken(readOf(), { ...prior, supplyRaw: (1000n * 10n ** 18n).toString() }, NOW).supplyMoved, null);
  });

  it('reports an unread multiplier as an absence with its reason, never as one', () => {
    const v = judgeToken(readOf({ multiplier: unread('SOURCE_TIMEOUT', { source: 't', detail: 'slow' }) }), null, NOW);
    assert.equal(v.multiplier, null);
    assert.equal(v.shown, null);
    assert.match(v.unreadBecause ?? '', /SOURCE_TIMEOUT — slow/);
    // Supply, read separately, is still kept.
    assert.equal(v.supply, 1000n * 10n ** 18n);
  });
});

describe('the token snapshot', () => {
  it('records the exact multiplier and round-trips into a prior', () => {
    const value = ONE + 566080061092436n; // AAPL at capture
    const v = judgeToken(readOf({ multiplier: ok(value) }), null, NOW);
    const snap = tokenSnapshot(v, AT);
    assert.equal(snap.key, 'token:rh-aapl');
    assert.equal(snap.payload.multiplier, '1.000566080061092436');
    assert.equal(snap.payload.multiplierRaw, value.toString());
    const prior = priorOf(snap);
    assert.deepEqual(prior, { multiplierRaw: value.toString(), supplyRaw: (1000n * 10n ** 18n).toString() });
  });

  it('yields no prior from a snapshot that recorded an absence', () => {
    const v = judgeToken(readOf({ multiplier: unread('SOURCE_TIMEOUT', { source: 't' }) }), null, NOW);
    assert.equal(priorOf(tokenSnapshot(v, AT)), null);
    assert.equal(priorOf(undefined), null);
  });
});
