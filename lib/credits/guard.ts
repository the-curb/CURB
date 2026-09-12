/**
 * The gate on a paid endpoint, in two steps so a call is charged only when
 * it is answered:
 *
 *   admit  — the desk is configured, the key is in the `x-curb-key`
 *            header, and the key can pay the listed price. No write.
 *   settle — the charge, recorded with what was bought. Done after the
 *            answer has been composed, so a store that could not answer
 *            costs the caller nothing.
 *
 * A call without a key is 401; a key that cannot pay is 402 with the
 * figures and how to top up; a desk nobody configured is 503, because
 * nothing can be bought where nothing is sold. The public endpoints never
 * pass through here.
 */

import type { Store } from '../store/types.ts';
import { creditsStatus } from './config.ts';
import { charge, isKey, keyAccount, keyHashOf, type KeyAccount } from './keys.ts';
import { latestDeskCode } from './code.ts';
import { serviceById, type ServiceId } from './prices.ts';

const NO_STORE = { 'cache-control': 'no-store' } as const;

export type Admission = { readonly ok: true; readonly hash: string; readonly account: KeyAccount; readonly cents: number } | { readonly ok: false; readonly response: Response };
export type Settlement = { readonly ok: true; readonly account: KeyAccount } | { readonly ok: false; readonly response: Response };

/** The key a request presents: `x-curb-key`, or `Authorization: Bearer`; null when neither is sent. */
export function presentedKey(request: Request): string | null {
  const header = request.headers.get('x-curb-key');
  if (header) return header.trim();
  const auth = request.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

async function cannotPay(store: Store, status: string, detail: string, account: KeyAccount, serviceId: ServiceId, cents: number, charged: false | 'UNKNOWN' = false): Promise<Response> {
  const cfg = creditsStatus();
  // The way to pay is named only for a desk whose code the last tick verified: a top-up to an unverified desk is not credited, and is not invited. A verification the store could not read is said so, not read as a failed one.
  const code = cfg.state === 'CONFIGURED' ? await latestDeskCode(store, cfg.config) : null;
  const verified = code !== null && code.storeFault === null && code.code !== null && code.code.state === 'MATCHES';
  const held =
    cfg.state !== 'CONFIGURED' || verified
      ? null
      : code !== null && code.storeFault !== null
        ? `the desk’s verification could not be read from the store (${code.storeFault}); ask /api/credits before sending a top-up`
        : `the desk’s code is not verified as the build by the last tick (${code?.code?.state ?? 'not yet read'}); top-ups are not credited from it — do not send one`;
  const body = {
    error: status,
    detail,
    /** false: nothing was charged for this call. 'UNKNOWN': the store could not say whether the charge landed — read the balance before calling again. */
    charged,
    service: serviceId,
    priceCents: cents,
    keyHash: account.hash,
    creditedCents: account.creditedCents,
    spentCents: account.spentCents,
    balanceCents: account.balanceCents,
    toOpenCents: account.toOpenCents,
    topUp: cfg.state === 'CONFIGURED' && verified ? { desk: cfg.config.desk, network: cfg.config.network.id, call: 'topUp(bytes32 keyHash, uint256 amount)', quote: '/api/credits?usd=20' } : null,
    topUpHeld: held,
  };
  const httpStatus = status === 'STORE_UNREADABLE' || status === 'NOT_RECORDED' ? 503 : 402;
  return Response.json(body, { status: httpStatus, headers: NO_STORE });
}

/** Configured, keyed, and able to pay — without charging yet. */
export async function admit(request: Request, store: Store, serviceId: ServiceId): Promise<Admission> {
  const service = serviceById(serviceId);
  if (service === null) return { ok: false, response: Response.json({ error: 'SERVICE_UNKNOWN' }, { status: 500, headers: NO_STORE }) };

  const status = creditsStatus();
  if (status.state !== 'CONFIGURED') {
    return {
      ok: false,
      response: Response.json(
        { error: 'CREDITS_NOT_CONFIGURED', state: status.state, detail: status.detail, service: service.id, priceCents: service.cents, priceList: '/api/credits' },
        { status: 503, headers: NO_STORE },
      ),
    };
  }

  const key = presentedKey(request);
  if (key === null) {
    return { ok: false, response: Response.json({ error: 'KEY_REQUIRED', detail: 'send the key in an x-curb-key header; make one at POST /api/keys or in the browser at /services', service: service.id, priceCents: service.cents }, { status: 401, headers: NO_STORE }) };
  }
  if (!isKey(key)) {
    return { ok: false, response: Response.json({ error: 'KEY_MALFORMED', detail: 'a key is curb_ followed by 43 characters of base64url', service: service.id }, { status: 401, headers: NO_STORE }) };
  }
  const hash = keyHashOf(key);
  const account = await keyAccount(store, hash, { pending: false });
  if (account.storeFault !== null) return { ok: false, response: await cannotPay(store, 'STORE_UNREADABLE', account.storeFault, account, service.id, service.cents) };
  if (account.status === 'UNFUNDED') return { ok: false, response: await cannotPay(store, 'UNFUNDED', 'the chain has credited nothing to this key hash', account, service.id, service.cents) };
  if (account.status === 'BELOW_MINIMUM') return { ok: false, response: await cannotPay(store, 'BELOW_MINIMUM', `the key has been credited ${account.creditedCents} cents; it opens at ${account.minimumOpenCents}`, account, service.id, service.cents) };
  if (BigInt(account.balanceCents) < BigInt(service.cents)) return { ok: false, response: await cannotPay(store, 'INSUFFICIENT', `the balance is ${account.balanceCents} cents; this call is ${service.cents}`, account, service.id, service.cents) };
  return { ok: true, hash, account, cents: service.cents };
}

/** The charge, once there is an answer to give. Refused with the figures if the balance moved meanwhile. */
export async function settle(store: Store, hash: string, serviceId: ServiceId, ref: string, now: Date = new Date()): Promise<Settlement> {
  const service = serviceById(serviceId)!;
  const outcome = await charge(store, hash, service.id, service.cents, ref, now);
  if (outcome.ok) return { ok: true, account: outcome.account };
  return { ok: false, response: await cannotPay(store, outcome.status, outcome.detail, outcome.account, service.id, service.cents, outcome.charged ?? false) };
}

/** Admit and settle in one step, for a call whose answer needs nothing from the store. */
export async function gate(request: Request, store: Store, serviceId: ServiceId, ref: string, now: Date = new Date()): Promise<Settlement & { readonly hash?: string }> {
  const a = await admit(request, store, serviceId);
  if (!a.ok) return a;
  const s = await settle(store, a.hash, serviceId, ref, now);
  return s.ok ? { ...s, hash: a.hash } : s;
}

/** The headers a paid answer carries: what the call cost and what is left. */
export function paidHeaders(account: KeyAccount, cents: number): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-curb-charged-cents': String(cents), 'x-curb-balance-cents': account.balanceCents };
}
