import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localUrl } from './rehearsal-safety.mjs';

/** Generate a fresh local signing account for the CLI path; never a fixed key. */
export async function creditToolFixture({ stage, rpcUrl, fixture, localEnv, run }) {
  localUrl(rpcUrl);
  const rpc = async (method, params = []) => {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.error, undefined, `Local ${method} refused`);
    return body.result;
  };
  assert.equal(await rpc('eth_chainId'), '0x7a69');
  const require = createRequire(path.join(stage, 'contracts/package.json'));
  const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');
  const privateKey = generatePrivateKey();
  const signer = privateKeyToAccount(privateKey);
  // Only the owned local node can synthesize this test account's gas balance.
  await rpc('hardhat_setBalance', [signer.address, `0x${(10n ** 21n).toString(16)}`]);
  const env = { ...localEnv, DEPLOYER_PRIVATE_KEY: privateKey };
  const contracts = path.join(stage, 'contracts');
  mkdirSync(path.join(contracts, 'records'), { recursive: true });
  const recordPath = path.join(contracts, 'records/rehearsal-credit-desk.json');
  await run('Read local token through the operator CLI', ['scripts/record-token.ts', fixture.credits.token, '--network', 'hardhat-local', '--treasury', fixture.treasury, '--out', recordPath], contracts, localEnv);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  record.priceSource = fixture.credits.priceSource;
  record.reviewedBy = 'LOCAL MOCK REHEARSAL ONLY; no independent review';
  record.reviewedAt = new Date().toISOString();
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  await run('Dry-run local CreditDesk deployment through the operator CLI', ['scripts/deploy-credit-desk.ts', recordPath, '--dry-run'], contracts, localEnv);
  const deployed = await run('Deploy local CreditDesk through the operator CLI', ['scripts/deploy-credit-desk.ts', recordPath], contracts, env, true);
  const nonceBefore = await rpc('eth_getTransactionCount', [signer.address, 'latest']);
  const refusal = await run('Refuse duplicate local CreditDesk deployment', ['scripts/deploy-credit-desk.ts', recordPath], contracts, env, false, true);
  assert.notEqual(refusal.code, 0);
  assert.match(refusal.stderr, /already exists/i, 'the failure must explicitly identify the existing deployment journal');
  assert.equal(await rpc('eth_getTransactionCount', [signer.address, 'latest']), nonceBefore, 'duplicate refusal must not consume a new nonce');
  return { config: deployed, verification: { recordedToken: true, dryRun: true, deployed: true, duplicateRefusedWithoutNewTransaction: true, signer: 'new random local account; key discarded, never recorded' } };
}
