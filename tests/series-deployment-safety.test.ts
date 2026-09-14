import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertRecordedSourceCommit } from '../contracts/scripts/lib/build-provenance.mjs';
import { journaledDeployment } from '../contracts/scripts/lib/journaled-deployment.mjs';

describe('series deployment source provenance', () => {
  it('refuses a clean-looking build from an older source/compiler commit', () => {
    const current = 'a'.repeat(40);
    assert.doesNotThrow(() => assertRecordedSourceCommit({ sourceCommit: current, workingTreeClean: true }, current));
    for (const record of [{ sourceCommit: 'b'.repeat(40), workingTreeClean: true }, { sourceCommit: current, workingTreeClean: false }, { sourceCommit: null, workingTreeClean: true }]) assert.throws(() => assertRecordedSourceCommit(record, current), /sourceCommit/);
  });
});

describe('series deployment journal', () => {
  const fresh = () => join(mkdtempSync(join(tmpdir(), 'curb-deploy-journal-')), 'deployment.json');
  const intent = { pending: { deployer: 'local fixture', nonce: 7, expectedAddress: 'local predicted address' } };
  it('writes the nonce and intended address before send and the hash before receipt polling', async () => {
    const file = fresh();
    const result = await journaledDeployment(file, intent, async () => {
      const journal = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(journal.pending.state, 'SENDING');
      assert.equal(journal.pending.nonce, 7);
      assert.equal(journal.pending.transactionHash, null);
      return '0xlocalhash';
    }, async (hash) => {
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).pending.transactionHash, hash);
      return { status: 'success', transactionHash: hash };
    });
    assert.equal(result.hash, '0xlocalhash');
  });
  it('retains uncertain send intent and forbids another send using the same deployment record', async () => {
    const file = fresh();
    await assert.rejects(journaledDeployment(file, intent, async () => { throw new Error('RPC may have accepted the transaction'); }, async () => ({})));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).pending.state, 'SENDING');
    let sends = 0;
    await assert.rejects(journaledDeployment(file, intent, async () => { sends += 1; return 'new hash'; }, async () => ({})), /EEXIST/);
    assert.equal(sends, 0);
  });
  it('retains the known hash if receipt polling fails', async () => {
    const file = fresh();
    await assert.rejects(journaledDeployment(file, intent, async () => '0xknownhash', async () => { throw new Error('receipt timeout'); }));
    const journal = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(journal.pending.transactionHash, '0xknownhash');
    assert.equal(journal.pending.state, 'SENT');
  });
  it('retains SENT when receipt polling returns another transaction or omits its hash', async () => {
    for (const receipt of [{ status: 'success', transactionHash: '0xreplacement' }, { status: 'success' }]) {
      const file = fresh();
      await assert.rejects(journaledDeployment(file, intent, async () => '0xoriginal', async () => receipt), /receipt does not identify the sent transaction/);
      const journal = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(journal.pending.state, 'SENT');
      assert.equal(journal.pending.transactionHash, '0xoriginal');
      assert.equal(journal.pending.expectedAddress, intent.pending.expectedAddress);
    }
  });
});
