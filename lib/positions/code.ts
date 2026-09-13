/**
 * Is the series at the recorded address the contract in this repository?
 *
 * The compiled runtime bytecode is committed with the commit it came from
 * (contracts/evidence/CompanySeries.build.json). A deployed series matches
 * when its code equals that bytecode everywhere but the immutable slots,
 * and each immutable slot holds exactly what the deployment record says —
 * the two component addresses, the units per lot, the cap. That is the
 * contract verification procedure of gate G2's plan, done by the site on
 * every tick and shown on the series page. No explorer is asked, and a
 * mismatch is a DARK condition: the address is not what the record says
 * it is, and nothing about it is trusted until a person says why.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { keccak256, toHex } from '../chain/keccak.ts';
import { rpcCall, type RpcOptions } from '../chain/rpc.ts';
import type { SnapshotRecord, Store } from '../store/types.ts';
import type { SeriesDeployment } from './deployments.ts';

export interface BuildRecord {
  readonly contract: string;
  readonly solc: string | null;
  /** The commit the record was written at. */
  readonly commit: string;
  /** The commit that last changed the source — what a deployment is the build of; stable when the record is merely re-run. */
  readonly sourceCommit: string | null;
  readonly workingTreeClean: boolean;
  readonly recordedAt: string;
  readonly deployedBytecode: string;
  readonly immutables: readonly { readonly name: string; readonly slots: readonly { readonly start: number; readonly length: number }[] }[];
}

export interface ImmutableCheck {
  readonly name: string;
  readonly expected: string;
  readonly onChain: string | null;
  readonly matches: boolean;
}

export interface CodeVerification {
  readonly seriesId: string;
  readonly chainId: number;
  readonly address: string;
  readonly state: 'MATCHES' | 'MISMATCH' | 'UNREAD' | 'NO_BUILD';
  readonly detail: string | null;
  readonly codeHash: string | null;
  readonly buildCommit: string | null;
  readonly solc: string | null;
  readonly immutables: readonly ImmutableCheck[];
  readonly readAt: string;
}

const FILE = (contract: string) => path.join(/*turbopackIgnore: true*/ process.cwd(), 'contracts', 'evidence', `${contract}.build.json`);
export const CODE_KEY = (seriesId: string) => `positions:code:${seriesId}`;

/** The committed build of one contract — the series by default; the credit desk reads its own. */
export async function buildRecord(contract = 'CompanySeries'): Promise<{ build: BuildRecord | null; fault: string | null }> {
  try {
    const j = JSON.parse(await fs.readFile(FILE(contract), 'utf8')) as Record<string, unknown>;
    if (typeof j.deployedBytecode !== 'string' || !Array.isArray(j.immutables) || typeof j.commit !== 'string') return { build: null, fault: 'the build record is not the shape the script writes' };
    return {
      build: {
        contract: typeof j.contract === 'string' ? j.contract : contract,
        solc: typeof j.solc === 'string' ? j.solc : null,
        commit: j.commit,
        sourceCommit: typeof j.sourceCommit === 'string' ? j.sourceCommit : null,
        workingTreeClean: j.workingTreeClean === true,
        recordedAt: typeof j.recordedAt === 'string' ? j.recordedAt : '',
        deployedBytecode: j.deployedBytecode.toLowerCase(),
        immutables: j.immutables as BuildRecord['immutables'],
      },
      fault: null,
    };
  } catch (cause) {
    return { build: null, fault: cause instanceof Error ? cause.message : 'no build record' };
  }
}

export const word = (n: bigint) => n.toString(16).padStart(64, '0');
export const addressWord = (a: string) => a.slice(2).toLowerCase().padStart(64, '0');

/** The expected immutable words for a deployment record, by the names the build record uses. */
export function expectedImmutables(deployment: SeriesDeployment): Record<string, string> {
  return {
    componentA: addressWord(deployment.components.A),
    componentB: addressWord(deployment.components.B),
    qA: word(deployment.q.A),
    qB: word(deployment.q.B),
    capLots: word(deployment.capLots),
  };
}

/** Compare on-chain code with the build: equal outside the immutable slots, and the slots hold the record's values. Pure. */
export function compareCode(codeHex: string, build: BuildRecord, deployment: SeriesDeployment): { state: 'MATCHES' | 'MISMATCH'; detail: string | null; immutables: ImmutableCheck[] } {
  return compareAgainst(codeHex, build, expectedImmutables(deployment));
}

/** The same comparison for any contract with a build record: the expected words are given by the immutables' names. Pure. */
export function compareAgainst(codeHex: string, build: BuildRecord, want: Readonly<Record<string, string>>): { state: 'MATCHES' | 'MISMATCH'; detail: string | null; immutables: ImmutableCheck[] } {
  const code = codeHex.toLowerCase().replace(/^0x/, '');
  const expected = build.deployedBytecode.replace(/^0x/, '');
  if (code.length !== expected.length) {
    return { state: 'MISMATCH', detail: `the code is ${code.length / 2} bytes; the build is ${expected.length / 2}`, immutables: [] };
  }
  const masked = new Set<number>();
  for (const im of build.immutables) for (const s of im.slots) for (let i = 0; i < s.length; i += 1) masked.add(s.start + i);
  for (let i = 0; i < code.length / 2; i += 1) {
    if (masked.has(i)) continue;
    if (code.slice(i * 2, i * 2 + 2) !== expected.slice(i * 2, i * 2 + 2)) {
      return { state: 'MISMATCH', detail: `the code differs from the build at byte ${i}, outside every immutable slot`, immutables: [] };
    }
  }
  const immutables: ImmutableCheck[] = build.immutables.map((im) => {
    const values = new Set(im.slots.map((s) => code.slice(s.start * 2, (s.start + s.length) * 2)));
    const onChain = values.size === 1 ? [...values][0]! : null;
    const exp = want[im.name] ?? '';
    return { name: im.name, expected: `0x${exp}`, onChain: onChain === null ? null : `0x${onChain}`, matches: onChain !== null && onChain === exp };
  });
  const wrong = immutables.filter((c) => !c.matches);
  return wrong.length === 0
    ? { state: 'MATCHES', detail: null, immutables }
    : { state: 'MISMATCH', detail: `the code is the build, but ${wrong.map((c) => c.name).join(', ')} in it ${wrong.length === 1 ? 'is' : 'are'} not what the record says`, immutables };
}

export async function verifySeriesCode(deployment: SeriesDeployment, opts: RpcOptions, now: Date): Promise<CodeVerification> {
  const base = { seriesId: deployment.seriesId, chainId: deployment.chainId, address: deployment.address, readAt: now.toISOString() };
  const { build, fault } = await buildRecord();
  if (build === null) return { ...base, state: 'NO_BUILD', detail: fault, codeHash: null, buildCommit: null, solc: null, immutables: [] };
  const provenance = seriesBuildProvenance(build, deployment.chainId);
  if (!provenance.allowed) return { ...base, state: 'NO_BUILD', detail: provenance.detail, codeHash: null, buildCommit: null, solc: build.solc, immutables: [] };
  const code = await rpcCall<string>('eth_getCode', [deployment.address, 'latest'], opts);
  if (code.state === 'UNREAD') return { ...base, state: 'UNREAD', detail: `${code.reason}${code.detail ? ` — ${code.detail}` : ''}`, codeHash: null, buildCommit: provenance.sourceCommit, solc: build.solc, immutables: [] };
  if (code.value === '0x' || code.value.length <= 2) return { ...base, state: 'MISMATCH', detail: 'no code at the address', codeHash: null, buildCommit: provenance.sourceCommit, solc: build.solc, immutables: [] };
  const codeHash = toHex(keccak256(Buffer.from(code.value.slice(2), 'hex')));
  const compared = compareCode(code.value, build, deployment);
  return { ...base, state: compared.state, detail: compared.detail ?? provenance.detail, codeHash, buildCommit: provenance.sourceCommit, solc: build.solc, immutables: compared.immutables };
}

/** Local bytes may be rehearsed without attributing them to a commit that never contained them. */
export function seriesBuildProvenance(build: Pick<BuildRecord, 'sourceCommit' | 'workingTreeClean'>, chainId: number): { allowed: boolean; sourceCommit: string | null; detail: string | null } {
  const recorded = build.workingTreeClean && typeof build.sourceCommit === 'string' && /^[0-9a-f]{40}$/.test(build.sourceCommit);
  if (recorded) return { allowed: true, sourceCommit: build.sourceCommit, detail: null };
  return chainId === 31337
    ? { allowed: true, sourceCommit: null, detail: 'local rehearsal build; these bytes are not attributed to a committed source release' }
    : { allowed: false, sourceCommit: null, detail: 'public series verification requires a build recorded from clean committed source; local rehearsal evidence is insufficient' };
}

export function codeSnapshot(v: CodeVerification): SnapshotRecord {
  return { key: CODE_KEY(v.seriesId), observedAt: v.readAt, payload: v as unknown as Record<string, unknown> };
}

export async function latestCodeVerification(store: Store, seriesId: string): Promise<{ code: CodeVerification | null; storeFault: string | null }> {
  const read = await store.snapshots(CODE_KEY(seriesId));
  if (read.state === 'UNREAD') return { code: null, storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const snap = read.value.find((s) => s.key === CODE_KEY(seriesId));
  return { code: snap ? (snap.payload as unknown as CodeVerification) : null, storeFault: null };
}
