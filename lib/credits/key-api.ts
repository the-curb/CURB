import type { Store } from '../store/types.ts';
import type { CreditsStatus } from './config.ts';
import { newKey, keyHashOf } from './keys.ts';
import { MINIMUM_OPEN_CENTS } from './prices.ts';
import { topUpReadiness } from './top-up.ts';
import { isFree, KEY_IS_IDENTITY_ONLY, type AccessMode } from './access.ts';

/** Stateless key creation still succeeds while payment invitations are held. */
export async function newKeyResponse(status: CreditsStatus, store: Store, now = new Date(), mode?: AccessMode): Promise<Response> {
  const key = newKey();
  // While the desk is free a key is a name, not an account: it says whose
  // webhook a subscription belongs to and nothing else. The top-up fields
  // would be an invitation to pay for something that is not for sale, so they
  // are absent rather than present and zero.
  if (isFree(mode)) {
    return Response.json({
      key,
      keyHash: keyHashOf(key),
      access: 'FREE',
      shownOnce: 'the desk keeps neither the key nor its hash; lose the key and you simply raise another',
      whatItIsFor: KEY_IS_IDENTITY_ONLY,
      subscriptions: '/api/subscriptions',
    }, { status: 201, headers: { 'cache-control': 'no-store' } });
  }
  const readiness = await topUpReadiness(store, status, now);
  return Response.json({
    key, keyHash: keyHashOf(key),
    access: 'PAID',
    shownOnce: 'the desk keeps neither the key nor its hash until the chain credits the hash; lose the key and the balance is lost',
    minimumOpenCents: MINIMUM_OPEN_CENTS,
    topUp: readiness.topUp, topUpHeld: readiness.topUpHeld, quoteReadiness: readiness.quoteReadiness,
    priceList: '/api/credits', balance: '/api/keys/<keyHash>',
  }, { status: 201, headers: { 'cache-control': 'no-store' } });
}
