/**
 * What the desk charges to use, declared once.
 *
 * Everything this desk measures is worth nothing sitting behind a key nobody
 * has raised. The credit machinery — the contract, the indexer, the rate read
 * from a pool, the receipts — was built and is kept, tested and readable; what
 * changed on 20 September 2026 is that it no longer stands between a reader
 * and an answer. The desk is free to use.
 *
 * One constant decides it, and everything downstream reads this one constant:
 * the guard that would have charged, the routes that would have demanded a
 * key, the price list, the services page, the front page and the API. A page
 * that says "free" while an endpoint answers 402 is the same class of lie as a
 * price shown without its age, and the only way to make that impossible is to
 * leave exactly one place where the answer lives.
 *
 * `PRICES_IF_CHARGED` stays published while the mode is FREE, because "this is
 * what a call would cost if it were charged" is a fact worth being able to
 * read, and because a price list that vanishes and reappears is worse than one
 * that says plainly which of the two states it is in.
 */

export type AccessMode = 'FREE' | 'PAID';

/**
 * The environment variable an operator may set to run a deployment in the
 * other mode. It is not a back door around the declaration: the pages read the
 * same function the guard does, so whichever mode a deployment is in, what it
 * says and what it does are the same thing. Unset — and it is unset in
 * production — the declared mode below is what runs.
 */
export const ACCESS_ENV = 'CURB_ACCESS';

export const ACCESS = {
  /** The decision. What runs, unless a deployment sets ACCESS_ENV. */
  declared: 'FREE' as AccessMode,
  decidedBy: 'the product owner',
  decidedOn: '2026-09-20',
  why: 'A desk nobody can read is not a desk. Use comes first; how the work is paid for is a separate question and is not answered by charging the reader.',
} as const;

/**
 * The mode in force: what a caller asked for, else what this deployment is set
 * to, else the declared decision. One function, read by the guard and by every
 * page, so the two cannot disagree.
 */
export function accessMode(mode?: AccessMode): AccessMode {
  if (mode !== undefined) return mode;
  const raw = process.env[ACCESS_ENV];
  return raw === 'PAID' || raw === 'FREE' ? raw : ACCESS.declared;
}

export function isFree(mode?: AccessMode): boolean {
  return accessMode(mode) === 'FREE';
}

/**
 * The one sentence every page renders, so none of them can drift from the
 * guard. It says what is true now and what stays true about the record.
 */
export const ACCESS_NOTICE = {
  FREE: 'Free to use. No key, no credit and no wallet: every endpoint below answers an ordinary request, and nothing is charged for any of them.',
  PAID: 'Paid per call in prepaid credit. A key the chain has credited is presented on each request, and the listed price is charged once the answer exists.',
} as const;

/** The heading each mode puts on the price list. */
export const ACCESS_TITLE = {
  FREE: 'What a call would cost, if it were charged',
  PAID: 'What a call costs',
} as const;

/**
 * What a key is for while the desk is free.
 *
 * A subscription still needs to know whose webhook it is, and that is all a
 * key does now: it names a subscriber. It is raised in the browser or at
 * POST /api/keys, it needs no top-up, and it is never charged. Nothing is
 * looked up about it on chain.
 */
export const KEY_IS_IDENTITY_ONLY =
  'A key names a subscription; it is not a payment. Raise one in the browser or at POST /api/keys, register a webhook with it, and nothing is ever charged to it.';
