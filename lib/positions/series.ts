/**
 * The one series the site describes, and everything the site is allowed to
 * say about it. A design, not a deployment: no contract exists, no issuer
 * integration has been made, no transaction has been sent. Every figure here
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
  stageLine: 'Design and testing. No Curb contract, issuer integration, transaction or deployment exists for this series.',
  chain: 'Ethereum — the candidate network; availability of both components on it is a gate, not a given',
  receiptDecimals: 0,
  capLotsIllustrative: 1_000n,
  components: [
    {
      id: 'A',
      issuer: 'xStocks (Backed) — the legal issuing entity is to be taken from the issuer’s own documents, not assumed here',
      instrument: 'AAPLx, held as the official non-rebasing wrapper — not raw AAPLx, whose balance behaviour is not assumed to be a static ERC-20',
      chain: 'Ethereum',
      verification: 'CANDIDATE',
      perLotIllustrative: 10n,
      known: [
        'The issuer documents Apple exposure and an Ethereum/ERC-20 deployment.',
        'The issuer documents a non-rebasing wrapper and distinguishes an older and a current version; its public API returns deployments, a wrapperAddress and a wrapperAddressV2.',
        'Corporate actions are documented as affecting balances and multipliers — which is why the wrapper, not the raw token, is the candidate unit.',
      ],
      unknown: [
        'Which wrapper address and version would be the component, checked against chain, asset(), code and the issuer’s stated version — not the first API field that looks right.',
        'Whether the wrapper’s unit balance stays static under every corporate action: shown on a fork across the dividend activation of 8 August 2026; a split is not on the record.',
        'Holder eligibility for a Curb series contract and for receipt holders.',
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
      issuer: 'Ondo (Global Markets) — the legal issuing entity is to be taken from the issuer’s own documents, not assumed here',
      instrument: 'AAPLon',
      chain: 'Ethereum',
      verification: 'CANDIDATE',
      perLotIllustrative: 20n,
      known: [
        'The issuer documents AAPLon and an Ethereum launch; its product page publishes the deployments per network with chain id and decimals, and a live shares-per-token figure.',
        'The issuer documents that smart contracts may hold the token, with access requirements still applying; the token is transferable outside the U.S., subject to restrictions.',
        'Dividends are documented as reinvested in token pricing; no separate cash balance would arise in the series.',
        'The issuer names Ankura Trust Company as security agent and as the verification agent for daily attestations, and names Spearbit and Cyfrin as its auditors.',
      ],
      unknown: [
        'The issuer’s documented API for addresses answers 403 without a key; the candidate address is the one the issuer’s product page publishes, read on chain daily and never taken from an example.',
        'Whether a Curb series contract and its receipt holders satisfy the issuer’s eligibility — technical ability to hold is not eligibility.',
        'Display treatment of corporate actions across networks, verified against the version that would be used.',
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
    'One company per series. Two components, from two issuers, on one network.',
    'A fixed number of base units of each component per lot, set when the series is made and never changed.',
    'Deposits are in kind: both components, exactly, in one atomic transaction. If one fails to arrive, no receipt is issued.',
    'Exit allocates every component and burns the receipt; each component is then claimed separately, to the holder’s own wallet.',
    'A receipt is one whole lot (decimals = 0). It is not one share, and not one dollar.',
    'No rebalancing. A component falling in value does not make the series buy more of it.',
    'Receipts cannot be transferred in the experiment. Exit is by claim, not by sale.',
    'An upgrade is a new series. Old components are never swapped underneath a holder.',
    'Mint and exit need no oracle and no model: rights are counted in units.',
    'Units sent straight to the contract change no lot, no receipt and no claim, and cannot be swept.',
  ],
  deferred: [
    'Single-stablecoin deposit and an automatic router',
    'Cash redemption',
    'Dynamic rebalancing',
    'Leverage, lending, insurance, bridges',
    'Uncurated stock lists and permissionless series',
    'Free transfer of receipts and a market for stuck claims',
    'Reward tokens, buybacks, and governance able to change the backing of an old series',
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
  { id: 'G1', name: 'Instrument', evidence: 'Two issuers, one underlying, one chain, canonical identities', status: 'IN_RESEARCH', today: 'A’s raw token and both wrappers, and B’s token as the issuer’s product page publishes it, are read on Ethereum daily (code, symbol, decimals, asset(), the EIP-1967 slots) and match the issuers’ records. The related parties are mapped from the documents; B’s broker-dealer and custodian are described but not named.' },
  { id: 'G2', name: 'Rights and access', evidence: 'Review of holder rights, user categories, contract custody, receipt distribution, exit process', status: 'NOT_STARTED', today: 'Technical ability to hold a token is not enough.' },
  { id: 'G3', name: 'Components', evidence: 'Static unit balances, decimals, correct wrapper version, authority, real transfer and claim under test', status: 'IN_RESEARCH', today: 'On a fork of Ethereum the real wrapper transfers and unwraps, real AAPLon transfers, and one series took both real components in and paid both out; who stands behind each address is recorded; across the issuer’s dividend activation of 8 August 2026 the wrapper’s shares did not move while the raw balance did (T14). A split is not on the record; eligibility is not a fork question.' },
  { id: 'G4', name: 'Contract', evidence: 'Invariants and adversarial tests pass; independent review; material findings closed', status: 'IN_RESEARCH', today: 'A prototype in contracts/ passes the blueprint’s cases T01–T12, T17, T19, T20, T22–T25 and a fuzz run. No independent review, no audit, no deployment.' },
  { id: 'G5', name: 'Operations', evidence: 'Reconciliation, index recovery, incident drill, key management, direct claim UI', status: 'IN_RESEARCH', today: 'Reconciliation, index recovery and the incident drill are shown on a local chain with mock components; a holder’s own wallet mints and claims from the series page against a deployed series, rehearsed on that chain. No signers exist, so key management and the operator multisig are a written proposal only.' },
  { id: 'G6', name: 'Economics', evidence: 'Measured cost to form and exit; user need against the baseline of holding both tokens', status: 'IN_RESEARCH', today: 'Execution gas to form and exit is measured on a fork with the real wrapper, with no price applied. User need against the baseline is not validated: no interviews have been held.' },
];

/** The three steps, in the words the site uses. */
export const STEPS = [
  { title: 'Choose a company', body: 'See the representations, the issuers behind them, and the components a series would hold.' },
  { title: 'Form a position', body: 'Deposit each component in the amount per lot shown. Both arrive or neither does; the receipt exists only after both.' },
  { title: 'Manage the exit', body: 'Allocate lots for exit and claim each component separately. One component that cannot move does not hold the other.' },
] as const;

/** The worked ledger example from the blueprint, with its illustrative units. */
export const WORKED_EXAMPLE = {
  q: { A: 10n, B: 20n },
  capLots: 1_000n,
  lots: 100n,
  alice: 25n,
  bob: 10n,
} as const;
