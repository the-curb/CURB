import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  Q96,
  basisBps,
  depthToMoveOnePercent,
  deeper,
  formatBasis,
  humanUnits,
  isqrt,
  midPrice,
  sqrtMovedOnePercent,
} from '../lib/market/basis.ts';

/**
 * The basis is the desk's first figure that is a difference between two
 * sources rather than a reading of one, so the arithmetic is checked against
 * worked examples here rather than against a live chain. Every constant below
 * is derived in the comment beside it; none is copied from a run.
 */

/** √(price) · 2^96 for a given human price, given each side's decimals. */
function sqrtX96For(price: number, decimals0: number, decimals1: number): bigint {
  const raw = price / 10 ** (decimals0 - decimals1);
  return BigInt(Math.floor(Math.sqrt(raw) * Number(Q96)));
}

describe('isqrt', () => {
  it('is exact on squares', () => {
    for (const n of [0n, 1n, 4n, 9n, 10n ** 30n]) {
      assert.equal(isqrt(n * n), n);
    }
  });

  it('floors between squares', () => {
    assert.equal(isqrt(8n), 2n);
    assert.equal(isqrt(15n), 3n);
    assert.equal(isqrt(99n), 9n);
  });

  it('refuses a negative rather than returning something', () => {
    assert.throws(() => isqrt(-1n), RangeError);
  });
});

describe('a one percent move', () => {
  it('moves the price, not the square root, by one percent', () => {
    const sqrt = sqrtX96For(220, 18, 6);
    const up = sqrtMovedOnePercent(sqrt, 'up');
    const down = sqrtMovedOnePercent(sqrt, 'down');
    // (√P'/√P)² must be 1.01 and 1/1.01 to within integer-root rounding.
    const upRatio = (Number(up) / Number(sqrt)) ** 2;
    const downRatio = (Number(down) / Number(sqrt)) ** 2;
    assert.ok(Math.abs(upRatio - 1.01) < 1e-9, `up ratio ${upRatio}`);
    assert.ok(Math.abs(downRatio - 1 / 1.01) < 1e-9, `down ratio ${downRatio}`);
  });

  it('is not symmetric, and the down move is the smaller one', () => {
    const sqrt = sqrtX96For(220, 18, 6);
    const up = sqrtMovedOnePercent(sqrt, 'up') - sqrt;
    const down = sqrt - sqrtMovedOnePercent(sqrt, 'down');
    assert.ok(up > down, 'a multiplicative move up is larger than the move down');
  });
});

describe('the mid', () => {
  it('reads a v3 stock-token pool priced in USDG', () => {
    // NVDA is 18 decimals, USDG is 6. A mid of 220.81 USDG per NVDA.
    const state = { kind: 'v3' as const, sqrtPriceX96: sqrtX96For(220.81, 18, 6), liquidity: 1n, decimals0: 18, decimals1: 6 };
    const mid = midPrice(state);
    assert.ok(mid !== null);
    assert.ok(Math.abs(mid - 220.81) < 0.01, `mid ${mid}`);
  });

  it('reads a v2 pair from its reserves', () => {
    // 1,000 tokens (18dp) against 220,810 USDG (6dp) is 220.81 per token.
    const state = {
      kind: 'v2' as const,
      reserve0: 1_000n * 10n ** 18n,
      reserve1: 220_810n * 10n ** 6n,
      decimals0: 18,
      decimals1: 6,
    };
    const mid = midPrice(state);
    assert.ok(mid !== null);
    assert.ok(Math.abs(mid - 220.81) < 1e-6, `mid ${mid}`);
  });

  it('returns null rather than zero when a pool has never been priced', () => {
    assert.equal(midPrice({ kind: 'v4', sqrtPriceX96: 0n, liquidity: 5n, decimals0: 18, decimals1: 6 }), null);
    assert.equal(midPrice({ kind: 'v2', reserve0: 0n, reserve1: 5n, decimals0: 18, decimals1: 6 }), null);
  });
});

describe('the depth bound', () => {
  it('is exact for a v2 pair, and is the reserve times √1.01 − 1', () => {
    const reserve1 = 220_810n * 10n ** 6n;
    const bound = depthToMoveOnePercent({
      kind: 'v2',
      reserve0: 1_000n * 10n ** 18n,
      reserve1,
      decimals0: 18,
      decimals1: 6,
    });
    assert.ok(bound !== null);
    assert.equal(bound.exact, true);
    // √1.01 − 1 = 0.00498756…; 220,810 USDG × that = 1,101.3 USDG.
    const usdg = humanUnits(bound.currency1In, 6);
    assert.ok(Math.abs(usdg - 220_810 * (Math.sqrt(1.01) - 1)) < 1, `usdg ${usdg}`);
  });

  it('is tick-local for v3 and says so', () => {
    const bound = depthToMoveOnePercent({
      kind: 'v3',
      sqrtPriceX96: sqrtX96For(220.81, 18, 6),
      liquidity: 10n ** 20n,
      decimals0: 18,
      decimals1: 6,
    });
    assert.ok(bound !== null);
    assert.equal(bound.exact, false);
    assert.ok(bound.currency1In > 0n);
    assert.ok(bound.currency0In > 0n);
  });

  it('scales with liquidity: twice the book takes twice the size', () => {
    const base = { kind: 'v3' as const, sqrtPriceX96: sqrtX96For(220.81, 18, 6), decimals0: 18, decimals1: 6 };
    const one = depthToMoveOnePercent({ ...base, liquidity: 10n ** 20n });
    const two = depthToMoveOnePercent({ ...base, liquidity: 2n * 10n ** 20n });
    assert.ok(one !== null && two !== null);
    const ratio = Number(two.currency1In) / Number(one.currency1In);
    assert.ok(Math.abs(ratio - 2) < 1e-6, `ratio ${ratio}`);
  });

  it('calls a pool with no liquidity absent, never free to move', () => {
    assert.equal(depthToMoveOnePercent({ kind: 'v3', sqrtPriceX96: sqrtX96For(1, 18, 18), liquidity: 0n, decimals0: 18, decimals1: 18 }), null);
    assert.equal(depthToMoveOnePercent({ kind: 'v2', reserve0: 0n, reserve1: 0n, decimals0: 18, decimals1: 6 }), null);
  });
});

describe('the basis', () => {
  it('is signed against the reference, in basis points', () => {
    // The Floor's oracle answer for NVDA on 20 September 2026 was 222.44,
    // 42 hours old; the deepest pool mid at the same moment was 220.81.
    const bps = basisBps(220.81, 222.44);
    assert.ok(bps !== null);
    assert.ok(Math.abs(bps - -73.28) < 0.1, `bps ${bps}`);
    assert.equal(formatBasis(bps), '−73 bp');
  });

  it('is positive when the chain is dearer than the last print', () => {
    const bps = basisBps(101, 100);
    assert.ok(bps !== null);
    assert.equal(formatBasis(bps), '+100 bp');
  });

  it('refuses to divide by an absent reference', () => {
    assert.equal(basisBps(220.81, 0), null);
    assert.equal(basisBps(220.81, Number.NaN), null);
    assert.equal(basisBps(0, 222.44), null);
  });

  it('prints an unsigned zero without a sign', () => {
    assert.equal(formatBasis(0.2), '0 bp');
  });
});

describe('choosing which pool describes the market', () => {
  const pool = (depthUsd: number | null, exact: boolean, tag: string) => ({ depthUsd, exact, tag });

  it('takes the deeper of two', () => {
    assert.equal(deeper(pool(1_000, false, 'a'), pool(5_000, false, 'b'))?.tag, 'b');
  });

  it('prefers an exact figure to a bound when they are equal', () => {
    assert.equal(deeper(pool(1_000, false, 'tick'), pool(1_000, true, 'reserves'))?.tag, 'reserves');
  });

  it('treats an unmeasured depth as weaker than a measured one', () => {
    assert.equal(deeper(pool(null, true, 'unmeasured'), pool(1, false, 'measured'))?.tag, 'measured');
    assert.equal(deeper(pool(null, true, 'a'), pool(null, false, 'b'))?.tag, 'a');
  });

  it('survives having nothing to choose from', () => {
    assert.equal(deeper(null, null), null);
    assert.equal(deeper(null, pool(1, true, 'only'))?.tag, 'only');
  });
});
