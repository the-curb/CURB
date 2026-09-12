/**
 * What the operational drill recorded, as it wrote it: contracts/evidence/drill-local.json.
 *
 * Written by tests/positions-drill.test.ts after contracts/scripts/drill.ts
 * staged the incidents on a Hardhat node (blueprint O02). Read at request
 * time like the fork evidence, shown dated, and shown as nothing when it is
 * absent — a drill nobody ran is not a drill.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DrillChainStep {
  readonly scenario: string;
  readonly who: string;
  readonly did: string;
  readonly expected: string;
  readonly outcome: 'AS_EXPECTED' | 'NOT_AS_EXPECTED';
  readonly tx: string | null;
  readonly revert: string | null;
}

export interface DrillFinding {
  readonly scenario: string;
  readonly finding: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface DrillEvidence {
  readonly ranAt: string;
  readonly chain: { readonly profile: string; readonly chainId: number; readonly note: string };
  readonly by: string;
  readonly chainSteps: readonly DrillChainStep[];
  readonly siteFindings: readonly DrillFinding[];
  readonly limits: readonly string[];
}

const FILE = () => path.join(/*turbopackIgnore: true*/ process.cwd(), 'contracts', 'evidence', 'drill-local.json');
const isStr = (v: unknown): v is string => typeof v === 'string';

export async function drillEvidence(): Promise<{ drill: DrillEvidence | null; fault: string | null }> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE(), 'utf8');
  } catch {
    return { drill: null, fault: null };
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const chain = (j.chain ?? {}) as Record<string, unknown>;
    if (!isStr(j.ranAt) || !Array.isArray(j.chainSteps) || !Array.isArray(j.siteFindings)) return { drill: null, fault: 'the drill record is not the shape the test writes' };
    return {
      drill: {
        ranAt: j.ranAt,
        chain: { profile: isStr(chain.profile) ? chain.profile : 'unknown', chainId: typeof chain.chainId === 'number' ? chain.chainId : 0, note: isStr(chain.note) ? chain.note : '' },
        by: isStr(j.by) ? j.by : '',
        chainSteps: j.chainSteps as DrillChainStep[],
        siteFindings: (j.siteFindings as DrillFinding[]).slice().sort((a, b) => a.scenario.localeCompare(b.scenario)),
        limits: Array.isArray(j.limits) ? j.limits.filter(isStr) : [],
      },
      fault: null,
    };
  } catch (cause) {
    return { drill: null, fault: cause instanceof Error ? cause.message : 'unreadable drill record' };
  }
}
