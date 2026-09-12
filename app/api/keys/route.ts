import { creditsStatus } from '@/lib/credits/config';
import { keyHashOf, newKey } from '@/lib/credits/keys';
import { MINIMUM_OPEN_CENTS } from '@/lib/credits/prices';

export const dynamic = 'force-dynamic';

/**
 * A new key and its hash, made here for callers without a browser. Nothing
 * is recorded: the desk learns of a key only when the chain credits its
 * hash, and it sees the key only when a call presents it. The same can be
 * done offline — thirty-two random bytes, base64url, SHA-256 — and the
 * services page does it in the browser.
 */
export async function POST(): Promise<Response> {
  const key = newKey();
  const status = creditsStatus();
  return Response.json(
    {
      key,
      keyHash: keyHashOf(key),
      shownOnce: 'the desk keeps neither the key nor its hash until the chain credits the hash; lose the key and the balance is lost',
      minimumOpenCents: MINIMUM_OPEN_CENTS,
      topUp: status.state === 'CONFIGURED' ? { desk: status.config.desk, network: status.config.network.id, call: 'topUp(bytes32 keyHash, uint256 amount)', quote: '/api/credits?usd=20' } : { state: status.state, detail: status.detail },
      balance: '/api/keys/<keyHash>',
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}
