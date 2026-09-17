import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { composeBoard, rowOf } from '../lib/floor/board.ts';
import { composeRoll } from '../lib/registry/roll.ts';
import { parseInline, parseMarkdown, slugOf } from '../lib/docs/markdown.ts';
import { STOCK_TOKENS } from '../lib/chain/stock-tokens.ts';
import type { SnapshotRecord } from '../lib/store/types.ts';

/**
 * The pages are composed from stored snapshots by pure functions, and those
 * are what is tested: that a payload is never trusted, that an absence stays
 * an absence, and that a board drawn from an old sample says so.
 */

const NOW = new Date('2026-09-11T14:00:00.000Z');

function feedSnapshot(key: string, ageMinutes: number, payload: Record<string, unknown>): SnapshotRecord {
  return {
    key: `feed:${key}`,
    observedAt: new Date(NOW.getTime() - ageMinutes * 60_000).toISOString(),
    payload: { key, label: key.toUpperCase(), name: key, marketHours: 'equity', ...payload },
  };
}

describe('the Floor board', () => {
  const priced = {
    price: '334.34',
    raw: '33434916130',
    decimals: 8,
    updatedAt: Math.floor(NOW.getTime() / 1000) - 415,
    ageSeconds: 415,
    heartbeatSeconds: 86400,
    pastHeartbeat: false,
    identity: 'MATCHES',
    pauseFlag: 'CLEAR',
    notPricedBecause: null,
    session: 'REGULAR',
  };

  it('computes the feed age against now, not against the sample', () => {
    // Sampled ten minutes ago; the oracle published 415 s before that sample.
    const row = rowOf(feedSnapshot('rh-aapl-usd', 10, priced), NOW);
    assert.equal(row.price, '334.34');
    assert.equal(row.feedAgeSeconds, 415);
    assert.equal(row.sampleAgeSeconds, 600);
    assert.equal(row.identity, 'MATCHES');
    assert.equal(row.pauseFlag, 'CLEAR');
  });

  it('keeps an absence an absence, with its reason', () => {
    const row = rowOf(feedSnapshot('rh-nvda-usd', 1, { price: null, notPricedBecause: 'SOURCE_TIMEOUT — slow' }), NOW);
    assert.equal(row.price, null);
    assert.equal(row.feedAgeSeconds, null);
    assert.match(row.notPricedBecause ?? '', /SOURCE_TIMEOUT/);
  });

  it('does not trust the payload shape', () => {
    const row = rowOf({ key: 'feed:rh-x-usd', observedAt: NOW.toISOString(), payload: { price: 42, updatedAt: 'yesterday', identity: 'FINE', pauseFlag: 7 } }, NOW);
    assert.equal(row.price, null);
    assert.equal(row.feedAgeSeconds, null);
    assert.equal(row.identity, null);
    assert.equal(row.pauseFlag, null);
    assert.match(row.notPricedBecause ?? '', /could not be read as written/);
  });

  it('says how old the board is, in the same three states as everything else', () => {
    assert.equal(composeBoard([], NOW).sampleState, 'NONE');
    assert.equal(composeBoard([feedSnapshot('rh-aapl-usd', 5, priced)], NOW).sampleState, 'VERIFIED');
    // Pillar interval 15 min; freshness is interval + 2 h grace, absence 2× interval + 2 h.
    assert.equal(composeBoard([feedSnapshot('rh-aapl-usd', 140, priced)], NOW).sampleState, 'STALE');
    assert.equal(composeBoard([feedSnapshot('rh-aapl-usd', 200, priced)], NOW).sampleState, 'ABSENT');
  });

  it('counts the book and splits the clocks', () => {
    const board = composeBoard(
      [
        feedSnapshot('rh-aapl-usd', 1, priced),
        feedSnapshot('rh-nvda-usd', 1, { ...priced, pastHeartbeat: true, pauseFlag: 'SET' }),
        feedSnapshot('rh-tsla-usd', 1, { ...priced, price: null, identity: 'DRIFT', notPricedBecause: 'drift' }),
        feedSnapshot('btc-usd', 1, { ...priced, marketHours: 'crypto', pauseFlag: 'NOT_ASKED' }),
      ],
      NOW,
    );
    assert.equal(board.equity.length, 3);
    assert.equal(board.crypto.length, 1);
    assert.deepEqual(board.counts, { equity: 3, priced: 2, pastHeartbeat: 1, paused: 1, drift: 1, unread: 1 });
    assert.deepEqual(board.equity.map((r) => r.label), ['RH-AAPL-USD', 'RH-NVDA-USD', 'RH-TSLA-USD']);
  });
});

describe('the Registry roll', () => {
  const aapl = STOCK_TOKENS.find((t) => t.ticker === 'AAPL')!;

  it('lists every token in the registry even before any is read', () => {
    const roll = composeRoll([], NOW);
    assert.equal(roll.rows.length, STOCK_TOKENS.length);
    assert.equal(roll.sampleState, 'NONE');
    assert.equal(roll.counts.read, 0);
    assert.match(roll.rows[0]!.unreadBecause ?? '', /not yet read/);
    assert.equal(roll.counts.withFeed, STOCK_TOKENS.filter((t) => t.feedKey !== null).length);
  });

  it('renders a read token exactly, with six places for the eye', () => {
    const roll = composeRoll(
      [
        {
          key: `token:${aapl.key}`,
          observedAt: new Date(NOW.getTime() - 60_000).toISOString(),
          payload: { multiplier: '1.000566080061092436', multiplierRaw: '1000566080061092436', pendingRaw: null, supplyRaw: '1500000000000000000000', decimals: 18, unreadBecause: null },
        },
      ],
      NOW,
    );
    const row = roll.rows.find((r) => r.token.ticker === 'AAPL')!;
    assert.equal(row.multiplier, '1.000566');
    assert.equal(row.multiplierExact, '1.000566080061092436');
    assert.equal(row.notAtOne, true);
    assert.equal(row.supply, '1,500');
    assert.equal(row.pending, null);
    assert.equal(roll.counts.read, 1);
    assert.equal(roll.counts.notAtOne, 1);
    assert.equal(roll.sampleState, 'VERIFIED');
  });

  it('shows a pending change and never invents one from a malformed payload', () => {
    const pending = composeRoll(
      [{ key: `token:${aapl.key}`, observedAt: NOW.toISOString(), payload: { multiplier: '1.000000000000000000', multiplierRaw: '1000000000000000000', pendingRaw: '4000000000000000000', pendingEffectiveAt: '2026-09-15T13:30:00.000Z' } }],
      NOW,
    );
    assert.deepEqual(pending.rows.find((r) => r.token.ticker === 'AAPL')!.pending, { shown: '4.000000', effectiveAt: '2026-09-15T13:30:00.000Z' });
    const bad = composeRoll([{ key: `token:${aapl.key}`, observedAt: NOW.toISOString(), payload: { multiplier: 1.5, multiplierRaw: 'lots', pendingRaw: 'soon' } }], NOW);
    const row = bad.rows.find((r) => r.token.ticker === 'AAPL')!;
    assert.equal(row.multiplier, null);
    assert.equal(row.pending, null);
    assert.equal(row.notAtOne, null);
    assert.match(row.unreadBecause ?? '', /could not be read as written/);
  });
});

describe('the markdown renderer', () => {
  it('parses emphasis, code inside bold, and leaves a relative link as text', () => {
    assert.deepEqual(parseInline('see *this* and **`x` bold** then [t](../mainnet/F.md) and 2 * 3 * 4'), [
      { kind: 'text', text: 'see ' },
      { kind: 'em', text: 'this' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', text: '`x` bold', inlines: [{ kind: 'code', text: 'x' }, { kind: 'text', text: ' bold' }] },
      { kind: 'text', text: ' then [t](../mainnet/F.md) and 2 * 3 * 4' },
    ]);
  });

  it('parses a numbered list as an ordered list', () => {
    const blocks = parseMarkdown(['1. **First.** one', '2. second', '   wrapped', '', '- a'].join('\n'));
    assert.deepEqual(blocks.map((b) => b.kind), ['list', 'list']);
    const ordered = blocks[0]!;
    const bullets = blocks[1]!;
    assert.ok(ordered.kind === 'list' && ordered.ordered === true && ordered.items.length === 2);
    assert.ok(bullets.kind === 'list' && bullets.ordered === undefined);
  });

  it('parses inline code and bold, nothing nested', () => {
    assert.deepEqual(parseInline('a `b` **c** d'), [
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'strong', text: 'c' },
      { kind: 'text', text: ' d' },
    ]);
  });

  it('parses headings, paragraphs, lists, tables and indented code', () => {
    const blocks = parseMarkdown(
      ['# T', '', '## One', '', 'Para one', 'continues.', '', '- a', '- b', '  wrapped', '', '| H1 | H2 |', '| --- | --- |', '| `x` | y |', '', '    code line', '', 'tail'].join('\n'),
    );
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ['heading', 'heading', 'paragraph', 'list', 'table', 'code', 'paragraph'],
    );
    const list = blocks[3]!;
    assert.equal(list.kind === 'list' ? list.items.length : 0, 2);
    assert.equal(list.kind === 'list' ? list.items[1]?.[0]?.text : '', 'b wrapped');
    const table = blocks[4]!;
    assert.equal(table.kind === 'table' ? table.rows[0]?.[0]?.[0]?.kind : '', 'code');
    const code = blocks[5]!;
    assert.equal(code.kind === 'code' ? code.text : '', 'code line');
    assert.equal(slugOf('5. The pipeline, and the heartbeat that always runs'), '5-the-pipeline-and-the-heartbeat-that-always-runs');
  });

  it('renders the real DOCTRINE.md without losing a section', () => {
    const source = readFileSync('DOCTRINE.md', 'utf8');
    const blocks = parseMarkdown(source);
    const h2 = blocks.filter((b) => b.kind === 'heading' && b.level === 2).length;
    const expected = source.split('\n').filter((l) => /^## /.test(l)).length;
    assert.equal(h2, expected);
    assert.ok(blocks.some((b) => b.kind === 'table'), 'the three-state table should render as a table');
    assert.ok(blocks.some((b) => b.kind === 'code'), 'the pipeline line should render as code');
  });
});
