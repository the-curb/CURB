/**
 * Liveness, and nothing else. The platform's health check asks one question —
 * is this process serving? — and must not be answered by a route that reads
 * the store: `/api/state` returns 503 when Postgres will not answer, which is
 * the honest reading for a reader and the wrong signal for a deploy, because
 * a store blip would fail the release of a build that would have reported the
 * outage correctly. Whether the record can be read is `/api/state`'s to say.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    { ok: true, at: new Date().toISOString(), note: 'liveness only; the record is at /api/state' },
    { headers: { 'cache-control': 'no-store' } },
  );
}
