import { previewMint, seriesById } from '@/lib/positions/api';

export const dynamic = 'force-dynamic';

/** What minting `lots` would require and yield, in base units. Sends nothing, proves nothing about success. */
export async function GET(request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const preview = previewMint(spec, new URL(request.url).searchParams.get('lots'));
  return Response.json(preview, { status: 'error' in preview ? 400 : 200, headers: { 'cache-control': 'no-store' } });
}
