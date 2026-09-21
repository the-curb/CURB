import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { SERVICES_COPY, bandText, fill, servicesSentences } from '../lib/copy/services.ts';
import { SERVICES } from '../lib/credits/prices.ts';
import { DEFAULT_KINDS } from '../lib/ops/alerts.ts';
import { PROMISES } from '../lib/positions/series.ts';
import { screen } from '../lib/doctrine/policy.ts';

/**
 * The services page told a reader "free" in its headline and "paid" a dozen
 * times below it: a price list first, a US$20 opening minimum, a top-up
 * walkthrough, and a footnote naming which endpoints were charged. It measured
 * 1,817 words with a 19-word average sentence, and the alerts — the one thing
 * that needs a key — started three and a half screens down. These tests keep
 * it short, keep the free path free of prices, and keep the payment machinery
 * folded rather than in the reading path.
 */

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const everything = () => [SERVICES_COPY.headline.FREE, SERVICES_COPY.headline.PAID, SERVICES_COPY.sub.PAID, ...servicesSentences()].join(' ');

describe('the services page is short', () => {
  it('says what the page is in a few words', () => {
    assert.ok(words(SERVICES_COPY.headline.FREE) <= 8, SERVICES_COPY.headline.FREE);
    assert.ok(words(SERVICES_COPY.sub.FREE) <= 20, SERVICES_COPY.sub.FREE);
  });

  it('keeps every sentence to twenty words or fewer', () => {
    const long = servicesSentences().filter((s) => words(s) > 20);
    assert.deepEqual(long, [], long.map((s) => `(${words(s)}) ${s}`).join(' | '));
  });

  it('averages a sentence a reader can take in at once', () => {
    const lens = servicesSentences().map(words);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    assert.ok(avg <= 12, `average ${avg.toFixed(1)} words`);
  });

  it('describes every service and every alert kind in one plain line', () => {
    for (const s of SERVICES) assert.ok(words(SERVICES_COPY.use.services[s.id]) <= 14, s.id);
    for (const line of Object.values(SERVICES_COPY.alerts.kinds)) assert.ok(words(line) <= 18, line);
  });
});

describe('the services page describes the desk that is running', () => {
  it('names no price in the free path', () => {
    const c = SERVICES_COPY;
    const freePath = [c.headline.FREE, c.sub.FREE, c.use.open.what, ...Object.values(c.use.services), c.alerts.headline, ...c.alerts.steps.map((s) => s.body), c.alerts.free, c.alerts.key.copy, c.alerts.key.server].join(' ');
    assert.equal(/US\$|\$\d|cents?\b|top.?up|minimum|refund|prepaid|per delivery|per call/i.test(freePath), false, freePath);
  });

  it('keeps a line for the paid mode, so the page can say so if the mode changes', () => {
    assert.match(SERVICES_COPY.headline.PAID, /paid/i);
    assert.match(SERVICES_COPY.alerts.paid, /paid/i);
  });

  it('labels the machinery as switched off while the desk is free', () => {
    assert.match(SERVICES_COPY.machinery.summary.FREE, /switched off while the desk is free/i);
    assert.match(SERVICES_COPY.use.recordNote, /no endpoint reads them/i);
  });

  it('says a holder of the token gets nothing for holding it', () => {
    assert.match(SERVICES_COPY.token.holders, /no share of fees/i);
    assert.match(SERVICES_COPY.token.holders, /no buyback/i);
    assert.match(SERVICES_COPY.token.headline, /you do not need it/i);
  });

  it('says no funding source or launch approval is recorded', () => {
    assert.match(SERVICES_COPY.token.budget, /no funding source or launch approval is recorded/i);
  });

  it('writes the published alert band in, as a percentage', () => {
    assert.equal(fill(SERVICES_COPY.alerts.kinds.market, { band: bandText(200) }).includes('2%'), true);
    assert.equal(fill('{a} and {b}', { a: 1 }), '1 and {b}');
  });

  it('marks as default exactly the kinds the subscriptions default to', () => {
    const page = readFileSync(new URL('../app/services/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /DEFAULT_KINDS\.includes\(kind\)/);
    assert.match(page, /DEFAULT_KINDS\.join\(', '\)/);
    assert.ok(DEFAULT_KINDS.length > 0);
  });
});

describe('the services page is honest in plain words', () => {
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

describe('the services page', () => {
  const page = readFileSync(new URL('../app/services/page.tsx', import.meta.url), 'utf8');

  it('reads its words from the copy module', () => {
    assert.match(page, /from '@\/lib\/copy\/services'/);
  });

  it('reads the access mode the guard reads, not a configuration of its own', () => {
    assert.match(page, /from '@\/lib\/credits\/access'/);
    assert.match(page, /accessMode\(\)/);
  });

  it('no longer prints the paid-era footnote', () => {
    for (const stale of ['Everything the site shows today stays free', 'The paid endpoints are the history and the fan-out', 'a call that is refused is not charged']) {
      assert.equal(page.includes(stale), false, stale);
    }
  });

  it('keeps the alerts where the guide sends a reader, before the token and the machinery', () => {
    const alerts = page.indexOf('id="alerts"');
    assert.ok(alerts > 0);
    assert.ok(alerts < page.indexOf('C.token.kicker'));
    assert.ok(alerts < page.indexOf('C.machinery.summary'));
    assert.match(page, /<KeyMaker/);
  });

  it('folds the payment machinery while the desk is free, and opens it when it is paid', () => {
    assert.match(page, /<details className="[^"]*" open=\{!free\}>/);
    const fold = page.slice(page.indexOf('open={!free}'));
    for (const piece of ['<CreditDesk', 'The rate', 'Receipts', 'The rule']) assert.ok(fold.includes(piece), piece);
  });
});
