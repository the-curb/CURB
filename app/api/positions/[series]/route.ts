import { seriesById, seriesDetail } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** One series: its specification, evidence, on-chain verification, index and reconciliation. */
export async function GET(_request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const store = await getStoreAsync();
  return Response.json({ observedAt: new Date().toISOString(), ...(await seriesDetail(store, spec)) }, { headers: { 'cache-control': 'no-store' } });
}
