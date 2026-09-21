/**
 * The one series the site describes, and everything the site is allowed to
 * say about it. A contract prototype exists with fork and local-chain tests;
 * no public series deployment or issuer integration is approved. Every figure here
 * is illustrative and is labelled so where it is shown.
 */

export type Verification = 'CANDIDATE' | 'VERIFIED' | 'EXCLUDED';

/** The four statuses of a component that must each stand on their own. */
export type ComponentStatus = 'NOT_DETERMINED' | 'YES' | 'NO';

export interface Source {
  readonly title: string;
  readonly url: string;
}

export interface ComponentSpec {
  readonly id: 'A' | 'B';
  /** The issuing entity as the issuer names it — never an exchange or a chain. */
  readonly issuer: string;
  /** What the series would actually hold, including the wrapper if one is used. */
  readonly instrument: string;
  readonly chain: string;
  readonly verification: Verification;
  /** Base units per lot — an illustration for the model, not a chosen parameter. */
  readonly perLotIllustrative: bigint;
  readonly known: readonly string[];
  readonly unknown: readonly string[];
  readonly statuses: {
    readonly transferable: ComponentStatus;
    readonly unwrappable: ComponentStatus;
    readonly marketOffer: ComponentStatus;
    readonly issuerRedemption: ComponentStatus;
  };
  readonly sources: readonly Source[];
}

export interface SeriesSpec {
  readonly id: string;
  readonly name: string;
  readonly company: string;
  /** For the specification only. Not an issued token, not a checked name. */
  readonly illustrativeSymbol: string;
  readonly stage: 'DESIGN';
  readonly stageLine: string;
  readonly chain: string;
  readonly receiptDecimals: 0;
  readonly capLotsIllustrative: bigint;
  readonly components: readonly [ComponentSpec, ComponentSpec];
  readonly rules: readonly string[];
  readonly deferred: readonly string[];
}

export const APPLE_S1: SeriesSpec = {
  id: 'apple-s1',
  name: 'Apple Position — Series 1',
  company: 'Apple Inc.',
  illustrativeSymbol: 'cAAPL-S1',
  stage: 'DESIGN',
  stageLine: 'Not live. A prototype contract is tested on Ethereum forks and a local chain; the series is not deployed, its network is still a gate, and no issuer integration exists. The Robinhood Chain treasury is a separate role, not an Ethereum series operator. Positions do not depend on CURB.',
  chain: 'Ethereum — the candidate network; both components being there is a gate, not a given',
  receiptDecimals: 0,
  capLotsIllustrative: 1_000n,
  components: [
    {
      id: 'A',
      issuer: 'xStocks (Backed) — the legal entity comes from the issuer’s documents, not assumed here',
      instrument: 'AAPLx, held as the official non-rebasing wrapper, not raw AAPLx',
      chain: 'Ethereum',
      verification: 'CANDIDATE',
      perLotIllustrative: 10n,
      known: [
        'Apple exposure, deployed on Ethereum as an ERC-20.',
        'A non-rebasing wrapper in two versions; the public API returns wrapperAddress and wrapperAddressV2.',
        'Corporate actions change raw balances and multipliers, so the wrapper is the candidate unit.',
      ],
      unknown: [
        'Which wrapper address and version would be the component — to be checked on chain, not taken from the API.',
        'Whether the wrapper balance stays static through every corporate action. Shown for the 8 August 2026 dividend; no split on record.',
        'Whether a Curb series contract and its receipt holders are eligible holders.',
      ],
      statuses: { transferable: 'NOT_DETERMINED', unwrappable: 'NOT_DETERMINED', marketOffer: 'NOT_DETERMINED', issuerRedemption: 'NOT_DETERMINED' },
      sources: [
        { title: 'AAPLx product page', url: 'https://assets.backed.fi/products/apple-xstock' },
        { title: 'xStocks FAQ', url: 'https://docs.xstocks.fi/docs/frequently-asked-questions' },
        { title: 'xStocks corporate actions', url: 'https://docs.xstocks.fi/docs/dividends-and-stock-splits' },
        { title: 'Wrapped xStocks', url: 'https://docs.xstocks.fi/developers/wrapped-xstocks' },
        { title: 'AAPLx public endpoint', url: 'https://api.xstocks.fi/api/v2/public/assets/AAPLx' },
      ],
    },
    {
      id: 'B',
      issuer: 'Ondo (Global Markets) — the legal entity comes from the issuer’s documents, not assumed here',
      instrument: 'AAPLon',
      chain: 'Ethereum',
      verification: 'CANDIDATE',
      perLotIllustrative: 20n,
      known: [
        'AAPLon is live on Ethereum; the product page lists each deployment, its decimals and a live shares-per-token figure.',
        'Smart contracts may hold it, access rules still apply; transferable outside the U.S., with restrictions.',
        'Dividends are reinvested in the token price, so no cash balance arises in the series.',
        'Ankura Trust Company is security and attestation agent; Spearbit and Cyfrin are named auditors.',
      ],
      unknown: [
        'The address API needs a key (403 without one); the address used is the product page’s, read on chain daily.',
        'Whether a Curb series contract and its holders are eligible. Being able to hold is not eligibility.',
        'How corporate actions display across networks, for the version that would be used.',
      ],
      statuses: { transferable: 'NOT_DETERMINED', unwrappable: 'NOT_DETERMINED', marketOffer: 'NOT_DETERMINED', issuerRedemption: 'NOT_DETERMINED' },
      sources: [
        { title: 'Ondo Global Markets launch', url: 'https://ondo.finance/blog/global-markets-is-live' },
        { title: 'Ondo disclaimers', url: 'https://docs.ondo.finance/legal/disclaimers' },
        { title: 'Investing & redeeming', url: 'https://docs.ondo.finance/ondo-stocks/investing-and-redeeming' },
        { title: 'Eligibility', url: 'https://docs.ondo.finance/ondo-stocks/eligibility' },
        { title: 'Corporate actions', url: 'https://docs.ondo.finance/ondo-stocks/corporate-actions' },
        { title: 'Trust & transparency', url: 'https://docs.ondo.finance/ondo-stocks/trust-and-transparency' },
        { title: 'Secondary market restrictions', url: 'https://docs.ondo.finance/ondo-stocks/secondary-market-restrictions' },
        { title: 'Transferability', url: 'https://docs.ondo.finance/ondo-stocks/transferability' },
        { title: 'Technical', url: 'https://docs.ondo.finance/ondo-stocks/technical' },
        { title: 'AAPLon product page', url: 'https://app.ondo.finance/assets/aaplon' },
      ],
    },
  ],
  rules: [
    'One company, two components from two issuers, one network.',
    'Fixed units of each component per lot, set once, never changed.',
    'Deposits are in kind and atomic: both arrive or no receipt.',
    'Exit burns the receipt; each component is claimed separately to the holder’s wallet.',
    'A receipt is one whole lot (decimals = 0): not one share, not one dollar.',
    'No rebalancing: a falling component is never bought more of.',
    'Receipts are not transferable here. Exit is by claim, not sale.',
    'An upgrade is a new series; components are never swapped under a holder.',
    'Mint and exit need no oracle and no model: rights are counted in units.',
    'Units sent straight to the contract change nothing and cannot be swept.',
  ],
  deferred: [
    'Stablecoin deposit and an automatic router',
    'Cash redemption',
    'Dynamic rebalancing',
    'Leverage, lending, insurance, bridges',
    'Uncurated lists and permissionless series',
    'Transferable receipts and a market for stuck claims',
    'Reward tokens, buybacks, and governance that could change an old series’ backing',
  ],
};

export const SERIES: readonly SeriesSpec[] = [APPLE_S1];

export function seriesById(id: string): SeriesSpec | null {
  return SERIES.find((s) => s.id === id) ?? null;
}

/** What the site may promise, and what it may not. Both are shown; neither is negotiable. */
export const PROMISES = {
  testable: [
    'A holder can know and prove the composition of their position.',
    'The ledger never erases a right to a component that cannot yet be transferred.',
    'Mint and exit require no decision by a model.',
  ],
  unsupported: [
    'Capital is protected.',
    'It cannot be frozen.',
    'It is the same as holding the share directly.',
    'It is automatically safer.',
    'It can always be sold at the reference value.',
    'It earns more.',
    'The issuers or custodians are fully independent of each other.',
    'It is the first of its kind.',
  ],
} as const;

/** The gates a real-asset pilot must pass, and where each stands. */
export interface Gate {
  readonly id: string;
  readonly name: string;
  readonly evidence: string;
  readonly status: 'NOT_STARTED' | 'IN_RESEARCH' | 'PASSED';
  readonly today: string;
}

export const GATES: readonly Gate[] = [
  { id: 'G1', name: 'Instrument', evidence: 'Two issuers, one underlying, one chain, canonical identities', status: 'IN_RESEARCH', today: 'A’s raw token, both wrappers and B’s token are read on Ethereum daily and match the issuers’ records. Related parties are mapped; B’s broker-dealer and custodian are not named.' },
  { id: 'G2', name: 'Rights and access', evidence: 'Review of holder rights, user categories, contract custody, receipt distribution, exit process', status: 'NOT_STARTED', today: 'Technical ability to hold a token is not enough.' },
  { id: 'G3', name: 'Components', evidence: 'Static unit balances, decimals, correct wrapper version, authority, real transfer and claim under test', status: 'IN_RESEARCH', today: 'On an Ethereum fork the real wrapper transfers and unwraps, AAPLon transfers, and a series took both in and paid both out. Who stands behind each address is recorded. Through the 8 August 2026 dividend the wrapper’s shares held still (T14). No split on record; eligibility is not a fork question.' },
  { id: 'G4', name: 'Contract', evidence: 'Invariants and adversarial tests pass; independent review; material findings closed', status: 'IN_RESEARCH', today: 'The prototype in contracts/ passes T01–T12, T17, T19, T20, T22–T25 and a fuzz run. No independent review, no audit, no deployment.' },
  { id: 'G5', name: 'Operations', evidence: 'Reconciliation, index recovery, incident drill, key management, direct claim UI', status: 'IN_RESEARCH', today: 'Reconciliation, index recovery, the incident drill and wallet mint/claim are rehearsed on a local chain with mock components. A 2-of-3 treasury Safe is recorded on Robinhood Chain. An Ethereum series operator and key policy are not yet approved.' },
  { id: 'G6', name: 'Economics', evidence: 'Measured cost to form and exit; user need against the baseline of holding both tokens', status: 'IN_RESEARCH', today: 'Gas to form and exit is measured on a fork, with no price applied. User need is not validated: the owner decided on 20 September 2026 not to hold interviews.' },
];

/** The three steps, in the words the site uses. */
export const STEPS = [
  { title: 'Choose a company', body: 'See the issuers and the components a series would hold.' },
  { title: 'Form a position', body: 'Deposit both components per lot. Both arrive or neither does.' },
  { title: 'Manage the exit', body: 'Claim each component separately. One stuck component does not hold the other.' },
] as const;

/** The worked ledger example from the blueprint, with its illustrative units. */
export const WORKED_EXAMPLE = {
  q: { A: 10n, B: 20n },
  capLots: 1_000n,
  lots: 100n,
  alice: 25n,
  bob: 10n,
} as const;
