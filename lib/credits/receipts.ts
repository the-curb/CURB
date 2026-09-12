/**
 * The receipts: what the chain has paid into the treasury through the desk,
 * as the indexer credited it — every top-up by key hash, summed. The token
 * record promises the proceeds' budget before a launch and the receipts
 * after; this is the "after", derived from the keys' rows on every request
 * and never a second record. Key hashes are public; keys are not.
 */

import type { Store } from '../store/types.ts';
import { INDEX_KEY, type CreditsIndexState } from './indexer.ts';
import { TOPUPS_PREFIX, type TopUpCredit } from './keys.ts';

export interface Receipts {
  readonly topUps: number;
  readonly keys: number;
  /** CURB base units received by the treasury, as credited. */
  readonly curbBaseUnits: string;
  /** US cents credited across every key at the rates of the top-up blocks. */
  readonly cents: string;
  /** The desk addresses the top-ups went through — more than one after a redeployment. */
  readonly desks: readonly string[];
  readonly pricedAtOwnBlock: number;
  readonly pricedAtHead: number;
  readonly lastBlock: number | null;
  readonly lastCreditedAt: string | null;
  /** The indexer's position: the last block read, and top-ups still waiting for a rate. */
  readonly cursor: number | null;
  readonly waitingForRate: number;
  readonly storeFault: string | null;
}

export async function receipts(store: Store): Promise<Receipts> {
  const [rows, index] = await Promise.all([store.snapshots(TOPUPS_PREFIX), store.snapshots(INDEX_KEY)]);
  const empty: Receipts = { topUps: 0, keys: 0, curbBaseUnits: '0', cents: '0', desks: [], pricedAtOwnBlock: 0, pricedAtHead: 0, lastBlock: null, lastCreditedAt: null, cursor: null, waitingForRate: 0, storeFault: null };
  if (rows.state === 'UNREAD') return { ...empty, storeFault: `${rows.reason}${rows.detail ? ` — ${rows.detail}` : ''}` };
  let topUps = 0;
  let curb = 0n;
  let cents = 0n;
  let own = 0;
  let head = 0;
  let lastBlock: number | null = null;
  let lastCreditedAt: string | null = null;
  let keys = 0;
  const desks = new Set<string>();
  for (const row of rows.value) {
    const list = Array.isArray(row.payload.topUps) ? (row.payload.topUps as TopUpCredit[]) : [];
    if (list.length === 0) continue;
    keys += 1;
    for (const t of list) {
      topUps += 1;
      curb += BigInt(t.amount);
      cents += BigInt(t.cents);
      if (typeof t.desk === 'string') desks.add(t.desk);
      if (t.basis === 'HEAD_AT_INDEXING') head += 1;
      else own += 1;
      if (lastBlock === null || t.blockNumber > lastBlock) lastBlock = t.blockNumber;
      if (lastCreditedAt === null || t.creditedAt > lastCreditedAt) lastCreditedAt = t.creditedAt;
    }
  }
  const state = index.state === 'UNREAD' ? null : ((index.value.find((s) => s.key === INDEX_KEY)?.payload as unknown as CreditsIndexState | undefined) ?? null);
  return {
    topUps,
    keys,
    curbBaseUnits: curb.toString(),
    cents: cents.toString(),
    desks: [...desks].sort(),
    pricedAtOwnBlock: own,
    pricedAtHead: head,
    lastBlock,
    lastCreditedAt,
    cursor: state?.cursor ?? null,
    waitingForRate: state?.unpriced.length ?? 0,
    storeFault: null,
  };
}

export interface DayReceipts {
  readonly day: string;
  readonly topUps: number;
  readonly keys: number;
  readonly curbBaseUnits: string;
  readonly cents: string;
  readonly byBasis: { readonly TOP_UP_BLOCK: number; readonly TOP_UP_BLOCK_EVENTS: number; readonly HEAD_AT_INDEXING: number };
  readonly storeFault: string | null;
}

/** The credits of one UTC day, by the day they were credited — what the Gazette prints under the services. Key hashes are not printed. */
export async function receiptsByDay(store: Store, day: string): Promise<DayReceipts> {
  const rows = await store.snapshots(TOPUPS_PREFIX);
  const empty: DayReceipts = { day, topUps: 0, keys: 0, curbBaseUnits: '0', cents: '0', byBasis: { TOP_UP_BLOCK: 0, TOP_UP_BLOCK_EVENTS: 0, HEAD_AT_INDEXING: 0 }, storeFault: null };
  if (rows.state === 'UNREAD') return { ...empty, storeFault: `${rows.reason}${rows.detail ? ` — ${rows.detail}` : ''}` };
  let topUps = 0;
  let keys = 0;
  let curb = 0n;
  let cents = 0n;
  const byBasis = { TOP_UP_BLOCK: 0, TOP_UP_BLOCK_EVENTS: 0, HEAD_AT_INDEXING: 0 };
  for (const row of rows.value) {
    const list = Array.isArray(row.payload.topUps) ? (row.payload.topUps as TopUpCredit[]) : [];
    const today = list.filter((t) => t.creditedAt.slice(0, 10) === day);
    if (today.length === 0) continue;
    keys += 1;
    for (const t of today) {
      topUps += 1;
      curb += BigInt(t.amount);
      cents += BigInt(t.cents);
      byBasis[t.basis] += 1;
    }
  }
  return { day, topUps, keys, curbBaseUnits: curb.toString(), cents: cents.toString(), byBasis, storeFault: null };
}
