/**
 * The credit desk's share of the tick: the rate at the head, recorded with
 * its block or its reason; the desk's code against the committed build;
 * the top-ups since the cursor, priced and credited; the alert transition,
 * if there was one, fanned out to the subscribers who can pay. One summary
 * row (`credits:run`) says how each part ended, for the conditions to read.
 * NOT_CONFIGURED is reported, not silent — the services page reads the
 * same status and says the same thing.
 */

import { readHead, type RpcOptions } from '../chain/rpc.ts';
import { isRead } from '../doctrine/reading.ts';
import type { AlertRun } from '../ops/alerts.ts';
import type { SnapshotRecord, Store } from '../store/types.ts';
import { deskCodeSnapshot, verifyDeskCode, type DeskCodeVerification } from './code.ts';
import { creditsStatus, type CreditsStatus } from './config.ts';
import { CREDITS_INTERVAL_SECONDS, syncTopUps, type CreditsSyncReport } from './indexer.ts';
import { readRate, type Rate } from './rate.ts';
import { fanOut, type FanOutReport } from './subscriptions.ts';

export const RATE_KEY = 'credits:rate';
export const RUN_KEY = 'credits:run';

export type RateSnapshot =
  | { readonly state: 'READ'; readonly rate: Rate; readonly at: string }
  | { readonly state: 'UNREAD'; readonly reason: string; readonly detail: string | null; readonly at: string; readonly block: number | null };

export interface CreditsRun {
  readonly state: CreditsStatus['state'];
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
}

export async function runCredits(store: Store, now: Date, alert: Pick<AlertRun, 'message' | 'transitionId'> | null): Promise<CreditsRun> {
  const status = creditsStatus();
  if (status.state !== 'CONFIGURED') return { state: status.state, detail: status.detail, rate: null, code: null, index: null, fanOut: null };
  const config = status.config;
  const opts: RpcOptions = { profile: config.network, intervalSeconds: CREDITS_INTERVAL_SECONDS };

  const head = await readHead(opts);
  let rate: RateSnapshot;
  if (!isRead(head)) {
    rate = { state: 'UNREAD', reason: head.reason, detail: head.detail ?? null, at: now.toISOString(), block: null };
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

  const { index, report } = await syncTopUps(store, config, opts, now);
  const fan = await fanOut(store, now, alert?.message ?? null, alert?.transitionId ?? null);

  const summary: RunSummary = {
    at: now.toISOString(),
    rate: rate.state,
    rateDetail: rate.state === 'UNREAD' ? `${rate.reason}${rate.detail ? ` — ${rate.detail}` : ''}` : null,
    code: code.state,
    codeDetail: code.detail,
    index: report.state,
    indexDetail: report.detail,
    waitingForRate: index.unpriced.length,
    fanOutFailed: fan.failed.length,
  };
  await store.writeSnapshots([{ key: RUN_KEY, observedAt: now.toISOString(), payload: { ...summary } }]);
  return { state: 'CONFIGURED', detail: null, rate, code, index: report, fanOut: fan };
}

/** The last rate the tick recorded, as the page and the API show it. */
export async function latestRate(store: Store): Promise<RateSnapshot | null> {
  const read = await store.snapshots(RATE_KEY);
  if (read.state === 'UNREAD') return null;
  const row = read.value.find((s) => s.key === RATE_KEY);
  return row ? (row.payload as unknown as RateSnapshot) : null;
}

/** How the last run ended, or null before the first. */
export async function latestRun(store: Store): Promise<RunSummary | null> {
  const read = await store.snapshots(RUN_KEY);
  if (read.state === 'UNREAD') return null;
  const row = read.value.find((s) => s.key === RUN_KEY);
  return row ? (row.payload as unknown as RunSummary) : null;
}
