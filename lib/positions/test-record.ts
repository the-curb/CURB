/**
 * The recorded unit-test run of the contract prototype: contracts/evidence/unit-tests.json,
 * written by `node scripts/record-tests.mjs` in contracts/ (blueprint C07: the seed, the
 * results and the commit). Read at request time; nothing shown when absent.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface TestRecord {
  readonly ranAt: string;
  readonly commit: string;
  readonly workingTreeClean: boolean;
  readonly solc: string | null;
  readonly fuzz: { readonly seed: string | null; readonly runs: number | null };
  readonly passing: number;
  readonly failing: number;
  readonly tests: readonly { readonly name: string; readonly passed: boolean; readonly fuzzRuns: number | null }[];
  readonly limit: string;
}

const FILE = () => path.join(/*turbopackIgnore: true*/ process.cwd(), 'contracts', 'evidence', 'unit-tests.json');

export async function testRecord(): Promise<{ record: TestRecord | null; fault: string | null }> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE(), 'utf8');
  } catch {
    return { record: null, fault: null };
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (typeof j.ranAt !== 'string' || typeof j.commit !== 'string' || typeof j.passing !== 'number' || typeof j.failing !== 'number') return { record: null, fault: 'the test record is not the shape the script writes' };
    const fuzz = (j.fuzz ?? {}) as Record<string, unknown>;
    return {
      record: {
        ranAt: j.ranAt,
        commit: j.commit,
        workingTreeClean: j.workingTreeClean === true,
        solc: typeof j.solc === 'string' ? j.solc : null,
        fuzz: { seed: typeof fuzz.seed === 'string' ? fuzz.seed : null, runs: typeof fuzz.runs === 'number' ? fuzz.runs : null },
        passing: j.passing,
        failing: j.failing,
        tests: Array.isArray(j.tests) ? (j.tests as TestRecord['tests']) : [],
        limit: typeof j.limit === 'string' ? j.limit : '',
      },
      fault: null,
    };
  } catch (cause) {
    return { record: null, fault: cause instanceof Error ? cause.message : 'unreadable test record' };
  }
}
