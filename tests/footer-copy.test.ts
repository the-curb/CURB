import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { FOOTER, footerLine, footerSentences } from '../lib/copy/footer.ts';
import { AGENT_COUNTS } from '../lib/agents/registry.ts';
import { PROMISES } from '../lib/positions/series.ts';
import { screen } from '../lib/doctrine/policy.ts';

/**
 * The footer sits under every page. It opened on the thesis of a product that
 * is not live and ran 317 words, averaging 22 a sentence, with the longest at
 * 52; on a phone it was more than two screens tall. These tests keep it short,
 * keep it on what the desk does today, and keep it honest.
 */

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

describe('the footer is short', () => {
  it('keeps every sentence to twenty words or fewer', () => {
    const long = footerSentences().filter((s) => words(s) > 20);
    assert.deepEqual(long, [], long.map((s) => `(${words(s)}) ${s}`).join(' | '));
  });

  it('says what it says in under a hundred words', () => {
    const total = footerSentences().map(words).reduce((a, b) => a + b, 0);
    assert.ok(total < 100, `${total} words`);
  });
});

describe('the footer is honest', () => {
  it('counts the agents from the roster, not by hand', () => {
    assert.match(footerLine(FOOTER.about, AGENT_COUNTS.total), new RegExp(`\\b${AGENT_COUNTS.total} agents\\b`));
  });

  it('says the position is not live and the token gives a holder nothing', () => {
    const text = FOOTER.facts.join(' ');
    assert.match(text, /position product is not live/i);
    assert.match(text, /no share of fees/i);
    assert.match(text, /no buyback/i);
  });

  it('never says any of the claims the positions thesis refuses', () => {
    const text = footerSentences().join(' ').toLowerCase();
    for (const claim of PROMISES.unsupported) assert.equal(text.includes(claim.toLowerCase().replace(/\.$/, '')), false, `says: ${claim}`);
    for (const word of [/\bprotected\b/, /\bguarantee/, /\bsafe(r|ly)?\b/, /\bfirst of its kind\b/]) assert.equal(word.test(text), false, `matches ${word}`);
  });

  it('passes the same claim gates a publication would', () => {
    const verdict = screen({ text: footerSentences().join(' '), figures: [] });
    const breaches = verdict.decision === 'ALLOW' ? [] : verdict.breaches.filter((b) => b.rule !== 'UNSOURCED_FIGURE');
    assert.deepEqual(breaches, [], breaches.map((b) => `${b.rule}: ${b.matched}`).join(' | '));
  });
});

describe('the footer component', () => {
  const footer = readFileSync(new URL('../app/components/site-footer.tsx', import.meta.url), 'utf8');

  it('reads its words from the copy module', () => {
    assert.match(footer, /from '@\/lib\/copy\/footer'/);
  });

  it('no longer leads with the thesis of a product that is not live', () => {
    assert.equal(footer.includes('One position'), false);
    assert.equal(footer.includes('BRAND.thesis'), false);
    assert.equal(footer.includes('BRAND.stage'), false);
  });

  it('keeps every destination', () => {
    const hrefs = FOOTER.links.map(([, href]) => href);
    for (const href of ['/guide', '/floor', '/registry', '/vault', '/chambers', '/gazette', '/services', '/positions', '/mechanism', '/doctrine', '/agents', '/api/state']) {
      assert.ok(hrefs.includes(href), href);
    }
    assert.match(footer, /BRAND\.links\.github/);
    assert.match(footer, /BRAND\.links\.x\b/);
  });
});
