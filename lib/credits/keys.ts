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
 *   credits:spend:<hash>   what calls consumed — written by charge() only: the gate on a
 *                          paid call, and the fan-out charging a delivery; never the indexer
 *
 * The balance is credited minus spent, computed at read time. A key opens
 * when its cumulative credit reaches the minimum (TOKEN.md); below that it
 * keeps its balance and buys nothing.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { SnapshotRecord, Store } from '../store/types.ts';
import { MINIMUM_OPEN_CENTS, type ServiceId } from './prices.ts';
import { pendingIndex, type PendingState } from './pending.ts';

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
  /** The desk the top-up went through; a desk that is redeployed leaves its earlier credits standing under its old address. */
  readonly desk?: string;
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly payer: string;
  /** CURB base units. */
  readonly amount: string;
  /** US dollars per CURB scaled by 1e18, as read. */
  readonly usdPerCurb18: string;
  /**
   * The block the rate was read at, and how: TOP_UP_BLOCK by state at that
   * block; TOP_UP_BLOCK_EVENTS from the pool's last event at or before it,
   * when the node no longer served its state; HEAD_AT_INDEXING when neither
   * could be had and the head when indexed was used instead.
   */
  readonly ratedAtBlock: number;
  readonly basis: 'TOP_UP_BLOCK' | 'TOP_UP_BLOCK_EVENTS' | 'HEAD_AT_INDEXING';
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

/** A top-up the indexer has read but not yet credited, with why — waiting for a rate, or next in line. */
export interface PendingTopUp {
  readonly transactionHash: string;
  readonly logIndex: number;
  readonly blockNumber: number;
  readonly amount: string;
  readonly reason: string;
}

export interface KeyAccount {
  readonly hash: string;
  readonly balanceState: 'READ' | 'UNREAD';
  readonly status: KeyStatus;
  readonly creditedCents: string;
  readonly spentCents: string;
  readonly balanceCents: string;
  /** What is still to be credited before the key opens; "0" once it is. */
  readonly toOpenCents: string;
  readonly minimumOpenCents: number;
  readonly topUps: readonly TopUpCredit[];
  /** Read from the chain, not yet credited: visible so a payer can see their top-up landed and what it waits for. */
  readonly pending: readonly PendingTopUp[] | null;
  readonly pendingState: PendingState;
  readonly pendingFault: string | null;
  readonly charges: readonly Charge[];
  readonly chargeCount: number;
  /** The spend row's version as read, for the conditional write a charge makes; null before the first charge. */
  readonly spendVersion: number | null;
  readonly storeFault: string | null;
}

/** The most recent charges kept on the row; the totals count every one. */
export const CHARGES_KEPT = 100;

const big = (v: unknown): bigint => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : 0n);

function rowOf(rows: readonly SnapshotRecord[], key: string): SnapshotRecord | null {
  return rows.find((r) => r.key === key) ?? null;
}

/**
 * The account as the API states it. `pending` (the key's top-ups read but
 * not yet credited) comes from the index row; a charge or an admission
 * needs the totals only and passes `{ pending: false }` so the index row
 * — every waiting top-up on the desk — is not read on every paid call.
 */
export async function keyAccount(store: Store, hash: string, opts: { readonly pending?: boolean } = {}): Promise<KeyAccount> {
  const wantPending = opts.pending !== false;
  const [topUps, spend, index] = await Promise.all([store.snapshots(topUpsRow(hash)), store.snapshots(spendRow(hash)), wantPending ? store.snapshots('credits:index') : Promise.resolve(null)]);
  const indexRead = pendingIndex(index);
  const pending: PendingTopUp[] | null = indexRead.index === null ? null : indexRead.index.unpriced
    .filter((u) => u.keyHash === hash)
    .map((u) => ({ transactionHash: u.transactionHash, logIndex: typeof u.logIndex === 'number' ? u.logIndex : -1, blockNumber: u.blockNumber, amount: u.amount, reason: typeof u.reason === 'string' ? u.reason : 'waiting for a rate' }));
  const pendingFields = { pending, pendingState: indexRead.state, pendingFault: indexRead.fault };
  const empty: KeyAccount = {
    hash,
    balanceState: 'UNREAD',
    status: 'UNFUNDED',
    creditedCents: '0',
    spentCents: '0',
    balanceCents: '0',
    toOpenCents: String(MINIMUM_OPEN_CENTS),
    minimumOpenCents: MINIMUM_OPEN_CENTS,
    topUps: [],
    ...pendingFields,
    charges: [],
    chargeCount: 0,
    spendVersion: null,
    storeFault: null,
  };
  if (topUps.state === 'UNREAD') return { ...empty, storeFault: `${topUps.reason}${topUps.detail ? ` — ${topUps.detail}` : ''}` };
  if (spend.state === 'UNREAD') return { ...empty, storeFault: `${spend.reason}${spend.detail ? ` — ${spend.detail}` : ''}` };

  const t = rowOf(topUps.value, topUpsRow(hash));
  const s = rowOf(spend.value, spendRow(hash));
  if (t === null) return { ...empty, balanceState: 'READ', spendVersion: s === null ? null : (s.version ?? 0) };
  const credited = big(t.payload.creditedCents);
  const spent = big(s?.payload.spentCents);
  const toOpen = credited >= BigInt(MINIMUM_OPEN_CENTS) ? 0n : BigInt(MINIMUM_OPEN_CENTS) - credited;
  return {
    hash,
    balanceState: 'READ',
    status: credited >= BigInt(MINIMUM_OPEN_CENTS) ? 'OPEN' : 'BELOW_MINIMUM',
    creditedCents: credited.toString(),
    spentCents: spent.toString(),
    balanceCents: (credited - spent).toString(),
    toOpenCents: toOpen.toString(),
    minimumOpenCents: MINIMUM_OPEN_CENTS,
    topUps: Array.isArray(t.payload.topUps) ? (t.payload.topUps as TopUpCredit[]) : [],
    ...pendingFields,
    charges: Array.isArray(s?.payload.charges) ? (s.payload.charges as Charge[]) : [],
    chargeCount: typeof s?.payload.count === 'number' ? s.payload.count : 0,
    spendVersion: s === null ? null : (s.version ?? 0),
    storeFault: null,
  };
}

export type ChargeOutcome =
  | { readonly ok: true; readonly account: KeyAccount; readonly charged: Charge }
  | {
      readonly ok: false;
      readonly status: KeyStatus | 'INSUFFICIENT' | 'STORE_UNREADABLE' | 'NOT_RECORDED';
      readonly account: KeyAccount;
      readonly detail: string;
      /** Whether the charge is known not to have landed. 'UNKNOWN' when the store could neither confirm nor deny the write: the caller must not retry blind. */
      readonly charged?: false | 'UNKNOWN';
    };

/**
 * Charge one unit of a service to a key. Refused, with the reason, when the
 * key is unfunded, below the minimum, or short; recorded, with the
 * reference, when it is not. A charge that could not be recorded is not a
 * charge — the call is refused rather than served for free and forgotten.
 */
/** How many times a charge is retried after finding the spend row moved under it, with a short random pause between tries so concurrent callers spread out. */
export const CHARGE_RETRIES = 8;

export async function charge(store: Store, hash: string, service: ServiceId, cents: number, ref: string, now: Date): Promise<ChargeOutcome> {
  // The spend row is read and written back only if nobody wrote it in
  // between — two calls charging one key at once cannot lose each other's
  // charge; the later one reads again and is refused if the first left too
  // little.
  let last: ChargeOutcome | null = null;
  for (let attempt = 0; attempt < CHARGE_RETRIES; attempt += 1) {
    const account = await keyAccount(store, hash, { pending: false });
    if (account.storeFault !== null) return { ok: false, status: 'STORE_UNREADABLE', account, detail: account.storeFault };
    if (account.status === 'UNFUNDED') return { ok: false, status: 'UNFUNDED', account, detail: 'the chain has credited nothing to this key hash' };
    if (account.status === 'BELOW_MINIMUM') return { ok: false, status: 'BELOW_MINIMUM', account, detail: `the key has been credited ${account.creditedCents} cents; it opens at ${MINIMUM_OPEN_CENTS}` };
    if (BigInt(account.balanceCents) < BigInt(cents)) return { ok: false, status: 'INSUFFICIENT', account, detail: `the balance is ${account.balanceCents} cents; this call is ${cents}` };
    const charged: Charge = { at: now.toISOString(), service, cents, ref };
    const charges = [...account.charges, charged].slice(-CHARGES_KEPT);
    const spent = (BigInt(account.spentCents) + BigInt(cents)).toString();
    const written = await store.writeSnapshotIf({ key: spendRow(hash), observedAt: now.toISOString(), payload: { hash, spentCents: spent, count: account.chargeCount + 1, charges } }, account.spendVersion);
    if (written.state === 'WRITTEN') return { ok: true, account: { ...account, spentCents: spent, balanceCents: (BigInt(account.balanceCents) - BigInt(cents)).toString(), charges, chargeCount: account.chargeCount + 1 }, charged };
    if (written.state === 'FAILED') return { ok: false, status: 'NOT_RECORDED', account, detail: written.reason, charged: /could not be read either/.test(written.reason) ? 'UNKNOWN' : false };
    last = { ok: false, status: 'NOT_RECORDED', account, detail: `the key was charged by another call at the same time (${written.reason}); tried ${attempt + 1} times`, charged: false };
    await new Promise((resolve) => setTimeout(resolve, 2 + Math.random() * 15 * (attempt + 1)));
  }
  return last!;
}
