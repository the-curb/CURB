/**
 * The Tally's stock-token line, read back into a table.
 *
 * The Tally files one sentence for the stock tokens — how many transfers, how
 * many tokens moved, and the most active few with their senders and
 * receivers. It is exact and hard to read at a glance. This reads the same
 * sentence back into rows so the Vault can show it as a table. Nothing is
 * computed here that the filing did not state: a line this cannot read is
 * returned as null, and the page prints the filing as written instead.
 */

export interface ActiveToken {
  readonly ticker: string;
  readonly transfers: number;
  readonly senders: number;
  readonly receivers: number;
}

export interface ActiveLine {
  readonly transfers: number;
  readonly moved: number;
  readonly total: number;
  readonly still: number;
  readonly top: readonly ActiveToken[];
}

const SUMMARY = /(\d+) transfers in the sample(?:, [\d.]+ a minute)?, across (\d+) of the (\d+) tokens[^;]*; (\d+) did not move\./;
const NAMED = /([A-Za-z0-9.\-]+) (\d+) \((\d+) sending, (\d+) receiving\)/g;

export function parseActive(line: string): ActiveLine | null {
  const summary = SUMMARY.exec(line);
  if (summary === null) return null;
  const at = line.indexOf('Most active:');
  const top: ActiveToken[] = [];
  if (at >= 0) {
    for (const m of line.slice(at).matchAll(NAMED)) {
      top.push({ ticker: m[1]!, transfers: Number(m[2]), senders: Number(m[3]), receivers: Number(m[4]) });
    }
  }
  return { transfers: Number(summary[1]), moved: Number(summary[2]), total: Number(summary[3]), still: Number(summary[4]), top };
}
