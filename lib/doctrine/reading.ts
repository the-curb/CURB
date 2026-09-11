/**
 * The three-state reading — the spine of this system.
 *
 * Most systems have two outcomes: a value, or an error. That collapses the most
 * common real case (the source answered slowly, partially, or not at all) into
 * whichever of the two is more convenient, and convenience always picks the value.
 *
 * Here there are three, and the third one is not a number:
 *   VERIFIED — read, current, carries its source and the time it was read
 *   STALE    — read, but older than the freshness threshold; shown with its age
 *   UNREAD   — not read; carries a reason, never a value, and never renders as 0
 *
 * The type makes the mistake hard rather than merely forbidden: an UNREAD reading
 * has `value: null`, so arithmetic on it does not typecheck without an explicit
 * unwrap whose name says what you are doing.
 */

export type ReadingState = 'VERIFIED' | 'STALE' | 'UNREAD';

/** Why a figure could not be read. A missing reason is itself a bug. */
export type UnreadReason =
  | 'SOURCE_UNREACHABLE'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_MALFORMED'
  | 'SOURCE_NOT_CONNECTED'
  | 'FIELD_ABSENT'
  | 'COVERAGE_BELOW_MINIMUM'
  | 'MARKET_NEVER_OPENED'
  | 'NOT_YET_IMPLEMENTED';

export interface ReadMeta {
  /** Named source. Not "api", not "internal" — the thing a reader could check. */
  readonly source: string;
  /** ISO-8601, UTC. When the source answered, not when we rendered. */
  readonly retrievedAt: string;
}

export interface VerifiedReading<T> extends ReadMeta {
  readonly state: 'VERIFIED';
  readonly value: T;
  readonly ageSeconds: number;
}

export interface StaleReading<T> extends ReadMeta {
  readonly state: 'STALE';
  readonly value: T;
  readonly ageSeconds: number;
  /** The threshold it exceeded, so a reader can judge for themselves. */
  readonly freshnessSeconds: number;
}

export interface UnreadReading {
  readonly state: 'UNREAD';
  readonly value: null;
  readonly reason: UnreadReason;
  /** The source we tried, when we know it. Null when nothing was attempted. */
  readonly source: string | null;
  /** When we observed the absence — an absence has a timestamp too. */
  readonly observedAt: string;
  /** Operator detail. Never rendered as a figure. */
  readonly detail?: string;
}

export type Reading<T> = VerifiedReading<T> | StaleReading<T> | UnreadReading;

/**
 * How stale is too stale. Both thresholds derive from one declared interval, so
 * they cannot drift apart. Choosing them separately is how they drift.
 */
export const GRACE_SECONDS = 2 * 60 * 60;

export function freshnessSeconds(intervalSeconds: number): number {
  return intervalSeconds + GRACE_SECONDS;
}

export function absenceSeconds(intervalSeconds: number): number {
  return intervalSeconds * 2 + GRACE_SECONDS;
}

interface ReadInput<T> {
  value: T | null | undefined;
  source: string;
  retrievedAt: string | Date;
  /** The producing agent's declared interval, in seconds. */
  intervalSeconds: number;
  now?: Date;
}

/**
 * Build a reading from a source response. This is the only supported way to make
 * a VERIFIED or STALE reading — it computes the age rather than trusting a caller.
 */
export function read<T>(input: ReadInput<T>): Reading<T> {
  const now = input.now ?? new Date();
  const at = input.retrievedAt instanceof Date ? input.retrievedAt : new Date(input.retrievedAt);

  if (Number.isNaN(at.getTime())) {
    return unread('SOURCE_MALFORMED', {
      source: input.source,
      now,
      detail: 'unparsable retrievedAt',
    });
  }
  if (input.value === null || input.value === undefined) {
    return unread('FIELD_ABSENT', { source: input.source, now });
  }

  const ageSeconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  const fresh = freshnessSeconds(input.intervalSeconds);
  const absent = absenceSeconds(input.intervalSeconds);

  if (ageSeconds > absent) {
    // Past the absence threshold a figure stops being late and starts being fiction.
    return unread('SOURCE_TIMEOUT', {
      source: input.source,
      now,
      detail: `age ${ageSeconds}s exceeded absence threshold ${absent}s`,
    });
  }
  if (ageSeconds > fresh) {
    return {
      state: 'STALE',
      value: input.value,
      ageSeconds,
      freshnessSeconds: fresh,
      source: input.source,
      retrievedAt: at.toISOString(),
    };
  }
  return {
    state: 'VERIFIED',
    value: input.value,
    ageSeconds,
    source: input.source,
    retrievedAt: at.toISOString(),
  };
}

export function unread(
  reason: UnreadReason,
  opts: { source?: string | null; now?: Date; detail?: string } = {},
): UnreadReading {
  const base = {
    state: 'UNREAD' as const,
    value: null,
    reason,
    source: opts.source ?? null,
    observedAt: (opts.now ?? new Date()).toISOString(),
  };
  return opts.detail === undefined ? base : { ...base, detail: opts.detail };
}

export function isRead<T>(r: Reading<T>): r is VerifiedReading<T> | StaleReading<T> {
  return r.state !== 'UNREAD';
}

/**
 * Unwrap with an explicit fallback. Named so a reviewer can grep every place a
 * default was substituted for a measurement. Never pass 0 as the fallback for a
 * figure that will be rendered — render the reading instead.
 */
export function unwrapOr<T>(r: Reading<T>, fallback: T): T {
  return isRead(r) ? r.value : fallback;
}

/** For code paths that genuinely cannot proceed without the figure. */
export function mustRead<T>(r: Reading<T>, label: string): T {
  if (!isRead(r)) {
    throw new Error(
      `${label} is UNREAD (${r.reason}); it has no value and must not be defaulted`,
    );
  }
  return r.value;
}

/** The dash. An unread figure renders as absence, with its reason on hover. */
export const ABSENT_GLYPH = '—';

export function renderReading<T>(r: Reading<T>, format: (v: T) => string): string {
  return isRead(r) ? format(r.value) : ABSENT_GLYPH;
}

/** Human-readable age, for the line that states how old a stale figure is. */
export function describeAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Coverage. When too few sources answered, the reading is UNKNOWN — never NEUTRAL.
 * Neutral is a measurement: it says the signals were read and they cancelled out.
 * Unknown says they were not read. Publishing the first when the second is true is
 * the quietest way to lie with a dashboard.
 */
export type Coverage<T> =
  | {
      readonly state: 'DECLARED';
      readonly value: T;
      readonly sourcesReached: number;
      readonly sourcesExpected: number;
    }
  | {
      readonly state: 'UNKNOWN';
      readonly value: null;
      readonly reason: 'COVERAGE_BELOW_MINIMUM';
      readonly sourcesReached: number;
      readonly sourcesExpected: number;
      readonly minimumSources: number;
    };

export function declareCoverage<T>(
  value: T,
  sourcesReached: number,
  sourcesExpected: number,
  minimumSources: number,
): Coverage<T> {
  if (sourcesReached < minimumSources) {
    return {
      state: 'UNKNOWN',
      value: null,
      reason: 'COVERAGE_BELOW_MINIMUM',
      sourcesReached,
      sourcesExpected,
      minimumSources,
    };
  }
  return { state: 'DECLARED', value, sourcesReached, sourcesExpected };
}
