import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { AGENTS_COPY } from '../lib/copy/agents.ts';
import { CHAMBERS } from '../lib/copy/chambers.ts';
import { POSITIONS } from '../lib/copy/positions.ts';
import { DOCUMENTS } from '../lib/copy/documents.ts';
import { GAZETTE, splitFiling } from '../lib/copy/gazette.ts';
import { copySentences, copyStrings } from '../lib/copy/walk.ts';
import { parseMarkdown, sectionsOf } from '../lib/docs/markdown.ts';
import { PROMISES } from '../lib/positions/series.ts';
import { screen } from '../lib/doctrine/policy.ts';

/**
 * The rest of the site, held to the same rules as the front page: the agents,
 * Chambers, the positions, the documents and the Gazette. Every string each
 * copy module holds is walked, so a line added later is checked without
 * anyone remembering to list it.
 */

const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const MODULES = {
  agents: AGENTS_COPY,
  chambers: CHAMBERS,
  positions: POSITIONS,
  documents: DOCUMENTS,
  gazette: GAZETTE,
} as const;

for (const [name, module] of Object.entries(MODULES)) {
  describe(`the ${name} copy`, () => {
    it('keeps every sentence to twenty words or fewer', () => {
      const long = copySentences(module).filter((s) => words(s) > 20);
      assert.deepEqual(long, [], long.map((s) => `(${words(s)}) ${s}`).join(' | '));
    });

    it('averages a sentence a reader can take in at once', () => {
      const lens = copySentences(module).map(words);
      const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
      assert.ok(avg <= 13, `average ${avg.toFixed(1)} words`);
    });

    it('never says any of the claims the positions thesis refuses', () => {
      const text = copyStrings(module).join(' ').toLowerCase();
      for (const claim of PROMISES.unsupported) assert.equal(text.includes(claim.toLowerCase().replace(/\.$/, '')), false, `says: ${claim}`);
      for (const word of [/\bprotected\b/, /\bguarantee/, /\bsafe(r|ly)?\b/, /\bfirst of its kind\b/, /\bown(s|ership)? (the |a )?shares?\b/, /\bfree\b/]) {
        assert.equal(word.test(text), false, `matches ${word}`);
      }
    });

    it('passes the same claim gates a publication would', () => {
      const verdict = screen({ text: copyStrings(module).join(' '), figures: [] });
      const breaches = verdict.decision === 'ALLOW' ? [] : verdict.breaches.filter((b) => b.rule !== 'UNSOURCED_FIGURE');
      assert.deepEqual(breaches, [], breaches.map((b) => `${b.rule}: ${b.matched}`).join(' | '));
    });
  });
}

describe('each page reads its words from its copy module', () => {
  for (const [file, module] of [
    ['app/agents/page.tsx', 'agents'],
    ['app/agents/[id]/page.tsx', 'agents'],
    ['app/chambers/page.tsx', 'chambers'],
    ['app/positions/page.tsx', 'positions'],
    ['app/positions/[series]/page.tsx', 'positions'],
    ['app/mechanism/page.tsx', 'documents'],
    ['app/doctrine/page.tsx', 'documents'],
    ['app/mechanism/decisions/page.tsx', 'documents'],
    ['app/mechanism/decisions/[slug]/page.tsx', 'documents'],
    ['app/gazette/page.tsx', 'gazette'],
    ['app/gazette/[day]/page.tsx', 'gazette'],
  ] as const) {
    it(file, () => assert.match(read(file), new RegExp(`from '@/lib/copy/${module}'`)));
  }
});

describe('the positions pages', () => {
  const series = read('app/positions/[series]/page.tsx');

  it('say plainly that the product is not live and does not need the token', () => {
    assert.match(POSITIONS.status[0]!, /^Not live\./);
    assert.match(POSITIONS.status.join(' '), /do not depend on the CURB token/i);
  });

  it('put the simulation before the full record, and the full record folded', () => {
    const simulator = series.indexOf('<PositionSimulator');
    const record = series.indexOf('P.record.kicker');
    assert.ok(simulator > 0 && record > simulator, 'the simulation comes before the full record');
    for (const part of ['P.record.parties', 'P.record.evidence', 'P.record.drill', 'P.record.rules']) {
      assert.ok(series.includes('>{' + part + '}</summary>'), part);
    }
  });

  it('keep what is not known in view, and every refused claim listed', () => {
    const unknownAt = series.indexOf('{P.lot.unknown}');
    const foldAt = series.indexOf('{P.lot.more}');
    assert.ok(unknownAt > 0 && unknownAt < foldAt, 'what is not known is shown before the fold');
    assert.match(series, /PROMISES\.unsupported\.map/);
  });

  it('no longer open on the 77-word stage line', () => {
    assert.equal(series.includes('{spec.stageLine}'), false);
    assert.equal(read('app/positions/page.tsx').includes('{s.stageLine}'), false);
  });
});

describe('the documents', () => {
  it('are shown whole, each section folded, and a link to a section opens it', () => {
    for (const file of ['app/mechanism/page.tsx', 'app/doctrine/page.tsx', 'app/mechanism/decisions/[slug]/page.tsx']) {
      const page = read(file);
      assert.match(page, /<FoldedDocument blocks=\{blocks\} \/>/, file);
      assert.match(page, /<HashOpener \/>/, file);
    }
  });

  it('fold every word of the file: the sections joined are the document', () => {
    const blocks = parseMarkdown(read('MECHANISM.md'));
    const headings = blocks.filter((b) => b.kind === 'heading' && b.level === 2).length;
    assert.ok(headings >= 10, 'the mechanism has its sections');
    const { preamble, sections } = sectionsOf(blocks);
    assert.equal(preamble.length + sections.reduce((n, s) => n + 1 + s.body.length, 0), blocks.length);
  });

  it('still refuse a summary written by hand', () => {
    const text = copyStrings(DOCUMENTS).join(' ');
    assert.match(text, /full document, read from the repository/i);
    assert.equal(/in short|summary:/i.test(text), false);
  });
});

describe('a filing, cut for the page', () => {
  const body = ['MEASURED · 28 of 28', '— DELL: 573 against 585', '— ORCL: 145 against 148', '', '— TSM: 430 against 439', 'NOT READ', '— No price for CLSK'].join('\n');

  it('keeps its first four lines in view and loses nothing', () => {
    const { head, rest, restLines } = splitFiling(body);
    assert.equal(head.split('\n').filter((l) => l.trim() !== '').length, 4);
    assert.equal(`${head}\n${rest}`, body);
    assert.equal(restLines, 2);
  });

  it('shows a short filing whole', () => {
    const short = 'One line.\nTwo lines.';
    assert.deepEqual(splitFiling(short), { head: short, rest: '', restLines: 0 });
  });
});
