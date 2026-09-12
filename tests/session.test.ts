import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { describePriceAge, readSession } from '../lib/market/session.ts';

/**
 * The session calendar is the one module where a silent error is worst: it would
 * not throw, it would just quietly describe a shut market as an open one.
 *
 * 2026 reference weekdays used below (verified, not assumed):
 *   Jan 1 Thu · Apr 3 Fri · Jun 19 Fri · Jul 3 Fri · Jul 4 Sat
 *   Nov 26 Thu · Nov 27 Fri · Dec 24 Thu · Dec 25 Fri
 * US DST 2026 runs 8 March to 1 November, so EST is UTC-5 and EDT is UTC-4.
 */

const at = (iso: string) => new Date(iso);

describe('regular sessions', () => {
  it('opens at 14:30 UTC in winter (EST)', () => {
    const s = readSession(at('2026-01-14T15:00:00Z'));
    assert.equal(s.phase, 'REGULAR');
    assert.equal(s.calendarDay, '2026-01-14');
    assert.equal(s.regularOpenUtc, '2026-01-14T14:30:00.000Z');
    assert.equal(s.regularCloseUtc, '2026-01-14T21:00:00.000Z');
  });

  it('opens at 13:30 UTC in summer (EDT)', () => {
    const s = readSession(at('2026-07-08T14:00:00Z'));
    assert.equal(s.phase, 'REGULAR');
    assert.equal(s.regularOpenUtc, '2026-07-08T13:30:00.000Z');
    assert.equal(s.regularCloseUtc, '2026-07-08T20:00:00.000Z');
  });

  it('walks pre → regular → post → closed across one winter day', () => {
    assert.equal(readSession(at('2026-01-14T13:00:00Z')).phase, 'PRE'); // 08:00 ET
    assert.equal(readSession(at('2026-01-14T15:00:00Z')).phase, 'REGULAR'); // 10:00 ET
    assert.equal(readSession(at('2026-01-14T21:30:00Z')).phase, 'POST'); // 16:30 ET
    assert.equal(readSession(at('2026-01-15T02:00:00Z')).phase, 'CLOSED'); // 21:00 ET
  });

  it('is closed before the pre-market bell', () => {
    // 03:00 ET, an hour before pre-market opens at 04:00 ET.
    assert.equal(readSession(at('2026-01-14T08:00:00Z')).phase, 'CLOSED');
  });

  it('reports no time since close while the market is open', () => {
    const s = readSession(at('2026-01-14T15:00:00Z'));
    assert.equal(s.secondsSinceRegularClose, null);
  });
});

describe('weekends', () => {
  it('is not a trading day on Saturday', () => {
    const s = readSession(at('2026-01-17T15:00:00Z'));
    assert.equal(s.phase, 'CLOSED');
    assert.equal(s.isTradingDay, false);
    assert.equal(s.holiday, 'Weekend');
  });

  it('skips a holiday Monday when looking for the next open', () => {
    // Saturday 17 January 2026. The following Monday is MLK Day, so the next
    // regular open is the Tuesday — the walk-forward has to step over both.
    const s = readSession(at('2026-01-17T15:00:00Z'));
    assert.equal(s.nextRegularOpenUtc, '2026-01-20T14:30:00.000Z');
  });

  it('points at the next weekday open when no holiday intervenes', () => {
    // Saturday 24 January 2026 — the Monday after is an ordinary trading day.
    const s = readSession(at('2026-01-24T15:00:00Z'));
    assert.equal(s.nextRegularOpenUtc, '2026-01-26T14:30:00.000Z');
  });
});

describe('holidays', () => {
  const cases: readonly [string, string][] = [
    ['2026-01-01T15:00:00Z', "New Year's Day"],
    ['2026-01-19T15:00:00Z', 'Martin Luther King, Jr. Day'],
    ['2026-02-16T15:00:00Z', "Washington's Birthday"],
    ['2026-04-03T15:00:00Z', 'Good Friday'],
    ['2026-05-25T15:00:00Z', 'Memorial Day'],
    ['2026-06-19T15:00:00Z', 'Juneteenth National Independence Day'],
    ['2026-09-07T15:00:00Z', 'Labor Day'],
    ['2026-11-26T15:00:00Z', 'Thanksgiving Day'],
    ['2026-12-25T15:00:00Z', 'Christmas Day'],
  ];

  for (const [instant, label] of cases) {
    it(`closes for ${label}`, () => {
      const s = readSession(at(instant));
      assert.equal(s.isTradingDay, false, `${label} should not be a trading day`);
      assert.equal(s.holiday, label);
      assert.equal(s.phase, 'CLOSED');
    });
  }

  it('observes Independence Day on Friday when 4 July is a Saturday', () => {
    // 4 July 2026 is a Saturday, so the exchange closes on Friday 3 July.
    const observed = readSession(at('2026-07-03T15:00:00Z'));
    assert.equal(observed.holiday, 'Independence Day');
    assert.equal(observed.isTradingDay, false);
  });

  it('does not treat the observed holiday as an early close', () => {
    // The 3 July half-day only applies when 3 July is itself a trading day.
    const s = readSession(at('2026-07-03T15:00:00Z'));
    assert.equal(s.earlyClose, false);
  });
});

describe('early closes', () => {
  it('closes at 13:00 ET on the day after Thanksgiving', () => {
    const s = readSession(at('2026-11-27T15:00:00Z'));
    assert.equal(s.isTradingDay, true);
    assert.equal(s.earlyClose, true);
    assert.equal(s.regularCloseUtc, '2026-11-27T18:00:00.000Z'); // 13:00 EST
  });

  it('is already closed at 14:00 ET on a half day', () => {
    assert.equal(readSession(at('2026-11-27T19:00:00Z')).phase, 'POST');
  });

  it('closes early on Christmas Eve when it is a weekday', () => {
    const s = readSession(at('2026-12-24T15:00:00Z'));
    assert.equal(s.isTradingDay, true);
    assert.equal(s.earlyClose, true);
  });
});

describe('price age against the session', () => {
  it('calls a price taken before the last close what it is', () => {
    // Read Friday morning; asked about it on Sunday.
    const verdict = describePriceAge(
      at('2026-01-16T15:00:00Z'),
      readSession(at('2026-01-18T12:00:00Z')),
      at('2026-01-18T12:00:00Z'),
    );
    assert.equal(verdict.kind, 'PREDATES_LAST_CLOSE');
  });

  it('calls a price from before the last close what it is in the pre-market and the post-market too', () => {
    // Read Thursday at noon; asked in Friday's pre-market and again in Friday's post-market, after the Friday session it never saw.
    const preMarket = at('2026-01-16T13:00:00Z'); // 08:00 ET, a trading day
    const pre = describePriceAge(at('2026-01-15T17:00:00Z'), readSession(preMarket), preMarket);
    assert.equal(pre.kind, 'PREDATES_LAST_CLOSE');
    const postMarket = at('2026-01-16T22:00:00Z'); // 17:00 ET
    const post = describePriceAge(at('2026-01-15T17:00:00Z'), readSession(postMarket), postMarket);
    assert.equal(post.kind, 'PREDATES_LAST_CLOSE');
    // A price read during Friday's session, asked in Friday's post-market: extended hours, and fresh enough to be called so.
    const fresh = describePriceAge(at('2026-01-16T21:30:00Z'), readSession(postMarket), postMarket); // read after the close, in the post-market itself
    assert.equal(fresh.kind, 'EXTENDED_HOURS');
  });

  it('reports an unread price as absent rather than old', () => {
    assert.equal(describePriceAge(null).kind, 'NO_PRICE_READ');
  });

  it('calls a live price in-session', () => {
    const now = at('2026-01-14T15:00:00Z');
    const verdict = describePriceAge(at('2026-01-14T14:59:00Z'), readSession(now), now);
    assert.equal(verdict.kind, 'IN_SESSION');
  });
});
