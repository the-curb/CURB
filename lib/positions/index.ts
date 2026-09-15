/**
 * The chain index of a series: every event the contract emitted, in order,
 * kept so the database can be thrown away and rebuilt from the chain.
 *
 * Idempotent on (chain id, transaction hash, log index): the same log
 * applied twice is applied once. Reorg-aware: the hash of every indexed
 * block is kept, and before reading further the chain is asked for the hash
 * at the heights already indexed; a height whose hash moved is rolled back
 * with everything after it, and read again. The index is a view for the
 * interface. The ledger it reduces to is the contract's, replayed — never a
 * second source of liability that could outrank the chain.
 */

import { readBlockHash, readHead, type LogEntry, type RpcOptions } from '../chain/rpc.ts';
import { readLogWindow } from '../chain/logs.ts';
import { isRead } from '../doctrine/reading.ts';
import type { SnapshotRecord, Store } from '../store/types.ts';
import type { SeriesDeployment } from './deployments.ts';
import { decodeSeriesEvent, type IndexedEvent, type SeriesEvent } from './events.ts';
import { allocateExit, claim, mint, openSeries, setClaimPaused, setMintPaused, type LedgerState, type Units } from './ledger.ts';

/** How many indexed block hashes are kept for reorg checks. */
export const REORG_DEPTH = 64;
/** The most blocks read per sync, so one tick never tries to catch up a year. */
export const MAX_BLOCKS_PER_SYNC = 20_000;
/** The reads are aged against the tick's cadence. */
export const INDEX_INTERVAL_SECONDS = 15 * 60;

export interface IndexState {
  readonly chainId: number;
  readonly series: string;
  /** The last block fully indexed, or fromBlock − 1 before the first sync. */
  readonly cursor: number;
  /** Recent block hashes by height, for reorg detection. */
  readonly blocks: readonly { readonly number: number; readonly hash: string }[];
  readonly events: readonly IndexedEvent[];
  /** Logs that could not be decoded, kept with their reason rather than dropped. */
  readonly faults: readonly { readonly transactionHash: string; readonly logIndex: number; readonly blockNumber: number; readonly detail: string }[];
  readonly updatedAt: string | null;
  /** The shape this index was built with (INDEX_VERSION); absent on one a previous build wrote. */
  readonly version?: number;
}

export function emptyIndex(deployment: SeriesDeployment): IndexState {
  return { chainId: deployment.chainId, series: deployment.address, cursor: deployment.fromBlock - 1, blocks: [], events: [], faults: [], updatedAt: null, version: INDEX_VERSION };
}

const eventKey = (e: { transactionHash: string; logIndex: number }) => `${e.transactionHash.toLowerCase()}:${e.logIndex}`;

/** Apply logs from the chain. A log already present is not applied twice; order is by block then log index. */
export function applyLogs(state: IndexState, logs: readonly LogEntry[], now: Date): IndexState {
  const seen = new Set(state.events.map(eventKey));
  const seenFaults = new Set(state.faults.map(eventKey));
  const events = [...state.events];
  const faults = [...state.faults];
  const blocks = new Map(state.blocks.map((b) => [b.number, b.hash]));

  for (const log of logs) {
    const blockNumber = Number.parseInt(log.blockNumber, 16);
    const logIndex = log.logIndex === undefined ? -1 : Number.parseInt(log.logIndex, 16);
    const blockHash = (log.blockHash ?? '').toLowerCase();
    if (!Number.isInteger(blockNumber) || logIndex < 0 || blockHash === '') {
      faults.push({ transactionHash: log.transactionHash, logIndex: Math.max(logIndex, 0), blockNumber: Number.isInteger(blockNumber) ? blockNumber : -1, detail: 'the log carries no block hash or log index — the node did not identify it' });
      continue;
    }
    const key = eventKey({ transactionHash: log.transactionHash, logIndex });
    if (seen.has(key) || seenFaults.has(key)) continue;
    blocks.set(blockNumber, blockHash);
    const decoded = decodeSeriesEvent(log);
    if (decoded.ok === 'IGNORED') continue;
    if (decoded.ok === false) {
      faults.push({ transactionHash: log.transactionHash.toLowerCase(), logIndex, blockNumber, detail: decoded.detail });
      seenFaults.add(key);
      continue;
    }
    events.push({ chainId: state.chainId, series: state.series, blockNumber, blockHash, transactionHash: log.transactionHash.toLowerCase(), logIndex, event: decoded.event });
    seen.add(key);
  }

  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const kept = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-REORG_DEPTH)
    .map(([number, hash]) => ({ number, hash }));
  return { ...state, events, faults, blocks: kept, updatedAt: now.toISOString() };
}

/** Forget every event and block at or after a height. The cursor moves back so they are read again. */
export function rollbackFrom(state: IndexState, height: number): IndexState {
  return {
    ...state,
    cursor: Math.min(state.cursor, height - 1),
    blocks: state.blocks.filter((b) => b.number < height),
    events: state.events.filter((e) => e.blockNumber < height),
    faults: state.faults.filter((f) => f.blockNumber < height),
  };
}

/**
 * The ledger the events imply, replayed through the same functions the
 * simulation and the tests use. An event the ledger refuses is a
 * disagreement between this model and the contract, and is reported as
 * such rather than forced.
 */
export function reduceLedger(state: IndexState, q: Units, capLots: bigint): { ledger: LedgerState; disagreements: readonly string[] } {
  let ledger = openSeries(q, capLots);
  const disagreements: string[] = [];
  const note = (e: IndexedEvent, text: string) => disagreements.push(`${e.transactionHash}:${e.logIndex} ${e.event.name}: ${text}`);
  for (const indexed of state.events) {
    const ev: SeriesEvent = indexed.event;
    switch (ev.name) {
      case 'PositionMinted': {
        if (ev.unitsA !== ev.lots * q.A || ev.unitsB !== ev.lots * q.B) note(indexed, 'units do not equal lots × q');
        const r = mint({ ...ledger, mintPaused: false, transferable: { A: true, B: true } }, ev.holder, ev.lots);
        if (r.ok) ledger = { ...r.state, mintPaused: ledger.mintPaused, transferable: ledger.transferable };
        else note(indexed, `${r.reason}: ${r.detail}`);
        break;
      }
      case 'ExitAllocated': {
        const r = allocateExit(ledger, ev.holder, ev.lots);
        if (r.ok) ledger = r.state;
        else note(indexed, `${r.reason}: ${r.detail}`);
        break;
      }
      case 'ComponentClaimed': {
        const r = claim({ ...ledger, claimPaused: { A: false, B: false }, transferable: { A: true, B: true } }, ev.holder, ev.component);
        if (r.ok) ledger = { ...r.state, claimPaused: ledger.claimPaused, transferable: ledger.transferable };
        else note(indexed, `${r.reason}: ${r.detail}`);
        break;
      }
      case 'MintStatusChanged':
        ledger = setMintPaused(ledger, ev.paused);
        break;
      case 'ComponentClaimStatusChanged':
        ledger = setClaimPaused(ledger, ev.component, ev.paused);
        break;
      case 'MintPermitSet':
      case 'ClaimPermitSet':
      case 'OperatorChanged':
      case 'OperatorTransferProposed':
      case 'OperatorTransferCancelled':
        // The operator's actions: not ledger movements; read out by operatorLog().
        break;
    }
  }
  return { ledger, disagreements };
}

export interface OperatorLog {
  /** The operator as the chain last said (the latest OperatorChanged), or null when no change was seen. */
  readonly operator: string | null;
  /** A proposal grants no operator authority until OperatorChanged records acceptance. */
  readonly pendingOperator: string | null;
  readonly nominations: readonly { readonly blockNumber: number; readonly transactionHash: string; readonly current: string; readonly nominee: string; readonly action: 'PROPOSED' | 'CANCELLED' }[];
  readonly changes: readonly { readonly blockNumber: number; readonly transactionHash: string; readonly previous: string; readonly next: string }[];
  /** Mint permits by holder, as last set: the unix time they run until (0 means revoked), and whether that is still ahead of now. */
  readonly mintPermits: readonly { readonly holder: string; readonly until: string; readonly live: boolean; readonly blockNumber: number; readonly transactionHash: string }[];
  readonly claimPermits: readonly { readonly holder: string; readonly permitted: boolean; readonly blockNumber: number; readonly transactionHash: string }[];
  /** Every pause and resume, with the reason given on chain. */
  readonly stops: readonly { readonly blockNumber: number; readonly transactionHash: string; readonly what: string; readonly paused: boolean; readonly reason: string }[];
}

/**
 * The operator's actions on a series as the chain recorded them — permits
 * granted and revoked, stops and resumes with their reasons, the operator
 * changing hands. The policy asks for every operator transaction logged;
 * this is that log, derived from the events rather than kept by hand.
 */
export function operatorLog(state: IndexState, now: Date = new Date()): OperatorLog {
  const changes: OperatorLog['changes'][number][] = [];
  const nominations: OperatorLog['nominations'][number][] = [];
  let pendingOperator: string | null = null;
  const mint = new Map<string, OperatorLog['mintPermits'][number]>();
  const claim = new Map<string, OperatorLog['claimPermits'][number]>();
  const stops: OperatorLog['stops'][number][] = [];
  for (const e of state.events) {
    const at = { blockNumber: e.blockNumber, transactionHash: e.transactionHash };
    switch (e.event.name) {
      case 'OperatorChanged':
        changes.push({ ...at, previous: e.event.previous, next: e.event.next });
        pendingOperator = null;
        break;
      case 'OperatorTransferProposed':
        pendingOperator = e.event.proposed;
        nominations.push({ ...at, current: e.event.current, nominee: e.event.proposed, action: 'PROPOSED' });
        break;
      case 'OperatorTransferCancelled':
        pendingOperator = null;
        nominations.push({ ...at, current: e.event.current, nominee: e.event.cancelled, action: 'CANCELLED' });
        break;
      case 'MintPermitSet':
        mint.set(e.event.holder, { ...at, holder: e.event.holder, until: e.event.until.toString(), live: e.event.until > BigInt(Math.floor(now.getTime() / 1000)) });
        break;
      case 'ClaimPermitSet':
        claim.set(e.event.holder, { ...at, holder: e.event.holder, permitted: e.event.permitted });
        break;
      case 'MintStatusChanged':
        stops.push({ ...at, what: 'mint', paused: e.event.paused, reason: e.event.reason });
        break;
      case 'ComponentClaimStatusChanged':
        stops.push({ ...at, what: `claim ${e.event.component}`, paused: e.event.paused, reason: e.event.reason });
        break;
      default:
        break;
    }
  }
  return { operator: changes.at(-1)?.next ?? null, pendingOperator, nominations, changes, mintPermits: [...mint.values()], claimPermits: [...claim.values()], stops };
}

const INDEX_KEY = (seriesId: string) => `positions:index:${seriesId}`;

function serialise(state: IndexState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v))) as Record<string, unknown>;
}

const BIGINT_FIELDS = new Set(['lots', 'unitsA', 'unitsB', 'units', 'until']);

/**
 * The shape of the index this build writes. An index a previous build wrote
 * (no version, or an older one) was built without the events this build
 * reads — the operator's permits, and since version 3 the operator transfer
 * nomination and its cancellation — and its cursor has passed the blocks
 * they are in, so it is not carried forward: it is read again from the
 * deployment's first block, which costs one sync and loses nothing.
 */
export const INDEX_VERSION = 3;

function revive(payload: Record<string, unknown>): IndexState {
  // Only the fields that are amounts are revived; a reason string that happens to look like one stays a string.
  return JSON.parse(JSON.stringify(payload), (k, v) => (BIGINT_FIELDS.has(k) && typeof v === 'string' && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as IndexState;
}

export async function loadIndex(store: Store, seriesId: string, deployment: SeriesDeployment): Promise<{ state: IndexState; storeFault: string | null }> {
  const read = await store.snapshots(INDEX_KEY(seriesId));
  if (read.state === 'UNREAD') return { state: emptyIndex(deployment), storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const snap = read.value.find((s) => s.key === INDEX_KEY(seriesId));
  if (!snap) return { state: emptyIndex(deployment), storeFault: null };
  const state = revive(snap.payload as Record<string, unknown>);
  // A deployment that moved chain or address is a different series; its old index is not reused.
  if (state.chainId !== deployment.chainId || state.series !== deployment.address) return { state: emptyIndex(deployment), storeFault: null };
  // An index a previous build wrote was read without the events this build reads: it is read again from the start.
  if ((state.version ?? 1) < INDEX_VERSION) return { state: emptyIndex(deployment), storeFault: null };
  return { state, storeFault: null };
}

export interface SyncReport {
  readonly state: 'SYNCED' | 'HEAD_UNREAD' | 'STORE_UNREADABLE' | 'PARTIAL';
  readonly fromBlock: number | null;
  readonly toBlock: number | null;
  readonly head: number | null;
  readonly rolledBackFrom: number | null;
  readonly newEvents: number;
  readonly unreadRanges: readonly { fromBlock: number; toBlock: number; reason: string }[];
  readonly recorded: boolean;
  readonly detail: string | null;
}

/** Read the chain from the cursor to the head, after checking the indexed blocks are still the chain's. */
export async function syncIndex(store: Store, seriesId: string, deployment: SeriesDeployment, opts: RpcOptions, now: Date): Promise<{ index: IndexState; report: SyncReport }> {
  const loaded = await loadIndex(store, seriesId, deployment);
  let index = loaded.state;
  if (loaded.storeFault !== null) {
    return { index, report: { state: 'STORE_UNREADABLE', fromBlock: null, toBlock: null, head: null, rolledBackFrom: null, newEvents: 0, unreadRanges: [], recorded: false, detail: loaded.storeFault } };
  }

  const head = await readHead(opts);
  if (!isRead(head)) {
    return { index, report: { state: 'HEAD_UNREAD', fromBlock: null, toBlock: null, head: null, rolledBackFrom: null, newEvents: 0, unreadRanges: [], recorded: false, detail: `${head.reason}${head.detail ? ` — ${head.detail}` : ''}` } };
  }

  // Reorg check: the oldest kept block whose hash moved, and everything after it, is forgotten.
  let rolledBackFrom: number | null = null;
  for (const block of [...index.blocks].sort((a, b) => a.number - b.number)) {
    const onChain = await readBlockHash(block.number, opts);
    if (!isRead(onChain)) break; // an unreadable hash is not evidence of a reorg; leave the index as it is
    if (onChain.value !== block.hash) {
      rolledBackFrom = block.number;
      index = rollbackFrom(index, block.number);
      break;
    }
  }

  const fromBlock = index.cursor + 1;
  const toBlock = Math.min(head.value.number, fromBlock + MAX_BLOCKS_PER_SYNC - 1);
  if (fromBlock > toBlock) {
    const written = await store.writeSnapshots([{ key: INDEX_KEY(seriesId), observedAt: now.toISOString(), payload: serialise({ ...index, updatedAt: now.toISOString() }) }]);
    return { index, report: { state: 'SYNCED', fromBlock, toBlock, head: head.value.number, rolledBackFrom, newEvents: 0, unreadRanges: [], recorded: written.state === 'WRITTEN', detail: 'nothing new to read' } };
  }

  // Every log the contract emits is ours; the decoder sets aside any topic it does not know.
  const window = await readLogWindow(deployment.address, [], fromBlock, toBlock, opts);
  const before = index.events.length;
  index = applyLogs(index, window.logs, now);
  const complete = window.unread.length === 0;
  // The cursor advances only over ranges that were actually read; an unread range is read again next time.
  const readUpTo = complete ? toBlock : Math.min(...window.unread.map((u) => u.fromBlock)) - 1;
  index = { ...index, cursor: Math.max(index.cursor, readUpTo) };

  const record: SnapshotRecord = { key: INDEX_KEY(seriesId), observedAt: now.toISOString(), payload: serialise(index) };
  const written = await store.writeSnapshots([record]);
  return {
    index,
    report: {
      state: complete ? 'SYNCED' : 'PARTIAL',
      fromBlock,
      toBlock,
      head: head.value.number,
      rolledBackFrom,
      newEvents: index.events.length - before,
      unreadRanges: window.unread,
      recorded: written.state === 'WRITTEN',
      detail: complete ? null : 'some ranges could not be read and will be read again',
    },
  };
}
