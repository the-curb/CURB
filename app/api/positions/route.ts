import { seriesSummary } from '@/lib/positions/api';
import { SERIES } from '@/lib/positions/series';

export const dynamic = 'force-dynamic';

/** Every series the site describes, with its stage and whether a reviewed deployment is configured. */
export async function GET(): Promise<Response> {
  return Response.json({ observedAt: new Date().toISOString(), series: SERIES.map(seriesSummary) }, { headers: { 'cache-control': 'no-store' } });
}
