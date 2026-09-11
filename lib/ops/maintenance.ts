/**
 * Retention, on the tick instead of on a person remembering.
 *
 * Observations accumulate at about forty rows per Pillar run and a few
 * hundred per Archivist sweep; the retention horizon is stated in
 * `store/retention.ts`. Once a UTC day, the first tick to notice that no prune
 * has run today runs one and records what it removed. The count comes back as
 * a Reading, so a prune that could not be confirmed is reported as unconfirmed
 * rather than as zero — the same rule the manual script follows.
 */

import type { Store } from '../store/types.ts';
import { retentionCutoff, OBSERVATION_RETENTION_DAYS } from '../store/retention.ts';

export const PRUNE_STATE_KEY = 'ops:prune';

export type PruneRun =
  | { readonly state: 'ALREADY_DONE'; readonly day: string; readonly lastRemoved: number | null }
  | { readonly state: 'PRUNED'; readonly day: string; readonly removed: number; readonly cutoff: string; readonly recorded: boolean }
  | { readonly state: 'UNCONFIRMED'; readonly day: string; readonly reason: string }
  | { readonly state: 'STATE_UNREADABLE'; readonly day: string; readonly reason: string };

export async function maintainRetention(store: Store, now: Date): Promise<PruneRun> {
  const day = now.toISOString().slice(0, 10);
  const state = await store.snapshots(PRUNE_STATE_KEY);
  if (state.state === 'UNREAD') {
    // Without the record of the last prune, running one blind could run one
    // on every tick of a day the store keeps failing. Say so and wait.
    return { state: 'STATE_UNREADABLE', day, reason: `${state.reason}${state.detail ? ` — ${state.detail}` : ''}` };
  }
  const last = state.value.find((s) => s.key === PRUNE_STATE_KEY);
  if (last && last.observedAt.slice(0, 10) === day) {
    const removed = last.payload.removed;
    return { state: 'ALREADY_DONE', day, lastRemoved: typeof removed === 'number' ? removed : null };
  }

  const cutoff = retentionCutoff(now);
  const pruned = await store.pruneObservations(cutoff);
  if (pruned.state === 'UNREAD') {
    return { state: 'UNCONFIRMED', day, reason: `${pruned.reason}${pruned.detail ? ` — ${pruned.detail}` : ''}` };
  }
  const written = await store.writeSnapshots([
    {
      key: PRUNE_STATE_KEY,
      observedAt: now.toISOString(),
      payload: { removed: pruned.value, cutoff: cutoff.toISOString(), horizonDays: OBSERVATION_RETENTION_DAYS },
    },
  ]);
  return { state: 'PRUNED', day, removed: pruned.value, cutoff: cutoff.toISOString(), recorded: written.state === 'WRITTEN' };
}
