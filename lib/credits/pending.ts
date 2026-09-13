import type { Reading } from '../doctrine/reading.ts';
import type { SnapshotRecord } from '../store/types.ts';
import { INDEX_KEY, type CreditsIndexState } from './indexer.ts';

/** A successful store query with no index row is not a completed index with no pending payments. */
export type PendingState = 'READ' | 'UNREAD' | 'NOT_INDEXED' | 'NOT_REQUESTED';

export function pendingIndex(read: Reading<readonly SnapshotRecord[]> | null): {
  state: PendingState;
  index: CreditsIndexState | null;
  fault: string | null;
} {
  if (read === null) return { state: 'NOT_REQUESTED', index: null, fault: null };
  if (read.state === 'UNREAD') return { state: 'UNREAD', index: null, fault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const row = read.value.find((r) => r.key === INDEX_KEY);
  if (!row) return { state: 'NOT_INDEXED', index: null, fault: null };
  const index = row.payload as unknown as CreditsIndexState;
  if (!Array.isArray(index.unpriced) || !Number.isSafeInteger(index.cursor) || index.cursor < -1 || index.unpriced.some((u) => !u || typeof u.keyHash !== 'string' || typeof u.transactionHash !== 'string' || !Number.isSafeInteger(u.blockNumber) || typeof u.amount !== 'string' || !/^\d+$/.test(u.amount))) {
    return { state: 'UNREAD', index: null, fault: 'SOURCE_MALFORMED — the pending index is not a valid recorded queue' };
  }
  return { state: 'READ', index, fault: null };
}
