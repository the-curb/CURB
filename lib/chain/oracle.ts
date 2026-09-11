/**
 * Chainlink AggregatorV3Interface reads, plus the two Robinhood stock-token
 * fields that decide whether a price means what it appears to mean.
 *
 * Three things the vendor guidance says, kept here as code rather than as a
 * comment in a README:
 *
 *   1. Staleness is judged by `updatedAt` against the feed's heartbeat. It is
 *      the primary guard.
 *   2. A negative or zero answer is rejected, not displayed.
 *   3. `oraclePaused()` is advisory and NOT enforced on chain — a paused oracle
 *      may still return a value. So the flag never replaces the staleness check;
 *      it is reported alongside it.
 */

import { rpcCall, type RpcOptions } from './rpc.ts';
import { decodeInt, decodeString, decodeUint, SELECTORS, words } from './abi.ts';
import { unread, type Reading } from '../doctrine/reading.ts';

async function call(
  address: string,
  selector: string,
  label: string,
  opts: RpcOptions,
): Promise<Reading<string>> {
  const result = await rpcCall<string>(
    'eth_call',
    [{ to: address, data: selector }, 'latest'],
    opts,
  );
  if (result.state === 'UNREAD') return result;
  if (result.value === '0x' || result.value === '') {
    return unread('FIELD_ABSENT', {
      source: result.source,
      detail: `${label} returned no data — reverted or not implemented. Not a "no".`,
    });
  }
  return result;
}

export interface RoundData {
  readonly roundId: bigint;
  readonly answer: bigint;
  readonly startedAt: bigint;
  readonly updatedAt: bigint;
  readonly answeredInRound: bigint;
}

/**
 * The decoders are separate from the calls so that bytes read through a batch
 * (see multicall.ts) pass through exactly the same code as a direct call. One
 * decoder per field, and every one returns a Reading: undecodable bytes are
 * SOURCE_MALFORMED with the field named, never a zero.
 */
export function decodeRound(raw: Reading<string>): Reading<RoundData> {
  if (raw.state === 'UNREAD') return raw;

  const parts = words(raw.value);
  if (parts.length < 5) {
    return unread('SOURCE_MALFORMED', {
      source: raw.source,
      detail: `latestRoundData() returned ${parts.length} words, expected 5`,
    });
  }

  const roundId = decodeUint(parts[0]!);
  const answer = decodeInt(parts[1]!);
  const startedAt = decodeUint(parts[2]!);
  const updatedAt = decodeUint(parts[3]!);
  const answeredInRound = decodeUint(parts[4]!);

  if (
    roundId === null ||
    answer === null ||
    startedAt === null ||
    updatedAt === null ||
    answeredInRound === null
  ) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'round data undecodable' });
  }

  return { ...raw, value: { roundId, answer, startedAt, updatedAt, answeredInRound } };
}

export function decodeDecimals(raw: Reading<string>): Reading<number> {
  if (raw.state === 'UNREAD') return raw;
  const value = decodeUint(raw.value);
  if (value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'decimals() undecodable' });
  }
  return { ...raw, value: Number(value) };
}

export function decodeDescription(raw: Reading<string>): Reading<string> {
  if (raw.state === 'UNREAD') return raw;
  const value = decodeString(raw.value);
  if (value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: 'description() undecodable' });
  }
  return { ...raw, value };
}

/** A uint256 flag: zero is false, anything else is true, no data is unread. */
export function decodeFlag(raw: Reading<string>, label: string): Reading<boolean> {
  if (raw.state === 'UNREAD') return raw;
  const value = decodeUint(raw.value);
  if (value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: `${label} undecodable` });
  }
  return { ...raw, value: value !== 0n };
}

export function decodeUintReading(raw: Reading<string>, label: string): Reading<bigint> {
  if (raw.state === 'UNREAD') return raw;
  const value = decodeUint(raw.value);
  if (value === null) {
    return unread('SOURCE_MALFORMED', { source: raw.source, detail: `${label} undecodable` });
  }
  return { ...raw, value };
}

export async function readLatestRound(
  feedProxy: string,
  opts: RpcOptions,
): Promise<Reading<RoundData>> {
  return decodeRound(await call(feedProxy, SELECTORS.latestRoundData, 'latestRoundData()', opts));
}

export async function readFeedDecimals(
  feedProxy: string,
  opts: RpcOptions,
): Promise<Reading<number>> {
  return decodeDecimals(await call(feedProxy, SELECTORS.decimals, 'decimals()', opts));
}

export async function readFeedDescription(
  feedProxy: string,
  opts: RpcOptions,
): Promise<Reading<string>> {
  return decodeDescription(await call(feedProxy, SELECTORS.description, 'description()', opts));
}

/**
 * The advisory pause flag on a stock token. Tri-state: paused, not paused, or
 * the contract does not answer. The third is not the second, and because the
 * flag is not enforced on chain, none of the three replaces the staleness check.
 */
export async function readOraclePaused(
  tokenAddress: string,
  opts: RpcOptions,
): Promise<Reading<boolean>> {
  return decodeFlag(
    await call(tokenAddress, SELECTORS.oraclePaused, 'oraclePaused()', opts),
    'oraclePaused()',
  );
}

/**
 * Shares per token, scaled by 1e18. A stock token tracks the total return of the
 * underlying: reinvested dividends raise the multiplier, so one token comes to
 * represent more than one share and the feed price drifts above the headline
 * share price. Reporting the feed price as "the share price" is wrong by exactly
 * this factor, and the error grows quietly over time.
 */
export async function readUiMultiplier(
  tokenAddress: string,
  opts: RpcOptions,
): Promise<Reading<bigint>> {
  return decodeUintReading(
    await call(tokenAddress, SELECTORS.uiMultiplier, 'uiMultiplier()', opts),
    'uiMultiplier()',
  );
}

/**
 * A multiplier change that has been announced but has not taken effect yet,
 * with the moment it does. This pair is the only forward-looking thing in the
 * whole system, and it is not a forecast: it is a scheduled change the issuer
 * has already published on chain.
 */
export async function readPendingMultiplier(
  tokenAddress: string,
  opts: RpcOptions,
): Promise<{ next: Reading<bigint>; effectiveAt: Reading<bigint> }> {
  const [next, effective] = await Promise.all([
    call(tokenAddress, SELECTORS.newUIMultiplier, 'newUIMultiplier()', opts),
    call(tokenAddress, SELECTORS.effectiveAt, 'effectiveAt()', opts),
  ]);

  return {
    next: decodeUintReading(next, 'newUIMultiplier()'),
    effectiveAt: decodeUintReading(effective, 'effectiveAt()'),
  };
}

/** The multiplier is scaled by 1e18. Dividing later, or not at all, is the
 *  documented way to be wrong by a factor of a billion billion. */
export const MULTIPLIER_SCALE = 10n ** 18n;

export function formatMultiplier(raw: bigint): string {
  const whole = raw / MULTIPLIER_SCALE;
  const fraction = (raw % MULTIPLIER_SCALE).toString().padStart(18, '0').slice(0, 6);
  return `${whole}.${fraction}`;
}

/** All eighteen places, as the issuer's registry prints its own figure. Lossless. */
export function formatMultiplierExact(raw: bigint): string {
  const whole = raw / MULTIPLIER_SCALE;
  const fraction = (raw % MULTIPLIER_SCALE).toString().padStart(18, '0');
  return `${whole}.${fraction}`;
}

export type SequencerVerdict =
  | { readonly kind: 'UP'; readonly sinceSeconds: number }
  | { readonly kind: 'DOWN' }
  | { readonly kind: 'NOT_CHECKED'; readonly reason: string };

/**
 * Answer 0 means the sequencer is up. A recent recovery still warrants caution,
 * so the time since the status changed is reported rather than swallowed.
 *
 * When no feed address is configured this returns NOT_CHECKED. That is
 * deliberately not the same value as UP.
 */
export async function readSequencer(
  feedProxy: string | null,
  opts: RpcOptions,
  now: Date = new Date(),
): Promise<SequencerVerdict> {
  if (feedProxy === null) {
    return {
      kind: 'NOT_CHECKED',
      reason: 'no sequencer uptime feed configured; the sequencer was not checked',
    };
  }
  const round = await readLatestRound(feedProxy, opts);
  if (round.state === 'UNREAD') {
    return { kind: 'NOT_CHECKED', reason: `sequencer feed unread: ${round.reason}` };
  }
  if (round.value.answer !== 0n) return { kind: 'DOWN' };
  const sinceSeconds = Math.max(
    0,
    Math.round(now.getTime() / 1000 - Number(round.value.startedAt)),
  );
  return { kind: 'UP', sinceSeconds };
}

/** Format a feed answer against its decimals, rejecting non-positive values. */
export function formatAnswer(answer: bigint, decimals: number): string | null {
  if (answer <= 0n) return null;
  const digits = answer.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = digits.slice(digits.length - decimals).slice(0, 2);
  return `${whole}.${fraction}`;
}
