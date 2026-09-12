import { rowOf } from '@/lib/floor/board';
import { describePriceAge, readSession } from '@/lib/market/session';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** The feed the Bell's reference price is read from: the SPY / USD feed the Pillar samples, an equity feed on the session's own clock. */
export const BELL_FEED_KEY = 'rh-spy-usd';

/**
 * THE BELL, as an endpoint. Route Handlers are not cached by default in Next 16,
 * which is what we want: a session state served from a cache is the same lie the
 * whole module exists to prevent.
 *
 * The price is the Pillar's last sample of one equity feed — read from the
 * store, with the time it was sampled and the feed's own update time — and
 * its age is judged against the session: a price read before the last close
 * says so. No sample, or a store that will not answer, is reported as such,
 * never as a price of zero.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const session = readSession(now);
  const store = await getStoreAsync();
  const feed = await store.snapshots(`feed:${BELL_FEED_KEY}`);

  let price: { readonly state: 'READ'; readonly feed: string; readonly label: string; readonly value: string; readonly feedUpdatedAgeSeconds: number | null; readonly sampledAt: string; readonly source: string } | { readonly state: 'UNREAD'; readonly reason: string; readonly detail: string | null; readonly value: null };
  let retrievedAt: Date | null = null;
  if (feed.state === 'UNREAD') {
    price = { state: 'UNREAD', reason: feed.reason, detail: feed.detail ?? null, value: null };
  } else {
    const snapshot = feed.value.find((s) => s.key === `feed:${BELL_FEED_KEY}`);
    if (snapshot === undefined) price = { state: 'UNREAD', reason: 'FIELD_ABSENT', detail: `the Pillar has not sampled ${BELL_FEED_KEY} yet`, value: null };
    else {
      const row = rowOf(snapshot, now);
      if (row.price === null) price = { state: 'UNREAD', reason: 'FIELD_ABSENT', detail: row.notPricedBecause, value: null };
      else {
        // The feed's own update time is the price's time; the sample's is when the desk read it.
        const updatedAt = typeof snapshot.payload.updatedAt === 'number' ? new Date(snapshot.payload.updatedAt * 1000) : new Date(snapshot.observedAt);
        retrievedAt = updatedAt;
        price = { state: 'READ', feed: BELL_FEED_KEY, label: row.label, value: row.price, feedUpdatedAgeSeconds: row.feedAgeSeconds, sampledAt: row.sampledAt, source: `the Pillar's sample of ${row.name}` };
      }
    }
  }

  return Response.json(
    {
      session,
      price,
      priceAge: describePriceAge(retrievedAt, session, now),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
