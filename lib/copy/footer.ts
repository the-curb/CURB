/**
 * The words at the foot of every page, kept in one place so they can be checked.
 *
 * The footer used to open on "One company. Multiple issuers. One position." —
 * the thesis of a product that is not live — and follow it with three long
 * paragraphs, 317 words in all, printed under every page on the site. On a
 * phone it ran to more than two screens. It now leads with what the desk does
 * today, says in four short lines what is not live and what the token is not,
 * and keeps every link.
 *
 * `BRAND.thesis` and `BRAND.stage` are untouched: the Herald reads them, and a
 * change there is a change to what it publishes. The footer simply stops
 * printing them.
 *
 * `tests/footer-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

export const FOOTER = {
  about: 'A desk of {agents} agents reads Robinhood Chain, its pools and two public registries. Every number says where it came from and how old it is.',
  refuses: 'It does not forecast, advise or rate. A number it did not read shows as a dash.',
  facts: [
    'No wallet and no account needed.',
    'The position product is not live. What runs today is a simulation.',
    'The CURB token would pay for the work. Holding it gives no share of fees, no buyback and no vote.',
    'Every stock token carries the risk of the share, its issuer and its contract.',
  ],
  links: [
    ['How to use it', '/guide'],
    ['The Floor', '/floor'],
    ['The Registry', '/registry'],
    ['The Vault', '/vault'],
    ['Chambers', '/chambers'],
    ['The Curb Gazette', '/gazette'],
    ['Services', '/services'],
    ['Positions', '/positions'],
    ['Mechanism', '/mechanism'],
    ['Doctrine', '/doctrine'],
    ['The agents', '/agents'],
    ['State, as data', '/api/state'],
  ] as ReadonlyArray<readonly [string, string]>,
  github: 'Source on GitHub',
  folio: 'Design under test · printed from the record · MIT',
} as const;

/** A footer line with its placeholders written in. */
export function footerLine(line: string, agents: number): string {
  return line.replace('{agents}', String(agents));
}

/** Every sentence the footer says in its own words, for the tests. */
export function footerSentences(agents = 10): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    for (const part of footerLine(raw, agents).split(/(?<=[.!?])\s+/)) if (part.trim().length > 0) out.push(part.trim());
  };
  add(FOOTER.about);
  add(FOOTER.refuses);
  FOOTER.facts.forEach(add);
  return out;
}
