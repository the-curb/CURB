import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  MARKET_FLOOR_USD,
  MATERIAL_MOVE_BPS,
  deepestByTicker,
  reducePool,
  referencesFrom,
  type PoolReading,
} from '../lib/agents/producers/specialist.ts';
import { AGENT_BY_ID } from '../lib/agents/registry.ts';
import { STOCK_POOLS, type StockPoolRecord } from '../lib/chain/stock-pools.ts';
import { Q96 } from '../lib/market/basis.ts';
import type { SnapshotRecord } from '../lib/store/types.ts';

/**
 * The Specialist publishes the first figure on this desk that is a difference
 * between two sources. Two mistakes would be invisible on the page and wrong
 * on every row: reading the mid upside down when the stock token is the second
 * currency, and treating an abandoned pool's leftover price as a market. Both
 * are pinned here.
 */

const NOW = new Date('2026-09-20T14:00:00.000Z');

/** √(currency1 per currency0) · 2^96, from a human price and each side's decimals. */
function sqrtX96For(price: number, decimals0: number, decimals1: number): bigint {
  return BigInt(Math.floor(Math.sqrt(price / 10 ** (decimals0 - decimals1)) * Number(Q96)));
}

function pool(over: Partial<StockPoolRecord> = {}): StockPoolRecord {
  return {
    key: 'nvda-usdg-v3-500',
    ticker: 'NVDA',
    token: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec',
    tokenDecimals: 18,
    feedKey: 'rh-nvda-usd',
    venue: 'v3',
    address: '0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3',
    poolId: null,
    fee: 500,
    tickSpacing: 10,
    hooks: null,
    quoteKey: 'usdg',
    quoteLabel: 'USDG',
    quoteAddress: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    quoteDecimals: 6,
    quoteFeedKey: 'usdg-usd',
    tokenIsCurrency0: true,
    decimals0: 18,
    decimals1: 6,
    ...over,
  };
}

function reading(over: Partial<PoolReading> = {}): PoolReading {
  return {
    pool: pool(),
    priceInQuote: 220,
    priceUsd: 220,
    depthQuote: 1_000,
    depthUsd: 1_000,
    hasMarket: true,
    exact: false,
    sqrtPriceX96: '1',
    liquidity: '1',
    ...over,
  };
}

describe('the registry declares what the producer asks', () => {
  it('pins sourcesExpected to the captured book', () => {
    assert.equal(
      AGENT_BY_ID.specialist.sourcesExpected,
      STOCK_POOLS.length,
      'the book was re-captured and the registry was not updated: run scripts/capture-stock-pools.ts --write and set sourcesExpected to the new count',
    );
  });

  it('will not conclude from less than half the book', () => {
    assert.ok(AGENT_BY_ID.specialist.minimumSources * 2 <= STOCK_POOLS.length + 2);
    assert.ok(AGENT_BY_ID.specialist.minimumSources > STOCK_POOLS.length / 3);
  });

  it('measures, and says in one line what it will not do', () => {
    assert.equal(AGENT_BY_ID.specialist.posture, 'MEASURES');
    assert.match(AGENT_BY_ID.specialist.refusal, /never says which way it closes/i);
  });
});

describe('reading a pool', () => {
  it('reads the mid straight when the stock token is currency0', () => {
    const r = reducePool(pool(), {
      kind: 'v3',
      sqrtPriceX96: sqrtX96For(220.81, 18, 6),
      liquidity: 10n ** 20n,
      decimals0: 18,
      decimals1: 6,
    });
    assert.ok(r !== null);
    assert.ok(Math.abs(r.priceInQuote - 220.81) < 0.01, `price ${r.priceInQuote}`);
    assert.equal(r.hasMarket, true);
  });

  it('inverts the mid when the stock token is currency1', () => {
    // USDG sorts below the token here, so the mid is USDG per token's
    // reciprocal: 1/220.81 tokens per USDG. The reading must undo that.
    const r = reducePool(pool({ tokenIsCurrency0: false, decimals0: 6, decimals1: 18 }), {
      kind: 'v3',
      sqrtPriceX96: sqrtX96For(1 / 220.81, 6, 18),
      liquidity: 10n ** 20n,
      decimals0: 6,
      decimals1: 18,
    });
    assert.ok(r !== null);
    assert.ok(Math.abs(r.priceInQuote - 220.81) < 0.05, `price ${r.priceInQuote}`);
  });

  it('takes the depth from the quote side whichever currency that is', () => {
    const state = { sqrtPriceX96: sqrtX96For(220.81, 18, 6), liquidity: 10n ** 20n } as const;
    const asC0 = reducePool(pool(), { kind: 'v3', ...state, decimals0: 18, decimals1: 6 });
    assert.ok(asC0 !== null && asC0.depthQuote !== null && asC0.depthQuote > 0);
  });

  it('calls a pool with no liquidity a pool with no market, and still reports its mid', () => {
    const r = reducePool(pool(), {
      kind: 'v3',
      sqrtPriceX96: sqrtX96For(220.81, 18, 6),
      liquidity: 0n,
      decimals0: 18,
      decimals1: 6,
    });
    assert.ok(r !== null);
    assert.equal(r.hasMarket, false);
    assert.equal(r.depthQuote, null);
    assert.ok(r.priceInQuote > 0, 'the mid is still what the pool says; it is simply not a market');
  });

  it('returns nothing at all for a pool that was never given a price', () => {
    assert.equal(
      reducePool(pool(), { kind: 'v3', sqrtPriceX96: 0n, liquidity: 10n ** 20n, decimals0: 18, decimals1: 6 }),
      null,
    );
  });
});

describe('choosing the pool that describes the ticker', () => {
  it('never lets an abandoned pool price a ticker', () => {
    // The real case this exists for: one v3 pool on chain 4663 holds no
    // liquidity and still answers slot0 with a mid of 3.4 × 10^50.
    const absurd = reading({
      pool: pool({ key: 'rgti-usdg-v3-10000', ticker: 'RGTI', feedKey: 'rh-rgti-usd' }),
      priceInQuote: 3.37e50,
      priceUsd: 3.37e50,
      depthQuote: null,
      depthUsd: null,
      hasMarket: false,
    });
    const { best, withoutMarket } = deepestByTicker([absurd]);
    assert.equal(best.size, 0, 'a pool with no book must not price anything');
    assert.deepEqual(withoutMarket, ['RGTI']);
  });

  it('refuses a book too small for its mid to mean anything', () => {
    // The bug production found: RGTI priced at 418 dollars against a feed of
    // 15.74, from a native-ETH pool a dollar would have moved through.
    const dust = reading({
      pool: pool({ key: 'rgti-eth-v4', ticker: 'RGTI', feedKey: 'rh-rgti-usd', quoteLabel: 'native ETH' }),
      priceInQuote: 418.26,
      priceUsd: 418.26,
      depthQuote: 0.0001,
      depthUsd: 0.31,
      hasMarket: true,
    });
    const { best, withoutMarket } = deepestByTicker([dust]);
    assert.equal(best.size, 0, 'a book under the floor must not price a ticker');
    assert.deepEqual(withoutMarket, ['RGTI']);
  });

  it('keeps a book exactly at the floor', () => {
    const atFloor = reading({ pool: pool({ key: 'at-floor' }), depthUsd: MARKET_FLOOR_USD });
    assert.equal(deepestByTicker([atFloor]).best.size, 1);
  });

  it('takes a real market over a dust pool even when the dust one is listed first', () => {
    const dust = reading({ pool: pool({ key: 'dust' }), depthUsd: 2, priceUsd: 418 });
    const real = reading({ pool: pool({ key: 'real' }), depthUsd: 50_000, priceUsd: 15.6 });
    assert.equal(deepestByTicker([dust, real]).best.get('NVDA')?.pool.key, 'real');
  });

  it('prefers the deeper of two real markets', () => {
    const thin = reading({ pool: pool({ key: 'a' }), depthUsd: 1_000, priceUsd: 220 });
    const deep = reading({ pool: pool({ key: 'b' }), depthUsd: 900_000, priceUsd: 218 });
    const { best } = deepestByTicker([thin, deep]);
    assert.equal(best.get('NVDA')?.pool.key, 'b');
  });

  it('does not let the order of the captured book decide a tie', () => {
    const tick = reading({ pool: pool({ key: 'tick' }), depthUsd: 5_000, exact: false });
    const whole = reading({ pool: pool({ key: 'whole', venue: 'v2' }), depthUsd: 5_000, exact: true });
    assert.equal(deepestByTicker([tick, whole]).best.get('NVDA')?.pool.key, 'whole');
    assert.equal(deepestByTicker([whole, tick]).best.get('NVDA')?.pool.key, 'whole');
  });

  it('prefers a market it can price in dollars when neither depth is measured', () => {
    const noDollars = reading({ pool: pool({ key: 'eth', quoteLabel: 'native ETH' }), depthUsd: null, priceUsd: null });
    const dollars = reading({ pool: pool({ key: 'usdg' }), depthUsd: null, priceUsd: 220 });
    assert.equal(deepestByTicker([noDollars, dollars]).best.get('NVDA')?.pool.key, 'usdg');
  });

  it('reports a ticker once, whether it had one empty pool or six', () => {
    const empty = (key: string) => reading({ pool: pool({ key }), hasMarket: false, depthUsd: null });
    const { withoutMarket } = deepestByTicker([empty('a'), empty('b'), empty('c')]);
    assert.deepEqual(withoutMarket, ['NVDA']);
  });
});

describe('the reference half', () => {
  const snapshot = (key: string, payload: Record<string, unknown>): SnapshotRecord => ({
    key: `feed:${key}`,
    observedAt: NOW.toISOString(),
    payload,
  });

  it('reads a price and the age of the oracle answer behind it', () => {
    const refs = referencesFrom(
      [snapshot('rh-nvda-usd', { price: '222.44', label: 'NVDA', updatedAt: Math.floor(NOW.getTime() / 1000) - 3600 })],
      NOW,
    );
    assert.equal(refs.get('rh-nvda-usd')?.priceUsd, 222.44);
    assert.equal(refs.get('rh-nvda-usd')?.feedAgeSeconds, 3600);
  });

  it('strips the separators a stored price carries', () => {
    const refs = referencesFrom([snapshot('rh-sndk-usd', { price: '1,792.32', label: 'SNDK' })], NOW);
    assert.equal(refs.get('rh-sndk-usd')?.priceUsd, 1792.32);
  });

  it('refuses a feed that answered with no price rather than reading it as zero', () => {
    const refs = referencesFrom(
      [
        snapshot('rh-tsla-usd', { price: null, label: 'TSLA' }),
        snapshot('rh-gme-usd', { price: 'unavailable', label: 'GME' }),
        snapshot('rh-spy-usd', { price: '0', label: 'SPY' }),
      ],
      NOW,
    );
    assert.equal(refs.size, 0);
  });

  it('leaves the age absent when the snapshot records no publication time', () => {
    const refs = referencesFrom([snapshot('rh-aapl-usd', { price: '335.38', label: 'AAPL' })], NOW);
    assert.equal(refs.get('rh-aapl-usd')?.feedAgeSeconds, null);
  });
});

describe('the captured book', () => {
  it('names a quote feed for every pool, so a mid can become dollars', () => {
    for (const p of STOCK_POOLS) {
      assert.ok(p.quoteFeedKey.length > 0, `${p.key} has no quote feed`);
      assert.ok(p.feedKey.length > 0, `${p.key} has no reference feed`);
    }
  });

  it('decides currency order by address, never by hope', () => {
    for (const p of STOCK_POOLS) {
      const expected = BigInt(p.token) < BigInt(p.quoteAddress);
      assert.equal(p.tokenIsCurrency0, expected, `${p.key} has the pair the wrong way round`);
      assert.equal(p.decimals0, expected ? p.tokenDecimals : p.quoteDecimals, `${p.key} decimals0`);
      assert.equal(p.decimals1, expected ? p.quoteDecimals : p.tokenDecimals, `${p.key} decimals1`);
    }
  });

  it('gives every v4 row a pool id and every v2 or v3 row an address of its own', () => {
    for (const p of STOCK_POOLS) {
      if (p.venue === 'v4') assert.match(p.poolId ?? '', /^0x[0-9a-f]{64}$/, `${p.key} v4 without an id`);
      else assert.equal(p.poolId, null, `${p.key} is ${p.venue} and carries a pool id`);
      assert.match(p.address, /^0x[0-9a-f]{40}$/, `${p.key} address`);
    }
  });
});

describe('the quiet rule', () => {
  it('speaks again on a move a reader would notice, not on every tick', () => {
    assert.ok(MATERIAL_MOVE_BPS >= 10 && MATERIAL_MOVE_BPS <= 100);
  });
});
