/**
 * Webhook subscriptions: a key registers a URL; each time the desk's
 * conditions change, a message in the operator's own form — what was
 * raised, what cleared, what stays — is posted there and the key is charged
 * one delivery. Each subscription keeps the set it was last told of, so it
 * is told exactly its own changes since, whether or not the operator's
 * webhook was reachable: a delivery that failed is not charged and is not
 * marked as told. A subscription whose key cannot pay is skipped, and the
 * row says so, rather than delivered on credit.
 *
 * A row is never deleted — the store keeps one row per key, replaced — so a
 * cancelled subscription is marked cancelled and kept as the record that it
 * existed.
 */

import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { CONDITION_KINDS, DEFAULT_KINDS, composeMessage, deliver, matchesFilter, transition, type Condition, type ConditionFilter, type ConditionKind, type Delivery } from '../ops/alerts.ts';
import { STOCK_TOKENS } from '../chain/stock-tokens.ts';
import type { Store } from '../store/types.ts';
import { charge, keyAccount } from './keys.ts';
import { serviceById } from './prices.ts';

export const SUB_PREFIX = 'credits:sub:';
export const subRow = (id: string) => `${SUB_PREFIX}${id}`;
/** One row per key holding its counts and live URLs, written conditionally, so the caps hold under concurrent requests — the rows themselves stay the record. */
export const SUBKEY_PREFIX = 'credits:subkey:';
export const subKeyRow = (keyHash: string) => `${SUBKEY_PREFIX}${keyHash}`;

interface SubLedger {
  readonly live: number;
  readonly total: number;
  readonly urls: readonly string[];
}

const ledgerOf = (payload: Readonly<Record<string, unknown>> | undefined): SubLedger => ({
  live: typeof payload?.live === 'number' ? payload.live : 0,
  total: typeof payload?.total === 'number' ? payload.total : 0,
  urls: Array.isArray(payload?.urls) ? (payload.urls as unknown[]).filter((u): u is string => typeof u === 'string') : [],
});
/** The most live subscriptions one key may hold at once, and the most rows — live and cancelled — it may ever make, since a row is never deleted. */
export const MAX_PER_KEY = 5;
export const MAX_ROWS_PER_KEY = 20;
/** How long one fan-out may take in all, and one webhook at most, inside a tick that has sixty seconds for everything. */
export const FAN_OUT_BUDGET_MS = 20_000;
/** What one subscription's store round trips are allowed to take, over the lookup and the post, before the deadline. */
export const STORE_ALLOWANCE_MS = 1_500;
export const WEBHOOK_TIMEOUT_MS = 5_000;

export interface Subscription {
  readonly id: string;
  readonly keyHash: string;
  readonly url: string;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
  /** What this subscription is told of: which kinds, and which tokens for the token kind. Fixed when made; a different filter is a new subscription. */
  readonly filter: ConditionFilter;
  /** The condition ids this subscription was last told were active; its next message is the change from these. */
  readonly lastActive: readonly string[];
  readonly lastDelivery: { readonly at: string; readonly state: Delivery['state']; readonly detail: string | null; readonly charged: boolean } | null;
  /** The row's version as read; a write lands only on the row it read. */
  readonly version: number;
  readonly deliveries: number;
}

const HOST_REFUSED = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[.*\]$|^[0-9a-f:]+$/i;

/** A webhook the desk will post to: https, a public hostname, no credentials in the URL. */
export function webhookFault(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'not a URL';
  }
  if (url.protocol !== 'https:') return 'the desk posts to https URLs only';
  if (url.username !== '' || url.password !== '') return 'a URL with credentials in it is refused';
  if (HOST_REFUSED.test(url.hostname) || IP_LITERAL.test(url.hostname) || !url.hostname.includes('.')) return 'the hostname must be a public name, not an address or a local name';
  if (raw.length > 2_048) return 'the URL is longer than 2048 characters';
  return null;
}

/**
 * An address the desk will not post to: loopback, private, link-local
 * (the cloud metadata address lives there), unique-local, unspecified. A
 * public name can resolve to one of these; the check is at delivery time,
 * on what the name resolves to then, so a name that was public when it was
 * registered and points inward now is refused now.
 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true;
  if (/^::ffff:(\d{1,3}\.){3}\d{1,3}$/.test(v6)) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe[89ab])/.test(v6);
}

export type Resolver = (hostname: string) => Promise<readonly string[]>;

/** A lookup that does not answer within this is a hostname that did not resolve; the resolver's own retries can run far longer than a tick has. */
export const LOOKUP_TIMEOUT_MS = 3_000;

/** Every address a hostname resolves to, or an empty list when it resolves to nothing; bounded in time. */
export const resolveAll: Resolver = async (hostname) => {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${LOOKUP_TIMEOUT_MS} ms`)), LOOKUP_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([lookup(hostname, { all: true, verbatim: true }), late])).map((a) => a.address);
  } finally {
    clearTimeout(timer);
  }
};

/** Why the desk will not post to a URL right now, or the public addresses it resolved to — which are the ones then dialled. */
export async function deliveryCheck(url: string, resolve: Resolver = resolveAll): Promise<{ fault: string; addresses: null } | { fault: null; addresses: readonly string[] }> {
  const fault = webhookFault(url);
  if (fault !== null) return { fault, addresses: null };
  let addresses: readonly string[];
  try {
    addresses = await resolve(new URL(url).hostname);
  } catch (cause) {
    return { fault: `the hostname did not resolve (${cause instanceof Error ? cause.message : 'unknown'})`, addresses: null };
  }
  if (addresses.length === 0) return { fault: 'the hostname resolves to nothing', addresses: null };
  const inward = addresses.find(isPrivateAddress);
  return inward === undefined ? { fault: null, addresses } : { fault: `the hostname resolves to ${inward}, which is not a public address`, addresses: null };
}

/** Why the desk will not post to a URL right now, or null. */
export async function deliveryFault(url: string, resolve: Resolver = resolveAll): Promise<string | null> {
  return (await deliveryCheck(url, resolve)).fault;
}

function subOf(payload: Readonly<Record<string, unknown>>, version: number): Subscription | null {
  if (typeof payload.id !== 'string' || typeof payload.keyHash !== 'string' || typeof payload.url !== 'string' || typeof payload.createdAt !== 'string') return null;
  return {
    version,
    id: payload.id,
    keyHash: payload.keyHash,
    url: payload.url,
    createdAt: payload.createdAt,
    cancelledAt: typeof payload.cancelledAt === 'string' ? payload.cancelledAt : null,
    filter: filterOf(payload.filter),
    lastActive: Array.isArray(payload.lastActive) ? (payload.lastActive as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    lastDelivery: payload.lastDelivery && typeof payload.lastDelivery === 'object' ? (payload.lastDelivery as Subscription['lastDelivery']) : null,
    deliveries: typeof payload.deliveries === 'number' ? payload.deliveries : 0,
  };
}

export async function subscriptionsOf(store: Store, keyHash: string | null): Promise<{ subscriptions: Subscription[]; storeFault: string | null }> {
  const read = await store.snapshots(SUB_PREFIX);
  if (read.state === 'UNREAD') return { subscriptions: [], storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const all = read.value.map((r) => subOf(r.payload, r.version ?? 0)).filter((s): s is Subscription => s !== null);
  return { subscriptions: keyHash === null ? all : all.filter((s) => s.keyHash === keyHash), storeFault: null };
}

export type CreateOutcome = { readonly ok: true; readonly subscription: Subscription } | { readonly ok: false; readonly error: string; readonly detail: string; readonly status: number };

/** A row written before filters existed, or one whose filter cannot be read, is told what a holder is told by default. */
function filterOf(raw: unknown): ConditionFilter {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const kinds = Array.isArray(p.kinds) ? (p.kinds as unknown[]).filter((k): k is ConditionKind => typeof k === 'string' && (CONDITION_KINDS as readonly string[]).includes(k)) : [];
  const tokens = Array.isArray(p.tokens) ? (p.tokens as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  return { kinds: kinds.length > 0 ? kinds : DEFAULT_KINDS, tokens };
}

export type FilterInput = { readonly kinds?: unknown; readonly tokens?: unknown };

/**
 * The filter a request asked for, checked: kinds from the catalogue, tokens
 * as tickers the capture holds (case does not matter). Nothing is guessed —
 * a ticker the desk does not watch is refused with the reason, since a
 * subscription that silently watched nothing would be paid for nothing.
 */
export function parseFilter(input: FilterInput): { ok: true; filter: ConditionFilter } | { ok: false; detail: string } {
  const kindsRaw = input.kinds === undefined ? [] : Array.isArray(input.kinds) ? input.kinds : null;
  const tokensRaw = input.tokens === undefined ? [] : Array.isArray(input.tokens) ? input.tokens : null;
  if (kindsRaw === null) return { ok: false, detail: `kinds must be a list from: ${CONDITION_KINDS.join(', ')}` };
  if (tokensRaw === null) return { ok: false, detail: 'tokens must be a list of tickers, e.g. ["AAPL", "TSLA"]' };
  const kinds: ConditionKind[] = [];
  for (const k of kindsRaw) {
    if (typeof k !== 'string' || !(CONDITION_KINDS as readonly string[]).includes(k)) return { ok: false, detail: `unknown kind ${JSON.stringify(k)}; the kinds are ${CONDITION_KINDS.join(', ')}` };
    if (!kinds.includes(k as ConditionKind)) kinds.push(k as ConditionKind);
  }
  const tokens: string[] = [];
  for (const t of tokensRaw) {
    if (typeof t !== 'string') return { ok: false, detail: 'tokens must be tickers as strings' };
    const ticker = t.trim().toUpperCase();
    if (!STOCK_TOKENS.some((s) => s.ticker === ticker)) return { ok: false, detail: `the desk does not watch a token with ticker ${JSON.stringify(t)}; the tickers it watches are at /api/registry` };
    if (!tokens.includes(ticker)) tokens.push(ticker);
  }
  if (tokens.length > 50) return { ok: false, detail: 'at most fifty tickers on one subscription; leave tokens empty for every token' };
  return { ok: true, filter: { kinds: kinds.length > 0 ? kinds : DEFAULT_KINDS, tokens } };
}

export async function createSubscription(store: Store, keyHash: string, url: string, now: Date, filter: ConditionFilter = { kinds: DEFAULT_KINDS, tokens: [] }): Promise<CreateOutcome> {
  const fault = webhookFault(url);
  if (fault !== null) return { ok: false, error: 'WEBHOOK_REFUSED', detail: fault, status: 400 };
  const account = await keyAccount(store, keyHash);
  if (account.storeFault !== null) return { ok: false, error: 'STORE_UNREADABLE', detail: account.storeFault, status: 503 };
  if (account.status === 'UNFUNDED') return { ok: false, error: 'UNFUNDED', detail: 'the chain has credited nothing to this key hash', status: 402 };
  if (account.status === 'BELOW_MINIMUM') return { ok: false, error: 'BELOW_MINIMUM', detail: `the key opens once ${account.minimumOpenCents} cents have been credited; ${account.creditedCents} have`, status: 402 };
  // The caps and the same-URL rule are enforced on the key's ledger row by a
  // conditional write, so two requests at once cannot both pass them; the
  // subscription row is written after the ledger took this one.
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
    const read = await store.snapshots(subKeyRow(keyHash));
    if (read.state === 'UNREAD') return { ok: false, error: 'STORE_UNREADABLE', detail: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}`, status: 503 };
    const row = read.value.find((r) => r.key === subKeyRow(keyHash));
    const ledger = ledgerOf(row?.payload);
    if (ledger.urls.includes(url)) return { ok: false, error: 'ALREADY_SUBSCRIBED', detail: 'this key already posts to that URL', status: 409 };
    if (ledger.live >= MAX_PER_KEY) return { ok: false, error: 'TOO_MANY', detail: `a key holds at most ${MAX_PER_KEY} subscriptions`, status: 409 };
    if (ledger.total >= MAX_ROWS_PER_KEY) return { ok: false, error: 'TOO_MANY', detail: `a key makes at most ${MAX_ROWS_PER_KEY} subscriptions in all, cancelled ones counted: a cancelled row is kept as the record that it existed`, status: 409 };
    const taken = await store.writeSnapshotIf({ key: subKeyRow(keyHash), observedAt: now.toISOString(), payload: { live: ledger.live + 1, total: ledger.total + 1, urls: [...ledger.urls, url] } }, row === undefined ? null : (row.version ?? 0));
    if (taken.state === 'CONFLICT') continue;
    if (taken.state === 'FAILED') return { ok: false, error: 'NOT_RECORDED', detail: taken.reason, status: 503 };
    const subscription: Subscription = { id: randomBytes(16).toString('hex'), keyHash, url, filter, createdAt: now.toISOString(), cancelledAt: null, lastActive: [], lastDelivery: null, deliveries: 0, version: 0 };
    const { version: _v, ...subRowPayload } = subscription;
    const written = await store.writeSnapshotIf({ key: subRow(subscription.id), observedAt: now.toISOString(), payload: { ...subRowPayload } }, null);
    // A row the store did not take leaves the ledger one ahead — a stricter cap, never a looser one; said so.
    if (written.state !== 'WRITTEN') return { ok: false, error: 'NOT_RECORDED', detail: `${written.reason}; the key's count was taken and is released by a cancellation of nothing — one fewer subscription is allowed until then`, status: 503 };
    return { ok: true, subscription };
  }
  return { ok: false, error: 'NOT_RECORDED', detail: 'the key’s subscription ledger kept moving; try again', status: 503 };
}

/** Release a live slot and a URL on the key's ledger after a cancellation; a ledger that keeps moving is left one ahead — stricter, never looser. */
async function releaseOnLedger(store: Store, keyHash: string, url: string, now: Date): Promise<void> {
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
    const read = await store.snapshots(subKeyRow(keyHash));
    if (read.state === 'UNREAD') return;
    const row = read.value.find((r) => r.key === subKeyRow(keyHash));
    if (row === undefined) return;
    const ledger = ledgerOf(row.payload);
    const w = await store.writeSnapshotIf({ key: subKeyRow(keyHash), observedAt: now.toISOString(), payload: { live: Math.max(0, ledger.live - 1), total: ledger.total, urls: ledger.urls.filter((u) => u !== url) } }, row.version ?? 0);
    if (w.state !== 'CONFLICT') return;
  }
}

/** A row with its version stripped, as it is written; the version is the store's. */
const rowOf = (sub: Subscription): Record<string, unknown> => {
  const { version: _v, ...row } = sub;
  return row;
};

/**
 * Cancel: written only onto the row as read, so a fan-out writing the same
 * row at the same time cannot overwrite the cancellation; on a conflict the
 * row is read again and the cancellation written onto the newer one.
 */
export async function cancelSubscription(store: Store, keyHash: string, id: string, now: Date): Promise<{ ok: boolean; status: number; detail: string }> {
  for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
    const mine = await subscriptionsOf(store, keyHash);
    if (mine.storeFault !== null) return { ok: false, status: 503, detail: mine.storeFault };
    const sub = mine.subscriptions.find((s) => s.id === id);
    if (!sub) return { ok: false, status: 404, detail: 'no such subscription under this key' };
    if (sub.cancelledAt !== null) return { ok: true, status: 200, detail: `already cancelled at ${sub.cancelledAt}` };
    const written = await store.writeSnapshotIf({ key: subRow(id), observedAt: now.toISOString(), payload: { ...rowOf(sub), cancelledAt: now.toISOString() } }, sub.version);
    if (written.state === 'WRITTEN') {
      await releaseOnLedger(store, keyHash, sub.url, now);
      const charging = sub.lastDelivery?.state === 'SENT' && sub.lastDelivery.detail === 'delivered; the charge follows';
      return { ok: true, status: 200, detail: charging ? 'cancelled; no further delivery — a delivery already made may still be charged' : 'cancelled; no further delivery, no further charge' };
    }
    if (written.state === 'FAILED') return { ok: false, status: 503, detail: written.reason };
  }
  return { ok: false, status: 503, detail: 'the subscription row kept moving under the cancellation; try again' };
}

/** How many times a conditional write on a subscription row is retried after finding the row moved. */
export const WRITE_RETRIES = 4;

export interface FanOutReport {
  /** How many live subscriptions had a change to be told of. */
  readonly considered: number;
  readonly delivered: number;
  readonly charged: number;
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
  /** Delivered, and the row says so, but the charge did not land: the desk's loss, counted so the operator sees it. */
  readonly uncharged: readonly { readonly id: string; readonly reason: string }[];
  /** Delivered, but the row could not be marked told: not charged; told again next tick. Not a webhook failure. */
  readonly untold: readonly { readonly id: string; readonly reason: string }[];
  /** Subscriptions not reached within the fan-out's time; they are next in line on the next tick. */
  readonly deferred: number;
}

/**
 * Tell every live subscription its own changes — what was raised and what
 * cleared since the set it was last told of — and charge each delivery
 * that went through. A subscription with nothing new is not written to.
 */
export async function fanOut(
  store: Store,
  now: Date,
  conditions: readonly Condition[] | null,
  post: (message: string, webhook: string, pinTo: readonly string[]) => Promise<Delivery> = (m, w, pin) => deliver(m, w, WEBHOOK_TIMEOUT_MS, pin),
  resolve: Resolver = resolveAll,
  deadline: number = Date.now() + FAN_OUT_BUDGET_MS,
): Promise<FanOutReport> {
  const service = serviceById('alert-delivery')!;
  const empty: FanOutReport = { considered: 0, delivered: 0, charged: 0, skipped: [], failed: [], uncharged: [], untold: [], deferred: 0 };
  if (conditions === null) return empty;
  const all = await subscriptionsOf(store, null);
  if (all.storeFault !== null) return { ...empty, failed: [{ id: '*', reason: all.storeFault }] };
  // Each subscription sees the conditions its filter admits, and nothing else: its transition, its message and its record are of that set.
  const forSub = (s: Subscription): Condition[] => conditions.filter((c) => matchesFilter(s.filter, c));
  // The ones told longest ago go first, so a subscription the last run's budget did not reach is first in line, not last again.
  const live = all.subscriptions
    .filter((s) => s.cancelledAt === null)
    .map((s) => ({ sub: s, t: transition(s.lastActive, forSub(s)) }))
    .filter(({ t }) => t.raised.length > 0 || t.cleared.length > 0)
    .sort((a, b) => (a.sub.lastDelivery?.at ?? a.sub.createdAt).localeCompare(b.sub.lastDelivery?.at ?? b.sub.createdAt) || a.sub.createdAt.localeCompare(b.sub.createdAt));
  const skipped: { id: string; reason: string }[] = [];
  const failed: { id: string; reason: string }[] = [];
  const uncharged: { id: string; reason: string }[] = [];
  const untold: { id: string; reason: string }[] = [];
  let delivered = 0;
  let charged = 0;
  let deferred = 0;
  // A row is re-read before it is written and written only onto the row as
  // read, so a cancellation that lands meanwhile is never overwritten and a
  // cancelled subscription is not delivered to. A write the store did not
  // take is false: "told" means the row says so.
  const liveRow = async (id: string): Promise<{ row: Subscription } | { cancelled: true } | { storeFault: string }> => {
    const fresh = await subscriptionsOf(store, null);
    if (fresh.storeFault !== null) return { storeFault: fresh.storeFault };
    const current = fresh.subscriptions.find((s) => s.id === id);
    return current === undefined || current.cancelledAt !== null ? { cancelled: true } : { row: current };
  };
  const write = async (id: string, patch: Partial<Subscription>): Promise<boolean> => {
    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const current = await liveRow(id);
      if (!('row' in current)) return false;
      const written = await store.writeSnapshotIf({ key: subRow(id), observedAt: now.toISOString(), payload: { ...rowOf(current.row), ...patch } }, current.row.version);
      if (written.state === 'WRITTEN') return true;
      if (written.state === 'FAILED') return false;
    }
    return false;
  };
  // The same, onto the row whether live or cancelled: for a fact about a delivery that already happened.
  const writeAny = async (id: string, patch: Partial<Subscription>): Promise<boolean> => {
    for (let attempt = 0; attempt < WRITE_RETRIES; attempt += 1) {
      const fresh = await subscriptionsOf(store, null);
      const current = fresh.storeFault === null ? fresh.subscriptions.find((s) => s.id === id) : undefined;
      if (current === undefined) return false;
      const written = await store.writeSnapshotIf({ key: subRow(id), observedAt: now.toISOString(), payload: { ...rowOf(current), ...patch } }, current.version);
      if (written.state === 'WRITTEN') return true;
      if (written.state === 'FAILED') return false;
    }
    return false;
  };
  for (const { sub, t } of live) {
    const message = composeMessage(t, now);
    // An iteration costs up to a lookup, a post and a few store round trips; one that cannot finish before the deadline is not started.
    if (Date.now() + LOOKUP_TIMEOUT_MS + WEBHOOK_TIMEOUT_MS + STORE_ALLOWANCE_MS > deadline) {
      deferred += 1;
      continue;
    }
    const account = await keyAccount(store, sub.keyHash, { pending: false });
    if (account.storeFault !== null) {
      // Not a fact about the key: nothing is written on the row, and the subscription is tried again next tick.
      skipped.push({ id: sub.id, reason: 'STORE_UNREADABLE' });
      continue;
    }
    if (account.status !== 'OPEN' || BigInt(account.balanceCents) < BigInt(service.cents)) {
      skipped.push({ id: sub.id, reason: account.status !== 'OPEN' ? account.status : 'INSUFFICIENT' });
      await write(sub.id, { lastDelivery: { at: now.toISOString(), state: 'NOTHING_TO_SEND', detail: `not delivered: the key is ${account.status === 'OPEN' ? 'short' : account.status.toLowerCase()}`, charged: false } });
      continue;
    }
    const checked = await deliveryCheck(sub.url, resolve);
    if (checked.fault !== null) {
      skipped.push({ id: sub.id, reason: 'WEBHOOK_REFUSED' });
      await write(sub.id, { lastDelivery: { at: now.toISOString(), state: 'NOTHING_TO_SEND', detail: `not delivered: ${checked.fault}`, charged: false } });
      continue;
    }
    // Cancelled since the list was read? Then not delivered. A store that would not answer is said so, not read as a cancellation.
    const live = await liveRow(sub.id);
    if (!('row' in live)) {
      skipped.push({ id: sub.id, reason: 'storeFault' in live ? 'STORE_UNREADABLE' : 'CANCELLED' });
      continue;
    }
    // Dialled at the addresses just checked, not resolved again: what was judged public is what is reached.
    const outcome = await post(message, sub.url, checked.addresses);
    if (outcome.state !== 'SENT') {
      const reason = outcome.state === 'FAILED' ? outcome.reason : outcome.state;
      failed.push({ id: sub.id, reason });
      await write(sub.id, { lastDelivery: { at: now.toISOString(), state: outcome.state, detail: reason, charged: false } });
      continue;
    }
    delivered += 1;
    // Told first, charged second: a row write that fails leaves a delivery
    // uncharged, which is the desk's loss, never a subscriber charged twice
    // for the same change.
    const told = await write(sub.id, { lastActive: t.active.map((c) => c.id), deliveries: sub.deliveries + 1, lastDelivery: { at: now.toISOString(), state: 'SENT', detail: 'delivered; the charge follows', charged: false } });
    if (!told) {
      untold.push({ id: sub.id, reason: 'delivered, but the row could not be marked told; not charged, told again next tick' });
      continue;
    }
    const paid = await charge(store, sub.keyHash, service.id, service.cents, `alert delivery · ${t.raised.length} raised, ${t.cleared.length} cleared`, now);
    if (paid.ok) charged += 1;
    else uncharged.push({ id: sub.id, reason: paid.detail });
    await writeAny(sub.id, { lastDelivery: { at: now.toISOString(), state: 'SENT', detail: paid.ok ? null : `delivered but not charged: ${paid.detail}`, charged: paid.ok } });
  }
  return { considered: live.length, delivered, charged, skipped, failed, uncharged, untold, deferred };
}
