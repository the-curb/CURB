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
 *
 * Every equity feed is read on every run, in one batched call, together with
 * the issuer's pause flag on the token it prices — because a frozen feed and a
 * paused oracle are the same event seen from two contracts, and only one of
 * them says why. Crypto feeds rotate: they are not what this paper is about.
 *
 * What the equity block prints is the shape of the book, not thirty-five
 * prices: how many answered, the freshest and the oldest, what is past its
 * heartbeat, what is paused, what no longer describes itself as recorded. The
 * prices themselves go to the snapshot and the series, where a page can show
 * them with their age attached.
 */

import type { Producer, ProducerResult } from '../runtime.ts';
import { figuresIn, type DeclaredFigure } from '../../doctrine/policy.ts';
import type { ObservationRecord, SnapshotRecord } from '../../store/types.ts';
import { describeAge, isRead, type Reading } from '../../doctrine/reading.ts';
import { activeNetwork } from '../../chain/networks.ts';
import { readHead } from '../../chain/rpc.ts';
import { SELECTORS } from '../../chain/abi.ts';
import { readMany, type Call } from '../../chain/multicall.ts';
import {
  decodeDecimals,
  decodeDescription,
  decodeFlag,
  decodeRound,
  formatAnswer,
  readSequencer,
  type RoundData,
} from '../../chain/oracle.ts';
import {
  CRYPTO_FEEDS,
  EQUITY_FEEDS,
  FEED_COVERAGE,
  HEAD_STALL_SECONDS,
  SEQUENCER_FEED,
  STOCK_TOKEN_COVERAGE,
  tokenForFeed,
  type FeedRecord,
} from '../../chain/feeds.ts';
import type { StockTokenRecord } from '../../chain/stock-tokens.ts';
import { phaseLabel, readSession, type SessionState } from '../../market/session.ts';

const INTERVAL = 15 * 60;

/** Crypto feeds per run. Every equity feed is read every run; these rotate. */
export const CRYPTO_PER_RUN = 4;

const HOUR = 3600;

/** The raw answers for one feed, before judgement. */
export interface FeedRead {
  readonly feed: FeedRecord;
  readonly token: StockTokenRecord | null;
  readonly round: Reading<RoundData>;
  readonly decimals: Reading<number>;
  readonly description: Reading<string>;
  /** Null when not asked: crypto feeds have no issuer pause flag. */
  readonly oraclePaused: Reading<boolean> | null;
}

export type FeedIdentity = 'MATCHES' | 'DRIFT' | 'UNREAD';
export type PauseFlag = 'SET' | 'CLEAR' | 'UNREAD' | 'NOT_ASKED';

/** One feed, judged. Everything a page or a sentence needs, and nothing inferred. */
export interface FeedVerdict {
  readonly feed: FeedRecord;
  readonly label: string;
  readonly price: string | null;
  readonly raw: bigint | null;
  readonly scale: number | null;
  readonly updatedAt: number | null;
  readonly ageSeconds: number | null;
  readonly pastHeartbeat: boolean | null;
  readonly identity: FeedIdentity;
  readonly observedDescription: string | null;
  readonly pauseFlag: PauseFlag;
  readonly pauseDetail: string | null;
  readonly notPricedBecause: string | null;
  readonly retrievedAt: string | null;
}

function ageOf(updatedAt: bigint, now: Date): number {
  return Math.max(0, Math.round(now.getTime() / 1000 - Number(updatedAt)));
}

/**
 * Judge one feed from its raw answers. Pure, so the rules can be tested with
 * fabricated readings and the same function can never drift from what the
 * snapshot records.
 */
export function judgeFeed(read: FeedRead, now: Date): FeedVerdict {
  const { feed, round, decimals, description, oraclePaused } = read;
  const label = feed.ticker ?? feed.name;

  const identity: FeedIdentity = !isRead(description)
    ? 'UNREAD'
    : description.value === feed.observedDescription
      ? 'MATCHES'
      : 'DRIFT';
  const observedDescription = isRead(description) ? description.value : null;

  const pauseFlag: PauseFlag =
    oraclePaused === null ? 'NOT_ASKED' : !isRead(oraclePaused) ? 'UNREAD' : oraclePaused.value ? 'SET' : 'CLEAR';
  const pauseDetail =
    oraclePaused !== null && !isRead(oraclePaused)
      ? `${oraclePaused.reason}${oraclePaused.detail ? ` — ${oraclePaused.detail}` : ''}`
      : null;

  const base = {
    feed,
    label,
    identity,
    observedDescription,
    pauseFlag,
    pauseDetail,
    retrievedAt: isRead(round) ? round.retrievedAt : null,
  };
  const unpriced = {
    price: null,
    raw: null,
    scale: null,
    updatedAt: null,
    ageSeconds: null,
    pastHeartbeat: null,
  };

  if (!isRead(round)) {
    return {
      ...base,
      ...unpriced,
      notPricedBecause: `${round.reason}${round.detail ? ` — ${round.detail}` : ''}`,
    };
  }
  const updatedAt = Number(round.value.updatedAt);
  const ageSeconds = ageOf(round.value.updatedAt, now);
  const pastHeartbeat = ageSeconds > feed.heartbeatSeconds;
  const timed = { updatedAt, ageSeconds, pastHeartbeat };

  // Two distinct failures, kept apart: an answer we cannot scale is not the
  // same as an answer we scaled and then rejected.
  if (!isRead(decimals)) {
    return {
      ...base,
      ...unpriced,
      ...timed,
      notPricedBecause: `the feed answered but its decimals could not be read (${decimals.reason}), so the answer cannot be scaled`,
    };
  }

  // A proxy that no longer describes itself as it did at capture may point at
  // a different instrument. Its answer is withheld, not relabelled.
  if (identity === 'DRIFT') {
    return {
      ...base,
      ...unpriced,
      ...timed,
      notPricedBecause: `the feed now describes itself as "${observedDescription}", recorded at capture as "${feed.observedDescription}". The price is withheld until the registry is re-captured`,
    };
  }

  // Vendor guidance: reject a zero or negative answer rather than display it.
  const price = formatAnswer(round.value.answer, decimals.value);
  if (price === null) {
    return {
      ...base,
      ...unpriced,
      ...timed,
      notPricedBecause: 'the feed returned a non-positive answer, which is rejected rather than displayed',
    };
  }

  return {
    ...base,
    ...timed,
    price,
    raw: round.value.answer,
    scale: decimals.value,
    notPricedBecause: null,
  };
}

/** The magnitude the gate will see: "17h" declares 17, "3m" declares 3. */
function ageFigure(ageSeconds: number, source: string, retrievedAt: string): DeclaredFigure {
  return { token: describeAge(ageSeconds).replace(/[^\d.]/g, ''), source, retrievedAt };
}

export interface EquitySummary {
  readonly lines: readonly string[];
  readonly figures: readonly DeclaredFigure[];
  readonly literals: readonly string[];
  readonly priced: number;
  readonly answered: number;
}

/**
 * The equity block: the shape of the book in a handful of lines. Every count
 * is a count of our own readings and goes out as an allowed literal; every age
 * and threshold is a measurement and goes out declared with its source.
 */
export function summariseEquity(
  verdicts: readonly FeedVerdict[],
  session: SessionState,
  networkLabel: string,
): EquitySummary {
  const lines: string[] = [];
  const figures: DeclaredFigure[] = [];
  const literals = new Set<string>();
  const literal = (n: number) => {
    literals.add(String(n));
    return String(n);
  };
  const ageOfVerdict = (v: FeedVerdict) => {
    figures.push(ageFigure(v.ageSeconds!, `${networkLabel} · ${v.feed.name} updatedAt`, v.retrievedAt!));
    return describeAge(v.ageSeconds!);
  };

  const answered = verdicts.filter((v) => v.ageSeconds !== null);
  const priced = verdicts.filter((v) => v.price !== null);
  const total = verdicts.length;

  lines.push(
    `— ${literal(answered.length)} of ${literal(total)} tokenized-equity feeds answered; ${literal(priced.length)} ${priced.length === 1 ? "carries" : "carry"} a price this run. The exchange is ${phaseLabel(session.phase).toLowerCase()}.`,
  );

  if (answered.length > 0) {
    const byAge = [...answered].sort((a, b) => a.ageSeconds! - b.ageSeconds!);
    const freshest = byAge[0]!;
    const oldest = byAge[byAge.length - 1]!;
    const heartbeat = oldest.feed.heartbeatSeconds;
    figures.push({
      token: describeAge(heartbeat).replace(/[^\d.]/g, ''),
      source: `${FEED_COVERAGE.directory} · heartbeat`,
      retrievedAt: FEED_COVERAGE.observedAt,
    });
    lines.push(
      `— Freshest: ${freshest.label}, updated ${ageOfVerdict(freshest)} ago. Oldest: ${oldest.label}, updated ${ageOfVerdict(oldest)} ago, ${oldest.pastHeartbeat ? 'past' : 'within'} the published heartbeat of ${describeAge(heartbeat)}.`,
    );

    const older = byAge.filter((v) => v.ageSeconds! > HOUR);
    const within = answered.length - older.length;
    lines.push(
      older.length === 0
        ? `— Every feed that answered updated within the last hour.`
        : `— Updated within the last hour: ${literal(within)}. Older: ${older.map((v) => `${v.label} ${ageOfVerdict(v)}`).join(', ')}.`,
    );

    const stale = answered.filter((v) => v.pastHeartbeat);
    lines.push(
      stale.length === 0
        ? '— Past the published heartbeat: none.'
        : `— Past the published heartbeat: ${stale.map((v) => v.label).join(', ')}. A feed past its heartbeat has not been refreshed within the interval its publisher declares; while the exchange is ${phaseLabel(session.phase).toLowerCase()} that is ${session.phase === 'CLOSED' ? 'consistent with a closed market and is not by itself a fault' : 'not explained by a closed market'}.`,
    );
  }

  const paused = verdicts.filter((v) => v.pauseFlag === 'SET');
  const pauseUnread = verdicts.filter((v) => v.pauseFlag === 'UNREAD');
  lines.push(
    paused.length === 0
      ? `— Issuer oracle pause flag set: none of the ${literal(verdicts.length - pauseUnread.length)} tokens read.`
      : `— Issuer oracle pause flag SET on ${paused.map((v) => v.label).join(', ')}. The feed holds its last value while the flag is set; the flag is advisory and not enforced on chain, so it is reported beside the age, not instead of it.`,
  );
  if (pauseUnread.length > 0) {
    lines.push(
      `— Pause flag not readable for ${pauseUnread.map((v) => v.label).join(', ')}. Not readable is not the same as clear.`,
    );
  }

  const drift = verdicts.filter((v) => v.identity === 'DRIFT');
  const identityUnread = verdicts.filter((v) => v.identity === 'UNREAD');
  if (drift.length > 0) {
    lines.push(
      `— Feed identity CHANGED for ${drift.map((v) => `${v.label} (now "${v.observedDescription}")`).join(', ')}. Their prices are withheld: a proxy that describes itself differently may be pointing at a different instrument.`,
    );
  }
  if (identityUnread.length > 0) {
    lines.push(
      `— Feed identity not re-verified this run for ${identityUnread.map((v) => v.label).join(', ')}: the description call did not answer. Their prices are shown against the identity recorded at capture.`,
    );
  }
  if (drift.length === 0 && identityUnread.length === 0 && answered.length > 0) {
    lines.push('— Every feed read describes itself exactly as it did when the registry was captured.');
  }

  // The same age can be declared from two sentences (the oldest feed is also
  // in the "older than an hour" list). One declaration per figure and source.
  const seen = new Set<string>();
  const distinct = figures.filter((f) => {
    const id = `${f.token}|${f.source}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { lines, figures: distinct, literals: [...literals], priced: priced.length, answered: answered.length };
}

/** What a page needs to show the feed now, with its age attached. */
export function snapshotOf(v: FeedVerdict, session: SessionState, observedAt: string): SnapshotRecord {
  return {
    key: `feed:${v.feed.key}`,
    observedAt,
    payload: {
      key: v.feed.key,
      label: v.label,
      name: v.feed.name,
      marketHours: v.feed.marketHours,
      price: v.price,
      raw: v.raw === null ? null : v.raw.toString(),
      decimals: v.scale,
      updatedAt: v.updatedAt,
      ageSeconds: v.ageSeconds,
      heartbeatSeconds: v.feed.heartbeatSeconds,
      pastHeartbeat: v.pastHeartbeat,
      identity: v.identity,
      pauseFlag: v.pauseFlag,
      notPricedBecause: v.notPricedBecause,
      session: session.phase,
    },
  };
}

/**
 * The shape of the book: everything the equity block would say that is not a
 * clock reading. Two runs with the same shape would file the same filing with
 * different ages in it, and the second is not news. Pure.
 */
export function bookShape(verdicts: readonly FeedVerdict[], session: SessionState, headStalled: boolean | null): string {
  const labels = (rows: readonly FeedVerdict[]) => rows.map((v) => v.label).sort();
  return JSON.stringify({
    phase: session.phase,
    answered: verdicts.filter((v) => v.ageSeconds !== null).length,
    priced: verdicts.filter((v) => v.price !== null).length,
    pastHeartbeat: labels(verdicts.filter((v) => v.pastHeartbeat === true)),
    paused: labels(verdicts.filter((v) => v.pauseFlag === 'SET')),
    pauseUnread: labels(verdicts.filter((v) => v.pauseFlag === 'UNREAD')),
    drift: labels(verdicts.filter((v) => v.identity === 'DRIFT')),
    identityUnread: labels(verdicts.filter((v) => v.identity === 'UNREAD')),
    unread: labels(verdicts.filter((v) => v.price === null)),
    headStalled,
  });
}

/** How long the Pillar may stay quiet on an unchanged book before filing anyway. */
export const REFILE_SECONDS = 6 * 3600;

export const SHAPE_KEY = 'pillar:shape';

export const pillarProducer: Producer = async ({ now, store }): Promise<ProducerResult> => {
  const network = activeNetwork();
  const session = readSession(now);
  const opts = { intervalSeconds: INTERVAL };

  // What the last filing said the book looked like, so this run can tell
  // whether it has anything new to say. Unreadable is treated as unknown,
  // which means file: repeating a filing is a smaller fault than going quiet
  // on a change nobody could compare.
  const priorShape = await store.snapshots(SHAPE_KEY);
  const prior = priorShape.state === 'UNREAD' ? null : (priorShape.value.find((s) => s.key === SHAPE_KEY) ?? null);

  // Rotate the crypto feeds by the quarter-hour so successive runs cover them.
  const slot = Math.floor(now.getTime() / (INTERVAL * 1000)) % CRYPTO_FEEDS.length;
  const crypto = Array.from({ length: Math.min(CRYPTO_PER_RUN, CRYPTO_FEEDS.length) }, (_, i) =>
    CRYPTO_FEEDS[(slot + i) % CRYPTO_FEEDS.length]!,
  );
  const selected = [...EQUITY_FEEDS, ...crypto];

  // One batch: three questions per feed, four when there is a token with a
  // pause flag to ask. Laid out so the answers can be walked back in order.
  const calls: Call[] = [];
  const layout = selected.map((feed) => {
    const token = tokenForFeed(feed);
    const start = calls.length;
    calls.push(
      { target: feed.proxy, data: SELECTORS.latestRoundData },
      { target: feed.proxy, data: SELECTORS.decimals },
      { target: feed.proxy, data: SELECTORS.description },
    );
    if (token !== null) calls.push({ target: token.address, data: SELECTORS.oraclePaused });
    return { feed, token, start };
  });
  const answers = await readMany(calls, opts);

  const reads: FeedRead[] = layout.map(({ feed, token, start }) => ({
    feed,
    token,
    round: decodeRound(answers[start]!),
    decimals: decodeDecimals(answers[start + 1]!),
    description: decodeDescription(answers[start + 2]!),
    oraclePaused: token === null ? null : decodeFlag(answers[start + 3]!, 'oraclePaused()'),
  }));
  const verdicts = reads.map((read) => judgeFeed(read, now));
  const equity = verdicts.filter((v) => v.feed.marketHours === 'equity');
  const cryptoVerdicts = verdicts.filter((v) => v.feed.marketHours === 'crypto');

  const [sequencer, head] = await Promise.all([readSequencer(SEQUENCER_FEED.proxy, opts, now), readHead(opts)]);

  const figures: DeclaredFigure[] = [];
  const literals = new Set<string>();
  const observations: ObservationRecord[] = [];
  const snapshots: SnapshotRecord[] = [];
  const notRead: string[] = [];
  let oldestInputAt: Date | null = null;
  let sourcesReached = 0;

  for (const v of verdicts) {
    snapshots.push(snapshotOf(v, session, now.toISOString()));
    if (v.retrievedAt !== null) {
      sourcesReached += 1;
      const at = new Date(v.retrievedAt);
      if (oldestInputAt === null || at < oldestInputAt) oldestInputAt = at;
    }
    if (v.price !== null && v.raw !== null && v.scale !== null && v.retrievedAt !== null) {
      // Keep the sample. Over time these become a series the Surveyor can
      // measure structure from — our own observations at our own rate, never
      // described as exchange daily closes.
      observations.push({
        key: v.feed.key,
        observedAt: v.retrievedAt,
        value: Number(v.raw) / 10 ** v.scale,
        raw: v.raw.toString(),
        decimals: v.scale,
        source: `${network.label} · ${v.feed.name} latestRoundData()`,
      });
    }
    if (v.notPricedBecause !== null) {
      notRead.push(`— ${v.label}: ${v.notPricedBecause}. Reported as unread, not as a price of zero.`);
    }
  }

  // ── equity: the book, summarised ────────────────────────────────────────────
  const summary = summariseEquity(equity, session, network.label);
  figures.push(...summary.figures);
  for (const l of summary.literals) literals.add(l);

  // ── crypto: the rotation, one line each ─────────────────────────────────────
  const cryptoLines: string[] = [];
  for (const v of cryptoVerdicts) {
    if (v.price === null || v.ageSeconds === null || v.retrievedAt === null) continue;
    figures.push(
      { token: v.price, source: `${network.label} · ${v.feed.name} latestRoundData()`, retrievedAt: v.retrievedAt },
      ageFigure(v.ageSeconds, `${network.label} · ${v.feed.name} updatedAt`, v.retrievedAt),
    );
    cryptoLines.push(
      `— ${v.feed.name}: ${v.price}, updated ${describeAge(v.ageSeconds)} ago — ${v.pastHeartbeat ? 'past' : 'within'} its published heartbeat. This feed follows the crypto clock, which does not close, so age here is not explained by a shut market.`,
    );
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
      snapshots,
      note: notRead.join(' ').slice(0, 400) || 'no feed answered and no reason was recorded',
    };
  }

  // What the chain itself says about being alive: the head and its age. Not a
  // sequencer check — there is no feed for that here — but a head that has
  // stopped advancing is what an outage looks like from this side.
  let liveness: string;
  if (isRead(head)) {
    const headAge = Math.max(0, Math.round(now.getTime() / 1000 - head.value.timestamp));
    const headSource = `${network.label} · eth_getBlockByNumber latest`;
    figures.push(
      { token: head.value.number.toLocaleString('en-US'), source: headSource, retrievedAt: head.retrievedAt },
      ageFigure(headAge, `${headSource} · timestamp`, head.retrievedAt),
    );
    snapshots.push({
      key: 'chain:head',
      observedAt: now.toISOString(),
      payload: { number: head.value.number, timestamp: head.value.timestamp, ageSeconds: headAge, stalled: headAge > HEAD_STALL_SECONDS, retrievedAt: head.retrievedAt },
    });
    liveness =
      headAge > HEAD_STALL_SECONDS
        ? `— What the chain itself says: its head is block ${head.value.number.toLocaleString('en-US')}, timestamped ${describeAge(headAge)} ago. Blocks arrive every tenth of a second here, so a head this old is the chain not producing, and every feed age above should be read with that in mind.`
        : `— What the chain itself says: its head is block ${head.value.number.toLocaleString('en-US')}, timestamped ${describeAge(headAge)} ago. Blocks being produced is not the same claim as the sequencer being healthy; it is the one liveness signal this chain offers, and it is offered as that.`;
  } else {
    liveness = `— The chain head could not be read (${head.reason}), so nothing is said about whether blocks are being produced. That is an absence, not a stall.`;
  }

  // A failure line carries whatever the source said, and what a source says can
  // hold a number: "HTTP 429", "exceeds limit of 10000". Printing it undeclared
  // blocks the whole filing. Those numbers came from that source, at this run;
  // they are declared as such, and the gate agrees.
  for (const line of notRead) figures.push(...figuresIn(line, `${network.label} · as reported in a refusal`, now.toISOString()));

  const directoryCount = String(FEED_COVERAGE.listedByDirectory);
  const tokenCount = String(STOCK_TOKEN_COVERAGE.tokensInRegistry);
  const withoutFeed = String(STOCK_TOKEN_COVERAGE.withoutFeed);
  figures.push(
    { token: directoryCount, source: FEED_COVERAGE.directory, retrievedAt: FEED_COVERAGE.observedAt },
    { token: tokenCount, source: STOCK_TOKEN_COVERAGE.registry, retrievedAt: STOCK_TOKEN_COVERAGE.observedAt },
    { token: withoutFeed, source: STOCK_TOKEN_COVERAGE.registry, retrievedAt: STOCK_TOKEN_COVERAGE.observedAt },
  );
  const notInRotation = CRYPTO_FEEDS.length - crypto.length;
  literals.add(String(CRYPTO_FEEDS.length));
  literals.add(String(crypto.length));
  literals.add(String(notInRotation));
  literals.add(String(equity.length));

  const body = [
    'EQUITY',
    ...summary.lines,
    '',
    `CRYPTO · ${crypto.length} of ${CRYPTO_FEEDS.length} feeds in this run's rotation`,
    ...(cryptoLines.length > 0 ? cryptoLines : ['— No crypto feed in this rotation returned a usable price.']),
    '',
    'NOT READ',
    ...(notRead.length > 0 ? notRead : ['— Every feed put to the chain on this run answered with a usable price.']),
    ...(notInRotation > 0 ? [`— ${notInRotation} crypto feeds were not in this run's rotation and are not described here.`] : []),
    '',
    'WHAT THIS RUN DOES NOT ESTABLISH',
    sequencer.kind === 'NOT_CHECKED'
      ? `— ${SEQUENCER_FEED.proxy === null ? `The sequencer: ${SEQUENCER_FEED.reason}` : `The sequencer was not checked: ${sequencer.reason}`}. This chain is a Layer 2, and during a sequencer outage a feed can go stale while still returning a value.`
      : sequencer.kind === 'DOWN'
        ? '— The sequencer uptime feed reports the sequencer is not up. Prices read during an outage should not be treated as current.'
        : `— The sequencer reports up, ${describeAge(sequencer.sinceSeconds)} since that status began.`,
    liveness,
    `— Coverage: the vendor directory lists ${directoryCount} feeds for this network and every one is in this registry. The issuer's registry lists ${tokenCount} stock tokens on this chain, of which ${withoutFeed} have no feed this system can read: their prices are not stated anywhere here.`,
    '— A feed within its heartbeat is a feed that updated recently. It is not a statement that the value is correct, and nothing here verifies the data behind it.',
  ].join('\n');

  const readings = Object.fromEntries(reads.map((r) => [r.feed.name, r.round]));

  // ── is there anything new to say? ──────────────────────────────────────────
  // The snapshot and the series were written for this run whatever the answer.
  // A filing goes out when the shape changed, when there is no prior shape to
  // compare with, or when the last filing is old enough that the paper should
  // carry one anyway.
  const shape = bookShape(equity, session, isRead(head) ? Math.round(now.getTime() / 1000 - head.value.timestamp) > HEAD_STALL_SECONDS : null);
  const priorShapeText = prior && typeof prior.payload.shape === 'string' ? prior.payload.shape : null;
  const priorFiledAt = prior && typeof prior.payload.filedAt === 'string' ? new Date(prior.payload.filedAt) : null;
  const sinceFiled = priorFiledAt === null ? null : Math.round((now.getTime() - priorFiledAt.getTime()) / 1000);
  const unchanged = priorShapeText === shape && sinceFiled !== null && sinceFiled < REFILE_SECONDS;

  if (unchanged) {
    // Keep the shape's filedAt as it was: the clock on "when did we last file" runs from the filing, not from this quiet run.
    snapshots.push({ key: SHAPE_KEY, observedAt: now.toISOString(), payload: { shape, filedAt: priorFiledAt!.toISOString() } });
    return {
      publication: null,
      sourcesReached,
      oldestInputAt,
      observations,
      snapshots,
      note: `the book is unchanged in shape since the filing ${describeAge(sinceFiled!)} ago; the snapshot and the series were updated, and nothing new was said`,
    };
  }
  snapshots.push({ key: SHAPE_KEY, observedAt: now.toISOString(), payload: { shape, filedAt: now.toISOString() } });

  return {
    publication: {
      headline: `FEEDS · ${summary.answered} of ${equity.length} equity · ${cryptoLines.length} crypto · ${phaseLabel(session.phase)}`,
      body,
      figures,
      readings,
      allowedLiterals: [...literals, String(summary.answered), String(cryptoLines.length)],
    },
    sourcesReached,
    oldestInputAt,
    observations,
    snapshots,
  };
};
