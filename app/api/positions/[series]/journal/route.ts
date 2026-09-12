import { gate, paidHeaders } from '@/lib/credits/guard';
import { serviceById } from '@/lib/credits/prices';
import { seriesById } from '@/lib/positions/api';
import { positionsJournal } from '@/lib/positions/journal';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

const PRICE = serviceById('journal-day')!.cents;

/** The product's verified changes on one UTC day, as the Gazette prints them. Paid: one call per day asked. */
export async function GET(request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const day = new URL(request.url).searchParams.get('day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    return Response.json({ error: 'DAY_MALFORMED', detail: 'pass ?day=YYYY-MM-DD (UTC)' }, { status: 400 });
  }
  const store = await getStoreAsync();
  const paid = await gate(request, store, 'journal-day', `${series} · ${day}`);
  if (!paid.ok) return paid.response;
  const journal = await positionsJournal(store, day);
  const entries = journal.entries.filter((e) => e.seriesId === spec.id);
  return Response.json(
    { observedAt: new Date().toISOString(), series: spec.id, day, entries, storeFault: journal.storeFault },
    { status: journal.storeFault === null ? 200 : 503, headers: paidHeaders(paid.account, PRICE) },
  );
}
