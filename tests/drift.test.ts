import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { diffFeeds, diffPools, diffTokens } from '../lib/chain/capture-drift.ts';
import { DEFAULT_KINDS, deriveConditions, kindOf } from '../lib/ops/alerts.ts';
import { STOCK_TOKENS } from '../lib/chain/stock-tokens.ts';
import { STOCK_POOLS } from '../lib/chain/stock-pools.ts';
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
    assert.equal(AGENT_BY_ID.registrar.sourcesExpected, 8);
  });
});

describe('the pool book against the venues', () => {
  const asDiscovered = (p: { key: string; ticker: string; venue: string }) => p;
  const book = STOCK_POOLS.map((p) => asDiscovered({ key: p.key, ticker: p.ticker, venue: p.venue }));

  it('finds nothing when the venues still hold exactly the captured book', () => {
    const drift = diffPools(book);
    assert.equal(drift.discovered, STOCK_POOLS.length);
    assert.equal(drift.captured, STOCK_POOLS.length);
    assert.deepEqual(drift.added, []);
    assert.deepEqual(drift.removed, []);
    assert.deepEqual(drift.tickersGained, []);
  });

  it('names a pool that opened since the capture, which the Specialist does not read', () => {
    const drift = diffPools([...book, asDiscovered({ key: 'nvda-usdg-v3-3000-new', ticker: 'NVDA', venue: 'v3' })]);
    assert.equal(drift.added.length, 1);
    assert.equal(drift.added[0]!.key, 'nvda-usdg-v3-3000-new');
    assert.deepEqual(drift.removed, []);
    // NVDA already had pools, so this is a deeper book, not a new ticker.
    assert.deepEqual(drift.tickersGained, []);
  });

  it('separates a ticker that gained its first pool from one that merely gained another', () => {
    const fresh = diffPools([...book, asDiscovered({ key: 'zzzz-usdg-v3-500', ticker: 'ZZZZ', venue: 'v3' })]);
    assert.deepEqual(fresh.tickersGained, ['ZZZZ']);
  });

  it('names a pool the factories no longer admit to, which is still probed every run', () => {
    const drift = diffPools(book.slice(1));
    assert.equal(drift.removed.length, 1);
    assert.equal(drift.removed[0]!.key, STOCK_POOLS[0]!.key);
    assert.deepEqual(drift.added, []);
  });

  it('reports a book read as empty as every pool gone, never as agreement', () => {
    const drift = diffPools([]);
    assert.equal(drift.discovered, 0);
    assert.equal(drift.removed.length, STOCK_POOLS.length);
  });

  it('raises a note, not a darkness: the figures published from the old book are still right', () => {
    const conditions = deriveConditions({
      heartbeats: [],
      feedSnapshots: [],
      lastRegistrar: null,
      driftSnapshot: {
        key: 'capture:drift',
        observedAt: NOW.toISOString(),
        payload: { poolsAdded: ['nvda-usdg-v3-3000-new'], poolsRemoved: [], poolTickersGained: ['ZZZZ'] },
      },
      now: NOW,
    });
    const pools = conditions.find((c) => c.id === 'capture:pools:DRIFT');
    assert.ok(pools, conditions.map((c) => c.id).join());
    assert.equal(pools.severity, 'NOTE');
    assert.match(pools.text, /1 open and not captured/);
    assert.match(pools.text, /a first pool for ZZZZ/);
    assert.match(pools.text, /capture-stock-pools\.ts --write/);
  });

  it('says nothing while the book and the venues agree', () => {
    const conditions = deriveConditions({
      heartbeats: [],
      feedSnapshots: [],
      lastRegistrar: null,
      driftSnapshot: { key: 'capture:drift', observedAt: NOW.toISOString(), payload: { poolsAdded: [], poolsRemoved: [], poolTickersGained: [] } },
      now: NOW,
    });
    assert.equal(conditions.some((c) => c.id === 'capture:pools:DRIFT'), false);
  });

  it('is the issuer’s kind, so a holder is told without asking for the plumbing', () => {
    assert.equal(kindOf('capture:pools:DRIFT'), 'issuer');
    assert.ok(DEFAULT_KINDS.includes('issuer'));
  });
});
