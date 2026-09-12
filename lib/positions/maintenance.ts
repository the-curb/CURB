/**
 * The position product's backend, run on the desk's tick.
 *
 * Once a UTC day: archive what the issuers publish, then verify on chain
 * every address that evidence names. Every tick: for a series with a
 * reviewed deployment configured, sync its event index and reconcile what
 * it owes against what it holds. A series with no deployment reports
 * NOT_DEPLOYED and nothing is read for it — the usual case today, and said
 * plainly rather than left out.
 */

import { positionsNetwork } from '../chain/networks.ts';
import type { RpcOptions } from '../chain/rpc.ts';
import type { Store } from '../store/types.ts';
import { deploymentOf } from './deployments.ts';
import { archiveEvidence, type ArchiveOutcome } from './evidence.ts';
import { INDEX_INTERVAL_SECONDS, reduceLedger, syncIndex, type SyncReport } from './index.ts';
import { reconcileSeries, type Reconciliation } from './reconcile.ts';
import { codeSnapshot, verifySeriesCode, type CodeVerification } from './code.ts';
import { SERIES } from './series.ts';
import { verifySeriesCandidates, type VerificationRun } from './verify.ts';

const DAILY_KEY = 'positions:daily';

export interface DailyRun {
  readonly state: 'ALREADY_DONE' | 'DONE' | 'STATE_UNREADABLE';
  readonly day: string;
  readonly evidence: readonly ArchiveOutcome[] | null;
  readonly verification: readonly Pick<VerificationRun, 'seriesId' | 'chainId' | 'candidates' | 'recorded' | 'note'>[] | null;
  readonly detail: string | null;
}

export interface SeriesRun {
  readonly seriesId: string;
  readonly deployment: 'NOT_DEPLOYED' | 'CONFIG_INVALID' | 'CONFIGURED';
  readonly detail: string | null;
  readonly sync: SyncReport | null;
  readonly reconciliation: Pick<Reconciliation, 'components' | 'disagreements' | 'asOfBlock'> | null;
  /** Whether the address is the contract in this repository; absent while not deployed. */
  readonly code?: { readonly state: CodeVerification['state']; readonly detail: string | null; readonly buildCommit: string | null } | null;
}

export interface PositionsMaintenance {
  readonly network: string;
  readonly chainId: number;
  readonly daily: DailyRun;
  readonly series: readonly SeriesRun[];
}

async function runDaily(store: Store, now: Date, force: boolean): Promise<DailyRun> {
  const day = now.toISOString().slice(0, 10);
  const state = await store.snapshots(DAILY_KEY);
  if (state.state === 'UNREAD') {
    return { state: 'STATE_UNREADABLE', day, evidence: null, verification: null, detail: `${state.reason}${state.detail ? ` — ${state.detail}` : ''}` };
  }
  const last = state.value.find((s) => s.key === DAILY_KEY);
  // Once a UTC day, unless the operator forces it — when a source was added or
  // a page changed and waiting for midnight would leave the record behind.
  if (!force && last && last.observedAt.slice(0, 10) === day) {
    return { state: 'ALREADY_DONE', day, evidence: null, verification: null, detail: null };
  }

  const evidence = await archiveEvidence(store, now);
  const verification = [];
  for (const spec of SERIES) {
    const run = await verifySeriesCandidates(store, spec.id, now);
    verification.push({ seriesId: run.seriesId, chainId: run.chainId, candidates: run.candidates, recorded: run.recorded, note: run.note });
  }
  await store.writeSnapshots([{ key: DAILY_KEY, observedAt: now.toISOString(), payload: { day, evidence, verification } }]);
  return { state: 'DONE', day, evidence, verification, detail: null };
}

export async function positionsMaintenance(store: Store, now: Date, options: { readonly forceDaily?: boolean } = {}): Promise<PositionsMaintenance> {
  const profile = positionsNetwork();
  const opts: RpcOptions = { profile, intervalSeconds: INDEX_INTERVAL_SECONDS };
  const daily = await runDaily(store, now, options.forceDaily === true);

  const series: SeriesRun[] = [];
  for (const spec of SERIES) {
    const status = deploymentOf(spec.id);
    if (status.state !== 'CONFIGURED') {
      series.push({ seriesId: spec.id, deployment: status.state, detail: status.detail, sync: null, reconciliation: null });
      continue;
    }
    const { deployment } = status;
    if (deployment.chainId !== profile.chainId) {
      series.push({ seriesId: spec.id, deployment: 'CONFIG_INVALID', detail: `the deployment is on chain ${deployment.chainId} but the positions network is ${profile.id} (${profile.chainId})`, sync: null, reconciliation: null });
      continue;
    }
    const { index, report } = await syncIndex(store, spec.id, deployment, opts, now);
    const { ledger, disagreements } = reduceLedger(index, deployment.q, deployment.capLots);
    const { reconciliation } = await reconcileSeries(store, spec.id, deployment, ledger, disagreements, index.cursor, opts, now);
    // Is the address the contract in this repository? Asked every tick; a mismatch is a DARK condition.
    const code = await verifySeriesCode(deployment, opts, now);
    await store.writeSnapshots([codeSnapshot(code)]);
    series.push({
      seriesId: spec.id,
      deployment: 'CONFIGURED',
      detail: null,
      sync: report,
      reconciliation: { components: reconciliation.components, disagreements: reconciliation.disagreements, asOfBlock: reconciliation.asOfBlock },
      code: { state: code.state, detail: code.detail, buildCommit: code.buildCommit },
    });
  }

  return { network: profile.id, chainId: profile.chainId, daily, series };
}
