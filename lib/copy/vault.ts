/**
 * The words on the Vault, kept in one place so they can be checked.
 *
 * The Vault said what it measures in a 50-word sentence about block ranges, a
 * fallback endpoint and a ten-thousand-log limit, and printed the Tally's
 * most-active line as one long sentence. The limits are still true and still
 * why the page shows a rate and never a total; the page now says that in two
 * short lines and shows the most active tokens as a table.
 *
 * `tests/vault-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

import type { SampleState } from '../floor/board.ts';

export const VAULT = {
  title: 'The Vault',
  description: 'How often stock tokens change hands on Robinhood Chain, from an hourly sample.',
  headline: 'How often tokens change hands on Robinhood Chain.',
  sub: 'Transfers a minute, from a short sample of the chain taken every hour.',
  why: 'The chain is too busy to count every transfer. So each figure is a rate, not a total.',
  bars: 'Each bar is one hourly sample. Together they show the day.',
  state: {
    VERIFIED: { label: 'up to date', means: 'The Tally sampled within its interval.' },
    STALE: { label: 'late', means: 'The Tally has not sampled within its usual time. These are its last samples.' },
    ABSENT: { label: 'reader missing', means: 'The Tally has not reported. Every bar here is from before it stopped.' },
    NONE: { label: 'no sample yet', means: 'The Tally has never written a sample here.' },
  } satisfies Record<SampleState, { label: string; means: string }>,
  newest: 'newest sample {age} ago',
  series: {
    settlement: 'what trades are paid in',
    stocks: 'all {n} stock tokens',
  },
  latest: 'transfers a minute, latest sample',
  sampled: 'sampled {age} ago',
  range: { samples: 'samples', sample: 'sample', low: 'low', median: 'typical', high: 'high' },
  unread: 'This series could not be read. Nothing is drawn, which is not the same as a quiet token.',
  noSample: 'No sample yet.',
  active: {
    kicker: 'Most active, latest sample',
    moved: '{moved} of {total} stock tokens moved. {still} did not.',
    columns: { token: 'Token', transfers: 'Transfers', senders: 'Senders', receivers: 'Receivers' },
    noLine: 'The latest report has no stock-token line.',
    unread: 'No report from the Tally could be read.',
  },
  reading: 'Many transfers between few addresses is churn. Many addresses means the token is spreading.',
  notMeasured: 'Who holds how much is not measured here. A sample cannot rank holders, so this page does not try.',
} as const;

/** A line with its placeholders written in. */
export function vaultLine(line: string, vars: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Every sentence the Vault says in its own words, for the tests. */
export function vaultSentences(): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    for (const part of vaultLine(raw, { moved: 27, total: 194, still: 167, n: 194, age: '5m' }).split(/(?<=[.!?])\s+/)) if (part.trim().length > 0) out.push(part.trim());
  };
  add(VAULT.sub);
  add(VAULT.why);
  add(VAULT.bars);
  Object.values(VAULT.state).forEach((s) => add(s.means));
  add(VAULT.unread);
  add(VAULT.active.moved);
  add(VAULT.active.noLine);
  add(VAULT.active.unread);
  add(VAULT.reading);
  add(VAULT.notMeasured);
  return out;
}
