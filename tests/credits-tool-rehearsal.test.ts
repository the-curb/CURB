import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import { CREDITS_ENV, parseCreditsConfig } from '../lib/credits/config.ts';
import { runCredits } from '../lib/credits/maintenance.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * The operator's tools, end to end on a local chain: the token read into a
 * record by record-token.ts, the record reviewed (a stand-in named as
 * such, on chain 31337 only), the desk deployed by deploy-credit-desk.ts
 * with the well-known local test key, and the site reading that desk —
 * its code the committed build with the record's token and treasury, the
 * rate from the same pool, the index synced. Skipped unless the tool's
 * printed line is in CURB_REHEARSAL_DESK_ENV.
 */
describe('the credit desk deployed through the operator’s tools, read by the site', () => {
  const raw = process.env.CURB_REHEARSAL_DESK_ENV;

  it('finds the tool-deployed desk to be the build, paying to the recorded treasury, with a rate from the pool', async (t) => {
    if (!raw) {
      t.skip('CURB_REHEARSAL_DESK_ENV is not set; run record-token.ts and deploy-credit-desk.ts against a Hardhat node first');
      return;
    }
    const parsed = parseCreditsConfig(raw);
    assert.equal(parsed.state, 'CONFIGURED', parsed.state === 'CONFIGURED' ? '' : parsed.detail);
    if (parsed.state !== 'CONFIGURED') return;
    assert.equal(parsed.config.network.chainId, 31337, 'the tool path is rehearsed on a local chain only');
    assert.ok(parsed.config.priceSource !== null, 'the record names the pool');

    const before = process.env[CREDITS_ENV];
    process.env[CREDITS_ENV] = raw;
    forgetChainConfirmations();
    try {
      const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-credits-tool-')));
      const run = await runCredits(store, new Date(), null);
      assert.equal(run.state, 'CONFIGURED', run.detail ?? '');
      assert.equal(run.code?.state, 'MATCHES', run.code?.detail ?? '');
      assert.deepEqual(run.code?.immutables.map((i) => [i.name, i.expected.slice(-40), i.matches]), [
        ['curb', parsed.config.token.slice(2), true],
        ['treasury', parsed.config.treasury.slice(2), true],
      ]);
      assert.equal(run.rate?.state, 'READ', JSON.stringify(run.rate));
      assert.equal(run.index?.state, 'SYNCED', run.index?.detail ?? '');
      assert.equal(run.index?.newTopUps, 0, 'nobody has topped this desk up yet');
    } finally {
      if (before === undefined) delete process.env[CREDITS_ENV];
      else process.env[CREDITS_ENV] = before;
      forgetChainConfirmations();
    }
  });
});
