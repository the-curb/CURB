/**
 * Is the credit desk at the recorded address the contract in this
 * repository, paying to the treasury the record names?
 *
 * The same procedure as the series (lib/positions/code.ts): the deployed
 * code must equal the committed build (contracts/evidence/CreditDesk.build.json)
 * everywhere but the two immutable slots, and those must hold exactly the
 * record's token and treasury. Done every tick, shown on the services page;
 * a mismatch is a DARK condition — a desk that pays somewhere else, or runs
 * other code, is not the desk the page describes, and nothing about it is
 * trusted until a person says why.
 */

import { keccak256, toHex } from '../chain/keccak.ts';
import { rpcCall, type RpcOptions } from '../chain/rpc.ts';
import { addressWord, buildRecord, compareAgainst, type ImmutableCheck } from '../positions/code.ts';
import type { SnapshotRecord, Store } from '../store/types.ts';
import type { CreditsConfig } from './config.ts';

export const DESK_CODE_KEY = 'credits:code';

export interface DeskCodeVerification {
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

/** The expected immutable words for the record: the token, and the treasury every top-up goes to. */
export function expectedDeskImmutables(config: CreditsConfig): Record<string, string> {
  return { curb: addressWord(config.token), treasury: addressWord(config.treasury) };
}

export async function verifyDeskCode(config: CreditsConfig, opts: RpcOptions, now: Date): Promise<DeskCodeVerification> {
  const base = { chainId: config.network.chainId, address: config.desk, readAt: now.toISOString() };
  const { build, fault } = await buildRecord('CreditDesk');
  if (build === null) return { ...base, state: 'NO_BUILD', detail: fault, codeHash: null, buildCommit: null, solc: null, immutables: [] };
  const sourceRecorded = build.workingTreeClean && typeof build.sourceCommit === 'string' && /^[0-9a-f]{40}$/.test(build.sourceCommit);
  if (!sourceRecorded && config.network.chainId !== 31337) return { ...base, state: 'NO_BUILD', detail: 'public CreditDesk verification requires a build recorded from clean committed source; local rehearsal evidence is insufficient', codeHash: null, buildCommit: null, solc: build.solc, immutables: [] };
  const code = await rpcCall<string>('eth_getCode', [config.desk, 'latest'], opts);
  const buildCommit = sourceRecorded ? build.sourceCommit : null;
  if (code.state === 'UNREAD') return { ...base, state: 'UNREAD', detail: `${code.reason}${code.detail ? ` — ${code.detail}` : ''}`, codeHash: null, buildCommit, solc: build.solc, immutables: [] };
  if (code.value === '0x' || code.value.length <= 2) return { ...base, state: 'MISMATCH', detail: 'no code at the address', codeHash: null, buildCommit, solc: build.solc, immutables: [] };
  const codeHash = toHex(keccak256(Buffer.from(code.value.slice(2), 'hex')));
  const compared = compareAgainst(code.value, build, expectedDeskImmutables(config));
  return { ...base, state: compared.state, detail: compared.detail ?? (sourceRecorded ? null : 'local rehearsal build; these bytes are not attributed to a committed source release'), codeHash, buildCommit, solc: build.solc, immutables: compared.immutables };
}

export function deskCodeSnapshot(v: DeskCodeVerification): SnapshotRecord {
  return { key: DESK_CODE_KEY, observedAt: v.readAt, payload: v as unknown as Record<string, unknown> };
}

/**
 * The last verification, for the desk the configuration names: a row about
 * another address or chain (the configuration changed since the last tick)
 * is not a verification of this desk, and is answered as none — so a new
 * desk is never shown as MATCHES on the strength of the old one's read.
 */
export async function latestDeskCode(store: Store, config: CreditsConfig): Promise<{ code: DeskCodeVerification | null; storeFault: string | null }> {
  const read = await store.snapshots(DESK_CODE_KEY);
  if (read.state === 'UNREAD') return { code: null, storeFault: `${read.reason}${read.detail ? ` — ${read.detail}` : ''}` };
  const snap = read.value.find((s) => s.key === DESK_CODE_KEY);
  if (!snap) return { code: null, storeFault: null };
  const v = snap.payload as unknown as DeskCodeVerification;
  if (typeof v.address !== 'string' || v.address.toLowerCase() !== config.desk.toLowerCase() || v.chainId !== config.network.chainId) return { code: null, storeFault: null };
  return { code: v, storeFault: null };
}

