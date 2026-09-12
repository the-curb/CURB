/**
 * The gate on a paid endpoint: a key in the `x-curb-key` header, charged
 * the listed price before the answer is composed. A call without a key is
 * 401; a key that cannot pay is 402 with the figures and how to top up; a
 * desk nobody configured is 503, because nothing can be bought where nothing
 * is sold. The public endpoints never pass through here.
 */

import type { Store } from '../store/types.ts';
import { creditsStatus } from './config.ts';
import { charge, isKey, keyHashOf, type KeyAccount } from './keys.ts';
import { serviceById, type ServiceId } from './prices.ts';

const NO_STORE = { 'cache-control': 'no-store' } as const;

export type GateOutcome = { readonly ok: true; readonly hash: string; readonly account: KeyAccount } | { readonly ok: false; readonly response: Response };

function keyFrom(request: Request): string | null {
  const header = request.headers.get('x-curb-key');
  if (header) return header.trim();
  const auth = request.headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

export async function gate(request: Request, store: Store, serviceId: ServiceId, ref: string, now: Date = new Date()): Promise<GateOutcome> {
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

  const key = keyFrom(request);
  if (key === null) {
    return { ok: false, response: Response.json({ error: 'KEY_REQUIRED', detail: 'send the key in an x-curb-key header; make one at POST /api/keys or in the browser at /services', service: service.id, priceCents: service.cents }, { status: 401, headers: NO_STORE }) };
  }
  if (!isKey(key)) {
    return { ok: false, response: Response.json({ error: 'KEY_MALFORMED', detail: 'a key is curb_ followed by 43 characters of base64url', service: service.id }, { status: 401, headers: NO_STORE }) };
  }
  const hash = keyHashOf(key);
  const outcome = await charge(store, hash, service.id, service.cents, ref, now);
  if (outcome.ok) return { ok: true, hash, account: outcome.account };

  const body = {
    error: outcome.status,
    detail: outcome.detail,
    service: service.id,
    priceCents: service.cents,
    keyHash: hash,
    creditedCents: outcome.account.creditedCents,
    spentCents: outcome.account.spentCents,
    balanceCents: outcome.account.balanceCents,
    toOpenCents: outcome.account.toOpenCents,
    topUp: { desk: status.config.desk, network: status.config.network.id, call: 'topUp(bytes32 keyHash, uint256 amount)', quote: '/api/credits?usd=20' },
  };
  const httpStatus = outcome.status === 'STORE_UNREADABLE' || outcome.status === 'NOT_RECORDED' ? 503 : 402;
  return { ok: false, response: Response.json(body, { status: httpStatus, headers: NO_STORE }) };
}

/** The headers a paid answer carries: what the call cost and what is left. */
export function paidHeaders(account: KeyAccount, cents: number): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-curb-charged-cents': String(cents), 'x-curb-balance-cents': account.balanceCents };
}
