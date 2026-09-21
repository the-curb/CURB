import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { FLOOR, floorSentences } from '../lib/copy/floor.ts';
import { PROMISES } from '../lib/positions/series.ts';
import { screen } from '../lib/doctrine/policy.ts';

/**
 * The Floor measured as a twenty-five minute read: six agent filings printed
 * in full, a 110-word paragraph to explain the columns, and column names only
 * an insider could read. These tests keep the page short, keep its words
 * plain, and keep plain words from saying what the desk would not.
 */

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const everything = () => [FLOOR.headline, ...floorSentences(), ...Object.values(FLOOR.columns), ...FLOOR.legend.items.map((i) => i.term)].join(' ');

describe('the Floor is short', () => {
  it('says what the page is in under fifteen words', () => {
    assert.ok(words(FLOOR.headline) < 15, `"${FLOOR.headline}"`);
    assert.ok(words(FLOOR.sub) <= 20, `"${FLOOR.sub}"`);
  });

  it('keeps every sentence to twenty words or fewer', () => {
    const long = floorSentences().filter((s) => words(s) > 20);
    assert.deepEqual(long, [], long.map((s) => `(${words(s)}) ${s}`).join(' | '));
  });

  it('averages a sentence a reader can take in at once', () => {
    const lens = floorSentences().map(words);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    assert.ok(avg <= 13, `average ${avg.toFixed(1)} words`);
  });

  it('explains every column in one line', () => {
    for (const item of FLOOR.legend.items) assert.ok(words(item.means) <= 16, `${item.term}: ${item.means}`);
  });

  it('names its columns in words a newcomer knows', () => {
    const insider = /basis|heartbeat|identity|oracle|bp\b|feed updated|sampled/i;
    for (const [key, label] of Object.entries(FLOOR.columns)) assert.equal(insider.test(label), false, `${key}: "${label}"`);
  });
});

describe('the Floor is honest in plain words', () => {
  it('never says any of the claims the positions thesis refuses', () => {
    const text = everything().toLowerCase();
    for (const claim of PROMISES.unsupported) assert.equal(text.includes(claim.toLowerCase().replace(/\.$/, '')), false, `says: ${claim}`);
    for (const word of [/\bprotected\b/, /\bguarantee/, /\bsafe(r|ly)?\b/, /\bfirst of its kind\b/, /\breal (stock|price|share)/, /\bown(s|ership)? (the |a )?shares?\b/]) {
      assert.equal(word.test(text), false, `matches ${word}`);
    }
  });

  it('passes the same claim gates a publication would', () => {
    const verdict = screen({ text: everything(), figures: [] });
    const breaches = verdict.decision === 'ALLOW' ? [] : verdict.breaches.filter((b) => b.rule !== 'UNSOURCED_FIGURE');
    assert.deepEqual(breaches, [], breaches.map((b) => `${b.rule}: ${b.matched}`).join(' | '));
  });

  it('still says the size is not an offer and the gap does not say which way it closes', () => {
    assert.match(FLOOR.legend.items.find((i) => i.term === 'Moves it 1%')!.means, /not an offer/i);
    assert.match(FLOOR.tips.gap, /which way it closes is not stated/i);
  });

  it('still says an absence is a dash and never a zero', () => {
    assert.match(FLOOR.footer[0], /dash/i);
    assert.match(FLOOR.footer[0], /never as zero/i);
  });

  it('warns that late feeds are normal while the market is closed, so a weekend does not read as a fault', () => {
    assert.match(FLOOR.closedNote, /normal/i);
    assert.match(FLOOR.tips.late, /closed/i);
  });
});

describe('the Floor page', () => {
  const page = readFileSync(new URL('../app/floor/page.tsx', import.meta.url), 'utf8');
  const board = readFileSync(new URL('../app/components/floor-board.tsx', import.meta.url), 'utf8');

  it('reads its words from the copy module', () => {
    assert.match(page, /from '@\/lib\/copy\/floor'/);
    assert.match(board, /from '@\/lib\/copy\/floor'/);
  });

  it('opens on the board, before the market details and the agents', () => {
    const boardAt = page.indexOf('<FloorBoard');
    assert.ok(boardAt > 0);
    assert.ok(boardAt < page.indexOf('FLOOR.bell.kicker'), 'the market panel comes before the board');
    assert.ok(boardAt < page.indexOf('FLOOR.warden.kicker'), 'the agents panel comes before the board');
  });

  it('keeps every filing word for word, folded rather than cut', () => {
    // The body is still rendered in full; it sits inside a <details> the
    // reader opens, not in the reading path.
    const wire = page.slice(page.indexOf('FLOOR.wire.kicker'));
    assert.match(wire, /<details[\s\S]*\{pub\.body\}/);
  });

  it('renders a gap in percent and keeps the basis points on hover', () => {
    assert.match(board, /function percent\(bps: number\)/);
    assert.match(board, /basis points/);
  });
});
