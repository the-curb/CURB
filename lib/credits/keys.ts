/**
 * API keys and what they have been credited and charged.
 *
 * A key is a secret whoever uses it makes themselves — thirty-two random
 * bytes — and the desk never sees it until it is presented. What the chain
 * credits is the key's SHA-256, put on chain in `topUp`; what the desk
 * stores is by that hash. So the desk keeps nothing about a key until the
 * chain says something about it, and there is nothing to create, leak or
 * spam. Two rows per hash, each with one writer, so the indexer crediting a
 * top-up and a request charging a call never overwrite each other:
 *
 *   credits:topups:<hash>  what the chain credited — written by the indexer only
 *   credits:spend:<hash>   what calls consumed — written by the guard only
 *
 * The balance is credited minus spent, computed at read time. A key opens
 * when its cumulative credit reaches the minimum (TOKEN.md); below that it
 * keeps its balance and buys nothing.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { SnapshotRecord, Store } from '../store/types.ts';
import { MINIMUM_OPEN_CENTS, type ServiceId } from './prices.ts';

export const TOPUPS_PREFIX = 'credits:topups:';
export const SPEND_PREFIX = 'credits:spend:';

export const topUpsRow = (hash: string) => `${TOPUPS_PREFIX}${hash}`;
export const spendRow = (hash: string) => `${SPEND_PREFIX}${hash}`;

const KEY_RE = /^curb_[A-Za-z0-9_-]{43}$/;
const HASH_RE = /^0x[0-9a-f]{64}$/;

/** A new key: 32 random bytes, base64url, with a prefix so it is recognisable in a header. Stateless: nothing is recorded. */
export function newKey(): string {
  return `curb_${randomBytes(32).toString('base64url')}`;
}

export function isKey(v: string): boolean {
  return KEY_RE.test(v);
}

export function isKeyHash(v: string): boolean {
  return HASH_RE.test(v);
}

/** The hash the chain sees: SHA-256 of the key's UTF-8 bytes, as a 32-byte hex word. */
export function keyHashOf(key: string): string {
  return `0x${createHash('sha256').update(key, 'utf8').digest('hex')}`;
}

export interface TopUpCredit {
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly payer: string;
  /** CURB base units. */
  readonly amount: string;
  /** US dollars per CURB scaled by 1e18, as read. */
  readonly usdPerCurb18: string;
  /** The block the rate was read at, and why it was that one. */
  readonly ratedAtBlock: number;
  readonly basis: 'TOP_UP_BLOCK' | 'HEAD_AT_INDEXING';
  readonly cents: string;
  readonly creditedAt: string;
}

export interface Charge {
  readonly at: string;
  readonly service: ServiceId;
  readonly cents: number;
  /** What was bought, in one line: the source, the day, the webhook. */
  readonly ref: string;
}

/** UNFUNDED: the chain has credited nothing to this hash. BELOW_MINIMUM: something, less than the minimum. OPEN: usable. */
export type KeyStatus = 'UNFUNDED' | 'BELOW_MINIMUM' | 'OPEN';

export interface KeyAccount {
  readonly hash: string;
  readonly status: KeyStatus;
  readonly creditedCents: string;
  readonly spentCents: string;
  readonly balanceCents: string;
  /** What is still to be credited before the key opens; "0" once it is. */
  readonly toOpenCents: string;
  readonly minimumOpenCents: number;
  readonly topUps: readonly TopUpCredit[];
  readonly charges: readonly Charge[];
  readonly chargeCount: number;
  readonly storeFault: string | null;
}

/** The most recent charges kept on the row; the totals count every one. */
export const CHARGES_KEPT = 100;

const big = (v: unknown): bigint => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : 0n);

function rowOf(rows: readonly SnapshotRecord[], key: string): SnapshotRecord | null {
  return rows.find((r) => r.key === key) ?? null;
}

export async function keyAccount(store: Store, hash: string): Promise<KeyAccount> {
  const empty: KeyAccount = {
    hash,
    status: 'UNFUNDED',
    creditedCents: '0',
    spentCents: '0',
    balanceCents: '0',
    toOpenCents: String(MINIMUM_OPEN_CENTS),
    minimumOpenCents: MINIMUM_OPEN_CENTS,
    topUps: [],
    charges: [],
    chargeCount: 0,
    storeFault: null,
  };
  const [topUps, spend] = await Promise.all([store.snapshots(topUpsRow(hash)), store.snapshots(spendRow(hash))]);
  if (topUps.state === 'UNREAD') return { ...empty, storeFault: `${topUps.reason}${topUps.detail ? ` — ${topUps.detail}` : ''}` };
  if (spend.state === 'UNREAD') return { ...empty, storeFault: `${spend.reason}${spend.detail ? ` — ${spend.detail}` : ''}` };

  const t = rowOf(topUps.value, topUpsRow(hash));
  const s = rowOf(spend.value, spendRow(hash));
  if (t === null) return empty;
  const credited = big(t.payload.creditedCents);
  const spent = big(s?.payload.spentCents);
  const toOpen = credited >= BigInt(MINIMUM_OPEN_CENTS) ? 0n : BigInt(MINIMUM_OPEN_CENTS) - credited;
  return {
    hash,
    status: credited >= BigInt(MINIMUM_OPEN_CENTS) ? 'OPEN' : 'BELOW_MINIMUM',
    creditedCents: credited.toString(),
    spentCents: spent.toString(),
    balanceCents: (credited - spent).toString(),
    toOpenCents: toOpen.toString(),
    minimumOpenCents: MINIMUM_OPEN_CENTS,
    topUps: Array.isArray(t.payload.topUps) ? (t.payload.topUps as TopUpCredit[]) : [],
    charges: Array.isArray(s?.payload.charges) ? (s.payload.charges as Charge[]) : [],
    chargeCount: typeof s?.payload.count === 'number' ? s.payload.count : 0,
    storeFault: null,
  };
}

export type ChargeOutcome =
  | { readonly ok: true; readonly account: KeyAccount; readonly charged: Charge }
  | { readonly ok: false; readonly status: KeyStatus | 'INSUFFICIENT' | 'STORE_UNREADABLE' | 'NOT_RECORDED'; readonly account: KeyAccount; readonly detail: string };

/**
 * Charge one unit of a service to a key. Refused, with the reason, when the
 * key is unfunded, below the minimum, or short; recorded, with the
 * reference, when it is not. A charge that could not be recorded is not a
 * charge — the call is refused rather than served for free and forgotten.
 */
export async function charge(store: Store, hash: string, service: ServiceId, cents: number, ref: string, now: Date): Promise<ChargeOutcome> {
  const account = await keyAccount(store, hash);
  if (account.storeFault !== null) return { ok: false, status: 'STORE_UNREADABLE', account, detail: account.storeFault };
  if (account.status === 'UNFUNDED') return { ok: false, status: 'UNFUNDED', account, detail: 'the chain has credited nothing to this key hash' };
  if (account.status === 'BELOW_MINIMUM') return { ok: false, status: 'BELOW_MINIMUM', account, detail: `the key has been credited ${account.creditedCents} cents; it opens at ${MINIMUM_OPEN_CENTS}` };
  if (BigInt(account.balanceCents) < BigInt(cents)) return { ok: false, status: 'INSUFFICIENT', account, detail: `the balance is ${account.balanceCents} cents; this call is ${cents}` };
  const charged: Charge = { at: now.toISOString(), service, cents, ref };
  const charges = [...account.charges, charged].slice(-CHARGES_KEPT);
  const spent = (BigInt(account.spentCents) + BigInt(cents)).toString();
  const written = await store.writeSnapshots([{ key: spendRow(hash), observedAt: now.toISOString(), payload: { hash, spentCents: spent, count: account.chargeCount + 1, charges } }]);
  if (written.state !== 'WRITTEN') return { ok: false, status: 'NOT_RECORDED', account, detail: written.reason };
  return { ok: true, account: { ...account, spentCents: spent, balanceCents: (BigInt(account.balanceCents) - BigInt(cents)).toString(), charges, chargeCount: account.chargeCount + 1 }, charged };
}
