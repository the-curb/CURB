/**
 * The top-up indexer: every `TopUp` the credit desk emitted, priced at its
 * block and credited to its key hash.
 *
 * Idempotent on (transaction hash, log index): a top-up already on a key's
 * row is not credited twice, whatever the cursor says. Reorg-aware in the
 * same way as the series index: the hash of every indexed block is kept,
 * and a height whose hash moved is rolled back — its credits removed from
 * the keys' rows — and read again. A top-up whose block the node cannot
 * price is not credited at a guessed rate; it waits, listed, for a tick
 * that can.
 */

import { keccak256Hex } from '../chain/keccak.ts';
import { readLogWindow } from '../chain/logs.ts';
import { readBlockHash, readHead, type LogEntry, type RpcOptions } from '../chain/rpc.ts';
import { decodeAddressWord, decodeUint, words } from '../chain/abi.ts';
import { isRead, type Reading } from '../doctrine/reading.ts';
import type { Store } from '../store/types.ts';
import type { CreditsConfig } from './config.ts';
import { topUpsRow, type TopUpCredit } from './keys.ts';
import { centsForCurb, readRate, type Rate } from './rate.ts';

export const TOPUP_TOPIC = keccak256Hex('TopUp(bytes32,address,uint256)');
export const INDEX_KEY = 'credits:index';
export const REORG_DEPTH = 64;
export const MAX_BLOCKS_PER_SYNC = 20_000;
export const CREDITS_INTERVAL_SECONDS = 15 * 60;

export interface TopUpLog {
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly blockHash: string;
  readonly keyHash: string;
  readonly payer: string;
  readonly amount: string;
}

export interface CreditsIndexState {
  readonly network: string;
  readonly desk: string;
  readonly cursor: number;
  readonly blocks: readonly { readonly number: number; readonly hash: string }[];
  /** Every top-up credited, by key hash, so a rollback knows what to remove. */
  readonly applied: readonly { readonly ref: string; readonly blockNumber: number; readonly keyHash: string }[];
  /** Top-ups read but not yet priced, with the reason; tried again each sync. */
  readonly unpriced: readonly (TopUpLog & { readonly reason: string })[];
  readonly faults: readonly { readonly transactionHash: string; readonly logIndex: number; readonly detail: string }[];
  readonly updatedAt: string | null;
}

export function emptyCreditsIndex(config: CreditsConfig): CreditsIndexState {
  return { network: config.network.id, desk: config.desk, cursor: config.fromBlock - 1, blocks: [], applied: [], unpriced: [], faults: [], updatedAt: null };
}

const ref = (l: { transactionHash: string; logIndex: number }) => `${l.transactionHash.toLowerCase()}:${l.logIndex}`;

export function decodeTopUp(log: LogEntry): { ok: true; topUp: TopUpLog } | { ok: false; detail: string } | { ok: 'IGNORED' } {
  if ((log.topics[0] ?? '').toLowerCase() !== TOPUP_TOPIC) return { ok: 'IGNORED' };
  const blockNumber = Number.parseInt(log.blockNumber, 16);
  const logIndex = log.logIndex === undefined ? -1 : Number.parseInt(log.logIndex, 16);
  if (!Number.isInteger(blockNumber) || logIndex < 0 || !log.blockHash) return { ok: false, detail: 'the log carries no block hash or log index' };
  const keyHash = log.topics[1]?.toLowerCase();
  const payer = log.topics[2] === undefined ? null : decodeAddressWord(log.topics[2]);
  const amount = words(log.data)[0];
  const value = amount === undefined ? null : decodeUint(amount);
  if (!keyHash || !/^0x[0-9a-f]{64}$/.test(keyHash) || payer === null || value === null) return { ok: false, detail: 'TopUp undecodable' };
  return { ok: true, topUp: { transactionHash: log.transactionHash.toLowerCase(), logIndex, blockNumber, blockHash: log.blockHash.toLowerCase(), keyHash, payer: payer.toLowerCase(), amount: value.toString() } };
}

export async function loadCreditsIndex(store: Store, config: CreditsConfig): Promise<{ state: CreditsIndexState; storeFault: string | null }> {
  const read = await store.snapshots(INDEX_KEY);
  if (read.state === 'UNREAD') return { state: emptyCreditsIndex(config), storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const snap = read.value.find((s) => s.key === INDEX_KEY);
  if (!snap) return { state: emptyCreditsIndex(config), storeFault: null };
  const state = snap.payload as unknown as CreditsIndexState;
  // A desk that moved chain or address is a different desk; its old index is not reused.
  if (state.network !== config.network.id || state.desk !== config.desk) return { state: emptyCreditsIndex(config), storeFault: null };
  return { state, storeFault: null };
}

export interface CreditsSyncReport {
  readonly state: 'SYNCED' | 'PARTIAL' | 'HEAD_UNREAD' | 'STORE_UNREADABLE';
  readonly fromBlock: number | null;
  readonly toBlock: number | null;
  readonly head: number | null;
  readonly rolledBackFrom: number | null;
  readonly newTopUps: number;
  readonly credited: readonly { readonly keyHash: string; readonly cents: string; readonly basis: TopUpCredit['basis'] }[];
  readonly unpriced: number;
  readonly unreadRanges: readonly { fromBlock: number; toBlock: number; reason: string }[];
  readonly recorded: boolean;
  readonly detail: string | null;
}

type RateReader = (config: CreditsConfig, block: number, opts: RpcOptions, now: Date) => Promise<Reading<Rate>>;

/** Add a priced top-up to its key's row unless the row already has it. */
async function creditKey(store: Store, credit: TopUpCredit, keyHash: string, now: Date): Promise<boolean> {
  const read = await store.snapshots(topUpsRow(keyHash));
  if (read.state === 'UNREAD') return false;
  const row = read.value.find((r) => r.key === topUpsRow(keyHash));
  const existing = Array.isArray(row?.payload.topUps) ? (row.payload.topUps as TopUpCredit[]) : [];
  if (existing.some((t) => ref(t) === ref(credit))) return true;
  const topUps = [...existing, credit];
  const creditedCents = topUps.reduce((sum, t) => sum + BigInt(t.cents), 0n).toString();
  const written = await store.writeSnapshots([{ key: topUpsRow(keyHash), observedAt: now.toISOString(), payload: { hash: keyHash, creditedCents, topUps } }]);
  return written.state === 'WRITTEN';
}

/** Remove every credit at or after a height from a key's row. */
async function uncreditFrom(store: Store, keyHash: string, height: number, now: Date): Promise<void> {
  const read = await store.snapshots(topUpsRow(keyHash));
  if (read.state === 'UNREAD') return;
  const row = read.value.find((r) => r.key === topUpsRow(keyHash));
  const existing = Array.isArray(row?.payload.topUps) ? (row.payload.topUps as TopUpCredit[]) : [];
  const topUps = existing.filter((t) => t.blockNumber < height);
  if (topUps.length === existing.length) return;
  const creditedCents = topUps.reduce((sum, t) => sum + BigInt(t.cents), 0n).toString();
  await store.writeSnapshots([{ key: topUpsRow(keyHash), observedAt: now.toISOString(), payload: { hash: keyHash, creditedCents, topUps } }]);
}

export async function syncTopUps(
  store: Store,
  config: CreditsConfig,
  opts: RpcOptions,
  now: Date,
  rateReader: RateReader = readRate,
): Promise<{ index: CreditsIndexState; report: CreditsSyncReport }> {
  const loaded = await loadCreditsIndex(store, config);
  let index = loaded.state;
  const none = (state: CreditsSyncReport['state'], detail: string): { index: CreditsIndexState; report: CreditsSyncReport } => ({
    index,
    report: { state, fromBlock: null, toBlock: null, head: null, rolledBackFrom: null, newTopUps: 0, credited: [], unpriced: index.unpriced.length, unreadRanges: [], recorded: false, detail },
  });
  if (loaded.storeFault !== null) return none('STORE_UNREADABLE', loaded.storeFault);

  const head = await readHead(opts);
  if (!isRead(head)) return none('HEAD_UNREAD', `${head.reason}${head.detail ? ` — ${head.detail}` : ''}`);

  // Reorg check: the oldest kept block whose hash moved, and everything after it, is forgotten and uncredited.
  let rolledBackFrom: number | null = null;
  for (const block of [...index.blocks].sort((a, b) => a.number - b.number)) {
    const onChain = await readBlockHash(block.number, opts);
    if (!isRead(onChain)) break;
    if (onChain.value.toLowerCase() !== block.hash) {
      rolledBackFrom = block.number;
      const touched = new Set(index.applied.filter((a) => a.blockNumber >= block.number).map((a) => a.keyHash));
      for (const keyHash of touched) await uncreditFrom(store, keyHash, block.number, now);
      index = {
        ...index,
        cursor: Math.min(index.cursor, block.number - 1),
        blocks: index.blocks.filter((b) => b.number < block.number),
        applied: index.applied.filter((a) => a.blockNumber < block.number),
        unpriced: index.unpriced.filter((u) => u.blockNumber < block.number),
      };
      break;
    }
  }

  const fromBlock = index.cursor + 1;
  const toBlock = Math.min(head.value.number, fromBlock + MAX_BLOCKS_PER_SYNC - 1);
  const blocks = new Map(index.blocks.map((b) => [b.number, b.hash]));
  const faults = [...index.faults];
  const fresh: TopUpLog[] = [];
  let unreadRanges: CreditsSyncReport['unreadRanges'] = [];
  let complete = true;

  if (fromBlock <= toBlock) {
    const window = await readLogWindow(config.desk, [TOPUP_TOPIC], fromBlock, toBlock, opts);
    unreadRanges = window.unread;
    complete = window.unread.length === 0;
    const known = new Set([...index.applied.map((a) => a.ref), ...index.unpriced.map(ref), ...index.faults.map(ref)]);
    for (const log of window.logs) {
      const decoded = decodeTopUp(log);
      if (decoded.ok === 'IGNORED') continue;
      if (decoded.ok === false) {
        const key = ref({ transactionHash: log.transactionHash, logIndex: log.logIndex === undefined ? -1 : Number.parseInt(log.logIndex, 16) });
        if (!known.has(key)) faults.push({ transactionHash: log.transactionHash.toLowerCase(), logIndex: Number.parseInt(log.logIndex ?? '-1', 16), detail: decoded.detail });
        continue;
      }
      blocks.set(decoded.topUp.blockNumber, decoded.topUp.blockHash);
      if (known.has(ref(decoded.topUp))) continue;
      fresh.push(decoded.topUp);
    }
  }

  // Price and credit: the fresh top-ups and the ones still waiting, at their own block or, failing that, at the head.
  const rates = new Map<number, Reading<Rate>>();
  const rateAt = async (block: number) => {
    const held = rates.get(block);
    if (held) return held;
    const r = await rateReader(config, block, opts, now);
    rates.set(block, r);
    return r;
  };
  const credited: { keyHash: string; cents: string; basis: TopUpCredit['basis'] }[] = [];
  const applied = [...index.applied];
  const unpriced: (TopUpLog & { reason: string })[] = [];
  for (const t of [...index.unpriced, ...fresh].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)) {
    let rate = await rateAt(t.blockNumber);
    let basis: TopUpCredit['basis'] = 'TOP_UP_BLOCK';
    if (!isRead(rate)) {
      const atHead = await rateAt(head.value.number);
      if (isRead(atHead)) {
        rate = atHead;
        basis = 'HEAD_AT_INDEXING';
      }
    }
    if (!isRead(rate)) {
      unpriced.push({ ...t, reason: `${rate.reason}${rate.detail ? ` — ${rate.detail}` : ''}` });
      continue;
    }
    const cents = centsForCurb(rate.value, BigInt(t.amount)).toString();
    const credit: TopUpCredit = {
      desk: config.desk,
      transactionHash: t.transactionHash,
      logIndex: t.logIndex,
      blockNumber: t.blockNumber,
      payer: t.payer,
      amount: t.amount,
      usdPerCurb18: rate.value.usdPerCurb18,
      ratedAtBlock: rate.value.block,
      basis,
      cents,
      creditedAt: now.toISOString(),
    };
    const ok = await creditKey(store, credit, t.keyHash, now);
    if (!ok) {
      unpriced.push({ ...t, reason: 'the store did not record the credit' });
      continue;
    }
    applied.push({ ref: ref(t), blockNumber: t.blockNumber, keyHash: t.keyHash });
    credited.push({ keyHash: t.keyHash, cents, basis });
  }

  const readUpTo = fromBlock > toBlock ? index.cursor : complete ? toBlock : Math.min(...unreadRanges.map((u) => u.fromBlock)) - 1;
  const kept = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-REORG_DEPTH)
    .map(([number, hash]) => ({ number, hash }));
  index = { ...index, cursor: Math.max(index.cursor, readUpTo), blocks: kept, applied, unpriced, faults, updatedAt: now.toISOString() };
  const written = await store.writeSnapshots([{ key: INDEX_KEY, observedAt: now.toISOString(), payload: JSON.parse(JSON.stringify(index)) as Record<string, unknown> }]);

  return {
    index,
    report: {
      state: complete ? 'SYNCED' : 'PARTIAL',
      fromBlock,
      toBlock,
      head: head.value.number,
      rolledBackFrom,
      newTopUps: fresh.length,
      credited,
      unpriced: unpriced.length,
      unreadRanges,
      recorded: written.state === 'WRITTEN',
      detail: fromBlock > toBlock ? 'nothing new to read' : complete ? null : 'some ranges could not be read and will be read again',
    },
  };
}
