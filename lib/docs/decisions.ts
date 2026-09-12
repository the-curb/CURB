/**
 * The decision records: proposals for the choices the blueprint asks to be
 * written down (R03, R05, R06, O01, O03), kept as files in docs/decisions
 * and rendered from the file like the doctrine and the mechanism. Every one
 * is marked proposed until a named person decides; the site never upgrades
 * a proposal to a decision on its own.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DecisionRecord {
  readonly slug: string;
  readonly file: string;
  readonly title: string;
  readonly asks: string;
  readonly backlog: string;
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
];

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
