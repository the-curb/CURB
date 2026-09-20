/**
 * Which venues hold a market in the issuer's stock tokens, asked of the venues.
 *
 * One implementation, used twice: `scripts/capture-stock-pools.ts` writes the
 * generated book from it, and the Registrar runs the same discovery once a day
 * and diffs the answer against that book. Two implementations of "what pools
 * exist" would drift from each other, and the drift check would then be
 * measuring the difference between two guesses rather than between the capture
 * and the chain.
 *
 * Nothing here is taken from an aggregator. A v2 or v3 pool is discovered by
 * asking the factory the question only it can answer — `getPair`, `getPool` —
 * and a v4 pool, which has no address at all, by recomputing its id from a key
 * and asking the StateView lens whether that id has ever been given a price.
 *
 * What is NOT asked about is stated rather than implied: the fee tiers, the
 * v4 tier pairs and the hooks are declared in `venues.ts`, and a pool outside
 * them exists and is not found here.
 */

import { readMany, type Call } from './multicall.ts';
import { decodeAddressWord, decodeUint, words } from './abi.ts';
import { selector } from './keccak.ts';
import { isRead } from '../doctrine/reading.ts';
import type { RpcOptions } from './rpc.ts';
import { STOCK_TOKENS, type StockTokenRecord } from './stock-tokens.ts';
import { TOKENS } from './tokens.ts';
import { poolIdOf, ZERO_ADDRESS, type V4PoolKey } from './uniswap-v4.ts';
import { VENUES, V3_FEE_TIERS, V4_TIERS, V4_HOOKS } from './venues.ts';

const SEL = {
  getPool: selector('getPool(address,address,uint24)'),
  getPair: selector('getPair(address,address)'),
  getSlot0: selector('getSlot0(bytes32)'),
} as const;

const pad = (address: string) => address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = (n: number) => n.toString(16).padStart(64, '0');
const bytes32 = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const body = (sel: string) => sel.replace(/^0x/, '');

const usdg = TOKENS.find((t) => t.key === 'usdg')!;
const weth = TOKENS.find((t) => t.key === 'weth')!;

export interface QuoteAsset {
  readonly key: string;
  readonly label: string;
  readonly address: string;
  readonly decimals: number;
  /** The feed that turns this quote asset into US dollars. */
  readonly feedKey: string;
  /** v2 and v3 hold ERC-20s only; native ETH exists as a currency in v4 alone. */
  readonly erc20: boolean;
}

export const QUOTE_ASSETS: readonly QuoteAsset[] = [
  { key: 'usdg', label: 'USDG', address: usdg.address, decimals: usdg.observedDecimals, feedKey: 'usdg-usd', erc20: true },
  { key: 'weth', label: 'WETH', address: weth.address, decimals: weth.observedDecimals, feedKey: 'eth-usd', erc20: true },
  { key: 'eth', label: 'native ETH', address: ZERO_ADDRESS, decimals: 18, feedKey: 'eth-usd', erc20: false },
];

/** The tokens a basis can be computed for: the ones the vendor directory prices. */
export const PRICED_STOCK_TOKENS: readonly StockTokenRecord[] = STOCK_TOKENS.filter((t) => t.feedKey !== null);

export interface DiscoveredPool {
  readonly key: string;
  readonly ticker: string;
  readonly token: string;
  readonly tokenDecimals: number;
  readonly feedKey: string;
  readonly venue: 'v2' | 'v3' | 'v4';
  /** The pool for v2 and v3; the PoolManager for v4, which holds every v4 pool. */
  readonly address: string;
  readonly poolId: string | null;
  readonly fee: number | null;
  readonly tickSpacing: number | null;
  readonly hooks: string | null;
  readonly quoteKey: string;
  readonly quoteLabel: string;
  readonly quoteAddress: string;
  readonly quoteDecimals: number;
  readonly quoteFeedKey: string;
  /** Decided by address order, which is how both the v3 factory and the v4 key sort their pair. */
  readonly tokenIsCurrency0: boolean;
  readonly decimals0: number;
  readonly decimals1: number;
}

export interface Discovery {
  readonly pools: readonly DiscoveredPool[];
  readonly probesMade: number;
  /** Probes the node did not answer. A key nobody asked about is not the same as a key with no pool. */
  readonly probesUnread: number;
  readonly tickersProbed: number;
}

function v4Key(token: string, quote: string, fee: number, tickSpacing: number, hooks: string): V4PoolKey {
  const a = token.toLowerCase();
  const b = quote.toLowerCase();
  const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return { currency0, currency1, fee, tickSpacing, hooks: hooks.toLowerCase() };
}

/** The stable name of one pool in the book. Pure, so the script and the agent agree on it. */
export function poolKeyOf(ticker: string, quoteKey: string, venue: 'v2' | 'v3' | 'v4', fee: number | null, tickSpacing: number | null, hooks: string | null): string {
  const suffix =
    venue === 'v4'
      ? `v4-${fee}-${tickSpacing}-${hooks === ZERO_ADDRESS ? 'nohook' : 'hook'}`
      : venue === 'v3'
        ? `v3-${fee}`
        : 'v2';
  return `${ticker.toLowerCase()}-${quoteKey}-${suffix}`;
}

function recordOf(t: StockTokenRecord, q: QuoteAsset, venue: DiscoveredPool['venue'], address: string, opts: { poolId?: string; fee?: number; tickSpacing?: number; hooks?: string }): DiscoveredPool {
  const tokenIsCurrency0 = BigInt(t.address.toLowerCase()) < BigInt(q.address.toLowerCase());
  return {
    key: poolKeyOf(t.ticker, q.key, venue, opts.fee ?? null, opts.tickSpacing ?? null, opts.hooks ?? null),
    ticker: t.ticker,
    token: t.address.toLowerCase(),
    tokenDecimals: t.decimals,
    feedKey: t.feedKey!,
    venue,
    address: address.toLowerCase(),
    poolId: opts.poolId ?? null,
    fee: opts.fee ?? null,
    tickSpacing: opts.tickSpacing ?? null,
    hooks: opts.hooks ?? null,
    quoteKey: q.key,
    quoteLabel: q.label,
    quoteAddress: q.address.toLowerCase(),
    quoteDecimals: q.decimals,
    quoteFeedKey: q.feedKey,
    tokenIsCurrency0,
    decimals0: tokenIsCurrency0 ? t.decimals : q.decimals,
    decimals1: tokenIsCurrency0 ? q.decimals : t.decimals,
  };
}

/**
 * Every pool the declared venues admit to, for every priced stock token.
 *
 * About 1,400 subcalls over six batches, a couple of seconds. A probe the node
 * did not answer is counted, never read as "no pool": the difference decides
 * whether a missing row means the pool went away or the question went
 * unanswered, and a drift report that cannot tell them apart is noise.
 */
export async function discoverStockPools(opts: RpcOptions, subjects: readonly StockTokenRecord[] = PRICED_STOCK_TOKENS): Promise<Discovery> {
  const pools: DiscoveredPool[] = [];
  let probesUnread = 0;

  // ── v2 and v3: the factory is asked; a pool is never assumed ─────────────
  const calls: Call[] = [];
  const plan: { t: StockTokenRecord; q: QuoteAsset; venue: 'v2' | 'v3'; fee: number | null }[] = [];
  for (const t of subjects) {
    for (const q of QUOTE_ASSETS) {
      if (!q.erc20) continue;
      for (const fee of V3_FEE_TIERS) {
        calls.push({ target: VENUES.v3Factory, data: `0x${body(SEL.getPool)}${pad(t.address)}${pad(q.address)}${uint(fee)}` });
        plan.push({ t, q, venue: 'v3', fee });
      }
      calls.push({ target: VENUES.v2Factory, data: `0x${body(SEL.getPair)}${pad(t.address)}${pad(q.address)}` });
      plan.push({ t, q, venue: 'v2', fee: null });
    }
  }
  const answers = await readMany(calls, opts);
  for (let i = 0; i < plan.length; i += 1) {
    const r = answers[i];
    const p = plan[i]!;
    if (!r || !isRead(r)) {
      probesUnread += 1;
      continue;
    }
    const address = decodeAddressWord(r.value);
    if (address === null || address === ZERO_ADDRESS) continue;
    pools.push(recordOf(p.t, p.q, p.venue, address, p.fee === null ? {} : { fee: p.fee }));
  }

  // ── v4: no address exists, so the id is recomputed and the lens asked ────
  const v4Calls: Call[] = [];
  const v4Plan: { t: StockTokenRecord; q: QuoteAsset; fee: number; tickSpacing: number; hooks: string; poolId: string }[] = [];
  for (const t of subjects) {
    for (const q of QUOTE_ASSETS) {
      for (const [fee, tickSpacing] of V4_TIERS) {
        for (const hooks of V4_HOOKS) {
          const poolId = poolIdOf(v4Key(t.address, q.address, fee, tickSpacing, hooks));
          v4Calls.push({ target: VENUES.stateView, data: `0x${body(SEL.getSlot0)}${bytes32(poolId)}` });
          v4Plan.push({ t, q, fee, tickSpacing, hooks, poolId });
        }
      }
    }
  }
  const v4Answers = await readMany(v4Calls, opts);
  for (let i = 0; i < v4Plan.length; i += 1) {
    const r = v4Answers[i];
    const p = v4Plan[i]!;
    if (!r || !isRead(r)) {
      probesUnread += 1;
      continue;
    }
    const sqrt = decodeUint(words(r.value)[0] ?? '');
    if (sqrt === null || sqrt === 0n) continue;
    pools.push(recordOf(p.t, p.q, 'v4', VENUES.poolManager, { poolId: p.poolId, fee: p.fee, tickSpacing: p.tickSpacing, hooks: p.hooks }));
  }

  pools.sort((a, b) => (a.ticker === b.ticker ? a.key.localeCompare(b.key) : a.ticker.localeCompare(b.ticker)));
  return { pools, probesMade: plan.length + v4Plan.length, probesUnread, tickersProbed: subjects.length };
}
