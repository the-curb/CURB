import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { keccak256, toHex } from '../lib/chain/keccak.ts';
import { validateOperatorSafeExpectation, verifyOperatorSafe, type OperatorSafeExpectation, type OperatorSafeReader } from '../contracts/scripts/lib/operator-safe.ts';
import { assertLoopbackRpc } from '../contracts/scripts/lib/local-chain.ts';

const operator = '0x1000000000000000000000000000000000000000';
const owners = ['0x2000000000000000000000000000000000000000', '0x3000000000000000000000000000000000000000', '0x4000000000000000000000000000000000000000'] as const;
const singleton = '0x5000000000000000000000000000000000000000';
const proxyCode = '0x6000';
const singletonCode = '0x6001';
const hash = (hex: string) => toHex(keccak256(Buffer.from(hex.slice(2), 'hex'))) as `0x${string}`;
const expectation: OperatorSafeExpectation = { chainId: 1, owners, threshold: 2, runtimeCodeHash: hash(proxyCode), singleton: { address: singleton, runtimeCodeHash: hash(singletonCode) }, reviewedBy: 'unit-test fixture, not a public approval', reviewedAt: '2026-09-13T00:00:00Z' };
const reader = (overrides: Partial<OperatorSafeReader> = {}): OperatorSafeReader => ({
  chainId: async () => 1, blockNumber: async () => 123n,
  code: async (at, block) => { assert.equal(block, 123n); return at === operator ? proxyCode : singletonCode; },
  owners: async (_at, block) => { assert.equal(block, 123n); return [...owners].reverse(); },
  threshold: async (_at, block) => { assert.equal(block, 123n); return 2n; },
  singleton: async (_at, block) => { assert.equal(block, 123n); return singleton; },
  ...overrides,
});

describe('public series operator Safe preflight', () => {
  it('requires explicit reviewed chain, unique owners, quorum and runtime identity before reading a node', () => {
    for (const value of [undefined, {}, { ...expectation, chainId: 4663 }, { ...expectation, owners: [owners[0], owners[0]] }, { ...expectation, threshold: 1 }, { ...expectation, threshold: 4 }, { ...expectation, runtimeCodeHash: '0x' }, { ...expectation, reviewedBy: '' }, { ...expectation, reviewedAt: 'later' }, { ...expectation, singleton: undefined }]) {
      assert.throws(() => validateOperatorSafeExpectation(value, 1), /operator Safe/);
    }
  });

  it('verifies the same block, owner set regardless of order, quorum, proxy and singleton', async () => {
    const result = await verifyOperatorSafe(operator, expectation, 1, reader());
    assert.equal(result.blockNumber, '123');
    assert.equal(result.threshold, 2);
    assert.deepEqual(result.owners, owners);
    assert.equal(result.singleton.address, singleton);
  });

  it('refuses an EOA, wrong chain, duplicate or different owners and quorum mismatch', async () => {
    for (const overrides of [
      { chainId: async () => 4663 },
      { code: async () => '0x' as const },
      { owners: async () => [owners[0], owners[0], owners[2]] },
      { owners: async () => [owners[0], owners[1]] },
      { threshold: async () => 1n },
      { owners: async () => { throw new Error('RPC unread'); } },
    ]) await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader(overrides)));
  });

  it('refuses an altered proxy, a different singleton and changed singleton code even if owners match', async () => {
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ code: async () => singletonCode })), /proxy runtime/);
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ singleton: async () => owners[0] })), /singleton differs/);
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ code: async () => proxyCode })), /singleton runtime/);
  });
});

describe('local rehearsal endpoints', () => {
  it('accepts only uncredentialed loopback URLs before any network or transaction', () => {
    for (const url of ['http://127.0.0.1:8545', 'http://localhost:9546', 'http://[::1]:8545']) assert.doesNotThrow(() => assertLoopbackRpc(url));
    for (const url of ['https://example.com', 'http://127.0.0.1.evil.example', 'http://secret@localhost', 'file:///tmp/rpc']) assert.throws(() => assertLoopbackRpc(url));
  });
});
