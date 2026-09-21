/**
 * The words on the positions pages, kept in one place so they can be checked.
 *
 * The series page was the product's full dossier on one screen after
 * another: 4,900 words, opening on a 77-word stage line, with the simulation a
 * reader was invited to try sitting two-thirds of the way down. The dossier is
 * all still there. The page now says in four short lines what the product is
 * and is not, shows what one lot holds and what is not known about it, puts
 * the simulation next, then the checks that must pass first — and folds the
 * full record (related parties, evidence, the drill, the rules) under plain
 * headings.
 *
 * `tests/pages-copy.test.ts` holds this file to short sentences and to the
 * same claim limits as every other page.
 */

export const POSITIONS = {
  status: [
    'Not live. The series is a design you can run as a simulation.',
    'A prototype contract is tested on copies of Ethereum and on a local chain.',
    'Nothing is deployed, and no issuer integration exists.',
    'Positions do not depend on the CURB token.',
  ],

  index: {
    title: 'Positions',
    description: 'A position on one company, formed from two stock-token issuers. Not live yet: a simulation.',
    kicker: 'The position',
    headline: 'One company. Two issuers. One position.',
    sub: 'Exposure to one company, split across two stock-token issuers. Each part keeps its own way out.',
    rows: { stage: 'Stage', checks: 'Checks passed', receipt: 'Receipt', symbol: 'Symbol' },
    stage: 'design · simulation only',
    receipt: 'one whole lot · not transferable · not one share',
    illustrative: 'illustrative, not issued',
    try: 'Try the simulation',
    mechanism: 'How it would work',
    part: 'Part',
    network: 'Network',
    units: 'Units per lot',
    unitsNote: 'illustrative',
  },

  series: {
    kicker: 'The position',
    all: 'all positions',
    sub: 'Exposure to {company}, split across two stock-token issuers.',
    checks: '{passed} of {total} checks passed before real assets.',

    lot: {
      kicker: 'What one lot holds',
      unknown: 'Not known, and not guessed',
      more: 'What is known, the four checks, and sources',
      known: 'Known, from the issuer’s documents',
      checks: 'Four checks, each on its own',
      checksNote: 'Each is a decision for whoever admits the part. The lines under them are dated evidence.',
      sources: 'Sources',
    },

    simulate: {
      kicker: 'Try it',
      lede: 'Sample units only: no prices and no chain. Form lots, exit, and claim each part.',
      mechanism: 'the ledger, in the mechanism',
    },

    lookup: {
      kicker: 'Look up an address',
      lede: 'See what the index holds for any address. Until a series is live, every address comes back empty.',
    },

    sign: {
      kicker: 'Form a position with your own wallet',
      lede: 'Your wallet signs. The site sends nothing.',
    },

    gates: {
      kicker: 'What must happen first',
      lede: 'Six checks before any real asset. Each is decided by a named person, not a model.',
    },

    say: {
      will: 'What we will say, and can test',
      wont: 'What we will not say',
    },

    record: {
      kicker: 'The full record',
      lede: 'Everything behind the summary above, kept in full. Open what you need.',
      parties: 'Related parties, as the issuers’ documents name them',
      evidence: 'Evidence and status: sources, the chain, deployment, tests',
      drill: 'The drill: incidents staged on a local chain',
      rules: 'The rules of a series',
      deferred: 'Deferred',
    },
  },
} as const;

/** A line with its placeholders written in. */
export function positionsLine(line: string, vars: Readonly<Record<string, string | number>>): string {
  return line.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
