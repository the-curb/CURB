/**
 * The words on Chambers, kept in one place so they can be checked.
 *
 * Chambers opened on "The terms, pointed at and watched. The system, with its
 * three numbers showing." — a line only its author could unpack — and named
 * its columns "register", "authority for" and "chars". It now says plainly
 * that it watches the issuers' published terms for changes and shows the
 * desk's own health, and every column says what it holds.
 *
 * `tests/pages-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

import type { SampleState } from '../floor/board.ts';

export const CHAMBERS = {
  title: 'Chambers',
  description: 'The issuers’ published terms, checked every day for changes, and the desk’s own health.',
  headline: 'The issuers’ terms, checked every day for changes.',
  sub: 'Each page is fetched daily and compared with the last copy. A change is the page to read again.',
  limit: 'This page does not read the terms for meaning. Whether they apply to you is not decided here.',

  terms: {
    kicker: 'The pages we watch',
    state: {
      VERIFIED: { label: 'up to date', means: 'Counsel fetched the pages within its interval.' },
      STALE: { label: 'late', means: 'Counsel has not fetched within its usual time.' },
      ABSENT: { label: 'reader missing', means: 'Counsel has not reported.' },
      NONE: { label: 'not watched yet', means: 'Counsel has never written a check here.' },
    } satisfies Record<SampleState, { label: string; means: string }>,
    fetched: 'fetched {age} ago',
    unread: 'The checks could not be loaded. No table is drawn.',
    counts: { read: 'read for meaning', links: 'kept as links', watched: 'watched', changed: 'changed since first seen' },
    columns: { page: 'Page', covers: 'What it covers', read: 'Read for meaning', first: 'First seen', changed: 'Last changed', size: 'Size', checked: 'Checked' },
    values: { readOn: 'read {date}', linkOnly: 'link only', unchanged: 'unchanged', chars: 'characters', ago: 'ago' },
    never: 'Never decided here',
  },

  health: {
    kicker: 'The desk’s own health',
    unread: 'The desk’s status could not be read. No numbers are shown, and none should be guessed.',
    rows: { sources: 'Sources reached', agents: 'Agents reporting in the last hour', oldest: 'Oldest input', alerts: 'Operator alerts' },
    alerts: { on: 'set up', off: 'not set up' },
    conditions: 'Needs attention',
    none: 'nothing — every check passed',
    note: 'These are worked out after every run. A new one, or one that clears, is sent once to the webhook.',
    watch: 'A stopped scheduler cannot send its own alert. That shows as the agents count above falling to zero.',
  },
} as const;
