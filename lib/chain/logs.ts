/**
 * Logs over a window the node is willing to answer.
 *
 * This chain moves. Measured on 2026-09-11: about 450 Transfer events a second
 * across the settlement assets and the stock tokens, and a public node that
 * refuses — not truncates — any query matching more than ten thousand logs.
 * A window that would total hours of that is millions of logs, and no paging
 * strategy makes it readable from here. What is readable is a sample: a short
 * window, split in half whenever the node says it matched too much, down to a
 * page so narrow that a refusal there is reported as a gap.
 *
 * The result says what was read and what was not. A page the node refused is
 * a range with no logs *known*, which is not a range with no logs, and the
 * caller states the gap rather than summing over it.
 */

import { readLogs, type LogEntry, type RpcOptions } from './rpc.ts';

/** The node's own cap. A query matching more than this is refused outright. */
export const LOG_RESULT_CAP = 10_000;

/** Below this a refused page is not split again; it becomes a stated gap. */
export const MIN_PAGE_BLOCKS = 25;

export interface LogWindow {
  readonly logs: readonly LogEntry[];
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly pagesRead: number;
  /** Ranges the node did not answer for, with its reason. Not empty ranges. */
  readonly unread: readonly { readonly fromBlock: number; readonly toBlock: number; readonly reason: string }[];
  /** Ranges whose answer sat at the cap: their counts are floors, not totals. */
  readonly capped: readonly { readonly fromBlock: number; readonly toBlock: number }[];
  readonly retrievedAt: string | null;
}

/**
 * A node's refusal of a query for matching too much or spanning too wide, as
 * the nodes seen so far word it — Robinhood Chain's public node ("logs matched
 * by query exceeds limit of 10000"); dRPC, measured 13 September 2026: keyless
 * "ranges over 10000 blocks are not supported on free plan" (in fact about
 * 200 blocks), keyed "eth_getLogs range over 100000 blocks is not supported on
 * robinhood, request a narrower fromBlock/toBlock range" (100,001 blocks
 * served, no cap on results seen: 703,091 logs in one answer); Alchemy and
 * others ("block range", "query returned more than", "response size"). Either
 * kind is answered by halving.
 */
export function isTooManyLogs(detail: string | undefined): boolean {
  return detail !== undefined && /exceeds limit|too many|query returned more than|response size|block range|ranges? over \d+ blocks|range too (?:large|wide)|narrower (?:fromBlock|range)/i.test(detail);
}

/**
 * A node's own way of giving up on a query that matched too much to answer in
 * its time: a JSON-RPC error, not a transport timeout, so it arrives as
 * SOURCE_MALFORMED with the node's words. Measured on Robinhood Chain's public
 * node, 16–17 September 2026, on wide PoolManager queries: -32000 "log query
 * timed out" and "context deadline exceeded", nondeterministically — the same
 * window answered and timed out on different attempts. The answer is the
 * same as for a refusal: halve.
 */
export function isLogTimeout(detail: string | undefined): boolean {
  return detail !== undefined && /log query timed out|context deadline exceeded|query timed? ?out|request timed out/i.test(detail);
}

/** A page to halve: refused for matching too much or too wide, or not answered in time — by the transport, or by the node's own clock. A node with no cap on results (dRPC) says "too much" only by taking too long. */
export function halveable(reading: { readonly reason: string; readonly detail?: string }): boolean {
  return reading.reason === 'SOURCE_TIMEOUT' || isTooManyLogs(reading.detail) || isLogTimeout(reading.detail);
}

export async function readLogWindow(
  addresses: string | readonly string[],
  topics: readonly (string | null)[],
  fromBlock: number,
  toBlock: number,
  opts: RpcOptions,
  fetch: typeof readLogs = readLogs,
): Promise<LogWindow> {
  const logs: LogEntry[] = [];
  const unread: { fromBlock: number; toBlock: number; reason: string }[] = [];
  const capped: { fromBlock: number; toBlock: number }[] = [];
  let pagesRead = 0;
  let retrievedAt: string | null = null;

  // Explicit stack, earliest range on top, so the logs come out in block order.
  const pending: { from: number; to: number }[] = [{ from: fromBlock, to: toBlock }];

  while (pending.length > 0) {
    const page = pending.pop()!;
    const width = page.to - page.from + 1;
    const result = await fetch(addresses, topics, page.from, page.to, opts);

    if (result.state === 'UNREAD') {
      if (halveable(result) && width > MIN_PAGE_BLOCKS) {
        // Too many for one answer: halve, and push the later half first so
        // the earlier one is read next.
        const middle = page.from + Math.floor(width / 2);
        pending.push({ from: middle, to: page.to }, { from: page.from, to: middle - 1 });
        continue;
      }
      unread.push({ fromBlock: page.from, toBlock: page.to, reason: `${result.reason}${result.detail ? ` — ${result.detail}` : ''}` });
      continue;
    }

    pagesRead += 1;
    retrievedAt ??= result.retrievedAt;
    // Defensive, for a node that truncates instead of refusing: an answer of
    // exactly the cap is the signature of a cut. More than the cap is not —
    // this node's refusal is an estimate, and its answers can run past it.
    if (result.value.length === LOG_RESULT_CAP) capped.push({ fromBlock: page.from, toBlock: page.to });
    logs.push(...result.value);
  }

  return { logs, fromBlock, toBlock, pagesRead, unread, capped, retrievedAt };
}
