/**
 * The distance between two prices, and the size that moves one of them.
 *
 * The desk already publishes what a share was worth when the exchange last
 * printed: an oracle answer with two ages attached. It has never published what
 * the token is worth on this chain right now, which is the other half of the
 * same sentence and the only half a holder can act on. This module is the
 * arithmetic for that half. It reads nothing; every function here is a pure
 * function of state a pool has already published, so each one can be checked
 * against a worked example in the tests rather than against a live chain.
 *
 * Three things are computed and they are not the same thing:
 *
 *   mid      the pool's current price, from `sqrtPriceX96` or from reserves.
 *            It is the price of an infinitesimal trade. Nobody trades that.
 *   bound    the size that moves the mid one percent, against the liquidity in
 *            force now. Not a fill, not a quote — see `DEPTH_IS_A_BOUND`.
 *   basis    mid minus reference, in basis points of the reference.
 *
 * The basis carries the ages of BOTH prices, always. A basis computed from a
 * forty-two-hour-old oracle answer and a one-second-old pool read is a real
 * measurement of a real gap, and it is not a mispricing — over a closed
 * weekend it is mostly the market's opinion of Monday. Publishing the number
 * without both ages beside it would be the same lie the Floor exists to
 * prevent, told with a new figure.
 */

/** Uniswap prices are held as a square root, scaled by 2^96. */
export const Q96 = 2n ** 96n;

/**
 * DEPTH IS A BOUND, NOT A QUOTE.
 *
 * For a v2 pair the reserves are the entire book, so the size below is exact
 * arithmetic over the whole pool. For v3 and v4 the pool publishes only the
 * liquidity in force at the current tick: a move that stays inside the current
 * tick range costs exactly this, and a move that leaves it meets whatever
 * liquidity was placed on the other side — which may be more, may be less, and
 * is not readable from `slot0`. So the figure is stated as what it is: the size
 * at today's tick. Every row says which of the two it is.
 */
export const DEPTH_IS_A_BOUND =
  'The size that moves the mid one percent against the liquidity in force now. For a v2 pair the reserves are the whole book and this is exact; for v3 and v4 it is the liquidity at the current tick only, and a move that leaves that tick meets liquidity this figure cannot see.';

/** Integer square root, floor. Newton's method on bigints — exact, no float. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of a negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * A price moved by one percent, as a square root. Derived by squaring, scaling
 * by 101/100, and taking the root again — so the move is exactly one percent in
 * price and there is no decimal constant to mistype.
 */
export function sqrtMovedOnePercent(sqrtPriceX96: bigint, direction: 'up' | 'down'): bigint {
  const squared = sqrtPriceX96 * sqrtPriceX96;
  return direction === 'up'
    ? isqrt((squared * 101n) / 100n)
    : isqrt((squared * 100n) / 101n);
}

export interface PoolState {
  readonly kind: 'v2' | 'v3' | 'v4';
  /** v3 and v4 only. */
  readonly sqrtPriceX96?: bigint;
  /** v3 and v4 only: the liquidity in force at the current tick. */
  readonly liquidity?: bigint;
  /** v2 only. */
  readonly reserve0?: bigint;
  readonly reserve1?: bigint;
  readonly decimals0: number;
  readonly decimals1: number;
}

/**
 * The mid as currency1 per whole currency0, in human units.
 *
 * Returned as a number because it is about to be multiplied by an oracle answer
 * that is itself a double, and pretending otherwise would be false precision.
 * The raw integers the chain returned are kept by the caller and written to the
 * record beside it, because a value rounded at write time cannot be un-rounded.
 */
export function midPrice(state: PoolState): number | null {
  const scale = 10 ** (state.decimals0 - state.decimals1);
  if (state.kind === 'v2') {
    const { reserve0, reserve1 } = state;
    if (reserve0 === undefined || reserve1 === undefined || reserve0 === 0n) return null;
    return (Number(reserve1) / Number(reserve0)) * scale;
  }
  const sqrt = state.sqrtPriceX96;
  if (sqrt === undefined || sqrt === 0n) return null;
  const ratio = Number(sqrt) / Number(Q96);
  const price = ratio * ratio * scale;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export interface DepthBound {
  /** Raw currency1 units that must go in to raise the mid one percent. */
  readonly currency1In: bigint;
  /** Raw currency0 units that must go in to lower the mid one percent. */
  readonly currency0In: bigint;
  /** True when the reserves are the whole book, so the sizes are exact. */
  readonly exact: boolean;
}

/**
 * The size that moves the mid one percent, each way.
 *
 * v3 and v4 share the same arithmetic because they hold price and liquidity the
 * same way: Δcurrency1 = L·Δ√P and Δcurrency0 = L·Δ(1/√P). v2 keeps the product
 * of its reserves constant, so a move of factor f takes reserve·(√f − 1) on the
 * side being sold into.
 *
 * Zero liquidity is not zero depth — it is a pool with no book, and the caller
 * gets null rather than a figure that reads as "free to move".
 */
export function depthToMoveOnePercent(state: PoolState): DepthBound | null {
  if (state.kind === 'v2') {
    const { reserve0, reserve1 } = state;
    if (reserve0 === undefined || reserve1 === undefined || reserve0 === 0n || reserve1 === 0n) return null;
    return {
      currency1In: isqrt((reserve1 * reserve1 * 101n) / 100n) - reserve1,
      currency0In: isqrt((reserve0 * reserve0 * 101n) / 100n) - reserve0,
      exact: true,
    };
  }
  const sqrt = state.sqrtPriceX96;
  const liquidity = state.liquidity;
  if (sqrt === undefined || liquidity === undefined || sqrt === 0n || liquidity === 0n) return null;
  const up = sqrtMovedOnePercent(sqrt, 'up');
  const down = sqrtMovedOnePercent(sqrt, 'down');
  return {
    // Δy = L · (√P' − √P), the Q96 scaling divided back out.
    currency1In: (liquidity * (up - sqrt)) / Q96,
    // Δx = L · (1/√P'' − 1/√P) = L · (√P − √P'') / (√P · √P''), scaled by Q96.
    currency0In: down === 0n ? 0n : (liquidity * Q96 * (sqrt - down)) / (sqrt * down),
    exact: false,
  };
}

/** A raw integer amount as a human number of whole units. */
export function humanUnits(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/**
 * The basis, in basis points of the reference.
 *
 * Positive means the pool is above the reference — the token is dearer on this
 * chain than the last exchange print. Which of the two is "right" is not a
 * question this function or this desk answers.
 */
export function basisBps(poolUsd: number, referenceUsd: number): number | null {
  if (!Number.isFinite(poolUsd) || !Number.isFinite(referenceUsd) || referenceUsd <= 0 || poolUsd <= 0) {
    return null;
  }
  return (poolUsd / referenceUsd - 1) * 10_000;
}

/** "+64 bp", "−73 bp", "0 bp" — signed, rounded, with the unit attached. */
export function formatBasis(bps: number): string {
  const rounded = Math.round(bps);
  if (rounded === 0) return '0 bp';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString('en-US')} bp`;
}

/**
 * Which of two pools describes the market better.
 *
 * Depth, not volume and not recency: a pool that takes more size to move is the
 * one whose mid means more, and it is the only one of the three properties that
 * can be read from published state without an indexer. Ties go to the pool that
 * is exact over the one that is tick-local, because an exact figure is a
 * stronger statement than a bound.
 */
export function deeper<T extends { readonly depthUsd: number | null; readonly exact: boolean }>(
  a: T | null,
  b: T | null,
): T | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.depthUsd === null) return b.depthUsd === null ? a : b;
  if (b.depthUsd === null) return a;
  if (a.depthUsd === b.depthUsd) return a.exact ? a : b;
  return a.depthUsd > b.depthUsd ? a : b;
}
