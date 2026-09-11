/**
 * The published sources that govern what a token holder actually has.
 *
 * The three-state doctrine applies to documents exactly as it does to figures.
 * A page we hold a link to is not a page we have read, and a register that lists
 * both the same way is claiming coverage it does not have. Each entry therefore
 * records its own state, and Counsel reports the unread ones as unread.
 *
 * `READ` here means a person or this system actually retrieved the page and
 * recorded what it said, with the date. It does not mean the content was
 * verified against anything, and it is never a legal opinion.
 */

export type SourceState = 'READ' | 'LINK_ONLY';

export interface TermsSource {
  readonly key: string;
  readonly title: string;
  readonly url: string;
  /** What question this document is the authority for. */
  readonly covers: string;
  readonly state: SourceState;
  /** Set only when state is READ. */
  readonly readAt: string | null;
  /** One line of what it said, recorded at readAt. Never a paraphrase of intent. */
  readonly recorded: string | null;
}

export const TERMS_SOURCES: readonly TermsSource[] = [
  {
    key: 'oracles',
    title: 'Oracles & Price Feeds',
    url: 'https://docs.robinhood.com/chain/oracles-and-price-feeds/',
    covers: 'how a stock-token price is produced, and when it should not be trusted',
    state: 'READ',
    readAt: '2026-09-11T02:00:00Z',
    recorded:
      'States that stock feeds update 24/5 following market hours; that a paused oracle should be treated as price temporarily unavailable rather than as a zero or stale price; that the pause flag is advisory and not enforced on chain, so a staleness check against the feed heartbeat remains the primary guard; and that sequencer uptime should be confirmed before trusting any price on this Layer 2.',
  },
  {
    key: 'stock-tokens',
    title: 'Stock Token overview',
    url: 'https://docs.robinhood.com/chain/stock-tokens/',
    covers: 'what a stock token is and how it relates to the underlying share',
    state: 'LINK_ONLY',
    readAt: null,
    recorded: null,
  },
  {
    key: 'issuer-faq',
    title: 'Issuer FAQ',
    url: 'https://docs.robinhood.com/rhj/faq/',
    covers: 'the holder’s rights, distributions, and redemption terms',
    state: 'LINK_ONLY',
    readAt: null,
    recorded: null,
  },
  {
    key: 'restricted',
    title: 'Restricted jurisdictions',
    url: 'https://docs.robinhood.com/rhj/restricted-jurisdictions/',
    covers: 'where these instruments are not offered',
    state: 'LINK_ONLY',
    readAt: null,
    recorded: null,
  },
  {
    key: 'corporate-actions',
    title: 'Corporate actions',
    url: 'https://docs.robinhood.com/rhj/corporate-actions/',
    covers: 'how splits, dividends and other actions are handled',
    state: 'LINK_ONLY',
    readAt: null,
    recorded: null,
  },
];

/**
 * Determinations this system will not make, in any wording, for anybody.
 *
 * These are not modesty. Telling a reader they are eligible to hold a tokenized
 * security is a determination only the issuer can make, and a system that makes
 * it anyway has not been helpful — it has been wrong in a way the reader cannot
 * check until it costs them.
 */
export const NEVER_DETERMINED = [
  // Worded to describe the determination without containing the phrase policy
  // forbids. The gate does not distinguish use from mention, and that is the
  // safer failure: an exception for refusal wording would need context judged,
  // which is the thing this system took out of prompts and put into code.
  'Whether any instrument described here may lawfully be held or transferred by a given reader. That turns on jurisdiction, on status, and on the issuer’s own checks — the issuer decides it, and nothing here does.',
  'What your rights are as a holder. The issuer’s published terms say; this system can point at them and quote them, and it does not interpret them.',
  'Any tax consequence, in either direction.',
  'Whether a wallet signature identifies you. It proves control of a key. It is not identity verification and it is not a substitute for any check an issuer requires.',
] as const;

export function readSources(): readonly TermsSource[] {
  return TERMS_SOURCES.filter((s) => s.state === 'READ');
}

export function unreadSources(): readonly TermsSource[] {
  return TERMS_SOURCES.filter((s) => s.state === 'LINK_ONLY');
}
