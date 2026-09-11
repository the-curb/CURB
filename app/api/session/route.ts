import { describePriceAge, readSession } from '@/lib/market/session';

/**
 * THE BELL, as an endpoint. Route Handlers are not cached by default in Next 16,
 * which is what we want: a session state served from a cache is the same lie the
 * whole module exists to prevent.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const session = readSession(now);

  return Response.json(
    {
      session,
      // No price feed is wired yet. It is reported as not-connected, not as zero.
      price: { state: 'UNREAD', reason: 'SOURCE_NOT_CONNECTED', value: null },
      priceAge: describePriceAge(null, session, now),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
