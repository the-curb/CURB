import { composeRoll } from '@/lib/registry/roll';
import { STOCK_TOKENS_SOURCE, STOCK_TOKEN_BEACON } from '@/lib/chain/stock-tokens';
import { getStoreAsync } from '@/lib/store';

/**
 * The Registry roll as data: every stock token the issuer lists, with what the
 * Archivist last read for it, and the beacon they all delegate to. A token
 * with no snapshot yet is on the roll with every measured column absent and
 * the reason saying so; it is not a multiplier of one.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const store = await getStoreAsync();
  const [snapshots, audits] = await Promise.all([store.snapshots('token:'), store.publicationsByAgent('registrar', 1)]);

  if (snapshots.state === 'UNREAD') {
    return Response.json(
      {
        observedAt: now.toISOString(),
        state: 'STORE_UNREADABLE',
        reason: snapshots.reason,
        detail: snapshots.detail ?? null,
        note: 'No roll is drawn. This is not an empty registry.',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const roll = composeRoll(snapshots.value, now);
  const lastAudit = audits.state === 'UNREAD' ? null : (audits.value[0] ?? null);
  const beaconLine = lastAudit?.body.split('\n').find((l) => l.includes('stock-token beacon')) ?? null;

  return Response.json(
    {
      observedAt: now.toISOString(),
      state: 'READ',
      sampleState: roll.sampleState,
      sampledAt: roll.sampledAt,
      sampleAgeSeconds: roll.sampleAgeSeconds,
      counts: roll.counts,
      source: STOCK_TOKENS_SOURCE,
      beacon: {
        ...STOCK_TOKEN_BEACON,
        /** What the Registrar's last audit said, when it could be read. */
        lastAudit:
          lastAudit === null
            ? null
            : {
                at: lastAudit.publishedAt,
                verdict: beaconLine === null ? 'NO_LINE' : /CHANGED|DIFFERS/.test(beaconLine) ? 'CHANGED' : 'AS_RECORDED',
                line: beaconLine,
              },
      },
      rows: roll.rows.map((r) => ({
        ticker: r.token.ticker,
        name: r.token.name,
        address: r.token.address,
        isin: r.token.isin,
        feedKey: r.token.feedKey,
        feedName: r.feedName,
        multiplier: r.multiplierExact,
        notAtOne: r.notAtOne,
        pending: r.pending,
        supply: r.supply,
        sampleAgeSeconds: r.sampleAgeSeconds,
        unreadBecause: r.unreadBecause,
      })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
