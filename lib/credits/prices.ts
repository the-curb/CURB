/**
 * The price list, in US cents, as the token record proposes it
 * (docs/decisions/TOKEN.md). One table: the services page renders it, the
 * guard charges from it, the API publishes it. A price that is not here is
 * not a price the desk charges, and nothing is charged that is not on the
 * page.
 *
 * Prices are in dollars on purpose. The token's market price moves; the
 * price of a call does not move with it. What moves is how much CURB a
 * dollar is, and that is read from the chain, never typed in (rate.ts).
 */

export type ServiceId = 'evidence-versions' | 'journal-day' | 'alert-delivery';

export interface Service {
  readonly id: ServiceId;
  readonly title: string;
  readonly what: string;
  /** US cents per unit. */
  readonly cents: number;
  readonly unit: 'call' | 'delivery';
  readonly path: string;
}

export const SERVICES: readonly Service[] = [
  {
    id: 'evidence-versions',
    title: 'Evidence versions',
    what: "Every archived version of one source's record for a series — identities, dates, the parsed record of each",
    cents: 5,
    unit: 'call',
    path: '/api/positions/<series>/evidence/versions?source=<id>',
  },
  {
    id: 'journal-day',
    title: 'Journal by day',
    what: "The product's verified changes on one UTC day, as the Gazette prints them",
    cents: 5,
    unit: 'call',
    path: '/api/positions/<series>/journal?day=YYYY-MM-DD',
  },
  {
    id: 'alert-delivery',
    title: 'Alert delivery',
    what: "The desk's conditions — raised, cleared, still active — posted to a webhook the key registered, once per change",
    cents: 10,
    unit: 'delivery',
    path: '/api/subscriptions',
  },
];

/**
 * What a key must have been credited, cumulatively, before it can be used.
 * Decided: the product owner set the opening minimum at US$20.00 on
 * 12 September 2026, and the same day confirmed the per-unit prices above.
 * Every figure in this file is therefore decided; the record's terms —
 * validity, cancellation, the proceeds split, the order of work — are not,
 * and the token record says so.
 */
export const MINIMUM_OPEN_CENTS = 2_000;
export const MINIMUM_DECISION = { by: 'the product owner', on: '2026-09-12' } as const;
export const PRICES_DECISION = { by: 'the product owner', on: '2026-09-12' } as const;
export const PRICES_STATUS = 'decided' as const;

/** How many days' notice a price change or a service closure gets, per the record. */
export const NOTICE_DAYS = 30;

export function serviceById(id: string): Service | null {
  return SERVICES.find((s) => s.id === id) ?? null;
}

/** Cents as dollars, two places, never a float in between. */
export function centsText(cents: number | bigint): string {
  const c = typeof cents === 'bigint' ? cents : BigInt(Math.trunc(cents));
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}US$${dollars}.${(abs % 100n).toString().padStart(2, '0')}`;
}
