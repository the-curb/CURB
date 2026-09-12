import { latestDeskCode } from '@/lib/credits/code';
import { creditsStatus } from '@/lib/credits/config';
import { latestRate, latestRun } from '@/lib/credits/maintenance';
import { receipts } from '@/lib/credits/receipts';
import { MINIMUM_DECISION, MINIMUM_OPEN_CENTS, NOTICE_DAYS, PRICES_DECISION, PRICES_STATUS, SERVICES, TERMS_DECISION, TERMS_STATUS, centsText } from '@/lib/credits/prices';
import { curbForCents, curbText, usd18Text } from '@/lib/credits/rate';
import { getStoreAsync } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The credit desk as the API states it: whether it exists, the price list in
 * dollars, the last rate read with its block, and — for `?usd=` — how much
 * CURB that many dollars is at that rate. No rate is quoted from anything
 * but a read; NOT_CONFIGURED, UNREAD and a store that would not answer are
 * answers here, not blanks.
 */
export async function GET(request: Request): Promise<Response> {
  const status = creditsStatus();
  const store = await getStoreAsync();
  const configured = status.state === 'CONFIGURED';
  const [rateRead, code, run, paid] = await Promise.all([configured ? latestRate(store) : null, configured ? latestDeskCode(store) : null, configured ? latestRun(store) : null, receipts(store)]);
  const rate = rateRead?.rate ?? null;
  const rateFault = rateRead?.storeFault ?? null;
  const usdParam = new URL(request.url).searchParams.get('usd');

  let quote: Record<string, unknown> | null = null;
  if (usdParam !== null) {
    const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(usdParam.trim());
    if (m === null) quote = { error: 'USD_MALFORMED', detail: 'usd is a dollar figure with at most two decimals, e.g. 20 or 20.50' };
    else {
      const cents = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
      if (cents === 0n) quote = { error: 'USD_ZERO', detail: 'a quote for nothing is nothing; the desk refuses a top-up of zero' };
      else if (status.state !== 'CONFIGURED') quote = { usdCents: cents.toString(), usd: centsText(cents), curb: null, state: status.state, detail: `${status.detail}; nothing is quoted` };
      else if (rateFault !== null) quote = { usdCents: cents.toString(), usd: centsText(cents), curb: null, state: 'STORE_UNREADABLE', detail: `the last rate could not be read from the store (${rateFault}); nothing is quoted` };
      else if (rate === null || rate.state !== 'READ') {
        quote = { usdCents: cents.toString(), usd: centsText(cents), curb: null, state: rate === null ? 'NO_RATE' : 'UNREAD', detail: rate === null ? 'no tick has read a rate yet; nothing is quoted' : `${rate.reason}${rate.detail ? ` — ${rate.detail}` : ''}` };
      } else {
        const amount = curbForCents(rate.rate, cents);
        // Five per cent more: the price moves between the quote and the block the top-up is mined, and a top-up meant to open a key should not land a few cents short. What lands over the figure stays on the key.
        const withMargin = (amount * 105n + 99n) / 100n;
        quote = {
          usdCents: cents.toString(),
          usd: centsText(cents),
          curb: amount.toString(),
          curbText: curbText(amount, rate.rate.token.decimals),
          curbWithMargin: withMargin.toString(),
          curbWithMarginText: curbText(withMargin, rate.rate.token.decimals),
          marginPct: 5,
          atBlock: rate.rate.block,
          readAt: rate.at,
          state: 'QUOTED',
          note: 'read at that block; the credit is at the rate at the block the top-up is mined, or the lowest the pool showed in the window before it — send the figure with the margin if the top-up must reach a threshold; what lands over it stays on the key',
        };
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
      /** Who decided the opening minimum, the per-unit prices and the record's terms, and when. */
      minimumDecided: MINIMUM_DECISION,
      pricesDecided: PRICES_DECISION,
      pricesStatus: PRICES_STATUS,
      termsDecided: TERMS_DECISION,
      termsStatus: TERMS_STATUS,
      noticeDays: NOTICE_DAYS,
      services: SERVICES.map((s) => ({ id: s.id, title: s.title, what: s.what, cents: s.cents, price: `${centsText(s.cents)} per ${s.unit}`, path: s.path, status: PRICES_STATUS })),
      rate:
        rateFault !== null
          ? { state: 'STORE_UNREADABLE', detail: rateFault }
          : rate === null
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
                  supplyAt: rate.rate.token.supplyAt,
                  decimals: rate.rate.token.decimals,
                  basis: rate.rate.basis,
                  guard: rate.rate.guard,
                  pool: rate.rate.pool,
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
