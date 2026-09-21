/**
 * The words around the documents the site shows from the repository: the
 * mechanism, the doctrine and the decision records.
 *
 * Those pages show the file itself, not a summary of it — a summary written by
 * hand would be a second document that could disagree with the first — and
 * that rule stands. What changed is how the file is laid out: the mechanism
 * ran to 33 screens with every section open, under a 157-word introduction.
 * Each section now sits folded under its own heading, so a reader sees the
 * document's shape first and opens what they came for; the introduction says
 * what the page is in two lines. Not a word of either file is cut.
 *
 * `tests/pages-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

export const DOCUMENTS = {
  open: 'This is the full document, read from the repository when you load the page. Open any section.',
  unread: 'The file could not be read. Nothing is shown in its place.',

  mechanism: {
    title: 'Mechanism',
    description: 'How the position would work, and what has to be true before it touches a real asset.',
    kicker: 'The position',
    headline: 'How the position would work, and what has to be true first.',
    status: 'Not live · {passed} of {total} checks passed · {records} decision records: {proposed} proposed, {decided} decided',
    simulation: 'Try the simulation',
    decisions: 'Read the decision records',
    exists: 'See what exists today',
  },

  status: {
    title: 'What exists today',
    description: 'Every piece of the position product, whether it is built, and where to check it.',
    kicker: 'what exists today',
    headline: 'What exists today.',
  },

  doctrine: {
    title: 'Doctrine',
    description: 'The rules the desk is built on, each naming the file that enforces it.',
    kicker: 'The desk',
    headline: 'The rules the desk is built on.',
    sub: 'Each rule names the file that enforces it.',
    counts: '{rules} policy rules in code · {measure} agents measure · {promote} promotes · none trades',
    mechanism: 'The position product’s own rules are in the mechanism.',
  },

  decisions: {
    title: 'Decision records',
    description: 'What has to be decided before a pilot, written down before anyone decides it.',
    kicker: 'decision records',
    headline: 'What has to be decided, written down first.',
    sub: '{records} records: {proposed} proposed, {decided} decided.',
    what: 'Each says what is proposed, why, what the prototype already does, and what stays open. A record stays proposed until a named person decides it.',
    proposed: 'proposed, not decided',
  },
} as const;

/** A line with its placeholders written in. */
export function documentsLine(line: string, vars: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
