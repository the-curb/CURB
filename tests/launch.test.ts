import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { SAFE_EVIDENCE, launchStatus, shortAddress } from '../lib/launch/status.ts';
import type { Store } from '../lib/store/types.ts';

/**
 * The front page's stage line is derived from the record, not typed: the
 * Safe's evidence file, the CURB_CREDITS line, the last rate row. With no
 * desk configured the store is never asked, so a store that refuses every
 * call is enough to prove it.
 */
const noStore = new Proxy({}, { get: (_t, name) => () => Promise.reject(new Error(`the store was asked ${String(name)}; nothing should be read without a desk`)) }) as Store;
const SAFE = '0x4E69723F9Ba9fA2C9842d77b240b2C0F601ac219';

describe('the launch status', () => {
  const realCredits = process.env.CURB_CREDITS;
  beforeEach(() => {
    delete process.env.CURB_CREDITS;
  });
  afterEach(() => {
    if (realCredits === undefined) delete process.env.CURB_CREDITS;
    else process.env.CURB_CREDITS = realCredits;
  });

  it('reads the treasury from the committed evidence file and says the token and the desk are not there', async () => {
    const status = await launchStatus(noStore, path.resolve(import.meta.dirname, '..'));
    assert.equal(status.step, 'TREASURY_LIVE');
    assert.equal(status.chainId, 4663);
    assert.deepEqual(status.treasury, { address: SAFE, owners: 3, threshold: '2', block: 61_691_826 });
    assert.equal(status.desk, null);
    assert.equal(status.rateAtBlock, null);
    assert.match(status.line, /^On Robinhood Chain mainnet: the operator's 2-of-3 Safe/);
    assert.ok(status.line.includes(shortAddress(SAFE)), 'the treasury is named');
    assert.ok(status.line.includes('block 61,691,826'), 'the block is named');
    assert.match(status.line, /the token and the desk come next, so nothing is sold yet\.$/);
  });

  it('says nothing is on chain when there is no evidence file', async () => {
    const status = await launchStatus(noStore, mkdtempSync(path.join(tmpdir(), 'curb-launch-')));
    assert.equal(status.step, 'NOTHING');
    assert.equal(status.treasury, null);
    assert.match(status.line, /no treasury, no token, no desk on chain yet; nothing is sold\./);
  });

  it('shortens an address to the first six and the last four', () => {
    assert.equal(shortAddress(SAFE), '0x4E69…c219');
    assert.equal(SAFE_EVIDENCE, path.join('contracts', 'evidence', 'safes', 'safe.4663.json'));
  });
});
