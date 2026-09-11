/**
 * THE BELL — session state for the underlying US equity market.
 *
 * This is the question every tokenized-equity venue answers badly. The chain runs
 * continuously; the exchange does not. A price read at 03:00 on a Sunday is not a
 * price, it is a memory — and a system that prints it without saying so has told
 * you something false without stating a single wrong number.
 *
 * The calendar is computed rather than tabulated. A hardcoded holiday table is
 * correct on the day it is written and rots silently afterwards; the rules below
 * are the published NYSE/Nasdaq rules and hold for any year.
 *
 * DECLARED BLIND SPOT: ad-hoc closures — national days of mourning, weather, a
 * halt for a systems failure — are not derivable from a rule. This module cannot
 * see them, and says so via `blindSpots` rather than pretending the calendar is
 * complete. Nothing here should be read as a claim that the market was open.
 */

const ET = 'America/New_York';

export type SessionPhase = 'CLOSED' | 'PRE' | 'REGULAR' | 'POST';

export interface SessionState {
  readonly phase: SessionPhase;
  /** The exchange's calendar day, in ET — not the viewer's day and not UTC's. */
  readonly calendarDay: string;
  readonly isTradingDay: boolean;
  readonly holiday: string | null;
  readonly earlyClose: boolean;
  readonly regularOpenUtc: string | null;
  readonly regularCloseUtc: string | null;
  /** Null while the market is open — there is no "next open" until it shuts. */
  readonly nextRegularOpenUtc: string | null;
  /** Null unless the market has closed at least once in the window we looked at. */
  readonly secondsSinceRegularClose: number | null;
  readonly observedAt: string;
  readonly blindSpots: readonly string[];
}

const BLIND_SPOTS = [
  'Ad-hoc closures (mourning, weather, systems failure) are not rule-derivable and are not detected here.',
  'Single-security halts (LULD, news pending) are a per-symbol state, not a session state.',
] as const;

/** ET wall-clock offset from UTC, in minutes, at a given instant. */
function etOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    if (!found) throw new Error(`Intl did not return ${type} for ${ET}`);
    return Number(found.value);
  };

  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

interface EtDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly minutes: number;
  readonly weekday: number;
}

function toEt(instant: Date): EtDate {
  const offset = etOffsetMinutes(instant);
  const shifted = new Date(instant.getTime() + offset * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** Convert an ET wall-clock time to the UTC instant it refers to. */
function etToUtc(year: number, month: number, day: number, minuteOfDay: number): Date {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let instant = new Date(naive);
  // Two passes settle the DST boundary case; the offset of the guess decides the answer.
  for (let i = 0; i < 2; i += 1) {
    instant = new Date(naive - etOffsetMinutes(instant) * 60_000);
  }
  return instant;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = weekdayOf(year, month, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = weekdayOf(year, month, daysInMonth);
  return daysInMonth - ((last - weekday + 7) % 7);
}

/** Anonymous Gregorian algorithm. Good Friday is the Friday before Easter Sunday. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Saturday holidays are observed on the preceding Friday, Sunday on the Monday. */
function observed(year: number, month: number, day: number): { month: number; day: number } {
  const weekday = weekdayOf(year, month, day);
  if (weekday === 6) {
    const prior = new Date(Date.UTC(year, month - 1, day - 1));
    return { month: prior.getUTCMonth() + 1, day: prior.getUTCDate() };
  }
  if (weekday === 0) {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return { month: next.getUTCMonth() + 1, day: next.getUTCDate() };
  }
  return { month, day };
}

function holidayMap(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const put = (m: number, d: number, label: string) => map.set(iso(year, m, d), label);

  // New Year's Day is not rolled back into the previous year when it lands on a Saturday.
  const newYear = weekdayOf(year, 1, 1) === 6 ? null : observed(year, 1, 1);
  if (newYear) put(newYear.month, newYear.day, "New Year's Day");

  put(1, nthWeekday(year, 1, 1, 3), 'Martin Luther King, Jr. Day');
  put(2, nthWeekday(year, 2, 1, 3), "Washington's Birthday");

  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));
  put(goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate(), 'Good Friday');

  put(5, lastWeekday(year, 5, 1), 'Memorial Day');

  const juneteenth = observed(year, 6, 19);
  put(juneteenth.month, juneteenth.day, 'Juneteenth National Independence Day');

  const july4 = observed(year, 7, 4);
  put(july4.month, july4.day, 'Independence Day');

  put(9, nthWeekday(year, 9, 1, 1), 'Labor Day');
  put(11, nthWeekday(year, 11, 4, 4), 'Thanksgiving Day');

  const christmas = observed(year, 12, 25);
  put(christmas.month, christmas.day, 'Christmas Day');

  return map;
}

/** 13:00 ET closes: the day before Independence Day, Black Friday, Christmas Eve. */
function earlyCloseSet(year: number): Set<string> {
  const set = new Set<string>();
  const holidays = holidayMap(year);

  const july3 = weekdayOf(year, 7, 3);
  if (july3 >= 1 && july3 <= 5 && !holidays.has(iso(year, 7, 3))) set.add(iso(year, 7, 3));

  const thanksgiving = nthWeekday(year, 11, 4, 4);
  set.add(iso(year, 11, thanksgiving + 1));

  const dec24 = weekdayOf(year, 12, 24);
  if (dec24 >= 1 && dec24 <= 5 && !holidays.has(iso(year, 12, 24))) set.add(iso(year, 12, 24));

  return set;
}

const PRE_OPEN = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;
const EARLY_CLOSE = 13 * 60;
const POST_CLOSE = 20 * 60;
const EARLY_POST_CLOSE = 17 * 60;

interface DayShape {
  readonly isTradingDay: boolean;
  readonly holiday: string | null;
  readonly earlyClose: boolean;
  readonly close: number;
  readonly postClose: number;
}

function shapeOf(year: number, month: number, day: number): DayShape {
  const key = iso(year, month, day);
  const weekday = weekdayOf(year, month, day);
  const holiday = holidayMap(year).get(key) ?? null;
  const weekend = weekday === 0 || weekday === 6;
  const early = earlyCloseSet(year).has(key);

  if (weekend || holiday) {
    return {
      isTradingDay: false,
      holiday: holiday ?? (weekend ? 'Weekend' : null),
      earlyClose: false,
      close: REGULAR_CLOSE,
      postClose: POST_CLOSE,
    };
  }
  return {
    isTradingDay: true,
    holiday: null,
    earlyClose: early,
    close: early ? EARLY_CLOSE : REGULAR_CLOSE,
    postClose: early ? EARLY_POST_CLOSE : POST_CLOSE,
  };
}

function addEtDays(year: number, month: number, day: number, delta: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Read the session. Pure: same instant in, same state out. */
export function readSession(now: Date = new Date()): SessionState {
  const et = toEt(now);
  const today = shapeOf(et.year, et.month, et.day);
  const calendarDay = iso(et.year, et.month, et.day);

  let phase: SessionPhase = 'CLOSED';
  if (today.isTradingDay) {
    if (et.minutes >= PRE_OPEN && et.minutes < REGULAR_OPEN) phase = 'PRE';
    else if (et.minutes >= REGULAR_OPEN && et.minutes < today.close) phase = 'REGULAR';
    else if (et.minutes >= today.close && et.minutes < today.postClose) phase = 'POST';
  }

  const regularOpenUtc = today.isTradingDay
    ? etToUtc(et.year, et.month, et.day, REGULAR_OPEN).toISOString()
    : null;
  const regularCloseUtc = today.isTradingDay
    ? etToUtc(et.year, et.month, et.day, today.close).toISOString()
    : null;

  // Walk forward for the next open; ten days covers any holiday run.
  let nextRegularOpenUtc: string | null = null;
  for (let delta = 0; delta <= 10; delta += 1) {
    const candidate = addEtDays(et.year, et.month, et.day, delta);
    const shape = shapeOf(candidate.year, candidate.month, candidate.day);
    if (!shape.isTradingDay) continue;
    const openInstant = etToUtc(candidate.year, candidate.month, candidate.day, REGULAR_OPEN);
    if (openInstant.getTime() > now.getTime()) {
      nextRegularOpenUtc = openInstant.toISOString();
      break;
    }
  }

  // Walk back for the most recent close; the same ten days covers the long weekends.
  let secondsSinceRegularClose: number | null = null;
  for (let delta = 0; delta <= 10; delta += 1) {
    const candidate = addEtDays(et.year, et.month, et.day, -delta);
    const shape = shapeOf(candidate.year, candidate.month, candidate.day);
    if (!shape.isTradingDay) continue;
    const closeInstant = etToUtc(candidate.year, candidate.month, candidate.day, shape.close);
    if (closeInstant.getTime() <= now.getTime()) {
      secondsSinceRegularClose = Math.round((now.getTime() - closeInstant.getTime()) / 1000);
      break;
    }
  }

  return {
    phase,
    calendarDay,
    isTradingDay: today.isTradingDay,
    holiday: today.holiday,
    earlyClose: today.earlyClose,
    regularOpenUtc,
    regularCloseUtc,
    nextRegularOpenUtc,
    secondsSinceRegularClose: phase === 'REGULAR' ? null : secondsSinceRegularClose,
    observedAt: now.toISOString(),
    blindSpots: BLIND_SPOTS,
  };
}

/**
 * The line that makes the difference. "42 hours old" tells a reader nothing.
 * "Last read before Friday's close; the market has not opened since" tells them
 * everything they needed to know before treating it as a price.
 */
export type PriceAgeVerdict =
  | { readonly kind: 'IN_SESSION'; readonly ageSeconds: number }
  | { readonly kind: 'EXTENDED_HOURS'; readonly ageSeconds: number }
  | { readonly kind: 'MARKET_CLOSED'; readonly ageSeconds: number; readonly closedForSeconds: number }
  | { readonly kind: 'PREDATES_LAST_CLOSE'; readonly ageSeconds: number; readonly note: string }
  | { readonly kind: 'NO_PRICE_READ' };

export function describePriceAge(
  priceRetrievedAt: Date | null,
  session: SessionState = readSession(),
  now: Date = new Date(),
): PriceAgeVerdict {
  if (priceRetrievedAt === null) return { kind: 'NO_PRICE_READ' };
  const ageSeconds = Math.max(0, Math.round((now.getTime() - priceRetrievedAt.getTime()) / 1000));

  if (session.phase === 'REGULAR') return { kind: 'IN_SESSION', ageSeconds };
  if (session.phase === 'PRE' || session.phase === 'POST') {
    return { kind: 'EXTENDED_HOURS', ageSeconds };
  }

  const closedFor = session.secondsSinceRegularClose;
  if (closedFor !== null && ageSeconds > closedFor) {
    return {
      kind: 'PREDATES_LAST_CLOSE',
      ageSeconds,
      note: 'This price was read before the most recent close. It has not been refreshed against an open market since.',
    };
  }
  return { kind: 'MARKET_CLOSED', ageSeconds, closedForSeconds: closedFor ?? 0 };
}

export function phaseLabel(phase: SessionPhase): string {
  switch (phase) {
    case 'REGULAR':
      return 'OPEN';
    case 'PRE':
      return 'PRE-MARKET';
    case 'POST':
      return 'AFTER HOURS';
    case 'CLOSED':
      return 'CLOSED';
  }
}
