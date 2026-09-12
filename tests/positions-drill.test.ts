import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { NETWORKS, type NetworkProfile } from '../lib/chain/networks.ts';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import { positionConditions } from '../lib/ops/alerts.ts';
import { parseDeployments } from '../lib/positions/deployments.ts';
import { INDEX_INTERVAL_SECONDS, reduceLedger, syncIndex } from '../lib/positions/index.ts';
import { claimsOf } from '../lib/positions/ledger.ts';
import { reconcileSeries } from '../lib/positions/reconcile.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * The operational drill's second half (blueprint O02): what the site does
 * during each incident the chain half staged. contracts/scripts/drill.ts
 * froze A, seized part of the series' A, and had a holder claim with no
 * backend involved; this reads that chain and checks the index, the
 * reconciliation and the conditions say the right thing — then stages the
 * two incidents that are the site's own, a failed RPC and a lost source —
 * and writes the whole drill to contracts/evidence/drill-local.json, with
 * who did what. Skipped unless CURB_DRILL_RECORD carries the script's
 * output: a drill nobody ran is not a drill.
 *
 *   cd contracts && npx hardhat node                    # one terminal
 *   cd contracts && node scripts/drill.ts > drill.json  # another
 *   CURB_DRILL_RECORD="$(cat contracts/drill.json)" npm test
 */
interface ChainStep {
  readonly scenario: string;
  readonly who: string;
  readonly did: string;
  readonly expected: string;
  readonly outcome: 'AS_EXPECTED' | 'NOT_AS_EXPECTED';
  readonly tx: string | null;
  readonly revert: string | null;
}
interface DrillRecord {
  readonly ranAt: string;
  readonly chainId: number;
  readonly deployments: Record<string, unknown>;
  readonly holders: { alice: string; bob: string; carol: string };
  readonly state: Record<string, string>;
  readonly steps: ChainStep[];
}

describe('the operational drill, on a local chain', () => {
  const raw = process.env.CURB_DRILL_RECORD;

  it('finds the shortfall, keeps the record through a failed RPC, and names a lost source', async (t) => {
    if (!raw) {
      t.skip('CURB_DRILL_RECORD is not set; start a Hardhat node and run contracts/scripts/drill.ts');
      return;
    }
    const record = JSON.parse(raw) as DrillRecord;
    assert.equal(record.steps.filter((s) => s.outcome !== 'AS_EXPECTED').length, 0, 'the chain half went as the blueprint says');
    const parsed = parseDeployments(JSON.stringify(record.deployments));
    assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.detail);
    if (!parsed.ok) return;
    const deployment = parsed.deployments['apple-s1'];
    assert.ok(deployment);

    forgetChainConfirmations();
    const profile = NETWORKS['hardhat-local'];
    const opts = { profile, intervalSeconds: INDEX_INTERVAL_SECONDS };
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-drill-')));
    const findings: { scenario: string; finding: string; evidence: Record<string, unknown> }[] = [];

    // ── what the index and the reconciliation say after the chain half ──
    const synced = await syncIndex(store, 'apple-s1', deployment, opts, new Date());
    assert.equal(synced.report.state, 'SYNCED', synced.report.detail ?? '');
    const { ledger, disagreements } = reduceLedger(synced.index, deployment.q, deployment.capLots);
    assert.deepEqual(disagreements, []);
    assert.equal(ledger.n, 52n, '40 + 30 minted, 10 + 10 allocated for exit, then 1 + 1 by carol around the quorum stop');
    const bob = record.holders.bob.toLowerCase();
    assert.equal(claimsOf(ledger, bob).A, 100n * 10n ** 18n, "bob's A is still owed: he could not be paid while the series was short");
    assert.equal(claimsOf(ledger, bob).B, 0n, 'bob was paid his B with no backend involved');
    const bobClaimedB = synced.index.events.find((e) => e.event.name === 'ComponentClaimed' && 'holder' in e.event && e.event.holder === bob && 'component' in e.event && e.event.component === 'B');
    assert.ok(bobClaimedB, "the index caught up on bob's claim of B made while no backend ran");
    findings.push({
      scenario: '3 backend down',
      finding: 'a holder claimed B with no site involved — the permit is on chain — and the index, started afterwards, caught the claim up',
      evidence: { transactionHash: bobClaimedB.transactionHash, blockNumber: bobClaimedB.blockNumber, eventsIndexed: synced.index.events.length },
    });

    const { reconciliation } = await reconcileSeries(store, 'apple-s1', deployment, ledger, disagreements, synced.index.cursor, opts, new Date());
    const a = reconciliation.components.find((c) => c.component === 'A')!;
    const b = reconciliation.components.find((c) => c.component === 'B')!;
    assert.equal(a.finding, 'SHORTFALL');
    assert.equal(a.owed, (620n * 10n ** 18n).toString());
    assert.equal(a.held, (570n * 10n ** 18n).toString());
    assert.equal(a.difference, (-50n * 10n ** 18n).toString());
    assert.equal(b.finding, 'MATCHED');
    const reconcileSnap = await store.snapshots('positions:reconcile:apple-s1');
    assert.notEqual(reconcileSnap.state, 'UNREAD');
    if (reconcileSnap.state === 'UNREAD') return;
    const conditions = positionConditions(reconcileSnap.value, new Date());
    assert.deepEqual(
      conditions.map((c) => `${c.severity} ${c.id}`),
      ['DARK positions:apple-s1:SHORTFALL:A'],
      'the shortfall is a DARK condition on A alone; B is not implicated',
    );
    findings.push({
      scenario: '2 series short of A',
      finding: 'the reconciliation found A SHORTFALL by exactly what was seized and B MATCHED; the condition is DARK on A alone; on chain, claims of A halt and claims of B pay',
      evidence: { owedA: a.owed, heldA: a.held, differenceA: a.difference, findingB: b.finding, asOfBlock: reconciliation.asOfBlock, condition: conditions[0]!.text },
    });
    const quorum = record.steps.filter((s) => s.scenario.startsWith('6 '));
    assert.equal(quorum.length, 10, 'the quorum scenario ran all its steps');
    assert.ok(quorum.every((s) => s.outcome === 'AS_EXPECTED'));
    const stopped = synced.index.events.filter((e) => e.event.name === 'MintStatusChanged');
    assert.deepEqual(stopped.map((e) => (e.event.name === 'MintStatusChanged' ? [e.event.paused, e.event.reason] : null)), [[true, 'drill: quorum stop'], [false, 'drill: quorum resume after review']], 'the index carries the stop and the resume with the reasons the multisig sent');
    findings.push({
      scenario: '6 operator quorum',
      finding: 'the operator role was handed to a 2-of-3 multisig; the former single key could no longer stop minting; one signer’s proposal did not stop it and a second confirmation did; the resume needed two again; the index recorded both with their reasons',
      evidence: { multisig: (record as unknown as { operatorMultisig?: unknown }).operatorMultisig ?? null, steps: Object.fromEntries(quorum.map((s) => [`${s.who}: ${s.did}`, s.tx ?? `reverted ${s.revert}`])) },
    });

    const frozen = record.steps.filter((s) => s.scenario.startsWith('1 '));
    findings.push({
      scenario: '1 issuer freezes A',
      finding: 'while A was frozen a claim of A reverted and a claim of B paid; minting was refused; after the resume the A claim paid',
      evidence: Object.fromEntries(frozen.map((s) => [s.did, s.tx ?? `reverted ${s.revert}`])),
    });

    // ── 4. the RPC fails ──────────────────────────────────────────────────
    const dead: NetworkProfile = { ...profile, defaultRpcUrl: 'http://127.0.0.1:9', rpcEnv: 'CURB_RPC_URL_DRILL_DEAD' };
    forgetChainConfirmations();
    const failed = await syncIndex(store, 'apple-s1', deployment, { profile: dead, intervalSeconds: INDEX_INTERVAL_SECONDS, timeoutMs: 3000 }, new Date());
    assert.equal(failed.report.state, 'HEAD_UNREAD', 'a node that does not answer is reported, not worked around');
    assert.equal(failed.index.cursor, synced.index.cursor, 'the cursor did not move');
    assert.equal(failed.index.events.length, synced.index.events.length, 'nothing was rolled back');
    const blind = await reconcileSeries(store, 'apple-s1', deployment, ledger, disagreements, synced.index.cursor, { profile: dead, intervalSeconds: INDEX_INTERVAL_SECONDS, timeoutMs: 3000 }, new Date());
    assert.deepEqual(
      blind.reconciliation.components.map((c) => c.finding),
      ['UNKNOWN', 'UNKNOWN'],
      'a balance that could not be read is UNKNOWN, never a shortfall and never a match',
    );
    const blindSnap = await store.snapshots('positions:reconcile:apple-s1');
    assert.notEqual(blindSnap.state, 'UNREAD');
    if (blindSnap.state === 'UNREAD') return;
    const blindConditions = positionConditions(blindSnap.value, new Date());
    assert.deepEqual(blindConditions.map((c) => `${c.severity} ${c.id}`).sort(), ['STALE positions:apple-s1:UNKNOWN:A', 'STALE positions:apple-s1:UNKNOWN:B']);
    forgetChainConfirmations();
    const recovered = await syncIndex(store, 'apple-s1', deployment, opts, new Date());
    assert.equal(recovered.report.state, 'SYNCED');
    assert.equal(recovered.report.newEvents, 0, 'after the node answers again the index continues from where it was');
    findings.push({
      scenario: '4 RPC fails',
      finding: 'with the node unreachable the index reported HEAD_UNREAD and kept its cursor and events; the reconciliation reported UNKNOWN for both components (STALE conditions), not a shortfall; when the node answered again the index continued from the same cursor with nothing to re-read',
      evidence: { detail: failed.report.detail, cursor: failed.index.cursor, unknownReasonA: blind.reconciliation.components[0]!.reason },
    });

    // ── 5. a source is lost ───────────────────────────────────────────────
    const lost = positionConditions(
      [{ key: 'evidence:xstocks:AAPLx:latest', observedAt: new Date().toISOString(), payload: { sourceId: 'xstocks:AAPLx', kind: 'xstocks-asset', status: 'UNREACHABLE', hash: null, detail: 'fetch failed' } }],
      new Date(),
    );
    assert.deepEqual(lost.map((c) => `${c.severity} ${c.id}`), ['STALE evidence:xstocks:AAPLx:UNREACHABLE']);
    findings.push({
      scenario: '5 source lost',
      finding: 'an issuer record that stops answering is a STALE condition naming the source; the last archived record stays on file and nothing is inferred from an example instead',
      evidence: { condition: lost[0]!.text },
    });

    // ── the record ────────────────────────────────────────────────────────
    const out = {
      ranAt: new Date().toISOString(),
      chain: { profile: profile.id, chainId: profile.chainId, note: 'a Hardhat node on one machine with mock components; not a public chain' },
      by: 'contracts/scripts/drill.ts (the chain half) and tests/positions-drill.test.ts (the site half), run by hand',
      chainRanAt: record.ranAt,
      series: record.deployments['apple-s1'],
      holders: record.holders,
      chainSteps: record.steps,
      siteFindings: findings,
      limits: [
        'the issuer of A is a mock whose freeze and seizure are switches; a real issuer’s actions have their own rules and timing',
        'no person was paged: the conditions here are computed, not delivered; delivery is the webhook’s job and was proven separately',
        'nothing here is a recovery: what was seized stays seized, and no rights were moved',
      ],
    };
    writeFileSync(new URL('../contracts/evidence/drill-local.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
    await store.close();
  });
});
