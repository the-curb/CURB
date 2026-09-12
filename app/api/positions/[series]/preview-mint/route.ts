import { previewMint, seriesById, valuationFor } from '@/lib/positions/api';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** What minting `lots` would require and yield, in base units. Sends nothing, proves nothing about success. */
export async function GET(request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const store = await getStoreAsync();
  const preview = previewMint(spec, new URL(request.url).searchParams.get('lots'), await valuationFor(store, spec));
  return Response.json(preview, { status: 'error' in preview ? 400 : 200, headers: { 'cache-control': 'no-store' } });
}
