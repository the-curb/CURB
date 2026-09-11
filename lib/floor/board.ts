/**
 * The Floor board: every feed the Pillar last read, with its age attached.
 *
 * Composed from `feed:` snapshots, never from the chain: a page that reads the
 * chain to render is a page whose numbers carry no provenance and no time. The
 * snapshot carries both, and the board says how old the snapshot itself is —
 * because a board drawn from a three-hour-old sample is a different thing from
 * a board drawn from one taken a minute ago, and it must look different.
 *
 * Two ages per row, kept apart on purpose:
 *
 *   feed age    now − updatedAt      how long since the oracle last published
 *   sample age  now − observedAt     how long since the Pillar read it
 *
 * The first is about the feed; the second is about us. A reader who sees only
 * one of them cannot tell which side went quiet.
 *
 * Snapshot payloads are stored JSON. Nothing about their shape is assumed:
 * every field is checked before it is used, and a row whose payload cannot be
 * read says so instead of rendering a guess.
 */

import { AGENT_BY_ID } from '../agents/registry.ts';
import { absenceSeconds, freshnessSeconds } from '../doctrine/reading.ts';
import type { SnapshotRecord } from '../store/types.ts';
import type { SessionPhase } from '../market/session.ts';

export type SampleState = 'VERIFIED' | 'STALE' | 'ABSENT' | 'NONE';

export interface BoardRow {
  readonly key: string;
  readonly label: string;
  readonly name: string;
  readonly marketHours: 'equity' | 'crypto';
  readonly price: string | null;
  readonly feedAgeSeconds: number | null;
  readonly sampleAgeSeconds: number;
  readonly sampledAt: string;
  readonly pastHeartbeat: boolean | null;
  readonly heartbeatSeconds: number | null;
  readonly identity: 'MATCHES' | 'DRIFT' | 'UNREAD' | null;
  readonly pauseFlag: 'SET' | 'CLEAR' | 'UNREAD' | 'NOT_ASKED' | null;
  readonly notPricedBecause: string | null;
  readonly sessionAtSample: SessionPhase | null;
}

export interface Board {
  readonly rows: readonly BoardRow[];
  readonly equity: readonly BoardRow[];
  readonly crypto: readonly BoardRow[];
  /** The most recent sample on the board, and how the board should be read because of it. */
  readonly sampledAt: string | null;
  readonly sampleAgeSeconds: number | null;
  readonly sampleState: SampleState;
  readonly counts: {
    readonly equity: number;
    readonly priced: number;
    readonly pastHeartbeat: number;
    readonly paused: number;
    readonly drift: number;
    readonly unread: number;
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** One snapshot into one row. Never throws; a bad payload becomes a row that says so. */
export function rowOf(snapshot: SnapshotRecord, now: Date): BoardRow {
  const p = snapshot.payload;
  const key = str(p.key) ?? snapshot.key.replace(/^feed:/, '');
  const sampleAgeSeconds = Math.max(0, Math.round((now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000));
  const marketHours = oneOf(p.marketHours, ['equity', 'crypto'] as const) ?? 'crypto';
  const updatedAt = num(p.updatedAt);
  const feedAgeSeconds = updatedAt === null ? null : Math.max(0, Math.round(now.getTime() / 1000 - updatedAt));
  const price = str(p.price);
  const notPricedBecause = str(p.notPricedBecause);

  return {
    key,
    label: str(p.label) ?? key,
    name: str(p.name) ?? key,
    marketHours,
    price,
    feedAgeSeconds,
    sampleAgeSeconds,
    sampledAt: snapshot.observedAt,
    pastHeartbeat: bool(p.pastHeartbeat),
    heartbeatSeconds: num(p.heartbeatSeconds),
    identity: oneOf(p.identity, ['MATCHES', 'DRIFT', 'UNREAD'] as const),
    pauseFlag: oneOf(p.pauseFlag, ['SET', 'CLEAR', 'UNREAD', 'NOT_ASKED'] as const),
    notPricedBecause:
      price === null && notPricedBecause === null
        ? 'the snapshot carries no price and no reason — the record for this feed could not be read as written'
        : notPricedBecause,
    sessionAtSample: oneOf(p.session, ['CLOSED', 'PRE', 'REGULAR', 'POST'] as const),
  };
}

export function composeBoard(snapshots: readonly SnapshotRecord[], now: Date): Board {
  const rows = snapshots
    .filter((s) => s.key.startsWith('feed:'))
    .map((s) => rowOf(s, now))
    .sort((a, b) => a.label.localeCompare(b.label));
  const equity = rows.filter((r) => r.marketHours === 'equity');
  const crypto = rows.filter((r) => r.marketHours === 'crypto');

  const newest = rows.reduce<BoardRow | null>((best, r) => (best === null || r.sampleAgeSeconds < best.sampleAgeSeconds ? r : best), null);
  const interval = AGENT_BY_ID.pillar.intervalSeconds ?? 900;
  const sampleState: SampleState =
    newest === null
      ? 'NONE'
      : newest.sampleAgeSeconds > absenceSeconds(interval)
        ? 'ABSENT'
        : newest.sampleAgeSeconds > freshnessSeconds(interval)
          ? 'STALE'
          : 'VERIFIED';

  return {
    rows,
    equity,
    crypto,
    sampledAt: newest?.sampledAt ?? null,
    sampleAgeSeconds: newest?.sampleAgeSeconds ?? null,
    sampleState,
    counts: {
      equity: equity.length,
      priced: equity.filter((r) => r.price !== null).length,
      pastHeartbeat: equity.filter((r) => r.pastHeartbeat === true).length,
      paused: equity.filter((r) => r.pauseFlag === 'SET').length,
      drift: equity.filter((r) => r.identity === 'DRIFT').length,
      unread: equity.filter((r) => r.price === null).length,
    },
  };
}
