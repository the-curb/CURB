/**
 * Capture the book: which venues hold a market in the issuer's stock tokens,
 * asked of the venues themselves.
 *
 * Nothing here is taken from an aggregator's label. Every pool is discovered by
 * asking the factory the question only it can answer — `getPool` on the v3
 * factory, `getPair` on the v2 factory — or, for v4 where a pool has no address
 * at all, by recomputing the pool id from a key and asking the StateView lens
 * whether that id has ever been given a price. A key that names no pool answers
 * with a zero square root, which is an absence and is recorded as one.
 *
 * The output is a generated module, like the feed directory and the stock-token
 * registry before it: committed, carrying the block it was read at, and re-run
 * rather than edited. A pool created after the capture is not in the book until
 * the capture runs again — a stated boundary, and `--check` prints what moved.
 *
 * Run: node scripts/capture-stock-pools.ts [--write] [--check] [--all]
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { activeNetwork, rpcUrl } from '../lib/chain/networks.ts';
import { readHead, readChainId } from '../lib/chain/rpc.ts';
import { readMany, type Call } from '../lib/chain/multicall.ts';
import { decodeAddressWord, decodeUint, words } from '../lib/chain/abi.ts';
import { selector } from '../lib/chain/keccak.ts';
import { isRead } from '../lib/doctrine/reading.ts';
import { STOCK_TOKENS } from '../lib/chain/stock-tokens.ts';
import { TOKENS } from '../lib/chain/tokens.ts';
import { poolIdOf, ZERO_ADDRESS, type V4PoolKey } from '../lib/chain/uniswap-v4.ts';
import { VENUES, V3_FEE_TIERS, V4_TIERS, V4_HOOKS } from '../lib/chain/venues.ts';

const OUTPUT = 'lib/chain/stock-pools.ts';

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

interface Quote {
  readonly key: string;
  readonly label: string;
  readonly address: string;
  readonly decimals: number;
  /** The feed that turns this quote asset into US dollars. */
  readonly feedKey: string;
  /** v2 and v3 hold ERC-20s only; native ETH exists as a currency in v4 alone. */
  readonly erc20: boolean;
}

const QUOTES: readonly Quote[] = [
  { key: 'usdg', label: 'USDG', address: usdg.address, decimals: usdg.observedDecimals, feedKey: 'usdg-usd', erc20: true },
  { key: 'weth', label: 'WETH', address: weth.address, decimals: weth.observedDecimals, feedKey: 'eth-usd', erc20: true },
  { key: 'eth', label: 'native ETH', address: ZERO_ADDRESS, decimals: 18, feedKey: 'eth-usd', erc20: false },
];

function sortedPair(a: string, b: string): readonly [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return BigInt(x) < BigInt(y) ? [x, y] : [y, x];
}

function v4Key(token: string, quote: string, fee: number, tickSpacing: number, hooks: string): V4PoolKey {
  const [currency0, currency1] = sortedPair(token, quote);
  return { currency0, currency1, fee, tickSpacing, hooks: hooks.toLowerCase() };
}

interface PoolRecord {
  key: string;
  ticker: string;
  token: string;
  tokenDecimals: number;
  feedKey: string;
  venue: 'v2' | 'v3' | 'v4';
  /** v2 and v3: the pool's own address. v4: the PoolManager, which holds every pool. */
  address: string;
  /** v4 only. */
  poolId: string | null;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  quoteKey: string;
  quoteLabel: string;
  quoteAddress: string;
  quoteDecimals: number;
  quoteFeedKey: string;
  /** True when the stock token is currency0 — decided by address order, not by hope. */
  tokenIsCurrency0: boolean;
  decimals0: number;
  decimals1: number;
}

function recordOf(
  t: (typeof STOCK_TOKENS)[number],
  q: Quote,
  venue: PoolRecord['venue'],
  address: string,
  opts: { poolId?: string; fee?: number; tickSpacing?: number; hooks?: string },
): PoolRecord {
  const tokenIsCurrency0 = BigInt(t.address.toLowerCase()) < BigInt(q.address.toLowerCase());
  const suffix = venue === 'v4'
    ? `v4-${opts.fee}-${opts.tickSpacing}-${opts.hooks === ZERO_ADDRESS ? 'nohook' : 'hook'}`
    : venue === 'v3'
      ? `v3-${opts.fee}`
      : 'v2';
  return {
    key: `${t.ticker.toLowerCase()}-${q.key}-${suffix}`,
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

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const check = args.has('--check');
  const network = activeNetwork();
  const opts = { intervalSeconds: 900, timeoutMs: 90_000 };

  const [chainId, head] = await Promise.all([readChainId(opts), readHead(opts)]);
  if (!isRead(chainId) || !isRead(head)) {
    console.error('the chain could not be reached; nothing is captured rather than guessed');
    process.exit(1);
  }
  if (chainId.value !== network.chainId) {
    console.error(`the node answered chain ${chainId.value}; ${network.label} is ${network.chainId}`);
    process.exit(1);
  }

  const subjects = STOCK_TOKENS.filter((t) => t.feedKey !== null);
  const retrievedAt = new Date(head.value.timestamp * 1000).toISOString();
  console.log(`# ${network.label} (${network.chainId}) via ${rpcUrl(network)}`);
  console.log(`# head ${head.value.number.toLocaleString('en-US')} at ${retrievedAt}`);
  console.log(`# asking the factories about ${subjects.length} priced stock tokens\n`);

  // ── v2 and v3: the factory is asked; a pool is never assumed ─────────────
  const calls: Call[] = [];
  const plan: { t: (typeof subjects)[number]; q: Quote; venue: 'v2' | 'v3'; fee: number | null }[] = [];
  for (const t of subjects) {
    for (const q of QUOTES) {
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
  const records: PoolRecord[] = [];
  let unreadProbes = 0;
  for (let i = 0; i < plan.length; i += 1) {
    const r = answers[i];
    const p = plan[i]!;
    if (!r || !isRead(r)) {
      unreadProbes += 1;
      continue;
    }
    const address = decodeAddressWord(r.value);
    if (address === null || address === ZERO_ADDRESS) continue;
    records.push(recordOf(p.t, p.q, p.venue, address, p.fee === null ? {} : { fee: p.fee }));
  }

  // ── v4: the id is recomputed from the key and the lens asked ─────────────
  const v4Calls: Call[] = [];
  const v4Plan: { t: (typeof subjects)[number]; q: Quote; fee: number; tickSpacing: number; hooks: string; poolId: string }[] = [];
  for (const t of subjects) {
    for (const q of QUOTES) {
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
      unreadProbes += 1;
      continue;
    }
    const sqrt = decodeUint(words(r.value)[0] ?? '');
    if (sqrt === null || sqrt === 0n) continue;
    records.push(recordOf(p.t, p.q, 'v4', VENUES.poolManager, { poolId: p.poolId, fee: p.fee, tickSpacing: p.tickSpacing, hooks: p.hooks }));
  }

  records.sort((a, b) => (a.ticker === b.ticker ? a.key.localeCompare(b.key) : a.ticker.localeCompare(b.ticker)));
  const tickers = new Set(records.map((r) => r.ticker));
  const byVenue = { v2: 0, v3: 0, v4: 0 };
  for (const r of records) byVenue[r.venue] += 1;

  console.log(`## ${records.length} pools across ${tickers.size} of ${subjects.length} priced tokens`);
  console.log(`   v2 ${byVenue.v2} · v3 ${byVenue.v3} · v4 ${byVenue.v4} · ${unreadProbes} of ${plan.length + v4Plan.length} probes unread`);
  const without = subjects.filter((t) => !tickers.has(t.ticker)).map((t) => t.ticker);
  if (without.length > 0) console.log(`   priced by the directory but holding no pool this capture can name: ${without.join(', ')}`);

  if (check && existsSync(OUTPUT)) {
    const previous = new Set([...readFileSync(OUTPUT, 'utf8').matchAll(/key: "([^"]+)"/g)].map((m) => m[1]!));
    const now = new Set(records.map((r) => r.key));
    const added = [...now].filter((k) => !previous.has(k));
    const gone = [...previous].filter((k) => !now.has(k));
    console.log(`\n## against the committed book: ${added.length} added, ${gone.length} no longer discoverable`);
    if (added.length > 0) console.log(`   added: ${added.slice(0, 20).join(', ')}${added.length > 20 ? ' …' : ''}`);
    if (gone.length > 0) console.log(`   gone:  ${gone.slice(0, 20).join(', ')}${gone.length > 20 ? ' …' : ''}`);
  }

  const lines = records.map((r) => `  ${JSON.stringify(r)},`);
  const header = [
    '/**',
    ' * Every venue holding a market in a priced stock token, as the factories',
    ' * answered on the date below. GENERATED by scripts/capture-stock-pools.ts —',
    ' * do not edit by hand; re-run the capture and commit the diff.',
    ' *',
    ' * A v2 or v3 pool is named by its own address. A v4 pool has no address: it is',
    ' * named by `poolId`, recomputed from the key recorded here, and its state is',
    ' * read from the StateView lens. `address` for a v4 row is the PoolManager,',
    ' * because that is what a reader would point at and what every event comes from.',
    ' *',
    ' * `tokenIsCurrency0` is decided by address order, which is how both the v3',
    ' * factory and the v4 key sort their pair. It decides which side of the mid the',
    ' * stock token is on, and getting it backwards would invert every price here.',
    ' */',
    '',
    'export interface StockPoolRecord {',
    '  readonly key: string;',
    '  readonly ticker: string;',
    '  readonly token: string;',
    '  readonly tokenDecimals: number;',
    '  /** The Chainlink feed that prices the underlying. The reference half of a basis. */',
    '  readonly feedKey: string;',
    "  readonly venue: 'v2' | 'v3' | 'v4';",
    '  /** The pool for v2 and v3; the PoolManager for v4. */',
    '  readonly address: string;',
    '  readonly poolId: string | null;',
    '  readonly fee: number | null;',
    '  readonly tickSpacing: number | null;',
    '  readonly hooks: string | null;',
    '  readonly quoteKey: string;',
    '  readonly quoteLabel: string;',
    '  readonly quoteAddress: string;',
    '  readonly quoteDecimals: number;',
    '  /** The feed that turns the quote asset into US dollars. */',
    '  readonly quoteFeedKey: string;',
    '  readonly tokenIsCurrency0: boolean;',
    '  readonly decimals0: number;',
    '  readonly decimals1: number;',
    '}',
    '',
    'export const STOCK_POOLS_SOURCE = {',
    `  network: ${JSON.stringify(network.label)},`,
    `  chainId: ${network.chainId},`,
    `  observedAt: ${JSON.stringify(retrievedAt)},`,
    `  observedAtBlock: ${head.value.number},`,
    `  tokensProbed: ${subjects.length},`,
    `  tokensWithAPool: ${tickers.size},`,
    `  pools: ${records.length},`,
    `  byVenue: { v2: ${byVenue.v2}, v3: ${byVenue.v3}, v4: ${byVenue.v4} },`,
    `  probesUnread: ${unreadProbes},`,
    '  /** Asked about, and therefore findable. Anything outside these was never asked. */',
    `  feeTiersAsked: ${JSON.stringify(V3_FEE_TIERS)},`,
    `  v4TiersAsked: ${JSON.stringify(V4_TIERS)},`,
    `  hooksAsked: ${JSON.stringify(V4_HOOKS)},`,
    '} as const;',
    '',
    'export const STOCK_POOLS: readonly StockPoolRecord[] = [',
  ].join('\n');

  const module = `${header}\n${lines.join('\n')}\n];\n`;
  if (write) {
    writeFileSync(OUTPUT, module);
    console.log(`\nwrote ${OUTPUT} (${records.length} pools)`);
  } else {
    console.log(`\ndry run — ${OUTPUT} not written. Pass --write to write it.`);
  }
}

await main();
