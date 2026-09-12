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
import { composeMessage, deliver, transition, type Condition, type Delivery } from '../ops/alerts.ts';
import type { Store } from '../store/types.ts';
import { charge, keyAccount } from './keys.ts';
import { serviceById } from './prices.ts';

export const SUB_PREFIX = 'credits:sub:';
export const subRow = (id: string) => `${SUB_PREFIX}${id}`;
/** The most subscriptions one key may hold at once. */
export const MAX_PER_KEY = 5;
/** How long one fan-out may take in all, and one webhook at most, inside a tick that has sixty seconds for everything. */
export const FAN_OUT_BUDGET_MS = 20_000;
export const WEBHOOK_TIMEOUT_MS = 5_000;

export interface Subscription {
  readonly id: string;
  readonly keyHash: string;
  readonly url: string;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
  /** The condition ids this subscription was last told were active; its next message is the change from these. */
  readonly lastActive: readonly string[];
  readonly lastDelivery: { readonly at: string; readonly state: Delivery['state']; readonly detail: string | null; readonly charged: boolean } | null;
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

/** Every address a hostname resolves to, or an empty list when it resolves to nothing. */
export const resolveAll: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

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

function subOf(payload: Readonly<Record<string, unknown>>): Subscription | null {
  if (typeof payload.id !== 'string' || typeof payload.keyHash !== 'string' || typeof payload.url !== 'string' || typeof payload.createdAt !== 'string') return null;
  return {
    id: payload.id,
    keyHash: payload.keyHash,
    url: payload.url,
    createdAt: payload.createdAt,
    cancelledAt: typeof payload.cancelledAt === 'string' ? payload.cancelledAt : null,
    lastActive: Array.isArray(payload.lastActive) ? (payload.lastActive as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    lastDelivery: payload.lastDelivery && typeof payload.lastDelivery === 'object' ? (payload.lastDelivery as Subscription['lastDelivery']) : null,
    deliveries: typeof payload.deliveries === 'number' ? payload.deliveries : 0,
  };
}

export async function subscriptionsOf(store: Store, keyHash: string | null): Promise<{ subscriptions: Subscription[]; storeFault: string | null }> {
  const read = await store.snapshots(SUB_PREFIX);
  if (read.state === 'UNREAD') return { subscriptions: [], storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const all = read.value.map((r) => subOf(r.payload)).filter((s): s is Subscription => s !== null);
  return { subscriptions: keyHash === null ? all : all.filter((s) => s.keyHash === keyHash), storeFault: null };
}

export type CreateOutcome = { readonly ok: true; readonly subscription: Subscription } | { readonly ok: false; readonly error: string; readonly detail: string; readonly status: number };

export async function createSubscription(store: Store, keyHash: string, url: string, now: Date): Promise<CreateOutcome> {
  const fault = webhookFault(url);
  if (fault !== null) return { ok: false, error: 'WEBHOOK_REFUSED', detail: fault, status: 400 };
  const account = await keyAccount(store, keyHash);
  if (account.storeFault !== null) return { ok: false, error: 'STORE_UNREADABLE', detail: account.storeFault, status: 503 };
  if (account.status === 'UNFUNDED') return { ok: false, error: 'UNFUNDED', detail: 'the chain has credited nothing to this key hash', status: 402 };
  if (account.status === 'BELOW_MINIMUM') return { ok: false, error: 'BELOW_MINIMUM', detail: `the key opens once ${account.minimumOpenCents} cents have been credited; ${account.creditedCents} have`, status: 402 };
  const mine = await subscriptionsOf(store, keyHash);
  if (mine.storeFault !== null) return { ok: false, error: 'STORE_UNREADABLE', detail: mine.storeFault, status: 503 };
  const active = mine.subscriptions.filter((s) => s.cancelledAt === null);
  if (active.some((s) => s.url === url)) return { ok: false, error: 'ALREADY_SUBSCRIBED', detail: 'this key already posts to that URL', status: 409 };
  if (active.length >= MAX_PER_KEY) return { ok: false, error: 'TOO_MANY', detail: `a key holds at most ${MAX_PER_KEY} subscriptions`, status: 409 };
  const subscription: Subscription = { id: randomBytes(16).toString('hex'), keyHash, url, createdAt: now.toISOString(), cancelledAt: null, lastActive: [], lastDelivery: null, deliveries: 0 };
  const written = await store.writeSnapshots([{ key: subRow(subscription.id), observedAt: now.toISOString(), payload: { ...subscription } }]);
  if (written.state !== 'WRITTEN') return { ok: false, error: 'NOT_RECORDED', detail: written.reason, status: 503 };
  return { ok: true, subscription };
}

export async function cancelSubscription(store: Store, keyHash: string, id: string, now: Date): Promise<{ ok: boolean; status: number; detail: string }> {
  const mine = await subscriptionsOf(store, keyHash);
  if (mine.storeFault !== null) return { ok: false, status: 503, detail: mine.storeFault };
  const sub = mine.subscriptions.find((s) => s.id === id);
  if (!sub) return { ok: false, status: 404, detail: 'no such subscription under this key' };
  if (sub.cancelledAt !== null) return { ok: true, status: 200, detail: `already cancelled at ${sub.cancelledAt}` };
  const written = await store.writeSnapshots([{ key: subRow(id), observedAt: now.toISOString(), payload: { ...sub, cancelledAt: now.toISOString() } }]);
  return written.state === 'WRITTEN' ? { ok: true, status: 200, detail: 'cancelled; no further delivery, no further charge' } : { ok: false, status: 503, detail: written.reason };
}

export interface FanOutReport {
  /** How many live subscriptions had a change to be told of. */
  readonly considered: number;
  readonly delivered: number;
  readonly charged: number;
  readonly skipped: readonly { readonly id: string; readonly reason: string }[];
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
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
  budgetMs: number = FAN_OUT_BUDGET_MS,
): Promise<FanOutReport> {
  const service = serviceById('alert-delivery')!;
  const empty: FanOutReport = { considered: 0, delivered: 0, charged: 0, skipped: [], failed: [], deferred: 0 };
  if (conditions === null) return empty;
  const all = await subscriptionsOf(store, null);
  if (all.storeFault !== null) return { ...empty, failed: [{ id: '*', reason: all.storeFault }] };
  const currentIds = conditions.map((c) => c.id);
  const live = all.subscriptions
    .filter((s) => s.cancelledAt === null)
    .map((s) => ({ sub: s, t: transition(s.lastActive, conditions) }))
    .filter(({ t }) => t.raised.length > 0 || t.cleared.length > 0);
  const skipped: { id: string; reason: string }[] = [];
  const failed: { id: string; reason: string }[] = [];
  let delivered = 0;
  let charged = 0;
  let deferred = 0;
  const startedAt = Date.now();
  // A row is re-read before it is written, so a cancellation that landed
  // meanwhile is kept and a cancelled subscription is not delivered to.
  const write = async (id: string, patch: Partial<Subscription>): Promise<boolean> => {
    const fresh = await subscriptionsOf(store, null);
    const current = fresh.storeFault === null ? fresh.subscriptions.find((s) => s.id === id) : undefined;
    if (current === undefined || current.cancelledAt !== null) return false;
    await store.writeSnapshots([{ key: subRow(id), observedAt: now.toISOString(), payload: { ...current, ...patch } }]);
    return true;
  };
  for (const { sub, t } of live) {
    const message = composeMessage(t, now);
    if (Date.now() - startedAt > budgetMs) {
      deferred += 1;
      continue;
    }
    const account = await keyAccount(store, sub.keyHash);
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
    // Cancelled since the list was read? Then not delivered.
    const stillLive = await write(sub.id, {});
    if (!stillLive) {
      skipped.push({ id: sub.id, reason: 'CANCELLED' });
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
    const paid = await charge(store, sub.keyHash, service.id, service.cents, `alert delivery · ${t.raised.length} raised, ${t.cleared.length} cleared`, now);
    if (paid.ok) charged += 1;
    await write(sub.id, { lastActive: currentIds, deliveries: sub.deliveries + 1, lastDelivery: { at: now.toISOString(), state: 'SENT', detail: paid.ok ? null : `delivered but not charged: ${paid.detail}`, charged: paid.ok } });
  }
  return { considered: live.length, delivered, charged, skipped, failed, deferred };
}
