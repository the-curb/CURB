/**
 * The tokens the Registrar knows how to look at, and what was observed the last
 * time a human recorded them.
 *
 * The recorded implementation address is a tripwire, not decoration. These are
 * upgradeable proxies: the address the proxy points at can change without the
 * proxy address changing, and a reader who checked the contract last month has
 * not checked the contract that is running today. When the live implementation
 * differs from what is recorded here, the Registrar reports the difference
 * instead of quietly describing new code with old findings.
 *
 * Nothing in this file is an endorsement, a listing, or a statement that a token
 * is suitable for anything. It is a list of addresses that were observed.
 */

export interface TokenRecord {
  readonly key: string;
  readonly address: string;
  /** What the issuer's own metadata called it when observed. Not a guarantee. */
  readonly observedSymbol: string;
  readonly observedName: string;
  readonly observedDecimals: number;
  /** The implementation the proxy pointed at when this was recorded. */
  readonly recordedImplementation: string;
  /** EIP-1967 admin slot state when observed: transparent proxies set it. */
  readonly recordedProxyPattern: 'transparent' | 'uups';
  readonly observedAt: string;
  readonly observedAtBlock: number;
  readonly source: string;
}

/**
 * The official contracts page listed exactly these two for mainnet when this was
 * recorded. Stock and ETF tokens are described there as coming from a live
 * on-chain registry, which is not the same thing as a published address list —
 * so those are absent here rather than guessed at.
 */
export const TOKENS: readonly TokenRecord[] = [
  {
    key: 'usdg',
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    observedSymbol: 'USDG',
    observedName: 'Global Dollar',
    observedDecimals: 6,
    recordedImplementation: '0x68184C449E1a8f34fA18d289737129FD27B66f8F',
    recordedProxyPattern: 'uups',
    observedAt: '2026-09-08T13:46:51Z',
    observedAtBlock: 57737007,
    source: 'https://docs.robinhood.com/chain/contracts/',
  },
  {
    key: 'weth',
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    observedSymbol: 'WETH',
    observedName: 'WETH',
    observedDecimals: 18,
    recordedImplementation: '0xC6B81b429797E0f555440b70cD99e032D7AE947e',
    recordedProxyPattern: 'transparent',
    observedAt: '2026-09-08T13:46:51Z',
    observedAtBlock: 57737007,
    source: 'https://docs.robinhood.com/chain/contracts/',
  },
];

export function tokenByKey(key: string): TokenRecord | null {
  return TOKENS.find((t) => t.key === key) ?? null;
}

/**
 * Questions that cannot be answered by reading the chain, listed once so every
 * audit carries the same third block and it is never empty for convenience.
 *
 * The first entry is the important one. A scan for pause or freeze selectors
 * that finds nothing has established nothing: issuers name these functions
 * differently, the logic can live behind a hook inside `transfer`, and the
 * implementation can be replaced tomorrow.
 */
export const UNKNOWABLE_FROM_CHAIN: readonly string[] = [
  'Whether the issuer can freeze, blacklist or claw back a holder’s balance. A selector scan that finds no pause or freeze function proves nothing — the capability can be named differently or live inside a transfer hook.',
  'Whether transfers take a fee or the balance rebases. A static read cannot establish this; it needs execution against a fork.',
  'What the implementation will be tomorrow. Both proxies are upgradeable by their issuer, so every finding here describes the code that was running at the block it was read.',
  'The holder’s legal claim — rights, distributions, eligibility, redemption. These live in the issuer’s published terms, not in the bytecode.',
];
