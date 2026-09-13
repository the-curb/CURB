import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseDeployments } from '../lib/positions/deployments.ts';
import { decodeSeriesEvent, encodeSeriesEvent, EVENT_TOPICS } from '../lib/positions/events.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INDEX_VERSION, applyLogs, emptyIndex, loadIndex, operatorLog, reduceLedger, rollbackFrom } from '../lib/positions/index.ts';
import { FileSystemStore } from '../lib/store/fs.ts';
import { parseOndoAddresses, parseXstocksAsset } from '../lib/positions/issuers.ts';
import { candidatesFrom } from '../lib/positions/verify.ts';
import { balanceOfCalldata, reconcileComponent } from '../lib/positions/reconcile.ts';
import { openSeries, mint, allocateExit } from '../lib/positions/ledger.ts';
import { previewExit, previewMint } from '../lib/positions/api.ts';
import { APPLE_S1 } from '../lib/positions/series.ts';
import { EVIDENCE_SOURCES } from '../lib/positions/evidence.ts';
import { NETWORKS, rpcUrl } from '../lib/chain/networks.ts';
import type { LogEntry } from '../lib/chain/rpc.ts';

/**
 * The position product's backend, without a chain: the issuer parsers on
 * bodies as received, the event codec, the index's idempotency and reorg
 * rollback, the reduction to the ledger, the reconciliation findings, the
 * deployment configuration, and the previews.
 */

const HOLDER = '0x00000000000000000000000000000000000000a1';
const OTHER = '0x00000000000000000000000000000000000000b2';
const NOW = new Date('2026-09-12T12:00:00.000Z');

const deployment = {
  seriesId: 'apple-s1',
  chainId: 1,
  address: '0x00000000000000000000000000000000000000ee',
  components: { A: '0x00000000000000000000000000000000000000aa', B: '0x00000000000000000000000000000000000000bb' },
  fromBlock: 100,
  q: { A: 10n, B: 20n },
  capLots: 1_000n,
};

function log(block: number, index: number, event: Parameters<typeof encodeSeriesEvent>[0], hashSuffix = 'a'): LogEntry {
  const enc = encodeSeriesEvent(event);
  return {
    address: deployment.address,
    topics: enc.topics,
    data: enc.data,
    blockNumber: `0x${block.toString(16)}`,
    blockHash: `0x${hashSuffix.repeat(64).slice(0, 63)}${block.toString(16).slice(-1)}`,
    transactionHash: `0x${'f'.repeat(60)}${block.toString(16).padStart(4, '0')}`,
    logIndex: `0x${index.toString(16)}`,
  };
}

describe('issuer parsers', () => {
  it('parses the xStocks asset record as received, keeping only what the series needs', () => {
    const raw = readFileSync(new URL('./fixtures/xstocks-aaplx.json', import.meta.url), 'utf8');
    const parsed = parseXstocksAsset(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.asset.symbol, 'AAPLx');
    assert.equal(parsed.asset.underlyingSymbol, 'AAPL');
    const eth = parsed.asset.deployments.find((d) => d.network === 'Ethereum');
    assert.ok(eth, 'an Ethereum deployment is listed');
    assert.match(eth.address, /^0x[0-9a-f]{40}$/);
    assert.match(eth.wrapperAddressV2 ?? '', /^0x[0-9a-f]{40}$/);
  });

  it('reports a moved shape as SCHEMA_CHANGED and a non-JSON body as NOT_JSON', () => {
    assert.deepEqual(parseXstocksAsset('<html>'), { ok: false, status: 'NOT_JSON', detail: 'the body is not JSON' });
    const moved = parseXstocksAsset(JSON.stringify({ ticker: 'AAPLx', deployments: [] }));
    assert.equal(moved.ok, false);
    if (!moved.ok) assert.equal(moved.status, 'SCHEMA_CHANGED');
  });

  it('parses Ondo addresses with the chain id taken from the network label, and refuses a bad entry', () => {
    const ok = parseOndoAddresses(JSON.stringify({ symbol: 'AAPLon', addresses: [{ networkChainId: 'ethereum-1', address: '0x14C3ABF95CB9C93A8B82C1CDCB76D72CB87B2D4C', decimals: 18 }] }));
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.asset.addresses[0]?.chainId, 1);
      assert.equal(ok.asset.addresses[0]?.address, '0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c');
    }
    const bad = parseOndoAddresses(JSON.stringify({ symbol: 'AAPLon', addresses: [{ networkChainId: 'ethereum-1' }] }));
    assert.equal(bad.ok, false);
  });

  it('draws candidates only from parsed evidence on the requested chain', () => {
    const raw = readFileSync(new URL('./fixtures/xstocks-aaplx.json', import.meta.url), 'utf8');
    const parsed = parseXstocksAsset(raw);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const source = EVIDENCE_SOURCES[0]!;
    const onEthereum = candidatesFrom(1, [{ source, observation: { parsed: parsed.asset } }]);
    assert.ok(onEthereum.some((c) => c.role === 'RAW_TOKEN'));
    assert.ok(onEthereum.some((c) => c.role === 'WRAPPER_V2' && c.claimedAsset !== null));
    assert.deepEqual(candidatesFrom(4663, [{ source, observation: { parsed: parsed.asset } }]), [], 'nothing on a chain the issuer does not list');
    assert.deepEqual(candidatesFrom(1, [{ source, observation: null }]), [], 'nothing from evidence that was not parsed');
  });
});

describe('the event codec', () => {
  it('computes topics from signatures and round-trips every event', () => {
    for (const topic of Object.values(EVENT_TOPICS)) assert.match(topic, /^0x[0-9a-f]{64}$/);
    const events = [
      { name: 'PositionMinted', holder: HOLDER, lots: 3n, unitsA: 30n, unitsB: 60n },
      { name: 'ExitAllocated', holder: HOLDER, lots: 1n, unitsA: 10n, unitsB: 20n },
      { name: 'ComponentClaimed', holder: HOLDER, component: 'B', units: 20n },
      { name: 'MintStatusChanged', paused: true, reason: 'assumptions unconfirmed — a reason longer than one word' },
      { name: 'ComponentClaimStatusChanged', component: 'A', paused: true, reason: 'exploit risk' },
      { name: 'MintPermitSet', holder: HOLDER, until: 1_800_000_000n },
      { name: 'ClaimPermitSet', holder: OTHER, permitted: true },
      { name: 'OperatorChanged', previous: HOLDER, next: OTHER },
      { name: 'OperatorTransferProposed', current: HOLDER, proposed: OTHER },
      { name: 'OperatorTransferCancelled', current: HOLDER, cancelled: OTHER },
    ] as const;
    for (const e of events) {
      const decoded = decodeSeriesEvent(encodeSeriesEvent(e));
      assert.equal(decoded.ok, true);
      if (decoded.ok === true) assert.deepEqual(decoded.event, e);
    }
  });

  it('sets aside a topic it does not know and faults a body it cannot decode', () => {
    assert.deepEqual(decodeSeriesEvent({ topics: [`0x${'1'.repeat(64)}`], data: '0x' }), { ok: 'IGNORED' });
    const bad = decodeSeriesEvent({ topics: [EVENT_TOPICS.PositionMinted], data: '0x' });
    assert.equal(bad.ok, false);
  });
});

describe('the chain index', () => {
  it('keeps nominations separate from accepted authority and reconstructs them after a reorg', () => {
    const proposed = applyLogs(emptyIndex(deployment), [
      log(100, 0, { name: 'OperatorTransferProposed', current: HOLDER, proposed: OTHER }),
    ], NOW);
    assert.equal(operatorLog(proposed).operator, null, 'the deployment operator still applies; a proposal is not a change');
    assert.equal(operatorLog(proposed).pendingOperator, OTHER);
    const cancelled = applyLogs(proposed, [log(101, 0, { name: 'OperatorTransferCancelled', current: HOLDER, cancelled: OTHER })], NOW);
    assert.equal(operatorLog(cancelled).pendingOperator, null);
    assert.deepEqual(operatorLog(cancelled).nominations.map((n) => n.action), ['PROPOSED', 'CANCELLED']);
    const restored = rollbackFrom(cancelled, 101);
    assert.equal(operatorLog(restored).pendingOperator, OTHER);
    const accepted = applyLogs(restored, [log(102, 0, { name: 'OperatorChanged', previous: HOLDER, next: OTHER })], NOW);
    assert.equal(operatorLog(accepted).operator, OTHER);
    assert.equal(operatorLog(accepted).pendingOperator, null);
    assert.deepEqual(reduceLedger(accepted, deployment.q, deployment.capLots).disagreements, []);
  });
  it('applies a log once however many times it is seen, and orders by block then index', () => {
    const logs = [
      log(102, 1, { name: 'ExitAllocated', holder: HOLDER, lots: 1n, unitsA: 10n, unitsB: 20n }),
      log(101, 0, { name: 'PositionMinted', holder: HOLDER, lots: 3n, unitsA: 30n, unitsB: 60n }),
    ];
    let state = applyLogs(emptyIndex(deployment), logs, NOW);
    state = applyLogs(state, logs, NOW);
    state = applyLogs(state, [logs[0]!], NOW);
    assert.equal(state.events.length, 2);
    assert.deepEqual(state.events.map((e) => e.blockNumber), [101, 102]);
    assert.equal(state.blocks.length, 2);
  });

  it('rolls back everything at and after a reorganised height, and moves the cursor back', () => {
    const logs = [
      log(101, 0, { name: 'PositionMinted', holder: HOLDER, lots: 3n, unitsA: 30n, unitsB: 60n }),
      log(105, 0, { name: 'PositionMinted', holder: OTHER, lots: 1n, unitsA: 10n, unitsB: 20n }),
      log(107, 0, { name: 'ExitAllocated', holder: HOLDER, lots: 1n, unitsA: 10n, unitsB: 20n }),
    ];
    const state = { ...applyLogs(emptyIndex(deployment), logs, NOW), cursor: 110 };
    const rolled = rollbackFrom(state, 105);
    assert.deepEqual(rolled.events.map((e) => e.blockNumber), [101]);
    assert.deepEqual(rolled.blocks.map((b) => b.number), [101]);
    assert.equal(rolled.cursor, 104);
    // The replacement block is applied cleanly afterwards.
    const again = applyLogs(rolled, [log(105, 0, { name: 'PositionMinted', holder: OTHER, lots: 2n, unitsA: 20n, unitsB: 40n }, 'b')], NOW);
    assert.equal(again.events.length, 2);
    assert.equal(again.events[1]?.event.name === 'PositionMinted' && again.events[1].event.lots, 2n);
  });

  it('keeps an undecodable log as a fault rather than dropping it', () => {
    const broken: LogEntry = { ...log(101, 0, { name: 'PositionMinted', holder: HOLDER, lots: 1n, unitsA: 10n, unitsB: 20n }), data: '0x' };
    const state = applyLogs(emptyIndex(deployment), [broken], NOW);
    assert.equal(state.events.length, 0);
    assert.equal(state.faults.length, 1);
  });

  it('reduces to the ledger through the same functions the tests use, and reports a disagreement', () => {
    const logs = [
      log(101, 0, { name: 'PositionMinted', holder: HOLDER, lots: 3n, unitsA: 30n, unitsB: 60n }),
      log(102, 0, { name: 'ExitAllocated', holder: HOLDER, lots: 1n, unitsA: 10n, unitsB: 20n }),
      log(103, 0, { name: 'ComponentClaimStatusChanged', component: 'A', paused: true, reason: 'exploit risk' }),
      log(104, 0, { name: 'ComponentClaimed', holder: HOLDER, component: 'B', units: 20n }),
      log(105, 0, { name: 'ExitAllocated', holder: OTHER, lots: 1n, unitsA: 10n, unitsB: 20n }), // OTHER holds nothing
    ];
    const state = applyLogs(emptyIndex(deployment), logs, NOW);
    const { ledger, disagreements } = reduceLedger(state, deployment.q, deployment.capLots);
    assert.equal(ledger.n, 2n);
    assert.equal(ledger.reserved.A, 10n);
    assert.equal(ledger.reserved.B, 0n);
    assert.equal(ledger.claimPaused.A, true);
    assert.equal(disagreements.length, 1);
    assert.match(disagreements[0] ?? '', /INSUFFICIENT_RECEIPTS/);
  });

  it('reads the operator’s actions out of the events: permits as last set, every stop with its reason, the operator as the chain last said', () => {
    const logs = [
      log(100, 0, { name: 'MintPermitSet', holder: HOLDER, until: 1_800_000_000n }),
      log(100, 1, { name: 'ClaimPermitSet', holder: HOLDER, permitted: true }),
      log(101, 0, { name: 'MintStatusChanged', paused: true, reason: 'assumptions unconfirmed' }),
      log(102, 0, { name: 'MintPermitSet', holder: HOLDER, until: 0n }),
      log(103, 0, { name: 'OperatorChanged', previous: HOLDER, next: OTHER }),
      log(104, 0, { name: 'MintStatusChanged', paused: false, reason: 'confirmed' }),
    ];
    const state = applyLogs(emptyIndex(deployment), logs, NOW);
    const log_ = operatorLog(state);
    assert.equal(log_.operator, OTHER);
    assert.deepEqual(log_.mintPermits.map((p) => [p.holder, p.until, p.blockNumber]), [[HOLDER, '0', 102]], 'the permit as last set: revoked at block 102');
    assert.deepEqual(log_.claimPermits.map((p) => [p.holder, p.permitted]), [[HOLDER, true]]);
    assert.deepEqual(log_.stops.map((x) => [x.blockNumber, x.what, x.paused, x.reason]), [[101, 'mint', true, 'assumptions unconfirmed'], [104, 'mint', false, 'confirmed']]);
    assert.deepEqual(log_.changes.map((c) => [c.previous, c.next]), [[HOLDER, OTHER]]);
    // The ledger is untouched by the operator's own actions.
    const { ledger } = reduceLedger(state, deployment.q, deployment.capLots);
    assert.equal(ledger.n, 0n);
    assert.equal(ledger.mintPaused, false);
    // A permit is live by the clock, not by being non-zero: one that ran out is not counted.
    const clock = new Date(1_800_000_000 * 1000);
    const stillLive = operatorLog(applyLogs(emptyIndex(deployment), [log(100, 0, { name: 'MintPermitSet', holder: HOLDER, until: 1_800_000_001n })], NOW), clock);
    const ranOut = operatorLog(applyLogs(emptyIndex(deployment), [log(100, 0, { name: 'MintPermitSet', holder: HOLDER, until: 1_799_999_999n })], NOW), clock);
    assert.equal(stillLive.mintPermits[0]!.live, true);
    assert.equal(ranOut.mintPermits[0]!.live, false);
  });

  it('keeps a permit’s until as a number through the store, and reads an index a previous build wrote from the start', async () => {
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-index-')));
    // The index as this build writes it: a permit's until survives the store as a bigint, so a revoked permit reads as revoked.
    const state = applyLogs(emptyIndex(deployment), [log(100, 0, { name: 'MintPermitSet', holder: HOLDER, until: 0n })], NOW);
    const payload = JSON.parse(JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v))) as Record<string, unknown>;
    await store.writeSnapshots([{ key: 'positions:index:apple-s1', observedAt: NOW.toISOString(), payload }]);
    const loaded = await loadIndex(store, 'apple-s1', deployment);
    assert.equal(loaded.storeFault, null);
    const ev = loaded.state.events[0]!.event;
    assert.equal(ev.name, 'MintPermitSet');
    if (ev.name === 'MintPermitSet') assert.equal(typeof ev.until, 'bigint');
    assert.deepEqual(operatorLog(loaded.state, NOW).mintPermits.map((p) => [p.until, p.live]), [['0', false]]);
    assert.equal(loaded.state.version, INDEX_VERSION);
    // An index without a version — a previous build's, read without the permit events — is not carried forward.
    await store.writeSnapshots([{ key: 'positions:index:apple-s1', observedAt: NOW.toISOString(), payload: { ...payload, version: undefined, cursor: 500 } }]);
    const old = await loadIndex(store, 'apple-s1', deployment);
    assert.equal(old.state.cursor, deployment.fromBlock - 1, 'read again from the deployment’s first block');
    assert.equal(old.state.events.length, 0);
  });
});

describe('reconciliation', () => {
  it('names the four findings and never calls a unit finding an audit', () => {
    let s = openSeries({ A: 10n, B: 20n }, 1_000n);
    const minted = mint(s, HOLDER, 2n);
    assert.equal(minted.ok, true);
    if (!minted.ok) return;
    s = minted.state;
    const exited = allocateExit(s, HOLDER, 1n);
    if (exited.ok) s = exited.state;
    assert.equal(reconcileComponent(s, 'A', deployment.components.A, 20n, null).finding, 'MATCHED');
    assert.equal(reconcileComponent(s, 'A', deployment.components.A, 25n, null).finding, 'SURPLUS');
    assert.equal(reconcileComponent(s, 'A', deployment.components.A, 15n, null).finding, 'SHORTFALL');
    const unknown = reconcileComponent(s, 'A', deployment.components.A, null, 'SOURCE_TIMEOUT');
    assert.equal(unknown.finding, 'UNKNOWN');
    assert.equal(unknown.held, null);
    assert.equal(reconcileComponent(s, 'A', deployment.components.A, 15n, null).owed, '20');
  });

  it('encodes balanceOf(holder) with the selector and a padded address', () => {
    const data = balanceOfCalldata(deployment.address);
    assert.equal(data.length, 2 + 8 + 64);
    assert.ok(data.endsWith(deployment.address.slice(2)));
  });
});

describe('deployment configuration', () => {
  it('refuses an operator that is not an address, and keeps one that is', () => {
    const base = { chainId: 1, address: deployment.address, components: deployment.components, fromBlock: 100, q: { A: '10', B: '20' }, capLots: '1000' };
    const bad = parseDeployments(JSON.stringify({ 'apple-s1': { ...base, operator: 'nobody' } }));
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.detail, /operator, when given, must be a 20-byte hex address/);
    const good = parseDeployments(JSON.stringify({ 'apple-s1': { ...base, operator: '0x00000000000000000000000000000000000000CC' } }));
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(good.deployments['apple-s1']?.operator, '0x00000000000000000000000000000000000000cc');
  });

  it('is empty when unset, refuses a shared component address, and requires integer strings', () => {
    assert.deepEqual(parseDeployments(undefined), { ok: true, deployments: {} });
    const shared = parseDeployments(JSON.stringify({ 'apple-s1': { chainId: 1, address: deployment.address, components: { A: deployment.components.A, B: deployment.components.A }, fromBlock: 1, q: { A: '10', B: '20' }, capLots: '1000' } }));
    assert.equal(shared.ok, false);
    const floats = parseDeployments(JSON.stringify({ 'apple-s1': { chainId: 1, address: deployment.address, components: deployment.components, fromBlock: 1, q: { A: 10, B: 20 }, capLots: '1000' } }));
    assert.equal(floats.ok, false);
    const good = parseDeployments(JSON.stringify({ 'apple-s1': { chainId: 1, address: deployment.address, components: deployment.components, fromBlock: 1, q: { A: '10', B: '20' }, capLots: '1000' } }));
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(good.deployments['apple-s1']?.q.A, 10n);
  });
});

describe('previews', () => {
  it('quote units as strings, no value and no gas, and refuse a bad lot count', () => {
    const p = previewMint(APPLE_S1, '3');
    assert.ok(!('error' in p));
    if ('error' in p) return;
    assert.equal(p.deposit.A, '30');
    assert.equal(p.deposit.B, '60');
    assert.equal(p.indicativeValue.state, 'NOT_AVAILABLE');
    assert.equal(p.gas.state, 'NOT_ESTIMATED');
    assert.equal(p.sendsTransaction, false);
    assert.equal(p.unitsIllustrative, true);
    assert.ok('error' in previewMint(APPLE_S1, '0'));
    assert.ok('error' in previewMint(APPLE_S1, '1.5'));
    const x = previewExit(APPLE_S1, '2');
    assert.ok(!('error' in x));
    if (!('error' in x)) assert.deepEqual(x.reserves, { A: '20', B: '40' });
  });
});

describe('the networks', () => {
  it('give each profile its own RPC override so one variable cannot point both networks at one node', () => {
    const envs = Object.values(NETWORKS).map((n) => n.rpcEnv);
    assert.equal(new Set(envs).size, envs.length);
    assert.equal(NETWORKS['robinhood-mainnet'].rpcEnv, 'CURB_RPC_URL');
    assert.equal(NETWORKS['ethereum-mainnet'].chainId, 1);
    const saved = process.env.CURB_RPC_URL_ETHEREUM;
    process.env.CURB_RPC_URL_ETHEREUM = 'https://node.test.invalid';
    assert.equal(rpcUrl(NETWORKS['ethereum-mainnet']), 'https://node.test.invalid');
    assert.notEqual(rpcUrl(NETWORKS['robinhood-mainnet']), 'https://node.test.invalid');
    if (saved === undefined) delete process.env.CURB_RPC_URL_ETHEREUM;
    else process.env.CURB_RPC_URL_ETHEREUM = saved;
  });
});

describe('the position conditions', () => {
  const NOW2 = new Date('2026-09-12T12:00:00.000Z');
  const snap = (key: string, observedAt: string, payload: Record<string, unknown>) => ({ key, observedAt, payload });

  it('raise a changed document for two days, and never a refusal for want of a key', async () => {
    const { positionConditions } = await import('../lib/ops/alerts.ts');
    const fresh = positionConditions(
      [
        snap('evidence:page:B:ondo-stocks-eligibility:latest', '2026-09-12T10:00:00.000Z', { sourceId: 'page:B:ondo-stocks-eligibility', kind: 'page', status: 'OK', hash: 'abcdef0123456789', url: 'https://x/y', changedAt: '2026-09-12T10:00:00.000Z' }),
        snap('evidence:ondo:AAPLon:latest', '2026-09-12T10:00:00.000Z', { sourceId: 'ondo:AAPLon', kind: 'ondo-addresses', status: 'ACCESS_DENIED', hash: null, detail: 'HTTP 403 — no key' }),
        snap('evidence:xstocks:AAPLx:latest', '2026-09-12T10:00:00.000Z', { sourceId: 'xstocks:AAPLx', kind: 'xstocks-asset', status: 'SCHEMA_CHANGED', hash: 'ff', detail: 'symbol or name is missing' }),
      ],
      NOW2,
    );
    assert.deepEqual(
      fresh.map((c) => c.id).sort(),
      ['evidence:page:B:ondo-stocks-eligibility:CHANGED:abcdef01', 'evidence:xstocks:AAPLx:SCHEMA_CHANGED'],
    );
    const old = positionConditions(
      [snap('evidence:page:B:ondo-stocks-eligibility:latest', '2026-09-01T10:00:00.000Z', { sourceId: 'page:B:ondo-stocks-eligibility', kind: 'page', status: 'OK', hash: 'abcdef0123456789', url: 'https://x/y', changedAt: '2026-09-01T10:00:00.000Z' })],
      NOW2,
    );
    assert.deepEqual(old, [], 'a change older than the window is no longer a condition');
  });

  it('name a drifted candidate darkly, and a shortfall or a disagreement on a series', async () => {
    const { positionConditions } = await import('../lib/ops/alerts.ts');
    const out = positionConditions(
      [
        snap('positions:verify:apple-s1', '2026-09-12T11:00:00.000Z', {
          seriesId: 'apple-s1',
          driftSince: '2026-09-12T11:00:00.000Z',
          lastDrift: [{ address: '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f', role: 'WRAPPER_V2', field: 'codeHash', from: '0xaa', to: '0xbb' }],
        }),
        snap('positions:reconcile:apple-s1', '2026-09-12T11:00:00.000Z', {
          seriesId: 'apple-s1',
          components: [
            { component: 'A', finding: 'SHORTFALL', owed: '40', held: '25' },
            { component: 'B', finding: 'MATCHED', owed: '80', held: '80' },
          ],
          disagreements: ['0xf..:0 ExitAllocated: INSUFFICIENT_RECEIPTS'],
        }),
      ],
      NOW2,
    );
    const ids = out.map((c) => `${c.severity} ${c.id}`).sort();
    assert.deepEqual(ids, [
      'DARK positions:apple-s1:DISAGREEMENT',
      'DARK positions:apple-s1:DRIFT:0x943bf64d:codeHash',
      'DARK positions:apple-s1:SHORTFALL:A',
    ]);
  });
});

describe('verification drift', () => {
  it('names a field that moved between two runs, and an address that stopped answering', async () => {
    const { driftBetween } = await import('../lib/positions/verify.ts');
    const base = {
      sourceId: 'xstocks:AAPLx',
      component: 'A' as const,
      role: 'WRAPPER_V2' as const,
      address: '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f',
      claimedAsset: '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a',
      networkChainId: 1,
      chainId: 1,
      readAt: '2026-09-11T00:00:00.000Z',
      source: 'node',
      hasCode: { value: true, state: 'VERIFIED' as const, reason: null },
      codeHash: { value: '0xaa', state: 'VERIFIED' as const, reason: null },
      symbol: { value: 'wAAPLx', state: 'VERIFIED' as const, reason: null },
      decimals: { value: 18, state: 'VERIFIED' as const, reason: null },
      asset: { value: '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a', state: 'VERIFIED' as const, reason: null },
      assetMatchesClaim: 'MATCHES' as const,
      answersAsToken: true,
      notProven: [],
    };
    const later = { ...base, codeHash: { value: '0xbb', state: 'VERIFIED' as const, reason: null }, symbol: { value: null, state: 'UNREAD' as const, reason: 'SOURCE_TIMEOUT' }, answersAsToken: false };
    const drift = driftBetween([base], [later]);
    assert.deepEqual(
      drift.map((d) => `${d.field}:${d.from}->${d.to}`),
      ['codeHash:0xaa->0xbb', 'answersAsToken:true->false'],
      'an unread field is not a drift; a changed hash and a lost answer are',
    );
    assert.deepEqual(driftBetween([base], [base]), []);
  });

  it('sees an upgrade the code hash cannot: the implementation slot moved behind an unchanged proxy', async () => {
    const { driftBetween } = await import('../lib/positions/verify.ts');
    const { addressInWord } = await import('../lib/chain/proxy.ts');
    const proxy = { state: 'VERIFIED' as const, kind: 'EIP1967' as const, implementation: '0x1111111111111111111111111111111111111111', admin: '0x2222222222222222222222222222222222222222', beacon: null, reason: null, source: 'node' };
    const base = {
      sourceId: 'xstocks:AAPLx',
      component: 'A' as const,
      role: 'RAW_TOKEN' as const,
      address: '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a',
      claimedAsset: null,
      networkChainId: 1,
      chainId: 1,
      readAt: '2026-09-11T00:00:00.000Z',
      source: 'node',
      hasCode: { value: true, state: 'VERIFIED' as const, reason: null },
      codeHash: { value: '0xaa', state: 'VERIFIED' as const, reason: null },
      symbol: { value: 'AAPLx', state: 'VERIFIED' as const, reason: null },
      decimals: { value: 18, state: 'VERIFIED' as const, reason: null },
      asset: { value: null, state: 'UNREAD' as const, reason: 'not a wrapper' },
      assetMatchesClaim: 'NOT_APPLICABLE' as const,
      answersAsToken: true,
      proxy,
      notProven: [],
    };
    const upgraded = { ...base, proxy: { ...proxy, implementation: '0x3333333333333333333333333333333333333333' } };
    assert.deepEqual(
      driftBetween([base], [upgraded]).map((d) => `${d.field}:${d.from}->${d.to}`),
      ['implementation:0x1111111111111111111111111111111111111111->0x3333333333333333333333333333333333333333'],
      'the proxy code hash is unchanged; the implementation is what moved',
    );
    const unreadSlots = { ...base, proxy: { ...proxy, state: 'UNREAD' as const, kind: null, implementation: null, admin: null, reason: 'SOURCE_TIMEOUT' } };
    assert.deepEqual(driftBetween([base], [unreadSlots]), [], 'slots that could not be read are not a drift');
    const olderRecord = { ...base, proxy: undefined };
    assert.deepEqual(driftBetween([olderRecord], [base]), [], 'a record written before the slots were read is not compared on them');
    assert.equal(addressInWord('0x' + '0'.repeat(64)), null, 'an empty slot is no address');
    assert.equal(addressInWord('0x' + '0'.repeat(24) + '1111111111111111111111111111111111111111'), '0x1111111111111111111111111111111111111111');
    assert.equal(addressInWord('0x1234'), undefined, 'a short word is not a word');
  });
});

describe('the map of related parties (R02)', () => {
  it('names every source, leaves unnamed roles empty, and finds no party named under both components', async () => {
    const { DEPENDENCIES, sharedParties, POSSIBLY_SHARED } = await import('../lib/positions/dependencies.ts');
    for (const d of DEPENDENCIES) {
      assert.ok(d.source.title.length > 0, 'every line names a source');
      assert.match(d.readOn, /^\d{4}-\d{2}-\d{2}$/);
      if (d.name === null) assert.ok(d.limit !== null && d.limit.length > 0, `an unnamed ${d.partyType} says why it is unnamed`);
    }
    const unnamedB = DEPENDENCIES.filter((d) => d.component === 'B' && d.name === null).map((d) => d.partyType).sort();
    assert.deepEqual(unnamedB, ['BROKER', 'CUSTODIAN'], 'B’s documents describe the broker-dealer and the custodian without naming them; the agents are named on the trust page');
    assert.deepEqual(sharedParties(), [], 'no party is named under both components; independence is not thereby claimed');
    assert.ok(POSSIBLY_SHARED.some((p) => p.name === 'Alpaca Securities LLC'), 'a name in one issuer’s role list and the other’s partner list is recorded as possibly shared');
  });
});

describe('the issuer’s product page', () => {
  it('yields the record the page publishes — deployments per network, decimals, the live multiplier apart', async () => {
    const { parseOndoAssetPage } = await import('../lib/positions/ondo-page.ts');
    const raw = readFileSync(new URL('./fixtures/ondo-aaplon-page.html', import.meta.url), 'utf8');
    const parsed = parseOndoAssetPage(raw, 'AAPLon');
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.asset.symbol, 'AAPLon');
    assert.equal(parsed.asset.ticker, 'AAPL');
    assert.equal(parsed.asset.underlyingName, 'Apple Inc. Common Stock');
    const eth = parsed.asset.addresses.find((a) => a.chainId === 1);
    assert.ok(eth, 'an Ethereum deployment is published');
    assert.match(eth.address, /^0x[0-9a-f]{40}$/);
    assert.equal(eth.decimals, 18);
    const solana = parsed.asset.addresses.find((a) => a.networkChainId.startsWith('solana'));
    assert.ok(solana && solana.chainId === null, 'a non-EVM deployment is kept as published and is no candidate anywhere');
    assert.match(parsed.live.sharesMultiplier ?? '', /^1\.\d+$/, 'the live multiplier is read but kept apart from the record');

    const { canonicalHash } = await import('../lib/positions/evidence.ts');
    const moved = raw.replace('1.003376073740221058', '1.004000000000000000');
    const again = parseOndoAssetPage(moved, 'AAPLon');
    assert.ok(again.ok);
    if (again.ok) assert.equal(canonicalHash(again.asset), canonicalHash(parsed.asset), 'a moved multiplier is not a change of record');

    const gone = parseOndoAssetPage('<html><script>self.__next_f.push([1,"nothing here"])</script></html>', 'AAPLon');
    assert.deepEqual(gone, { ok: false, status: 'SCHEMA_CHANGED', detail: 'the page carries no record for AAPLon' });
  });

  it('is a candidate source for component B on Ethereum, and the refused API is not', async () => {
    const { parseOndoAssetPage } = await import('../lib/positions/ondo-page.ts');
    const raw = readFileSync(new URL('./fixtures/ondo-aaplon-page.html', import.meta.url), 'utf8');
    const parsed = parseOndoAssetPage(raw, 'AAPLon');
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const page = EVIDENCE_SOURCES.find((s) => s.id === 'ondo:AAPLon:page')!;
    const api = EVIDENCE_SOURCES.find((s) => s.id === 'ondo:AAPLon')!;
    const candidates = candidatesFrom(1, [
      { source: page, observation: { parsed: parsed.asset } },
      { source: api, observation: null },
    ]);
    assert.deepEqual(candidates.map((c) => [c.component, c.role, c.address]), [['B', 'ISSUER_TOKEN', '0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c']]);
    assert.deepEqual(candidatesFrom(56, [{ source: page, observation: { parsed: parsed.asset } }]).map((c) => c.address), ['0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4'], 'the BNB deployment is a candidate only on chain 56');
  });
});

describe('the corporate-action evidence (T14)', () => {
  it('reads the committed record and prints its figures without a float', async () => {
    const { corporateActionEvidenceOf, multiplier18, percentChange } = await import('../lib/positions/corporate-action.ts');
    const { evidence, fault } = await corporateActionEvidenceOf('apple-s1');
    assert.equal(fault, null);
    assert.ok(evidence, 'the record is committed');
    assert.equal(evidence.after.block, evidence.activationBlock);
    assert.equal(evidence.before.block, evidence.activationBlock - 1);
    assert.equal(evidence.findings.wrapperSharesStatic, true, 'the wrapper’s shares did not move across the activation');
    assert.equal(evidence.before.wrapperShares, evidence.after.wrapperShares);
    assert.notEqual(evidence.before.multiplier, evidence.after.multiplier);
    assert.equal(multiplier18('1003269012539818700'), '1.003269');
    assert.equal(percentChange('1002664207589379700', '1003269012539818700'), '+0.0603%');
    assert.equal(percentChange('100', '99'), '-1.0000%');
    assert.equal((await corporateActionEvidenceOf('no-such-series')).evidence, null, 'no file, no finding');
  });
});

describe('a candidate set that moved', () => {
  it('is a drift of its own, per component, and the parser finds the record past an earlier mention of the symbol', async () => {
    const { driftBetween } = await import('../lib/positions/verify.ts');
    const base = {
      sourceId: 'ondo:AAPLon:page',
      component: 'B' as const,
      role: 'ISSUER_TOKEN' as const,
      address: '0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c',
      claimedAsset: null,
      networkChainId: 1,
      chainId: 1,
      readAt: '2026-09-12T00:00:00.000Z',
      source: 'node',
      hasCode: { value: true, state: 'VERIFIED' as const, reason: null },
      codeHash: { value: '0xaa', state: 'VERIFIED' as const, reason: null },
      symbol: { value: 'AAPLon', state: 'VERIFIED' as const, reason: null },
      decimals: { value: 18, state: 'VERIFIED' as const, reason: null },
      asset: { value: null, state: 'UNREAD' as const, reason: 'not a wrapper' },
      assetMatchesClaim: 'NOT_APPLICABLE' as const,
      answersAsToken: true,
      notProven: [],
    };
    const moved = { ...base, address: '0x000000000000000000000000000000000000dead' };
    const drift = driftBetween([base], [moved]);
    assert.deepEqual(
      drift.map((d) => [d.component, d.field, d.from, d.to]),
      [['B', 'candidateSet', 'issuer_token 0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c', 'issuer_token 0x000000000000000000000000000000000000dead']],
      'the record named a different address: a drift the per-address comparison cannot see',
    );
    assert.deepEqual(driftBetween([base], []).map((d) => d.to), ['none'], 'an address that vanished from the record is a drift too');
    assert.deepEqual(driftBetween([], [base]), [], 'a first run has nothing to compare');
    assert.deepEqual(driftBetween([base], [base]), []);

    const { parseOndoAssetPage } = await import('../lib/positions/ondo-page.ts');
    const raw = readFileSync(new URL('./fixtures/ondo-aaplon-page.html', import.meta.url), 'utf8');
    const decoy = raw.replace('<script>', '<script>self.__next_f.push([1,"\\"symbol\\":\\"AAPLon\\" in a list of assets with no deployments beside it"]);');
    const parsed = parseOndoAssetPage(decoy, 'AAPLon');
    assert.equal(parsed.ok, true, 'an earlier mention of the symbol does not hide the record');
    if (parsed.ok) assert.equal(parsed.asset.addresses.length, 3);
  });
});

describe('a corporate action seen by the daily read', () => {
  it('is a multiplier drift, reported as a NOTE that says what it is, never as a fault', async () => {
    const { driftBetween } = await import('../lib/positions/verify.ts');
    const { positionConditions } = await import('../lib/ops/alerts.ts');
    const base = {
      sourceId: 'xstocks:AAPLx',
      component: 'A' as const,
      role: 'RAW_TOKEN' as const,
      address: '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a',
      claimedAsset: null,
      networkChainId: 1,
      chainId: 1,
      readAt: '2026-09-12T00:00:00.000Z',
      source: 'node',
      hasCode: { value: true, state: 'VERIFIED' as const, reason: null },
      codeHash: { value: '0xaa', state: 'VERIFIED' as const, reason: null },
      symbol: { value: 'AAPLx', state: 'VERIFIED' as const, reason: null },
      decimals: { value: 18, state: 'VERIFIED' as const, reason: null },
      asset: { value: null, state: 'UNREAD' as const, reason: 'not a wrapper' },
      assetMatchesClaim: 'NOT_APPLICABLE' as const,
      answersAsToken: true,
      multiplier: { value: '1002664207589379700', state: 'VERIFIED' as const, reason: null },
      notProven: [],
    };
    const activated = { ...base, multiplier: { value: '1003269012539818700', state: 'VERIFIED' as const, reason: null } };
    const drift = driftBetween([base], [activated]);
    assert.deepEqual(drift.map((d) => [d.field, d.from, d.to]), [['multiplier', '1002664207589379700', '1003269012539818700']]);
    const conditions = positionConditions(
      [{ key: 'positions:verify:apple-s1', observedAt: '2026-09-12T11:00:00.000Z', payload: { seriesId: 'apple-s1', driftSince: '2026-09-12T11:00:00.000Z', lastDrift: drift } }],
      new Date('2026-09-12T12:00:00.000Z'),
    );
    assert.equal(conditions.length, 1);
    assert.equal(conditions[0]!.severity, 'NOTE');
    assert.match(conditions[0]!.text, /a corporate action activated/);
    const unread = { ...base, multiplier: { value: null, state: 'UNREAD' as const, reason: 'SOURCE_TIMEOUT' } };
    assert.deepEqual(driftBetween([base], [unread]), [], 'a multiplier that could not be read is not a drift');
  });
});

describe('the series code against the build', () => {
  it('refuses uncommitted build provenance on public chains while identifying local rehearsal bytes honestly', async () => {
    const { seriesBuildProvenance } = await import('../lib/positions/code.ts');
    for (const build of [{ workingTreeClean: false, sourceCommit: 'a'.repeat(40) }, { workingTreeClean: true, sourceCommit: null }]) {
      assert.equal(seriesBuildProvenance(build, 1).allowed, false);
      assert.equal(seriesBuildProvenance(build, 4663).allowed, false);
      assert.deepEqual(seriesBuildProvenance(build, 31337), { allowed: true, sourceCommit: null, detail: 'local rehearsal build; these bytes are not attributed to a committed source release' });
    }
    assert.equal(seriesBuildProvenance({ workingTreeClean: true, sourceCommit: 'a'.repeat(40) }, 1).sourceCommit, 'a'.repeat(40));
  });
  it('matches only when the bytes agree outside the immutable slots and the slots hold the record', async () => {
    const { buildRecord, compareCode, expectedImmutables } = await import('../lib/positions/code.ts');
    const { build, fault } = await buildRecord();
    assert.equal(fault, null);
    assert.ok(build, 'the build record is committed');
    assert.equal(build.immutables.length, 5);
    const record = {
      seriesId: 'apple-s1',
      chainId: 31337,
      address: '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
      components: { A: '0x5fbdb2315678afecb367f032d93f642f64180aa3', B: '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512' },
      fromBlock: 1,
      q: { A: 10n * 10n ** 18n, B: 20n * 10n ** 18n },
      capLots: 1000n,
    };
    // Stamp the record's values into the build's immutable slots, as a deployment would.
    const want = expectedImmutables(record);
    let code = build.deployedBytecode.replace(/^0x/, '');
    for (const im of build.immutables) for (const s of im.slots) code = code.slice(0, s.start * 2) + want[im.name] + code.slice((s.start + s.length) * 2);
    const ok = compareCode(`0x${code}`, build, record);
    assert.equal(ok.state, 'MATCHES', ok.detail ?? '');
    assert.ok(ok.immutables.every((c) => c.matches));

    const wrongCap = compareCode(`0x${code}`, build, { ...record, capLots: 999n });
    assert.equal(wrongCap.state, 'MISMATCH');
    assert.match(wrongCap.detail ?? '', /capLots/);

    const tampered = `0x${code.slice(0, 200)}${code.slice(200, 202) === 'ff' ? '00' : 'ff'}${code.slice(202)}`;
    assert.equal(compareCode(tampered, build, record).state, 'MISMATCH', 'a byte outside the slots is a different contract');
    assert.equal(compareCode('0x6000', build, record).state, 'MISMATCH', 'a different length is a different contract');
  });
});
