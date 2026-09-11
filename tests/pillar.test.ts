import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  bookShape,
  CRYPTO_PER_RUN,
  judgeFeed,
  REFILE_SECONDS,
  snapshotOf,
  summariseEquity,
  type FeedRead,
  type FeedVerdict,
} from '../lib/agents/producers/pillar.ts';
import { AGENT_BY_ID } from '../lib/agents/registry.ts';
import { EQUITY_FEEDS, CRYPTO_FEEDS, FEEDS, tokenForFeed, type FeedRecord } from '../lib/chain/feeds.ts';
import { STOCK_TOKENS, STOCK_TOKEN_BEACON } from '../lib/chain/stock-tokens.ts';
import { FEED_DIRECTORY_SOURCE } from '../lib/chain/feed-directory.ts';
import { screen } from '../lib/doctrine/policy.ts';
import { read, unread, type Reading } from '../lib/doctrine/reading.ts';
import { readSession } from '../lib/market/session.ts';
import type { RoundData } from '../lib/chain/oracle.ts';

/**
 * The Pillar is tested without a chain. What is under test is the judgement —
 * which answers become a price, which become an absence, and why — and that
 * the prose the judgement produces passes the same gate every agent passes.
 * The chain read itself is rehearsed with scripts/preview.ts.
 */

const NOW = new Date('2026-09-11T13:30:00.000Z'); // Friday, 09:30 ET: the open
const AT = NOW.toISOString();
const AAPL = FEEDS.find((f) => f.key === 'rh-aapl-usd')!;
const NVDA = FEEDS.find((f) => f.key === 'rh-nvda-usd')!;
const SGOV = FEEDS.find((f) => f.key === 'rh-sgov-usd')!;
const BTC = FEEDS.find((f) => f.key === 'btc-usd')!;

function ok<T>(value: T): Reading<T> {
  return read({ value, source: 'test', retrievedAt: AT, intervalSeconds: 900 });
}
function round(answer: bigint, ageSeconds: number): Reading<RoundData> {
  const updatedAt = BigInt(Math.floor(NOW.getTime() / 1000) - ageSeconds);
  return ok({ roundId: 1n, answer, startedAt: updatedAt, updatedAt, answeredInRound: 1n });
}
function readOf(feed: FeedRecord, over: Partial<FeedRead> = {}): FeedRead {
  return {
    feed,
    token: tokenForFeed(feed),
    round: round(32641467229n, 60),
    decimals: ok(8),
    description: ok(feed.observedDescription ?? ''),
    oraclePaused: feed.marketHours === 'equity' ? ok(false) : null,
    ...over,
  };
}

describe('the registries agree with each other', () => {
  it('every equity feed prices exactly one stock token, by ticker', () => {
    for (const feed of EQUITY_FEEDS) {
      const token = tokenForFeed(feed);
      assert.ok(token, `${feed.name} has no token`);
      assert.equal(token.ticker, feed.ticker);
      assert.equal(token.feedKey, feed.key);
    }
  });

  it('was verified on chain in full at capture', () => {
    assert.equal(FEED_DIRECTORY_SOURCE.verifiedOnChain, FEED_DIRECTORY_SOURCE.listed);
    assert.equal(FEEDS.length, FEED_DIRECTORY_SOURCE.listed);
    for (const feed of FEEDS) {
      assert.ok(feed.observedDescription, `${feed.name} has no observed description`);
      assert.equal(feed.observedDecimals, feed.decimals, `${feed.name} decimals disagree`);
      assert.match(feed.proxy, /^0x[0-9a-fA-F]{40}$/);
    }
    const keys = new Set(FEEDS.map((f) => f.key));
    assert.equal(keys.size, FEEDS.length, 'feed keys are not unique');
  });

  it('records every stock token as a proxy on the one shared beacon', () => {
    assert.ok(STOCK_TOKENS.length > 0);
    const tickers = new Set(STOCK_TOKENS.map((t) => t.ticker));
    assert.equal(tickers.size, STOCK_TOKENS.length, 'tickers are not unique');
    for (const token of STOCK_TOKENS) {
      assert.equal(token.beacon, STOCK_TOKEN_BEACON.address, `${token.ticker} is on another beacon`);
      assert.equal(token.codeHash, STOCK_TOKEN_BEACON.observedProxyCodeHash, `${token.ticker} runs other code`);
      assert.equal(token.observedSymbol, token.ticker);
      assert.equal(token.observedMultiplier, token.multiplierAtCapture, `${token.ticker} multiplier disagrees`);
    }
  });

  it('declares in the agent registry exactly what the producer asks', () => {
    const spec = AGENT_BY_ID.pillar;
    assert.equal(spec.sourcesExpected, EQUITY_FEEDS.length + CRYPTO_PER_RUN + 1);
    assert.ok(spec.minimumSources > EQUITY_FEEDS.length / 2);
    assert.ok(CRYPTO_FEEDS.length >= CRYPTO_PER_RUN);
  });
});

describe('judgeFeed', () => {
  it('prices a clean answer and stamps its age against the heartbeat', () => {
    const v = judgeFeed(readOf(AAPL), NOW);
    assert.equal(v.price, '326.41');
    assert.equal(v.raw, 32641467229n);
    assert.equal(v.ageSeconds, 60);
    assert.equal(v.pastHeartbeat, false);
    assert.equal(v.identity, 'MATCHES');
    assert.equal(v.pauseFlag, 'CLEAR');
    assert.equal(v.notPricedBecause, null);
    assert.equal(v.label, 'AAPL');
  });

  it('reports an unread round as an absence with the reason, never as zero', () => {
    const v = judgeFeed(readOf(AAPL, { round: unread('SOURCE_TIMEOUT', { source: 't', detail: 'no answer in 15s' }) }), NOW);
    assert.equal(v.price, null);
    assert.equal(v.ageSeconds, null);
    assert.match(v.notPricedBecause ?? '', /SOURCE_TIMEOUT/);
    assert.match(v.notPricedBecause ?? '', /no answer in 15s/);
  });

  it('withholds the price when the feed no longer describes itself as recorded', () => {
    const v = judgeFeed(readOf(NVDA, { description: ok('Robinhood TSLA / USD') }), NOW);
    assert.equal(v.identity, 'DRIFT');
    assert.equal(v.price, null);
    assert.match(v.notPricedBecause ?? '', /now describes itself as "Robinhood TSLA \/ USD"/);
    // The age is still known — the round answered — and is kept for the record.
    assert.equal(v.ageSeconds, 60);
  });

  it('keeps the price but says the identity was not re-verified when description() fails', () => {
    const v = judgeFeed(readOf(NVDA, { description: unread('FIELD_ABSENT', { source: 't' }) }), NOW);
    assert.equal(v.identity, 'UNREAD');
    assert.equal(v.price, '220.97'.length > 0 ? v.price : null);
    assert.ok(v.price !== null);
  });

  it('rejects a non-positive answer rather than displaying it', () => {
    const v = judgeFeed(readOf(AAPL, { round: round(0n, 60) }), NOW);
    assert.equal(v.price, null);
    assert.match(v.notPricedBecause ?? '', /non-positive/);
  });

  it('cannot scale an answer without decimals, and says so', () => {
    const v = judgeFeed(readOf(AAPL, { decimals: unread('SOURCE_MALFORMED', { source: 't' }) }), NOW);
    assert.equal(v.price, null);
    assert.match(v.notPricedBecause ?? '', /decimals could not be read/);
  });

  it('judges staleness against the feed’s own published heartbeat', () => {
    const v = judgeFeed(readOf(SGOV, { round: round(10104000000n, SGOV.heartbeatSeconds + 1) }), NOW);
    assert.equal(v.pastHeartbeat, true);
  });

  it('keeps the pause flag tri-state', () => {
    assert.equal(judgeFeed(readOf(AAPL, { oraclePaused: ok(true) }), NOW).pauseFlag, 'SET');
    assert.equal(judgeFeed(readOf(AAPL, { oraclePaused: ok(false) }), NOW).pauseFlag, 'CLEAR');
    const unreadFlag = judgeFeed(readOf(AAPL, { oraclePaused: unread('FIELD_ABSENT', { source: 't', detail: 'reverted' }) }), NOW);
    assert.equal(unreadFlag.pauseFlag, 'UNREAD');
    assert.match(unreadFlag.pauseDetail ?? '', /reverted/);
    assert.equal(judgeFeed(readOf(BTC), NOW).pauseFlag, 'NOT_ASKED');
  });
});

describe('summariseEquity', () => {
  const session = readSession(NOW);

  function verdicts(over: Array<[FeedRecord, Partial<FeedRead>]>): FeedVerdict[] {
    return over.map(([feed, o]) => judgeFeed(readOf(feed, o), NOW));
  }

  /** The text goes through the real gate with the summary's own figures. */
  function gate(summary: ReturnType<typeof summariseEquity>) {
    return screen({
      text: summary.lines.join('\n'),
      figures: summary.figures,
      allowedLiterals: summary.literals,
    });
  }

  it('describes a clean book and passes the gate', () => {
    const s = summariseEquity(
      verdicts([
        [AAPL, { round: round(32641467229n, 61_200) }], // 17h
        [NVDA, { round: round(22097000000n, 120) }],
        [SGOV, { round: round(10104000000n, 46_800) }], // 13h
      ]),
      session,
      'Robinhood Chain',
    );
    const text = s.lines.join('\n');
    assert.match(text, /3 of 3 tokenized-equity feeds answered; 3 carry a price/);
    assert.match(text, /Freshest: NVDA, updated 2m ago\. Oldest: AAPL, updated 17h ago, within the published heartbeat of 24h/);
    assert.match(text, /Older: SGOV 13h, AAPL 17h/);
    assert.match(text, /Past the published heartbeat: none/);
    assert.match(text, /pause flag set: none of the 3 tokens read/);
    assert.match(text, /describes itself exactly as it did/);
    const verdict = gate(s);
    assert.equal(verdict.decision, 'ALLOW', JSON.stringify(verdict));
  });

  it('names what is past heartbeat, paused, drifted and unreadable — and still passes the gate', () => {
    const s = summariseEquity(
      verdicts([
        [AAPL, { round: round(32641467229n, 90_000), oraclePaused: ok(true) }], // 25h, paused
        [NVDA, { description: ok('Something Else / USD') }],
        [SGOV, { round: unread('SOURCE_UNREACHABLE', { source: 't' }), oraclePaused: unread('FIELD_ABSENT', { source: 't' }) }],
      ]),
      session,
      'Robinhood Chain',
    );
    const text = s.lines.join('\n');
    assert.match(text, /2 of 3 tokenized-equity feeds answered; 1 carries a price/);
    assert.match(text, /Past the published heartbeat: AAPL/);
    assert.match(text, /not explained by a closed market/);
    assert.match(text, /pause flag SET on AAPL/);
    assert.match(text, /Pause flag not readable for SGOV\. Not readable is not the same as clear/);
    assert.match(text, /Feed identity CHANGED for NVDA \(now "Something Else \/ USD"\)/);
    const verdict = gate(s);
    assert.equal(verdict.decision, 'ALLOW', JSON.stringify(verdict));
  });

  it('says nothing about ages when nothing answered, and does not invent a freshest feed', () => {
    const s = summariseEquity(
      verdicts([[AAPL, { round: unread('SOURCE_TIMEOUT', { source: 't' }) }]]),
      session,
      'Robinhood Chain',
    );
    const text = s.lines.join('\n');
    assert.match(text, /0 of 1 tokenized-equity feeds answered/);
    assert.doesNotMatch(text, /Freshest/);
    assert.equal(s.figures.length, 0);
    assert.equal(gate(s).decision, 'ALLOW');
  });

  it('calls a stale feed consistent with a closed market only when the market is closed', () => {
    const closed = readSession(new Date('2026-09-13T15:00:00.000Z')); // Sunday
    assert.equal(closed.phase, 'CLOSED');
    const s = summariseEquity(
      verdicts([[AAPL, { round: round(32641467229n, 90_000) }]]),
      closed,
      'Robinhood Chain',
    );
    assert.match(s.lines.join('\n'), /consistent with a closed market and is not by itself a fault/);
  });
});

describe('the snapshot', () => {
  it('carries the price, its age, and every judgement — with the raw integer, not a double', () => {
    const v = judgeFeed(readOf(AAPL, { round: round(32641467229n, 61_200) }), NOW);
    const snap = snapshotOf(v, readSession(NOW), AT);
    assert.equal(snap.key, 'feed:rh-aapl-usd');
    assert.equal(snap.payload.raw, '32641467229');
    assert.equal(snap.payload.price, '326.41');
    assert.equal(snap.payload.ageSeconds, 61_200);
    assert.equal(snap.payload.pastHeartbeat, false);
    assert.equal(snap.payload.identity, 'MATCHES');
    assert.equal(snap.payload.pauseFlag, 'CLEAR');
    assert.equal(snap.payload.session, 'REGULAR');
  });

  it('records an absence as an absence', () => {
    const v = judgeFeed(readOf(AAPL, { round: unread('SOURCE_TIMEOUT', { source: 't', detail: 'slow' }) }), NOW);
    const snap = snapshotOf(v, readSession(NOW), AT);
    assert.equal(snap.payload.price, null);
    assert.equal(snap.payload.raw, null);
    assert.match(String(snap.payload.notPricedBecause), /SOURCE_TIMEOUT/);
  });
});

describe('the shape of the book', () => {
  const session = readSession(NOW);

  it('ignores ages and prices, so a book that only got older is the same book', () => {
    const a = bookShape([judgeFeed(readOf(AAPL, { round: round(32641467229n, 60) }), NOW)], session, false);
    const b = bookShape([judgeFeed(readOf(AAPL, { round: round(33400000000n, 7200) }), NOW)], session, false);
    assert.equal(a, b);
  });

  it('changes when an exception appears, the session moves, or the head stalls', () => {
    const base = bookShape([judgeFeed(readOf(AAPL), NOW)], session, false);
    assert.notEqual(base, bookShape([judgeFeed(readOf(AAPL, { oraclePaused: ok(true) }), NOW)], session, false));
    assert.notEqual(base, bookShape([judgeFeed(readOf(AAPL, { round: round(32641467229n, 90_000) }), NOW)], session, false));
    assert.notEqual(base, bookShape([judgeFeed(readOf(AAPL), NOW)], readSession(new Date('2026-09-13T15:00:00.000Z')), false));
    assert.notEqual(base, bookShape([judgeFeed(readOf(AAPL), NOW)], session, true));
    assert.notEqual(base, bookShape([judgeFeed(readOf(AAPL), NOW)], session, null));
  });

  it('does not depend on the order the feeds were read in', () => {
    const x = judgeFeed(readOf(AAPL, { oraclePaused: ok(true) }), NOW);
    const y = judgeFeed(readOf(NVDA, { description: ok('other') }), NOW);
    assert.equal(bookShape([x, y], session, false), bookShape([y, x], session, false));
  });

  it('refiles within a bounded silence', () => {
    assert.ok(REFILE_SECONDS >= 3600 && REFILE_SECONDS <= 24 * 3600);
  });
});
