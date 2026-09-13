import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { unread } from '../lib/doctrine/reading.ts';
import { INDEX_KEY } from '../lib/credits/indexer.ts';
import { charge, keyAccount, keyHashOf, newKey, spendRow, topUpsRow, TOPUPS_PREFIX } from '../lib/credits/keys.ts';
import { receipts } from '../lib/credits/receipts.ts';
import type { SnapshotRecord, Store } from '../lib/store/types.ts';

const NOW = new Date('2026-09-13T12:00:00Z');
const HASH = keyHashOf(newKey());
const TX = '0x' + '1'.repeat(64);
const credit = { transactionHash: TX, logIndex: 0, blockNumber: 40, payer: '0x' + '2'.repeat(40), amount: '100', usdPerCurb18: '2000000000000000000', ratedAtBlock: 40, basis: 'TOP_UP_BLOCK', cents: '2000', creditedAt: NOW.toISOString() };
const row = (key: string, payload: Record<string, unknown>): SnapshotRecord => ({ key, payload, observedAt: NOW.toISOString() });
const totals = () => [row(topUpsRow(HASH), { hash: HASH, creditedCents: '2000', topUps: [credit] }), row(spendRow(HASH), { hash: HASH, spentCents: '5', count: 1, charges: [] })];
const queue = () => row(INDEX_KEY, { cursor: 50, unpriced: [{ ...credit, keyHash: HASH, reason: 'no rate at block' }] });
function storeFor(rows: SnapshotRecord[], faults: string[] = []) {
  const calls: string[] = [];
  const store = new Proxy({}, { get: (_target, name) => {
    if (name === 'snapshots') return async (prefix: string) => {
      calls.push(prefix);
      return faults.includes(prefix) ? unread('SOURCE_UNREACHABLE', { detail: 'isolated failed read', now: NOW })
        : { state: 'VERIFIED', value: rows.filter((r) => r.key.startsWith(prefix)), source: 'isolated store', retrievedAt: NOW.toISOString(), ageSeconds: 0 };
    };
    if (name === 'writeSnapshotIf') return async (next: SnapshotRecord) => {
      const at = rows.findIndex((r) => r.key === next.key);
      if (at === -1) rows.push(next); else rows[at] = next;
      return { state: 'WRITTEN' };
    };
    return () => { throw new Error(`unexpected operation ${String(name)}`); };
  } }) as Store;
  return { store, calls };
}

describe('credited amounts and the pending index are independent readings', () => {
  it('retains real credited receipts and balance when only the index fails, without inventing zero pending', async () => {
    const { store } = storeFor([...totals(), queue()], [INDEX_KEY]);
    const paid = await receipts(store);
    assert.equal(paid.receiptsState, 'READ'); assert.equal(paid.cents, '2000'); assert.equal(paid.topUps, 1); assert.equal(paid.storeFault, null);
    assert.equal(paid.pendingState, 'UNREAD'); assert.equal(paid.waitingForRate, null); assert.equal(paid.cursor, null); assert.match(paid.pendingFault!, /isolated failed read/);
    const account = await keyAccount(store, HASH);
    assert.equal(account.balanceState, 'READ'); assert.equal(account.balanceCents, '1995'); assert.equal(account.status, 'OPEN'); assert.equal(account.storeFault, null);
    assert.equal(account.pendingState, 'UNREAD'); assert.equal(account.pending, null); assert.match(account.pendingFault!, /isolated failed read/);
  });

  it('distinguishes no index yet, a successfully read empty queue, and a known pending payment', async () => {
    const { store } = storeFor(totals());
    assert.equal((await receipts(store)).pendingState, 'NOT_INDEXED'); assert.equal((await receipts(store)).waitingForRate, null);
    assert.equal((await keyAccount(store, HASH)).pendingState, 'NOT_INDEXED'); assert.equal((await keyAccount(store, HASH)).pending, null);
    const empty = storeFor([...totals(), row(INDEX_KEY, { cursor: 50, unpriced: [] })]).store;
    assert.equal((await receipts(empty)).waitingForRate, 0); assert.equal((await receipts(empty)).pendingState, 'READ'); assert.deepEqual((await keyAccount(empty, HASH)).pending, []);
    const waiting = storeFor([...totals(), queue()]).store;
    assert.equal((await receipts(waiting)).waitingForRate, 1); assert.equal((await keyAccount(waiting, HASH)).pending?.[0]?.transactionHash, TX);
  });

  it('does not convert a malformed queue into an empty one', async () => {
    const { store } = storeFor([...totals(), row(INDEX_KEY, { cursor: 50, unpriced: { not: 'a queue' } })]);
    assert.equal((await receipts(store)).pendingState, 'UNREAD'); assert.equal((await receipts(store)).waitingForRate, null);
    assert.equal((await keyAccount(store, HASH)).pending, null); assert.match((await keyAccount(store, HASH)).pendingFault!, /SOURCE_MALFORMED/);
  });

  it('marks pending:false as NOT_REQUESTED without reading the index and still charges a funded key', async () => {
    const { store, calls } = storeFor(totals(), [INDEX_KEY]);
    const account = await keyAccount(store, HASH, { pending: false });
    assert.equal(account.pendingState, 'NOT_REQUESTED'); assert.equal(account.pending, null); assert.equal(account.pendingFault, null); assert.equal(account.storeFault, null);
    const charged = await charge(store, HASH, 'journal-day', 5, 'isolated paid call', NOW);
    assert.equal(charged.ok, true); assert.equal(charged.account.balanceCents, '1990'); assert.equal(calls.includes(INDEX_KEY), false);
  });

  it('preserves the independent pending result when balance or receipt rows fail', async () => {
    const { store } = storeFor([...totals(), queue()], [topUpsRow(HASH), TOPUPS_PREFIX]);
    const paid = await receipts(store);
    assert.equal(paid.receiptsState, 'UNREAD'); assert.notEqual(paid.storeFault, null); assert.equal(paid.pendingState, 'READ'); assert.equal(paid.waitingForRate, 1);
    const account = await keyAccount(store, HASH);
    assert.equal(account.balanceState, 'UNREAD'); assert.notEqual(account.storeFault, null); assert.equal(account.pendingState, 'READ'); assert.equal(account.pending?.length, 1);
  });
});
