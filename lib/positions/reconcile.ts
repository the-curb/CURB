/**
 * Reconciliation: what the series owes, from the replayed ledger, against
 * what the series holds, from the component tokens' own balanceOf.
 *
 * Per component the finding is one of four: MATCHED, SURPLUS, SHORTFALL, or
 * UNKNOWN when the balance could not be read. A finding about token units
 * is only that. It is not an audit of any issuer's share reserve, and the
 * report says so in its own text so nobody has to remember.
 */

import { SELECTORS } from '../chain/abi.ts';
import { readMany } from '../chain/multicall.ts';
import { decodeUint } from '../chain/abi.ts';
import { positionsNetwork } from '../chain/networks.ts';
import type { RpcOptions } from '../chain/rpc.ts';
import { isRead } from '../doctrine/reading.ts';
import type { Store } from '../store/types.ts';
import type { SeriesDeployment } from './deployments.ts';
import { COMPONENTS, liability, surplus, shortfall, type ComponentId, type LedgerState } from './ledger.ts';

export type Finding = 'MATCHED' | 'SURPLUS' | 'SHORTFALL' | 'UNKNOWN';

export interface ComponentReconciliation {
  readonly component: ComponentId;
  readonly token: string;
  readonly finding: Finding;
  /** Strings of base units, never floats. */
  readonly owed: string;
  readonly held: string | null;
  readonly difference: string | null;
  readonly reason: string | null;
}

export interface Reconciliation {
  readonly seriesId: string;
  readonly chainId: number;
  readonly asOfBlock: number | null;
  readonly ranAt: string;
  readonly components: readonly ComponentReconciliation[];
  readonly disagreements: readonly string[];
  readonly limit: string;
}

export const RECONCILIATION_LIMIT =
  'A finding here is about units of a token held by the series against units it owes. It is not an audit of any issuer’s share reserve, custody, or the value of a unit.';

/** `balanceOf(holder)` calldata: the selector and the holder as a 32-byte word. */
export function balanceOfCalldata(holder: string): string {
  return `${SELECTORS.balanceOf}${holder.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

/** The finding for one component, from the ledger and a balance reading. */
export function reconcileComponent(ledger: LedgerState, i: ComponentId, token: string, held: bigint | null, reason: string | null): ComponentReconciliation {
  const owed = liability(ledger, i);
  if (held === null) return { component: i, token, finding: 'UNKNOWN', owed: owed.toString(), held: null, difference: null, reason: reason ?? 'balance not read' };
  const withHeld: LedgerState = { ...ledger, balances: { ...ledger.balances, [i]: held } };
  const over = surplus(withHeld, i);
  const short = shortfall(withHeld, i);
  const finding: Finding = short > 0n ? 'SHORTFALL' : over > 0n ? 'SURPLUS' : 'MATCHED';
  return { component: i, token, finding, owed: owed.toString(), held: held.toString(), difference: (held - owed).toString(), reason: null };
}

export async function readComponentBalances(deployment: SeriesDeployment, opts: RpcOptions): Promise<Record<ComponentId, { value: bigint | null; reason: string | null }>> {
  const calls = COMPONENTS.map((i) => ({ target: deployment.components[i], data: balanceOfCalldata(deployment.address) }));
  const answers = await readMany(calls, opts);
  const out = {} as Record<ComponentId, { value: bigint | null; reason: string | null }>;
  COMPONENTS.forEach((i, idx) => {
    const a = answers[idx];
    if (!a || !isRead(a)) {
      out[i] = { value: null, reason: a ? `${a.reason}${a.detail ? ` — ${a.detail}` : ''}` : 'no answer' };
      return;
    }
    const v = decodeUint(a.value);
    out[i] = v === null ? { value: null, reason: 'balanceOf undecodable' } : { value: v, reason: null };
  });
  return out;
}

const RECONCILE_KEY = (seriesId: string) => `positions:reconcile:${seriesId}`;

export async function reconcileSeries(
  store: Store,
  seriesId: string,
  deployment: SeriesDeployment,
  ledger: LedgerState,
  disagreements: readonly string[],
  asOfBlock: number | null,
  opts: RpcOptions,
  now: Date,
): Promise<{ reconciliation: Reconciliation; recorded: boolean }> {
  const balances = await readComponentBalances(deployment, opts);
  const reconciliation: Reconciliation = {
    seriesId,
    chainId: (opts.profile ?? positionsNetwork()).chainId,
    asOfBlock,
    ranAt: now.toISOString(),
    components: COMPONENTS.map((i) => reconcileComponent(ledger, i, deployment.components[i], balances[i].value, balances[i].reason)),
    disagreements,
    limit: RECONCILIATION_LIMIT,
  };
  const written = await store.writeSnapshots([{ key: RECONCILE_KEY(seriesId), observedAt: now.toISOString(), payload: reconciliation as unknown as Record<string, unknown> }]);
  return { reconciliation, recorded: written.state === 'WRITTEN' };
}

export async function latestReconciliation(store: Store, seriesId: string): Promise<{ reconciliation: Reconciliation | null; storeFault: string | null }> {
  const read = await store.snapshots(RECONCILE_KEY(seriesId));
  if (read.state === 'UNREAD') return { reconciliation: null, storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const snap = read.value.find((s) => s.key === RECONCILE_KEY(seriesId));
  return { reconciliation: snap ? (snap.payload as unknown as Reconciliation) : null, storeFault: null };
}
