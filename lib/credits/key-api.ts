import type { Store } from '../store/types.ts';
import type { CreditsStatus } from './config.ts';
import { newKey, keyHashOf } from './keys.ts';
import { MINIMUM_OPEN_CENTS } from './prices.ts';
import { topUpReadiness } from './top-up.ts';

/** Stateless key creation still succeeds while payment invitations are held. */
export async function newKeyResponse(status: CreditsStatus, store: Store, now = new Date()): Promise<Response> {
  const key = newKey();
  const readiness = await topUpReadiness(store, status, now);
  return Response.json({
    key, keyHash: keyHashOf(key),
    shownOnce: 'the desk keeps neither the key nor its hash until the chain credits the hash; lose the key and the balance is lost',
    minimumOpenCents: MINIMUM_OPEN_CENTS,
    topUp: readiness.topUp, topUpHeld: readiness.topUpHeld, quoteReadiness: readiness.quoteReadiness,
    priceList: '/api/credits', balance: '/api/keys/<keyHash>',
  }, { status: 201, headers: { 'cache-control': 'no-store' } });
}
