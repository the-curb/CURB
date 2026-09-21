/**
 * The words on the agents' pages, kept in one place so they can be checked.
 *
 * The roster opened on a seventeen-word headline, and each agent's page
 * printed its last eight filings in full — four thousand words on the
 * Specialist's alone — under labels like "posture" and "declares unknown
 * below". The filings are still there, word for word, each folded under its
 * headline; the labels now say what they mean.
 *
 * `tests/pages-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

import type { AgentHealth } from '../agents/health.ts';
import type { RunOutcome } from '../store/types.ts';

export const AGENTS_COPY = {
  index: {
    title: 'The agents',
    description: 'The agents that read Robinhood Chain for the desk, what each does, and what each refuses to do.',
    headline: '{total} agents, one job each.',
    sub: '{measure} measure. {promote} promotes, and says so every time. None of them trades.',
    refusals: 'Each one has a written refusal, enforced in code before anything is published.',
    unread: 'The status of the agents could not be read, so no light is shown. That is not a roster of idle agents.',
    notWired: 'not running yet',
  },

  health: {
    LIVE: 'running',
    STALE: 'late',
    DEGRADED: 'partial',
    ABSENT: 'missing',
    ON_REQUEST: 'on request',
    NOT_OBSERVED: 'not seen yet',
  } satisfies Record<AgentHealth, string>,

  outcome: {
    PUBLISHED: 'published',
    NOTHING_TO_SAY: 'nothing to say',
    COVERAGE_BELOW_MINIMUM: 'too few sources',
    PROVENANCE_INCOMPLETE: 'a source missing',
    POLICY_BLOCKED: 'stopped by policy',
    PRODUCER_FAILED: 'failed',
  } satisfies Record<RunOutcome, string>,

  page: {
    unreadable: 'status could not be read',
    refusal: 'What it will not do',
    enforced: 'Enforced in code before publication. An output that breaks it is stopped and kept, and the stop is recorded.',
    how: 'How it runs',
    rows: {
      posture: 'Kind',
      cadence: 'Schedule',
      sources: 'Sources it reads',
      minimum: 'Says “not known” below',
      producer: 'Running code',
    },
    posture: { MEASURES: 'measures', PROMOTES: 'promotes' },
    wired: 'yes',
    notWired: 'not yet',
    last: 'Last run',
    lastRows: { ran: 'Ran', age: 'Age of its data', outcome: 'Result', reached: 'Sources reached' },
    lastUnread: 'The last run could not be read. Nothing here is guessed from that.',
    onRequest: 'On request. It has not been asked yet, which is not a fault.',
    neverSeen: 'Not seen yet. That is not the same as missing.',
    reads: 'Where it reads from',
    runs: 'Recent runs',
    runsLast: 'last {n}',
    runsUnread: 'The run history could not be read.',
    runsNone: 'No runs recorded yet.',
    runsNote: 'One square per run, newest first. Runs that produced nothing are here too.',
    filings: 'Recent filings',
    filingsUnread: 'The filings could not be read.',
    filingsNone: 'Nothing filed yet.',
    edition: 'in the Gazette',
    footer: '{name} answers only within its own job. Ask it about something else and it points you to the right agent.',
  },
} as const;

/** A line with its placeholders written in. */
export function agentsLine(line: string, vars: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
