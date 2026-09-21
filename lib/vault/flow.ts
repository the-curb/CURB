/**
 * The Vault: flow over the day, from the Tally's hourly samples.
 *
 * Each sample is a rate — transfers per minute inside about a minute of chain
 * time — and the series of them is what the day looks like. Nothing here is a
 * total: the Tally cannot read one in a run, on either node, and says so; this
 * page does not sum what the Tally would not.
 *
 * Composed from observation series, never from the chain. The page says how
 * old the newest sample is, in the same three states as everything else.
 */

import { AGENT_BY_ID } from '../agents/registry.ts';
import { absenceSeconds, freshnessSeconds } from '../doctrine/reading.ts';
import type { ObservationRecord } from '../store/types.ts';
import type { SampleState } from '../floor/board.ts';

/** The series the Tally writes for the whole book. */
export const FLOW_SERIES = [
  { key: 'usdg:transfers-per-minute', label: 'USDG', kind: 'settlement' },
  { key: 'weth:transfers-per-minute', label: 'WETH', kind: 'settlement' },
  { key: 'stock-tokens:transfers-per-minute', label: 'Stock tokens, all', kind: 'stock' },
] as const;

export interface FlowPoint {
  readonly at: string;
  readonly perMinute: number;
}

export interface FlowSeries {
  readonly key: string;
  readonly label: string;
  readonly kind: 'settlement' | 'stock';
  readonly points: readonly FlowPoint[];
  readonly latest: FlowPoint | null;
  readonly sampleAgeSeconds: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly median: number | null;
  /** Why the series could not be read, when it could not. */
  readonly unreadBecause: string | null;
}

export interface Flow {
  readonly series: readonly FlowSeries[];
  readonly sampleState: SampleState;
  readonly sampleAgeSeconds: number | null;
  readonly windowHours: number;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function composeSeries(
  spec: (typeof FLOW_SERIES)[number],
  read: { readonly state: 'VERIFIED' | 'STALE'; readonly value: readonly ObservationRecord[] } | { readonly state: 'UNREAD'; readonly reason: string; readonly detail?: string },
  now: Date,
): FlowSeries {
  if (read.state === 'UNREAD') {
    return { key: spec.key, label: spec.label, kind: spec.kind, points: [], latest: null, sampleAgeSeconds: null, low: null, high: null, median: null, unreadBecause: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  }
  // Oldest first, as the store hands them; a value that is not a finite,
  // non-negative number is a row that cannot be a rate and is left out.
  const points = read.value
    .filter((r) => Number.isFinite(r.value) && r.value >= 0)
    .map((r) => ({ at: r.observedAt, perMinute: r.value }));
  const latest = points[points.length - 1] ?? null;
  const values = points.map((p) => p.perMinute);
  return {
    key: spec.key,
    label: spec.label,
    kind: spec.kind,
    points,
    latest,
    sampleAgeSeconds: latest === null ? null : Math.max(0, Math.round((now.getTime() - new Date(latest.at).getTime()) / 1000)),
    low: values.length === 0 ? null : Math.min(...values),
    high: values.length === 0 ? null : Math.max(...values),
    median: median(values),
    unreadBecause: null,
  };
}

export function composeFlow(series: readonly FlowSeries[], windowHours: number): Flow {
  const newest = series.reduce<number | null>((best, s) => (s.sampleAgeSeconds === null ? best : best === null || s.sampleAgeSeconds < best ? s.sampleAgeSeconds : best), null);
  const interval = AGENT_BY_ID.tally.intervalSeconds ?? 3600;
  const sampleState: SampleState =
    newest === null ? 'NONE' : newest > absenceSeconds(interval) ? 'ABSENT' : newest > freshnessSeconds(interval) ? 'STALE' : 'VERIFIED';
  return { series, sampleState, sampleAgeSeconds: newest, windowHours };
}
