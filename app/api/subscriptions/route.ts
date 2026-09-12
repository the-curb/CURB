import { creditsStatus } from '@/lib/credits/config';
import { presentedKey } from '@/lib/credits/guard';
import { isKey, keyHashOf } from '@/lib/credits/keys';
import { cancelSubscription, createSubscription, subscriptionsOf } from '@/lib/credits/subscriptions';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' } as const;

function keyOf(request: Request): { hash: string } | { response: Response } {
  const status = creditsStatus();
  if (status.state !== 'CONFIGURED') return { response: Response.json({ error: 'CREDITS_NOT_CONFIGURED', state: status.state, detail: status.detail }, { status: 503, headers: NO_STORE }) };
  const key = presentedKey(request) ?? '';
  if (key === '') return { response: Response.json({ error: 'KEY_REQUIRED', detail: 'send the key in an x-curb-key header (or Authorization: Bearer)' }, { status: 401, headers: NO_STORE }) };
  if (!isKey(key)) return { response: Response.json({ error: 'KEY_MALFORMED', detail: 'a key is curb_ followed by 43 characters of base64url' }, { status: 401, headers: NO_STORE }) };
  return { hash: keyHashOf(key) };
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The key's webhook subscriptions, live and cancelled, with the last delivery of each. Free to read. */
export async function GET(request: Request): Promise<Response> {
  const k = keyOf(request);
  if ('response' in k) return k.response;
  const store = await getStoreAsync();
  const mine = await subscriptionsOf(store, k.hash);
  return Response.json({ observedAt: new Date().toISOString(), keyHash: k.hash, subscriptions: mine.subscriptions, storeFault: mine.storeFault }, { status: mine.storeFault === null ? 200 : 503, headers: NO_STORE });
}

/** Register a webhook: `{ "url": "https://…" }`. Each delivery is charged at the listed price; registering is free. */
export async function POST(request: Request): Promise<Response> {
  const k = keyOf(request);
  if ('response' in k) return k.response;
  const body = await bodyOf(request);
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (url === '') return Response.json({ error: 'URL_REQUIRED', detail: 'send JSON: { "url": "https://…" }' }, { status: 400, headers: NO_STORE });
  const store = await getStoreAsync();
  const outcome = await createSubscription(store, k.hash, url, new Date());
  if (!outcome.ok) return Response.json({ error: outcome.error, detail: outcome.detail }, { status: outcome.status, headers: NO_STORE });
  return Response.json({ observedAt: new Date().toISOString(), subscription: outcome.subscription }, { status: 201, headers: NO_STORE });
}

/** Cancel: `{ "id": "…" }`. The row stays, marked cancelled; nothing further is delivered or charged. */
export async function DELETE(request: Request): Promise<Response> {
  const k = keyOf(request);
  if ('response' in k) return k.response;
  const body = await bodyOf(request);
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!/^[0-9a-f]{32}$/.test(id)) return Response.json({ error: 'ID_MALFORMED', detail: 'send JSON: { "id": "<32 hex>" }' }, { status: 400, headers: NO_STORE });
  const store = await getStoreAsync();
  const outcome = await cancelSubscription(store, k.hash, id, new Date());
  return Response.json({ observedAt: new Date().toISOString(), id, ok: outcome.ok, detail: outcome.detail }, { status: outcome.status, headers: NO_STORE });
}
