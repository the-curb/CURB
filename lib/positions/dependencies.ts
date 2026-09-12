/**
 * The map of related parties (blueprint R02, §6): who stands behind each
 * component, as the issuers' own documents state it, and what they do not
 * state. Every line names its source; a party the documents do not name is
 * recorded as not known, never filled in from memory or from a partner
 * list. No claim of independence is made where none is documented.
 *
 * The lines were read on the date given; the pages they come from are the
 * ones the archive watches for change by hash, so a changed page is a NOTE
 * on the desk and a reason to read these lines again. The chain's answers
 * about contract authority are read by the fork test and the daily
 * verification and shown beside them, dated by block.
 */

export type PartyType =
  | 'ISSUER'
  | 'TOKENIZER'
  | 'BROKER'
  | 'CUSTODIAN'
  | 'SECURITY_AGENT'
  | 'VERIFICATION_AGENT'
  | 'UNDERLYING'
  | 'SETTLEMENT_ASSET'
  | 'BRIDGE'
  | 'CONTRACT_AUTHORITY'
  | 'NETWORK';

export interface Dependency {
  readonly component: 'A' | 'B';
  readonly partyType: PartyType;
  /** The party as the document names it; null when the document names a role but no party. */
  readonly name: string | null;
  readonly relationship: string;
  readonly source: { readonly title: string; readonly url: string } | { readonly title: 'the chain, at the recorded fork block'; readonly url: null };
  readonly readOn: string;
  /** What is not settled by the line — stated, not smoothed over. */
  readonly limit: string | null;
}

const READ_ON = '2026-09-12';

const XSTOCKS_PRODUCT = { title: 'AAPLx product page (last updated 30 June 2025, as the page says)', url: 'https://assets.backed.fi/products/apple-xstock' };
const XSTOCKS_FAQ = { title: 'xStocks FAQ', url: 'https://docs.xstocks.fi/docs/frequently-asked-questions' };
const XSTOCKS_WRAPPED = { title: 'Wrapped xStocks', url: 'https://docs.xstocks.fi/developers/wrapped-xstocks' };
const XSTOCKS_CA = { title: 'xStocks corporate actions', url: 'https://docs.xstocks.fi/docs/dividends-and-stock-splits' };
const ONDO_LAUNCH = { title: 'Ondo Stocks launch post (3 September 2025)', url: 'https://ondo.finance/blog/global-markets-is-live' };
const ONDO_ELIGIBILITY = { title: 'Ondo Stocks eligibility', url: 'https://docs.ondo.finance/ondo-stocks/eligibility' };
const ONDO_INVEST = { title: 'Ondo Stocks investing & redeeming', url: 'https://docs.ondo.finance/ondo-stocks/investing-and-redeeming' };
const ONDO_CA = { title: 'Ondo Stocks corporate actions', url: 'https://docs.ondo.finance/ondo-stocks/corporate-actions' };
const CHAIN = { title: 'the chain, at the recorded fork block', url: null } as const;

export const DEPENDENCIES: readonly Dependency[] = [
  // ── Component A: AAPLx, xStocks ──────────────────────────────────────────
  { component: 'A', partyType: 'ISSUER', name: 'Backed Assets (JE) Limited', relationship: 'issuer of the tracker certificate AAPLx (ISIN CH1436219187)', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'TOKENIZER', name: 'Backed Finance AG', relationship: 'tokenizer, as the product page lists it', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'BROKER', name: 'Alpaca Securities LLC', relationship: 'broker, one of three the product page lists', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: 'which broker holds the shares behind any given token is not stated' },
  { component: 'A', partyType: 'BROKER', name: 'InCore Bank AG', relationship: 'broker, one of three the product page lists', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'BROKER', name: 'Maerki Baumann & Co. AG', relationship: 'broker, one of three the product page lists', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'CUSTODIAN', name: 'Alpaca Securities LLC', relationship: 'custodian, one of four the product page lists', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: 'the same firm is listed as broker and as custodian' },
  { component: 'A', partyType: 'CUSTODIAN', name: 'InCore Bank AG', relationship: 'custodian, one of four the product page lists', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: 'the same firm is listed as broker and as custodian' },
  { component: 'A', partyType: 'CUSTODIAN', name: 'Maerki Baumann & Co. AG', relationship: 'custodian, one of four the product page lists', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: 'the same firm is listed as broker and as custodian' },
  { component: 'A', partyType: 'CUSTODIAN', name: 'GTN Europe Financial Services Limited', relationship: 'custodian, one of four the product page lists', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'SECURITY_AGENT', name: 'Security Agent Services AG', relationship: 'security agent; the FAQ describes a three-party structure of issuer, custodians and an independent security agent that may take control of collateral accounts on issuer default', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: 'independence is the issuer’s description; the prospectus terms govern and are not read here' },
  { component: 'A', partyType: 'UNDERLYING', name: 'Apple Inc. (ISIN US0378331005, LEI HWUPKR0MPOU8FGXBT394)', relationship: 'the underlying; the token is a tracker certificate with economic exposure and no shareholder rights', source: XSTOCKS_FAQ, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'NETWORK', name: 'Ethereum (ERC-20); also Solana (SPL) and other networks the API lists', relationship: 'the deployment the series would use is Ethereum', source: XSTOCKS_PRODUCT, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'BRIDGE', name: 'xStocks CCIP bridge (Chainlink CCIP)', relationship: 'moves xStocks between networks; the series does not use it', source: XSTOCKS_FAQ, readOn: READ_ON, limit: 'not a dependency of the series as designed; listed because the issuer lists it' },
  { component: 'A', partyType: 'CONTRACT_AUTHORITY', name: 'proxy admin 0x696c685a…a085 and owner() 0x49754062…3a65 (raw token); admin 0x31206300…8bfa (wrapper v2), admin 0xe39fffff…0cc7 (wrapper v1), the same owner() on all three', relationship: 'can replace the code behind the token and the wrappers (EIP-1967 proxies)', source: CHAIN, readOn: READ_ON, limit: 'who those addresses belong to is not read from the chain and is not asserted; the issuer’s documents do not name them' },
  { component: 'A', partyType: 'ISSUER', name: 'Backed Assets (JE) Limited', relationship: 'sets the wrapper rules: the current wrapper uses the live multiplier and is the one to integrate; the v1 wrapper is unwrap-only and, in the issuer’s words, never to be used as collateral or a pricing source; the vault exchange rate is not a price', source: XSTOCKS_WRAPPED, readOn: READ_ON, limit: null },
  { component: 'A', partyType: 'ISSUER', name: 'Backed Assets (JE) Limited', relationship: 'publishes the multiplier on chain before each corporate action, activating at 00:30 UTC the day after the ex-date, and advises venues to pause around activation', source: XSTOCKS_CA, readOn: READ_ON, limit: 'the series holds the wrapper, whose share count changes only on deposit and redeem; a fork test across a recorded activation is still owed (T14)' },

  // ── Component B: AAPLon, Ondo ────────────────────────────────────────────
  { component: 'B', partyType: 'ISSUER', name: 'Ondo Global Markets (BVI) Limited', relationship: 'issuer of Ondo Stocks, as the eligibility page names it', source: ONDO_ELIGIBILITY, readOn: READ_ON, limit: null },
  { component: 'B', partyType: 'BROKER', name: null, relationship: 'the launch post says the platform acquires AAPL through “a U.S.-registered broker-dealer” and holds backing at “one or more U.S.-registered broker-dealers”', source: ONDO_LAUNCH, readOn: READ_ON, limit: 'no broker-dealer is named in the documents read' },
  { component: 'B', partyType: 'CUSTODIAN', name: null, relationship: 'the launch post says the underlying shares are held “with a regulated custodian”', source: ONDO_LAUNCH, readOn: READ_ON, limit: 'no custodian is named in the documents read' },
  { component: 'B', partyType: 'VERIFICATION_AGENT', name: null, relationship: 'an “independent third-party Verification Agent” is said to review asset backing and publish a report each business day', source: ONDO_LAUNCH, readOn: READ_ON, limit: 'not named; the reports are not read here' },
  { component: 'B', partyType: 'SECURITY_AGENT', name: null, relationship: 'an “independent third-party Security Agent” is said to hold a first-priority security interest in the underlying assets for tokenholders', source: ONDO_LAUNCH, readOn: READ_ON, limit: 'not named; independence is the issuer’s description' },
  { component: 'B', partyType: 'UNDERLYING', name: 'Apple Inc. — AAPL, held as shares behind a total-return tracker token', relationship: 'the token gives economic exposure with dividends reinvested; it is not a stock and gives no right to receive the shares', source: ONDO_LAUNCH, readOn: READ_ON, limit: null },
  { component: 'B', partyType: 'SETTLEMENT_ASSET', name: 'USDon (Ondo’s stablecoin), with a USDC swapper', relationship: 'mint and redeem through the issuer settle in USDon; USDC converts 1:1 through a swapper whose liquidity bounds instant conversion; swapping needs whitelisting and the swapper has no UI', source: ONDO_INVEST, readOn: READ_ON, limit: 'a dependency of issuer redemption, not of the series’ own mint and exit' },
  { component: 'B', partyType: 'NETWORK', name: 'Ethereum (live at launch); BNB Chain, Solana and Ondo Chain announced', relationship: 'the deployment the series would use is Ethereum', source: ONDO_LAUNCH, readOn: READ_ON, limit: 'the Ethereum address itself is behind an API key this desk does not hold' },
  { component: 'B', partyType: 'CONTRACT_AUTHORITY', name: null, relationship: 'who can change the code behind AAPLon', source: ONDO_INVEST, readOn: READ_ON, limit: 'not readable without the address; the documents read say the token is ERC-20 compliant and may be held by smart contracts, with eligibility still applying' },
  { component: 'B', partyType: 'ISSUER', name: 'Ondo Global Markets (BVI) Limited', relationship: 'may pause trading around an ex-dividend date (the documents give 7:50–8:10 pm the day before, subject to change) and halt a token until a dividend amount is known; status.ondo.finance lists halts', source: ONDO_CA, readOn: READ_ON, limit: 'a halt at the issuer is exactly the case the series’ per-component claim is built for; it is not prevented by the series' },
];

/** A party named under both components, by exact name. */
export function sharedParties(deps: readonly Dependency[] = DEPENDENCIES): readonly { name: string; roles: readonly string[] }[] {
  const byName = new Map<string, Set<string>>();
  for (const d of deps) {
    if (d.name === null) continue;
    const roles = byName.get(d.name) ?? new Set<string>();
    roles.add(`${d.component} ${d.partyType.toLowerCase().replace('_', ' ')}`);
    byName.set(d.name, roles);
  }
  return [...byName]
    .filter(([, roles]) => new Set([...roles].map((r) => r.slice(0, 1))).size > 1)
    .map(([name, roles]) => ({ name, roles: [...roles].sort() }));
}

/**
 * Names that appear in one component's documents in a role and in the
 * other's only in a list without a stated role — a possible shared party,
 * recorded as possible and nothing more.
 */
export const POSSIBLY_SHARED: readonly { name: string; note: string; sources: readonly { title: string; url: string }[] }[] = [
  {
    name: 'Alpaca Securities LLC',
    note: 'broker and custodian for A on the product page; named for B only in the launch post’s list of supporting “wallets, custodians, and exchanges” (as “Alpaca”), with no role stated for AAPLon',
    sources: [XSTOCKS_PRODUCT, ONDO_LAUNCH],
  },
  {
    name: 'Chainlink',
    note: 'the CCIP bridge the xStocks FAQ names for moving A between networks; listed in B’s launch post among supporters with no role stated; also the vendor of the price feeds the desk beneath this product reads on Robinhood Chain',
    sources: [XSTOCKS_FAQ, ONDO_LAUNCH],
  },
];

export const NOT_KNOWN_LINE = 'A role with no name is a role the documents describe without naming the party. It is left empty on purpose: a name filled in from a partner list or from memory would be the kind of claim this desk refuses.';
