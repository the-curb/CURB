import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { REGISTRY, registrySentences } from '../lib/copy/registry.ts';
import { VAULT, vaultSentences } from '../lib/copy/vault.ts';
import { parseActive } from '../lib/vault/active.ts';
import { PROMISES } from '../lib/positions/series.ts';
import { screen } from '../lib/doctrine/policy.ts';

/**
 * The Registry ran twelve and a half screens and opened on "one beacon behind
 * all of them" before the table a reader came for. The Vault explained itself
 * in a 50-word sentence about block ranges and log limits. These tests keep
 * both short and plain, and keep plain words from saying what the desk would
 * not.
 */

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

for (const [page, headline, sentences] of [
  ['the Registry', REGISTRY.headline, registrySentences],
  ['the Vault', VAULT.headline, vaultSentences],
] as const) {
  describe(`${page} is short and honest`, () => {
    it('says what the page is in under fifteen words', () => {
      assert.ok(words(headline) < 15, headline);
    });

    it('keeps every sentence to twenty words or fewer', () => {
      const long = sentences().filter((s) => words(s) > 20);
      assert.deepEqual(long, [], long.map((s) => `(${words(s)}) ${s}`).join(' | '));
    });

    it('averages a sentence a reader can take in at once', () => {
      const lens = sentences().map(words);
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      assert.ok(avg <= 13, `average ${avg.toFixed(1)} words`);
    });

    it('never says any of the claims the positions thesis refuses', () => {
      const text = [headline, ...sentences()].join(' ').toLowerCase();
      for (const claim of PROMISES.unsupported) assert.equal(text.includes(claim.toLowerCase().replace(/\.$/, '')), false, `says: ${claim}`);
      for (const word of [/\bprotected\b/, /\bguarantee/, /\bsafe(r|ly)?\b/, /\bfirst of its kind\b/, /\bown(s|ership)? (the |a )?shares?\b/]) assert.equal(word.test(text), false, `matches ${word}`);
    });

    it('passes the same claim gates a publication would', () => {
      const verdict = screen({ text: [headline, ...sentences()].join(' '), figures: [] });
      const breaches = verdict.decision === 'ALLOW' ? [] : verdict.breaches.filter((b) => b.rule !== 'UNSOURCED_FIGURE');
      assert.deepEqual(breaches, [], breaches.map((b) => `${b.rule}: ${b.matched}`).join(' | '));
    });
  });
}

describe('the Registry', () => {
  const page = readFileSync(new URL('../app/registry/page.tsx', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../app/components/registry-table.tsx', import.meta.url), 'utf8');

  it('reads its words from the copy module', () => {
    assert.match(page, /from '@\/lib\/copy\/registry'/);
    assert.match(table, /from '@\/lib\/copy\/registry'/);
  });

  it('opens on the table, before the beacon and the capture check', () => {
    const at = page.indexOf('<RegistryTable');
    assert.ok(at > 0);
    assert.ok(at < page.indexOf('REGISTRY.beacon.kicker'));
    assert.ok(at < page.indexOf('REGISTRY.capture.kicker'));
  });

  it('names its columns in words a newcomer knows', () => {
    const insider = /beacon|multiplier|uiMultiplier|feed\b|snapshot|oracle|sampled/i;
    for (const [key, label] of Object.entries(REGISTRY.table.columns)) assert.equal(insider.test(label), false, `${key}: "${label}"`);
  });

  it('keeps every token reachable: a search, filters and a way to show them all', () => {
    assert.match(table, /type="search"/);
    assert.match(table, /T\.showAll/);
    assert.match(table, /narrowed \|\| expanded \? matches/);
  });

  it('still says a token is not always one share', () => {
    assert.match(REGISTRY.why, /not always one share/i);
    assert.match(REGISTRY.whyMore, /only when this figure is 1/i);
  });

  it('still shows the reason when the readings cannot be loaded', () => {
    assert.match(page, /\{REGISTRY\.unreadStore\}[\s\S]{0,80}\{rollFault\}/);
  });
});

describe('the Vault', () => {
  const page = readFileSync(new URL('../app/vault/page.tsx', import.meta.url), 'utf8');

  it('reads its words from the copy module', () => {
    assert.match(page, /from '@\/lib\/copy\/vault'/);
  });

  it('still says each figure is a rate, not a total', () => {
    assert.match(VAULT.why, /a rate, not a total/i);
  });

  it('still says it does not rank holders', () => {
    assert.match(VAULT.notMeasured, /does not try/i);
  });

  it('prints the filing as written when it cannot read it back', () => {
    assert.match(page, /active === null \?[\s\S]{0,200}mostActive\.replace/);
  });
});

describe('the most-active line, read back into rows', () => {
  const line =
    "— Stock tokens: 953 transfers in the sample, 1121.2 a minute, across 27 of the 194 tokens in the issuer's registry; 167 did not move. Most active: NVDA 338 (31 sending, 29 receiving), USO 97 (13 sending, 14 receiving), BRK.B 5 (2 sending, 3 receiving).";

  it('reads the summary and every named token', () => {
    const a = parseActive(line)!;
    assert.deepEqual({ transfers: a.transfers, moved: a.moved, total: a.total, still: a.still }, { transfers: 953, moved: 27, total: 194, still: 167 });
    assert.deepEqual(a.top, [
      { ticker: 'NVDA', transfers: 338, senders: 31, receivers: 29 },
      { ticker: 'USO', transfers: 97, senders: 13, receivers: 14 },
      { ticker: 'BRK.B', transfers: 5, senders: 2, receivers: 3 },
    ]);
  });

  it('reads a line with no per-minute rate', () => {
    const a = parseActive("— Stock tokens: 10 transfers in the sample, across 2 of the 194 tokens in the issuer's registry; 192 did not move. Most active: AAPL 6 (2 sending, 2 receiving).")!;
    assert.equal(a.moved, 2);
    assert.equal(a.top.length, 1);
  });

  it('returns nothing for a line it cannot read, so the page prints the filing as written', () => {
    assert.equal(parseActive("— Stock tokens: none of the 194 tokens in the issuer's registry moved in the sample."), null);
    assert.equal(parseActive('— Stock tokens: no page of the sample was answered, so nothing is said about them.'), null);
  });
});
