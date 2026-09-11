import { instrumentFile, seriesById } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** The instrument file for a series: generated from the archive and the chain, for an admission review. */
export async function GET(_request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const store = await getStoreAsync();
  return Response.json(await instrumentFile(store, spec), { headers: { 'cache-control': 'no-store' } });
}
