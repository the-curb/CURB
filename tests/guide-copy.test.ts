import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { GUIDE, guideSentences } from '../lib/copy/guide.ts';
import { PROMISES } from '../lib/positions/series.ts';
import { screen } from '../lib/doctrine/policy.ts';

/**
 * The guide had the longest sentences on the site — an average of 38 words —
 * and, after the desk went free, a services section that still walked a reader
 * through a US$20 minimum, a wallet top-up and US$0.10 a delivery. These tests
 * keep it short, keep it honest, and keep it from describing a price the desk
 * does not charge.
 */

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const everything = () => [GUIDE.headline, ...guideSentences()].join(' ');

describe('the guide is short', () => {
  it('keeps every sentence to twenty words or fewer', () => {
    const long = guideSentences().filter((s) => words(s) > 20);
    assert.deepEqual(long, [], long.map((s) => `(${words(s)}) ${s}`).join(' | '));
  });

  it('averages a sentence a reader can take in at once', () => {
    const lens = guideSentences().map(words);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    assert.ok(avg <= 12, `average ${avg.toFixed(1)} words`);
  });

  it('keeps each step to a few short lines', () => {
    for (const section of [GUIDE.read, GUIDE.alerts, GUIDE.api, GUIDE.position]) {
      for (const step of section.steps) assert.ok(step.body.length <= 3, `${step.title} has ${step.body.length} lines`);
    }
  });
});

describe('the guide describes the desk that is running', () => {
  it('names no price on the path a reader takes', () => {
    const freePath = [GUIDE.sub, GUIDE.alerts.lede, ...GUIDE.alerts.steps.flatMap((s) => s.body)].join(' ');
    assert.equal(/US\$|\$\d|cents?\b|top.?up|minimum|refund|prepaid|per delivery/i.test(freePath), false, freePath);
  });

  it('keeps a line for the paid mode, so the page can say so if the mode changes', () => {
    assert.match(GUIDE.alerts.paid, /paid/i);
  });

  it('says the desk does not use the payment machinery today', () => {
    assert.match(GUIDE.token.ladder, /does not use it today/i);
  });

  it('says a holder of the token gets nothing for holding it', () => {
    assert.match(GUIDE.token.holders, /no share of fees/i);
    assert.match(GUIDE.token.holders, /no buyback/i);
  });

  it('says the position is not live', () => {
    assert.match(GUIDE.position.lede, /not live/i);
  });
});

describe('the guide is honest in plain words', () => {
  it('never says any of the claims the positions thesis refuses', () => {
    const text = everything().toLowerCase();
    for (const claim of PROMISES.unsupported) assert.equal(text.includes(claim.toLowerCase().replace(/\.$/, '')), false, `says: ${claim}`);
    for (const word of [/\bprotected\b/, /\bguarantee/, /\bsafe(r|ly)?\b/, /\bfirst of its kind\b/, /\bown(s|ership)? (the |a )?shares?\b/, /\bnothing is charged,? ever\b/]) {
      assert.equal(word.test(text), false, `matches ${word}`);
    }
  });

  it('passes the same claim gates a publication would', () => {
    const verdict = screen({ text: everything(), figures: [] });
    const breaches = verdict.decision === 'ALLOW' ? [] : verdict.breaches.filter((b) => b.rule !== 'UNSOURCED_FIGURE');
    assert.deepEqual(breaches, [], breaches.map((b) => `${b.rule}: ${b.matched}`).join(' | '));
  });
});

describe('the guide page', () => {
  const page = readFileSync(new URL('../app/guide/page.tsx', import.meta.url), 'utf8');

  it('reads its words from the copy module', () => {
    assert.match(page, /from '@\/lib\/copy\/guide'/);
  });

  it('reads the access mode the guard reads, not a configuration of its own', () => {
    assert.match(page, /from '@\/lib\/credits\/access'/);
    assert.match(page, /isFree\(\)/);
    assert.equal(/MINIMUM_OPEN_CENTS|confirmationsFor|topUp\(keyHash/.test(page), false, 'the paid walkthrough is still on the page');
  });

  it('dates its Gazette example today, not on a day that has passed', () => {
    assert.equal(page.includes('2026-09-17'), false);
    assert.match(page, /api\/gazette\/\$\{today\}/);
  });
});
