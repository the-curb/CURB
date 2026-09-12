import { previewExit, seriesById, valuationFor } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** What allocating `lots` for exit would reserve, per component. Sends nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const store = await getStoreAsync();
  const preview = previewExit(spec, new URL(request.url).searchParams.get('lots'), await valuationFor(store, spec));
  return Response.json(preview, { status: 'error' in preview ? 400 : 200, headers: { 'cache-control': 'no-store' } });
}
