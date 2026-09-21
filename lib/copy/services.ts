/**
 * The words on the services page, kept in one place so they can be checked.
 *
 * The services page was written for a paid desk. When the desk went free on
 * 20 September it gained a headline that said so, and kept everything else: a
 * price list, a rate read from a pool that does not exist yet, a US$20 opening
 * minimum, a top-up walkthrough, and a footnote that still explained which
 * endpoints were charged. A reader was told "free" once and "paid" a dozen
 * times. The page now leads with what a reader can use, puts alerts — the one
 * thing that needs a key — in the reading path, and folds the payment
 * machinery under a heading that says it is switched off.
 *
 * The machinery is folded, not cut. The contract, the price reader and the
 * receipts are still built, tested and readable, and in the paid mode the fold
 * opens by itself. The page reads the access mode the guard reads, so the two
 * cannot disagree.
 *
 * `tests/services-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

import type { ServiceId } from '../credits/prices.ts';
import type { ConditionKind } from '../ops/alerts.ts';
import type { AccessMode } from '../credits/access.ts';

export const SERVICES_COPY = {
  title: 'Services',
  description: 'What you can use at THE CURB, and what the CURB token is for.',
  kicker: 'Services',
  headline: {
    FREE: 'Everything here is free.',
    PAID: 'Paid per call, in prepaid credit.',
  } satisfies Record<AccessMode, string>,
  sub: {
    FREE: 'No wallet and no account. Alerts need a key, and a key costs nothing.',
    PAID: 'Reading the pages stays free. The history and the alerts are paid per call.',
  } satisfies Record<AccessMode, string>,
  decided: 'Decided by {by} on {on}.',

  use: {
    kicker: 'What you can use',
    columns: { service: 'Service', what: 'What you get', cost: 'Cost' },
    free: 'Free',
    open: { title: 'Every page, as JSON', what: 'The Floor, the Registry and the rest, for your own code.', path: '/api/state' },
    services: {
      'evidence-versions': 'Every saved copy of one source’s record for a series.',
      'journal-day': 'What changed on one day, as the Gazette prints it.',
      'alert-delivery': 'A message to your webhook when something changes.',
    } satisfies Record<ServiceId, string>,
    record: 'Prices on record, not charged',
    recordNote: 'These prices were set on {on} in case the desk is ever charged. No endpoint reads them while it is free.',
    minimum: 'Opening a key',
    minimumWhat: 'What a key would need before its first call.',
  },

  alerts: {
    kicker: 'Get alerts',
    headline: 'A message when something changes on a token you hold.',
    steps: [
      { title: 'Make a key', body: 'It is made in this browser and shown once. It only names your alerts.' },
      { title: 'Register your webhook', body: 'Send the address and the tokens you hold. Leave the tokens out to hear about all of them.' },
      { title: 'Hear about changes', body: 'Once when a change starts, and once when it ends.' },
      { title: 'Stop when you like', body: 'Cancel with the same key.' },
    ],
    kindsTitle: 'What you hear about',
    byDefault: 'by default',
    onRequest: 'if you ask',
    kinds: {
      token: 'One token: a split on the way, a paused feed, or a late price during market hours.',
      issuer: 'Every token at once: the issuer’s shared contract or its published list changes.',
      market: 'The gap between the two prices passes {band}, or the pool gets too thin.',
      chain: 'The chain stops making blocks.',
      desk: 'The desk’s own machinery. Sent only if you ask for it.',
    } satisfies Record<ConditionKind, string>,
    free: 'Free. Nothing is charged for a key, a webhook or a delivery.',
    paid: 'Each delivery is paid from the key’s credit. The machinery below shows how to add credit.',
    key: {
      make: 'Make a key',
      again: 'Make another key',
      key: 'Your key · send it as x-curb-key',
      hash: 'Its hash',
      copy: 'Copy it now. It is not shown again.',
      server: 'No browser? POST /api/keys makes one.',
    },
    example: 'Register, list, cancel',
  },

  token: {
    kicker: 'The CURB token',
    headline: 'It would pay for the work. You do not need it.',
    lede: 'A launch would pay for an independent review, a legal read and the servers.',
    holders: 'Holding it gives no share of fees, no buyback, no vote and no discount.',
    not: [
      'It is not needed to form, hold or claim a position.',
      'It is not a claim on any series, the treasury, fees or revenue.',
      'It does not cover anyone’s losses.',
      'Its price says nothing about the position product. The site never adds the two.',
      'It gives nobody an admin key. The payment contract has no owner, no pause and no upgrade.',
      'The eight claims the desk refuses for the position, it refuses for the token too.',
    ],
    notTitle: 'What it does not do',
    venue: 'The launch venue is PONS v2, a bonding-curve launchpad on Robinhood Chain. It was chosen on 17 September 2026.',
    venueTerms: 'Its first three seconds carry a 99% tax. At 4.2 ETH raised, trading moves to a Uniswap v4 pool.',
    noBalance: 'No call on this desk checks a balance.',
    budget: 'No funding source or launch approval is recorded yet. If a launch raises money, the budget is published first.',
    record: 'The token record',
    assumptions: 'What is assumed meanwhile',
    statusTitle: 'Where it stands',
    steps: {
      services: 'The services and the key store are built',
      review: 'The payment contract is reviewed',
      desk: 'The token launches and its payment desk is deployed',
      rate: 'A price for the token is read from its pool',
      interviews: 'The interviews run',
    },
    state: {
      done: 'done',
      notDone: 'not done',
    },
    details: {
      services: 'Rehearsed on a local chain.',
      review: 'A self-review is filed. No independent reviewer has reported.',
      interviews: 'The guide is ready. Nobody has been interviewed.',
    },
  },

  machinery: {
    summary: {
      FREE: 'The payment machinery · switched off while the desk is free',
      PAID: 'The payment machinery',
    } satisfies Record<AccessMode, string>,
    lede: 'The contract, the price reader and the receipts are built and tested. They stay here so anyone can check them.',
    terms: [
      'A call is charged only when it is answered.',
      'Credit does not expire while the service it buys is offered.',
      'A service closes with {days} days’ notice, here and in the journal.',
      'Nothing is refunded, in dollars or in CURB. The contract has no refund path.',
    ],
    termsTitle: {
      FREE: 'The terms, if it is ever charged',
      PAID: 'The terms',
    } satisfies Record<AccessMode, string>,
    keyTitle: 'A key, a quote, a top-up, a balance',
    keyLede: 'The top-up is one call, signed in your own wallet. The site holds no key and sends nothing. A balance is public by its hash.',
    noRate: 'No CURB amount is quoted until the token trades in a pool the desk can read. A price is never typed in by hand.',
  },
} as const;

/** A line with its placeholders written in: `{band}`, `{on}`, `{days}` and the like. */
export function fill(line: string, vars: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** A band in basis points as the page prints it: a percentage. */
export function bandText(bps: number): string {
  return `${bps / 100}%`;
}

/**
 * Every sentence the page says in its own words in the free mode, for the
 * tests. The paid lines are checked separately.
 */
export function servicesSentences(bandBps = 200): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    for (const part of fill(raw, { band: bandText(bandBps), on: '2026-09-12', days: 30, by: 'the product owner' }).split(/(?<=[.!?])\s+/)) {
      if (part.trim().length > 0) out.push(part.trim());
    }
  };
  const c = SERVICES_COPY;
  add(c.sub.FREE);
  add(c.use.open.what);
  Object.values(c.use.services).forEach(add);
  add(c.use.recordNote);
  add(c.use.minimumWhat);
  add(c.alerts.headline);
  c.alerts.steps.forEach((s) => add(s.body));
  Object.values(c.alerts.kinds).forEach(add);
  add(c.alerts.free);
  add(c.alerts.paid);
  add(c.alerts.key.copy);
  add(c.alerts.key.server);
  add(c.token.headline);
  add(c.token.lede);
  add(c.token.holders);
  c.token.not.forEach(add);
  add(c.token.venue);
  add(c.token.venueTerms);
  add(c.token.noBalance);
  add(c.token.budget);
  Object.values(c.token.details).forEach(add);
  add(c.machinery.lede);
  add(c.machinery.keyLede);
  add(c.machinery.noRate);
  c.machinery.terms.forEach(add);
  return out;
}
