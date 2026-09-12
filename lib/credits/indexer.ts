/**
 * The top-up indexer: every `TopUp` the credit desk emitted, priced at its
 * block and credited to its key hash.
 *
 * Idempotent on (transaction hash, log index): a top-up already on a key's
 * row is not credited twice, whatever the cursor says. Reorg-aware in the
 * same way as the series index: the hash of every indexed block is kept,
 * and a height whose hash moved is rolled back — its credits removed from
 * the keys' rows — and read again. A top-up is priced at its own block:
 * by state if the node still serves it, else from the pool's own events at
 * that block; only when neither can be had is the head at indexing used,
 * and the credit says so. One that cannot be priced at all is not credited
 * at a guessed rate; it waits, listed, for a tick that can.
 */

import { keccak256Hex } from '../chain/keccak.ts';
import { readLogWindow } from '../chain/logs.ts';
import { readBlockHash, readHead, type LogEntry, type RpcOptions } from '../chain/rpc.ts';
import { decodeAddressWord, decodeUint, words } from '../chain/abi.ts';
import { isRead, type Reading } from '../doctrine/reading.ts';
import type { Store } from '../store/types.ts';
import type { CreditsConfig } from './config.ts';
import { topUpsRow, type TopUpCredit } from './keys.ts';
import { centsForCurb, readRate, readRateFromEvents, type Rate, type RateContext } from './rate.ts';

export const TOPUP_TOPIC = keccak256Hex('TopUp(bytes32,address,uint256)');
export const INDEX_KEY = 'credits:index';
/** How many block hashes are kept for the reorg check: every block that carried a top-up and every sync's last block, newest first. */
export const REORG_DEPTH = 64;
/** The node answers a 100,000-block log query with an address filter in under a second (measured on Robinhood Chain); about three hours of that chain per tick. */
export const MAX_BLOCKS_PER_SYNC = 100_000;
/**
 * How many blocks behind the head the index stops, by chain, so a block the
 * sequencer could still re-sequence is not read as final: about a minute on
 * Robinhood Chain, two epochs' worth on Ethereum, none on a local chain.
 */
export const CONFIRMATIONS_BY_CHAIN: Readonly<Record<number, number>> = { 4663: 600, 1: 12, 11155111: 12, 31337: 0 };
export const confirmationsFor = (chainId: number): number => CONFIRMATIONS_BY_CHAIN[chainId] ?? 12;
/** How long one sync may spend pricing before the rest are deferred, inside a tick that has sixty seconds for everything. */
export const SYNC_TIME_BUDGET_MS = 25_000;
/** How many top-ups one run prices at most; the rest wait for the next, so a burst cannot outrun the tick's time. */
export const MAX_TOPUPS_PER_SYNC = 50;
/** How many applied references are kept for idempotency and rollbacks; entries within MAX_BLOCKS_PER_SYNC of the last read block are always kept, and at most this many beyond. */
export const APPLIED_KEPT = 20_000;
/** How many waiting top-ups are tried again per run, after the fresh ones and least-tried first, so a few that cannot be priced never starve the rest. */
export const MAX_RETRIES_PER_SYNC = 10;
/** The reads are aged against the tick's cadence: scheduled every five minutes, in practice ten to twenty. */
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
  /** Top-ups read but not yet priced, with the reason and how often they were tried; tried again each sync, fresh ones first. */
  readonly unpriced: readonly (TopUpLog & { readonly reason: string; readonly attempts?: number })[];
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
  readonly state: 'SYNCED' | 'PARTIAL' | 'HEAD_UNREAD' | 'STORE_UNREADABLE' | 'HELD';
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

type RateReader = (config: CreditsConfig, block: number, opts: RpcOptions, now: Date, ctx: RateContext) => Promise<Reading<Rate>>;
export interface RateReaders {
  readonly byState: RateReader;
  readonly byEvents: RateReader;
}
export const RATE_READERS: RateReaders = { byState: readRate, byEvents: readRateFromEvents };

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

/** Remove every credit at or after a height from a key's row. False when the store would not let it be done, so the rollback is not recorded as done. */
async function uncreditFrom(store: Store, keyHash: string, height: number, now: Date): Promise<boolean> {
  const read = await store.snapshots(topUpsRow(keyHash));
  if (read.state === 'UNREAD') return false;
  const row = read.value.find((r) => r.key === topUpsRow(keyHash));
  const existing = Array.isArray(row?.payload.topUps) ? (row.payload.topUps as TopUpCredit[]) : [];
  const topUps = existing.filter((t) => t.blockNumber < height);
  if (topUps.length === existing.length) return true;
  const creditedCents = topUps.reduce((sum, t) => sum + BigInt(t.cents), 0n).toString();
  const written = await store.writeSnapshots([{ key: topUpsRow(keyHash), observedAt: now.toISOString(), payload: { hash: keyHash, creditedCents, topUps } }]);
  return written.state === 'WRITTEN';
}

/**
 * Only a top-up mined before the pool was created — the record's
 * priceSource.fromBlock, read from the chain — goes to the head's rate.
 * A pool with no event found before the block is waited out, like a node
 * that did not answer: a quiet pool is not an absent one.
 */
const poolAbsentAtBlock = (r: Reading<Rate>): boolean => r.state === 'UNREAD' && r.reason === 'FIELD_ABSENT' && /^the pool was created in block/.test(r.detail ?? '');

export async function syncTopUps(
  store: Store,
  config: CreditsConfig,
  opts: RpcOptions,
  now: Date,
  readers: RateReaders = RATE_READERS,
  deadline: number = Date.now() + SYNC_TIME_BUDGET_MS,
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

  // Reorg check, newest kept block first: a kept block whose hash still
  // stands has every older kept block standing beneath it, so the usual
  // tick makes one read. The oldest moved block, and everything after it,
  // is forgotten and uncredited; if the store would not take a rollback,
  // nothing is forgotten and the check runs again next tick.
  let rolledBackFrom: number | null = null;
  const kept = [...index.blocks].sort((a, b) => b.number - a.number);
  let oldestMoved: number | null = null;
  for (const block of kept) {
    const onChain = await readBlockHash(block.number, opts);
    // A kept block that cannot be read is not a kept block that stands: nothing is read past it until it can be.
    if (!isRead(onChain)) return none('HEAD_UNREAD', `kept block ${block.number} could not be read for the reorg check (${onChain.reason}${onChain.detail ? ` — ${onChain.detail}` : ''}); nothing is read until it can be`);
    if (onChain.value.toLowerCase() === block.hash) break;
    oldestMoved = block.number;
  }
  if (oldestMoved !== null) {
    const touched = new Set(index.applied.filter((a) => a.blockNumber >= oldestMoved).map((a) => a.keyHash));
    let undone = true;
    for (const keyHash of touched) undone = (await uncreditFrom(store, keyHash, oldestMoved, now)) && undone;
    if (!undone) return none('STORE_UNREADABLE', `block ${oldestMoved} was reorganised but the store would not take the rollback; nothing is forgotten until it does`);
    rolledBackFrom = oldestMoved;
    index = {
      ...index,
      cursor: Math.min(index.cursor, oldestMoved - 1),
      blocks: index.blocks.filter((b) => b.number < oldestMoved),
      applied: index.applied.filter((a) => a.blockNumber < oldestMoved),
      unpriced: index.unpriced.filter((u) => u.blockNumber < oldestMoved),
    };
  }

  const fromBlock = index.cursor + 1;
  const confirmedHead = head.value.number - confirmationsFor(config.network.chainId);
  const toBlock = Math.min(confirmedHead, fromBlock + MAX_BLOCKS_PER_SYNC - 1);
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

  // The last block of this sync is kept too, so a reorganisation that
  // touched no top-up block is still seen and read again from there. A tip
  // whose hash cannot be read is not passed: the cursor stops before it.
  if (fromBlock <= toBlock && complete) {
    const tip = await readBlockHash(toBlock, opts);
    if (isRead(tip)) blocks.set(toBlock, tip.value.toLowerCase());
    else {
      complete = false;
      unreadRanges = [...unreadRanges, { fromBlock: toBlock, toBlock, reason: `the block's hash could not be read (${tip.reason}${tip.detail ? ` — ${tip.detail}` : ''})` }];
    }
  }

  // Price and credit: the fresh top-ups and the ones still waiting — at their
  // own block by state, else at their own block by the pool's events; at the
  // head only when the pool had no event before the block, which is a pool
  // that did not exist then. A node that did not answer is waited out, not
  // priced around. Each read is made once per block per run, and at most
  // MAX_TOPUPS_PER_SYNC top-ups are priced per run.
  const byState = new Map<number, Reading<Rate>>();
  const byEvents = new Map<number, Reading<Rate>>();
  const ctx: RateContext = {};
  const rateAt = async (block: number, how: 'STATE' | 'EVENTS') => {
    const cache = how === 'STATE' ? byState : byEvents;
    const held = cache.get(block);
    if (held) return held;
    const r = await (how === 'STATE' ? readers.byState : readers.byEvents)(config, block, opts, now, ctx);
    cache.set(block, r);
    return r;
  };
  const credited: { keyHash: string; cents: string; basis: TopUpCredit['basis'] }[] = [];
  const applied = [...index.applied];
  const unpriced: (TopUpLog & { reason: string; attempts?: number })[] = [];
  // Fresh top-ups first, in chain order; then the ones still waiting, the
  // least-tried first and in chain order among equals, a few per run — so
  // what cannot be priced never starves what can, and one that can never be
  // priced falls to the back of the line rather than holding the slots.
  const order = (a: TopUpLog, b: TopUpLog) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex;
  const leastTried = (a: { attempts?: number } & TopUpLog, b: { attempts?: number } & TopUpLog) => (a.attempts ?? 0) - (b.attempts ?? 0) || order(a, b);
  const queue: (TopUpLog & { reason?: string; attempts?: number })[] = [...fresh.sort(order), ...[...index.unpriced].sort(leastTried)];
  let priced = 0;
  let retried = 0;
  for (const t of queue) {
    const waiting = t.reason !== undefined;
    const attempts = (t.attempts ?? 0) + 1;
    if (priced >= MAX_TOPUPS_PER_SYNC) {
      unpriced.push({ ...t, reason: `deferred: ${MAX_TOPUPS_PER_SYNC} top-ups were priced this run; this one is next`, attempts: t.attempts ?? 0 });
      continue;
    }
    if (waiting && retried >= MAX_RETRIES_PER_SYNC) {
      unpriced.push({ ...t, reason: t.reason!, attempts: t.attempts ?? 0 });
      continue;
    }
    if (Date.now() > deadline) {
      unpriced.push({ ...t, reason: 'deferred: the run\'s time for pricing was used; this one is next', attempts: t.attempts ?? 0 });
      continue;
    }
    priced += 1;
    if (waiting) retried += 1;
    let rate = await rateAt(t.blockNumber, 'STATE');
    let basis: TopUpCredit['basis'] = 'TOP_UP_BLOCK';
    const reasons: string[] = [];
    if (!isRead(rate)) {
      reasons.push(`by state: ${rate.reason}${rate.detail ? ` — ${rate.detail}` : ''}`);
      rate = await rateAt(t.blockNumber, 'EVENTS');
      basis = 'TOP_UP_BLOCK_EVENTS';
    }
    if (!isRead(rate) && poolAbsentAtBlock(rate)) {
      reasons.push(`by events: ${rate.detail}`);
      rate = await rateAt(head.value.number, 'STATE');
      basis = 'HEAD_AT_INDEXING';
    }
    if (!isRead(rate)) {
      reasons.push(`${basis === 'HEAD_AT_INDEXING' ? 'at the head' : 'by events'}: ${rate.reason}${rate.detail ? ` — ${rate.detail}` : ''}`);
      unpriced.push({ ...t, reason: `waits (tried ${attempts}): ${reasons.join('; ')}`, attempts });
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
      unpriced.push({ ...t, reason: `the store did not record the credit (tried ${attempts})`, attempts });
      continue;
    }
    applied.push({ ref: ref(t), blockNumber: t.blockNumber, keyHash: t.keyHash });
    credited.push({ keyHash: t.keyHash, cents, basis });
  }

  const readUpTo = fromBlock > toBlock ? index.cursor : complete ? toBlock : Math.min(...unreadRanges.map((u) => u.fromBlock)) - 1;
  const keptBlocks = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-REORG_DEPTH)
    .map(([number, hash]) => ({ number, hash }));
  // Applied references within a sync's width of the cursor are always kept for a rollback; beyond that, the newest APPLIED_KEPT.
  const cursorNow = Math.max(index.cursor, readUpTo);
  const keptApplied = applied.filter((a) => a.blockNumber >= cursorNow - MAX_BLOCKS_PER_SYNC);
  const olderApplied = applied.filter((a) => a.blockNumber < cursorNow - MAX_BLOCKS_PER_SYNC).slice(-APPLIED_KEPT);
  index = { ...index, cursor: cursorNow, blocks: keptBlocks, applied: [...olderApplied, ...keptApplied], unpriced, faults, updatedAt: now.toISOString() };
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
