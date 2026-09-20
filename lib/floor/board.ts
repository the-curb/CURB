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
  /**
   * The other half of the price, when the Specialist has read it.
   *
   * The feed says what a share was worth when the exchange last printed. This
   * says what the token is worth on this chain right now, and how far apart the
   * two are. It is a different agent's reading taken at a different moment, so
   * it carries its own age: a row whose feed was sampled a minute ago and whose
   * pool was sampled an hour ago is two statements about "now", and it must not
   * be drawn as one.
   */
  readonly market: MarketRow | null;
}

/** What the Specialist last read about the pool behind a feed's ticker. */
export interface MarketRow {
  /** The token's price in dollars, from the deepest pool that has a market. */
  readonly priceUsd: number | null;
  /** The mid in the pool's own quote asset, which survives a missing dollar feed. */
  readonly priceInQuote: number | null;
  readonly quoteLabel: string | null;
  readonly basisBps: number | null;
  /** The size that moves that mid one percent: a bound over published state, never a quote. */
  readonly depthUsd: number | null;
  readonly depthIsExact: boolean | null;
  readonly venueLabel: string | null;
  readonly poolsRead: number | null;
  readonly sampleAgeSeconds: number;
  readonly sampledAt: string;
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
    readonly withMarket: number;
    readonly withBasis: number;
  };
  /** The widest difference between a pool and its feed. Null when none exists. */
  readonly widestBasisBps: number | null;
  readonly marketSampledAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/**
 * A `pool:` snapshot into the market half of a row. Never throws: a payload
 * that cannot be read becomes an absent figure, never a zero.
 */
export function marketOf(snapshot: SnapshotRecord, now: Date): MarketRow {
  const p = snapshot.payload;
  return {
    priceUsd: num(p.priceUsd),
    priceInQuote: num(p.priceInQuote),
    quoteLabel: str(p.quoteLabel),
    basisBps: num(p.basisBps),
    depthUsd: num(p.depthUsd),
    depthIsExact: bool(p.depthIsExact),
    venueLabel: str(p.venueLabel),
    poolsRead: num(p.poolsReadForTicker),
    sampleAgeSeconds: Math.max(0, Math.round((now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000)),
    sampledAt: snapshot.observedAt,
  };
}

/** One snapshot into one row. Never throws; a bad payload becomes a row that says so. */
export function rowOf(snapshot: SnapshotRecord, now: Date, market: MarketRow | null = null): BoardRow {
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
    market,
  };
}

export function composeBoard(
  snapshots: readonly SnapshotRecord[],
  now: Date,
  poolSnapshots: readonly SnapshotRecord[] = [],
): Board {
  // Keyed by feed, because that is the one name both agents carry: the Pillar
  // writes `feed:rh-nvda-usd` and the Specialist writes `pool:rh-nvda-usd` for
  // the same ticker. Joining on anything else would be joining on a label.
  const markets = new Map<string, MarketRow>();
  for (const s of poolSnapshots) {
    if (!s.key.startsWith('pool:')) continue;
    markets.set(s.key.replace(/^pool:/, ''), marketOf(s, now));
  }

  const rows = snapshots
    .filter((s) => s.key.startsWith('feed:'))
    .map((s) => rowOf(s, now, markets.get(s.key.replace(/^feed:/, '')) ?? null))
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
      /** Equity rows carrying a pool price as well as a feed price. */
      withMarket: equity.filter((r) => r.market?.priceUsd != null).length,
      /** Of those, the ones where both sides were readable, so a basis exists. */
      withBasis: equity.filter((r) => r.market?.basisBps != null).length,
    },
    /**
     * The widest difference on the board, so a reader is told where to look
     * before scanning thirty-five rows. Null when no row carries both sides —
     * never zero, which would read as "the chain agrees with the exchange".
     */
    widestBasisBps: equity.reduce<number | null>((widest, r) => {
      const b = r.market?.basisBps;
      if (b == null) return widest;
      return widest === null || Math.abs(b) > Math.abs(widest) ? b : widest;
    }, null),
    marketSampledAt: equity.reduce<string | null>((newest, r) => {
      const at = r.market?.sampledAt;
      if (at == null) return newest;
      return newest === null || at > newest ? at : newest;
    }, null),
  };
}
