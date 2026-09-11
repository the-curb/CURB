import { seriesById, seriesEvidence } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** The archived issuer evidence for a series and what the chain said about the addresses it names. */
export async function GET(_request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const store = await getStoreAsync();
  return Response.json({ observedAt: new Date().toISOString(), ...(await seriesEvidence(store, spec)) }, { headers: { 'cache-control': 'no-store' } });
}
