import { presentedKey } from '@/lib/credits/guard';
import { isKey, isKeyHash, keyAccount, keyHashOf } from '@/lib/credits/keys';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * What the chain has credited to a key hash and what calls have consumed.
 * The hash is public — the top-ups are on chain and the totals follow from
 * them — but what was bought is the key holder's: the charges, with their
 * references, are returned only when the request carries the key that
 * hashes to this hash. Everyone else sees the count.
 */
export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }): Promise<Response> {
  const { hash } = await params;
  const h = hash.toLowerCase();
  if (!isKeyHash(h)) return Response.json({ error: 'HASH_MALFORMED', detail: 'a key hash is 0x followed by 64 hex digits — the SHA-256 of the key' }, { status: 400 });
  const store = await getStoreAsync();
  const account = await keyAccount(store, h);
  const presented = presentedKey(request) ?? '';
  const holder = presented !== '' && isKey(presented) && keyHashOf(presented) === h;
  return Response.json(
    {
      observedAt: new Date().toISOString(),
      ...account,
      charges: holder ? account.charges : null,
      chargesNote: holder ? null : 'the charges, with what they bought, are shown to the holder of the key only: send it in an x-curb-key header (or Authorization: Bearer)',
    },
    { status: account.storeFault === null ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
