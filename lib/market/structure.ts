/**
 * Market structure, computed in code from a price series.
 *
 * This module is pure: no I/O, no clock, no model. Given the same series it
 * returns the same numbers, which is the only reason any of them can be compared
 * across time. A figure a language model produced twice with different values is
 * not a measurement, it is a mood.
 *
 * Every function returns `null` rather than a number when the series is too
 * short. Coverage before conclusion, enforced at the level where the arithmetic
 * happens rather than remembered by each caller.
 */

/** Minimum observations each figure needs before it means anything. */
export const MINIMUMS = {
  /** Two returns is the fewest that has a dispersion at all; ten is the fewest
   *  where that dispersion is not mostly an artefact of the sample. */
  volatility: 11,
  /** A slope through fewer than four points is a line through noise. */
  trend: 8,
  /** Wilder's RSI needs one seed window plus a step. */
  rsi: 16,
  range: 3,
} as const;

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n-1). The population form flatters short series. */
function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Log returns. Non-positive prices are dropped rather than producing NaN. */
export function logReturns(closes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const previous = closes[i - 1]!;
    const current = closes[i]!;
    if (previous <= 0 || current <= 0) continue;
    out.push(Math.log(current / previous));
  }
  return out;
}

/**
 * Realised volatility, annualised, as a percentage.
 *
 * `periodsPerYear` is how many observations a year holds at this sampling rate —
 * 252 for daily closes, 35,040 for quarter-hourly. Getting it wrong scales the
 * answer by its square root, so it is a required argument rather than a default.
 */
export function realisedVolatility(
  closes: readonly number[],
  periodsPerYear: number,
): number | null {
  const returns = logReturns(closes);
  if (returns.length < MINIMUMS.volatility) return null;
  return stdev(returns) * Math.sqrt(periodsPerYear) * 100;
}

/**
 * A bound that does not destroy information.
 *
 * A hard cut returns the same value for two clearly different readings, and does
 * it precisely where the signal is strongest. This is smooth: injective, so two
 * different inputs never produce the same output; asymptotic to ±limit; and for
 * small inputs it passes through almost unchanged.
 */
export function softBound(value: number, limit: number): number {
  if (!Number.isFinite(value)) return value > 0 ? limit : -limit;
  return value / (1 + Math.abs(value) / limit);
}

export const TREND_LIMIT = 10;

export interface TrendStrength {
  /** OLS slope of log price against index. Direction, in log units per period. */
  readonly slope: number;
  /** Slope divided by its own standard error: how far it stands out of the noise. */
  readonly tStatistic: number;
  /** The reported figure: the t-statistic, smoothly bounded. */
  readonly strength: number;
  readonly observations: number;
}

/**
 * Trend strength, normalised on the dispersion of the residuals rather than
 * reported as a raw slope.
 *
 * Two series that rise by the same amount — one clean, one jagged — have the
 * same slope and very different reliability. The sign is the direction; the
 * magnitude is how far the move stands out of the noise.
 */
export function trendStrength(closes: readonly number[]): TrendStrength | null {
  const usable = closes.filter((c) => c > 0);
  const n = usable.length;
  if (n < MINIMUMS.trend) return null;

  const y = usable.map((c) => Math.log(c));
  const xMean = (n - 1) / 2;
  const yMean = mean(y);

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (i - xMean) * (y[i]! - yMean);
    sxx += (i - xMean) ** 2;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;

  let residualSumSquares = 0;
  for (let i = 0; i < n; i += 1) {
    residualSumSquares += (y[i]! - (intercept + slope * i)) ** 2;
  }

  // A perfect fit has no residual dispersion, so the t-statistic is unbounded.
  // That is a real reading, not an error: report it at the bound rather than
  // dividing by zero and shipping NaN.
  if (residualSumSquares === 0) {
    const sign = slope === 0 ? 0 : Math.sign(slope);
    return { slope, tStatistic: sign * Infinity, strength: sign * TREND_LIMIT, observations: n };
  }

  const residualVariance = residualSumSquares / (n - 2);
  const slopeStandardError = Math.sqrt(residualVariance / sxx);
  const tStatistic = slope / slopeStandardError;

  return {
    slope,
    tStatistic,
    strength: softBound(tStatistic, TREND_LIMIT),
    observations: n,
  };
}

/**
 * Wilder's RSI. The smoothing is the original recursive form, not a simple
 * moving average of gains — they diverge, and the difference is not small.
 */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (closes.length < period + 2) return null;

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i]! - closes[i - 1]!;
    gains.push(Math.max(0, change));
    losses.push(Math.max(0, -change));
  }
  if (gains.length < period) return null;

  let averageGain = mean(gains.slice(0, period));
  let averageLoss = mean(losses.slice(0, period));

  for (let i = period; i < gains.length; i += 1) {
    averageGain = (averageGain * (period - 1) + gains[i]!) / period;
    averageLoss = (averageLoss * (period - 1) + losses[i]!) / period;
  }

  // No losses at all: the index is at its ceiling. This is defined, not an error.
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

export interface RangePosition {
  readonly low: number;
  readonly high: number;
  /** Where the last close sits in the range, 0 at the low and 100 at the high. */
  readonly percent: number;
}

export function rangePosition(closes: readonly number[]): RangePosition | null {
  if (closes.length < MINIMUMS.range) return null;
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const last = closes[closes.length - 1]!;
  // A flat series has no range to be positioned within. Midpoint is the only
  // honest answer, and it is stated rather than derived from a division by zero.
  if (high === low) return { low, high, percent: 50 };
  return { low, high, percent: ((last - low) / (high - low)) * 100 };
}

export type Agreement = 'ALIGNED_UP' | 'ALIGNED_DOWN' | 'CONFLICT' | 'UNDETERMINED';

/**
 * Whether two horizons say the same thing. A conflict is a finding, not a
 * failure — it is the most useful thing this module produces, because it is the
 * state a single-window reading hides.
 */
export function agreement(shortTrend: number | null, longTrend: number | null): Agreement {
  if (shortTrend === null || longTrend === null) return 'UNDETERMINED';
  if (shortTrend === 0 || longTrend === 0) return 'UNDETERMINED';
  if (shortTrend > 0 && longTrend > 0) return 'ALIGNED_UP';
  if (shortTrend < 0 && longTrend < 0) return 'ALIGNED_DOWN';
  return 'CONFLICT';
}

export interface Structure {
  readonly observations: number;
  readonly last: number | null;
  readonly volatilityShort: number | null;
  readonly volatilityLong: number | null;
  readonly trendShort: TrendStrength | null;
  readonly trendLong: TrendStrength | null;
  readonly rsi14: number | null;
  readonly range: RangePosition | null;
  readonly agreement: Agreement;
}

/**
 * The whole read, over two windows. Every field is independently nullable: a
 * series long enough for a range but too short for volatility reports the range
 * and an absence, not a plausible-looking number.
 */
export function readStructure(
  closes: readonly number[],
  options: { shortWindow: number; longWindow: number; periodsPerYear: number },
): Structure {
  const short = closes.slice(-options.shortWindow);
  const long = closes.slice(-options.longWindow);
  const trendShort = trendStrength(short);
  const trendLong = trendStrength(long);

  return {
    observations: closes.length,
    last: closes.length > 0 ? closes[closes.length - 1]! : null,
    volatilityShort: realisedVolatility(short, options.periodsPerYear),
    volatilityLong: realisedVolatility(long, options.periodsPerYear),
    trendShort,
    trendLong,
    rsi14: rsi(long, 14),
    range: rangePosition(long),
    agreement: agreement(trendShort?.strength ?? null, trendLong?.strength ?? null),
  };
}
