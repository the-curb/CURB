import { composeEdition, isValidDay } from '@/lib/gazette/edition';
import { getStoreAsync } from '@/lib/store';

/** The edition as data, for anyone who would rather read the record than the page. */
export async function GET(_request: Request, ctx: RouteContext<'/api/gazette/[day]'>) {
  const { day } = await ctx.params;
  if (!isValidDay(day)) {
    return Response.json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });
  }

  const store = await getStoreAsync();
  const record = await store.dayRecord(day);

  if (record.state === 'UNREAD') {
    return Response.json(
      {
        day,
        state: 'RECORD_UNREADABLE',
        reason: record.reason,
        detail: record.detail ?? null,
        note: 'No edition is composed. An unreadable record is not an empty day.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return Response.json(
    { state: 'READ', edition: composeEdition(record.value) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
