/**
 * The Registry roll: every stock token the issuer lists, as the Archivist last
 * read it, joined to the feed that prices it when one exists.
 *
 * Composed from `token:` snapshots and the captured registry, never from the
 * chain. A token with no snapshot yet is still on the roll — it is in the
 * issuer's registry — but every measured column for it is an absence with the
 * reason "not yet read", which is not the same as a multiplier of one.
 *
 * Payloads are stored JSON and are checked field by field before use.
 */

import { AGENT_BY_ID } from '../agents/registry.ts';
import { absenceSeconds, freshnessSeconds } from '../doctrine/reading.ts';
import { STOCK_TOKENS, type StockTokenRecord } from '../chain/stock-tokens.ts';
import { FEED_DIRECTORY } from '../chain/feed-directory.ts';
import { formatUnits } from '../chain/abi.ts';
import type { SnapshotRecord } from '../store/types.ts';
import type { SampleState } from '../floor/board.ts';

export interface RollRow {
  readonly token: StockTokenRecord;
  readonly feedName: string | null;
  /** Six places for the eye; the exact figure is in the snapshot. */
  readonly multiplier: string | null;
  readonly multiplierExact: string | null;
  readonly notAtOne: boolean | null;
  readonly pending: { readonly shown: string; readonly effectiveAt: string | null } | null;
  readonly supply: string | null;
  readonly sampleAgeSeconds: number | null;
  readonly unreadBecause: string | null;
}

export interface Roll {
  readonly rows: readonly RollRow[];
  readonly sampledAt: string | null;
  readonly sampleAgeSeconds: number | null;
  readonly sampleState: SampleState;
  readonly counts: {
    readonly total: number;
    readonly read: number;
    readonly notAtOne: number;
    readonly pending: number;
    readonly withFeed: number;
    readonly withoutFeed: number;
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function sixPlaces(exact: string): string {
  const [whole, fraction = ''] = exact.split('.');
  return `${whole}.${fraction.padEnd(18, '0').slice(0, 6)}`;
}

function rowOf(token: StockTokenRecord, snapshot: SnapshotRecord | undefined, now: Date): RollRow {
  const feedName = token.feedKey === null ? null : (FEED_DIRECTORY.find((f) => f.key === token.feedKey)?.name ?? null);
  if (!snapshot) {
    return {
      token,
      feedName,
      multiplier: null,
      multiplierExact: null,
      notAtOne: null,
      pending: null,
      supply: null,
      sampleAgeSeconds: null,
      unreadBecause: 'not yet read: the Archivist has not written a snapshot for this token to this store',
    };
  }
  const p = snapshot.payload;
  const sampleAgeSeconds = Math.max(0, Math.round((now.getTime() - new Date(snapshot.observedAt).getTime()) / 1000));
  const exact = str(p.multiplier);
  const raw = str(p.multiplierRaw);
  const pendingRaw = str(p.pendingRaw);
  const supplyRaw = str(p.supplyRaw);
  const unreadBecause = str(p.unreadBecause);

  let supply: string | null = null;
  if (supplyRaw !== null && /^\d+$/.test(supplyRaw)) supply = formatUnits(BigInt(supplyRaw), token.decimals);

  let pending: RollRow['pending'] = null;
  if (pendingRaw !== null && /^\d+$/.test(pendingRaw)) {
    const value = BigInt(pendingRaw);
    const shown = `${value / 10n ** 18n}.${(value % 10n ** 18n).toString().padStart(18, '0').slice(0, 6)}`;
    pending = { shown, effectiveAt: str(p.pendingEffectiveAt) };
  }

  return {
    token,
    feedName,
    multiplier: exact === null ? null : sixPlaces(exact),
    multiplierExact: exact,
    notAtOne: raw === null || !/^\d+$/.test(raw) ? null : BigInt(raw) !== 10n ** 18n,
    pending,
    supply,
    sampleAgeSeconds,
    unreadBecause:
      exact === null && unreadBecause === null
        ? 'the snapshot carries no multiplier and no reason — the record for this token could not be read as written'
        : unreadBecause,
  };
}

export function composeRoll(snapshots: readonly SnapshotRecord[], now: Date): Roll {
  const byKey = new Map(snapshots.filter((s) => s.key.startsWith('token:')).map((s) => [s.key, s]));
  const rows = STOCK_TOKENS.map((token) => rowOf(token, byKey.get(`token:${token.key}`), now));

  const sampled = rows.filter((r) => r.sampleAgeSeconds !== null);
  const newest = sampled.reduce<RollRow | null>((best, r) => (best === null || r.sampleAgeSeconds! < best.sampleAgeSeconds! ? r : best), null);
  const interval = AGENT_BY_ID.archivist.intervalSeconds ?? 6 * 3600;
  const sampleState: SampleState =
    newest === null
      ? 'NONE'
      : newest.sampleAgeSeconds! > absenceSeconds(interval)
        ? 'ABSENT'
        : newest.sampleAgeSeconds! > freshnessSeconds(interval)
          ? 'STALE'
          : 'VERIFIED';

  return {
    rows,
    sampledAt: newest === null ? null : byKey.get(`token:${newest.token.key}`)?.observedAt ?? null,
    sampleAgeSeconds: newest?.sampleAgeSeconds ?? null,
    sampleState,
    counts: {
      total: rows.length,
      read: rows.filter((r) => r.multiplier !== null).length,
      notAtOne: rows.filter((r) => r.notAtOne === true).length,
      pending: rows.filter((r) => r.pending !== null).length,
      withFeed: rows.filter((r) => r.token.feedKey !== null).length,
      withoutFeed: rows.filter((r) => r.token.feedKey === null).length,
    },
  };
}
