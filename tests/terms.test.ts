import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { digestOf, judgePage, visibleText, watchOf, watchSnapshot } from '../lib/terms/watch.ts';
import { describeWatch } from '../lib/agents/producers/counsel.ts';
import { AGENT_BY_ID } from '../lib/agents/registry.ts';
import { TERMS_SOURCES } from '../lib/chain/terms.ts';
import { screen, type DeclaredFigure } from '../lib/doctrine/policy.ts';

const NOW = new Date('2026-09-11T16:00:00.000Z');
const AT = NOW.toISOString();

describe('visibleText', () => {
  it('keeps the main content and drops chrome, scripts and tags', () => {
    const html = '<html><body><nav>Home · Docs</nav><main><h1>Terms</h1><script>var x = 1;</script><p>The  offer &amp; sale are <b>restricted</b>.</p></main><footer>© 2026</footer></body></html>';
    assert.equal(visibleText(html), 'Terms The offer & sale are restricted.');
  });

  it('falls back to the article, then the body, then the whole document', () => {
    assert.equal(visibleText('<body><article><p>A</p></article><aside>B</aside></body>'), 'A');
    assert.equal(visibleText('<body><p>Only body</p></body>'), 'Only body');
    assert.equal(visibleText('bare <i>text</i>'), 'bare text');
  });

  it('hashes the text, not the markup, so a re-render with the same words is the same page', () => {
    const a = digestOf('u', '<main><p>Same words.</p></main>', 200);
    const b = digestOf('u', '<main>\n  <div><span>Same</span> <em>words</em>.</div>\n</main>', 200);
    assert.equal(a.hash, b.hash);
    assert.notEqual(a.hash, digestOf('u', '<main><p>Different words.</p></main>', 200).hash);
  });
});

describe('judgePage', () => {
  const digest = digestOf('u', '<main>v1</main>', 200);

  it('is a first sighting without a prior, and unchanged when the hash holds', () => {
    const first = judgePage(digest, null, AT);
    assert.equal(first.kind, 'FIRST_SEEN');
    assert.equal(first.watch.firstSeenAt, AT);
    assert.equal(first.watch.changes, 0);
    const later = '2026-09-12T16:00:00.000Z';
    const same = judgePage(digest, first.watch, later);
    assert.equal(same.kind, 'UNCHANGED');
    assert.equal(same.watch.lastFetchedAt, later);
    assert.equal(same.watch.firstSeenAt, AT);
  });

  it('records a change with the date and counts it', () => {
    const prior = judgePage(digest, null, AT).watch;
    const changed = judgePage(digestOf('u', '<main>v2</main>', 200), prior, '2026-09-13T16:00:00.000Z');
    assert.equal(changed.kind, 'CHANGED');
    if (changed.kind === 'CHANGED') {
      assert.equal(changed.previousHash, digest.hash);
      assert.equal(changed.watch.lastChangedAt, '2026-09-13T16:00:00.000Z');
      assert.equal(changed.watch.changes, 1);
    }
  });

  it('round-trips through a snapshot and refuses a malformed one', () => {
    const watch = judgePage(digest, null, AT).watch;
    const snap = watchSnapshot('restricted', watch, AT);
    assert.equal(snap.key, 'terms:restricted');
    assert.deepEqual(watchOf(snap), watch);
    assert.equal(watchOf({ key: 'terms:x', observedAt: AT, payload: { hash: 42 } }), null);
    assert.equal(watchOf(undefined), null);
  });
});

describe('the watch lines', () => {
  const restricted = TERMS_SOURCES.find((s) => s.key === 'restricted')!;
  const oracles = TERMS_SOURCES.find((s) => s.key === 'oracles')!;
  const digest = digestOf('u', '<main>v1</main>', 200);

  /** Collects what the lines declare, the way the producer does. */
  function collector() {
    const figures: DeclaredFigure[] = [];
    const declare = (token: string, source: string) => figures.push({ token, source, retrievedAt: AT });
    return { figures, declare };
  }

  it('say why a page could not be fetched, and that unknown is not unchanged', () => {
    const { figures, declare } = collector();
    const line = describeWatch(restricted, null, 'SOURCE_TIMEOUT — 30s', NOW, declare);
    assert.match(line, /could not be fetched .*SOURCE_TIMEOUT/);
    assert.match(line, /not the same as unchanged/);
    assert.deepEqual(figures.map((f) => f.token), ['30']);
  });

  it('flag a changed page whose content was recorded by hand', () => {
    const prior = judgePage(digest, null, '2026-09-01T00:00:00.000Z').watch;
    const changed = judgePage(digestOf('u', '<main>v2</main>', 200), prior, AT);
    const line = describeWatch(oracles, changed, null, NOW, () => {});
    assert.match(line, /CHANGED/);
    assert.match(line, /recorded for this page .* earlier version/);
    const plain = describeWatch(restricted, changed, null, NOW, () => {});
    assert.doesNotMatch(plain, /recorded for this page/);
  });

  it('pass the gate: every age and status code printed is declared', () => {
    // First seen eleven days ago: an age past the ten the gate lets through undeclared.
    const prior = judgePage(digest, null, '2026-08-31T16:00:00.000Z').watch;
    const { figures, declare } = collector();
    const lines = [
      describeWatch(restricted, judgePage(digest, prior, AT), null, NOW, declare),
      describeWatch(oracles, judgePage(digestOf('u', '<main>v2</main>', 200), prior, AT), null, NOW, declare),
      describeWatch(restricted, null, 'SOURCE_UNREACHABLE — HTTP 503', NOW, declare),
    ];
    assert.match(lines[0]!, /11d ago/);
    assert.ok(figures.some((f) => f.token === '11'));
    assert.ok(figures.some((f) => f.token === '503'));
    const verdict = screen({ text: lines.join('\n'), figures, allowedLiterals: [] });
    assert.equal(verdict.decision, 'ALLOW', JSON.stringify(verdict));
    // Without the declarations the same text is blocked — which is the point.
    assert.equal(screen({ text: lines.join('\n'), figures: [], allowedLiterals: [] }).decision, 'BLOCK');
  });

  it('declares in the registry what the producer asks', () => {
    assert.equal(AGENT_BY_ID.counsel.sourcesExpected, 1 + TERMS_SOURCES.length);
  });
});
