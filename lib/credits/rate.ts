/**
 * What a CURB is worth in dollars, read from a pool at a block.
 *
 * The rule is the token record's (docs/decisions/TOKEN.md): the price is the
 * ratio of a pool's reserves at a block, the market capitalisation is that
 * price times `totalSupply()` at the same block, and the desk states neither
 * unless it read both. A pool with an empty side has no price; a feed that
 * answers zero or less has no price; a node that cannot serve the block has
 * no price. Every one of those is UNREAD with its reason, never a stale
 * figure carried forward and never a number typed in.
 *
 * Arithmetic is in base units and scaled integers. Dollars are carried
 * scaled by 1e18 and rounded once, to cents, at the edge.
 */

import { decodeAddressWord, decodeInt, decodeUint, formatUnits, words } from '../chain/abi.ts';
import { selector } from '../chain/keccak.ts';
import { rpcCall, type RpcOptions } from '../chain/rpc.ts';
import { isRead, unread, type Reading } from '../doctrine/reading.ts';
import type { CreditsConfig } from './config.ts';

const SEL = {
  token0: selector('token0()'),
  token1: selector('token1()'),
  getReserves: selector('getReserves()'),
  decimals: selector('decimals()'),
  totalSupply: selector('totalSupply()'),
  latestRoundData: selector('latestRoundData()'),
} as const;

export interface Rate {
  readonly block: number;
  readonly token: { readonly address: string; readonly decimals: number; readonly supply: string };
  readonly pair: {
    readonly address: string;
    readonly reserveCurb: string;
    readonly reserveQuote: string;
    readonly quoteAddress: string;
    readonly quoteDecimals: number;
  };
  readonly quote:
    | { readonly kind: 'usd-stable' }
    | { readonly kind: 'chainlink-feed'; readonly feed: string; readonly answer: string; readonly decimals: number; readonly updatedAt: string };
  /** US dollars per CURB, scaled by 1e18. */
  readonly usdPerCurb18: string;
  /** Market capitalisation in US dollars, scaled by 1e18: price × supply. */
  readonly marketCapUsd18: string;
  readonly source: string;
  readonly readAt: string;
}

const hexBlock = (n: number) => `0x${n.toString(16)}`;

async function callAt(to: string, data: string, block: number, label: string, opts: RpcOptions): Promise<Reading<string>> {
  const raw = await rpcCall<string>('eth_call', [{ to, data }, hexBlock(block)], opts);
  if (!isRead(raw)) return raw;
  if (raw.value === '0x' || raw.value === '') return unread('FIELD_ABSENT', { source: raw.source, detail: `${label} returned no data at block ${block} — the function reverted or is not implemented` });
  return raw;
}

async function uintAt(to: string, data: string, block: number, label: string, opts: RpcOptions): Promise<Reading<bigint>> {
  const raw = await callAt(to, data, block, label, opts);
  if (!isRead(raw)) return raw;
  const w = words(raw.value);
  const v = w[0] === undefined ? null : decodeUint(w[0]);
  return v === null ? unread('SOURCE_MALFORMED', { source: raw.source, detail: `${label} undecodable` }) : { ...raw, value: v };
}

async function addressAt(to: string, data: string, block: number, label: string, opts: RpcOptions): Promise<Reading<string>> {
  const raw = await callAt(to, data, block, label, opts);
  if (!isRead(raw)) return raw;
  const w = words(raw.value);
  const v = w[0] === undefined ? null : decodeAddressWord(w[0]);
  return v === null ? unread('SOURCE_MALFORMED', { source: raw.source, detail: `${label} undecodable` }) : { ...raw, value: v.toLowerCase() };
}

/** The pool's reserves and the token's supply at one block, reduced to a price and a market capitalisation. */
export async function readRate(config: CreditsConfig, block: number, opts: RpcOptions, now: Date = new Date()): Promise<Reading<Rate>> {
  const pair = config.priceSource.pair;
  const [token0, token1, reserves, decimals, supply] = await Promise.all([
    addressAt(pair, SEL.token0, block, 'token0()', opts),
    addressAt(pair, SEL.token1, block, 'token1()', opts),
    callAt(pair, SEL.getReserves, block, 'getReserves()', opts),
    uintAt(config.token, SEL.decimals, block, 'decimals()', opts),
    uintAt(config.token, SEL.totalSupply, block, 'totalSupply()', opts),
  ]);
  if (!isRead(token0)) return token0;
  if (!isRead(token1)) return token1;
  if (!isRead(reserves)) return reserves;
  if (!isRead(decimals)) return decimals;
  if (!isRead(supply)) return supply;

  const curbIs0 = token0.value === config.token;
  const curbIs1 = token1.value === config.token;
  if (!curbIs0 && !curbIs1) return unread('SOURCE_MALFORMED', { source: reserves.source, detail: `the pool ${pair} holds ${token0.value} and ${token1.value}, neither of which is the configured token ${config.token}` });
  const quoteAddress = curbIs0 ? token1.value : token0.value;
  const w = words(reserves.value);
  const r0 = w[0] === undefined ? null : decodeUint(w[0]);
  const r1 = w[1] === undefined ? null : decodeUint(w[1]);
  if (r0 === null || r1 === null) return unread('SOURCE_MALFORMED', { source: reserves.source, detail: 'getReserves() undecodable' });
  const reserveCurb = curbIs0 ? r0 : r1;
  const reserveQuote = curbIs0 ? r1 : r0;
  if (reserveCurb === 0n || reserveQuote === 0n) return unread('FIELD_ABSENT', { source: reserves.source, detail: `the pool has an empty side at block ${block} (CURB ${reserveCurb}, quote ${reserveQuote}); there is no price` });

  const quoteDecimals = await uintAt(quoteAddress, SEL.decimals, block, 'quote decimals()', opts);
  if (!isRead(quoteDecimals)) return quoteDecimals;

  const dCurb = Number(decimals.value);
  const dQuote = Number(quoteDecimals.value);
  if (dCurb > 36 || dQuote > 36) return unread('SOURCE_MALFORMED', { source: reserves.source, detail: 'decimals beyond 36 are not handled' });

  // USD per CURB × 1e18 = reserveQuote × usdPerQuote × 10^(18 + dCurb − dQuote) / reserveCurb
  let quote: Rate['quote'];
  let numerator = reserveQuote * 10n ** 18n * 10n ** BigInt(dCurb);
  let denominator = reserveCurb * 10n ** BigInt(dQuote);
  if (config.priceSource.quote.kind === 'chainlink-feed') {
    const feed = config.priceSource.quote.feed;
    const [round, feedDecimals] = await Promise.all([callAt(feed, SEL.latestRoundData, block, 'latestRoundData()', opts), uintAt(feed, SEL.decimals, block, 'feed decimals()', opts)]);
    if (!isRead(round)) return round;
    if (!isRead(feedDecimals)) return feedDecimals;
    const parts = words(round.value);
    const answer = parts[1] === undefined ? null : decodeInt(parts[1]);
    const updatedAt = parts[3] === undefined ? null : decodeUint(parts[3]);
    if (answer === null || updatedAt === null || parts.length !== 5) return unread('SOURCE_MALFORMED', { source: round.source, detail: 'latestRoundData() undecodable' });
    if (answer <= 0n) return unread('FIELD_ABSENT', { source: round.source, detail: `the feed answered ${answer} at block ${block}; a price that is not positive is not a price` });
    numerator *= answer;
    denominator *= 10n ** feedDecimals.value;
    quote = { kind: 'chainlink-feed', feed, answer: answer.toString(), decimals: Number(feedDecimals.value), updatedAt: new Date(Number(updatedAt) * 1000).toISOString() };
  } else {
    quote = { kind: 'usd-stable' };
  }
  const usdPerCurb18 = numerator / denominator;
  if (usdPerCurb18 === 0n) return unread('FIELD_ABSENT', { source: reserves.source, detail: `the price rounds to zero at 18 places at block ${block}` });
  const marketCapUsd18 = (supply.value * usdPerCurb18) / 10n ** BigInt(dCurb);

  return {
    state: reserves.state,
    ageSeconds: reserves.ageSeconds,
    ...(reserves.state === 'STALE' ? { freshnessSeconds: reserves.freshnessSeconds } : {}),
    source: reserves.source,
    retrievedAt: reserves.retrievedAt,
    value: {
      block,
      token: { address: config.token, decimals: dCurb, supply: supply.value.toString() },
      pair: { address: pair, reserveCurb: reserveCurb.toString(), reserveQuote: reserveQuote.toString(), quoteAddress, quoteDecimals: dQuote },
      quote,
      usdPerCurb18: usdPerCurb18.toString(),
      marketCapUsd18: marketCapUsd18.toString(),
      source: reserves.source,
      readAt: now.toISOString(),
    },
  } as Reading<Rate>;
}

/** US cents an amount of CURB (base units) is worth at a rate, rounded down once. */
export function centsForCurb(rate: Rate, amount: bigint): bigint {
  const usd18 = (amount * BigInt(rate.usdPerCurb18)) / 10n ** BigInt(rate.token.decimals);
  return usd18 / 10n ** 16n;
}

/** The CURB (base units) that is worth at least `cents` at a rate, rounded up once. */
export function curbForCents(rate: Rate, cents: bigint): bigint {
  const numerator = cents * 10n ** 16n * 10n ** BigInt(rate.token.decimals);
  const price = BigInt(rate.usdPerCurb18);
  return (numerator + price - 1n) / price;
}

/** A dollar figure scaled by 1e18 as text, with the places asked for, no float. */
export function usd18Text(v: string | bigint, places: number): string {
  const full = formatUnits(typeof v === 'bigint' ? v : BigInt(v), 18);
  // formatUnits groups the whole part and strips trailing zeros; the places asked for are padded back.
  const [whole = '0', frac = ''] = full.split('.');
  if (places === 0) return `US$${whole}`;
  return `US$${whole}.${(frac + '0'.repeat(places)).slice(0, places)}`;
}

/** CURB base units as a token amount, grouped, without trailing zeros beyond the places asked for. */
export function curbText(amount: bigint, decimals: number, places = 4): string {
  const full = formatUnits(amount, decimals);
  const [whole = '0', frac = ''] = full.split('.');
  const f = frac.slice(0, places).replace(/0+$/, '');
  return f === '' ? whole : `${whole}.${f}`;
}
