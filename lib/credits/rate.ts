/**
 * What a CURB is worth in dollars, read from a pool at a block.
 *
 * The rule is the token record's (docs/decisions/TOKEN.md): the price is
 * the pool's own price at a block — the ratio of reserves for a constant-
 * product pair, the square-root price for a concentrated-liquidity pool —
 * the market capitalisation is that price times `totalSupply()`, and the
 * desk states neither unless it read both. A pool with an empty side has
 * no price; a feed that answers zero or less has no price; a node that
 * cannot serve the block has no price by state. Every one of those is
 * UNREAD with its reason, never a stale figure carried forward and never a
 * number typed in.
 *
 * Two ways to the price at a block, tried in this order by the indexer:
 *
 *   by state   — `eth_call` at the block. Exact, and the simplest to check;
 *                but a public node keeps state for a short window only
 *                (Robinhood Chain's serves about 6,200 blocks, ten minutes,
 *                measured 12 September 2026), and a tick every quarter of
 *                an hour reaches most top-ups after that window has passed.
 *   by events  — the pool's own log at or before the block: a pair emits
 *                `Sync(reserve0, reserve1)` on every change of reserves, a
 *                v3 pool emits `Swap(…, sqrtPriceX96, …)` on every change of
 *                price (and `Initialize` once). The last such event at or
 *                before the block is the pool's state at the block, and
 *                logs are served far deeper than state (100,000 blocks and
 *                more on the same node). Decimals never change and are
 *                read at the head; the supply for the capitalisation is
 *                read at the head too, and the record says so.
 *
 * Arithmetic is in base units and scaled integers. Dollars are carried
 * scaled by 1e18 and rounded once, to cents, at the edge.
 */

import { decodeAddressWord, decodeInt, decodeUint, formatUnits, words } from '../chain/abi.ts';
import { keccak256Hex, selector } from '../chain/keccak.ts';
import { readLogs, rpcCall, type LogEntry, type RpcOptions } from '../chain/rpc.ts';
import { isRead, unread, type Reading } from '../doctrine/reading.ts';
import type { CreditsConfig, PriceSource } from './config.ts';

const SEL = {
  token0: selector('token0()'),
  token1: selector('token1()'),
  getReserves: selector('getReserves()'),
  slot0: selector('slot0()'),
  decimals: selector('decimals()'),
  totalSupply: selector('totalSupply()'),
  latestRoundData: selector('latestRoundData()'),
  aggregator: selector('aggregator()'),
} as const;

export const TOPICS = {
  /** Uniswap v2: emitted on every change of reserves. */
  sync: keccak256Hex('Sync(uint112,uint112)'),
  /** Uniswap v3: emitted on every swap, carrying the price after it. */
  swap: keccak256Hex('Swap(address,address,int256,int256,uint160,uint128,int24)'),
  /** Uniswap v3: the price the pool was created at. */
  initialize: keccak256Hex('Initialize(uint160,int24)'),
  /** Chainlink aggregators: every answer, with the answer indexed. */
  answerUpdated: keccak256Hex('AnswerUpdated(int256,uint256,uint256)'),
} as const;

/** How far back the pool's last event is looked for, in widening windows, before giving up. */
export const EVENT_WINDOWS = [20_000, 200_000, 2_000_000, 20_000_000] as const;

export interface Rate {
  readonly block: number;
  /** STATE: read by eth_call at the block. EVENTS: from the pool's last event at or before the block. */
  readonly basis: 'STATE' | 'EVENTS';
  readonly token: { readonly address: string; readonly decimals: number; readonly supply: string; readonly supplyAt: 'BLOCK' | 'HEAD' };
  readonly pool: {
    readonly kind: PriceSource['kind'];
    readonly address: string;
    readonly quoteAddress: string;
    readonly quoteDecimals: number;
    /** For a pair: the reserves. For a v3 pool: the square-root price, Q64.96. */
    readonly reserveCurb?: string;
    readonly reserveQuote?: string;
    readonly sqrtPriceX96?: string;
    /** By events: the block of the event the price came from. */
    readonly eventBlock?: number;
  };
  readonly quote:
    | { readonly kind: 'usd-stable' }
    | { readonly kind: 'chainlink-feed'; readonly feed: string; readonly answer: string; readonly decimals: number; readonly updatedAt: string; readonly eventBlock?: number };
  /** US dollars per CURB, scaled by 1e18. */
  readonly usdPerCurb18: string;
  /** Market capitalisation in US dollars, scaled by 1e18: price × supply. */
  readonly marketCapUsd18: string;
  readonly source: string;
  readonly readAt: string;
}

const hexBlock = (n: number) => `0x${n.toString(16)}`;
const Q192 = 1n << 192n;

async function callAt(to: string, data: string, block: number | 'latest', label: string, opts: RpcOptions): Promise<Reading<string>> {
  const raw = await rpcCall<string>('eth_call', [{ to, data }, block === 'latest' ? 'latest' : hexBlock(block)], opts);
  if (!isRead(raw)) return raw;
  if (raw.value === '0x' || raw.value === '') return unread('FIELD_ABSENT', { source: raw.source, detail: `${label} returned no data at block ${block} — the function reverted or is not implemented` });
  return raw;
}

async function uintAt(to: string, data: string, block: number | 'latest', label: string, opts: RpcOptions): Promise<Reading<bigint>> {
  const raw = await callAt(to, data, block, label, opts);
  if (!isRead(raw)) return raw;
  const w = words(raw.value);
  const v = w[0] === undefined ? null : decodeUint(w[0]);
  return v === null ? unread('SOURCE_MALFORMED', { source: raw.source, detail: `${label} undecodable` }) : { ...raw, value: v };
}

async function addressAt(to: string, data: string, block: number | 'latest', label: string, opts: RpcOptions): Promise<Reading<string>> {
  const raw = await callAt(to, data, block, label, opts);
  if (!isRead(raw)) return raw;
  const w = words(raw.value);
  const v = w[0] === undefined ? null : decodeAddressWord(w[0]);
  return v === null ? unread('SOURCE_MALFORMED', { source: raw.source, detail: `${label} undecodable` }) : { ...raw, value: v.toLowerCase() };
}

/** The last log of one topic from one address at or before `block`, looked for in widening windows. */
async function lastEventBefore(address: string, topic: string, block: number, opts: RpcOptions): Promise<Reading<LogEntry | null>> {
  let to = block;
  let source = '';
  for (const width of EVENT_WINDOWS) {
    const from = Math.max(0, block - width);
    if (from > to) break;
    const read = await readLogs(address, [topic], from, to, opts);
    if (!isRead(read)) return read;
    source = read.source;
    const logs = read.value.filter((l) => Number.parseInt(l.blockNumber, 16) <= block).sort((a, b) => Number.parseInt(a.blockNumber, 16) - Number.parseInt(b.blockNumber, 16) || Number.parseInt(a.logIndex ?? '0', 16) - Number.parseInt(b.logIndex ?? '0', 16));
    const last = logs.at(-1);
    if (last !== undefined) return { ...read, value: last };
    if (from === 0) break;
    to = from - 1;
  }
  return { state: 'VERIFIED', value: null, ageSeconds: 0, source, retrievedAt: new Date().toISOString() };
}

/** Which side of the pool is CURB, and what the other side is. Constants of the pool; read at the head. */
async function sides(config: CreditsConfig, opts: RpcOptions): Promise<Reading<{ curbIs0: boolean; quoteAddress: string; curbDecimals: number; quoteDecimals: number }>> {
  const pool = config.priceSource.pair;
  const [token0, token1, decimals] = await Promise.all([addressAt(pool, SEL.token0, 'latest', 'token0()', opts), addressAt(pool, SEL.token1, 'latest', 'token1()', opts), uintAt(config.token, SEL.decimals, 'latest', 'decimals()', opts)]);
  if (!isRead(token0)) return token0;
  if (!isRead(token1)) return token1;
  if (!isRead(decimals)) return decimals;
  const curbIs0 = token0.value === config.token;
  const curbIs1 = token1.value === config.token;
  if (!curbIs0 && !curbIs1) return unread('SOURCE_MALFORMED', { source: token0.source, detail: `the pool ${pool} holds ${token0.value} and ${token1.value}, neither of which is the configured token ${config.token}` });
  const quoteAddress = curbIs0 ? token1.value : token0.value;
  const quoteDecimals = await uintAt(quoteAddress, SEL.decimals, 'latest', 'quote decimals()', opts);
  if (!isRead(quoteDecimals)) return quoteDecimals;
  const dCurb = Number(decimals.value);
  const dQuote = Number(quoteDecimals.value);
  if (dCurb > 36 || dQuote > 36) return unread('SOURCE_MALFORMED', { source: token0.source, detail: 'decimals beyond 36 are not handled' });
  return { ...token0, value: { curbIs0, quoteAddress, curbDecimals: dCurb, quoteDecimals: dQuote } };
}

type PoolPrice =
  | { readonly kind: 'uniswap-v2-pair'; readonly reserveCurb: bigint; readonly reserveQuote: bigint; readonly eventBlock?: number }
  | { readonly kind: 'uniswap-v3-pool'; readonly sqrtPriceX96: bigint; readonly eventBlock?: number };

/** Quote units per CURB, scaled by 1e18 and by the decimals gap, from the pool's own figures. Zero means no price. */
function quotePerCurb18(p: PoolPrice, curbIs0: boolean, dCurb: number, dQuote: number): bigint {
  if (p.kind === 'uniswap-v2-pair') {
    if (p.reserveCurb === 0n || p.reserveQuote === 0n) return 0n;
    return (p.reserveQuote * 10n ** 18n * 10n ** BigInt(dCurb)) / (p.reserveCurb * 10n ** BigInt(dQuote));
  }
  if (p.sqrtPriceX96 === 0n) return 0n;
  const sq = p.sqrtPriceX96 * p.sqrtPriceX96;
  // token1 per token0 = sqrtP² / 2¹⁹²; CURB per quote is the inverse when CURB is token1.
  return curbIs0 ? (sq * 10n ** 18n * 10n ** BigInt(dCurb)) / (Q192 * 10n ** BigInt(dQuote)) : (Q192 * 10n ** 18n * 10n ** BigInt(dCurb)) / (sq * 10n ** BigInt(dQuote));
}

async function poolPriceByState(source: PriceSource, curbIs0: boolean, block: number, opts: RpcOptions): Promise<Reading<PoolPrice>> {
  if (source.kind === 'uniswap-v2-pair') {
    const raw = await callAt(source.pair, SEL.getReserves, block, 'getReserves()', opts);
    if (!isRead(raw)) return raw;
    const w = words(raw.value);
    const r0 = w[0] === undefined ? null : decodeUint(w[0]);
    const r1 = w[1] === undefined ? null : decodeUint(w[1]);
    if (r0 === null || r1 === null) return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'getReserves() undecodable' });
    return { ...raw, value: { kind: 'uniswap-v2-pair', reserveCurb: curbIs0 ? r0 : r1, reserveQuote: curbIs0 ? r1 : r0 } };
  }
  const raw = await callAt(source.pair, SEL.slot0, block, 'slot0()', opts);
  if (!isRead(raw)) return raw;
  const w = words(raw.value);
  const sqrt = w[0] === undefined ? null : decodeUint(w[0]);
  if (sqrt === null) return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'slot0() undecodable' });
  return { ...raw, value: { kind: 'uniswap-v3-pool', sqrtPriceX96: sqrt } };
}

async function poolPriceByEvents(source: PriceSource, curbIs0: boolean, block: number, opts: RpcOptions): Promise<Reading<PoolPrice>> {
  if (source.kind === 'uniswap-v2-pair') {
    const last = await lastEventBefore(source.pair, TOPICS.sync, block, opts);
    if (!isRead(last)) return last;
    if (last.value === null) return unread('FIELD_ABSENT', { source: last.source, detail: `no Sync from the pair in the ${EVENT_WINDOWS.at(-1)!.toLocaleString('en-US')} blocks before block ${block}` });
    const w = words(last.value.data);
    const r0 = w[0] === undefined ? null : decodeUint(w[0]);
    const r1 = w[1] === undefined ? null : decodeUint(w[1]);
    if (r0 === null || r1 === null) return unread('SOURCE_MALFORMED', { source: last.source, detail: 'Sync undecodable' });
    return { ...last, value: { kind: 'uniswap-v2-pair', reserveCurb: curbIs0 ? r0 : r1, reserveQuote: curbIs0 ? r1 : r0, eventBlock: Number.parseInt(last.value.blockNumber, 16) } };
  }
  // The last swap sets the price; before any swap, the price the pool was initialised at.
  const swap = await lastEventBefore(source.pair, TOPICS.swap, block, opts);
  if (!isRead(swap)) return swap;
  let sqrt: bigint | null = null;
  let eventBlock: number | null = null;
  let src = swap.source;
  if (swap.value !== null) {
    sqrt = words(swap.value.data)[2] === undefined ? null : decodeUint(words(swap.value.data)[2]!);
    eventBlock = Number.parseInt(swap.value.blockNumber, 16);
  } else {
    const init = await lastEventBefore(source.pair, TOPICS.initialize, block, opts);
    if (!isRead(init)) return init;
    src = init.source;
    if (init.value === null) return unread('FIELD_ABSENT', { source: init.source, detail: `no Swap and no Initialize from the pool in the ${EVENT_WINDOWS.at(-1)!.toLocaleString('en-US')} blocks before block ${block}` });
    sqrt = words(init.value.data)[0] === undefined ? null : decodeUint(words(init.value.data)[0]!);
    eventBlock = Number.parseInt(init.value.blockNumber, 16);
  }
  if (sqrt === null || eventBlock === null) return unread('SOURCE_MALFORMED', { source: src, detail: 'the pool event is undecodable' });
  return { state: 'VERIFIED', value: { kind: 'uniswap-v3-pool', sqrtPriceX96: sqrt, eventBlock }, ageSeconds: 0, source: src, retrievedAt: new Date().toISOString() };
}

type FeedAnswer = { readonly answer: bigint; readonly updatedAt: bigint; readonly decimals: number; readonly eventBlock?: number };

async function feedByState(feed: string, block: number, opts: RpcOptions): Promise<Reading<FeedAnswer>> {
  const [round, decimals] = await Promise.all([callAt(feed, SEL.latestRoundData, block, 'latestRoundData()', opts), uintAt(feed, SEL.decimals, 'latest', 'feed decimals()', opts)]);
  if (!isRead(round)) return round;
  if (!isRead(decimals)) return decimals;
  const parts = words(round.value);
  const answer = parts[1] === undefined ? null : decodeInt(parts[1]);
  const updatedAt = parts[3] === undefined ? null : decodeUint(parts[3]);
  if (answer === null || updatedAt === null || parts.length !== 5) return unread('SOURCE_MALFORMED', { source: round.source, detail: 'latestRoundData() undecodable' });
  return { ...round, value: { answer, updatedAt, decimals: Number(decimals.value) } };
}

/** The feed's last AnswerUpdated at or before the block, from the aggregator behind the proxy. */
async function feedByEvents(feed: string, block: number, opts: RpcOptions): Promise<Reading<FeedAnswer>> {
  const [aggregator, decimals] = await Promise.all([addressAt(feed, SEL.aggregator, 'latest', 'aggregator()', opts), uintAt(feed, SEL.decimals, 'latest', 'feed decimals()', opts)]);
  if (!isRead(aggregator)) return aggregator;
  if (!isRead(decimals)) return decimals;
  const last = await lastEventBefore(aggregator.value, TOPICS.answerUpdated, block, opts);
  if (!isRead(last)) return last;
  if (last.value === null) return unread('FIELD_ABSENT', { source: last.source, detail: `no AnswerUpdated from the feed's aggregator ${aggregator.value} in the ${EVENT_WINDOWS.at(-1)!.toLocaleString('en-US')} blocks before block ${block}` });
  const answer = last.value.topics[1] === undefined ? null : decodeInt(last.value.topics[1]);
  const updatedAt = words(last.value.data)[0] === undefined ? null : decodeUint(words(last.value.data)[0]!);
  if (answer === null || updatedAt === null) return unread('SOURCE_MALFORMED', { source: last.source, detail: 'AnswerUpdated undecodable' });
  return { ...last, value: { answer, updatedAt, decimals: Number(decimals.value), eventBlock: Number.parseInt(last.value.blockNumber, 16) } };
}

async function assemble(config: CreditsConfig, block: number, basis: Rate['basis'], opts: RpcOptions, now: Date): Promise<Reading<Rate>> {
  const s = await sides(config, opts);
  if (!isRead(s)) return s;
  const { curbIs0, quoteAddress, curbDecimals, quoteDecimals } = s.value;
  const pool = basis === 'STATE' ? await poolPriceByState(config.priceSource, curbIs0, block, opts) : await poolPriceByEvents(config.priceSource, curbIs0, block, opts);
  if (!isRead(pool)) return pool;
  const perCurb = quotePerCurb18(pool.value, curbIs0, curbDecimals, quoteDecimals);
  if (perCurb === 0n) {
    const why = pool.value.kind === 'uniswap-v2-pair' ? `the pool has an empty side at block ${block} (CURB ${pool.value.reserveCurb}, quote ${pool.value.reserveQuote})` : `the pool's price is zero at block ${block}`;
    return unread('FIELD_ABSENT', { source: pool.source, detail: `${why}; there is no price` });
  }

  let quote: Rate['quote'];
  let usdPerCurb18 = perCurb;
  if (config.priceSource.quote.kind === 'chainlink-feed') {
    const feed = config.priceSource.quote.feed;
    const f = basis === 'STATE' ? await feedByState(feed, block, opts) : await feedByEvents(feed, block, opts);
    if (!isRead(f)) return f;
    if (f.value.answer <= 0n) return unread('FIELD_ABSENT', { source: f.source, detail: `the feed answered ${f.value.answer} at block ${block}; a price that is not positive is not a price` });
    usdPerCurb18 = (perCurb * f.value.answer) / 10n ** BigInt(f.value.decimals);
    quote = { kind: 'chainlink-feed', feed, answer: f.value.answer.toString(), decimals: f.value.decimals, updatedAt: new Date(Number(f.value.updatedAt) * 1000).toISOString(), ...(f.value.eventBlock === undefined ? {} : { eventBlock: f.value.eventBlock }) };
  } else {
    quote = { kind: 'usd-stable' };
  }
  if (usdPerCurb18 === 0n) return unread('FIELD_ABSENT', { source: pool.source, detail: `the price rounds to zero at 18 places at block ${block}` });

  // The supply at the block by state; at the head by events, and said so.
  const supply = await uintAt(config.token, SEL.totalSupply, basis === 'STATE' ? block : 'latest', 'totalSupply()', opts);
  if (!isRead(supply)) return supply;
  const marketCapUsd18 = (supply.value * usdPerCurb18) / 10n ** BigInt(curbDecimals);

  const poolOut: Rate['pool'] = {
    kind: config.priceSource.kind,
    address: config.priceSource.pair,
    quoteAddress,
    quoteDecimals,
    ...(pool.value.kind === 'uniswap-v2-pair' ? { reserveCurb: pool.value.reserveCurb.toString(), reserveQuote: pool.value.reserveQuote.toString() } : { sqrtPriceX96: pool.value.sqrtPriceX96.toString() }),
    ...(pool.value.eventBlock === undefined ? {} : { eventBlock: pool.value.eventBlock }),
  };
  return {
    state: pool.state,
    ageSeconds: pool.ageSeconds,
    ...(pool.state === 'STALE' ? { freshnessSeconds: pool.freshnessSeconds } : {}),
    source: pool.source,
    retrievedAt: pool.retrievedAt,
    value: {
      block,
      basis,
      token: { address: config.token, decimals: curbDecimals, supply: supply.value.toString(), supplyAt: basis === 'STATE' ? 'BLOCK' : 'HEAD' },
      pool: poolOut,
      quote,
      usdPerCurb18: usdPerCurb18.toString(),
      marketCapUsd18: marketCapUsd18.toString(),
      source: pool.source,
      readAt: now.toISOString(),
    },
  } as Reading<Rate>;
}

/** The pool's price and the token's supply at one block, by state, reduced to a price and a market capitalisation. */
export async function readRate(config: CreditsConfig, block: number, opts: RpcOptions, now: Date = new Date()): Promise<Reading<Rate>> {
  return assemble(config, block, 'STATE', opts, now);
}

/** The same, from the pool's (and the feed's) last event at or before the block, for a block the node no longer serves by state. */
export async function readRateFromEvents(config: CreditsConfig, block: number, opts: RpcOptions, now: Date = new Date()): Promise<Reading<Rate>> {
  return assemble(config, block, 'EVENTS', opts, now);
}

/** US cents an amount of CURB (base units) is worth at a rate, rounded down once. */
export function centsForCurb(rate: Rate, amount: bigint): bigint {
  const usd18 = (amount * BigInt(rate.usdPerCurb18)) / 10n ** BigInt(rate.token.decimals);
  return usd18 / 10n ** 16n;
}

/** The CURB (base units) that is worth at least `cents` at a rate, rounded up once. */
export function curbForCents(rate: Rate, cents: bigint): bigint {
  const numerator = cents * 10n ** 16n * 10n ** BigInt(rate.token.decimals);
  const price = BigInt(rate.usdPerCurb18);
  return (numerator + price - 1n) / price;
}

/** A dollar figure scaled by 1e18 as text, with the places asked for, no float. */
export function usd18Text(v: string | bigint, places: number): string {
  const full = formatUnits(typeof v === 'bigint' ? v : BigInt(v), 18);
  // formatUnits groups the whole part and strips trailing zeros; the places asked for are padded back.
  const [whole = '0', frac = ''] = full.split('.');
  if (places === 0) return `US$${whole}`;
  return `US$${whole}.${(frac + '0'.repeat(places)).slice(0, places)}`;
}

/** CURB base units as a token amount, grouped, without trailing zeros beyond the places asked for. */
export function curbText(amount: bigint, decimals: number, places = 4): string {
  const full = formatUnits(amount, decimals);
  const [whole = '0', frac = ''] = full.split('.');
  const f = frac.slice(0, places).replace(/0+$/, '');
  return f === '' ? whole : `${whole}.${f}`;
}
