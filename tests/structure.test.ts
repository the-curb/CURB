import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  agreement,
  logReturns,
  MINIMUMS,
  rangePosition,
  readStructure,
  realisedVolatility,
  rsi,
  softBound,
  trendStrength,
  TREND_LIMIT,
} from '../lib/market/structure.ts';

/**
 * Every case here has an answer that can be derived without running the code:
 * a series with no dispersion has no volatility, a perfectly straight line has
 * no residuals, a series that only rises has an RSI at its ceiling. Checking the
 * implementation against its own output would prove nothing.
 */

/** 100, 101, 102.01, … — a constant ratio, so every log return is identical. */
const geometric = (n: number, ratio = 1.01, start = 100) =>
  Array.from({ length: n }, (_, i) => start * ratio ** i);

const flat = (n: number, value = 100) => Array.from({ length: n }, () => value);

describe('log returns', () => {
  it('is the log of the ratio between consecutive closes', () => {
    const [first] = logReturns([100, 110]);
    assert.ok(Math.abs(first! - Math.log(1.1)) < 1e-12);
  });

  it('drops non-positive prices instead of producing NaN', () => {
    const returns = logReturns([100, 0, 110, -5, 120]);
    assert.ok(returns.every((r) => Number.isFinite(r)));
  });

  it('produces one fewer value than it was given', () => {
    assert.equal(logReturns(geometric(10)).length, 9);
  });
});

describe('realised volatility', () => {
  it('is zero when every return is identical', () => {
    // Constant ratio ⇒ zero dispersion ⇒ zero volatility, at any annualisation.
    const vol = realisedVolatility(geometric(MINIMUMS.volatility + 2), 252);
    assert.ok(vol !== null);
    assert.ok(Math.abs(vol) < 1e-9, `expected ~0, got ${vol}`);
  });

  it('scales with the square root of the periods per year', () => {
    const noisy = [100, 102, 99, 104, 97, 105, 96, 106, 95, 107, 94, 108, 93];
    const daily = realisedVolatility(noisy, 252);
    const quarterly = realisedVolatility(noisy, 4);
    assert.ok(daily !== null && quarterly !== null);
    assert.ok(Math.abs(daily / quarterly - Math.sqrt(252 / 4)) < 1e-9);
  });

  it('declares nothing below its stated minimum', () => {
    assert.equal(realisedVolatility(geometric(MINIMUMS.volatility), 252), null);
  });
});

describe('the smooth bound', () => {
  it('passes small values through almost unchanged', () => {
    assert.ok(Math.abs(softBound(0.5, 10) - 0.5) < 0.03);
  });

  it('never returns the same output for two different inputs', () => {
    // The failure a hard cut has: two clearly different readings, one answer.
    assert.notEqual(softBound(50, 10), softBound(500, 10));
    assert.notEqual(softBound(1e6, 10), softBound(1e9, 10));
  });

  it('stays inside the limit', () => {
    for (const value of [1, 10, 100, 1e6, -1e6]) {
      assert.ok(Math.abs(softBound(value, 10)) < 10.000001);
    }
  });

  it('is symmetric about zero', () => {
    assert.equal(softBound(-7, 10), -softBound(7, 10));
  });
});

describe('trend strength', () => {
  it('reports zero for a flat series', () => {
    const trend = trendStrength(flat(20));
    assert.ok(trend !== null);
    assert.equal(trend.slope, 0);
    assert.equal(trend.strength, 0);
  });

  it('sits at the bound for a perfectly straight log-price line', () => {
    // A geometric series is exactly linear in log space: no residual dispersion,
    // so the slope stands infinitely far out of a noise floor of zero.
    const trend = trendStrength(geometric(20));
    assert.ok(trend !== null);
    assert.ok(trend.slope > 0);
    assert.ok(trend.strength > TREND_LIMIT - 0.01, `expected ~${TREND_LIMIT}, got ${trend.strength}`);
  });

  it('signs a falling series negative', () => {
    const trend = trendStrength(geometric(20, 0.99));
    assert.ok(trend !== null);
    assert.ok(trend.slope < 0);
    assert.ok(trend.strength < 0);
  });

  it('rates a clean rise above a jagged one of the same total move', () => {
    // The whole reason the figure is normalised on residuals rather than reported
    // as a raw slope: same start, same end, different reliability.
    const clean = geometric(20, 1.01);
    const jagged = clean.map((v, i) => v * (i % 2 === 0 ? 1.06 : 0.94));
    const a = trendStrength(clean);
    const b = trendStrength(jagged);
    assert.ok(a !== null && b !== null);
    assert.ok(a.strength > b.strength, `clean ${a.strength} should exceed jagged ${b.strength}`);
  });

  it('declares nothing below its stated minimum', () => {
    assert.equal(trendStrength(geometric(MINIMUMS.trend - 1)), null);
  });
});

describe('RSI', () => {
  it('is at its ceiling when nothing falls', () => {
    assert.equal(rsi(geometric(30, 1.02)), 100);
  });

  it('is at its floor when nothing rises', () => {
    assert.equal(rsi(geometric(30, 0.98)), 0);
  });

  it('is the midpoint for a flat series', () => {
    assert.equal(rsi(flat(30)), 50);
  });

  it('lands between the extremes for a mixed series', () => {
    const mixed = Array.from({ length: 40 }, (_, i) => 100 + (i % 3 === 0 ? -2 : 3));
    const value = rsi(mixed);
    assert.ok(value !== null && value > 0 && value < 100);
  });

  it('declares nothing below its stated minimum', () => {
    assert.equal(rsi(flat(15)), null);
  });
});

describe('range position', () => {
  it('is at the top when the last close is the high', () => {
    const range = rangePosition([10, 20, 30]);
    assert.deepEqual(range, { low: 10, high: 30, percent: 100 });
  });

  it('is at the bottom when the last close is the low', () => {
    assert.equal(rangePosition([30, 20, 10])?.percent, 0);
  });

  it('is halfway in the middle', () => {
    assert.equal(rangePosition([10, 30, 20])?.percent, 50);
  });

  it('answers the midpoint for a flat series rather than dividing by zero', () => {
    assert.equal(rangePosition(flat(5))?.percent, 50);
  });
});

describe('window agreement', () => {
  it('names a conflict rather than averaging it away', () => {
    assert.equal(agreement(-0.6, 4.8), 'CONFLICT');
  });

  it('recognises both windows pointing the same way', () => {
    assert.equal(agreement(0.7, 5.6), 'ALIGNED_UP');
    assert.equal(agreement(-0.7, -5.6), 'ALIGNED_DOWN');
  });

  it('is undetermined when a window could not be measured', () => {
    assert.equal(agreement(null, 4.8), 'UNDETERMINED');
    assert.equal(agreement(0, 4.8), 'UNDETERMINED');
  });
});

describe('the whole read', () => {
  it('reports what it can and leaves the rest absent', () => {
    // Long enough for a range, too short for volatility or a trend.
    const structure = readStructure([100, 105, 103], {
      shortWindow: 3,
      longWindow: 3,
      periodsPerYear: 252,
    });
    assert.equal(structure.observations, 3);
    assert.ok(structure.range !== null);
    assert.equal(structure.volatilityLong, null);
    assert.equal(structure.trendLong, null);
    assert.equal(structure.rsi14, null);
    assert.equal(structure.agreement, 'UNDETERMINED');
  });

  it('fills in once the series is long enough', () => {
    const structure = readStructure(geometric(60), {
      shortWindow: 14,
      longWindow: 60,
      periodsPerYear: 252,
    });
    assert.ok(structure.volatilityLong !== null);
    assert.ok(structure.trendLong !== null);
    assert.ok(structure.rsi14 !== null);
    assert.equal(structure.agreement, 'ALIGNED_UP');
  });
});
