/**
 * The words on the front page, kept in one place so they can be checked.
 *
 * The front page used to be the doctrine read aloud: about 2,100 words, an
 * average sentence of 31, and 367 words before a visitor was told what the site
 * is. Every claim was careful and almost none of it was readable. The care is
 * not gone — it lives on /doctrine, /mechanism and the pages behind each link —
 * but the front now says what this is, shows the live numbers, and gets out of
 * the way.
 *
 * Two rules hold here, and `tests/home-copy.test.ts` enforces both:
 *
 *   short    no sentence over 20 words, and the headline under 20 in all.
 *   honest   none of the eight claims the positions thesis refuses, and none
 *            of the phrases policy blocks from any publication, even though a
 *            page is not a publication. Plain words are not a licence to say
 *            something the desk would not.
 *
 * Figures are not written here. Anything that is a number is computed on the
 * page from the record, with its age, and renders as a dash when it was not
 * read — the same rule as everywhere else on the site.
 */

export const HOME = {
  headline: {
    line: 'What stock tokens trade at on Robinhood Chain.',
    emphasis: 'Next to the stock’s last price, with the age of both.',
  },
  subhead: 'Free to use — no wallet, no sign‑up. Prices are read from the chain every 15 minutes.',
  primary: 'See today’s prices',
  secondary: 'How it works',

  now: {
    kicker: 'Right now',
    bothSides: 'stock tokens with a price on both sides',
    bothSidesHelp: 'a stock price, and a live market on this chain',
    widest: 'biggest gap from the stock’s last price',
    split: 'tokens trading under or over the stock’s last price',
    // Why the gap exists is section two's job, with the drawing; saying it here
    // too was the same sentence twice on one screen.
    explainer: ['The gap is how far the price here sits from the stock’s last price.'],
    notAdvice: 'A measurement, not advice.',
    unread: 'not read right now — shown as a dash, never as zero',
  },

  table: {
    kicker: 'Biggest gaps right now',
    columns: ['Token', 'Stock price', 'On chain', 'Gap'] as const,
    all: 'All stock tokens',
    empty: 'No token carries a price on both sides in the record yet.',
  },

  why: {
    kicker: 'Why the prices differ',
    caption: '24 hours of chain · 6½ hours of exchange',
    body: [
      'US stocks trade about 6½ hours a day, five days a week.',
      'The chain never closes. The stock market does.',
      'Nights and weekends, token prices keep moving while the stock price stands still.',
      'That gap is what this page measures.',
    ],
  },

  actions: {
    kicker: 'What you can do here',
    items: [
      {
        title: 'See every price',
        body: 'Every stock token: the stock’s last price, the price here, and how old each one is.',
        cta: 'Open the Floor',
        href: '/floor',
      },
      {
        title: 'Get alerts',
        // {band} is the published alert band, filled on the page from the one
        // constant the alert product uses, so the two cannot disagree.
        body: 'A message when a gap passes {band}, a token’s feed is paused, or a split is scheduled.',
        cta: 'Set up alerts',
        href: '/services#alerts',
      },
      {
        title: 'Check a token',
        body: 'Who issued it, whether its price feed is paused, and whether it followed its last split.',
        cta: 'Open the Registry',
        href: '/registry',
      },
    ],
    free: 'Free. The key for your alerts is made in your browser.',
  },

  trust: {
    kicker: 'How to read it',
    points: [
      'Every number shows how old it is and where it came from.',
      'If something could not be read, you see a dash — never a zero.',
      'Measurements only. What you do with them is up to you.',
    ],
    doctrine: 'How we know',
    agents: 'Agent status',
  },

  next: {
    kicker: 'Being built',
    title: 'One company. Two issuers. One position.',
    body: 'Exposure to one company, split across two stock-token issuers. Not live yet — try the simulation.',
    cta: 'Try the simulation',
  },

  token: {
    notLaunched: 'The CURB token has not launched. The desk is free either way.',
  },

  more: {
    kicker: 'More on the desk',
  },
} as const;

/** The district pages a curious reader can go on to, in one line rather than six essays. */
export const MORE_LINKS = [
  { label: 'The Vault', href: '/vault', what: 'token transfers per minute' },
  { label: 'Chambers', href: '/chambers', what: 'issuer terms, watched for change' },
  { label: 'The Gazette', href: '/gazette', what: 'one story a day from the record' },
  { label: 'The agents', href: '/agents', what: 'who reads what, and how often' },
] as const;

/** A copy line with the published alert band written in, as a percentage. */
export function withBand(line: string, bandBps: number): string {
  return line.replace('{band}', `${bandBps / 100}%`);
}

/** Every sentence the front page speaks in its own words, for the tests. */
export function homeSentences(bandBps = 200): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const s = withBand(raw, bandBps);
    for (const part of s.split(/(?<=[.!?])\s+/)) if (part.trim().length > 0) out.push(part.trim());
  };
  add(HOME.subhead);
  add(HOME.now.explainer.join(' '));
  add(HOME.now.notAdvice);
  add(HOME.table.empty);
  HOME.why.body.forEach(add);
  HOME.actions.items.forEach((i) => add(i.body));
  add(HOME.actions.free);
  HOME.trust.points.forEach(add);
  add(HOME.next.body);
  add(HOME.token.notLaunched);
  return out;
}

/** The headline, in full, as a reader meets it. */
export function homeHeadline(): string {
  return `${HOME.headline.line} ${HOME.headline.emphasis}`;
}
