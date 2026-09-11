/**
 * Chainlink price feeds on Robinhood Chain — the view the agents read.
 *
 * The data lives in `feed-directory.ts`, generated from the vendor's own
 * directory and verified on chain at capture (see scripts/capture-feeds.ts).
 * This module is the vocabulary over it: which feeds follow which clock, how
 * much of the directory is covered, and the one feed that is configured rather
 * than captured.
 *
 * The vendor documentation is explicit that its directory is the source of
 * truth and that addresses should be read from there. The generated module
 * does not contradict that: it is dated evidence of what the directory said,
 * with a hash of the file, kept so that a change can be noticed. It is not a
 * recommendation of any feed.
 */

import {
  FEED_DIRECTORY,
  FEED_DIRECTORY_SOURCE,
  type DirectoryFeed,
  type FeedMarketHours,
} from './feed-directory.ts';
import { STOCK_TOKENS, STOCK_TOKENS_SOURCE } from './stock-tokens.ts';

export type FeedRecord = DirectoryFeed;
export type { FeedMarketHours };

export const FEEDS: readonly FeedRecord[] = FEED_DIRECTORY;

/**
 * The feeds this project is about. Each prices one stock token and follows the
 * equity clock: a quiet weekend is a closed exchange, not a fault.
 */
export const EQUITY_FEEDS: readonly FeedRecord[] = FEEDS.filter((f) => f.marketHours === 'equity');

/** Feeds on the crypto clock, which does not close. Age here has no alibi. */
export const CRYPTO_FEEDS: readonly FeedRecord[] = FEEDS.filter((f) => f.marketHours === 'crypto');

/** What the directory said existed, against what was captured and verified. */
export const FEED_COVERAGE = {
  listedByDirectory: FEED_DIRECTORY_SOURCE.listed,
  capturedHere: FEEDS.length,
  verifiedOnChain: FEED_DIRECTORY_SOURCE.verifiedOnChain,
  equity: EQUITY_FEEDS.length,
  crypto: CRYPTO_FEEDS.length,
  source: FEED_DIRECTORY_SOURCE.linkedFrom,
  directory: FEED_DIRECTORY_SOURCE.url,
  observedAt: FEED_DIRECTORY_SOURCE.retrievedAt,
  observedAtBlock: FEED_DIRECTORY_SOURCE.verifiedAtBlock,
} as const;

/**
 * How many stock tokens have a reference price this system can read, and how
 * many do not. The second number is the larger one, and it is reported as such:
 * a token without a feed is a token whose price this system cannot state.
 */
export const STOCK_TOKEN_COVERAGE = {
  tokensInRegistry: STOCK_TOKENS.length,
  withFeed: STOCK_TOKENS.filter((t) => t.feedKey !== null).length,
  withoutFeed: STOCK_TOKENS.filter((t) => t.feedKey === null).length,
  source: STOCK_TOKENS_SOURCE.linkedFrom,
  registry: STOCK_TOKENS_SOURCE.url,
  observedAt: STOCK_TOKENS_SOURCE.retrievedAt,
} as const;

/**
 * The L2 sequencer uptime feed. Robinhood Chain is a Layer 2, and the vendor
 * guidance is to confirm the sequencer is up before trusting any price: during
 * an outage feeds can go stale while still returning a value.
 *
 * There is none for this network. The vendor's sequencer-feed page lists
 * eleven networks, this is not one of them, and the page states that no new
 * networks are being added (read 2026-09-11). So the sequencer is not checked
 * through a feed, and the Pillar says exactly that. What is checked instead is
 * the chain head's age against the clock — `readHead()` — which is the one
 * liveness signal the chain itself offers. The env override remains for the
 * unlikely day a feed is published.
 */
export const SEQUENCER_FEED = {
  proxy: process.env.CURB_SEQUENCER_FEED ?? null,
  state: process.env.CURB_SEQUENCER_FEED ? 'CONFIGURED' : 'NOT_PUBLISHED',
  reason:
    'no sequencer uptime feed exists for this network — the vendor lists none and has stopped adding networks — so the sequencer is not checked through a feed. This is not a statement that the sequencer is up',
  source: 'https://docs.chain.link/data-feeds/l2-sequencer-feeds',
  observedAt: '2026-09-11T14:30:00Z',
} as const;

/**
 * How old the chain head may be before the Pillar calls it stalled. Blocks
 * arrive every tenth of a second here; two minutes without one is not a slow
 * block, it is the chain not producing.
 */
export const HEAD_STALL_SECONDS = 120;

export function feedByKey(key: string): FeedRecord | null {
  return FEEDS.find((f) => f.key === key) ?? null;
}

/** The stock token an equity feed prices, by the ticker both sources share. */
export function tokenForFeed(feed: FeedRecord) {
  if (feed.ticker === null) return null;
  return STOCK_TOKENS.find((t) => t.feedKey === feed.key) ?? null;
}
