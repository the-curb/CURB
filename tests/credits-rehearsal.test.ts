import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import { CREDITS_ENV } from '../lib/credits/config.ts';
import { gate } from '../lib/credits/guard.ts';
import { keyAccount, keyHashOf } from '../lib/credits/keys.ts';
import { runCredits } from '../lib/credits/maintenance.ts';
import { curbForCents, readRateFromEvents } from '../lib/credits/rate.ts';
import { NETWORKS } from '../lib/chain/networks.ts';
import { CREDITS_INTERVAL_SECONDS } from '../lib/credits/indexer.ts';
import { parseCreditsConfig } from '../lib/credits/config.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

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
      // After the second top-up the pool is 4,000,000 CURB against 40,000 dollars: US$0.01 a CURB; 1e9 supply is US$10,000,000.
      assert.equal(run.rate.rate.usdPerCurb18, (10n ** 16n).toString());
      assert.equal(run.rate.rate.marketCapUsd18, (10_000_000n * 10n ** 18n).toString());
      assert.equal(curbForCents(run.rate.rate, 2000n), 2_000n * 10n ** 18n, 'US$20 is 2,000 CURB at the head');

      // The desk's code is the committed build, and its immutables are the record's token and treasury.
      assert.equal(run.code?.state, 'MATCHES', run.code?.detail ?? '');
      assert.deepEqual(run.code?.immutables.map((i) => [i.name, i.matches]), [['curb', true], ['treasury', true]]);

      assert.equal(run.index?.state, 'SYNCED', run.index?.detail ?? '');
      assert.equal(run.index?.newTopUps, 2);
      assert.deepEqual(
        run.index?.credited.map((c) => [c.keyHash, c.cents, c.basis]),
        record.topUps.map((u) => [record.keyHash, u.expectCents, 'TOP_UP_BLOCK']),
        'each top-up priced at its own block: 4,000 CURB at US$0.005, then 1,000 at US$0.01',
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
        assert.equal(first.value.usdPerCurb18, (5n * 10n ** 15n).toString(), 'US/usr/bin/bash.005 from the Sync before the first top-up');
        assert.equal(second.value.usdPerCurb18, (10n ** 16n).toString(), 'US/usr/bin/bash.01 from the Sync before the second');
        assert.ok(first.value.pool.eventBlock! < record.topUps[0]!.block);
      }

      const account = await keyAccount(store, record.keyHash);
      assert.equal(account.status, 'OPEN');
      assert.equal(account.creditedCents, '3000');
      assert.deepEqual(account.topUps.map((u) => [u.blockNumber, u.amount, u.cents]), record.topUps.map((u) => [u.block, u.amount, u.expectCents]));

      // The same tick again credits nothing twice.
      const again = await runCredits(store, new Date(), null);
      assert.equal(again.index?.newTopUps, 0);
      assert.equal((await keyAccount(store, record.keyHash)).creditedCents, '3000');

      // A paid call with the key: charged, answered, the balance moved by the listed price.
      const paid = await gate(new Request('https://the-curb.test/api/x', { headers: { 'x-curb-key': record.key } }), store, 'evidence-versions', 'apple-s1 · rehearsal');
      assert.equal(paid.ok, true);
      if (paid.ok) assert.equal(paid.account.balanceCents, '2995');
    } finally {
      if (before === undefined) delete process.env[CREDITS_ENV];
      else process.env[CREDITS_ENV] = before;
      forgetChainConfirmations();
    }
  });
});
