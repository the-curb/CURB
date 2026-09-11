/**
 * Every piece of project identity lives here.
 * Renaming the project should be a one-file edit — nothing else may hardcode a name.
 */
export const BRAND = {
  /** Short mark used in the header and the tab title. */
  name: 'THE CURB',
  /** Technical slug: package name, cookie prefix, storage keys. */
  slug: 'the-curb',
  /** One line, used in the meta description and the hero. */
  descriptor: 'Stock tokens, with the conditions in view.',
  /**
   * The thesis. Before the American Stock Exchange had a building it was the Curb
   * Market: claims traded outside the official floor. A stock token is the same
   * thing again. "Curb" is also a limit — which is the other half of the job.
   */
  thesis: 'The ticker tells you the exposure. The curb tells you the conditions.',
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
