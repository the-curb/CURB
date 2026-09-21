/**
 * The words on the guide, kept in one place so they can be checked.
 *
 * The guide measured the worst on the site for sentence length: an average of
 * 38 words, 41% of sentences over 35. It had a second problem that length hid:
 * after the desk went free on 20 September, its services section still walked
 * a reader through a US$20 opening minimum, a top-up from a wallet, and
 * US$0.10 a delivery. Every one of those steps described a product that was no
 * longer on offer. The guide now reads the access mode the guard reads, so it
 * cannot describe a price the desk does not charge.
 *
 * `tests/guide-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

import type { LaunchStep } from '../launch/status.ts';

export interface GuideStep {
  readonly title: string;
  readonly body: readonly string[];
  readonly href?: string;
  readonly link?: string;
}

export const GUIDE = {
  title: 'How to use it',
  description: 'What you can do at THE CURB today, step by step.',
  kicker: 'How to use it',
  headline: 'What you can do here, step by step.',
  sub: 'No wallet, no account. Pick where to start.',

  parts: {
    read: { name: 'Read the prices', what: 'Every stock token, two prices, with ages.' },
    alerts: { name: 'Get alerts', what: 'A message when something changes.' },
    position: { name: 'The position', what: 'Being built. A simulation for now.' },
  },

  read: {
    title: '1 · Read the prices',
    lede: 'Each page shows one part of the record. Every number says where it came from and how old it is.',
    steps: [
      { title: 'See every price on the Floor', body: ['Every stock token, with the stock’s last price, the price on this chain, and the gap between them.'], href: '/floor', link: 'Open the Floor' },
      { title: 'Check a token in the Registry', body: ['Who issued it, whether its feed is paused, and the issuer’s shares-per-token figure.', 'A split shows up here.'], href: '/registry', link: 'Open the Registry' },
      { title: 'See transfers in the Vault', body: ['How many tokens move per minute, from a short sample of blocks.'], href: '/vault', link: 'Open the Vault' },
      { title: 'Watch the terms in Chambers', body: ['The issuers’ published terms, checked every day for changes.'], href: '/chambers', link: 'Open Chambers' },
      { title: 'Read the Gazette', body: ['One story a day, written from the record.'], href: '/gazette', link: 'Open the Gazette' },
    ] as readonly GuideStep[],
    states: 'Every number is read, late, or not read. Not read shows as a dash, never as zero.',
    doctrine: 'How we decide which',
  },

  alerts: {
    title: '2 · Get alerts',
    lede: 'You get a message when something changes on a token you hold.',
    steps: [
      { title: 'Make a key', body: ['On the Services page, press Make a key.', 'It is made in your browser and shown once. It only names your alerts.'], href: '/services#alerts', link: 'Go to Services' },
      { title: 'Register a webhook', body: ['Send your webhook address and the tokens you hold.', 'Leave the tokens out to hear about every token.'] },
      { title: 'What you are told', body: ['A gap passes {band}, a feed is paused, or a split is scheduled.', 'Also issuer and chain events that touch every token.', 'Once when it starts, once when it ends.'] },
      { title: 'Stop when you like', body: ['Cancel with the same key.'] },
    ] as readonly GuideStep[],
    paid: 'Alerts are paid per delivery right now. The prices and how to pay are on the Services page.',
  },

  api: {
    title: '3 · Take the data',
    lede: 'Every page is also JSON. No key, no account.',
    steps: [
      { title: 'The whole desk in one call', body: ['Agent health, the latest block, and what needs attention.'] },
      { title: 'One part at a time', body: ['The Floor, the Registry and the positions each have their own address.'] },
      { title: 'How to read a number', body: ['updatedAt is when the feed published. retrievedAt is when we read it.', 'Treat the older of the two as the age.', 'A null field was not read. The reason sits beside it.'] },
    ] as readonly GuideStep[],
  },

  position: {
    title: '4 · The position',
    lede: 'Exposure to one company, split across two stock-token issuers. Not live yet.',
    steps: [
      { title: 'Try the simulation', body: ['Walk one position through its life in sample units.', 'No prices and no chain.'] },
      { title: 'Read how it works', body: ['The mechanism is the plan it is built to.', 'Each design choice has a written decision record.'], href: '/mechanism', link: 'Read the mechanism' },
      { title: 'Look up an address', body: ['See what the index holds for any address.'] },
      { title: 'What must happen first', body: ['Six checks, including a rights review and an independent review of the contract.', 'Each is decided by a named person, not a model.'] },
    ] as readonly GuideStep[],
    emptyLookup: 'Until a series is live, every address comes back empty.',
  },

  token: {
    title: '5 · The token',
    lede: 'The CURB token is how the work would be funded. You do not need it to use the desk.',
    holders: 'Holding it gives no share of fees, no buyback and no vote.',
    ladder: 'These steps build the payment machinery for the token. The desk does not use it today.',
    rungs: {
      NOTHING: 'Nothing recorded yet.',
      TREASURY_RECORDED: 'A 2-of-3 treasury wallet on Robinhood Chain.',
      DESK_CONFIGURED: 'The token launched, and a payment desk set up for it.',
      CODE_VERIFIED: 'The payment desk’s code checked against the build.',
      RATE_READ: 'A price for the token read from its pool.',
      TOP_UP_RECORDED: 'A first small test payment by the operator.',
    } satisfies Record<LaunchStep, string>,
    decided: 'Each step is a person’s decision, recorded when made. Nothing here is a date.',
    checklist: 'The launch checklist',
  },
} as const;

/** A guide line with the published alert band written in, as a percentage. */
export function withGuideBand(line: string, bandBps: number): string {
  return line.replace('{band}', `${bandBps / 100}%`);
}

/** Every sentence the guide says in its own words, for the tests. */
export function guideSentences(bandBps = 200): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    for (const part of withGuideBand(raw, bandBps).split(/(?<=[.!?])\s+/)) if (part.trim().length > 0) out.push(part.trim());
  };
  add(GUIDE.sub);
  for (const section of [GUIDE.read, GUIDE.alerts, GUIDE.api, GUIDE.position]) {
    add(section.lede);
    for (const step of section.steps) step.body.forEach(add);
  }
  add(GUIDE.read.states);
  add(GUIDE.alerts.paid);
  add(GUIDE.position.emptyLookup);
  add(GUIDE.token.lede);
  add(GUIDE.token.holders);
  add(GUIDE.token.ladder);
  Object.values(GUIDE.token.rungs).forEach(add);
  add(GUIDE.token.decided);
  return out;
}
