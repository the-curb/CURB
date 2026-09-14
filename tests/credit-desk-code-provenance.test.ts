import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { verifyDeskCode, expectedDeskImmutables } from '../lib/credits/code.ts';
import { NETWORKS } from '../lib/chain/networks.ts';
import { forgetChainConfirmations } from '../lib/chain/rpc.ts';
import type { CreditsConfig } from '../lib/credits/config.ts';

const originalBuild = JSON.parse(readFileSync(new URL('../contracts/evidence/CreditDesk.build.json', import.meta.url), 'utf8'));
const baseConfig = {
  token: `0x${'1'.repeat(40)}`, treasury: `0x${'2'.repeat(40)}`, desk: `0x${'3'.repeat(40)}`,
  fromBlock: 1, priceSource: null,
};

async function verify(patch: Record<string, unknown>, network: 'hardhat-local' | 'ethereum-mainnet') {
  const priorCwd = process.cwd();
  const priorFetch = globalThis.fetch;
  const root = mkdtempSync(join(tmpdir(), 'curb-credit-build-provenance-'));
  mkdirSync(join(root, 'contracts', 'evidence'), { recursive: true });
  const build = { ...originalBuild, ...patch };
  writeFileSync(join(root, 'contracts', 'evidence', 'CreditDesk.build.json'), JSON.stringify(build));
  const config: CreditsConfig = { ...baseConfig, network: NETWORKS[network] };
  const wanted = expectedDeskImmutables(config);
  let runtime: string = build.deployedBytecode.slice(2);
  for (const immutable of build.immutables) for (const slot of immutable.slots) runtime = runtime.slice(0, slot.start * 2) + wanted[immutable.name] + runtime.slice((slot.start + slot.length) * 2);
  const methods: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const { id, method } = JSON.parse(String(init?.body));
    methods.push(method);
    assert.ok(['eth_chainId', 'eth_getCode'].includes(method), 'verification performs only expected reads');
    const result = method === 'eth_chainId' ? `0x${config.network.chainId.toString(16)}` : `0x${runtime}`;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'content-type': 'application/json' } });
  };
  forgetChainConfirmations();
  process.chdir(root);
  try {
    const result = await verifyDeskCode(config, { profile: config.network, intervalSeconds: 900 }, new Date('2026-09-15T00:00:00Z'));
    return { result, methods };
  } finally {
    process.chdir(priorCwd);
    globalThis.fetch = priorFetch;
    forgetChainConfirmations();
  }
}

describe('CreditDesk runtime verification source provenance', () => {
  it('rejects dirty, absent or malformed public source attribution before RPC', async () => {
    for (const patch of [
      { workingTreeClean: false, sourceCommit: 'a'.repeat(40) },
      { workingTreeClean: true, sourceCommit: null },
      { workingTreeClean: true, sourceCommit: 'not-a-source-commit' },
    ]) {
      const { result, methods } = await verify(patch, 'ethereum-mainnet');
      assert.equal(result.state, 'NO_BUILD');
      assert.equal(result.buildCommit, null);
      assert.match(result.detail ?? '', /clean committed source/);
      assert.deepEqual(methods, []);
    }
  });
  it('compares local rehearsal bytes without falsely assigning the recording commit as source', async () => {
    const { result, methods } = await verify({ workingTreeClean: false, sourceCommit: null, commit: 'b'.repeat(40) }, 'hardhat-local');
    assert.equal(result.state, 'MATCHES');
    assert.equal(result.buildCommit, null);
    assert.match(result.detail ?? '', /local rehearsal build/);
    assert.ok(methods.includes('eth_getCode'));
  });
  it('attributes a public bytecode match to the clean source commit, not the record-writing commit', async () => {
    const { result } = await verify({ workingTreeClean: true, sourceCommit: 'a'.repeat(40), commit: 'b'.repeat(40) }, 'ethereum-mainnet');
    assert.equal(result.state, 'MATCHES');
    assert.equal(result.buildCommit, 'a'.repeat(40));
  });
});
