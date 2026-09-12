import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NETWORKS } from '../lib/chain/networks.ts';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import { selector } from '../lib/chain/keccak.ts';
import { CREDITS_ENV, parseCreditsConfig, type CreditsConfig } from '../lib/credits/config.ts';
import { admit, gate, settle } from '../lib/credits/guard.ts';
import { verifyDeskCode } from '../lib/credits/code.ts';
import { receipts } from '../lib/credits/receipts.ts';
import { addressWord, buildRecord } from '../lib/positions/code.ts';
import { INDEX_KEY, TOPUP_TOPIC, decodeTopUp, syncTopUps, type RateReaders } from '../lib/credits/indexer.ts';
import { charge, isKey, keyAccount, keyHashOf, newKey, spendRow, topUpsRow } from '../lib/credits/keys.ts';
import { latestRate, runCredits } from '../lib/credits/maintenance.ts';
import { MINIMUM_OPEN_CENTS, SERVICES, centsText } from '../lib/credits/prices.ts';
import { TOPICS, centsForCurb, curbForCents, curbText, readRate, readRateFromEvents, usd18Text, type Rate } from '../lib/credits/rate.ts';
import { createSubscription, deliveryFault, fanOut, isPrivateAddress, subscriptionsOf, webhookFault } from '../lib/credits/subscriptions.ts';
import { positionConditions, type Condition } from '../lib/ops/alerts.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * The credit desk, site side: prices in dollars, a rate read from a pool at
 * a block, top-ups credited at that rate and never twice, a gate that
 * charges before it answers and refuses with the figures when it cannot,
 * and a fan-out that charges only what was delivered.
 */

const CURB = '0x1000000000000000000000000000000000000001';
const USDC = '0x2000000000000000000000000000000000000002';
const PAIR = '0x3000000000000000000000000000000000000003';
const DESK = '0x4000000000000000000000000000000000000004';
const FEED = '0x5000000000000000000000000000000000000005';
const AGGREGATOR = '0x6000000000000000000000000000000000000006';
const POOL3 = '0x7000000000000000000000000000000000000007';
const PAYER = '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const TREASURY = '0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e';

const word = (v: bigint) => v.toString(16).padStart(64, '0');
const hexWord = (v: bigint) => `0x${word(v)}`;
const blockHashOf = (n: number, fork = 0) => `0x${(BigInt(n) * 1_000_003n + BigInt(fork)).toString(16).padStart(64, '0')}`;

const CONFIG_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'usd-stable' } } });
const CONFIG_FEED_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'chainlink-feed', feed: FEED } } });
const CONFIG_V3_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: { kind: 'uniswap-v3-pool', pair: POOL3, quote: { kind: 'usd-stable' } } });

const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  // Newton's method from a power-of-two estimate; exact for any size of n.
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
};
/** The v3 square-root price for a ratio of token1 base units per token0 base unit given as num/den. */
const sqrtPriceX96For = (num: bigint, den: bigint): bigint => isqrt((num * (1n << 192n)) / den);
const UNREAD_READER = async () => ({ state: 'UNREAD' as const, value: null, reason: 'SOURCE_UNREACHABLE' as const, source: null, observedAt: new Date().toISOString(), detail: 'archive gone' });

/** The committed build's runtime bytecode with the immutable slots holding the given token and treasury — what a real deployment's code looks like. */
async function deskCodeFor(token: string, treasury: string): Promise<string> {
  const { build } = await buildRecord('CreditDesk');
  if (build === null) throw new Error('no CreditDesk build record');
  let code = build.deployedBytecode.replace(/^0x/, '');
  const words: Record<string, string> = { curb: addressWord(token), treasury: addressWord(treasury) };
  for (const im of build.immutables) for (const slot of im.slots) code = code.slice(0, slot.start * 2) + words[im.name] + code.slice((slot.start + slot.length) * 2);
  return '0x' + code;
}

interface NodeState {
  head: number;
  fork: number;
  /** CURB and quote reserves by block; the last entry at or before a block applies. */
  reserves: { block: number; curb: bigint; quote: bigint }[];
  logs: { block: number; keyHash: string; payer: string; amount: bigint; txHash: string; logIndex: number }[];
  supply: bigint;
  feedAnswer: bigint;
  /** What eth_getCode answers for the desk; null means no code. */
  deskCode: string | null;
  /** Blocks behind the head the node still serves state for; null means every block. */
  stateWindow: number | null;
  /** The pair's Sync events, as the chain has them (reserves in token0/token1 order = CURB/quote). */
  syncs: { block: number; curb: bigint; quote: bigint; logIndex?: number }[];
  /** A v3 pool: CURB's side, its current square-root price, its swaps and its initialisation. */
  v3: { curbIs0: boolean; sqrt: bigint; liquidity?: bigint; swaps: { block: number; sqrt: bigint; liquidity?: bigint }[] } | null;
  /** The node's cap on logs matched by one query; more than this is refused the way Robinhood Chain's node refuses. */
  logLimit: number | null;
  /** The feed's AnswerUpdated events on its aggregator. */
  feedAnswers: { block: number; answer: bigint; roundId: bigint; updatedAt: bigint }[];
  calls: string[];
}

/** A node that answers the chain id, heads, block hashes, logs and the pool's and token's views at a block. */
function fakeNode(state: NodeState) {
  const SEL = { token0: selector('token0()'), token1: selector('token1()'), getReserves: selector('getReserves()'), slot0: selector('slot0()'), liquidity: selector('liquidity()'), decimals: selector('decimals()'), totalSupply: selector('totalSupply()'), latestRoundData: selector('latestRoundData()'), aggregator: selector('aggregator()') };
  const logOf = (address: string, block: number, topics: string[], data: string, logIndex = 0) => ({ address, topics, data, blockNumber: `0x${block.toString(16)}`, blockHash: blockHashOf(block, block >= 42 ? state.fork : 0), transactionHash: `0x${block.toString(16).padStart(64, 'e')}`, logIndex: `0x${logIndex.toString(16)}` });
  const reservesAt = (block: number) => [...state.reserves].filter((r) => r.block <= block).sort((a, b) => a.block - b.block).at(-1) ?? null;
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const { method, id, params } = JSON.parse(String(init?.body)) as { method: string; id: number; params: unknown[] };
    state.calls.push(method);
    let result: unknown = null;
    let error: { code: number; message: string } | null = null;
    switch (method) {
      case 'eth_chainId':
        result = '0x7a69';
        break;
      case 'eth_getCode':
        result = (params[0] as string).toLowerCase() === DESK ? (state.deskCode ?? '0x') : '0x6001';
        break;
      case 'eth_getBlockByNumber': {
        const tag = params[0] as string;
        const n = tag === 'latest' ? state.head : Number.parseInt(tag, 16);
        // A numbered block's time is fixed by its height, so a feed's age at a block is a definite figure; the head's is now, for liveness.
        const ts = tag === 'latest' ? Math.floor(Date.now() / 1000) : 1_700_000_000 + n * 100;
        result = n > state.head ? null : { number: `0x${n.toString(16)}`, timestamp: `0x${ts.toString(16)}`, hash: blockHashOf(n, n >= 42 ? state.fork : 0) };
        break;
      }
      case 'eth_getLogs': {
        const q = params[0] as { address: string; fromBlock: string; toBlock: string; topics: string[] };
        const from = Number.parseInt(q.fromBlock, 16);
        const to = Number.parseInt(q.toBlock, 16);
        const address = q.address.toLowerCase();
        const topic = (q.topics[0] ?? '').toLowerCase();
        const within = (b: number) => b >= from && b <= to;
        const capped = (logs: unknown[]) => {
          if (state.logLimit !== null && logs.length > state.logLimit) {
            error = { code: -32000, message: `logs matched by query exceeds limit of ${state.logLimit}` };
            return null;
          }
          return logs;
        };
        if (address === PAIR && topic === TOPICS.sync) {
          result = capped(state.syncs.filter((e) => within(e.block)).map((e) => logOf(PAIR, e.block, [TOPICS.sync], `0x${word(e.curb)}${word(e.quote)}`, e.logIndex ?? 0)));
          break;
        }
        if (address === POOL3 && state.v3 !== null && topic === TOPICS.swap) {
          result = capped(state.v3.swaps.filter((e) => within(e.block)).map((e) => logOf(POOL3, e.block, [TOPICS.swap, hexWord(0n), hexWord(0n)], `0x${word(0n)}${word(0n)}${word(e.sqrt)}${word(e.liquidity ?? 1n)}${word(0n)}`)));
          break;
        }
        if (address === AGGREGATOR && topic === TOPICS.answerUpdated) {
          result = capped(state.feedAnswers.filter((e) => within(e.block)).map((e) => logOf(AGGREGATOR, e.block, [TOPICS.answerUpdated, hexWord(e.answer), hexWord(e.roundId)], hexWord(e.updatedAt))));
          break;
        }
        result = state.logs
          .filter((l) => within(l.block) && address === DESK)
          .map((l) => ({
            address: DESK,
            topics: [TOPUP_TOPIC, l.keyHash, `0x${l.payer.slice(2).padStart(64, '0')}`],
            data: hexWord(l.amount),
            blockNumber: `0x${l.block.toString(16)}`,
            blockHash: blockHashOf(l.block, l.block >= 42 ? state.fork : 0),
            transactionHash: l.txHash,
            logIndex: `0x${l.logIndex.toString(16)}`,
          }));
        break;
      }
      case 'eth_call': {
        const { to, data } = params[0] as { to: string; data: string };
        const tag = params[1] as string;
        const block = tag === 'latest' ? state.head : Number.parseInt(tag, 16);
        if (block > state.head) {
          error = { code: -32000, message: 'header not found' };
          break;
        }
        if (state.stateWindow !== null && block < state.head - state.stateWindow) {
          // Robinhood Chain's public node, measured 12 September 2026: state beyond its window is refused this way.
          error = { code: -32000, message: `metadata is not found, ${block + 3}` };
          break;
        }
        const t = to.toLowerCase();
        const sel = data.slice(0, 10);
        if (t === PAIR && sel === SEL.token0) result = hexWord(BigInt(CURB));
        else if (t === PAIR && sel === SEL.token1) result = hexWord(BigInt(USDC));
        else if (t === POOL3 && sel === SEL.token0) result = hexWord(BigInt(state.v3?.curbIs0 === false ? USDC : CURB));
        else if (t === POOL3 && sel === SEL.token1) result = hexWord(BigInt(state.v3?.curbIs0 === false ? CURB : USDC));
        else if (t === POOL3 && sel === SEL.slot0) result = state.v3 === null ? '0x' : `0x${word(state.v3.sqrt)}${word(0n)}${word(0n)}${word(0n)}${word(0n)}${word(0n)}${word(1n)}`;
        else if (t === POOL3 && sel === SEL.liquidity) result = state.v3 === null ? '0x' : hexWord(state.v3.liquidity ?? 1n);
        else if (t === FEED && sel === SEL.aggregator) result = hexWord(BigInt(AGGREGATOR));
        else if (t === PAIR && sel === SEL.getReserves) {
          const r = reservesAt(block);
          result = r === null ? '0x' : `0x${word(r.curb)}${word(r.quote)}${word(BigInt(block))}`;
        } else if (t === CURB && sel === SEL.decimals) result = hexWord(18n);
        else if (t === CURB && sel === SEL.totalSupply) result = hexWord(state.supply);
        else if (t === USDC && sel === SEL.decimals) result = hexWord(6n);
        else if (t === FEED && sel === SEL.decimals) result = hexWord(8n);
        else if (t === FEED && sel === SEL.latestRoundData) result = `0x${word(1n)}${word(state.feedAnswer)}${word(1_700_000_000n)}${word(1_700_000_000n)}${word(1n)}`;
        else result = '0x';
        break;
      }
      default:
        error = { code: -32601, message: `method ${method} not found` };
    }
    return new Response(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return fetch as unknown as typeof globalThis.fetch;
}

function freshState(): NodeState {
  // 4,000,000 CURB against 20,000 USDC: US$0.005 a CURB; a supply of 1e9 makes the market cap US$5,000,000.
  return { head: 100, fork: 0, reserves: [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n }], logs: [], supply: 10n ** 9n * 10n ** 18n, feedAnswer: 0n, deskCode: null, stateWindow: null, syncs: [], v3: null, feedAnswers: [], logLimit: null, calls: [] };
}

const profile = NETWORKS['hardhat-local'];
const opts = { profile, intervalSeconds: 900 };
const tmpStore = () => new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-credits-')));

describe('the credit desk, site side', () => {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.CURB_RPC_URL_LOCAL;
  const realDoh = process.env.CURB_DNS_OVER_HTTPS;
  const realCredits = process.env[CREDITS_ENV];

  beforeEach(() => {
    forgetChainConfirmations();
    process.env.CURB_RPC_URL_LOCAL = 'https://node.test.invalid/rpc';
    delete process.env.CURB_DNS_OVER_HTTPS;
    delete process.env[CREDITS_ENV];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.CURB_RPC_URL_LOCAL;
    else process.env.CURB_RPC_URL_LOCAL = realUrl;
    if (realDoh === undefined) delete process.env.CURB_DNS_OVER_HTTPS;
    else process.env.CURB_DNS_OVER_HTTPS = realDoh;
    if (realCredits === undefined) delete process.env[CREDITS_ENV];
    else process.env[CREDITS_ENV] = realCredits;
    forgetChainConfirmations();
  });

  it('prints cents as dollars without a float', () => {
    assert.equal(centsText(2000), 'US$20.00');
    assert.equal(centsText(5), 'US$0.05');
    assert.equal(centsText(123_456), 'US$1,234.56');
    assert.equal(centsText(0n), 'US$0.00');
    assert.equal(MINIMUM_OPEN_CENTS, 2000);
    assert.ok(SERVICES.every((s) => s.cents > 0 && s.path.startsWith('/api/')));
  });

  it('is NOT_CONFIGURED without the record and refuses a record that does not describe a desk', () => {
    assert.equal(parseCreditsConfig(undefined).state, 'NOT_CONFIGURED');
    assert.equal(parseCreditsConfig('').state, 'NOT_CONFIGURED');
    assert.equal(parseCreditsConfig('nope').state, 'CONFIG_INVALID');
    assert.equal(parseCreditsConfig(JSON.stringify({ network: 'mars' })).state, 'CONFIG_INVALID');
    assert.equal(parseCreditsConfig(JSON.stringify({ network: 'hardhat-local', token: CURB, desk: CURB, fromBlock: 1, priceSource: {} })).state, 'CONFIG_INVALID');
    assert.equal(parseCreditsConfig(JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 1, priceSource: { kind: 'oracle-of-nothing' } })).state, 'CONFIG_INVALID');
    assert.equal(parseCreditsConfig(JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, fromBlock: 1, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'usd-stable' } } })).state, 'CONFIG_INVALID', 'no treasury named');
    assert.equal(parseCreditsConfig(JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: DESK, fromBlock: 1, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'usd-stable' } } })).state, 'CONFIG_INVALID', 'the desk as its own treasury');
    const ok = parseCreditsConfig(CONFIG_JSON);
    assert.equal(ok.state, 'CONFIGURED');
    if (ok.state === 'CONFIGURED') {
      assert.equal(ok.config.network.chainId, 31337);
      assert.equal(ok.config.priceSource?.pair, PAIR);
      assert.equal(ok.config.priceSource?.quote.kind, 'usd-stable');
      const noPool = parseCreditsConfig(JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: null }));
      assert.equal(noPool.state, 'CONFIGURED', 'a desk without a pool yet is configured; nothing is priced');
      assert.equal(noPool.state === 'CONFIGURED' ? noPool.config.priceSource : 'x', null);
      assert.equal(ok.config.treasury, TREASURY);
    }
  });

  it('verifies the desk’s code against the committed build and the record’s treasury, and names what is wrong', async () => {
    const state = freshState();
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;

    const none = await verifyDeskCode(config, opts, new Date());
    assert.equal(none.state, 'MISMATCH');
    assert.equal(none.detail, 'no code at the address');

    state.deskCode = await deskCodeFor(CURB, TREASURY);
    const right = await verifyDeskCode(config, opts, new Date());
    assert.equal(right.state, 'MATCHES', right.detail ?? '');
    assert.deepEqual(right.immutables.map((i) => [i.name, i.matches]), [['curb', true], ['treasury', true]]);
    assert.ok(right.buildCommit && right.codeHash);

    state.deskCode = await deskCodeFor(CURB, PAYER);
    const elsewhere = await verifyDeskCode(config, opts, new Date());
    assert.equal(elsewhere.state, 'MISMATCH');
    assert.match(elsewhere.detail ?? '', /treasury in it is not what the record says/);
    assert.deepEqual(elsewhere.immutables.map((i) => [i.name, i.matches]), [['curb', true], ['treasury', false]]);

    state.deskCode = (await deskCodeFor(CURB, TREASURY)).replace(/..$/, 'ff');
    const other = await verifyDeskCode(config, opts, new Date());
    assert.equal(other.state, 'MISMATCH');
    assert.match(other.detail ?? '', /differs from the build/);
  });

  it('makes keys the desk never stores, and hashes them the way the chain sees them', () => {
    const key = newKey();
    assert.ok(isKey(key), key);
    assert.notEqual(newKey(), key);
    assert.equal(keyHashOf('abc'), '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 of "abc", the published vector');
    assert.ok(/^0x[0-9a-f]{64}$/.test(keyHashOf(key)));
    assert.equal(isKey('curb_short'), false);
    assert.equal(isKey(`sk_${'a'.repeat(43)}`), false);
  });

  it('converts between cents and CURB in base units, rounding once and in the payer’s disfavour', () => {
    const rate: Rate = {
      block: 100,
      basis: 'STATE',
      token: { address: CURB, decimals: 18, supply: (10n ** 27n).toString(), supplyAt: 'BLOCK' },
      pool: { kind: 'uniswap-v2-pair', address: PAIR, reserveCurb: '0', reserveQuote: '0', quoteAddress: USDC, quoteDecimals: 6 },
      quote: { kind: 'usd-stable' },
      guard: { windowBlocks: 40, samples: 0, lowestAtBlock: null, atBlockUsdPerCurb18: (5n * 10n ** 15n).toString(), applied: false },
      usdPerCurb18: (5n * 10n ** 15n).toString(), // US$0.005
      marketCapUsd18: (5_000_000n * 10n ** 18n).toString(),
      source: 'test',
      readAt: '2026-09-12T00:00:00.000Z',
    };
    assert.equal(centsForCurb(rate, 4_000n * 10n ** 18n), 2000n, '4,000 CURB at US$0.005 is US$20.00');
    assert.equal(curbForCents(rate, 2000n), 4_000n * 10n ** 18n);
    assert.equal(centsForCurb(rate, 10n ** 18n), 0n, 'one CURB is half a cent: floors to nothing');
    assert.equal(curbForCents(rate, 1n), 2n * 10n ** 18n, 'one cent needs two CURB');
    assert.equal(curbForCents(rate, 3n), 6n * 10n ** 18n);
    assert.equal(centsForCurb(rate, 6n * 10n ** 18n), 3n);
    const six: Rate = { ...rate, token: { ...rate.token, decimals: 6 } };
    assert.equal(curbForCents(six, 2000n), 4_000n * 10n ** 6n, 'a six-decimal token needs six-decimal base units');
    assert.equal(usd18Text(rate.usdPerCurb18, 8), 'US$0.00500000');
    assert.equal(usd18Text(rate.marketCapUsd18, 2), 'US$5,000,000.00');
    assert.equal(curbText(4_000n * 10n ** 18n, 18), '4,000');
    assert.equal(curbText(4_000_500_000_000_000_000_000n, 18), '4,000.5');
  });

  it('reads the pool and the supply at a block into a price and a market cap, and has no price for an empty pool', async () => {
    const state = freshState();
    globalThis.fetch = fakeNode(state);
    const parsed = parseCreditsConfig(CONFIG_JSON);
    assert.equal(parsed.state, 'CONFIGURED');
    const config = (parsed as { config: CreditsConfig }).config;

    const rate = await readRate(config, 100, opts);
    if (rate.state === 'UNREAD') assert.fail(JSON.stringify(rate));
    assert.equal(rate.state, 'VERIFIED');
    assert.equal(rate.value.usdPerCurb18, (5n * 10n ** 15n).toString());
    assert.equal(rate.value.marketCapUsd18, (5_000_000n * 10n ** 18n).toString());
    assert.equal(rate.value.pool.quoteAddress, USDC);
    assert.equal(rate.value.pool.quoteDecimals, 6);
    assert.equal(rate.value.basis, 'STATE');
    assert.equal(rate.value.token.decimals, 18);
    assert.equal(curbForCents(rate.value, 2000n), 4_000n * 10n ** 18n);

    // The pool moves at block 60: twice the dollars for the same CURB. The earlier block still prices as it did.
    state.reserves.push({ block: 60, curb: 4_000_000n * 10n ** 18n, quote: 40_000n * 10n ** 6n });
    const later = await readRate(config, 100, opts);
    const earlier = await readRate(config, 50, opts);
    assert.equal(later.state === 'UNREAD' ? null : later.value.usdPerCurb18, (10n ** 16n).toString());
    assert.equal(earlier.state === 'UNREAD' ? null : earlier.value.usdPerCurb18, (5n * 10n ** 15n).toString());

    state.reserves = [{ block: 0, curb: 0n, quote: 0n }];
    const empty = await readRate(config, 100, opts);
    assert.equal(empty.state, 'UNREAD');
    assert.match(empty.state === 'UNREAD' ? (empty.detail ?? '') : '', /empty side/);

    const beyond = await readRate(config, 101, opts);
    assert.equal(beyond.state, 'UNREAD', 'a block the node does not have is not priced');
  });

  it('prices a quote asset through a feed, and refuses a feed that answers nothing positive', async () => {
    const state = freshState();
    // The quote is worth US$2,500 each (an ETH-like asset): 20,000 of it against 4,000,000 CURB is US$12.50 a CURB.
    state.feedAnswer = 2_500n * 10n ** 8n;
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_FEED_JSON) as { config: CreditsConfig }).config;
    const rate = await readRate(config, 100, opts);
    if (rate.state === 'UNREAD') assert.fail(JSON.stringify(rate));
    assert.equal(rate.state, 'VERIFIED');
    assert.equal(rate.value.usdPerCurb18, (125n * 10n ** 17n).toString());
    assert.equal(rate.value.quote.kind, 'chainlink-feed');
    state.feedAnswer = 0n;
    const none = await readRate(config, 100, opts);
    assert.equal(none.state, 'UNREAD');

    // By events: the aggregator's last AnswerUpdated at or before the block, not a later one.
    state.syncs = [{ block: 10, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n }];
    state.feedAnswers = [
      { block: 20, answer: 2_500n * 10n ** 8n, roundId: 1n, updatedAt: 1_700_000_000n },
      { block: 80, answer: 5_000n * 10n ** 8n, roundId: 2n, updatedAt: 1_700_000_600n },
    ];
    const at50 = await readRateFromEvents(config, 50, opts);
    if (at50.state === 'UNREAD') assert.fail(JSON.stringify(at50));
    assert.equal(at50.value.usdPerCurb18, (125n * 10n ** 17n).toString(), 'the US$2,500 answer at block 20 applies at block 50');
    assert.equal(at50.value.quote.kind === 'chainlink-feed' ? at50.value.quote.eventBlock : null, 20);
    const at90 = await readRateFromEvents(config, 90, opts);
    if (at90.state === 'UNREAD') assert.fail(JSON.stringify(at90));
    assert.equal(at90.value.usdPerCurb18, (25n * 10n ** 18n).toString(), 'the US$5,000 answer at block 80 applies at block 90');

    // A feed that stopped: its last answer was days before the block, so it is not a price for that block.
    state.feedAnswers = [{ block: 20, answer: 2_500n * 10n ** 8n, roundId: 1n, updatedAt: 1_700_000_000n - 5n * 86_400n }];
    const stale = await readRateFromEvents(config, 50, opts);
    assert.equal(stale.state, 'UNREAD');
    assert.match(stale.state === 'UNREAD' ? (stale.detail ?? '') : '', /hours old/);
  });

  it('prices at a block from the pair’s own Sync events when the node no longer serves the state, and never from a later event', async () => {
    const state = freshState();
    state.stateWindow = 30;
    state.syncs = [
      { block: 10, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n },
      { block: 42, curb: 4_000_000n * 10n ** 18n, quote: 30_000n * 10n ** 6n, logIndex: 3 },
      { block: 42, curb: 4_000_000n * 10n ** 18n, quote: 32_000n * 10n ** 6n, logIndex: 7 },
      { block: 60, curb: 4_000_000n * 10n ** 18n, quote: 40_000n * 10n ** 6n },
    ];
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;

    const byState = await readRate(config, 42, opts);
    assert.equal(byState.state, 'UNREAD', 'block 42 is beyond the window of 30 blocks');
    assert.match(byState.state === 'UNREAD' ? (byState.detail ?? '') : '', /metadata is not found/);

    const at42 = await readRateFromEvents(config, 42, opts);
    if (at42.state === 'UNREAD') assert.fail(JSON.stringify(at42));
    assert.equal(at42.value.basis, 'EVENTS');
    assert.equal(at42.value.guard.atBlockUsdPerCurb18, (8n * 10n ** 15n).toString(), 'the later Sync in the same block (log index 7): US$0.008 at the block');
    assert.equal(at42.value.usdPerCurb18, (5n * 10n ** 15n).toString(), 'credited at the lowest in the window before it, the Sync at block 10');
    assert.equal(at42.value.guard.lowestAtBlock, 10);
    assert.equal(at42.value.pool.eventBlock, 42);
    assert.equal(at42.value.token.supplyAt, 'HEAD');
    const at41 = await readRateFromEvents(config, 41, opts);
    if (at41.state === 'UNREAD') assert.fail(JSON.stringify(at41));
    assert.equal(at41.value.guard.atBlockUsdPerCurb18, (5n * 10n ** 15n).toString(), 'block 41 is priced by the Sync at block 10, not the one at 42');
    assert.equal(at41.value.guard.applied, false);
    const at99 = await readRateFromEvents(config, 99, opts);
    if (at99.state === 'UNREAD') assert.fail(JSON.stringify(at99));
    assert.equal(at99.value.usdPerCurb18, (10n ** 16n).toString());

    state.syncs = [];
    const none = await readRateFromEvents(config, 42, opts);
    assert.equal(none.state, 'UNREAD');
    assert.match(none.state === 'UNREAD' ? (none.detail ?? '') : '', /no Sync/);
  });

  it('reads a v3 pool by state and by events, with CURB on either side', async () => {
    const state = freshState();
    // US$0.005 a CURB with CURB as token0: token1 (6 decimals) per token0 (18 decimals) base unit is 5 × 10⁶ ÷ 10³ ÷ 10¹⁸.
    const forCurbIs0 = sqrtPriceX96For(5n * 10n ** 6n, 10n ** 3n * 10n ** 18n);
    state.v3 = { curbIs0: true, sqrt: forCurbIs0, swaps: [] };
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_V3_JSON) as { config: CreditsConfig }).config;
    const near = (v: string, target: bigint, label: string) => {
      const d = BigInt(v) > target ? BigInt(v) - target : target - BigInt(v);
      assert.ok(d * 1_000_000n <= target, `${label}: ${v} is not within a millionth of ${target}`);
    };
    const byState = await readRate(config, 100, opts);
    if (byState.state === 'UNREAD') assert.fail(JSON.stringify(byState));
    near(byState.value.usdPerCurb18, 5n * 10n ** 15n, 'v3 by state, CURB token0');
    assert.equal(byState.value.pool.kind, 'uniswap-v3-pool');
    assert.ok(byState.value.pool.sqrtPriceX96);

    // No swap yet: by events there is no traded price. A swap at block 60 doubles the price from there; at block 70 the guard's window (40 blocks on the local chain) still holds the first swap, so the credited price is the lower one.
    const none = await readRateFromEvents(config, 50, opts);
    assert.equal(none.state, 'UNREAD');
    assert.match(none.state === 'UNREAD' ? (none.detail ?? '') : '', /no Swap/);
    state.v3.swaps.push({ block: 30, sqrt: forCurbIs0 });
    state.v3.swaps.push({ block: 60, sqrt: sqrtPriceX96For(10n * 10n ** 6n, 10n ** 3n * 10n ** 18n) });
    const after = await readRateFromEvents(config, 70, opts);
    if (after.state === 'UNREAD') assert.fail(JSON.stringify(after));
    near(after.value.guard.atBlockUsdPerCurb18, 10n ** 16n, 'v3 by Swap, at the block');
    near(after.value.usdPerCurb18, 5n * 10n ** 15n, 'v3 by Swap, guarded by the swap 40 blocks before');
    assert.equal(after.value.guard.applied, true);
    const before = await readRateFromEvents(config, 59, opts);
    if (before.state === 'UNREAD') assert.fail(JSON.stringify(before));
    near(before.value.usdPerCurb18, 5n * 10n ** 15n, 'v3 before the second swap');

    // A pool with no liquidity has a price nobody can trade at: none, by state and by events.
    state.v3 = { curbIs0: true, sqrt: forCurbIs0, liquidity: 0n, swaps: [{ block: 30, sqrt: forCurbIs0, liquidity: 0n }] };
    assert.equal((await readRate(config, 100, opts)).state, 'UNREAD');
    assert.equal((await readRateFromEvents(config, 50, opts)).state, 'UNREAD');

    // CURB as token1: token1 per token0 is CURB base units per quote base unit — the inverse.
    state.v3 = { curbIs0: false, sqrt: sqrtPriceX96For(10n ** 3n * 10n ** 18n, 5n * 10n ** 6n), swaps: [] };
    const flipped = await readRate(config, 100, opts);
    if (flipped.state === 'UNREAD') assert.fail(JSON.stringify(flipped));
    near(flipped.value.usdPerCurb18, 5n * 10n ** 15n, 'v3 by state, CURB token1');
    assert.equal(flipped.value.pool.quoteAddress, USDC);
  });

  it('decodes a TopUp and sets aside a log that is not one', () => {
    const keyHash = keyHashOf('curb_test');
    const decoded = decodeTopUp({ address: DESK, topics: [TOPUP_TOPIC, keyHash, `0x${PAYER.slice(2).padStart(64, '0')}`], data: hexWord(7n), blockNumber: '0x2a', blockHash: blockHashOf(42), transactionHash: '0xAB', logIndex: '0x1' });
    assert.equal(decoded.ok, true);
    if (decoded.ok === true) {
      assert.equal(decoded.topUp.keyHash, keyHash);
      assert.equal(decoded.topUp.payer, PAYER);
      assert.equal(decoded.topUp.amount, '7');
      assert.equal(decoded.topUp.transactionHash, '0xab');
    }
    assert.equal(decodeTopUp({ address: DESK, topics: ['0x' + '1'.repeat(64)], data: '0x', blockNumber: '0x2a', transactionHash: '0xab' }).ok, 'IGNORED');
    assert.equal(decodeTopUp({ address: DESK, topics: [TOPUP_TOPIC], data: '0x', blockNumber: '0x2a', transactionHash: '0xab', logIndex: '0x0', blockHash: '0x1' }).ok, false);
  });

  it('credits a top-up at the rate at its block, once, and rolls it back when the block is reorganised', async () => {
    const state = freshState();
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const store = tmpStore();
    const key = newKey();
    const hash = keyHashOf(key);
    // 4,000 CURB at block 42 (US$0.005) and 1,000 CURB at block 70, after the pool doubled (US$0.01).
    state.reserves.push({ block: 60, curb: 4_000_000n * 10n ** 18n, quote: 40_000n * 10n ** 6n });
    state.logs.push({ block: 42, keyHash: hash, payer: PAYER, amount: 4_000n * 10n ** 18n, txHash: '0x' + '1'.repeat(64), logIndex: 0 });
    state.logs.push({ block: 70, keyHash: hash, payer: PAYER, amount: 1_000n * 10n ** 18n, txHash: '0x' + '2'.repeat(64), logIndex: 3 });

    const first = await syncTopUps(store, config, opts, new Date());
    assert.equal(first.report.state, 'SYNCED', first.report.detail ?? '');
    assert.equal(first.report.newTopUps, 2);
    assert.deepEqual(first.report.credited.map((c) => [c.cents, c.basis]), [['2000', 'TOP_UP_BLOCK'], ['1000', 'TOP_UP_BLOCK']]);
    assert.equal(first.index.cursor, 100);

    const account = await keyAccount(store, hash);
    assert.equal(account.status, 'OPEN');
    assert.equal(account.creditedCents, '3000');
    assert.equal(account.balanceCents, '3000');
    assert.equal(account.topUps.length, 2);
    assert.equal(account.topUps[0]!.usdPerCurb18, (5n * 10n ** 15n).toString());
    assert.equal(account.topUps[1]!.usdPerCurb18, (10n ** 16n).toString());

    // The same logs again: nothing is credited twice, whatever the cursor says.
    await store.writeSnapshots([{ key: INDEX_KEY, observedAt: new Date().toISOString(), payload: { ...first.index, cursor: 39 } }]);
    const again = await syncTopUps(store, config, opts, new Date());
    assert.equal(again.report.newTopUps, 0);
    assert.equal((await keyAccount(store, hash)).creditedCents, '3000');

    // A spend, then a reorganisation from block 42: both credits go, the spend stays, and the balance says so.
    const paid = await charge(store, hash, 'journal-day', 5, 'apple-s1 · 2026-09-12', new Date());
    assert.equal(paid.ok, true);
    state.fork = 1;
    state.logs = [];
    const rolled = await syncTopUps(store, config, opts, new Date());
    assert.equal(rolled.report.rolledBackFrom, 42);
    const after = await keyAccount(store, hash);
    assert.equal(after.creditedCents, '0');
    assert.equal(after.spentCents, '5');
    assert.equal(after.balanceCents, '-5');
    assert.equal(after.status, 'BELOW_MINIMUM');
  });

  it('holds a top-up it cannot price rather than guessing, and prices it at the head when its block is gone', async () => {
    const state = freshState();
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    state.logs.push({ block: 42, keyHash: hash, payer: PAYER, amount: 4_000n * 10n ** 18n, txHash: '0x' + '3'.repeat(64), logIndex: 0 });

    // A node that prices nothing, by state or by events: the top-up waits, listed with every reason.
    const nothing: RateReaders = { byState: UNREAD_READER, byEvents: UNREAD_READER };
    const priceless = await syncTopUps(store, config, opts, new Date(), nothing);
    assert.equal(priceless.report.newTopUps, 1);
    assert.equal(priceless.report.credited.length, 0);
    assert.equal(priceless.report.unpriced, 1);
    assert.match(priceless.index.unpriced[0]!.reason, /^waits: by state: .*; by events: /);
    assert.equal((await keyAccount(store, hash)).status, 'UNFUNDED');

    // A node that did not answer is waited out — never priced around at the head.
    const transient: RateReaders = { byState: async (c, block, o, now) => (block === 42 ? UNREAD_READER() : readRate(c, block, o, now)), byEvents: UNREAD_READER };
    const waited = await syncTopUps(store, config, opts, new Date(), transient);
    assert.equal(waited.report.unpriced, 1, 'a transport failure by events is not a reason to use the head');
    assert.equal(waited.report.credited.length, 0);

    // The pool had no event before the block — it did not exist then — so the head when indexed is the rate, and the record says which basis it used.
    const absent = async () => ({ state: 'UNREAD' as const, value: null, reason: 'FIELD_ABSENT' as const, source: null, observedAt: new Date().toISOString(), detail: 'no Sync from the pair in the 20,000,000 blocks before block 42' });
    const headOnly: RateReaders = { byState: async (c, block, o, now) => (block === 42 ? UNREAD_READER() : readRate(c, block, o, now)), byEvents: absent };
    const atHead = await syncTopUps(store, config, opts, new Date(), headOnly);
    assert.equal(atHead.report.unpriced, 0);
    assert.deepEqual(atHead.report.credited.map((c) => [c.cents, c.basis]), [['2000', 'HEAD_AT_INDEXING']]);
    const account = await keyAccount(store, hash);
    assert.equal(account.topUps[0]!.ratedAtBlock, 100);
    assert.equal(account.status, 'OPEN');
  });

  it('prices a top-up at its own block from the pool’s events when the node’s state window has passed, and says so', async () => {
    const state = freshState();
    state.head = 10_000;
    state.stateWindow = 6_200; // Robinhood Chain's public node, measured
    state.syncs = [
      { block: 100, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n },
      { block: 3_000, curb: 4_000_000n * 10n ** 18n, quote: 40_000n * 10n ** 6n },
    ];
    // The head's state reads the pool's current reserves; the reserves table serves eth_call for blocks in the window.
    state.reserves = [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 40_000n * 10n ** 6n }];
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    // A top-up at block 2,000 — 8,000 blocks ago, beyond the window — when the pool said US$0.005; and one at 9,900, inside the window, at US$0.01.
    state.logs.push({ block: 2_000, keyHash: hash, payer: PAYER, amount: 4_000n * 10n ** 18n, txHash: '0x' + '7'.repeat(64), logIndex: 0 });
    state.logs.push({ block: 9_900, keyHash: hash, payer: PAYER, amount: 1_000n * 10n ** 18n, txHash: '0x' + '8'.repeat(64), logIndex: 0 });
    const run = await syncTopUps(store, config, opts, new Date());
    assert.equal(run.report.state, 'SYNCED', run.report.detail ?? '');
    assert.deepEqual(
      run.report.credited.map((c) => [c.cents, c.basis]),
      [
        ['2000', 'TOP_UP_BLOCK_EVENTS'],
        ['1000', 'TOP_UP_BLOCK'],
      ],
      'the old one at its own block by the Sync at block 100; the recent one by state',
    );
    const account = await keyAccount(store, hash);
    assert.equal(account.topUps[0]!.ratedAtBlock, 2_000);
    assert.equal(account.topUps[0]!.usdPerCurb18, (5n * 10n ** 15n).toString());
    assert.equal(account.topUps[1]!.usdPerCurb18, (10n ** 16n).toString());
    assert.equal(account.creditedCents, '3000');
  });

  it('guards a top-up against a pump: the lowest price the pool showed in the window before the block is the one credited', async () => {
    const state = freshState();
    // The pool showed US$0.005 at block 30, then someone pumps it to US$0.05 at block 41 and tops up at block 42; the window on the local chain is 40 blocks.
    state.syncs = [
      { block: 30, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n },
      { block: 41, curb: 4_000_000n * 10n ** 18n, quote: 200_000n * 10n ** 6n },
    ];
    state.reserves = [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 200_000n * 10n ** 6n }];
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const at42 = await readRate(config, 42, opts);
    if (at42.state === 'UNREAD') assert.fail(JSON.stringify(at42));
    assert.equal(at42.value.guard.atBlockUsdPerCurb18, (5n * 10n ** 16n).toString(), 'the pumped price at the block');
    assert.equal(at42.value.usdPerCurb18, (5n * 10n ** 15n).toString(), 'credited at the lowest in the window');
    assert.deepEqual([at42.value.guard.applied, at42.value.guard.lowestAtBlock, at42.value.guard.samples, at42.value.guard.windowBlocks], [true, 30, 2, 40]);
    assert.equal(at42.value.marketCapUsd18, (50_000_000n * 10n ** 18n).toString(), 'the capitalisation is stated at the block, not guarded');
    // A dump before the top-up costs the payer: the lower price at the block stands.
    state.syncs.push({ block: 43, curb: 4_000_000n * 10n ** 18n, quote: 4_000n * 10n ** 6n });
    state.reserves = [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 4_000n * 10n ** 6n }];
    const at44 = await readRate(config, 44, opts);
    if (at44.state === 'UNREAD') assert.fail(JSON.stringify(at44));
    assert.equal(at44.value.usdPerCurb18, (10n ** 15n).toString());
    assert.equal(at44.value.guard.applied, false);
    // A window the node will not serve is a rate that is not stated.
    state.logLimit = 0;
    const unguarded = await readRate(config, 44, opts);
    assert.equal(unguarded.state, 'UNREAD');
    assert.match(unguarded.state === 'UNREAD' ? (unguarded.detail ?? '') : '', /guard window/);
  });

  it('narrows a log query the node refuses for matching too much, for the last event and for the window', async () => {
    const state = freshState();
    state.head = 1_000;
    state.stateWindow = 5;
    state.logLimit = 3;
    // Twelve Syncs fifty blocks apart, from block 100 to 650; the node refuses any query matching more than three.
    state.syncs = Array.from({ length: 12 }, (_, i) => ({ block: 100 + i * 50, curb: 4_000_000n * 10n ** 18n, quote: BigInt(10_000 + i * 1_000) * 10n ** 6n }));
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const at700 = await readRateFromEvents(config, 700, opts);
    if (at700.state === 'UNREAD') assert.fail(JSON.stringify(at700));
    // The last Sync at or before 700 is at block 650 (i = 11): 21,000 quote → US$0.00525; the window of 40 blocks before 700 holds no Sync.
    assert.equal(at700.value.guard.atBlockUsdPerCurb18, (525n * 10n ** 13n).toString());
    assert.equal(at700.value.usdPerCurb18, (525n * 10n ** 13n).toString());
    assert.equal(at700.value.pool.eventBlock, 650);
    assert.equal(at700.value.guard.samples, 0);
    assert.ok(state.calls.filter((c) => c === 'eth_getLogs').length > 3, 'the refused range was halved until the node answered');
    // And the window: a top-up at block 351 sees the Sync at 350 in its forty blocks (US$0.00375, i = 5) and none earlier; the refused query was halved to find it.
    const at351 = await readRateFromEvents(config, 351, opts);
    if (at351.state === 'UNREAD') assert.fail(JSON.stringify(at351));
    assert.equal(at351.value.guard.samples, 1);
    assert.equal(at351.value.usdPerCurb18, (375n * 10n ** 13n).toString());
  });

  it('prices at most fifty top-ups a run and lists the rest as next in line', async () => {
    const state = freshState();
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    for (let i = 0; i < 60; i += 1) state.logs.push({ block: 42, keyHash: hash, payer: PAYER, amount: 10n ** 18n, txHash: `0x${String(i).padStart(64, 'a')}`, logIndex: i });
    const first = await syncTopUps(store, config, opts, new Date());
    assert.equal(first.report.credited.length, 50);
    assert.equal(first.report.unpriced, 10);
    assert.match(first.index.unpriced[0]!.reason, /^deferred/);
    const second = await syncTopUps(store, config, opts, new Date());
    assert.equal(second.report.credited.length, 10);
    assert.equal(second.report.unpriced, 0);
    assert.equal((await keyAccount(store, hash)).topUps.length, 60);
  });

  it('gates a paid endpoint: 503 unsold, 401 without a key, 402 with the figures, then charges and answers', async () => {
    const store = tmpStore();
    const key = newKey();
    const hash = keyHashOf(key);
    const req = (headers: Record<string, string> = {}) => new Request('https://the-curb.test/api/x', { headers });

    const unsold = await gate(req({ 'x-curb-key': key }), store, 'journal-day', 'ref');
    assert.equal(unsold.ok, false);
    if (!unsold.ok) assert.equal(unsold.response.status, 503);

    process.env[CREDITS_ENV] = CONFIG_JSON;
    const noKey = await gate(req(), store, 'journal-day', 'ref');
    assert.equal(noKey.ok === false ? noKey.response.status : 0, 401);
    const badKey = await gate(req({ 'x-curb-key': 'curb_nope' }), store, 'journal-day', 'ref');
    assert.equal(badKey.ok === false ? badKey.response.status : 0, 401);

    const unfunded = await gate(req({ 'x-curb-key': key }), store, 'journal-day', 'ref');
    assert.equal(unfunded.ok, false);
    if (!unfunded.ok) {
      assert.equal(unfunded.response.status, 402);
      const body = (await unfunded.response.json()) as Record<string, unknown>;
      assert.equal(body.error, 'UNFUNDED');
      assert.equal(body.keyHash, hash);
      assert.equal(body.toOpenCents, '2000');
      assert.equal((body.topUp as Record<string, unknown>).desk, DESK);
    }

    // Credited below the minimum: still refused, with what is missing.
    const credit = (cents: string, n: number) => ({ transactionHash: `0x${String(n).repeat(64).slice(0, 64)}`, logIndex: 0, blockNumber: 42, payer: PAYER, amount: '1', usdPerCurb18: '1', ratedAtBlock: 42, basis: 'TOP_UP_BLOCK', cents, creditedAt: new Date().toISOString() });
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '1500', topUps: [credit('1500', 1)] } }]);
    const below = await gate(req({ 'x-curb-key': key }), store, 'journal-day', 'ref');
    assert.equal(below.ok, false);
    if (!below.ok) {
      const body = (await below.response.json()) as Record<string, unknown>;
      assert.equal(below.response.status, 402);
      assert.equal(body.error, 'BELOW_MINIMUM');
      assert.equal(body.toOpenCents, '500');
    }

    // At the minimum: admitted without a charge, then charged when there is an answer, and the balance is on the account.
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2010', topUps: [credit('1500', 1), credit('510', 2)] } }]);
    const admitted = await admit(req({ authorization: `Bearer ${key}` }), store, 'evidence-versions');
    assert.equal(admitted.ok, true);
    if (admitted.ok) {
      assert.equal(admitted.cents, 5);
      assert.equal(admitted.account.balanceCents, '2010', 'admission charges nothing');
    }
    const beforeSettle = await store.snapshots(spendRow(hash));
    assert.equal(beforeSettle.state === 'UNREAD' ? -1 : beforeSettle.value.length, 0, 'no spend row before settlement');
    const settled = await settle(store, hash, 'evidence-versions', 'apple-s1 · xstocks:AAPLx');
    assert.equal(settled.ok, true);
    if (settled.ok) {
      assert.equal(settled.account.balanceCents, '2005');
      assert.equal(settled.account.chargeCount, 1);
      assert.equal(settled.account.charges[0]!.ref, 'apple-s1 · xstocks:AAPLx');
    }
    const spend = await store.snapshots(spendRow(hash));
    assert.equal(spend.state === 'UNREAD' ? null : spend.value[0]?.payload.spentCents, '5');
    const both = await gate(req({ 'x-curb-key': key }), store, 'journal-day', 'apple-s1 · 2026-09-12');
    assert.equal(both.ok, true);
    if (both.ok) assert.equal(both.account.balanceCents, '2000');

    // Spend it down to less than a call: refused as INSUFFICIENT, nothing served.
    await store.writeSnapshots([{ key: spendRow(hash), observedAt: new Date().toISOString(), payload: { hash, spentCents: '2008', count: 3, charges: [] } }]);
    const short = await gate(req({ 'x-curb-key': key }), store, 'journal-day', 'ref');
    assert.equal(short.ok, false);
    if (!short.ok) {
      const body = (await short.response.json()) as Record<string, unknown>;
      assert.equal(body.error, 'INSUFFICIENT');
      assert.equal(body.balanceCents, '2');
    }
  });

  it('refuses webhooks the desk should not post to', () => {
    assert.equal(webhookFault('https://hooks.example.com/abc'), null);
    assert.notEqual(webhookFault('http://hooks.example.com/abc'), null);
    assert.notEqual(webhookFault('https://localhost/abc'), null);
    assert.notEqual(webhookFault('https://10.0.0.1/abc'), null);
    assert.notEqual(webhookFault('https://[::1]/abc'), null);
    assert.notEqual(webhookFault('https://user:pw@hooks.example.com/abc'), null);
    assert.notEqual(webhookFault('https://intranet/abc'), null);
    assert.notEqual(webhookFault('not a url'), null);
  });

  it('refuses, at delivery time, a public name that resolves inward', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '100.128.0.1']) assert.equal(isPrivateAddress(ip), false, ip);
    assert.equal(await deliveryFault('https://hooks.example.com/a', async () => ['93.184.216.34']), null);
    assert.match((await deliveryFault('https://hooks.example.com/a', async () => ['93.184.216.34', '10.0.0.5'])) ?? '', /10\.0\.0\.5/);
    assert.match((await deliveryFault('https://hooks.example.com/a', async () => [])) ?? '', /resolves to nothing/);
    assert.match((await deliveryFault('https://hooks.example.com/a', async () => { throw new Error('ENOTFOUND'); })) ?? '', /did not resolve/);
    assert.notEqual(await deliveryFault('http://hooks.example.com/a', async () => ['93.184.216.34']), null, 'the static refusals still apply');
  });

  it('fans an alert out to paying subscribers once per transition, charging only what was delivered', async () => {
    process.env[CREDITS_ENV] = CONFIG_JSON;
    const store = tmpStore();
    const rich = keyHashOf(newKey());
    const poor = keyHashOf(newKey());
    const credit = (hash: string, cents: string) => store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: cents, topUps: [{ transactionHash: '0x' + '9'.repeat(64), logIndex: 0, blockNumber: 42, payer: PAYER, amount: '1', usdPerCurb18: '1', ratedAtBlock: 42, basis: 'TOP_UP_BLOCK', cents, creditedAt: new Date().toISOString() }] } }]);
    await credit(rich, '2000');
    await credit(poor, '2000');
    await store.writeSnapshots([{ key: spendRow(poor), observedAt: new Date().toISOString(), payload: { hash: poor, spentCents: '1995', count: 1, charges: [] } }]);

    const refused = await createSubscription(store, keyHashOf(newKey()), 'https://hooks.example.com/a', new Date());
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error, 'UNFUNDED');
    const a = await createSubscription(store, rich, 'https://hooks.example.com/a', new Date());
    const b = await createSubscription(store, rich, 'https://hooks.example.com/b', new Date());
    const c = await createSubscription(store, poor, 'https://hooks.example.com/c', new Date());
    const d = await createSubscription(store, rich, 'https://inward.example.com/d', new Date());
    assert.ok(a.ok && b.ok && c.ok && d.ok);
    const resolve = async (hostname: string) => (hostname === 'inward.example.com' ? ['10.0.0.7'] : ['93.184.216.34']);
    const dup = await createSubscription(store, rich, 'https://hooks.example.com/a', new Date());
    assert.equal(dup.ok === false ? dup.error : '', 'ALREADY_SUBSCRIBED');

    const posted: { webhook: string; message: string; pinTo: readonly string[] }[] = [];
    const post = async (message: string, webhook: string, pinTo: readonly string[]) => {
      posted.push({ webhook, message, pinTo });
      return webhook.endsWith('/b') ? ({ state: 'FAILED', reason: 'HTTP 500' } as const) : ({ state: 'SENT', status: 204 } as const);
    };
    const x: Condition = { id: 'x', severity: 'DARK', text: 'x is dark' };
    const y: Condition = { id: 'y', severity: 'NOTE', text: 'y is noted' };
    const first = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(first.considered, 4);
    assert.equal(first.delivered, 1, 'a delivered, b failed, c short, d resolves inward');
    assert.equal(first.charged, 1);
    assert.deepEqual(first.failed.map((f) => f.id), [b.ok ? b.subscription.id : '']);
    assert.deepEqual(
      first.skipped.map((s) => [s.id, s.reason]).sort(),
      [
        [c.ok ? c.subscription.id : '', 'INSUFFICIENT'],
        [d.ok ? d.subscription.id : '', 'WEBHOOK_REFUSED'],
      ].sort(),
    );
    assert.ok(!posted.some((w) => w.webhook.includes('inward')), 'nothing was posted inward');
    assert.deepEqual(posted[0]!.pinTo, ['93.184.216.34'], 'the address checked is the address dialled');
    assert.match(posted[0]!.message, /RAISED[\s\S]*x is dark/);
    assert.equal((await keyAccount(store, rich)).balanceCents, '1990');
    assert.equal((await keyAccount(store, poor)).balanceCents, '5');

    // The same set again: a was told; b is tried again and fails again; c is still short. Nothing new is charged.
    const second = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(second.delivered, 0);
    assert.equal(second.charged, 0);
    assert.equal((await keyAccount(store, rich)).balanceCents, '1990');
    assert.equal(posted.filter((w) => w.webhook.endsWith('/a')).length, 1);

    // The set moves: x clears, y is raised. a is told exactly that; b, never told, is told x cleared and y raised from nothing — and fails again.
    const third = await fanOut(store, new Date(), [y], post, resolve);
    assert.equal(third.delivered, 1);
    const toA = posted.filter((w) => w.webhook.endsWith('/a')).at(-1)!;
    assert.match(toA.message, /RAISED[\s\S]*y is noted[\s\S]*CLEARED[\s\S]*x/);
    assert.equal((await keyAccount(store, rich)).balanceCents, '1980');

    // Nothing to tell: nothing considered.
    const nothing = await fanOut(store, new Date(), null, post, resolve);
    assert.equal(nothing.considered, 0);
    const same = await fanOut(store, new Date(), [y], post, resolve);
    assert.equal(same.considered, 3, 'b, c and d still have a change they were never told of; a does not');

    const mine = await subscriptionsOf(store, rich);
    assert.equal(mine.subscriptions.length, 3);
    const delivered = mine.subscriptions.find((s) => s.url.endsWith('/a'))!;
    assert.equal(delivered.deliveries, 2);
    assert.equal(delivered.lastDelivery?.charged, true);
    assert.deepEqual(delivered.lastActive, ['y']);
  });

  it('runs on the tick: NOT_CONFIGURED without a record; with one, the rate at the head is recorded with its block', async () => {
    const store = tmpStore();
    const off = await runCredits(store, new Date(), null);
    assert.equal(off.state, 'NOT_CONFIGURED');
    assert.equal((await latestRate(store)).rate, null);

    const state = freshState();
    state.deskCode = await deskCodeFor(CURB, TREASURY);
    const hash = keyHashOf(newKey());
    state.logs.push({ block: 42, keyHash: hash, payer: PAYER, amount: 4_000n * 10n ** 18n, txHash: '0x' + '5'.repeat(64), logIndex: 0 });
    globalThis.fetch = fakeNode(state);
    process.env[CREDITS_ENV] = CONFIG_JSON;
    const on = await runCredits(store, new Date(), []);
    assert.equal(on.state, 'CONFIGURED');
    assert.equal(on.code?.state, 'MATCHES', on.code?.detail ?? '');
    assert.equal(on.rate?.state, 'READ');
    if (on.rate?.state === 'READ') {
      assert.equal(on.rate.rate.block, 100);
      assert.equal(on.rate.rate.marketCapUsd18, (5_000_000n * 10n ** 18n).toString());
    }
    assert.equal(on.index?.state, 'SYNCED');
    assert.equal(on.fanOut?.considered, 0);
    const recorded = await latestRate(store);
    assert.equal(recorded.rate?.state, 'READ');

    // The receipts: one top-up of 4,000 CURB, US$20.00, priced at its own block.
    const paid = await receipts(store);
    assert.equal(paid.topUps, 1);
    assert.equal(paid.keys, 1);
    assert.equal(paid.curbBaseUnits, (4_000n * 10n ** 18n).toString());
    assert.equal(paid.cents, '2000');
    assert.equal(paid.pricedAtOwnBlock, 1);
    assert.equal(paid.lastBlock, 42);
    assert.equal(paid.cursor, 100);

    // A clean run raises no condition; the rows say so.
    const rows = async () => {
      const [run, code] = await Promise.all([store.snapshots('credits:run'), store.snapshots('credits:code')]);
      return [...(run.state === 'UNREAD' ? [] : run.value), ...(code.state === 'UNREAD' ? [] : code.value)];
    };
    assert.deepEqual(positionConditions(await rows(), new Date()).map((c) => c.id), []);

    // The pool empties: the tick records UNREAD with the reason, not the last rate again, and a new top-up waits.
    state.reserves = [{ block: 0, curb: 0n, quote: 0n }];
    state.head = 120;
    state.logs.push({ block: 110, keyHash: hash, payer: PAYER, amount: 10n ** 18n, txHash: '0x' + '6'.repeat(64), logIndex: 0 });
    const dry = await runCredits(store, new Date(), null);
    assert.equal(dry.rate?.state, 'UNREAD');
    assert.equal(dry.index?.unpriced, 1, 'the new top-up waits for a rate');
    assert.equal((await latestRate(store)).rate?.state, 'UNREAD');
    assert.deepEqual(positionConditions(await rows(), new Date()).map((c) => [c.id, c.severity]).sort(), [
      ['credits:rate:UNREAD', 'STALE'],
      ['credits:topups:WAITING', 'NOTE'],
    ]);

    // The desk's treasury is not the record's: the code is DARK and nothing is credited from the desk — the index is held.
    state.deskCode = await deskCodeFor(CURB, PAYER);
    const held = await runCredits(store, new Date(), null);
    assert.equal(held.code?.state, 'MISMATCH');
    assert.equal(held.index?.state, 'HELD');
    const conditions = positionConditions(await rows(), new Date());
    assert.deepEqual(conditions.map((c) => [c.id, c.severity]).sort(), [
      ['credits:code:MISMATCH', 'DARK'],
      ['credits:index:HELD', 'STALE'],
      ['credits:rate:UNREAD', 'STALE'],
      ['credits:topups:WAITING', 'NOTE'],
    ]);
    assert.match(conditions.find((c) => c.id === 'credits:code:MISMATCH')!.text, /treasury/);
  });
});

describe('the selector the services page assembles by hand', () => {
  it('is the one keccak gives for topUp(bytes32,uint256)', () => {
    assert.equal(selector('topUp(bytes32,uint256)'), '0xb67644b9');
    assert.equal(TOPUP_TOPIC, '0x6e7690b9717f311efac1eee5fa4bc5ab15ddfd75a5a43eed4f79604e6855b685');
  });
});
