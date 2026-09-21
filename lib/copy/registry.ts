/**
 * The words on the Registry, kept in one place so they can be checked.
 *
 * The Registry opened on "One beacon behind all of them" — a word only a
 * contract reader knows — then two panels about the beacon and the capture
 * before the table a reader came for, which started below the first screen
 * and ran all 194 tokens: twelve and a half screens. It now says what the page
 * is, shows four counts, and puts the table first, with a search box, filters,
 * and the tokens that stand for more or less than one share at the top. The
 * beacon and the capture check follow, in plain words, with every figure they
 * had.
 *
 * `tests/registry-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

import type { SampleState } from '../floor/board.ts';

export const REGISTRY = {
  title: 'The Registry',
  description: 'Every stock token on Robinhood Chain: how many shares each stands for, and whether that is about to change.',
  headline: 'Every stock token on Robinhood Chain.',
  sub: 'How many shares each token stands for, and whether that is about to change.',
  why: 'A token is not always one share. Splits and reinvested dividends change how many shares it stands for.',
  whyMore: 'Read a token’s price as a share price only when this figure is 1.',

  counts: {
    total: 'stock tokens',
    withFeed: 'with a price on the Floor',
    notAtOne: 'not at one share',
    pending: 'with a change coming',
  },

  state: {
    VERIFIED: { label: 'up to date', means: 'The Archivist read the list within its interval.' },
    STALE: { label: 'late', means: 'The Archivist has not read the list within its usual time. These are its last readings.' },
    ABSENT: { label: 'reader missing', means: 'The Archivist has not reported. Every value here is from before it stopped.' },
    NONE: { label: 'not read yet', means: 'The Archivist has never written a reading here.' },
  } satisfies Record<SampleState, { label: string; means: string }>,
  read: 'read {age} ago',
  unreadStore: 'The readings could not be loaded. No table is drawn, and none should be guessed.',

  table: {
    search: 'Find a token or company',
    filters: { all: 'All', notAtOne: 'Not one share', pending: 'Change coming', noPrice: 'No price' },
    showing: 'Showing {n} of {total}',
    showAll: 'Show all {total}',
    showFewer: 'Show fewer',
    none: 'No token matches.',
    columns: { token: 'Token', company: 'Company', shares: 'Shares per token', coming: 'Change coming', supply: 'Supply', price: 'Price', checked: 'Checked' },
    values: { none: 'none', onFloor: 'on the Floor', ago: 'ago' },
    noPrice: 'No price feed covers this token, so its price is not shown anywhere on this site.',
  },

  legend: [
    { term: 'Shares per token', means: 'How many shares one token stands for. Splits and reinvested dividends move it.' },
    { term: 'Change coming', means: 'A new figure the issuer has scheduled. Hover for when it takes effect.' },
    { term: 'Price', means: 'A dash means no price feed covers the token.' },
  ],

  beacon: {
    kicker: 'One contract behind every token',
    body: 'Every token runs the code one address points to. A change there changes all of them at once. The Registrar checks it on every run.',
    rows: { address: 'Address', code: 'Code at capture', size: 'Code size', block: 'Captured at block', at: 'Captured', last: 'Last check' },
    same: 'same as at capture',
    changed: 'changed since capture',
    noFiling: 'No check has been read yet.',
    ago: 'ago',
  },

  capture: {
    kicker: 'Is our list up to date?',
    body: 'Every day the Registrar compares our copy of the issuer’s list and the price-feed list with the live ones.',
    rows: {
      checked: 'Checked',
      tokens: 'Tokens listed now · in our copy',
      feeds: 'Price feeds listed now · in our copy',
      result: 'Result',
      added: 'Listed, not in our copy',
      removed: 'In our copy, no longer listed',
      moved: 'Moved to another contract',
      feedsAdded: 'Feeds listed, not in our copy',
      feedsRemoved: 'Feeds no longer listed',
    },
    same: 'the same lists, nothing to add',
    owed: 'our copy needs updating',
    notYet: 'Not checked yet.',
  },

  sources: {
    registry: 'Token list',
    feeds: 'Price feeds',
    onChain: '{n} of {listed} are on this chain, checked at block {block}',
    checked: '{n} of {listed} checked on chain at block {block}',
    note: 'Being listed here is not an endorsement. It is what two sources said and what the chain answered.',
  },
} as const;

/** A line with its placeholders written in. */
export function registryLine(line: string, vars: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Every sentence the Registry says in its own words, for the tests. */
export function registrySentences(): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    for (const part of registryLine(raw, { n: 194, total: 194, listed: 200, block: 1, age: '5m' }).split(/(?<=[.!?])\s+/)) if (part.trim().length > 0) out.push(part.trim());
  };
  add(REGISTRY.sub);
  add(REGISTRY.why);
  add(REGISTRY.whyMore);
  Object.values(REGISTRY.state).forEach((s) => add(s.means));
  add(REGISTRY.unreadStore);
  add(REGISTRY.table.none);
  add(REGISTRY.table.noPrice);
  REGISTRY.legend.forEach((l) => add(l.means));
  add(REGISTRY.beacon.body);
  add(REGISTRY.beacon.noFiling);
  add(REGISTRY.capture.body);
  add(REGISTRY.capture.notYet);
  add(REGISTRY.sources.note);
  return out;
}
