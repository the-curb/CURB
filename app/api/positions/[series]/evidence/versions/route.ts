import { gate, paidHeaders } from '@/lib/credits/guard';
import { serviceById } from '@/lib/credits/prices';
import { seriesById } from '@/lib/positions/api';
import { EVIDENCE_PREFIX, EVIDENCE_SOURCES, identityHistory } from '@/lib/positions/evidence';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

const PRICE = serviceById('evidence-versions')!.cents;

/**
 * Every archived version of one source's record: the identities in order,
 * when each was first seen, and the parsed record of each. Paid: one call
 * is charged before the archive is read, at the listed price.
 */
export async function GET(request: Request, { params }: { params: Promise<{ series: string }> }): Promise<Response> {
  const { series } = await params;
  const spec = seriesById(series);
  if (spec === null) return Response.json({ error: 'SERIES_UNKNOWN', detail: `no series is described as ${series}` }, { status: 404 });
  const sourceId = new URL(request.url).searchParams.get('source') ?? '';
  const source = EVIDENCE_SOURCES.find((s) => s.id === sourceId) ?? null;
  if (source === null) {
    return Response.json({ error: 'SOURCE_UNKNOWN', detail: 'pass ?source=<id>; the ids are in /api/positions/<series>/evidence', sources: EVIDENCE_SOURCES.map((s) => s.id) }, { status: 400 });
  }
  const store = await getStoreAsync();
  const paid = await gate(request, store, 'evidence-versions', `${series} · ${source.id}`);
  if (!paid.ok) return paid.response;

  const rows = await store.snapshots(`${EVIDENCE_PREFIX}${source.id}:v:`);
  if (rows.state === 'UNREAD') {
    return Response.json({ error: 'STORE_UNREADABLE', detail: `${rows.reason}${rows.detail ? ` — ${rows.detail}` : ''}` }, { status: 503, headers: paidHeaders(paid.account, PRICE) });
  }
  const hashOf = (r: { key: string; payload: Readonly<Record<string, unknown>> }) => (typeof r.payload.hash === 'string' ? r.payload.hash : r.key.slice(-64));
  const history = identityHistory(rows.value);
  return Response.json(
    {
      observedAt: new Date().toISOString(),
      series: spec.id,
      source: { id: source.id, title: source.title, url: source.url, component: source.component, kind: source.kind },
      versions: history.map((v) => {
        // The row whose bytes were first seen at this identity's time; older rows keyed by the bytes' hash still carry the parsed record.
        const row = rows.value.find((r) => r.observedAt === v.at) ?? rows.value.find((r) => hashOf(r) === v.identity) ?? null;
        return { identity: v.identity, firstSeenAt: v.at, status: v.status, httpStatus: v.httpStatus, parsed: row?.payload.parsed ?? null, retrievedAt: row?.observedAt ?? null };
      }),
      rowsRead: rows.value.length,
    },
    { headers: paidHeaders(paid.account, PRICE) },
  );
}
