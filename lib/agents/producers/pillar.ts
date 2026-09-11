/**
 * PILLAR — price feeds and staleness.
 *
 * Every other venue prints a price. This one prints how old it is and what that
 * age means, which needs two facts most systems never put side by side: when the
 * feed last updated, and whether the market it tracks was open at the time.
 *
 *   A crypto feed quiet for six hours is a fault.
 *   An equity feed quiet since Friday is a closed exchange.
 *
 * Same number, opposite meaning. Reporting the age alone tells a reader nothing,
 * which is why this producer reads the session from the same calendar the Bell
 * uses rather than inventing its own.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import type { DeclaredFigure } from '../../doctrine/policy.ts';
import type { ObservationRecord } from '../../store/types.ts';
import { describeAge, isRead, type Reading } from '../../doctrine/reading.ts';
import { activeNetwork } from '../../chain/networks.ts';
import {
  formatAnswer,
  readFeedDecimals,
  readLatestRound,
  readSequencer,
  type RoundData,
} from '../../chain/oracle.ts';
import {
  EQUITY_FEEDS_STATUS,
  FEEDS,
  FEED_COVERAGE,
  SEQUENCER_FEED,
  type FeedRecord,
} from '../../chain/feeds.ts';
import { phaseLabel, readSession } from '../../market/session.ts';

const INTERVAL = 15 * 60;

/** How many crypto feeds to read per run. Reading all eight every quarter hour
 *  is noise; four keeps the report legible and the rotation covers them. */
const FEEDS_PER_RUN = 4;

interface FeedReading {
  readonly feed: FeedRecord;
  readonly round: Reading<RoundData>;
  readonly decimals: Reading<number>;
}

function ageOf(round: RoundData, now: Date): number {
  return Math.max(0, Math.round(now.getTime() / 1000 - Number(round.updatedAt)));
}

export const pillarProducer: Producer = async ({ now }): Promise<ProducerResult> => {
  const network = activeNetwork();
  const session = readSession(now);
  const opts = { intervalSeconds: INTERVAL };

  // Rotate by the quarter-hour so successive runs cover different feeds.
  const slot = Math.floor(now.getTime() / (INTERVAL * 1000)) % FEEDS.length;
  const selected = Array.from({ length: Math.min(FEEDS_PER_RUN, FEEDS.length) }, (_, i) =>
    FEEDS[(slot + i) % FEEDS.length]!,
  );

  const readings: FeedReading[] = await Promise.all(
    selected.map(async (feed) => ({
      feed,
      round: await readLatestRound(feed.proxy, opts),
      decimals: await readFeedDecimals(feed.proxy, opts),
    })),
  );

  const sequencer = await readSequencer(SEQUENCER_FEED.proxy, opts, now);

  const figures: DeclaredFigure[] = [];
  const observations: ObservationRecord[] = [];
  const priced: string[] = [];
  const unreadable: string[] = [];
  let oldestInputAt: Date | null = null;
  let sourcesReached = 0;

  for (const { feed, round, decimals } of readings) {
    if (!isRead(round)) {
      unreadable.push(
        `— ${feed.pair}: ${round.reason}. Reported as unread, not as a price of zero.`,
      );
      continue;
    }
    sourcesReached += 1;
    const at = new Date(round.retrievedAt);
    if (oldestInputAt === null || at < oldestInputAt) oldestInputAt = at;

    // Two distinct failures, kept apart: an answer we cannot scale is not the
    // same as an answer we scaled and then rejected.
    if (!isRead(decimals)) {
      unreadable.push(
        `— ${feed.pair}: the feed answered but its decimals could not be read (${decimals.reason}), so the answer cannot be scaled. No price is shown.`,
      );
      continue;
    }
    const scale = decimals.value;

    // Vendor guidance: reject a zero or negative answer rather than display it.
    const price = formatAnswer(round.value.answer, scale);
    if (price === null) {
      unreadable.push(
        `— ${feed.pair}: the feed returned a non-positive answer, which is rejected rather than displayed.`,
      );
      continue;
    }

    // Keep the sample. Over time these become a series the Surveyor can measure
    // structure from — our own observations at our own rate, never described as
    // exchange daily closes.
    observations.push({
      key: feed.key,
      observedAt: round.retrievedAt,
      value: Number(round.value.answer) / 10 ** scale,
      source: `${network.label} · ${feed.pair} latestRoundData()`,
    });

    const age = ageOf(round.value, now);
    const ageText = describeAge(age);
    figures.push({
      token: price,
      source: `${network.label} · ${feed.pair} latestRoundData()`,
      retrievedAt: round.retrievedAt,
    });
    // Declare the magnitude, not the formatted string. "37m" prints as the
    // number 37 followed by a unit; the gate reads magnitudes, so what gets
    // declared has to be what the gate will see.
    figures.push({
      token: ageText.replace(/[^\d.]/g, ''),
      source: `${network.label} · ${feed.pair} updatedAt`,
      retrievedAt: round.retrievedAt,
    });

    // The judgement. A threshold we do not have is stated, not guessed.
    const verdict =
      feed.heartbeatSeconds === null
        ? 'its published heartbeat was not captured, so this age is reported without a threshold to judge it against'
        : age > feed.heartbeatSeconds
          ? 'past its published heartbeat'
          : 'within its published heartbeat';

    const clock =
      feed.marketHours === 'crypto'
        ? 'This feed follows the crypto clock, which does not close, so age here is not explained by a shut market.'
        : `This feed follows the equity clock, and the exchange is ${phaseLabel(session.phase).toLowerCase()}.`;

    priced.push(`— ${feed.pair}: ${price}, updated ${ageText} ago — ${verdict}. ${clock}`);
  }

  // The session itself is a source, and it always answers.
  sourcesReached += 1;
  if (oldestInputAt === null) oldestInputAt = new Date(session.observedAt);

  if (sourcesReached < 2) {
    // Carry the reasons and whatever was measured. A coverage failure that
    // reports only a count cannot be diagnosed, and samples taken before the
    // failure are still samples.
    return {
      publication: null,
      sourcesReached,
      oldestInputAt,
      observations,
      note: unreadable.join(' ').slice(0, 400) || 'no feed answered and no reason was recorded',
    };
  }

  const capturedFigure = String(FEED_COVERAGE.listedByDirectory);
  figures.push({
    token: capturedFigure,
    source: FEED_COVERAGE.source,
    retrievedAt: FEED_COVERAGE.observedAt,
  });

  const body = [
    'READ',
    ...(priced.length > 0 ? priced : ['— No feed returned a usable price on this run.']),
    '',
    'NOT READ',
    ...(unreadable.length > 0
      ? unreadable
      : ['— Every feed put to the chain on this run answered.']),
    `— Tokenized equity feeds: ${EQUITY_FEEDS_STATUS.reason}`,
    '',
    'WHAT THIS RUN DOES NOT ESTABLISH',
    sequencer.kind === 'NOT_CHECKED'
      ? `— The sequencer was not checked: ${sequencer.reason}. This chain is a Layer 2, and during a sequencer outage a feed can go stale while still returning a value. Not checked is not the same as up.`
      : sequencer.kind === 'DOWN'
        ? '— The sequencer uptime feed reports the sequencer is not up. Prices read during an outage should not be treated as current.'
        : `— The sequencer reports up, ${describeAge(sequencer.sinceSeconds)} since that status began.`,
    `— Feed coverage: the directory lists ${capturedFigure} feeds for this network and this registry holds the ones read by hand. The rest were not captured, and none of them are described here.`,
    '— A feed within its heartbeat is a feed that updated recently. It is not a statement that the value is correct, and nothing here verifies the data behind it.',
  ].join('\n');

  return {
    publication: {
      headline: `FEEDS · ${priced.length} read · ${phaseLabel(session.phase)}`,
      body,
      figures,
      readings: Object.fromEntries(readings.map(({ feed, round }) => [feed.pair, round])),
    },
    sourcesReached,
    oldestInputAt,
    observations,
  };
};
