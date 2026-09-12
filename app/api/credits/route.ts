import { latestDeskCode } from '@/lib/credits/code';
import { creditsStatus } from '@/lib/credits/config';
import { latestRate, latestRun } from '@/lib/credits/maintenance';
import { receipts } from '@/lib/credits/receipts';
import { MINIMUM_DECISION, MINIMUM_OPEN_CENTS, NOTICE_DAYS, PRICES_DECISION, PRICES_STATUS, SERVICES, centsText } from '@/lib/credits/prices';
import { curbForCents, curbText, usd18Text } from '@/lib/credits/rate';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The credit desk as the API states it: whether it exists, the price list in
 * dollars, the last rate read with its block, and — for `?usd=` — how much
 * CURB that many dollars is at that rate. No rate is quoted from anything
 * but a read; NOT_CONFIGURED and UNREAD are answers here, not blanks.
 */
export async function GET(request: Request): Promise<Response> {
  const status = creditsStatus();
  const store = await getStoreAsync();
  const configured = status.state === 'CONFIGURED';
  const [rate, code, run, paid] = await Promise.all([configured ? latestRate(store) : null, configured ? latestDeskCode(store) : null, configured ? latestRun(store) : null, receipts(store)]);
  const usdParam = new URL(request.url).searchParams.get('usd');

  let quote: Record<string, unknown> | null = null;
  if (usdParam !== null) {
    const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(usdParam.trim());
    if (m === null) quote = { error: 'USD_MALFORMED', detail: 'usd is a dollar figure with at most two decimals, e.g. 20 or 20.50' };
    else {
      const cents = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
      if (rate === null || rate.state !== 'READ') {
        quote = { usdCents: cents.toString(), usd: centsText(cents), curb: null, state: rate === null ? 'NO_RATE' : 'UNREAD', detail: rate === null ? 'no rate has been read; nothing is quoted' : `${rate.reason}${rate.detail ? ` — ${rate.detail}` : ''}` };
      } else {
        const amount = curbForCents(rate.rate, cents);
        quote = { usdCents: cents.toString(), usd: centsText(cents), curb: amount.toString(), curbText: curbText(amount, rate.rate.token.decimals), atBlock: rate.rate.block, readAt: rate.at, state: 'QUOTED', note: 'read at that block; the credit is at the rate at the block the top-up is mined' };
      }
    }
  }

  return Response.json(
    {
      observedAt: new Date().toISOString(),
      state: status.state,
      detail: status.state === 'CONFIGURED' ? null : status.detail,
      desk: status.state === 'CONFIGURED' ? { network: status.config.network.id, chainId: status.config.network.chainId, desk: status.config.desk, token: status.config.token, treasury: status.config.treasury, priceSource: status.config.priceSource } : null,
      /** The desk's code against the committed build, and the treasury it pays to against the record — verified every tick. */
      code: code === null ? null : code.storeFault !== null ? { state: 'STORE_UNREADABLE', detail: code.storeFault } : code.code === null ? { state: 'NOT_YET_VERIFIED', detail: 'no tick has read the desk yet' } : code.code,
      lastRun: run,
      /** What the chain has paid into the treasury through the desk, as credited: the receipts the token record promises. */
      receipts: paid,
      minimumOpenCents: MINIMUM_OPEN_CENTS,
      minimumOpen: centsText(MINIMUM_OPEN_CENTS),
      /** Who decided the opening minimum and the per-unit prices, and when. The record's terms are still proposed. */
      minimumDecided: MINIMUM_DECISION,
      pricesDecided: PRICES_DECISION,
      pricesStatus: PRICES_STATUS,
      termsStatus: 'proposed',
      noticeDays: NOTICE_DAYS,
      services: SERVICES.map((s) => ({ id: s.id, title: s.title, what: s.what, cents: s.cents, price: `${centsText(s.cents)} per ${s.unit}`, path: s.path, status: PRICES_STATUS })),
      rate:
        rate === null
          ? null
          : rate.state === 'READ'
            ? {
                state: 'READ',
                at: rate.at,
                block: rate.rate.block,
                usdPerCurb18: rate.rate.usdPerCurb18,
                usdPerCurb: usd18Text(rate.rate.usdPerCurb18, 8),
                marketCapUsd18: rate.rate.marketCapUsd18,
                marketCap: usd18Text(rate.rate.marketCapUsd18, 2),
                supply: rate.rate.token.supply,
                decimals: rate.rate.token.decimals,
                pair: rate.rate.pair,
                quote: rate.rate.quote,
                source: rate.rate.source,
              }
            : { state: 'UNREAD', at: rate.at, block: rate.block, reason: rate.reason, detail: rate.detail },
      quote,
      keyHash: 'SHA-256 of the key; topUp(bytes32 keyHash, uint256 amount) on the desk credits it',
      record: '/mechanism/decisions/token',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
