import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { diffFeeds, diffTokens } from '../lib/chain/capture-drift.ts';
import { deriveConditions } from '../lib/ops/alerts.ts';
import { STOCK_TOKENS } from '../lib/chain/stock-tokens.ts';
import { FEED_DIRECTORY } from '../lib/chain/feed-directory.ts';
import { AGENT_BY_ID } from '../lib/agents/registry.ts';

/**
 * The drift check is arithmetic over two lists: what the source lists today
 * against what the capture holds. Tested with the real capture on one side
 * and a scripted "today" on the other.
 */

const NOW = new Date('2026-09-12T10:00:00.000Z');
const listedTokens = STOCK_TOKENS.map((t) => ({ id: t.registryId, ticker: t.ticker, address: t.address }));
const listedFeeds = FEED_DIRECTORY.map((f) => ({ name: f.name, proxy: f.proxy }));

describe('diffTokens', () => {
  it('reports the same set as clean', () => {
    const d = diffTokens(listedTokens);
    assert.equal(d.listed, STOCK_TOKENS.length);
    assert.equal(d.captured, STOCK_TOKENS.length);
    assert.deepEqual([d.added, d.removed, d.moved], [[], [], []]);
  });

  it('names what was added, removed and moved, joined by registry id and not by ticker', () => {
    const [first, second] = listedTokens;
    const today = [
      ...listedTokens.slice(2),
      // second keeps its id but sits at a new contract: moved, not removed.
      { ...second!, address: '0x000000000000000000000000000000000000beef' },
      { id: '0xnew', ticker: 'NEWCO', address: '0x000000000000000000000000000000000000cafe' },
    ];
    const d = diffTokens(today);
    assert.deepEqual(d.added.map((t) => t.ticker), ['NEWCO']);
    assert.deepEqual(d.removed.map((t) => t.ticker), [first!.ticker]);
    assert.deepEqual(d.moved.map((t) => t.ticker), [second!.ticker]);
    assert.equal(d.moved[0]!.listed, '0x000000000000000000000000000000000000beef');
  });

  it('compares addresses and ids without regard to case', () => {
    const shouted = listedTokens.map((t) => ({ ...t, id: t.id.toUpperCase(), address: t.address.toUpperCase() }));
    const d = diffTokens(shouted);
    assert.deepEqual([d.added, d.removed, d.moved], [[], [], []]);
  });
});

describe('diffFeeds', () => {
  it('reports the same set as clean and names additions and removals by proxy', () => {
    assert.deepEqual(diffFeeds(listedFeeds).added, []);
    const today = [...listedFeeds.slice(1), { name: 'Robinhood NEWCO / USD', proxy: '0x000000000000000000000000000000000000f00d' }];
    const d = diffFeeds(today);
    assert.deepEqual(d.added.map((f) => f.name), ['Robinhood NEWCO / USD']);
    assert.deepEqual(d.removed.map((f) => f.name), [listedFeeds[0]!.name]);
  });
});

describe('drift as a condition', () => {
  const base = { heartbeats: [], feedSnapshots: [], lastRegistrar: null, now: NOW };
  const snap = (payload: Record<string, unknown>) => ({ key: 'capture:drift', observedAt: NOW.toISOString(), payload });

  it('is silent on a clean check and speaks on each kind of drift', () => {
    assert.deepEqual(deriveConditions({ ...base, driftSnapshot: snap({ tokensAdded: [], tokensRemoved: [], tokensMoved: [], feedsAdded: [], feedsRemoved: [] }) }), []);
    const ids = deriveConditions({ ...base, driftSnapshot: snap({ tokensAdded: ['NEWCO'], tokensMoved: ['AAPL'], feedsRemoved: ['x'] }) }).map((c) => c.id);
    assert.deepEqual(ids, ['capture:feeds:DRIFT', 'capture:tokens:DRIFT', 'capture:tokens:MOVED']);
  });

  it('treats a malformed payload as no drift, not as drift', () => {
    assert.deepEqual(deriveConditions({ ...base, driftSnapshot: snap({ tokensAdded: 'NEWCO', tokensMoved: 3 }) }), []);
  });

  it('is declared in the Registrar’s sources', () => {
    assert.equal(AGENT_BY_ID.registrar.sourcesExpected, 7);
  });
});
