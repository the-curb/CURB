import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isTooManyLogs, LOG_RESULT_CAP, MIN_PAGE_BLOCKS, readLogWindow } from '../lib/chain/logs.ts';
import { perMinute, SAMPLE_BLOCKS, tallyFlows, type Subject } from '../lib/agents/producers/tally.ts';
import { AGENT_BY_ID } from '../lib/agents/registry.ts';
import { read, unread, type Reading } from '../lib/doctrine/reading.ts';
import type { LogEntry, readLogs } from '../lib/chain/rpc.ts';

/**
 * The window reader is tested with a scripted node: one that refuses wide
 * pages the way the real one does, one that fails for other reasons, one that
 * truncates. The arithmetic over the logs is tested on hand-built entries.
 */

const AT = '2026-09-11T14:00:00.000Z';
const opts = { intervalSeconds: 3600 };
const TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function entry(address: string, from: string | null, to: string | null, amount: bigint, block: number): LogEntry {
  const word = (a: string | null) => `0x${(a ?? '0x0').slice(2).toLowerCase().padStart(64, '0')}`;
  return {
    address,
    topics: [TOPIC, word(from), word(to)],
    data: `0x${amount.toString(16).padStart(64, '0')}`,
    blockNumber: `0x${block.toString(16)}`,
    transactionHash: '0xabc',
  };
}

/** A node that refuses any page wider than `maxWidth` and otherwise answers `perBlock` logs per block. */
function scriptedNode(maxWidth: number, perBlock: number, fail?: (from: number) => string | null) {
  const calls: [number, number][] = [];
  const fetch: typeof readLogs = async (_a, _t, from, to) => {
    calls.push([from, to]);
    const custom = fail?.(from);
    if (custom) return unread('SOURCE_UNREACHABLE', { source: 'fake', detail: custom });
    if (to - from + 1 > maxWidth) {
      return unread('SOURCE_MALFORMED', { source: 'fake', detail: 'rpc error -32000: logs matched by query exceeds limit of 10000' });
    }
    const logs: LogEntry[] = [];
    for (let b = from; b <= to; b += 1) for (let i = 0; i < perBlock; i += 1) logs.push(entry('0xaa', '0x01', '0x02', 1n, b));
    return read<LogEntry[]>({ value: logs, source: 'fake', retrievedAt: AT, intervalSeconds: 3600 }) as Reading<LogEntry[]>;
  };
  return { fetch, calls };
}

describe('readLogWindow', () => {
  it('reads a window the node accepts in one page', async () => {
    const node = scriptedNode(1000, 2);
    const w = await readLogWindow('0xaa', [TOPIC], 100, 599, opts, node.fetch);
    assert.equal(w.pagesRead, 1);
    assert.equal(w.logs.length, 1000);
    assert.deepEqual(w.unread, []);
    assert.deepEqual(w.capped, []);
  });

  it('splits on the node’s refusal until pages are narrow enough, keeping block order', async () => {
    const node = scriptedNode(130, 1);
    const w = await readLogWindow('0xaa', [TOPIC], 0, 499, opts, node.fetch);
    assert.equal(w.logs.length, 500);
    assert.deepEqual(w.unread, []);
    const blocks = w.logs.map((l) => Number(l.blockNumber));
    assert.deepEqual(blocks, [...blocks].sort((a, b) => a - b));
    // 500 → 250 → 125: four pages of 125 answered, plus the refusals on the way.
    assert.equal(w.pagesRead, 4);
    assert.ok(node.calls.length > 4);
  });

  it('stops splitting at the minimum page and reports a gap, not a zero', async () => {
    const node = scriptedNode(10, 1); // narrower than the minimum page ever gets
    const w = await readLogWindow('0xaa', [TOPIC], 0, 199, opts, node.fetch);
    assert.equal(w.logs.length, 0);
    assert.ok(w.unread.length > 0);
    assert.ok(w.unread.every((u) => u.toBlock - u.fromBlock + 1 <= MIN_PAGE_BLOCKS));
    assert.match(w.unread[0]!.reason, /exceeds limit/);
    // The gaps tile the whole window: nothing is silently dropped.
    const covered = w.unread.reduce((n, u) => n + (u.toBlock - u.fromBlock + 1), 0);
    assert.equal(covered, 200);
  });

  it('records a non-refusal failure as a gap without splitting', async () => {
    const node = scriptedNode(1000, 1, (from) => (from === 0 ? 'HTTP 429' : null));
    const w = await readLogWindow('0xaa', [TOPIC], 0, 99, opts, node.fetch);
    assert.equal(w.pagesRead, 0);
    assert.deepEqual(w.unread, [{ fromBlock: 0, toBlock: 99, reason: 'SOURCE_UNREACHABLE — HTTP 429' }]);
    assert.equal(node.calls.length, 1);
  });

  it('flags an answer of exactly the cap as a floor, and one above it as complete', async () => {
    const exactly = scriptedNode(10_000, LOG_RESULT_CAP);
    const w1 = await readLogWindow('0xaa', [TOPIC], 5, 5, opts, exactly.fetch);
    assert.equal(w1.capped.length, 1);
    const above = scriptedNode(10_000, LOG_RESULT_CAP + 1);
    const w2 = await readLogWindow('0xaa', [TOPIC], 5, 5, opts, above.fetch);
    assert.equal(w2.capped.length, 0);
  });

  it('recognises the node’s wording for too many logs', () => {
    assert.ok(isTooManyLogs('rpc error -32000: logs matched by query exceeds limit of 10000'));
    assert.ok(isTooManyLogs('query returned more than 10000 results'));
    assert.ok(!isTooManyLogs('HTTP 429'));
    assert.ok(!isTooManyLogs(undefined));
  });
});

describe('tallyFlows', () => {
  const usdg: Subject = { key: 'usdg', symbol: 'USDG', address: '0xAA', decimals: 6 };
  const aapl: Subject = { key: 'rh-aapl', symbol: 'AAPL', address: '0xBB', decimals: 18 };

  it('counts transfers, distinct addresses, mint, burn and the largest per token', () => {
    const logs = [
      entry('0xaa', '0x01', '0x02', 100n, 1),
      entry('0xaa', '0x01', '0x03', 250n, 1),
      entry('0xaa', null, '0x02', 1000n, 2), // mint
      entry('0xaa', '0x02', null, 40n, 2), // burn
      entry('0xbb', '0x09', '0x08', 5n, 3),
      entry('0xcc', '0x09', '0x08', 5n, 3), // not a subject
    ];
    const window = { logs, fromBlock: 1, toBlock: 3, pagesRead: 1, unread: [], capped: [], retrievedAt: AT };
    const [u, a] = tallyFlows([usdg, aapl], window);
    assert.deepEqual({ transfers: u!.transfers, senders: u!.senders, receivers: u!.receivers, minted: u!.minted, burned: u!.burned, largest: u!.largest }, { transfers: 4, senders: 2, receivers: 2, minted: 1000n, burned: 40n, largest: 1000n });
    assert.equal(a!.transfers, 1);
    assert.equal(a!.senders, 1);
  });

  it('reports a token with no logs as a measured zero, not an absence', () => {
    const [flow] = tallyFlows([usdg], { logs: [], fromBlock: 1, toBlock: 3, pagesRead: 1, unread: [], capped: [], retrievedAt: AT });
    assert.equal(flow!.transfers, 0);
    assert.equal(flow!.largest, 0n);
  });

  it('computes a rate per minute over the sample, and never over a zero span', () => {
    assert.equal(perMinute(7977, 52), '9204.2');
    assert.equal(perMinute(0, 52), '0.0');
    assert.equal(perMinute(10, 0), '0.0');
  });

  it('samples about a minute of chain time at the measured block rate', () => {
    assert.ok(SAMPLE_BLOCKS * 0.102 > 30 && SAMPLE_BLOCKS * 0.102 < 120);
    assert.equal(AGENT_BY_ID.tally.sourcesExpected, 3);
  });
});
