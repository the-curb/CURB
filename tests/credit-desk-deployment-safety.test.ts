import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const script = fileURLToPath(new URL('../contracts/scripts/deploy-credit-desk.ts', import.meta.url));
const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const reviewed = {
  network: 'ethereum-mainnet', chainId: 1, rpcUrl: 'http://127.0.0.1:1',
  token: address(10), decimals: 18, treasury: address(20), priceSource: null,
  reviewedBy: 'local refusal fixture only', reviewedAt: '2026-09-15T00:00:00Z',
};
const safe = {
  chainId: 1, version: '1.4.1', owners: [address(21), address(22), address(23)], threshold: 2,
  runtimeCodeHash: `0x${'ab'.repeat(32)}`, singleton: { address: address(24), runtimeCodeHash: `0x${'cd'.repeat(32)}` },
  modules: [], guard: null, fallbackHandler: null,
  reviewedBy: 'local refusal fixture only', reviewedAt: '2026-09-15T00:00:00Z',
};

function run(record: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'curb-credit-deploy-refusal-'));
  const file = join(directory, 'record.json');
  writeFileSync(file, JSON.stringify(record));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(CURB_|DEPLOYER_|REHEARSAL_)/.test(key)) delete env[key];
  const result = spawnSync(process.execPath, [script, file, '--dry-run', '--reviewed'], { encoding: 'utf8', env, timeout: 15_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.stdout, '', 'a refused record cannot publish deployment configuration');
  assert.doesNotMatch(result.stderr, /node:|did not answer|sent 0x/, 'refusal occurs before network activity');
  return result.stderr;
}

describe('CreditDesk public deployment record guards', () => {
  it('requires reviewed treasury governance even when an address was supplied', () => {
    assert.match(run(reviewed), /treasury verification:.*reviewed operatorSafe expectation/);
    assert.match(run({ ...reviewed, treasurySafe: null }), /treasury verification:/);
  });
  it('rejects a one-signer treasury expectation before making RPC calls', () => {
    assert.match(run({ ...reviewed, treasurySafe: { ...safe, threshold: 1 } }), /quorum must be at least two/);
  });
  it('rejects a treasury expectation copied from another chain', () => {
    assert.match(run({ ...reviewed, treasurySafe: { ...safe, chainId: 4663 } }), /expectation must name the deployment chain/);
  });
  it('does not equate omitted modules and fallback controls with reviewed absence', () => {
    const { modules: _modules, ...missingModules } = safe;
    assert.match(run({ ...reviewed, treasurySafe: missingModules }), /complete modules array/);
    const { fallbackHandler: _fallback, ...missingFallback } = safe;
    assert.match(run({ ...reviewed, treasurySafe: missingFallback }), /fallback handler/);
  });
  it('does not use the local-chain exception with a remote or credentialed endpoint', () => {
    const local = { ...reviewed, network: 'hardhat-local', chainId: 31337 };
    assert.match(run({ ...local, rpcUrl: 'https://example.com' }), /uncredentialed loopback RPC/);
    assert.match(run({ ...local, rpcUrl: 'http://secret:password@127.0.0.1:8545' }), /uncredentialed loopback RPC/);
  });
});
