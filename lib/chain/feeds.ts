/**
 * Chainlink price feeds on Robinhood Chain, as recorded by hand.
 *
 * The vendor documentation is explicit that its own directory is the source of
 * truth and that addresses should be read from there rather than hardcoded. This
 * file does not contradict that: it is dated evidence of what the directory said
 * when a person looked, kept so that a change can be noticed. It is not a
 * substitute for the directory and it is not a recommendation of any feed.
 *
 * COVERAGE, STATED PLAINLY: the directory listed 57 feeds for this network. The
 * eight below are the ones actually read off the page. The remaining 49 — which
 * include every tokenized-equity feed — were NOT captured, and this module
 * reports them as unread rather than presenting eight as if they were all.
 */

export type FeedMarketHours = 'crypto' | 'equity' | 'unknown';

export interface FeedRecord {
  readonly key: string;
  readonly pair: string;
  readonly assetName: string;
  /**
   * Which clock this feed follows. The distinction is the point of the Pillar:
   * a crypto feed that has not moved in six hours is a problem; an equity feed
   * that has not moved since Friday is a closed exchange.
   */
  readonly marketHours: FeedMarketHours;
  readonly proxy: string;
  /**
   * Seconds the feed may go without an update before staleness is expected.
   * Null means the heartbeat was not captured — so staleness cannot be judged
   * against a threshold, and the Pillar says so instead of inventing one.
   */
  readonly heartbeatSeconds: number | null;
  readonly observedAt: string;
  readonly source: string;
}

const SOURCE = 'https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood';
const OBSERVED = '2026-09-11T02:00:00Z';

export const FEEDS: readonly FeedRecord[] = [
  {
    key: 'btc-usd',
    pair: 'BTC / USD',
    assetName: 'Bitcoin',
    marketHours: 'crypto',
    proxy: '0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
  {
    key: 'eth-usd',
    pair: 'ETH / USD',
    assetName: 'Ethereum',
    marketHours: 'crypto',
    proxy: '0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
  {
    key: 'link-usd',
    pair: 'LINK / USD',
    assetName: 'Chainlink',
    marketHours: 'crypto',
    proxy: '0xe86e3422Aa9B5e8ee9f3E41a63975bC387A8bce9',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
  {
    key: 'eurc-usd',
    pair: 'EURC / USD',
    assetName: 'Euro Coin',
    marketHours: 'crypto',
    proxy: '0xfF2B10c1973eD10c841434f98e456d8f3a0D7DD8',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
  {
    key: 'ena-usd',
    pair: 'ENA / USD',
    assetName: 'Ethena',
    marketHours: 'crypto',
    proxy: '0x2A291496b3aa19d8948e442Ef28Ee952f3Ee97E8',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
  {
    key: 'cbbtc-usd',
    pair: 'CBBTC / USD',
    assetName: 'Coinbase Wrapped BTC',
    marketHours: 'crypto',
    proxy: '0x0009cD492adf8167f9eEBf1293556A673530a21a',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
  {
    key: 'btcb-usd',
    pair: 'BTC.B / USD',
    assetName: 'Avalanche Bridged BTC',
    marketHours: 'crypto',
    proxy: '0x5BB5e6a17a477d5B6Fec77b4322daD4A66bFb732',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
  {
    key: 'lbtc-usd',
    pair: 'LBTC / USD',
    assetName: 'LOMBARD STAKED BTC',
    marketHours: 'crypto',
    proxy: '0xa621344AdAEE699491597Fd8890E0C59a5BFBE59',
    heartbeatSeconds: null,
    observedAt: OBSERVED,
    source: SOURCE,
  },
];

/** What the directory said existed, against what was actually captured. */
export const FEED_COVERAGE = {
  listedByDirectory: 57,
  capturedHere: FEEDS.length,
  source: SOURCE,
  observedAt: OBSERVED,
} as const;

/**
 * Equity feeds are the ones this project is actually about, and there are none
 * here. The directory carries them; they were not read. Reporting that as an
 * absence with a reason is the only honest option — an equity feed address that
 * is wrong does not fail loudly, it prices the wrong instrument.
 */
export const EQUITY_FEEDS_STATUS = {
  state: 'SOURCE_NOT_CONNECTED',
  reason:
    'No tokenized-equity feed address has been captured from the Chainlink directory. Until one is read from the source of truth, equity prices are reported as unread — never as zero, and never guessed.',
  remedy: `Read an equity feed proxy from ${SOURCE} and add it to FEEDS with marketHours: 'equity'.`,
} as const;

/**
 * The L2 sequencer uptime feed. Robinhood Chain is a Layer 2, and the vendor
 * guidance is to confirm the sequencer is up before trusting any price: during
 * an outage feeds can go stale while still returning a value.
 *
 * The address was not captured, so the Pillar reports the sequencer check as
 * not performed rather than as passed. "Not checked" and "up" are different
 * claims, and only one of them is safe to assume.
 */
export const SEQUENCER_FEED = {
  proxy: process.env.CURB_SEQUENCER_FEED ?? null,
  state: process.env.CURB_SEQUENCER_FEED ? 'CONFIGURED' : 'SOURCE_NOT_CONNECTED',
  reason:
    'The L2 sequencer uptime feed address is not configured, so the sequencer was not checked. This is not a statement that the sequencer is up.',
} as const;

export function feedByKey(key: string): FeedRecord | null {
  return FEEDS.find((f) => f.key === key) ?? null;
}
