import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { DESK_CODE_KEY, expectedDeskImmutables, type DeskCodeVerification } from '../lib/credits/code.ts';
import { parseCreditsConfig } from '../lib/credits/config.ts';
import { INDEX_KEY } from '../lib/credits/indexer.ts';
import { TOPUPS_PREFIX } from '../lib/credits/keys.ts';
import { creditRateHistoryKey, latestRate, RATE_KEY, type RateSnapshot } from '../lib/credits/maintenance.ts';
import { unread, type Reading } from '../lib/doctrine/reading.ts';
import { currentDeskCode, currentRate, LAUNCH_READ_MAX_AGE_MS, rateHistory, recentRead } from '../lib/launch/evidence.ts';
import { SAFE_EVIDENCE, launchStatus, shortAddress } from '../lib/launch/status.ts';
import type { ObservationRecord, SnapshotRecord, Store } from '../lib/store/types.ts';

const NOW = new Date('2026-09-13T09:00:00Z');
const AT = '2026-09-13T08:59:00Z';
const TOKEN = '0x1000000000000000000000000000000000000001';
const PAIR = '0x2000000000000000000000000000000000000002';
const DESK = '0x3000000000000000000000000000000000000003';
const TREASURY = '0x4000000000000000000000000000000000000004';
const OTHER = '0x5000000000000000000000000000000000000005';
const KEY = `0x${'a'.repeat(64)}`;
const TX = `0x${'b'.repeat(64)}`;
const CONFIG_JSON = JSON.stringify({ network: 'robinhood-mainnet', token: TOKEN, desk: DESK, treasury: TREASURY, fromBlock: 100, priceSource: { kind: 'uniswap-v2-pair', pair: PAIR, quote: { kind: 'usd-stable' } } });
const parsed = parseCreditsConfig(CONFIG_JSON);
if (parsed.state !== 'CONFIGURED') throw new Error('invalid test configuration');
const CONFIG = parsed.config;
function code(): DeskCodeVerification {
  return { chainId: 4663, address: DESK, state: 'MATCHES', detail: null, codeHash: `0x${'c'.repeat(64)}`, buildCommit: 'd'.repeat(40), solc: '0.8.30', readAt: AT,
    immutables: Object.entries(expectedDeskImmutables(CONFIG)).map(([name, expected]) => ({ name, expected: `0x${expected}`, onChain: `0x${expected}`, matches: true })) };
}
function rate(): RateSnapshot & { state: 'READ' } {
  return { state: 'READ', chainId: 4663, at: AT, rate: { block: 200, basis: 'STATE', token: { address: TOKEN, decimals: 18, supply: '100000000000000000000', supplyAt: 'BLOCK' },
    pool: { kind: 'uniswap-v2-pair', address: PAIR, quoteAddress: OTHER, quoteDecimals: 6 }, quote: { kind: 'usd-stable' },
    guard: { windowBlocks: 40, samples: 2, lowestAtBlock: 190, atBlockUsdPerCurb18: '1000000000000000000', applied: false },
    usdPerCurb18: '1000000000000000000', marketCapUsd18: '100000000000000000000', source: 'fixture: chain 4663', readAt: AT } };
}
const row = (key: string, payload: unknown): SnapshotRecord => ({ key, observedAt: AT, payload: payload as Record<string, unknown> });
const verified = <T>(value: T): Reading<T> => ({ state: 'VERIFIED', value, ageSeconds: 0, source: 'fixture', retrievedAt: AT });
const unavailable = () => unread('SOURCE_UNREACHABLE', { source: 'fixture store', detail: 'database unavailable', now: NOW });
const noStore = new Proxy({}, { get: (_t, name) => () => Promise.reject(new Error(`unexpected store read: ${String(name)}`)) }) as Store;
function storeOf(rows: readonly SnapshotRecord[] = [], refused: readonly string[] = []): Store {
  return { snapshots: async (prefix: string) => refused.includes(prefix) ? unavailable() : verified(rows.filter((r) => r.key.startsWith(prefix))) } as Store;
}
function evidenceRows(): SnapshotRecord[] {
  return [row(DESK_CODE_KEY, code()), row(RATE_KEY, rate()), row(INDEX_KEY, { network: 'robinhood-mainnet', desk: DESK, cursor: 200, updatedAt: AT,
    blocks: [], applied: [{ ref: `${TX}:2`, blockNumber: 180, keyHash: KEY }], unpriced: [], faults: [] }),
  row(TOPUPS_PREFIX + KEY, { topUps: [{ desk: DESK, transactionHash: TX, logIndex: 2, blockNumber: 180, payer: OTHER, amount: '1000000000000000000', usdPerCurb18: '1000000000000000000', ratedAtBlock: 180, basis: 'TOP_UP_BLOCK', cents: '100', creditedAt: AT }] })];
}
// These casts deliberately simulate malformed persisted JSON, not valid domain objects.
const mutable = (v: unknown) => v as Record<string, any>;
const safeRecord = () => ({ plan: { chainId: 4663, predictedAddress: TREASURY }, creation: { block: 1234 }, asRead: { owners: [TOKEN, DESK, OTHER], threshold: '2', codeBytes: 100 } });

describe('conservative launch milestones', () => {
  const original = process.env.CURB_CREDITS;
  let root: string;
  beforeEach(() => { delete process.env.CURB_CREDITS; root = mkdtempSync(path.join(tmpdir(), 'curb-launch-test-')); });
  afterEach(() => {
    if (original === undefined) delete process.env.CURB_CREDITS; else process.env.CURB_CREDITS = original;
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('curb-launch-test-'));
    rmSync(resolved, { recursive: true, force: true });
  });
  const configure = () => { process.env.CURB_CREDITS = CONFIG_JSON; };
  const writeSafe = (value: unknown) => { const file = path.join(root, SAFE_EVIDENCE); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  it('says the treasury is live from valid Safe evidence, and that nothing is sold yet', async () => {
    writeSafe(safeRecord()); const status = await launchStatus(noStore, root, NOW);
    assert.equal(status.step, 'TREASURY_RECORDED');
    assert.deepEqual(status.treasury, { address: TREASURY, owners: 3, threshold: '2', block: 1234 });
    assert.match(status.line, /^On Robinhood Chain mainnet: the operator's 2-of-3 Safe — the treasury every top-up goes to — is live at 0x4000…0004 \(block 1,234\); the token and the desk come next, so nothing is sold yet\./);
    assert.doesNotMatch(status.line, /TREASURY_RECORDED|TREASURY_LIVE|guarantee/);
  });
  for (const [name, alter] of [
    ['wrong chain', (s: any) => { s.plan.chainId = 1; }], ['zero address', (s: any) => { s.plan.predictedAddress = `0x${'0'.repeat(40)}`; }],
    ['duplicate owners', (s: any) => { s.asRead.owners = [TOKEN, TOKEN]; }], ['impossible threshold', (s: any) => { s.asRead.threshold = '4'; }],
    ['no observed code', (s: any) => { s.asRead.codeBytes = 0; }], ['invalid creation block', (s: any) => { s.creation.block = -1; }],
  ] as const) {
    it(`does not infer on-chain absence from a Safe record with ${name}`, async () => {
      const record = safeRecord(); alter(record); writeSafe(record); const status = await launchStatus(noStore, root, NOW);
      assert.equal(status.step, 'NOTHING'); assert.equal(status.treasury, null);
      assert.match(status.line, /no treasury creation record is available here/);
      assert.doesNotMatch(status.line, /is live|no treasury.*on chain/i);
    });
  }
  it('treats missing, malformed and null Safe files as missing local evidence', async () => {
    for (const body of [undefined, '{broken', 'null']) {
      if (body !== undefined) writeSafe(body);
      const status = await launchStatus(noStore, root, NOW);
      assert.equal(status.treasury, null); assert.match(status.line, /no treasury creation record is available here/);
    }
  });
  it('reports invalid configuration without reading the store', async () => {
    process.env.CURB_CREDITS = '{broken'; const status = await launchStatus(noStore, root, NOW);
    assert.equal(status.desk, null); assert.ok(status.faults.some((f) => f.includes('not JSON')));
  });
  it('does not describe Ethereum configuration as a Robinhood deployment', async () => {
    process.env.CURB_CREDITS = CONFIG_JSON.replace('robinhood-mainnet', 'ethereum-mainnet');
    const status = await launchStatus(noStore, root, NOW); assert.equal(status.desk, null); assert.equal(status.step, 'NOTHING');
  });
  it('configuration alone proves neither deployment nor matching code', async () => {
    configure(); const status = await launchStatus(storeOf(), root, NOW);
    assert.equal(status.step, 'DESK_CONFIGURED'); assert.match(status.line, /configuration alone does not prove deployment/);
    assert.equal(status.rateAtBlock, null); assert.equal(status.topUp, null);
  });
  it('a fresh rate and receipt cannot promote a desk without matching code', async () => {
    configure(); const status = await launchStatus(storeOf(evidenceRows().filter((r) => r.key !== DESK_CODE_KEY)), root, NOW);
    assert.equal(status.step, 'DESK_CONFIGURED'); assert.equal(status.rateAtBlock, null); assert.equal(status.topUp, null);
  });
  it('requires code before rate and both before the credited-top-up milestone', async () => {
    configure(); assert.equal((await launchStatus(storeOf([row(DESK_CODE_KEY, code())]), root, NOW)).step, 'CODE_VERIFIED');
    assert.equal((await launchStatus(storeOf(evidenceRows().slice(0, 2)), root, NOW)).step, 'RATE_READ');
    const status = await launchStatus(storeOf(evidenceRows()), root, NOW);
    assert.equal(status.step, 'TOP_UP_RECORDED'); assert.deepEqual(status.topUp, { transactionHash: TX, block: 180 });
    assert.match(status.line, /not a guarantee of current availability/);
  });
  it('expired code prevents promotion even with a fresh rate and receipts', async () => {
    configure(); const rows = evidenceRows(); mutable(rows[0]!.payload).readAt = new Date(NOW.getTime() - LAUNCH_READ_MAX_AGE_MS - 1).toISOString();
    assert.equal((await launchStatus(storeOf(rows), root, NOW)).step, 'DESK_CONFIGURED');
  });
  it('holds the rate milestone until a fresh observation identifies the configured chain', async () => {
    configure();
    for (const chainId of [undefined, 1]) {
      const rows = evidenceRows(); mutable(rows[1]!.payload).chainId = chainId;
      const status = await launchStatus(storeOf(rows), root, NOW);
      assert.equal(status.step, 'CODE_VERIFIED'); assert.equal(status.rateAtBlock, null); assert.equal(status.topUp, null);
    }
  });
  for (const [name, change] of [
    ['another chain', (r: any[]) => { r[2].payload.network = 'ethereum-mainnet'; }], ['another indexed desk', (r: any[]) => { r[2].payload.desk = OTHER; }],
    ['an old receipt desk', (r: any[]) => { r[3].payload.topUps[0].desk = OTHER; }], ['no applied event', (r: any[]) => { r[2].payload.applied = []; }],
    ['another key', (r: any[]) => { r[2].payload.applied[0].keyHash = `0x${'f'.repeat(64)}`; }], ['another log', (r: any[]) => { r[2].payload.applied[0].ref = `${TX}:3`; }],
    ['another block', (r: any[]) => { r[2].payload.applied[0].blockNumber = 181; }], ['predeployment receipt', (r: any[]) => { r[3].payload.topUps[0].blockNumber = 99; r[2].payload.applied[0].blockNumber = 99; }],
    ['zero credits', (r: any[]) => { r[3].payload.topUps[0].cents = '0'; }], ['negative log index', (r: any[]) => { r[3].payload.topUps[0].logIndex = -1; r[2].payload.applied[0].ref = `${TX}:-1`; }],
    ['fractional log index', (r: any[]) => { r[3].payload.topUps[0].logIndex = 1.5; r[2].payload.applied[0].ref = `${TX}:1.5`; }], ['receipt beyond cursor', (r: any[]) => { r[2].payload.cursor = 179; }],
  ] as const) {
    it(`rejects a top-up supported by ${name}`, async () => {
      configure(); const rows = evidenceRows(); change(rows as any[]); const status = await launchStatus(storeOf(rows), root, NOW);
      assert.equal(status.step, 'RATE_READ'); assert.equal(status.topUp, null);
    });
  }
  it('ignores unrelated newer receipts', async () => {
    configure(); const rows = evidenceRows(); const topUps = mutable(rows[3]!.payload).topUps;
    topUps.push({ ...topUps[0], desk: OTHER, blockNumber: 199 });
    assert.deepEqual((await launchStatus(storeOf(rows), root, NOW)).topUp, { transactionHash: TX, block: 180 });
  });
  for (const prefix of [DESK_CODE_KEY, RATE_KEY, INDEX_KEY, TOPUPS_PREFIX]) {
    it(`preserves UNREAD ${prefix} as a fault, never zero or a confirmed payment`, async () => {
      configure(); const status = await launchStatus(storeOf(evidenceRows(), [prefix]), root, NOW);
      assert.ok(status.faults.length > 0); assert.equal(status.topUp, null);
      assert.doesNotMatch(status.line, /0 top-ups|zero top-ups|no payments happened/i);
      if (prefix === DESK_CODE_KEY || prefix === RATE_KEY) assert.equal(status.rateAtBlock, null);
    });
  }
  it('malformed evidence cannot crash status or silently claim success', async () => {
    configure();
    for (const bad of [null, { state: 'READ', chainId: 4663, rate: { guard: {}, basis: 'STATE', usdPerCurb18: '1', pool: { address: 42 } }, at: AT }]) {
      const status = await launchStatus(storeOf([row(RATE_KEY, bad), row(DESK_CODE_KEY, code())]), root, NOW);
      assert.equal(status.step, 'CODE_VERIFIED'); assert.ok(status.faults.length > 0);
    }
    const rows = evidenceRows(); mutable(rows[2]!.payload).applied = [null]; mutable(rows[3]!.payload).topUps = [null];
    const status = await launchStatus(storeOf(rows), root, NOW); assert.equal(status.topUp, null); assert.ok(status.faults.length > 0);
  });
  it('shortens addresses and exposes the expected local evidence path', () => {
    assert.equal(shortAddress(TREASURY), '0x4000…0004'); assert.equal(SAFE_EVIDENCE, path.join('contracts', 'evidence', 'safes', 'safe.4663.json'));
  });
});

describe('current launch code and rate evidence', () => {
  it('quarantines unscoped and other-chain reads without rewriting the historical row', async () => {
    for (const chainId of [undefined, 1]) {
      const sample = { ...rate(), chainId };
      const stored = row(RATE_KEY, sample);
      const found = await latestRate(storeOf([stored]), CONFIG);
      assert.equal(found.rate?.state, 'UNREAD');
      if (found.rate?.state === 'UNREAD') assert.equal(found.rate.reason, chainId === undefined ? 'RATE_ROW_UNSCOPED' : 'RATE_ROW_OTHER_CHAIN');
      assert.equal(stored.payload.state, 'READ'); assert.equal(stored.payload.chainId, chainId);
    }
  });
  it('accepts exactly 30 minutes, rejects future, invalid and older timestamps', () => {
    assert.equal(recentRead(new Date(NOW.getTime() - LAUNCH_READ_MAX_AGE_MS).toISOString(), NOW), true);
    for (const at of ['invalid', new Date(NOW.getTime() + 1).toISOString(), new Date(NOW.getTime() - LAUNCH_READ_MAX_AGE_MS - 1).toISOString()]) assert.equal(recentRead(at, NOW), false);
  });
  it('requires exact immutable booleans/values and unique checks on the configured chain/desk', () => {
    assert.equal(currentDeskCode(code(), CONFIG, NOW), true);
    for (const change of [
      (v: any) => { v.state = 'MISMATCH'; }, (v: any) => { v.chainId = 1; }, (v: any) => { v.address = OTHER; },
      (v: any) => { v.immutables[0].onChain = '0'.repeat(64); }, (v: any) => { v.immutables[1].expected = '0'.repeat(64); },
      (v: any) => { v.immutables[0].onChain = v.immutables[0].onChain.slice(2); }, (v: any) => { v.immutables[0].expected = v.immutables[0].expected.slice(2); },
      (v: any) => { v.immutables[0].matches = 'false'; }, (v: any) => { v.immutables.pop(); },
      (v: any) => { v.immutables.push({ ...v.immutables[0], onChain: '0'.repeat(64), matches: false }); },
      (v: any) => { v.address = null; }, (v: any) => { v.immutables[0] = null; },
    ]) { const v = code(); change(v); assert.equal(currentDeskCode(v, CONFIG, NOW), false); }
  });
  it('requires fresh snapshot/read timestamps and matching token/pool/quote identity', () => {
    assert.equal(currentRate(rate(), CONFIG, NOW), true);
    for (const change of [
      (v: any) => { delete v.chainId; }, (v: any) => { v.chainId = 1; }, (v: any) => { v.chainId = '4663'; },
      (v: any) => { v.at = 'invalid'; }, (v: any) => { v.rate.readAt = '2026-09-13T08:29:59Z'; }, (v: any) => { v.rate.token.address = OTHER; },
      (v: any) => { v.rate.pool.address = OTHER; }, (v: any) => { v.rate.pool.kind = 'uniswap-v3-pool'; }, (v: any) => { v.rate.quote.kind = 'chainlink-feed'; },
      (v: any) => { v.rate.usdPerCurb18 = '0'; }, (v: any) => { v.rate.block = -1; }, (v: any) => { v.rate = null; },
      (v: any) => { v.rate.token = null; }, (v: any) => { v.rate.pool.address = 42; },
    ]) { const v = rate(); change(v); assert.equal(currentRate(v, CONFIG, NOW), false); }
    assert.equal(currentRate(rate(), { ...CONFIG, priceSource: null }, NOW), false);
  });
  it('requires the configured Chainlink feed when the quote uses one', () => {
    const config = { ...CONFIG, priceSource: { ...CONFIG.priceSource!, quote: { kind: 'chainlink-feed' as const, feed: OTHER } } };
    const v = rate(); mutable(v.rate).quote = { kind: 'chainlink-feed', feed: OTHER };
    assert.equal(currentRate(v, config, NOW), true); mutable(v.rate.quote).feed = TOKEN; assert.equal(currentRate(v, config, NOW), false);
  });
});

describe('24-hour rate history', () => {
  const LEGACY = 'credits:rate:usd-per-curb';
  const observation = (raw: string, observedAt = AT): ObservationRecord => ({ key: 'credits:rate:usd-per-curb', raw, decimals: 18, value: Number(raw) / 1e18, observedAt, source: 'fixture' });
  it('keeps missing/unread history UNREAD without inventing a count', () => {
    for (const r of [null, unavailable()]) { const result = rateHistory(r, NOW, LEGACY); assert.equal(result.state, 'UNREAD'); assert.equal('count' in result, false); }
  });
  it('distinguishes a readable empty window from an unread history', () => {
    assert.deepEqual(rateHistory(verified([]), NOW, LEGACY), { state: 'READ', count: 0, low: null, high: null });
  });
  it('separates histories by chain, token, pool kind/address and quote kind/feed', () => {
    const key = creditRateHistoryKey(CONFIG);
    assert.ok(key);
    const pool = CONFIG.priceSource!;
    for (const other of [
      { ...CONFIG, network: { ...CONFIG.network, chainId: 1 } }, { ...CONFIG, token: OTHER },
      { ...CONFIG, priceSource: { ...pool, kind: 'uniswap-v3-pool' as const } }, { ...CONFIG, priceSource: { ...pool, pair: OTHER } },
      { ...CONFIG, priceSource: { ...pool, quote: { kind: 'chainlink-feed' as const, feed: OTHER } } },
    ]) assert.notEqual(creditRateHistoryKey(other), key);
    const feedConfig = { ...CONFIG, priceSource: { ...pool, quote: { kind: 'chainlink-feed' as const, feed: OTHER } } };
    assert.notEqual(creditRateHistoryKey(feedConfig), creditRateHistoryKey({ ...feedConfig, priceSource: { ...feedConfig.priceSource, quote: { kind: 'chainlink-feed', feed: TOKEN } } }));
    assert.equal(creditRateHistoryKey({ ...CONFIG, desk: OTHER }), key, 'a desk redeployment does not change the pricing source');
    assert.equal(creditRateHistoryKey({ ...CONFIG, priceSource: null }), null);
  });
  it('accepts only the explicitly requested pricing source and never combines legacy samples', () => {
    const key = creditRateHistoryKey(CONFIG)!;
    const sample = { ...observation('100'), key };
    assert.deepEqual(rateHistory(verified([sample]), NOW, key), { state: 'READ', count: 1, low: 100n, high: 100n });
    assert.equal(rateHistory(verified([sample, observation('200')]), NOW, key).state, 'UNREAD');
    const otherChainKey = creditRateHistoryKey({ ...CONFIG, network: { ...CONFIG.network, chainId: 1 } })!;
    assert.equal(rateHistory(verified([{ ...sample, key: otherChainKey }]), NOW, key).state, 'UNREAD');
    assert.equal(rateHistory(verified([]), NOW, null).state, 'UNREAD');
  });
  it('uses precise raw units and includes the 24-hour boundary while excluding older samples', () => {
    const low = '9007199254740993000000001'; const high = '9007199254740993000000002';
    const rows = [observation(high), observation(low, '2026-09-12T09:00:00Z'), observation('1', '2026-09-12T08:59:59Z')];
    assert.deepEqual(rateHistory(verified(rows), NOW, LEGACY), { state: 'READ', count: 2, low: BigInt(low), high: BigInt(high) });
  });
  it('malformed rows do not become one observation or a zero rate', () => {
    for (const bad of [null, observation('0'), observation('-1'), observation('1.2'), observation('NaN'), { ...observation('1'), decimals: 6 }, { ...observation('1'), raw: undefined }, observation('1', 'invalid'), observation('1', '2026-09-13T09:00:01Z')]) {
      const result = rateHistory(verified([bad]) as Reading<readonly ObservationRecord[]>, NOW, LEGACY);
      assert.equal(result.state, 'UNREAD'); assert.equal('count' in result, false);
    }
    assert.equal(rateHistory(verified(null) as unknown as Reading<readonly ObservationRecord[]>, NOW, LEGACY).state, 'UNREAD');
  });
});
