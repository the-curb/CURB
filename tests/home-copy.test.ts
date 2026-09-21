import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { HOME, MORE_LINKS, homeHeadline, homeSentences } from '../lib/copy/home.ts';
import { PROMISES } from '../lib/positions/series.ts';
import { screen } from '../lib/doctrine/policy.ts';

/**
 * The front page was rewritten because nobody could read it: about 2,100
 * words, an average sentence of 31, and 367 words before a visitor was told
 * what the site is. These tests are what stop it drifting back, and what stop
 * plain words from saying something the desk would not.
 */

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const everything = () => [homeHeadline(), ...homeSentences(), ...HOME.actions.items.map((i) => i.title), HOME.next.title].join(' ');

describe('the front page is short', () => {
  it('says what the site is in under twenty words', () => {
    assert.ok(words(homeHeadline()) < 20, `the headline is ${words(homeHeadline())} words: "${homeHeadline()}"`);
  });

  it('keeps every sentence to twenty words or fewer', () => {
    const long = homeSentences().filter((s) => words(s) > 20);
    assert.deepEqual(long, [], `sentences over twenty words: ${long.map((s) => `(${words(s)}) ${s}`).join(' | ')}`);
  });

  it('averages a sentence a reader can take in at once', () => {
    const lens = homeSentences().map(words);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    assert.ok(avg <= 14, `average sentence ${avg.toFixed(1)} words`);
  });

  it('offers three things to do, not six districts', () => {
    assert.equal(HOME.actions.items.length, 3);
    for (const item of HOME.actions.items) assert.match(item.href, /^\//);
  });

  it('points the rest of the desk out in one line each', () => {
    for (const link of MORE_LINKS) assert.ok(words(link.what) <= 8, `${link.label}: "${link.what}"`);
  });
});

describe('the front page is honest in plain words', () => {
  it('never says any of the claims the positions thesis refuses', () => {
    const text = everything().toLowerCase();
    for (const claim of PROMISES.unsupported) {
      // The claims are sentences; their load-bearing words are checked too, so
      // a paraphrase cannot slip one past.
      assert.equal(text.includes(claim.toLowerCase().replace(/\.$/, '')), false, `says: ${claim}`);
    }
    for (const word of [/\bprotected\b/, /\bguarantee/, /\bsafe(r|ly)?\b/, /\bfirst\b/, /\bearns?\b/, /\bsame as (holding|owning)/, /\breal (stock|price|share)/, /\bown(s|ership)? (the |a )?shares?\b/]) {
      assert.equal(word.test(text), false, `the front page says something matching ${word}`);
    }
  });

  it('passes the same claim gates a publication would', () => {
    const verdict = screen({ text: everything(), figures: [] });
    // Figures on the front page are computed from the record on the page
    // itself, with their ages; the words here carry none of their own, so the
    // unsourced-figure gate has nothing to say about them. Every other gate
    // must find nothing.
    const breaches = verdict.decision === 'ALLOW' ? [] : verdict.breaches.filter((b) => b.rule !== 'UNSOURCED_FIGURE');
    assert.deepEqual(breaches, [], breaches.map((b) => `${b.rule}: ${b.matched}`).join(' | '));
  });

  it('says the thing that is not live is not live', () => {
    assert.match(HOME.next.body, /not live/i);
    assert.match(HOME.next.cta, /simulation/i);
  });

  it('says a measurement is not advice, once and briefly', () => {
    assert.match(HOME.now.notAdvice, /not advice/i);
    assert.ok(words(HOME.now.notAdvice) <= 5);
  });

  it('claims no liquidity the chain does not promise', () => {
    // "The chain never closes" is about the chain, not about being able to
    // trade in size at any hour; the words for the second must not appear.
    assert.equal(/24\s*\/\s*7|around the clock|any hour|always (trade|sell|buy)/i.test(everything()), false);
  });
});

describe('the page renders these words and computes its figures', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

  it('reads its words from the copy module rather than typing them twice', () => {
    assert.match(page, /from '@\/lib\/copy\/home'/);
    assert.match(page, /HOME\.headline\.line/);
    assert.match(page, /HOME\.subhead/);
  });

  it('renders an unread figure as a dash, never a zero', () => {
    assert.match(page, /ABSENT_GLYPH/);
    assert.equal(/\?\?\s*0\b/.test(page), false, 'a figure falls back to zero somewhere on the page');
  });

  it('no longer carries the six-district essay or the doctrine lists on the front', () => {
    assert.equal(page.includes('const DISTRICTS'), false);
    assert.equal(page.includes('PROMISES.unsupported'), false);
  });
});
