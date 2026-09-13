/**
 * Every piece of project identity lives here.
 * Renaming the project should be a one-file edit — nothing else may hardcode a name.
 */
export const BRAND = {
  /** Short mark used in the header and the tab title. */
  name: 'THE CURB',
  /** Technical slug: package name, cookie prefix, storage keys. */
  slug: 'the-curb',
  /** One line, used in the meta description and the masthead. */
  descriptor: 'One company. Multiple issuers. One position.',
  /**
   * The thesis. A stock-token holder chooses a company and, in the same act,
   * a particular way of getting exposure to it — an issuer, a contract, a set
   * of terms and an exit. The Curb is where that second choice is made in the
   * open: one position on one company, formed from several issuers, with the
   * composition inspectable and the right to every component recorded.
   */
  thesis: 'One company. Multiple issuers. One position.',
  /**
   * Where the product stands. Public copy follows this line, and the line
   * follows the record: it moved from "building" to "mainnet" on
   * 13 September 2026, the day the operator's treasury went live on Robinhood
   * Chain, at the product owner's decision; what it says is deployed and
   * what it says is not are both true of the chain that day. The front page
   * derives the same from the record itself (lib/launch/status.ts).
   */
  stage: 'Mainnet — Robinhood Chain. The operator’s treasury, a 2-of-3 Safe, is live on chain since 13 September 2026; the token and the credit desk follow it. The position product is a prototype contract tested on forks and a local chain, not yet deployed; no issuer integration exists.',
  /**
   * The desk beneath the product: the measuring agents and their line. Before
   * the American Stock Exchange had a building it was the Curb Market: claims
   * traded outside the official floor. A stock token is the same thing again.
   * "Curb" is also a limit — which is the other half of the job.
   */
  desk: {
    line: 'The ticker tells you the exposure. The desk tells you the conditions.',
  },
  domain: 'thecurb.io',
  /** Narrative universe: original financial-noir. No licensed characters, ever. */
  universe: {
    city: 'The Curb',
    districts: [
      { id: 'floor', name: 'THE FLOOR', holds: 'session and market structure' },
      { id: 'registry', name: 'THE REGISTRY', holds: 'token provenance and corporate actions' },
      { id: 'vault', name: 'THE VAULT', holds: 'holdings, flow and concentration' },
      { id: 'chambers', name: 'CHAMBERS', holds: 'eligibility, rights, change control' },
      { id: 'press', name: 'THE PRESS', holds: 'the daily paper' },
      { id: 'cage', name: 'THE CAGE', holds: 'the declared promoter, kept apart' },
    ],
  },
  paper: {
    name: 'The Curb Gazette',
    cadence: 'One story a day. Every claim sourced.',
  },
} as const;

export type Brand = typeof BRAND;
