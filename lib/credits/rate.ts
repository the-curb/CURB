/**
 * What a CURB is worth in dollars, read from a pool at a block.
 *
 * The rule is the token record's (docs/decisions/TOKEN.md): the price is
 * the pool's own price at a block — the ratio of reserves for a constant-
 * product pair, the square-root price for a concentrated-liquidity pool —
 * the market capitalisation is that price times `totalSupply()`, and the
 * desk states neither unless it read both. A pool with an empty side has
 * no price; a v3 pool with no liquidity or no swap yet has no price; a feed
 * that answers zero or less, or answered too long before the block, has no
 * price; a node that cannot serve the block has no price by state. Every
 * one of those is UNREAD with its reason, never a stale figure carried
 * forward and never a number typed in.
 *
 * Two ways to the price at a block, tried in this order by the indexer:
 *
 *   by state   — `eth_call` at the block. Exact, and the simplest to check;
 *                but a public node keeps state for a short window only
 *                (Robinhood Chain's serves about 6,200 blocks, ten minutes,
 *                measured 12 September 2026), and a tick — scheduled every
 *                five minutes, in practice every ten to twenty — reaches
 *                most top-ups after that window has passed.
 *   by events  — the pool's own log at or before the block: a pair emits
 *                `Sync(reserve0, reserve1)` on every change of reserves, a
 *                v3 pool emits `Swap(…, sqrtPriceX96, liquidity, …)` on every
 *                change of price. The last such event at or before the
 *                block is the pool's state at the block, and logs are served
 *                far deeper than state (the whole chain on the same node, as
 *                long as few match). Decimals never change and are read at
 *                the head; the supply for the capitalisation is read at the
 *                head too, and the record says so.
 *
 * The guard. A pool's price at one block can be set by whoever trades in
 * it just before, and a top-up credited at a pumped price would buy more
 * service than the CURB was worth. So the price a top-up is credited at is
 * the price at its block **or the lowest price the pool showed in the
 * window before it, whichever is lower** — every Sync or Swap in the last
 * hour or so (by chain, in blocks). A dump before a top-up costs the payer;
 * a pump before it buys nothing. The guard is read from events, which the
 * node serves for any block; a window that cannot be read is a rate that
 * cannot be stated.
 *
 * Arithmetic is in base units and scaled integers. Dollars are carried
 * scaled by 1e18 and rounded once, to cents, at the edge.
 */

import { decodeAddressWord, decodeInt, decodeUint, formatUnits, words } from '../chain/abi.ts';
import { keccak256Hex, selector } from '../chain/keccak.ts';
import { halveable, isTooManyLogs, MIN_PAGE_BLOCKS } from '../chain/logs.ts';
import { readBlockNumber, readLogs, rpcCall, type LogEntry, type RpcOptions } from '../chain/rpc.ts';
import { isRead, unread, type Reading } from '../doctrine/reading.ts';
import type { CreditsConfig, PriceSource } from './config.ts';

const SEL = {
  token0: selector('token0()'),
  token1: selector('token1()'),
  getReserves: selector('getReserves()'),
  slot0: selector('slot0()'),
  liquidity: selector('liquidity()'),
  decimals: selector('decimals()'),
  totalSupply: selector('totalSupply()'),
  latestRoundData: selector('latestRoundData()'),
  aggregator: selector('aggregator()'),
  phaseId: selector('phaseId()'),
  phaseAggregators: selector('phaseAggregators(uint16)'),
} as const;

/** How many earlier phases of a feed's proxy are looked at for a block before the current aggregator's first answer. */
export const FEED_PHASES_BACK = 3;

export const TOPICS = {
  /** Uniswap v2: emitted on every change of reserves. */
  sync: keccak256Hex('Sync(uint112,uint112)'),
  /** Uniswap v3: emitted on every swap, carrying the price and the liquidity after it. */
  swap: keccak256Hex('Swap(address,address,int256,int256,uint160,uint128,int24)'),
  /** Uniswap v3: emitted once, when the pool is given its first price — the price a pool has before its first swap. */
  initialize: keccak256Hex('Initialize(uint160,int24)'),
  /** Uniswap v3: liquidity added; a pool with a price and no Mint yet has a price nobody can trade at. */
  mint: keccak256Hex('Mint(address,address,int24,int24,uint128,uint256,uint256)'),
  /** Uniswap v3: liquidity removed. */
  burn: keccak256Hex('Burn(address,int24,int24,uint128,uint256,uint256)'),
  /** Chainlink aggregators: every answer, with the answer indexed. */
  answerUpdated: keccak256Hex('AnswerUpdated(int256,uint256,uint256)'),
} as const;

/**
 * How far back the pool's last event is looked for, in widening windows;
 * after the widest, one read down to the floor — the pool's creation block
 * when the record names it, else the chain's first — so a pool quiet for
 * longer than the widest window (24 days on a 0.1 s chain) is still found,
 * and "no event before the block" is said only of the whole span. The node
 * serves any width when few logs match (measured on chain 4663); a range it
 * refuses is halved.
 */
export const EVENT_WINDOWS = [20_000, 200_000, 2_000_000, 20_000_000] as const;

/** The guard's window before a block, in blocks, by chain — about an hour on each; the local chain's is short so a rehearsal can move the price. */
export const GUARD_WINDOW_BLOCKS: Readonly<Record<number, number>> = { 4663: 35_000, 1: 300, 11155111: 300, 31337: 40 };
export const DEFAULT_GUARD_WINDOW_BLOCKS = 300;
export const guardWindowFor = (chainId: number): number => GUARD_WINDOW_BLOCKS[chainId] ?? DEFAULT_GUARD_WINDOW_BLOCKS;

/** A feed answer older than this at the priced block is not a price for that block (the desk's feeds publish at least daily). */
export const FEED_MAX_AGE_SECONDS = 26 * 3600;

/**
 * How many pages of events the guard will read for one window before it
 * refuses to state a rate. A page is what the node serves in one answer
 * (up to its cap, 10,000 on the chain decided), so this bounds the time a
 * window can take, not the number of trades: a pool doing 6 swaps a second
 * for an hour is four pages.
 */
export const GUARD_MAX_PAGES = 64;

/**
 * The start of the detail a reading carries when the pool had no price at
 * a block as a definite fact about that block — it was created later, it
 * had no event at or before it back to its creation, it held no liquidity
 * or an empty side there. Nothing that happens later changes such a fact,
 * so the indexer does not wait for it; it prices the top-up at the head
 * when indexed and the credit says so.
 */
export const NO_PRICE_AT_BLOCK = 'the pool had no price at block';
export const poolHadNoPriceAt = (r: Reading<unknown>): boolean => r.state === 'UNREAD' && r.reason === 'FIELD_ABSENT' && (r.detail ?? '').startsWith(NO_PRICE_AT_BLOCK);

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
    /** For a pair: the reserves. For a v3 pool: the square-root price, Q64.96, and the liquidity. */
    readonly reserveCurb?: string;
    readonly reserveQuote?: string;
    readonly sqrtPriceX96?: string;
    readonly liquidity?: string;
    /** By events: the block of the event the price came from. */
    readonly eventBlock?: number;
  };
  readonly quote:
    | { readonly kind: 'usd-stable' }
    | { readonly kind: 'chainlink-feed'; readonly feed: string; readonly answer: string; readonly decimals: number; readonly updatedAt: string; readonly eventBlock?: number };
  /**
   * The guard: the lowest price the pool showed in the window before the
   * block, from its events. `applied` is true when that was lower than the
   * price at the block and is what `usdPerCurb18` carries.
   */
  readonly guard: { readonly windowBlocks: number; readonly samples: number; readonly lowestAtBlock: number | null; readonly atBlockUsdPerCurb18: string; readonly applied: boolean };
  /** US dollars per CURB, scaled by 1e18 — after the guard. */
  readonly usdPerCurb18: string;
  /** Market capitalisation in US dollars, scaled by 1e18: the price at the block × supply. */
  readonly marketCapUsd18: string;
  readonly source: string;
  readonly readAt: string;
}

const hexBlock = (n: number) => `0x${n.toString(16)}`;
const Q192 = 1n << 192n;
const byPosition = (a: LogEntry, b: LogEntry) => Number.parseInt(a.blockNumber, 16) - Number.parseInt(b.blockNumber, 16) || Number.parseInt(a.logIndex ?? '0', 16) - Number.parseInt(b.logIndex ?? '0', 16);
const blockOf = (l: LogEntry) => Number.parseInt(l.blockNumber, 16);

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

/** The timestamp of a block, for judging a feed's age at it. */
async function timestampOf(block: number, opts: RpcOptions): Promise<Reading<number>> {
  const raw = await rpcCall<{ timestamp?: string } | null>('eth_getBlockByNumber', [hexBlock(block), false], opts);
  if (!isRead(raw)) return raw;
  const ts = raw.value?.timestamp === undefined ? NaN : Number(raw.value.timestamp);
  return Number.isFinite(ts) && ts > 0 ? { ...raw, value: ts } : unread('SOURCE_MALFORMED', { source: raw.source, detail: `no header for block ${block}` });
}

/**
 * Every log of one topic from one address in a range, folded page by page
 * in block order and dropped once weighed, so a busy window costs pages,
 * not memory. A range the node refuses for matching too much is halved
 * until it answers or is narrower than the smallest page, which is then a
 * fault; more pages than GUARD_MAX_PAGES is a fault too, stated as such.
 */
async function foldEventsInRange(address: string, topic: string, from: number, to: number, opts: RpcOptions, fold: (log: LogEntry) => void, budget: { pages: number }): Promise<Reading<null>> {
  if (budget.pages <= 0) return unread('SOURCE_MALFORMED', { source: null, detail: `more than ${GUARD_MAX_PAGES} pages of events in the window; the desk does not weigh a pool that busy` });
  const read = await readLogs(address, [topic], from, to, opts);
  if (isRead(read)) {
    budget.pages -= 1;
    for (const log of [...read.value].sort(byPosition)) fold(log);
    return { ...read, value: null };
  }
  const width = to - from + 1;
  if (!halveable(read) || width <= MIN_PAGE_BLOCKS) return read;
  const mid = from + Math.floor(width / 2);
  const earlier = await foldEventsInRange(address, topic, from, mid - 1, opts, fold, budget);
  if (!isRead(earlier)) return earlier;
  return foldEventsInRange(address, topic, mid, to, opts, fold, budget);
}

/** The last log of one topic from one address in a range; a refused range is halved, later half first, since the last event is wanted. */
async function lastInRange(address: string, topic: string, from: number, to: number, opts: RpcOptions): Promise<Reading<LogEntry | null>> {
  const read = await readLogs(address, [topic], from, to, opts);
  if (isRead(read)) {
    const last = [...read.value].sort(byPosition).at(-1);
    return { ...read, value: last ?? null };
  }
  const width = to - from + 1;
  if (!halveable(read) || width <= MIN_PAGE_BLOCKS) return read;
  const mid = from + Math.floor(width / 2);
  const later = await lastInRange(address, topic, mid, to, opts);
  if (!isRead(later) || later.value !== null) return later;
  return lastInRange(address, topic, from, mid - 1, opts);
}

/** The last log of one topic from one address at or before `block`, looked for in widening windows and then down to `floor`. Null, VERIFIED, only when there is none in the whole span. */
async function lastEventBefore(address: string, topic: string, block: number, opts: RpcOptions, floor = 0): Promise<Reading<LogEntry | null>> {
  let to = block;
  let source = '';
  const bottom = Math.max(0, floor);
  for (const width of [...EVENT_WINDOWS, Number.POSITIVE_INFINITY]) {
    const from = Number.isFinite(width) ? Math.max(bottom, block - width) : bottom;
    if (from > to) break;
    const read = await lastInRange(address, topic, from, to, opts);
    if (!isRead(read)) return read;
    source = read.source;
    if (read.value !== null) return read;
    if (from === bottom) break;
    to = from - 1;
  }
  return { state: 'VERIFIED', value: null, ageSeconds: 0, source, retrievedAt: new Date().toISOString() };
}

interface Sides {
  readonly curbIs0: boolean;
  readonly quoteAddress: string;
  readonly curbDecimals: number;
  readonly quoteDecimals: number;
}

/**
 * What one run may carry between reads: the pool's constants, read once,
 * and the highest block the node was seen to refuse state for, so blocks
 * below it are not asked by state again this run.
 */
export interface RateContext {
  sides?: Sides;
  stateUnservedBelow?: number;
}

/** The node's ways of saying a block's state is gone (Arbitrum Nitro, geth, erigon). */
export const STATE_GONE = /metadata is not found|missing trie node|header not found|state (is )?not available|pruned|old block/i;

/** Which side of the pool is CURB, and what the other side is. Constants of the pool; read at the head. */
async function sides(config: CreditsConfig, source: PriceSource, opts: RpcOptions): Promise<Reading<Sides>> {
  const pool = source.pair;
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
  | { readonly kind: 'uniswap-v3-pool'; readonly sqrtPriceX96: bigint; readonly liquidity: bigint; readonly eventBlock?: number };

/** Quote units per CURB, scaled by 1e18 and by the decimals gap, from the pool's own figures. Zero means no price. */
function quotePerCurb18(p: PoolPrice, s: Sides): bigint {
  if (p.kind === 'uniswap-v2-pair') {
    if (p.reserveCurb === 0n || p.reserveQuote === 0n) return 0n;
    return (p.reserveQuote * 10n ** 18n * 10n ** BigInt(s.curbDecimals)) / (p.reserveCurb * 10n ** BigInt(s.quoteDecimals));
  }
  if (p.sqrtPriceX96 === 0n || p.liquidity === 0n) return 0n;
  const sq = p.sqrtPriceX96 * p.sqrtPriceX96;
  // token1 per token0 = sqrtP² / 2¹⁹²; CURB per quote is the inverse when CURB is token1.
  return s.curbIs0 ? (sq * 10n ** 18n * 10n ** BigInt(s.curbDecimals)) / (Q192 * 10n ** BigInt(s.quoteDecimals)) : (Q192 * 10n ** 18n * 10n ** BigInt(s.curbDecimals)) / (sq * 10n ** BigInt(s.quoteDecimals));
}

function decodePoolEvent(source: PriceSource, s: Sides, log: LogEntry): PoolPrice | null {
  const w = words(log.data);
  if (source.kind === 'uniswap-v2-pair') {
    const r0 = w[0] === undefined ? null : decodeUint(w[0]);
    const r1 = w[1] === undefined ? null : decodeUint(w[1]);
    if (r0 === null || r1 === null) return null;
    return { kind: 'uniswap-v2-pair', reserveCurb: s.curbIs0 ? r0 : r1, reserveQuote: s.curbIs0 ? r1 : r0, eventBlock: blockOf(log) };
  }
  if ((log.topics[0] ?? '').toLowerCase() === TOPICS.initialize) {
    // The pool's first price, before any swap; liquidity is not in the event — a Mint at or before the block is checked by the caller.
    const sqrt0 = w[0] === undefined ? null : decodeUint(w[0]);
    return sqrt0 === null ? null : { kind: 'uniswap-v3-pool', sqrtPriceX96: sqrt0, liquidity: 1n, eventBlock: blockOf(log) };
  }
  const sqrt = w[2] === undefined ? null : decodeUint(w[2]);
  const liquidity = w[3] === undefined ? null : decodeUint(w[3]);
  if (sqrt === null || liquidity === null) return null;
  return { kind: 'uniswap-v3-pool', sqrtPriceX96: sqrt, liquidity, eventBlock: blockOf(log) };
}

/**
 * The pool's last price event at or before a block, back to its creation
 * (`floor`): a pair's last Sync; a v3 pool's last Swap, or — before its
 * first swap — its Initialize, provided liquidity was added by then (a
 * Mint at or before the block). Null, VERIFIED, means the pool had no price
 * at that block: a definite fact, since the span reaches the creation block.
 */
/**
 * ...with what the pool's Mint and Burn events say about liquidity after
 * the last price event: a Swap that left liquidity at zero followed by a
 * Mint is a price with liquidity again; an Initialize followed by a Mint
 * and then a Burn is a pool whose liquidity by events cannot be told — a
 * reading that is UNCERTAIN, so the indexer waits for the node's state
 * rather than calling it a definite no-price.
 */
async function lastPriceEventBefore(source: PriceSource, block: number, opts: RpcOptions): Promise<Reading<LogEntry | null> & { readonly liquidityAfter?: 'PRESENT' | 'UNCERTAIN' }> {
  const floor = source.fromBlock ?? 0;
  if (source.kind === 'uniswap-v2-pair') return lastEventBefore(source.pair, TOPICS.sync, block, opts, floor);
  const swap = await lastEventBefore(source.pair, TOPICS.swap, block, opts, floor);
  if (!isRead(swap)) return swap;
  if (swap.value !== null) {
    const w = words(swap.value.data);
    const liquidity = w[3] === undefined ? null : decodeUint(w[3]);
    if (liquidity !== 0n) return swap;
    // The swap left no liquidity: a Mint after it, at or before the block, means there is liquidity again at that price.
    const mint = await lastEventBefore(source.pair, TOPICS.mint, block, opts, floor);
    if (!isRead(mint)) return mint;
    return mint.value !== null && byPosition(mint.value, swap.value) > 0 ? { ...swap, liquidityAfter: 'PRESENT' } : swap;
  }
  const init = await lastEventBefore(source.pair, TOPICS.initialize, block, opts, floor);
  if (!isRead(init) || init.value === null) return init;
  const [mint, burn] = await Promise.all([lastEventBefore(source.pair, TOPICS.mint, block, opts, floor), lastEventBefore(source.pair, TOPICS.burn, block, opts, floor)]);
  if (!isRead(mint)) return mint;
  if (!isRead(burn)) return burn;
  if (mint.value === null) return { ...init, value: null };
  // Liquidity was added and then some removed, with no swap to say what is left: not a definite reading.
  if (burn.value !== null && byPosition(burn.value, mint.value) > 0) return { ...init, liquidityAfter: 'UNCERTAIN' };
  return init;
}

async function poolPriceByState(source: PriceSource, s: Sides, block: number, opts: RpcOptions): Promise<Reading<PoolPrice>> {
  if (source.kind === 'uniswap-v2-pair') {
    const raw = await callAt(source.pair, SEL.getReserves, block, 'getReserves()', opts);
    if (!isRead(raw)) return raw;
    const w = words(raw.value);
    const r0 = w[0] === undefined ? null : decodeUint(w[0]);
    const r1 = w[1] === undefined ? null : decodeUint(w[1]);
    if (r0 === null || r1 === null) return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'getReserves() undecodable' });
    return { ...raw, value: { kind: 'uniswap-v2-pair', reserveCurb: s.curbIs0 ? r0 : r1, reserveQuote: s.curbIs0 ? r1 : r0 } };
  }
  const [raw, liquidity] = await Promise.all([callAt(source.pair, SEL.slot0, block, 'slot0()', opts), uintAt(source.pair, SEL.liquidity, block, 'liquidity()', opts)]);
  if (!isRead(raw)) return raw;
  if (!isRead(liquidity)) return liquidity;
  const w = words(raw.value);
  const sqrt = w[0] === undefined ? null : decodeUint(w[0]);
  if (sqrt === null) return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'slot0() undecodable' });
  return { ...raw, value: { kind: 'uniswap-v3-pool', sqrtPriceX96: sqrt, liquidity: liquidity.value } };
}

async function poolPriceByEvents(source: PriceSource, s: Sides, block: number, opts: RpcOptions): Promise<Reading<PoolPrice>> {
  const last = await lastPriceEventBefore(source, block, opts);
  if (!isRead(last)) return last;
  if (last.value === null) {
    return unread('FIELD_ABSENT', { source: last.source, detail: `${NO_PRICE_AT_BLOCK} ${block}: no ${source.kind === 'uniswap-v2-pair' ? 'Sync from the pair' : 'Swap from the pool, nor an Initialize with liquidity,'} at or before it, back to block ${source.fromBlock ?? 0}` });
  }
  if (last.liquidityAfter === 'UNCERTAIN') return unread('FIELD_ABSENT', { source: last.source, detail: `the pool's liquidity at block ${block} cannot be told from its events (liquidity was added and then removed with no swap since); by state only` });
  const price = decodePoolEvent(source, s, last.value);
  if (price === null) return unread('SOURCE_MALFORMED', { source: last.source, detail: 'the pool event is undecodable' });
  if ((last.value.topics[0] ?? '').toLowerCase() === TOPICS.initialize) {
    // Priced from the Initialize: the pool has not swapped under the Swap topic the reader knows. If its price by state at the head has moved from that, it swapped under another — a pool of another kind, never priced from its first price.
    const head = await readBlockNumber(opts);
    if (!isRead(head)) return head;
    const [slot0, sawSwap] = await Promise.all([callAt(source.pair, SEL.slot0, 'latest', 'slot0()', opts), lastEventBefore(source.pair, TOPICS.swap, head.value, opts, source.fromBlock ?? 0)]);
    if (!isRead(slot0)) return slot0;
    if (!isRead(sawSwap)) return sawSwap;
    const headSqrt = words(slot0.value)[0] === undefined ? null : decodeUint(words(slot0.value)[0]!);
    if (sawSwap.value === null && headSqrt !== null && price.kind === 'uniswap-v3-pool' && headSqrt !== price.sqrtPriceX96) {
      return unread('SOURCE_MALFORMED', { source: slot0.source, detail: `the pool's price moved from its Initialize without a Swap the reader recognises; the recorded kind is not this pool's interface` });
    }
  }
  return { ...last, value: price.kind === 'uniswap-v3-pool' && last.liquidityAfter === 'PRESENT' ? { ...price, liquidity: 1n } : price };
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

/**
 * The feed's last AnswerUpdated at or before the block, from the aggregator
 * behind the proxy. A proxy is re-pointed at a new aggregator now and then
 * (a new phase); a block before the current aggregator's first answer is
 * looked for on the earlier phases' aggregators, a few steps back, so a
 * top-up from before the switch is priced by the answer the feed gave then.
 */
async function feedByEvents(feed: string, block: number, opts: RpcOptions): Promise<Reading<FeedAnswer>> {
  const [aggregator, decimals, phase] = await Promise.all([addressAt(feed, SEL.aggregator, 'latest', 'aggregator()', opts), uintAt(feed, SEL.decimals, 'latest', 'feed decimals()', opts), uintAt(feed, SEL.phaseId, 'latest', 'phaseId()', opts)]);
  if (!isRead(aggregator)) return aggregator;
  if (!isRead(decimals)) return decimals;
  let at = aggregator.value;
  let phaseNo = isRead(phase) ? Number(phase.value) : null;
  const seen: string[] = [];
  for (let step = 0; step <= FEED_PHASES_BACK; step += 1) {
    seen.push(at);
    const last = await lastEventBefore(at, TOPICS.answerUpdated, block, opts);
    if (!isRead(last)) return last;
    if (last.value !== null) {
      const answer = last.value.topics[1] === undefined ? null : decodeInt(last.value.topics[1]);
      const updatedAt = words(last.value.data)[0] === undefined ? null : decodeUint(words(last.value.data)[0]!);
      if (answer === null || updatedAt === null) return unread('SOURCE_MALFORMED', { source: last.source, detail: 'AnswerUpdated undecodable' });
      return { ...last, value: { answer, updatedAt, decimals: Number(decimals.value), eventBlock: blockOf(last.value) } };
    }
    if (phaseNo === null || phaseNo <= 1 || step === FEED_PHASES_BACK) break;
    phaseNo -= 1;
    const earlier = await addressAt(feed, `${SEL.phaseAggregators}${phaseNo.toString(16).padStart(64, '0')}`, 'latest', `phaseAggregators(${phaseNo})`, opts);
    if (!isRead(earlier)) return earlier;
    if (/^0x0{40}$/.test(earlier.value)) break;
    at = earlier.value;
  }
  return unread('FIELD_ABSENT', { source: feed, detail: `no AnswerUpdated from the feed's aggregator${seen.length > 1 ? 's' : ''} ${seen.join(', ')} at or before block ${block}` });
}

/** The feed's answer for a block, checked for sign, decimals and age against the block's own time. */
async function feedFor(feed: string, block: number, basis: Rate['basis'], opts: RpcOptions): Promise<Reading<FeedAnswer>> {
  const f = basis === 'STATE' ? await feedByState(feed, block, opts) : await feedByEvents(feed, block, opts);
  if (!isRead(f)) return f;
  if (f.value.answer <= 0n) return unread('FIELD_ABSENT', { source: f.source, detail: `the feed answered ${f.value.answer} at block ${block}; a price that is not positive is not a price` });
  if (f.value.decimals > 36) return unread('SOURCE_MALFORMED', { source: f.source, detail: `the feed reports ${f.value.decimals} decimals; beyond 36 is not handled` });
  if (f.value.updatedAt > 10n ** 12n) return unread('SOURCE_MALFORMED', { source: f.source, detail: 'the feed reports an updatedAt that is not a time' });
  const at = await timestampOf(block, opts);
  if (!isRead(at)) return at;
  const age = at.value - Number(f.value.updatedAt);
  if (age > FEED_MAX_AGE_SECONDS) return unread('SOURCE_TIMEOUT', { source: f.source, detail: `the feed's answer at block ${block} was ${Math.round(age / 3600)} hours old; older than ${FEED_MAX_AGE_SECONDS / 3600} hours is not a price for that block` });
  return f;
}

function noPrice(source: PriceSource, p: PoolPrice, block: number): string {
  if (p.kind === 'uniswap-v2-pair') return `${NO_PRICE_AT_BLOCK} ${block}: an empty side (CURB ${p.reserveCurb}, quote ${p.reserveQuote})`;
  return p.liquidity === 0n ? `${NO_PRICE_AT_BLOCK} ${block}: no liquidity — a price nobody can trade at is not a price` : `${NO_PRICE_AT_BLOCK} ${block}: the pool's price is zero`;
}

async function assemble(config: CreditsConfig, block: number, basis: Rate['basis'], opts: RpcOptions, now: Date, ctx: RateContext = {}): Promise<Reading<Rate>> {
  const source = config.priceSource;
  if (source === null) return unread('FIELD_ABSENT', { source: null, detail: 'no pool is recorded for the token; nothing is quoted until one is' });
  if (basis === 'STATE' && ctx.stateUnservedBelow !== undefined && block <= ctx.stateUnservedBelow) {
    return unread('SOURCE_MALFORMED', { source: null, detail: `the node was seen to serve no state at or below block ${ctx.stateUnservedBelow} this run; block ${block} is not asked by state` });
  }
  if (source.fromBlock !== null && block < source.fromBlock) {
    return unread('FIELD_ABSENT', { source: null, detail: `${NO_PRICE_AT_BLOCK} ${block}: it was created in block ${source.fromBlock}` });
  }
  let sidesRead: Sides;
  if (ctx.sides !== undefined) sidesRead = ctx.sides;
  else {
    const s = await sides(config, source, opts);
    if (!isRead(s)) return s;
    sidesRead = s.value;
    ctx.sides = s.value;
  }
  const s = { value: sidesRead };
  const pool = basis === 'STATE' ? await poolPriceByState(source, s.value, block, opts) : await poolPriceByEvents(source, s.value, block, opts);
  if (!isRead(pool)) {
    if (basis === 'STATE' && STATE_GONE.test(pool.detail ?? '')) ctx.stateUnservedBelow = Math.max(ctx.stateUnservedBelow ?? 0, block);
    return pool;
  }
  const perCurbAtBlock = quotePerCurb18(pool.value, s.value);
  if (perCurbAtBlock === 0n) return unread('FIELD_ABSENT', { source: pool.source, detail: noPrice(source, pool.value, block) });

  // The feed, if the quote is priced by one: the same answer for the block applies to every sample the guard weighs.
  let quote: Rate['quote'] = { kind: 'usd-stable' };
  let feedFactor: { answer: bigint; decimals: number } | null = null;
  if (source.quote.kind === 'chainlink-feed') {
    const f = await feedFor(source.quote.feed, block, basis, opts);
    if (!isRead(f)) return f;
    feedFactor = { answer: f.value.answer, decimals: f.value.decimals };
    quote = { kind: 'chainlink-feed', feed: source.quote.feed, answer: f.value.answer.toString(), decimals: f.value.decimals, updatedAt: new Date(Number(f.value.updatedAt) * 1000).toISOString(), ...(f.value.eventBlock === undefined ? {} : { eventBlock: f.value.eventBlock }) };
  }
  const toUsd = (perCurb: bigint) => (feedFactor === null ? perCurb : (perCurb * feedFactor.answer) / 10n ** BigInt(feedFactor.decimals));
  const atBlock = toUsd(perCurbAtBlock);
  if (atBlock === 0n) return unread('FIELD_ABSENT', { source: pool.source, detail: `the price rounds to zero at 18 places at block ${block}` });

  // The guard: the lowest price the pool showed in the window before the
  // block, from its events — and the price prevailing when the window
  // opened, which is the last event before it, so a quiet pool pumped just
  // before a top-up still shows the price it had for the hour before.
  const windowBlocks = guardWindowFor(config.network.chainId);
  const topic = source.kind === 'uniswap-v2-pair' ? TOPICS.sync : TOPICS.swap;
  const windowStart = Math.max(0, block - windowBlocks);
  let lowest = atBlock;
  let lowestAtBlock: number | null = null;
  let samples = 0;
  const weigh = (log: LogEntry) => {
    const p = decodePoolEvent(source, s.value, log);
    if (p === null) return;
    const per = quotePerCurb18(p, s.value);
    if (per === 0n) return;
    samples += 1;
    const usd = toUsd(per);
    if (usd < lowest) {
      lowest = usd;
      lowestAtBlock = blockOf(log);
    }
  };
  const opening = windowStart > 0 ? await lastPriceEventBefore(source, windowStart - 1, opts) : null;
  if (opening !== null && !isRead(opening)) return unread(opening.reason, { source: opening.source, detail: `the price at the opening of the guard window before block ${block} could not be read (${opening.detail ?? opening.reason}); a rate without its guard is not stated` });
  if (opening !== null && opening.value !== null && opening.liquidityAfter !== 'UNCERTAIN') weigh(opening.value);
  if (source.kind === 'uniswap-v3-pool') {
    // The pool's first price counts too when it was set inside the window and liquidity followed by the block.
    const init = await lastEventBefore(source.pair, TOPICS.initialize, block, opts, source.fromBlock ?? 0);
    if (!isRead(init)) return unread(init.reason, { source: init.source, detail: `the pool's Initialize could not be looked for (${init.detail ?? init.reason}); a rate without its guard is not stated` });
    if (init.value !== null && blockOf(init.value) >= windowStart) {
      const mint = await lastEventBefore(source.pair, TOPICS.mint, block, opts, source.fromBlock ?? 0);
      if (!isRead(mint)) return unread(mint.reason, { source: mint.source, detail: `the pool's Mint could not be looked for (${mint.detail ?? mint.reason}); a rate without its guard is not stated` });
      if (mint.value !== null) weigh(init.value);
    }
  }
  const window = await foldEventsInRange(source.pair, topic, windowStart, block, opts, weigh, { pages: GUARD_MAX_PAGES });
  if (!isRead(window)) return unread(window.reason, { source: window.source, detail: `the guard window before block ${block} could not be read (${window.detail ?? window.reason}); a rate without its guard is not stated` });
  const guard: Rate['guard'] = { windowBlocks, samples, lowestAtBlock, atBlockUsdPerCurb18: atBlock.toString(), applied: lowest < atBlock };

  // The supply at the block by state; at the head by events, and said so.
  const supply = await uintAt(config.token, SEL.totalSupply, basis === 'STATE' ? block : 'latest', 'totalSupply()', opts);
  if (!isRead(supply)) return supply;
  const marketCapUsd18 = (supply.value * atBlock) / 10n ** BigInt(s.value.curbDecimals);

  const p = pool.value;
  const poolOut: Rate['pool'] = {
    kind: source.kind,
    address: source.pair,
    quoteAddress: s.value.quoteAddress,
    quoteDecimals: s.value.quoteDecimals,
    ...(p.kind === 'uniswap-v2-pair' ? { reserveCurb: p.reserveCurb.toString(), reserveQuote: p.reserveQuote.toString() } : { sqrtPriceX96: p.sqrtPriceX96.toString(), liquidity: p.liquidity.toString() }),
    ...(p.eventBlock === undefined ? {} : { eventBlock: p.eventBlock }),
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
      token: { address: config.token, decimals: s.value.curbDecimals, supply: supply.value.toString(), supplyAt: basis === 'STATE' ? 'BLOCK' : 'HEAD' },
      pool: poolOut,
      quote,
      guard,
      usdPerCurb18: lowest.toString(),
      marketCapUsd18: marketCapUsd18.toString(),
      source: pool.source,
      readAt: now.toISOString(),
    },
  } as Reading<Rate>;
}

/** The pool's price and the token's supply at one block, by state, guarded, reduced to a price and a market capitalisation. */
/**
 * Is the record's `priceSource.fromBlock` at or before the pool's first log?
 * A fromBlock later than that would send every top-up between the two to
 * the head's rate instead of its own block's, so it is not taken on the
 * configuration's word. What is asked is whether the pool emitted anything
 * before fromBlock: one query over [0, fromBlock − 1] on a node that serves
 * any width (a refusal for matching too much is itself the answer: logs
 * exist there); on a node that caps the width of a query, pages of the
 * width it serves, walked down from fromBlock, at most POOL_CHECK_MAX_READS
 * of them — the check then covers that span and says so. A check the node
 * could not make is UNREAD, not a refusal; the result is kept per pool and
 * fromBlock so it is made once.
 */
export const POOL_CHECK_MAX_READS = 64;
export const POOL_CHECK_BUDGET_MS = 20_000;
export interface PoolCreationCheck {
  /** True once the span is covered with no log; false when a log was found before fromBlock; null while the span is still being read (resumed next run). */
  readonly ok: boolean | null;
  /** A log of the pool before fromBlock, when one was found: the block. */
  readonly logBefore: number | null;
  /** The lowest block the check read down to; 0 when the whole span was covered. */
  readonly coveredFrom: number;
  /** The page width the node was last serving, kept so a resumed check does not halve its way down again. */
  readonly pageWidth?: number;
}
export async function checkPoolCreation(config: CreditsConfig, opts: RpcOptions, progress: { readonly resumeBelow?: number | null; readonly pageWidth?: number | null; readonly deadline?: number } = {}): Promise<Reading<PoolCreationCheck>> {
  const source = config.priceSource;
  const now = new Date().toISOString();
  const deadline = progress.deadline ?? Date.now() + POOL_CHECK_BUDGET_MS;
  if (source === null || source.fromBlock === null || source.fromBlock === 0) return { state: 'VERIFIED', value: { ok: true, logBefore: null, coveredFrom: 0 }, ageSeconds: 0, source: 'the record', retrievedAt: now };
  const top = progress.resumeBelow !== undefined && progress.resumeBelow !== null ? progress.resumeBelow - 1 : source.fromBlock - 1;
  if (top < 0) return { state: 'VERIFIED', value: { ok: true, logBefore: null, coveredFrom: 0 }, ageSeconds: 0, source: 'the record', retrievedAt: now };
  // Pages narrower than this are given up on: a pool with more logs than the node can answer for in a day of blocks is not one whose creation this reads.
  const timedOpts: RpcOptions = { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? 15_000, 8_000) };
  let width = top + 1;
  let source_ = 'the node';
  if (progress.pageWidth === undefined || progress.pageWidth === null) {
    const whole = await readLogs(source.pair, [], 0, top, timedOpts);
    if (isRead(whole)) {
      const first = whole.value.length === 0 ? null : whole.value.map(blockOf).reduce((a, b) => Math.min(a, b));
      return { ...whole, value: { ok: first === null, logBefore: first, coveredFrom: 0 } };
    }
    if (!halveable(whole)) return whole;
    // Refused for matching too much: that is logs before fromBlock, unless the refusal was for the query's width or its time.
    const widthCapped = whole.reason === 'SOURCE_TIMEOUT' || /block range|ranges? over \d+ blocks|range too (?:large|wide)|narrower (?:fromBlock|range)/i.test(whole.detail ?? '');
    if (!widthCapped) return { ...whole, state: 'VERIFIED', value: { ok: false, logBefore: top, coveredFrom: 0 }, ageSeconds: 0, retrievedAt: now } as Reading<PoolCreationCheck>;
    source_ = whole.source ?? source_;
  } else {
    width = progress.pageWidth;
  }
  // Width-capped: find the width served, then page down from fromBlock, within the run's time; what is not reached is read next run, at the width last served.
  let hi = top;
  for (let i = 0; i < POOL_CHECK_MAX_READS && Date.now() < deadline; i += 1) {
    const lo = Math.max(0, hi - width + 1);
    const page = await readLogs(source.pair, [], lo, hi, timedOpts);
    if (!isRead(page)) {
      if (!halveable(page) || width <= MIN_PAGE_BLOCKS) return page;
      width = Math.floor(width / 2);
      continue;
    }
    source_ = page.source;
    if (page.value.length > 0) return { ...page, value: { ok: false, logBefore: page.value.map(blockOf).reduce((a, b) => Math.min(a, b)), coveredFrom: lo, pageWidth: width } };
    if (lo === 0) return { ...page, value: { ok: true, logBefore: null, coveredFrom: 0, pageWidth: width } };
    hi = lo - 1;
  }
  return { state: 'VERIFIED', value: { ok: null, logBefore: null, coveredFrom: hi + 1, pageWidth: width }, ageSeconds: 0, source: source_, retrievedAt: now };
}

export async function readRate(config: CreditsConfig, block: number, opts: RpcOptions, now: Date = new Date(), ctx: RateContext = {}): Promise<Reading<Rate>> {
  return assemble(config, block, 'STATE', opts, now, ctx);
}

/** The same, from the pool's (and the feed's) last event at or before the block, for a block the node no longer serves by state. */
export async function readRateFromEvents(config: CreditsConfig, block: number, opts: RpcOptions, now: Date = new Date(), ctx: RateContext = {}): Promise<Reading<Rate>> {
  return assemble(config, block, 'EVENTS', opts, now, ctx);
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
