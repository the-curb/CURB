import { creditsStatus } from '@/lib/credits/config';
import { isFree, KEY_IS_IDENTITY_ONLY } from '@/lib/credits/access';
import { presentedKey } from '@/lib/credits/guard';
import { isKey, keyHashOf } from '@/lib/credits/keys';
import { cancelSubscription, createSubscription, parseFilter, subscriptionsOf } from '@/lib/credits/subscriptions';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' } as const;

function keyOf(request: Request): { hash: string } | { response: Response } {
  // A key is still required here, and while the desk is free that is the only
  // thing it is: the name a subscription belongs to, so the right webhook gets
  // the right changes and only its owner can cancel it. It is raised in the
  // browser or at POST /api/keys, it needs no top-up, and the desk's credit
  // configuration is not consulted — there is nothing to configure where
  // nothing is sold.
  if (!isFree()) {
    const status = creditsStatus();
    if (status.state !== 'CONFIGURED') return { response: Response.json({ error: 'CREDITS_NOT_CONFIGURED', state: status.state, detail: status.detail }, { status: 503, headers: NO_STORE }) };
  }
  const key = presentedKey(request) ?? '';
  if (key === '') return { response: Response.json({ error: 'KEY_REQUIRED', detail: isFree() ? `send the key in an x-curb-key header (or Authorization: Bearer). ${KEY_IS_IDENTITY_ONLY}` : 'send the key in an x-curb-key header (or Authorization: Bearer)' }, { status: 401, headers: NO_STORE }) };
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

/**
 * Register a webhook: `{ "url": "https://…", "kinds"?: ["token","issuer","chain","desk"], "tokens"?: ["AAPL", …] }`.
 * Without kinds, a holder's default: token, issuer and chain events, not the desk's plumbing; without tokens, every token.
 * Registering is free, and so is every delivery: see lib/credits/access.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const k = keyOf(request);
  if ('response' in k) return k.response;
  const body = await bodyOf(request);
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (url === '') return Response.json({ error: 'URL_REQUIRED', detail: 'send JSON: { "url": "https://…", "tokens": ["AAPL"] }' }, { status: 400, headers: NO_STORE });
  const filter = parseFilter({ kinds: body?.kinds, tokens: body?.tokens });
  if (!filter.ok) return Response.json({ error: 'FILTER_REFUSED', detail: filter.detail }, { status: 400, headers: NO_STORE });
  const store = await getStoreAsync();
  const outcome = await createSubscription(store, k.hash, url, new Date(), filter.filter);
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
