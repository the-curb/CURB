/**
 * The words around the Gazette, kept in one place so they can be checked.
 *
 * An edition printed every agent's latest filing in full, one after another:
 * about five thousand words a day, with the list of sources — often forty
 * lines — open at the foot. The filings are the paper's content and are not
 * edited here. Each now shows its opening lines, with the rest folded under
 * "the full filing", word for word; the sources fold under a count. The
 * paper's own words around them are short.
 *
 * `tests/pages-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

export const GAZETTE = {
  reporters: 'The agents are the reporters.',
  index: {
    live: 'Live edition',
    edition: 'Edition',
    read: 'Read the edition',
    older: 'Earlier editions',
    unread: 'The archive could not be read. No editions are listed, and none should be guessed from that.',
    dayUnread: 'This day’s record could not be read.',
    footer: 'Every edition is built from that day’s record and adds nothing to it. What was not read is printed beside what was. Nothing here is investment, legal or tax advice.',
  },
  edition: {
    live: 'Live edition',
    closed: 'Closed edition',
    filedBy: 'Filed by {agent} · {time} UTC',
    latestOf: 'latest of {n} filings today',
    promotion: 'Promotion · disclosed by the author, added by code',
    more: 'The full filing · {n} more lines',
    unread: 'The record for this day could not be read. No edition is shown. An unreadable record is not an empty day.',
    future: 'This day has not happened yet. There is nothing to print.',
    empty: 'Nothing was recorded on this day. That is an empty day, not one the record could not reach.',
    narratedBy: 'Written by {model} over the record · every figure in it is the record’s · passed the same checks as every agent',
    narrationFailed: 'A narration was tried and did not go out. The paper’s own count stands.',
    narrationStale: 'An earlier narration exists for a different version of this day and is not shown.',
    notRead: 'What was not read',
    allRead: 'Every agent that ran finished its reading. This line is printed so its absence would be noticed.',
    stopped: 'Stopped by policy',
    stoppedNote: 'The reading was complete; the gate kept the text back, and the text is kept.',
    sources: 'Sources of record',
    sourcesCount: '{n} sources',
    noSources: 'No figure was declared today, so no source is cited.',
    ledger: 'The ledger',
    ledgerNote: 'A dash is a count of zero, printed so it cannot be mistaken for a measured figure. Runs that produced nothing are counted too.',
    journal: 'Positions · verified changes',
    journalUnread: 'The position archive could not be read. An unreadable archive is not a day without change.',
    journalNone: 'No issuer record changed, no address moved and no finding moved on this day.',
    journalNote: 'Built from the archive’s rows by the day they were seen. A change is a fact about the source, not a finding about the instrument.',
    receipts: 'Services · receipts',
    receiptsUnread: 'The payment rows could not be read. An unreadable store is not a day without receipts.',
    receiptsNone: 'No top-up was credited on this day.',
    receiptsNote: 'Built from the keys’ rows by the day the credit was made. Key hashes are not printed.',
    footer: 'This edition is built from the day’s record and adds nothing to it. Each section carries its author’s refusal. Nothing here is investment, legal or tax advice, and no agent places an order.',
    composed: 'Composed {at}',
  },
} as const;

/** A line with its placeholders written in. */
export function gazetteLine(line: string, vars: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/**
 * A filing cut for the page: its first lines in view, the rest folded. The
 * cut falls after the fourth line that says something, so a filing of four
 * lines or fewer is shown whole. Nothing is dropped: the two parts joined are
 * the body as filed.
 */
export function splitFiling(body: string, keep = 4): { readonly head: string; readonly rest: string; readonly restLines: number } {
  const lines = body.split('\n');
  let seen = 0;
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== '') seen++;
    if (seen === keep) {
      cut = i + 1;
      break;
    }
  }
  const head = lines.slice(0, cut).join('\n');
  const restArr = lines.slice(cut);
  const rest = restArr.join('\n');
  return { head, rest, restLines: restArr.filter((l) => l.trim() !== '').length };
}
