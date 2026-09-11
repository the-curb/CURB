/**
 * THE SURVEYOR — market structure, on request.
 *
 * Two things about the series it measures, stated here because they must never
 * be quietly forgotten downstream:
 *
 *   1. These are OUR OWN samples of a price feed, taken when the Pillar ran.
 *      They are not exchange daily closes and are never described as such.
 *   2. The samples are irregularly spaced. Annualising a dispersion assumes a
 *      sampling rate, so the rate is derived from the observed timestamps rather
 *      than assumed — and the derivation is published alongside the figure.
 *
 * Every figure is independently nullable. A series long enough for a range but
 * too short for a trend reports the range and an absence, not a plausible number.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import type { ObservationRecord } from '../../store/types.ts';
import { describeAge } from '../../doctrine/reading.ts';
import { FEEDS } from '../../chain/feeds.ts';
import { MINIMUMS, readStructure } from '../../market/structure.ts';
import { describeRetention, OBSERVATION_RETENTION_DAYS } from '../../store/retention.ts';

const SHORT_WINDOW = 24;
const LONG_WINDOW = 120;
const SECONDS_PER_YEAR = 365 * 24 * 3600;

/** The middle gap between samples. The median, not the mean: one long outage
 *  would drag a mean far enough to misstate the annualisation. */
function medianSpacingSeconds(series: readonly ObservationRecord[]): number | null {
  if (series.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const gap =
      (new Date(series[i]!.observedAt).getTime() - new Date(series[i - 1]!.observedAt).getTime()) /
      1000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[middle - 1]! + gaps[middle]!) / 2 : gaps[middle]!;
}

function round(value: number, places: number): string {
  return value.toFixed(places);
}

export const surveyorProducer: Producer = async ({ store }): Promise<ProducerResult> => {
  // Measure whichever feed has the deepest series; a thin one tells us nothing
  // and picking a favourite would hide that.
  const read = await Promise.all(
    FEEDS.map(async (feed) => ({ feed, reading: await store.observations(feed.key, LONG_WINDOW) })),
  );

  // If no series could be read at all, that is an unreadable store, not a token
  // that has never been sampled. Structure is not computed from an absence.
  const unreadable = read.filter((r) => r.reading.state === 'UNREAD');
  if (unreadable.length === read.length) {
    const first = unreadable[0]?.reading;
    return {
      publication: null,
      sourcesReached: 0,
      oldestInputAt: null,
      note:
        first && first.state === 'UNREAD'
          ? `no observation series could be read (${first.reason}), so nothing was computed`
          : 'no observation series could be read, so nothing was computed',
    };
  }

  const candidates = read
    .filter((r) => r.reading.state !== 'UNREAD')
    .map((r) => ({ feed: r.feed, series: r.reading.value ?? [] }));
  const deepest = candidates.sort((a, b) => b.series.length - a.series.length)[0];

  if (!deepest || deepest.series.length === 0) {
    return { publication: null, sourcesReached: 0, oldestInputAt: null };
  }

  const { feed, series } = deepest;
  const closes = series.map((o) => o.value);
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const oldestInputAt = new Date(first.observedAt);

  const spacing = medianSpacingSeconds(series);
  const periodsPerYear = spacing === null ? null : SECONDS_PER_YEAR / spacing;

  const structure = readStructure(closes, {
    shortWindow: SHORT_WINDOW,
    longWindow: LONG_WINDOW,
    // When spacing cannot be derived, annualisation is not attempted: passing a
    // made-up rate would produce a volatility figure that looks measured.
    periodsPerYear: periodsPerYear ?? Number.NaN,
  });

  const figures: DeclaredFigure[] = [];
  const declare = (token: string) =>
    figures.push({ token, source: last.source, retrievedAt: last.observedAt });

  const observedCount = String(series.length);
  declare(observedCount);

  const measured: string[] = [];
  const absent: string[] = [];

  // The age of the earliest sample is itself a measurement, so it carries
  // provenance like every other number here.
  const spanText = describeAge(Math.round((Date.now() - oldestInputAt.getTime()) / 1000));
  declare(spanText.replace(/[^\d.]/g, ''));
  measured.push(
    `— Series: ${observedCount} observations of ${feed.name}, the earliest taken ${spanText} ago.`,
  );

  if (periodsPerYear === null || !Number.isFinite(periodsPerYear)) {
    absent.push(
      '— Annualised volatility: the spacing between samples could not be derived, so no annualisation was attempted. A rate we do not know is not replaced with one we assume.',
    );
  } else {
    const spacingText = describeAge(Math.round(spacing!));
    measured.push(
      `— Sampling: the median gap between observations is ${spacingText}, and every annualised figure below is scaled on that observed rate rather than an assumed one.`,
    );
    declare(spacingText.replace(/[^\d.]/g, ''));
  }

  if (structure.volatilityLong === null) {
    absent.push(
      `— Realised volatility: below the stated minimum of ${MINIMUMS.volatility} returns, so it is not declared. A dispersion computed from fewer samples is mostly an artefact of the sample.`,
    );
  } else {
    const vol = round(structure.volatilityLong, 1);
    declare(vol);
    measured.push(`— Realised volatility, annualised on the observed sampling rate: ${vol} percent.`);
  }

  if (structure.trendLong === null) {
    absent.push(
      `— Trend strength: below the stated minimum of ${MINIMUMS.trend} observations. A slope through fewer points is a line through noise.`,
    );
  } else {
    const strength = round(structure.trendLong.strength, 2);
    declare(strength);
    measured.push(
      `— Trend strength over the long window: ${strength}. The sign is the direction; the magnitude is how far the move stands out of the noise, normalised on the dispersion of the residuals rather than reported as a raw slope.`,
    );
  }

  if (structure.rsi14 === null) {
    absent.push(`— RSI(14): the series is shorter than the window the index needs.`);
  } else {
    const value = round(structure.rsi14, 1);
    declare(value);
    measured.push(`— RSI(14): ${value}.`);
  }

  if (structure.range === null) {
    absent.push('— Range position: too few observations to bound a range.');
  } else {
    const pct = round(structure.range.percent, 1);
    declare(pct);
    measured.push(`— The last observation sits ${pct} percent of the way up the observed range.`);
  }

  const agreementLine =
    structure.agreement === 'UNDETERMINED'
      ? '— Window agreement: one of the two windows could not be measured, so the windows are not compared. Undetermined is not the same as agreeing.'
      : structure.agreement === 'CONFLICT'
        ? '— Window agreement: the two windows disagree. That is a finding, not a failure — it is exactly the state a single-window reading hides.'
        : `— Window agreement: both windows point the same way (${structure.agreement.replace('ALIGNED_', '').toLowerCase()}).`;

  const body = [
    'MEASURED',
    ...measured,
    agreementLine,
    '',
    'NOT DECLARED',
    ...(absent.length > 0 ? absent : ['— Every figure this window supports was computed.']),
    '',
    'WHAT THIS IS NOT',
    '— These are our own samples of a price feed, taken when the Pillar ran. They are not exchange daily closes, and a figure computed from them describes the feed, not the underlying session.',
    `— ${describeRetention()}`,
    '— No entry, no stop, no target. This is a measurement method, not a trading method: it contains no rule for sizing a position and nothing here allocates capital.',
  ].join('\n');

  return {
    publication: {
      headline: `STRUCTURE · ${feed.name} · ${observedCount} observations`,
      body,
      figures,
      // 14 in "RSI(14)" names the index, and the minimums name our own rules.
      allowedLiterals: [
        '14',
        String(MINIMUMS.volatility),
        String(MINIMUMS.trend),
        String(OBSERVATION_RETENTION_DAYS),
      ],
    },
    sourcesReached: 1,
    oldestInputAt,
  };
};
