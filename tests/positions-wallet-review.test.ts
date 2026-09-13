import assert from 'node:assert/strict';
import { it } from 'node:test';
import { selector } from '../lib/chain/keccak.ts';
import { approveCall } from '../lib/positions/calldata.ts';
import { checkWalletReplacement, displayTokenUnits, readWalletReview } from '../lib/positions/wallet-review.ts';
import type { WalletProvider } from '../lib/positions/wallet.ts';

const holder = `0x${'1'.repeat(40)}`, series = `0x${'2'.repeat(40)}`, A = `0x${'3'.repeat(40)}`, B = `0x${'4'.repeat(40)}`;
const oldHash = `0x${'a'.repeat(64)}`, newHash = `0x${'b'.repeat(64)}`;
const uint = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}`;

it('displays units exactly beyond Number precision and for differing decimals', () => {
  assert.equal(displayTokenUnits('9007199254740993000001', 6), '9007199254740993.000001');
  assert.equal(displayTokenUnits('10000000000000000001', 18), '10.000000000000000001');
  assert.equal(displayTokenUnits('123', 0), '123');
  assert.equal(displayTokenUnits('0', 18), '0');
  assert.throws(() => displayTokenUnits('-1', 18));
});

it('reads allowance/decimals at one block, keeps failed B and gas unavailable, and never sends', async () => {
  const reads: { method: string; params?: unknown[] }[] = [];
  const provider: WalletProvider = { async request(args) {
    reads.push(args);
    if (args.method === 'eth_accounts') return [holder];
    if (args.method === 'eth_chainId') return '0x1';
    if (args.method === 'eth_blockNumber') return '0x64';
    if (args.method === 'eth_estimateGas') throw new Error('approval needed first');
    if (args.method === 'eth_call') {
      const call = args.params![0] as { to: string; data: string };
      assert.equal(args.params![1], '0x64');
      if (call.to === B) throw new Error('B unread');
      return call.data === selector('decimals()') ? uint(6n) : uint(15_000_000n);
    }
    throw new Error(`unexpected ${args.method}`);
  } };
  const review = await readWalletReview(provider, { account: holder, chainId: 1 }, series, { A, B }, { A: '10000000', B: '20000000' }, [approveCall(A, series, 10_000_000n, 'A')]);
  assert.deepEqual(review.components.A, { state: 'READ', address: A, decimals: 6, allowance: '15', amount: '10', enoughAllowance: true });
  assert.equal(review.components.B.state, 'UNREAD');
  assert.equal(review.gas[0]!.units, null);
  assert.ok(reads.every(r => r.method !== 'eth_sendTransaction'));
});

function replacementProvider(change: Record<string, unknown> = {}, mined = true): WalletProvider {
  const tx = { from: holder, to: series, nonce: '0x5', input: '0x1234', value: '0x0' };
  return { async request({ method, params }) {
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getTransactionByHash') return params![0] === oldHash ? { ...tx, hash: oldHash } : { ...tx, hash: newHash, ...change };
    if (method === 'eth_getTransactionReceipt') return mined ? { transactionHash: params![0], status: '0x1', blockNumber: '0x64' } : null;
    throw new Error(`unexpected ${method}`);
  } };
}
const pending = { account: holder, chainId: 1, action: 'mint' as const, hash: oldHash };
it('recognizes a mined speed-up only when sender, nonce, value and action match', async () => {
  assert.equal((await checkWalletReplacement(replacementProvider(), pending, newHash))?.state, 'MINED');
  await assert.rejects(checkWalletReplacement(replacementProvider({ nonce: '0x6' }), pending, newHash), /same wallet and nonce/);
  await assert.rejects(checkWalletReplacement(replacementProvider({ from: A }), pending, newHash), /same wallet and nonce/);
});
it('distinguishes cancellation, different action and still-pending replacement', async () => {
  assert.equal((await checkWalletReplacement(replacementProvider({ to: holder, input: '0x' }), pending, newHash))?.state, 'CANCELLED');
  assert.equal((await checkWalletReplacement(replacementProvider({ input: '0xabcd' }), pending, newHash))?.state, 'REPLACED');
  assert.equal(await checkWalletReplacement(replacementProvider({}, false), pending, newHash), null);
});
it('does not reconcile a replacement on another chain', async () => {
  await assert.rejects(checkWalletReplacement(replacementProvider(), { ...pending, chainId: 4663 }, newHash), /switch to chain/);
});
it('requires a receipt bound to the replacement hash and rejects a chain switch during the read', async () => {
  for (const scenario of ['different-hash', 'missing-hash', 'chain-switch']) {
    const base = replacementProvider();
    let switched = false;
    const provider: WalletProvider = { async request(args) {
      if (args.method === 'eth_chainId' && switched) return '0xa';
      if (args.method === 'eth_getTransactionReceipt') {
        switched = scenario === 'chain-switch';
        return { status: '0x1', blockNumber: '0x64', ...(scenario === 'missing-hash' ? {} : { transactionHash: scenario === 'different-hash' ? oldHash : newHash }) };
      }
      return base.request(args);
    } };
    await assert.rejects(checkWalletReplacement(provider, pending, newHash), /transaction hash|chain changed/);
  }
});
