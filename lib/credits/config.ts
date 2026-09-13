/**
 * Where the credit desk lives — when it lives anywhere.
 *
 * No token exists and the desk is not deployed. The desk is configured, never
 * assumed: `CURB_CREDITS` is one JSON record, filled only from what was
 * read from the chain after a launch (docs/decisions/TOKEN.md, "the order
 * of work"). Absent, every credit function reports NOT_CONFIGURED; a record
 * that does not parse is a fault with its reason, not a silent skip.
 *
 *   {
 *     "network": "ethereum-mainnet",
 *     "token": "0x…",                      the CURB token
 *     "desk": "0x…",                       the CreditDesk contract
 *     "treasury": "0x…",                   the operator multisig the desk pays to — the desk's own immutable, verified each tick
 *     "fromBlock": 21000000,               the block the desk was created in
 *     "priceSource": {                     or null until a pool exists: the desk is verified and top-ups are indexed, but nothing is priced
 *       "kind": "uniswap-v2-pair",         or "uniswap-v3-pool" for a concentrated-liquidity pool (slot0 / Swap)
 *       "pair": "0x…",                     a pool holding CURB and the quote asset
 *       "fromBlock": 61300000,             the block the pool was created in, read from the chain; a top-up before it is priced at the head when indexed
 *       "quote": { "kind": "usd-stable" }  or { "kind": "chainlink-feed", "feed": "0x…" } for a quote priced in USD by a feed
 *     }
 *   }
 */

import { NETWORKS, type NetworkProfile } from '../chain/networks.ts';

export const CREDITS_ENV = 'CURB_CREDITS';

export type QuoteSource = { readonly kind: 'usd-stable' } | { readonly kind: 'chainlink-feed'; readonly feed: string };

export type PoolKind = 'uniswap-v2-pair' | 'uniswap-v3-pool';

export interface PriceSource {
  readonly kind: PoolKind;
  /** The pool's address — a pair or a v3 pool; the field keeps its first name. */
  readonly pair: string;
  /** The block the pool was created in, from the chain. A top-up mined before it is priced at the head when indexed; without it, a top-up the pool has no event before waits. */
  readonly fromBlock: number | null;
  readonly quote: QuoteSource;
}

export interface CreditsConfig {
  readonly network: NetworkProfile;
  readonly token: string;
  readonly desk: string;
  /** Where every top-up goes: the published treasury, the desk's immutable, checked against the code each tick. */
  readonly treasury: string;
  readonly fromBlock: number;
  /** Null before a pool exists: the desk runs, top-ups wait unpriced, and the page says no pool is recorded. */
  readonly priceSource: PriceSource | null;
}

export type CreditsStatus =
  | { readonly state: 'NOT_CONFIGURED'; readonly detail: string }
  | { readonly state: 'CONFIG_INVALID'; readonly detail: string }
  | { readonly state: 'CONFIGURED'; readonly config: CreditsConfig };

const isAddress = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);

export function parseCreditsConfig(raw: string | undefined): CreditsStatus {
  if (raw === undefined || raw.trim() === '') {
    return { state: 'NOT_CONFIGURED', detail: `${CREDITS_ENV} is not set: no token, no desk and no pool are configured, so nothing is read and no rate is quoted` };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { state: 'CONFIG_INVALID', detail: `${CREDITS_ENV} is not JSON` };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { state: 'CONFIG_INVALID', detail: `${CREDITS_ENV} must be an object` };
  const e = body as Record<string, unknown>;
  const network = NETWORKS[e.network as NetworkProfile['id']];
  if (!network) return { state: 'CONFIG_INVALID', detail: `network must be one of ${Object.keys(NETWORKS).join(', ')}` };
  if (!isAddress(e.token)) return { state: 'CONFIG_INVALID', detail: 'token is not a 20-byte hex address' };
  if (!isAddress(e.desk)) return { state: 'CONFIG_INVALID', detail: 'desk is not a 20-byte hex address' };
  if (e.token.toLowerCase() === e.desk.toLowerCase()) return { state: 'CONFIG_INVALID', detail: 'token and desk share an address' };
  const treasury = e.treasury;
  if (!isAddress(treasury)) return { state: 'CONFIG_INVALID', detail: 'treasury is not a 20-byte hex address' };
  if ([e.token, e.desk].some((a) => a.toLowerCase() === treasury.toLowerCase())) return { state: 'CONFIG_INVALID', detail: 'the treasury cannot be the token or the desk' };
  if (!Number.isInteger(e.fromBlock) || (e.fromBlock as number) < 0) return { state: 'CONFIG_INVALID', detail: 'fromBlock must be a non-negative integer' };
  const ps = e.priceSource as Record<string, unknown> | null | undefined;
  if (ps === null || ps === undefined) {
    return { state: 'CONFIGURED', config: { network, token: e.token.toLowerCase(), desk: e.desk.toLowerCase(), treasury: treasury.toLowerCase(), fromBlock: e.fromBlock as number, priceSource: null } };
  }
  if (typeof ps !== 'object') return { state: 'CONFIG_INVALID', detail: 'priceSource must be an object or null' };
  if (ps.kind !== 'uniswap-v2-pair' && ps.kind !== 'uniswap-v3-pool') return { state: 'CONFIG_INVALID', detail: `priceSource.kind ${JSON.stringify(ps.kind)} is not supported; the reader knows uniswap-v2-pair and uniswap-v3-pool` };
  if (!isAddress(ps.pair)) return { state: 'CONFIG_INVALID', detail: 'priceSource.pair is not a 20-byte hex address' };
  const q = ps.quote as Record<string, unknown> | undefined;
  let quote: QuoteSource;
  if (q && q.kind === 'usd-stable') quote = { kind: 'usd-stable' };
  else if (q && q.kind === 'chainlink-feed' && isAddress(q.feed)) quote = { kind: 'chainlink-feed', feed: q.feed.toLowerCase() };
  else return { state: 'CONFIG_INVALID', detail: 'priceSource.quote must be { kind: "usd-stable" } or { kind: "chainlink-feed", feed: "0x…" }' };
  if (ps.fromBlock !== undefined && ps.fromBlock !== null && (!Number.isInteger(ps.fromBlock) || (ps.fromBlock as number) < 0)) return { state: 'CONFIG_INVALID', detail: 'priceSource.fromBlock must be a non-negative integer, or absent' };
  return {
    state: 'CONFIGURED',
    config: {
      network,
      token: e.token.toLowerCase(),
      desk: e.desk.toLowerCase(),
      treasury: treasury.toLowerCase(),
      fromBlock: e.fromBlock as number,
      priceSource: { kind: ps.kind, pair: ps.pair.toLowerCase(), fromBlock: typeof ps.fromBlock === 'number' ? ps.fromBlock : null, quote },
    },
  };
}

export function creditsStatus(raw: string | undefined = process.env[CREDITS_ENV]): CreditsStatus {
  return parseCreditsConfig(raw);
}
