/**
 * THE SPECIALIST — the other half of the price.
 *
 * The desk has always published what a share was worth when the exchange last
 * printed: an oracle answer with two ages attached. It has never published what
 * the token is worth on this chain right now. That is the half a holder can act
 * on, and its absence was the quiet hole in a masthead that reads "every price
 * with its age" — the one price the desk did not carry was the live one.
 *
 * This agent reads the pools the factories admit to, computes the mid and the
 * size that moves it one percent, and prints the distance between that mid and
 * the Pillar's feed answer for the same ticker. It never says the distance is
 * wide or narrow, cheap or dear, and never says which way it closes. On a
 * closed weekend most of that distance is not a mispricing at all — it is the
 * chain's opinion of Monday, formed with no exchange to check it against, and
 * the run says the market was shut rather than leaving a reader to assume.
 *
 * Why the reference is the Pillar's snapshot and not a fresh read of the feed:
 * the basis has to be the distance between what the Floor shows and what the
 * pool says. Two agents reading the same oracle a minute apart would publish
 * two numbers both claiming to be the reference, and the difference between
 * them would be nobody's measurement. Reading the Pillar's own record means an
 * unread feed makes an unread basis, which is the correct answer.
 *
 * What it refuses is named in the registry and enforced in policy: it publishes
 * a bound computed from published state, not a quote, because a fill is an
 * execution question and no agent on this desk answers those.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import { figuresIn, type DeclaredFigure } from '../../doctrine/policy.ts';
import type { ObservationRecord, SnapshotRecord } from '../../store/types.ts';
import { isRead, type Reading } from '../../doctrine/reading.ts';
import { activeNetwork } from '../../chain/networks.ts';
import { readHead } from '../../chain/rpc.ts';
import { readMany, type Call } from '../../chain/multicall.ts';
import { decodeUint, words } from '../../chain/abi.ts';
import { selector } from '../../chain/keccak.ts';
import { STOCK_POOLS, STOCK_POOLS_SOURCE, type StockPoolRecord } from '../../chain/stock-pools.ts';
import { VENUES } from '../../chain/venues.ts';
import { readSession } from '../../market/session.ts';
import {
  basisBps,
  depthToMoveOnePercent,
  formatBasis,
  humanUnits,
  midPrice,
  type PoolState,
} from '../../market/basis.ts';

const INTERVAL = 15 * 60;

/**
 * The same cadence as the Pillar, on purpose. A basis is a difference between
 * two reads; reading one side four times as often does not make the pair
 * fresher, it only makes the pair's age harder to state honestly.
 */
export const SPECIALIST_INTERVAL_SECONDS = INTERVAL;

/** A filing is worth making when a basis has moved this far since the last one. */
export const MATERIAL_MOVE_BPS = 25;

/**
 * Where the agent keeps what it last said, under its own id.
 *
 * Compared against the last FILING rather than the last run, on purpose: a
 * basis that drifts twenty-four points every run would never be spoken of
 * again if each run only looked one run back.
 */
export const LAST_FILING_KEY = 'specialist:last-filing';

/** How many tickers the narration names. The rest are a count. */
const NAMED = 6;

/**
 * The floor under which a pool is not a market.
 *
 * Zero liquidity was never the whole problem. A pool holding a few cents of
 * liquidity publishes a mid and a computable bound, and that mid is noise: the
 * first production run put RGTI on the board at 418 dollars against a feed of
 * 15.74 — two hundred and fifty thousand basis points — from a pool a dollar
 * would have moved through. A book that cannot absorb one hundred dollars
 * without moving one percent is not a price anybody could act on, and stating a
 * difference against it would be arithmetic dressed as a measurement.
 *
 * A hundred dollars is a declaration, not a discovery. It is published here and
 * on the page for the same reason the bands are: so a reader knows the line.
 */
export const MARKET_FLOOR_USD = 100;

const SEL = {
  slot0: selector('slot0()'),
  liquidity: selector('liquidity()'),
  getReserves: selector('getReserves()'),
  getSlot0: selector('getSlot0(bytes32)'),
  getLiquidity: selector('getLiquidity(bytes32)'),
} as const;

const bytes32 = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const body = (sel: string) => sel.replace(/^0x/, '');

/** One pool, read and reduced to the three things a reader needs. */
export interface PoolReading {
  readonly pool: StockPoolRecord;
  /** The token's price in its quote asset. */
  readonly priceInQuote: number;
  readonly priceUsd: number | null;
  /** Quote-asset notional that moves the token's price up one percent. */
  readonly depthQuote: number | null;
  readonly depthUsd: number | null;
  /**
   * False when no size could be computed, which means no liquidity is in force.
   *
   * A pool with an empty book still answers `slot0` with a price: whatever it
   * was initialised at, or wherever the last trade left it before the liquidity
   * went. That number is a memory, not a market, and it can be absurd — one
   * abandoned v3 pool on this chain still reports a mid of 3.4 × 10^50. A mid
   * from a book nobody can trade against is never published as the ticker's
   * price; the ticker goes unpriced with the reason instead.
   */
  readonly hasMarket: boolean;
  /** True when the reserves are the whole book. */
  readonly exact: boolean;
  readonly sqrtPriceX96: string | null;
  readonly liquidity: string | null;
}

/**
 * A pool's state reduced to a price and a depth, in quote units.
 *
 * `tokenIsCurrency0` decides whether the mid is the token's price or its
 * reciprocal, and which side of the depth bound is the quote side. Getting it
 * backwards would invert every figure here, so it is read from the captured
 * record rather than inferred at run time.
 */
export function reducePool(pool: StockPoolRecord, state: PoolState): Omit<PoolReading, 'pool' | 'priceUsd' | 'depthUsd'> | null {
  const mid = midPrice(state);
  if (mid === null || mid <= 0) return null;
  const priceInQuote = pool.tokenIsCurrency0 ? mid : 1 / mid;
  if (!Number.isFinite(priceInQuote) || priceInQuote <= 0) return null;

  const bound = depthToMoveOnePercent(state);
  // The quote side is whichever currency is not the stock token; putting that
  // amount in is what moves the token's own price up one percent either way.
  const quoteRaw = bound === null ? null : pool.tokenIsCurrency0 ? bound.currency1In : bound.currency0In;
  const depthQuote = quoteRaw === null || quoteRaw <= 0n ? null : humanUnits(quoteRaw, pool.quoteDecimals);

  return {
    priceInQuote,
    depthQuote,
    hasMarket: depthQuote !== null,
    exact: bound?.exact ?? false,
    sqrtPriceX96: state.sqrtPriceX96 === undefined ? null : state.sqrtPriceX96.toString(),
    liquidity: state.liquidity === undefined ? null : state.liquidity.toString(),
  };
}

/** The Pillar's feed snapshots, reduced to what a basis needs from them. */
export interface Reference {
  readonly priceUsd: number;
  readonly feedAgeSeconds: number | null;
  readonly label: string;
  readonly pauseFlag: string | null;
}

export function referencesFrom(snapshots: readonly SnapshotRecord[], now: Date): Map<string, Reference> {
  const out = new Map<string, Reference>();
  for (const s of snapshots) {
    if (!s.key.startsWith('feed:')) continue;
    const p = s.payload;
    const raw = typeof p.price === 'string' ? Number(p.price.replace(/,/g, '')) : null;
    if (raw === null || !Number.isFinite(raw) || raw <= 0) continue;
    const updatedAt = typeof p.updatedAt === 'number' ? p.updatedAt : null;
    out.set(s.key.replace(/^feed:/, ''), {
      priceUsd: raw,
      feedAgeSeconds: updatedAt === null ? null : Math.max(0, Math.round(now.getTime() / 1000 - updatedAt)),
      label: typeof p.label === 'string' ? p.label : s.key,
      pauseFlag: typeof p.pauseFlag === 'string' ? p.pauseFlag : null,
    });
  }
  return out;
}

/**
 * The pool that describes each ticker's market best, and the tickers that have
 * no market at all.
 *
 * Only a pool with liquidity in force is eligible. That filter is the whole
 * point: an abandoned pool answers with a price, and ranking on depth alone
 * would still hand the ticker to it whenever every candidate was empty. Among
 * eligible pools, depth decides — a pool that takes more size to move is the
 * one whose mid means more — and a measured depth beats an unmeasured one so a
 * quote asset the Pillar has not read yet cannot win by default.
 *
 * `withoutMarket` holds the tickers that answered from every pool they have and
 * had liquidity in none of them. They are named in the filing rather than
 * quietly dropped, because "no market" and "not read" are different facts.
 */
export function deepestByTicker(readings: readonly PoolReading[]): {
  readonly best: Map<string, PoolReading>;
  readonly withoutMarket: readonly string[];
} {
  const best = new Map<string, PoolReading>();
  const seen = new Set<string>();
  const better = (candidate: PoolReading, held: PoolReading): boolean => {
    const a = held.depthUsd;
    const b = candidate.depthUsd;
    if (a === null && b === null) return held.priceUsd === null && candidate.priceUsd !== null;
    if (a === null) return true;
    if (b === null) return false;
    if (b > a) return true;
    if (b < a) return false;
    return candidate.exact && !held.exact;
  };
  for (const r of readings) {
    seen.add(r.pool.ticker);
    // Not a market: no liquidity in force, or a book too small for its mid to
    // mean anything. Both are recorded on the ticker and neither prices it.
    if (!r.hasMarket) continue;
    if (r.depthUsd !== null && r.depthUsd < MARKET_FLOOR_USD) continue;
    const held = best.get(r.pool.ticker);
    if (held === undefined || better(r, held)) best.set(r.pool.ticker, r);
  }
  return {
    best,
    withoutMarket: [...seen].filter((t) => !best.has(t)).sort(),
  };
}

const usd = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A size, printed so a thin book cannot round to nothing.
 *
 * A pool whose one-percent bound is forty cents is a pool with no market in it,
 * and printing that as "0" would say the mid moves for free — the same lie as
 * rendering an absence as a zero, told about depth instead of about a reading.
 */
const size = (n: number) =>
  n < 1_000
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(n).toLocaleString('en-US');

function venueLabel(p: StockPoolRecord): string {
  if (p.venue === 'v2') return `v2 against ${p.quoteLabel}`;
  const tier = p.fee === null ? '' : `${(p.fee / 10_000).toFixed(p.fee % 10_000 === 0 ? 0 : 2)}% `;
  return `${p.venue} ${tier}against ${p.quoteLabel}`;
}

export const specialistProducer: Producer = async (ctx): Promise<ProducerResult> => {
  const network = activeNetwork();
  const now = ctx.now;
  const opts = { intervalSeconds: INTERVAL, timeoutMs: 90_000 };
  const session = readSession(now);

  const head = await readHead(opts);
  const feedSnapshots = await ctx.store.snapshots('feed:');
  // The agent's own memory lives under its own id, which is the prefix the
  // rehearsal harness hides for `--fresh`. The board's rows live under `pool:`
  // and are rewritten every run whatever the prose decides — the measurement
  // does not go quiet because the sentence did.
  const previous = await ctx.store.snapshots(`${LAST_FILING_KEY}`);

  if (feedSnapshots.state === 'UNREAD') {
    return {
      publication: null,
      sourcesReached: 0,
      oldestInputAt: null,
      note: `the Pillar's feed record could not be read (${feedSnapshots.reason}), and a basis with no reference is not a number`,
    };
  }
  const references = referencesFrom(feedSnapshots.value, now);

  // ── one batch of state reads over the captured book ──────────────────────
  const calls: Call[] = [];
  for (const p of STOCK_POOLS) {
    if (p.venue === 'v2') {
      calls.push({ target: p.address, data: SEL.getReserves });
      calls.push({ target: p.address, data: SEL.getReserves });
    } else if (p.venue === 'v3') {
      calls.push({ target: p.address, data: SEL.slot0 });
      calls.push({ target: p.address, data: SEL.liquidity });
    } else {
      calls.push({ target: VENUES.stateView, data: `0x${body(SEL.getSlot0)}${bytes32(p.poolId ?? '')}` });
      calls.push({ target: VENUES.stateView, data: `0x${body(SEL.getLiquidity)}${bytes32(p.poolId ?? '')}` });
    }
  }
  const answers = await readMany(calls, opts);

  const retrievedAt = isRead(head) ? new Date(head.value.timestamp * 1000).toISOString() : now.toISOString();
  const readings: PoolReading[] = [];
  const unreadPools: string[] = [];
  let sourcesReached = 0;

  for (let i = 0; i < STOCK_POOLS.length; i += 1) {
    const p = STOCK_POOLS[i]!;
    const a = answers[i * 2];
    const b = answers[i * 2 + 1];
    if (!a || !isRead(a) || !b || !isRead(b)) {
      unreadPools.push(p.key);
      continue;
    }
    sourcesReached += 1;

    let state: PoolState;
    if (p.venue === 'v2') {
      const w = words(a.value);
      state = {
        kind: 'v2',
        reserve0: decodeUint(w[0] ?? '') ?? 0n,
        reserve1: decodeUint(w[1] ?? '') ?? 0n,
        decimals0: p.decimals0,
        decimals1: p.decimals1,
      };
    } else {
      state = {
        kind: p.venue,
        sqrtPriceX96: decodeUint(words(a.value)[0] ?? '') ?? 0n,
        liquidity: decodeUint(b.value) ?? 0n,
        decimals0: p.decimals0,
        decimals1: p.decimals1,
      };
    }

    const reduced = reducePool(p, state);
    if (reduced === null) continue;

    // The quote asset is turned into dollars by the feed the capture recorded
    // for it. No feed, no dollar figure — and the price in quote units stands.
    const quoteUsd = references.get(p.quoteFeedKey)?.priceUsd ?? null;
    readings.push({
      pool: p,
      ...reduced,
      priceUsd: quoteUsd === null ? null : reduced.priceInQuote * quoteUsd,
      depthUsd: quoteUsd === null || reduced.depthQuote === null ? null : reduced.depthQuote * quoteUsd,
    });
  }

  const { best, withoutMarket } = deepestByTicker(readings);

  // ── the basis, per ticker, and the record of it ──────────────────────────
  interface Row {
    readonly ticker: string;
    readonly reading: PoolReading;
    readonly reference: Reference | null;
    readonly bps: number | null;
  }
  const rows: Row[] = [];
  for (const [ticker, reading] of best) {
    const reference = references.get(reading.pool.feedKey) ?? null;
    const bps = reference === null || reading.priceUsd === null ? null : basisBps(reading.priceUsd, reference.priceUsd);
    rows.push({ ticker, reading, reference, bps });
  }
  rows.sort((a, b) => a.ticker.localeCompare(b.ticker));

  const observations: ObservationRecord[] = [];
  const snapshots: SnapshotRecord[] = [];

  // A ticker that lost its market must be written as one, not left behind.
  //
  // Two things go wrong if these are simply omitted. The board keeps whatever
  // `pool:` row was written the last time the ticker had liquidity, so a price
  // that no longer exists stays on the page indefinitely — the absence rendered
  // as a value, which is the one bug this whole system exists to prevent. And
  // nothing downstream can tell "the pool emptied" from "the Specialist has not
  // looked yet", so a holder who can no longer leave a position is never told.
  for (const ticker of withoutMarket) {
    const any = readings.find((r) => r.pool.ticker === ticker);
    if (any === undefined) continue;
    const p = any.pool;
    snapshots.push({
      key: `pool:${p.feedKey}`,
      observedAt: retrievedAt,
      payload: {
        ticker,
        feedKey: p.feedKey,
        source: `${network.label} · every pool listed for ${ticker} in the captured book`,
        venue: p.venue,
        venueLabel: venueLabel(p),
        poolKey: p.key,
        address: p.address,
        poolId: p.poolId,
        fee: p.fee,
        quoteLabel: p.quoteLabel,
        // Every figure absent, with the reason beside them. The mid these pools
        // still report is whatever they were left at, and is not carried.
        priceInQuote: null,
        priceUsd: null,
        depthQuote: null,
        depthUsd: null,
        depthIsExact: null,
        basisBps: null,
        referenceUsd: references.get(p.feedKey)?.priceUsd ?? null,
        referenceAgeSeconds: references.get(p.feedKey)?.feedAgeSeconds ?? null,
        sessionAtSample: session.phase,
        poolsReadForTicker: readings.filter((r) => r.pool.ticker === ticker).length,
        notPricedBecause: `every pool listed for this ticker answered and none of them is a market: each held no liquidity in force, or a book under the published floor of ${MARKET_FLOOR_USD} dollars. A pool that thin still reports a mid, and that mid is a memory rather than a price, so none is carried here.`,
        sqrtPriceX96: null,
        liquidity: null,
      },
    });
  }

  for (const row of rows) {
    const p = row.reading.pool;
    const source = `${network.label} · ${venueLabel(p)}`;
    snapshots.push({
      key: `pool:${p.feedKey}`,
      observedAt: retrievedAt,
      payload: {
        ticker: row.ticker,
        feedKey: p.feedKey,
        source,
        venue: p.venue,
        venueLabel: venueLabel(p),
        poolKey: p.key,
        address: p.address,
        poolId: p.poolId,
        fee: p.fee,
        quoteLabel: p.quoteLabel,
        priceInQuote: row.reading.priceInQuote,
        priceUsd: row.reading.priceUsd,
        depthQuote: row.reading.depthQuote,
        depthUsd: row.reading.depthUsd,
        depthIsExact: row.reading.exact,
        basisBps: row.bps,
        referenceUsd: row.reference?.priceUsd ?? null,
        referenceAgeSeconds: row.reference?.feedAgeSeconds ?? null,
        sessionAtSample: session.phase,
        poolsReadForTicker: readings.filter((r) => r.pool.ticker === row.ticker).length,
        // The raw integers the chain returned, beside the lossy doubles above:
        // a value rounded at write time cannot be un-rounded.
        sqrtPriceX96: row.reading.sqrtPriceX96,
        liquidity: row.reading.liquidity,
      },
    });
    if (row.reading.priceUsd !== null) {
      observations.push({ key: `${p.feedKey}:pool-usd`, observedAt: retrievedAt, value: row.reading.priceUsd, source });
    }
    if (row.bps !== null) {
      observations.push({ key: `${p.feedKey}:basis-bps`, observedAt: retrievedAt, value: row.bps, source });
    }
    if (row.reading.depthUsd !== null) {
      observations.push({ key: `${p.feedKey}:depth-usd`, observedAt: retrievedAt, value: row.reading.depthUsd, source });
    }
  }

  if (sourcesReached === 0) {
    return {
      publication: null,
      sourcesReached,
      oldestInputAt: isRead(head) ? new Date(retrievedAt) : null,
      snapshots,
      observations,
      note: `no pool in the captured book of ${STOCK_POOLS.length} answered; the book was not read, which is not the same as a book with no price`,
    };
  }

  // ── is this worth filing? ────────────────────────────────────────────────
  const priorBasis = new Map<string, number>();
  if (previous.state !== 'UNREAD') {
    const held = previous.value.find((s) => s.key === LAST_FILING_KEY)?.payload.basis;
    if (held !== null && typeof held === 'object') {
      for (const [k, v] of Object.entries(held as Record<string, unknown>)) {
        if (typeof v === 'number') priorBasis.set(k, v);
      }
    }
  }
  const priced = rows.filter((r) => r.bps !== null);
  const moved = priced.filter((r) => {
    const before = priorBasis.get(r.reading.pool.feedKey);
    return before === undefined || Math.abs(r.bps! - before) >= MATERIAL_MOVE_BPS;
  });
  const shapeChanged = priorBasis.size !== priced.length;

  const figures: DeclaredFigure[] = [];
  const literals = new Set<string>();
  const declare = (token: string, source: string) => figures.push({ token, source, retrievedAt });
  const literal = (v: number | string) => {
    literals.add(String(v));
    return String(v);
  };

  // A run that priced nothing is not a quiet run. The pools answered and the
  // reference did not, which is a different sentence from "nothing moved" and
  // must not be filed as one — the note is what an operator reads to tell the
  // two apart.
  if (priced.length === 0) {
    // Which half was missing decides what an operator fixes, so the note says
    // which. A ticker with no reference needs its own equity feed read; a
    // ticker with a mid and no dollars needs the feed for the asset its pool
    // quotes in — USDG/USD or ETH/USD — which the Pillar samples in rotation
    // and may not have reached yet on a young store.
    const missingQuotes = [
      ...new Set(rows.filter((r) => r.reading.priceUsd === null).map((r) => r.reading.pool.quoteFeedKey)),
    ].sort();
    return {
      publication: null,
      sourcesReached,
      oldestInputAt: new Date(retrievedAt),
      snapshots,
      observations,
      note:
        rows.length === 0
          ? `${sourcesReached} of ${STOCK_POOLS.length} pools answered but none carried a readable mid, so no ticker was priced`
          : missingQuotes.length > 0
            ? `${rows.length} tickers carried a pool mid and none could be stated in dollars: the Pillar's record holds no price for ${missingQuotes.join(' or ')}, the feed the pools quote against. Every mid is in the record; every basis is absent rather than zero`
            : `${rows.length} tickers carried a pool price and none carried a reference: the Pillar's record held no usable answer for their own equity feeds, so every basis this run is absent rather than zero`,
    };
  }

  if (moved.length === 0 && !shapeChanged) {
    return {
      publication: null,
      sourcesReached,
      oldestInputAt: new Date(retrievedAt),
      snapshots,
      observations,
      note: `the book is unchanged since the last filing: ${priced.length} tickers priced, none moved ${MATERIAL_MOVE_BPS} basis points or more`,
    };
  }

  // ── the filing ───────────────────────────────────────────────────────────
  const widest = [...priced].sort((a, b) => Math.abs(b.bps!) - Math.abs(a.bps!));
  const named = widest.slice(0, NAMED);
  const measured: string[] = [];

  for (const row of named) {
    const p = row.reading.pool;
    const source = `${network.label} · ${venueLabel(p)}`;
    const refSource = `${network.label} · ${row.reference!.label} feed, as the Pillar last read it`;
    const poolPrice = usd(row.reading.priceUsd!);
    const refPrice = usd(row.reference!.priceUsd);
    const bpsText = String(Math.abs(Math.round(row.bps!)));
    declare(poolPrice, source);
    declare(refPrice, refSource);
    declare(bpsText, `${source} · against ${refSource}, computed by code`);
    // The venue's own name carries its fee tier — "v3 0.05% against USDG" —
    // and a fee tier is a figure read from the pool's key like any other.
    figures.push(...figuresIn(venueLabel(p), `${network.label} · the pool key as the factory recorded it`, retrievedAt));

    let line = `— ${row.ticker}: ${poolPrice} in the pool against ${refPrice} from the feed — ${formatBasis(row.bps!)}. Deepest book: ${venueLabel(p)}.`;
    if (row.reading.depthUsd !== null) {
      const depth = size(row.reading.depthUsd);
      declare(depth, `${source} · size to move the mid one percent, computed by code from published state`);
      line += ` About ${depth} ${p.quoteLabel === 'USDG' ? 'dollars' : 'dollars of ' + p.quoteLabel} moves that mid one percent${row.reading.exact ? ', over the whole book' : ', against the liquidity at today’s tick'}.`;
    } else {
      line += ' Its depth could not be computed from the state published, so none is given.';
    }
    if (row.reference!.feedAgeSeconds !== null) {
      const hours = Math.round(row.reference!.feedAgeSeconds / 3600);
      if (hours >= 1) {
        declare(String(hours), refSource);
        line += ` The feed answer is ${hours} hours old.`;
      }
    }
    measured.push(line);
  }

  const notRead: string[] = [];
  if (unreadPools.length > 0) {
    notRead.push(`— ${literal(unreadPools.length)} of the ${literal(STOCK_POOLS.length)} pools in the captured book did not answer this run. Their tickers may still be priced from another pool; where they are not, the ticker is absent above rather than carried over.`);
  }
  // Two different absences, kept apart. A ticker whose own feed is missing has
  // no reference to measure against; a ticker whose QUOTE asset has no feed has
  // a mid in USDG or in ether and no way to state it in dollars. Reporting both
  // as "the reference did not answer" would name the wrong source as broken.
  const noReference = rows.filter((r) => r.reference === null).map((r) => r.ticker);
  const noQuoteFeed = rows
    .filter((r) => r.reference !== null && r.reading.priceUsd === null)
    .map((r) => `${r.ticker} (quoted in ${r.reading.pool.quoteLabel})`);
  if (noReference.length > 0) {
    notRead.push(`— No basis for ${noReference.join(', ')}: a pool answered and the ticker's own feed did not, and a difference with one side missing is not a number.`);
  }
  if (noQuoteFeed.length > 0) {
    notRead.push(`— No basis for ${noQuoteFeed.join(', ')}: the pool has a market and the ticker has a feed, but the Pillar has not read a price for the asset the pool quotes in, so the mid cannot be stated in dollars. The mid itself is in the record.`);
  }
  if (withoutMarket.length > 0) {
    notRead.push(`— No price for ${withoutMarket.join(', ')}: every pool these tickers have answered, and none of them had liquidity in force. An empty pool still reports whatever price it was left at, and that is a memory rather than a market, so none is carried here.`);
  }
  const noPool = new Set(STOCK_POOLS.map((p) => p.ticker));
  for (const r of rows) noPool.delete(r.ticker);
  for (const t of withoutMarket) noPool.delete(t);
  if (noPool.size > 0) {
    notRead.push(`— ${literal(noPool.size)} tickers in the book returned no readable state from any of their pools this run.`);
  }
  for (const line of notRead) figures.push(...figuresIn(line, `${network.label} · as observed on this run`, retrievedAt));

  const sessionLine = session.phase === 'REGULAR'
    ? 'The exchange was open when this was read, so both sides of every difference above were moving.'
    : 'The exchange was shut when this was read. A feed answer carried across a closed market is a memory, and the difference beside it is the chain trading without one.';

  literal(priced.length);
  literal(STOCK_POOLS.length);
  literal(sourcesReached);
  literal(rows.length);
  literal(moved.length);
  literal(MATERIAL_MOVE_BPS);

  const bodyText = [
    `MEASURED · ${priced.length} of ${rows.length} tickers with a price on both sides, from ${sourcesReached} of ${STOCK_POOLS.length} pools that answered`,
    ...measured,
    '',
    sessionLine,
    '',
    'NOT READ',
    ...(notRead.length > 0 ? notRead : ['— Every pool in the captured book answered, and every priced ticker carried a reference.']),
    '',
    'WHAT THIS IS NOT',
    '— Not a quote. The size beside each ticker is the amount that moves the mid one percent against state the pool has already published — for a v2 pair that is the whole book and exact, for v3 and v4 it is the liquidity at the current tick and a move that leaves that tick meets liquidity this figure cannot see.',
    '— Not a judgement. A difference is printed with its sign and the age of both prices. Whether it is wide, whether it is worth anything, and which way it closes are not stated here and will not be.',
    '— Not the whole venue. Only pools discoverable from the factories in the captured book are read; a pool created since that capture, or one on a fee tier nobody asked about, is not in these figures.',
  ].join('\n');

  // Written only on a filing, so the next run measures its move against what
  // was last said rather than against what was last seen.
  snapshots.push({
    key: LAST_FILING_KEY,
    observedAt: retrievedAt,
    payload: {
      filedAt: retrievedAt,
      tickersPriced: priced.length,
      basis: Object.fromEntries(priced.map((r) => [r.reading.pool.feedKey, r.bps!])),
    },
  });

  return {
    publication: {
      headline: `BASIS · ${priced.length} tickers priced both sides · ${moved.length} moved ${MATERIAL_MOVE_BPS} bp or more`,
      body: bodyText,
      figures,
      allowedLiterals: [...literals, String(STOCK_POOLS_SOURCE.observedAtBlock)],
    },
    sourcesReached,
    oldestInputAt: new Date(retrievedAt),
    snapshots,
    observations,
    note: notRead.length > 0 ? notRead.join(' ').slice(0, 400) : undefined,
  };
};

/** Exported for the tests: a reading with no reference is not half a basis. */
export function basisOf(reading: PoolReading, reference: Reference | null): number | null {
  if (reference === null || reading.priceUsd === null) return null;
  return basisBps(reading.priceUsd, reference.priceUsd);
}

export type { Reading };
