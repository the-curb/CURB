import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NETWORKS } from '../lib/chain/networks.ts';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import { selector } from '../lib/chain/keccak.ts';
import { V4_SELECTORS, V4_TOPICS, ZERO_ADDRESS, hookPermissions, poolIdOf, validatePoolKey } from '../lib/chain/uniswap-v4.ts';
import { isLogTimeout } from '../lib/chain/logs.ts';
import { CREDITS_ENV, parseCreditsConfig, type CreditsConfig } from '../lib/credits/config.ts';
import { admit, gate, settle } from '../lib/credits/guard.ts';
import { latestDeskCode, verifyDeskCode, expectedDeskImmutables } from '../lib/credits/code.ts';
import { receipts } from '../lib/credits/receipts.ts';
import { creditsResponse } from '../lib/launch/credits-api.ts';
import { addressWord, buildRecord } from '../lib/positions/code.ts';
import { INDEX_KEY, MAX_RETRIES_PER_SYNC, TOPUP_TOPIC, decodeTopUp, syncTopUps, type RateReaders } from '../lib/credits/indexer.ts';
import { charge, isKey, keyAccount, keyHashOf, newKey, spendRow, topUpsRow } from '../lib/credits/keys.ts';
import { latestRate, runCredits } from '../lib/credits/maintenance.ts';
import { MINIMUM_OPEN_CENTS, SERVICES, centsText } from '../lib/credits/prices.ts';
import { TOPICS, centsForCurb, checkPoolCreation, curbForCents, curbText, poolHadNoPriceAt, readRate, readRateFromEvents, usd18Text, type Rate } from '../lib/credits/rate.ts';
import { SUB_PREFIX, cancelSubscription, createSubscription, deliveryFault, fanOut, isPrivateAddress, subscriptionsOf, webhookFault } from '../lib/credits/subscriptions.ts';
import { MESSAGE_MAX_CHARS, composeMessage, positionConditions, type Condition } from '../lib/ops/alerts.ts';
import type { ConditionalWriteOutcome, SnapshotRecord, Store, WriteOutcome } from '../lib/store/types.ts';
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
const AGGREGATOR_PHASE1 = '0x8000000000000000000000000000000000000008';
/** A v4 pool: the manager every pool's events come from, the lens its state is read through, the hook, and the key — native ETH against CURB, fee 0, tick spacing 200, as the launchpad decided creates them. */
const POOL_MANAGER = '0x9000000000000000000000000000000000000009';
const STATE_VIEW = '0x9a00000000000000000000000000000000000009';
const HOOK = '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044';
const V4_KEY = { currency0: ZERO_ADDRESS, currency1: CURB, fee: 0, tickSpacing: 200, hooks: HOOK };
const POOL_ID = poolIdOf(V4_KEY);
const PAYER = '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const TREASURY = '0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e';

const word = (v: bigint) => v.toString(16).padStart(64, '0');
const hexWord = (v: bigint) => `0x${word(v)}`;
const blockHashOf = (n: number, fork = 0) => `0x${(BigInt(n) * 1_000_003n + BigInt(fork)).toString(16).padStart(64, '0')}`;

const CONFIG_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'usd-stable' } } });
const CONFIG_FEED_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'chainlink-feed', feed: FEED } } });
const CONFIG_V3_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: { kind: 'uniswap-v3-pool', pair: POOL3, quote: { kind: 'usd-stable' } } });
const CONFIG_V4_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, treasury: TREASURY, fromBlock: 40, priceSource: { kind: 'uniswap-v4-pool', poolManager: POOL_MANAGER, stateView: STATE_VIEW, key: V4_KEY, fromBlock: 20, quote: { kind: 'chainlink-feed', feed: FEED } } });

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
  v3: { curbIs0: boolean; sqrt: bigint; liquidity?: bigint; swaps: { block: number; sqrt: bigint; liquidity?: bigint }[]; initialize?: { block: number; sqrt: bigint }; mints?: number[]; burns?: number[] } | null;
  /** A v4 pool inside the manager: its current price and liquidity by id, its swaps, its Initialize (with the key it states) and its signed liquidity changes. Other pools' events are there too, to be ignored. */
  v4: { sqrt: bigint; liquidity?: bigint; swaps: { block: number; sqrt: bigint; liquidity?: bigint; sender?: string }[]; initialize?: { block: number; sqrt: bigint; key?: typeof V4_KEY; logIndex?: number }; modifies?: { block: number; delta: bigint; logIndex?: number }[]; otherPools?: { block: number; id: string }[]; timeoutWiderThan?: number } | null;
  /** The node's cap on logs matched by one query; more than this is refused the way Robinhood Chain's node refuses. */
  logLimit: number | null;
  /** The feed's AnswerUpdated events on its aggregator. */
  feedAnswers: { block: number; answer: bigint; roundId: bigint; updatedAt: bigint }[];
  /** The feed proxy's earlier phase: its aggregator's answers, when the proxy has moved on (phaseId 2). */
  feedPhase1Answers: { block: number; answer: bigint; roundId: bigint; updatedAt: bigint }[] | null;
  calls: string[];
}

/** A node that answers the chain id, heads, block hashes, logs and the pool's and token's views at a block. */
function fakeNode(state: NodeState) {
  const SEL = { token0: selector('token0()'), token1: selector('token1()'), getReserves: selector('getReserves()'), slot0: selector('slot0()'), liquidity: selector('liquidity()'), decimals: selector('decimals()'), totalSupply: selector('totalSupply()'), latestRoundData: selector('latestRoundData()'), aggregator: selector('aggregator()'), phaseId: selector('phaseId()'), phaseAggregators: selector('phaseAggregators(uint16)') };
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
      case 'eth_blockNumber':
        result = `0x${state.head.toString(16)}`;
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
        if (address === POOL_MANAGER) {
          // The manager answers by [topic, id] only; a query without the id would be every pool's events, which the reader never asks for.
          const id = (q.topics[1] ?? '').toLowerCase();
          if (state.v4 === null) { result = []; break; }
          if (id !== POOL_ID) {
            // Another pool in the same manager: its swaps exist and are answered for its own id only.
            result = topic === V4_TOPICS.swap ? (state.v4.otherPools ?? []).filter((e) => e.id === id && within(e.block)).map((e) => logOf(POOL_MANAGER, e.block, [V4_TOPICS.swap, e.id, hexWord(0n)], `0x${word(0n)}${word(0n)}${word(1n)}${word(1n)}${word(0n)}${word(0n)}`)) : [];
            break;
          }
          if (state.v4.timeoutWiderThan !== undefined && to - from + 1 > state.v4.timeoutWiderThan) {
            // Robinhood Chain's public node, 17 September 2026: a wide query on the manager gives up with the node's own words, HTTP 200.
            error = { code: -32000, message: 'log query timed out' };
            break;
          }
          const signedWord = (v: bigint) => word(v < 0n ? (1n << 256n) + v : v);
          if (topic === V4_TOPICS.swap) {
            result = state.v4.swaps.filter((e) => within(e.block)).map((e) => logOf(POOL_MANAGER, e.block, [V4_TOPICS.swap, POOL_ID, hexWord(BigInt(e.sender ?? HOOK))], `0x${word(0n)}${word(0n)}${word(e.sqrt)}${word(e.liquidity ?? 1n)}${word(0n)}${word(0n)}`));
          } else if (topic === V4_TOPICS.initialize) {
            const init = state.v4.initialize;
            const key = init?.key ?? V4_KEY;
            result = init !== undefined && within(init.block) ? [logOf(POOL_MANAGER, init.block, [V4_TOPICS.initialize, POOL_ID, hexWord(BigInt(key.currency0)), hexWord(BigInt(key.currency1))], `0x${word(BigInt(key.fee))}${word(BigInt(key.tickSpacing))}${word(BigInt(key.hooks))}${word(init.sqrt)}${word(0n)}`, init.logIndex ?? 0)] : [];
          } else if (topic === V4_TOPICS.modifyLiquidity) {
            result = (state.v4.modifies ?? []).filter((e) => within(e.block)).map((e) => logOf(POOL_MANAGER, e.block, [V4_TOPICS.modifyLiquidity, POOL_ID, hexWord(0n)], `0x${signedWord(-887200n)}${word(887200n)}${signedWord(e.delta)}${word(0n)}`, e.logIndex ?? 0));
          } else result = [];
          break;
        }
        const capped = (logs: unknown[]) => {
          if (state.logLimit !== null && logs.length > state.logLimit) {
            error = { code: -32000, message: `logs matched by query exceeds limit of ${state.logLimit}` };
            return null;
          }
          return logs;
        };
        if (address === PAIR && topic === '') {
          // No topic: every log of the pair — its Syncs, for the first-log search.
          result = capped(state.syncs.filter((e) => within(e.block)).map((e) => logOf(PAIR, e.block, [TOPICS.sync], `0x${word(e.curb)}${word(e.quote)}`, e.logIndex ?? 0)));
          break;
        }
        if (address === PAIR && topic === TOPICS.sync) {
          result = capped(state.syncs.filter((e) => within(e.block)).map((e) => logOf(PAIR, e.block, [TOPICS.sync], `0x${word(e.curb)}${word(e.quote)}`, e.logIndex ?? 0)));
          break;
        }
        if (address === POOL3 && state.v3 !== null && topic === TOPICS.initialize) {
          const init = state.v3.initialize;
          result = capped(init !== undefined && within(init.block) ? [logOf(POOL3, init.block, [TOPICS.initialize], `0x${word(init.sqrt)}${word(0n)}`)] : []);
          break;
        }
        if (address === POOL3 && state.v3 !== null && topic === TOPICS.burn) {
          result = capped((state.v3.burns ?? []).filter((b) => within(b)).map((b) => logOf(POOL3, b, [TOPICS.burn, hexWord(0n), hexWord(0n), hexWord(0n)], `0x${word(1n)}${word(1n)}${word(1n)}`)));
          break;
        }
        if (address === POOL3 && state.v3 !== null && topic === TOPICS.mint) {
          result = capped((state.v3.mints ?? []).filter((b) => within(b)).map((b) => logOf(POOL3, b, [TOPICS.mint, hexWord(0n), hexWord(0n), hexWord(0n)], `0x${word(0n)}${word(1n)}${word(1n)}${word(1n)}`)));
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
        if (address === AGGREGATOR_PHASE1 && topic === TOPICS.answerUpdated) {
          result = capped((state.feedPhase1Answers ?? []).filter((e) => within(e.block)).map((e) => logOf(AGGREGATOR_PHASE1, e.block, [TOPICS.answerUpdated, hexWord(e.answer), hexWord(e.roundId)], hexWord(e.updatedAt))));
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
        else if (t === STATE_VIEW && sel === V4_SELECTORS.getSlot0) result = state.v4 === null || data.slice(10) !== POOL_ID.slice(2) ? '0x' : `0x${word(state.v4.sqrt)}${word(0n)}${word(0n)}${word(0n)}`;
        else if (t === STATE_VIEW && sel === V4_SELECTORS.getLiquidity) result = state.v4 === null || data.slice(10) !== POOL_ID.slice(2) ? '0x' : hexWord(state.v4.liquidity ?? 1n);
        else if (t === FEED && sel === SEL.aggregator) result = hexWord(BigInt(AGGREGATOR));
        else if (t === FEED && sel === SEL.phaseId) result = hexWord(state.feedPhase1Answers === null ? 1n : 2n);
        else if (t === FEED && sel === SEL.phaseAggregators) result = hexWord(data.endsWith('1') && state.feedPhase1Answers !== null ? BigInt(AGGREGATOR_PHASE1) : 0n);
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
  return { head: 100, fork: 0, reserves: [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n }], logs: [], supply: 10n ** 9n * 10n ** 18n, feedAnswer: 0n, deskCode: null, stateWindow: null, syncs: [], v3: null, v4: null, feedAnswers: [], feedPhase1Answers: null, logLimit: null, calls: [] };
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

    // The proxy moved to a new aggregator at block 80: a block before that is priced by the earlier phase's aggregator, which answered US$2,500 at block 20.
    state.feedAnswers = [{ block: 80, answer: 5_000n * 10n ** 8n, roundId: 1n, updatedAt: 1_700_000_600n }];
    state.feedPhase1Answers = [{ block: 20, answer: 2_500n * 10n ** 8n, roundId: 9n, updatedAt: 1_700_000_000n }];
    const beforeSwitch = await readRateFromEvents(config, 50, opts);
    if (beforeSwitch.state === 'UNREAD') assert.fail(JSON.stringify(beforeSwitch));
    assert.equal(beforeSwitch.value.usdPerCurb18, (125n * 10n ** 17n).toString(), 'the earlier phase answered US$2,500 at block 20');
    assert.equal(beforeSwitch.value.quote.kind === 'chainlink-feed' ? beforeSwitch.value.quote.eventBlock : null, 20);
    const afterSwitch = await readRateFromEvents(config, 90, opts);
    if (afterSwitch.state === 'UNREAD') assert.fail(JSON.stringify(afterSwitch));
    assert.equal(afterSwitch.value.usdPerCurb18, (25n * 10n ** 18n).toString());
    state.feedPhase1Answers = [];
    const noPhase = await readRateFromEvents(config, 50, opts);
    assert.equal(noPhase.state, 'UNREAD');
    assert.match(noPhase.state === 'UNREAD' ? (noPhase.detail ?? '') : '', /aggregators 0x6000.*, 0x8000/);
    state.feedPhase1Answers = null;

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
    // Block 99's window is [59, 98]: the Sync at 60 says US$0.01, and the price standing when the window opened — the Sync at 42, US$0.008 — counts too.
    assert.equal(at99.value.guard.atBlockUsdPerCurb18, (10n ** 16n).toString());
    assert.equal(at99.value.usdPerCurb18, (8n * 10n ** 15n).toString(), 'the price at the opening of the window is in the guard');
    assert.deepEqual([at99.value.guard.applied, at99.value.guard.lowestAtBlock, at99.value.guard.samples], [true, 42, 2]);

    state.syncs = [];
    const none = await readRateFromEvents(config, 42, opts);
    assert.equal(none.state, 'UNREAD');
    assert.match(none.state === 'UNREAD' ? (none.detail ?? '') : '', /^the pool had no price at block 42: no Sync/);
    assert.equal(poolHadNoPriceAt(none), true, 'the span reached the chain’s first block: a definite fact, not a quiet wait');
  });

  it('names a v4 pool by its key, and refuses a key that names another', () => {
    // Two pool ids the chain decided answers for these keys (docs/mainnet/EXTERNAL-FACTS-2026-09-17-PONS-V2.md, verified against the Initialize events).
    assert.equal(poolIdOf({ currency0: ZERO_ADDRESS, currency1: '0x9f6b9d004544d34e211bd442391ee4b69174d9c1', fee: 0, tickSpacing: 200, hooks: HOOK }), '0xa781cab706613976b4d1d855dacec2d800069e9413b3ae12f8b4d8b226b8e665');
    assert.equal(poolIdOf({ currency0: ZERO_ADDRESS, currency1: '0xd1a4e3a035852a3be3f24c2de889a9f17c265f19', fee: 0, tickSpacing: 200, hooks: HOOK }), '0x4f47eea24582afa4cf17db257891c8681f27f31e128c1e81de617d7371bd130f');
    // The launchpad's hook may act after a swap and take from its output; it may not act before one, so it cannot move the price the reader reads.
    assert.deepEqual(hookPermissions(HOOK), { beforeInitialize: true, beforeSwap: false, afterSwap: true, beforeSwapReturnsDelta: false, afterSwapReturnsDelta: true });
    assert.ok('error' in validatePoolKey({ ...V4_KEY, currency0: CURB, currency1: ZERO_ADDRESS }), 'unsorted currencies name no pool');
    assert.ok('error' in validatePoolKey({ ...V4_KEY, tickSpacing: 0 }));
    assert.ok('error' in validatePoolKey({ ...V4_KEY, fee: 9_000_000 }));
    const parsed = parseCreditsConfig(CONFIG_V4_JSON);
    if (parsed.state !== 'CONFIGURED') assert.fail(JSON.stringify(parsed));
    assert.equal(parsed.config.priceSource?.pair, POOL_ID, 'the record carries the id derived from the key');
    assert.equal(parsed.config.priceSource?.v4?.poolManager, POOL_MANAGER);
    const wrongId = parseCreditsConfig(CONFIG_V4_JSON.replace('"fromBlock":20', '"fromBlock":20,"poolId":"0x' + 'ab'.repeat(32) + '"'));
    assert.equal(wrongId.state, 'CONFIG_INVALID');
    assert.match(wrongId.state === 'CONFIG_INVALID' ? wrongId.detail : '', /does not equal keccak256/);
    const notOurs = parseCreditsConfig(JSON.stringify({ ...JSON.parse(CONFIG_V4_JSON), priceSource: { ...JSON.parse(CONFIG_V4_JSON).priceSource, key: { ...V4_KEY, currency1: USDC } } }));
    assert.equal(notOurs.state, 'CONFIG_INVALID');
    assert.match(notOurs.state === 'CONFIG_INVALID' ? notOurs.detail : '', /neither of which is the token/);
    assert.ok(isLogTimeout('rpc error -32000: log query timed out') && isLogTimeout('context deadline exceeded') && !isLogTimeout('execution reverted'));
  });

  it('reads a v4 pool through the manager and the lens, by id, with native ETH as the quote', async () => {
    const state = freshState();
    // CURB is currency1 against native ETH (currency0, 18 decimals): 0.000002 ETH a CURB; the feed says US$2,500 an ETH, so US$0.005 a CURB.
    const sqrt = sqrtPriceX96For(10n ** 18n, 2n * 10n ** 12n);
    state.v4 = { sqrt, swaps: [{ block: 60, sqrt }], initialize: { block: 20, sqrt }, modifies: [{ block: 20, delta: 5000n, logIndex: 12 }] };
    state.feedAnswer = 2500n * 10n ** 8n;
    state.feedAnswers = [{ block: 10, answer: 2500n * 10n ** 8n, roundId: 1n, updatedAt: 1_700_000_000n + 10n * 100n }];
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_V4_JSON) as { config: CreditsConfig }).config;
    const near = (v: string, target: bigint, label: string) => {
      const d = BigInt(v) > target ? BigInt(v) - target : target - BigInt(v);
      assert.ok(d * 1_000_000n <= target, `${label}: ${v} is not within a millionth of ${target}`);
    };
    const byState = await readRate(config, 100, opts);
    if (byState.state === 'UNREAD') assert.fail(JSON.stringify(byState));
    near(byState.value.usdPerCurb18, 5n * 10n ** 15n, 'v4 by state through the lens');
    assert.equal(byState.value.pool.kind, 'uniswap-v4-pool');
    assert.equal(byState.value.pool.address, POOL_ID);
    assert.equal(byState.value.pool.poolManager, POOL_MANAGER);
    assert.equal(byState.value.pool.quoteAddress, ZERO_ADDRESS, 'native ETH is the quote, not an absent address');
    assert.equal(byState.value.pool.quoteDecimals, 18);
    assert.equal(byState.value.quote.kind, 'chainlink-feed');
    // Another pool's swap in the same manager, at a wild price, is not this pool's: every query names the id.
    state.v4.otherPools = [{ block: 99, id: '0x' + 'ab'.repeat(32) }];
    const filtered = await readRate(config, 100, opts);
    if (filtered.state === 'UNREAD') assert.fail(JSON.stringify(filtered));
    near(filtered.value.usdPerCurb18, 5n * 10n ** 15n, 'the other pool’s swap did not enter the guard');
    assert.equal(filtered.value.guard.samples, 2, 'the opening and this pool’s one swap');
    // By events: the swap at 60 prices block 80; the Initialize prices block 30, once the addition at 20 has followed it.
    const byEvents = await readRateFromEvents(config, 80, opts);
    if (byEvents.state === 'UNREAD') assert.fail(JSON.stringify(byEvents));
    near(byEvents.value.usdPerCurb18, 5n * 10n ** 15n, 'v4 by events');
    assert.equal(byEvents.value.pool.eventBlock, 60);
    const seeded = await readRateFromEvents(config, 30, opts);
    if (seeded.state === 'UNREAD') assert.fail(JSON.stringify(seeded));
    assert.equal(seeded.value.pool.eventBlock, 20, 'the Initialize, with liquidity added in the same block');
    // Before the pool existed: no price, definitely — the record's fromBlock is the Initialize's block.
    const before = await readRateFromEvents(config, 15, opts);
    assert.equal(poolHadNoPriceAt(before), true);
    // Initialised, liquidity added then all removed, no swap since: not definite.
    state.v4.swaps = [];
    state.v4.modifies = [{ block: 20, delta: 5000n }, { block: 25, delta: -5000n }];
    const uncertain = await readRateFromEvents(config, 30, opts);
    assert.equal(uncertain.state, 'UNREAD');
    assert.equal(poolHadNoPriceAt(uncertain), false);
    assert.match(uncertain.state === 'UNREAD' ? (uncertain.detail ?? '') : '', /cannot be told from its events/);
    // A swap that drained the pool, then an addition: priced again.
    state.v4.swaps = [{ block: 40, sqrt, liquidity: 0n }];
    state.v4.modifies = [{ block: 20, delta: 5000n }, { block: 45, delta: 5000n }];
    const refilled = await readRateFromEvents(config, 50, opts);
    if (refilled.state === 'UNREAD') assert.fail(JSON.stringify(refilled));
    near(refilled.value.usdPerCurb18, 5n * 10n ** 15n, 'priced from the drained swap once liquidity was added');
    assert.equal(poolHadNoPriceAt(await readRateFromEvents(config, 42, opts)), true, 'between the drain and the addition: no liquidity, definitely');
    // The guard: a pump at 95 inside the hour before block 100; the low is the earlier price, and the hook's own swap counts like any other.
    // A pump: fewer CURB per ETH, so each CURB is worth more — US$0.05.
    const pump = sqrtPriceX96For(10n ** 18n, 2n * 10n ** 13n);
    state.v4.swaps = [{ block: 40, sqrt }, { block: 95, sqrt: pump, sender: HOOK }];
    state.v4.modifies = [{ block: 20, delta: 5000n }];
    state.v4.sqrt = pump;
    const guarded = await readRate(config, 100, opts);
    if (guarded.state === 'UNREAD') assert.fail(JSON.stringify(guarded));
    near(guarded.value.guard.atBlockUsdPerCurb18, 5n * 10n ** 16n, 'pumped to US$0.05 at the block');
    near(guarded.value.usdPerCurb18, 5n * 10n ** 15n, 'the guard holds the hour’s low');
    assert.equal(guarded.value.guard.applied, true);
    // A wide query the node gives up on with its own words is halved, not a fault.
    state.v4.timeoutWiderThan = 30;
    const halved = await readRate(config, 100, opts);
    if (halved.state === 'UNREAD') assert.fail(JSON.stringify(halved));
    near(halved.value.usdPerCurb18, 5n * 10n ** 15n, 'the same after halving on the node’s timeout');
    delete state.v4.timeoutWiderThan;
    // The creation check: the Initialize must sit in fromBlock and state the record's key; nothing of this id before it.
    const ok = await checkPoolCreation(config, opts);
    if (ok.state === 'UNREAD') assert.fail(JSON.stringify(ok));
    assert.equal(ok.value.ok, true);
    state.v4.initialize = { block: 20, sqrt, key: { ...V4_KEY, tickSpacing: 60 } };
    const otherKey = await checkPoolCreation(config, opts);
    if (otherKey.state === 'UNREAD') assert.fail(JSON.stringify(otherKey));
    assert.equal(otherKey.value.ok, false);
    assert.match(otherKey.value.detail ?? '', /tick spacing 60/);
    state.v4.initialize = { block: 18, sqrt };
    const wrongBlock = await checkPoolCreation(config, opts);
    if (wrongBlock.state === 'UNREAD') assert.fail(JSON.stringify(wrongBlock));
    assert.equal(wrongBlock.value.ok, false);
    assert.match(wrongBlock.value.detail ?? '', /no Initialize for this pool id in block 20/);
  });

  it('weighs a v4 pool’s liquidity by the net of its signed deltas, so dust added and removed changes nothing', async () => {
    const state = freshState();
    const sqrt = sqrtPriceX96For(10n ** 18n, 2n * 10n ** 12n);
    const pump = sqrtPriceX96For(10n ** 18n, 2n * 10n ** 13n);
    state.feedAnswer = 2500n * 10n ** 8n;
    state.feedAnswers = [{ block: 10, answer: 2500n * 10n ** 8n, roundId: 1n, updatedAt: 1_700_000_000n + 10n * 100n }];
    globalThis.fetch = fakeNode(state);
    // The record's fromBlock is the Initialize's block: 65 for the in-window case, 20 for the rest.
    const configAt = (fromBlock: number) => (parseCreditsConfig(CONFIG_V4_JSON.replace('"fromBlock":20', `"fromBlock":${fromBlock}`)) as { config: CreditsConfig }).config;
    const near = (v: string, target: bigint, label: string) => {
      const d = BigInt(v) > target ? BigInt(v) - target : target - BigInt(v);
      assert.ok(d * 1_000_000n <= target, `${label}: ${v} is not within a millionth of ${target}`);
    };
    // The pool's first hour: initialised at 65 with its graduation position, a dust position added at 70 and removed at 75, one buy at 80 that pumps the price; a top-up at 85.
    state.v4 = { sqrt: pump, liquidity: 5000n, swaps: [{ block: 80, sqrt: pump, liquidity: 5000n }], initialize: { block: 65, sqrt }, modifies: [{ block: 65, delta: 5000n }, { block: 70, delta: 100n }, { block: 75, delta: -100n }] };
    const inWindow = await readRate(configAt(65), 85, opts);
    if (inWindow.state === 'UNREAD') assert.fail(JSON.stringify(inWindow));
    near(inWindow.value.guard.atBlockUsdPerCurb18, 5n * 10n ** 16n, 'pumped at the block');
    near(inWindow.value.usdPerCurb18, 5n * 10n ** 15n, 'the Initialize price inside the window is the guard’s low, dust or no dust');
    assert.equal(inWindow.value.guard.applied, true);
    assert.equal(inWindow.value.guard.samples, 2);
    // The same with the Initialize before the window: it is the opening price, weighed although the last delta before the window is negative.
    const beforeWindow = { ...state.v4, initialize: { block: 20, sqrt }, modifies: [{ block: 20, delta: 5000n }, { block: 30, delta: 100n }, { block: 35, delta: -100n }] };
    state.v4 = beforeWindow;
    const opening = await readRate(configAt(20), 85, opts);
    if (opening.state === 'UNREAD') assert.fail(JSON.stringify(opening));
    near(opening.value.usdPerCurb18, 5n * 10n ** 15n, 'the opening price stands although a dust position was removed');
    assert.equal(opening.value.guard.applied, true);
    // A dust pair in the block before the pump changes nothing either.
    state.v4 = { ...state.v4, modifies: [{ block: 20, delta: 5000n }, { block: 79, delta: 1n, logIndex: 1 }, { block: 79, delta: -1n, logIndex: 2 }] };
    const dust = await readRate(configAt(20), 85, opts);
    if (dust.state === 'UNREAD') assert.fail(JSON.stringify(dust));
    near(dust.value.usdPerCurb18, 5n * 10n ** 15n, 'a +1/−1 pair before the pump is not a removal');
    // A zero delta — a fee collection — after the graduation position is not a removal: the first price still stands by events.
    state.v4 = { sqrt, liquidity: 5000n, swaps: [], initialize: { block: 20, sqrt }, modifies: [{ block: 20, delta: 5000n }, { block: 25, delta: 0n }] };
    const collected = await readRateFromEvents(configAt(20), 30, opts);
    if (collected.state === 'UNREAD') assert.fail(JSON.stringify(collected));
    assert.equal(collected.value.pool.eventBlock, 20);
    // Added and then all of it removed, no swap since: not definite — the sum is what says so.
    state.v4.modifies = [{ block: 20, delta: 5000n }, { block: 25, delta: -5000n }];
    const removed = await readRateFromEvents(configAt(20), 30, opts);
    assert.equal(removed.state, 'UNREAD');
    assert.equal(poolHadNoPriceAt(removed), false);
    // Drained by a swap, then a dust pair: still no liquidity, definitely; then a real addition: priced again.
    state.v4.swaps = [{ block: 40, sqrt, liquidity: 0n }];
    state.v4.modifies = [{ block: 20, delta: 5000n }, { block: 42, delta: 1n, logIndex: 1 }, { block: 42, delta: -1n, logIndex: 2 }];
    assert.equal(poolHadNoPriceAt(await readRateFromEvents(configAt(20), 45, opts)), true, 'a dust pair after the drain is not liquidity');
    state.v4.modifies = [{ block: 20, delta: 5000n }, { block: 42, delta: 1n, logIndex: 1 }, { block: 42, delta: -1n, logIndex: 2 }, { block: 44, delta: 300n }];
    const back = await readRateFromEvents(configAt(20), 45, opts);
    if (back.state === 'UNREAD') assert.fail(JSON.stringify(back));
    assert.equal(back.value.pool.eventBlock, 40);
  });

  it('refuses a v4 record that would price native ETH as a dollar, or that has no Initialize block', () => {
    const base = JSON.parse(CONFIG_V4_JSON);
    const usdEth = parseCreditsConfig(JSON.stringify({ ...base, priceSource: { ...base.priceSource, quote: { kind: 'usd-stable' } } }));
    assert.equal(usdEth.state, 'CONFIG_INVALID');
    assert.match(usdEth.state === 'CONFIG_INVALID' ? usdEth.detail : '', /native ETH, which is not a dollar/);
    const { fromBlock: _dropped, ...withoutFromBlock } = base.priceSource;
    const noInit = parseCreditsConfig(JSON.stringify({ ...base, priceSource: withoutFromBlock }));
    assert.equal(noInit.state, 'CONFIG_INVALID');
    assert.match(noInit.state === 'CONFIG_INVALID' ? noInit.detail : '', /Initialize/);
    const dynamicFee = parseCreditsConfig(JSON.stringify({ ...base, priceSource: { ...base.priceSource, key: { ...V4_KEY, fee: 0x800000 } } }));
    assert.equal(dynamicFee.state, 'CONFIG_INVALID');
    assert.match(dynamicFee.state === 'CONFIG_INVALID' ? dynamicFee.detail : '', /dynamic-fee flag/);
    // An ERC-20 quote with CURB as currency0 is a valid key the other way round: the token sorts lower than the quote.
    const erc20 = parseCreditsConfig(JSON.stringify({ ...base, priceSource: { ...base.priceSource, key: { currency0: CURB, currency1: USDC, fee: 0, tickSpacing: 200, hooks: HOOK }, quote: { kind: 'usd-stable' } } }));
    assert.equal(erc20.state, 'CONFIGURED');
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

    // No swap and no Initialize seen: the pool had no price at the block — a definite fact, since the span reaches the pool's creation.
    const none = await readRateFromEvents(config, 50, opts);
    assert.equal(none.state, 'UNREAD');
    assert.match(none.state === 'UNREAD' ? (none.detail ?? '') : '', /^the pool had no price at block 50: no Swap from the pool, nor an Initialize with liquidity/);
    assert.equal(poolHadNoPriceAt(none), true);
    // Initialised at block 20 and given liquidity at block 25: the Initialize price stands from block 25 until the first swap; before the Mint it is a price nobody can trade at.
    state.v3.initialize = { block: 20, sqrt: forCurbIs0 };
    state.v3.mints = [25];
    const seeded = await readRateFromEvents(config, 50, opts);
    if (seeded.state === 'UNREAD') assert.fail(JSON.stringify(seeded));
    near(seeded.value.usdPerCurb18, 5n * 10n ** 15n, 'v3 before its first swap, from Initialize');
    assert.equal(seeded.value.pool.eventBlock, 20);
    const unseeded = await readRateFromEvents(config, 22, opts);
    assert.equal(unseeded.state, 'UNREAD');
    assert.equal(poolHadNoPriceAt(unseeded), true, 'initialised, no liquidity yet: no price at that block');
    // The pool's first hour: Initialize at 70 inside the window before block 90, a pump swap at 80 — the Initialize price is in the guard, by state and by events.
    state.v3.initialize = { block: 70, sqrt: forCurbIs0 };
    state.v3.mints = [72];
    const pump = sqrtPriceX96For(50n * 10n ** 6n, 10n ** 3n * 10n ** 18n);
    state.v3.swaps = [{ block: 80, sqrt: pump }];
    state.v3.sqrt = pump;
    const firstHour = await readRate(config, 90, opts);
    if (firstHour.state === 'UNREAD') assert.fail(JSON.stringify(firstHour));
    near(firstHour.value.guard.atBlockUsdPerCurb18, 5n * 10n ** 16n, 'pumped to US$0.05 at the block');
    near(firstHour.value.usdPerCurb18, 5n * 10n ** 15n, 'the Initialize price inside the window is the guard’s low');
    assert.equal(firstHour.value.guard.applied, true);
    const firstHourByEvents = await readRateFromEvents(config, 90, opts);
    if (firstHourByEvents.state === 'UNREAD') assert.fail(JSON.stringify(firstHourByEvents));
    near(firstHourByEvents.value.usdPerCurb18, 5n * 10n ** 15n, 'the same by events');
    // A pool of another kind: its price by state has moved from the Initialize, yet no Swap the reader knows was ever emitted — never priced from its first price.
    state.v3.swaps = [];
    const foreign = await readRateFromEvents(config, 90, opts);
    assert.equal(foreign.state, 'UNREAD');
    assert.match(foreign.state === 'UNREAD' ? (foreign.detail ?? '') : '', /without a Swap the reader recognises/);
    // A swap that drained the pool, then a Mint: liquidity is back at that price by events, not a definite no-price.
    state.v3.sqrt = forCurbIs0;
    state.v3.swaps = [{ block: 75, sqrt: forCurbIs0, liquidity: 0n }];
    state.v3.mints = [72, 78];
    const refilled = await readRateFromEvents(config, 85, opts);
    if (refilled.state === 'UNREAD') assert.fail(JSON.stringify(refilled));
    near(refilled.value.usdPerCurb18, 5n * 10n ** 15n, 'priced from the drained swap once a Mint followed');
    const drained = await readRateFromEvents(config, 76, opts);
    assert.equal(poolHadNoPriceAt(drained), true, 'before the Mint: no liquidity, definitely');
    // Initialize, Mint, then a Burn and no swap: liquidity by events cannot be told — waited for, not called definite.
    state.v3.swaps = [];
    state.v3.mints = [72];
    state.v3.burns = [74];
    const uncertain = await readRateFromEvents(config, 76, opts);
    assert.equal(uncertain.state, 'UNREAD');
    assert.equal(poolHadNoPriceAt(uncertain), false);
    assert.match(uncertain.state === 'UNREAD' ? (uncertain.detail ?? '') : '', /cannot be told from its events/);
    delete state.v3.burns;
    delete state.v3.initialize;
    delete state.v3.mints;
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
    assert.match(priceless.index.unpriced[0]!.reason, /^waits \(tried 1\): by state: .*; by events: /);
    assert.equal(priceless.index.unpriced[0]!.attempts, 1);
    assert.equal((await keyAccount(store, hash)).status, 'UNFUNDED');

    // A node that did not answer is waited out — never priced around at the head.
    const transient: RateReaders = { byState: async (c, block, o, now) => (block === 42 ? UNREAD_READER() : readRate(c, block, o, now)), byEvents: UNREAD_READER };
    const waited = await syncTopUps(store, config, opts, new Date(), transient);
    assert.equal(waited.report.unpriced, 1, 'a transport failure by events is not a reason to use the head');
    assert.equal(waited.report.credited.length, 0);
    assert.equal(waited.index.unpriced[0]!.attempts, 2);

    // A reading that is not a definite fact about the block — a scan that did not reach the pool's creation — is waited for, not priced at the head.
    const quiet = async () => ({ state: 'UNREAD' as const, value: null, reason: 'FIELD_ABSENT' as const, source: null, observedAt: new Date().toISOString(), detail: 'no Sync from the pair in the 20,000,000 blocks before block 42' });
    const quietOnly: RateReaders = { byState: async (c, block, o, now) => (block === 42 ? UNREAD_READER() : readRate(c, block, o, now)), byEvents: quiet };
    const stillWaiting = await syncTopUps(store, config, opts, new Date(), quietOnly);
    assert.equal(stillWaiting.report.unpriced, 1, 'an indefinite miss is waited for, not priced at the head');
    assert.equal(stillWaiting.report.credited.length, 0);

    // The top-up was mined before the pool was created — the record's priceSource.fromBlock, read from the chain — so the head when indexed is the rate, and the record says which basis it used.
    const created = (parseCreditsConfig(JSON.stringify({ ...JSON.parse(CONFIG_JSON), priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, fromBlock: 50, quote: { kind: 'usd-stable' } } })) as { config: CreditsConfig }).config;
    assert.equal(created.priceSource?.fromBlock, 50);
    const headOnly: RateReaders = { byState: async (c, block, o, now) => (block === 42 ? UNREAD_READER() : readRate(c, block, o, now)), byEvents: (c, block, o, now) => readRateFromEvents(c, block, o, now) };
    const atHead = await syncTopUps(store, created, opts, new Date(), headOnly);
    assert.equal(atHead.report.unpriced, 0);
    assert.deepEqual(atHead.report.credited.map((c) => [c.cents, c.basis]), [['2000', 'HEAD_AT_INDEXING']]);
    const account = await keyAccount(store, hash);
    assert.equal(account.topUps[0]!.ratedAtBlock, 100);
    assert.equal(account.status, 'OPEN');

    // The pool had no price at the block by state — an empty side there — which is as definite: the head, and the credit says so.
    const other = keyHashOf(newKey());
    state.head = 120;
    state.logs.push({ block: 110, keyHash: other, payer: PAYER, amount: 4_000n * 10n ** 18n, txHash: '0x' + '4'.repeat(64), logIndex: 0 });
    state.reserves = [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n }, { block: 105, curb: 0n, quote: 0n }, { block: 115, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n }];
    const emptied = await syncTopUps(store, config, opts, new Date());
    assert.deepEqual(emptied.report.credited.map((c) => [c.keyHash, c.basis]), [[other, 'HEAD_AT_INDEXING']]);
    assert.equal((await keyAccount(store, other)).topUps[0]!.ratedAtBlock, 120);
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

  it('weighs a busy window page by page: fifteen thousand Syncs in the window are two pages, not a refusal', async () => {
    const state = freshState();
    state.logLimit = 10_000;
    // 15,000 Syncs in the 40-block window before block 100 — more than one answer, fewer than the smallest page can hold — the lowest of them at block 75; the price at the block is higher.
    state.syncs = Array.from({ length: 15_000 }, (_, i) => ({ block: 60 + (i % 40), curb: 4_000_000n * 10n ** 18n, quote: BigInt(20_000 + (i % 40 === 15 ? 0 : 10_000)) * 10n ** 6n, logIndex: i }));
    state.reserves = [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 30_000n * 10n ** 6n }];
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const busy = await readRate(config, 100, opts);
    if (busy.state === 'UNREAD') assert.fail(JSON.stringify(busy));
    assert.equal(busy.value.guard.samples, 15_000);
    assert.equal(busy.value.usdPerCurb18, (5n * 10n ** 15n).toString(), 'the lowest of fifteen thousand');
    assert.equal(busy.value.guard.lowestAtBlock, 75);
    assert.ok(state.calls.filter((c) => c === 'eth_getLogs').length >= 3, 'refused once, then read in two pages');
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
    assert.equal(at700.value.guard.samples, 1, 'the window [660, 699] holds no Sync; the price standing at its opening, the Sync at 650, is the one sample');
    assert.ok(state.calls.filter((c) => c === 'eth_getLogs').length > 3, 'the refused range was halved until the node answered');
    // And the window: a top-up at block 351 sees the Sync at 350 in its forty blocks (US$0.00375, i = 5) and the one standing at the window's opening, at 300 (US$0.0035, i = 4); the refused queries were halved to find them.
    const at351 = await readRateFromEvents(config, 351, opts);
    if (at351.state === 'UNREAD') assert.fail(JSON.stringify(at351));
    assert.equal(at351.value.guard.samples, 2);
    assert.equal(at351.value.guard.atBlockUsdPerCurb18, (375n * 10n ** 13n).toString());
    assert.equal(at351.value.usdPerCurb18, (35n * 10n ** 14n).toString());
    assert.equal(at351.value.guard.lowestAtBlock, 300);
  });

  it('prices at most fifty top-ups a run and lists the rest as next in line — a burst drains at fifty a run, oldest first', async () => {
    const state = freshState();
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    for (let i = 0; i < 130; i += 1) state.logs.push({ block: 42, keyHash: hash, payer: PAYER, amount: 10n ** 18n, txHash: `0x${String(i).padStart(64, 'a')}`, logIndex: i });
    const first = await syncTopUps(store, config, opts, new Date());
    assert.equal(first.report.credited.length, 50);
    assert.equal(first.report.unpriced, 80);
    assert.match(first.index.unpriced[0]!.reason, /^deferred/);
    assert.ok(first.index.unpriced.every((u) => u.attempts === 0), 'deferred, never tried');
    // Fifty more fresh ones arrive: the deferred ones were never tried and stay ahead of them, oldest first, at fifty a run — not ten.
    state.head = 110;
    for (let i = 0; i < 50; i += 1) state.logs.push({ block: 105, keyHash: hash, payer: PAYER, amount: 10n ** 18n, txHash: `0x${String(i).padStart(64, 'f')}`, logIndex: i });
    const second = await syncTopUps(store, config, opts, new Date());
    assert.equal(second.report.credited.length, 50);
    assert.equal(second.report.unpriced, 80, '30 of the first burst and the 50 new ones');
    const third = await syncTopUps(store, config, opts, new Date());
    assert.equal(third.report.credited.length, 50);
    const fourth = await syncTopUps(store, config, opts, new Date());
    assert.equal(fourth.report.credited.length, 30);
    assert.equal(fourth.report.unpriced, 0);
    assert.equal((await keyAccount(store, hash)).topUps.length, 180);
    const blocks = (await keyAccount(store, hash)).topUps.map((t) => t.blockNumber);
    assert.deepEqual(blocks.slice(0, 130), Array(130).fill(42), 'the first burst was credited before anything from the second block');
  });

  it('retries the waiting top-ups a few per run, the least-tried first, after the fresh ones', async () => {
    const state = freshState();
    globalThis.fetch = fakeNode(state);
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    // Block 42 cannot be priced by state or by events for now; block 50 can.
    let stuck = true;
    const readers: RateReaders = { byState: async (c, block, o, now) => (stuck && block === 42 ? UNREAD_READER() : readRate(c, block, o, now)), byEvents: UNREAD_READER };
    for (let i = 0; i < 15; i += 1) state.logs.push({ block: 42, keyHash: hash, payer: PAYER, amount: 10n ** 18n, txHash: `0x${String(i).padStart(64, 'b')}`, logIndex: i });
    const first = await syncTopUps(store, config, opts, new Date(), readers);
    assert.equal(first.report.unpriced, 15);
    assert.ok(first.index.unpriced.every((u) => u.attempts === 1), 'every fresh one was tried once');

    // Three fresh top-ups arrive in a new block: they are priced before any waiting one is retried, and at most ten waiting ones are retried.
    state.head = 110;
    for (let i = 0; i < 3; i += 1) state.logs.push({ block: 105, keyHash: hash, payer: PAYER, amount: 10n ** 18n, txHash: `0x${String(i).padStart(64, 'c')}`, logIndex: i });
    const second = await syncTopUps(store, config, opts, new Date(), readers);
    assert.equal(second.report.credited.length, 3);
    assert.equal(second.report.unpriced, 15);
    const attemptsAfter = (run: { index: { unpriced: readonly { attempts?: number }[] } }) => run.index.unpriced.map((u) => u.attempts ?? 0).sort((a, b) => a - b).join(',');
    assert.equal(attemptsAfter(second), [...Array(15 - MAX_RETRIES_PER_SYNC).fill(1), ...Array(MAX_RETRIES_PER_SYNC).fill(2)].join(','));
    // The five never retried go first next run; then five of the others — nobody is left at the back for good.
    const third = await syncTopUps(store, config, opts, new Date(), readers);
    assert.equal(attemptsAfter(third), [...Array(10).fill(2), ...Array(5).fill(3)].join(','));
    // Block 42 becomes readable: ten a run until none wait.
    stuck = false;
    const fourth = await syncTopUps(store, config, opts, new Date(), readers);
    assert.equal(fourth.report.credited.length, MAX_RETRIES_PER_SYNC);
    assert.equal(fourth.report.unpriced, 5);
    const fifth = await syncTopUps(store, config, opts, new Date(), readers);
    assert.equal(fifth.report.credited.length, 5);
    assert.equal(fifth.report.unpriced, 0);
    assert.equal((await keyAccount(store, hash)).topUps.length, 18);
  });

  it('stops the cursor before a tip block whose hash it could not read, and reads it again next run', async () => {
    const state = freshState();
    const realFetchNode = fakeNode(state);
    let refuseTip = true;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[]; id: number };
      // The tip's block header is refused this run: its hash cannot be kept for the reorg check.
      if (refuseTip && body.method === 'eth_getBlockByNumber' && body.params[0] === `0x${(100).toString(16)}`) {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'header not found' } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetchNode(url, init);
    }) as unknown as typeof globalThis.fetch;
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    state.logs.push({ block: 42, keyHash: hash, payer: PAYER, amount: 4_000n * 10n ** 18n, txHash: '0x' + '4'.repeat(64), logIndex: 0 });
    const partial = await syncTopUps(store, config, opts, new Date());
    assert.equal(partial.report.state, 'PARTIAL');
    assert.equal(partial.index.cursor, 99, 'the cursor stops before the block whose hash is not kept');
    assert.equal(partial.report.credited.length, 1, 'the top-up in a read block is credited all the same');
    assert.ok(!partial.index.blocks.some((b) => b.number === 100));
    refuseTip = false;
    const whole = await syncTopUps(store, config, opts, new Date());
    assert.equal(whole.report.state, 'SYNCED');
    assert.equal(whole.index.cursor, 100);
    assert.ok(whole.index.blocks.some((b) => b.number === 100));
    assert.equal((await keyAccount(store, hash)).topUps.length, 1, 'credited once');
  });

  it('cuts a message before the webhook’s limit and counts what was left out', () => {
    const many: Condition[] = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, severity: 'NOTE', text: `condition ${i} is noted with a long enough line of text to fill the message quickly` }));
    const message = composeMessage({ raised: many, cleared: [], active: many }, new Date());
    assert.ok(message.length <= MESSAGE_MAX_CHARS, `${message.length} chars`);
    assert.match(message, /… and \d+ more lines; the full set is on \/api\/state/);
    assert.match(message, /still active: c0, c1/);
    const short = composeMessage({ raised: [many[0]!], cleared: ['z'], active: [many[0]!] }, new Date());
    assert.doesNotMatch(short, /more line/);
  });

  it('tells a subscriber before it charges, and charges nothing when the row could not be marked told', async () => {
    process.env[CREDITS_ENV] = CONFIG_JSON;
    const inner = tmpStore();
    let failSubWrites = false;
    // A store whose subscription rows stop taking writes: the delivery stands, the charge does not follow.
    const store: Store = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'writeSnapshots') {
          return async (records: readonly SnapshotRecord[]): Promise<WriteOutcome> => {
            if (failSubWrites && records.some((r) => r.key.startsWith(SUB_PREFIX))) return { state: 'FAILED', reason: 'disk full' };
            return target.writeSnapshots(records);
          };
        }
        if (prop === 'writeSnapshotIf') {
          return async (record: SnapshotRecord, expected: number | null): Promise<ConditionalWriteOutcome> => {
            if (failSubWrites && record.key.startsWith(SUB_PREFIX)) return { state: 'FAILED', reason: 'disk full' };
            return target.writeSnapshotIf(record, expected);
          };
        }
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as Store;
    const hash = keyHashOf(newKey());
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2000', topUps: [{ transactionHash: '0x' + '9'.repeat(64), logIndex: 0, blockNumber: 42, payer: PAYER, amount: '1', usdPerCurb18: '1', ratedAtBlock: 42, basis: 'TOP_UP_BLOCK', cents: '2000', creditedAt: new Date().toISOString() }] } }]);
    const sub = await createSubscription(store, hash, 'https://hooks.example.com/a', new Date());
    assert.ok(sub.ok);
    const post = async () => ({ state: 'SENT', status: 204 }) as const;
    const resolve = async () => ['93.184.216.34'];
    const x: Condition = { id: 'x', severity: 'DARK', text: 'x is dark' };
    failSubWrites = true;
    const run = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(run.delivered, 1);
    assert.equal(run.charged, 0, 'delivered but the row would not say so: not charged');
    assert.equal(run.failed.length, 0, 'the webhook did accept it: not a webhook failure');
    assert.match(run.untold[0]?.reason ?? '', /could not be marked told; not charged/);
    assert.equal((await keyAccount(store, hash)).balanceCents, '2000');
    // The rows take writes again: the same change is told again (the row never said it was) and charged once.
    failSubWrites = false;
    const again = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(again.delivered, 1);
    assert.equal(again.charged, 1);
    assert.equal((await keyAccount(store, hash)).balanceCents, '1990');
    const third = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(third.considered, 0, 'told, charged, done');
  });

  for (const contenders of [20, 2]) it(`loses no charge to another charge landing at the same time, and refuses the later one when the first left too little (${contenders} initial contenders)`, async () => {
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2015', topUps: [] } }]);
    // No concurrent charge overwrites another: each lands or is refused as NOT_RECORDED (not served). Two contenders also exercise the setup below with few initial winners, independent of scheduling.
    const outcomes = await Promise.all(Array.from({ length: contenders }, (_, i) => charge(store, hash, 'journal-day', 5, `ref ${i}`, new Date())));
    const landed = outcomes.filter((o) => o.ok).length;
    assert.ok(landed >= 2, `at least the winners of the first rounds land (${landed})`);
    assert.ok(outcomes.every((o) => o.ok || o.status === 'NOT_RECORDED'), 'a refused charge is refused, never silently lost');
    const after = await keyAccount(store, hash);
    assert.equal(after.spentCents, String(5 * landed));
    assert.equal(after.chargeCount, landed);
    assert.equal(after.balanceCents, String(2015 - 5 * landed));
    // Three at once — the realistic burst — all land.
    const three = await Promise.all(Array.from({ length: 3 }, (_, i) => charge(store, hash, 'journal-day', 5, `three ${i}`, new Date())));
    assert.equal(three.filter((o) => o.ok).length, 3, JSON.stringify(three.filter((o) => !o.ok).map((o) => (o.ok ? '' : o.detail))));
    assert.equal((await keyAccount(store, hash)).spentCents, String(5 * landed + 15));
    // Spend down to 1,900 cents without lowering cumulative funding. Rewriting
    // funding as spent + 1,900 could put a key below the 2,000-cent opening
    // minimum when few contenders won, testing eligibility instead of shortage.
    const beforeBurst = await keyAccount(store, hash);
    const setupSpend = BigInt(beforeBurst.balanceCents) - 1900n;
    assert.ok(setupSpend >= 0n && setupSpend <= 115n);
    if (contenders === 2) assert.ok(BigInt(beforeBurst.spentCents) < 100n, 'the few-winners fixture must exercise the old below-minimum setup');
    if (setupSpend > 0n) {
      const prepared = await charge(store, hash, 'journal-day', Number(setupSpend), 'prepare the shortage burst', new Date());
      assert.equal(prepared.ok, true);
    }
    const short = await keyAccount(store, hash);
    assert.equal(short.creditedCents, '2015', 'cumulative funding must stay above the opening minimum');
    assert.equal(short.status, 'OPEN');
    assert.equal(short.balanceCents, '1900');
    let fit = 0;
    for (let round = 0; round < 12; round += 1) {
      const more = await Promise.all(Array.from({ length: 3 }, (_, i) => charge(store, hash, 'evidence-versions', 100, `big ${round}.${i}`, new Date())));
      fit += more.filter((o) => o.ok).length;
      assert.ok(more.filter((o) => !o.ok).every((o) => !o.ok && (o.status === 'INSUFFICIENT' || o.status === 'NOT_RECORDED')));
    }
    assert.equal(fit, 19, 'nineteen of a hundred cents fit in 1,900; the twentieth is refused with the figures');
    const exhausted = await keyAccount(store, hash);
    assert.equal(exhausted.creditedCents, '2015');
    assert.equal(exhausted.status, 'OPEN');
    assert.equal(exhausted.balanceCents, '0');
  });

  it('keeps a cancellation that lands while the fan-out is writing the same row, and counts a delivery whose charge did not land', async () => {
    process.env[CREDITS_ENV] = CONFIG_JSON;
    const inner = tmpStore();
    let cancelDuring: { keyHash: string; id: string } | null = null;
    let starveDuring: string | null = null;
    // Between the fan-out's read of a row and its write, a DELETE lands (cancelDuring), or another call spends the key down (starveDuring).
    const store: Store = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'writeSnapshotIf') {
          return async (record: SnapshotRecord, expected: number | null): Promise<ConditionalWriteOutcome> => {
            if (cancelDuring !== null && record.key === `${SUB_PREFIX}${cancelDuring.id}`) {
              const c = cancelDuring;
              cancelDuring = null;
              const cancelled = await cancelSubscription(target, c.keyHash, c.id, new Date());
              assert.equal(cancelled.ok, true);
            }
            if (starveDuring !== null && record.key.startsWith(SUB_PREFIX) && (record.payload.lastDelivery as { detail?: string } | null)?.detail === 'delivered; the charge follows') {
              const h = starveDuring;
              starveDuring = null;
              await target.writeSnapshots([{ key: spendRow(h), observedAt: new Date().toISOString(), payload: { hash: h, spentCents: '1995', count: 1, charges: [] } }]);
            }
            return target.writeSnapshotIf(record, expected);
          };
        }
        const v = Reflect.get(target, prop, receiver) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as Store;
    const hash = keyHashOf(newKey());
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2000', topUps: [] } }]);
    const sub = await createSubscription(store, hash, 'https://hooks.example.com/a', new Date());
    assert.ok(sub.ok);
    const post = async () => ({ state: 'SENT', status: 204 }) as const;
    const resolve = async () => ['93.184.216.34'];
    const x: Condition = { id: 'x', severity: 'DARK', text: 'x is dark' };

    // The cancellation lands as the fan-out writes: the write finds the row moved, reads it cancelled, and writes nothing; no charge.
    cancelDuring = { keyHash: hash, id: sub.ok ? sub.subscription.id : '' };
    const raced = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(raced.delivered, 1, 'the post had gone out before the cancellation landed');
    assert.equal(raced.charged, 0);
    assert.equal(raced.untold.length, 1);
    const mine = await subscriptionsOf(store, hash);
    assert.notEqual(mine.subscriptions[0]!.cancelledAt, null, 'the cancellation stands');
    assert.equal((await keyAccount(store, hash)).balanceCents, '2000');
    const again = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(again.considered, 0, 'a cancelled subscription is not delivered to');

    // A key spent down between the admission and the charge: told, delivered, not charged — counted as the desk's loss, and a condition names it.
    const sub2 = await createSubscription(store, hash, 'https://hooks.example.com/b', new Date());
    assert.ok(sub2.ok);
    starveDuring = hash;
    const starved = await fanOut(store, new Date(), [x], post, resolve);
    assert.equal(starved.delivered, 1);
    assert.equal(starved.charged, 0);
    assert.equal(starved.uncharged.length, 1);
    assert.match(starved.uncharged[0]!.reason, /balance is 5 cents/);
    const rows = [{ key: 'credits:run', observedAt: new Date().toISOString(), payload: { at: new Date().toISOString(), rate: 'READ', rateDetail: null, code: 'MATCHES', codeDetail: null, index: 'SYNCED', indexDetail: null, waitingForRate: 0, fanOutFailed: 0, fanOutUncharged: starved.uncharged.length, behindBlocks: 0, configured: true } }];
    assert.deepEqual(positionConditions(rows, new Date()).map((c) => [c.id, c.severity]), [['credits:fanout:UNCHARGED', 'NOTE']]);
  });

  it('holds the index when the record’s fromBlock is later than a log the pool emitted, found through the node’s own refusals', async () => {
    const state = freshState();
    state.deskCode = await deskCodeFor(CURB, TREASURY);
    state.logLimit = 3;
    // Syncs from block 20 on; the record claims the pool was created in block 50.
    state.syncs = Array.from({ length: 7 }, (_, i) => ({ block: 20 + i * 12, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n, logIndex: i }));
    state.logs.push({ block: 42, keyHash: keyHashOf(newKey()), payer: PAYER, amount: 4_000n * 10n ** 18n, txHash: '0x' + '2'.repeat(64), logIndex: 0 });
    globalThis.fetch = fakeNode(state);
    const store = tmpStore();
    process.env[CREDITS_ENV] = JSON.stringify({ ...JSON.parse(CONFIG_JSON), priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, fromBlock: 50, quote: { kind: 'usd-stable' } } });
    const wrong = await runCredits(store, new Date(), []);
    assert.equal(wrong.code?.state, 'MATCHES');
    assert.equal(wrong.index?.state, 'HELD');
    assert.match(wrong.index?.detail ?? '', /fromBlock 50 is later than a log the pool emitted in block 20/);
    assert.equal(wrong.index?.credited.length, 0, 'nothing is credited on a wrong configuration');
    const kept = await store.snapshots('credits:pool');
    assert.deepEqual(kept.state === 'UNREAD' ? null : [kept.value[0]?.payload.logBefore, kept.value[0]?.payload.ok], [20, false]);
    // Corrected: the check is made again for the new fromBlock and the top-up is credited.
    process.env[CREDITS_ENV] = JSON.stringify({ ...JSON.parse(CONFIG_JSON), priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, fromBlock: 20, quote: { kind: 'usd-stable' } } });
    const right = await runCredits(store, new Date(), []);
    assert.equal(right.index?.state, 'SYNCED');
    assert.equal(right.index?.credited.length, 1);
  });

  it('holds the subscription caps and the same-URL rule under concurrent requests', async () => {
    process.env[CREDITS_ENV] = CONFIG_JSON;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2000', topUps: [] } }]);
    const same = await Promise.all(Array.from({ length: 20 }, () => createSubscription(store, hash, 'https://hooks.example.com/same', new Date())));
    assert.equal(same.filter((o) => o.ok).length, 1, 'one URL, one subscription, however many requests at once');
    assert.ok(same.filter((o) => !o.ok).every((o) => !o.ok && (o.error === 'ALREADY_SUBSCRIBED' || o.error === 'NOT_RECORDED')));
    const distinct = await Promise.all(Array.from({ length: 12 }, (_, i) => createSubscription(store, hash, `https://hooks.example.com/d${i}`, new Date())));
    assert.equal(distinct.filter((o) => o.ok).length, 4, 'five live at most, one taken already');
    assert.ok(distinct.filter((o) => !o.ok).every((o) => !o.ok && (o.error === 'TOO_MANY' || o.error === 'NOT_RECORDED')));
    const mine = await subscriptionsOf(store, hash);
    assert.equal(mine.subscriptions.filter((x) => x.cancelledAt === null).length, 5);
    // A cancellation frees the slot and the URL.
    const first = same.find((o) => o.ok);
    assert.ok(first && first.ok);
    assert.equal((await cancelSubscription(store, hash, first.subscription.id, new Date())).ok, true);
    const again = await createSubscription(store, hash, 'https://hooks.example.com/same', new Date());
    assert.equal(again.ok, true, 'the URL can be subscribed again after its cancellation');
  });

  it('does not tell subscribers of the fan-out’s own bookkeeping', async () => {
    const state = freshState();
    state.deskCode = await deskCodeFor(CURB, TREASURY);
    globalThis.fetch = fakeNode(state);
    process.env[CREDITS_ENV] = CONFIG_JSON;
    const store = tmpStore();
    const hash = keyHashOf(newKey());
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2000', topUps: [] } }]);
    assert.ok((await createSubscription(store, hash, 'https://hooks.example.com/z', new Date())).ok);
    const run = await runCredits(store, new Date(), [{ id: 'credits:fanout:UNCHARGED', severity: 'NOTE', text: 'the desk lost ten cents' }, { id: 'credits:fanout:FAILED', severity: 'NOTE', text: 'a webhook failed' }]);
    assert.equal(run.fanOut?.considered, 0, 'nothing a subscriber pays to hear');
  });

  it('does not quote from a rate row an earlier build wrote', async () => {
    const store = tmpStore();
    await store.writeSnapshots([{ key: 'credits:rate', observedAt: new Date().toISOString(), payload: { state: 'READ', at: '2026-09-01T00:00:00.000Z', rate: { block: 7, usdPerCurb18: '1' } } }]);
    const old = await latestRate(store);
    assert.equal(old.storeFault, null);
    assert.equal(old.rate?.state, 'UNREAD');
    if (old.rate?.state === 'UNREAD') {
      assert.equal(old.rate.reason, 'RATE_ROW_OLD');
      assert.equal(old.rate.block, 7);
    }
  });

  it('reports an uncertain settlement without retrying or claiming that no debit landed', async () => {
    process.env[CREDITS_ENV] = CONFIG_JSON;
    // Both realities are possible after a lost store acknowledgement. The API
    // must preserve uncertainty until the caller reads its balance, not retry.
    for (const landed of [false, true]) {
      const inner = tmpStore();
      const key = newKey();
      const hash = keyHashOf(key);
      await inner.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2000', topUps: [] } }]);
      let writes = 0;
      const store = new Proxy(inner, {
        get(target, prop, receiver) {
          if (prop === 'writeSnapshotIf') {
            return async (record: SnapshotRecord, expected: number | null): Promise<ConditionalWriteOutcome> => {
              writes += 1;
              if (landed) assert.equal((await target.writeSnapshotIf(record, expected)).state, 'WRITTEN');
              return { state: 'FAILED', reason: 'the write acknowledgement was lost and the row could not be read either' };
            };
          }
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      }) as Store;
      const result = await gate(new Request('https://the-curb.test/api/x', { headers: { 'x-curb-key': key } }), store, 'journal-day', 'uncertain response');
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.response.status, 503);
        const body = await result.response.json();
        assert.equal(body.error, 'NOT_RECORDED');
        assert.equal(body.charged, 'UNKNOWN');
      }
      assert.equal(writes, 1, 'an uncertain debit is never retried automatically');
      const recovered = await keyAccount(inner, hash);
      assert.equal(recovered.spentCents, landed ? '5' : '0');
      assert.equal(recovered.chargeCount, landed ? 1 : 0);
      assert.equal(recovered.balanceCents, landed ? '1995' : '2000');
    }
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

    // Before any tick has verified the desk's code, the 402 names no way to pay: a top-up to an unverified desk is not invited.
    const unverified = await gate(req({ 'x-curb-key': key }), store, 'journal-day', 'ref');
    assert.equal(unverified.ok, false);
    if (!unverified.ok) {
      const body = (await unverified.response.json()) as Record<string, unknown>;
      assert.equal(body.error, 'UNFUNDED');
      assert.equal(body.topUp, null);
      assert.match(String(body.topUpHeld), /not verified as the build/);
    }
    // Both code identity/immutables and the rate must be current before a way to pay is named.
    const config = (parseCreditsConfig(CONFIG_JSON) as { config: CreditsConfig }).config;
    const at = new Date().toISOString();
    const immutables = Object.entries(expectedDeskImmutables(config)).map(([name, expected]) => ({ name, expected: `0x${expected}`, onChain: `0x${expected}`, matches: true }));
    await store.writeSnapshots([
      { key: 'credits:code', observedAt: at, payload: { chainId: 31337, address: DESK, state: 'MATCHES', detail: null, codeHash: '0x', buildCommit: 'abc', solc: '0.8.30', immutables, readAt: at } },
      { key: 'credits:rate', observedAt: at, payload: { state: 'READ', chainId: 31337, at, rate: {
        block: 100, basis: 'STATE', readAt: at, token: { address: CURB, decimals: 18, supply: '1000000000000000000000000', supplyAt: 'BLOCK' },
        pool: { kind: 'uniswap-v2-pair', address: PAIR, quoteAddress: USDC, quoteDecimals: 6 }, quote: { kind: 'usd-stable' },
        usdPerCurb18: '1000000000000000000', marketCapUsd18: '1000000000000000000000000', source: 'synthetic local test',
        guard: { windowBlocks: 40, samples: 1, lowestAtBlock: 90, atBlockUsdPerCurb18: '1000000000000000000', applied: false },
      } } },
    ]);
    const unfunded = await gate(req({ 'x-curb-key': key }), store, 'journal-day', 'ref');
    assert.equal(unfunded.ok, false);
    if (!unfunded.ok) {
      assert.equal(unfunded.response.status, 402);
      const body = (await unfunded.response.json()) as Record<string, unknown>;
      assert.equal(body.error, 'UNFUNDED');
      assert.equal(body.keyHash, hash);
      assert.equal(body.toOpenCents, '2000');
      assert.equal((body.topUp as Record<string, unknown>).desk, DESK);
      assert.equal(body.topUpHeld, null);
    }
    // A verification of another desk is no verification of this one.
    await store.writeSnapshots([{ key: 'credits:code', observedAt: new Date().toISOString(), payload: { chainId: 31337, address: PAYER, state: 'MATCHES', detail: null, codeHash: '0x', buildCommit: 'abc', solc: '0.8.30', immutables: [], readAt: new Date().toISOString() } }]);
    assert.equal((await latestDeskCode(store, config)).code, null);
    await store.writeSnapshots([{ key: 'credits:code', observedAt: new Date().toISOString(), payload: { chainId: 31337, address: DESK, state: 'MATCHES', detail: null, codeHash: '0x', buildCommit: 'abc', solc: '0.8.30', immutables: [], readAt: new Date().toISOString() } }]);

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
    // Exercise the real verification -> recorded snapshot -> HTTP quote path.
    // Handwritten unprefixed immutable fixtures previously hid an integration bug.
    const quoted = await (await creditsResponse(new Request('http://127.0.0.1/api/credits?usd=20'), parseCreditsConfig(CONFIG_JSON), store)).json();
    assert.equal(quoted.quoteReadiness.codeCurrent, true);
    assert.equal(quoted.quote.state, 'QUOTED');
    assert.equal(quoted.topUp.desk, DESK);
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
