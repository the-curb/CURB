/**
 * The terms watch as a table: every page in the register, what the register
 * says about it, and what the watch last saw. Composed from `terms:`
 * snapshots; a page with no snapshot yet is on the table with its watch
 * columns absent and the reason saying so.
 */

import { TERMS_SOURCES, type TermsSource } from '../chain/terms.ts';
import { watchOf, type PageWatch } from './watch.ts';
import type { SnapshotRecord } from '../store/types.ts';
import { AGENT_BY_ID } from '../agents/registry.ts';
import { absenceSeconds, freshnessSeconds } from '../doctrine/reading.ts';
import type { SampleState } from '../floor/board.ts';

export interface WatchRow {
  readonly source: TermsSource;
  readonly watch: PageWatch | null;
  readonly sampleAgeSeconds: number | null;
  readonly unreadBecause: string | null;
}

export interface WatchTable {
  readonly rows: readonly WatchRow[];
  readonly sampleState: SampleState;
  readonly sampleAgeSeconds: number | null;
  readonly counts: { readonly read: number; readonly linkOnly: number; readonly watched: number; readonly changed: number };
}

export function composeWatchTable(snapshots: readonly SnapshotRecord[], now: Date): WatchTable {
  const byKey = new Map(snapshots.filter((s) => s.key.startsWith('terms:')).map((s) => [s.key, s]));
  const rows: WatchRow[] = TERMS_SOURCES.map((source) => {
    const snapshot = byKey.get(`terms:${source.key}`);
    if (!snapshot) {
      return { source, watch: null, sampleAgeSeconds: null, unreadBecause: 'not yet watched: Counsel has not written a watch for this page to this store' };
    }
    const watch = watchOf(snapshot);
    if (watch === null) {
      return { source, watch: null, sampleAgeSeconds: null, unreadBecause: 'the watch could not be read as written' };
    }
    return {
      source,
      watch,
      sampleAgeSeconds: Math.max(0, Math.round((now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000)),
      unreadBecause: null,
    };
  });

  const newest = rows.reduce<number | null>((best, r) => (r.sampleAgeSeconds === null ? best : best === null || r.sampleAgeSeconds < best ? r.sampleAgeSeconds : best), null);
  const interval = AGENT_BY_ID.counsel.intervalSeconds ?? 24 * 3600;
  const sampleState: SampleState =
    newest === null ? 'NONE' : newest > absenceSeconds(interval) ? 'ABSENT' : newest > freshnessSeconds(interval) ? 'STALE' : 'VERIFIED';

  return {
    rows,
    sampleState,
    sampleAgeSeconds: newest,
    counts: {
      read: rows.filter((r) => r.source.state === 'READ').length,
      linkOnly: rows.filter((r) => r.source.state === 'LINK_ONLY').length,
      watched: rows.filter((r) => r.watch !== null).length,
      changed: rows.filter((r) => (r.watch?.changes ?? 0) > 0).length,
    },
  };
}
