/**
 * The credit desk's share of the tick: the rate at the head, recorded with
 * its block or its reason; the desk's code against the committed build;
 * the top-ups since the cursor, priced and credited — unless the desk's
 * code is not the record's, in which case nothing is credited from it; the
 * alert transition, if there was one, fanned out to the subscribers who
 * can pay. One summary row (`credits:run`) says how each part ended, for
 * the conditions to read. NOT_CONFIGURED is reported, not silent — the
 * services page reads the same status and says the same thing — and a
 * failure inside is reported as FAILED with its reason rather than thrown
 * up through the tick.
 */

import { readHead, type RpcOptions } from '../chain/rpc.ts';
import { isRead } from '../doctrine/reading.ts';
import type { Condition } from '../ops/alerts.ts';
import type { SnapshotRecord, Store } from '../store/types.ts';
import { deskCodeSnapshot, verifyDeskCode, type DeskCodeVerification } from './code.ts';
import { creditsStatus, type CreditsConfig, type CreditsStatus } from './config.ts';
import { CREDITS_INTERVAL_SECONDS, loadCreditsIndex, syncTopUps, type CreditsSyncReport } from './indexer.ts';
import { readRate, type Rate } from './rate.ts';
import { fanOut, type FanOutReport } from './subscriptions.ts';

export const RATE_KEY = 'credits:rate';
export const RUN_KEY = 'credits:run';

export type RateSnapshot =
  | { readonly state: 'READ'; readonly rate: Rate; readonly at: string }
  | { readonly state: 'UNREAD'; readonly reason: string; readonly detail: string | null; readonly at: string; readonly block: number | null };

export interface CreditsRun {
  readonly state: CreditsStatus['state'] | 'FAILED';
  readonly detail: string | null;
  readonly rate: RateSnapshot | null;
  readonly code: DeskCodeVerification | null;
  readonly index: CreditsSyncReport | null;
  readonly fanOut: FanOutReport | null;
}

/** What the conditions read: how the last run ended, in one row. */
export interface RunSummary {
  readonly at: string;
  readonly rate: 'READ' | 'UNREAD';
  readonly rateDetail: string | null;
  readonly code: DeskCodeVerification['state'];
  readonly codeDetail: string | null;
  readonly index: CreditsSyncReport['state'];
  readonly indexDetail: string | null;
  readonly waitingForRate: number;
  readonly fanOutFailed: number;
  /** Deliveries the row says were told but the charge did not land: the desk's loss, not the subscriber's. */
  readonly fanOutUncharged: number;
  /** How far the index is behind the head, in blocks; a backlog is caught up MAX_BLOCKS_PER_SYNC a tick. */
  readonly behindBlocks: number | null;
  /** False when the row was written by a run that found nothing configured — such a row raises no condition. */
  readonly configured: boolean;
}

export async function runCredits(store: Store, now: Date, conditions: readonly Condition[] | null, deadline: number = now.getTime() + 50_000): Promise<CreditsRun> {
  const status = creditsStatus();
  if (status.state !== 'CONFIGURED') {
    // A run row that says so, so a condition from an earlier configuration does not outlive it.
    await store.writeSnapshots([{ key: RUN_KEY, observedAt: now.toISOString(), payload: { at: now.toISOString(), rate: 'UNREAD', rateDetail: status.detail, code: 'NO_BUILD', codeDetail: null, index: 'HELD', indexDetail: status.detail, waitingForRate: 0, fanOutFailed: 0, fanOutUncharged: 0, behindBlocks: null, configured: false } }]);
    return { state: status.state, detail: status.detail, rate: null, code: null, index: null, fanOut: null };
  }
  const config = status.config;
  const opts: RpcOptions = { profile: config.network, intervalSeconds: CREDITS_INTERVAL_SECONDS };

  try {
    const head = await readHead(opts);
    let rate: RateSnapshot;
    if (!isRead(head)) {
      rate = { state: 'UNREAD', reason: head.reason, detail: head.detail ?? null, at: now.toISOString(), block: null };
    } else if (config.priceSource === null) {
      rate = { state: 'UNREAD', reason: 'FIELD_ABSENT', detail: 'no pool is recorded for the token; nothing is quoted until one is', at: now.toISOString(), block: head.value.number };
    } else {
      const r = await readRate(config, head.value.number, opts, now);
      rate = isRead(r) ? { state: 'READ', rate: r.value, at: now.toISOString() } : { state: 'UNREAD', reason: r.reason, detail: r.detail ?? null, at: now.toISOString(), block: head.value.number };
    }
    const code = await verifyDeskCode(config, opts, now);
    const records: SnapshotRecord[] = [{ key: RATE_KEY, observedAt: now.toISOString(), payload: { ...rate } }, deskCodeSnapshot(code)];
    await store.writeSnapshots(records);
    if (rate.state === 'READ') {
      await store.writeObservations([
        { key: 'credits:rate:usd-per-curb', observedAt: now.toISOString(), value: Number(BigInt(rate.rate.usdPerCurb18)) / 1e18, raw: rate.rate.usdPerCurb18, decimals: 18, source: rate.rate.source },
        { key: 'credits:rate:market-cap-usd', observedAt: now.toISOString(), value: Number(BigInt(rate.rate.marketCapUsd18)) / 1e18, raw: rate.rate.marketCapUsd18, decimals: 18, source: rate.rate.source },
      ]);
    }

    // Nothing is credited from a desk that is not the contract the record
    // describes, or whose code could not be read at all: its events are not
    // trusted until a person says why they should be.
    let report: CreditsSyncReport;
    let waiting: number;
    if (code.state === 'MATCHES') {
      // The pricing gets what is left of the run's time, less what the fan-out needs.
      const synced = await syncTopUps(store, config, opts, now, undefined, Math.min(deadline - 12_000, Date.now() + 25_000));
      report = synced.report;
      waiting = synced.index.unpriced.length;
    } else {
      const loaded = await loadCreditsIndex(store, config);
      waiting = loaded.state.unpriced.length;
      const why = code.state === 'MISMATCH' ? `the desk's code is not the record's (${code.detail ?? 'mismatch'})` : `the desk's code could not be verified (${code.detail ?? code.state})`;
      report = { state: 'HELD', fromBlock: null, toBlock: null, head: isRead(head) ? head.value.number : null, rolledBackFrom: null, newTopUps: 0, credited: [], unpriced: waiting, unreadRanges: [], recorded: false, detail: `${why}; nothing is credited from it` };
    }
    const fan = await fanOut(store, now, conditions, undefined, undefined, Math.min(deadline, Date.now() + 20_000));

    const summary: RunSummary = {
      at: now.toISOString(),
      rate: rate.state,
      rateDetail: rate.state === 'UNREAD' ? `${rate.reason}${rate.detail ? ` — ${rate.detail}` : ''}` : null,
      code: code.state,
      codeDetail: code.detail,
      index: report.state,
      indexDetail: report.detail,
      waitingForRate: waiting,
      fanOutFailed: fan.failed.length,
      fanOutUncharged: fan.uncharged.length,
      behindBlocks: report.head === null || report.toBlock === null ? null : Math.max(0, report.head - report.toBlock),
      configured: true,
    };
    await store.writeSnapshots([{ key: RUN_KEY, observedAt: now.toISOString(), payload: { ...summary } }]);
    return { state: 'CONFIGURED', detail: null, rate, code, index: report, fanOut: fan };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown failure';
    await store.writeSnapshots([{ key: RUN_KEY, observedAt: now.toISOString(), payload: { at: now.toISOString(), rate: 'UNREAD', rateDetail: `the run failed: ${detail}`, code: 'UNREAD', codeDetail: null, index: 'STORE_UNREADABLE', indexDetail: `the run failed: ${detail}`, waitingForRate: 0, fanOutFailed: 0, fanOutUncharged: 0, behindBlocks: null, configured: true } }]);
    return { state: 'FAILED', detail, rate: null, code: null, index: null, fanOut: null };
  }
}

/** The last rate the tick recorded, as the page and the API show it — or the store's fault, which is not "no rate yet". */
export async function latestRate(store: Store, config: CreditsConfig | null = null): Promise<{ rate: RateSnapshot | null; storeFault: string | null }> {
  const read = await store.snapshots(RATE_KEY);
  if (read.state === 'UNREAD') return { rate: null, storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const row = read.value.find((s) => s.key === RATE_KEY);
  if (!row) return { rate: null, storeFault: null };
  const snapshot = row.payload as unknown as RateSnapshot;
  // A READ row written by an earlier build lacks what this build states (the guard, the basis): it is not quoted from; the next tick writes a current one.
  if (snapshot.state === 'READ' && (typeof snapshot.rate?.guard !== 'object' || snapshot.rate.guard === null || typeof snapshot.rate.basis !== 'string' || typeof snapshot.rate.usdPerCurb18 !== 'string')) {
    return { rate: { state: 'UNREAD', reason: 'RATE_ROW_OLD', detail: 'the last rate was written by an earlier build of the reader and lacks fields this one states; nothing is quoted from it until the next tick reads again', at: snapshot.at, block: typeof snapshot.rate?.block === 'number' ? snapshot.rate.block : null }, storeFault: null };
  }
  // A rate read from another pool (the configuration changed since) is not this pool's rate.
  if (snapshot.state === 'READ' && config !== null && (config.priceSource === null || snapshot.rate.pool?.address?.toLowerCase() !== config.priceSource.pair.toLowerCase())) {
    return { rate: { state: 'UNREAD', reason: 'RATE_ROW_OTHER_POOL', detail: `the last rate was read from ${snapshot.rate.pool?.address ?? 'another pool'}, not the pool now recorded; nothing is quoted from it until the next tick reads again`, at: snapshot.at, block: snapshot.rate.block }, storeFault: null };
  }
  return { rate: snapshot, storeFault: null };
}

/** How the last run ended, or null before the first. */
export async function latestRun(store: Store): Promise<RunSummary | null> {
  const read = await store.snapshots(RUN_KEY);
  if (read.state === 'UNREAD') return null;
  const row = read.value.find((s) => s.key === RUN_KEY);
  return row ? (row.payload as unknown as RunSummary) : null;
}
