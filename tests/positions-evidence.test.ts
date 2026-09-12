import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { archiveEvidence, canonicalHash, EVIDENCE_SOURCES, evidenceLatestKey, latestEvidence, versionCount } from '../lib/positions/evidence.ts';
import { parseXstocksAsset, sha256Hex } from '../lib/positions/issuers.ts';
import { FileSystemStore } from '../lib/store/fs.ts';

/**
 * The archive versions a record by its identity — the parsed fields in
 * canonical order — not by the bytes of a body that carries the trading
 * session beside them and lists its deployments in whatever order the
 * server chose that day. Seen live on 2026-09-12: the same record, two
 * bodies, 123 fields "different", none the series reads.
 */
describe('the identity of an issuer record', () => {
  const raw = readFileSync(new URL('./fixtures/xstocks-aaplx.json', import.meta.url), 'utf8');
  const body = JSON.parse(raw) as { deployments: unknown[]; trading: Record<string, unknown>; [k: string]: unknown };
  const hashOf = (b: unknown) => {
    const p = parseXstocksAsset(JSON.stringify(b));
    assert.ok(p.ok);
    return p.ok ? canonicalHash(p.asset) : '';
  };

  it('does not move when the trading session moves or the deployments are reordered', () => {
    const base = hashOf(body);
    const sessionMoved = { ...body, trading: { ...body.trading, currentPeriod: 'closed', openNow: false, nextChangeAt: '2026-09-14T00:00:00.000Z' } };
    const reordered = { ...body, deployments: [...body.deployments].reverse() };
    assert.equal(hashOf(sessionMoved), base);
    assert.equal(hashOf(reordered), base);
    assert.notEqual(base, sha256Hex(raw), 'the identity is not the hash of the bytes');
  });

  it('moves when a field the series reads moves', () => {
    const base = hashOf(body);
    const deployments = body.deployments as Record<string, unknown>[];
    const eth = deployments.findIndex((d) => d.network === 'Ethereum');
    assert.ok(eth >= 0);
    const wrapperMoved = { ...body, deployments: deployments.map((d, i) => (i === eth ? { ...d, wrapperAddressV2: '0x000000000000000000000000000000000000dEaD' } : d)) };
    const halted = { ...body, isTradingHalted: true };
    const isinMoved = { ...body, underlyingIsin: 'US0000000000' };
    assert.notEqual(hashOf(wrapperMoved), base);
    assert.notEqual(hashOf(halted), base);
    assert.notEqual(hashOf(isinMoved), base);
  });
});

describe('the archive, across the change to canonical identities', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const raw = readFileSync(new URL('./fixtures/xstocks-aaplx.json', import.meta.url), 'utf8');
  const body = JSON.parse(raw) as { deployments: Record<string, unknown>[]; trading: Record<string, unknown>; [k: string]: unknown };
  const xstocks = EVIDENCE_SOURCES.find((s) => s.id === 'xstocks:AAPLx')!;
  const serve = (text: string) => {
    globalThis.fetch = (async () => new Response(text, { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;
  };

  it('does not archive the same record again when only its bytes moved, and does when a wrapper moves', async () => {
    const store = new FileSystemStore(mkdtempSync(path.join(tmpdir(), 'curb-archive-')));
    const parsed = parseXstocksAsset(raw);
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    // A latest written before identities were canonical: the hash of its bytes, no rawHash.
    await store.writeSnapshots([
      {
        key: evidenceLatestKey(xstocks.id),
        observedAt: '2026-09-11T22:53:51.983Z',
        payload: { sourceId: xstocks.id, kind: xstocks.kind, url: xstocks.url, readAt: '2026-09-11T22:53:51.983Z', status: 'OK', httpStatus: 200, hash: sha256Hex(raw), raw, parse: 'PARSED', parsed: parsed.asset, detail: null, previousHash: null, changedAt: null, firstSeenAt: '2026-09-11T22:53:51.983Z' },
      },
    ]);

    serve(JSON.stringify({ ...body, trading: { ...body.trading, currentPeriod: 'closed', openNow: false }, deployments: [...body.deployments].reverse() }));
    const [same] = await archiveEvidence(store, new Date('2026-09-12T00:20:49.415Z'), [xstocks]);
    assert.equal(same!.version, 'SAME', 'the record is the one on file; the bytes are not the record');
    assert.equal(same!.hash, canonicalHash(parsed.asset));
    let latest = (await latestEvidence(store, [xstocks]))[0]!.observation!;
    assert.equal(latest.changedAt, null, 'nothing changed, so no change is dated');
    assert.equal(latest.hash, canonicalHash(parsed.asset), 'the latest now carries the canonical identity');
    assert.equal(latest.rawHash, sha256Hex(JSON.stringify({ ...body, trading: { ...body.trading, currentPeriod: 'closed', openNow: false }, deployments: [...body.deployments].reverse() })));
    assert.equal(await versionCount(store, xstocks.id), 0, 'no version row was written for the same record');

    const eth = body.deployments.findIndex((d) => d.network === 'Ethereum');
    serve(JSON.stringify({ ...body, deployments: body.deployments.map((d, i) => (i === eth ? { ...d, wrapperAddressV2: '0x000000000000000000000000000000000000dEaD' } : d)) }));
    const [moved] = await archiveEvidence(store, new Date('2026-09-13T00:20:00.000Z'), [xstocks]);
    assert.equal(moved!.version, 'NEW');
    latest = (await latestEvidence(store, [xstocks]))[0]!.observation!;
    assert.equal(latest.changedAt, '2026-09-13T00:20:00.000Z');
    assert.equal(latest.previousHash, canonicalHash(parsed.asset), 'the change names the identity it replaced');
    assert.equal(await versionCount(store, xstocks.id), 1);
    await store.close();
  });
});
