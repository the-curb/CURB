import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EVIDENCE_SOURCES, evidenceLatestKey, evidenceVersionKey } from '../lib/positions/evidence.ts';
import { driftKey, positionsJournal } from '../lib/positions/journal.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * The journal is derived from the archive's version rows and the drift rows,
 * by the day they were observed. It is composed from the same rows every
 * time, so a day reads the same tomorrow.
 */
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const H3 = 'c'.repeat(64);

describe('the position product’s journal', () => {
  it('prints a source first archived, a source changed, and an address that moved, by day', async () => {
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-journal-')));
    const xstocks = EVIDENCE_SOURCES.find((s) => s.id === 'xstocks:AAPLx')!;
    const page = EVIDENCE_SOURCES.find((s) => s.kind === 'page')!;
    await store.writeSnapshots([
      { key: evidenceVersionKey(xstocks.id, H1), observedAt: '2026-09-10T03:00:00.000Z', payload: { hash: H1 } },
      { key: evidenceVersionKey(xstocks.id, H2), observedAt: '2026-09-12T03:00:00.000Z', payload: { hash: H2 } },
      { key: evidenceLatestKey(xstocks.id), observedAt: '2026-09-12T03:00:00.000Z', payload: { hash: H2, changedAt: '2026-09-12T03:00:00.000Z' } },
      { key: evidenceVersionKey(page.id, H3), observedAt: '2026-09-12T03:00:05.000Z', payload: { hash: H3 } },
      { key: evidenceVersionKey('page:A:no-longer-watched', H3), observedAt: '2026-09-12T03:00:06.000Z', payload: { hash: H3 } },
      { key: evidenceVersionKey('ondo:AAPLon', H1), observedAt: '2026-09-12T03:00:07.000Z', payload: { hash: H1, status: 'ACCESS_DENIED', httpStatus: 401 } },
      {
        key: driftKey('apple-s1', '2026-09-12T03:01:00.000Z'),
        observedAt: '2026-09-12T03:01:00.000Z',
        payload: {
          seriesId: 'apple-s1',
          chainId: 1,
          network: 'ethereum-mainnet',
          at: '2026-09-12T03:01:00.000Z',
          previousRanAt: '2026-09-11T03:01:00.000Z',
          drift: [{ address: '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f', role: 'WRAPPER_V2', component: 'A', field: 'codeHash', from: '0x11', to: '0x22' }],
        },
      },
    ]);

    const day = await positionsJournal(store, '2026-09-12');
    assert.equal(day.storeFault, null);
    assert.deepEqual(
      day.entries.map((e) => [e.at.slice(11, 19), e.kind, e.component, e.mark]),
      [
        ['03:00:00', 'EVIDENCE_CHANGED', 'A', H2.slice(0, 8)],
        ['03:00:05', 'EVIDENCE_ARCHIVED', page.component, H3.slice(0, 8)],
        ['03:00:07', 'EVIDENCE_ARCHIVED', 'B', H1.slice(0, 8)],
        ['03:01:00', 'DRIFT', 'A', 'codeHash'],
      ],
      'the change, the first archive of a page, the refused source, the drift — in the order they happened; the unwatched source leaves nothing',
    );
    assert.ok(day.entries[0]!.detail.includes(H1.slice(0, 8)), 'the change names the version it replaced');
    assert.equal(day.entries[0]!.subject, xstocks.title);
    assert.ok(day.entries[2]!.detail.includes('access denied (HTTP 401); the refusal is kept, not the record'), 'a refusal is archived as a refusal');
    assert.ok(day.entries[3]!.detail.includes('2026-09-11T03:01'), 'the drift names the run it is measured against');

    const earlier = await positionsJournal(store, '2026-09-10');
    assert.deepEqual(
      earlier.entries.map((e) => [e.kind, e.mark]),
      [['EVIDENCE_ARCHIVED', H1.slice(0, 8)]],
      'the first body is the first archive, on its own day',
    );
    const empty = await positionsJournal(store, '2026-09-11');
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.storeFault, null);
    await store.close();
  });
});

describe('a reconciliation finding that moved', () => {
  it('is journalled once, on the day it moved, and printed as such', async () => {
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-journal-')));
    const { findingKey } = await import('../lib/positions/reconcile.ts');
    await store.writeSnapshots([
      {
        key: findingKey('apple-s1', '2026-09-12T04:00:00.000Z'),
        observedAt: '2026-09-12T04:00:00.000Z',
        payload: { seriesId: 'apple-s1', chainId: 31337, at: '2026-09-12T04:00:00.000Z', asOfBlock: 93, moved: [{ component: 'A', from: 'MATCHED', to: 'SHORTFALL' }] },
      },
    ]);
    const day = await positionsJournal(store, '2026-09-12');
    assert.deepEqual(
      day.entries.map((e) => [e.kind, e.component, e.mark, e.subject]),
      [['FINDING', 'A', 'SHORTFALL', 'reconciliation of A']],
    );
    assert.match(day.entries[0]!.detail, /from MATCHED to SHORTFALL as of block 93/);
    assert.match(day.entries[0]!.detail, /not an audit/);
    assert.deepEqual((await positionsJournal(store, '2026-09-13')).entries, []);
    await store.close();
  });
});
