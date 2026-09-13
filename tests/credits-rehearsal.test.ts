import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import { CREDITS_ENV } from '../lib/credits/config.ts';
import { admit, gate, paidHeaders, settle } from '../lib/credits/guard.ts';
import { keyAccount, keyHashOf, newKey } from '../lib/credits/keys.ts';
import { runCredits } from '../lib/credits/maintenance.ts';
import { curbForCents, readRateFromEvents } from '../lib/credits/rate.ts';
import { NETWORKS, rpcUrl } from '../lib/chain/networks.ts';
import { selector } from '../lib/chain/keccak.ts';
import { CREDITS_INTERVAL_SECONDS } from '../lib/credits/indexer.ts';
import { parseCreditsConfig } from '../lib/credits/config.ts';
import { FileSystemStore } from '../lib/store/fs.ts';
import { receipts } from '../lib/credits/receipts.ts';
import { creditsResponse } from '../lib/launch/credits-api.ts';
import { createSubscription, fanOut, subscriptionsOf } from '../lib/credits/subscriptions.ts';
import type { Condition } from '../lib/ops/alerts.ts';

/**
 * The credit desk against a chain with real top-ups: the desk the
 * rehearsal script deployed on a local Hardhat node, with a mock CURB and
 * a mock pool, and two top-ups mined at different prices. Skipped unless
 * the script's record is in CURB_REHEARSAL_CREDITS — a chain nobody
 * started is not a failure, and a green run against nothing would be worse.
 *
 *   cd contracts && npx hardhat node                    # one terminal
 *   cd contracts && node scripts/credits-rehearsal.ts   # another; copy its output
 *   CURB_REHEARSAL_CREDITS='<that line>' npm test
 */
interface Record {
  readonly credits: unknown;
  readonly key: string;
  readonly keyHash: string;
  readonly treasury: string;
  readonly payer: string;
  readonly topUps: readonly { readonly block: number; readonly amount: string; readonly expectCents: string }[];
}

describe('the credit desk, rehearsed on a local chain', () => {
  const raw = process.env.CURB_REHEARSAL_CREDITS;

  it('reads the pool, verifies the desk’s code and treasury, credits the two top-ups at their own blocks, opens the key and charges a call', async (t) => {
    if (!raw) {
      t.skip('CURB_REHEARSAL_CREDITS is not set; start a Hardhat node and run contracts/scripts/credits-rehearsal.ts');
      return;
    }
    const record = JSON.parse(raw) as Record;
    assert.equal(keyHashOf(record.key), record.keyHash, 'the site hashes the key the way the script did');
    const before = process.env[CREDITS_ENV];
    process.env[CREDITS_ENV] = JSON.stringify(record.credits);
    forgetChainConfirmations();
    try {
      const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-credits-rehearsal-')));
      const run = await runCredits(store, new Date(), null);
      assert.equal(run.state, 'CONFIGURED', run.detail ?? '');
      assert.equal(run.rate?.state, 'READ', JSON.stringify(run.rate));
      if (run.rate?.state !== 'READ') return;
      // After the second top-up the pool is 4,000,000 CURB against 40,000 dollars: US$0.01 a CURB at the block; 1e9 supply is US$10,000,000.
      // The guard's window on the local chain (40 blocks) still holds the pool's first price, US$0.005, so that is the rate a top-up is credited at.
      assert.equal(run.rate.rate.guard.atBlockUsdPerCurb18, (10n ** 16n).toString());
      assert.equal(run.rate.rate.usdPerCurb18, (5n * 10n ** 15n).toString());
      assert.equal(run.rate.rate.guard.applied, true);
      assert.equal(run.rate.rate.marketCapUsd18, (10_000_000n * 10n ** 18n).toString());
      assert.equal(curbForCents(run.rate.rate, 2000n), 4_000n * 10n ** 18n, 'US$20 is 4,000 CURB at the guarded rate');

      // The desk's code is the committed build, and its immutables are the record's token and treasury.
      assert.equal(run.code?.state, 'MATCHES', run.code?.detail ?? '');
      assert.deepEqual(run.code?.immutables.map((i) => [i.name, i.matches]), [['curb', true], ['treasury', true]]);
      const quote = await (await creditsResponse(new Request('http://127.0.0.1/api/credits?usd=20'), parseCreditsConfig(JSON.stringify(record.credits)), store)).json();
      assert.equal(quote.quoteReadiness.codeCurrent, true, 'real verifier output must qualify as current HTTP evidence');
      assert.equal(quote.quote.state, 'QUOTED');
      assert.equal(quote.topUp?.desk, run.code?.address);

      assert.equal(run.index?.state, 'SYNCED', run.index?.detail ?? '');
      // The acceptance below may have run on this fixture before. Its keys
      // are unrelated to the script's key; all events must still be indexed.
      assert.ok((run.index?.newTopUps ?? 0) >= record.topUps.length);
      assert.deepEqual(
        run.index?.credited.filter((c) => c.keyHash === record.keyHash).map((c) => [c.keyHash, c.cents, c.basis]),
        record.topUps.map((u) => [record.keyHash, u.expectCents, 'TOP_UP_BLOCK']),
        'each top-up priced at its own block: 4,000 CURB at US$0.005, then 1,000 at US$0.01 guarded down to US$0.005',
      );

      // The same two prices from the pair's own Sync events at the top-up blocks — the path a node with a short state window takes.
      const parsed = parseCreditsConfig(JSON.stringify(record.credits));
      assert.equal(parsed.state, 'CONFIGURED');
      if (parsed.state === 'CONFIGURED') {
        const opts = { profile: NETWORKS['hardhat-local'], intervalSeconds: CREDITS_INTERVAL_SECONDS };
        const first = await readRateFromEvents(parsed.config, record.topUps[0]!.block, opts);
        const second = await readRateFromEvents(parsed.config, record.topUps[1]!.block, opts);
        if (first.state === 'UNREAD') assert.fail(JSON.stringify(first));
        if (second.state === 'UNREAD') assert.fail(JSON.stringify(second));
        assert.equal(first.value.basis, 'EVENTS');
        assert.equal(first.value.usdPerCurb18, (5n * 10n ** 15n).toString(), 'US$0.005 from the Sync before the first top-up');
        assert.equal(second.value.guard.atBlockUsdPerCurb18, (10n ** 16n).toString(), 'US$0.01 from the Sync before the second');
        assert.equal(second.value.usdPerCurb18, (5n * 10n ** 15n).toString(), 'guarded by the first price, still in the window');
        assert.ok(first.value.pool.eventBlock! < record.topUps[0]!.block);
      }

      const account = await keyAccount(store, record.keyHash);
      assert.equal(account.status, 'OPEN');
      assert.equal(account.creditedCents, '2500');
      assert.deepEqual(account.topUps.map((u) => [u.blockNumber, u.amount, u.cents]), record.topUps.map((u) => [u.block, u.amount, u.expectCents]));

      // The same tick again credits nothing twice.
      const again = await runCredits(store, new Date(), null);
      assert.equal(again.index?.newTopUps, 0);
      assert.equal((await keyAccount(store, record.keyHash)).creditedCents, '2500');

      // A paid call with the key: charged, answered, the balance moved by the listed price.
      const paid = await gate(new Request('https://the-curb.test/api/x', { headers: { 'x-curb-key': record.key } }), store, 'evidence-versions', 'apple-s1 · rehearsal');
      assert.equal(paid.ok, true);
      if (paid.ok) assert.equal(paid.account.balanceCents, '2495');
    } finally {
      if (before === undefined) delete process.env[CREDITS_ENV];
      else process.env[CREDITS_ENV] = before;
      forgetChainConfirmations();
    }
  });

  it('accepts cumulative mock payments through the paid gate, delivery, receipts and exhaustion without replaying credit', async (t) => {
    if (!raw) {
      t.skip('CURB_REHEARSAL_CREDITS is not set; this acceptance requires the local mock deployment');
      return;
    }
    const record = JSON.parse(raw) as Record;
    const parsed = parseCreditsConfig(JSON.stringify(record.credits));
    assert.equal(parsed.state, 'CONFIGURED');
    if (parsed.state !== 'CONFIGURED') return;
    assert.equal(parsed.config.network.chainId, 31337, 'acceptance never transacts on a public chain');
    const endpoint = rpcUrl(NETWORKS['hardhat-local']);
    const url = new URL(endpoint);
    assert.equal(url.protocol, 'http:');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'transactions are restricted to loopback');
    assert.equal(url.username + url.password, '', 'no credentialed endpoint is used');
    const rpc = async <T>(method: string, params: unknown[]): Promise<T> => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.ok, true, `${method}: HTTP ${response.status}`);
      const body = (await response.json()) as { result: T; error?: { message: string } };
      assert.equal(body.error, undefined, `${method}: ${body.error?.message}`);
      return body.result;
    };
    assert.equal(await rpc<string>('eth_chainId', []), '0x7a69');
    const word = (n: bigint) => n.toString(16).padStart(64, '0');
    const send = async (to: string, data: string) => {
      const hash = await rpc<string>('eth_sendTransaction', [{ from: record.payer, to, data, gas: '0x7a120' }]);
      const receipt = await rpc<{ status: string; blockNumber: string }>('eth_getTransactionReceipt', [hash]);
      assert.ok(receipt, 'the automining local node returns a receipt');
      assert.equal(receipt.status, '0x1', 'the mock payment succeeded on chain');
      return hash;
    };
    const before = process.env[CREDITS_ENV];
    process.env[CREDITS_ENV] = JSON.stringify(record.credits);
    forgetChainConfirmations();
    const directory = mkdtempSync(path.join(tmpdir(), 'curb-credits-acceptance-'));
    try {
      const store = new FileSystemStore(directory);
      const initial = await runCredits(store, new Date(), null);
      assert.equal(initial.code?.state, 'MATCHES', initial.code?.detail ?? '');
      assert.equal(initial.rate?.state, 'READ');
      if (initial.rate?.state !== 'READ') return;
      const priorReceipts = await receipts(store);
      const key = newKey();
      const hash = keyHashOf(key);
      const request = new Request('https://the-curb.test/api/positions/apple-s1/evidence/versions', { headers: { 'x-curb-key': key } });
      assert.equal((await keyAccount(store, hash)).status, 'UNFUNDED');

      // Use the actual rate reader and quote conversion before sending the mock
      // payments. The first $15 cannot open the key; another $5 completes $20.
      const firstAmount = curbForCents(initial.rate.rate, 1500n);
      const secondAmount = curbForCents(initial.rate.rate, 500n);
      await send(parsed.config.token, `${selector('approve(address,uint256)')}${parsed.config.desk.slice(2).padStart(64, '0')}${word(firstAmount + secondAmount)}`);
      const firstHash = await send(parsed.config.desk, `${selector('topUp(bytes32,uint256)')}${hash.slice(2)}${word(firstAmount)}`);
      const first = await runCredits(store, new Date(), null);
      assert.equal(first.index?.state, 'SYNCED', first.index?.detail ?? '');
      const partial = await keyAccount(store, hash);
      assert.equal(partial.creditedCents, '1500');
      assert.equal(partial.toOpenCents, '500');
      assert.equal(partial.status, 'BELOW_MINIMUM');
      assert.equal(partial.topUps[0]?.transactionHash, firstHash.toLowerCase());
      const refused = await admit(request, store, 'evidence-versions');
      assert.equal(refused.ok, false);
      if (!refused.ok) {
        assert.equal(refused.response.status, 402);
        assert.equal((await refused.response.json()).charged, false);
      }
      assert.equal((await keyAccount(store, hash)).spentCents, '0');

      const secondHash = await send(parsed.config.desk, `${selector('topUp(bytes32,uint256)')}${hash.slice(2)}${word(secondAmount)}`);
      await runCredits(store, new Date(), null);
      const opened = await keyAccount(store, hash);
      assert.equal(opened.status, 'OPEN');
      assert.equal(opened.creditedCents, '2000');
      assert.equal(opened.balanceCents, '2000', 'opening consumes none of the prepaid balance');
      assert.deepEqual(opened.topUps.map((u) => u.transactionHash), [firstHash, secondHash].map((h) => h.toLowerCase()));

      const admitted = await admit(request, store, 'evidence-versions');
      assert.equal(admitted.ok, true);
      assert.equal((await keyAccount(store, hash)).spentCents, '0', 'admission is not a debit');
      const answer = await receipts(store);
      assert.equal(answer.storeFault, null);
      assert.equal(answer.topUps, priorReceipts.topUps + 2);
      assert.equal(BigInt(answer.cents), BigInt(priorReceipts.cents) + 2000n);
      const settled = await settle(store, hash, 'evidence-versions', 'apple-s1 · local acceptance');
      assert.equal(settled.ok, true);
      if (settled.ok) {
        assert.equal(settled.account.balanceCents, '1995');
        assert.equal(paidHeaders(settled.account, 5)['x-curb-charged-cents'], '5');
      }
      const charged = await keyAccount(store, hash);
      assert.equal(charged.charges[0]?.ref, 'apple-s1 · local acceptance');
      const replay = await runCredits(store, new Date(), null);
      assert.equal(replay.index?.newTopUps, 0);
      assert.equal((await keyAccount(store, hash)).creditedCents, '2000');
      assert.equal((await keyAccount(store, hash)).balanceCents, '1995');
      assert.equal((await receipts(store)).cents, answer.cents, 'spending and replay do not inflate payment receipts');

      // Delivery is injected: no DNS lookup or webhook request leaves this test.
      const success = await createSubscription(store, hash, 'https://hooks.example.com/success', new Date());
      const failure = await createSubscription(store, hash, 'https://hooks.example.com/failure', new Date());
      assert.ok(success.ok && failure.ok);
      const condition: Condition = { id: 'acceptance:sample', severity: 'NOTE', text: 'local acceptance condition' };
      const sent: string[] = [];
      const post = async (_message: string, webhook: string) => {
        sent.push(webhook);
        return webhook.endsWith('/success') ? { state: 'SENT' as const, status: 204 } : { state: 'FAILED' as const, reason: 'simulated receiver unavailable' };
      };
      const resolve = async () => ['93.184.216.34'];
      const delivery = await fanOut(store, new Date(), [condition], post, resolve);
      assert.equal(delivery.delivered, 1);
      assert.equal(delivery.charged, 1);
      assert.equal(delivery.failed.length, 1);
      assert.equal((await keyAccount(store, hash)).balanceCents, '1985');
      const same = await fanOut(store, new Date(), [condition], post, resolve);
      assert.equal(same.charged, 0);
      assert.equal(sent.filter((s) => s.endsWith('/success')).length, 1);
      const subscriptions = await subscriptionsOf(store, hash);
      assert.equal(subscriptions.subscriptions.find((s) => s.url.endsWith('/failure'))?.lastDelivery?.charged, false);

      // Consume the remaining prepaid balance at the unchanged five-cent price.
      // No synthetic balance write is used to force the insufficient-funds case.
      for (let i = 0; i < 397; i += 1) {
        const paid = await gate(request, store, 'evidence-versions', `local acceptance usage ${i}`);
        assert.equal(paid.ok, true, `paid call ${i}`);
      }
      const exhausted = await keyAccount(store, hash);
      assert.equal(exhausted.status, 'OPEN', 'the opening minimum is cumulative, not a minimum remaining balance');
      assert.equal(exhausted.balanceCents, '0');
      assert.equal(exhausted.spentCents, '2000');
      const noBalance = await gate(request, store, 'evidence-versions', 'must not be billed');
      assert.equal(noBalance.ok, false);
      if (!noBalance.ok) {
        assert.equal(noBalance.response.status, 402);
        const body = await noBalance.response.json();
        assert.equal(body.error, 'INSUFFICIENT');
        assert.equal(body.charged, false);
      }
      assert.equal((await keyAccount(store, hash)).spentCents, '2000');
      assert.equal((await receipts(store)).cents, answer.cents);
      t.diagnostic('LOCAL MOCKS ONLY: cumulative $20 credited, 398 five-cent calls and one ten-cent delivery consumed $20; failed delivery and refused calls charged zero; replay did not duplicate receipts');
    } finally {
      if (before === undefined) delete process.env[CREDITS_ENV];
      else process.env[CREDITS_ENV] = before;
      forgetChainConfirmations();
      assert.ok(directory.startsWith(path.join(tmpdir(), 'curb-credits-acceptance-')));
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
