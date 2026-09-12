/**
 * The decision records: proposals for the choices the blueprint asks to be
 * written down (R03, R05, R06, O01, O03), kept as files in docs/decisions
 * and rendered from the file like the doctrine and the mechanism. Every one
 * is marked proposed until a named person decides; the site never upgrades
 * a proposal to a decision on its own.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export type DecisionStatus = 'proposed' | 'partly decided' | 'decided';

export interface DecisionRecord {
  readonly slug: string;
  readonly file: string;
  readonly title: string;
  readonly asks: string;
  readonly backlog: string;
  /** Proposed unless a named person decided it; the record's own status line says who and when. */
  readonly status?: DecisionStatus;
}

export const DECISIONS: readonly DecisionRecord[] = [
  { slug: 'adr-001-immutable-series', file: 'ADR-001-immutable-series.md', title: 'A series is immutable', asks: 'no upgrade, no component swap, no change of units per lot; a change is a new series', backlog: 'R06' },
  { slug: 'adr-002-nontransferable-receipt', file: 'ADR-002-nontransferable-receipt.md', title: 'The receipt does not transfer', asks: 'exit is by claim, not by sale; no restricted-transfer toggle', backlog: 'R03, R06' },
  { slug: 'adr-003-on-chain-access', file: 'ADR-003-on-chain-access.md', title: 'Access is a permit on chain', asks: 'who may hold, who the pilot is for, revocation, and a holder who loses access', backlog: 'R03, R06' },
  { slug: 'adr-004-per-component-stops', file: 'ADR-004-per-component-stops.md', title: 'Stops are per operation and per component', asks: 'what the operator can stop, and that a stop moves nothing', backlog: 'R06' },
  { slug: 'adr-005-no-sweep-claims-to-holder', file: 'ADR-005-no-sweep-claims-to-holder.md', title: 'Nothing is swept; a claim is paid only to its holder', asks: 'no rescue function, no third-party payee, effects before transfer', backlog: 'R06' },
  { slug: 'adr-006-lots-and-cap', file: 'ADR-006-lots-and-cap.md', title: 'Units per lot, decimals, lot size and the cap', asks: 'the method for choosing q, a receipt of 0 decimals, a cap that counts reserved liability', backlog: 'R05' },
  { slug: 'operations', file: 'OPERATIONS.md', title: 'Operator policy', asks: 'signers and quorum, what each action needs, rotation, logging, limits on pausing', backlog: 'O01' },
  { slug: 'runbook', file: 'RUNBOOK.md', title: 'Runbook', asks: 'the incident order, the rehearsed incidents, lost access and keys, what is never said', backlog: 'O03' },
  { slug: 'costs', file: 'COSTS.md', title: 'Cost against the baseline', asks: 'the measured gas of a round trip with both real components, the method with its variables left as variables, and what the comparison cannot say', backlog: 'B01' },
  { slug: 'deployment', file: 'DEPLOYMENT.md', title: 'Deployment plan', asks: 'what has to be true first, the reviewed record, the steps, the two verifications, and what there is no plan for', backlog: 'G02' },
  { slug: 'assumptions', file: 'ASSUMPTIONS.md', title: 'The assumption register', asks: 'every question that needs a person, what is assumed meanwhile and why it is the conservative assumption, and what the site says while it holds', backlog: '§19' },
  { slug: 'review', file: 'REVIEW.md', title: 'A self-review, not a review', asks: 'the checklist a reviewer would walk, walked by the author; one open finding; what it did not do', backlog: 'C09' },
  { slug: 'interviews', file: 'INTERVIEWS.md', title: 'The interview guide', asks: 'who to talk to, the conversation, the scoring, the comprehension test — ready to run, not run', backlog: 'R04, B02' },
  {
    slug: 'token',
    file: 'TOKEN.md',
    title: 'The CURB token: one function',
    asks: 'prepaid credit for services that exist, priced in dollars and paid in CURB at a rate read from the chain; validity, cancellation, what the token does not do, the proceeds budget, and the order: services first, launch after — decided by the product owner on 12 September 2026, Robinhood Chain included',
    backlog: '§16',
    status: 'decided',
  },
];

export function statusOf(record: DecisionRecord): DecisionStatus {
  return record.status ?? 'proposed';
}

export function decisionBySlug(slug: string): DecisionRecord | null {
  return DECISIONS.find((d) => d.slug === slug) ?? null;
}

const DIR = () => path.join(/*turbopackIgnore: true*/ process.cwd(), 'docs', 'decisions');

export async function readDecision(record: DecisionRecord): Promise<{ source: string | null; fault: string | null }> {
  try {
    return { source: await fs.readFile(path.join(DIR(), record.file), 'utf8'), fault: null };
  } catch (cause) {
    return { source: null, fault: cause instanceof Error ? cause.message : 'unreadable' };
  }
}
