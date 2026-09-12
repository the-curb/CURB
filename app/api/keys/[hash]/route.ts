import { isKeyHash, keyAccount } from '@/lib/credits/keys';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** What the chain has credited to a key hash and what calls have consumed. The hash is public; the key is not needed to look. */
export async function GET(_request: Request, { params }: { params: Promise<{ hash: string }> }): Promise<Response> {
  const { hash } = await params;
  const h = hash.toLowerCase();
  if (!isKeyHash(h)) return Response.json({ error: 'HASH_MALFORMED', detail: 'a key hash is 0x followed by 64 hex digits — the SHA-256 of the key' }, { status: 400 });
  const store = await getStoreAsync();
  const account = await keyAccount(store, h);
  return Response.json({ observedAt: new Date().toISOString(), ...account }, { status: account.storeFault === null ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
