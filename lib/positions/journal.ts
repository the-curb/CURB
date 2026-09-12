/**
 * The position product's journal: what changed, by day, as the store has it.
 *
 * Nothing here is a second record. A day's entries are derived from the
 * evidence archive's version rows — one per body first seen — and the drift
 * rows the verification writes when a candidate address moves. Composed
 * again tomorrow from the same rows, the day reads the same. The Gazette
 * prints it under the product's own heading (§9: the Gazette publishes
 * verified changes); an empty day is printed as empty, not omitted.
 */

import type { SnapshotRecord, Store } from '../store/types.ts';
import { EVIDENCE_PREFIX, EVIDENCE_SOURCES, type EvidenceSource } from './evidence.ts';
import type { Drift } from './verify.ts';

export const DRIFT_PREFIX = 'positions:drift:';
export const driftKey = (seriesId: string, at: string) => `${DRIFT_PREFIX}${seriesId}:${at}`;

export interface DriftRecord {
  readonly seriesId: string;
  readonly chainId: number;
  readonly network: string;
  readonly at: string;
  readonly previousRanAt: string | null;
  readonly drift: readonly Drift[];
}

export type JournalKind = 'EVIDENCE_ARCHIVED' | 'EVIDENCE_CHANGED' | 'DRIFT';

export interface JournalEntry {
  readonly at: string;
  readonly kind: JournalKind;
  readonly seriesId: string;
  readonly component: 'A' | 'B';
  /** The source's title, or the address that moved. */
  readonly subject: string;
  readonly url: string | null;
  /** The first eight hex digits of the body's hash, or the field that moved. */
  readonly mark: string;
  readonly detail: string;
}

export interface Journal {
  readonly day: string;
  readonly entries: readonly JournalEntry[];
  readonly storeFault: string | null;
}

const VERSION_KEY = /^evidence:(.+):v:([0-9a-f]{64})$/;

function sourceOf(id: string): EvidenceSource | null {
  return EVIDENCE_SOURCES.find((s) => s.id === id) ?? null;
}

/** Version rows grouped by source, oldest first, so "first archived" and "changed" can be told apart. */
function evidenceEntries(rows: readonly SnapshotRecord[], day: string): JournalEntry[] {
  const bySource = new Map<string, { hash: string; at: string; status: string | null; httpStatus: number | null }[]>();
  for (const row of rows) {
    const m = VERSION_KEY.exec(row.key);
    if (!m) continue;
    const list = bySource.get(m[1]!) ?? [];
    const status = typeof row.payload.status === 'string' ? row.payload.status : null;
    const httpStatus = typeof row.payload.httpStatus === 'number' ? row.payload.httpStatus : null;
    list.push({ hash: m[2]!, at: row.observedAt, status, httpStatus });
    bySource.set(m[1]!, list);
  }
  const entries: JournalEntry[] = [];
  for (const [id, versions] of bySource) {
    const source = sourceOf(id);
    if (!source) continue; // a source no longer watched leaves no orphan entry
    versions.sort((a, b) => a.at.localeCompare(b.at));
    versions.forEach((v, i) => {
      if (v.at.slice(0, 10) !== day) return;
      const first = i === 0;
      // A body that was a refusal, not the record, is archived as that. The
      // hash is of the refusal; printing it as the record would be a lie.
      const refused = v.status !== null && v.status !== 'OK' ? v.status : null;
      const what =
        refused !== null
          ? `the answer was ${refused.toLowerCase().replace(/_/g, ' ')}${v.httpStatus === null ? '' : ` (HTTP ${v.httpStatus})`}; the refusal is kept, not the record`
          : source.kind === 'page'
            ? 'the visible text is kept by its hash'
            : 'kept as received';
      entries.push({
        at: v.at,
        kind: first ? 'EVIDENCE_ARCHIVED' : 'EVIDENCE_CHANGED',
        seriesId: source.seriesId,
        component: source.component,
        subject: source.title,
        url: source.url,
        mark: v.hash.slice(0, 8),
        detail: first ? `first archived; ${what}` : `changed from version ${versions[i - 1]!.hash.slice(0, 8)}; the earlier body is kept; ${what}`,
      });
    });
  }
  return entries;
}

function driftEntries(rows: readonly SnapshotRecord[], day: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const row of rows) {
    if (!row.key.startsWith(DRIFT_PREFIX) || row.observedAt.slice(0, 10) !== day) continue;
    const record = row.payload as unknown as DriftRecord;
    for (const d of record.drift ?? []) {
      entries.push({
        at: record.at,
        kind: 'DRIFT',
        seriesId: record.seriesId,
        component: d.component,
        subject: `${d.address} (${d.role.toLowerCase().replace('_', ' ')})`,
        url: null,
        mark: d.field,
        detail: `${d.field} read ${d.to} on ${record.network}; the run before${record.previousRanAt ? ` (${record.previousRanAt.slice(0, 16)}Z)` : ''} read ${d.from}`,
      });
    }
  }
  return entries;
}

/** One day's entries, oldest first. A store that cannot be read is reported, not shown as an empty day. */
export async function positionsJournal(store: Store, day: string): Promise<Journal> {
  const [evidence, drift] = await Promise.all([store.snapshots(EVIDENCE_PREFIX), store.snapshots(DRIFT_PREFIX)]);
  const faults = [evidence, drift].filter((r) => r.state === 'UNREAD').map((r) => (r.state === 'UNREAD' ? `${r.reason}${r.detail ? ` — ${r.detail}` : ''}` : ''));
  if (faults.length > 0) return { day, entries: [], storeFault: faults.join('; ') };
  const entries = [...evidenceEntries(evidence.state === 'UNREAD' ? [] : evidence.value, day), ...driftEntries(drift.state === 'UNREAD' ? [] : drift.value, day)].sort(
    (a, b) => a.at.localeCompare(b.at) || a.seriesId.localeCompare(b.seriesId) || a.component.localeCompare(b.component) || a.subject.localeCompare(b.subject),
  );
  return { day, entries, storeFault: null };
}
