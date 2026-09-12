import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { NETWORKS } from '../lib/chain/networks.ts';
import { forgetChainConfirmations, rpcCall } from '../lib/chain/rpc.ts';
import { allocateExitCall, approveCall, claimCall, mintCall } from '../lib/positions/calldata.ts';
import { parseDeployments } from '../lib/positions/deployments.ts';
import { INDEX_INTERVAL_SECONDS, operatorLog, reduceLedger, syncIndex } from '../lib/positions/index.ts';
import { claimsOf, receiptsOf } from '../lib/positions/ledger.ts';
import { reconcileSeries } from '../lib/positions/reconcile.ts';
import { previewExit, previewMint } from '../lib/positions/api.ts';
import { APPLE_S1 } from '../lib/positions/series.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * The index and the reconciliation against a chain with real events: the
 * series the rehearsal script deployed on a local Hardhat node, with the
 * worked example run as transactions. Skipped unless the rehearsal's
 * deployment line is in CURB_REHEARSAL_DEPLOYMENTS — a chain nobody started
 * is not a failure, and a green run against nothing would be worse.
 *
 *   cd contracts && npx hardhat node          # one terminal
 *   cd contracts && node scripts/rehearsal.ts # another; copy its output
 *   CURB_REHEARSAL_DEPLOYMENTS='<that line>' npm test
 */
describe('the index and the reconciliation, rehearsed on a local chain', () => {
  const raw = process.env.CURB_REHEARSAL_DEPLOYMENTS;

  it('replays the worked example from the chain and finds every component matched', async (t) => {
    if (!raw) {
      t.skip('CURB_REHEARSAL_DEPLOYMENTS is not set; start a Hardhat node and run contracts/scripts/rehearsal.ts');
      return;
    }
    const parsed = parseDeployments(raw);
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.detail);
    if (!parsed.ok) return;
    const deployment = parsed.deployments['apple-s1'];
    assert.ok(deployment, 'the rehearsal names apple-s1');

    forgetChainConfirmations();
    const profile = NETWORKS['hardhat-local'];
    const opts = { profile, intervalSeconds: INDEX_INTERVAL_SECONDS };
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-rehearsal-')));
    const now = new Date();

    const first = await syncIndex(store, 'apple-s1', deployment, opts, now);
    assert.equal(first.report.state, 'SYNCED', first.report.detail ?? '');
    assert.equal(first.index.faults.length, 0, 'every log decoded');
    const names = first.index.events.map((e) => e.event.name);
    // The operator's own actions come first (the rehearsal grants permits before anyone mints), then the worked example.
    const ledgerEvents = names.filter((n) => n !== 'MintPermitSet' && n !== 'ClaimPermitSet' && n !== 'OperatorChanged');
    assert.deepEqual(ledgerEvents, ['PositionMinted', 'PositionMinted', 'ExitAllocated', 'ComponentClaimed', 'PositionMinted'], 'the worked example, in order, as the chain emitted it');
    assert.ok(names.includes('MintPermitSet') && names.includes('ClaimPermitSet'), 'the permits the rehearsal granted are on the record');
    const log = operatorLog(first.index);
    assert.ok(log.mintPermits.length >= 2 && log.claimPermits.every((p) => p.permitted), 'the permits as last set');

    const { ledger, disagreements } = reduceLedger(first.index, deployment.q, deployment.capLots);
    assert.deepEqual(disagreements, [], 'the contract and the model agree on every event');
    assert.equal(ledger.n, 85n);
    assert.equal(ledger.reserved.A, 250n * 10n ** 18n);
    assert.equal(ledger.reserved.B, 0n);
    const alice = first.index.events.find((e) => e.event.name === 'PositionMinted')!.event;
    assert.equal(alice.name, 'PositionMinted');
    if (alice.name === 'PositionMinted') {
      assert.equal(claimsOf(ledger, alice.holder).A, 250n * 10n ** 18n, 'alice keeps her A claim');
      assert.equal(receiptsOf(ledger, alice.holder), 0n);
    }

    // The same sync again applies nothing twice.
    const second = await syncIndex(store, 'apple-s1', deployment, opts, new Date());
    assert.equal(second.report.newEvents, 0);
    assert.equal(second.index.events.length, first.index.events.length);

    const { reconciliation } = await reconcileSeries(store, 'apple-s1', deployment, ledger, disagreements, second.index.cursor, opts, new Date());
    assert.deepEqual(
      reconciliation.components.map((c) => [c.component, c.finding, c.owed, c.held]),
      [
        ['A', 'MATCHED', (1100n * 10n ** 18n).toString(), (1100n * 10n ** 18n).toString()],
        ['B', 'MATCHED', (1700n * 10n ** 18n).toString(), (1700n * 10n ** 18n).toString()],
      ],
      '850 active + 250 reserved of A; 1,700 active of B — held exactly',
    );

    // The deployed series is the contract in this repository: its code equals the
    // build outside the immutable slots, and the slots hold the record's values.
    const { verifySeriesCode } = await import('../lib/positions/code.ts');
    const code = await verifySeriesCode(deployment, opts, new Date());
    assert.equal(code.state, 'MATCHES', code.detail ?? '');
    assert.deepEqual(code.immutables.map((c) => [c.name, c.matches]), [['componentA', true], ['componentB', true], ['qA', true], ['qB', true], ['capLots', true]]);

    // The bytes the site would hand a wallet, simulated by the node against
    // the real contract from the holders' own addresses. Nothing is sent.
    // The worked example's holders, in the order the ledger events name them (the operator's permit events precede them and are not the example).
    const exampleEvents = first.index.events.filter((e) => e.event.name === 'PositionMinted' || e.event.name === 'ExitAllocated' || e.event.name === 'ComponentClaimed');
    const holderOf = (i: number) => {
      const e = exampleEvents[i]!.event;
      if (!('holder' in e)) throw new Error('the event names no holder');
      return e.holder;
    };
    const [aliceAddress, others, bob] = [holderOf(0), holderOf(1), holderOf(4)];
    const simulate = (from: string, call: { to: string; data: string }) => rpcCall<string>('eth_call', [{ from, to: call.to, data: call.data }, 'latest'], opts);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const accepted = await Promise.all([
      simulate(bob, approveCall(deployment.components.A, deployment.address, 5n * deployment.q.A, 'A')),
      simulate(bob, mintCall(deployment.address, 5n, deadline)),
      simulate(others, allocateExitCall(deployment.address, 5n)),
      simulate(aliceAddress, claimCall(deployment.address, 'A')),
    ]);
    for (const r of accepted) assert.equal(r.state, 'VERIFIED', `the contract accepts the prepared bytes: ${r.state === 'UNREAD' ? r.detail : ''}`);
    const declined = await simulate(aliceAddress, claimCall(deployment.address, 'B'));
    assert.equal(declined.state, 'UNREAD', 'alice has no B claim left; the contract says so rather than paying nothing');
    if (declined.state === 'UNREAD') assert.equal(declined.reason, 'FIELD_ABSENT', declined.detail);

    // The same bytes, as the preview endpoint prepares them once the
    // deployment is configured — accepted by the node from bob, in order.
    const held = process.env.CURB_SERIES_DEPLOYMENTS;
    process.env.CURB_SERIES_DEPLOYMENTS = raw;
    try {
      const preview = previewMint(APPLE_S1, '5');
      assert.ok(!('error' in preview));
      if ('error' in preview) return;
      assert.equal(preview.signItYourself.state, 'PREPARED');
      assert.equal(preview.unitsIllustrative, false, 'units come from the deployment record, not the illustration');
      assert.deepEqual(
        preview.signItYourself.calls.map((c) => [c.to, c.signature]),
        [
          [deployment.components.A, 'approve(address,uint256)'],
          [deployment.components.B, 'approve(address,uint256)'],
          [deployment.address, 'mint(uint256,uint256)'],
        ],
      );
      for (const call of preview.signItYourself.calls) {
        const r = await simulate(bob, call);
        assert.equal(r.state, 'VERIFIED', `${call.signature}: ${r.state === 'UNREAD' ? r.detail : ''}`);
      }
      const exit = previewExit(APPLE_S1, '5');
      assert.ok(!('error' in exit));
      if ('error' in exit) return;
      assert.equal(exit.signItYourself.state, 'PREPARED');
      assert.equal(exit.signItYourself.calls.length, 3);
    } finally {
      if (held === undefined) delete process.env.CURB_SERIES_DEPLOYMENTS;
      else process.env.CURB_SERIES_DEPLOYMENTS = held;
    }
    await store.close();
  });
});
