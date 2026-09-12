import { admit, paidHeaders, settle } from '@/lib/credits/guard';
import { seriesById } from '@/lib/positions/api';
import { positionsJournal } from '@/lib/positions/journal';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** The product's verified changes on one UTC day, as the Gazette prints them. Paid: admitted, composed, then charged. */
export async function GET(request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const day = new URL(request.url).searchParams.get('day') ?? '';
  // A real calendar day: the parse must give the same day back, so 2026-02-31 is refused rather than charged for.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    return Response.json({ error: 'DAY_MALFORMED', detail: 'pass ?day=YYYY-MM-DD (UTC)' }, { status: 400 });
  }
  const store = await getStoreAsync();
  const admitted = await admit(request, store, 'journal-day');
  if (!admitted.ok) return admitted.response;

  const journal = await positionsJournal(store, day);
  if (journal.storeFault !== null) {
    return Response.json({ error: 'STORE_UNREADABLE', detail: journal.storeFault, charged: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const entries = journal.entries.filter((e) => e.seriesId === spec.id);

  const settled = await settle(store, admitted.hash, 'journal-day', `${series} · ${day}`);
  if (!settled.ok) return settled.response;
  return Response.json({ observedAt: new Date().toISOString(), series: spec.id, day, entries }, { headers: paidHeaders(settled.account, admitted.cents) });
}
