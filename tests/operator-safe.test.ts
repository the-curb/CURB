import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { keccak256, toHex } from '../lib/chain/keccak.ts';
import { FALLBACK_STORAGE_SLOT, GUARD_STORAGE_SLOT, MODULE_SENTINEL, validateOperatorSafeExpectation, verifyOperatorSafe, type OperatorSafeExpectation, type OperatorSafeReader } from '../contracts/scripts/lib/operator-safe.ts';
import { assertLoopbackRpc } from '../contracts/scripts/lib/local-chain.ts';

const operator = '0x1000000000000000000000000000000000000000';
const owners = ['0x2000000000000000000000000000000000000000', '0x3000000000000000000000000000000000000000', '0x4000000000000000000000000000000000000000'] as const;
const singleton = '0x5000000000000000000000000000000000000000';
const proxyCode = '0x6000';
const singletonCode = '0x6001';
const hash = (hex: string) => toHex(keccak256(Buffer.from(hex.slice(2), 'hex'))) as `0x${string}`;
const word = (at = '0x0000000000000000000000000000000000000000') => `0x${'0'.repeat(24)}${at.slice(2)}`;
const expectation: OperatorSafeExpectation = { chainId: 1, version: '1.4.1', owners, threshold: 2, runtimeCodeHash: hash(proxyCode), singleton: { address: singleton, runtimeCodeHash: hash(singletonCode) }, modules: [], guard: null, fallbackHandler: null, reviewedBy: 'unit-test fixture, not a public approval', reviewedAt: '2026-09-13T00:00:00Z' };
const reader = (overrides: Partial<OperatorSafeReader> = {}): OperatorSafeReader => ({
  chainId: async () => 1, blockNumber: async () => 123n,
  code: async (at, block) => { assert.equal(block, 123n); return at === operator ? proxyCode : singletonCode; },
  owners: async (_at, block) => { assert.equal(block, 123n); return [...owners].reverse(); },
  threshold: async (_at, block) => { assert.equal(block, 123n); return 2n; },
  singleton: async (_at, block) => { assert.equal(block, 123n); return singleton; },
  version: async (_at, block) => { assert.equal(block, 123n); return '1.4.1'; },
  modules: async (_at, start, pageSize, block) => { assert.equal(block, 123n); assert.equal(start, MODULE_SENTINEL); assert.equal(pageSize, 16n); return [[], MODULE_SENTINEL]; },
  storage: async (_at, slot, block) => { assert.equal(block, 123n); assert.ok([GUARD_STORAGE_SLOT, FALLBACK_STORAGE_SLOT].includes(slot)); return word(); },
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

  it('requires explicit version, complete module records, guard and fallback expectations', () => {
    for (const value of [
      { ...expectation, version: undefined }, { ...expectation, version: '1.5.0' },
      { ...expectation, modules: undefined }, { ...expectation, modules: [null] },
      { ...expectation, modules: [{ address: owners[0], runtimeCodeHash: hash(singletonCode) }, { address: owners[0], runtimeCodeHash: hash(singletonCode) }] },
      { ...expectation, modules: [{ address: MODULE_SENTINEL, runtimeCodeHash: hash(singletonCode) }] },
      { ...expectation, guard: undefined }, { ...expectation, guard: { address: owners[0] } },
      { ...expectation, fallbackHandler: undefined }, { ...expectation, fallbackHandler: { address: owners[0], runtimeCodeHash: '0x' } },
    ]) assert.throws(() => validateOperatorSafeExpectation(value, 1), /operator Safe/);
  });

  it('refuses an enabled unreviewed module, unread module list, and unsupported Safe version', async () => {
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ modules: async () => [[owners[0]], MODULE_SENTINEL] })), /modules differ/);
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ modules: async () => { throw new Error('module RPC unread'); } })), /RPC unread/);
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ version: async () => '1.5.0' })), /version differs/);
  });

  it('walks every module page at the pinned block and matches module runtime hashes', async () => {
    const modules = Array.from({ length: 17 }, (_, i) => `0x${(100n + BigInt(i)).toString(16).padStart(40, '0')}` as const);
    const expected = { ...expectation, modules: [...modules].reverse().map((at) => ({ address: at, runtimeCodeHash: hash(singletonCode) })) };
    const cursors: string[] = [];
    const paginated = reader({ modules: async (_at, start, pageSize, block) => {
      assert.equal(block, 123n); assert.equal(pageSize, 16n); cursors.push(start);
      return start === MODULE_SENTINEL ? [modules.slice(0, 16), modules[15]] : [[modules[16]], MODULE_SENTINEL];
    } });
    const result = await verifyOperatorSafe(operator, expected, 1, paginated);
    assert.deepEqual(cursors, [MODULE_SENTINEL, modules[15]]);
    assert.equal(result.modules.length, 17);
    await assert.rejects(verifyOperatorSafe(operator, expected, 1, { ...paginated, code: async (at) => at === operator ? proxyCode : at === singleton ? singletonCode : proxyCode }), /module runtime/);
    await assert.rejects(verifyOperatorSafe(operator, expected, 1, { ...paginated, code: async (at) => at === operator ? proxyCode : at === singleton ? singletonCode : '0x' }), /module runtime/);
  });

  it('refuses truncated, looping, malformed or unbounded module lists', async () => {
    const modules = Array.from({ length: 16 }, (_, i) => `0x${(100n + BigInt(i)).toString(16).padStart(40, '0')}` as const);
    for (const response of [null, [[], '0x'], [[MODULE_SENTINEL], MODULE_SENTINEL], [[owners[0], owners[0]], MODULE_SENTINEL], [[owners[0]], owners[0]], [modules, owners[0]]]) {
      await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ modules: async () => response })), /module pagination/);
    }
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ modules: async () => [modules, modules[15]] })), /duplicate or cycle/);
    let next = 100n;
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ modules: async () => {
      const page = Array.from({ length: 16 }, () => `0x${(next++).toString(16).padStart(40, '0')}`);
      return [page, page.at(-1)];
    } })), /did not terminate/);
  });

  it('matches guard and fallback address and code or explicit absence at the pinned block', async () => {
    const guard = { address: owners[0], runtimeCodeHash: hash(singletonCode) };
    const fallbackHandler = { address: owners[1], runtimeCodeHash: hash(singletonCode) };
    const configured = reader({ storage: async (_at, slot, block) => { assert.equal(block, 123n); return word(slot === GUARD_STORAGE_SLOT ? guard.address : fallbackHandler.address); } });
    const result = await verifyOperatorSafe(operator, { ...expectation, guard, fallbackHandler }, 1, configured);
    assert.deepEqual(result.guard, guard);
    assert.deepEqual(result.fallbackHandler, fallbackHandler);
    for (const label of ['guard', 'fallbackHandler'] as const) {
      const expected = { ...expectation, guard, fallbackHandler, [label]: null };
      await assert.rejects(verifyOperatorSafe(operator, expected, 1, configured), /reviewed as absent/);
      await assert.rejects(verifyOperatorSafe(operator, { ...expectation, guard, fallbackHandler }, 1, { ...configured, storage: async (_at, slot) => word(slot === (label === 'guard' ? GUARD_STORAGE_SLOT : FALLBACK_STORAGE_SLOT) ? owners[2] : slot === GUARD_STORAGE_SLOT ? guard.address : fallbackHandler.address) }), /differs from the reviewed address/);
      await assert.rejects(verifyOperatorSafe(operator, { ...expectation, guard, fallbackHandler }, 1, { ...configured, code: async (at) => at === operator ? proxyCode : at === (label === 'guard' ? guard.address : fallbackHandler.address) ? proxyCode : singletonCode }), /runtime code differs/);
    }
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ storage: async () => undefined })), /storage is unreadable/);
    await assert.rejects(verifyOperatorSafe(operator, expectation, 1, reader({ storage: async () => `0x1${'0'.repeat(63)}` })), /not an address word/);
  });
});

describe('local rehearsal endpoints', () => {
  it('accepts only uncredentialed loopback URLs before any network or transaction', () => {
    for (const url of ['http://127.0.0.1:8545', 'http://localhost:9546', 'http://[::1]:8545']) assert.doesNotThrow(() => assertLoopbackRpc(url));
    for (const url of ['https://example.com', 'http://127.0.0.1.evil.example', 'http://secret@localhost', 'file:///tmp/rpc']) assert.throws(() => assertLoopbackRpc(url));
  });
});
