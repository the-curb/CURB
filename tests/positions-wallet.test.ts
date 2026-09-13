import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { selector } from '../lib/chain/keccak.ts';
import { allocateExitCall, approveCall, claimCall, mintCall, SIGNATURES, type PreparedCall } from '../lib/positions/calldata.ts';
import { allocateExit, claim, claimsOf, mint, openSeries, receiptsOf, setTransferable, type LedgerResult } from '../lib/positions/ledger.ts';
import {
  callsForPositionAction, checkWalletTransaction, parsePendingWalletTransaction,
  parsePositionLots, readWalletPosition, runWalletSteps,
  type WalletProvider, type WalletStep,
} from '../lib/positions/wallet.ts';

const HOLDER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const SERIES = '0x3333333333333333333333333333333333333333';
const A = '0x4444444444444444444444444444444444444444';
const B = '0x5555555555555555555555555555555555555555';
const EXPECTED = { account: HOLDER, chainId: 1 };
const HASH = `0x${'a'.repeat(64)}`;
const mined = { status: '0x1', blockNumber: '0x64' };
const fast = { attempts: 1, delay: async () => {} };
const waiting = (calls: readonly PreparedCall[]): WalletStep[] => calls.map((call) => ({ call, state: 'WAITING', hash: null, detail: null }));
const mintCalls = () => [approveCall(A, SERIES, 10n, 'A'), approveCall(B, SERIES, 20n, 'B'), mintCall(SERIES, 1n, 2000000000n)];
const uint = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
const ok = (result: LedgerResult) => { assert.ok(result.ok); return result.state; };

class Wallet implements WalletProvider {
  account = HOLDER;
  chain = '0x1';
  sent: { from: string; to: string; data: string; chainId: string }[] = [];
  reads: { method: string; params?: unknown[] }[] = [];
  receipt: unknown = mined;
  sendError: unknown = null;
  onReceipt: (() => void) | null = null;
  balances = { receipts: 0n, A: 10n, B: 20n };
  unreadBalances = false;
  async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    this.reads.push(args);
    if (args.method === 'eth_accounts') return [this.account];
    if (args.method === 'eth_chainId') return this.chain;
    if (args.method === 'eth_blockNumber') return '0x64';
    if (args.method === 'eth_sendTransaction') {
      this.sent.push(args.params![0] as typeof this.sent[number]);
      if (this.sendError) throw this.sendError;
      return `0x${this.sent.length.toString(16).padStart(64, '0')}`;
    }
    if (args.method === 'eth_getTransactionReceipt') { this.onReceipt?.(); return this.receipt && typeof this.receipt === 'object' ? { transactionHash: args.params![0], ...this.receipt } : this.receipt; }
    if (args.method === 'eth_call') {
      if (this.unreadBalances) return '0x';
      const data = (args.params![0] as { data: string }).data;
      if (data.startsWith(selector('balanceOf(address)'))) return uint(this.balances.receipts);
      if (data.startsWith(selector('claimA(address)'))) return uint(this.balances.A);
      if (data.startsWith(selector('claimB(address)'))) return uint(this.balances.B);
    }
    throw new Error(`unexpected wallet method ${args.method}`);
  }
}

describe('position lot input', () => {
  it('rejects fractional, partial, exponent and noncanonical parses; preserves integers beyond Number precision', () => {
    for (const raw of ['', '0', '-1', '+1', '01', '1.5', '2abc', '1e3', '1,000', '1 2', 'Infinity', '１２']) assert.equal(parsePositionLots(raw), null, raw);
    assert.equal(parsePositionLots(' 123 '), 123n);
    assert.equal(parsePositionLots('9007199254740993'), 9007199254740993n);
    assert.equal(parsePositionLots(((1n << 256n) - 1n).toString()), (1n << 256n) - 1n);
    assert.equal(parsePositionLots((1n << 256n).toString()), null);
    assert.equal(parsePositionLots('1'.repeat(10000)), null);
  });
});

describe('separate allocation and component claims', () => {
  it('allocates once, then lets a zero-receipt holder claim B after A reverts without touching A or allocating again', async () => {
    let ledger = ok(mint(openSeries({ A: 10n, B: 20n }, 100n), HOLDER, 1n));
    ledger = ok(allocateExit(ledger, HOLDER, 1n));
    ledger = setTransferable(ledger, 'A', false);
    assert.equal(receiptsOf(ledger, HOLDER), 0n);
    const allocation = callsForPositionAction('allocate', SERIES, [allocateExitCall(SERIES, 1n), claimCall(SERIES, 'A'), claimCall(SERIES, 'B')]);
    assert.deepEqual(allocation.map((call) => call.signature), [SIGNATURES.allocateExit]);

    const wallet = new Wallet();
    wallet.receipt = { ...mined, status: '0x0' };
    const failedA = await runWalletSteps(wallet, EXPECTED, 'claimA', waiting(callsForPositionAction('claimA', SERIES)), () => {}, fast);
    assert.equal(failedA[0]!.state, 'REVERTED');
    assert.equal(claim(ledger, HOLDER, 'A').ok, false);
    wallet.receipt = mined;
    const paidB = await runWalletSteps(wallet, EXPECTED, 'claimB', waiting(callsForPositionAction('claimB', SERIES)), () => {}, fast);
    assert.equal(paidB[0]!.state, 'MINED');
    assert.equal(wallet.sent.length, 2, 'one A attempt and one independent B attempt, with no allocation');
    assert.equal(wallet.sent[1]!.data, claimCall(SERIES, 'B').data);
    ledger = ok(claim(ledger, HOLDER, 'B'));
    assert.deepEqual(claimsOf(ledger, HOLDER), { A: 10n, B: 0n });
  });

  it('reads pending claims even when receipts are zero, at one block, without calling either component', async () => {
    const wallet = new Wallet();
    assert.deepEqual(await readWalletPosition(wallet, SERIES, EXPECTED), { receipts: '0', claims: { A: '10', B: '20' }, block: '100' });
    const reads = wallet.reads.filter((read) => read.method === 'eth_call');
    assert.equal(reads.length, 3);
    for (const read of reads) {
      assert.equal((read.params![0] as { to: string }).to, SERIES);
      assert.equal(read.params![1], '0x64');
    }
    wallet.unreadBalances = true;
    await assert.rejects(readWalletPosition(wallet, SERIES, EXPECTED), /not shown as zero/);
  });
});

describe('wallet context and unresolved transactions', () => {
  it('blocks a stale connected account or chain before the first send', async () => {
    for (const change of ['account', 'chain'] as const) {
      const wallet = new Wallet();
      if (change === 'account') wallet.account = OTHER;
      else wallet.chain = '0xa';
      const steps = await runWalletSteps(wallet, EXPECTED, 'claimB', waiting(callsForPositionAction('claimB', SERIES)), () => {}, fast);
      assert.equal(wallet.sent.length, 0);
      assert.equal(steps[0]!.state, 'BLOCKED');
    }
  });

  it('rechecks account and chain after an approval, before sending the next transaction', async () => {
    for (const change of ['account', 'chain'] as const) {
      const wallet = new Wallet();
      wallet.onReceipt = () => { if (change === 'account') wallet.account = OTHER; else wallet.chain = '0xa'; };
      const steps = await runWalletSteps(wallet, EXPECTED, 'mint', waiting(mintCalls()), () => {}, fast);
      assert.equal(wallet.sent.length, 1, `the changed ${change} must stop further sends`);
      assert.equal(steps[0]!.state, change === 'chain' ? 'PENDING' : 'MINED', 'a receipt read during a chain switch cannot settle the pending hash');
      assert.equal(steps[1]!.state, change === 'chain' ? 'WAITING' : 'BLOCKED');
      assert.equal(steps[2]!.state, 'WAITING');
      assert.equal(wallet.sent[0]!.from, HOLDER);
      assert.equal(wallet.sent[0]!.chainId, '0x1');
    }
  });

  it('keeps a timed-out hash pending, checks it without resending, then resumes only unsent steps', async () => {
    const wallet = new Wallet();
    wallet.receipt = null;
    const pending = await runWalletSteps(wallet, EXPECTED, 'mint', waiting(mintCalls()), () => {}, fast);
    assert.equal(pending[0]!.state, 'PENDING');
    assert.equal(wallet.sent.length, 1);
    await runWalletSteps(wallet, EXPECTED, 'mint', pending, () => {}, fast);
    assert.equal(wallet.sent.length, 1, 'clicking send again must not resubmit the pending approval');
    const marker = { ...EXPECTED, action: 'mint' as const, hash: pending[0]!.hash };
    assert.equal(await checkWalletTransaction(wallet, marker), null);
    wallet.receipt = mined;
    const receipt = await checkWalletTransaction(wallet, marker);
    assert.equal(receipt!.state, 'MINED');
    assert.equal(wallet.sent.length, 1, 'receipt checks must be read only');
    const resolved = pending.map((step, index) => index === 0 ? { ...step, state: receipt!.state } : step);
    const done = await runWalletSteps(wallet, EXPECTED, 'mint', resolved, () => {}, fast);
    assert.deepEqual(done.map((step) => step.state), ['MINED', 'MINED', 'MINED']);
    assert.equal(wallet.sent.length, 3);
    await runWalletSteps(wallet, EXPECTED, 'mint', done, () => {}, fast);
    assert.equal(wallet.sent.length, 3, 'a completed preparation must not be submitted twice');
  });

  it('does not infer that a missing wallet response means nothing was broadcast', async () => {
    const wallet = new Wallet();
    wallet.sendError = new Error('connection interrupted after submission');
    const uncertain = await runWalletSteps(wallet, EXPECTED, 'claimB', waiting(callsForPositionAction('claimB', SERIES)), () => {}, fast);
    assert.equal(uncertain[0]!.state, 'UNCERTAIN');
    wallet.sendError = null;
    await runWalletSteps(wallet, EXPECTED, 'claimB', uncertain, () => {}, fast);
    assert.equal(wallet.sent.length, 1);
    await assert.rejects(checkWalletTransaction(wallet, { ...EXPECTED, action: 'claimB', hash: null }), /inspect the wallet activity/);
  });

  it('does not automatically retry a user rejection or an on-chain revert', async () => {
    for (const rejected of [true, false]) {
      const wallet = new Wallet();
      if (rejected) wallet.sendError = { code: 4001, message: 'Rejected' };
      else wallet.receipt = { ...mined, status: '0x0' };
      const stopped = await runWalletSteps(wallet, EXPECTED, 'mint', waiting(mintCalls()), () => {}, fast);
      assert.equal(stopped[0]!.state, rejected ? 'REFUSED' : 'REVERTED');
      await runWalletSteps(wallet, EXPECTED, 'mint', stopped, () => {}, fast);
      assert.equal(wallet.sent.length, 1);
    }
  });

  it('does not send if the unresolved-state checkpoint cannot be saved before the wallet call', async () => {
    const wallet = new Wallet();
    await assert.rejects(runWalletSteps(wallet, EXPECTED, 'claimB', waiting(callsForPositionAction('claimB', SERIES)), () => { throw new Error('storage unavailable'); }, fast), /storage unavailable/);
    assert.equal(wallet.sent.length, 0);
  });

  it('refuses to check a known hash on a different chain and retains unread receipt outcomes', async () => {
    const wallet = new Wallet();
    const marker = { ...EXPECTED, action: 'claimB' as const, hash: HASH };
    wallet.chain = '0xa';
    await assert.rejects(checkWalletTransaction(wallet, marker), /switch to chain 1/);
    wallet.chain = '0x1';
    wallet.receipt = { status: '0x1' };
    await assert.rejects(checkWalletTransaction(wallet, marker), /outcome is still unknown/);
    assert.equal(wallet.sent.length, 0);
  });

  it('restores only validated unresolved metadata; no prepared transaction bytes are recovered for signing', () => {
    const marker = { ...EXPECTED, action: 'claimB', hash: HASH };
    assert.deepEqual(parsePendingWalletTransaction(JSON.stringify({ ...marker, calls: mintCalls() })), marker);
    assert.deepEqual(parsePendingWalletTransaction(JSON.stringify({ ...marker, hash: null })), { ...marker, hash: null });
    for (const value of ['{', 'null', '{}', JSON.stringify({ ...marker, chainId: -1 }), JSON.stringify({ ...marker, hash: '0x1234' }), JSON.stringify({ ...marker, account: 'bad' })]) assert.equal(parsePendingWalletTransaction(value), null);
  });
});
