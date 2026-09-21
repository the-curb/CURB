/**
 * The words on the Floor, kept in one place so they can be checked.
 *
 * The Floor measured as a twenty-five minute read. Most of that was not the
 * board — it was six agent filings printed in full under it, a 110-word
 * paragraph explaining the columns, and column names only an insider could
 * read ("Basis · bp", "Heartbeat", "Identity"). The board is the product; the
 * page now opens on it, says what each column means in a line, and keeps the
 * filings one click away instead of in the reading path.
 *
 * Nothing measured is written here. Every figure is computed on the page from
 * the record, carries its age, and renders as a dash when it was not read.
 * `tests/floor-copy.test.ts` holds this file to the same rules as the front
 * page: short sentences, and none of the claims the desk refuses.
 */

export const FLOOR = {
  title: 'The Floor',
  headline: 'Every stock token, and two prices for each.',
  sub: 'The stock’s last price, what the token trades at here, and how old each number is.',
  closedNote: 'The stock market is closed, so every stock price is its last close. Late feeds are normal until it opens.',

  legend: {
    kicker: 'How to read the table',
    items: [
      { term: 'Stock price', means: 'The stock’s last price, from its Chainlink feed.' },
      { term: 'On chain', means: 'What the token trades at here, from its deepest pool.' },
      { term: 'Gap', means: 'How far the price here is from the stock price, in percent.' },
      { term: 'Moves it 1%', means: 'About how much money moves the price here by 1%. A rough size, not an offer.' },
      { term: 'Age · Read', means: 'How old the stock price is, and when we last read it.' },
      { term: 'On time · Paused · Checked', means: 'Whether the feed is updating, paused by its issuer, and still the one we recorded.' },
    ],
    star: '* counted from the current price range only.',
  },

  columns: {
    token: 'Token',
    feed: 'Feed',
    stock: 'Stock price',
    chain: 'On chain',
    gap: 'Gap',
    moves: 'Moves it 1%',
    age: 'Age',
    read: 'Read',
    onTime: 'On time',
    paused: 'Paused',
    checked: 'Checked',
  },

  values: {
    onTime: 'yes',
    late: 'late',
    notPaused: 'no',
    paused: 'paused',
    notAsked: 'n/a',
    matches: 'ok',
    changed: 'changed',
  },

  tips: {
    stock: 'The last answer from the stock’s Chainlink feed.',
    chain: 'The deepest pool on this chain that has money in it.',
    gap: 'The price here against the stock price. Which way it closes is not stated.',
    moves: 'Counted from what the pool shows now. A move past the current range meets money this cannot see.',
    movesExact: 'This pool’s whole book is counted, so the size is exact.',
    age: 'How long since the feed last published.',
    read: 'How long since the desk read it.',
    late: 'Older than the feed promises to update. Normal while the market is closed.',
    paused: 'The issuer has paused this feed. It holds its last price until the pause lifts.',
    changed: 'This feed no longer describes itself the way it did when we recorded it. Its price is held back.',
    noPool: 'No pool with money in it was found for this token.',
    noDollar: 'The pool has a price, but not in dollars yet.',
    noRead: 'The desk has not read a pool for this token.',
    unread: 'Not read. Shown as a dash, never as zero.',
  },

  state: {
    VERIFIED: { label: 'up to date', means: 'Prices were read on schedule.' },
    STALE: { label: 'behind schedule', means: 'Prices were not read on schedule. These are the last ones we have.' },
    ABSENT: { label: 'not read', means: 'The price reader has not reported. Everything here is out of date.' },
    NONE: { label: 'no prices yet', means: 'No prices have been read into the record yet.' },
  },
  staleNote: 'Prices below are the last ones we read.',
  unreadable: 'The record could not be read, so no table is shown. That is not the same as an empty one.',
  empty: 'No prices have been read into the record yet.',
  crypto: 'Crypto price feeds',
  missing: 'stock tokens have no price feed, so they are not on this table.',

  bell: {
    kicker: 'Is the market open?',
    intro: 'The chain never closes. The stock market does. While it is closed, a stock price is its last close.',
    rows: {
      day: 'Market day (New York)',
      tradingDay: 'Trading day',
      why: 'Why closed',
      earlyClose: 'Early close',
      closedFor: 'Closed for',
      opens: 'Opens next',
      lastRead: 'Last stock price read',
      status: 'Price status',
    },
    status: {
      IN_SESSION: 'live, market open',
      EXTENDED_HOURS: 'outside regular hours',
      MARKET_CLOSED: 'last close, market shut',
      PREDATES_LAST_CLOSE: 'older than the last close',
      NO_PRICE_READ: 'no price read yet',
    },
    blindSpots: 'What this cannot detect',
  },

  warden: {
    kicker: 'Is the desk working?',
    intro: 'These numbers are printed even when they look bad.',
    rows: {
      sources: 'Sources answering',
      reporting: 'Agents that ran in the last hour',
      oldest: 'Oldest data in use',
      held: 'Filings held back by the rules',
    },
    lights: 'What the lights mean',
    unreadable: 'The agents’ record could not be read, so their state is not shown.',
  },

  wire: {
    kicker: 'What the agents wrote',
    intro: 'The latest filings, word for word. Open one to read it.',
    open: 'Read the filing',
    figures: 'figures, each with its source',
    empty: 'Nothing has been published yet.',
    unreadable: 'The filings could not be read, so none are shown.',
  },

  coverage: {
    kicker: 'What this page covers',
    intro: 'What we read, and what we do not.',
    rows: {
      listed: 'Price feeds Chainlink lists',
      checked: 'Feeds checked on chain',
      equity: 'Stock price feeds',
      tokens: 'Stock tokens Robinhood lists',
      noFeed: 'Stock tokens with no price feed',
      uptime: 'Chain uptime feed',
      head: 'Latest block read',
      agents: 'Agents running',
    },
  },

  footer: [
    'A number we could not read is shown as a dash with its reason, never as zero.',
    'Nothing here is investment, legal or tax advice. No agent places an order.',
  ],
} as const;

/** Every sentence the Floor says in its own words, for the tests. */
export function floorSentences(): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    for (const part of s.split(/(?<=[.!?])\s+/)) if (part.trim().length > 0) out.push(part.trim());
  };
  add(FLOOR.sub);
  add(FLOOR.closedNote);
  FLOOR.legend.items.forEach((i) => add(i.means));
  Object.values(FLOOR.tips).forEach(add);
  Object.values(FLOOR.state).forEach((s) => add(s.means));
  add(FLOOR.staleNote);
  add(FLOOR.unreadable);
  add(FLOOR.bell.intro);
  add(FLOOR.warden.intro);
  add(FLOOR.warden.unreadable);
  add(FLOOR.wire.intro);
  add(FLOOR.wire.empty);
  add(FLOOR.wire.unreadable);
  add(FLOOR.coverage.intro);
  FLOOR.footer.forEach(add);
  return out;
}
