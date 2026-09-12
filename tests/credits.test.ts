import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { NETWORKS } from '../lib/chain/networks.ts';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import { selector } from '../lib/chain/keccak.ts';
import { CREDITS_ENV, parseCreditsConfig, type CreditsConfig } from '../lib/credits/config.ts';
import { gate } from '../lib/credits/guard.ts';
import { INDEX_KEY, TOPUP_TOPIC, decodeTopUp, syncTopUps } from '../lib/credits/indexer.ts';
import { charge, isKey, keyAccount, keyHashOf, newKey, spendRow, topUpsRow } from '../lib/credits/keys.ts';
import { latestRate, runCredits } from '../lib/credits/maintenance.ts';
import { MINIMUM_OPEN_CENTS, SERVICES, centsText } from '../lib/credits/prices.ts';
import { centsForCurb, curbForCents, curbText, readRate, usd18Text, type Rate } from '../lib/credits/rate.ts';
import { createSubscription, fanOut, subscriptionsOf, webhookFault } from '../lib/credits/subscriptions.ts';
import { transitionId } from '../lib/ops/alerts.ts';
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
const PAYER = '0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';

const word = (v: bigint) => v.toString(16).padStart(64, '0');
const hexWord = (v: bigint) => `0x${word(v)}`;
const blockHashOf = (n: number, fork = 0) => `0x${(BigInt(n) * 1_000_003n + BigInt(fork)).toString(16).padStart(64, '0')}`;

const CONFIG_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, fromBlock: 40, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'usd-stable' } } });
const CONFIG_FEED_JSON = JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, fromBlock: 40, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'chainlink-feed', feed: FEED } } });

interface NodeState {
  head: number;
  fork: number;
  /** CURB and quote reserves by block; the last entry at or before a block applies. */
  reserves: { block: number; curb: bigint; quote: bigint }[];
  logs: { block: number; keyHash: string; payer: string; amount: bigint; txHash: string; logIndex: number }[];
  supply: bigint;
  feedAnswer: bigint;
  calls: string[];
}

/** A node that answers the chain id, heads, block hashes, logs and the pool's and token's views at a block. */
function fakeNode(state: NodeState) {
  const SEL = { token0: selector('token0()'), token1: selector('token1()'), getReserves: selector('getReserves()'), decimals: selector('decimals()'), totalSupply: selector('totalSupply()'), latestRoundData: selector('latestRoundData()') };
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
      case 'eth_getBlockByNumber': {
        const tag = params[0] as string;
        const n = tag === 'latest' ? state.head : Number.parseInt(tag, 16);
        result = n > state.head ? null : { number: `0x${n.toString(16)}`, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, hash: blockHashOf(n, n >= 42 ? state.fork : 0) };
        break;
      }
      case 'eth_getLogs': {
        const q = params[0] as { address: string; fromBlock: string; toBlock: string; topics: string[] };
        const from = Number.parseInt(q.fromBlock, 16);
        const to = Number.parseInt(q.toBlock, 16);
        result = state.logs
          .filter((l) => l.block >= from && l.block <= to && q.address.toLowerCase() === DESK)
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
        const block = Number.parseInt(params[1] as string, 16);
        if (block > state.head) {
          error = { code: -32000, message: 'header not found' };
          break;
        }
        const t = to.toLowerCase();
        const sel = data.slice(0, 10);
        if (t === PAIR && sel === SEL.token0) result = hexWord(BigInt(CURB));
        else if (t === PAIR && sel === SEL.token1) result = hexWord(BigInt(USDC));
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
  return { head: 100, fork: 0, reserves: [{ block: 0, curb: 4_000_000n * 10n ** 18n, quote: 20_000n * 10n ** 6n }], logs: [], supply: 10n ** 9n * 10n ** 18n, feedAnswer: 0n, calls: [] };
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
    assert.equal(parseCreditsConfig(JSON.stringify({ network: 'hardhat-local', token: CURB, desk: DESK, fromBlock: 1, priceSource: { kind: 'oracle-of-nothing' } })).state, 'CONFIG_INVALID');
    const ok = parseCreditsConfig(CONFIG_JSON);
    assert.equal(ok.state, 'CONFIGURED');
    if (ok.state === 'CONFIGURED') {
      assert.equal(ok.config.network.chainId, 31337);
      assert.equal(ok.config.priceSource.pair, PAIR);
      assert.equal(ok.config.priceSource.quote.kind, 'usd-stable');
    }
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
      token: { address: CURB, decimals: 18, supply: (10n ** 27n).toString() },
      pair: { address: PAIR, reserveCurb: '0', reserveQuote: '0', quoteAddress: USDC, quoteDecimals: 6 },
      quote: { kind: 'usd-stable' },
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
    assert.equal(rate.value.pair.quoteAddress, USDC);
    assert.equal(rate.value.pair.quoteDecimals, 6);
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

    // A node that prices nothing: the top-up waits, listed with the reason.
    const priceless = await syncTopUps(store, config, opts, new Date(), async () => ({ state: 'UNREAD', value: null, reason: 'SOURCE_UNREACHABLE', source: null, observedAt: new Date().toISOString(), detail: 'archive gone' }));
    assert.equal(priceless.report.newTopUps, 1);
    assert.equal(priceless.report.credited.length, 0);
    assert.equal(priceless.report.unpriced, 1);
    assert.equal((await keyAccount(store, hash)).status, 'UNFUNDED');

    // The next tick prices at the head when the block itself cannot be, and the record says which basis it used.
    const atHead = await syncTopUps(store, config, opts, new Date(), async (c, block, o, now) => (block === 42 ? { state: 'UNREAD', value: null, reason: 'SOURCE_UNREACHABLE', source: null, observedAt: now.toISOString(), detail: 'archive gone' } : readRate(c, block, o, now)));
    assert.equal(atHead.report.unpriced, 0);
    assert.deepEqual(atHead.report.credited.map((c) => [c.cents, c.basis]), [['2000', 'HEAD_AT_INDEXING']]);
    const account = await keyAccount(store, hash);
    assert.equal(account.topUps[0]!.ratedAtBlock, 100);
    assert.equal(account.status, 'OPEN');
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

    // At the minimum: charged, answered, and the balance is on the account.
    await store.writeSnapshots([{ key: topUpsRow(hash), observedAt: new Date().toISOString(), payload: { hash, creditedCents: '2010', topUps: [credit('1500', 1), credit('510', 2)] } }]);
    const ok = await gate(req({ authorization: `Bearer ${key}` }), store, 'evidence-versions', 'apple-s1 · xstocks:AAPLx');
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.account.balanceCents, '2005');
      assert.equal(ok.account.chargeCount, 1);
      assert.equal(ok.account.charges[0]!.ref, 'apple-s1 · xstocks:AAPLx');
    }
    const spend = await store.snapshots(spendRow(hash));
    assert.equal(spend.state === 'UNREAD' ? null : spend.value[0]?.payload.spentCents, '5');

    // Spend it down to less than a call: refused as INSUFFICIENT, nothing served.
    await store.writeSnapshots([{ key: spendRow(hash), observedAt: new Date().toISOString(), payload: { hash, spentCents: '2008', count: 2, charges: [] } }]);
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
    assert.ok(a.ok && b.ok && c.ok);
    const dup = await createSubscription(store, rich, 'https://hooks.example.com/a', new Date());
    assert.equal(dup.ok === false ? dup.error : '', 'ALREADY_SUBSCRIBED');

    const posted: string[] = [];
    const post = async (_message: string, webhook: string) => {
      posted.push(webhook);
      return webhook.endsWith('/b') ? ({ state: 'FAILED', reason: 'HTTP 500' } as const) : ({ state: 'SENT', status: 204 } as const);
    };
    const t1 = transitionId({ raised: [{ id: 'x', severity: 'DARK', text: 'x' }] as never, cleared: [], active: [{ id: 'x', severity: 'DARK', text: 'x' }] as never });
    const first = await fanOut(store, new Date(), 'THE CURB · raised x', t1, post);
    assert.equal(first.considered, 3);
    assert.equal(first.delivered, 1, 'a delivered, b failed, c short');
    assert.equal(first.charged, 1);
    assert.deepEqual(first.failed.map((f) => f.id), [b.ok ? b.subscription.id : '']);
    assert.deepEqual(first.skipped.map((s) => [s.id, s.reason]), [[c.ok ? c.subscription.id : '', 'INSUFFICIENT']]);
    assert.equal((await keyAccount(store, rich)).balanceCents, '1990');
    assert.equal((await keyAccount(store, poor)).balanceCents, '5');

    // The same transition again: a already has it; b is tried again and fails again; c is still short. Nothing new is charged.
    const second = await fanOut(store, new Date(), 'THE CURB · raised x', t1, post);
    assert.equal(second.delivered, 0);
    assert.equal(second.charged, 0);
    assert.equal((await keyAccount(store, rich)).balanceCents, '1990');
    assert.deepEqual(posted.filter((w) => w.endsWith('/a')).length, 1);

    // Nothing to send: nothing considered.
    const nothing = await fanOut(store, new Date(), null, null, post);
    assert.equal(nothing.considered, 0);

    const mine = await subscriptionsOf(store, rich);
    assert.equal(mine.subscriptions.length, 2);
    const delivered = mine.subscriptions.find((s) => s.url.endsWith('/a'))!;
    assert.equal(delivered.deliveries, 1);
    assert.equal(delivered.lastDelivery?.charged, true);
    assert.equal(delivered.lastTransitionId, t1);
  });

  it('runs on the tick: NOT_CONFIGURED without a record; with one, the rate at the head is recorded with its block', async () => {
    const store = tmpStore();
    const off = await runCredits(store, new Date(), null);
    assert.equal(off.state, 'NOT_CONFIGURED');
    assert.equal(await latestRate(store), null);

    const state = freshState();
    globalThis.fetch = fakeNode(state);
    process.env[CREDITS_ENV] = CONFIG_JSON;
    const on = await runCredits(store, new Date(), { message: null, transitionId: null });
    assert.equal(on.state, 'CONFIGURED');
    assert.equal(on.rate?.state, 'READ');
    if (on.rate?.state === 'READ') {
      assert.equal(on.rate.rate.block, 100);
      assert.equal(on.rate.rate.marketCapUsd18, (5_000_000n * 10n ** 18n).toString());
    }
    assert.equal(on.index?.state, 'SYNCED');
    assert.equal(on.fanOut?.considered, 0);
    const recorded = await latestRate(store);
    assert.equal(recorded?.state, 'READ');

    // The pool empties: the tick records UNREAD with the reason, not the last rate again.
    state.reserves = [{ block: 0, curb: 0n, quote: 0n }];
    const dry = await runCredits(store, new Date(), null);
    assert.equal(dry.rate?.state, 'UNREAD');
    assert.equal((await latestRate(store))?.state, 'UNREAD');
  });
});

describe('the selector the services page assembles by hand', () => {
  it('is the one keccak gives for topUp(bytes32,uint256)', () => {
    assert.equal(selector('topUp(bytes32,uint256)'), '0xb67644b9');
    assert.equal(TOPUP_TOPIC, '0x6e7690b9717f311efac1eee5fa4bc5ab15ddfd75a5a43eed4f79604e6855b685');
  });
});
